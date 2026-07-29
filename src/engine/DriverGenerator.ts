import { BALANCE } from '../data/balance';
import { FIRST_NAMES, LAST_NAMES } from '../data/names';
import { TRAITS } from '../data/traits';
import type { TraitId } from '../data/traits';
import type { RankId } from '../data/balance';
import { randInt, pick } from './rng';
import type { Rng } from './rng';
import type { Driver } from './types';

let nextDriverId = 1;

function makeDriverId(): string {
  const id = `drv-${nextDriverId}`;
  nextDriverId += 1;
  return id;
}

/** Sync counter when loading saves (call from SaveManager if needed). */
export function syncDriverIdCounter(maxId: number): void {
  nextDriverId = Math.max(nextDriverId, maxId + 1);
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
  const [skill, bravery, focus, determination] = distributeBudget(rng, total).map(clampStat);
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

export function generateRoster(
  rng: Rng,
  count: number,
  budgetMin: number,
  budgetMax: number,
): Driver[] {
  const usedNames = new Set<string>();
  const roster: Driver[] = [];
  for (let i = 0; i < count; i++) {
    roster.push(generateDriver(rng, budgetMin, budgetMax, usedNames));
  }
  return roster;
}

/** Opponents scaled to rank tier stat budgets (plan 8.4). */
export function generateOpponents(rng: Rng, count: number, rank: RankId): Driver[] {
  const [statMin, statMax] = BALANCE.opponentStatRanges[rank] ?? BALANCE.opponentStatRanges[0]!;
  const budgetMin = statMin * 4;
  const budgetMax = statMax * 4;
  return generateRoster(rng, count, budgetMin, budgetMax);
}

export function hireCost(driver: Driver): number {
  return BALANCE.hireCostMultiplier * (driver.skill + driver.bravery + driver.focus + driver.determination);
}
