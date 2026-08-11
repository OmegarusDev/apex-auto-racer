import { BALANCE } from '../../data/balance';
import type { DisciplineId } from '../../data/disciplines';
import type { Driver, GameState, VehicleParts, VehicleSave } from '../types';
import type { TrackScaleOpts } from '../TrackGenerator';

export type PaceBand = 0 | 1 | 2 | 3 | 4 | 5;

function meanPartTier(parts: VehicleParts): number {
  const vals = Object.values(parts);
  if (vals.length === 0) return BALANCE.startingPartTier;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function meanDriverSkill(drivers: readonly Driver[]): number {
  if (drivers.length === 0) return BALANCE.startingDriverStatMin;
  let sum = 0;
  for (const d of drivers) {
    sum += (d.skill + d.bravery + d.focus + d.determination) / 4;
  }
  return sum / drivers.length;
}

/**
 * Map player pace (parts + driver skill + career rank) → 0..5 band.
 * Slower / early careers land in lower bands → smaller Quick Race tracks.
 */
export function computePaceBand(opts: {
  rankUnlocked: number;
  partTiers: VehicleParts;
  drivers: readonly Driver[];
  /** Optional absolute override (Quick Race presets). */
  forceBand?: number;
}): PaceBand {
  if (opts.forceBand !== undefined) {
    return Math.max(0, Math.min(5, Math.round(opts.forceBand))) as PaceBand;
  }
  const tier = meanPartTier(opts.partTiers);
  const skill = meanDriverSkill(opts.drivers);
  const rank = Math.max(0, Math.min(5, opts.rankUnlocked));
  // Parts 1→5, skill ~25→95, rank 0→5 — blend favors car + driver over cup unlock.
  const tierScore = ((tier - 1) / 4) * 5;
  const skillScore = ((skill - 20) / 75) * 5;
  const blended = tierScore * 0.45 + skillScore * 0.4 + rank * 0.15;
  return Math.max(0, Math.min(5, Math.round(blended))) as PaceBand;
}

export function paceBandFromState(
  state: GameState,
  discipline: DisciplineId,
  drivers?: readonly Driver[],
  vehicle?: VehicleSave,
  forceBand?: number,
): PaceBand {
  const unlocked = Math.max(
    state.rankUnlocked.track,
    state.rankUnlocked.street,
    state.rankUnlocked.rally,
    state.rankUnlocked[discipline] ?? 0,
  );
  const veh = vehicle ?? state.vehicles[discipline];
  const line = drivers ?? state.roster;
  return computePaceBand({
    rankUnlocked: unlocked,
    partTiers: veh?.partTiers ?? {
      engine: BALANCE.startingPartTier,
      intake: BALANCE.startingPartTier,
      exhaust: BALANCE.startingPartTier,
      tyres: BALANCE.startingPartTier,
      brakes: BALANCE.startingPartTier,
      suspension: BALANCE.startingPartTier,
      spoiler: BALANCE.startingPartTier,
    },
    drivers: line,
    forceBand,
  });
}

export function trackScaleForPaceBand(band: PaceBand): TrackScaleOpts {
  const row = BALANCE.quickRaceTrackScale[band] ?? BALANCE.quickRaceTrackScale[0]!;
  return { lengthMult: row.length, widthMult: row.width };
}

export function durationRangeForPaceBand(band: PaceBand): [number, number] {
  return (
    BALANCE.quickRaceDurationByPace[band] ?? [
      BALANCE.quickRaceDurationMin,
      BALANCE.quickRaceDurationMax,
    ]
  );
}

export function maxLapsForPaceBand(band: PaceBand): number {
  const cap = BALANCE.quickRaceMaxLapsByPace[band] ?? BALANCE.maxLaps;
  return Math.max(BALANCE.minLaps, Math.min(BALANCE.maxLaps, cap));
}
