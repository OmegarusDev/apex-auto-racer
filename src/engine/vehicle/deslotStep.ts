/** Deslot / off-slot step. */
import { PHYSICS } from '../../data/physics';
import { getDisciplineProfile } from '../../data/disciplineProfiles';
import type { DisciplineId } from '../../data/disciplines';
import { outwardSign } from '../RacingLine';
import type { CarSimState } from './types';
import {
  computeDeslotLateralAccel,
  tryRejoinGroove,
  applyOffslotYawBleed,
} from './deslotDynamics';

export function stepDeslot(args: {
  car: CarSimState;
  dt: number;
  kappaUse: number;
  kappaEff: number;
  aLatCap: number;
  aLatPath: number;
  aGrip: number;
  lineOffset: number;
  vDeslot: number;
  discipline: DisciplineId;
}): { aLongScrub: number; mode: CarSimState['slotMode'] } {
  const {
    car,
    dt,
    kappaUse,
    kappaEff,
    aLatCap,
    aLatPath,
    aGrip,
    lineOffset,
    vDeslot,
    discipline,
  } = args;

  if (car.slotMode !== 'deslot') {
    return { aLongScrub: 0, mode: car.slotMode };
  }

  car.deslotRemaining = Math.max(0, car.deslotRemaining - dt);
  const aL =
    computeDeslotLateralAccel(car, kappaEff, aLatCap, lineOffset) *
    getDisciplineProfile(discipline).deslotWashoutMult;
  car.dl += aL * dt;

  const excess = Math.max(0, aLatPath - aLatCap);
  const scrubGain = PHYSICS.deslotScrubGain * getDisciplineProfile(discipline).deslotScrubMult;
  const scrub = Math.min(PHYSICS.deslotScrubMaxG * PHYSICS.g, scrubGain * excess);

  const dir = (() => {
    const outward = outwardSign(kappaUse);
    return outward === 0 ? (car.l >= 0 ? 1 : -1) : outward;
  })();
  const slipTarget =
    dir * PHYSICS.deslotSlipMax * Math.min(1, 0.35 + excess / Math.max(aGrip, 1));
  car.slipAngle += (slipTarget - car.slipAngle) * (1 - Math.exp(-4 * dt));
  car.slipAngle = Math.max(
    -PHYSICS.deslotSlipMax,
    Math.min(PHYSICS.deslotSlipMax, car.slipAngle),
  );

  applyOffslotYawBleed(
    car,
    discipline,
    excess / Math.max(PHYSICS.g, 1),
    dt,
    car.brake,
    car.throttle,
  );

  tryRejoinGroove(car, lineOffset, vDeslot);
  return { aLongScrub: scrub, mode: car.slotMode };
}
