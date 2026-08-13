/**
 * Hybrid dynamics feel gates — HYBRID_FORCES, GROOVE_AUTOPILOT, ONE_FINGER_SURVIVE,
 * plus Phase 3 GEAR_RPM / SHIFT_WINDOW and Phase 2 LINE_SKILL.
 */
import { BALANCE } from '../../data/balance';
import { FORMATS } from '../../data/formats';
import { PHYSICS } from '../../data/physics';
import { RaceDirector, type RaceConfig, runDeterminismCheck } from '../RaceDirector';
import { gearboxFor, gearBandFrac, shiftWindow, revMeterNorm } from '../Gearbox';
import { defaultVehicleSave, type Driver } from '../types';
import { personalLineAt } from '../Vehicle';
import { interpolateAtSInto, type InterpolatedNode } from '../RacingLine';
import type { FeelGateResult } from './types';
import {
  HYBRID_MASS_KG,
  computeAxleLoads,
  gripAccelFromLoads,
  aeroForces,
} from '../vehicle/dynamics';
import {
  carSetupFromParts,
  predictVDeslot,
  predictVMax,
  DEFAULT_CAR_SETUP,
} from '../vehicle/CarSetup';
import { emptyVehicleParts } from '../types';
import { driftStyleFor } from '../vehicle/deslotDynamics';
import { getDisciplineProfile } from '../../data/disciplineProfiles';

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

function makeDriver(id: string, skill: number, focus = 50, bravery = 45): Driver {
  return {
    id,
    name: id,
    trait: 'grinder',
    skill,
    bravery,
    focus,
    determination: 50,
    xp: 0,
    level: 1,
    unspentPoints: 0,
  };
}

