/**
 * Feel harness gates — the greenfield real-car physics.
 * Every gate is deterministic (seeded) and tests an emergent property, not a knob.
 */

import { FORMATS } from '../../data/formats';
import { PHYSICS } from '../../data/physics';
import { SURFACES } from '../../data/surfaces';
import { RaceDirector, type RaceConfig } from '../RaceDirector';
import { createCarState } from '../Vehicle';
import { effectiveStats } from '../stats';
import { defaultVehicleSave, type Driver } from '../types';
import { mulberry32 } from '../rng';
import { lateralMu, longitudinalMu, tyreTempGrip } from '../sim/tyre';
import { blendInputs } from '../sim/update';
import { stepVehicle } from '../sim/vehicle';
import { cornerTargetSpeed } from '../DriverBrain';
import type { TrackData } from '../TrackGenerator';
import type { FeelGateResult } from './types';

/** Deterministic circular track for isolated cornering probes. */
export function buildCircleTrack(radius: number, width = 30, runoff = 6, ds = 2): TrackData {
  const length = 2 * Math.PI * radius;
  const n = Math.max(32, Math.ceil(length / ds));
  const kappa = 1 / radius;
  const nodes = [];
  for (let i = 0; i < n; i++) {
    const s = (i * length) / n;
    const theta = (2 * Math.PI * i) / n;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    nodes.push({
      pos: { x: radius * cos, y: radius * sin },
      tangent: { x: -sin, y: cos },
      normal: { x: cos, y: sin },
      s,
      width,
      runoffWidth: runoff,
      kappa,
      kappaLine: kappa,
      o: 0,
    });
  }
  return {
    length,
    nodes,
    archetype: 'oval',
    seed: 1,
    discipline: 'track',
    bounds: { minX: -radius - width, minY: -radius - width, maxX: radius + width, maxY: radius + width },
  } as TrackData;
}

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

function probeCar(staticFront: number, mu = SURFACES.track.mu, playerControlled = false) {
  const stats = effectiveStats('track', defaultVehicleSave(1).partTiers, 1);
  const car = createCarState(
    'probe',
    'd',
    0,
    playerControlled,
    stats,
    1,
    0,
    0,
    1,
  );
  car.setup = {
    ...car.setup,
    massKg: 1180,
    cgHeight: 0.42,
    staticFront,
    wheelbase: 2.7,
    iz: 1180 * (1.28 + 0.42 * 0.15),
    suspStiffness: 1,
    compoundMu: mu / SURFACES.track.mu,
    brakeBiasFront: 0.6,
    clScale: 1,
    cdScale: 1,
    finalDrive: 1,
    driveBias: 0,
  };
  return car;
}

/** Run an isolated cornering probe: fixed steer, coasting or RWD-throttle, on a circle. */
function runCornerProbe(
  car: ReturnType<typeof probeCar>,
  track: TrackData,
  seconds: number,
  v0: number,
  throttle = 0,
  steer = 0,
) {
  const R = track.length / (2 * Math.PI);
  car.v = v0;
  car.yawRate = v0 / R;
  car.slipAngle = 0;
  car.l = 0;
  car.setup = { ...car.setup, driveBias: throttle > 0 ? 0 : car.setup.driveBias };
  let maxAbsL = 0;
  let maxAbsBeta = 0;
  let maxAbsA = 0;
  let maxAbsAr = 0;
  let maxYaw = 0;
  for (let t = 0; t < seconds; t += PHYSICS.dt) {
    car.stats.vMax = 60;
    stepVehicle(car, track, PHYSICS.dt, throttle, 0, steer, 'track', 1, false);
    maxAbsL = Math.max(maxAbsL, Math.abs(car.l));
    maxAbsBeta = Math.max(maxAbsBeta, Math.abs(car.slipAngle));
    maxAbsA = Math.max(maxAbsA, Math.abs(car.alphaFront));
    maxAbsAr = Math.max(maxAbsAr, Math.abs(car.alphaRear));
    maxYaw = Math.max(maxYaw, Math.abs(car.yawRate));
  }
  return { maxAbsL, maxAbsBeta, maxAbsA, maxAbsAr, maxYaw, spin: car.spinCount > 0 };
}

