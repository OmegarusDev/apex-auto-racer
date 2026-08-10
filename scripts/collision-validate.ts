/**
 * Headless multi-car solid-collision check.
 * Run: ./node_modules/.bin/vite-node scripts/collision-validate.ts
 */
import { FORMATS } from '../src/data/formats.ts';
import { PHYSICS } from '../src/data/physics.ts';
import {
  RaceDirector,
  type RaceConfig,
  type PedalTraceSample,
} from '../src/engine/RaceDirector.ts';
import { defaultVehicleSave, type Driver } from '../src/engine/types.ts';

function driver(id: string, name: string, skill: number): Driver {
  return {
    id,
    name,
    trait: 'grinder',
    skill,
    bravery: skill,
    focus: skill,
    determination: 50,
    xp: 0,
    level: 1,
    unspentPoints: 0,
  };
}

function runPackedRace(label: string, raceSeed: number, trackSeed: number) {
  const format = FORMATS.find((f) => f.id === '2v2v2') ?? FORMATS.find((f) => f.id === '1v1v1v1')!;
  const config: RaceConfig = {
    discipline: 'track',
    trackSeed,
    raceSeed,
    laps: 2,
    format,
    playerTeamDrivers: [driver('p1', 'Lead', 55)],
    leadDriverId: 'p1',
    playerVehicle: defaultVehicleSave(2),
    opponentBudget: [140, 220],
    opponentPartRange: [1, 3],
  };

  const pedals: PedalTraceSample[] = [
    { time: 0, throttle: 0, brake: 0 },
    { time: 3, throttle: 0.9, brake: 0 },
    { time: 400, throttle: 0.9, brake: 0 },
  ];

  const director = new RaceDirector(config);
  const maxTime = 420;
  let simTime = 0;
  const speedMult = 40;

  while (!director.isRaceFinished && simTime < maxTime) {
    const t = director.raceClock;
    let lo = 0;
    for (let i = 0; i < pedals.length; i++) {
      if (pedals[i]!.time <= t) lo = i;
    }
    const sample = pedals[lo]!;
    director.setPlayerPedals(sample.throttle, sample.brake, sample.throttle >= 0.7);
    director.update(PHYSICS.dt * speedMult);
    simTime += PHYSICS.dt;
  }
  if (!director.isRaceFinished) director.retire();

  const cars = director.cars;
  const finishers = cars.filter((c) => c.finished && c.finishTime > 0).length;
  const stats = director.contactStats;
  const overlapRate = stats.ticks > 0 ? stats.overlapFrames / stats.ticks : 0;
  const residualRate = stats.ticks > 0 ? stats.residualOverlapFrames / stats.ticks : 0;

  return {
    label,
    cars: cars.length,
    finishers,
    deslots: cars.reduce((n, c) => n + c.deslotCount, 0),
    spins: cars.reduce((n, c) => n + c.spinCount, 0),
    overlapFrames: stats.overlapFrames,
    residualOverlapFrames: stats.residualOverlapFrames,
    ticks: stats.ticks,
    overlapRate,
    residualRate,
  };
}

async function main() {
  const formats = FORMATS.map((f) => f.id);
  console.log('formats:', formats.join(', '));

  const seeds = [
    [11_001, 42_001],
    [22_002, 42_002],
    [33_003, 42_003],
    [44_004, 42_004],
  ] as const;

  const rows = seeds.map(([raceSeed, trackSeed], i) =>
    runPackedRace(`pack-${i + 1}`, raceSeed, trackSeed),
  );

  console.log('\n=== Collision validation ===\n');
  for (const r of rows) {
    console.log(
      `${r.label}: finish ${r.finishers}/${r.cars} overlap=${r.overlapFrames}/${r.ticks} (${(r.overlapRate * 100).toFixed(2)}%) residual=${r.residualOverlapFrames} (${(r.residualRate * 100).toFixed(3)}%) deslots=${r.deslots} spins=${r.spins}`,
    );
  }

  const totCars = rows.reduce((n, r) => n + r.cars, 0);
  const totFin = rows.reduce((n, r) => n + r.finishers, 0);
  const avgResidual =
    rows.reduce((n, r) => n + r.residualRate, 0) / Math.max(1, rows.length);
  const avgOverlap =
    rows.reduce((n, r) => n + r.overlapRate, 0) / Math.max(1, rows.length);

  const okFinish = totFin / totCars >= 0.75;
  // After solid resolve, residual body overlap should be vanishingly rare.
  const okResidual = avgResidual < 0.005;
  // Pre-resolve overlaps = closing into contact before the resolver runs; pack racing
  // will register some, but constant bumper-grinding should stay bounded.
  const okOverlap = avgOverlap < 0.35;

  console.log('\nChecks:');
  console.log(
    `  finish rate >= 75%: ${okFinish ? 'PASS' : 'FAIL'} (${((totFin / totCars) * 100).toFixed(1)}%)`,
  );
  console.log(
    `  avg residual overlap < 0.5%: ${okResidual ? 'PASS' : 'FAIL'} (${(avgResidual * 100).toFixed(3)}%)`,
  );
  console.log(
    `  avg pre-resolve overlap < 35%: ${okOverlap ? 'PASS' : 'FAIL'} (${(avgOverlap * 100).toFixed(2)}%)`,
  );

  if (!(okFinish && okResidual && okOverlap)) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
