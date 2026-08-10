import { PHYSICS } from '../data/physics';
import type { Vec2 } from './types';

export interface SplineSample {
  pos: Vec2;
  tangent: Vec2;
  normal: Vec2;
  s: number;
}

export interface RacingLineNode extends SplineSample {
  width: number;
  runoffWidth: number;
  kappa: number;
  kappaLine: number;
  o: number;
}

const ALPHA = 0.5;
const EPS = 1e-6;

function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

function scale(v: Vec2, s: number): Vec2 {
  return { x: v.x * s, y: v.y * s };
}

function len(v: Vec2): number {
  return Math.hypot(v.x, v.y);
}

function normalize(v: Vec2): Vec2 {
  const l = len(v);
  if (l < EPS) return { x: 1, y: 0 };
  return { x: v.x / l, y: v.y / l };
}

function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

function leftNormal(tangent: Vec2): Vec2 {
  return { x: -tangent.y, y: tangent.x };
}

function dist(a: Vec2, b: Vec2): number {
  return len(sub(a, b));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpVec(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

function wrapIndex(i: number, n: number): number {
  return ((i % n) + n) % n;
}

/** Centripetal knot spacing for Catmull-Rom (alpha = 0.5). */
function knotDelta(a: Vec2, b: Vec2): number {
  return Math.pow(dist(a, b), ALPHA);
}

/** Evaluate centripetal Catmull-Rom at global parameter t in [t1, t2]. */
function catmullRomPoint(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number, t0: number, t1: number, t2: number, t3: number): Vec2 {
  const a1 = scale(add(scale(p0, (t1 - t) / (t1 - t0)), scale(p1, (t - t0) / (t1 - t0))), 1);
  const a2 = scale(add(scale(p1, (t2 - t) / (t2 - t1)), scale(p2, (t - t1) / (t2 - t1))), 1);
  const a3 = scale(add(scale(p2, (t3 - t) / (t3 - t2)), scale(p3, (t - t2) / (t3 - t2))), 1);

  const b1 = lerpVec(a1, a2, (t - t0) / (t2 - t0));
  const b2 = lerpVec(a2, a3, (t - t1) / (t3 - t1));
  return lerpVec(b1, b2, (t - t1) / (t2 - t1));
}

/** Derivative of centripetal Catmull-Rom w.r.t. t (finite-difference fallback safe). */
function catmullRomTangent(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number, t0: number, t1: number, t2: number, t3: number): Vec2 {
  const dt = 0.001;
  const tLo = Math.max(t1 + EPS, t - dt);
  const tHi = Math.min(t2 - EPS, t + dt);
  const pLo = catmullRomPoint(p0, p1, p2, p3, tLo, t0, t1, t2, t3);
  const pHi = catmullRomPoint(p0, p1, p2, p3, tHi, t0, t1, t2, t3);
  return normalize(sub(pHi, pLo));
}

export interface ClosedSpline {
  waypoints: Vec2[];
  cumulativeT: number[];
  segmentT0: number[];
  totalLength: number;
}

/** Build closed centripetal Catmull-Rom parameterization from waypoints. */
export function buildClosedCentripetalSpline(waypoints: Vec2[]): ClosedSpline {
  const n = waypoints.length;
  if (n < 4) throw new Error('Closed spline requires at least 4 waypoints');

  const segmentT0: number[] = [];
  const cumulativeT: number[] = [0];
  let totalT = 0;

  for (let i = 0; i < n; i++) {
    const p0 = waypoints[wrapIndex(i - 1, n)]!;
    const p1 = waypoints[i]!;
    segmentT0.push(totalT);
    totalT += knotDelta(p0, p1);
    cumulativeT.push(totalT);
  }

  return {
    waypoints,
    cumulativeT,
    segmentT0,
    totalLength: totalT,
  };
}

function evalSplineAtT(spline: ClosedSpline, globalT: number): { pos: Vec2; tangent: Vec2 } {
  const n = spline.waypoints.length;
  const totalT = spline.totalLength;
  let t = globalT % totalT;
  if (t < 0) t += totalT;

  let seg = 0;
  for (let i = 0; i < n; i++) {
    const tStart = spline.segmentT0[i]!;
    const tEnd = i + 1 < n ? spline.segmentT0[i + 1]! : totalT;
    if (t >= tStart && (i === n - 1 ? t <= totalT : t < tEnd)) {
      seg = i;
      break;
    }
  }

  const i = seg;
  const p0 = spline.waypoints[wrapIndex(i - 1, n)]!;
  const p1 = spline.waypoints[i]!;
  const p2 = spline.waypoints[wrapIndex(i + 1, n)]!;
  const p3 = spline.waypoints[wrapIndex(i + 2, n)]!;

  const t0 = spline.segmentT0[wrapIndex(i - 1, n)]!;
  const t1 = spline.segmentT0[i]!;
  const t2 = i + 1 < n ? spline.segmentT0[i + 1]! : totalT;
  const t3 = spline.segmentT0[wrapIndex(i + 2, n)]!;

  const pos = catmullRomPoint(p0, p1, p2, p3, t, t0, t1, t2, t3);
  const tangent = catmullRomTangent(p0, p1, p2, p3, t, t0, t1, t2, t3);
  return { pos, tangent };
}

/** Sample closed spline at uniform arc-length spacing (ds meters). */
export function sampleSplineByArcLength(
  spline: ClosedSpline,
  ds: number,
): SplineSample[] {
  const samples: SplineSample[] = [];
  const fineStep = Math.max(ds * 0.05, 0.05);
  let t = 0;
  let s = 0;
  let prevPos = evalSplineAtT(spline, 0).pos;
  const startEval = evalSplineAtT(spline, 0);

  samples.push({
    pos: startEval.pos,
    tangent: startEval.tangent,
    normal: leftNormal(startEval.tangent),
    s: 0,
  });

  // Walk open parameter range [0, totalLength). Do not emit a closing duplicate of
  // the start sample — that near-overlap creates false curvature spikes at the seam.
  while (t < spline.totalLength - fineStep) {
    t = Math.min(t + fineStep, spline.totalLength - fineStep);
    const evalAt = evalSplineAtT(spline, t);
    s += dist(prevPos, evalAt.pos);
    prevPos = evalAt.pos;

    const lastS = samples[samples.length - 1]!.s;
    if (s - lastS >= ds - EPS) {
      samples.push({
        pos: evalAt.pos,
        tangent: evalAt.tangent,
        normal: leftNormal(evalAt.tangent),
        s,
      });
    }
  }

  // Drop a trailing sample that collapsed onto the start (numerical wrap).
  if (samples.length > 2) {
    const first = samples[0]!.pos;
    const last = samples[samples.length - 1]!.pos;
    if (dist(first, last) < ds * 0.25) {
      samples.pop();
    }
  }

  return samples;
}

/** Curvature by finite differences on tangent heading vs arc length. */
export function computeCurvature(
  nodes: readonly { tangent: Vec2; s: number; pos?: Vec2 }[],
): number[] {
  const n = nodes.length;
  const kappa = new Array<number>(n).fill(0);
  if (n < 3) return kappa;

  // Closed loop perimeter: open-chain s of last sample plus seam gap back to first.
  let loopLength = Math.max(nodes[n - 1]!.s, EPS);
  const p0 = nodes[0]!.pos;
  const pLast = nodes[n - 1]!.pos;
  if (p0 !== undefined && pLast !== undefined) {
    loopLength += dist(p0, pLast);
  }

  for (let i = 0; i < n; i++) {
    const im = wrapIndex(i - 1, n);
    const ip = wrapIndex(i + 1, n);
    const tm = nodes[im]!.tangent;
    const tp = nodes[ip]!.tangent;
    let ds = nodes[ip]!.s - nodes[im]!.s;
    if (ds <= EPS) ds += loopLength;
    const dTheta = Math.atan2(tp.y, tp.x) - Math.atan2(tm.y, tm.x);
    let wrapped = dTheta;
    while (wrapped > Math.PI) wrapped -= 2 * Math.PI;
    while (wrapped < -Math.PI) wrapped += 2 * Math.PI;
    kappa[i] = ds > EPS ? wrapped / ds : 0;
  }

  return kappa;
}

/** Rebuild closed centerline samples after position edits (tangents, normals, s). */
export function rebuildClosedSamples(positions: readonly Vec2[]): SplineSample[] {
  const n = positions.length;
  if (n < 3) throw new Error('rebuildClosedSamples requires at least 3 points');

  const samples: SplineSample[] = [];
  let s = 0;
  for (let i = 0; i < n; i++) {
    const pos = positions[i]!;
    if (i > 0) s += dist(positions[i - 1]!, pos);
    const tangent = normalize(sub(positions[wrapIndex(i + 1, n)]!, positions[wrapIndex(i - 1, n)]!));
    samples.push({
      pos: { x: pos.x, y: pos.y },
      tangent,
      normal: leftNormal(tangent),
      s,
    });
  }
  return samples;
}

/**
 * Iteratively smooth high-curvature centerline nodes toward neighbor midpoints
 * until min corner radius >= minRadius (or maxIters).
 * Plan: "min corner radius >= 18 m (relax offending nodes)".
 */
export function relaxCenterlineMinRadius(
  centerline: readonly SplineSample[],
  minRadius: number,
  maxIters = 200,
  blend = 0.45,
): SplineSample[] {
  const n = centerline.length;
  if (n < 3) return centerline.map((c) => ({ ...c, pos: { ...c.pos } }));

  let positions = centerline.map((c) => ({ x: c.pos.x, y: c.pos.y }));
  const maxKappa = 1 / Math.max(minRadius, EPS);

  for (let iter = 0; iter < maxIters; iter++) {
    const samples = rebuildClosedSamples(positions);
    const kappa = computeCurvature(samples);
    let minR = Infinity;
    let worst = -1;
    for (let i = 0; i < n; i++) {
      const ak = Math.abs(kappa[i]!);
      if (ak > EPS) {
        const r = 1 / ak;
        if (r < minR) {
          minR = r;
          worst = i;
        }
      }
    }
    if (minR >= minRadius) return samples;

    const next = positions.map((p) => ({ x: p.x, y: p.y }));
    // Stronger blend when still far below target (or late iterations stall).
    const urgency = Math.min(1, (minRadius / Math.max(minR, EPS) - 1) * 0.5 + 0.25);
    const localBlend = Math.min(0.75, blend * (0.6 + urgency));

    for (let i = 0; i < n; i++) {
      const ak = Math.abs(kappa[i]!);
      if (ak <= maxKappa && i !== worst) continue;
      const mid = scale(add(positions[wrapIndex(i - 1, n)]!, positions[wrapIndex(i + 1, n)]!), 0.5);
      const b = i === worst ? Math.min(0.85, localBlend + 0.15) : localBlend;
      next[i] = {
        x: lerp(positions[i]!.x, mid.x, b),
        y: lerp(positions[i]!.y, mid.y, b),
      };
    }

    // Also lightly pull immediate neighbors of offending nodes so corners don't just shift.
    for (let i = 0; i < n; i++) {
      if (Math.abs(kappa[i]!) <= maxKappa) continue;
      for (const d of [-1, 1]) {
        const j = wrapIndex(i + d, n);
        if (Math.abs(kappa[j]!) > maxKappa) continue;
        const mid = scale(add(positions[wrapIndex(j - 1, n)]!, positions[wrapIndex(j + 1, n)]!), 0.5);
        next[j] = {
          x: lerp(next[j]!.x, mid.x, localBlend * 0.35),
          y: lerp(next[j]!.y, mid.y, localBlend * 0.35),
        };
      }
    }

    positions = next;
  }

  return rebuildClosedSamples(positions);
}

/**
 * Per-driver racing line as a *lane corridor*, not a rush to shared geometric o(s).
 * Track node.o stays decorative; centerline (l=0) is bounds/graphics only.
 *
 * - Lane identity from grid column (left stays left, right stays right)
 * - Skill → cut farther toward the apex *within* that side of the track
 * - Bravery → carry a bit wider through the corner
 * - Anchored to gridL near the start so launch does not yank laterally
 */
export function buildPersonalRacingLine(
  nodes: readonly RacingLineNode[],
  trackLength: number,
  skill: number,
  bravery: number,
  gripFactor: number,
  laneSign: number,
  gridS: number,
  gridL: number,
): number[] {
  const n = nodes.length;
  if (n === 0) return [];

  const skill01 = Math.max(0, Math.min(1, skill / 100));
  const bravery01 = Math.max(0, Math.min(1, bravery / 100));
  const sign = Math.sign(laneSign || gridL || 1) || 1;
  // Preferred lane center — stays near the grid column, not the track centerline.
  const laneBase = sign * PHYSICS.gridColOffset * (0.92 + 0.08 * (1 - skill01));
  // How far elites may ease toward center for an apex (still mostly on their side).
  const crossCap = 0.4 + 2.2 * skill01;
  const gripUse = 0.85 + 0.2 * Math.max(0.5, Math.min(1.2, gripFactor));
  const out = new Array<number>(n);

  for (let i = 0; i < n; i++) {
    const node = nodes[i]!;
    const half = Math.max(0.5, node.width / 2 - PHYSICS.racingLineMargin);
    const k = node.kappaLine;
    const kAbs = Math.abs(k);
    const corner = Math.min(1, kAbs / Math.max(PHYSICS.grooveKappaMin * 2.2, 1e-3));

    // Inside of the corner (toward apex). Geometric o() is only a hint for magnitude.
    const insideDir = kAbs > 1e-5 ? -Math.sign(k) : 0;
    const apexCut =
      insideDir * corner * (0.9 + 2.4 * skill01) * gripUse;
    // Bravery holds a touch wider (less cut / slight outside bias).
    const wideCarry = sign * corner * bravery01 * (0.7 + 0.6 * (1 - skill01));

    let line = laneBase + apexCut * (0.55 + 0.45 * skill01) + wideCarry * 0.35;

    // Soft hint from geometric ideal — only the component that keeps lane identity.
    const idealHint = node.o * (0.15 + 0.25 * skill01);
    if (sign < 0) {
      line = line * 0.82 + Math.min(idealHint, 0) * 0.18;
      line = Math.min(line, crossCap);
    } else {
      line = line * 0.82 + Math.max(idealHint, 0) * 0.18;
      line = Math.max(line, -crossCap);
    }

    out[i] = Math.max(-half, Math.min(half, line));
  }

  // Light smooth.
  const smoothed = out.slice();
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      const im = wrapIndex(i - 1, n);
      const ip = wrapIndex(i + 1, n);
      smoothed[i] = out[i]! * 0.5 + (out[im]! + out[ip]!) * 0.25;
    }
    for (let i = 0; i < n; i++) out[i] = smoothed[i]!;
  }

  // Hard-anchor near the grid stub — launch line == starting column.
  const anchorDist = 70;
  for (let i = 0; i < n; i++) {
    const node = nodes[i]!;
    let ds = Math.abs(node.s - gridS);
    ds = Math.min(ds, trackLength - ds);
    if (ds >= anchorDist) continue;
    const w = 1 - ds / anchorDist;
    const blend = w * w * (3 - 2 * w);
    const half = Math.max(0.5, node.width / 2 - PHYSICS.racingLineMargin);
    out[i] = Math.max(-half, Math.min(half, out[i]! * (1 - blend) + gridL * blend));
  }

  return out;
}

