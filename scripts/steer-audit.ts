/** Steering audit across many races. npx vite-node scripts/steer-audit.ts */
import { RaceDirector, type RaceConfig } from '../src/engine/RaceDirector.ts';
import { createNewGame } from '../src/engine/SaveManager.ts';
import { mulberry32 } from '../src/engine/rng.ts';
import { defaultVehicleSave } from '../src/engine/types.ts';
import { PHYSICS } from '../src/data/physics.ts';
import { BALANCE } from '../src/data/balance.ts';
import { FORMATS } from '../src/data/formats.ts';
import { personalLineAt } from '../src/engine/vehicle/create.ts';
import type { DisciplineId } from '../src/data/disciplines.ts';
import type { TrackData } from '../src/engine/TrackGenerator.ts';

function blended(track: TrackData, car: any, s: number): number {
  const halfW = track.nodes[0]!.width / 2;
  const lineClamp = halfW - PHYSICS.racingLineMargin;
  const base = personalLineAt(car, track, s);
  const dsN = (((s - car.gridS) % track.length) + track.length) % track.length;
  const ad = PHYSICS.idealLine.gridAnchorDist;
  let t = base;
  if (dsN < ad) {
    const w = 1 - dsN / ad;
    const b = w * w * (3 - 2 * w);
    t = car.gridL * b + base * (1 - b);
  }
  return Math.max(-lineClamp, Math.min(lineClamp, t));
}

function kappaAhead(track: TrackData, s: number, dist: number): number {
  let k = 0;
  let d = 0;
  const step = track.nodes[1]!.s - track.nodes[0]!.s;
  while (d < dist) {
    const ss = (s + d) % track.length;
    const n = track.nodes[Math.floor(ss / step) % track.nodes.length]!;
    k = Math.max(k, Math.abs(n.kappaLine));
    d += step;
  }
  return k;
}

const anchor = PHYSICS.idealLine.gridAnchorDist;
let worst: { seed: number; disc: string; wrong: number; lock: number; note: string }[] = [];

for (const disc of ['track', 'street', 'rally'] as DisciplineId[]) {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const format = FORMATS.find((f) => f.id === '1v1v1v1') ?? FORMATS[0]!;
    const game = createNewGame(mulberry32(seed), seed);
    const lead = game.roster[0]!;
    const config: RaceConfig = {
      discipline: disc, trackSeed: 90_000 + seed, raceSeed: seed, laps: 2, format,
      playerTeamDrivers: [lead], leadDriverId: lead.id,
      playerVehicle: defaultVehicleSave(BALANCE.startingPartTier),
      opponentBudget: [BALANCE.opponentStatRanges[0]![0] * 4, BALANCE.opponentStatRanges[0]![1] * 4],
      opponentPartRange: BALANCE.opponentPartTiers[0]!,
    };
    const director = new RaceDirector(config);
    const track = director.track;
    const entries = (director as unknown as { entries: { car: any; driver: { skill: number } }[] }).entries;
    for (const e of entries) e.car.skill = e.driver.skill;
    let t = 0;
    while (director.countdown !== null && t < 10) { director.update(PHYSICS.dt * 20); t += PHYSICS.dt; }

    let wrong = 0, lock = 0, wrongEx: string = '';
    for (let step = 0; step < 1800; step++) {
      director.update(PHYSICS.dt);
      for (const e of entries) {
        const car = e.car;
        const v = Math.max(0.1, car.v);
        const lookahead = Math.max(12, Math.min(80, v * (0.9 + 0.9 * (car.skill / 100)) + 8));
        const targetNow = blended(track, car, car.s);
        // Replicate the brain's ADAPTIVE lookahead (stop at curvature flip).
        const nodeStep = track.nodes[1]!.s - track.nodes[0]!.s;
        const baseLook = Math.max(12, Math.min(80, v * (0.9 + 0.9 * (car.skill / 100)) + 8));
        let laDist = baseLook * 0.6;
        const s0node = track.nodes[Math.round((car.s % track.length) / nodeStep) % track.nodes.length]!;
        let prevK = Math.sign(s0node.kappaLine);
        for (let dd = nodeStep; dd < laDist; dd += nodeStep) {
          const n = track.nodes[Math.round(((car.s + dd) % track.length) / nodeStep) % track.nodes.length]!;
          const k = n.kappaLine;
          if (Math.abs(k) > 0.004) {
            if (prevK !== 0 && Math.sign(k) !== prevK) { laDist = dd; break; }
            prevK = Math.sign(k);
          }
        }
        const targetAhead = blended(track, car, (car.s + laDist) % track.length);
        const errDir = Math.sign(targetAhead - car.l);
        const steerDir = Math.sign(car.steerRad);
        const kA = kappaAhead(track, car.s, 30);
        const offLine = Math.abs(car.l - targetNow);
        // Wrong-way: clearly off line, cornering, but steering AWAY from target.
        if (offLine > 3 && errDir !== 0 && steerDir !== 0 && errDir !== steerDir && kA > 0.01) {
          wrong++;
          if (!wrongEx) wrongEx = `s=${Math.round(car.s)} off=${offLine.toFixed(1)} kA=${kA.toFixed(3)} steer=${car.steerRad.toFixed(2)} tgtAhead=${targetAhead.toFixed(1)} l=${car.l.toFixed(1)} v=${v.toFixed(0)}`;
        }
        // Understeer lockout: corner but basically no steer while off line.
        if (kA > 0.02 && Math.abs(car.steerRad) < 0.03 && offLine > 4) {
          lock++;
        }
      }
    }
    worst.push({ seed, disc, wrong, lock, note: wrongEx });
  }
}

worst.sort((a, b) => b.wrong + b.lock - (a.wrong + a.lock));
console.log('Worst races by steering anomalies (wrong-way + lockout ticks):');
for (const w of worst.slice(0, 12)) {
  console.log(`  ${w.disc} seed=${w.seed}: wrong=${w.wrong} lock=${w.lock}  ${w.note}`);
}
const tot = worst.reduce((s, w) => s + w.wrong + w.lock, 0);
console.log(`\nTotal anomalies across 24 races: ${tot}`);
