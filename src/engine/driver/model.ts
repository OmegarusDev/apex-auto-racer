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
import { planPackCraft } from './packCraft';

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
  finished: boolean;
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
  /** Committed overtake side: -1 left, 1 right, 0 none. */
  overtakeSide: -1 | 0 | 1;
  /** Race time when the pull-out expires. */
  overtakeUntil: number;
  /** Race time until a defensive cover fades. */
  blockUntil: number;
  /** Last time the driver applied countersteer (reaction gating). */
  lastSlideReact: number;
  /**
   * Caution 0..1 after a wide run / spin — the driver carries a little less
   * corner speed until they compose. The racing line stays the groove.
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
    overtakeSide: 0,
    overtakeUntil: 0,
    blockUntil: 0,
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

const KAPPA_CORNER = 0.008;
/** Real opposite-way corner — not centreline wiggles that used to chop the look. */
const KAPPA_REVERSE = 0.02;

/**
 * Command curvature: at speed, turn in on this bend's peak; at crawl, wait
 * until the road has actually started. Never take an opposite-sign peak
 * (that's the following S-apex).
 */
function previewKappa(now: number, ahead: number, v: number): number {
  if (Math.abs(now) < KAPPA_CORNER) {
    const t = Math.max(0, Math.min(1, (v - 6) / 10));
    const w = t * t * (3 - 2 * t);
    return ahead * w;
  }
  if (Math.sign(now) !== Math.sign(ahead) && Math.abs(ahead) > KAPPA_REVERSE) return now;
  return Math.abs(ahead) >= Math.abs(now) ? ahead : now;
}

/** How far ahead the driver aims (m). Long enough to be smooth; short at crawl so a hairpin isn't skipped. */
function desiredLookaheadM(v: number, skill01: number): number {
  const tLook = 0.58 + 0.32 * skill01;
  const floor = Math.max(4.5, Math.min(16, 3.2 + v * 0.38));
  const ceiling = 20 + 24 * skill01;
  return Math.max(floor, Math.min(ceiling, v * tLook));
}

function nodeAtLook(
  track: TrackData,
  s0: number,
  dd: number,
  nodeStep: number,
): TrackData['nodes'][number] {
  const s = ((s0 + dd) % track.length + track.length) % track.length;
  const n = track.nodes.length;
  return track.nodes[Math.round(s / nodeStep) % n]!;
}

/**
 * Look along THIS corner: keep a race-speed horizon, stop only at a real
 * curvature reversal. Feedforward uses the peak same-sign κ in that window
 * (stable) instead of the κ at a jumping look-point (drunk weave).
 */
