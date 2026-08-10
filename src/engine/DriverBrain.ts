import { BALANCE } from '../data/balance';
import { PHYSICS } from '../data/physics';
import type { DisciplineId } from '../data/disciplines';
import type { Driver, SlotMode } from './types';
import type { Modifier, ModifierContext } from './modifiers';
import { applyModifierParam } from './modifiers';
import type { TrackData } from './TrackGenerator';
import { interpolateAtSInto, type InterpolatedNode } from './RacingLine';
import type { CarSimState } from './Vehicle';
import type { BrainOutput } from './Vehicle';
import { computeTempGrip, computeVDeslot, personalLineAt, vDriverAt } from './Vehicle';
import { makeIntent, type BrainIntent, type BrainIntentTag } from './BrainIntent';
import type { Rng } from './rng';
import { randRange } from './rng';

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

export interface RivalSnapshot {
  /** Arc distance to rival minus car length (positive = ahead with clearance). */
  arcGap: number;
  lateralSep: number;
  speed: number;
  s: number;
  l: number;
  /** Deslotted / spinning cars still occupy space. */
  deslotted: boolean;
}

export interface BrainTickContext {
  track: TrackData;
  driver: Driver;
  discipline: DisciplineId;
  modifierStack: readonly Modifier[];
  rivals: readonly RivalSnapshot[];
  draft: number;
  rain: boolean;
  raceTime: number;
  isFinalLap: boolean;
  isLeading: boolean;
  leadingMarginSec: number;
  position: number;
  totalCars: number;
  rng: Rng;
  /** True when contact blocking applies (plan 7.4). */
  contactBlocked: boolean;
}

export interface BrainState {
  reactionQueue: { emitTime: number; out: BrainOutput }[];
  suppressBrakeUntil: number;
  mistakeLShift: number;
  mistakeLUntil: number;
  overtakeSide: number;
  overtakeUntil: number;
  draftHoldTime: number;
  /** Seconds stuck same-lane blocked without a pull-out (anti park-forever). */
  blockStallTime: number;
  /** Race-time until which brain returns raw (post-deslot / post-spin recovery). */
  recoveryUntil: number;
  /** Previous slot mode — detect rejoin edges for recovery grace. */
  prevSlotMode: SlotMode | '';
}

const EMPTY_OUTPUT: BrainOutput = { desiredThrottle: 0, desiredBrake: 0, lTarget: 0 };

/** Brain ticks at 120/brainEveryN Hz — stall accumulator step. */
const BRAIN_DT = PHYSICS.dt * PHYSICS.brainEveryN;
/** After this many seconds parked behind a wreck, force a side. */
const BLOCK_FORCE_SEC = 0.85;
/** Creep throttle while committing a forced wreck pass. */
const BLOCK_CREEP_THROTTLE = 0.2;
/** Park-forever stall speed threshold (m/s). */
const BLOCK_STALL_V = 8;

export function createBrainState(): BrainState {
  return {
    reactionQueue: [],
    suppressBrakeUntil: 0,
    mistakeLShift: 0,
    mistakeLUntil: 0,
    overtakeSide: 0,
    overtakeUntil: 0,
    draftHoldTime: 0,
    blockStallTime: 0,
    recoveryUntil: 0,
    prevSlotMode: '',
  };
}

/** kBrake perception multiplier — low Skill brakes earlier; Bravery delays. */
export function computeKBrake(driver: Driver, modifierStack: readonly Modifier[], ctx: ModifierContext): number {
  // Novice: early/safe. Elite + brave: later, closer to the peg. Wide span.
  let k =
    2.05 -
    1.05 * (driver.skill / 100) -
    0.32 * (driver.bravery / 100) +
    0.22 * (1 - driver.focus / 100);
  k = Math.max(0.8, Math.min(2.25, k));
  k = applyModifierParam(k, 'kBrake', modifierStack, ctx);
  return k;
}

function nodeDs(track: TrackData, idx: number): number {
  const n = track.nodes.length;
  const ip = (idx + 1) % n;
  if (ip === 0) return track.length - track.nodes[idx]!.s;
  return track.nodes[ip]!.s - track.nodes[idx]!.s;
}

function findStartNodeIndex(track: TrackData, s: number): number {
  let idx = 0;
  for (let i = 0; i < track.nodes.length; i++) {
    if (track.nodes[i]!.s <= s) idx = i;
  }
  return idx;
}

/**
 * Max required decel over horizon against the driver's speed target
 * (vDriver already embeds Skill/Bravery confidence under v_deslot).
 */
