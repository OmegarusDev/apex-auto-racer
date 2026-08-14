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

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Max |κ| over the lookahead window (sampled on track nodes). */
function kappaAhead(track: TrackData, s: number, dist: number): { kappa: number; distance: number } {
  let best = 0;
  let bestDist = dist;
  const n = track.nodes.length;
  let idx = 0;
  for (let i = 0; i < n; i++) {
    if (track.nodes[i]!.s <= s) idx = i;
  }
  let travelled = 0;
  for (let step = 0; step < n && travelled < dist; step++) {
    const node = track.nodes[idx]!;
    const k = Math.abs(node.kappaLine);
    if (k > best) {
      best = k;
      bestDist = travelled;
    }
    const next = track.nodes[(idx + 1) % n]!;
    let ds = next.s - node.s;
    if (ds <= 0) ds += track.length;
    travelled += ds;
    idx = (idx + 1) % n;
  }
  return { kappa: best, distance: bestDist };
}

/** The driver's estimate of the car's lateral grip accel — MUST match the sim's
 *  live µ (ctx.muSurface already carries the rain multiplier). */
function gripEstimate(car: CarSimState, muSurface: number, tempGrip: number): number {
  const mu = muSurface * (car.setup?.compoundMu ?? 1) * tempGrip;
  return mu * G;
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
): void {
  const focus01 = clamp01(driver.focus / 100);
  let rate = ((1 - focus01) * PHYSICS.mistakeBasePerSec * 0.6) * (rain ? BALANCE.rainMistakeMult : 1);
  rate = Math.min(rate, 0.06);
  if (rng() >= rate / 30) return;
  if (rng() < 0.5) {
    state.suppressBrakeUntil = raceTime + PHYSICS.mistakeBrakeSuppress;
  } else {
    state.mistakeLShift = (rng() < 0.5 ? -1 : 1) * PHYSICS.mistakeLateralShift;
    state.mistakeLUntil = raceTime + PHYSICS.mistakeLateralDuration;
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
  state.prevSlotMode = car.slotMode;

  const node = interpolateAtSInto(track.nodes, track.length, car.s, nodeScratch);
  const halfW = node.width / 2;
  const lineClamp = halfW - PHYSICS.racingLineMargin;
  const v = Math.max(0, car.v);
  const tempGrip = tyreTempGrip(car.tyreTemp);
  const aGrip = gripEstimate(car, ctx.muSurface ?? SURFACES[disc].mu, tempGrip);

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
    // Running wide / sliding: back off, aim at the line ahead (pure pursuit).
    const lineT = Math.max(-lineClamp, Math.min(lineClamp, personalLineAt(car, track, car.s)));
    const lookS = (car.s + 18) % track.length;
    const lineTAhead = Math.max(
      -lineClamp,
      Math.min(lineClamp, personalLineAt(car, track, lookS)),
    );
    const errLat = lineTAhead - (car.l + 18 * Math.sin(car.slipAngle));
    const steerCapR = Math.atan((G * (car.setup?.wheelbase ?? 2.7)) / Math.max(v * v, 18));
    const steer = Math.max(
      -steerCapR,
      Math.min(
        steerCapR,
        Math.atan((2 * errLat * (car.setup?.wheelbase ?? 2.7)) / (18 * 18)) - car.dl * 0.2,
      ),
    );
    const throttle = Math.abs(car.slipAngle) > 0.5 ? 0.5 : 0.8;
    return {
      desiredThrottle: throttle,
      desiredBrake: 0.05,
      lTarget: lineT,
      steerTarget: steer,
      steer,
      intent: makeIntent('REJOIN_CRAWL'),
    };
  }

  // --- Perception ---
  const lookahead = Math.max(12, Math.min(80, v * (0.9 + 0.9 * skill01) + 8));
  const ahead = kappaAhead(track, car.s, lookahead);
  // Long-range corner detection (also feeds the braking decision).
  const brakeAhead = kappaAhead(track, car.s, Math.max(110, v * 4));
  const brakeKappa = Math.max(ahead.kappa, brakeAhead.kappa);
  const kappaPeak = ahead.kappa;

  // Target speed from the real limit, with skill-scaled perception error.
  const percepErr = (1 - skill01) * 0.15;
  const vLimit = kappaPeak > 1e-3 ? Math.sqrt(aGrip / kappaPeak) : car.stats.vMax * 0.98;
  const vEst = vLimit * (1 + (rng() - 0.5) * percepErr);
  // Discipline-aware commitment: Rally's loose surface and Street's close
  // walls demand a more cautious margin than Track's open circuit.
  const discMargin = disc === 'rally' ? 0.86 : disc === 'street' ? 0.90 : 0.94;
  // Power caution: a car whose drive exceeds the surface grip (a powerful car
  // on loose) must corner with extra care or its exits break the rear loose.
  const driveCaution =
    disc === 'rally' ? Math.max(0, (car.stats.aAccel / G - aGrip / G) * 0.6) : 0;
  const margin = Math.max(
    0.74,
    Math.min(0.95, 0.74 + 0.16 * skill01 + 0.04 * bravery01 + state.conf * 0.03),
  ) * discMargin - driveCaution;
  // Tight-corner safety: hairpins (κ ≳ 0.02) get an extra margin — off the
  // racing line the car must follow the track's own (tighter) radius.
  const tightSafety = brakeKappa > 0.02 ? 0.9 : 1;
  const vTarget = Math.min(vEst * margin * tightSafety, vLimit);

  // --- Braking ---
  let desiredBrake = 0;
  // Brake as soon as the car is over the corner target — hard enough to be back
  // at vTarget by the corner. Rally brakes gentler: its surface µ drops under
  // braking load, so a hard brake just breaks the tyres loose.
  let braking = brakeKappa > 0.01 && v > vTarget;
  if (braking) {
    const overFrac = (v - vTarget) / Math.max(vTarget, 1);
    // Cut the brake off near the target — residual brake at vTarget was
    // overslowing into corners (brake→crawl→re-accelerate wobble). Above that
    // the full strength curve brakes hard on the approach.
    desiredBrake = overFrac < 0.05 ? 0 : Math.max(0, Math.min(1, 0.25 + overFrac * 1.1));
    if (disc === 'rally') desiredBrake *= 0.75;
    // Street's driftable compound can't take a hard brake — the rear breaks
    // loose into the walls. Gentle, spreading stops instead.
    if (disc === 'street') desiredBrake *= 0.85;
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
  const launching = raceTime < PHYSICS.gridHoldSec;
  desiredBrake = Math.max(desiredBrake, launching ? traffic * 0.15 : traffic);
  // Contact-block braking only after the grid clears — during launch it just
  // pins the pack against each other (start stalls).
  if (ctx.contactBlocked && car.v < 14 && raceTime > PHYSICS.gridHoldSec) {
    desiredBrake = Math.max(desiredBrake, 0.4);
  }

  // Target line (personal racing line + mistake wobble).
  const shaken = state.shaken;

  const baseLine = personalLineAt(car, track, car.s) + (raceTime < state.mistakeLUntil ? state.mistakeLShift : 0);
  // Grid hold: hold the starting column through launch, then ease to the line —
  // steering hard from the grid column at speed is what caused launch spins.
  let lineT: number;
  if (raceTime < PHYSICS.gridHoldSec * 1.2) {
    const t = Math.min(1, raceTime / (PHYSICS.gridHoldSec * 1.2));
    const eased = t * t * (3 - 2 * t);
    lineT = car.gridL * (1 - eased) + baseLine * eased;
  } else {
    lineT = baseLine;
  }
  // While shaken the line morphs toward the driver's own lane (their grid
  // column) — a wider, less aggressive drawing of the corner that keeps lane
  // separation instead of dragging both lanes into the center of the track.
  lineT = lineT * (1 - 0.7 * shaken) + car.gridL * 0.7 * shaken;
  lineT = Math.max(-lineClamp, Math.min(lineClamp, lineT));

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
  // Pure pursuit: aim at the racing line a lookahead ahead of the car, so the
  // recovery arcs in smoothly instead of yanking across the track.
  const lookS = (car.s + lookahead * 0.6) % track.length;
  const lineTAhead = Math.max(
    -lineClamp,
    Math.min(lineClamp, personalLineAt(car, track, lookS)),
  );
  const errLat = lineTAhead - (car.l + lookahead * Math.sin(car.slipAngle));
  // Kinematic pursuit: requested curvature = 2·err/λ² → steer angle for that arc.
  const lam = Math.max(lookahead, 14);
  const steerPursuit = Math.atan(
    (2 * errLat * (car.setup?.wheelbase ?? 2.7)) / (lam * lam),
  );
  // The wheels point where the Racer aims the nose (pure pursuit) plus a hint
  // of countersteer (the Racer reads its own slide) — and a SMALL lateral
  // damper that catches a momentum plow in a hairpin without erasing the drift
  // (the drift lives in the body slip, not the lateral velocity).
  const steerYaw = -0.15 * car.slipAngle;
  const steerDamp = -0.18 * (car.dl / Math.max(v, 6));
  let steer = Math.max(-0.6, Math.min(0.6, steerPursuit + steerYaw + steerDamp));
  // Grip-limited steering: at speed the tyres can only turn the car so hard
  // (max yaw ≈ grip/v). Demanding more just slides the front — a spin. This
  // is why full lock at 11 m/s spun the cars.
  const steerCap = Math.atan(
    (1.5 * G * (car.setup?.wheelbase ?? 2.7)) / Math.max(v * v, 18),
  );
  steer = Math.max(-steerCap, Math.min(steerCap, steer));
  // Threshold braking: while braking hard, keep the wheel almost straight —
  // braking and big steering together overload the front axle (understeer-wide).
  // The driver brakes in a line, then turns in once the speed is down.
  if (desiredBrake > 0.2) steer *= 1 - 0.55 * Math.min(1, desiredBrake - 0.2);

  // Skill: rate limit (neuromuscular) + tracking noise.
  const rate = 2.6 + 1.9 * skill01;
  steer = Math.max(
    state.prevSteer - rate * PHYSICS.dt * 4,
    Math.min(state.prevSteer + rate * PHYSICS.dt * 4, steer),
  );
  steer += (rng() - 0.5) * 0.06 * (1 - skill01);
  steer = Math.max(-0.6, Math.min(0.6, steer));
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
    const reaction = 0.28 * (1 - skill01) * (disc === 'street' ? 0.7 : 1);
    if (raceTime - state.lastSlideReact >= reaction) {
      state.lastSlideReact = raceTime;
      // Counter the dominant motion: the body-slip sign (lateral slide) or the
      // yaw sign (rotation) — whichever is stronger.
      const slideSign =
        Math.abs(car.slipAngle) > Math.abs(car.yawRate) * 0.6
          ? Math.sign(car.slipAngle || 1)
          : Math.sign(car.yawRate || 1);
      const catchQuality = 0.45 + 0.7 * skill01;
      steer = Math.max(-0.6, Math.min(0.6, steer - slideSign * catchQuality));
      desiredThrottle = Math.min(desiredThrottle, 0.25);
    }
  }

  rollMistake(state, driver, raceTime, rng, rain);

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
