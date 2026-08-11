import { BALANCE } from '../data/balance';
import { FORMATS } from '../data/formats';
import type { DisciplineId } from '../data/disciplines';
import type { RaceConfig } from '../engine/RaceDirector';
import type { Driver, GameState } from '../engine/types';

export interface RaceLaunchConfig {
  discipline: DisciplineId;
  trackSeed: number;
  raceSeed: number;
  laps: number;
  formatId: string;
  playerLineup: string[];
  leadDriverId: string;
  mode: 'quick' | 'tournament';
  tournamentDefId?: string;
  again?: boolean;
  /** Where Results Back should land — Title for Quick Race, Campaign otherwise. */
  returnTo?: 'title' | 'campaign';
}

export function buildRaceConfig(state: GameState, launch: RaceLaunchConfig): RaceConfig {
  const format = FORMATS.find((f) => f.id === launch.formatId) ?? FORMATS[0]!;
  const playerTeamDrivers = launch.playerLineup
    .map((id) => state.roster.find((d) => d.id === id))
    .filter((d): d is Driver => d !== undefined);

  const unlocked = Math.max(
    state.rankUnlocked.track,
    state.rankUnlocked.street,
    state.rankUnlocked.rally,
    state.rankUnlocked[launch.discipline] ?? 0,
  );
  /**
   * Quick Race is a sparring challenge, not a soft tutorial field.
   * Floor at rank band 2 and nudge +1 above career unlock so early careers
   * still face upgraded cars and skilled drivers (tournament keeps true rank).
   */
  const rank =
    launch.mode === 'quick'
      ? Math.min(5, Math.max(unlocked + 1, 2))
      : unlocked;
  const statRange = BALANCE.opponentStatRanges[rank] ?? BALANCE.opponentStatRanges[0]!;
  const opponentBudget: [number, number] = [statRange[0] * 4, statRange[1] * 4];
  const opponentPartRange = BALANCE.opponentPartTiers[rank] ?? BALANCE.opponentPartTiers[0]!;

  let opponentDrivers: Driver[] | undefined;
  if (launch.mode === 'tournament') {
    const progress = state.inProgressTournaments[launch.discipline];
    if (progress !== null) {
      opponentDrivers = progress.opponentDrivers;
    }
  }

  return {
    discipline: launch.discipline,
    trackSeed: launch.trackSeed,
    raceSeed: launch.raceSeed,
    laps: launch.laps,
    format,
    playerTeamDrivers,
    leadDriverId: launch.leadDriverId,
    playerVehicle: state.vehicles[launch.discipline],
    opponentBudget,
    opponentPartRange,
    isTournament: launch.mode === 'tournament',
    opponentDrivers,
  };
}

