import { BALANCE } from '../data/balance';
import type { RankId } from '../data/balance';
import { FORMATS } from '../data/formats';
import { OBJECTIVES } from '../data/objectives';
import type { ObjectiveKind } from '../data/objectives';
import { TOURNAMENTS } from '../data/tournaments';
import type { DisciplineId } from '../data/disciplines';
import type { RaceConfig, RaceResult, GhostTrace } from './RaceDirector';
import type { Driver, GameState, TournamentStandingsEntry } from './types';

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
}

export interface RaceResultEntry {
  driverId: string;
  name: string;
  position: number;
  finishTime: number;
  teamId: number;
  isPlayer: boolean;
}

export interface PayoutBreakdown {
  base: number;
  placement: number;
  objective: number;
  handsOff: number;
  tournament: number;
  total: number;
}

export interface DriverXpGrant {
  driverId: string;
  xpEarned: number;
  leveledUp: boolean;
  newLevel?: number;
}

export interface ResultsPayload {
  config: RaceLaunchConfig;
  discipline: DisciplineId;
  formatLabel: string;
  playerPosition: number;
  playerTeamPosition: number;
  finishers: RaceResultEntry[];
  standings: TournamentStandingsEntry[];
  payout: PayoutBreakdown;
  driverXp: DriverXpGrant[];
  objectivesCompleted: ObjectiveKind[];
  handsOffRatio: number;
  handsOffBonus: number;
  rankUnlocked?: RankId;
  tournamentComplete?: boolean;
  tournamentRaceIndex?: number;
  tournamentRaceCount?: number;
  nextRaceConfig?: RaceLaunchConfig;
}

export interface ResultsSceneOptions {
  payload: ResultsPayload;
  tournamentMode: boolean;
}

/** Callback RaceScene invokes when a race finishes. */
export type RaceCompleteHandler = (payload: ResultsPayload) => void;

export interface RaceSceneLike {
  new (ctx: import('./GameContext').GameContext, config: RaceLaunchConfig): import('./SceneManager').Scene;
}

export interface RaceObjectiveStats {
  playerBrakeUsed: boolean;
  playerWallHits: number;
  playerSpinCount: number;
  playerDeslotCount: number;
  playerOvertakes: number;
  startGridPosition: number;
  vehicleConditionAtStart: number;
  vehicleRepairedBeforeRace: boolean;
}

/** Championship standings row count follows format.teamCount. */
export function buildTournamentStandings(
  teamCount: number,
  rivalNames?: readonly string[],
): TournamentStandingsEntry[] {
  const standings: TournamentStandingsEntry[] = [{ teamId: 0, points: 0, name: 'You' }];
  for (let t = 1; t < teamCount; t++) {
    const named = rivalNames?.[t - 1];
    standings.push({
      teamId: t,
      points: 0,
      name: named && named.length > 0 ? named : `Rival ${t}`,
    });
  }
  return standings;
}

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

