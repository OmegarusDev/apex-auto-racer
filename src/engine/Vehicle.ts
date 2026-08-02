import { BALANCE } from '../data/balance';
import { PHYSICS, DRIFT_CFG } from '../data/physics';
import type { DisciplineId } from '../data/disciplines';
import type { Driver, EffectiveStats, SlotMode, VehicleState } from './types';
import type { Modifier, ModifierContext } from './modifiers';
import { applyModifiers } from './modifiers';
import type { TrackData } from './TrackGenerator';
import { interpolateAtSInto, outwardSign, type InterpolatedNode } from './RacingLine';

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
  skill: number;
  bravery: number;
  focus: number;
}

export interface CarSimState extends VehicleState {
  stats: EffectiveStats;
  lTarget: number;
  /** Starting-grid lateral column — held briefly after GO so pack doesn't collapse to o(s). */
  gridL: number;
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
  vSafe: number[];
  authority: number;
  /** Live v_deslot cached for HUD / AI (updated each tick). */
  vDeslot: number;
}

export interface ZoneModifiers {
  gripMult: number;
  dragDecel: number;
  onKerb: boolean;
  inRunoff: boolean;
  atWall: boolean;
}

/** Match VectorRenderer kerb kappa gate so zones align with painted stripes. */
const KERB_KAPPA_THRESHOLD = 0.012;
const GEAR_COUNT = 5;
const RPM_IDLE = 900;
const RPM_MIN = 2500;
const RPM_MAX = 8000;

/** Tyre temperature grip multiplier (plan 4.1; cold floor from PHYSICS.tyreColdGrip). */
export function computeTempGrip(T: number): number {
  const cold = PHYSICS.tyreColdGrip;
  const hot = PHYSICS.tyreHotGrip;
  if (T <= 0.6) return cold + (1.0 - cold) * (T / 0.6);
  if (T <= 1.0) return 1.0;
  if (T >= 1.3) return hot;
  return 1.0 - ((1.0 - hot) * (T - 1.0)) / 0.3;
}

/**
 * Driver adhesion margin — Skill/Focus raise the peg limit; Bravery rides closer.
 * mDriver ∈ ~0.42 (rookie timid) … ~1.0 (elite brave+focused).
 */
export function computeDriverDeslotMargin(skill: number, focus: number, bravery = 50): number {
  const mSkill = PHYSICS.deslotSkillBase + PHYSICS.deslotSkillSpan * (skill / 100);
  const mFocus = PHYSICS.deslotFocusBase + PHYSICS.deslotFocusSpan * (focus / 100);
  const mBrave = PHYSICS.deslotBraveryBase + PHYSICS.deslotBraverySpan * (bravery / 100);
  return mSkill * mFocus * mBrave;
}

/**
 * Car-center lateral limit where the body edge meets the painted barrier
 * at |l| = W/2 + R (asphalt + runoff outer edge).
 */
export function wallLimitFor(width: number, runoffWidth: number): number {
  return width / 2 + runoffWidth - PHYSICS.wallMargin;
}

/** Painted barrier half-extent (visual outer edge). */
export function barrierHalfWidth(width: number, runoffWidth: number): number {
  return width / 2 + runoffWidth;
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
  const wallLimit = wallLimitFor(width, runoffWidth);

  if (absL > wallLimit) {
    return { gripMult: 1, dragDecel: 0, onKerb: false, inRunoff: false, atWall: true };
  }

  if (absL > halfW) {
    const drag = discipline === 'rally' ? PHYSICS.runoffDragRally : PHYSICS.runoffDrag;
    // Kerbs sit on the outer asphalt rim (matches VectorRenderer).
    const onKerb =
      Math.abs(kappa) >= KERB_KAPPA_THRESHOLD &&
      absL <= halfW + PHYSICS.kerbOuterM;
    return {
      gripMult: onKerb ? PHYSICS.kerbGrip : PHYSICS.runoffGrip,
      dragDecel: drag,
      onKerb,
      inRunoff: true,
      atWall: false,
    };
  }

  return {
    gripMult: 1,
    dragDecel: 0,
    onKerb: false,
    inRunoff: false,
    atWall: false,
  };
}

