import { BALANCE } from '../data/balance';
import { FIRST_NAMES, LAST_NAMES } from '../data/names';
import { TRAITS } from '../data/traits';
import type { TraitId } from '../data/traits';
import type { RankId } from '../data/balance';
import { randInt, pick, shuffleInPlace } from './rng';
import type { Rng } from './rng';
import type { Driver } from './types';

let nextDriverId = 1;

/** Allocate the next unique `drv-N` id (shared across save + field generation). */
export function makeDriverId(): string {
  const id = `drv-${nextDriverId}`;
  nextDriverId += 1;
  return id;
}

/** Sync counter when loading saves or before generating a field against existing roster ids. */
export function syncDriverIdCounter(maxId: number): void {
  nextDriverId = Math.max(nextDriverId, maxId + 1);
}

/** Raise the counter above every `drv-N` id in the given drivers. */
export function syncDriverIdsFrom(drivers: readonly { id: string }[]): void {
  let max = 0;
  for (const d of drivers) {
    const m = /^drv-(\d+)$/.exec(d.id);
    if (m !== null) max = Math.max(max, Number(m[1]));
  }
  syncDriverIdCounter(max);
}

function pickUniqueName(rng: Rng, used: Set<string>): string {
  for (let attempt = 0; attempt < 64; attempt++) {
    const name = `${pick(rng, FIRST_NAMES)} ${pick(rng, LAST_NAMES)}`;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  const fallback = `${pick(rng, FIRST_NAMES)} ${pick(rng, LAST_NAMES)} ${randInt(rng, 2, 99)}`;
  used.add(fallback);
  return fallback;
}

function distributeBudget(rng: Rng, total: number): [number, number, number, number] {
  const weights = [
    rng() + 0.1,
    rng() + 0.1,
    rng() + 0.1,
    rng() + 0.1,
  ];
  const wSum = weights[0]! + weights[1]! + weights[2]! + weights[3]!;
  const raw = weights.map((w) => Math.round((w / wSum) * total));
  let sum = raw[0]! + raw[1]! + raw[2]! + raw[3]!;
  while (sum < total) {
    const idx = randInt(rng, 0, 3);
    if (raw[idx]! < 100) {
      raw[idx]! += 1;
      sum += 1;
    }
  }
  while (sum > total) {
    const idx = randInt(rng, 0, 3);
    if (raw[idx]! > 1) {
      raw[idx]! -= 1;
      sum -= 1;
    }
  }
  return [raw[0]!, raw[1]!, raw[2]!, raw[3]!];
}

function clampStat(v: number): number {
  return Math.max(1, Math.min(100, v));
}

/** Plan 8.5: collision-avoided name, budget-range stats, uniform trait. */
export function generateDriver(
  rng: Rng,
  budgetMin: number,
  budgetMax: number,
  usedNames: Set<string>,
): Driver {
  const total = randInt(rng, budgetMin, budgetMax);
  // Per-stat floor scales with band — no skill-11 "dead" cars in mid budgets.
  const statFloor = Math.max(16, Math.min(40, Math.round(budgetMin / 9)));
  let [skill, bravery, focus, determination] = distributeBudget(rng, total).map(clampStat);
  const stats = [skill, bravery, focus, determination];
  let deficit = 0;
  for (let i = 0; i < 4; i++) {
    if (stats[i]! < statFloor) {
      deficit += statFloor - stats[i]!;
      stats[i] = statFloor;
    }
  }
  // Steal overflow from the highest stats so totals stay near budget.
  while (deficit > 0) {
    let hi = 0;
    for (let i = 1; i < 4; i++) {
      if (stats[i]! > stats[hi]!) hi = i;
    }
    if (stats[hi]! <= statFloor) break;
    stats[hi]! -= 1;
    deficit -= 1;
  }
  skill = clampStat(stats[0]!);
  bravery = clampStat(stats[1]!);
  focus = clampStat(stats[2]!);
  determination = clampStat(stats[3]!);
  const trait = pick(rng, TRAITS).id as TraitId;

  return {
    id: makeDriverId(),
    name: pickUniqueName(rng, usedNames),
    trait,
    skill,
    bravery,
    focus,
    determination,
    xp: 0,
    level: 1,
    unspentPoints: 0,
  };
}

/**
 * Spread a field across [budgetMin, budgetMax] so races have backmarkers,
 * midfield, and standouts — not a flat random pack clustered in the middle.
 */
export function generateFieldDrivers(
  rng: Rng,
  count: number,
  budgetMin: number,
  budgetMax: number,
  usedNames?: Set<string>,
): Driver[] {
  const used = usedNames ?? new Set<string>();
  if (count <= 0) return [];

  const span = Math.max(0, budgetMax - budgetMin);
  const drivers: Driver[] = [];
  for (let i = 0; i < count; i++) {
    // Even percentiles + jitter; shuffle later so grid order ≠ strength order.
    const t = count === 1 ? rng() : i / (count - 1);
    // Mild curve: slightly more midfield mass, still hits both extremes.
    const shaped = t * t * (3 - 2 * t);
    const center = budgetMin + span * shaped;
    const jitter = Math.max(8, span * 0.14);
    const lo = Math.round(Math.max(budgetMin, center - jitter));
    const hi = Math.round(Math.min(budgetMax, center + jitter));
    drivers.push(generateDriver(rng, Math.min(lo, hi), Math.max(lo, hi), used));
  }
  shuffleInPlace(rng, drivers);
  return drivers;
}

export function generateRoster(
  rng: Rng,
  count: number,
  budgetMin: number,
  budgetMax: number,
): Driver[] {
  return generateFieldDrivers(rng, count, budgetMin, budgetMax);
}

/** Opponents scaled to rank tier — full within-band variance (plan 8.4). */
export function generateOpponents(rng: Rng, count: number, rank: RankId): Driver[] {
  const [statMin, statMax] = BALANCE.opponentStatRanges[rank] ?? BALANCE.opponentStatRanges[0]!;
  const budgetMin = statMin * 4;
  const budgetMax = statMax * 4;
  return generateFieldDrivers(rng, count, budgetMin, budgetMax);
}

/** 0..1 field strength from total budget vs rank band (for part loadout bias). */
export function driverStrength01(
  driver: Driver,
  budgetMin: number,
  budgetMax: number,
): number {
  const total = driver.skill + driver.bravery + driver.focus + driver.determination;
  if (budgetMax <= budgetMin) return 0.5;
  return Math.max(0, Math.min(1, (total - budgetMin) / (budgetMax - budgetMin)));
}

export function hireCost(driver: Driver): number {
  return BALANCE.hireCostMultiplier * (driver.skill + driver.bravery + driver.focus + driver.determination);
}
