import { BALANCE } from '../data/balance';
import { PHYSICS } from '../data/physics';
import type { DisciplineId } from '../data/disciplines';
import type { Driver } from './types';
import type { Modifier, ModifierContext } from './modifiers';
import { applyModifierParam } from './modifiers';
import type { TrackData } from './TrackGenerator';
import { interpolateAtS } from './RacingLine';
import type { CarSimState } from './Vehicle';
import type { BrainOutput } from './Vehicle';
import { vDriverAt } from './Vehicle';
import type { Rng } from './rng';
import { randRange } from './rng';

export interface RivalSnapshot {
  /** Arc distance to rival minus car length (positive = ahead). */
  arcGap: number;
  lateralSep: number;
  speed: number;
  s: number;
  l: number;
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
}

const EMPTY_OUTPUT: BrainOutput = { desiredThrottle: 0, desiredBrake: 0, lTarget: 0 };

export function createBrainState(): BrainState {
  return {
    reactionQueue: [],
    suppressBrakeUntil: 0,
    mistakeLShift: 0,
    mistakeLUntil: 0,
    overtakeSide: 0,
    overtakeUntil: 0,
    draftHoldTime: 0,
  };
}

/** kBrake perception multiplier (plan 7.1). */
export function computeKBrake(driver: Driver, modifierStack: readonly Modifier[], ctx: ModifierContext): number {
  let k = 1.2 - 0.25 * (driver.skill / 100) - 0.1 * (driver.bravery / 100);
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

/** Max required decel over horizon (plan 6 step 2). */
function computeRequiredDecel(
  car: CarSimState,
  track: TrackData,
  kBrake: number,
): number {
  const horizon = Math.max(car.v * PHYSICS.horizonSec, PHYSICS.sampleDs * 2);
  let accDist = 0;
  let maxReq = 0;
  let idx = findStartNodeIndex(track, car.s);
  const n = track.nodes.length;
  let steps = 0;

  while (accDist < horizon && steps < n * 3) {
    const ds = nodeDs(track, idx);
    const nodeS = track.nodes[idx]!.s;
    const vTarget = vDriverAt(car.vDriver, track, nodeS);
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
  if (req >= 0.4) return req / aBrake;
  return 0;
}

function computeDesiredThrottle(
  car: CarSimState,
  track: TrackData,
  braking: boolean,
): number {
  if (braking) return 0;
  const vTarget = vDriverAt(car.vDriver, track, car.s);
  if (vTarget <= 0.1) return 0;
  return Math.max(0, Math.min(1, (vTarget - car.v) / (0.05 * vTarget)));
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

function pickOvertakeSide(car: CarSimState, track: TrackData, rivals: readonly RivalSnapshot[]): number {
  const node = interpolateAtS(track.nodes, track.length, car.s);
  const halfW = node.width / 2 - PHYSICS.racingLineMargin;
  let roomLeft = halfW - (node.o - car.l);
  let roomRight = halfW + (node.o - car.l);

  for (const r of rivals) {
    if (Math.abs(r.arcGap) > BALANCE.contactGap) continue;
    if (r.l < car.l) roomLeft -= 1;
    if (r.l > car.l) roomRight -= 1;
  }

  return roomLeft >= roomRight ? -1 : 1;
}

function rollMistake(
  state: BrainState,
  driver: Driver,
  ctx: BrainTickContext,
  modifierStack: readonly Modifier[],
  modCtx: ModifierContext,
  rng: Rng,
): void {
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
  if (rng() >= pTick) return;

  if (rng() < 0.5) {
    state.suppressBrakeUntil = ctx.raceTime + PHYSICS.mistakeBrakeSuppress;
  } else {
    state.mistakeLShift = (rng() < 0.5 ? -1 : 1) * PHYSICS.mistakeLateralShift;
    state.mistakeLUntil = ctx.raceTime + PHYSICS.mistakeLateralDuration;
  }
}

function applyTraitKBrake(driver: Driver, rivals: readonly RivalSnapshot[], kBrake: number): number {
  if (driver.trait === 'hothead' && rivalWithinBehind(rivals, 12)) {
    return kBrake - 0.1;
  }
  return kBrake;
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
 * Full driver brain tick at 30 Hz (plan section 6 step 2 + 7.x).
 * Call every PHYSICS.brainEveryN physics steps.
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

  let kBrake = computeKBrake(ctx.driver, ctx.modifierStack, modCtx);
  kBrake = applyTraitKBrake(ctx.driver, ctx.rivals, kBrake);

  const req = computeRequiredDecel(car, ctx.track, kBrake);
  const suppressBrake = ctx.raceTime < state.suppressBrakeUntil;
  let desiredBrake = computeDesiredBrake(req, car.stats.aBrake, suppressBrake);
  let desiredThrottle = computeDesiredThrottle(car, ctx.track, desiredBrake > 0);

  const node = interpolateAtS(ctx.track.nodes, ctx.track.length, car.s);
  const halfW = node.width / 2;
  const lineClamp = halfW - PHYSICS.racingLineMargin;
  let lTarget = node.o;

  // Overtake logic (plan 7.3)
  if (ctx.draft > BALANCE.overtakeDraftThreshold) {
    state.draftHoldTime += 1 / 30;
  } else {
    state.draftHoldTime = 0;
  }

  const shouldOvertake =
    ctx.contactBlocked || state.draftHoldTime >= BALANCE.overtakeHoldSec;

  if (shouldOvertake && ctx.raceTime >= state.overtakeUntil) {
    state.overtakeSide = pickOvertakeSide(car, ctx.track, ctx.rivals);
    state.overtakeUntil = ctx.raceTime + BALANCE.overtakeDurationSec;
  }

  if (ctx.raceTime < state.overtakeUntil) {
    lTarget = node.o + state.overtakeSide * BALANCE.overtakeLateralShift;
  }

  // Mistakes
  rollMistake(state, ctx.driver, ctx, ctx.modifierStack, modCtx, ctx.rng);

  if (ctx.raceTime < state.mistakeLUntil) {
    lTarget += state.mistakeLShift;
  }

  // Continuous line noise (plan 6 step 7b)
  const lineNoise = applyModifierParam(
    car.stats.lineNoise,
    'lineNoise',
    ctx.modifierStack,
    modCtx,
  );
  lTarget += lineNoise * randRange(ctx.rng, -1, 1);

  lTarget = Math.max(-lineClamp, Math.min(lineClamp, lTarget));

  const raw: BrainOutput = { desiredThrottle, desiredBrake, lTarget };

  // Reaction delay buffer
  const tau = PHYSICS.reactionBase + PHYSICS.reactionFocusSpan * (1 - ctx.driver.focus / 100);
  state.reactionQueue.push({ emitTime: ctx.raceTime, out: raw });

  return drainReactionQueue(state, ctx.raceTime, tau);
}

/** Neutral brain output for stun/spin or pre-race. */
export function idleBrainOutput(car: CarSimState, track: TrackData): BrainOutput {
  const node = interpolateAtS(track.nodes, track.length, car.s);
  return { desiredThrottle: 0, desiredBrake: 1, lTarget: node.o };
}
