/**
 * updateVehicle — the greenfield sim entry point (same signature as the old
 * slot model so RaceDirector is unchanged).
 *
 * Control blend (the crux):
 *   - Player throttle is a CEILING: applied = min(player, driverPlan).
 *   - Player brake ADDS to the driver plan: applied = max(player, driverPlan).
 *   - The driver always owns the steering (brainOut.steer).
 */
import { PHYSICS } from '../../data/physics';
import type { TrackData } from '../TrackGenerator';
import { applyModifiers, type ModifierContext } from '../modifiers';
import { conditionLiveMods } from '../stats';
import type { CarSimState, VehicleInputs, VehicleUpdateContext } from '../vehicle/types';
import { stepTransmission, transmissionDriveScale } from '../vehicle/transmission';
import { stepVehicle } from './vehicle';

const INPUT_EASE = 1 / (PHYSICS.pedalEaseMs / 1000);

/**
 * The control blend — the crux of "assisted but not automated":
 * player throttle is a CEILING (driver never exceeds it), player brake ADDS
 * to the driver's plan. AI cars get the full driver plan.
 */
export function blendInputs(
  isPlayer: boolean,
  easedThrottle: number,
  easedBrake: number,
  planT: number,
  planB: number,
): { throttle: number; brake: number } {
  const throttle = isPlayer ? Math.min(easedThrottle, planT) : planT;
  const brake = isPlayer ? Math.max(easedBrake, planB) : planB;
  return { throttle, brake };
}

export function updateVehicle(
  car: CarSimState,
  track: TrackData,
  dt: number,
  inputs: VehicleInputs,
  brainOut: {
    desiredThrottle: number;
    desiredBrake: number;
    steer?: number;
    steerTarget?: number;
    intent?: unknown;
  },
  ctx: VehicleUpdateContext,
): void {
  // Pedal easing.
  car.easedThrottle = easeTo(car.easedThrottle, inputs.throttle, dt * INPUT_EASE);
  car.easedBrake = easeTo(car.easedBrake, inputs.brake, dt * INPUT_EASE);

  // Driver plan (the driver always runs its own cornering plan).
  const planT = Math.max(0, Math.min(1, brainOut.desiredThrottle ?? 0));
  const planB = Math.max(0, Math.min(1, brainOut.desiredBrake ?? 0));

  // The control blend.
  const blend = blendInputs(car.isPlayerControlled, car.easedThrottle, car.easedBrake, planT, planB);
  const throttle = blend.throttle;
  const brake = blend.brake;
  car.throttle = throttle;
  car.brake = brake;

  // Recovery stun cuts drive.
  const recovering = car.stunRemaining > 0;
  if (recovering) {
    car.stunRemaining = Math.max(0, car.stunRemaining - dt);
  }

  // Modifiers (rain / draft / surface).
  const modCtx: ModifierContext = {
    time: ctx.raceTime,
    isPlayer: car.isPlayerControlled,
    rain: ctx.rain,
    drifting: car.driftState,
  };
  const mods = applyModifiers(
    { muSurface: ctx.muSurface, vMax: car.stats.vMax, aAccel: car.stats.aAccel, aBrake: car.stats.aBrake },
    ctx.modifierStack,
    modCtx,
  );
  const muSurface = mods.muSurface ?? ctx.muSurface;
  // Modifiers + slipstream + live condition are applied to LOCALS, never mutated
  // into car.stats (writing them back each tick would compound — a drafted car's
  // vMax would grow exponentially). The draft comes from computeDraft per-tick.
  const live = conditionLiveMods(car.condition);
  const vMaxEff =
    (mods.vMax ?? car.stats.vMax) *
    live.condTop *
    (1 + PHYSICS.draftSpeedBonus * ctx.draft);
  const aAccelEff =
    (mods.aAccel ?? car.stats.aAccel) *
    (1 + PHYSICS.draftAccelBonus * ctx.draft) *
    // Clutch launch quality: a low-clutch car bogs off the line, a good one
    // launches clean. Only bite at launch speed (a clutch isn't slipping at
    // 100 km/h).
    (car.v < 8 ? (car.stats.launchMul ?? 1) : 1);
  const aBrakeEff = mods.aBrake ?? car.stats.aBrake;

  // Gearbox / powerband (kept from the old model — it's the real gearbox).
  stepTransmission(
    car,
    dt,
    vMaxEff,
    throttle,
    inputs.upshift === true,
    ctx.discipline,
    car.isPlayerControlled,
    Math.max(0, Math.min(1, ctx.skill / 100)),
    inputs.clutchKick === true,
  );

  // Steering: the driver commands it (rad). Default to 0 if absent.
  const steer = brainOut.steer ?? brainOut.steerTarget ?? 0;
  car.steerRad = steer;

  stepVehicle(
    car,
    track,
    dt,
    recovering ? throttle * 0.4 : throttle,
    recovering ? Math.max(brake, 0.25) : brake,
    steer,
    ctx.discipline,
    muSurface,
    ctx.rain,
    vMaxEff,
    aAccelEff,
    aBrakeEff,
    live.condGrip,
  );
}

function easeTo(current: number, target: number, rate: number): number {
  if (current === target) return current;
  if (target > current) return Math.min(target, current + rate);
  return Math.max(target, current - rate);
}

export { transmissionDriveScale };
