/** Drive / long / tyre / integrate step. */
import { PHYSICS } from '../../data/physics';
import type { CarSimState } from './types';
import {
  HYBRID_MASS_KG,
  computeAxleLoads,
  gripAccelFromLoads,
  resolveTwoAxleTyres,
  integrateYaw,
  updateSlipAngle,
} from './dynamics';

export interface DriveLongResult {
  aDriveUncapped: number;
  aBrakeAppliedUncapped: number;
  aCoast: number;
  aLongDemand: number;
  aGrip: number;
  aLatPath: number;
  aBudget: number;
  aDrive: number;
  aBrakeApplied: number;
  aLong: number;
  O: number;
  aLatCap: number;
  loads: ReturnType<typeof computeAxleLoads>;
  tyreUsage: number;
}

export function computeLongAndGrip(args: {
  car: CarSimState;
  throttle: number;
  brake: number;
  recovering: boolean;
  pinOverrule: boolean;
  curved: boolean;
  skill: number;
  vMaxEff: number;
  torque: number;
  clutchKickLong: number;
  vGearMax: number;
  sDet: number;
  draft: number;
  muEff: number;
  kappaEff: number;
  suspStiffness: number;
}): DriveLongResult {
  const {
    car,
    throttle,
    brake,
    recovering,
    pinOverrule,
    curved,
    skill,
    torque,
    clutchKickLong,
    vGearMax,
    sDet,
    draft,
    muEff,
    kappaEff,
    suspStiffness,
  } = args;

  const mass = car.setup.massKg;
  // Heavier cars are slower to accelerate for the same power (MASS_INERTIA).
  const massScale = HYBRID_MASS_KG / Math.max(900, mass);
  const aDriveUncapped =
    throttle *
    car.stats.aAccel *
    sDet *
    torque *
    clutchKickLong *
    massScale *
    (1 + PHYSICS.draftAccelBonus * draft) *
    (1 - (car.v / Math.max(vGearMax, 0.1)) ** 2);
  const aCoast = (1 - throttle) * (PHYSICS.coastBase + PHYSICS.coastVel * car.v);
  // Trail bias: forward brake bias bites harder into front axle (TRAIL_BIAS).
  const biasBite = 0.92 + 0.16 * (car.setup.brakeBiasFront - 0.5) * 2;
  const aBrakeAppliedUncapped = brake * car.stats.aBrake * biasBite;

  // Path centripetal demand (before tyre solve).
  const aLatPath = car.v * car.v * Math.abs(kappaEff);

  // Axle loads from weight + DF + transfer (force inventory §1.2b).
  const loads = computeAxleLoads(
    mass,
    car.v,
    car.aLong,
    aLatPath,
    car.stats.D,
    car.balanceB,
    suspStiffness,
    {
      cgHeight: car.setup.cgHeight,
      staticFront: car.setup.staticFront,
      clScale: car.setup.clScale,
      cdScale: car.setup.cdScale,
    },
  );
  car.fzFront = loads.fzFront;
  car.fzRear = loads.fzRear;

  let aGrip = gripAccelFromLoads(muEff, loads, mass);
  if (car.balanceB < 0) {
    aGrip *= 1 + 0.06 * Math.max(0, -car.balanceB);
  }

  const aLatClamped = Math.min(aLatPath, aGrip);
  const aBudget = Math.sqrt(Math.max(0, aGrip * aGrip - aLatClamped * aLatClamped));

  let aDrive = Math.min(Math.max(0, aDriveUncapped), aBudget);
  const tractionBonus = 1 + 0.15 * Math.max(0, car.balanceB);
  aDrive = Math.min(aDrive * tractionBonus, aBudget);

  const aBrakeApplied = Math.min(aBrakeAppliedUncapped, aBudget);
  let aLong = aDrive - aBrakeApplied - aCoast;
  // Aero drag already in resolveTwoAxle via loads.fDrag — subtract accel equivalent here
  // for the pre-tyre long path so friction circle stays honest.
  aLong -= loads.fDrag / mass;

  if (recovering) {
    aLong -=
      car.slotMode === 'deslot'
        ? PHYSICS.crashRecoveryDecelDeslot
        : PHYSICS.crashRecoveryDecel;
  }
  if (pinOverrule && car.isPlayerControlled && curved) {
    const cl = Math.min(1, aLatPath / Math.max(aGrip, 1e-6));
    if (cl > 0.28) {
      const kill = Math.min(1, (cl - 0.28) / 0.72);
      aLong -= Math.max(0, aDrive) * (0.45 + 0.5 * kill);
      aLong -= (0.22 + 0.4 * kill) * PHYSICS.g;
    }
  }
  void skill;

  const aLongDemand = Math.max(aDriveUncapped, aBrakeAppliedUncapped);
  const O = Math.sqrt(aLatPath * aLatPath + aLongDemand * aLongDemand) / Math.max(aGrip, 1e-6);
  car.gripUsage = O;

  const aLongUsed = Math.abs(aDrive - aBrakeApplied);
  const aLatCap = Math.sqrt(Math.max(0, aGrip * aGrip - aLongUsed * aLongUsed));

  return {
    aDriveUncapped,
    aBrakeAppliedUncapped,
    aCoast,
    aLongDemand,
    aGrip,
    aLatPath,
    aBudget,
    aDrive,
    aBrakeApplied,
    aLong,
    O,
    aLatCap,
    loads,
    tyreUsage: O,
  };
}

