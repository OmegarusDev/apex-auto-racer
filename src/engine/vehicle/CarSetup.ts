/**
 * CarSetup — garage tradeoffs from part tiers into live force paths.
 * Mass, CG, aero DF/drag, tyre compound, brake bias, susp, final drive.
 * Every knob must move a measured observable (gates SETUP_TRADEOFF / MASS_INERTIA / TRAIL_BIAS).
 */
import type { VehicleParts } from '../types';
import type { DisciplineId } from '../../data/disciplines';
import {
  HYBRID_CD_BASE,
  HYBRID_CD_FROM_CL,
  HYBRID_CL_FROM_D,
  HYBRID_LOAD_SENS_N,
  HYBRID_MASS_KG,
  HYBRID_RHO,
} from './dynamics';

export interface CarSetup {
  /** Curb mass (kg). */
  massKg: number;
  /** CG height (m). */
  cgHeight: number;
  /** Static front weight fraction 0–1. */
  staticFront: number;
  /** Aero CL scale (spoiler). */
  clScale: number;
  /** Aero CD scale — rises with spoiler (DF vs drag tradeoff). */
  cdScale: number;
  /** Brake bias front 0–1. */
  brakeBiasFront: number;
  /** Suspension roll stiffness 0.5–1.5. */
  suspStiffness: number;
  /** Tyre compound µ scale. */
  compoundMu: number;
  /** Final drive scalar on gear tops. */
  finalDrive: number;
  /** Yaw inertia proxy I_z (kg·m²). */
  iz: number;
  /** Wheelbase (m). */
  wheelbase: number;
  /** Drive force split to front axle 0..1. 0.5 = AWD, ~0 = RWD, ~1 = FWD. */
  driveBias: number;
  /**
   * Differential lock 0..1 — a locked diff drives both rear wheels together,
   * so the rear breaks loose crisply and holds a predictable drift (the
   * Street drift cars). 0 = open diff (Track RWD holds the limit instead).
   */
  diffLock: number;
}

export const DEFAULT_CAR_SETUP: CarSetup = {
  massKg: HYBRID_MASS_KG,
  cgHeight: 0.36,
  staticFront: 0.48,
  clScale: 1,
  cdScale: 1,
  brakeBiasFront: 0.58,
  suspStiffness: 1,
  compoundMu: 1,
  finalDrive: 1,
  iz: HYBRID_MASS_KG * 2.2,
  wheelbase: 2.7,
  driveBias: 0.5,
  diffLock: 0,
};

/**
 * Drivetrain by car class. Track cars are RWD with an open diff (hold the
 * limit); Street drift cars are RWD with a locked diff (that's what makes them
 * drift); Rally cars are AWD.
 */
export function drivetrainForDiscipline(discipline: DisciplineId): { driveBias: number; diffLock: number } {
  switch (discipline) {
    case 'rally':
      return { driveBias: 0.5, diffLock: 0.1 };
    case 'street':
      // RWD + a locked-ish diff (the drift cars). Not fully locked — a fully
      // locked diff snaps the rear out at hairpins (spin-recover-spin loops).
      return { driveBias: 0.06, diffLock: 0.6 };
    default:
      return { driveBias: 0.06, diffLock: 0 };
  }
}

/**
 * Resolve the live drive split to the front axle (0..1). The sim and the
 * driver brain must agree on this — a setup with driveBias 0 (the legacy
 * sentinel) falls back to the discipline's drivetrain, never "pure RWD".
 */
export function resolveDriveBias(setup: CarSetup | undefined, discipline: DisciplineId): number {
  const b = setup?.driveBias;
  if (b !== undefined && b > 0) return b;
  return drivetrainForDiscipline(discipline).driveBias;
}

