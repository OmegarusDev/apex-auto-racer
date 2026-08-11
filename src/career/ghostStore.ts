import type { GhostTrace } from '../engine/RaceDirector';

let storedGhost: GhostTrace | null = null;
let storedGhostCarId: string | null = null;

export function storeGhostTrace(trace: GhostTrace, playerCarId: string): void {
  storedGhost = trace;
  storedGhostCarId = playerCarId;
}

export function loadGhostTrace(): { trace: GhostTrace; carId: string } | null {
  if (storedGhost === null || storedGhostCarId === null) return null;
  return { trace: storedGhost, carId: storedGhostCarId };
}