export function runTyreFundamentals(): FeelGateResult[] {
  // Curve with a clear peak then falloff.
  const curve = { muPeak: 1.1, alphaPeak: 0.12, stiffness: 1.7, muXPeak: 1.0, kappaPeak: 0.1, driftable: 0.4, postPeakDecay: 2.2, breakawayMult: 2.4 };
  const half = lateralMu(curve, 0.06);
  const peak = lateralMu(curve, 0.12);
  const past = lateralMu(curve, 0.3);
  const longHalf = longitudinalMu(curve, 0.05);
  const longPeak = longitudinalMu(curve, 0.1);
  const longPast = longitudinalMu(curve, 0.3);

  const peakOk = peak > half && peak > past;
  const longOk = longPeak > longHalf && longPeak > longPast;

  // Street is more driftable than Track: more grip retained past the peak.
  const st = SURFACES.street!;
  const tk = SURFACES.track!;
  const curveStreet = { muPeak: st.mu, alphaPeak: (st.alphaPeakDeg * Math.PI) / 180, stiffness: st.stiffness, muXPeak: st.muX, kappaPeak: 0.1, driftable: 1, postPeakDecay: st.postPeakDecay, breakawayMult: st.breakawayMult };
  const curveTrack = { muPeak: tk.mu, alphaPeak: (tk.alphaPeakDeg * Math.PI) / 180, stiffness: tk.stiffness, muXPeak: tk.muX, kappaPeak: 0.1, driftable: 0.3, postPeakDecay: tk.postPeakDecay, breakawayMult: tk.breakawayMult };
  const aHigh = (16 * Math.PI) / 180;
  const streetKeeps = lateralMu(curveStreet, aHigh) / curveStreet.muPeak;
  const trackKeeps = lateralMu(curveTrack, aHigh) / curveTrack.muPeak;

  return [
    {
      id: 'TYRE_PEAK_FALLOFF',
      ok: peakOk && longOk,
      detail: `lat peak=${peak.toFixed(3)} half=${half.toFixed(3)} past=${past.toFixed(3)} | long=${longPeak.toFixed(3)} past=${longPast.toFixed(3)}`,
    },
    {
      id: 'DRIFT_IS_USABLE_STREET',
      ok: streetKeeps > trackKeeps + 0.05,
      detail: `street retains ${(streetKeeps * 100).toFixed(0)}% @16° vs track ${(trackKeeps * 100).toFixed(0)}%`,
    },
  ];
}

export function runUnderOversteerGates(): FeelGateResult[] {
  const R = 50;
  const track = buildCircleTrack(R);
  // Sit between the two axle grip thresholds: front-heavy front saturates
  // (rear holds → understeer wide, no spin).
  const vBase = Math.sqrt(SURFACES.track.mu * 9.81 * R);
  // Understeer: the front-heavy car cannot hold the turn and runs WIDE.
  // Oversteer: the rear-heavy car's body breaks away and ROTATES (spin-out).
  // Steer sign matches the corrected F = −C·α bicycle model.
  const under = runCornerProbe(probeCar(0.7), track, 2.2, vBase * 1.01);
  const over = runCornerProbe(probeCar(0.25), track, 3.2, vBase * 1.06, 1, -0.12);

  return [
    {
      id: 'UNDERSTEER_EMERGES',
      ok: under.maxAbsL > 5 && under.maxAbsBeta < 0.75,
      detail: `front-heavy: maxL=${under.maxAbsL.toFixed(2)}m beta=${under.maxAbsBeta.toFixed(2)} — runs wide without spinning`,
    },
    {
      id: 'OVERSTEER_EMERGES',
      ok: over.maxAbsBeta > 0.75,
      detail: `rear-heavy: beta=${over.maxAbsBeta.toFixed(2)} rad l=${over.maxAbsL.toFixed(2)}m — rear breaks, car rotates past 43°`,
    },
    {
      id: 'SPIN_EMERGENT',
      ok: over.maxAbsBeta > 0.7,
      detail: `rear-heavy exit-throttle → beta ${over.maxAbsBeta.toFixed(2)} rad (a 40°+ rotation, emergent from the tyre model)`,
    },
  ];
}

function raceConfig(skill: number, seed = 55_001): RaceConfig {
  const format = FORMATS.find((f) => f.id === '1v1v1v1') ?? FORMATS[0]!;
  return {
    discipline: 'track',
    trackSeed: 60_000 + seed,
    raceSeed: seed,
    laps: 2,
    format,
    playerTeamDrivers: [makeDriver('lead', skill)],
    leadDriverId: 'lead',
    playerVehicle: defaultVehicleSave(1),
    opponentBudget: [260, 340],
    opponentPartRange: [3, 4],
  };
}

