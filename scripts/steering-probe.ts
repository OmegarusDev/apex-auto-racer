/**
 * Steering quality probe v2 — headless instrumentation of the driver brain +
 * lateral plant. Run: npx vite-node scripts/steering-probe.ts
 *
 * The brain's lTarget is NOT written back to the car, so we recompute the
 * controller's target here (personal line + grid blend — mirrors model.ts).
 * Also captures every groove→deslot transition with full context so the
 * dominant failure mode is identifiable.
 */
import { BALANCE } from '../src/data/balance.ts';
import { FORMATS } from '../src/data/formats.ts';
import { PHYSICS } from '../src/data/physics.ts';
import { RaceDirector, type RaceConfig } from '../src/engine/RaceDirector.ts';
import { createNewGame } from '../src/engine/SaveManager.ts';
import { mulberry32 } from '../src/engine/rng.ts';
import { defaultVehicleSave } from '../src/engine/types.ts';
import { personalLineAt } from '../src/engine/vehicle/create.ts';
import { interpolateAtSInto } from '../src/engine/RacingLine.ts';
import type { DisciplineId } from '../src/data/disciplines.ts';

interface CarView {
  id: string;
  s: number;
  l: number;
  lap: number;
  v: number;
  gridL: number;
  gridS: number;
  isPlayerControlled: boolean;
  steerRad: number;
  slotMode: string;
  deslotCount: number;
  spinCount: number;
  wallHits: number;
  slipAngle: number;
  yawRate: number;
  throttle: number;
  brake: number;
  lineO: number[];
  skill: number;
}

interface DeslotEvent {
  carId: string;
  t: number;
  v: number;
  slip: number;
  steer: number;
  l: number;
  halfWidth: number;
  kappa: number;
  throttle: number;
  brake: number;
  kind: 'spin' | 'wide' | 'wall';
}

function targetLineAt(car: CarView, track: import('../src/engine/TrackGenerator.ts').TrackData): number {
  // Mirror of tickDriverBrain's lineT: personal line + grid anchor blend.
  const base = car.lineO.length > 0 ? personalLineAt(car as never, track, car.s) : 0;
  const dsFromGrid = car.s - car.gridS;
  const dsNormalized = dsFromGrid < 0 ? dsFromGrid + track.length : dsFromGrid;
  const anchorDist = PHYSICS.idealLine.gridAnchorDist;
  if (dsNormalized < anchorDist) {
    const w = 1 - dsNormalized / anchorDist;
    const blend = w * w * (3 - 2 * w);
    return car.gridL * blend + base * (1 - blend);
  }
  return base;
}