/** Apply two-axle tyre solve + Mag yaw; returns refined aLong / body aLat from rubber. */
export function applyTyreYawStep(args: {
  car: CarSimState;
  aLongDemand: number;
  muEff: number;
  loads: ReturnType<typeof computeAxleLoads>;
  kappaEff: number;
  magMz: number;
  dt: number;
}): { aLongTyre: number; aLatTyre: number; usage: number } {
  const { car, aLongDemand, muEff, loads, kappaEff, magMz, dt } = args;
  const solved = resolveTwoAxleTyres({
    massKg: car.setup.massKg,
    v: car.v,
    yawRate: car.yawRate,
    slipAngle: car.slipAngle,
    steerRad: car.steerRad,
    muEff,
    loads,
    aLongDemand,
    kappaPath: kappaEff,
    brakeBiasFront: car.setup.brakeBiasFront,
    staticFront: car.setup.staticFront,
  });

  car.yawRate = integrateYaw(car.yawRate, solved.mzTyre, magMz, dt, car.setup.iz);
  car.slipAngle = updateSlipAngle(
    car.slipAngle,
    solved.aLat,
    car.v,
    car.yawRate,
    kappaEff,
    dt,
  );

  return { aLongTyre: solved.aLong, aLatTyre: solved.aLat, usage: solved.usage };
}

export function integrateMotion(
  car: CarSimState,
  aLong: number,
  dt: number,
  trackLength: number,
  mode: CarSimState['slotMode'],
): void {
  car.v = Math.max(0, car.v + aLong * dt);
  car.s = (car.s + car.v * dt) % trackLength;
  if (car.s < 0) car.s += trackLength;
  if (car.v < PHYSICS.grooveLatMinV * 0.5 && mode === 'groove') {
    car.dl = 0;
  }
  car.l += car.dl * dt;
  car.aLong = aLong;
}

export function updateTyreTemp(
  car: CarSimState,
  dt: number,
  O: number,
  recovering: boolean,
): void {
  const recoveringTyres = recovering || car.slotMode === 'deslot' || car.spinRemaining > 0;
  const cool =
    recoveringTyres || car.v > 2 ? PHYSICS.tyreCool * 0.35 : PHYSICS.tyreCool;
  car.tyreTemp = Math.max(
    recoveringTyres ? PHYSICS.tyreRecoveryFloor : 0,
    Math.min(
      PHYSICS.tyreTempMax,
      car.tyreTemp +
        (PHYSICS.tyreHeatSpeed * (car.v / Math.max(car.stats.vMax, 0.1)) +
          PHYSICS.tyreHeatOver * Math.max(0, O - 1) +
          (car.driftState ? PHYSICS.tyreHeatDrift : 0) +
          (car.slotMode === 'deslot' ? PHYSICS.tyreHeatOver * 0.35 : 0) -
          cool) *
          dt,
    ),
  );
}
