/**
 * Headless Scalextric groove/deslot validation.
 * Run: npx tsx scripts/scalextric-validate.ts
 */
import { FORMATS } from '../src/data/formats.ts';
import { PHYSICS } from '../src/data/physics.ts';
import {
  RaceDirector,
  type RaceConfig,
  type PedalTraceSample,
} from '../src/engine/RaceDirector.ts';
import { interpolateAtS } from '../src/engine/RacingLine.ts';
import { barrierHalfWidth, wallLimitFor } from '../src/engine/Vehicle.ts';
import { defaultVehicleSave, type Driver } from '../src/engine/types.ts';

function noviceDriver(id: string, name: string, bravery = 40): Driver {
  return {
    id,
    name,
    trait: 'grinder',
    skill: 28,
    bravery,
    focus: 35,
    determination: 40,
    xp: 0,
    level: 1,
    unspentPoints: 0,
  };
}

function runRace(
  label: string,
  config: RaceConfig,
  pedalTrace: PedalTraceSample[],
  speedMult = 40,
  opts?: { clearAirPlayer?: boolean },
): {
  label: string;
  cars: number;
  finishers: number;
  deslots: number;
  spins: number;
  playerDeslots: number;
  playerSpins: number;
  playerWallHits: number;
  playerMaxAbsL: number;
  playerRunoff: boolean;
  /** |l| at wall clamp samples — should sit near wallLimit (= barrier − car half-width). */
  wallHitAbsL: number[];
  wallHitBarrier: number[];
  wallHitLimit: number[];
  deslotEvents: number;
  spinEvents: number;
  wallEvents: number;
} {
  const director = new RaceDirector(config);
  const maxTime = 480;
  let simTime = 0;
  let cleared = false;
  let playerMaxAbsL = 0;
  let playerRunoff = false;
  let prevWallHits = 0;
  const wallHitAbsL: number[] = [];
  const wallHitBarrier: number[] = [];
  const wallHitLimit: number[] = [];

  while (!director.isRaceFinished && simTime < maxTime) {
    const t = director.raceClock;
    // After lights out, park rivals behind so pin-throttle can prove deslot in clear air.
    // Solid contact otherwise lets a slow ahead-car absorb overspeed forever.
    if (opts?.clearAirPlayer && !cleared && director.countdown === null) {
      const trackLen = director.track.length;
      const player = director.cars.find((c) => c.isPlayerControlled);
      if (player) {
        let place = 1;
        for (const c of director.cars) {
          if (c.id === player.id) continue;
          c.lap = 0;
          c.s = (trackLen - place * 40) % trackLen;
          c.v = 8;
          place += 1;
        }
        player.lap = 0;
        player.s = 0;
        player.v = Math.max(player.v, 28);
      }
      cleared = true;
    }
    let lo = 0;
    for (let i = 0; i < pedalTrace.length; i++) {
      if (pedalTrace[i]!.time <= t) lo = i;
    }
    const sample = pedalTrace[lo]!;
    // Manual gearbox: race traces must keep requesting upshifts or gear-cap
    // soft-limits top speed (pin deslot / wall gates never fire).
    const wantUp = sample.throttle >= 0.7;
    director.setPlayerPedals(sample.throttle, sample.brake, wantUp);
    director.update(PHYSICS.dt * speedMult);
    simTime += PHYSICS.dt;

    const player = director.cars.find((c) => c.isPlayerControlled);
    if (player) {
      const node = interpolateAtS(director.track.nodes, director.track.length, player.s);
      const absL = Math.abs(player.l);
      playerMaxAbsL = Math.max(playerMaxAbsL, absL);
      if (absL > node.width / 2) playerRunoff = true;
      if (player.wallHits > prevWallHits) {
        wallHitAbsL.push(absL);
        wallHitBarrier.push(barrierHalfWidth(node.width, node.runoffWidth));
        wallHitLimit.push(wallLimitFor(node.width, node.runoffWidth));
        prevWallHits = player.wallHits;
      }
    }
  }
  if (!director.isRaceFinished) director.retire();

  const cars = director.cars;
  const deslots = cars.reduce((n, c) => n + c.deslotCount, 0);
  const spins = cars.reduce((n, c) => n + c.spinCount, 0);
  const finishers = cars.filter((c) => c.finished && c.finishTime > 0).length;
  const player = cars.find((c) => c.isPlayerControlled);
  const events = director.recentEvents;

  return {
    label,
    cars: cars.length,
    finishers,
    deslots,
    spins,
    playerDeslots: player?.deslotCount ?? 0,
    playerSpins: player?.spinCount ?? 0,
    playerWallHits: player?.wallHits ?? 0,
    playerMaxAbsL,
    playerRunoff,
    wallHitAbsL,
    wallHitBarrier,
    wallHitLimit,
    deslotEvents: events.filter((e) => e.kind === 'deslot').length,
    spinEvents: events.filter((e) => e.kind === 'spin').length,
    wallEvents: events.filter((e) => e.kind === 'crash' || e.kind === 'wallHit').length,
  };
}

