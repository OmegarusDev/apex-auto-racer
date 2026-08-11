import type { RivalSnapshot } from '../DriverBrain';
import { arcGap } from './trackMath';
import type { RaceCarEntry } from './types';

export function buildRivals(
  idx: number,
  entries: readonly RaceCarEntry[],
  trackLength: number,
): RivalSnapshot[] {
  const car = entries[idx]!.car;
  const rivals: RivalSnapshot[] = [];

  for (let j = 0; j < entries.length; j++) {
    if (j === idx) continue;
    const other = entries[j]!.car;
    rivals.push({
      arcGap: arcGap(car, other, trackLength),
      lateralSep: other.l - car.l,
      speed: other.v,
      s: other.s,
      l: other.l,
      deslotted: other.slotMode === 'deslot' || other.spinRemaining > 0,
    });
  }

  return rivals;
}
