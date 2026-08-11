/** Wall / runoff step. */
import { BALANCE } from '../../data/balance';
import { PHYSICS } from '../../data/physics';
import { getDisciplineProfile } from '../../data/disciplineProfiles';
import type { DisciplineId } from '../../data/disciplines';
import type { CarSimState } from './types';
import { computeZoneModifiers, wallLimitFor } from './zones';

export function stepWalls(args: {
  car: CarSimState;
  dt: number;
  width: number;
  runoffWidth: number;
  kappa: number;
  discipline: DisciplineId;
  focus: number;
  bravery: number;
}): void {
  const { car, dt, width, runoffWidth, kappa, discipline, focus, bravery } = args;

  const zone = computeZoneModifiers(Math.abs(car.l), width, runoffWidth, kappa, discipline);
  car.onKerb = zone.onKerb;
  if (zone.inRunoff) {
    car.v = Math.max(0, car.v - zone.dragDecel * dt);
    car.dl *= Math.exp(-0.55 * dt);
  }

  const wallLimit = wallLimitFor(width, runoffWidth);
  if (Math.abs(car.l) > wallLimit) {
    const into = Math.sign(car.l) || 1;
    car.l = into * wallLimit;
    const impactLat = Math.max(0, car.dl * into);
    if (impactLat > 0) {
      car.dl = -impactLat * PHYSICS.wallRestitution;
    }

    const impactSpeed = car.v;
    const hard = impactSpeed > PHYSICS.crashSpeed || impactLat > 5.5;
    if (hard) {
      const severity = Math.max(
        0.22,
        Math.min(
          1,
          (impactSpeed - PHYSICS.crashSpeed) / 16 +
            (impactLat * impactLat) / 120 +
            impactSpeed / 90,
        ),
      );
      car.v = Math.max(
        hard && car.slotMode === 'deslot' ? 1.2 : 0,
        car.v * (1 - (1 - PHYSICS.crashSpeedMult) * severity) -
          PHYSICS.wallImpactScrub * severity * dt * 8,
      );
      const stunScale = 1.05 - 0.3 * (focus / 100) + 0.08 * (bravery / 100);
      const streetStun = getDisciplineProfile(discipline).wallStunMult;
      // Street JDM latch: walls punish harder while latched (tyre+barrier story).
      const latchPunish =
        discipline === 'street' && car.driftState ? 1.35 : 1;
      car.stunRemaining = Math.max(
        car.stunRemaining,
        PHYSICS.crashStun * severity * stunScale * streetStun * latchPunish,
      );
      car.wallHits += 1;
      if (car.isPlayerControlled) {
        car.condition = Math.max(
          BALANCE.conditionMin,
          car.condition -
            BALANCE.wallCrashConditionLoss * severity * (latchPunish > 1 ? 1.25 : 1),
        );
      }
      if (discipline === 'street' && car.driftState && hard) {
        // Latch breaks on hard barrier — washout, not free continue.
        car.driftState = false;
        car.holdGear = false;
        car.slipAngle *= 0.4;
      }
      if (
        car.slotMode === 'deslot' &&
        impactSpeed > PHYSICS.spinWallSpeed &&
        impactLat > 5 &&
        car.spinRemaining <= 0
      ) {
        car.spinRemaining = PHYSICS.spinStun;
        car.stunRemaining = Math.max(car.stunRemaining, PHYSICS.spinStun * 0.85);
        car.spinCount += 1;
        car.driftState = false;
      }
    } else {
      car.v *= 1 - PHYSICS.scrapeSpeedMultPerSec * dt;
      if (car.slotMode === 'deslot' && car.v < 2.2 && Math.abs(car.dl) < 0.8) {
        car.dl = -into * Math.min(PHYSICS.deslotWallPush, 3.2);
      }
    }
  } else if (
    car.slotMode === 'deslot' &&
    Math.abs(car.l) > wallLimit - 0.8 &&
    car.v < 2.5 &&
    Math.abs(car.dl) < 1
  ) {
    const into = Math.sign(car.l) || 1;
    car.dl += -into * PHYSICS.deslotWallPush * 0.4 * dt;
  }
}
