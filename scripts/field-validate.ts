/**
 * Multi-seed field strength / finish-spread check.
 * Run: ./node_modules/.bin/vite-node scripts/field-validate.ts
 */
import { BALANCE } from '../src/data/balance.ts';
import { FORMATS } from '../src/data/formats.ts';
import { PHYSICS } from '../src/data/physics.ts';
import { generateFieldDrivers, generateOpponents } from '../src/engine/DriverGenerator.ts';
import { createNewGame } from '../src/engine/SaveManager.ts';
import {
  RaceDirector,
  type RaceConfig,
  type PedalTraceSample,
} from '../src/engine/RaceDirector.ts';
import { mulberry32 } from '../src/engine/rng.ts';
import { defaultVehicleSave } from '../src/engine/types.ts';

function summarizeDrivers(label: string, drivers: { skill: number; bravery: number; focus: number; determination: number }[]) {
  const totals = drivers.map(
    (d) => d.skill + d.bravery + d.focus + d.determination,
  );
  const skills = drivers.map((d) => d.skill);
  const minT = Math.min(...totals);
  const maxT = Math.max(...totals);
  const avgT = totals.reduce((a, b) => a + b, 0) / totals.length;
  const minS = Math.min(...skills);
  const maxS = Math.max(...skills);
  console.log(
    `${label}: n=${drivers.length} budget ${minT}-${maxT} (avg ${avgT.toFixed(0)}) skill ${minS}-${maxS}`,
  );
  return { minT, maxT, avgT, minS, maxS };
}

function runRace(seed: number, playerSkill: number) {
  const format = FORMATS.find((f) => f.id === '1v1v1v1') ?? FORMATS[0]!;
  const player = {
    id: 'p1',
    name: 'Player',
    trait: 'grinder' as const,
    skill: playerSkill,
    bravery: playerSkill,
    focus: playerSkill,
    determination: playerSkill,
    xp: 0,
    level: 1,
    unspentPoints: 0,
  };
  const config: RaceConfig = {
    discipline: 'track',
    trackSeed: 40_000 + seed,
    raceSeed: seed,
    laps: 2,
    format,
    playerTeamDrivers: [player],
    leadDriverId: 'p1',
    playerVehicle: defaultVehicleSave(BALANCE.startingPartTier),
    opponentBudget: [
      BALANCE.opponentStatRanges[0]![0] * 4,
      BALANCE.opponentStatRanges[0]![1] * 4,
    ],
    opponentPartRange: BALANCE.opponentPartTiers[0]!,
  };

  const pedals: PedalTraceSample[] = [
    { time: 0, throttle: 0, brake: 0 },
    { time: 3, throttle: 0.82, brake: 0 },
    { time: 400, throttle: 0.82, brake: 0 },
  ];

  const director = new RaceDirector(config);
  let simTime = 0;
  const maxTime = 420;
  const speedMult = 40;
  while (!director.isRaceFinished && simTime < maxTime) {
    const t = director.raceClock;
    let lo = 0;
    for (let i = 0; i < pedals.length; i++) {
      if (pedals[i]!.time <= t) lo = i;
    }
    const sample = pedals[lo]!;
    director.setPlayerPedals(sample.throttle, sample.brake);
    director.update(PHYSICS.dt * speedMult);
    simTime += PHYSICS.dt;
  }
  if (!director.isRaceFinished) director.retire();

  const cars = director.cars;
  const standings = director.currentStandings;
  const playerPos =
    standings.find((s) => s.driverId === 'p1')?.position ??
    cars.findIndex((c) => c.isPlayerControlled) + 1;
  const finishTimes = cars
    .filter((c) => c.finished && c.finishTime > 0)
    .map((c) => c.finishTime)
    .sort((a, b) => a - b);
  const deslots = cars.reduce((n, c) => n + c.deslotCount, 0);
  const finishers = cars.filter((c) => c.finished).length;
  const spread =
    finishTimes.length >= 2
      ? finishTimes[finishTimes.length - 1]! - finishTimes[0]!
      : 0;

  // Peek race entries for opponent budget span (validation only).
  const entries = (director as unknown as {
    entries: { car: { isPlayerControlled: boolean }; driver: { skill: number; bravery: number; focus: number; determination: number } }[];
  }).entries;
  const oppBudgets = entries
    .filter((e) => !e.car.isPlayerControlled)
    .map((e) => e.driver.skill + e.driver.bravery + e.driver.focus + e.driver.determination);

  return {
    seed,
    playerPos,
    finishers,
    cars: cars.length,
    deslots,
    spread,
    oppMin: Math.min(...oppBudgets),
    oppMax: Math.max(...oppBudgets),
    draftPasses: director.recentEvents.filter((e) => e.kind === 'draftPass').length,
  };
}

async function main() {
  const rng = mulberry32(99_001);
  const field = generateOpponents(rng, 8, 0);
  summarizeDrivers('rank0 field (8)', field);

  const game = createNewGame(mulberry32(42), 42);
  summarizeDrivers('starting roster', game.roster);

  const band = BALANCE.opponentStatRanges[0]!;
  const stratified = generateFieldDrivers(mulberry32(7), 6, band[0] * 4, band[1] * 4);
  summarizeDrivers('stratified budgets', stratified);

  const seeds = [11_001, 22_002, 33_003, 44_004, 55_005, 66_006];
  // Default-ish starting lead (~31 mid of 22-40)
  const rows = seeds.map((s) => runRace(s, 31));

  console.log('\n=== Multi-seed novice races (player skill=31, T1 car) ===\n');
  let p1 = 0;
  for (const r of rows) {
    if (r.playerPos === 1) p1 += 1;
    console.log(
      `seed ${r.seed}: P${r.playerPos} finish ${r.finishers}/${r.cars} deslots=${r.deslots} spread=${r.spread.toFixed(1)}s oppBudget ${r.oppMin}-${r.oppMax} draftPass=${r.draftPasses}`,
    );
  }

  const avgSpread = rows.reduce((n, r) => n + r.spread, 0) / rows.length;
  const avgDeslots = rows.reduce((n, r) => n + r.deslots, 0) / rows.length;
  const finishRate =
    rows.reduce((n, r) => n + r.finishers, 0) /
    rows.reduce((n, r) => n + r.cars, 0);
  const fieldSpanOk = rows.every((r) => r.oppMax - r.oppMin >= 45);
  const notAlwaysP1 = p1 < rows.length;
  const finishesOk = finishRate >= 0.75;

  console.log('\nChecks:');
  console.log(`  player not always P1: ${notAlwaysP1 ? 'PASS' : 'FAIL'} (P1 in ${p1}/${rows.length})`);
  console.log(`  finish rate >= 75%: ${finishesOk ? 'PASS' : 'FAIL'} (${(finishRate * 100).toFixed(1)}%)`);
  console.log(`  field budget span >= 45 each race: ${fieldSpanOk ? 'PASS' : 'FAIL'}`);
  console.log(`  avg finish spread: ${avgSpread.toFixed(1)}s`);
  console.log(`  avg deslots/race: ${avgDeslots.toFixed(1)}`);

  if (!(notAlwaysP1 && finishesOk && fieldSpanOk)) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
