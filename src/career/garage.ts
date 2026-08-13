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
