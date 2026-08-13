import { BALANCE } from '../../data/balance';
import { FORMATS } from '../../data/formats';
import { PHYSICS } from '../../data/physics';
import { gearboxFor } from '../Gearbox';
import { RaceDirector, type RaceConfig } from '../RaceDirector';
import { enterDeslot } from '../Vehicle';
import { effectiveStats } from '../stats';
import { interpolateAtSInto, type InterpolatedNode } from '../RacingLine';
import { defaultVehicleSave, type Driver } from '../types';
import { mulberry32 } from '../rng';
import type { FeelGateResult } from './types';

const nodeScratch: InterpolatedNode = {
  pos: { x: 0, y: 0 },
  tangent: { x: 1, y: 0 },
  normal: { x: 0, y: 1 },
  width: 0,
  runoffWidth: 0,
  kappa: 0,
  kappaLine: 0,
  o: 0,
  s: 0,
};

function makeDriver(id: string, skill = 40): Driver {
  return {
    id,
    name: id,
    trait: 'grinder',
    skill,
    bravery: 45,
    focus: 50,
    determination: 50,
    xp: 0,
    level: 1,
    unspentPoints: 0,
  };
}

function baseConfig(seed: number): RaceConfig {
  const lead = makeDriver('lead', 35);
  return {
    discipline: 'track',
    trackSeed: 50_000 + seed,
    raceSeed: seed,
    laps: 2,
    format: FORMATS.find((f) => f.id === '1v1') ?? FORMATS[0]!,
    playerTeamDrivers: [lead],
    leadDriverId: lead.id,
    playerVehicle: defaultVehicleSave(BALANCE.startingPartTier),
    opponentBudget: [200, 260],
    opponentPartRange: [2, 3],
  };
}

function skipCountdown(director: RaceDirector): void {
  let guard = 0;
  while (director.countdown !== null && guard < 500) {
    director.update(PHYSICS.dt * 20);
    guard += 1;
  }
}

/** Force deslot on non-player; ensure they rejoin or keep crawling within 8s. */
export function runRejoinGate(): FeelGateResult {
  const director = new RaceDirector(baseConfig(77_001));
  skipCountdown(director);
  const ai = director.cars.find((c) => !c.isPlayerControlled);
  if (!ai) {
    return { id: 'REJOIN_NO_PARK', ok: false, detail: 'no AI car' };
  }
  // Place mid-track with some speed, force deslot.
  ai.v = 12;
  ai.s = director.track.length * 0.35;
  const node = interpolateAtSInto(director.track.nodes, director.track.length, ai.s, nodeScratch);
  enterDeslot(ai, node.kappaLine, Math.max(8, ai.vDeslot || 10));
  ai.l = (ai.lineO[0] ?? 0) + 2.5;

  let zeroTime = 0;
  let maxZero = 0;
  let rejoined = false;
  let progressed = false;
  const s0 = ai.s;
  for (let t = 0; t < 8; t += PHYSICS.dt) {
    director.setPlayerPedals(0.4, 0.1);
    director.update(PHYSICS.dt);
    if (ai.slotMode === 'groove') rejoined = true;
    if (ai.v < 0.15) {
      zeroTime += PHYSICS.dt;
      maxZero = Math.max(maxZero, zeroTime);
    } else {
      zeroTime = 0;
    }
    const ds = Math.abs(ai.s - s0);
    if (ds > 3 || ai.v > 3) progressed = true;
  }

  const ok = (rejoined || progressed) && maxZero < 3.05;
  return {
    id: 'REJOIN_NO_PARK',
    ok,
    detail: `rejoined=${rejoined} progressed=${progressed} maxZero=${maxZero.toFixed(2)}s final=${ai.slotMode} v=${ai.v.toFixed(1)}`,
  };
}