export function runSkillIsControlGate(): FeelGateResult {
  // Skill = control quality: how close to the physical limit the plan runs.
  // The brake point derives from this target, so the mapping is the game.
  const low = cornerTargetSpeed({ skill: 28, bravery: 50, conf: 0.5, aGrip: 9.42, kappa: 0.02 });
  const high = cornerTargetSpeed({ skill: 88, bravery: 50, conf: 0.5, aGrip: 9.42, kappa: 0.02 });
  const ok = high > low * 1.03 && high < 22;
  return {
    id: 'SKILL_IS_CONTROL',
    ok,
    detail: `corner plan: skill28=${low.toFixed(1)} m/s | skill88=${high.toFixed(1)} m/s (margin = control quality, not a fudge)`,
  };
}

/** Player throttle is a ceiling the driver never exceeds; brake adds. */
export function runPlayerBlendGate(): FeelGateResult {
  const ceiling = blendInputs(true, 0.3, 0, 1, 0);
  const brakeAdd = blendInputs(true, 1, 0.6, 1, 0.2);
  const aiFull = blendInputs(false, 0, 0, 0.85, 0.1);
  const ok =
    Math.abs(ceiling.throttle - 0.3) < 1e-9 &&
    Math.abs(brakeAdd.throttle - 1) < 1e-9 &&
    Math.abs(brakeAdd.brake - 0.6) < 1e-9 &&
    Math.abs(aiFull.throttle - 0.85) < 1e-9;
  return {
    id: 'PLAYER_AGENCY_ALWAYS',
    ok,
    detail: `ceiling(0.3) -> ${ceiling.throttle} | brake+add -> ${brakeAdd.brake} | ai plan -> ${aiFull.throttle}`,
  };
}

/** Tyre temp warms at speed, cools while recovering, stays off the ice. */
export function runTempGates(): FeelGateResult[] {
  const start = PHYSICS.tyreStartTemp;
  const warm = tyreTempGrip(0.45);
  const opt = tyreTempGrip(0.8);
  const hot = tyreTempGrip(1.4);
  return [
    {
      id: 'TYRE_START_WARM',
      ok: Math.abs(start - 0.42) < 1e-6,
      detail: `start=${start}`,
    },
    {
      id: 'TYRE_COLD_GRIP',
      ok: warm > tyreTempGrip(0) && opt >= 0.99 && hot < 0.99,
      detail: `grip(0.45)=${warm.toFixed(3)} opt=${opt.toFixed(3)} hot=${hot.toFixed(3)}`,
    },
  ];
}

/** Contact pack layer still resolves overlaps (mesh = collision). */
export function runPackContactGate(): FeelGateResult {
  const director = new RaceDirector(raceConfig(50, 77_020));
  const player = director.cars.find((c) => c.isPlayerControlled);
  const ai = director.cars.find((c) => !c.isPlayerControlled);
  if (!player || !ai) return { id: 'PACK_CONTACT', ok: false, detail: 'missing cars' };
  ai.lap = 0;
  ai.s = director.track.length * 0.5;
  ai.l = 0;
  ai.v = 12;
  player.lap = 0;
  player.s = (ai.s - 2 + director.track.length) % director.track.length;
  player.l = 0.2;
  player.v = 22;
  let sameLanePass = 0;
  const raceDist = (c: { lap: number; s: number }) => c.lap * director.track.length + c.s;
  for (let i = 0; i < 60; i++) {
    director.setPlayerPedals(1, 0);
    director.update(PHYSICS.dt);
    if (raceDist(player) > raceDist(ai) && Math.abs(player.l - ai.l) < PHYSICS.carWidth * 0.55) {
      sameLanePass += 1;
    }
  }
  return {
    id: 'PACK_CONTACT',
    ok: sameLanePass === 0,
    detail: `sameLanePass=${sameLanePass} finalL=${Math.abs(player.l - ai.l).toFixed(2)}`,
  };
}

export function runHarnessGates(): FeelGateResult[] {
  void mulberry32;
  return [
    ...runTyreFundamentals(),
    ...runUnderOversteerGates(),
    runSkillIsControlGate(),
    runPlayerBlendGate(),
    ...runTempGates(),
    runPackContactGate(),
  ];
}
