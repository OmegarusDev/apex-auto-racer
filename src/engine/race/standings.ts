import { BALANCE } from '../../data/balance';
import type { StandingEntry } from '../RaceDirector';
import type { CarSimState } from '../Vehicle';
import { raceDistance } from './trackMath';
import type { RaceCarEntry } from './types';

export interface StandingEvent {
  kind: 'overtake' | 'draftPass';
  car: CarSimState;
  driverName: string;
  detail?: string;
}

export interface StandingsRebuild {
  standings: StandingEntry[];
  standingIndexById: Map<string, number>;
  events: StandingEvent[];
}

/** Rebuild standings order and collect overtake / draftPass events. Mutates entry.prevPosition. */
export function rebuildStandings(
  entries: RaceCarEntry[],
  trackLength: number,
): StandingsRebuild {
  // Finishers rank by finishTime + marshal penalty; everyone else by distance.
  // (Finished cars still roll — distance sort alone inverted true results.)
  const sorted = [...entries].sort((a, b) => {
    if (a.car.finished && b.car.finished) {
      return a.car.finishTime + a.car.penaltySec - (b.car.finishTime + b.car.penaltySec);
    }
    if (a.car.finished !== b.car.finished) {
      return a.car.finished ? -1 : 1;
    }
    return raceDistance(b.car, trackLength) - raceDistance(a.car, trackLength);
  });

  const standings: StandingEntry[] = sorted.map((entry, idx) => ({
    carId: entry.car.id,
    driverId: entry.driver.id,
    driverName: entry.driver.name,
    teamId: entry.car.teamId,
    position: idx + 1,
    lap: entry.car.lap,
    s: entry.car.s,
    distance: raceDistance(entry.car, trackLength),
    finished: entry.car.finished,
    finishTime: entry.car.finishTime,
    penaltySec: entry.car.penaltySec,
    isPlayerControlled: entry.car.isPlayerControlled,
  }));

  const standingIndexById = new Map<string, number>();
  for (let i = 0; i < standings.length; i++) {
    standingIndexById.set(standings[i]!.carId, i);
  }

  const events: StandingEvent[] = [];
  for (const entry of entries) {
    const idx = standingIndexById.get(entry.car.id);
    if (idx === undefined) continue;
    const st = standings[idx]!;
    if (entry.prevPosition > st.position) {
      events.push({
        kind: 'overtake',
        car: entry.car,
        driverName: entry.driver.name,
        detail: `P${st.position}`,
      });
      entry.car.overtakeCount += 1;
    }
    // Draft often drops as the car pulls out — credit a tow pass if wake was
    // held recently or still partially aligned at the moment of the pass.
    if (
      entry.prevPosition > st.position &&
      (entry.draft > BALANCE.overtakeDraftThreshold * 0.45 ||
        entry.brain.draftHoldTime >= BALANCE.overtakeHoldSec * 0.4)
    ) {
      events.push({
        kind: 'draftPass',
        car: entry.car,
        driverName: entry.driver.name,
      });
    }
    entry.prevPosition = st.position;
  }

  return { standings, standingIndexById, events };
}