/** After a hard wall shove, car should still advance while recovering. */
export function runCrashStunGate(): FeelGateResult {
  const director = new RaceDirector(baseConfig(77_002));
  skipCountdown(director);
  const player = director.cars.find((c) => c.isPlayerControlled);
  if (!player) {
    return { id: 'CRASH_STUN_SOFT', ok: false, detail: 'no player' };
  }
  player.v = 22;
  player.slotMode = 'deslot';
  player.deslotRemaining = 0.5;
  const node = interpolateAtSInto(
    director.track.nodes,
    director.track.length,
    player.s,
    nodeScratch,
  );
  const wall =
    node.width / 2 + node.runoffWidth - PHYSICS.wallMargin;
  player.l = wall + 0.2;
  player.dl = 8;
  player.stunRemaining = 0;

  // Drive into wall resolve
  for (let i = 0; i < 30; i++) {
    director.setPlayerPedals(0.6, 0);
    director.update(PHYSICS.dt);
  }
  const stunned = player.stunRemaining > 0 || player.wallHits > 0;
  const s0 = player.s;
  for (let t = 0; t < 6; t += PHYSICS.dt) {
    director.setPlayerPedals(0.7, 0);
    director.update(PHYSICS.dt);
  }
  let dist = player.s - s0;
  if (dist < -director.track.length * 0.5) dist += director.track.length;
  const ok = stunned && dist > 5;
  return {
    id: 'CRASH_STUN_SOFT',
    ok,
    detail: `stunned=${stunned} wallHits=${player.wallHits} dist=${dist.toFixed(1)}m stunLeft=${player.stunRemaining.toFixed(2)}`,
  };
}

/** Two cars on a straight: follower should see meaningful draft. */
export function runDraftTowGate(): FeelGateResult {
  const director = new RaceDirector(baseConfig(77_003));
  skipCountdown(director);
  const entries = (
    director as unknown as {
      entries: {
        car: { id: string; s: number; l: number; v: number; lap: number; finished: boolean };
        draft: number;
      }[];
      track: { length: number; nodes: { s: number; kappaLine: number }[] };
    }
  );
  if (entries.entries.length < 2) {
    return { id: 'DRAFT_TOW', ok: false, detail: 'need 2 cars' };
  }

  let sStraight = 0;
  let bestK = 99;
  for (const n of entries.track.nodes) {
    const k = Math.abs(n.kappaLine);
    if (k < bestK) {
      bestK = k;
      sStraight = n.s;
    }
  }

  const a = entries.entries[0]!;
  const b = entries.entries[1]!;
  // Put B ahead, A behind in the tow.
  for (const e of entries.entries) {
    e.car.finished = false;
    e.car.lap = 0;
    e.car.l = 0;
    e.car.v = 30;
  }
  b.car.s = sStraight;
  a.car.s = (sStraight - 8 + entries.track.length) % entries.track.length;

  let maxDraft = 0;
  for (let i = 0; i < 120; i++) {
    // Hold positions so contact/AI cannot break the tow geometry.
    b.car.s = sStraight;
    a.car.s = (sStraight - 8 + entries.track.length) % entries.track.length;
    a.car.l = 0;
    b.car.l = 0;
    a.car.v = 30;
    b.car.v = 30;
    director.setPlayerPedals(0.8, 0);
    director.update(PHYSICS.dt);
    maxDraft = Math.max(maxDraft, a.draft, b.draft);
  }

  return {
    id: 'DRAFT_TOW',
    ok: maxDraft >= 0.2,
    detail: `maxDraft=${maxDraft.toFixed(3)} kappaMin=${bestK.toFixed(4)}`,
  };
}

/**
 * Gear contract:
 *  - Pin-throttle alone auto-climbs after ~1s at the redline (no more crawl).
 *  - Manual Shift works any time the band is valid — gas or not.
 *  - Shift at low revs (band below earlyUpshiftBand) does nothing.
 */
export function runGearAssistGate(): FeelGateResult {
  const director = new RaceDirector(baseConfig(77_010));
  skipCountdown(director);
  const player = director.cars.find((c) => c.isPlayerControlled);
  if (!player) {
    return { id: 'GEAR_ASSIST', ok: false, detail: 'no player' };
  }
  // Park on the lowest-kappa stretch so Authority corners don't eat the pull.
  let bestS = player.s;
  let bestK = 99;
  for (const n of director.track.nodes) {
    const k = Math.abs(n.kappaLine);
    if (k < bestK) {
      bestK = k;
      bestS = n.s;
    }
  }

  // (a) Pin-throttle, no Shift: redline dwell must auto-climb past gear 1.
  player.gear = 1;
  player.v = 6;
  player.slotMode = 'groove';
  player.s = bestS;
  player.l = 0;
  player.shiftCooldown = 0;
  player.redlineDwell = 0;
  for (let i = 0; i < 720; i++) {
    director.setPlayerPedals(1, 0, false);
    director.update(PHYSICS.dt);
  }
  const autoClimb = player.gear >= 3;

  // (b) Manual upshift while coasting (gas off) once the band is valid.
  player.gear = 2;
  player.v = coastBandSpeed(player, 'track', 0.6);
  player.slotMode = 'groove';
  player.shiftCooldown = 0;
  player.redlineDwell = 0;
  const gearBefore = player.gear;
  director.setPlayerPedals(0, 0, true);
  director.update(PHYSICS.dt);
  const coastUp = player.gear === gearBefore + 1;

  // (c) Low-rev upshift is refused — must be a valid shift.
  player.gear = 2;
  player.v = coastBandSpeed(player, 'track', 0.2);
  player.slotMode = 'groove';
  player.shiftCooldown = 0;
  player.redlineDwell = 0;
  const gearBeforeLow = player.gear;
  director.setPlayerPedals(0, 0, true);
  director.update(PHYSICS.dt);
  const lowRevBlocked = player.gear === gearBeforeLow;

  const ok = autoClimb && coastUp && lowRevBlocked;
  return {
    id: 'GEAR_ASSIST',
    ok,
    detail: `autoClimb=${autoClimb} gear=${player.gear} coastUp=${coastUp} lowRevBlocked=${lowRevBlocked} kappaMin=${bestK.toFixed(4)}`,
  };
}

