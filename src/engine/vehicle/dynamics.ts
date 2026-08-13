/**
 * Hybrid dynamics — Newtonian plane + yaw with two-axle tyres.
 *
 * Force inventory (§1.2b): weight → Fz; DF → +Fz + drag; pitch/roll → ΔFz;
 * tyres = only contact patch; Mag is a separate autopilot actuator (see grooveAutopilot).
 *
 * State representation (Phase 1): Frenet (s,l) for track binding + forward speed v,
 * yaw rate ω, heading/slipAngle β. World pose is projected from ribbon samples.
 */
import { PHYSICS } from '../../data/physics';

/** Base curb weight (kg) — inertia + normal load. Garage mass comes in Phase 5. */
export const HYBRID_MASS_KG = 1180;
/** Yaw inertia proxy I_z (kg·m²). */
export const HYBRID_IZ = HYBRID_MASS_KG * 1.35;
export const HYBRID_WHEELBASE = 2.7;
export const HYBRID_TRACK_WIDTH = 1.55;
export const HYBRID_CG_HEIGHT = 0.42;
/** Load sensitivity exponent n<1 — doubling Fz does not double Fy max. */
export const HYBRID_LOAD_SENS_N = 0.88;
export const HYBRID_RHO = 1.225;
/** Maps stats.D into CL so mid-corner DF ≈ legacy (1+D) grip at vMax. */
export const HYBRID_CL_FROM_D = 10;
/** Base magnetic rail downforce (N) — speed-independent, the Scalextric soul. */
export const HYBRID_MAG_FORCE = 1100;
/**
 * Corner/brake "squat" multiplies magnetic pull — the car loads toward the
 * rail under lateral g (F_mag ~ 1/gap², bounded). Adds the authentic
 * "loads up in corners" feel instead of a flat grip knob.
 */
export const HYBRID_MAG_LOADUP = 0.5;
export const HYBRID_CD_BASE = 0.32;
export const HYBRID_CD_FROM_CL = 0.1;
/** Front weight distribution at rest (0–1). */
export const HYBRID_STATIC_FRONT = 0.48;

export interface AxleLoads {
  fzFront: number;
  fzRear: number;
  fzTotal: number;
  /** Downforce contribution (N). */
  fDownforce: number;
  /** Aero drag (N), opposing velocity. */
  fDrag: number;
}

export interface AeroScale {
  clScale?: number;
  cdScale?: number;
}

/**
 * Dynamic pressure q = ½ρv²; DF adds Fz and induced drag.
 * Signs: DF presses down (+Fz), drag opposes long velocity.
 * Spoiler scales CL and CD together so DF is never free.
 * DownforceD also proxies the magnet's strength — the rail adds a
 * speed-independent magnetic component on top of the aero part.
 */
export function aeroForces(
  v: number,
  downforceD: number,
  scale: AeroScale = {},
): { q: number; fDownforce: number; fDrag: number; cl: number; cd: number } {
  const q = 0.5 * HYBRID_RHO * v * v;
  const clScale = scale.clScale ?? 1;
  const cdScale = scale.cdScale ?? 1;
  const cl = Math.max(0, downforceD) * HYBRID_CL_FROM_D * clScale;
  const cd = (HYBRID_CD_BASE + HYBRID_CD_FROM_CL * cl) * cdScale;
  // Magnetic rail DF — present even at zero speed (real slot-car magnets).
  const fMag = HYBRID_MAG_FORCE * (0.5 + Math.max(0, downforceD));
  return {
    q,
    fDownforce: q * cl + fMag,
    fDrag: q * cd,
    cl,
    cd,
  };
}

export interface LoadTransferOpts {
  cgHeight?: number;
  staticFront?: number;
  clScale?: number;
  cdScale?: number;
}

/**
 * Quasi-steady pitch + roll load transfer → axle Fz.
 * Roll L/R collapsed into effective axle loads (two-axle model).
 */
export function computeAxleLoads(
  massKg: number,
  v: number,
  aLong: number,
  aLat: number,
  downforceD: number,
  balanceB: number,
  suspStiffness = 1,
  opts: LoadTransferOpts = {},
): AxleLoads {
  const g = PHYSICS.g;
  const cgH = opts.cgHeight ?? HYBRID_CG_HEIGHT;
  const staticFront = opts.staticFront ?? HYBRID_STATIC_FRONT;
  const aero = aeroForces(v, downforceD, {
    clScale: opts.clScale,
    cdScale: opts.cdScale,
  });
  // Magnetic load-up: cornering / braking squat the car toward the rail, which
  // pulls the magnet closer → more downforce (1/gap² behaviour, bounded).
  const squatLoad = Math.min(
    1.1,
    (Math.abs(aLat) / g) * 0.6 + (Math.max(0, -aLong) / g) * 0.4,
  );
  const fzStatic = massKg * g + aero.fDownforce * (1 + HYBRID_MAG_LOADUP * squatLoad);

  // Pitch: brake → front; accel → rear. balanceB soft-filters aLong/scale.
  const pitchRaw = (massKg * aLong * cgH) / HYBRID_WHEELBASE;
  const pitch = pitchRaw * (0.65 + 0.35 / Math.max(0.5, suspStiffness));
  // Soft CG bias from balanceB (−1 front-loaded under brake).
  const pitchSoft = pitch + balanceB * massKg * g * 0.04;

  // Roll transfer magnitude — soft susp transfers more, reducing total µFz via load sens.
  const rollRaw = (massKg * Math.abs(aLat) * cgH) / HYBRID_TRACK_WIDTH;
  const rollFrac = Math.min(
    0.35,
    (rollRaw / Math.max(fzStatic, 1)) * (1.15 - 0.2 * suspStiffness),
  );

  let fzFront = fzStatic * staticFront - pitchSoft;
  let fzRear = fzStatic * (1 - staticFront) + pitchSoft;
  // Collapse roll: unload "inside" equally on both axles' effective grip later via n.
  const rollUnload = fzStatic * rollFrac * 0.5;
  fzFront = Math.max(massKg * g * 0.08, fzFront - rollUnload * 0.45);
  fzRear = Math.max(massKg * g * 0.08, fzRear - rollUnload * 0.55);

  return {
    fzFront,
    fzRear,
    fzTotal: fzFront + fzRear,
    fDownforce: aero.fDownforce,
    fDrag: aero.fDrag,
  };
}

/** Peak lateral/long force for an axle with load sensitivity. */
export function axleMuForce(mu: number, fz: number, fzRef: number): number {
  const n = HYBRID_LOAD_SENS_N;
  const ref = Math.max(1, fzRef);
  // F_max = µ Fz_ref (Fz/Fz_ref)^n
  return mu * ref * Math.pow(Math.max(0.05, fz / ref), n);
}

/**
 * Effective lateral grip accel (m/s²) from axle loads — replaces bare µ·g
 * so weight and DF sit on a real Fz path.
 */
export function gripAccelFromLoads(muEff: number, loads: AxleLoads, massKg: number): number {
  const fzRef = (massKg * PHYSICS.g) * 0.5;
  const fMaxF = axleMuForce(muEff, loads.fzFront, fzRef);
  const fMaxR = axleMuForce(muEff, loads.fzRear, fzRef);
  return (fMaxF + fMaxR) / Math.max(massKg, 1);
}
