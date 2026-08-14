import { BALANCE } from '../data/balance';
import { FORMATS, formatsForRoster } from '../data/formats';
import type { DisciplineId } from '../data/disciplines';
import type { SessionKind } from '../engine/RaceDirector';
import type { RaceConfig } from '../engine/RaceDirector';
import type { Driver, GameState, VehicleSave } from '../engine/types';
import type { QuickRacePresetId } from './quickRacePresets';
import {
  getQuickRacePreset,
  materializePresetDrivers,
  materializePresetVehicle,
} from './quickRacePresets';
import {
  maxLapsForPaceBand,
  paceBandFromState,
  trackScaleForPaceBand,
  type PaceBand,
} from '../engine/race/paceTrackScale';

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
  /** Session structure (defaults to a circuit race). */
  session?: SessionKind;
  /** Sprint finish fraction of the generated loop (0.2–0.75, default ~0.5). */
  sprintFinishFrac?: number;
  again?: boolean;
  /** Where Results Back should land — Title for Quick Race, Campaign otherwise. */
  returnTo?: 'title' | 'campaign';
  /** Quick Race preset id (picker / Again). */
  quickPresetId?: QuickRacePresetId;
  /** Synthetic Quick Race drivers (not on career roster). */
  playerDriversOverride?: Driver[];
  /** Synthetic / preset vehicle (skips career garage condition writeback). */
  playerVehicleOverride?: VehicleSave;
  /** Force opponent difficulty rank (Quick Race presets). */
  challengeRankOverride?: PaceBand;
  /** Force track-scale pace band. */
  paceBandOverride?: PaceBand;
}

export function buildRaceConfig(state: GameState, launch: RaceLaunchConfig): RaceConfig {
  const format = FORMATS.find((f) => f.id === launch.formatId) ?? FORMATS[0]!;

  let playerTeamDrivers: Driver[];
  if (launch.playerDriversOverride && launch.playerDriversOverride.length > 0) {
    const byId = new Map(launch.playerDriversOverride.map((d) => [d.id, d]));
    playerTeamDrivers = launch.playerLineup
      .map((id) => byId.get(id))
      .filter((d): d is Driver => d !== undefined);
    if (playerTeamDrivers.length === 0) {
      playerTeamDrivers = [...launch.playerDriversOverride].slice(0, format.teamSize);
    }
  } else {
    playerTeamDrivers = launch.playerLineup
      .map((id) => state.roster.find((d) => d.id === id))
      .filter((d): d is Driver => d !== undefined);
  }

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
   * Presets may pin challengeRankOverride to showcase a skill band.
   */
  let rank: number;
  if (launch.challengeRankOverride !== undefined) {
    rank = launch.challengeRankOverride;
  } else if (launch.mode === 'quick') {
    rank = Math.min(5, Math.max(unlocked + 1, 2));
  } else {
    rank = unlocked;
  }
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

  const playerVehicle =
    launch.playerVehicleOverride ?? state.vehicles[launch.discipline];

  const paceBand =
    launch.mode === 'quick'
      ? paceBandFromState(
          state,
          launch.discipline,
          playerTeamDrivers,
          playerVehicle,
          launch.paceBandOverride,
        )
      : undefined;
  const baseScale =
    launch.mode === 'quick' && paceBand !== undefined
      ? trackScaleForPaceBand(paceBand)
      : undefined;
  // A sprint races a doubled loop point-to-point — scale the track up and
  // stretch it into a long thin ribbon.
  const trackScale =
    baseScale && launch.session === 'sprint'
      ? { ...baseScale, sprint: { lengthMult: 2.0 } }
      : baseScale;

  return {
    discipline: launch.discipline,
    trackSeed: launch.trackSeed,
    raceSeed: launch.raceSeed,
    laps: launch.laps,
    format,
    playerTeamDrivers,
    leadDriverId: launch.leadDriverId,
    playerVehicle,
    opponentBudget,
    opponentPartRange,
    isTournament: launch.mode === 'tournament',
    opponentDrivers,
    trackScale,
    session: launch.session,
    sprintFinishFrac: launch.sprintFinishFrac,
  };
}

/** Resolve preset material for a Quick Race launch (shared by setup + Again). */
export function applyQuickRacePreset(
  state: GameState,
  launch: RaceLaunchConfig,
  presetId: QuickRacePresetId,
): RaceLaunchConfig {
  const preset = getQuickRacePreset(presetId);
  if (preset.useGarage) {
    const eligible = formatsForRoster(state.roster.length);
    const format =
      eligible.find((f) => f.id === launch.formatId) ??
      eligible[0] ??
      FORMATS[0]!;
    const lineup = state.roster.slice(0, format.teamSize).map((d) => d.id);
    return {
      ...launch,
      formatId: format.id,
      playerLineup: lineup,
      leadDriverId: lineup[0] ?? '',
      quickPresetId: presetId,
      playerDriversOverride: undefined,
      playerVehicleOverride: undefined,
      challengeRankOverride: undefined,
      paceBandOverride: undefined,
    };
  }

  const drivers = materializePresetDrivers(preset);
  const vehicle = materializePresetVehicle(preset);
  // Presets are showcase 1-car entries — keep formats small and readable.
  const format = FORMATS.find((f) => f.id === '1v1') ?? FORMATS[0]!;
  const lineup = drivers.slice(0, format.teamSize).map((d) => d.id);
  return {
    ...launch,
    formatId: format.id,
    playerLineup: lineup,
    leadDriverId: lineup[0] ?? '',
    quickPresetId: presetId,
    playerDriversOverride: drivers,
    playerVehicleOverride: vehicle ?? undefined,
    challengeRankOverride: preset.challengeRank,
    paceBandOverride: preset.paceBand,
    laps: Math.min(launch.laps, maxLapsForPaceBand(preset.paceBand)),
  };
}
