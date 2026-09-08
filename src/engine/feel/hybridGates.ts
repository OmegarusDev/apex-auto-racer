/**
 * Discipline + recovery gates — three sports on one physics core.
 */
import { PHYSICS } from '../../data/physics';
import { SURFACES } from '../../data/surfaces';
import { buildCircleTrack, buildHairpinTrack, buildSBendTrack, HAIRPIN, SBEND } from './harnessGates';
import { createCarState, buildVehicleContext } from '../Vehicle';
import { effectiveStats } from '../stats';
import { defaultVehicleSave } from '../types';
import { tickDriverBrain, createBrainState, type BrainTickContext } from '../DriverBrain';
import { updateVehicle } from '../sim/update';
import { stepVehicle } from '../sim/vehicle';
import { mulberry32 } from '../rng';
import type { RaceConfig } from '../RaceDirector';
import type { FeelGateResult } from './types';
import { computeIdealLine } from '../vehicle/IdealLine';
import { outwardSign } from '../RacingLine';

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
    id: 'd', name: 'd', trait: 'grinder' as const, discipline: 'track' as const,
    color: '#f0c41a', skill: 60, bravery: 50, focus: 60,
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

/** Driver on a circle at ~82% grip speed must hold the ribbon — not fly tangent. */
export function runLineFollowsCornerGate(): FeelGateResult {
  const R = 50;
  const track = buildCircleTrack(R);
  const car = makeProbe();
  car.tyreTemp = 0.85;
  const vHold = Math.sqrt(SURFACES.track.mu * 9.81 * R) * 0.82;
  car.v = vHold;
  car.yawRate = 0;
  car.slipAngle = 0;
  car.l = 0;
  car.lineO = track.nodes.map(() => 0);
  const state = createBrainState();
  const bctx = brainCtx(track);
  let maxAbsL = 0;
  let lastSteer = 0;
  let prevSteerSamp = 0;
  let prevDelta = 0;
  let haveSamp = false;
  let weave = 0;
  let samp = 0;
  for (let t = 0; t < 4; t += PHYSICS.dt) {
    bctx.raceTime = t;
    const out = tickDriverBrain(state, car, bctx);
    lastSteer = out.steer;
    // Isolate steering: light drive holds pace. AI throttle would otherwise
    // chase vMax and this gate would become an overspeed test.
    stepVehicle(car, track, PHYSICS.dt, 0.18, 0, out.steer, 'track', SURFACES.track.mu, false);
    maxAbsL = Math.max(maxAbsL, Math.abs(car.l));
    // Oscillation, not a slow ramp as speed bleeds: reversing steer deltas.
    if (t > 0.8 && samp % 8 === 0) {
      if (!haveSamp) {
        prevSteerSamp = lastSteer;
        haveSamp = true;
      } else {
        const d = lastSteer - prevSteerSamp;
        if (d * prevDelta < 0) weave += Math.abs(d);
        prevDelta = d;
        prevSteerSamp = lastSteer;
      }
    }
    samp += 1;
  }
  return {
    id: 'LINE_FOLLOWS_CORNER',
    ok: maxAbsL < 6 && car.spinCount === 0 && weave < 0.08,
    detail: `circle R=50 @82% vGrip maxL=${maxAbsL.toFixed(2)}m steer=${lastSteer.toFixed(3)} weave=${weave.toFixed(3)} spin=${car.spinCount}`,
  };
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

/** After a short hold on the dirt bank, the driver steers back onto the asphalt. */
export function runDirtBankRejoinGate(): FeelGateResult {
  const R = 50;
  const width = 30;
  const track = buildCircleTrack(R, width, 8);
  const halfW = width / 2;
  const car = makeProbe();
  car.tyreTemp = 0.85;
  car.v = 14;
  car.l = halfW + 2.4;
  car.slipAngle = 0.04;
  car.yawRate = 0;
  car.slotMode = 'deslot';
  const state = createBrainState();
  const ctx = ctxFor(car);
  const bctx = brainCtx(track);
  let stillOnDirtAtHold = false;
  let backOnTarmac = false;
  for (let t = 0; t < 2.8; t += PHYSICS.dt) {
    bctx.raceTime = t;
    const out = tickDriverBrain(state, car, bctx);
    updateVehicle(car, track, PHYSICS.dt, { throttle: 0.35, brake: 0 }, out, ctx);
    if (t >= 0.28 && t <= 0.32) stillOnDirtAtHold = Math.abs(car.l) >= halfW - 0.2;
    if (Math.abs(car.l) < halfW) backOnTarmac = true;
  }
  return {
    id: 'DIRT_BANK_REJOINS',
    ok: stillOnDirtAtHold && backOnTarmac && car.penaltySec === 0,
    detail: `holdOnDirt=${stillOnDirtAtHold} backOnTarmac=${backOnTarmac} endL=${car.l.toFixed(2)} penalty=${car.penaltySec}`,
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

/** A rolling crawl on a hairpin must follow the wheels, not drive straight off. */
export function runCrawlTakesCornerGate(): FeelGateResult {
  const track = buildHairpinTrack();
  const car = makeProbe();
  car.tyreTemp = 0.85;
  car.s = HAIRPIN.straight + 2;
  car.v = 1.0;
  car.slipAngle = 0;
  car.headingErr = 0;
  car.yawRate = 0;
  car.l = 0;
  const kappa = 1 / HAIRPIN.radius;
  const steer = Math.atan((car.setup.wheelbase ?? 2.7) * kappa);
  const s0 = car.s;
  let maxAbsL = 0;
  for (let t = 0; t < 4.5; t += PHYSICS.dt) {
    stepVehicle(car, track, PHYSICS.dt, 0.14, 0, steer, 'track', SURFACES.track.mu, false);
    maxAbsL = Math.max(maxAbsL, Math.abs(car.l));
  }
  const progressed = car.s - s0;
  const wrapped = progressed < 0 ? progressed + track.length : progressed;
  return {
    id: 'CRAWL_TAKES_CORNER',
    ok: wrapped > 8 && maxAbsL < 4.2 && car.spinCount === 0,
    detail: `crawl hairpin Δs=${wrapped.toFixed(1)}m maxL=${maxAbsL.toFixed(2)}m spin=${car.spinCount}`,
  };
}

/** From a near-stop into a U-turn, the driver + car must make the bend. */
export function runHairpinFromStopGate(): FeelGateResult {
  const track = buildHairpinTrack();
  const car = makeProbe();
  car.tyreTemp = 0.85;
  car.s = HAIRPIN.straight - 3;
  car.v = 0.4;
  car.slipAngle = 0;
  car.headingErr = 0;
  car.yawRate = 0;
  car.l = 0;
  car.gear = 1;
  car.clutchEngage = 1;
  const g = 9.81;
  car.lineO = track.nodes.map(() => 0);
  car.idealVLine = track.nodes.map((n) => {
    const k = Math.max(Math.abs(n.kappaLine), 0.003);
    return Math.min(car.stats.vMax * 0.95, Math.sqrt((g * SURFACES.track.mu) / k) * 0.8);
  });
  car.brakeZoneStart = track.nodes.map((n) =>
    n.s < HAIRPIN.straight && n.s > HAIRPIN.straight - 22 ? HAIRPIN.straight - n.s : -1,
  );
  car.turnInPoint = track.nodes.map((n) =>
    n.s < HAIRPIN.straight && n.s > HAIRPIN.straight - 10 ? 1 : -1,
  );
  const state = createBrainState();
  const bctx = brainCtx(track);
  const ctx = ctxFor(car);
  let maxAbsL = 0;
  const arcEnd = HAIRPIN.straight + Math.PI * HAIRPIN.radius;
  const doneS = arcEnd + 6;
  for (let t = 0; t < 12 && car.s < doneS; t += PHYSICS.dt) {
    bctx.raceTime = t;
    const out = tickDriverBrain(state, car, bctx);
    updateVehicle(car, track, PHYSICS.dt, { throttle: 1, brake: 0 }, out, ctx);
    if (car.s >= HAIRPIN.straight && car.s <= arcEnd) {
      maxAbsL = Math.max(maxAbsL, Math.abs(car.l));
    }
  }
  const madeTurn = car.s > HAIRPIN.straight + (arcEnd - HAIRPIN.straight) * 0.7;
  return {
    id: 'HAIRPIN_FROM_STOP',
    ok: madeTurn && maxAbsL < 8 && car.spinCount === 0 && car.penaltySec < 0.1,
    detail: `s=${car.s.toFixed(1)} (need >${(HAIRPIN.straight + (arcEnd - HAIRPIN.straight) * 0.7).toFixed(0)}) maxL(in-arc)=${maxAbsL.toFixed(2)} spin=${car.spinCount} penalty=${car.penaltySec.toFixed(1)}`,
  };
}

/** Steer must match the road into a left, and must not pre-turn for the following right. */
export function runTurnInSignGate(): FeelGateResult {
  const left = 1 / HAIRPIN.radius;
  const hairpin = buildHairpinTrack();
  const sBend = buildSBendTrack();
  const firstArc = (Math.PI / 2) * SBEND.radius;

  const inLeft = steerAt(hairpin, HAIRPIN.straight + 3, 16);
  const intoLeft = steerAt(hairpin, HAIRPIN.straight - 6, 18);
  const intoS = steerAt(sBend, SBEND.straight - 3, 16);

  const hairpinOk = inLeft > 0.08 && Math.sign(inLeft) === Math.sign(left);
  const approachOk = intoLeft > 0.05;
  const sOk = intoS > 0.05;
  return {
    id: 'TURN_IN_SIGN',
    ok: hairpinOk && approachOk && sOk,
    detail: `in-left=${inLeft.toFixed(3)} approach=${intoLeft.toFixed(3)} S-entry=${intoS.toFixed(3)} (first arc ${firstArc.toFixed(1)}m)`,
  };
}

function steerAt(track: ReturnType<typeof buildHairpinTrack>, s: number, v: number): number {
  const car = makeProbe();
  car.tyreTemp = 0.85;
  car.s = s;
  car.v = v;
  car.slipAngle = 0;
  car.headingErr = 0;
  car.yawRate = 0;
  car.l = 0;
  car.lineO = track.nodes.map(() => 0);
  const g = 9.81;
  car.idealVLine = track.nodes.map((n) => {
    const k = Math.max(Math.abs(n.kappa), 0.003);
    return Math.min(car.stats.vMax * 0.95, Math.sqrt((g * SURFACES.track.mu) / k) * 0.8);
  });
  const state = createBrainState();
  const bctx = brainCtx(track);
  return tickDriverBrain(state, car, bctx).steer;
}

/**
 * Ideal line apex must sit on the INSIDE of the bend (Frenet: κ>0 → +l).
 * An inverted line made Mag chase the wall while road FF turned the other way.
 */
export function runIdealLineInwardGate(): FeelGateResult {
  const track = buildHairpinTrack();
  const car = makeProbe();
  const ideal = computeIdealLine(track, car.setup, car.stats, SURFACES.track.mu);
  let checked = 0;
  let okCount = 0;
  let sampleDetail = 'none';
  for (const apexIdx of ideal.apexNode) {
    if (apexIdx < 0) continue;
    const k = track.nodes[apexIdx]!.kappa;
    const out = outwardSign(k);
    if (out === 0) continue;
    const l = ideal.idealLineO[apexIdx]!;
    const inward = -out;
    checked += 1;
    const dot = l * inward;
    if (dot > 0.4) okCount += 1;
    sampleDetail = `apex=${apexIdx} κ=${k.toFixed(3)} l=${l.toFixed(2)} inwardDot=${dot.toFixed(2)}`;
  }
  // Also probe mid-hairpin by |κ| peak if apex list empty.
  if (checked === 0) {
    let peakI = 0;
    let peakK = 0;
    for (let i = 0; i < track.nodes.length; i++) {
      if (Math.abs(track.nodes[i]!.kappa) > peakK) {
        peakK = Math.abs(track.nodes[i]!.kappa);
        peakI = i;
      }
    }
    const k = track.nodes[peakI]!.kappa;
    const out = outwardSign(k) || (k >= 0 ? -1 : 1);
    const l = ideal.idealLineO[peakI]!;
    const dot = l * -out;
    checked = 1;
    if (dot > 0.4) okCount = 1;
    sampleDetail = `peak=${peakI} κ=${k.toFixed(3)} l=${l.toFixed(2)} inwardDot=${dot.toFixed(2)}`;
  }
  const ok = checked > 0 && okCount === checked;
  return {
    id: 'IDEAL_LINE_INWARD',
    ok,
    detail: `${sampleDetail} (${okCount}/${checked} apexes inward)`,
  };
}

export function runHybridGates(): FeelGateResult[] {
  void PHYSICS;
  return [
    ...runDisciplineIdentityGate(),
    runLineFollowsCornerGate(),
    runIdealLineInwardGate(),
    runRejoinNaturalGate(),
    runDirtBankRejoinGate(),
    runMarshalGate(),
    runCrawlTakesCornerGate(),
    runHairpinFromStopGate(),
    runTurnInSignGate(),
  ];
}

export type { RaceConfig };