/** Determination catch-up scalar (plan 7.1). */
export function computeSDet(determination: number, position: number, totalCars: number): number {
  if (totalCars <= 1) return 1;
  return 1 + PHYSICS.detBonus * (determination / 100) * ((position - 1) / (totalCars - 1));
}

/** @deprecated Prefer computeBrakeAuthority / computeThrottleAuthority. */
export function computeAuthority(skill: number): number {
  return computeBrakeAuthority(skill);
}

/** Low Skill → stronger auto-brake; elites manage braking themselves. */
export function computeBrakeAuthority(skill: number): number {
  return Math.max(
    0.2,
    Math.min(1, PHYSICS.brakeAuthorityBase + PHYSICS.brakeAuthoritySpan * (skill / 100)),
  );
}

/** High Skill → stronger throttle trim toward AI when pin-throttling. */
export function computeThrottleAuthority(skill: number): number {
  return Math.max(
    0,
    Math.min(1, PHYSICS.throttleAuthorityBase + PHYSICS.throttleAuthoritySpan * (skill / 100)),
  );
}

function interpolateProfile(profile: readonly number[], track: TrackData, s: number): number {
  const n = profile.length;
  if (n === 0) return 0;
  let distS = s % track.length;
  if (distS < 0) distS += track.length;

  let i0 = 0;
  if (distS > track.nodes[0]!.s) {
    let lo = 0;
    let hi = n - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (track.nodes[mid]!.s <= distS) lo = mid;
      else hi = mid;
    }
    i0 = lo;
  }
  const i1 = (i0 + 1) % n;
  const s0 = track.nodes[i0]!.s;
  const s1 = i1 === 0 ? track.length : track.nodes[i1]!.s;
  const ds = s1 - s0;
  const t = ds > 1e-6 ? (distS - s0) / ds : 0;
  return profile[i0]! * (1 - t) + profile[i1]! * t;
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
  const fields: (keyof CarSimState)[] = [
    's',
    'l',
    'v',
    'slipAngle',
    'tyreTemp',
    'balanceB',
    'lTarget',
    'dl',
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
  // Prod: clamp/reset so a single bad frame cannot poison the race.
  if (!Number.isFinite(car.s)) car.s = 0;
  if (!Number.isFinite(car.l)) car.l = 0;
  if (!Number.isFinite(car.v) || car.v < 0) car.v = 0;
  if (!Number.isFinite(car.slipAngle)) car.slipAngle = 0;
  if (!Number.isFinite(car.tyreTemp)) car.tyreTemp = 0.5;
  if (!Number.isFinite(car.balanceB)) car.balanceB = 0;
  if (!Number.isFinite(car.lTarget)) car.lTarget = car.l;
  if (!Number.isFinite(car.dl)) car.dl = 0;
}

/** Live deslot speed at s — v_safe × driver × car (temp) margins. */
export function computeVDeslot(
  car: CarSimState,
  track: TrackData,
  skill: number,
  focus: number,
  tempGrip: number,
  bravery = 50,
): number {
  const vSafe = interpolateProfile(car.vSafe, track, car.s);
  const mDriver = computeDriverDeslotMargin(skill, focus, bravery);
  // v ∝ √μ — cold tyres / heat lower the slot limit
  const mCar = Math.sqrt(Math.max(0.5, tempGrip));
  return Math.max(1, vSafe * mDriver * mCar);
}

export function createCarState(
  id: string,
  driverId: string,
  teamId: number,
  isPlayerControlled: boolean,
  stats: EffectiveStats,
  vProfile: number[],
  vDriver: number[],
  vSafe: number[],
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
    slotMode: 'groove',
    deslotRemaining: 0,
    deslotImmunity: 0,
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
    deslotCount: 0,
    overtakeCount: 0,
    stats,
    lTarget: gridL,
    gridL,
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
    vSafe,
    authority,
    vDeslot: 0,
  };
}

function outwardDir(kappa: number, l: number): number {
  const outward = outwardSign(kappa);
  return outward === 0 ? (l >= 0 ? 1 : -1) : outward;
}

/**
 * Peg pops: leave the magnetic groove. Lateral washout comes from excess
 * centripetal demand integrated below — only a small overspeed-scaled impulse
 * seeds the release (lost constraint force), not a scripted eject.
 */