function computeRequiredDecel(
  car: CarSimState,
  track: TrackData,
  kBrake: number,
  tempGrip: number,
): number {
  const horizon = Math.max(car.v * PHYSICS.horizonSec, PHYSICS.sampleDs * 2);
  const gripScale = Math.sqrt(Math.max(0.75, tempGrip));
  let accDist = 0;
  let maxReq = 0;
  let idx = findStartNodeIndex(track, car.s);
  const n = track.nodes.length;
  let steps = 0;

  while (accDist < horizon && steps < n * 3) {
    const ds = nodeDs(track, idx);
    const nodeS = track.nodes[idx]!.s;
    const vTarget = vDriverAt(car.vDriver, track, nodeS) * gripScale;
    const req = (car.v * car.v - vTarget * vTarget) / (2 * Math.max(ds, 1e-3));
    if (req > maxReq) maxReq = req;
    accDist += ds;
    idx = (idx + 1) % n;
    steps += 1;
  }

  return kBrake * Math.max(0, maxReq);
}

function computeDesiredBrake(req: number, aBrake: number, suppress: boolean): number {
  if (suppress) return 0;
  if (req >= 0.9 * aBrake) return 1;
  if (req >= 0.35) return req / aBrake;
  return 0;
}

/**
 * Scalextric throttle: full send when not braking for a corner.
 * No anti-spin feathering — speed vs v_deslot is the whole game.
 */
function computeDesiredThrottle(
  car: CarSimState,
  track: TrackData,
  braking: boolean,
  driver: Driver,
  raceTime: number,
  tempGrip: number,
): number {
  if (braking) return 0;
  if (car.slotMode === 'deslot') return 0;

  const gripScale = Math.sqrt(Math.max(0.75, tempGrip));
  const vTarget = vDriverAt(car.vDriver, track, car.s) * gripScale;
  // Never treat a standing start as "no target" — weak profiles still launch.
  if (vTarget <= 0.1 && car.v > 2) return 0;

  // Mild launch cap so the pack doesn't pin through cold T1
  if (raceTime < PHYSICS.aiLaunchSec) {
    const launchCap =
      0.55 + 0.35 * (driver.skill / 100) + 0.15 * (raceTime / PHYSICS.aiLaunchSec);
    const node = interpolateAtSInto(track.nodes, track.length, car.s, nodeScratch);
    if (Math.abs(node.kappaLine) >= PHYSICS.grooveKappaMin) {
      return Math.min(1, Math.max(PHYSICS.aiLaunchMinThrottle * 0.85, launchCap));
    }
    return 1;
  }

  // Coast slightly if already above target (apex / exit timing)
  if (car.v > vTarget * 1.03) return 0.12;
  if (car.v > vTarget * 0.98) return 0.5 + 0.35 * (driver.bravery / 100);

  // Full throttle on straights and when under the target
  return 1;
}

/**
 * Blend grid column → personal racing line after GO.
 * Stay on the grid stub until the car is actually rolling — otherwise the brain
 * asks for a lateral target while v≈0 and (historically) the peg shoved sideways.
 */
function gridAwareLineTarget(
  car: CarSimState,
  lineTarget: number,
  raceTime: number,
  _kappaLine: number,
): number {
  const hold = PHYSICS.gridHoldSec;
  // Parked / crawling off the lights: hold the starting column.
  if (car.v < PHYSICS.grooveLatMinV * 1.5) return car.gridL;
  if (raceTime >= hold) return lineTarget;
  const pureEnd = hold * PHYSICS.gridHoldPureFrac;
  if (raceTime <= pureEnd) return car.gridL;
  const blend = (raceTime - pureEnd) / Math.max(1e-3, hold - pureEnd);
  const t = blend * blend * (3 - 2 * blend);
  return car.gridL * (1 - t) + lineTarget * t;
}

function rivalWithinBehind(rivals: readonly RivalSnapshot[], distance: number): boolean {
  for (const r of rivals) {
    if (r.arcGap < 0 && Math.abs(r.arcGap) <= distance) return true;
  }
  return false;
}

function rivalWithinAny(rivals: readonly RivalSnapshot[], distance: number): boolean {
  for (const r of rivals) {
    if (Math.abs(r.arcGap) <= distance) return true;
  }
  return false;
}

