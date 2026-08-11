import { PHYSICS } from '../../data/physics';
import { FORMATS } from '../../data/formats';
import { hashState } from '../rng';
import { defaultVehicleSave } from '../types';
import type { VehicleInputs } from '../Vehicle';
import {
  RaceDirector,
  type PedalTraceSample,
  type RaceConfig,
  type RaceResult,
} from '../RaceDirector';

function samplePedals(trace: readonly PedalTraceSample[] | undefined, time: number): VehicleInputs {
  if (trace === undefined || trace.length === 0) return { throttle: 1, brake: 0 };

  let lo = 0;
  for (let i = 0; i < trace.length; i++) {
    if (trace[i]!.time <= time) lo = i;
  }
  const hi = Math.min(lo + 1, trace.length - 1);
  const a = trace[lo]!;
  const b = trace[hi]!;
  if (lo === hi || b.time <= a.time) return { throttle: a.throttle, brake: a.brake };
  const t = (time - a.time) / (b.time - a.time);
  return {
    throttle: a.throttle + (b.throttle - a.throttle) * t,
    brake: a.brake + (b.brake - a.brake) * t,
  };
}

/** Run a full race without rendering; optional pedal trace for player car. */
export function runHeadless(
  config: RaceConfig,
  pedalTrace?: PedalTraceSample[],
  speedMult = 1,
): RaceResult {
  const director = new RaceDirector(config);
  const maxTime = 600;
  let simTime = 0;

  while (!director.isRaceFinished && simTime < maxTime) {
    const pedals = samplePedals(pedalTrace, director.raceClock);
    director.setPlayerPedals(pedals.throttle, pedals.brake);
    director.update(PHYSICS.dt * Math.max(1, speedMult));
    simTime += PHYSICS.dt;
  }

  if (!director.isRaceFinished) {
    director.retire();
  }

  return director.getResult();
}

function resultFingerprint(result: RaceResult): number {
  const values: number[] = [
    result.rain ? 1 : 0,
    result.inputTime,
    result.trackSeed,
    result.raceSeed,
  ];
  for (const p of result.positions) {
    values.push(p.position, p.finishTime, p.teamId);
  }
  for (const t of result.teamScores) {
    values.push(t.teamId, t.points, t.bestFinish);
  }
  return hashState(values);
}

/** Dev helper: two identical headless runs must produce the same fingerprint. */
export function runDeterminismCheck(): boolean {
  const config: RaceConfig = {
    discipline: 'track',
    trackSeed: 42_001,
    raceSeed: 99_001,
    laps: 2,
    format: FORMATS.find((f) => f.id === '1v1v1v1') ?? FORMATS[0]!,
    playerTeamDrivers: [
      {
        id: 'p1',
        name: 'Test Alpha',
        trait: 'grinder',
        skill: 50,
        bravery: 50,
        focus: 50,
        determination: 50,
        xp: 0,
        level: 1,
        unspentPoints: 0,
      },
    ],
    leadDriverId: 'p1',
    playerVehicle: defaultVehicleSave(2),
    opponentBudget: [120, 180],
    opponentPartRange: [1, 2],
  };

  const trace: PedalTraceSample[] = [
    { time: 0, throttle: 0, brake: 0 },
    { time: 4, throttle: 1, brake: 0 },
    { time: 120, throttle: 0.8, brake: 0 },
  ];

  const a = runHeadless(config, trace, 50);
  const b = runHeadless(config, trace, 50);
  return resultFingerprint(a) === resultFingerprint(b);
}
