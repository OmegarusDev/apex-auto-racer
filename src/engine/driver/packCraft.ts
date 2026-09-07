/**
 * Pack craft — draft, overtake, and block by biasing the groove the driver
 * already steers toward. Tyres still decide whether the offset holds.
 * Not a chassis magnet.
 */
import { BALANCE } from '../../data/balance';
import { PHYSICS } from '../../data/physics';
import type { BrainIntentTag } from '../BrainIntent';
import type { BrainState, RivalSnapshot } from './model';
import type { CarSimState } from '../vehicle/types';

const SAME_LANE = PHYSICS.carWidth * 0.85;
const LOOK_AHEAD = 20;
const LOOK_BEHIND = 14;

export interface PackPlan {
  /** Added to the personal-line target (m). Same offset at lookahead. */
  lineOffset: number;
  trafficBrake: number;
  pullingOut: boolean;
  blocking: boolean;
  drafting: boolean;
  tag: BrainIntentTag | null;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function aheadRivals(rivals: readonly RivalSnapshot[]): RivalSnapshot[] {
  const out: RivalSnapshot[] = [];
  for (const r of rivals) {
    if (r.finished) continue;
    const centerGap = r.arcGap + PHYSICS.carLength;
    if (centerGap <= 0) continue;
    if (r.arcGap > LOOK_AHEAD) continue;
    out.push(r);
  }
  return out;
}

function closestSameLaneAhead(
  rivals: readonly RivalSnapshot[],
): RivalSnapshot | null {
  let best: RivalSnapshot | null = null;
  for (const r of aheadRivals(rivals)) {
    if (Math.abs(r.lateralSep) > SAME_LANE) continue;
    if (best === null || r.arcGap < best.arcGap) best = r;
  }
  return best;
}

function closestHunter(
  rivals: readonly RivalSnapshot[],
): RivalSnapshot | null {
  let best: RivalSnapshot | null = null;
  for (const r of rivals) {
    if (r.finished) continue;
    const centerGap = r.arcGap + PHYSICS.carLength;
    if (centerGap >= 0) continue;
    if (r.arcGap < -LOOK_BEHIND) continue;
    if (best === null || r.arcGap > best.arcGap) best = r;
  }
  return best;
}

function sideRoom(
  car: CarSimState,
  rivals: readonly RivalSnapshot[],
  side: -1 | 1,
  halfW: number,
): number {
  let room = side > 0 ? halfW - car.l : halfW + car.l;
  room -= 1.1;
  for (const r of rivals) {
    if (r.finished) continue;
    if (r.arcGap < -4 || r.arcGap > LOOK_AHEAD) continue;
    if (Math.sign(r.lateralSep) !== side) continue;
    const sep = Math.abs(r.lateralSep);
    if (sep < 4.6) room -= Math.max(0, 3.4 - sep);
  }
  return room;
}

function pickOvertakeSide(
  car: CarSimState,
  rivals: readonly RivalSnapshot[],
  halfW: number,
  preferred: -1 | 0 | 1,
): -1 | 1 {
  if (preferred === -1 || preferred === 1) {
    if (sideRoom(car, rivals, preferred, halfW) > 1.4) return preferred;
  }
  const left = sideRoom(car, rivals, -1, halfW);
  const right = sideRoom(car, rivals, 1, halfW);
  if (right > left + 0.4) return 1;
  if (left > right + 0.4) return -1;
  return car.l >= 0 ? 1 : -1;
}

/**
 * Time-gap follow distance plus a committed pull-out / cover-the-door plan.
 */
export function planPackCraft(
  state: BrainState,
  car: CarSimState,
  rivals: readonly RivalSnapshot[],
  opts: {
    draft: number;
    skill01: number;
    bravery01: number;
    raceTime: number;
    halfW: number;
    kappaAbs: number;
    aBrake: number;
    contactBlocked: boolean;
  },
): PackPlan {
  const {
    draft,
    skill01,
    bravery01,
    raceTime,
    halfW,
    kappaAbs,
    aBrake,
    contactBlocked,
  } = opts;

  const launching = raceTime < PHYSICS.aiLaunchSec;
  const threat = closestSameLaneAhead(rivals);
  const hunter = closestHunter(rivals);
  const closing = threat !== null ? car.v - threat.speed : 0;
  const tightCorner = kappaAbs > 0.02;
  const mildCorner = kappaAbs > 0.012;

  const holdNeed = BALANCE.overtakeHoldSec * (1.35 - 0.7 * skill01);
  const minClosing = 0.7 + 0.9 * (1 - bravery01);
  const draftReady =
    !launching &&
    draft > BALANCE.overtakeDraftThreshold &&
    state.draftHoldTime >= holdNeed &&
    threat !== null &&
    threat.arcGap < 16;
  const closingPass =
    !launching &&
    threat !== null &&
    !tightCorner &&
    closing > minClosing &&
    threat.arcGap < 14 &&
    Math.abs(threat.lateralSep) < SAME_LANE;
  const wreck =
    !launching && threat !== null && threat.deslotted && threat.arcGap < 16;
  const stuck =
    !launching &&
    contactBlocked &&
    threat !== null &&
    threat.arcGap < 10 &&
    !tightCorner;

  const wantPull = draftReady || closingPass || wreck || stuck;

  if (wantPull && state.overtakeSide === 0) {
    state.overtakeSide = pickOvertakeSide(car, rivals, halfW, 0);
  }
  if (wantPull) {
    const extra = wreck ? 1.1 : 0;
    state.overtakeUntil = Math.max(
      state.overtakeUntil,
      raceTime + BALANCE.overtakeDurationSec * 0.7 + extra,
    );
  }

  const committed = state.overtakeSide !== 0 && raceTime < state.overtakeUntil;
  // Stay out until the nose is clear — don't snap back into the gearbox.
  if (committed) {
    let stillPassing = false;
    for (const r of aheadRivals(rivals)) {
      if (
        r.arcGap < 10 &&
        r.speed <= car.v + 0.4 &&
        Math.abs(r.lateralSep) < 5
      ) {
        stillPassing = true;
        break;
      }
    }
    if (stillPassing) {
      state.overtakeUntil = Math.max(state.overtakeUntil, raceTime + 0.55);
    } else if (threat !== null && threat.arcGap < -PHYSICS.carLength * 0.35) {
      state.overtakeUntil = Math.min(state.overtakeUntil, raceTime + 0.4);
    }
  }

  if (raceTime >= state.overtakeUntil) {
    state.overtakeSide = 0;
  }
  const pullingOut = state.overtakeSide !== 0 && raceTime < state.overtakeUntil;
  const shiftScale = tightCorner ? 0.25 : mildCorner ? 0.62 : 1;
  let lineOffset = pullingOut
    ? state.overtakeSide * BALANCE.overtakeLateralShift * shiftScale
    : 0;

  let blocking = false;
  if (
    !launching &&
    !pullingOut &&
    hunter !== null &&
    hunter.speed > car.v + 0.6 &&
    Math.abs(hunter.lateralSep) > 0.7 &&
    Math.abs(hunter.lateralSep) < 4.8 &&
    skill01 > 0.22 &&
    !tightCorner
  ) {
    const cover = Math.sign(hunter.lateralSep) as -1 | 1;
    const coverAmt = BALANCE.overtakeLateralShift * (0.38 + 0.22 * skill01);
    lineOffset += cover * coverAmt * (mildCorner ? 0.55 : 1);
    blocking = true;
    state.blockUntil = raceTime + 0.8;
  } else if (raceTime >= state.blockUntil) {
    state.blockUntil = 0;
  } else if (!pullingOut) {
    blocking = true;
  }

  const maxOff = Math.max(1.2, halfW - 1.35);
  lineOffset = clamp(lineOffset, -maxOff, maxOff);

  const drafting = draft > 0.22 && threat !== null && Math.abs(threat.lateralSep) < BALANCE.draftLateralMax + 0.4;

  // Follow gap: shorter while committed to a pass so they don't just park in the wake.
  const skillCushion = 1 + BALANCE.followSkillGapSpan * (1 - skill01);
  const timeGap = BALANCE.followTimeGap * skillCushion * (pullingOut ? 0.55 : 1);
  let trafficBrake = 0;
  for (const r of aheadRivals(rivals)) {
    const lane = Math.abs(r.lateralSep);
    if (lane > 2.6) continue;
    const desired = Math.max(BALANCE.followMinGap, car.v * timeGap);
    const gap = r.arcGap;
    if (gap <= 1.4 && lane < 1.8) {
      trafficBrake = Math.max(trafficBrake, 1);
    } else if (gap < desired + 4) {
      const closingR = car.v - r.speed;
      if (closingR > 0.25 || gap < desired) {
        const need = (desired + 1.2 - gap) / Math.max(desired, 1);
        const fromClose = closingR > 0 ? closingR / Math.max(aBrake, 4) : 0;
        const scale = pullingOut && lane > 1.35 ? 0.35 : 1;
        trafficBrake = Math.max(trafficBrake, Math.min(1, Math.max(need, fromClose) * scale));
      }
    }
  }

  let tag: BrainIntentTag | null = null;
  if (wreck && pullingOut) tag = 'AVOID_WRECK';
  else if (pullingOut) tag = 'PULL_OUT';
  else if (blocking) tag = 'BLOCK';
  else if (drafting && !pullingOut) tag = 'DRAFT_HOLD';

  return {
    lineOffset,
    trafficBrake,
    pullingOut,
    blocking,
    drafting,
    tag,
  };
}
