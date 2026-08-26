/** Single-car corner trace. npx vite-node scripts/corner-trace.ts */
import { RaceDirector, type RaceConfig } from '../src/engine/RaceDirector.ts';
import { createNewGame } from '../src/engine/SaveManager.ts';
import { mulberry32 } from '../src/engine/rng.ts';
import { defaultVehicleSave } from '../src/engine/types.ts';
import { PHYSICS } from '../src/data/physics.ts';
import { BALANCE } from '../src/data/balance.ts';
import { FORMATS } from '../src/data/formats.ts';
import { personalLineAt } from '../src/engine/vehicle/create.ts';

function nodeIdxAtS(track: any, s: number): number {
  const nodes = track.nodes;
  let best = 0, bestD = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    let d = Math.abs(nodes[i]!.s - s);
    if (d > track.length / 2) d = track.length - d;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

const discipline = 'track' as const;
const format = FORMATS.find((f) => f.id === '1v1v1v1') ?? FORMATS[0]!;
const game = createNewGame(mulberry32(90011), 90011);
const lead = game.roster[0]!;
const config: RaceConfig = {
  discipline, trackSeed: 90_000 + 90011, raceSeed: 90011, laps: 1, format,
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

let peakS = 0, peakK = 0;
for (const n of track.nodes) if (Math.abs(n.kappaLine) > peakK) { peakK = Math.abs(n.kappaLine); peakS = n.s; }

function dist(a: number, b: number) { let d = a - b; if (d < -track.length / 2) d += track.length; if (d > track.length / 2) d -= track.length; return d; }

const car0 = entries.find((e) => e.car.id === 'car-0')!.car;
// First significant corner AFTER the car's grid start (so we see entry + braking).
const gridS0 = car0.gridS;
let bestGap = Infinity;
for (const n of track.nodes) {
  if (Math.abs(n.kappaLine) <= 0.012) continue;
  const gap = ((n.s - gridS0) % track.length + track.length) % track.length;
  if (gap > 50 && gap < bestGap) { bestGap = gap; peakS = n.s; peakK = Math.abs(n.kappaLine); }
}
if (peakK <= 0.012) { peakK = 0.0357; peakS = 1197; }
let printed = 0;
console.log(`first corner after grid: s=${Math.round(peakS)} k=${peakK.toFixed(4)} (window +/-350m)`);
console.log('   t    s    v   vTgt thr brk steer    l   tgt  slip   dl   aY   hed  yaw  mode');
for (let step = 0; step < 2500; step++) {
  director.update(PHYSICS.dt);
  t += PHYSICS.dt;
  const ni = nodeIdxAtS(track, car0.s);
  const vTgt = car0.idealVLine?.[ni] ?? -1;
  if (Math.abs(dist(car0.s, peakS)) > 350) continue;
  if (printed++ % 4 !== 0) continue;
  const base = car0.lineO.length ? personalLineAt(car0, track, car0.s) : 0;
  const dsN = ((car0.s - car0.gridS) % track.length + track.length) % track.length;
  const ad = PHYSICS.idealLine.gridAnchorDist;
  const tgt = dsN < ad ? car0.gridL * (1 - dsN / ad) ** 2 * (3 - 2 * (dsN / ad)) + base * (1 - (1 - dsN / ad) ** 2 * (3 - 2 * (dsN / ad))) : base;
  const aY = (car0.lastLateralG ?? 0) * 9.81;
  console.log(
    `${t.toFixed(2).padStart(5)} ${Math.round(car0.s).toString().padStart(4)} ${car0.v.toFixed(1).padStart(4)} ${vTgt.toFixed(1).padStart(5)} ${car0.throttle.toFixed(2).padStart(3)} ${car0.brake.toFixed(2).padStart(3)} ${car0.steerRad.toFixed(2).padStart(5)} ${car0.l.toFixed(1).padStart(5)} ${tgt.toFixed(1).padStart(5)} ${car0.slipAngle.toFixed(2).padStart(5)} ${car0.dl.toFixed(1).padStart(4)} ${aY.toFixed(1).padStart(5)} ${(car0.headingErr ?? 0).toFixed(2).padStart(4)} ${(car0.yawRate ?? 0).toFixed(2).padStart(4)} ${car0.slotMode.padStart(5)}`,
  );
}