function runProbe(seed: number, discipline: DisciplineId, laps = 3) {
  const format = FORMATS.find((f) => f.id === '1v1v1v1') ?? FORMATS[0]!;
  const game = createNewGame(mulberry32(seed), seed);
  const lead = game.roster[0]!;
  const config: RaceConfig = {
    discipline,
    trackSeed: 90_000 + seed,
    raceSeed: seed,
    laps,
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
  const track = director.track;
  const entries = (
    director as unknown as { entries: { car: CarView; driver: { skill: number } }[] }
  ).entries;
  for (const e of entries) e.car.skill = e.driver.skill;

  let simTime = 0;
  while (director.countdown !== null && simTime < 10) {
    director.update(PHYSICS.dt * 20);
    simTime += PHYSICS.dt;
  }

  const spread: { t: number; spread: number }[] = [];
  const traces = new Map<string, { t: number; l: number; target: number; steer: number; v: number }[]>();
  for (const e of entries) traces.set(e.car.id, []);
  const deslots: DeslotEvent[] = [];
  const prevMode = new Map<string, string>();

  let t = 0;
  let sampleClock = 0;
  const speedMult = 4;
  let guard = 0;
  let nextSpreadT = 0.5;
  while (!director.isRaceFinished && guard < 200_000) {
    director.setPlayerPedals(1, 0, false);
    director.update(PHYSICS.dt * speedMult);
    t += PHYSICS.dt;
    sampleClock += PHYSICS.dt;
    guard += 1;

    if (t >= nextSpreadT && nextSpreadT <= 3.0) {
      const ls = entries.map((e) => e.car.l);
      spread.push({ t: Math.round(nextSpreadT * 10) / 10, spread: Math.max(...ls) - Math.min(...ls) });
      nextSpreadT += 0.5;
    }
    if (sampleClock >= 0.1) {
      sampleClock = 0;
      for (const e of entries) {
        traces.get(e.car.id)!.push({
          t: Math.round(t * 100) / 100,
          l: e.car.l,
          target: targetLineAt(e.car, track),
          steer: e.car.steerRad,
          v: e.car.v,
        });
      }
    }

    // Deslot transition capture.
    for (const e of entries) {
      const prev = prevMode.get(e.car.id) ?? 'groove';
      if (prev === 'groove' && e.car.slotMode !== 'groove') {
        const node = interpolateAtSInto(track.nodes, track.length, e.car.s, {
          pos: { x: 0, y: 0 }, tangent: { x: 1, y: 0 }, normal: { x: 0, y: 1 },
          width: 0, runoffWidth: 0, kappa: 0, kappaLine: 0, o: 0, s: 0,
        });
        deslots.push({
          carId: e.car.id,
          t: Math.round(t * 100) / 100,
          v: e.car.v,
          slip: e.car.slipAngle,
          steer: e.car.steerRad,
          l: e.car.l,
          halfWidth: node.width / 2,
          kappa: node.kappaLine,
          throttle: e.car.throttle,
          brake: e.car.brake,
          kind:
            Math.abs(e.car.slipAngle) > 0.7 ? 'spin'
            : e.car.wallHits > 0 && Math.abs(e.car.l) > node.width / 2 - 1 ? 'wall'
            : 'wide',
        });
      }
      prevMode.set(e.car.id, e.car.slotMode);
    }
  }

  const perCar = entries.map((e) => {
    const trace = traces.get(e.car.id)!;
    let errSum = 0;
    let errMax = 0;
    let errFlip = 0;
    let steerFlip = 0;
    let steerSat = 0;
    let prevErrSign = 0;
    let prevSteerSign = 0;
    for (const s of trace) {
      const err = s.l - s.target;
      errSum += Math.abs(err);
      if (Math.abs(err) > errMax) errMax = Math.abs(err);
      const es = Math.abs(err) < 0.2 ? 0 : Math.sign(err);
      if (es !== 0 && prevErrSign !== 0 && es !== prevErrSign) errFlip += 1;
      if (es !== 0) prevErrSign = es;
      const ss = Math.abs(s.steer) < 0.04 ? 0 : Math.sign(s.steer);
      if (ss !== 0 && prevSteerSign !== 0 && ss !== prevSteerSign) steerFlip += 1;
      if (ss !== 0) prevSteerSign = ss;
      if (Math.abs(s.steer) > 0.6) steerSat += 1;
    }
    const secs = Math.max(1, trace[trace.length - 1]!.t);
    return {
      id: e.car.id,
      player: e.car.isPlayerControlled,
      skill: e.car.skill,
      meanErr: errSum / Math.max(1, trace.length),
      maxErr: errMax,
      weaveHz: errFlip / secs,
      steerFlipHz: steerFlip / secs,
      steerSatFrac: steerSat / Math.max(1, trace.length),
      deslots: e.car.deslotCount,
      spins: e.car.spinCount,
      walls: e.car.wallHits,
      trace,
    };
  });

  return { discipline, seed, spread, perCar, deslots };
}

function summarize(label: string, probes: ReturnType<typeof runProbe>[]) {
  const cars = probes.flatMap((p) => p.perCar);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  const deslots = probes.flatMap((p) => p.deslots);
  const byKind = { spin: 0, wide: 0, wall: 0 } as Record<string, number>;
  for (const d of deslots) byKind[d.kind] += 1;
  const atLimit = deslots.filter((d) => d.v > 0.92 * d.halfWidth / Math.max(0.02, Math.abs(d.kappa)) || false).length;
  console.log(`\n── ${label} ──`);
  console.log(
    `  launch spread: ${probes[0]!.spread.filter((s) => s.t <= 2).map((s) => `${s.t}s:${s.spread.toFixed(1)}`).join(' ')} m (cols ±${PHYSICS.gridColOffset})`,
  );
  console.log(
    `  line err mean=${mean(cars.map((c) => c.meanErr)).toFixed(2)}m max=${Math.max(...cars.map((c) => c.maxErr)).toFixed(2)}m | ` +
      `weave=${mean(cars.map((c) => c.weaveHz)).toFixed(2)}Hz steerFlip=${mean(cars.map((c) => c.steerFlipHz)).toFixed(2)}Hz | ` +
      `steerSat=${(mean(cars.map((c) => c.steerSatFrac)) * 100).toFixed(0)}%`,
  );
  console.log(
    `  deslot events: ${deslots.length} (spin=${byKind.spin} wide=${byKind.wide} wall=${byKind.wall}) | spins=${cars.reduce((a, c) => a + c.spins, 0)} walls=${cars.reduce((a, c) => a + c.walls, 0)}`,
  );
  if (deslots.length > 0) {
    const meanV = mean(deslots.map((d) => d.v));
    const meanSlip = mean(deslots.map((d) => Math.abs(d.slip)));
    const onThrottle = deslots.filter((d) => d.throttle > 0.6).length / deslots.length;
    const onBrake = deslots.filter((d) => d.brake > 0.3).length / deslots.length;
    const offLine = deslots.filter((d) => Math.abs(d.l) > d.halfWidth * 0.75).length / deslots.length;
    console.log(
      `  deslot context: v̄=${meanV.toFixed(1)}m/s slip̄=${meanSlip.toFixed(2)}rad throttle>${(onThrottle * 100).toFixed(0)}% brake>${(onBrake * 100).toFixed(0)}% already-offline>${(offLine * 100).toFixed(0)}% (v>vDeslot est: ${atLimit})`,
    );
  }
  const worst = [...cars].sort((a, b) => b.weaveHz - a.weaveHz)[0]!;
  console.log(
    `  worst weaver: weave=${worst.weaveHz.toFixed(2)}Hz meanErr=${worst.meanErr.toFixed(2)}m steerFlip=${worst.steerFlipHz.toFixed(2)}Hz skill=${worst.skill}`,
  );
}

const probes: ReturnType<typeof runProbe>[] = [];
for (const discipline of ['track', 'street', 'rally'] as DisciplineId[]) {
  for (const seed of [11001, 22002]) {
    probes.push(runProbe(seed, discipline));
  }
  summarize(discipline, probes.slice(-2));
}

// L vs target trace — first 30 s of one car, 1 s steps (eyeball the weave).
{
  const p = probes[0]!;
  const car = p.perCar[0]!;
  console.log(`\n── ${p.discipline}/${p.seed} ${car.player ? 'player' : car.id} l vs target (1 Hz) ──`);
  for (let i = 0; i < car.trace.length && car.trace[i]!.t <= 30; i += 10) {
    const s = car.trace[i]!;
    const bar = (v: number) => {
      const width = 40;
      const pos = Math.max(0, Math.min(width - 1, Math.round((v / 12 + 0.5) * width)));
      return ' '.repeat(pos) + '*';
    };
    console.log(
      `t=${s.t.toFixed(0).padStart(3)} l=${s.l.toFixed(1).padStart(6)} tgt=${s.target.toFixed(1).padStart(6)} steer=${s.steer.toFixed(2).padStart(6)} |l|${bar(s.l)} |t|${bar(s.target)}`,
    );
  }
}
