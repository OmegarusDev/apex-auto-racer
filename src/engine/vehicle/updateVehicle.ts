/**
 * Per-tick vehicle update — hybrid tyre+yaw + groove Mag autopilot.
 * Player inputs scale drive/brake/clutch only (no steer axis).
 */
import { PHYSICS, DRIFT_CFG } from '../../data/physics';
import type { SlotMode } from '../types';
import type { ModifierContext } from '../modifiers';
import { applyModifiers } from '../modifiers';
import { conditionLiveMods } from '../stats';
import type { TrackData } from '../TrackGenerator';
import { interpolateAtSInto, type InterpolatedNode } from '../RacingLine';
import { computePinAuthorityBlend } from './authority';
import { computeTempGrip, computeZoneModifiers, wallLimitFor } from './zones';
import { computeVDeslot } from './deslotMargin';
import { personalLineAt } from './create';
import { stepTransmission, transmissionDriveScale } from './transmission';
import { computeLongAndGrip, integrateMotion, updateTyreTemp } from './driveStep';
import { stepGroove } from './grooveStep';
import { stepDeslot } from './deslotStep';
import { stepWalls } from './wallStep';
import { stepDriftInitiate } from './deslotDynamics';
import type {
  BrainOutput,
  VehicleInputs,
  VehicleUpdateContext,
  CarSimState,
} from './types';

export type {
  BrainOutput,
  VehicleInputs,
  VehicleUpdateContext,
  CarSimState,
  ZoneModifiers,
} from './types';

export {
  computeBrakeAuthority,
  computeThrottleAuthority,
  computePinAuthorityBlend,
} from './authority';
export {
  computeTempGrip,
  wallLimitFor,
  barrierHalfWidth,
  computeZoneModifiers,
} from './zones';
export {
  computeDriverDeslotMargin,
  computeVDeslot,
  enterDeslot,
  contactDeslot,
} from './deslotMargin';
export {
  createCarState,
  buildVehicleContext,
  personalLineAt,
  vDriverAt,
  vSafeAt,
  computeSDet,
} from './create';

const nodeScratch: InterpolatedNode = {
  pos: { x: 0, y: 0 },
  tangent: { x: 1, y: 0 },
  normal: { x: 0, y: 1 },
  width: 0,
  runoffWidth: 0,
  kappa: 0,
  kappaLine: 0,
  o: 0,
  s: 0,
};

function assertFinite(car: CarSimState, debug: boolean): void {
  const fields: (keyof CarSimState)[] = [
    's',
    'l',
    'v',
    'slipAngle',
    'tyreTemp',
    'balanceB',
    'lTarget',
    'dl',
    'yawRate',
    'steerRad',
    'fzFront',
    'fzRear',
  ];
  let bad = false;
  for (const f of fields) {
    const val = car[f];
    if (typeof val === 'number' && !Number.isFinite(val)) {
      bad = true;
      if (debug) {
        console.warn(`[Vehicle] NaN/Inf in car.${String(f)}`, car.id);
      }
    }
  }
  if (!bad) return;
  if (!Number.isFinite(car.s)) car.s = 0;
  if (!Number.isFinite(car.l)) car.l = 0;
  if (!Number.isFinite(car.v) || car.v < 0) car.v = 0;
  if (!Number.isFinite(car.slipAngle)) car.slipAngle = 0;
  if (!Number.isFinite(car.tyreTemp)) car.tyreTemp = 0.5;
  if (!Number.isFinite(car.balanceB)) car.balanceB = 0;
  if (!Number.isFinite(car.lTarget)) car.lTarget = car.l;
  if (!Number.isFinite(car.dl)) car.dl = 0;
  if (!Number.isFinite(car.yawRate)) car.yawRate = 0;
  if (!Number.isFinite(car.steerRad)) car.steerRad = 0;
  if (!Number.isFinite(car.fzFront)) car.fzFront = 0;
  if (!Number.isFinite(car.fzRear)) car.fzRear = 0;
}

/**
 * Hybrid vehicle step — Newton long/lat via two-axle tyres + Mag autopilot.
 */
