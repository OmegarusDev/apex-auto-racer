/** Groove Mag step — autopilot toward steerTarget; saturates vs tyre budget. */
import { PHYSICS } from '../../data/physics';
import type { DisciplineId } from '../../data/disciplines';
import { getDisciplineProfile } from '../../data/disciplineProfiles';
import type { CarSimState } from './types';
import { computeGrooveMag, headingErrorFromSlip } from './grooveAutopilot';
import { enterDeslot, deslotMinTimeFor } from './deslotDynamics';

export interface GrooveStepResult {
  magnet: number;
  mode: CarSimState['slotMode'];
  magMz: number;
  saturated: boolean;
}

export function stepGroove(args: {
  car: CarSimState;
  dt: number;
  kappaUse: number;
  curved: boolean;
  lineOffset: number;
  steerTarget: number;
  vDeslot: number;
  aLongDemand: number;
  aLatPath: number;
  aGrip: number;
  aLatCap: number;
  pinOverrule: boolean;
    skill: number;
    raceTime: number;
    discipline: DisciplineId;
    focus?: number;
}): GrooveStepResult {
  const {
    car,
    dt,
    kappaUse,
    curved,
    steerTarget,
    vDeslot,
    aLongDemand,
    aLatPath,
    aGrip,
    aLatCap,
    pinOverrule,
    skill,
    raceTime,
    discipline,
    focus = 50,
  } = args;

  let mode = car.slotMode;
  let magnet = 0;
  let magMz = 0;
  let saturated = false;

  if (mode !== 'groove') {
    return { magnet: 0, mode, magMz: 0, saturated: false };
  }

  const longLoad = Math.min(1, aLongDemand / Math.max(aGrip, 1e-6));
  const cornerLoad = Math.min(1, aLatPath / Math.max(aGrip, 1e-6));
  const pathYaw = kappaUse * car.v;
  const headingErr = headingErrorFromSlip(car.slipAngle, pathYaw, car.yawRate);

  // Mag interrupt from clutch-kick collapses authority briefly.
  const budgetScale = Math.max(0.05, 1 - car.magInterrupt);
  const disc = getDisciplineProfile(discipline);
  const aLatBudget = aLatCap * budgetScale * disc.magBandwidthMult;

  const mag = computeGrooveMag({
    l: car.l,
    steerTarget,
    dl: car.dl,
    v: car.v,
    headingError: headingErr,
    yawRate: car.yawRate,
    prevSteer: car.steerRad,
    aLatBudget,
    longLoad,
    cornerLoad,
    raceTime,
    skill: skill * disc.magBandwidthMult,
    focus,
    dt,
  });

  magnet = mag.authority;
  magMz = mag.mz;
  saturated = mag.saturated;
  car.magAuthority = mag.authority;
  car.steerRad = mag.steerRad;

  const roll =
    (car.v - PHYSICS.grooveLatMinV) /
    Math.max(1e-3, PHYSICS.grooveLatFullV - PHYSICS.grooveLatMinV);
  if (roll <= 1e-4) {
    car.dl = 0;
  } else {
    car.dl += mag.aLat * dt;
    const maxDl = car.v * PHYSICS.grooveMaxDlPerV;
    car.dl = Math.max(-maxDl, Math.min(maxDl, car.dl));
  }
  // Groove: tyres realize Mag attitude — cosmetic slip decays toward Mag heading.
  car.slipAngle *= Math.exp(-PHYSICS.slipDecay * dt);

  const overspeed = car.v > vDeslot;
  const O = car.gripUsage;
  const gripBreak = car.v > vDeslot * PHYSICS.oDeslotSpeedFrac && O > PHYSICS.oDeslot;
  const offLine = Math.abs(car.l - args.lineOffset) > PHYSICS.grooveCapacityDeslotL;
  const capacityFail =
    curved &&
    car.v > vDeslot * PHYSICS.oDeslotSpeedFrac &&
    magnet < PHYSICS.grooveCapacityMagnetMin &&
    offLine &&
    cornerLoad > 0.55 &&
    longLoad > 0.4;
  // Mag saturation under load = Newton-derived Scalextric pop.
  const magPop =
    curved &&
    saturated &&
    cornerLoad > 0.5 &&
    longLoad > 0.35 &&
    car.v > vDeslot * 0.88;
  const pinBendPop =
    pinOverrule &&
    car.isPlayerControlled &&
    curved &&
    cornerLoad > 0.48 &&
    longLoad > 0.45 &&
    car.v > vDeslot * 0.82;

  if (
    curved &&
    car.deslotImmunity <= 0 &&
    (overspeed || gripBreak || capacityFail || magPop || pinBendPop)
  ) {
    enterDeslot(car, kappaUse, vDeslot, discipline);
    if (pinOverrule) {
      car.deslotRemaining = Math.max(
        car.deslotRemaining,
        deslotMinTimeFor(discipline) * (1.85 - 0.45 * Math.min(1, skill / 80)),
      );
    }
    mode = 'deslot';
  }

  return { magnet, mode, magMz, saturated };
}