function pickOvertakeSide(
  car: CarSimState,
  track: TrackData,
  rivals: readonly RivalSnapshot[],
  force = false,
): number {
  const node = interpolateAtSInto(track.nodes, track.length, car.s, nodeScratch);
  const lineClamp = node.width / 2 - PHYSICS.racingLineMargin;
  let roomLeft = car.l + lineClamp;
  let roomRight = lineClamp - car.l;
  const laneHalf = PHYSICS.carWidth * 0.45;

  for (const r of rivals) {
    // Nearby longitudinally (ahead or overlapping) blocks a side.
    if (r.arcGap < -PHYSICS.carLength * 0.25 || r.arcGap > BALANCE.contactGap * 1.5) continue;
    const lat = r.lateralSep;
    if (lat < -laneHalf) roomLeft -= PHYSICS.carWidth;
    if (lat > laneHalf) roomRight -= PHYSICS.carWidth;
    if (Math.abs(lat) <= laneHalf) {
      roomLeft -= PHYSICS.carWidth * 0.5;
      roomRight -= PHYSICS.carWidth * 0.5;
    }
  }

  // Need a clear car-width corridor; wide asphalt usually has room on both sides.
  const need = Math.min(PHYSICS.carWidth * 0.95, BALANCE.overtakeLateralShift * 0.7);
  if (roomLeft < need && roomRight < need) {
    if (!force) return 0;
    if (roomLeft <= 0 && roomRight <= 0) return car.l >= 0 ? -1 : 1;
    return roomLeft >= roomRight ? -1 : 1;
  }
  if (roomLeft >= roomRight) return -1;
  return 1;
}

/**
 * Brake/lift for the car ahead in the same lane. Uses bumper gap + closing speed;
 * deslotted cars still count as solid obstacles. Low Skill leaves a bigger cushion.
 */
function computeTrafficBrake(
  car: CarSimState,
  rivals: readonly RivalSnapshot[],
  aBrake: number,
  skill: number,
): { brake: number; blocked: boolean; closeAhead: boolean } {
  let brake = 0;
  let blocked = false;
  let closeAhead = false;
  /** Strict same-lane — cars with clear lateral room must not trigger accordion brake. */
  const laneWidth = PHYSICS.carWidth * 0.62;
  const skillGap = 1 + BALANCE.followSkillGapSpan * (1 - skill / 100);
  const targetGap = Math.max(BALANCE.followMinGap, car.v * BALANCE.followTimeGap) * skillGap;

  for (const r of rivals) {
    // Ahead if center is in front (arcGap > -carLength).
    const centerGap = r.arcGap + PHYSICS.carLength;
    if (centerGap <= 0) continue;
    if (Math.abs(r.lateralSep) >= laneWidth) continue;

    const gap = r.arcGap;
    const closing = car.v - r.speed;
    closeAhead = closeAhead || gap < targetGap * 1.45;

    if (gap <= 0.1) {
      blocked = true;
      brake = 1;
      continue;
    }

    // Closing-speed decel onto the bumper gap.
    let need = 0;
    if (closing > 0.75) {
      need = (closing * closing) / (2 * Math.max(gap, 0.35));
    }
    if (gap < targetGap) {
      need = Math.max(need, (targetGap - gap) / Math.max(targetGap, 1) * aBrake);
    }
    // Give deslotted wrecks a wider berth.
    if (r.deslotted && gap < targetGap * 1.4) {
      need = Math.max(need, 0.55 * aBrake);
    }

    if (need > 0) {
      brake = Math.max(brake, Math.min(1, need / Math.max(aBrake, 0.1)));
    }
  }

  return { brake, blocked, closeAhead };
}

type MistakeKind = 'lateBrake' | 'wobble' | null;

function rollMistake(
  state: BrainState,
  driver: Driver,
  ctx: BrainTickContext,
  modifierStack: readonly Modifier[],
  modCtx: ModifierContext,
  rng: Rng,
): MistakeKind {
  let rate = ((100 - driver.focus) / 100) * PHYSICS.mistakeBasePerSec;
  rate = applyModifierParam(rate, 'mistakeRate', modifierStack, modCtx);

  if (driver.trait === 'iceCold' && (ctx.isFinalLap || rivalWithinAny(ctx.rivals, 10))) {
    rate *= 0.5;
  }
  if (driver.trait === 'showboat' && ctx.isLeading && ctx.leadingMarginSec > 3) {
    rate *= 1.5;
  }
  if (ctx.rain) rate *= BALANCE.rainMistakeMult;

  const pTick = rate / 30;
  if (rng() >= pTick) return null;

  if (rng() < 0.5) {
    state.suppressBrakeUntil = ctx.raceTime + PHYSICS.mistakeBrakeSuppress;
    return 'lateBrake';
  }
  state.mistakeLShift = (rng() < 0.5 ? -1 : 1) * PHYSICS.mistakeLateralShift;
  state.mistakeLUntil = ctx.raceTime + PHYSICS.mistakeLateralDuration;
  return 'wobble';
}

