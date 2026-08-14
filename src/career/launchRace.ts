import { BALANCE } from '../data/balance';
import { FORMATS, formatsForRoster } from '../data/formats';
import type { DisciplineId } from '../data/disciplines';
import { getGameContext } from '../engine/GameContext';
import { mulberry32, pick, randInt, randRange, shuffleInPlace, weightedPick } from '../engine/rng';
import type { GameState } from '../engine/types';
import type { RaceLaunchConfig } from './raceLaunch';
import { applyQuickRacePreset } from './raceLaunch';
import type { QuickRacePresetId } from './quickRacePresets';
import {
  maxLapsForPaceBand,
  paceBandFromState,
} from '../engine/race/paceTrackScale';
import { RaceScene } from '../scenes/RaceScene';
import { accentForDiscipline } from '../ui/theme';
import type { ToastManager } from '../ui/components';

export function makeQuickRaceConfig(
  state: GameState,
  discipline: DisciplineId,
  returnTo: 'title' | 'campaign' = 'title',
  presetId: QuickRacePresetId = 'garage',
): RaceLaunchConfig {
  state.quickRaceNonce = ((state.quickRaceNonce >>> 0) + 1) >>> 0;
  try {
    getGameContext().autosave();
  } catch {
    // Context may be absent in headless harnesses.
  }
  const seedMaterial =
    (state.seed +
      state.careerStats.races * 9973 +
      state.careerStats.earnings +
      discipline.charCodeAt(0) * 131 +
      state.quickRaceNonce * 7919) >>>
    0;
  const rng = mulberry32(seedMaterial);
  const raceSeed = randInt(rng, 1, 0x7fffffff);
  const trackSeed = randInt(rng, 1, 0x7fffffff);
  const eligible = formatsForRoster(state.roster.length);
  const format =
    eligible.length > 0
      ? weightedPick(
          rng,
          eligible.map((f) => ({ ...f, weight: f.weight })),
        )
      : FORMATS[0]!;
  const shuffled = [...state.roster];
  shuffleInPlace(rng, shuffled);
  const team = shuffled.slice(0, Math.min(format.teamSize, shuffled.length));
  const playerLineup = team.map((d) => d.id);
  const leadDriverId = playerLineup.length > 0 ? pick(rng, playerLineup) : '';

  const paceBand = paceBandFromState(state, discipline);
  const lapCap = maxLapsForPaceBand(paceBand);
  const laps = randInt(rng, BALANCE.minLaps, Math.max(BALANCE.minLaps, lapCap));

  // ~25% of Quick Races are a point-to-point sprint instead of a circuit.
  // The finish line lands at a random 42–58% of the doubled loop.
  const isSprint = rng() < 0.25;
  const sprintFinishFrac = isSprint ? randRange(rng, 0.42, 0.58) : undefined;
  const session = isSprint ? ('sprint' as const) : undefined;

  const base: RaceLaunchConfig = {
    discipline,
    trackSeed,
    raceSeed,
    laps,
    formatId: format.id,
    playerLineup,
    leadDriverId,
    mode: 'quick',
    session,
    sprintFinishFrac,
    returnTo,
  };

  return applyQuickRacePreset(state, base, presetId);
}

/** Single-car time trial: one driver, a timer, 1–3 laps scaled to track length. */
export function makeTimeTrialConfig(
  state: GameState,
  discipline: DisciplineId,
  returnTo: 'title' | 'campaign' = 'title',
): RaceLaunchConfig {
  state.quickRaceNonce = ((state.quickRaceNonce >>> 0) + 1) >>> 0;
  try {
    getGameContext().autosave();
  } catch {
    // Context may be absent in headless harnesses.
  }
  const seedMaterial =
    (state.seed +
      state.careerStats.races * 9973 +
      state.careerStats.earnings +
      discipline.charCodeAt(0) * 131 +
      state.quickRaceNonce * 7919) >>>
    0;
  const rng = mulberry32(seedMaterial);
  const raceSeed = randInt(rng, 1, 0x7fffffff);
  const trackSeed = randInt(rng, 1, 0x7fffffff);

  const roster = [...state.roster];
  const leadDriverId = roster.length > 0 ? pick(rng, roster).id : '';

  const paceBand = paceBandFromState(state, discipline);
  const lapCap = maxLapsForPaceBand(paceBand);
  const laps = randInt(rng, BALANCE.minLaps, Math.max(BALANCE.minLaps, lapCap));

  return {
    discipline,
    trackSeed,
    raceSeed,
    laps,
    formatId: 'tt',
    playerLineup: leadDriverId ? [leadDriverId] : [],
    leadDriverId,
    mode: 'quick',
    session: 'timeTrial',
    returnTo,
  };
}

let raceLaunchInFlight = false;function formatLaunchError(err: unknown): string {
  if (err instanceof Error) {
    const msg = err.message.trim();
    return msg.length > 0 ? msg : err.name;
  }
  return String(err);
}

/** Open RaceScene synchronously. Replaces Results (raceLaunchReplace) so again/next don't stack. */
export function launchRace(config: RaceLaunchConfig, toasts: ToastManager): void {
  if (raceLaunchInFlight) return;
  raceLaunchInFlight = true;
  const accent = accentForDiscipline(config.discipline);
  try {
    if (config.playerLineup.length === 0) {
      toasts.push('Need a driver on the roster', accent);
      return;
    }
    if (typeof RaceScene !== 'function') {
      throw new Error('RaceScene failed to load (circular import)');
    }
    const g = getGameContext();
    const race = new RaceScene(g, config);
    if (g.scenes.current?.raceLaunchReplace) {
      g.scenes.replace(race);
    } else {
      g.scenes.push(race);
    }
  } catch (err) {
    console.error('[apex] launchRace failed', err);
    toasts.push(`Could not start race: ${formatLaunchError(err)}`, accent, 5);
  } finally {
    raceLaunchInFlight = false;
  }
}
