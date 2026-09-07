/**
 * Driver model — the RPG as CONTROL QUALITY, not a speed scalar.
 *
 * The driver perceives the corner, plans a brake point from the car's real
 * tyre limit, executes steering through a human-like plant (rate limit,
 * delay, skill-scaled error) and recovers slides. Skill differences are
 * control differences: a rookie under-brakes, early-apexes, oscillates and
 * snaps on exit; an elite clips apexes lap after lap. Player throttle is a
 * ceiling applied in sim/update.ts.
 */
import { BALANCE } from '../../data/balance';
import { PHYSICS } from '../../data/physics';
import type { DisciplineId } from '../../data/disciplines';
import { interpolateAtSInto, type InterpolatedNode } from '../RacingLine';
import type { TrackData } from '../TrackGenerator';
import { makeIntent } from '../BrainIntent';
import type { BrainIntent, BrainIntentTag } from '../BrainIntent';
import type { Rng } from '../rng';
import { SURFACES } from '../../data/surfaces';
import { tyreTempGrip } from '../sim/tyre';
import { personalLineAt } from '../vehicle/create';
import type { Driver } from '../types';
import type { CarSimState } from '../Vehicle';
import { resolveDriveBias, type CarSetup } from '../vehicle/CarSetup';
import type { ModifierContext } from '../modifiers';

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

const lookScratch: InterpolatedNode = {
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
  arcGap: number;
  lateralSep: number;
  speed: number;
  s: number;
  l: number;
  deslotted: boolean;
}

export interface BrainTickContext {
  track: TrackData;
  driver: Driver;
  discipline: DisciplineId;
  modifierStack: readonly import('../modifiers').Modifier[];
  rivals: readonly RivalSnapshot[];
  draft: number;
  rain: boolean;
  /** Live surface µ (already rain-adjusted) — the driver plans against this. */
  muSurface: number;
  raceTime: number;
  isFinalLap: boolean;
  isLeading: boolean;
  leadingMarginSec: number;
  position: number;
  totalCars: number;
  rng: Rng;
  contactBlocked: boolean;
}

export interface BrainState {
  /** Rate-limited steer from last tick (rad). */
  prevSteer: number;
  prevSlotMode: '' | 'groove' | 'deslot';
  prevAlphaRear: number;
  suppressBrakeUntil: number;
  mistakeLUntil: number;
  mistakeLShift: number;
  /**
   * Race time when the driver starts steering off the dirt bank (0 = on
   * tarmac). A short hold so a wide moment can exist, then they come home.
   */
  recoveryUntil: number;
  /** Confidence 0..1 — edges the driver closer to the limit (drama). */
  conf: number;
  lastIntentTag: BrainIntentTag | null;
  /** Time spent in a draft tow (for draft-pass credit). */
  draftHoldTime: number;
  /** Last time the driver applied countersteer (reaction gating). */
  lastSlideReact: number;
  /**
   * Mistake caution 0..1 — the driver's racing LINE morphs toward the safe
   * centerline after a wide run / spin and recovers as they regain confidence.
   * The line is the driver's own drawing of the corner, so it moving IS the
   * "morphing racing line" — safer through the corner, then back to the fast
   * line once composed.
   */
  shaken: number;
}

export interface BrainOutput {
  desiredThrottle: number;
  desiredBrake: number;
  lTarget: number;
  steerTarget?: number;
  /** Steering angle (rad) — the driver's hands. */
  steer: number;
  intent?: BrainIntent;
}

/**
 * The driver's planned corner speed for a given grip/curvature — the control
 * quality: how close to the physical limit the plan runs. Skill raises the
 * margin; the plan's brake point derives from this target.
 */
export function cornerTargetSpeed(opts: {
  skill: number;
  bravery: number;
  conf: number;
  aGrip: number;
  kappa: number;
}): number {
  const skill01 = clamp01(opts.skill / 100);
  const margin = Math.max(
    0.72,
    Math.min(0.9, 0.72 + 0.1 * skill01 + 0.04 * (opts.bravery / 100) + opts.conf * 0.02),
  );
  return Math.sqrt(opts.aGrip / Math.max(Math.abs(opts.kappa), 1e-3)) * margin;
}

