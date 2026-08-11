import { BALANCE } from '../data/balance';
import { FORMATS, formatsForRoster } from '../data/formats';
import type { DisciplineId } from '../data/disciplines';
import { getGameContext } from '../engine/GameContext';
import { mulberry32, pick, randInt, shuffleInPlace, weightedPick } from '../engine/rng';
import type { GameState } from '../engine/types';
import type { RaceLaunchConfig } from './raceLaunch';
import { RaceScene } from '../scenes/RaceScene';
import { accentForDiscipline } from '../ui/theme';
import type { ToastManager } from '../ui/components';

export function makeQuickRaceConfig(
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
  const laps = randInt(rng, BALANCE.minLaps, Math.min(BALANCE.maxLaps, 5));
  return {
    discipline,
    trackSeed,
    raceSeed,
    laps,
    formatId: format.id,
    playerLineup,
    leadDriverId,
    mode: 'quick',
    returnTo,
  };
}

let raceLaunchInFlight = false;

function formatLaunchError(err: unknown): string {
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
