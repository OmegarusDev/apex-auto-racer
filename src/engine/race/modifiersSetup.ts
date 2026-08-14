import { BALANCE } from '../../data/balance';
import { PARTS } from '../../data/parts';
import type { Modifier } from '../modifiers';
import { addModifier, createModifierStack } from '../modifiers';
import { randRange, type Rng } from '../rng';
import type { Driver, VehicleParts } from '../types';
import { emptyVehicleParts } from '../types';

export function clampStat(v: number): number {
  return Math.max(1, Math.min(100, v));
}

export function applyLooseCannon(driver: Driver, rng: Rng): Driver {
  if (driver.trait !== 'looseCannon') return driver;
  const jitter = (): number => Math.round(randRange(rng, -10, 10));
  return {
    ...driver,
    skill: clampStat(driver.skill + jitter()),
    bravery: clampStat(driver.bravery + jitter()),
    focus: clampStat(driver.focus + jitter()),
    determination: clampStat(driver.determination + jitter()),
  };
}

export function buildRainStack(rain: boolean): Modifier[] {
  const stack = createModifierStack();
  if (rain) {
    // muSurface rain factor is applied once on RaceDirector.muSurface (profiles + vehicle).
    // Do not also mul muSurface here — that squared wet grip and auto-spun early races.
    addModifier(stack, {
      source: 'rain',
      targetParam: 'mistakeRate',
      op: 'mul',
      value: BALANCE.rainMistakeMult,
    });
  }
  return stack;
}

export function buildTraitStack(driver: Driver): Modifier[] {
  const stack = createModifierStack();
  if (driver.trait === 'slipstreamer') {
    addModifier(stack, {
      source: 'trait:slipstreamer',
      targetParam: 'draft',
      op: 'mul',
      value: 1.65,
    });
  }
  return stack;
}

export function mergeModifierStacks(...stacks: readonly Modifier[][]): Modifier[] {
  const out = createModifierStack();
  for (const stack of stacks) {
    for (const mod of stack) out.push(mod);
  }
  return out;
}

/**
 * Opponent loadout: strength biases toward the top of the rank band, with
 * per-part jitter so the field is not uniform scrap / uniform rockets.
 */
export function generateOpponentParts(
  rng: Rng,
  range: [number, number],
  strength01 = 0.5,
): VehicleParts {
  const parts = emptyVehicleParts(0);
  const [lo, hi] = range;
  const span = hi - lo;
  for (const part of PARTS) {
    if (span <= 0) {
      parts[part.id] = lo;
      continue;
    }
    // The car tracks its driver tightly — a strong driver lands near the top
    // of the band, a weak one near the bottom (no genius-in-a-shitbox), with
    // small variance for a human read. Low-jitter keeps it coherent.
    const center = lo + span * (0.3 + 0.65 * strength01);
    const jitter = (rng() - 0.5) * span * 0.2;
    parts[part.id] = Math.max(lo, Math.min(hi, Math.round(center + jitter)));
  }
  return parts;
}
