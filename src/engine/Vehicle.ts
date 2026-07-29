import { BALANCE } from '../data/balance';
import { PHYSICS, DRIFT_CFG } from '../data/physics';
import type { DisciplineId } from '../data/disciplines';
import type { Driver, EffectiveStats, VehicleState } from './types';
import type { Modifier, ModifierContext } from './modifiers';
import { applyModifiers } from './modifiers';
import type { TrackData } from './TrackGenerator';
import { interpolateAtS, outwardSign } from './RacingLine';

export interface BrainOutput {
  desiredThrottle: number;
  desiredBrake: number;
  lTarget: number;
}

export interface VehicleInputs {
  /** Player pedal 0-1 (eased externally or here). */
  throttle: number;
  brake: number;
}

export interface VehicleUpdateContext {
  discipline: DisciplineId;
  stats: EffectiveStats;
  modifierStack: readonly Modifier[];
  muSurface: number;
  draft: number;
  sDet: number;
  position: number;
  totalCars: number;
  rain: boolean;
  debug?: boolean;
  raceTime: number;
}

export interface CarSimState extends VehicleState {
  stats: EffectiveStats;
  lTarget: number;
  dl: number;
  aLong: number;
  gripUsage: number;
  prevThrottle: number;
  throttleDropTime: number;
  gear: number;
  rpm: number;
  easedThrottle: number;
  easedBrake: number;
  vProfile: number[];
  vDriver: number[];
  authority: number;
}

export interface ZoneModifiers {
  gripMult: number;
  dragDecel: number;
  onKerb: boolean;
  inRunoff: boolean;
  atWall: boolean;
}

const KERB_KAPPA_THRESHOLD = 0.02;
const GEAR_COUNT = 5;
const RPM_IDLE = 900;
const RPM_MIN = 2500;
const RPM_MAX = 8000;

/** Tyre temperature grip multiplier (plan 4.1). */
export function computeTempGrip(T: number): number {
  if (T <= 0.6) return 0.92 + (1.0 - 0.92) * (T / 0.6);
  if (T <= 1.0) return 1.0;
  if (T >= 1.3) return 0.94;
  return 1.0 - (0.06 * (T - 1.0)) / 0.3;
}

/** Lateral zone grip/drag modifiers (plan 4.1). */
export function computeZoneModifiers(
  absL: number,
  width: number,
  runoffWidth: number,
  kappa: number,
  discipline: DisciplineId,
): ZoneModifiers {
  const halfW = width / 2;
  const wallLimit = halfW + runoffWidth - PHYSICS.wallMargin;

  if (absL > wallLimit) {
    return { gripMult: 1, dragDecel: 0, onKerb: false, inRunoff: false, atWall: true };
  }

  if (absL > halfW) {
    const drag = discipline === 'rally' ? PHYSICS.runoffDragRally : PHYSICS.runoffDrag;
    return { gripMult: PHYSICS.runoffGrip, dragDecel: drag, onKerb: false, inRunoff: true, atWall: false };
  }

  const kerbInner = halfW - PHYSICS.kerbOuterM;
  const onKerb =
    Math.abs(kappa) >= KERB_KAPPA_THRESHOLD && absL >= kerbInner && absL <= halfW;

  return {
    gripMult: onKerb ? PHYSICS.kerbGrip : 1,
    dragDecel: 0,
    onKerb,
    inRunoff: false,
    atWall: false,
  };
}

/** Determination catch-up scalar (plan 7.1). */
export function computeSDet(determination: number, position: number, totalCars: number): number {
  if (totalCars <= 1) return 1;
  return 1 + PHYSICS.detBonus * (determination / 100) * ((position - 1) / (totalCars - 1));
}

/** Player authority blend strength (plan 6 step 3). */
export function computeAuthority(skill: number): number {
  return PHYSICS.authorityBase + PHYSICS.authoritySpan * (skill / 100);
}

function interpolateVDriver(vDriver: readonly number[], track: TrackData, s: number): number {
  const n = vDriver.length;
  if (n === 0) return 0;
  let distS = s % track.length;
  if (distS < 0) distS += track.length;

  let i0 = 0;
  for (let i = 0; i < n; i++) {
    if (track.nodes[i]!.s <= distS) i0 = i;
  }
  const i1 = (i0 + 1) % n;
  const s0 = track.nodes[i0]!.s;
  const s1 = i1 === 0 ? track.length : track.nodes[i1]!.s;
  const ds = s1 - s0;
  const t = ds > 1e-6 ? (distS - s0) / ds : 0;
  return vDriver[i0]! * (1 - t) + vDriver[i1]! * t;
}