export function enterDeslot(car: CarSimState, kappa: number, vDeslot: number): void {
  car.slotMode = 'deslot';
  car.deslotRemaining = PHYSICS.deslotMinTime;
  car.deslotCount += 1;
  car.driftState = false;
  const dir = outwardDir(kappa, car.l);
  const over = Math.max(0, car.v / Math.max(vDeslot, 1) - 1);
  car.dl += dir * PHYSICS.deslotReleaseImpulse * Math.min(1.5, over);
  car.slipAngle = Math.max(
    -PHYSICS.deslotSlipMax,
    Math.min(PHYSICS.deslotSlipMax, car.slipAngle + dir * 0.1),
  );
}

/** Side/rear contact can yank a car out of the groove (deterministic). */
export function contactDeslot(car: CarSimState, lateralPush: number, severity: number): void {
  if (car.slotMode !== 'groove' || car.deslotImmunity > 0) return;
  if (severity < 0.45) return;
  car.slotMode = 'deslot';
  car.deslotRemaining = PHYSICS.deslotMinTime * (0.7 + 0.5 * severity);
  car.deslotCount += 1;
  car.driftState = false;
  car.dl += lateralPush * (2.2 + 3.5 * severity);
  car.slipAngle = Math.max(
    -PHYSICS.deslotSlipMax,
    Math.min(PHYSICS.deslotSlipMax, car.slipAngle + Math.sign(lateralPush || 1) * 0.12 * severity),
  );
}

function tryRejoinGroove(
  car: CarSimState,
  lineOffset: number,
  vDeslot: number,
): void {
  if (car.deslotRemaining > 0) return;
  if (Math.abs(car.l - lineOffset) > PHYSICS.deslotRejoinL) return;
  if (car.v > vDeslot * PHYSICS.deslotRejoinVFrac) return;
  // Still washing out hard — magnet can't grab yet.
  if (Math.abs(car.dl) > 4.5) return;
  car.slotMode = 'groove';
  car.slipAngle = 0;
  car.dl = 0;
  car.deslotImmunity = PHYSICS.deslotRejoinImmunity;
  // Fresh brain commit on rejoin — avoid replaying queued scrub/brake.
  car.easedThrottle = Math.max(car.easedThrottle, 0.2);
}

/**
 * Free (deslotted) lateral accel in track frame:
 * adhesion limit → excess v²|κ| runs you wide; spare grip steers toward o(s).
 */
function computeDeslotLateralAccel(
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
    // Spare adhesion steers back toward o(s) — needs rolling speed (tires, not magic).
    const roll = Math.min(1, car.v / 8);
    const spare = Math.max(0, aLatCap - aReq) * PHYSICS.deslotSteerFrac * roll;
    const err = lineOffset - car.l;
    const steer = err * PHYSICS.deslotSteerGain;
    aL = Math.max(-spare, Math.min(spare, steer));
  }

  aL -= car.dl * PHYSICS.deslotLatDamp;
  return aL;
}

/**
 * Per-tick vehicle update — Scalextric groove/deslot lateral layer
 * with retained longitudinal friction-circle physics.
 */
