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
export const HYBRID_CL_FROM_D = 14;
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

export interface AxleForces {
  fx: number;
  fy: number;
  /** Combined slip usage 0..∞ (1 = at friction limit). */
  usage: number;
}

export interface TyreAxleState {
  slipRatio: number;
  slipAngle: number;
  fx: number;
  fy: number;
  fz: number;
  usage: number;
}

export interface AeroScale {
  clScale?: number;
  cdScale?: number;
}

/**
 * Dynamic pressure q = ½ρv²; DF adds Fz and induced drag.
 * Signs: DF presses down (+Fz), drag opposes long velocity.
 * Spoiler scales CL and CD together so DF is never free.
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
  return {
    q,
    fDownforce: q * cl,
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
  const fzStatic = massKg * g + aero.fDownforce;

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
 * Brush / MF-lite combined slip on one axle.
 * κ long-slip (−1..1-ish), α slip angle (rad).
 */
export function axleBrushForces(
  kappa: number,
  alpha: number,
  fz: number,
  mu: number,
  fzRef: number,
  /** Drive/brake preference: +1 drive, −1 brake bias on long axis. */
  longSign = 0,
): AxleForces {
  const fMax = axleMuForce(mu, fz, fzRef);
  // Cornering / long stiffness proxies (N/rad, N per unit slip).
  const Cy = fMax * 8.5;
  const Cx = fMax * 12;

  const fyLin = -Cy * alpha;
  const fxLin = Cx * kappa + longSign * 0; // kappa carries drive/brake

  // Friction ellipse saturation
  const fy = fyLin;
  const fx = fxLin;
  const mag = Math.hypot(fx, fy);
  if (mag <= fMax || mag < 1e-9) {
    return { fx, fy, usage: mag / Math.max(fMax, 1e-6) };
  }
  const scale = fMax / mag;
  return { fx: fx * scale, fy: fy * scale, usage: 1 / scale };
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

/**
 * Split long demand into axle slip ratios and produce combined tyre forces
 * under Mag-commanded front steer (rad).
 */
export function resolveTwoAxleTyres(args: {
  massKg: number;
  v: number;
  yawRate: number;
  slipAngle: number;
  steerRad: number;
  muEff: number;
  loads: AxleLoads;
  /** Desired long accel from drive−brake−coast before tyre limit (m/s²). */
  aLongDemand: number;
  /** Path curvature for kinematic yaw (1/m). */
  kappaPath: number;
  /** Front brake bias 0–1 (trail-brake story). */
  brakeBiasFront?: number;
  staticFront?: number;
}): {
  front: TyreAxleState;
  rear: TyreAxleState;
  fxTotal: number;
  fyTotal: number;
  mzTyre: number;
  aLong: number;
  aLat: number;
  usage: number;
} {
  const {
    massKg,
    v,
    yawRate,
    slipAngle,
    steerRad,
    muEff,
    loads,
    aLongDemand,
    kappaPath,
    brakeBiasFront = 0.58,
    staticFront = HYBRID_STATIC_FRONT,
  } = args;
  const vSafe = Math.max(1.2, v);
  const lf = HYBRID_WHEELBASE * (1 - staticFront);
  const lr = HYBRID_WHEELBASE * staticFront;

  // Body-frame slip angles (small-angle bicycle).
  const alphaF = slipAngle + (lf * yawRate) / vSafe - steerRad;
  const alphaR = slipAngle - (lr * yawRate) / vSafe;

  // Long slip from accel demand (simplified): κ ≈ aLong * k / (µ g)
  const fzRef = massKg * PHYSICS.g * 0.5;
  const fLongDemand = aLongDemand * massKg;
  // Drive biased rear; brake split from setup bias (trail loads front).
  const drive = fLongDemand >= 0;
  const bias = Math.max(0.45, Math.min(0.72, brakeBiasFront));
  const fxFDemand = drive ? fLongDemand * 0.15 : fLongDemand * bias;
  const fxRDemand = drive ? fLongDemand * 0.85 : fLongDemand * (1 - bias);
  const kappaF = fxFDemand / Math.max(axleMuForce(muEff, loads.fzFront, fzRef), 1);
  const kappaR = fxRDemand / Math.max(axleMuForce(muEff, loads.fzRear, fzRef), 1);

  const front = axleBrushForces(kappaF, alphaF, loads.fzFront, muEff, fzRef);
  const rear = axleBrushForces(kappaR, alphaR, loads.fzRear, muEff, fzRef);

  const fxTotal = front.fx + rear.fx - loads.fDrag;
  const fyTotal = front.fy + rear.fy;
  const mzTyre = lf * front.fy - lr * rear.fy;

  const aLong = fxTotal / massKg;
  const aLat = fyTotal / massKg;
  const usage = Math.max(front.usage, rear.usage);

  void kappaPath;

  return {
    front: {
      slipRatio: kappaF,
      slipAngle: alphaF,
      fx: front.fx,
      fy: front.fy,
      fz: loads.fzFront,
      usage: front.usage,
    },
    rear: {
      slipRatio: kappaR,
      slipAngle: alphaR,
      fx: rear.fx,
      fy: rear.fy,
      fz: loads.fzRear,
      usage: rear.usage,
    },
    fxTotal,
    fyTotal,
    mzTyre,
    aLong,
    aLat,
    usage,
  };
}

/** Integrate yaw: ΣMz = I_z α. Mag yaw moment is external (autopilot hands). */
export function integrateYaw(
  yawRate: number,
  mzTyre: number,
  mzMag: number,
  dt: number,
  iz = HYBRID_IZ,
): number {
  const alpha = (mzTyre + mzMag) / Math.max(200, iz);
  return yawRate + alpha * dt;
}

/** Slip angle / body sideslip from lateral vs forward (Frenet-compatible). */
export function updateSlipAngle(
  slipAngle: number,
  aLatBody: number,
  v: number,
  yawRate: number,
  kappaPath: number,
  dt: number,
): number {
  const vSafe = Math.max(1.5, v);
  // β̇ ≈ a_y/v − r ; path curvature subtracts steady-state cornering rate.
  const betaDot = aLatBody / vSafe - yawRate + kappaPath * vSafe * 0.15;
  let beta = slipAngle + betaDot * dt;
  beta = Math.max(-0.55, Math.min(0.55, beta));
  return beta;
}