/** Plan 5.2: iterative racing-line offsets along centerline normals. */
export function computeRacingLineOffsets(
  centerline: readonly SplineSample[],
  width: number,
): number[] {
  const n = centerline.length;
  const margin = PHYSICS.racingLineMargin;
  const maxOffset = width / 2 - margin;
  const o = new Array<number>(n).fill(0);

  for (let iter = 0; iter < PHYSICS.racingLineIters; iter++) {
    for (let i = 0; i < n; i++) {
      const im = wrapIndex(i - 1, n);
      const ip = wrapIndex(i + 1, n);
      const ci = centerline[i]!;
      const ni = ci.normal;
      const midpoint = scale(add(centerline[im]!.pos, centerline[ip]!.pos), 0.5);
      const target = dot(sub(midpoint, ci.pos), ni);
      o[i] = o[i]! + PHYSICS.racingLineGain * (target - o[i]!);
      o[i] = Math.max(-maxOffset, Math.min(maxOffset, o[i]!));
    }
  }

  return o;
}

/** Build full racing-line node data from centerline samples. */
export function buildRacingLineNodes(
  centerline: SplineSample[],
  width: number,
  runoffWidth: number,
): RacingLineNode[] {
  const o = computeRacingLineOffsets(centerline, width);
  const kappa = computeCurvature(centerline);

  const linePoints = centerline.map((node, i) => ({
    pos: add(node.pos, scale(node.normal, o[i]!)),
    tangent: node.tangent,
    s: node.s,
  }));

  const kappaLine = computeCurvature(linePoints);

  return centerline.map((node, i) => ({
    pos: node.pos,
    tangent: node.tangent,
    normal: node.normal,
    s: node.s,
    width,
    runoffWidth,
    kappa: kappa[i]!,
    kappaLine: kappaLine[i]!,
    o: o[i]!,
  }));
}