export function buildRaceConfig(state: GameState, launch: RaceLaunchConfig): RaceConfig {
  const format = FORMATS.find((f) => f.id === launch.formatId) ?? FORMATS[0]!;
  const playerTeamDrivers = launch.playerLineup
    .map((id) => state.roster.find((d) => d.id === id))
    .filter((d): d is Driver => d !== undefined);

  const rank = Math.max(
    state.rankUnlocked.track,
    state.rankUnlocked.street,
    state.rankUnlocked.rally,
    state.rankUnlocked[launch.discipline] ?? 0,
  );
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

function xpToNextLevel(level: number): number {
  return Math.round(BALANCE.levelCostBase * Math.pow(BALANCE.levelCostGrowth, level - 1));
}

function evaluateObjectives(
  state: GameState,
  launch: RaceLaunchConfig,
  result: RaceResult,
  playerPosition: number,
  playerTeamWon: boolean,
  stats: RaceObjectiveStats,
  raceDuration: number,
): ObjectiveKind[] {
  const completed: ObjectiveKind[] = [];
  const handsOffRatio = raceDuration > 0 ? 1 - result.inputTime / raceDuration : 0;
  const leadDriver = state.roster.find((d) => d.id === launch.leadDriverId);
  const playerFinished = result.positions.some((p) => p.teamId === 0);

  for (const objId of state.objectives.active) {
    if (state.objectives.completed.includes(objId)) continue;

    let met = false;
    switch (objId) {
      case 'win_no_brake':
        met = playerPosition === 1 && !stats.playerBrakeUsed;
        break;
      case 'zero_wall_hits':
        met = playerFinished && stats.playerWallHits === 0;
        break;
      case 'podium_low_level':
        met = playerPosition <= 3 && (leadDriver?.level ?? 99) < 3;
        break;
      case 'win_hands_off':
        met = playerPosition === 1 && handsOffRatio >= 0.8;
        break;
      case 'finish_no_spin':
        met = playerPosition <= 3 && stats.playerSpinCount === 0;
        break;
      case 'podium_any':
        met = playerPosition <= 3;
        break;
      case 'win_rain':
        met = playerPosition === 1 && result.rain;
        break;
      case 'overtake_3':
        met = stats.playerOvertakes >= 3;
        break;
      case 'win_underdog':
        met = playerPosition === 1 && stats.startGridPosition > 2;
        break;
      case 'no_input_half':
        met = playerFinished && handsOffRatio >= 0.5;
        break;
      case 'repair_then_podium':
        met =
          playerPosition <= 3 &&
          (stats.vehicleRepairedBeforeRace || stats.vehicleConditionAtStart < BALANCE.conditionMax);
        break;
      case 'team_win':
        met = playerTeamWon && launch.playerLineup.length >= 2;
        break;
      case 'max_two_deslots':
        met = playerFinished && stats.playerDeslotCount <= 2;
        break;
      default:
        break;
    }

    if (met) completed.push(objId);
  }

  return completed;
}

function computePayout(
  rank: RankId,
  playerPosition: number,
  playerTeamPosition: number,
  totalCars: number,
  laps: number,
  handsOffRatio: number,
  objectivesCompleted: ObjectiveKind[],
  isTournament: boolean,
  tournamentBonus: number,
  playerTeamWon: boolean,
  playerCarPodiated: boolean,
): PayoutBreakdown {
  const rankBase = BALANCE.rankBasePayout[rank] ?? BALANCE.rankBasePayout[0]!;
  const placeForPayout = Math.min(playerTeamPosition, playerPosition);
  const placementIdx = Math.min(Math.max(placeForPayout - 1, 0), BALANCE.placementMult.length - 1);
  let placement = Math.round(rankBase * (BALANCE.placementMult[placementIdx] ?? 0.15));
  placement = Math.round(
    placement * (0.8 + 0.05 * totalCars) * (0.7 + 0.1 * laps),
  );
  if (playerCarPodiated) {
    placement = Math.round(placement * 1.1);
  }

  let objective = 0;
  for (const id of objectivesCompleted) {
    const def = OBJECTIVES.find((o) => o.id === id);
    objective += def?.reward ?? 0;
  }

  const handsOff = playerTeamWon
    ? Math.round(rankBase * BALANCE.handsOffBonusMax * handsOffRatio)
    : 0;
  const tournament =
    tournamentBonus > 0
      ? tournamentBonus
      : isTournament
        ? Math.round(rankBase * (BALANCE.tournamentRacePayoutMult - 1))
        : 0;

  return {
    base: 0,
    placement,
    objective,
    handsOff,
    tournament,
    total: placement + objective + handsOff + tournament,
  };
}

function computeDriverXp(
  state: GameState,
  launch: RaceLaunchConfig,
  teamPoints: number,
  rank: RankId,
  finishers: readonly RaceResultEntry[],
): DriverXpGrant[] {
  const baseXp =
    (BALANCE.xpBase + BALANCE.xpPerPoint * teamPoints) * (BALANCE.rankXpMult[rank] ?? 1);

  return launch.playerLineup.map((driverId) => {
    const driver = state.roster.find((d) => d.id === driverId);
    if (driver === undefined) {
      return { driverId, xpEarned: 0, leveledUp: false };
    }
    let xpMult = 1;
    if (driver.trait === 'grinder') xpMult *= 1.25;
    if (driver.trait === 'showboat') {
      const pos = finishers.find((f) => f.driverId === driverId)?.position ?? 99;
      if (pos <= 3) xpMult *= 1.3;
    }
    const xpEarned = Math.round(baseXp * xpMult);
    const needed = xpToNextLevel(driver.level);
    const leveledUp = driver.xp + xpEarned >= needed;
    return {
      driverId,
      xpEarned,
      leveledUp,
      newLevel: leveledUp ? driver.level + 1 : undefined,
    };
  });
}

export function buildResultsPayload(
  state: GameState,
  launch: RaceLaunchConfig,
  result: RaceResult,
  stats: RaceObjectiveStats,
  playerCarCondition?: number,
): ResultsPayload {
  const format = FORMATS.find((f) => f.id === launch.formatId) ?? FORMATS[0]!;
  const rank = state.rankUnlocked[launch.discipline] ?? 0;

  const finishers: RaceResultEntry[] = result.positions.map((p) => ({
    driverId: p.driverId,
    name: p.driverName,
    position: p.position,
    finishTime: p.finishTime,
    teamId: p.teamId,
    isPlayer: p.teamId === 0,
  }));

  // Prefer team-0 lead; driverId alone is ambiguous if ids ever collide.
  const leadFinisher =
    finishers.find((f) => f.driverId === launch.leadDriverId && f.teamId === 0) ??
    finishers.find((f) => f.driverId === launch.leadDriverId);
  const bestPlayer = finishers.filter((f) => f.teamId === 0).sort((a, b) => a.position - b.position)[0];
  const playerPosition = leadFinisher?.position ?? bestPlayer?.position ?? finishers.length;

  const teamScores = result.teamScores;
  const playerTeamPoints = teamScores.find((t) => t.teamId === 0)?.points ?? 0;
  const sortedTeams = [...teamScores].sort((a, b) => b.points - a.points || a.bestFinish - b.bestFinish);
  const playerTeamPosition =
    sortedTeams.findIndex((t) => t.teamId === 0) + 1 || sortedTeams.length;
  const playerTeamWon = sortedTeams[0]?.teamId === 0;

  const raceDuration = Math.max(
    ...result.positions.map((p) => p.finishTime),
    result.inputTime,
    1,
  );
  const handsOffRatio = Math.max(0, Math.min(1, 1 - result.inputTime / raceDuration));

  const objectivesCompleted = evaluateObjectives(
    state,
    launch,
    result,
    playerPosition,
    playerTeamWon,
    stats,
    raceDuration,
  );

  let standings: TournamentStandingsEntry[] = [];
  let tournamentComplete = false;
  let tournamentRaceIndex: number | undefined;
  let tournamentRaceCount: number | undefined;
  let tournamentBonus = 0;
  let rankUnlocked: RankId | undefined;
  let nextRaceConfig: RaceLaunchConfig | undefined;

  if (launch.mode === 'tournament' && launch.tournamentDefId !== undefined) {
    const progress = state.inProgressTournaments[launch.discipline];
    const def = TOURNAMENTS.find((t) => t.id === launch.tournamentDefId);
    if (progress !== null && def !== undefined) {
      tournamentRaceIndex = progress.raceIndex;
      tournamentRaceCount = def.races.length;

      for (const ts of teamScores) {
        let entry = progress.standings.find((s) => s.teamId === ts.teamId);
        if (entry === undefined) {
          entry = {
            teamId: ts.teamId,
            points: 0,
            name: ts.teamId === 0 ? 'You' : `Rival ${ts.teamId}`,
          };
          progress.standings.push(entry);
        }
        entry.points += ts.points;
      }
      standings = [...progress.standings];

      tournamentComplete = progress.raceIndex + 1 >= def.races.length;
      if (tournamentComplete) {
        const sorted = [...standings].sort((a, b) => b.points - a.points);
        const teamIdx = sorted.findIndex((s) => s.teamId === 0);
        const split = BALANCE.tournamentPrizeSplit[teamIdx] ?? 0;
        tournamentBonus = Math.round((BALANCE.tournamentPrizePools[def.rank] ?? 0) * split);
        if (teamIdx === 0 && def.rank < 5) {
          rankUnlocked = (def.rank + 1) as RankId;
        }
      } else {
        const nextRace = def.races[progress.raceIndex + 1];
        if (nextRace !== undefined) {
          nextRaceConfig = {
            discipline: launch.discipline,
            trackSeed: nextRace.trackSeed,
            raceSeed: (launch.raceSeed + progress.raceIndex + 2) >>> 0,
            laps: nextRace.laps,
            formatId: nextRace.formatId,
            playerLineup: progress.playerLineup,
            leadDriverId: progress.leadDriverId,
            mode: 'tournament',
            tournamentDefId: def.id,
          };
        }
      }
    }
  }

  const payout = computePayout(
    rank,
    playerPosition,
    playerTeamPosition,
    finishers.length,
    launch.laps,
    handsOffRatio,
    objectivesCompleted,
    launch.mode === 'tournament',
    tournamentBonus,
    playerTeamWon,
    playerPosition <= 3,
  );

  const driverXp = computeDriverXp(state, launch, playerTeamPoints, rank, finishers);

  if (playerCarCondition !== undefined) {
    state.vehicles[launch.discipline].condition = playerCarCondition;
  }

  return {
    config: launch,
    discipline: launch.discipline,
    formatLabel: format.label,
    playerPosition,
    playerTeamPosition,
    finishers,
    standings,
    payout,
    driverXp,
    objectivesCompleted,
    handsOffRatio,
    handsOffBonus: payout.handsOff,
    rankUnlocked,
    tournamentComplete,
    tournamentRaceIndex,
    tournamentRaceCount,
    nextRaceConfig,
  };
}