/** Speed for a given band in `gear` under raw player stats (track box). */
function coastBandSpeed(car: { stats: { vMax: number } }, discipline: import('../../data/disciplines').DisciplineId, band: number): number {
  const box = gearboxFor(discipline);
  const hi = car.stats.vMax * (box.topFrac[2] ?? 1);
  const lo = car.stats.vMax * (box.topFrac[1] ?? 0);
  return lo + band * (hi - lo);
}

/** Early Shift must not slap speed (no miss penalty). */
export function runGearNoMissGate(): FeelGateResult {
  const director = new RaceDirector(baseConfig(77_011));
  skipCountdown(director);
  const player = director.cars.find((c) => c.isPlayerControlled);
  if (!player) {
    return { id: 'GEAR_NO_MISS', ok: false, detail: 'no player' };
  }
  player.gear = 2;
  player.v = 10;
  player.slotMode = 'groove';
  player.shiftCooldown = 0;
  const v0 = player.v;
  // Spam early upshift while still low in the band.
  for (let i = 0; i < 30; i++) {
    director.setPlayerPedals(0.6, 0, true);
    director.update(PHYSICS.dt);
  }
  const ok = player.v >= v0 * 0.97 && player.lastShiftKind !== 'miss';
  return {
    id: 'GEAR_NO_MISS',
    ok,
    detail: `v0=${v0.toFixed(2)} v=${player.v.toFixed(2)} gear=${player.gear}`,
  };
}

/**
 * Same-lane contact must stack (brake / push back in S), not peel cars
 * sideways to carWidth while still nested longitudinally (phantom pass).
 */
export function runPackContactGate(): FeelGateResult {
  const director = new RaceDirector(baseConfig(77_020));
  skipCountdown(director);
  const player = director.cars.find((c) => c.isPlayerControlled);
  const ai = director.cars.find((c) => !c.isPlayerControlled);
  if (!player || !ai) {
    return { id: 'PACK_CONTACT', ok: false, detail: 'missing cars' };
  }

  let bestS = player.s;
  let bestK = 99;
  for (const n of director.track.nodes) {
    const k = Math.abs(n.kappaLine);
    if (k < bestK) {
      bestK = k;
      bestS = n.s;
    }
  }

  const raceDist = (c: { lap: number; s: number }) => c.lap * director.track.length + c.s;
  ai.lap = 0;
  ai.s = bestS;
  ai.l = 0;
  ai.dl = 0;
  ai.v = 12;
  ai.gear = 3;
  ai.slotMode = 'groove';
  ai.lTarget = 0;
  player.lap = 0;
  player.s = (bestS - 2.0 + director.track.length) % director.track.length;
  player.l = 0.25;
  player.dl = 0;
  player.v = 22;
  player.gear = 4;
  player.slotMode = 'groove';
  player.lTarget = 0.25;

  let maxAbsLEarly = 0;
  let sameLanePass = 0;
  let minFollowerV = player.v;

  for (let i = 0; i < 90; i++) {
    director.setPlayerPedals(1, 0, true);
    director.update(PHYSICS.dt);
    const absL = Math.abs(player.l - ai.l);
    const dS = raceDist(player) - raceDist(ai);
    if (i < 12) maxAbsLEarly = Math.max(maxAbsLEarly, absL);
    minFollowerV = Math.min(minFollowerV, player.v);
    // Phantom: go ahead while still sharing the lane.
    if (dS > 0 && absL < PHYSICS.carWidth * 0.55) sameLanePass += 1;
  }

  // Instant peel to ~carWidth while nested in S is the phantom signature.
  const noInstantPeel = maxAbsLEarly < PHYSICS.carWidth * 0.85;
  const stayedBehindOrOffset =
    sameLanePass === 0 &&
    (raceDist(player) <= raceDist(ai) || Math.abs(player.l - ai.l) >= PHYSICS.carWidth * 0.5);
  const speedMatched = minFollowerV <= ai.v * 1.15 + 2;
  const ok = noInstantPeel && stayedBehindOrOffset && speedMatched;

  return {
    id: 'PACK_CONTACT',
    ok,
    detail: `maxAbsLEarly=${maxAbsLEarly.toFixed(2)} sameLanePass=${sameLanePass} minFv=${minFollowerV.toFixed(1)} aiV=${ai.v.toFixed(1)} finalDs=${(raceDist(player) - raceDist(ai)).toFixed(2)} finalAbsL=${Math.abs(player.l - ai.l).toFixed(2)}`,
  };
}