/** Linear lookup of node fields at distance s along track length L. */
export function lookupAtS<T extends { s: number }>(
  nodes: readonly T[],
  trackLength: number,
  s: number,
): T {
  if (nodes.length === 0) throw new Error('lookupAtS: empty nodes');
  let dist = s % trackLength;
  if (dist < 0) dist += trackLength;

  if (dist <= nodes[0]!.s) return nodes[0]!;
  const last = nodes[nodes.length - 1]!;
  if (dist >= last.s) return last;

  let lo = 0;
  let hi = nodes.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (nodes[mid]!.s <= dist) lo = mid;
    else hi = mid;
  }

  return nodes[lo]!;
}

export interface InterpolatedNode {
  pos: Vec2;
  tangent: Vec2;
  normal: Vec2;
  width: number;
  runoffWidth: number;
  kappa: number;
  kappaLine: number;
  o: number;
  s: number;
}

/** Interpolate node data at s into `out` (wraps at L). Prefer this on hot paths. */
export function interpolateAtSInto(
  nodes: readonly RacingLineNode[],
  trackLength: number,
  s: number,
  out: InterpolatedNode,
): InterpolatedNode {
  if (nodes.length === 0) throw new Error('interpolateAtS: empty nodes');
  let distS = s % trackLength;
  if (distS < 0) distS += trackLength;

  const n = nodes.length;
  // Binary search for segment start (same index logic as lookupAtS).
  let i0 = 0;
  if (distS > nodes[0]!.s) {
    let lo = 0;
    let hi = n - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (nodes[mid]!.s <= distS) lo = mid;
      else hi = mid;
    }
    i0 = lo;
  }
  const i1 = wrapIndex(i0 + 1, n);
  const n0 = nodes[i0]!;
  const n1 = nodes[i1]!;

  let ds = n1.s - n0.s;
  if (ds <= 0) ds += trackLength;
  let localS = distS - n0.s;
  if (localS < 0) localS += trackLength;
  const t = ds > EPS ? localS / ds : 0;

  out.pos.x = lerp(n0.pos.x, n1.pos.x, t);
  out.pos.y = lerp(n0.pos.y, n1.pos.y, t);
  const tx = lerp(n0.tangent.x, n1.tangent.x, t);
  const ty = lerp(n0.tangent.y, n1.tangent.y, t);
  const tl = Math.hypot(tx, ty);
  if (tl < EPS) {
    out.tangent.x = 1;
    out.tangent.y = 0;
  } else {
    out.tangent.x = tx / tl;
    out.tangent.y = ty / tl;
  }
  out.normal.x = -out.tangent.y;
  out.normal.y = out.tangent.x;
  out.width = lerp(n0.width, n1.width, t);
  out.runoffWidth = lerp(n0.runoffWidth, n1.runoffWidth, t);
  out.kappa = lerp(n0.kappa, n1.kappa, t);
  out.kappaLine = lerp(n0.kappaLine, n1.kappaLine, t);
  out.o = lerp(n0.o, n1.o, t);
  out.s = distS;
  return out;
}

/** Linear interpolation of node data at s (wraps at L). Allocates a new node. */
export function interpolateAtS(
  nodes: readonly RacingLineNode[],
  trackLength: number,
  s: number,
): InterpolatedNode {
  return interpolateAtSInto(nodes, trackLength, s, {
    pos: { x: 0, y: 0 },
    tangent: { x: 1, y: 0 },
    normal: { x: 0, y: 1 },
    width: 0,
    runoffWidth: 0,
    kappa: 0,
    kappaLine: 0,
    o: 0,
    s: 0,
  });
}

/** Convert track-relative (s, l) to world coordinates (centerline + l * normal). */
export function slToWorld(
  nodes: readonly RacingLineNode[],
  trackLength: number,
  s: number,
  l: number,
): Vec2 {
  const node = interpolateAtS(nodes, trackLength, s);
  return add(node.pos, scale(node.normal, l));
}

/** Outward direction in a corner: away from curvature center = -sign(kappa) along normal. */
export function outwardSign(kappa: number): number {
  if (Math.abs(kappa) < EPS) return 0;
  return kappa > 0 ? -1 : 1;
}