export function updateVehicle(
  car: CarSimState,
  track: TrackData,
  dt: number,
  inputs: VehicleInputs,
  brainOut: BrainOutput,
  ctx: VehicleUpdateContext,
): void {
  // Soft wall recovery: bleed speed / cut drive — do NOT freeze lateral or early-out.
  const recovering = car.stunRemaining > 0;
  if (recovering) {
    car.stunRemaining = Math.max(0, car.stunRemaining - dt);
  }

  if (car.spinRemaining > 0) {
    car.spinRemaining = Math.max(0, car.spinRemaining - dt);
    car.v = Math.max(0, car.v * (1 - dt / PHYSICS.spinDecelTime));
    // Keep washing / scraping — no teleport back to the groove.
    car.dl *= Math.exp(-2.5 * dt);
    if (car.spinRemaining <= 0) {
      car.slipAngle = 0;
      car.slotMode = 'deslot';
      car.deslotRemaining = Math.max(car.deslotRemaining, PHYSICS.deslotMinTime * 0.5);
    }
    assertFinite(car, ctx.debug === true);
    return;
  }

  // Step 1: lookup node at s
  const node = interpolateAtSInto(track.nodes, track.length, car.s, nodeScratch);
  const halfW = node.width / 2;
  const lineClamp = halfW - PHYSICS.racingLineMargin;
  const kappaUse = node.kappaLine;
  const curved = Math.abs(kappaUse) >= PHYSICS.grooveKappaMin;

  // Step 3: input blend (player authority vs brain)
  car.easedThrottle = easePedal(car.easedThrottle, inputs.throttle, dt);
  car.easedBrake = easePedal(car.easedBrake, inputs.brake, dt);

  let throttle: number;
  let brake: number;

  let pinOverrule = false;
  if (car.isPlayerControlled) {
    const pT = car.easedThrottle;
    const pB = car.easedBrake;
    // Split Authority: rookies get brake assist; elites get throttle trim.
    // Pin-throttle overrule nearly kills the brake nanny — washouts must hurt.
    const brakeAuth = computeBrakeAuthority(ctx.skill);
    const throttleAuth = computeThrottleAuthority(ctx.skill);
    pinOverrule = pT > 0.85 && pB < 0.08;
    // Pin-throttle: almost no brake nanny. Low Skill keeps low throttle trim so
    // washouts happen; pace loss comes from deslot/wall, not a soft lift.
    const brakeBlend = pinOverrule ? brakeAuth * 0.015 : brakeAuth;
    const trim = pinOverrule ? throttleAuth * 0.25 : throttleAuth;
    throttle = pT - trim * Math.max(0, pT - brainOut.desiredThrottle);
    brake = Math.max(pB, brakeBlend * brainOut.desiredBrake);
  } else {
    throttle = brainOut.desiredThrottle;
    brake = brainOut.desiredBrake;
  }

  if (recovering) {
    throttle *= 0.15;
    brake = Math.max(brake, 0.35);
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
  let tempGrip = mods.tempGrip ?? computeTempGrip(car.tyreTemp);
  // Low-tier / damaged cars: colder adhesion window — pin-throttle hurts more early.
  if (car.tyreTemp < 0.5) {
    const tierCold = Math.max(0, 1.02 - gripFactor * condGrip) * 0.08;
    tempGrip = Math.max(0.82, tempGrip - tierCold * (1 - car.tyreTemp / 0.5));
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

  // Step 4: longitudinal
  const vMaxEff = car.stats.vMax * condTop * (1 + PHYSICS.draftSpeedBonus * draft);
  const sDet = ctx.sDet;
  const aDriveUncapped =
    throttle * car.stats.aAccel * sDet * (1 + PHYSICS.draftAccelBonus * draft) *
    (1 - (car.v / Math.max(vMaxEff, 0.1)) ** 2);
  const aCoast = (1 - throttle) * (PHYSICS.coastBase + PHYSICS.coastVel * car.v);
  const aBrakeAppliedUncapped = brake * car.stats.aBrake;

  // Step 5: grip & demand
  // Pin-throttle commitment: low-Skill cars lose adhesion margin (no nanny grip).
  const pinGrip =
    pinOverrule && car.isPlayerControlled
      ? 0.76 + 0.16 * Math.min(1, ctx.skill / 75)
      : 1;
  const muEff =
    muSurface * gripFactor * condGrip * tempGrip * pinGrip *
    (1 + car.stats.D * (car.v / Math.max(car.stats.vMax, 0.1)) ** 2) *
    zone.gripMult * (car.driftState ? driftCfg.muMult : 1);

  let aGrip = muEff * PHYSICS.g;
  if (car.balanceB < 0) {
    aGrip *= 1 + 0.06 * Math.max(0, -car.balanceB);
  }
  const kappaEff = kappaUse / Math.max(0.5, Math.min(1.5, 1 - car.l * kappaUse));
  const aLat = car.v * car.v * Math.abs(kappaEff);

  // Step 6: friction circle (longitudinal budget)
  const aLatClamped = Math.min(aLat, aGrip);
  const aBudget = Math.sqrt(Math.max(0, aGrip * aGrip - aLatClamped * aLatClamped));

  let aDrive = Math.min(Math.max(0, aDriveUncapped), aBudget);
  const tractionBonus = 1 + 0.15 * Math.max(0, car.balanceB);
  aDrive = Math.min(aDrive * tractionBonus, aBudget);

  const aBrakeApplied = Math.min(aBrakeAppliedUncapped, aBudget);
  let aLong = aDrive - aBrakeApplied - aCoast;
  if (recovering) {
    aLong -= PHYSICS.crashRecoveryDecel;
  }

  const balanceTarget = Math.max(-1, Math.min(1, aLong / PHYSICS.loadTransferScale));
  const balanceTau = PHYSICS.loadTransferTau;
  car.balanceB += (balanceTarget - car.balanceB) * (1 - Math.exp(-dt / balanceTau));

  const aLongDemand = Math.max(aDriveUncapped, aBrakeAppliedUncapped);
  const O = Math.sqrt(aLat * aLat + aLongDemand * aLongDemand) / Math.max(aGrip, 1e-6);
  car.gripUsage = O;

  const vDeslot =
    computeVDeslot(car, track, ctx.skill, ctx.focus, tempGrip, ctx.bravery) *
    (pinOverrule && car.isPlayerControlled ? pinGrip : 1);
  car.vDeslot = vDeslot;
  if (car.deslotImmunity > 0) {
    car.deslotImmunity = Math.max(0, car.deslotImmunity - dt);
  }
  const lineOffset = node.o;
  let mode: SlotMode = car.slotMode;

  // Lateral tire capacity left after longitudinal use (deslot washout).
  const aLongUsed = Math.abs(aDrive - aBrakeApplied);
  const aLatCap = Math.sqrt(Math.max(0, aGrip * aGrip - aLongUsed * aLongUsed));

  // Step 7: groove / deslot lateral layer
  if (mode === 'groove') {
    // Magnetic hold to brain line target (≈ o(s) ± small wobble / overtake)
    const follow = PHYSICS.grooveFollowGain;
    const maxDl = Math.max(2.5, 0.35 * car.v);
    car.dl = Math.max(-maxDl, Math.min(maxDl, follow * (car.lTarget - car.l)));
    car.slipAngle *= Math.exp(-PHYSICS.slipDecay * dt);

    // Slot peg limit: overspeed in curvature pops the groove.
    // O alone must not deslot at safe corner speeds (longitudinal spikes).
    const overspeed = car.v > vDeslot;
    const gripBreak =
      car.v > vDeslot * PHYSICS.oDeslotSpeedFrac && O > PHYSICS.oDeslot;
    if (curved && car.deslotImmunity <= 0 && (overspeed || gripBreak)) {
      enterDeslot(car, kappaUse, vDeslot);
      // Pinning through the peg: longer scrub so held-Go cannot soft-recover into a win.
      if (pinOverrule) {
        car.deslotRemaining = Math.max(
          car.deslotRemaining,
          PHYSICS.deslotMinTime * (1.55 - 0.35 * Math.min(1, ctx.skill / 80)),
        );
      }
      mode = 'deslot';
    }
  }

  if (mode === 'deslot') {
    car.deslotRemaining = Math.max(0, car.deslotRemaining - dt);
    const dir = outwardDir(kappaUse, car.l);

    // Excess centripetal demand → outward accel; spare grip steers to o(s).
    const aL = computeDeslotLateralAccel(car, kappaEff, aLatCap, lineOffset);
    car.dl += aL * dt;

    // Sliding scrub scales with how far past adhesion you are — not a flat g cheat.
    const excess = Math.max(0, aLat - aLatCap);
    const scrub = Math.min(PHYSICS.deslotScrubMaxG * PHYSICS.g, PHYSICS.deslotScrubGain * excess);
    aLong -= scrub;

    // Cosmetic yaw tracks washout; does not drive the failure.
    const slipTarget = dir * PHYSICS.deslotSlipMax * Math.min(1, 0.35 + excess / Math.max(aGrip, 1));
    car.slipAngle += (slipTarget - car.slipAngle) * (1 - Math.exp(-4 * dt));
    car.slipAngle = Math.max(
      -PHYSICS.deslotSlipMax,
      Math.min(PHYSICS.deslotSlipMax, car.slipAngle),
    );

    tryRejoinGroove(car, lineOffset, vDeslot);
    mode = car.slotMode;
  }

  // Drift kept dormant (DRIFT_CFG.enabled false for Scalextric base loop)
  if (driftCfg.enabled && brake >= 0.5 && Math.abs(car.slipAngle) > driftCfg.initiate) {
    car.driftState = true;
  }
  if (car.driftState) {
    const slipTarget = driftCfg.target * Math.sign(car.slipAngle || 1);
    car.slipAngle += (slipTarget - car.slipAngle) * (1 - Math.exp(-6 * dt));
    if (O < 0.6) car.driftState = false;
  }

  car.prevThrottle = throttle;

  // Step 10: integrate
  car.v = Math.max(0, car.v + aLong * dt);
  car.s = (car.s + car.v * dt) % track.length;
  if (car.s < 0) car.s += track.length;
  car.l += car.dl * dt;
  car.aLong = aLong;

  // Tyre temperature
  car.tyreTemp = Math.max(
    0,
    car.tyreTemp +
      (PHYSICS.tyreHeatSpeed * (car.v / Math.max(car.stats.vMax, 0.1)) +
        PHYSICS.tyreHeatOver * Math.max(0, O - 1) +
        (car.driftState ? PHYSICS.tyreHeatDrift : 0) +
        (car.slotMode === 'deslot' ? PHYSICS.tyreHeatOver * 0.5 : 0) -
        PHYSICS.tyreCool) *
        dt,
  );

  // Step 11: zones & walls (re-evaluate after lateral integrate)
  zone = computeZoneModifiers(
    Math.abs(car.l),
    node.width,
    node.runoffWidth,
    node.kappa,
    ctx.discipline,
  );
  if (zone.inRunoff) {
    car.v = Math.max(0, car.v - zone.dragDecel * dt);
    // Low-μ runoff bleeds lateral speed gently — still carry into the wall if hot.
    car.dl *= Math.exp(-0.55 * dt);
  }

  const wallLimit = wallLimitFor(node.width, node.runoffWidth);
  if (Math.abs(car.l) > wallLimit) {
    const into = Math.sign(car.l) || 1;
    car.l = into * wallLimit;
    const impactLat = Math.max(0, car.dl * into);
    // Kill / lightly reflect the into-wall component — continuous contact, not a snap stun.
    if (impactLat > 0) {
      car.dl = -impactLat * PHYSICS.wallRestitution;
    }

    // Impact energy from long speed into barrier + lateral slam.
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
      // Inelastic smash: retain little speed at high severity; scrub scales with energy.
      car.v = Math.max(
        0,
        car.v * (1 - (1 - PHYSICS.crashSpeedMult) * severity) -
          PHYSICS.wallImpactScrub * severity * dt * 8,
      );
      // Focus recovers cleaner (shorter stun); Bravery accepts a harder hit for pace.
      const stunScale = 1.12 - 0.28 * (ctx.focus / 100) + 0.1 * (ctx.bravery / 100);
      car.stunRemaining = Math.max(
        car.stunRemaining,
        PHYSICS.crashStun * severity * stunScale,
      );
      car.wallHits += 1;
      if (car.isPlayerControlled) {
        car.condition = Math.max(
          BALANCE.conditionMin,
          car.condition - BALANCE.wallCrashConditionLoss * severity,
        );
      }
      // Rare tumble: high-speed wall smash while already deslotted
      if (
        car.slotMode === 'deslot' &&
        impactSpeed > PHYSICS.spinWallSpeed &&
        impactLat > 5 &&
        car.spinRemaining <= 0
      ) {
        car.spinRemaining = PHYSICS.spinStun;
        car.stunRemaining = Math.max(car.stunRemaining, PHYSICS.spinStun);
        car.spinCount += 1;
        car.driftState = false;
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
    skill: driver.skill,
    bravery: driver.bravery,
    focus: driver.focus,
  };
}

export function vDriverAt(vDriver: readonly number[], track: TrackData, s: number): number {
  return interpolateProfile(vDriver, track, s);
}

export function vSafeAt(vSafe: readonly number[], track: TrackData, s: number): number {
  return interpolateProfile(vSafe, track, s);
}
