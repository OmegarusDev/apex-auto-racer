import { getGameContext } from '../engine/GameContext';
import { createNewGame } from '../engine/SaveManager';
import { mulberry32 } from '../engine/rng';
import type { GameState } from '../engine/types';

/** Load save if present; otherwise create an in-memory roster without persisting. */
export function ensureQuickRaceState(): GameState {
  const g = getGameContext();
  if (g.state !== null) return g.state;
  const loaded = g.bootstrap();
  if (loaded !== null) return loaded;
  const seed = Date.now() >>> 0;
  const state = createNewGame(mulberry32(seed), seed);
  g.state = state; // setState only — does not autosave / wipe storage
  g.audio.setVolumes(state.options.volumes);
  return state;
}
