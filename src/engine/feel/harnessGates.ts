import { BALANCE } from '../../data/balance';
import { FORMATS } from '../../data/formats';
import { PHYSICS } from '../../data/physics';
import { RaceDirector, type RaceConfig } from '../RaceDirector';
import { enterDeslot } from '../Vehicle';
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

export function runHarnessGates(): FeelGateResult[] {
  // Avoid mulberry noise in gate identity
  void mulberry32;
  return [runRejoinGate(), runCrashStunGate(), runDraftTowGate()];
}