/** Map garage part tiers → force-path scalars with explicit counter-costs. */
export function carSetupFromParts(parts: VehicleParts, discipline?: DisciplineId): CarSetup {
  const engine = parts.engine ?? 0;
  const intake = parts.intake ?? 0;
  const exhaust = parts.exhaust ?? 0;
  const tyres = parts.tyres ?? 0;
  const brakes = parts.brakes ?? 0;
  const susp = parts.suspension ?? 0;
  const spoiler = parts.spoiler ?? 0;

  // Powertrain / aero add mass; stiff susp sheds a little (lighter uprights story).
  const massKg = Math.max(
    980,
    HYBRID_MASS_KG +
      engine * 14 +
      intake * 5 +
      exhaust * 7 +
      brakes * 6 +
      spoiler * 9 -
      susp * 4,
  );

  // Soft susp + tall wing → higher CG; stiff susp lowers CG.
  const cgHeight = Math.max(0.3, Math.min(0.52, 0.36 + spoiler * 0.01 - susp * 0.012));

  // Brake upgrades push bias forward (trail bite) — costs rear stability under power.
  const brakeBiasFront = Math.max(0.5, Math.min(0.68, 0.54 + brakes * 0.022));
  const staticFront = Math.max(
    0.44,
    Math.min(0.54, 0.48 + (brakeBiasFront - 0.58) * 0.2),
  );

  // Spoiler: +CL mid-corner AND +CD straight-line (never free DF).
  const clScale = 1 + spoiler * 0.14;
  const cdScale = 1 + spoiler * 0.16;

  const suspStiffness = Math.max(0.55, Math.min(1.45, 0.78 + susp * 0.11));
  const compoundMu = Math.max(0.88, Math.min(1.22, 0.94 + tyres * 0.04));
  // Short final drive = punchier accel, lower gear tops (engine/intake vs exhaust).
  const finalDrive = Math.max(
    0.9,
    Math.min(1.18, 1 + engine * 0.018 + intake * 0.012 - exhaust * 0.01),
  );
  const iz = massKg * (2.1 + cgHeight * 0.3);

  const drivetrain = discipline !== undefined ? drivetrainForDiscipline(discipline) : { driveBias: 0, diffLock: 0 };

  return {
    massKg,
    cgHeight,
    staticFront,
    clScale,
    cdScale,
    brakeBiasFront,
    suspStiffness,
    compoundMu,
    finalDrive,
    iz,
    wheelbase: 2.7,
    driveBias: drivetrain.driveBias,
    diffLock: drivetrain.diffLock,
  };
}

/**
 * Predicted corner speed at curvature κ (m/s) — the real-car tyre limit.
 * v ≈ √(a_grip / |κ|), with aero downforce at that speed raising grip through
 * load sensitivity. No magnet: this is the same grip the driver plans against.
 */
export function predictVDeslot(
  setup: CarSetup,
  muSurface: number,
  kappa: number,
  downforceD = 0.25,
): number {
  const k = Math.max(0.02, Math.abs(kappa));
  const compound = setup.compoundMu ?? 1;
  const g = 9.81;
  // One aero pass: DF at the corner speed increases Fz → grip (load sensitivity).
  let v = Math.sqrt(Math.max(1, (muSurface * compound * g) / k));
  const q = 0.5 * HYBRID_RHO * v * v;
  const cl = Math.max(0, downforceD) * HYBRID_CL_FROM_D * setup.clScale;
  const fz = setup.massKg * g + q * cl;
  const aGrip =
    (muSurface *
      compound *
      (setup.massKg * g) *
      Math.pow(fz / (setup.massKg * g), HYBRID_LOAD_SENS_N)) /
    setup.massKg;
  return Math.sqrt(Math.max(1, aGrip / k));
}

/**
 * Predicted aero-limited top speed proxy (m/s) from drive vs drag balance.
 * Higher CD (spoiler) lowers vMax — SETUP_TRADEOFF observable.
 */
export function predictVMax(
  setup: CarSetup,
  aAccel: number,
  downforceD = 0.25,
): number {
  // Solve aAccel * (1 − (v/vCap)²) ≈ fDrag/m  with soft vCap from final drive.
  const cl = Math.max(0, downforceD) * HYBRID_CL_FROM_D * setup.clScale;
  const cd = (HYBRID_CD_BASE + HYBRID_CD_FROM_CL * cl) * setup.cdScale;
  const drive = Math.max(0.5, aAccel);
  // Equilibrium: drive ≈ (½ρ v² cd) / m  → v = sqrt(2 m drive / (ρ cd))
  const vDrag = Math.sqrt((2 * setup.massKg * drive) / Math.max(1e-3, HYBRID_RHO * cd));
  // Final drive shortens effective top a little.
  return vDrag / Math.max(0.85, setup.finalDrive * 0.92 + 0.08);
}

/** Tuning HUD pair: corner peg speed vs straight-line aero limit. */
export function tuningSpeedReadout(
  setup: CarSetup,
  muSurface: number,
  aAccel: number,
  downforceD: number,
  kappa = 0.08,
): { vDeslot: number; vMax: number } {
  return {
    vDeslot: predictVDeslot(setup, muSurface, kappa, downforceD),
    vMax: predictVMax(setup, aAccel, downforceD),
  };
}
