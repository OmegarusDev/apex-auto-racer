import { PHYSICS } from '../data/physics';
import { ARCHETYPES, FALLBACK_OVAL_SEED } from '../data/archetypes';
import type { ArchetypeId } from '../data/archetypes';
import { getDiscipline } from '../data/disciplines';
import type { DisciplineId } from '../data/disciplines';
import { mulberry32, randInt, randRange, weightedPick } from './rng';
import type { Rng } from './rng';
import type { EffectiveStats, Vec2 } from './types';
import {
  buildClosedCentripetalSpline,
  buildRacingLineNodes,
  relaxCenterlineMinRadius,
  sampleSplineByArcLength,
  type RacingLineNode,
} from './RacingLine';

export type { RacingLineNode as TrackNode };

export interface TrackBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface TrackData {
  length: number;
  nodes: RacingLineNode[];
  archetype: ArchetypeId;
  seed: number;
  discipline: DisciplineId;
  bounds: TrackBounds;
}

export interface SpeedProfiles {
  vSafe: number[];
  vProfile: number[];
}

/** Optional procedural scale (Quick Race pace bands). Defaults 1,1. */
export interface TrackScaleOpts {
  /** Multiplies waypoint radii → circuit length. */
  lengthMult?: number;
  /** Multiplies asphalt / runoff width. */
  widthMult?: number;
}

const DEFAULT_SCALE: Required<TrackScaleOpts> = { lengthMult: 1, widthMult: 1 };

function resolveScale(opts?: TrackScaleOpts): Required<TrackScaleOpts> {
  const lengthMult = Math.max(0.45, Math.min(1.35, opts?.lengthMult ?? 1));
  const widthMult = Math.max(0.75, Math.min(1.2, opts?.widthMult ?? 1));
  return { lengthMult, widthMult };
}

export type TrackFailReason =
  | { kind: 'selfIntersection' }
  | { kind: 'minRadius'; minR: number }
  | { kind: 'length'; length: number }
  | { kind: 'ok' };

function computeBounds(nodes: readonly RacingLineNode[]): TrackBounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const node of nodes) {
    const halfW = node.width / 2 + node.runoffWidth;
    minX = Math.min(minX, node.pos.x - halfW);
    minY = Math.min(minY, node.pos.y - halfW);
    maxX = Math.max(maxX, node.pos.x + halfW);
    maxY = Math.max(maxY, node.pos.y + halfW);
  }

  return { minX, minY, maxX, maxY };
}

function pickArchetype(rng: Rng, discipline: DisciplineId, hint?: ArchetypeId): ArchetypeDefLike {
  if (hint !== undefined) {
    const found = ARCHETYPES.find((a) => a.id === hint);
    if (found !== undefined) return found;
  }

  const weighted = ARCHETYPES.map((a) => ({
    ...a,
    weight: a.weights[discipline],
  })).filter((a) => a.weight > 0);

  return weightedPick(rng, weighted);
}

type ArchetypeDefLike = (typeof ARCHETYPES)[number];

function generateWaypoints(
  rng: Rng,
  archetype: ArchetypeDefLike,
  lengthMult = 1,
): { x: number; y: number }[] {
  const [minN, maxN] = archetype.waypointCount;
  const n = minN === maxN ? minN : randInt(rng, minN, maxN);
  const baseRadius = randRange(rng, PHYSICS.baseRadiusMin, PHYSICS.baseRadiusMax) * lengthMult;
  const rx = baseRadius * archetype.elongation;
  const ry = baseRadius;

  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const baseAngle = (2 * Math.PI * i) / n;
    const angleJitter = randRange(rng, -0.2, 0.2);
    const angle = baseAngle + angleJitter;
    const rNoise = 1 + randRange(rng, -archetype.radialNoise, archetype.radialNoise);
    points.push({
      x: rx * Math.cos(angle) * rNoise,
      y: ry * Math.sin(angle) * rNoise,
    });
  }

  return points;
}

function scaledArchetype(
  archetype: ArchetypeDefLike,
  widthMult: number,
): ArchetypeDefLike {
  if (Math.abs(widthMult - 1) < 1e-9) return archetype;
  return {
    ...archetype,
    width: Math.max(18, archetype.width * widthMult),
    runoff: Math.max(1, archetype.runoff * widthMult),
  };
}

/** Proper (interior) segment intersection; parallel/collinear → false. */
function segmentsProperIntersect(a0: Vec2, a1: Vec2, b0: Vec2, b1: Vec2): boolean {
  const ax = a1.x - a0.x;
  const ay = a1.y - a0.y;
  const bx = b1.x - b0.x;
  const by = b1.y - b0.y;
  const denom = ax * by - ay * bx;
  if (Math.abs(denom) < 1e-12) return false;

  const dx = b0.x - a0.x;
  const dy = b0.y - a0.y;
  const t = (dx * by - dy * bx) / denom;
  const u = (dx * ay - dy * ax) / denom;
  const eps = 1e-9;
  return t > eps && t < 1 - eps && u > eps && u < 1 - eps;
}