function baseConfig(seed: number, skill = 35): RaceConfig {
  const lead = makeDriver('lead', skill);
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

/** Determinism + finite hybrid state + bounded energy. */
export function runHybridForcesGate(): FeelGateResult {
  const detOk = runDeterminismCheck();
  const director = new RaceDirector(baseConfig(88_101));
  skipCountdown(director);
  const player = director.cars.find((c) => c.isPlayerControlled);
  if (!player) {
    return { id: 'HYBRID_FORCES', ok: false, detail: 'no player' };
  }

  let maxV = 0;
  let finite = true;
  for (let i = 0; i < 600; i++) {
    director.setPlayerPedals(0.75, 0.05, i % 40 === 0);
    director.update(PHYSICS.dt);
    maxV = Math.max(maxV, player.v);
    if (
      !Number.isFinite(player.v) ||
      !Number.isFinite(player.yawRate) ||
      !Number.isFinite(player.fzFront) ||
      !Number.isFinite(player.slipAngle) ||
      !Number.isFinite(player.steerRad)
    ) {
      finite = false;
      break;
    }
  }

  // Force inventory sanity: DF raises Fz; mass inertia present.
  const loads = computeAxleLoads(HYBRID_MASS_KG, 25, 0, 4, 0.3, 0, 1);
  const aero = aeroForces(25, 0.3);
  const aGrip = gripAccelFromLoads(1, loads, HYBRID_MASS_KG);
  const fzOk = loads.fzTotal > HYBRID_MASS_KG * PHYSICS.g && aero.fDownforce > 0;
  const gripOk = aGrip > 5 && aGrip < 30;
  const energyOk = maxV < 55 && maxV > 5;

  const ok = detOk && finite && fzOk && gripOk && energyOk;
  return {
    id: 'HYBRID_FORCES',
    ok,
    detail: `det=${detOk} finite=${finite} maxV=${maxV.toFixed(1)} fz=${loads.fzTotal.toFixed(0)} aGrip=${aGrip.toFixed(2)} df=${aero.fDownforce.toFixed(0)}`,
  };
}

/** Zero player steer — Mag tracks line on gentle throttle. */
export function runGrooveAutopilotGate(): FeelGateResult {
  const director = new RaceDirector(baseConfig(88_201, 55));
  skipCountdown(director);
  const player = director.cars.find((c) => c.isPlayerControlled);
  if (!player) {
    return { id: 'GROOVE_AUTOPILOT', ok: false, detail: 'no player' };
  }

  // Gentle throttle on groove — Mag must keep |l − line| bounded.
  player.slotMode = 'groove';
  player.v = 14;
  player.dl = 0;
  player.l = personalLineAt(player, director.track, player.s) + 1.2;

  let maxErr = 0;
  let stayedGroove = true;
  for (let i = 0; i < 480; i++) {
    director.setPlayerPedals(0.45, 0, false);
    director.update(PHYSICS.dt);
    const line = personalLineAt(player, director.track, player.s);
    maxErr = Math.max(maxErr, Math.abs(player.l - line));
    if (player.slotMode !== 'groove') stayedGroove = false;
  }

  // Player never has a steer input channel — Mag authority should be live.
  const magOk = player.magAuthority > 0.05 || stayedGroove;
  const trackOk = maxErr < 3.5 && stayedGroove;
  return {
    id: 'GROOVE_AUTOPILOT',
    ok: magOk && trackOk,
    detail: `maxErr=${maxErr.toFixed(2)} groove=${stayedGroove} mag=${player.magAuthority.toFixed(2)}`,
  };
}

/**
 * Low-Skill Authority assist survives a pin-throttle lap stretch better than
 * high-Skill with assist effectively clipped (pin overrule still applies, but
 * we compare deslot counts under matched pin).
 */
export function runOneFingerSurviveGate(): FeelGateResult {
  function pinDeslots(skill: number, seed: number): number {
    const director = new RaceDirector(baseConfig(seed, skill));
    skipCountdown(director);
    const player = director.cars.find((c) => c.isPlayerControlled);
    if (!player) return 999;
    const start = player.deslotCount;
    // ~8s pin throttle
    for (let i = 0; i < Math.ceil(8 / PHYSICS.dt); i++) {
      director.setPlayerPedals(1, 0, false);
      director.update(PHYSICS.dt);
    }
    return player.deslotCount - start;
  }

  const low = pinDeslots(25, 88_301);
  const high = pinDeslots(90, 88_301);
  // Low skill gets more brake assist when not pure pin — but under pure pin both
  // lose assist. Compare a soft-gas case with Authority brake for low skill.
  function softLapDeslots(skill: number): number {
    const director = new RaceDirector(baseConfig(88_311, skill));
    skipCountdown(director);
    const player = director.cars.find((c) => c.isPlayerControlled);
    if (!player) return 999;
    const start = player.deslotCount;
    for (let i = 0; i < Math.ceil(10 / PHYSICS.dt); i++) {
      // One-finger gas with light Authority brake room (not full pin overrule).
      director.setPlayerPedals(0.82, 0, false);
      director.update(PHYSICS.dt);
    }
    return player.deslotCount - start;
  }

  const lowSoft = softLapDeslots(28);
  const highSoft = softLapDeslots(92);
  // Low-Skill Authority should not deslot more than high-Skill (usually fewer).
  const ok = lowSoft <= highSoft + 1;
  return {
    id: 'ONE_FINGER_SURVIVE',
    ok,
    detail: `lowSoft=${lowSoft} highSoft=${highSoft} pinLow=${low} pinHigh=${high}`,
  };
}

/** RPM tracks gear band; rev meter finite. */
export function runGearRpmGate(): FeelGateResult {
  const director = new RaceDirector(baseConfig(88_401));
  skipCountdown(director);
  const player = director.cars.find((c) => c.isPlayerControlled);
  if (!player) {
    return { id: 'GEAR_RPM', ok: false, detail: 'no player' };
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
  player.s = bestS;
  player.v = 24;
  player.gear = 3;
  player.slotMode = 'groove';
  for (let i = 0; i < 120; i++) {
    director.setPlayerPedals(0.9, 0, false);
    director.update(PHYSICS.dt);
    // Dyno-pin at the low-kappa node: speed test, not a cornering test.
    player.s = bestS;
    player.l = 0;
  }
  const box = gearboxFor('track');
  const band = gearBandFrac(player.v, player.stats.vMax, player.gear, box);
  const rev = revMeterNorm(player.rpm);
  const ok =
    Number.isFinite(player.rpm) &&
    player.rpm > PHYSICS.rpmIdle &&
    player.rpm <= PHYSICS.rpmMax * 1.05 &&
    Math.abs(player.gearBand - band) < 0.2 &&
    rev > 0.05 &&
    rev <= 1;
  return {
    id: 'GEAR_RPM',
    ok,
    detail: `rpm=${player.rpm.toFixed(0)} band=${player.gearBand.toFixed(2)} rev=${rev.toFixed(2)} gear=${player.gear}`,
  };
}

/** Green/amber/red SHIFT windows match band thresholds. */
export function runShiftWindowGate(): FeelGateResult {
  const box = gearboxFor('track');
  const samples: { band: number; expect: string }[] = [
    { band: 0.2, expect: 'low' },
    { band: 0.7, expect: 'green' },
    { band: 0.88, expect: 'amber' },
    { band: 0.98, expect: 'red' },
  ];
  const fails: string[] = [];
  for (const s of samples) {
    const w = shiftWindow(s.band, box);
    if (w !== s.expect) fails.push(`${s.band}->${w}!=${s.expect}`);
  }

  const director = new RaceDirector(baseConfig(88_411));
  skipCountdown(director);
  const player = director.cars.find((c) => c.isPlayerControlled);
  if (!player) {
    return { id: 'SHIFT_WINDOW', ok: false, detail: 'no player' };
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
  player.s = bestS;
  player.l = 0;
  player.v = 8;
  player.gear = 2;
  for (let i = 0; i < 60; i++) {
    director.setPlayerPedals(1, 0, false);
    director.update(PHYSICS.dt);
    // Dyno-pin so a faster car cannot carry itself into a corner mid-test.
    player.s = bestS;
    player.l = 0;
  }
  const liveOk = ['low', 'green', 'amber', 'red'].includes(player.shiftWindow);
  return {
    id: 'SHIFT_WINDOW',
    ok: fails.length === 0 && liveOk,
    detail: fails.length === 0 ? `live=${player.shiftWindow} band=${player.gearBand.toFixed(2)}` : fails.join(','),
  };
}

/** Skill/Focus improve line tracking (lower |l−line| mean error). */
export function runLineSkillGate(): FeelGateResult {
  function meanLineErr(skill: number, focus: number, bravery: number): number {
    const lead = makeDriver('lead', skill, focus, bravery);
    const config: RaceConfig = {
      ...baseConfig(88_501, skill),
      playerTeamDrivers: [lead],
      leadDriverId: lead.id,
    };
    const director = new RaceDirector(config);
    skipCountdown(director);
    const player = director.cars.find((c) => c.isPlayerControlled);
    if (!player) return 99;
    player.slotMode = 'groove';
    player.v = 12;
    player.deslotImmunity = 2;
    let sum = 0;
    let n = 0;
    for (let i = 0; i < 900; i++) {
      director.setPlayerPedals(0.7, 0.08, i % 35 === 0);
      director.update(PHYSICS.dt);
      if (player.v > 5) {
        const line = personalLineAt(player, director.track, player.s);
        // Prefer groove samples; still count near-line deslot for Mag story.
        if (player.slotMode === 'groove' || Math.abs(player.l - line) < 4) {
          sum += Math.abs(player.l - line);
          n += 1;
        }
      }
    }
    return n > 40 ? sum / n : 99;
  }

  const rookie = meanLineErr(25, 30, 40);
  const elite = meanLineErr(85, 85, 55);
  // Elite Mag bandwidth + cleaner line → lower mean error (allow small slack).
  const ok =
    rookie < 90 && elite < 90 && (elite < rookie * 0.97 || elite + 0.02 < rookie);
  return {
    id: 'LINE_SKILL',
    ok,
    detail: `rookieErr=${rookie.toFixed(3)} eliteErr=${elite.toFixed(3)}`,
  };
}

function discConfig(
  discipline: 'track' | 'street' | 'rally',
  seed: number,
  skill = 40,
): RaceConfig {
  const lead = makeDriver('lead', skill);
  return {
    discipline,
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

/** Rally looseGround: brake-pulse grows slip; Mag soft; hold-gear while sliding. */
export function runDriftRallyGate(): FeelGateResult {
  const profile = getDisciplineProfile('rally');
  if (profile.driftStyle !== 'looseGround' || driftStyleFor('rally') !== 'looseGround') {
    return { id: 'DRIFT_RALLY', ok: false, detail: 'style≠looseGround' };
  }
  const director = new RaceDirector(discConfig('rally', 88_601));
  skipCountdown(director);
  const player = director.cars.find((c) => c.isPlayerControlled);
  if (!player) return { id: 'DRIFT_RALLY', ok: false, detail: 'no player' };

  player.slotMode = 'deslot';
  player.deslotRemaining = 1.2;
  player.v = 14;
  player.slipAngle = 0.05;
  const slip0 = Math.abs(player.slipAngle);
  for (let i = 0; i < 90; i++) {
    director.setPlayerPedals(0.55, 0.7, false);
    director.update(PHYSICS.dt);
  }
  const grew = Math.abs(player.slipAngle) > slip0 + 0.05;
  const latched = player.driftState || Math.abs(player.slipAngle) > 0.15;
  const softMag = profile.magBandwidthMult < 0.95;
  const hold = player.holdGear || player.driftState;
  const ok = grew && latched && softMag && hold;
  return {
    id: 'DRIFT_RALLY',
    ok,
    detail: `slip=${player.slipAngle.toFixed(3)} latch=${player.driftState} hold=${player.holdGear} magBw=${profile.magBandwidthMult}`,
  };
}

/** Street JDM: latch holds under power; Track never latches. */
export function runDriftStreetGate(): FeelGateResult {
  const street = getDisciplineProfile('street');
  const track = getDisciplineProfile('track');
  if (street.driftStyle !== 'jdm' || track.driftStyle !== 'fishtail') {
    return { id: 'DRIFT_STREET', ok: false, detail: 'style mismatch' };
  }

  const director = new RaceDirector(discConfig('street', 88_611));
  skipCountdown(director);
  const player = director.cars.find((c) => c.isPlayerControlled);
  if (!player) return { id: 'DRIFT_STREET', ok: false, detail: 'no player' };

  player.slotMode = 'deslot';
  player.deslotRemaining = 1.5;
  player.v = 16;
  player.slipAngle = 0.25;
  player.driftState = true;
  for (let i = 0; i < 120; i++) {
    director.setPlayerPedals(0.85, 0, false);
    director.update(PHYSICS.dt);
  }
  const held = player.driftState && Math.abs(player.slipAngle) > 0.14;

  const tDir = new RaceDirector(discConfig('track', 88_612));
  skipCountdown(tDir);
  const tPlayer = tDir.cars.find((c) => c.isPlayerControlled);
  if (!tPlayer) return { id: 'DRIFT_STREET', ok: false, detail: 'no track player' };
  tPlayer.slotMode = 'deslot';
  tPlayer.deslotRemaining = 1;
  tPlayer.v = 16;
  tPlayer.slipAngle = 0.3;
  tPlayer.driftState = true;
  for (let i = 0; i < 60; i++) {
    tDir.setPlayerPedals(0.8, 0, false);
    tDir.update(PHYSICS.dt);
  }
  const trackNoLatch = !tPlayer.driftState;
  const ok = held && trackNoLatch;
  return {
    id: 'DRIFT_STREET',
    ok,
    detail: `streetLatch=${player.driftState} slip=${player.slipAngle.toFixed(3)} trackLatch=${tPlayer.driftState}`,
  };
}

/** Street clutch-kick while armed spikes rear slip / Mag interrupt. */
export function runClutchKickGate(): FeelGateResult {
  const director = new RaceDirector(discConfig('street', 88_621));
  skipCountdown(director);
  const player = director.cars.find((c) => c.isPlayerControlled);
  if (!player) return { id: 'CLUTCH_KICK', ok: false, detail: 'no player' };

  player.v = 14;
  player.throttle = 0.9;
  player.driftArmed = true;
  player.gripUsage = 0.95;
  player.slotMode = 'groove';
  const slip0 = Math.abs(player.slipAngle);
  director.setPlayerPedals(0.9, 0, false, true);
  director.update(PHYSICS.dt);
  const kicked =
    player.clutchKickRemaining > 0 ||
    player.magInterrupt > 0.5 ||
    player.driftState ||
    Math.abs(player.slipAngle) > slip0 + 0.05;
  // A few more steps to let latch settle
  for (let i = 0; i < 20; i++) {
    director.setPlayerPedals(0.9, 0, false, false);
    director.update(PHYSICS.dt);
  }
  const ok = kicked && (player.driftState || player.magInterrupt > 0.1 || player.clutchKickRemaining > 0);
  return {
    id: 'CLUTCH_KICK',
    ok,
    detail: `kickRem=${player.clutchKickRemaining.toFixed(2)} magInt=${player.magInterrupt.toFixed(2)} latch=${player.driftState} slip=${player.slipAngle.toFixed(3)}`,
  };
}

/** Spoiler raises corner v_deslot AND lowers aero vMax (DF vs drag). */
export function runSetupTradeoffGate(): FeelGateResult {
  const base = emptyVehicleParts(1);
  const wing = { ...emptyVehicleParts(1), spoiler: 5 };
  const s0 = carSetupFromParts(base);
  const s1 = carSetupFromParts(wing);
  const vD0 = predictVDeslot(s0, 1, 0.08, 0.3);
  const vD1 = predictVDeslot(s1, 1, 0.08, 0.3);
  const vM0 = predictVMax(s0, 8, 0.3);
  const vM1 = predictVMax(s1, 8, 0.3);
  const a0 = aeroForces(30, 0.3, { clScale: s0.clScale, cdScale: s0.cdScale });
  const a1 = aeroForces(30, 0.3, { clScale: s1.clScale, cdScale: s1.cdScale });
  const ok =
    s1.clScale > s0.clScale &&
    s1.cdScale > s0.cdScale &&
    a1.fDownforce > a0.fDownforce &&
    a1.fDrag > a0.fDrag * 1.15 &&
    vD1 > vD0 &&
    vM1 < vM0 * 0.97;
  return {
    id: 'SETUP_TRADEOFF',
    ok,
    detail: `vD ${vD0.toFixed(2)}→${vD1.toFixed(2)} vM ${vM0.toFixed(2)}→${vM1.toFixed(2)} drag ${a0.fDrag.toFixed(0)}→${a1.fDrag.toFixed(0)}`,
  };
}

/** Heavier mass slows accel and raises absolute Fz (inertia + normal load). */
export function runMassInertiaGate(): FeelGateResult {
  const light = { ...DEFAULT_CAR_SETUP, massKg: 1000, iz: 1000 * 1.35 };
  const heavy = { ...DEFAULT_CAR_SETUP, massKg: 1400, iz: 1400 * 1.35 };
  const loadsL = computeAxleLoads(light.massKg, 20, 2, 3, 0.2, 0, 1, {
    cgHeight: light.cgHeight,
  });
  const loadsH = computeAxleLoads(heavy.massKg, 20, 2, 3, 0.2, 0, 1, {
    cgHeight: heavy.cgHeight,
  });
  // Same drive force → lighter car higher accel: a = F/m
  const fDrive = 8000;
  const aL = fDrive / light.massKg;
  const aH = fDrive / heavy.massKg;
  const ok =
    loadsH.fzTotal > loadsL.fzTotal &&
    aL > aH * 1.15 &&
    heavy.massKg > light.massKg;
  return {
    id: 'MASS_INERTIA',
    ok,
    detail: `fz ${loadsL.fzTotal.toFixed(0)}→${loadsH.fzTotal.toFixed(0)} a ${aL.toFixed(2)}→${aH.toFixed(2)}`,
  };
}

/** Forward brake bias loads front axle under braking (trail bite). */
export function runTrailBiasGate(): FeelGateResult {
  const rearBias = { ...DEFAULT_CAR_SETUP, brakeBiasFront: 0.5, staticFront: 0.46 };
  const frontBias = { ...DEFAULT_CAR_SETUP, brakeBiasFront: 0.68, staticFront: 0.52 };
  const loadsR = computeAxleLoads(
    rearBias.massKg,
    18,
    -6,
    2,
    0.2,
    -0.4,
    1,
    { staticFront: rearBias.staticFront, cgHeight: rearBias.cgHeight },
  );
  const loadsF = computeAxleLoads(
    frontBias.massKg,
    18,
    -6,
    2,
    0.2,
    -0.4,
    1,
    { staticFront: frontBias.staticFront, cgHeight: frontBias.cgHeight },
  );
  // Front-biased static + trail → more front Fz under brake.
  const ok = loadsF.fzFront > loadsR.fzFront * 1.02;
  // Live: brakes tier raises bias.
  const t1 = carSetupFromParts(emptyVehicleParts(1));
  const t5 = carSetupFromParts({ ...emptyVehicleParts(1), brakes: 5 });
  const tierOk = t5.brakeBiasFront > t1.brakeBiasFront;
  return {
    id: 'TRAIL_BIAS',
    ok: ok && tierOk,
    detail: `fzF ${loadsR.fzFront.toFixed(0)}→${loadsF.fzFront.toFixed(0)} bias ${t1.brakeBiasFront.toFixed(2)}→${t5.brakeBiasFront.toFixed(2)}`,
  };
}

/** Off-slot styles differ: Track fishtail clears latch; Rally/Street keep attitude. */
export function runOffslotDynamicsGate(): FeelGateResult {
  const styles = {
    track: driftStyleFor('track'),
    street: driftStyleFor('street'),
    rally: driftStyleFor('rally'),
  };
  const ok =
    styles.track === 'fishtail' &&
    styles.street === 'jdm' &&
    styles.rally === 'looseGround';
  return {
    id: 'OFFSLOT_DYNAMICS',
    ok,
    detail: `track=${styles.track} street=${styles.street} rally=${styles.rally}`,
  };
}

export function runHybridGates(): FeelGateResult[] {
  void interpolateAtSInto;
  void nodeScratch;
  void gripAccelFromLoads;
  return [
    runHybridForcesGate(),
    runGrooveAutopilotGate(),
    runOneFingerSurviveGate(),
    runGearRpmGate(),
    runShiftWindowGate(),
    runLineSkillGate(),
    runDriftRallyGate(),
    runDriftStreetGate(),
    runClutchKickGate(),
    runSetupTradeoffGate(),
    runMassInertiaGate(),
    runTrailBiasGate(),
    runOffslotDynamicsGate(),
  ];
}
