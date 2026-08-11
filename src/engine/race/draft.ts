import { BALANCE } from '../../data/balance';
import { PHYSICS } from '../../data/physics';
import { interpolateAtSInto } from '../RacingLine';
import type { TrackData } from '../TrackGenerator';
import { computeSDet } from '../Vehicle';
import { arcGap, nodeScratch } from './trackMath';
import type { RaceCarEntry } from './types';

/**
 * Slipstream: tow from a car ahead when aligned on a straight.
 * Fades with lateral offset and corner curvature (Scalextric wake).
 */
export function computeDraft(
  idx: number,
  entries: readonly RaceCarEntry[],
  trackLength: number,
  track: TrackData,
  determination: number,
  position: number,
  totalCars: number,
): number {
  const car = entries[idx]!.car;
  const node = interpolateAtSInto(track.nodes, trackLength, car.s, nodeScratch);
  const kappaAbs = Math.abs(node.kappaLine);
  // Corners kill the tow; mild bends still allow a trickle.
  const cornerFade = Math.max(
    0,
    1 - kappaAbs / Math.max(PHYSICS.draftCornerKappa, 1e-3),
  );
  if (cornerFade <= 0.05) return 0;

  let best = 0;
  for (let j = 0; j < entries.length; j++) {
    if (j === idx) continue;
    const other = entries[j]!.car;
    // Ribbon proximity reject before full race-distance gap.
    const ds = Math.abs(other.s - car.s);
    const wrapDs = Math.min(ds, trackLength - ds);
    if (wrapDs > BALANCE.draftGapMax) continue;
    const gap = arcGap(car, other, trackLength);
    if (gap <= 0 || gap > BALANCE.draftGapMax) continue;
    const lat = Math.abs(other.l - car.l);
    if (lat > BALANCE.draftLateralMax) continue;
    const align = 1 - lat / BALANCE.draftLateralMax;
    const gapFactor = 1 - gap / BALANCE.draftGapMax;
    const raw = gapFactor * align * cornerFade;
    if (raw > best) best = raw;
  }

  // Determination harvests the wake harder when chasing (catch-up RPG).
  const chase =
    totalCars > 1 ? (position - 1) / (totalCars - 1) : 0;
  const detMul = 1 + PHYSICS.draftDetBonus * (determination / 100) * chase;
  // Mild sDet echo so mid-pack fighters feel the tow more.
  const sDet = computeSDet(determination, position, totalCars);
  return Math.min(1.15, best * detMul * (0.92 + 0.08 * sDet));
}
