import { BALANCE } from '../data/balance';
import { generateDriver } from '../engine/DriverGenerator';
import { mulberry32 } from '../engine/rng';
import type { Driver, GameState } from '../engine/types';

export function findDriver(state: GameState, id: string): Driver | undefined {
  return state.roster.find((d) => d.id === id);
}

export function defaultLineup(state: GameState, count: number): string[] {
  return state.roster.slice(0, count).map((d) => d.id);
}

export function defaultLeadDriver(state: GameState, lineup: string[]): string {
  return lineup[0] ?? state.roster[0]?.id ?? '';
}
export function generateFreeAgents(state: GameState, rerollOffset = 0): Driver[] {
  const rank = Math.max(state.rankUnlocked.track, state.rankUnlocked.street, state.rankUnlocked.rally);
  const baseMin = BALANCE.freeAgentStatBase[0] + rank * BALANCE.freeAgentStatPerRank;
  const baseMax = Math.min(BALANCE.freeAgentStatCap, BALANCE.freeAgentStatBase[1] + rank * BALANCE.freeAgentStatPerRank);
  const rng = mulberry32((state.seed + rerollOffset * 7919) >>> 0);
  const used = new Set(state.roster.map((d) => d.name));
  const agents: Driver[] = [];
  for (let i = 0; i < BALANCE.freeAgentPoolSize; i++) {
    agents.push(generateDriver(rng, baseMin * 4, baseMax * 4, used));
  }
  return agents;
}
