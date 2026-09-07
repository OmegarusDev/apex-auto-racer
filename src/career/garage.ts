import { BALANCE } from '../data/balance';
import { PARTS, partCost } from '../data/parts';
import type { PartCategory } from '../data/parts';
import type { DisciplineId } from '../data/disciplines';
import { getGameContext } from '../engine/GameContext';
import { effectiveStats } from '../engine/stats';
import { getTrait } from '../data/traits';
import type { Driver, GameState, VehicleSave } from '../engine/types';
import { xpToNextLevel } from './xp';

export function repairVehicle(state: GameState, discipline: DisciplineId): boolean {
  const vehicle = state.vehicles[discipline];
  const pts = Math.max(0, Math.ceil((BALANCE.conditionMax - vehicle.condition) * 100));
  if (pts <= 0) return false;
  const cost = pts * BALANCE.repairCostPerPoint;
  if (state.cash < cost) return false;
  state.cash -= cost;
  vehicle.condition = BALANCE.conditionMax;
  state.repairedSinceLastRace[discipline] = true;
  getGameContext().autosave();
  return true;
}

export function buyPartTier(state: GameState, discipline: DisciplineId, part: PartCategory): boolean {
  const vehicle = state.vehicles[discipline];
  const tier = vehicle.partTiers[part] ?? 0;
  if (tier >= BALANCE.maxPartTier) return false;
  const cost = partCost(PARTS.find((p) => p.id === part)!.baseCost, tier + 1);
  if (state.cash < cost) return false;
  state.cash -= cost;
  vehicle.partTiers[part] = tier + 1;
  getGameContext().autosave();
  return true;
}

export function vehicleRadarValues(discipline: DisciplineId, vehicle: VehicleSave) {
  const stats = effectiveStats(discipline, vehicle.partTiers, vehicle.condition);
  return {
    topSpeed: stats.topSpeed,
    acceleration: stats.acceleration,
    braking: stats.braking,
    grip: stats.grip,
    downforce: stats.downforce,
  };
}

export function driverSpendData(driver: Driver) {
  const trait = getTrait(driver.trait);
  return {
    name: driver.name,
    trait: trait.name,
    traitDescription: trait.description,
    skill: driver.skill,
    bravery: driver.bravery,
    focus: driver.focus,
    determination: driver.determination,
    unspentPoints: driver.unspentPoints,
    level: driver.level,
    xp: driver.xp,
    xpToNext: xpToNextLevel(driver.level),
  };
}

/** Human-readable per-tier effect list for a part. */
export function partInfoText(part: PartCategory): string {
  if (part === 'clutch') {
    return 'Slower clunk at stock · upgrades make a tap-and-release shift.';
  }
  if (part === 'gearbox') {
    return 'Faster, cleaner gear changes per tier.';
  }
  if (part === 'differential') {
    return 'Tighter limited-slip lock per tier.';
  }
  if (part === 'suspension') {
    return 'Stiffer load transfer · lower CG · quieter line per tier.';
  }
  if (part === 'tyres') {
    return '+5 Grip (tyre µ) per tier.';
  }
  const def = PARTS.find((p) => p.id === part);
  if (def === undefined) return '';
  const bits: string[] = [];
  if (def.perTier.topSpeed !== undefined) {
    bits.push(`${signed(def.perTier.topSpeed)} Top Speed`);
  }
  if (def.perTier.acceleration !== undefined) {
    bits.push(`${signed(def.perTier.acceleration)} Accel`);
  }
  if (def.perTier.braking !== undefined) {
    bits.push(`${signed(def.perTier.braking)} Braking`);
  }
  if (def.perTier.grip !== undefined) {
    bits.push(`${signed(def.perTier.grip)} Grip`);
  }
  if (def.perTier.downforce !== undefined) {
    bits.push(`${signed(def.perTier.downforce)} Downforce`);
  }
  return bits.length > 0 ? `${bits.join(' · ')} per tier.` : '';
}

function signed(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

/**
 * Buy a tier and report what changed. Single source of truth for purchase
 * feedback across Tuning and Results.
 */
export function buyPartWithDelta(
  state: GameState,
  discipline: DisciplineId,
  part: PartCategory,
): { bought: boolean; summary: string } {
  const vehicle = state.vehicles[discipline];
  const before = effectiveStats(discipline, vehicle.partTiers, vehicle.condition);
  const name = PARTS.find((p) => p.id === part)?.name ?? 'Part';
  if (!buyPartTier(state, discipline, part)) {
    return { bought: false, summary: '' };
  }
  const after = effectiveStats(discipline, vehicle.partTiers, vehicle.condition);
  const dGrip = after.gripFactor - before.gripFactor;
  const dV = after.vMax - before.vMax;
  const dSweet = after.clutchSweet - before.clutchSweet;
  const dDelay = after.clutchBiteDelay - before.clutchBiteDelay;
  const dShift = after.shiftTime - before.shiftTime;
  const bits: string[] = [];
  if (Math.abs(dGrip) >= 0.001) {
    bits.push(`grip ${dGrip >= 0 ? '+' : ''}${dGrip.toFixed(3)}`);
  }
  if (Math.abs(dV) >= 0.05) {
    bits.push(`vMax ${dV >= 0 ? '+' : ''}${dV.toFixed(1)}`);
  }
  if (Math.abs(dDelay) >= 0.005) {
    bits.push(`delay ${dDelay >= 0 ? '+' : ''}${Math.round(dDelay * 1000)}ms`);
  }
  if (Math.abs(dSweet) >= 0.005) {
    bits.push(`bite ${dSweet >= 0 ? '+' : ''}${Math.round(dSweet * 1000)}ms`);
  }
  if (Math.abs(dShift) >= 0.005) {
    bits.push(`shift ${dShift >= 0 ? '+' : ''}${dShift.toFixed(2)}s`);
  }
  return {
    bought: true,
    summary: bits.length > 0 ? `${name}: ${bits.join(' · ')}` : `${name} upgraded`,
  };
}