export function createBrainState(): BrainState {
  return {
    prevSteer: 0,
    prevSlotMode: '',
    prevAlphaRear: 0,
    suppressBrakeUntil: 0,
    mistakeLUntil: 0,
    mistakeLShift: 0,
    recoveryUntil: 0,
    conf: 0.5,
    lastIntentTag: null,
    draftHoldTime: 0,
    lastSlideReact: -99,
    shaken: 0,
  };
}

export function idleBrainOutput(car: CarSimState, _track: TrackData): BrainOutput {
  return {
    desiredThrottle: 0,
    desiredBrake: 1,
    lTarget: car.l,
    steerTarget: 0,
    steer: 0,
  };
}

const G = 9.81;
/** Seconds on the dirt before the driver commits to coming back. */
const DIRT_HOLD_SEC = 0.45;
/** Extra hold for a rookie (elite uses DIRT_HOLD_SEC only). */
const DIRT_HOLD_ROOKIE = 0.3;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Find closest node index for arc position s. */
function findNodeIndexAtS(track: TrackData, s: number): number {
  const n = track.nodes.length;
  if (n === 0) return 0;
  let distS = s % track.length;
  if (distS < 0) distS += track.length;
  if (distS <= track.nodes[0]!.s) return 0;
  const last = track.nodes[n - 1]!;
  if (distS >= last.s) return n - 1;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (track.nodes[mid]!.s <= distS) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** The driver's estimate of the car's lateral grip accel — MUST match the sim's
 *  live µ (ctx.muSurface already carries the rain multiplier). */
function gripEstimate(car: CarSimState, muSurface: number, tempGrip: number): number {
  const mu = muSurface * (car.setup?.compoundMu ?? 1) * tempGrip;
  return mu * G;
}

/**
 * Steer feedforward for a path of curvature κ.
 * Ackermann (wb·κ) is rolling-without-slip; these tyres need extra road-wheel
 * to build the slip that actually makes aY = v²κ. Without that term the car
 * cuts straight across the inside of every bend.
 */
function steerForKappa(wb: number, pathK: number, v: number, aGrip: number): number {
  const k = Math.max(-0.28, Math.min(0.28, pathK));
  const ack = Math.atan(wb * k);
  const aYCmd = Math.max(-aGrip, Math.min(aGrip, v * v * k));
  return ack + 0.075 * (aYCmd / G);
}

/** Preview κ: turn in on the upcoming bend, hold the current one through the apex. */
function previewKappa(now: number, ahead: number): number {
  if (now === 0) return ahead;
  if (ahead === 0) return now;
  if (Math.sign(now) !== Math.sign(ahead)) return now;
  return Math.abs(ahead) >= Math.abs(now) ? ahead : now;
}

function trafficBrake(car: CarSimState, rivals: readonly RivalSnapshot[], aBrake: number): number {
  let brake = 0;
  for (const r of rivals) {
    // Only rivals AHEAD matter — a car behind you (its rear behind your nose)
    // must not trigger the traffic brake (this stalled every grid launch).
    const centerGap = r.arcGap + PHYSICS.carLength;
    if (centerGap <= 0) continue;
    if (Math.abs(r.lateralSep) > 2.4) continue;
    if (centerGap > 30) continue;
    const gap = r.arcGap;
    if (gap <= 2.6) {
      brake = Math.max(brake, 1);
    } else if (gap < 9) {
      const closing = car.v - r.speed;
      if (closing > 0.5) brake = Math.max(brake, Math.min(1, closing / Math.max(aBrake, 4)));
    }
  }
  return brake;
}

function rollMistake(
  state: BrainState,
  driver: Driver,
  raceTime: number,
  rng: Rng,
  rain: boolean,
  overdriving: boolean,
): void {
  // Competent drivers don't randomly melt down on a calm lap — mistakes only
  // surface when already past the grip limit (over-driving), so going off is a
  // physics consequence, not a brain glitch.
  if (!overdriving) return;
  const focus01 = clamp01(driver.focus / 100);
  let rate = ((1 - focus01) * PHYSICS.mistakeBasePerSec * 0.2) * (rain ? BALANCE.rainMistakeMult : 1);
  rate = Math.min(rate, 0.03);
  if (rng() >= rate / 30) return;
  if (rng() < 0.5) {
    // A brief lift — carries a touch too much speed, not a brake cut that throws you wide.
    state.suppressBrakeUntil = raceTime + PHYSICS.mistakeBrakeSuppress * 0.4;
  } else {
    state.mistakeLShift = (rng() < 0.5 ? -1 : 1) * PHYSICS.mistakeLateralShift * 0.4;
    state.mistakeLUntil = raceTime + PHYSICS.mistakeLateralDuration * 0.6;
  }
}

/**
 * The driver brain tick (30 Hz). Produces steering + a throttle/brake plan
 * that the sim blends with the player's requests.
 */
export function tickDriverBrain(
  state: BrainState,
  car: CarSimState,
  ctx: BrainTickContext,
): BrainOutput {
  const { track, discipline, driver, rain, rng, raceTime } = ctx;
  const skill01 = clamp01(driver.skill / 100);
  const bravery01 = clamp01(driver.bravery / 100);
  const disc = discipline;

  // Draft tow accumulation (draft-pass credit + tow commitment).
  state.draftHoldTime = ctx.draft > 0.25 ? state.draftHoldTime + PHYSICS.dt * 4 : Math.max(0, state.draftHoldTime - PHYSICS.dt * 2);

  // --- Mistake caution: the racing line morphs after a mistake and recovers ---
  // A wide run / spin shakes the driver: their line draws toward the safe
  // centerline and they lift the corner target a touch, then compose over ~8s.
  if (state.prevSlotMode === 'groove' && car.slotMode === 'deslot') {
    state.shaken = Math.min(1, state.shaken + 0.85);
  } else if (car.spinRemaining > 0) {
    state.shaken = Math.min(1, state.shaken + 0.02);
  } else {
    state.shaken = Math.max(0, state.shaken - (PHYSICS.dt * 4) / 8);
  }
  if (car.slotMode !== 'deslot') state.recoveryUntil = 0;
  state.prevSlotMode = car.slotMode;

  const node = interpolateAtSInto(track.nodes, track.length, car.s, nodeScratch);
  const halfW = node.width / 2;
  const lineClamp = halfW - PHYSICS.racingLineMargin;
  const v = Math.max(0, car.v);
  const tempGrip = tyreTempGrip(car.tyreTemp);
  const aGrip = gripEstimate(car, ctx.muSurface ?? SURFACES[disc].mu, tempGrip);
  // Groove = this car's personal line (κ feedforward + lateral pursuit).
  // Corner speed is planned against tyre grip; too hot → tyres saturate and
  // the car runs wide — that is the hybrid.

  // --- Unrecoverable / recovering states first ---
  if (car.spinRemaining > 0) {
    const counter = -Math.sign(car.yawRate || 1) * 0.55;
    return {
      desiredThrottle: 0,
      desiredBrake: 0.6,
      lTarget: car.l,
      steerTarget: counter,
      steer: counter,
      intent: makeIntent('SPIN_SCRUB'),
    };
  }
  if (car.slotMode === 'deslot') {
    // Kerb kiss: ease toward the line. Dirt bank: hold a beat, then come home.
    // A high-speed cap used to leave them running parallel on the runoff.
    const onBank = Math.abs(car.l) > halfW + 1.0;
    const delay = DIRT_HOLD_SEC + DIRT_HOLD_ROOKIE * (1 - skill01);
    if (onBank && state.recoveryUntil <= 0) state.recoveryUntil = raceTime + delay;
    const comeHome = state.recoveryUntil > 0 && raceTime >= state.recoveryUntil;
    const lineT = Math.max(-lineClamp, Math.min(lineClamp, personalLineAt(car, track, car.s)));
    const home = comeHome
      ? Math.sign(car.l || 1) * Math.max(0, halfW - 1.5)
      : lineT;
    const errNow = home - car.l;
    const wbR = car.setup?.wheelbase ?? 2.7;
    const gain = comeHome ? 0.95 : 0.4;
    const steerRaw =
      Math.atan((gain * errNow) / Math.max(v, 6)) - 0.18 * (car.dl / Math.max(v, 6));
    const cap = comeHome ? 0.42 : Math.atan((G * wbR) / Math.max(v * v, 18));
    let steer = Math.max(-cap, Math.min(cap, steerRaw));
    const speedBoost = v < 15 ? 1.5 : 1;
    const rate = (2.6 + 1.9 * skill01) * speedBoost;
    steer = Math.max(
      state.prevSteer - rate * PHYSICS.dt * 4,
      Math.min(state.prevSteer + rate * PHYSICS.dt * 4, steer),
    );
    state.prevSteer = steer;
    const throttle = comeHome
      ? Math.abs(car.slipAngle) > 0.5
        ? 0.28
        : 0.42
      : Math.abs(car.slipAngle) > 0.5
        ? 0.5
        : 0.75;
    return {
      desiredThrottle: throttle,
      desiredBrake: comeHome ? 0.12 : 0.05,
      lTarget: home,
      steerTarget: steer,
      steer,
      intent: makeIntent('REJOIN_CRAWL'),
    };
  }

  // --- Perception using ideal line data (O(1) lookup) ---
  const nodeIdx = findNodeIndexAtS(track, car.s);
  const idealVTarget = car.idealVLine?.[nodeIdx] ?? (car.stats.vMax * 0.95);
  const brakeZoneDist = car.brakeZoneStart?.[nodeIdx] ?? -1;
  const turnInIdx = car.turnInPoint?.[nodeIdx] ?? -1;
  // const apexIdx = car.apexNode?.[nodeIdx] ?? -1; // unused for now

  // Target speed from ideal line with skill-scaled perception error.
  const percepErr = (1 - skill01) * 0.12; // slightly reduced from 0.15
  const vEst = idealVTarget * (1 + (rng() - 0.5) * percepErr);
  // Discipline-aware commitment: Rally's loose surface and Street's close
  // walls demand a more cautious margin than Track's open circuit.
  const discMargin = disc === 'rally' ? 0.86 : disc === 'street' ? 0.90 : 0.94;
  // Power caution: a car whose drive exceeds the surface grip (a powerful car
  // on loose) must corner with extra care or its exits break the rear loose.
  const driveCaution =
    disc === 'rally' ? Math.max(0, (car.stats.aAccel / G - aGrip / G) * 0.6) : 0;
  const margin = Math.max(
    0.78,
    Math.min(0.95, 0.78 + 0.17 * skill01 + 0.04 * bravery01 + state.conf * 0.03),
  ) * discMargin - driveCaution;
  const vTarget = Math.min(vEst * margin, idealVTarget);

  // --- Braking using ideal line brake zones ---
  let desiredBrake = 0;
  // Brake when approaching a brake zone and over target speed.
  const inBrakeZone = brakeZoneDist > 0;
  const approachingTurnIn = turnInIdx >= 0;
  let braking = (inBrakeZone || approachingTurnIn) && v > vTarget;
  if (braking) {
    const overFrac = (v - vTarget) / Math.max(vTarget, 1);
    // Scale brake harder for larger speed overshoots.  A car going 2× target
    // must brake at full force; a car just above target eases off.
    desiredBrake = overFrac < 0.02 ? 0 : Math.max(0, Math.min(1, 0.35 + overFrac * 0.9));
    if (disc === 'rally') desiredBrake *= 0.75;
    // Street's driftable compound can't take a hard brake — the rear breaks
    // loose into the walls. Gentle, spreading stops instead.
    if (disc === 'street') desiredBrake *= 0.85;
  }
  // Emergency curvature brake: if there's high curvature ahead and the car
  // is way over the speed it should be, brake regardless of zone detection.
  // This catches corners the zone engine missed (e.g. very tight bends after
  // a long straight).
  if (!braking && Math.abs(node.kappaLine) > 0.015 && v > 8) {
    const cornerV = Math.sqrt(aGrip / Math.max(Math.abs(node.kappaLine), 1e-3)) * 0.8;
    if (v > cornerV * 1.3) {
      const excess = (v - cornerV) / Math.max(cornerV, 1);
      desiredBrake = Math.max(desiredBrake, Math.min(1, excess * 0.7));
      braking = true;
    }
  }
  // Bravery / confidence / skill nudge on momentum:
  //  - skilled drivers carry speed (brake at the last moment, hard)
  //  - BRAVE drivers trust the corner — gentler brake, keep momentum (risky)
  //  - TIMID drivers brake decisively early and hard — lose momentum but round
  //    the corner without shooting into the barrier
  //  - high CONFIDENCE (form) edges the same driver later; low confidence safer
  const brakeLatency = 1.02 - 0.1 * skill01 - 0.08 * bravery01 - 0.08 * state.conf;
  desiredBrake *= brakeLatency;

  if (raceTime < state.suppressBrakeUntil) desiredBrake = Math.min(desiredBrake, 0.1);

  // Launch commit: no corner braking while clearing the grid (braking into T1
  // while still correcting from the grid column caused launch spins).
  if (raceTime < PHYSICS.aiLaunchSec) desiredBrake = Math.min(desiredBrake, 0.15);

  const traffic = trafficBrake(car, ctx.rivals, car.stats.aBrake);
  // During launch the pack is packed tight — scale traffic braking way down so
  // the grid can clear instead of locking itself against the field.
  const launching = raceTime < PHYSICS.aiLaunchSec;
  desiredBrake = Math.max(desiredBrake, launching ? traffic * 0.15 : traffic);
  // Contact-block braking only after the grid clears — during launch it just
  // pins the pack against each other (start stalls).
  if (ctx.contactBlocked && car.v < 14 && raceTime > PHYSICS.aiLaunchSec) {
    desiredBrake = Math.max(desiredBrake, 0.4);
  }

  // Target line (personal racing line + mistake wobble).
  const shaken = state.shaken;
  const mistakeShift = raceTime < state.mistakeLUntil ? state.mistakeLShift : 0;
  // Grid anchor: hold starting column for first gridAnchorDist, then ease to
  // the personal line. Distance-based (not time-based) so it works at any
  // launch speed. Shared by BOTH the position target and the steering
  // lookahead — otherwise the steering aims at the raw personal line (often the
  // opposite side of the track) while the car is still pinned to its grid
  // column, yanking the wheel hard and spinning the car out of the gate.
  const anchorDist = PHYSICS.idealLine.gridAnchorDist;
  const blendedLineAt = (s: number): number => {
    const base = personalLineAt(car, track, s) + mistakeShift;
    const dsFromGrid = s - car.gridS;
    const dsNormalized = dsFromGrid < 0 ? dsFromGrid + track.length : dsFromGrid;
    let t = base;
    if (dsNormalized < anchorDist) {
      const w = 1 - dsNormalized / anchorDist;
      const blend = w * w * (3 - 2 * w); // smoothstep
      t = car.gridL * blend + base * (1 - blend);
    }
    // While shaken the line morphs toward centerline (safer), not grid column.
    t = t * (1 - 0.7 * shaken);
    return Math.max(-lineClamp, Math.min(lineClamp, t));
  };

  const lineT = blendedLineAt(car.s);

  // --- Throttle plan (grip-budget management) ---
  // Corner braking = throttle OFF (braking and flooring together make the car
  // net-accelerate into the corner). Light trail-brake still eases throttle.
  let desiredThrottle = braking ? 0 : Math.max(0, 1 - desiredBrake);
  if (desiredBrake <= 0.3) {
    // Grip-budget: ease the throttle so the FRONT axle keeps cornering grip.
    // Acceleration pitches load to the rear, unloading the front — the front
    // then understeers wide even if the TOTAL grip is fine. Solve the front's
    // friction circle (its cornering share + its long share ≤ its grip after
    // pitch) with a damped fixed-point iteration.
    const setup = car.setup as CarSetup;
    const mu = aGrip / G;
    const sf = setup.staticFront ?? 0.48;
    const pitchPerG = (setup.cgHeight ?? 0.36) / Math.max(1, setup.wheelbase ?? 2.7);
    // Shared with the sim's drive split (resolveDriveBias) — they must agree.
    const driveBias = resolveDriveBias(setup, disc);
    const cornerG = (car.v * car.v * Math.abs(nodeScratch.kappaLine)) / G;
    const driveG = Math.max(0.1, car.stats.aAccel / G);
    const frontCornerShare = cornerG * sf;
    const rearBias = Math.max(0.1, 1 - driveBias);
    const rearCornerShare = cornerG * (1 - sf);
    let a = 0.5;
    for (let i = 0; i < 3; i++) {
      // Both axles must hold their share of cornering AND drive on the friction
      // circle. The rear is what breaks loose on a powerful car (the rally/AWD
      // spin) — check it as hard as the front.
      const frontGrip = mu * Math.max(0.05, sf - a * pitchPerG);
      const frontLongCap = Math.sqrt(Math.max(0, frontGrip * frontGrip - frontCornerShare * frontCornerShare));
      const rearGrip = mu * Math.max(0.05, 1 - sf + a * pitchPerG);
      const rearLongCap = Math.sqrt(Math.max(0, rearGrip * rearGrip - rearCornerShare * rearCornerShare));
      const next = Math.min(frontLongCap / Math.max(0.2, driveBias), rearLongCap / rearBias);
      a = a * 0.5 + next * 0.5;
    }
    const throttleByGrip = Math.min(1, Math.max(0, a / driveG));
    // Rally exits need extra care — the loose surface can't take the power.
    if (disc === 'rally') desiredThrottle = Math.min(desiredThrottle, throttleByGrip * 0.8);
    // Street (RWD + locked diff) needs no forcing — the power through the rear
    // breaks it into a held slide at the limit on its own. Forcing it (×>1)
    // turned tight circuits into spin-recover-spin loops.
    else desiredThrottle = Math.min(desiredThrottle, throttleByGrip);

    // Exit throttle from idealVLine slope: if next node speed > current, we're in accel zone.
    const nextIdx = (nodeIdx + 1) % track.nodes.length;
    const idealVNext = car.idealVLine?.[nextIdx] ?? idealVTarget;
    const inAccelZone = idealVNext > idealVTarget + 1.5; // speeding up by >1.5 m/s
    if (inAccelZone && !braking) {
      desiredThrottle = Math.max(desiredThrottle, throttleByGrip);
    }

    // Drift throttle: the driver FEATHERS the pedal to hold the slide — power
    // keeps the rear loose, but too much spins it. Taper as the slide grows so
    // the drift settles instead of breaking away (or panic-cutting).
    if (Math.abs(car.slipAngle) > 0.18) {
      const taper = Math.max(0.55, 1 - (Math.abs(car.slipAngle) - 0.18) * 1.6);
      desiredThrottle = Math.min(desiredThrottle, taper);
    }
    // Hard slide → lift (the driver reads its own over-rotation).
    if (Math.abs(car.slipAngle) > 0.55 || car.gripUsage > 1.05) desiredThrottle = Math.min(desiredThrottle, 0.4);
    // Draft tow: commit in the wake.
    if (ctx.draft > 0.35) desiredThrottle = 1;
    // Never stall: a car crawling commits full power (no grid stutters).
    if (car.v < 3) desiredThrottle = 1;
  }

  // Point at the groove: Ackermann for the path curvature (feedforward) plus
  // pursuit on lateral error. Feedforward is what actually turns the car in a
  // corner — offset-only pursuit is ~0 when already on the line, and the
  // tyres then generate no aY, so the ribbon rotates under a world-straight
  // velocity. The tyres still accept or refuse the turn.
  const wb = car.setup?.wheelbase ?? 2.7;
  // Anticipatory corner setup: drivers KNOW the track (turnInPoint/apex are
  // precomputed). Skill sets how early they begin rotating — an elite leads far
  // and nails the apex; a rookie still leads enough to turn in BEFORE the corner
  // (never drives straight off). This is the "skill = lead + smoothness" model.
  const MIN_LEAD = 22;
  const MAX_LEAD = 45;
  const leadDistance = MIN_LEAD + (MAX_LEAD - MIN_LEAD) * skill01;
  const baseLook = Math.max(20, Math.min(80, v * (0.55 + 0.9 * skill01) + 12));
  // Adaptive lookahead: aiming PAST the corner exit makes the target flip to the
  // far side of the track, so the car steers the WRONG way out of the bend. If
  // the path curvature reverses within the lookahead, stop at that point (the
  // corner exit / S-crest) so we track the current bend, not the next one.
  const nodeStep = track.nodes[1]!.s - track.nodes[0]!.s;
  // Lead with the skill-scaled distance so the wheel starts rotating toward the
  // apex before entry; the curvature-reversal check below still caps it on S/chicanes.
  let laDist = Math.max(baseLook * 0.6, leadDistance);
  // Only shorten when the path genuinely REVERSES curvature (a real left-right
  // switch, e.g. an S or chicane). A sweeping corner keeps the full lookahead;
  // aiming the full distance there is correct and stable. Aiming the full
  // distance across a reversal lands the target on the far side of the track,
  // which is what made the car steer the WRONG way out of tight bends. We only
  // cut on substantial curvature (both sides) so small centreline wiggles don't
  // trigger it, and never below 15m (a too-short lookahead goes unstable).
  let prevK = Math.sign(node.kappaLine);
  let prevMag = Math.abs(node.kappaLine);
  for (let dd = nodeStep; dd < laDist; dd += nodeStep) {
    const n =
      track.nodes[
        Math.round(((car.s + dd) % track.length) / nodeStep) % track.nodes.length
      ]!;
    const k = n.kappaLine;
    const mag = Math.abs(k);
    if (mag > 0.008 && prevMag > 0.008 && prevK !== 0 && Math.sign(k) !== prevK) {
      laDist = Math.max(15, dd);
      break;
    }
    if (mag > 0.008) {
      prevK = Math.sign(k);
      prevMag = mag;
    }
  }
  const lookS = (car.s + laDist) % track.length;
  interpolateAtSInto(track.nodes, track.length, lookS, lookScratch);
  const kappaCmd = previewKappa(node.kappaLine, lookScratch.kappaLine);
  const pathK = kappaCmd / Math.max(0.45, 1 - kappaCmd * car.l);
  // While the nose is only a few degrees off the path, unwind that attitude
  // into extra/less curvature. Past ~12° this is a slide — leave it to the
  // recovery block so a held drift isn't countersteered away.
  const unwind =
    Math.abs(car.slipAngle) < 0.22 ? (1.6 * car.slipAngle) / Math.max(v, 5) : 0;
  const steerFF = steerForKappa(wb, pathK - unwind, v, aGrip);
  // Same grid-anchored blend as the position target (see blendedLineAt above).
  const lineTAhead = Math.max(-lineClamp, Math.min(lineClamp, blendedLineAt(lookS)));
  const errLat = lineTAhead - (car.l + laDist * Math.sin(car.slipAngle));
  const lam = Math.max(laDist, 19);
  const steerPursuit = Math.atan((2 * errLat * wb) / (lam * lam));
  const errNow = lineT - car.l;
  const ffBlend = Math.max(0.45, 1 - Math.abs(errNow) / 7);
  const steerYaw = -0.15 * car.slipAngle;
  const steerDamp = -0.18 * (car.dl / Math.max(v, 6));
  const steerCap = Math.atan((1.5 * aGrip * wb) / Math.max(v * v, 18));
  // Budget-cap the curvature command only. Clipping the sum starved turn-in
  // (pursuit is ~0 on the line, so a grip cap on the total killed the FF).
  const steerFFCapped = Math.max(-steerCap, Math.min(steerCap, steerFF));
  let steer = Math.max(
    -0.7,
    Math.min(0.7, ffBlend * steerFFCapped + steerPursuit + steerYaw + steerDamp),
  );
  // Steering is NEVER suppressed by braking — the wheel stays full (grip-capped
  // above). Real drivers trail-brake (brake + steer together), and the friction
  // circle in tyre.ts axleForces naturally penalises over-brake-through-corner as
  // understeer, so no artificial cut is needed. Instead model the *driver
  // preference*: a rookie eases the brake while steering hard (reluctant, but
  // never refuses); an elite trail-brakes freely. Bravery carries the brake deeper.
  const steerFrac = Math.min(1, Math.abs(steer) / Math.max(steerCap, 1e-3));
  const reluctance = Math.max(
    0,
    Math.min(0.6, 0.5 * steerFrac * (1 - 0.6 * skill01 - 0.2 * bravery01)),
  );
  desiredBrake *= 1 - reluctance;

  // Skill: rate limit (neuromuscular) + tracking noise.
  // Low speed demands sharper turn-in — boost the rate for tight corners.
  const speedBoost = v < 15 ? 1.5 : 1;
  const rate = (2.6 + 1.9 * skill01) * speedBoost;
  steer = Math.max(
    state.prevSteer - rate * PHYSICS.dt * 4,
    Math.min(state.prevSteer + rate * PHYSICS.dt * 4, steer),
  );
  steer += (rng() - 0.5) * 0.015 * (1 - skill01);
  steer = Math.max(-0.7, Math.min(0.7, steer));
  state.prevSteer = steer;

  // --- Slide recovery (countersteer) ---
  // A slide is either YAW oversteer (rear breaks, car rotates) or a LATERAL
  // slide (body slip grows with little yaw — the rally case). React to both.
  // The threshold sits ABOVE a normal drift (slip ~0.2–0.3 holds as the drift)
  // so only the genuine over-rotation gets countersteered.
  const lateralSlide = Math.abs(car.slipAngle) > 0.34 && car.gripUsage > 0.88;
  const yawOversteer =
    Math.abs(car.slipAngle) > 0.26 && Math.abs(car.yawRate) > 0.5;
  const oversteer = lateralSlide || yawOversteer;
  if (oversteer) {
    // Human reaction delay: a low-skill driver is late to the counter — the
    // slide builds past the point of no return → spin. High skill reacts in time.
    // The Street drift cars need to catch it a beat sooner (they live on the edge).
    const reaction = 0.16 * (1 - skill01) * (disc === 'street' ? 0.8 : 1);
    if (raceTime - state.lastSlideReact >= reaction) {
      state.lastSlideReact = raceTime;
      // Counter the dominant motion: the body-slip sign (lateral slide) or the
      // yaw sign (rotation) — whichever is stronger.
      const slideSign =
        Math.abs(car.slipAngle) > Math.abs(car.yawRate) * 0.6
          ? Math.sign(car.slipAngle || 1)
          : Math.sign(car.yawRate || 1);
      const catchQuality = 0.45 + 0.7 * skill01;
      steer = Math.max(-0.7, Math.min(0.7, steer - slideSign * catchQuality));
      desiredThrottle = Math.min(desiredThrottle, 0.25);
    }
  }

  rollMistake(state, driver, raceTime, rng, rain, car.gripUsage > 0.9);

  const tag: BrainIntentTag = car.spinRemaining > 0 ? 'SPIN_SCRUB' : braking ? 'BRAKE_FOR_CORNER' : 'FULL_SEND';
  state.lastIntentTag = tag;
  state.prevSlotMode = car.slotMode;
  state.prevAlphaRear = car.alphaRear;

  return {
    desiredThrottle,
    desiredBrake,
    lTarget: lineT,
    steerTarget: steer,
    steer,
    intent: makeIntent(tag),
  };
}

/** Neutral brain output for pre-race. */
export function computeKBrake(_driver: Driver, _stack: readonly import('../modifiers').Modifier[], _ctx: ModifierContext): number {
  return 1.2;
}
