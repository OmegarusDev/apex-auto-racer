/**
 * Headless start-line / grid / difficulty checks.
 * Run: ./node_modules/.bin/vite-node scripts/start-validate.ts
 */
import { BALANCE } from '../src/data/balance.ts';
import { FORMATS } from '../src/data/formats.ts';
import { PHYSICS } from '../src/data/physics.ts';
import {
  RaceDirector,
  type RaceConfig,
  type PedalTraceSample,
} from '../src/engine/RaceDirector.ts';
import { createNewGame } from '../src/engine/SaveManager.ts';
import { mulberry32 } from '../src/engine/rng.ts';
import { defaultVehicleSave } from '../src/engine/types.ts';

function raceDistance(s: number, lap: number, trackLength: number): number {
  return lap * trackLength + s;
}

function progressFromGrid(
  car: { s: number; lap: number },
  gridS: number,
  trackLength: number,
): number {
  const now = raceDistance(car.s, car.lap, trackLength);
  const start = raceDistance(gridS, 0, trackLength);
  let d = now - start;
  if (d < -trackLength * 0.5) d += trackLength;
  return d;
}

function runLaunchProbe(seed: number) {
  // Packed grid for stall/lateral checks; placement uses the same field.
  const format = FORMATS.find((f) => f.id === '1v1v1v1') ?? FORMATS[0]!;
  const game = createNewGame(mulberry32(seed), seed);
  const lead = game.roster[0]!;
  const config: RaceConfig = {
    discipline: 'track',
    trackSeed: 50_000 + seed,
    raceSeed: seed,
    laps: 2,
    format,
    playerTeamDrivers: [lead],
    leadDriverId: lead.id,
    playerVehicle: defaultVehicleSave(BALANCE.startingPartTier),
    opponentBudget: [
      BALANCE.opponentStatRanges[0]![0] * 4,
      BALANCE.opponentStatRanges[0]![1] * 4,
    ],
    opponentPartRange: BALANCE.opponentPartTiers[0]!,
  };

  const director = new RaceDirector(config);
  const trackLength = director.track.length;
  const entries = (
    director as unknown as {
      entries: {
        car: {
          id: string;
          s: number;
          l: number;
          lap: number;
          v: number;
          gridL: number;
          isPlayerControlled: boolean;
          finished: boolean;
          driverId: string;
        };
        driver: { skill: number; bravery: number; focus: number; determination: number };
      }[];
    }
  ).entries;

  const gridS0 = entries.map((e) => e.car.s);
  const gridL0 = entries.map((e) => e.car.l);

  // Skip countdown at high speed, then sample launch window in real-time steps.
  let simTime = 0;
  while (director.countdown !== null && simTime < 10) {
    director.update(PHYSICS.dt * 20);
    simTime += PHYSICS.dt;
  }

  const pedals: PedalTraceSample[] = [
    { time: 0, throttle: 1, brake: 0 },
    { time: 400, throttle: 1, brake: 0 },
  ];

  let latSamples = 0;
  let latSpreadSum = 0;
  let colSignOkSamples = 0;
  let colSignSamples = 0;
  let t = 0;
  const snapshot3s: { progress: number; l: number; gridL: number; v: number }[] = [];

  while (t < 3.05 && !director.isRaceFinished) {
    director.setPlayerPedals(1, 0);
    director.update(PHYSICS.dt);
    t += PHYSICS.dt;

    // Pure-hold window: columns must keep opposite signs / spread.
    if (t <= PHYSICS.gridHoldSec * PHYSICS.gridHoldPureFrac) {
      const ls = entries.map((e) => e.car.l);
      const spread = Math.max(...ls) - Math.min(...ls);
      latSpreadSum += spread;
      latSamples += 1;
      const left = entries.filter((e) => e.car.gridL < 0);
      const right = entries.filter((e) => e.car.gridL > 0);
      if (left.length > 0 && right.length > 0) {
        const leftMean = left.reduce((n, e) => n + e.car.l, 0) / left.length;
        const rightMean = right.reduce((n, e) => n + e.car.l, 0) / right.length;
        colSignSamples += 1;
        if (leftMean < -1.2 && rightMean > 1.2) colSignOkSamples += 1;
      }
    }

    if (t >= 3.0 && snapshot3s.length === 0) {
      for (let i = 0; i < entries.length; i++) {
        snapshot3s.push({
          progress: progressFromGrid(entries[i]!.car, gridS0[i]!, trackLength),
          l: entries[i]!.car.l,
          gridL: entries[i]!.car.gridL,
          v: entries[i]!.car.v,
        });
      }
    }
  }

  // Finish race for placement (pin throttle player vs novice field).
  const speedMult = 40;
  let guard = 0;
  while (!director.isRaceFinished && guard < 8000) {
    const clock = director.raceClock;
    let lo = 0;
    for (let i = 0; i < pedals.length; i++) {
      if (pedals[i]!.time <= clock) lo = i;
    }
    const sample = pedals[lo]!;
    director.setPlayerPedals(sample.throttle, sample.brake);
    director.update(PHYSICS.dt * speedMult);
    guard += 1;
  }
  if (!director.isRaceFinished) director.retire();

  // Prefer finalized result by carId (driverId alone can collide if counters diverge).
  const playerCarId = entries.find((e) => e.car.isPlayerControlled)?.car.id;
  const resultPos =
    (playerCarId
      ? director.getResult().positions.find((p) => p.carId === playerCarId)?.position
      : undefined) ??
    director.currentStandings.find((s) => s.isPlayerControlled)?.position ??
    99;
  const playerPos = resultPos;
  const avgLatSpread = latSamples > 0 ? latSpreadSum / latSamples : 0;
  const colSignRate = colSignSamples > 0 ? colSignOkSamples / colSignSamples : 0;
  // Progress clears the lights; brief low-v after a deslot scrub is OK.
  const stalled = snapshot3s.filter((c) => c.progress < 10);
  const oppBudgets = entries
    .filter((e) => !e.car.isPlayerControlled)
    .map((e) => e.driver.skill + e.driver.bravery + e.driver.focus + e.driver.determination);

  return {
    seed,
    cars: entries.length,
    stalled: stalled.length,
    minProgress: Math.min(...snapshot3s.map((c) => c.progress)),
    avgLatSpread,
    colSignRate,
    gridL0Spread: Math.max(...gridL0) - Math.min(...gridL0),
    playerPos,
    oppMin: Math.min(...oppBudgets),
    oppMax: Math.max(...oppBudgets),
    contact: director.contactStats,
  };
}

