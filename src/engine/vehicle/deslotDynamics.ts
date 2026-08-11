/**
 * Off-slot / deslot dynamics — Mag authority collapsed; tyres + washout.
 * Hybrid drift styles (Phase 4): fishtail / looseGround / jdm.
 * Does NOT flip quarantined DRIFT_CFG — latch is tyre+yaw state under Mag soft.
 */
import { PHYSICS } from '../../data/physics';
import { getDisciplineProfile } from '../../data/disciplineProfiles';
import type { DisciplineId } from '../../data/disciplines';
import { outwardSign } from '../RacingLine';
import type { CarSimState } from './types';
import { profileDeslotMinTime } from '../../data/disciplineProfiles';

function outwardDir(kappa: number, l: number): number {
  const outward = outwardSign(kappa);
  return outward === 0 ? (l >= 0 ? 1 : -1) : outward;
}

export function deslotMinTimeFor(discipline: DisciplineId = 'track'): number {
  return profileDeslotMinTime(discipline);
}

/**
 * Peg pops: leave the magnetic groove. Lateral washout from excess
 * centripetal demand — small overspeed-scaled impulse seeds the release.
 */
export function enterDeslot(
  car: CarSimState,
  kappa: number,
  vDeslot: number,
  discipline: DisciplineId = 'track',
): void {
  car.slotMode = 'deslot';
  car.deslotRemaining = deslotMinTimeFor(discipline);
  car.deslotCount += 1;
  // Keep street latch if already sliding; otherwise clear Track/Rally until style re-arms.
  if (discipline !== 'street' || !car.driftState) {
    car.driftState = false;
  }
  car.magAuthority = 0;
  let dir = outwardDir(kappa, car.l);
  // Street: if already on a side, wash toward the near wall (JDM / barrier story).
  if (discipline === 'street' && Math.abs(car.l) > 2.2) {
    dir = Math.sign(car.l) || dir;
  }
  const over = Math.max(0, car.v / Math.max(vDeslot, 1) - 1);
  const release =
    PHYSICS.deslotReleaseImpulse * getDisciplineProfile(discipline).deslotReleaseMult;
  // Always seed a small washout — capacity/pin pops can fire under v_deslot.
  const seed = Math.max(
    discipline === 'street' ? 0.85 : 0.55,
    Math.min(1.8, over + (discipline === 'street' ? 0.85 : 0.55)),
  );
  car.dl += dir * release * seed;
  car.slipAngle = Math.max(
    -PHYSICS.deslotSlipMax,
    Math.min(PHYSICS.deslotSlipMax, car.slipAngle + dir * 0.1),
  );
  car.yawRate += dir * 0.35 * Math.min(1.2, over);
}

/** Side/rear contact can yank a car out of the groove (deterministic). */
export function contactDeslot(
  car: CarSimState,
  lateralPush: number,
  severity: number,
  discipline: DisciplineId = 'track',
): void {
  if (car.slotMode !== 'groove' || car.deslotImmunity > 0) return;
  if (severity < 0.45) return;
  car.slotMode = 'deslot';
  car.deslotRemaining = deslotMinTimeFor(discipline) * (0.7 + 0.5 * severity);
  car.deslotCount += 1;
  car.driftState = false;
  car.magAuthority = 0;
  car.dl += lateralPush * (2.2 + 3.5 * severity);
  car.slipAngle = Math.max(
    -PHYSICS.deslotSlipMax,
    Math.min(PHYSICS.deslotSlipMax, car.slipAngle + Math.sign(lateralPush || 1) * 0.12 * severity),
  );
  car.yawRate += Math.sign(lateralPush || 1) * 0.5 * severity;
}

