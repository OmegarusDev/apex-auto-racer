/**
 * Smoke checks: determinism, track generation, optional headless race.
 * Run: npx tsx scripts/smoke.ts
 */
import { FORMATS } from '../src/data/formats.ts';
import type { DisciplineId } from '../src/data/disciplines.ts';
import { generateTrack } from '../src/engine/TrackGenerator.ts';
import {
  runDeterminismCheck,
  runHeadless,
  type RaceConfig,
  type PedalTraceSample,
} from '../src/engine/RaceDirector.ts';
import { defaultVehicleSave } from '../src/engine/types.ts';

function section(title: string) {
  console.log(`\n=== ${title} ===`);
}

async function main() {
  section('Determinism');
  const detOk = runDeterminismCheck();
  console.log(`runDeterminismCheck: ${detOk ? 'PASS' : 'FAIL'}`);

  section('Track generation');
  const seeds: Array<{ discipline: DisciplineId; seed: number }> = [
    { discipline: 'track', seed: 42_001 },
    { discipline: 'street', seed: 77_777 },
    { discipline: 'rally', seed: 123_456 },
  ];
  for (const { discipline, seed } of seeds) {
    const track = generateTrack(seed, discipline);
    console.log(
      `${discipline} seed=${seed}: nodes=${track.nodes.length} length=${track.length.toFixed(1)} archetype=${track.archetype}`,
    );
  }
  console.log('track gen: OK');

  section('Headless quick race');
  const config: RaceConfig = {
    discipline: 'track',
    trackSeed: 42_001,
    raceSeed: 99_001,
    laps: 1,
    format: FORMATS.find((f) => f.id === '1v1v1v1') ?? FORMATS[0]!,
    playerTeamDrivers: [
      {
        id: 'p1',
        name: 'Smoke Driver',
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
    { time: 2, throttle: 1, brake: 0 },
    { time: 120, throttle: 0.85, brake: 0 },
  ];
  const result = runHeadless(config, trace, 50);
  const winner = result.positions[0];
  if (winner) {
    console.log(
      `winner: pos=${winner.position} driver=${winner.driverName} team=${winner.teamId} finishTime=${winner.finishTime.toFixed(2)}s`,
    );
  } else {
    console.log('winner: (none — no finishers)');
  }
  console.log(`finishers: ${result.positions.length}`);
}

main().catch((err) => {
  console.error('smoke failed:', err);
  process.exit(1);
});