function applyTraitKBrake(
  driver: Driver,
  rivals: readonly RivalSnapshot[],
  kBrake: number,
): { kBrake: number; hotheadLate: boolean } {
  if (driver.trait === 'hothead' && rivalWithinBehind(rivals, 12)) {
    return { kBrake: kBrake - 0.1, hotheadLate: true };
  }
  return { kBrake, hotheadLate: false };
}

function attachIntent(out: BrainOutput, intent: BrainIntent): BrainOutput {
  return { ...out, intent };
}

function resolvePrimaryIntent(args: {
  spinning: boolean;
  deslotted: boolean;
  unstick: boolean;
  pullingOut: boolean;
  wreckAhead: boolean;
  contactBlocked: boolean;
  draftHold: boolean;
  cornerBrake: boolean;
  trafficLift: boolean;
  launching: boolean;
  launchWindow: boolean;
  recovering: boolean;
}): BrainIntentTag {
  if (args.spinning) return 'SPIN_SCRUB';
  if (args.deslotted) return 'REJOIN_CRAWL';
  if (args.unstick) return 'UNSTICK_SIDE';
  if (args.pullingOut) return 'PULL_OUT';
  if (args.wreckAhead) return 'AVOID_WRECK';
  if (args.contactBlocked) return 'CONTACT_BLOCKED';
  if (args.draftHold) return 'DRAFT_HOLD';
  if (args.cornerBrake) return 'BRAKE_FOR_CORNER';
  if (args.trafficLift) return 'TRAFFIC_LIFT';
  if (args.recovering) return 'RECOVERY_GRACE';
  if (args.launching) return 'HOLD_GRID';
  if (args.launchWindow) return 'LAUNCH_CLEAR';
  return 'FULL_SEND';
}

function applyTraitIntentOverlay(
  primary: BrainIntentTag,
  opts: {
    mistakeKind: MistakeKind;
    hotheadLate: boolean;
    iceColdCalm: boolean;
    showboatRisk: boolean;
    cornerBrake: boolean;
  },
): BrainIntentTag {
  if (primary === 'SPIN_SCRUB' || primary === 'REJOIN_CRAWL') return primary;

  if (opts.mistakeKind === 'lateBrake') return 'MISTAKE_LATE_BRAKE';
  if (opts.mistakeKind === 'wobble') return 'MISTAKE_WOBBLE';

  if (opts.hotheadLate && (primary === 'BRAKE_FOR_CORNER' || opts.cornerBrake)) {
    return 'HOTHEAD_LATE';
  }
  if (
    opts.iceColdCalm &&
    (primary === 'FULL_SEND' || primary === 'BRAKE_FOR_CORNER' || primary === 'HOLD_GRID')
  ) {
    return 'ICE_COLD_CALM';
  }
  if (
    opts.showboatRisk &&
    (primary === 'FULL_SEND' || primary === 'BRAKE_FOR_CORNER' || primary === 'LAUNCH_CLEAR')
  ) {
    return 'SHOWBOAT_RISK';
  }
  return primary;
}

function drainReactionQueue(state: BrainState, raceTime: number, tau: number): BrainOutput {
  const cutoff = raceTime - tau;
  let best: BrainOutput | null = null;
  let bestTime = -Infinity;

  for (const item of state.reactionQueue) {
    if (item.emitTime <= cutoff && item.emitTime > bestTime) {
      bestTime = item.emitTime;
      best = item.out;
    }
  }

  while (state.reactionQueue.length > 0 && state.reactionQueue[0]!.emitTime < cutoff - 2) {
    state.reactionQueue.shift();
  }

  return best ?? EMPTY_OUTPUT;
}

/**
 * Scalextric driver brain (30 Hz):
 * 1. Brake to stay under v_deslot / vDriver
 * 2. Full throttle on straights
 * 3. If deslotted: scrub, rejoin, continue
 */