export function updateVehicle(
  car: CarSimState,
  track: TrackData,
  dt: number,
  inputs: VehicleInputs,
  brainOut: BrainOutput,
  ctx: VehicleUpdateContext,
): void {
  const recovering = car.stunRemaining > 0;
  if (recovering) {
    car.stunRemaining = Math.max(0, car.stunRemaining - dt);
  }

  if (car.spinRemaining > 0) {
    car.spinRemaining = Math.max(0, car.spinRemaining - dt);
    car.v = Math.max(0, car.v * (1 - dt / PHYSICS.spinDecelTime));
    car.dl *= Math.exp(-2.5 * dt);
    car.yawRate *= Math.exp(-2 * dt);
    car.s = (car.s + car.v * dt) % track.length;
    if (car.s < 0) car.s += track.length;
    car.l += car.dl * dt;
    const spinNode = interpolateAtSInto(track.nodes, track.length, car.s, nodeScratch);
    const spinWall = wallLimitFor(spinNode.width, spinNode.runoffWidth);
    if (Math.abs(car.l) > spinWall) {
      const into = Math.sign(car.l) || 1;
      car.l = into * spinWall;
      car.dl = -Math.abs(car.dl) * into * PHYSICS.wallRestitution;
    }
    if (car.spinRemaining <= 0) {
      car.slipAngle = 0;
      car.slotMode = 'deslot';
      car.deslotRemaining = Math.max(car.deslotRemaining, PHYSICS.deslotMinTime * 0.5);
    }
    assertFinite(car, ctx.debug === true);
    return;
  }

  const node = interpolateAtSInto(track.nodes, track.length, car.s, nodeScratch);
  const halfW = node.width / 2;
  const lineClamp = halfW - PHYSICS.racingLineMargin;
  const kappaUse = node.kappaLine;
  const curved = Math.abs(kappaUse) >= PHYSICS.grooveKappaMin;

  car.easedThrottle = inputs.throttle;
  car.easedBrake = inputs.brake;

  let throttle: number;
  let brake: number;
  let pinOverrule = false;
  if (car.isPlayerControlled) {
    const pT = car.easedThrottle;
    const pB = car.easedBrake;
    const blend = computePinAuthorityBlend(ctx.skill, pT, pB);
    pinOverrule = blend.pinOverrule;
    const brakeBlend = blend.brakeBlend;
    const trim = blend.trim;
    throttle = pT - trim * Math.max(0, pT - brainOut.desiredThrottle);
    brake = Math.max(pB, brakeBlend * brainOut.desiredBrake);
  } else {
    throttle = brainOut.desiredThrottle;
    brake = brainOut.desiredBrake;
  }

  if (recovering) {
    const deslotRecover = car.slotMode === 'deslot';
    throttle *= deslotRecover ? 0.55 : 0.28;
    if (!deslotRecover) {
      brake = Math.max(brake, 0.22);
    } else {
      brake = Math.min(brake, 0.12);
      throttle = Math.max(throttle, 0.3);
    }
  }

  car.throttle = throttle;
  car.brake = brake;
  // Mag setpoint from AI steerTarget (falls back to lTarget). Player never steers.
  const steerTarget = Math.max(
    -lineClamp,
    Math.min(lineClamp, brainOut.steerTarget ?? brainOut.lTarget),
  );
  car.lTarget = steerTarget;

  const modCtx: ModifierContext = {
    time: ctx.raceTime,
    isPlayer: car.isPlayerControlled,
    rain: ctx.rain,
    drifting: car.driftState,
  };

  const baseMods = {
    muSurface: ctx.muSurface,
    gripFactor: car.stats.gripFactor,
    vMax: car.stats.vMax,
    aAccel: car.stats.aAccel,
    aBrake: car.stats.aBrake,
    condGrip: car.stats.condGrip,
    condTop: car.stats.condTop,
    tempGrip: computeTempGrip(car.tyreTemp),
    draft: ctx.draft,
  };

  const mods = applyModifiers(baseMods, ctx.modifierStack, modCtx);
  const muSurface = mods.muSurface ?? ctx.muSurface;
  const gripFactor = mods.gripFactor ?? car.stats.gripFactor;
  const liveCond = conditionLiveMods(car.condition);
  const condGrip = mods.condGrip ?? liveCond.condGrip;
  const condTop = mods.condTop ?? liveCond.condTop;
  let tempGrip = mods.tempGrip ?? computeTempGrip(car.tyreTemp);
  if (car.tyreTemp < 0.5) {
    const tierCold = Math.max(0, 1.02 - gripFactor * condGrip) * 0.06;
    tempGrip = Math.max(0.84, tempGrip - tierCold * (1 - car.tyreTemp / 0.5));
  }
  const draft = mods.draft ?? ctx.draft;

  let zone = computeZoneModifiers(
    Math.abs(car.l),
    node.width,
    node.runoffWidth,
    node.kappa,
    ctx.discipline,
  );
  const driftCfg = DRIFT_CFG[ctx.discipline] ?? DRIFT_CFG.track!;

  const pinGrip =
    pinOverrule && car.isPlayerControlled
      ? 0.62 + 0.2 * Math.min(1, ctx.skill / 75)
      : 1;
  // Surface/tyre µ only — downforce enters via Fz (aeroForces), not a free µ bump.
  // Compound from garage tyres; hybrid latch uses a tiny style µ (not DRIFT_CFG flip).
  const latchMu =
    car.driftState && ctx.discipline === 'street'
      ? 1.04
      : car.driftState && ctx.discipline === 'rally'
        ? 1.06
        : 1;
  const muEff =
    muSurface *
    gripFactor *
    condGrip *
    tempGrip *
    pinGrip *
    zone.gripMult *
    car.setup.compoundMu *
    latchMu *
    (driftCfg.enabled && car.driftState ? driftCfg.muMult : 1);

  const vMaxEff = car.stats.vMax * condTop * (1 + PHYSICS.draftSpeedBonus * draft);
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
  const { vGearMax, torque, clutchKickLong } = transmissionDriveScale(
    car,
    vMaxEff,
    ctx.discipline,
  );

  const kappaEff = kappaUse / Math.max(0.5, Math.min(1.5, 1 - car.l * kappaUse));
  const suspStiffness = car.setup.suspStiffness;

  stepDriftInitiate(car, ctx.discipline, brake, throttle, curved, dt);

  const long = computeLongAndGrip({
    car,
    throttle,
    brake,
    recovering,
    pinOverrule,
    curved,
    skill: ctx.skill,
    vMaxEff,
    torque,
    clutchKickLong,
    vGearMax,
    sDet: ctx.sDet,
    draft,
    muEff,
    kappaEff,
    suspStiffness,
  });

  const balanceTarget = Math.max(-1, Math.min(1, long.aLong / PHYSICS.loadTransferScale));
  car.balanceB +=
    (balanceTarget - car.balanceB) * (1 - Math.exp(-dt / PHYSICS.loadTransferTau));

  const vDeslot = computeVDeslot(
    car,
    track,
    ctx.skill,
    ctx.focus,
    tempGrip,
    ctx.bravery,
  );
  car.vDeslot = vDeslot;
  if (car.deslotImmunity > 0) {
    car.deslotImmunity = Math.max(0, car.deslotImmunity - dt);
  }

  const lineOffset =
    car.lineO.length > 0 ? personalLineAt(car, track, car.s) : node.o;
  let mode: SlotMode = car.slotMode;

  const groove = stepGroove({
    car,
    dt,
    kappaUse,
    curved,
    lineOffset,
    steerTarget,
    vDeslot,
    aLongDemand: long.aLongDemand,
    aLatPath: long.aLatPath,
    aGrip: long.aGrip,
    aLatCap: long.aLatCap,
    pinOverrule,
    skill: ctx.skill,
    raceTime: ctx.raceTime,
    discipline: ctx.discipline,
    focus: ctx.focus,
  });
  mode = groove.mode;

  let aLong = long.aLong;
  const deslot = stepDeslot({
    car,
    dt,
    kappaUse,
    kappaEff,
    aLatCap: long.aLatCap,
    aLatPath: long.aLatPath,
    aGrip: long.aGrip,
    lineOffset,
    vDeslot,
    discipline: ctx.discipline,
  });
  aLong -= deslot.aLongScrub;
  mode = deslot.mode;

  // Quarantined DRIFT_CFG — do not enable as slotted primary.
  if (driftCfg.enabled) {
    if (brake >= 0.5 && Math.abs(car.slipAngle) > driftCfg.initiate) {
      car.driftState = true;
    }
    if (car.driftState) {
      const slipTarget = driftCfg.target * Math.sign(car.slipAngle || 1);
      car.slipAngle += (slipTarget - car.slipAngle) * (1 - Math.exp(-6 * dt));
      if (long.O < 0.6) car.driftState = false;
    }
  }

  car.prevThrottle = throttle;

  integrateMotion(car, aLong, dt, track.length, mode);
  updateTyreTemp(car, dt, long.O, recovering);

  stepWalls({
    car,
    dt,
    width: node.width,
    runoffWidth: node.runoffWidth,
    kappa: node.kappa,
    discipline: ctx.discipline,
    focus: ctx.focus,
    bravery: ctx.bravery,
  });

  assertFinite(car, ctx.debug === true);
}