export function tryRejoinGroove(
  car: CarSimState,
  lineOffset: number,
  vDeslot: number,
): void {
  if (car.deslotRemaining > 0) return;
  // Street latch holds off-slot until slip bleeds — don't auto-catch while latched.
  if (car.driftState && Math.abs(car.slipAngle) > 0.18) return;
  const aiWiden = !car.isPlayerControlled && car.v < 7;
  const rejoinL = aiWiden ? PHYSICS.deslotRejoinL * 1.85 : PHYSICS.deslotRejoinL;
  if (Math.abs(car.l - lineOffset) > rejoinL) return;
  if (car.v > vDeslot * (aiWiden ? PHYSICS.deslotRejoinVFrac * 1.1 : PHYSICS.deslotRejoinVFrac))
    return;
  if (Math.abs(car.dl) > (aiWiden ? 8 : 4.5)) return;
  // Heading must be roughly aligned before Mag latches (hybrid rejoin).
  if (Math.abs(car.slipAngle) > 0.22 && !aiWiden) return;
  car.slotMode = 'groove';
  car.slipAngle *= 0.35;
  car.yawRate *= 0.4;
  car.dl = 0;
  car.deslotImmunity = PHYSICS.deslotRejoinImmunity;
  car.magAuthority = 0.55;
  car.easedThrottle = Math.max(car.easedThrottle, 0.2);
  car.driftState = false;
  car.driftArmed = false;
}

/**
 * Free (deslotted) lateral accel in track frame:
 * adhesion limit → excess v²|κ| runs you wide; spare grip steers toward o(s).
 */
export function computeDeslotLateralAccel(
  car: CarSimState,
  kappaEff: number,
  aLatCap: number,
  lineOffset: number,
): number {
  const aReq = car.v * car.v * Math.abs(kappaEff);
  const dir = outwardDir(kappaEff, car.l);
  const excess = Math.max(0, aReq - aLatCap);

  let aL = dir * excess;
  if (excess <= 1e-6) {
    const roll = Math.max(PHYSICS.deslotSteerMinRoll, Math.min(1, car.v / 8));
    const spare = Math.max(0.8, (aLatCap - aReq) * PHYSICS.deslotSteerFrac) * roll;
    const err = lineOffset - car.l;
    const steer = err * PHYSICS.deslotSteerGain;
    aL = Math.max(-spare, Math.min(spare, steer));
  }

  aL -= car.dl * PHYSICS.deslotLatDamp;
  return aL;
}

export type DriftStyleId = 'none' | 'fishtail' | 'looseGround' | 'jdm';

export function driftStyleFor(discipline: DisciplineId): DriftStyleId {
  if (discipline === 'rally') return 'looseGround';
  if (discipline === 'street') return 'jdm';
  return 'fishtail';
}

/** Near friction / slip → Shift can clutch-kick (Street). */
export function isDriftArmed(car: CarSimState): boolean {
  return (
    car.driftState ||
    car.driftArmed ||
    car.gripUsage > 0.88 ||
    Math.abs(car.slipAngle) > 0.12 ||
    (car.slotMode === 'deslot' && car.v > 6)
  );
}

/**
 * Hybrid drift styles — Mag soft / tyres hold attitude. Track never latches.
 * Rally: progressive looseGround + brake-pulse initiate + hold-gear.
 * Street: JDM latch + clutch-kick powerband; walls punish separately.
 */