function easePedal(current: number, target: number, dt: number): number {
  const rate = 1 / (PHYSICS.pedalEaseMs / 1000);
  if (target > current) return Math.min(target, current + rate * dt);
  if (target < current) return Math.max(target, current - rate * dt);
  return current;
}

function updateCosmeticRpm(car: CarSimState, dt: number): void {
  const band = car.stats.vMax / GEAR_COUNT;
  const gear = Math.min(GEAR_COUNT, Math.max(1, Math.floor(car.v / band) + 1));
  car.gear = gear;
  const bandStart = (gear - 1) * band;
  const bandFrac = band > 0 ? (car.v - bandStart) / band : 0;
  const targetRpm = RPM_IDLE + (RPM_MAX - RPM_MIN) * Math.max(0, Math.min(1, bandFrac));
  car.rpm += (targetRpm - car.rpm) * (1 - Math.exp(-8 * dt));
}

function assertFinite(car: CarSimState, debug: boolean): void {
  if (!debug) return;
  const fields: (keyof CarSimState)[] = ['s', 'l', 'v', 'slipAngle', 'tyreTemp', 'balanceB', 'lTarget'];
  for (const f of fields) {
    const val = car[f];
    if (typeof val === 'number' && !Number.isFinite(val)) {
      console.warn(`[Vehicle] NaN/Inf in car.${String(f)}`, car.id);
    }
  }
}

export function createCarState(
  id: string,
  driverId: string,
  teamId: number,
  isPlayerControlled: boolean,
  stats: EffectiveStats,
  vProfile: number[],
  vDriver: number[],
  condition: number,
  gridS: number,
  gridL: number,
  authority: number,
): CarSimState {
  return {
    id,
    driverId,
    teamId,
    isPlayerControlled,
    s: gridS,
    l: gridL,
    v: 0,
    slipAngle: 0,
    tyreTemp: 0,
    balanceB: 0,
    driftState: false,
    stunRemaining: 0,
    spinRemaining: 0,
    throttle: 0,
    brake: 0,
    condition,
    lap: 0,
    finished: false,
    finishTime: 0,
    wallHits: 0,
    spinCount: 0,
    overtakeCount: 0,
    stats,
    lTarget: gridL,
    dl: 0,
    aLong: 0,
    gripUsage: 0,
    prevThrottle: 0,
    throttleDropTime: -1,
    gear: 1,
    rpm: RPM_IDLE,
    easedThrottle: 0,
    easedBrake: 0,
    vProfile,
    vDriver,
    authority,
  };
}

/**
 * Per-tick vehicle update — plan section 6 steps 1-12.
 * Brain outputs are produced externally at 30 Hz and passed in.
 */