function lookAlongRoad(
  track: TrackData,
  s0: number,
  desired: number,
  nodeStep: number,
  startKappa: number,
): { lookM: number; kappaPeak: number } {
  let lookM = desired;
  let cornerSign = Math.abs(startKappa) > KAPPA_CORNER ? Math.sign(startKappa) : 0;
  let peak = startKappa;

  for (let dd = nodeStep; dd < desired; dd += nodeStep) {
    const sample = nodeAtLook(track, s0, dd, nodeStep);
    const mag = Math.abs(sample.kappa);
    const kSign = Math.sign(sample.kappa);

    if (cornerSign === 0) {
      if (mag > KAPPA_CORNER) {
        cornerSign = kSign;
        peak = sample.kappa;
      }
      continue;
    }

    if (mag > KAPPA_REVERSE && kSign !== 0 && kSign !== cornerSign) {
      lookM = Math.max(nodeStep * 2, dd);
      break;
    }
    if (kSign === cornerSign && mag > Math.abs(peak)) peak = sample.kappa;
  }

  return { lookM, kappaPeak: peak };
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
  // surface when already past the grip limit. A brief lift, never a line yank
  // off the groove.
  if (!overdriving) return;
  const focus01 = clamp01(driver.focus / 100);
  let rate = ((1 - focus01) * PHYSICS.mistakeBasePerSec * 0.2) * (rain ? BALANCE.rainMistakeMult : 1);
  rate = Math.min(rate, 0.03);
  if (rng() >= rate / 30) return;
  state.suppressBrakeUntil = raceTime + PHYSICS.mistakeBrakeSuppress * 0.4;
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

  // --- Mistake caution: compose after a moment, keep pointing at the groove ---
  // A wide run / spin shakes the driver: they carry a little less corner speed
  // until confidence returns. The line itself stays the personal groove.
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
    const look = Math.max(2.4, Math.min(10, v * 0.65 + 2.2));
    const steerRaw =
      Math.atan((gain * errNow) / look) - 0.18 * (car.dl / Math.max(v, 2.2));
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

  // Target speed from ideal line with skill-scaled perception (stable, not noisy).
  const percepErr = (1 - skill01) * 0.08;
  const vEst = idealVTarget * (1 - percepErr);
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
  const vTarget = Math.min(vEst * margin * (1 - 0.05 * state.shaken), idealVTarget);

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

  const pack = planPackCraft(state, car, ctx.rivals, {
    draft: ctx.draft,
    skill01,
    bravery01,
    raceTime,
    halfW,
    kappaAbs: Math.abs(node.kappaLine),
    aBrake: car.stats.aBrake,
    contactBlocked: ctx.contactBlocked,
  });
  const launching = raceTime < PHYSICS.aiLaunchSec;
  desiredBrake = Math.max(desiredBrake, launching ? pack.trafficBrake * 0.15 : pack.trafficBrake);
  // Contact-block braking only after the grid clears — and not while already
  // committed to a pull-out (that's the go-around, not a park-in-the-wake).
  if (ctx.contactBlocked && car.v < 14 && raceTime > PHYSICS.aiLaunchSec && !pack.pullingOut) {
    desiredBrake = Math.max(desiredBrake, 0.4);
  }

  // Groove target: personal racing line + pack offset. Grid-anchor holds the
  // starting column for the first stretch so launch doesn't yank across the pack.
  const anchorDist = PHYSICS.idealLine.gridAnchorDist;
  const blendedLineAt = (s: number): number => {
    const base = personalLineAt(car, track, s);
    const dsFromGrid = s - car.gridS;
    const dsNormalized = dsFromGrid < 0 ? dsFromGrid + track.length : dsFromGrid;
    let t = base;
    if (dsNormalized < anchorDist) {
      const w = 1 - dsNormalized / anchorDist;
      const blend = w * w * (3 - 2 * w); // smoothstep
      t = car.gridL * blend + base * (1 - blend);
    }
    t += pack.lineOffset;
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
    // Draft tow: commit in the wake — but if we're still in-lane on a slower
    // car, don't floor it into their gearbox. Pull-out keeps the power on.
    if (ctx.draft > 0.35) {
      if (pack.pullingOut || pack.trafficBrake < 0.22) desiredThrottle = 1;
      else desiredThrottle = Math.min(desiredThrottle, 0.72);
    }
    // Never stall: a crawl still commits enough power to roll. Do not wipe
    // the grip-budget at 2.9 m/s in a hairpin (that used to floor a U-turn).
    if (car.v < 1.6) desiredThrottle = Math.max(desiredThrottle, 0.55);
    // Hold the planned corner speed: zones brake for the approach, but once
    // in the bend don't keep accelerating past vTarget (that's how a crawl
    // entry still ran wide — grip-budget lagged the envelope).
    if (Math.abs(node.kappaLine) > KAPPA_CORNER && v > vTarget) {
      desiredThrottle = Math.min(desiredThrottle, 0.12);
    }
  }

  // Point at the groove: Ackermann for the path curvature (feedforward) plus
  // pursuit on lateral error. Feedforward is what actually turns the car in a
  // corner — offset-only pursuit is ~0 when already on the line, and the
  // tyres then generate no aY, so the ribbon rotates under a world-straight
  // velocity. The tyres still accept or refuse the turn.
  const wb = car.setup?.wheelbase ?? 2.7;
  // Anticipatory corner setup: drivers KNOW the track. Skill lengthens the
  // time-horizon; speed sets the metres. A 16–20 m floor at crawl looks PAST
  // a hairpin; a 4 m look at race speed hunts like a drunk.
  const nodeStep = track.nodes[1]!.s - track.nodes[0]!.s;
  const { lookM, kappaPeak } = lookAlongRoad(
    track,
    car.s,
    desiredLookaheadM(v, skill01),
    nodeStep,
    node.kappa,
  );
  // Road curvature, not the racing-line's swing (that can reverse at track-out).
  const kappaCmd = previewKappa(node.kappa, kappaPeak, v);
  // Mild offset-path correction only. Full 1/(1−κl) turns a 1 m sway into a
  // wheel fight — that's the drunk weave on an otherwise good line.
  const lFF = Math.max(-2.5, Math.min(2.5, car.l));
  const pathK = kappaCmd / Math.max(0.7, 1 - kappaCmd * lFF * 0.28);
  const steerFF = steerForKappa(wb, pathK, v, aGrip);
  const inBend = Math.abs(node.kappa) > KAPPA_CORNER;
  const pursueS = (car.s + lookM) % track.length;
  const lineTAhead = Math.max(-lineClamp, Math.min(lineClamp, blendedLineAt(pursueS)));
  const errLat = lineTAhead - car.l;
  // Long λ on the groove (low gain, no weave). Shorter only when packed/offline
  // so a pull-out still happens.
  const lam = Math.abs(errLat) > 1.35 ? Math.max(10, lookM * 0.5) : Math.max(lookM, 16);
  let steerPursuit = Math.atan((1.35 * errLat * wb) / (lam * lam));
  const steerCap = Math.atan((1.5 * aGrip * wb) / Math.max(v * v, 12));
  const steerFFCapped = Math.max(-steerCap, Math.min(steerCap, steerFF));
  // Soften line-chase that fights the road while we're ON the groove. Don't
  // hard-zero it — that step is another weave. Packed cars 2 m offline keep
  // the pull-out.
  if (
    inBend &&
    Math.abs(errLat) < 1.25 &&
    Math.sign(steerPursuit) !== 0 &&
    Math.sign(steerFFCapped) !== 0 &&
    Math.sign(steerPursuit) !== Math.sign(steerFFCapped)
  ) {
    steerPursuit *= 0.22;
  }
  const steerDamp = -0.16 * (car.dl / Math.max(v, 6));
  let steer = Math.max(-0.7, Math.min(0.7, steerFFCapped + steerPursuit + steerDamp));
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

  // Skill: rate limit (neuromuscular). No per-tick steer noise — that fights
  // the groove feedforward every frame and looks like a drunk line.
  const speedBoost = v < 15 ? 1.5 : 1;
  const rate = (2.6 + 1.9 * skill01) * speedBoost;
  steer = Math.max(
    state.prevSteer - rate * PHYSICS.dt * 4,
    Math.min(state.prevSteer + rate * PHYSICS.dt * 4, steer),
  );
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

  const tag: BrainIntentTag = pack.tag
    ?? (car.spinRemaining > 0 ? 'SPIN_SCRUB' : braking ? 'BRAKE_FOR_CORNER' : 'FULL_SEND');
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