export function tickDriverBrain(
  state: BrainState,
  car: CarSimState,
  ctx: BrainTickContext,
): BrainOutput {
  const modCtx: ModifierContext = {
    time: ctx.raceTime,
    rain: ctx.rain,
    isLeading: ctx.isLeading,
  };

  interpolateAtSInto(ctx.track.nodes, ctx.track.length, car.s, nodeScratch);
  // Snapshot — nested helpers may reuse nodeScratch.
  const nodeKappa = nodeScratch.kappaLine;
  const nodeWidth = nodeScratch.width;
  const halfW = nodeWidth / 2;
  const lineClamp = halfW - PHYSICS.racingLineMargin;
  const personalO = personalLineAt(car, ctx.track, car.s);
  const tempGrip = computeTempGrip(car.tyreTemp);

  // Rejoin edge: grant a short undelayed window so EMPTY_OUTPUT cannot stall recovery.
  if (
    state.prevSlotMode === 'deslot' &&
    car.slotMode === 'groove' &&
    car.spinRemaining <= 0
  ) {
    state.recoveryUntil = Math.max(
      state.recoveryUntil,
      ctx.raceTime + PHYSICS.recoveryBrainSec,
    );
  }
  if (car.spinRemaining > 0) {
    state.recoveryUntil = Math.max(
      state.recoveryUntil,
      ctx.raceTime + PHYSICS.recoveryBrainSec,
    );
  }
  state.prevSlotMode = car.spinRemaining > 0 ? 'deslot' : car.slotMode;

  // Off-slot: scrub, rejoin, continue. Return raw — delayed deslot brake was
  // leaving cars at v≈0 with throttle 0 after rejoin (false "start stalls").
  if (car.slotMode === 'deslot' || car.spinRemaining > 0) {
    const spinning = car.spinRemaining > 0;
    const ai = !car.isPlayerControlled;
    const farFromLine = Math.abs(car.l - personalO) > PHYSICS.deslotRejoinL * 0.55;
    const crawling = car.v < 8 && !spinning;
    // AI stranded off-line at low speed: keep a crawl so they can steer home.
    // Player Authority assist stays crawl-only (pin-throttle must still hurt).
    let desiredThrottle = 0;
    let desiredBrake = spinning ? 0.85 : crawling ? 0.05 : 0.35;
    if (spinning) {
      desiredThrottle = 0.05;
    } else if (ai && (crawling || farFromLine)) {
      desiredThrottle = 0.42 + 0.28 * (ctx.driver.skill / 100);
      desiredBrake = 0.05;
    } else if (crawling) {
      desiredThrottle = 0.4 + 0.25 * (ctx.driver.skill / 100);
    }
    const intent = makeIntent(spinning ? 'SPIN_SCRUB' : 'REJOIN_CRAWL');
    const raw: BrainOutput = {
      desiredThrottle,
      desiredBrake,
      lTarget: Math.max(-lineClamp, Math.min(lineClamp, personalO)),
      intent,
    };
    state.reactionQueue.length = 0;
    state.reactionQueue.push({ emitTime: ctx.raceTime, out: raw });
    state.recoveryUntil = Math.max(
      state.recoveryUntil,
      ctx.raceTime + PHYSICS.recoveryBrainSec,
    );
    return raw;
  }

  const launching = ctx.raceTime < PHYSICS.gridHoldSec;
  const launchWindow = ctx.raceTime < PHYSICS.aiLaunchSec;

  let kBrake = computeKBrake(ctx.driver, ctx.modifierStack, modCtx);
  const traitBrake = applyTraitKBrake(ctx.driver, ctx.rivals, kBrake);
  kBrake = traitBrake.kBrake;
  const hotheadLate = traitBrake.hotheadLate;
  if (launchWindow) {
    // Milder look-ahead during launch so weak AI do not park on the lights.
    kBrake *= 0.85;
  }
  if (car.tyreTemp < PHYSICS.tyreRecoveryFloor + 0.05) {
    kBrake *= 1.05;
  }
  // Rally: earlier brake perception — loose surface punishes late arrivals.
  if (ctx.discipline === 'rally') {
    kBrake *= 1.08;
  }

  const req = computeRequiredDecel(car, ctx.track, kBrake, tempGrip);
  const suppressBrake = ctx.raceTime < state.suppressBrakeUntil;
  let desiredBrake = computeDesiredBrake(req, car.stats.aBrake, suppressBrake);

  // Brake to the live slot limit — natural survival, not immunity.
  // Low Skill brakes earlier; Bravery delays the onset (risk).
  const vDeslot = computeVDeslot(
    car,
    ctx.track,
    ctx.driver.skill,
    ctx.driver.focus,
    tempGrip,
    ctx.driver.bravery,
  );
  // Low Skill brakes well before the peg; Bravery delays onset (risk).
  const slotOnset =
    0.74 + 0.18 * (ctx.driver.skill / 100) + 0.08 * (ctx.driver.bravery / 100);
  let cornerBrake = false;
  if (
    Math.abs(nodeKappa) >= PHYSICS.grooveKappaMin &&
    car.v > vDeslot * slotOnset &&
    !suppressBrake
  ) {
    const over = (car.v - vDeslot * slotOnset) / Math.max(vDeslot, 1);
    desiredBrake = Math.max(desiredBrake, Math.min(1, 0.55 + over * 1.5));
    cornerBrake = true;
  }
  if (desiredBrake > 0.05 && req > 0.35 * car.stats.aBrake) {
    cornerBrake = true;
  }
  const cornerBrakeAmt = desiredBrake;

  // Solid traffic: AI must not tunnel. Player brain emits a traffic brake cue so
  // low-Skill Authority auto-brake can pick it up (rookies get safer pack driving).
  const traffic = computeTrafficBrake(car, ctx.rivals, car.stats.aBrake, ctx.driver.skill);
  const aiTraffic = !car.isPlayerControlled;
  if (!suppressBrake) {
    // During grid clear: ignore soft accordion brakes; only hard stacks bite.
    const trafficScale = launching ? (traffic.blocked ? 0.55 : 0) : aiTraffic ? 1 : 0.85;
    desiredBrake = Math.max(desiredBrake, traffic.brake * trafficScale);
    // Longitudinal stack / bumper contact — not mild side rubs.
    if (
      aiTraffic &&
      ctx.contactBlocked &&
      (traffic.blocked || traffic.closeAhead) &&
      !launching
    ) {
      desiredBrake = Math.max(desiredBrake, 0.5);
    }
  }

  let desiredThrottle = computeDesiredThrottle(
    car,
    ctx.track,
    desiredBrake > 0.05,
    ctx.driver,
    ctx.raceTime,
    tempGrip,
  );

  // Commit drive off the lights — only on the straight clear; do not override T1 brakes.
  if (
    aiTraffic &&
    launchWindow &&
    !traffic.blocked &&
    Math.abs(nodeKappa) < PHYSICS.grooveKappaMin
  ) {
    desiredThrottle = Math.max(
      desiredThrottle,
      PHYSICS.aiLaunchMinThrottle + 0.2 * (ctx.driver.skill / 100),
    );
    if (ctx.raceTime < 0.7) {
      desiredBrake = Math.min(desiredBrake, 0.12);
    }
  }

  // Base target is this driver's personal line — not the shared geometric o(s).
  let lTarget = personalO;

  // Track parked-behind-traffic time (low speed only).
  let pullingOut = ctx.raceTime < state.overtakeUntil && state.overtakeSide !== 0;
  const parkRisk =
    aiTraffic &&
    (traffic.blocked || (ctx.contactBlocked && traffic.closeAhead)) &&
    !pullingOut &&
    car.v < BLOCK_STALL_V;
  if (parkRisk) state.blockStallTime += BRAIN_DT;
  else if (!traffic.blocked && !ctx.contactBlocked) state.blockStallTime = 0;
  else if (car.v >= BLOCK_STALL_V) {
    state.blockStallTime = Math.max(0, state.blockStallTime - BRAIN_DT * 2);
  }

  // Overtake: draft hold, contact block, or closing on a same-lane car.
  // Stay in the wake first — Determination shortens the hold before the pull-out.
  const draftReady =
    ctx.draft > BALANCE.overtakeDraftThreshold ||
    (ctx.draft > BALANCE.overtakeDraftThreshold * 0.55 && traffic.closeAhead);
  if (draftReady || traffic.closeAhead || pullingOut) {
    state.draftHoldTime += BRAIN_DT;
  } else {
    state.draftHoldTime = Math.max(0, state.draftHoldTime - BRAIN_DT * 1.5);
  }
  const holdNeed =
    BALANCE.overtakeHoldSec *
    (1.15 - 0.35 * (ctx.driver.determination / 100) - 0.15 * (ctx.driver.skill / 100));

  // Only true wrecks force a pass — a slow groove car is traffic, not a stranded peg.
  let wreckAhead = false;
  if (car.v < BLOCK_STALL_V) {
    const laneWidth = PHYSICS.carWidth * 0.62;
    for (const r of ctx.rivals) {
      const centerGap = r.arcGap + PHYSICS.carLength;
      if (centerGap <= 0 || centerGap > BALANCE.followMinGap * 2.2) continue;
      if (Math.abs(r.lateralSep) >= laneWidth) continue;
      if (r.deslotted) {
        wreckAhead = true;
        break;
      }
    }
  }
  const forceSide =
    state.blockStallTime >= BLOCK_FORCE_SEC && car.v < BLOCK_STALL_V && wreckAhead;
  // Also force a side after long park even without a deslot wreck (clogged pack).
  const forceAny =
    forceSide || (state.blockStallTime >= BLOCK_FORCE_SEC * 1.6 && car.v < BLOCK_STALL_V * 0.6);
  const shouldOvertake =
    ctx.contactBlocked ||
    traffic.blocked ||
    state.draftHoldTime >= holdNeed ||
    forceAny;

  let unstickCommit = false;
  if (shouldOvertake && ctx.raceTime >= state.overtakeUntil) {
    state.overtakeSide = pickOvertakeSide(car, ctx.track, ctx.rivals, forceAny);
    if (state.overtakeSide !== 0) {
      state.overtakeUntil = ctx.raceTime + BALANCE.overtakeDurationSec;
      state.blockStallTime = 0;
      pullingOut = true;
      if (forceAny) unstickCommit = true;
    } else if (forceAny) {
      // Never park forever — pick a least-bad side and creep.
      state.overtakeSide = car.l >= 0 ? -1 : 1;
      state.overtakeUntil = ctx.raceTime + BALANCE.overtakeDurationSec * 0.8;
      state.blockStallTime = 0;
      pullingOut = true;
      unstickCommit = true;
      desiredThrottle = Math.max(desiredThrottle, BLOCK_CREEP_THROTTLE + 0.1);
      desiredBrake = Math.min(desiredBrake, 0.15);
    } else if (traffic.blocked || ctx.contactBlocked) {
      desiredThrottle = Math.min(desiredThrottle, BLOCK_CREEP_THROTTLE);
      desiredBrake = Math.max(desiredBrake, 0.45);
    }
  }

  if (pullingOut) {
    const wideShift = Math.min(
      BALANCE.overtakeLateralShift * (0.9 + 0.25 * Math.min(1, nodeWidth / 36)),
      Math.max(PHYSICS.carWidth * 1.15, lineClamp * 0.55),
    );
    lTarget = personalO + state.overtakeSide * wideShift;
    if (forceAny) unstickCommit = true;
  }

  // Drafting races need throttle in the wake; creep only while forcing a wreck pass.
  let trafficLift = false;
  if (aiTraffic) {
    if (traffic.blocked && !pullingOut) {
      if (launching) desiredThrottle = Math.min(desiredThrottle, 0.35);
      else if (forceSide) {
        desiredThrottle = Math.max(BLOCK_CREEP_THROTTLE, Math.min(desiredThrottle, 0.28));
      } else desiredThrottle = 0;
      trafficLift = true;
    } else if (ctx.contactBlocked && !pullingOut && traffic.closeAhead && !launching) {
      desiredThrottle = Math.min(desiredThrottle, 0.2);
      trafficLift = true;
    } else if (traffic.closeAhead && !pullingOut && !launching) {
      if (ctx.draft >= BALANCE.overtakeDraftThreshold * 0.5) {
        // Stay planted in the tow — relative speed for the pass.
        const towCommit = 0.75 + 0.25 * (ctx.driver.determination / 100);
        desiredThrottle = Math.min(desiredThrottle, towCommit);
      } else {
        // Weak / no wake: lift earlier when low Skill.
        const lift = 0.28 + 0.4 * (ctx.driver.skill / 100);
        desiredThrottle = Math.min(desiredThrottle, lift);
        trafficLift = true;
      }
    }
  }

  // Prefer corner intent when corner brake dominates traffic.
  if (traffic.brake * (aiTraffic ? 1 : 0.85) > cornerBrakeAmt + 0.08) {
    cornerBrake = false;
  }

  // AI: hold a lane when a rival is abreast — don't stack on the same personal line.
  // Player keeps racing-line authority; contact resolve still peels bodies apart.
  if (aiTraffic && !launching) {
    for (const r of ctx.rivals) {
      const centerGap = r.arcGap + PHYSICS.carLength;
      if (Math.abs(centerGap) > PHYSICS.carLength * 0.85) continue;
      if (Math.abs(r.lateralSep) > PHYSICS.carWidth * 1.15) continue;
      const away = r.lateralSep >= 0 ? -1 : 1;
      const holdShift = Math.min(
        Math.max(BALANCE.overtakeLateralShift * 0.85, PHYSICS.carWidth * 1.05),
        Math.max(PHYSICS.carWidth * 1.1, lineClamp * 0.5),
      );
      lTarget = personalO + away * holdShift;
      if (state.overtakeSide === 0 || ctx.raceTime >= state.overtakeUntil) {
        state.overtakeSide = away;
        state.overtakeUntil = ctx.raceTime + BALANCE.overtakeDurationSec * 0.6;
      }
      break;
    }
  }

  const mistakeKind = rollMistake(state, ctx.driver, ctx, ctx.modifierStack, modCtx, ctx.rng);

  if (ctx.raceTime < state.mistakeLUntil) {
    lTarget += state.mistakeLShift;
  }

  // Groove wobble: vehicle lineNoise × Focus (high Focus = cleaner line)
  // Skip during grid hold so columns stay clean.
  if (!launching) {
    const lineNoise = applyModifierParam(
      car.stats.lineNoise,
      'lineNoise',
      ctx.modifierStack,
      modCtx,
    );
    // Low Focus = loose groove; high Focus holds the peg cleanly.
    const focusWobble = 1.55 - 1.05 * (ctx.driver.focus / 100);
    lTarget +=
      lineNoise * PHYSICS.grooveWobbleScale * focusWobble * randRange(ctx.rng, -1, 1);
  }

  // Hold starting-grid columns through launch, then ease into the racing line.
  lTarget = gridAwareLineTarget(car, lTarget, ctx.raceTime, nodeKappa);
  lTarget = Math.max(-lineClamp, Math.min(lineClamp, lTarget));

  const draftHold =
    draftReady && !pullingOut && state.draftHoldTime > 0 && !ctx.contactBlocked;
  const iceColdCalm =
    ctx.driver.trait === 'iceCold' &&
    (ctx.isFinalLap || rivalWithinAny(ctx.rivals, 10));
  const showboatRisk =
    ctx.driver.trait === 'showboat' && ctx.isLeading && ctx.leadingMarginSec > 3;

  const primary = resolvePrimaryIntent({
    spinning: false,
    deslotted: false,
    unstick: pullingOut && unstickCommit,
    pullingOut,
    wreckAhead: wreckAhead && !pullingOut && (traffic.blocked || traffic.closeAhead),
    contactBlocked: ctx.contactBlocked && !pullingOut && (traffic.blocked || traffic.closeAhead),
    draftHold,
    cornerBrake: cornerBrake && desiredBrake > 0.05,
    trafficLift: trafficLift && !cornerBrake,
    launching,
    launchWindow,
    recovering: ctx.raceTime < state.recoveryUntil,
  });
  const intentTag = applyTraitIntentOverlay(primary, {
    mistakeKind,
    hotheadLate,
    iceColdCalm,
    showboatRisk,
    cornerBrake,
  });
  const intent = makeIntent(intentTag);

  const raw: BrainOutput = { desiredThrottle, desiredBrake, lTarget, intent };

  const tau = PHYSICS.reactionBase + PHYSICS.reactionFocusSpan * (1 - ctx.driver.focus / 100);
  state.reactionQueue.push({ emitTime: ctx.raceTime, out: raw });

  // Launch / crawl / post-deslot: commit immediately — EMPTY_OUTPUT stalls recovery.
  if (launchWindow || car.v < 4 || ctx.raceTime < state.recoveryUntil) {
    return raw;
  }

  const delayed = drainReactionQueue(state, ctx.raceTime, tau);

  // AI traffic / contact is a reflex — don't wait a full reaction delay to lift.
  if (
    aiTraffic &&
    (traffic.blocked || ctx.contactBlocked || traffic.brake >= 0.55)
  ) {
    return attachIntent(
      {
        desiredThrottle: Math.min(delayed.desiredThrottle, desiredThrottle),
        desiredBrake: Math.max(delayed.desiredBrake, desiredBrake),
        lTarget: ctx.raceTime < state.overtakeUntil ? lTarget : delayed.lTarget,
      },
      intent,
    );
  }

  return attachIntent(delayed, intent);
}

/** Neutral brain output for stun/spin or pre-race. */
export function idleBrainOutput(car: CarSimState, _track: TrackData): BrainOutput {
  return { desiredThrottle: 0, desiredBrake: 1, lTarget: car.gridL };
}
