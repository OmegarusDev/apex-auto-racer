/**
 * Transmission — RPM/torque, AI auto-shift, player clutch simulation.
 * Player: hold clutch to disconnect and preselect, dump in the bite window.
 * AI: auto up/down. No clutch mini-game.
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
  type GearboxProfile,
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

function biteWindow(car: CarSimState, skill01: number): { delay: number; sweet: number } {
  return clutchBiteWindow(car, skill01);
}

/**
 * Live clutch bite: garage clutch/gearbox set the stock window; driver skill
 * shrinks the delay and widens the sweet so a maxed car+driver is a tap,
 * while a stock box is a held clunk.
 */
export function clutchBiteWindow(
  car: { stats?: { clutchBiteDelay?: number; clutchSweet?: number } },
  skill01: number,
): { delay: number; sweet: number } {
  const s = Math.max(0, Math.min(1, skill01));
  const delay0 = car.stats?.clutchBiteDelay ?? PHYSICS.clutchBiteDelay;
  const sweet0 = car.stats?.clutchSweet ?? 0.16;
  return {
    delay: Math.max(0.016, delay0 * (1 - 0.42 * s)),
    sweet: Math.max(0.05, sweet0 + 0.05 * s),
  };
}

function biteSweet(car: CarSimState, skill01: number): number {
  return biteWindow(car, skill01).sweet;
}

function biteDelay(car: CarSimState, skill01: number): number {
  return biteWindow(car, skill01).delay;
}

function biteHi(car: CarSimState, skill01: number): number {
  const w = biteWindow(car, skill01);
  return w.delay + w.sweet;
}

function beginPlayerClutch(
  car: CarSimState,
  box: GearboxProfile,
  band: number,
  throttle: number,
  autoUp: boolean,
): void {
  car.clutchIn = true;
  car.clutchTimer = 0;
  car.clutchEngage = 0;
  car.clutchQuality = null;
  const canUp =
    car.gear < box.gearCount && !car.holdGear && car.spinRemaining <= 0;
  const wantUp = canUp && (autoUp || band >= box.earlyUpshiftBand);
  const wantDown =
    car.gear > 1 &&
    (band < box.downshiftBand || throttle < box.playerDownshiftThrottle);
  if (wantUp) {
    car.gear += 1;
    car.clutchDir = 'up';
  } else if (wantDown) {
    car.gear -= 1;
    car.clutchDir = 'down';
  } else {
    car.clutchDir = 'same';
  }
  car.clutchToGear = car.gear;
}

function releasePlayerClutch(
  car: CarSimState,
  kind: 'perfect' | 'dump' | 'slip',
  skill01: number,
): void {
  car.clutchIn = false;
  car.clutchAuto = false;
  car.clutchQuality = kind;
  const shiftTime = (car.stats?.shiftTime ?? 0.24) * (1 - 0.4 * skill01);
  const scale = kind === 'perfect' ? 0.7 : kind === 'dump' ? 1.35 : 1.15;
  car.shiftCooldown = PHYSICS.shiftCooldown * (shiftTime / 0.24) * scale;
  car.redlineDwell = 0;
  if (car.clutchDir === 'same') {
    car.lastShiftKind = kind === 'dump' ? 'miss' : null;
  } else if (kind === 'dump') {
    car.lastShiftKind = 'miss';
  } else {
    car.lastShiftKind = car.clutchDir;
  }
}

function tryStreetDumpKick(
  car: CarSimState,
  discipline: DisciplineId,
  throttle: number,
): void {
  if (
    discipline !== 'street' ||
    car.clutchKickRemaining > 0 ||
    throttle <= 0.4 ||
    !(
      car.driftState ||
      car.driftArmed ||
      car.gripUsage > 0.82 ||
      Math.abs(car.slipAngle) > 0.1 ||
      car.slotMode === 'deslot'
    )
  ) {
    return;
  }
  car.clutchKickRemaining = 0.28;
  if (!car.driftState) {
    car.driftState = true;
    const kick = 0.18 * (car.stats?.kickMul ?? 1);
    car.slipAngle += Math.sign(car.slipAngle || car.dl || 1) * kick;
  }
}

function engageRate(car: CarSimState, skill01: number): number {
  const st = Math.max(0.35, ((car.stats?.shiftTime ?? 0.34) * (1 - 0.35 * skill01)) / 0.24);
  const base =
    car.clutchQuality === 'perfect'
      ? PHYSICS.clutchEngagePerfect
      : car.clutchQuality === 'dump'
        ? PHYSICS.clutchEngageDump
        : PHYSICS.clutchEngageSlip;
  return 1 / Math.max(0.04, base * st);
}