/** Skip segment pairs within ~2 neighbors on the closed ring. */
function hasSelfIntersection(nodes: readonly RacingLineNode[]): boolean {
  const n = nodes.length;
  if (n < 6) return false;

  for (let i = 0; i < n; i++) {
    const a0 = nodes[i]!.pos;
    const a1 = nodes[(i + 1) % n]!.pos;

    for (let j = i + 1; j < n; j++) {
      const gap = Math.min(j - i, n - (j - i));
      if (gap <= 2) continue;

      const b0 = nodes[j]!.pos;
      const b1 = nodes[(j + 1) % n]!.pos;
      if (segmentsProperIntersect(a0, a1, b0, b1)) return true;
    }
  }

  return false;
}

function minCornerRadius(nodes: readonly RacingLineNode[]): number {
  let minR = Infinity;
  for (const node of nodes) {
    const k = Math.abs(node.kappa);
    if (k > 1e-6) minR = Math.min(minR, 1 / k);
  }
  return minR;
}

export function kappaStats(nodes: readonly RacingLineNode[]): { maxAbsKappa: number; minR: number } {
  let maxAbsKappa = 0;
  let minR = Infinity;
  for (const node of nodes) {
    const ak = Math.abs(node.kappa);
    maxAbsKappa = Math.max(maxAbsKappa, ak);
    if (ak > 1e-6) minR = Math.min(minR, 1 / ak);
  }
  return { maxAbsKappa, minR: Number.isFinite(minR) ? minR : Infinity };
}

export function classifyTrackFail(track: TrackData): TrackFailReason {
  if (hasSelfIntersection(track.nodes)) return { kind: 'selfIntersection' };
  const minR = minCornerRadius(track.nodes);
  if (minR < PHYSICS.minCornerRadius) return { kind: 'minRadius', minR };
  if (track.length < 100) return { kind: 'length', length: track.length };
  return { kind: 'ok' };
}

function buildTrackFromWaypoints(
  waypoints: { x: number; y: number }[],
  archetype: ArchetypeDefLike,
  seed: number,
  discipline: DisciplineId,
): TrackData {
  const spline = buildClosedCentripetalSpline(waypoints);
  let centerline = sampleSplineByArcLength(spline, PHYSICS.sampleDs);
  centerline = relaxCenterlineMinRadius(centerline, PHYSICS.minCornerRadius);
  const nodes = buildRacingLineNodes(centerline, archetype.width, archetype.runoff);
  const last = nodes[nodes.length - 1]!;
  const first = nodes[0]!;
  const closeGap = Math.hypot(first.pos.x - last.pos.x, first.pos.y - last.pos.y);
  const length = last.s + closeGap;

  const raw: TrackData = {
    length,
    nodes,
    archetype: archetype.id,
    seed,
    discipline,
    bounds: computeBounds(nodes),
  };
  return phaseShiftStartToStraight(raw);
}

/**
 * Rotate the loop so s=0 sits mid-straight (grid + checkered).
 * Waypoint seams are usually corners — without this ~all races start in bends.
 */
function phaseShiftStartToStraight(track: TrackData): TrackData {
  const nodes = track.nodes;
  const n = nodes.length;
  if (n < 12) return track;

  const gridDepth = PHYSICS.gridRowSpacing * 6 + 60;
  const windowLen = Math.max(gridDepth, 90);

  const scores: { i: number; mean: number }[] = [];
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let count = 0;
    let dist = 0;
    let j = i;
    while (dist < windowLen && count < n) {
      const node = nodes[j]!;
      sum += Math.abs(node.kappaLine);
      count += 1;
      const next = nodes[(j + 1) % n]!;
      let ds = next.s - node.s;
      if (ds <= 0) ds += track.length;
      dist += ds;
      j = (j + 1) % n;
    }
    scores.push({ i, mean: sum / Math.max(1, count) });
  }
  scores.sort((a, b) => a.mean - b.mean);

  const kappaMax = PHYSICS.grooveKappaMin;
  let bestI = scores[0]!.i;
  for (const cand of scores) {
    // Prefer a window whose mean κ is clearly "straight".
    if (cand.mean < kappaMax * 0.85) {
      bestI = cand.i;
      break;
    }
  }

  const rotated = nodes.slice(bestI).concat(nodes.slice(0, bestI));
  const s0 = rotated[0]!.s;
  const rebasing: RacingLineNode[] = rotated.map((node) => {
    let s = node.s - s0;
    if (s < 0) s += track.length;
    return {
      pos: { x: node.pos.x, y: node.pos.y },
      tangent: { x: node.tangent.x, y: node.tangent.y },
      normal: { x: node.normal.x, y: node.normal.y },
      s,
      width: node.width,
      runoffWidth: node.runoffWidth,
      kappa: node.kappa,
      kappaLine: node.kappaLine,
      o: node.o,
    };
  });
  // Keep s monotonic from 0 — sort already is by original order after rotate.
  rebasing.sort((a, b) => a.s - b.s);

  return {
    ...track,
    nodes: rebasing,
    bounds: computeBounds(rebasing),
  };
}

