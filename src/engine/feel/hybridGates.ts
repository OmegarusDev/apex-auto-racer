/**
 * Discipline + recovery gates — three sports on one physics core.
 */
import { PHYSICS } from '../../data/physics';
import { SURFACES } from '../../data/surfaces';
import { buildCircleTrack } from './harnessGates';
import { createCarState, buildVehicleContext } from '../Vehicle';
import { effectiveStats } from '../stats';
import { defaultVehicleSave } from '../types';
import { tickDriverBrain, createBrainState, type BrainTickContext } from '../DriverBrain';
import { updateVehicle } from '../sim/update';
import { stepVehicle } from '../sim/vehicle';
import { mulberry32 } from '../rng';
import type { RaceConfig } from '../RaceDirector';
import type { FeelGateResult } from './types';

function makeProbe(staticFront = 0.48) {
  const stats = effectiveStats('track', defaultVehicleSave(1).partTiers, 1);
  const car = createCarState('p', 'd', 0, false, stats, 1, 0, 0, 1);
  car.setup = {
    ...car.setup,
    massKg: 1180,
    cgHeight: 0.42,
    staticFront,
    wheelbase: 2.7,
    iz: 1180 * (1.28 + 0.42 * 0.15),
    suspStiffness: 1,
    compoundMu: 1,
    brakeBiasFront: 0.6,
    clScale: 1,
    cdScale: 1,
    finalDrive: 1,
    driveBias: 0,
  };
  return car;
}

function driverFor() {
  return {
    id: 'd', name: 'd', trait: 'grinder' as const, skill: 60, bravery: 50, focus: 60,
    determination: 50, xp: 0, level: 1, unspentPoints: 0,
  };
}

function brainCtx(track: ReturnType<typeof buildCircleTrack>): BrainTickContext {
  return {
    track,
    driver: driverFor(),
    discipline: 'track',
    modifierStack: [],
    rivals: [],
    draft: 0,
    rain: false,
    muSurface: SURFACES.track.mu,
    raceTime: 0,
    isFinalLap: false,
    isLeading: false,
    leadingMarginSec: 0,
    position: 1,
    totalCars: 1,
    rng: mulberry32(7),
    contactBlocked: false,
  };
}

function ctxFor(car: ReturnType<typeof makeProbe>) {
  return buildVehicleContext(driverFor(), 1, 1, car.stats, [], 'track', 1, 0, false, 0);
}

/** Discipline surface signatures — data-level, deterministic. */
export function runDisciplineIdentityGate(): FeelGateResult[] {
  const t = SURFACES.track!;
  const s = SURFACES.street!;
  const r = SURFACES.rally!;
  const muOrder = t.mu > s.mu && s.mu > r.mu;
  // Driftability: later peak + gentler falloff on Street, then Rally, then Track.
  const driftOrder = s.alphaPeakDeg > r.alphaPeakDeg && r.alphaPeakDeg >= t.alphaPeakDeg;
  return [
    {
      id: 'DISCIPLINE_IDENTITY',
      ok: muOrder && driftOrder,
      detail: `mu track=${t.mu} street=${s.mu} rally=${r.mu} | alphaPeak street=${s.alphaPeakDeg}° rally=${r.alphaPeakDeg}° track=${t.alphaPeakDeg}°`,
    },
    {
      id: 'RALLY_LOOSE_UNDER_BRAKE',
      ok: r.brakingMuLoss > 0.1 && t.brakingMuLoss === 0 && r.noise > 0.02,
      detail: `rally brakingMuLoss=${r.brakingMuLoss} noise=${r.noise}`,
    },
  ];
}

/** A wide run (on-track, off-line) is recovered by the driver — no marshal. */
export function runRejoinNaturalGate(): FeelGateResult {
  const car = makeProbe();
  car.l = 3;
  car.v = 8;
  car.slipAngle = 0.05;
  car.slotMode = 'deslot';
  const state = createBrainState();
  const ctx = ctxFor(car);
  const track = buildCircleTrack(60, 33, 6);
  const bctx = brainCtx(track);
  const l0 = car.l;
  let minAbsL = Math.abs(l0);
  for (let t = 0; t < 3.5; t += PHYSICS.dt) {
    const out = tickDriverBrain(state, car, bctx);
    // The player lifts through the recovery (cautious) — realistic and gentle.
    updateVehicle(car, track, PHYSICS.dt, { throttle: 0.4, brake: 0 }, out, ctx);
    minAbsL = Math.min(minAbsL, Math.abs(car.l));
  }
  const recovered = minAbsL < 2.5;
  return {
    id: 'REJOIN_NATURAL',
    ok: recovered && car.penaltySec === 0,
    detail: `l ${l0.toFixed(1)} -> min ${minAbsL.toFixed(2)} (end ${car.l.toFixed(2)}) penalty=${car.penaltySec}`,
  };
}

/** A stopped, backward car is re-slotted by the marshal — diegetic, priced. */
export function runMarshalGate(): FeelGateResult {
  const car = makeProbe();
  car.l = 1;
  car.v = 0;
  car.slipAngle = 2.6; // facing backward
  car.yawRate = 0;
  const track = buildCircleTrack(60, 33, 6);
  for (let t = 0; t < 2.0; t += PHYSICS.dt) {
    stepVehicle(car, track, PHYSICS.dt, 0, 0, 0, 'track', 1, false);
  }
  return {
    id: 'MARSHAL_ONLY_WHEN_STUCK',
    ok: car.penaltySec > 0 && Math.abs(car.slipAngle) < 0.05 && Math.abs(car.l) < 2,
    detail: `penalty=${car.penaltySec.toFixed(1)}s beta=${car.slipAngle.toFixed(2)} l=${car.l.toFixed(2)}`,
  };
}

export function runHybridGates(): FeelGateResult[] {
  void PHYSICS;
  return [...runDisciplineIdentityGate(), runRejoinNaturalGate(), runMarshalGate()];
}

export type { RaceConfig };
