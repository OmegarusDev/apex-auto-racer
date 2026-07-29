/**
 * Diagnose why generateTrack falls back to oval (before/after).
 * Run: npx vite-node scripts/diag-track.ts
 */
import { PHYSICS } from '../src/data/physics';
import { ARCHETYPES, FALLBACK_OVAL_SEED } from '../src/data/archetypes';
import type { DisciplineId } from '../src/data/disciplines';
import {
  buildClosedCentripetalSpline,
  buildRacingLineNodes,
  computeCurvature,
  relaxCenterlineMinRadius,
  sampleSplineByArcLength,
} from '../src/engine/RacingLine';
import {
  classifyTrackFail,
  generateTrack,
  generateTrackAttempt,
  kappaStats,
} from '../src/engine/TrackGenerator';

function section(title: string) {
  console.log(`\n=== ${title} ===`);
}

function diagnoseSeed(seed: number, discipline: DisciplineId) {
  section(`AFTER attempts seed=${seed} discipline=${discipline}`);
  const counts = { selfIntersection: 0, minRadius: 0, length: 0, ok: 0 };
  let firstOk: { attempt: number; archetype: string; stats: ReturnType<typeof kappaStats> } | null =
    null;
  let lastAttempt: {
    attempt: number;
    archetype: string;
    failKind: string;
    stats: ReturnType<typeof kappaStats>;
  } | null = null;

  for (let attempt = 0; attempt < PHYSICS.maxGenAttempts; attempt++) {
    const attemptSeed = (seed + attempt * 0x9e3779b9) >>> 0;
    const track = generateTrackAttempt(attemptSeed, discipline);
    const fail = classifyTrackFail(track);
    const stats = kappaStats(track.nodes);
    counts[fail.kind]++;

    const extra =
      fail.kind === 'minRadius'
        ? ` minR=${fail.minR.toFixed(3)}`
        : fail.kind === 'length'
          ? ` len=${fail.length.toFixed(1)}`
          : '';

    console.log(
      `  attempt ${attempt}: archetype=${track.archetype} fail=${fail.kind}${extra}` +
        ` max|κ|=${stats.maxAbsKappa.toFixed(5)} minR=${stats.minR.toFixed(3)} len=${track.length.toFixed(1)}`,
    );

    if (fail.kind === 'ok' && firstOk === null) {
      firstOk = { attempt, archetype: track.archetype, stats };
    }
    lastAttempt = { attempt, archetype: track.archetype, failKind: fail.kind, stats };
  }

  console.log(
    `  SUMMARY: ok=${counts.ok} selfIntersection=${counts.selfIntersection} minRadius=${counts.minRadius} length=${counts.length}`,
  );

  const report = firstOk ?? lastAttempt!;
  console.log(
    `  kappa stats (${firstOk ? 'first success' : 'last attempt'} #${report.attempt}):` +
      ` archetype=${report.archetype} max|κ|=${report.stats.maxAbsKappa.toFixed(5)} minR=${report.stats.minR.toFixed(3)}`,
  );

  const produced = generateTrack(seed, discipline);
  const isFallback = produced.seed === FALLBACK_OVAL_SEED;
  console.log(
    `  generateTrack => archetype=${produced.archetype} seed=${produced.seed}` +
      (isFallback ? ' [FALLBACK_OVAL_SEED]' : ''),
  );

  return counts;
}

