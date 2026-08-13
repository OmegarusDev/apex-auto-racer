import { mulberry32, randInt } from '../engine/rng';

/**
 * Canonical per-race tournament seed. Single source of truth shared by the
 * campaign resume path (CampaignScene) and the results "Next Race" path
 * (buildResultsPayload) so the same tournament race always plays identically
 * no matter how the player reaches it.
 */
export function tournamentRaceSeed(stateSeed: number, raceIndex: number): number {
  return randInt(mulberry32(stateSeed + raceIndex), 1, 0x7fffffff);
}
