/**
 * Basic balance probe — is the sandbox (Rookie Quick Race) playable and fun?
 * Compares player strategies (pin / shift / shift+brake) vs the field.
 * Run: ./node_modules/.bin/vite-node scripts/balance-probe.ts
 */
import { BALANCE } from '../src/data/balance.ts';
import { FORMATS } from '../src/data/formats.ts';
import { PHYSICS } from '../src/data/physics.ts';
import {
  RaceDirector,
  type RaceConfig,
} from '../src/engine/RaceDirector.ts';
import { createNewGame } from '../src/engine/SaveManager.ts';
import { mulberry32 } from '../src/engine/rng.ts';
import { defaultVehicleSave } from '../src/engine/types.ts';
import { gearBandFrac, gearboxFor } from '../src/engine/Gearbox.ts';

type Strategy = 'pin' | 'shift' | 'brake';

const SEEDS = [11_001, 22_002, 33_003, 44_004, 55_005, 66_006, 77_007, 88_008];

interface RaceOutcome {
  seed: number;
  pos: number;
  cars: number;
  playerClock: number | null;
  winnerClock: number | null;
  p2Clock: number | null;
  playerFinished: boolean;
  finishedCount: number;
  playerDeslots: number;
  aiDeslots: number;
  playerTopV: number;
  raceDur: number;
}

function runRace(seed: number, bandIdx: number, strat: Strategy): RaceOutcome {
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
      BALANCE.opponentStatRanges[bandIdx]![0] * 4,
      BALANCE.opponentStatRanges[bandIdx]![1] * 4,
    ],
    opponentPartRange: BALANCE.opponentPartTiers[bandIdx]!,
  };

  const director = new RaceDirector(config);
  let guard = 0;
  while (director.countdown !== null && guard < 500) {
    director.update(PHYSICS.dt * 20);
    guard += 1;
  }

  const box = gearboxFor('track');
  let playerDeslots = 0;
  let aiDeslots = 0;
  let prevPlayerDeslot = false;
  let playerTopV = 0;
  const speedMult = 40;

  while (!director.isRaceFinished && guard < 12_000) {
    guard += 1;
    const player = director.cars.find((c) => c.isPlayerControlled)!;
    const v = player.v;
    playerTopV = Math.max(playerTopV, v);
    if (player.slotMode === 'deslot' && !prevPlayerDeslot) playerDeslots += 1;
    prevPlayerDeslot = player.slotMode === 'deslot';
    aiDeslots += director.cars.filter(
      (c) => !c.isPlayerControlled && c.slotMode === 'deslot',
    ).length;

    const vMaxEff = player.stats.vMax;
    let throttle = 1;
    let brake = 0;
    let wantUp = false;
    if (strat === 'pin') {
      throttle = 1;
    } else if (strat === 'shift') {
      const band = gearBandFrac(v, vMaxEff, player.gear, box);
      wantUp = band >= 0.62;
    } else {
      // shift + brake: green-window upshift, brake toward vDeslot.
      const band = gearBandFrac(v, vMaxEff, player.gear, box);
      wantUp = band >= 0.62;
      if (v > player.vDeslot * 0.92) {
        brake = 1;
        throttle = 0;
      }
    }
    director.setPlayerPedals(throttle, brake, wantUp);
    director.update(PHYSICS.dt * speedMult);
  }
  if (!director.isRaceFinished) director.retire();

  const result = director.getResult();
  const playerCarId = director.cars.find((c) => c.isPlayerControlled)!.id;
  const playerEntry = result.positions.find((p) => p.carId === playerCarId);
  const winnerEntry = result.positions[0];
  const p2Entry = result.positions[1];
  const playerFinished = !!playerEntry?.finished;
  const finishedCount = result.positions.filter((p) => p.finished).length;
  const playerClock =
    (playerEntry?.finishTime ?? null) as number | null;
  const winnerClock =
    (winnerEntry?.finishTime ?? null) as number | null;
  const p2Clock =
    (p2Entry?.finishTime ?? null) as number | null;

  return {
    seed,
    pos: playerEntry?.position ?? 99,
    cars: result.positions.length,
    playerClock,
    winnerClock,
    p2Clock,
    playerFinished,
    finishedCount,
    playerDeslots,
    aiDeslots,
    playerTopV,
    raceDur: director.raceClock,
  };
}

async function main() {
  console.log('\n=== Balance probe (Quick Race field bands) ===\n');
  for (const strat of ['pin', 'shift'] as Strategy[]) {
    for (const bandIdx of [0, 1, 2]) {
      let p1 = 0;
      let fin = 0;
      let deslots = 0;
      for (const seed of SEEDS) {
        const r = runRace(seed, bandIdx, strat);
        if (r.pos === 1) p1 += 1;
        if (r.playerFinished) fin += 1;
        deslots += r.playerDeslots;
      }
      console.log(`[${strat}] band ${bandIdx} (stats ${BALANCE.opponentStatRanges[bandIdx]![0]}-${BALANCE.opponentStatRanges[bandIdx]![1]}, parts ${BALANCE.opponentPartTiers[bandIdx]!.join('-')}): P1=${p1}/${SEEDS.length} fin=${fin}/${SEEDS.length} deslots=${(deslots / SEEDS.length).toFixed(1)}`);
    }
  }
  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
