/**
 * Rival personalities.
 *
 * Opponents are assigned a personality archetype that biases their core
 * driver stats (skill / bravery / focus / determination) — the same stats the
 * driver brain already reads. This makes rivals feel like distinct characters
 * on track (a late-braking Bulldog vs a metronomic Professor) rather than
 * statistically identical names.
 */
import type { Rng } from './rng';
import type { Driver } from './types';

export type PersonalityStat = 'skill' | 'bravery' | 'focus' | 'determination';

export interface RivalArchetype {
  id: string;
  name: string;
  blurb: string;
  /** Added to the generated stat (clamped to 1..100). */
  bias: Partial<Record<PersonalityStat, number>>;
}

export const RIVAL_ARCHETYPES: RivalArchetype[] = [
  {
    id: 'bulldog',
    name: 'Bulldog',
    blurb: 'Never yields a position — dives late and defends hard.',
    bias: { bravery: 18, focus: -8, determination: 6 },
  },
  {
    id: 'professor',
    name: 'Professor',
    blurb: 'Smooth and clinical — rarely puts a wheel wrong.',
    bias: { focus: 20, bravery: -6, skill: 4 },
  },
  {
    id: 'charger',
    name: 'Charger',
    blurb: 'All attack — hangs it out braking latest of all.',
    bias: { bravery: 16, skill: 8, focus: -4 },
  },
  {
    id: 'icevein',
    name: 'Ice Vein',
    blurb: 'Unflappable under pressure, grinds you down.',
    bias: { determination: 18, focus: 10, bravery: -4 },
  },
  {
    id: 'showman',
    name: 'Showman',
    blurb: 'Flashy and erratic — brilliant or binning it.',
    bias: { bravery: 12, focus: -12, skill: 2 },
  },
  {
    id: 'veteran',
    name: 'Veteran',
    blurb: 'Reads a race better than anyone — measured and quick.',
    bias: { skill: 10, determination: 12, focus: 4 },
  },
];

export function getArchetype(id: string): RivalArchetype | undefined {
  return RIVAL_ARCHETYPES.find((a) => a.id === id);
}

export function pickRivalArchetype(rng: Rng): RivalArchetype {
  return RIVAL_ARCHETYPES[Math.floor(rng() * RIVAL_ARCHETYPES.length)]!;
}

/** Apply an archetype's stat bias in place, clamped to the valid range. */
export function applyArchetype(driver: Driver, arch: RivalArchetype): void {
  for (const key of Object.keys(arch.bias) as PersonalityStat[]) {
    const delta = arch.bias[key] ?? 0;
    const next = Math.max(1, Math.min(100, (driver[key] ?? 0) + delta));
    driver[key] = next;
  }
  driver.archetype = arch.id;
}
