import { BALANCE } from '../data/balance';
import type { Driver } from '../engine/types';

export function xpToNextLevel(level: number): number {
  return Math.round(BALANCE.levelCostBase * Math.pow(BALANCE.levelCostGrowth, level - 1));
}

export function grantXp(
  driver: Driver,
  amount: number,
): { leveledUp: boolean; levelsGained: number } {
  driver.xp += amount;
  let levelsGained = 0;
  let needed = xpToNextLevel(driver.level);
  // Keep applying level-ups until the overflow settles — a big haul can cross
  // more than one threshold, and XP past the next level must not be discarded.
  while (driver.xp >= needed && driver.level < 100) {
    driver.xp -= needed;
    driver.level += 1;
    driver.unspentPoints += 1;
    levelsGained += 1;
    needed = xpToNextLevel(driver.level);
  }
  return { leveledUp: levelsGained > 0, levelsGained };
}

export function spendStatPoint(driver: Driver, stat: keyof Pick<Driver, 'skill' | 'bravery' | 'focus' | 'determination'>): boolean {
  if (driver.unspentPoints <= 0) return false;
  if (driver[stat] >= 100) return false;
  driver.unspentPoints -= 1;
  driver[stat] = Math.min(100, driver[stat] + BALANCE.skillPointStatGain);
  return true;
}
