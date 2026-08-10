import { BALANCE } from '../../data/balance';
import { FORMATS } from '../../data/formats';
import { PHYSICS } from '../../data/physics';
import { RaceDirector, type RaceConfig } from '../RaceDirector';
import { enterDeslot } from '../Vehicle';
import { interpolateAtSInto, type InterpolatedNode } from '../RacingLine';
import { defaultVehicleSave, type Driver } from '../types';
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

function skipCountdown(director: RaceDirector): void {
  let guard = 0;
  while (director.countdown !== null && guard < 500) {
    director.update(PHYSICS.dt * 20);
    guard += 1;
  }
}

/** Street: pin-throttle / forced wall contact should register wallHits. */
export function runStreetWallBiteGate(): FeelGateResult {
  const lead = makeDriver('lead', 30);
  const config: RaceConfig = {
    discipline: 'street',
    trackSeed: 91_002,
    raceSeed: 91_001,
    laps: 2,
    format: FORMATS.find((f) => f.id === '1v1') ?? FORMATS[0]!,
    playerTeamDrivers: [lead],
    leadDriverId: lead.id,
    playerVehicle: defaultVehicleSave(BALANCE.startingPartTier),
    opponentBudget: [200, 260],
    opponentPartRange: [2, 3],
    archetypeHint: 'street',
  };
  const director = new RaceDirector(config);
  skipCountdown(director);
  const player = director.cars.find((c) => c.isPlayerControlled);
  if (!player) {
    return { id: 'STREET_WALL_BITE', ok: false, detail: 'no player' };
  }

  // Force into the hard barrier (street has little runoff).
  player.v = 24;
  player.slotMode = 'deslot';
  player.deslotRemaining = 0.4;
  const node = interpolateAtSInto(
    director.track.nodes,
    director.track.length,
    player.s,
    nodeScratch,
  );
  const wall = node.width / 2 + node.runoffWidth - PHYSICS.wallMargin;
  player.l = wall + 0.25;
  player.dl = 9;
  player.wallHits = 0;

  for (let i = 0; i < 60; i++) {
    director.setPlayerPedals(1, 0, true);
    director.update(PHYSICS.dt);
  }

  const ok = player.wallHits >= 1;
  return {
    id: 'STREET_WALL_BITE',
    ok,
    detail: `wallHits=${player.wallHits} stun=${player.stunRemaining.toFixed(2)} |l|=${Math.abs(player.l).toFixed(2)}`,
  };
}

/** Rally: enterDeslot should stay off-slot longer than baseline. */
export function runRallyDeslotLongGate(): FeelGateResult {
  const lead = makeDriver('lead', 40);
  const config: RaceConfig = {
    discipline: 'rally',
    trackSeed: 55_001,
    raceSeed: 55_002,
    laps: 1,
    format: FORMATS.find((f) => f.id === '1v1') ?? FORMATS[0]!,
    playerTeamDrivers: [lead],
    leadDriverId: lead.id,
    playerVehicle: defaultVehicleSave(BALANCE.startingPartTier),
    opponentBudget: [200, 260],
    opponentPartRange: [2, 3],
  };
  const director = new RaceDirector(config);
  skipCountdown(director);
  const player = director.cars.find((c) => c.isPlayerControlled);
  if (!player) {
    return { id: 'RALLY_DESLOT_LONG', ok: false, detail: 'no player' };
  }

  player.v = 14;
  const node = interpolateAtSInto(
    director.track.nodes,
    director.track.length,
    player.s,
    nodeScratch,
  );
  enterDeslot(player, node.kappaLine, Math.max(8, player.vDeslot || 10), 'rally');

  const ok = player.deslotRemaining >= PHYSICS.deslotMinTime * 1.2;
  return {
    id: 'RALLY_DESLOT_LONG',
    ok,
    detail: `deslotRemaining=${player.deslotRemaining.toFixed(3)} min=${PHYSICS.deslotMinTime} need>=${(PHYSICS.deslotMinTime * 1.2).toFixed(3)}`,
  };
}

export function runDisciplineGates(): FeelGateResult[] {
  return [runStreetWallBiteGate(), runRallyDeslotLongGate()];
}