function validateTrack(track: TrackData): boolean {
  return classifyTrackFail(track).kind === 'ok';
}

/** One generation attempt (same seed hashing as generateTrack). */
export function generateTrackAttempt(
  seed: number,
  discipline: DisciplineId,
  archetypeHint?: ArchetypeId,
  scaleOpts?: TrackScaleOpts,
): TrackData {
  const scale = resolveScale(scaleOpts);
  const rng = mulberry32(seed);
  const archetype = scaledArchetype(pickArchetype(rng, discipline, archetypeHint), scale.widthMult);
  const waypoints = generateWaypoints(rng, archetype, scale.lengthMult);
  return buildTrackFromWaypoints(waypoints, archetype, seed, discipline);
}

/** Plan 5.1: seeded procedural track with validation and oval fallback. */
export function generateTrack(
  seed: number,
  discipline: DisciplineId,
  archetypeHint?: ArchetypeId,
  scaleOpts?: TrackScaleOpts,
): TrackData {
  const scale = resolveScale(scaleOpts ?? DEFAULT_SCALE);
  for (let attempt = 0; attempt < PHYSICS.maxGenAttempts; attempt++) {
    const attemptSeed = (seed + attempt * 0x9e3779b9) >>> 0;
    const track = generateTrackAttempt(
      attemptSeed,
      discipline,
      attempt === 0 ? archetypeHint : undefined,
      scale,
    );
    if (validateTrack(track)) return track;
  }

  // Only after exhausting real attempts — known-simple oval fallback.
  const oval = scaledArchetype(ARCHETYPES.find((a) => a.id === 'oval')!, scale.widthMult);
  const rng = mulberry32(FALLBACK_OVAL_SEED);
  const waypoints = generateWaypoints(rng, oval, scale.lengthMult);
  const fallback = buildTrackFromWaypoints(waypoints, oval, FALLBACK_OVAL_SEED, discipline);
  if (!validateTrack(fallback)) {
    console.error('[apex] oval fallback failed validateTrack — using anyway');
  }
  return fallback;
}

/** Plan 5.3: safe speed and braking-limited profile arrays. */
export function buildSpeedProfiles(
  track: TrackData,
  stats: EffectiveStats,
  muSurface?: number,
): SpeedProfiles {
  const mu0 =
    (muSurface ?? getDiscipline(track.discipline).muSurface) * stats.gripFactor * stats.condGrip;
  const g = PHYSICS.g;
  const { vMax, D, aBrake } = stats;
  const n = track.nodes.length;

  const vSafe = track.nodes.map((node) => {
    const r = 1 / Math.max(Math.abs(node.kappaLine), 1e-6);
    const denom = Math.max(0.25, 1 - (mu0 * g * r * D) / (vMax * vMax));
    const vSq = (mu0 * g * r) / denom;
    return Math.min(Math.sqrt(Math.max(0, vSq)), vMax);
  });

  const extended = [...vSafe, ...vSafe];
  const vProfileExt = new Array<number>(extended.length);
  vProfileExt[extended.length - 1] = vSafe[n - 1]!;

  const ds = PHYSICS.sampleDs;
  for (let i = extended.length - 2; i >= 0; i--) {
    const vNext = vProfileExt[i + 1]!;
    const brakeLimit = Math.sqrt(vNext * vNext + 2 * aBrake * 0.9 * ds);
    vProfileExt[i] = Math.min(vSafe[i % n]!, brakeLimit);
  }

  return { vSafe, vProfile: vProfileExt.slice(0, n) };
}

/**
 * Driver target speed under the Scalextric deslot limit.
 * Skill raises the ceiling; Bravery pushes the target closer to it.
 * Physical v_deslot uses Skill/Focus/Bravery in Vehicle.computeVDeslot.
 */
export function buildVDriverProfile(
  vProfile: readonly number[],
  skill: number,
  bravery: number,
): number[] {
  // Wide RPG span: low Skill crawls under the peg; elites + bravery flirt with it.
  const skillCeil = 0.38 + 0.58 * (skill / 100);
  const braveryPush = 0.58 + 0.42 * (bravery / 100);
  const confidence = Math.min(0.98, skillCeil * braveryPush);
  return vProfile.map((v) => v * confidence);
}

/** Estimate lap time by integrating ds / vProfile (plan 5.3). */
export function estimateLapTime(track: TrackData, vProfile: readonly number[]): number {
  const n = track.nodes.length;
  let time = 0;

  for (let i = 0; i < n; i++) {
    const ip = (i + 1) % n;
    const ds =
      ip === 0
        ? track.length - track.nodes[i]!.s
        : track.nodes[ip]!.s - track.nodes[i]!.s;
    const v = Math.max(vProfile[i] ?? 1, 0.5);
    time += ds / v;
  }

  return time;
}
