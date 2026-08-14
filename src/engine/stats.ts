import { BALANCE } from '../data/balance';
import { PHYSICS } from '../data/physics';
import { PARTS } from '../data/parts';
import { getDiscipline } from '../data/disciplines';
import type { DisciplineId } from '../data/disciplines';
import type { Driver, EffectiveStats, VehicleParts } from './types';

interface DisplayStats {
  topSpeed: number;
  acceleration: number;
  braking: number;
  grip: number;
  downforce: number;
}

export function clampCondition(condition: number): number {
  return Math.max(BALANCE.conditionMin, Math.min(BALANCE.conditionMax, condition));
}

/** Live condition → grip/top-speed multipliers (same curve as effectiveStats). */
export function conditionLiveMods(condition: number): { condGrip: number; condTop: number } {
  const clamped = clampCondition(condition);
  const normalized =
    (clamped - BALANCE.conditionMin) / (BALANCE.conditionMax - BALANCE.conditionMin);
  return {
    condGrip: 0.88 + 0.12 * normalized,
    condTop: 0.97 + 0.03 * normalized,
  };
}

function sumPartIncrements(partTiers: VehicleParts): DisplayStats {
  const totals: DisplayStats = {
    topSpeed: 0,
    acceleration: 0,
    braking: 0,
    grip: 0,
    downforce: 0,
  };

  for (const part of PARTS) {
    const tier = partTiers[part.id] ?? 0;
    if (tier <= 0) continue;

    const per = part.perTier;
    if (per.topSpeed !== undefined) totals.topSpeed += per.topSpeed * tier;
    if (per.acceleration !== undefined) totals.acceleration += per.acceleration * tier;
    if (per.braking !== undefined) totals.braking += per.braking * tier;
    if (per.grip !== undefined) totals.grip += per.grip * tier;
    if (per.downforce !== undefined) totals.downforce += per.downforce * tier;
  }

  return totals;
}

function toPhysicsParams(display: DisplayStats, suspTier: number, condition: number, partTiers: VehicleParts): EffectiveStats {
  const { topSpeed, acceleration, braking, grip, downforce } = display;

  const vMax = 30 + 0.4 * topSpeed;
  // Acceleration must sit UNDER cornering grip or the pitch transfer unloads
  // the front and the car cannot corner while accelerating (real-car: no magnet
  // holds the line). Starter ≈ 0.6g, elite ≈ 0.87g.
  const aAccel = 3 + 0.06 * acceleration;
  const aBrake = 9 + 0.15 * braking;
  const gripFactor = 0.75 + 0.005 * grip;
  const D = 0.006 * downforce;

  let lineNoise = PHYSICS.lineNoiseBase * (1 - 0.08 * suspTier);

  const clamped = clampCondition(condition);
  const normalized =
    (clamped - BALANCE.conditionMin) / (BALANCE.conditionMax - BALANCE.conditionMin);
  const { condGrip, condTop } = conditionLiveMods(condition);

  lineNoise *= 2 - normalized;

  // Transmission metaprogression — a better clutch shifts faster and launches
  // clean; a better gearbox shifts faster too. All control, never a fudge.
  const clutchTier = partTiers.clutch ?? 0;
  const gearboxTier = partTiers.gearbox ?? 0;
  const shiftTime = Math.max(0.1, 0.24 - 0.018 * (clutchTier + gearboxTier));
  const launchMul = Math.min(1.0, 0.82 + 0.045 * clutchTier);
  const kickMul = 1.0 + 0.15 * clutchTier;

  return {
    topSpeed,
    acceleration,
    braking,
    grip,
    downforce,
    vMax,
    aAccel,
    aBrake,
    gripFactor,
    D,
    lineNoise,
    condGrip,
    condTop,
    shiftTime,
    launchMul,
    kickMul,
  };
}

/**
 * Effective stats pipeline (plan 4.1–4.4):
 * discipline base + part increments → physics params + condition/suspension hooks.
 */
export function effectiveStats(
  discipline: DisciplineId,
  partTiers: VehicleParts,
  condition: number,
  driver?: Driver,
): EffectiveStats {
  const base = getDiscipline(discipline).baseStats;
  const parts = sumPartIncrements(partTiers);

  let topSpeed = base.topSpeed + parts.topSpeed;
  let acceleration = base.acceleration + parts.acceleration;
  let braking = base.braking + parts.braking;
  let grip = base.grip + parts.grip;
  let downforce = base.downforce + parts.downforce;

  if (driver !== undefined) {
    // Loose Cannon jitter is applied per-race by RaceDirector; driver optional here for future hooks.
    void driver;
  }

  const suspTier = partTiers.suspension ?? 0;
  return toPhysicsParams(
    { topSpeed, acceleration, braking, grip, downforce },
    suspTier,
    condition,
    partTiers,
  );
}

/** Suspension load-transfer magnitude scale (plan 4.1). */
export function suspensionBalanceScale(suspTier: number): number {
  return 1 - 0.06 * suspTier;
}

/** Suspension load-transfer time-constant scale (plan 4.1). */
export function suspensionBalanceTauScale(suspTier: number): number {
  return 1 - 0.08 * suspTier;
}