export function applyOffslotYawBleed(
  car: CarSimState,
  discipline: DisciplineId,
  excessG: number,
  dt: number,
  brake = 0,
  throttle = 0,
): void {
  const style = driftStyleFor(discipline);
  const dir = Math.sign(car.slipAngle || car.dl || 1);
  const slipMax =
    PHYSICS.deslotSlipMax * (style === 'looseGround' ? 1.4 : style === 'jdm' ? 1.25 : 1);

  if (style === 'fishtail') {
    // Track: damped yaw oscillation only — latch stays off.
    car.driftState = false;
    car.driftArmed = false;
    car.holdGear = false;
    car.yawRate += -car.slipAngle * 9 * dt - car.yawRate * 3.2 * dt;
    car.slipAngle += car.yawRate * dt;
  } else if (style === 'looseGround') {
    // Rally: Mag soft (profile); progressive slide; brake-pulse initiates.
    const scrub = getDisciplineProfile(discipline).deslotScrubMult;
    const brakePulse = brake > 0.42 && car.v > 5;
    if (brakePulse) {
      // Handbrake-lite: spike rear breakaway without inventing grip.
      car.yawRate += dir * (1.8 + excessG * 0.6) * dt * 8;
      car.slipAngle += dir * 0.55 * dt;
      car.magInterrupt = Math.max(car.magInterrupt, 0.55);
      if (Math.abs(car.slipAngle) > 0.14) car.driftState = true;
    }
    // Progressive build under throttle + excess; soft Mag while sliding.
    car.yawRate *= Math.exp(-(brakePulse ? 0.6 : 1.0) * dt);
    car.slipAngle += dir * Math.min(0.55, excessG * 0.1 * scrub + throttle * 0.04) * dt;
    if (car.driftState || Math.abs(car.slipAngle) > 0.2) {
      car.magInterrupt = Math.max(car.magInterrupt, 0.35);
      car.holdGear = true; // hold-gear friendly while loose
      car.driftState = true;
    }
    // Exit progressive latch when calmed.
    if (car.driftState && Math.abs(car.slipAngle) < 0.08 && throttle < 0.25 && brake < 0.2) {
      car.driftState = false;
      car.holdGear = false;
    }
    car.driftArmed = car.driftState || brakePulse || excessG > 0.35;
  } else if (style === 'jdm') {
    // Street: latch + powerband hold; kick spikes rear κ via transmission.
    car.driftArmed =
      car.driftState ||
      car.gripUsage > 0.85 ||
      Math.abs(car.slipAngle) > 0.1 ||
      car.clutchKickRemaining > 0;

    if (car.clutchKickRemaining > 0 && !car.driftState) {
      car.driftState = true;
      car.slipAngle += dir * 0.22;
      car.yawRate += dir * 1.4;
      car.magInterrupt = Math.max(car.magInterrupt, 0.9);
    }

    if (car.driftState) {
      // Powerband hold: throttle sustains target slip; lift bleeds out.
      const target = 0.38 * Math.sign(car.slipAngle || dir);
      const hold = throttle > 0.45 ? 5.5 : 1.8;
      car.slipAngle += (target - car.slipAngle) * (1 - Math.exp(-hold * dt));
      car.yawRate *= Math.exp(-1.4 * dt);
      car.magInterrupt = Math.max(car.magInterrupt, 0.5);
      car.holdGear = throttle > 0.4;
      if (throttle < 0.2 && Math.abs(car.slipAngle) < 0.12) {
        car.driftState = false;
        car.holdGear = false;
      }
    } else if (throttle > 0.55 && excessG > 0.25) {
      // Seed toward latch under power while scrubbing.
      car.slipAngle += dir * 0.18 * dt;
      if (Math.abs(car.slipAngle) > 0.22) car.driftState = true;
    } else {
      car.yawRate *= Math.exp(-2.5 * dt);
    }
  }

  car.slipAngle = Math.max(-slipMax, Math.min(slipMax, car.slipAngle));
}

/**
 * Groove-side brake-pulse (Rally) / kick arming — may soft-interrupt Mag
 * without flipping DRIFT_CFG. Called every tick from updateVehicle.
 */
export function stepDriftInitiate(
  car: CarSimState,
  discipline: DisciplineId,
  brake: number,
  throttle: number,
  curved: boolean,
  dt: number,
): void {
  const style = driftStyleFor(discipline);
  if (style === 'fishtail') {
    car.driftState = false;
    car.holdGear = false;
    return;
  }

  if (style === 'looseGround' && car.slotMode === 'groove' && curved && brake > 0.5 && car.v > 7) {
    // Handbrake-lite initiate while still slotted — Mag softens, then may deslot.
    car.magInterrupt = Math.max(car.magInterrupt, 0.65);
    car.slipAngle += Math.sign(car.slipAngle || car.dl || 1) * 0.35 * dt;
    car.yawRate += Math.sign(car.slipAngle || 1) * 2.2 * dt;
    car.driftArmed = true;
    if (Math.abs(car.slipAngle) > 0.16) {
      car.driftState = true;
      car.holdGear = true;
    }
  }

  if (style === 'jdm') {
    car.driftArmed = isDriftArmed(car);
    // Powered near-limit on groove arms kick without latching yet.
    if (
      car.slotMode === 'groove' &&
      curved &&
      throttle > 0.7 &&
      car.gripUsage > 0.9 &&
      !car.driftState
    ) {
      car.driftArmed = true;
    }
  }

  void dt;
}
