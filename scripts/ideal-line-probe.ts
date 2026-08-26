/**
 * Ideal-line smoothness probe. Run: npx vite-node scripts/ideal-line-probe.ts
 * Dumps the car-ideal lateral offset along s and measures its smoothness.
 */
import { generateTrack } from '../src/engine/TrackGenerator.ts';
import { computeIdealLine } from '../src/engine/vehicle/IdealLine.ts';
import { carSetupFromParts } from '../src/engine/vehicle/CarSetup.ts';
import { effectiveStats } from '../src/engine/stats.ts';
import { defaultVehicleSave } from '../src/engine/types.ts';
import { BALANCE } from '../src/data/balance.ts';
import { buildPersonalLineFromIdeal } from '../src/engine/RacingLine.ts';
import type { DisciplineId } from '../src/data/disciplines.ts';

for (const discipline of ['track', 'street', 'rally'] as DisciplineId[]) {
  const track = generateTrack(90011, discipline);
  const vehicle = defaultVehicleSave(BALANCE.startingPartTier);
  const setup = carSetupFromParts(vehicle.partTiers, discipline);
  const stats = effectiveStats(discipline, vehicle.partTiers, vehicle.condition);
  const ideal = computeIdealLine(track, setup, stats, 1.0);

  const nodes = track.nodes;
  const o = ideal.idealLineO;
  let maxStepPerM = 0;
  let flips100 = 0;
  let prevSign = 0;
  let halfWMax = 0;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!;
    const next = nodes[(i + 1) % nodes.length]!;
    halfWMax = Math.max(halfWMax, n.width / 2);
    const ds = Math.max(0.1, (next.s - n.s + track.length) % track.length);
    const step = Math.abs(o[(i + 1) % o.length]! - o[i]!) / ds;
    if (step > maxStepPerM) maxStepPerM = step;
    const sign = Math.abs(o[i]!) < 0.3 ? 0 : Math.sign(o[i]!);
    if (sign !== 0 && prevSign !== 0 && sign !== prevSign) flips100 += 1;
    if (sign !== 0) prevSign = sign;
  }
  const personal = buildPersonalLineFromIdeal(
    o,
    { skill: 55, bravery: 50, focus: 50 },
    track,
    track.length - 10,
    -4.6,
  );
  let pMaxStep = 0;
  for (let i = 0; i < nodes.length; i++) {
    const next = nodes[(i + 1) % nodes.length]!;
    const ds = Math.max(0.1, (next.s - nodes[i]!.s + track.length) % track.length);
    pMaxStep = Math.max(pMaxStep, Math.abs(personal[(i + 1) % personal.length]! - personal[i]!) / ds);
  }

  console.log(`\n── ${discipline} (track ${(track.length / 1000).toFixed(2)} km, ${nodes.length} nodes) ──`);
  console.log(
    `  ideal line: maxHalfWidth=${halfWMax.toFixed(1)}m  maxSlope=${maxStepPerM.toFixed(2)} m/m  signFlips=${flips100}  range=[${Math.min(...o).toFixed(1)}, ${Math.max(...o).toFixed(1)}]`,
  );
  console.log(`  personal:   maxSlope=${pMaxStep.toFixed(2)} m/m`);

  // Dump offset every ~40 m for the first 800 m.
  let printed = 0;
  let lastPrintS = -100;
  for (let i = 0; i < nodes.length && printed < 22; i++) {
    const n = nodes[i]!;
    if (n.s - lastPrintS < 40) continue;
    lastPrintS = n.s;
    printed++;
    const bar = (v: number) => {
      const width = 36;
      const half = Math.max(halfWMax, 1);
      const pos = Math.max(0, Math.min(width - 1, Math.round((v / half * 0.5 + 0.5) * width)));
      return ' '.repeat(pos) + '*';
    };
    console.log(
      `s=${Math.round(n.s).toString().padStart(5)} κ=${n.kappaLine.toFixed(4).padStart(8)} ideal=${o[i]!.toFixed(1).padStart(6)} |${bar(o[i]!)}`,
    );
  }
}
