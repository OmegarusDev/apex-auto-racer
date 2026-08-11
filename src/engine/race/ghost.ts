import type { GhostTrace } from '../RaceDirector';
import type { RaceCarEntry } from './types';

export const GHOST_MAX_SAMPLES_PER_CAR = 1500;

export function appendGhostSamples(
  entries: readonly RaceCarEntry[],
  ghostTrace: GhostTrace,
  raceTime: number,
): void {
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    // Player always; rivals only while under the hard sample cap.
    if (!entry.car.isPlayerControlled) {
      const rivalSamples = ghostTrace[i]!.samples.length;
      if (rivalSamples >= GHOST_MAX_SAMPLES_PER_CAR) continue;
    }
    const samples = ghostTrace[i]!.samples;
    if (samples.length >= GHOST_MAX_SAMPLES_PER_CAR) continue;
    samples.push({
      time: raceTime,
      s: entry.car.s,
      l: entry.car.l,
    });
  }
}