/** No arbitrary pace handicap — player live vMax/aAccel equal raw part+driver stats. */
export function runPlayerPacePhysGate(): FeelGateResult {
  const director = new RaceDirector(baseConfig(77_012));
  const player = director.cars.find((c) => c.isPlayerControlled);
  if (!player) {
    return { id: 'PLAYER_PACE_PHYS', ok: false, detail: 'no player' };
  }
  const raw = effectiveStats(
    'track',
    defaultVehicleSave(BALANCE.startingPartTier).partTiers,
    BALANCE.conditionMax,
  );
  const vOk = Math.abs(player.stats.vMax - raw.vMax) < 0.05;
  const aOk = Math.abs(player.stats.aAccel - raw.aAccel) < 0.05;
  return {
    id: 'PLAYER_PACE_PHYS',
    ok: vOk && aOk,
    detail: `vMax=${player.stats.vMax.toFixed(2)} raw=${raw.vMax.toFixed(2)} aAccel=${player.stats.aAccel.toFixed(2)} rawA=${raw.aAccel.toFixed(2)}`,
  };
}

/**
 * Races must not cut the pack off mid-final-lap. The player is a slow chicane
 * (throttle 0.3) so the equal AI field races itself. Invariant: every finished
 * car either completed all its scheduled laps, or crossed the line after the
 * checkered flag (classified, possibly lapped) — a car cut off by a timer
 * without a flag-crossing fails. This catches a regression to the old
 * fixed-10s finish window (which cut back markers off mid-lap), and guards
 * the old "finish in ~1.6s" bug: no car ever classifies at lap 0.
 */
export function runFinishLapCutoffGate(): FeelGateResult {
  const format = FORMATS.find((f) => f.id === '1v1v1v1') ?? FORMATS[0]!;
  const seeds = [11_001, 22_002, 33_003, 44_004, 55_005];
  let samples = 0;
  let cutOff = 0;
  let zeroLap = 0;

  for (const seed of seeds) {
    for (const laps of [2, 3]) {
      const director = new RaceDirector({
        discipline: 'track',
        trackSeed: 50_000 + seed,
        raceSeed: seed,
        laps,
        format,
        playerTeamDrivers: [makeDriver('lead', 35)],
        leadDriverId: 'lead',
        playerVehicle: defaultVehicleSave(BALANCE.startingPartTier),
        opponentBudget: [340, 360],
        opponentPartRange: [5, 5],
      });
      skipCountdown(director);
      let guard = 0;
      while (!director.isRaceFinished && guard < 60_000) {
        director.setPlayerPedals(0.3, 0);
        director.update(PHYSICS.dt * 40);
        guard += 1;
      }
      samples += 1;
      const classified = director.flagClassifiedIds;
      for (const c of director.cars) {
        if (!c.finished) continue;
        // The player is an intentionally slow chicane and is legitimately lapped.
        if (c.lap < laps && !classified.has(c.id) && !c.isPlayerControlled) cutOff += 1;
        if (c.lap <= 0) zeroLap += 1;
      }
    }
  }

  return {
    id: 'FINISH_LAP_CUTOFF',
    ok: cutOff === 0 && zeroLap === 0,
    detail: `samples=${samples} timerCutOff=${cutOff} zeroLap=${zeroLap}`,
  };
}

export function runHarnessGates(): FeelGateResult[] {
  void mulberry32;
  return [
    runRejoinGate(),
    runCrashStunGate(),
    runDraftTowGate(),
    runGearAssistGate(),
    runGearNoMissGate(),
    runPlayerPacePhysGate(),
    runPackContactGate(),
    runFinishLapCutoffGate(),
  ];
}