export function updateVehicle(
  car: CarSimState,
  track: TrackData,
  dt: number,
  inputs: VehicleInputs,
  brainOut: BrainOutput,
  ctx: VehicleUpdateContext,
): void {
  if (car.stunRemaining > 0) {
    car.stunRemaining = Math.max(0, car.stunRemaining - dt);
    car.v = Math.max(0, car.v - 20 * dt);
    car.dl = 0;
    assertFinite(car, ctx.debug === true);
    return;
  }

  if (car.spinRemaining > 0) {
    car.spinRemaining = Math.max(0, car.spinRemaining - dt);
    car.v = Math.max(0, car.v * (1 - dt / PHYSICS.spinDecelTime));
    car.dl = 0;
    if (car.spinRemaining <= 0) {
      car.l = 0;
      car.slipAngle = 0;
    }
    assertFinite(car, ctx.debug === true);
    return;
  }

  // Step 1: lookup node at s
  const node = interpolateAtS(track.nodes, track.length, car.s);
  const halfW = node.width / 2;
  const lineClamp = halfW - PHYSICS.racingLineMargin;

  // Step 3: input blend (player authority vs brain)
  car.easedThrottle = easePedal(car.easedThrottle, inputs.throttle, dt);
  car.easedBrake = easePedal(car.easedBrake, inputs.brake, dt);

  let throttle: number;
  let brake: number;

  if (car.isPlayerControlled) {
    const pT = car.easedThrottle;
    const pB = car.easedBrake;
    const auth = car.authority;
    throttle = pT - auth * Math.max(0, pT - brainOut.desiredThrottle);
    brake = Math.max(pB, auth * brainOut.desiredBrake);
  } else {
    throttle = brainOut.desiredThrottle;
    brake = brainOut.desiredBrake;
  }

  car.throttle = throttle;
  car.brake = brake;
  car.lTarget = Math.max(-lineClamp, Math.min(lineClamp, brainOut.lTarget));

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
    kUnder: car.stats.kUnder,
  };

  const mods = applyModifiers(baseMods, ctx.modifierStack, modCtx);
  const muSurface = mods.muSurface ?? ctx.muSurface;
  const gripFactor = mods.gripFactor ?? car.stats.gripFactor;
  const condGrip = mods.condGrip ?? car.stats.condGrip;
  const condTop = mods.condTop ?? car.stats.condTop;
  const tempGrip = mods.tempGrip ?? computeTempGrip(car.tyreTemp);
  const draft = mods.draft ?? ctx.draft;
  const kUnder = mods.kUnder ?? car.stats.kUnder;

  const zone = computeZoneModifiers(Math.abs(car.l), node.width, node.runoffWidth, node.kappa, ctx.discipline);
  const driftCfg = DRIFT_CFG[ctx.discipline] ?? DRIFT_CFG.track!;

  // Step 4: longitudinal
  const vMaxEff = car.stats.vMax * condTop * (1 + PHYSICS.draftSpeedBonus * draft);
  const sDet = ctx.sDet;
  const aDriveUncapped =
    throttle * car.stats.aAccel * sDet * (1 + PHYSICS.draftAccelBonus * draft) *
    (1 - (car.v / Math.max(vMaxEff, 0.1)) ** 2);
  const aCoast = (1 - throttle) * (PHYSICS.coastBase + PHYSICS.coastVel * car.v);
  const aBrakeAppliedUncapped = brake * car.stats.aBrake;

  // Step 5: grip & demand
  const muEff =
    muSurface * gripFactor * condGrip * tempGrip *
    (1 + car.stats.D * (car.v / Math.max(car.stats.vMax, 0.1)) ** 2) *
    zone.gripMult * (car.driftState ? driftCfg.muMult : 1);

  let aGrip = muEff * PHYSICS.g;
  if (car.balanceB < 0) {
    aGrip *= 1 + 0.06 * Math.max(0, -car.balanceB);
  }
  const kappaEff = node.kappa / Math.max(0.5, Math.min(1.5, 1 - car.l * node.kappa));
  const aLat = car.v * car.v * Math.abs(kappaEff);

  // Step 6: friction circle
  const aLatClamped = Math.min(aLat, aGrip);
  const aBudget = Math.sqrt(Math.max(0, aGrip * aGrip - aLatClamped * aLatClamped));

  let aDrive = Math.min(Math.max(0, aDriveUncapped), aBudget);
  const tractionBonus = 1 + 0.15 * Math.max(0, car.balanceB);
  aDrive = Math.min(aDrive * tractionBonus, aBudget);

  const aBrakeApplied = Math.min(aBrakeAppliedUncapped, aBudget);
  let aLong = aDrive - aBrakeApplied - aCoast;

  // Load-transfer target
  const balanceTarget = Math.max(-1, Math.min(1, aLong / PHYSICS.loadTransferScale));
  const balanceTau = PHYSICS.loadTransferTau;
  car.balanceB += (balanceTarget - car.balanceB) * (1 - Math.exp(-dt / balanceTau));

  const aLongDemand = Math.max(aDriveUncapped, aBrakeAppliedUncapped);

  // Step 7: grip usage O
  const O = Math.sqrt(aLat * aLat + aLongDemand * aLongDemand) / Math.max(aGrip, 1e-6);
  car.gripUsage = O;

  let dl = 0;

  if (O <= 1) {
    const followRate = PHYSICS.lineFollowGain;
    const maxDl = Math.max(1.0, 0.15 * car.v);
    dl = Math.max(-maxDl, Math.min(maxDl, followRate * (car.lTarget - car.l)));
    car.slipAngle *= Math.exp(-PHYSICS.slipDecay * dt);
  } else if (throttle >= 0.6) {
    car.slipAngle += PHYSICS.oversteerRate * (O - 1) * dt;
  } else {
    const outward = outwardSign(node.kappa);
    const understeerMul = kUnder * (1 + 0.4 * Math.max(0, car.balanceB));
    dl += outward * understeerMul * (O - 1) * car.v * dt;
    aLong -= PHYSICS.understeerScrub * (O - 1) * PHYSICS.g;
  }

  // Trail-brake rotation (plan 4.1)
  if (brake > 0 && O > 0.9 && car.balanceB < -0.5) {
    car.slipAngle += PHYSICS.trailBrakeSlipRate * (O - 0.9) * dt;
  }

  // Lift-off oversteer
  if (car.prevThrottle - throttle > 0.5 && throttle < 0.2) {
    if (car.throttleDropTime < 0) car.throttleDropTime = ctx.raceTime;
    if (ctx.raceTime - car.throttleDropTime < 0.2 && car.balanceB < -0.3 && O > 0.85) {
      car.slipAngle += PHYSICS.liftOffImpulse;
    }
  } else {
    car.throttleDropTime = -1;
  }
  car.prevThrottle = throttle;

  // Step 8: drift state
  if (driftCfg.enabled && brake >= 0.5 && Math.abs(car.slipAngle) > driftCfg.initiate) {
    car.driftState = true;
  }

  if (car.driftState) {
    const slipTarget = driftCfg.target * Math.sign(car.slipAngle || 1);
    car.slipAngle += (slipTarget - car.slipAngle) * (1 - Math.exp(-6 * dt));
    if (O < 0.6) car.driftState = false;
    if (O > 1.3) {
      car.spinRemaining = PHYSICS.spinStun;
      car.stunRemaining = PHYSICS.spinStun;
      car.spinCount += 1;
      car.driftState = false;
    }
  }

  // Step 9: spin-out
  if (Math.abs(car.slipAngle) > PHYSICS.spinAngle && car.spinRemaining <= 0) {
    car.spinRemaining = PHYSICS.spinStun;
    car.stunRemaining = PHYSICS.spinStun;
    car.spinCount += 1;
    car.driftState = false;
  }

  // Step 10: integrate
  car.v = Math.max(0, car.v + aLong * dt);
  car.s = (car.s + car.v * dt) % track.length;
  if (car.s < 0) car.s += track.length;
  car.l += dl * dt;
  car.dl = dl;
  car.aLong = aLong;

  // Tyre temperature
  car.tyreTemp = Math.max(
    0,
    car.tyreTemp +
      (PHYSICS.tyreHeatSpeed * (car.v / Math.max(car.stats.vMax, 0.1)) +
        PHYSICS.tyreHeatOver * Math.max(0, O - 1) +
        (car.driftState ? PHYSICS.tyreHeatDrift : 0) -
        PHYSICS.tyreCool) *
        dt,
  );

  // Step 11: zones & walls
  if (zone.inRunoff) {
    car.v = Math.max(0, car.v - zone.dragDecel * dt);
  }

  const wallLimit = halfW + node.runoffWidth - PHYSICS.wallMargin;
  if (Math.abs(car.l) > wallLimit) {
    car.l = Math.sign(car.l) * wallLimit;
    if (car.v > PHYSICS.crashSpeed) {
      car.v *= PHYSICS.crashSpeedMult;
      car.stunRemaining = PHYSICS.crashStun;
      car.wallHits += 1;
      if (car.isPlayerControlled) {
        car.condition = Math.max(BALANCE.conditionMin, car.condition - BALANCE.wallCrashConditionLoss);
      }
    } else {
      car.v *= 1 - PHYSICS.scrapeSpeedMultPerSec * dt;
    }
  }

  updateCosmeticRpm(car, dt);
  assertFinite(car, ctx.debug === true);
}

/** Convenience: build update context with SDet from driver. */
export function buildVehicleContext(
  driver: Driver,
  position: number,
  totalCars: number,
  stats: EffectiveStats,
  modifierStack: readonly Modifier[],
  discipline: DisciplineId,
  muSurface: number,
  draft: number,
  rain: boolean,
  raceTime: number,
  debug?: boolean,
): VehicleUpdateContext {
  return {
    discipline,
    stats,
    modifierStack,
    muSurface,
    draft,
    sDet: computeSDet(driver.determination, position, totalCars),
    position,
    totalCars,
    rain,
    raceTime,
    debug,
  };
}

export function vDriverAt(vDriver: readonly number[], track: TrackData, s: number): number {
  return interpolateVDriver(vDriver, track, s);
}
