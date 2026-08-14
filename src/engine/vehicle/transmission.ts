/**
 * Transmission step — RPM/torque curves, shift windows, clutch-kick channel.
 * Player: energy only (throttle/brake/Shift). No steer.
 */
import { PHYSICS } from '../../data/physics';
import type { DisciplineId } from '../../data/disciplines';
import {
  aiUpshiftBand,
  gearboxFor,
  gearBandFrac,
  gearTopSpeed,
  gearTorque,
  rpmFromBand,
  shiftWindow,
  torqueCurveAtBand,
  type ShiftWindowKind,
} from '../Gearbox';
import type { CarSimState } from './types';

export interface TransmissionResult {
  /** Always 0 — legacy miss-scrub removed. */
  missScrub: number;
  band: number;
  window: ShiftWindowKind;
  /** Clutch-kick impulse scale 0..1 (Street); stub-ready. */
  clutchKick: number;
}

/**
 * Player: manual upshift anytime the band is valid (Shift/tap); auto-upshift
 * safety net after ~1s pinned at the redline; auto downshift when off throttle.
 * AI: auto up/down at a band governed by driver skill (skill01 0..1).
 */
export function stepTransmission(
  car: CarSimState,
  dt: number,
  vMaxEff: number,
  throttle: number,
  wantUpshift: boolean,
  discipline: DisciplineId,
  isPlayer: boolean,
  /** Driver skill 0..1 — AI upshift quality only. */
  skill01: number,
  /** Edge: clutch-kick while Shift armed (Street). */
  clutchKickRequest = false,
): TransmissionResult {
  const box = gearboxFor(discipline);
  car.gear = Math.max(1, Math.min(box.gearCount, car.gear || 1));
  if (car.shiftCooldown > 0) {
    car.shiftCooldown = Math.max(0, car.shiftCooldown - dt);
  }
  if (car.clutchKickRemaining > 0) {
    car.clutchKickRemaining = Math.max(0, car.clutchKickRemaining - dt);
  }

  const band = gearBandFrac(car.v, vMaxEff, car.gear, box);
  car.lastShiftKind = null;
  const window = shiftWindow(band, box);
  car.shiftWindow = window;

  const canDown =
    car.gear > 1 && band < box.downshiftBand && car.shiftCooldown <= 0;
  if (canDown && (!isPlayer || throttle < box.playerDownshiftThrottle)) {
    car.gear -= 1;
    car.shiftCooldown = PHYSICS.shiftCooldown * 0.55;
    car.lastShiftKind = 'down';
  }

  const canUp =
    car.gear < box.gearCount &&
    car.shiftCooldown <= 0 &&
    car.spinRemaining <= 0 &&
    !car.holdGear; // Rally/Street slide: hold-gear friendly

  // Redline dwell — player pin-throttle safety net only.
  const redline = band >= box.amberBandHi;
  if (isPlayer && redline && throttle > 0.4 && canUp) {
    car.redlineDwell += dt;
  } else {
    car.redlineDwell = Math.max(0, car.redlineDwell - dt * PHYSICS.redlineDwellDecay);
  }

  const up = (kind: 'up' | 'down'): void => {
    if (kind === 'up') car.gear += 1;
    else car.gear -= 1;
    car.shiftCooldown = kind === 'up' ? PHYSICS.shiftCooldown : PHYSICS.shiftCooldown * 0.55;
    car.lastShiftKind = kind;
    car.redlineDwell = 0;
  };

  if (canUp) {
    if (isPlayer) {
      // Manual Shift any time the band will accept it — gas or not.
      const manual = wantUpshift && band >= box.earlyUpshiftBand;
      // Pin-throttle safety net: ~1s at the redline shifts for you.
      const auto = car.redlineDwell >= PHYSICS.redlineAutoShiftSec;
      if (manual || auto) up('up');
    } else if (band >= aiUpshiftBand(box, skill01) && throttle > 0.35) {
      up('up');
    }
  }

  // Clutch-kick — Street while armed/latched (or explicit request near limit).
  let clutchKick = 0;
  const kickOk =
    clutchKickRequest &&
    discipline === 'street' &&
    car.clutchKickRemaining <= 0 &&
    throttle > 0.4 &&
    (car.driftState || car.driftArmed || car.gripUsage > 0.82 || car.slotMode === 'deslot');
  if (kickOk) {
    car.clutchKickRemaining = 0.28;
    if (!car.driftState) {
      car.driftState = true;
      car.slipAngle += Math.sign(car.slipAngle || car.dl || 1) * 0.18;
    }
  }
  if (car.clutchKickRemaining > 0) {
    clutchKick = Math.min(1, car.clutchKickRemaining / 0.12);
  }

  // Drift state is a live flag, not a latch — clear it once the slide is gone
  // (otherwise HUD/audio/"drifting" modifier stick on for the whole race).
  if (car.driftState && Math.abs(car.slipAngle) < 0.15 && car.gripUsage < 0.7 && car.v > 4) {
    car.driftState = false;
  }

  const bandNow = gearBandFrac(car.v, vMaxEff, car.gear, box);
  const targetRpm = rpmFromBand(bandNow, throttle);
  // Slightly snappier RPM tracking so SHIFT rev meter reads the band.
  car.rpm += (targetRpm - car.rpm) * (1 - Math.exp(-12 * dt));
  car.gearBand = bandNow;

  return { missScrub: 0, band: bandNow, window, clutchKick };
}

export function transmissionDriveScale(
  car: CarSimState,
  vMaxEff: number,
  discipline: DisciplineId,
): { vGearMax: number; torque: number; clutchKickLong: number } {
  const box = gearboxFor(discipline);
  const fd = car.setup?.finalDrive ?? 1;
  const vGearMax = gearTopSpeed(vMaxEff, car.gear, box) * PHYSICS.gearCapSoft / Math.max(0.85, fd);
  const band = gearBandFrac(car.v, vMaxEff, car.gear, box);
  const torque = gearTorque(car.gear, box) * torqueCurveAtBand(band, discipline) * (0.92 + 0.08 * fd);
  const clutchKickLong = car.clutchKickRemaining > 0 ? 1.7 : 1;
  return { vGearMax, torque, clutchKickLong };
}
