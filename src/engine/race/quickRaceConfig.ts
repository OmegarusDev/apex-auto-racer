import { BALANCE } from '../../data/balance';
import { getDiscipline } from '../../data/disciplines';
import type { DisciplineId } from '../../data/disciplines';
import { FORMATS, formatsForRoster } from '../../data/formats';
import { effectiveStats } from '../stats';
import {
  buildSpeedProfiles,
  estimateLapTime,
  generateTrack,
} from '../TrackGenerator';
import {
  mulberry32,
  pick,
  randInt,
  randRange,
  shuffleInPlace,
  weightedPick,
} from '../rng';
import type { GameState } from '../types';
import { defaultVehicleSave } from '../types';
import type { RaceConfig } from '../RaceDirector';

/** Evenly spaced HSL hues for team identification. */
export function teamColor(teamId: number, teamCount: number): string {
  if (teamCount <= 0) return 'hsl(200, 70%, 55%)';
  const hue = Math.round((teamId * 360) / teamCount) % 360;
  return `hsl(${hue}, 70%, 55%)`;
}

export function quickRaceConfig(
  state: GameState,
  discipline: DisciplineId,
  raceSeed: number,
): RaceConfig {
  const rng = mulberry32(raceSeed);
  const eligible = formatsForRoster(state.roster.length);
  const format =
    eligible.length > 0
      ? weightedPick(
          rng,
          eligible.map((f) => ({ ...f, weight: f.weight })),
        )
      : FORMATS[0]!;

  const shuffledRoster = [...state.roster];
  shuffleInPlace(rng, shuffledRoster);
  const playerTeamDrivers = shuffledRoster.slice(0, format.teamSize);
  const leadDriverId = pick(rng, playerTeamDrivers).id;

  const rank = state.rankUnlocked[discipline] ?? 0;
  const highestRank = Math.max(
    state.rankUnlocked.track,
    state.rankUnlocked.street,
    state.rankUnlocked.rally,
  ) as 0 | 1 | 2 | 3 | 4 | 5;
  // Match buildRaceConfig Quick Race challenge floor (see raceTypes).
  const difficultyRank = Math.min(5, Math.max(Math.max(rank, highestRank) + 1, 2)) as
    | 0
    | 1
    | 2
    | 3
    | 4
    | 5;
  const statRange = BALANCE.opponentStatRanges[difficultyRank] ?? BALANCE.opponentStatRanges[0]!;
  const opponentBudget: [number, number] = [statRange[0] * 4, statRange[1] * 4];
  const opponentPartRange = BALANCE.opponentPartTiers[difficultyRank] ?? BALANCE.opponentPartTiers[0]!;

  const trackSeed = randInt(rng, 1, 0x7fffffff);
  const track = generateTrack(trackSeed, discipline);
  const refVehicle = state.vehicles[discipline] ?? defaultVehicleSave(BALANCE.startingPartTier);
  const refStats = effectiveStats(discipline, refVehicle.partTiers, refVehicle.condition);
  const mu = getDiscipline(discipline).muSurface;
  const { vProfile } = buildSpeedProfiles(track, refStats, mu);
  const lapTime = Math.max(estimateLapTime(track, vProfile), 1);
  const targetDuration = randRange(rng, BALANCE.quickRaceDurationMin, BALANCE.quickRaceDurationMax);
  const laps = Math.max(
    BALANCE.minLaps,
    Math.min(BALANCE.maxLaps, Math.round(targetDuration / lapTime)),
  );

  return {
    discipline,
    trackSeed,
    raceSeed,
    laps,
    format,
    playerTeamDrivers,
    leadDriverId,
    playerVehicle: refVehicle,
    opponentBudget,
    opponentPartRange,
  };
}
