import { BALANCE } from '../data/balance';
import type { Driver } from '../engine/types';

export function xpToNextLevel(level: number): number {
  return Math.round(BALANCE.levelCostBase * Math.pow(BALANCE.levelCostGrowth, level - 1));
}

export function grantXp(driver: Driver, amount: number): boolean {
  driver.xp += amount;
  const needed = xpToNextLevel(driver.level);
  if (driver.xp >= needed) {
    driver.xp -= needed;
    driver.level += 1;
    driver.unspentPoints += 1;
    return true;
  }
  return false;
}

export function spendStatPoint(driver: Driver, stat: keyof Pick<Driver, 'skill' | 'bravery' | 'focus' | 'determination'>): boolean {
  if (driver.unspentPoints <= 0) return false;
  driver.unspentPoints -= 1;
  driver[stat] = Math.min(100, driver[stat] + BALANCE.skillPointStatGain);
  return true;
}
