/** Deslot margin / v_deslot — public seams for RaceDirector + feel gates. */
import { PHYSICS } from '../../data/physics';
import type { DisciplineId } from '../../data/disciplines';
import type { TrackData } from '../TrackGenerator';
import type { CarSimState } from './types';
import {
  enterDeslot as enterDeslotDyn,
  contactDeslot as contactDeslotDyn,
} from './deslotDynamics';

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
  const mCar = Math.sqrt(Math.max(0.5, tempGrip));
  return Math.max(1, vSafe * mDriver * mCar);
}

export function enterDeslot(
  car: CarSimState,
  kappa: number,
  vDeslot: number,
  discipline: DisciplineId = 'track',
): void {
  enterDeslotDyn(car, kappa, vDeslot, discipline);
}

export function contactDeslot(
  car: CarSimState,
  lateralPush: number,
  severity: number,
  discipline: DisciplineId = 'track',
): void {
  contactDeslotDyn(car, lateralPush, severity, discipline);
}

export { interpolateProfile };