/**
 * Player: hold clutch to preselect, dump in the bite; auto-upshift safety net
 * after ~1s pinned at the redline. Auto downshift when off throttle.
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
  clutchKickRequest = false,
  clutchHeld = false,
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

  const clutching = car.clutchIn || car.clutchEngage < 0.97;
  const canDown =
    car.gear > 1 &&
    band < box.downshiftBand &&
    car.shiftCooldown <= 0 &&
    !clutching;
  if (canDown && (!isPlayer || (throttle < box.playerDownshiftThrottle && !clutchHeld))) {
    car.gear -= 1;
    car.shiftCooldown = PHYSICS.shiftCooldown * 0.55;
    car.lastShiftKind = 'down';
  }

  const canUp =
    car.gear < box.gearCount &&
    car.shiftCooldown <= 0 &&
    car.spinRemaining <= 0 &&
    !car.holdGear;

  // Redline dwell — player pin-throttle safety net only.
  const redline = band >= box.amberBandHi;
  if (isPlayer && redline && throttle > 0.4 && canUp && !car.clutchIn) {
    car.redlineDwell += dt;
  } else if (!car.clutchIn) {
    car.redlineDwell = Math.max(0, car.redlineDwell - dt * PHYSICS.redlineDwellDecay);
  }

  const up = (kind: 'up' | 'down'): void => {
    if (kind === 'up') car.gear += 1;
    else car.gear -= 1;
    const shiftTime = (car.stats?.shiftTime ?? 0.24) * (1 - 0.4 * skill01);
    car.shiftCooldown =
      kind === 'up'
        ? PHYSICS.shiftCooldown * (shiftTime / 0.24)
        : PHYSICS.shiftCooldown * 0.55;
    car.lastShiftKind = kind;
    car.redlineDwell = 0;
  };

  if (isPlayer) {
    const sweet = biteSweet(car, skill01);
    const delay = biteDelay(car, skill01);
    const autoReleaseAt = delay + sweet * 0.45;
    let pedal = clutchHeld;
    if (car.clutchAuto && car.clutchIn) pedal = true;

    const canStart =
      !car.clutchIn && car.clutchEngage >= 0.97 && car.shiftCooldown <= 0 && car.spinRemaining <= 0;

    if (canStart) {
      const autoNet = canUp && car.redlineDwell >= PHYSICS.redlineAutoShiftSec;
      // Headless traces pulse upshift; treat as a timed perfect dump.
      const pulse = wantUpshift && canUp;
      const rising = clutchHeld && !car.clutchPedal;
      if (autoNet || pulse) {
        beginPlayerClutch(car, box, band, throttle, true);
        car.clutchAuto = true;
        car.clutchAutoRelease = autoReleaseAt;
        pedal = true;
      } else if (rising) {
        beginPlayerClutch(car, box, band, throttle, false);
        car.clutchAuto = false;
      }
    }

    if (car.clutchIn) {
      car.clutchTimer += dt;
      const hi = biteHi(car, skill01);
      let dump: 'perfect' | 'dump' | 'slip' | null = null;
      if (car.clutchAuto && car.clutchTimer >= car.clutchAutoRelease) {
        dump = 'perfect';
      } else if (!pedal && !car.clutchAuto) {
        if (car.clutchTimer < delay) dump = 'dump';
        else if (car.clutchTimer <= hi) dump = 'perfect';
        else dump = 'slip';
      } else if (car.clutchTimer >= PHYSICS.clutchMaxHold) {
        dump = 'slip';
      }
      if (dump !== null) {
        releasePlayerClutch(car, dump, skill01);
        if (dump === 'dump') tryStreetDumpKick(car, discipline, throttle);
      }
    } else if (car.clutchEngage < 1) {
      car.clutchEngage = Math.min(1, car.clutchEngage + engageRate(car, skill01) * dt);
      if (car.clutchEngage >= 1) car.clutchQuality = null;
    }

    car.clutchPedal = clutchHeld;
  } else if (canUp) {
    if (band >= aiUpshiftBand(box, skill01) && throttle > 0.35) {
      up('up');
    }
  }

  // Legacy Street kick channel (scripts / leftover edge). Player dumps map above.
  let clutchKick = 0;
  const kickOk =
    clutchKickRequest &&
    discipline === 'street' &&
    car.clutchKickRemaining <= 0 &&
    throttle > 0.4 &&
    (car.driftState || car.driftArmed || car.gripUsage > 0.82 || car.slotMode === 'deslot');
  if (kickOk) {
    tryStreetDumpKick(car, discipline, throttle);
  }
  if (car.clutchKickRemaining > 0) {
    clutchKick = Math.min(1, car.clutchKickRemaining / 0.12);
  }

  if (car.driftState && Math.abs(car.slipAngle) < 0.15 && car.gripUsage < 0.7 && car.v > 4) {
    car.driftState = false;
  }

  const bandNow = gearBandFrac(car.v, vMaxEff, car.gear, box);
  const targetRpm = rpmFromBand(bandNow, throttle);
  if (isPlayer && car.clutchEngage < 0.45) {
    const flare =
      PHYSICS.rpmIdle + Math.max(throttle, 0.12) * (PHYSICS.rpmMax - PHYSICS.rpmIdle);
    car.rpm += (flare - car.rpm) * (1 - Math.exp(-10 * dt));
  } else {
    car.rpm += (targetRpm - car.rpm) * (1 - Math.exp(-12 * dt));
  }
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
  let torque = gearTorque(car.gear, box) * torqueCurveAtBand(band, discipline) * (0.92 + 0.08 * fd);
  const engage = car.clutchEngage ?? 1;
  torque *= Math.max(0, Math.min(1, engage));
  if (car.clutchQuality === 'dump' && engage < 1) torque *= 0.62;
  const clutchKickLong = car.clutchKickRemaining > 0 ? 1.7 : 1;
  return { vGearMax, torque, clutchKickLong };
}
