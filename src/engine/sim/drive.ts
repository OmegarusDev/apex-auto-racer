/**
 * Longitudinal drive / brake demand → per-axle Fx.
 * Motor torque curve (via gearbox band), braking with bias, aero drag, rolling.
 */
import { PHYSICS } from '../../data/physics';
import type { DisciplineId } from '../../data/disciplines';
import { gearTorque, gearboxFor, torqueCurveAtBand } from '../Gearbox';
import type { CarSimState } from '../vehicle/types';
import { resolveDriveBias } from '../vehicle/CarSetup';

export interface DriveResult {
  /** Total longitudinal force demand (N). */
  fxDemand: number;
  /** Drive force split to front axle 0..1. */
  driveFront: number;
  /** Torque-curve multiplier. */
  torque: number;
  /** Effective gear-top speed (m/s). */
  vGearMax: number;
}

/** Drive force from throttle, gear and the motor torque curve (back-EMF plateau). */
export function driveForce(
  car: CarSimState,
  throttle: number,
  massKg: number,
  aAccel: number,
  discipline: DisciplineId,
  vMaxEff?: number,
): DriveResult {
  const box = gearboxFor(discipline);
  const gear = Math.max(1, Math.min(car.gear || 1, box.gearCount));
  const fd = car.setup?.finalDrive ?? 1;
  // Use the live top speed (draft + condition + modifiers), not the raw stat —
  // otherwise a drafted/fresh car shifts on the boosted profile but its drive
  // stays capped at the unboosted gear top.
  const vMaxLive = vMaxEff ?? car.stats.vMax;
  const vGearMax =
    (vMaxLive * (box.topFrac[gear] ?? 1)) * PHYSICS.gearCapSoft / Math.max(0.85, fd);
  const band = Math.max(0, Math.min(1.1, car.gearBand ?? 0));
  const torque = gearTorque(gear, box) * torqueCurveAtBand(band, discipline);
  const driveFront = resolveDriveBias(car.setup, discipline);
  const fxMax =
    throttle * massKg * aAccel * torque * (1 - Math.pow(car.v / Math.max(vGearMax, 0.1), 2));
  return { fxDemand: Math.max(0, fxMax), driveFront, torque, vGearMax };
}

/** Brake force demand (N) with front bias split. */
export function brakeForce(car: CarSimState, brake: number, massKg: number, aBrake: number) {
  const bias = car.setup?.brakeBiasFront ?? 0.6;
  const total = brake * massKg * aBrake;
  return { fxFront: total * bias, fxRear: total * (1 - bias), total };
}

/** Rolling + aero drag decel (m/s²). */
export function dragDecel(_car: CarSimState, v: number, massKg: number, aeroDragN: number): number {
  const rolling = v * PHYSICS.coastVel;
  return (rolling + aeroDragN) / Math.max(massKg, 1);
}