function diagnoseSimpleEllipse() {
  section('Known-simple ellipse (low noise, with relax)');
  const oval = ARCHETYPES.find((a) => a.id === 'oval')!;
  const n = 8;
  const rx = 200 * oval.elongation;
  const ry = 200;
  const waypoints: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n;
    const rNoise = 1 + 0.02 * Math.sin(i * 1.7);
    waypoints.push({
      x: rx * Math.cos(angle) * rNoise,
      y: ry * Math.sin(angle) * rNoise,
    });
  }

  const spline = buildClosedCentripetalSpline(waypoints);
  let centerline = sampleSplineByArcLength(spline, PHYSICS.sampleDs);
  const kappaBefore = computeCurvature(centerline);
  let maxK0 = 0;
  let minR0 = Infinity;
  for (const k of kappaBefore) {
    const ak = Math.abs(k);
    maxK0 = Math.max(maxK0, ak);
    if (ak > 1e-6) minR0 = Math.min(minR0, 1 / ak);
  }
  console.log(`  centerline pre-relax: max|κ|=${maxK0.toFixed(5)} minR=${minR0.toFixed(3)}`);

  centerline = relaxCenterlineMinRadius(centerline, PHYSICS.minCornerRadius);
  const nodes = buildRacingLineNodes(centerline, oval.width, oval.runoff);
  const last = nodes[nodes.length - 1]!;
  const first = nodes[0]!;
  const length = last.s + Math.hypot(first.pos.x - last.pos.x, first.pos.y - last.pos.y);
  const fakeTrack = {
    length,
    nodes,
    archetype: oval.id,
    seed: 0,
    discipline: 'track' as DisciplineId,
    bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
  };
  const fail = classifyTrackFail(fakeTrack);
  const stats = kappaStats(nodes);
  console.log(
    `  ellipse post-relax: fail=${fail.kind}` +
      (fail.kind === 'minRadius' ? ` minR=${fail.minR.toFixed(3)}` : '') +
      ` max|κ|=${stats.maxAbsKappa.toFixed(5)} minR=${stats.minR.toFixed(3)} len=${length.toFixed(1)} nodes=${nodes.length}`,
  );
}

function archetypeDistribution() {
  section('Archetype distribution (30 random seeds × discipline)');
  const disciplines: DisciplineId[] = ['track', 'street', 'rally'];
  for (const discipline of disciplines) {
    const dist: Record<string, number> = {};
    let fallbackHits = 0;
    const samples: string[] = [];
    for (let i = 0; i < 30; i++) {
      const seed = (100_000 + i * 9973 + discipline.length * 13) >>> 0;
      const track = generateTrack(seed, discipline);
      dist[track.archetype] = (dist[track.archetype] ?? 0) + 1;
      if (track.seed === FALLBACK_OVAL_SEED) fallbackHits++;
      if (i < 8) samples.push(`${seed}:${track.archetype}`);
    }
    console.log(
      `  ${discipline}: ${JSON.stringify(dist)} fallbackSeedHits=${fallbackHits}`,
    );
    console.log(`    samples: ${samples.join(', ')}`);
  }
}

section('BEFORE (captured baseline — pre-fix)');
console.log('  grand totals (9×20 attempts): ok=1 selfIntersection=1 minRadius=178 length=0');
console.log('  generateTrack fallback-heavy: track 28/30, street 24/30, rally 27/30 used FALLBACK_OVAL_SEED');
console.log('  simple ellipse (legacy κ wrap): fail=minRadius minR≈3.44');
console.log('  root cause: minRadius — computeCurvature seam ds not wrapped; no radius relaxation');

const seeds: Array<{ seed: number; discipline: DisciplineId }> = [
  { seed: 42_001, discipline: 'track' },
  { seed: 42_001, discipline: 'street' },
  { seed: 42_001, discipline: 'rally' },
  { seed: 77_777, discipline: 'track' },
  { seed: 77_777, discipline: 'street' },
  { seed: 77_777, discipline: 'rally' },
  { seed: 123_456, discipline: 'track' },
  { seed: 123_456, discipline: 'street' },
  { seed: 123_456, discipline: 'rally' },
];

const totals = { selfIntersection: 0, minRadius: 0, length: 0, ok: 0 };

for (const { seed, discipline } of seeds) {
  const c = diagnoseSeed(seed, discipline);
  totals.selfIntersection += c.selfIntersection;
  totals.minRadius += c.minRadius;
  totals.length += c.length;
  totals.ok += c.ok;
}

section('AFTER grand totals (9×20 attempts)');
console.log(
  `  ok=${totals.ok} selfIntersection=${totals.selfIntersection} minRadius=${totals.minRadius} length=${totals.length}`,
);

diagnoseSimpleEllipse();
archetypeDistribution();

section('Smoke seeds');
for (const { seed, discipline } of [
  { discipline: 'track' as const, seed: 42_001 },
  { discipline: 'street' as const, seed: 77_777 },
  { discipline: 'rally' as const, seed: 123_456 },
]) {
  const track = generateTrack(seed, discipline);
  console.log(
    `  ${discipline} seed=${seed}: archetype=${track.archetype} nodes=${track.nodes.length}` +
      ` length=${track.length.toFixed(1)} fallback=${track.seed === FALLBACK_OVAL_SEED}`,
  );
}