async function main() {
  const seeds = [11_001, 22_002, 33_003, 44_004, 55_005, 66_006, 77_007, 88_008];
  const rows = seeds.map(runLaunchProbe);

  console.log('\n=== Start / grid / difficulty validation ===\n');
  let p1 = 0;
  for (const r of rows) {
    if (r.playerPos === 1) p1 += 1;
    console.log(
      `seed ${r.seed}: stall=${r.stalled}/${r.cars} minProg=${r.minProgress.toFixed(1)}m ` +
        `latSpread=${r.avgLatSpread.toFixed(2)} colSign=${(r.colSignRate * 100).toFixed(0)}% ` +
        `P${r.playerPos} oppBudget ${r.oppMin}-${r.oppMax}`,
    );
  }

  const noStalls = rows.every((r) => r.stalled === 0 && r.minProgress >= 12);
  const latOk = rows.every(
    (r) => r.avgLatSpread >= PHYSICS.gridColOffset * 1.2 && r.colSignRate >= 0.85,
  );
  // Pin-throttle must not casually dominate — assisted gears still leave room for skill.
  // Allow ≤ ~35% P1 across the seed board (3/8); tighter and pin becomes a coin flip.
  const rareP1 = p1 <= Math.max(2, Math.floor(rows.length * 0.375));
  // Loose Cannon can jitter totals ~±40 below the generated budget floor.
  const floorsOk = rows.every((r) => r.oppMin >= BALANCE.opponentStatRanges[0]![0] * 4 - 40);

  console.log('\nChecks:');
  console.log(
    `  no start stalls (prog>=12m @3s): ${noStalls ? 'PASS' : 'FAIL'}`,
  );
  console.log(
    `  grid lateral diversity (~2s): ${latOk ? 'PASS' : 'FAIL'}`,
  );
  console.log(
    `  pin-throttle player rarely P1: ${rareP1 ? 'PASS' : 'FAIL'} (P1 in ${p1}/${rows.length})`,
  );
  console.log(
    `  opponent budget floors healthy: ${floorsOk ? 'PASS' : 'FAIL'}`,
  );
  console.log(
    `  novice band: ${BALANCE.opponentStatRanges[0]![0]}-${BALANCE.opponentStatRanges[0]![1]} ` +
      `(budget ${BALANCE.opponentStatRanges[0]![0] * 4}-${BALANCE.opponentStatRanges[0]![1] * 4})`,
  );
  console.log(`  playerPaceMult=${BALANCE.playerPaceMult}`);

  if (!(noStalls && latOk && rareP1 && floorsOk)) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