async function main() {
  const format = FORMATS.find((f) => f.id === '1v1v1v1') ?? FORMATS[0]!;
  const baseConfig: RaceConfig = {
    discipline: 'track',
    trackSeed: 42_001,
    raceSeed: 11_001,
    laps: 2,
    format,
    playerTeamDrivers: [noviceDriver('p1', 'Novice Lead', 45)],
    leadDriverId: 'p1',
    playerVehicle: defaultVehicleSave(1),
    // Novice rank budget = statRange * 4 → [176, 312]
    opponentBudget: [176, 312],
    opponentPartRange: [2, 3],
  };

  // AI mostly self-drives; player holds moderate throttle (Authority helps brake)
  const assistTrace: PedalTraceSample[] = [
    { time: 0, throttle: 0, brake: 0 },
    { time: 3, throttle: 0.85, brake: 0 },
    { time: 300, throttle: 0.85, brake: 0 },
  ];

  // Pin throttle — should deslot, not spin-spam
  const pinTrace: PedalTraceSample[] = [
    { time: 0, throttle: 0, brake: 0 },
    { time: 2.5, throttle: 1, brake: 0 },
    { time: 300, throttle: 1, brake: 0 },
  ];

  const seeds = [11_001, 22_002, 33_003, 44_004, 55_005];
  const multi: ReturnType<typeof runRace>[] = [];
  for (const raceSeed of seeds) {
    multi.push(
      runRace(
        `novice-multi seed=${raceSeed}`,
        { ...baseConfig, raceSeed, trackSeed: 40_000 + raceSeed },
        assistTrace,
      ),
    );
  }

  const pin = runRace(
    'pin-throttle',
    { ...baseConfig, raceSeed: 77_007, trackSeed: 88_008 },
    pinTrace,
    40,
    { clearAirPlayer: true },
  );

  // Street: little/no runoff — pin-throttle should find the hard wall.
  const pinStreet = runRace(
    'pin-throttle-street',
    {
      ...baseConfig,
      discipline: 'street',
      raceSeed: 91_001,
      trackSeed: 91_002,
      archetypeHint: 'street',
    },
    pinTrace,
    40,
    { clearAirPlayer: true },
  );

  // Oval is mostly straight — with normal AI braking, deslots should stay rare
  const oval = runRace(
    'oval-assist',
    {
      ...baseConfig,
      raceSeed: 66_006,
      trackSeed: 1,
      archetypeHint: 'oval',
      laps: 2,
    },
    assistTrace,
  );

  console.log('\n=== Scalextric validation ===\n');
  for (const r of multi) {
    console.log(
      `${r.label}: finish ${r.finishers}/${r.cars} deslots=${r.deslots} spins=${r.spins} (events d=${r.deslotEvents} s=${r.spinEvents})`,
    );
  }

  const totCars = multi.reduce((n, r) => n + r.cars, 0);
  const totFin = multi.reduce((n, r) => n + r.finishers, 0);
  const totDes = multi.reduce((n, r) => n + r.deslots, 0);
  const totSpin = multi.reduce((n, r) => n + r.spins, 0);
  const finishRate = totFin / Math.max(1, totCars);

  console.log(
    `\nAggregate novice multi: finishRate=${(finishRate * 100).toFixed(1)}% deslots=${totDes} spins=${totSpin} deslots/car=${(totDes / totCars).toFixed(2)}`,
  );
  console.log(
    `Pin throttle: playerDeslots=${pin.playerDeslots} playerSpins=${pin.playerSpins} wallHits=${pin.playerWallHits} runoff=${pin.playerRunoff} max|l|=${pin.playerMaxAbsL.toFixed(1)} allDeslots=${pin.deslots} allSpins=${pin.spins}`,
  );
  console.log(
    `Pin street: playerDeslots=${pinStreet.playerDeslots} wallHits=${pinStreet.playerWallHits} runoff=${pinStreet.playerRunoff} max|l|=${pinStreet.playerMaxAbsL.toFixed(1)} spins=${pinStreet.playerSpins}`,
  );
  console.log(
    `Oval assist: deslots=${oval.deslots} spins=${oval.spins} finish ${oval.finishers}/${oval.cars}`,
  );

  /**
   * Wall clamp: body center must not sit past wallLimit, and limit must match
   * barrier − wallMargin. Post-hit recovery may peel inward within the same
   * batched update — that is OK (Δ below limit), overshoot past the wall is not.
   */
  function wallAlignOk(
    r: { wallHitAbsL: number[]; wallHitLimit: number[]; wallHitBarrier: number[] },
    label: string,
  ): boolean {
    if (r.wallHitAbsL.length === 0) {
      console.log(`  wall-align ${label}: SKIP (no wall hits)`);
      return true;
    }
    let ok = true;
    let worstOver = 0;
    for (let i = 0; i < r.wallHitAbsL.length; i++) {
      const over = r.wallHitAbsL[i]! - r.wallHitLimit[i]!;
      worstOver = Math.max(worstOver, over);
      const expected = r.wallHitBarrier[i]! - PHYSICS.wallMargin;
      if (Math.abs(r.wallHitLimit[i]! - expected) > 0.05) ok = false;
      // Allow tiny numeric overshoot; recovery peel (under-limit) is fine.
      if (over > 0.35) ok = false;
    }
    console.log(
      `  wall-align ${label}: ${ok ? 'PASS' : 'FAIL'} (n=${r.wallHitAbsL.length} worstOver=${worstOver.toFixed(2)} first |l|=${r.wallHitAbsL[0]!.toFixed(2)} limit=${r.wallHitLimit[0]!.toFixed(2)} barrier=${r.wallHitBarrier[0]!.toFixed(2)})`,
    );
    return ok;
  }

  const desPerCar = totDes / totCars;
  const okFinish = finishRate >= 0.75;
  const okDeslotPrimary = totDes >= totSpin && totSpin <= totCars * 0.5;
  const okDeslotRate = desPerCar <= 5.5;
  const okPinDeslots = pin.playerDeslots >= 1;
  const okPinNotSpinSpam = pin.playerSpins <= Math.max(1, pin.playerDeslots);
  // Overspeed must leave the asphalt — runoff and/or hard wall, not a soft reslot.
  const okPinWide =
    pin.playerRunoff || pin.playerWallHits >= 1 || pin.playerMaxAbsL >= 6;
  // Street barriers sit just outside asphalt (R=1.5 → wallLimit ≈ 5.5).
  const okPinStreetWall = pinStreet.playerWallHits >= 1 || pinStreet.playerMaxAbsL >= 5.0;
  // Oval + AI braking: spins must stay zero; light deslot chatter OK on the few bends
  const okOval = oval.spins === 0 && oval.deslots <= oval.cars * 4;

  console.log('\nChecks:');
  console.log(`  finish rate >= 75%: ${okFinish ? 'PASS' : 'FAIL'} (${(finishRate * 100).toFixed(1)}%)`);
  console.log(`  deslots primary / spins rare: ${okDeslotPrimary ? 'PASS' : 'FAIL'}`);
  console.log(`  deslots/car <= 5.5: ${okDeslotRate ? 'PASS' : 'FAIL'} (${desPerCar.toFixed(2)})`);
  console.log(`  pin-throttle deslots: ${okPinDeslots ? 'PASS' : 'FAIL'}`);
  console.log(`  pin-throttle not spin-spam: ${okPinNotSpinSpam ? 'PASS' : 'FAIL'}`);
  console.log(
    `  pin-throttle runoff/wall: ${okPinWide ? 'PASS' : 'FAIL'} (runoff=${pin.playerRunoff} walls=${pin.playerWallHits} max|l|=${pin.playerMaxAbsL.toFixed(1)})`,
  );
  console.log(
    `  pin-street wall: ${okPinStreetWall ? 'PASS' : 'FAIL'} (walls=${pinStreet.playerWallHits} max|l|=${pinStreet.playerMaxAbsL.toFixed(1)})`,
  );
  console.log(`  oval sane (no spin spam): ${okOval ? 'PASS' : 'FAIL'}`);
  const okWallTrack = wallAlignOk(pin, 'track-pin');
  const okWallStreet = wallAlignOk(pinStreet, 'street-pin');

  if (
    !(
      okFinish &&
      okDeslotPrimary &&
      okDeslotRate &&
      okPinDeslots &&
      okPinNotSpinSpam &&
      okPinWide &&
      okPinStreetWall &&
      okOval &&
      okWallTrack &&
      okWallStreet
    )
  ) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
