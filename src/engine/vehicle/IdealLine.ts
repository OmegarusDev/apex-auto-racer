/**
 * Car-Specific Ideal Line Engine (Plan 4.2)
 *
 * Pure physics: track + car setup -> the line THIS setup wants.
 * Racer skill lives elsewhere; this is the physics-optimal per-setup line
 * (brake point, turn-in, apex, track-out), computed once per race per setup.
 *
 * Sign convention: +lineO is toward node.normal. For κ>0 (right-hand turn)
 * the apex is on the -normal side, so apex = -sign(κ)·apexFrac·halfWidth.
 */

import { PHYSICS } from '../../data/physics';
import type { TrackData } from '../TrackGenerator';
import type { RacingLineNode } from '../RacingLine';
import type { EffectiveStats } from '../types';
import type { CarSetup } from './CarSetup';
import { HYBRID_CL_FROM_D, HYBRID_LOAD_SENS_N, HYBRID_RHO } from './dynamics';

export interface IdealLine {
  /** Lateral offset per node (m) — the line the setup can physically run. */
  idealLineO: number[];
  /** Target speed per node (m/s) — the speed envelope (brake -> corner -> exit). */
  idealVLine: number[];
  /** Distance (m) before each corner to begin braking. */
  brakeZoneStart: number[];
  /** Node index for turn-in per corner. */
  turnInPoint: number[];
  /** Node index for apex per corner. */
  apexNode: number[];
  /** Node index for track-out per corner. */
  trackOutNode: number[];
}

const { idealLine } = PHYSICS;
/** |κ| above this counts as a corner for segmentation. */
const CORNER_KAPPA = idealLine.cornerKappaThreshold;
/** |κ| below this counts as a straight (used to bracket corners). */
const STRAIGHT_KAPPA = idealLine.straightKappa;

interface Corner {
  peak: number;
  kappa: number;
  v: number;
  apexFrac: number;
  brakeDist: number;
  turnInIdx: number;
  trackOutIdx: number;
}

/** Smooth a periodic profile with moving-average passes (nodes are 1-D). */
function smooth(profile: number[], passes: number): number[] {
  const n = profile.length;
  const out = profile.slice();
  for (let pass = 0; pass < passes; pass++) {
    const src = out.slice();
    for (let i = 0; i < n; i++) {
      out[i] =
        src[i]! * 0.5 + (src[(i - 1 + n) % n]! + src[(i + 1) % n]!) * 0.25;
    }
  }
  return out;
}

/** Corner speed from real tyre limit with aero downforce iteration. */
function cornerSpeedAt(
  kappa: number,
  muSurface: number,
  setup: CarSetup,
  vMax: number,
  compoundMu: number,
): number {
  const g = 9.81;
  const k = Math.max(0.02, Math.abs(kappa));
  const loadSens = HYBRID_LOAD_SENS_N;

  let v = Math.sqrt(Math.max(1, (muSurface * compoundMu * g) / k));
  for (let iter = 0; iter < 2; iter++) {
    const q = 0.5 * HYBRID_RHO * v * v;
    const cl = Math.max(0, 0.25) * HYBRID_CL_FROM_D * (setup.clScale ?? 1);
    const fz = setup.massKg * g + q * cl;
    const aGrip =
      (muSurface * compoundMu * (setup.massKg * g) * Math.pow(fz / (setup.massKg * g), loadSens)) /
      setup.massKg;
    v = Math.sqrt(Math.max(1, aGrip / k));
  }
  return Math.min(v, vMax * 0.97);
}

/**
 * Build the per-setup ideal line and speed envelope with brake/turn-in/apex/track-out indices.
 * @param muSurface the discipline's surface µ (rain-adjusted by the director).
 */
export function computeIdealLine(
  track: TrackData,
  setup: CarSetup,
  stats: EffectiveStats,
  muSurface: number,
): IdealLine {
  const nodes = track.nodes as unknown as RacingLineNode[];
  const n = nodes.length;
  const halfWidth = (node: RacingLineNode) => Math.max(0.5, node.width / 2 - 0.3);

  // --- 1. Corner segmentation (local |κ| maxima above the threshold). ---
  const peaks: number[] = [];
  for (let i = 0; i < n; i++) {
    const kAbs = Math.abs(nodes[i]!.kappaLine);
    const prev = Math.abs(nodes[(i - 1 + n) % n]!.kappaLine);
    const next = Math.abs(nodes[(i + 1) % n]!.kappaLine);
    if (kAbs > CORNER_KAPPA && kAbs >= prev && kAbs >= next) {
      if (peaks.length === 0 || i - peaks[peaks.length - 1]! > 12) peaks.push(i);
      else if (kAbs > Math.abs(nodes[peaks[peaks.length - 1]!]!.kappaLine)) {
        peaks[peaks.length - 1] = i;
      }
    }
  }

  // --- 2. Per-corner physics: corner speed + exit-optimised apex. ---
  const compoundMu = setup.compoundMu ?? 1;
  const powerRatio = stats.aAccel / Math.max(0.5, muSurface * compoundMu * 9.81);
  const corners: Corner[] = peaks.map((peak) => {
    const kappa = nodes[peak]!.kappaLine;
    const v = cornerSpeedAt(kappa, muSurface, setup, stats.vMax, compoundMu);
    // Exit-line tradeoff: grippy -> geometric apex; powerful -> late apex.
    let apexFrac = Math.max(0.45, Math.min(0.98, 0.3 + 0.7 * powerRatio));
    apexFrac += (setup.diffLock ?? 0) * 0.06;
    apexFrac = Math.min(0.98, apexFrac);

    // Brake distance from approach speed to corner speed using aBrake
    const approach = stats.vMax; // will be refined after speed envelope
    const brakeDist = ((approach * approach - v * v) / (2 * Math.max(0.5, stats.aBrake))) / 3;

    // Turn-in ~1/3 into brake zone, track-out ~1/3 after apex
    const turnInIdx = (peak - Math.max(4, Math.round(brakeDist / 3 / 2))) % n;
    const trackOutIdx = (peak + Math.max(4, Math.round(brakeDist / 3 / 2))) % n;

    return { peak, kappa, v, apexFrac, brakeDist, turnInIdx: turnInIdx < 0 ? turnInIdx + n : turnInIdx, trackOutIdx };
  });

  // --- 3. Build the lateral line: wide outside, cut to the apex, blur. ---
  const line = new Array<number>(n).fill(0);
  let side = 1;
  // Outside bias: carry the sign of the last significant corner along straights.
  for (let i = 0; i < n; i++) {
    const k = nodes[i]!.kappaLine;
    if (Math.abs(k) > STRAIGHT_KAPPA) side = Math.sign(k);
    line[i] = side * idealLine.outsideBias * halfWidth(nodes[i]!);
  }
  // Apex zone at each corner: pull a window of nodes inward, ramping back to
  // the outside. The zone (not a single point) is what survives smoothing and
  // is where setup differences show in the line SHAPE.
  const apexHalfWindow = idealLine.apexHalfWindow;
  for (const c of corners) {
    const s = Math.sign(c.kappa) || 1;
    const apex = -s * c.apexFrac * halfWidth(nodes[c.peak]!);
    for (let d = -apexHalfWindow; d <= apexHalfWindow; d++) {
      const i = (c.peak + d + n) % n;
      const t = Math.abs(d) / apexHalfWindow;
      const blend = 1 - t * t; // sharp at the apex, blending out
      line[i] = line[i]! * (1 - blend) + apex * blend;
    }
  }
  const idealLineO = smooth(line, 4).map((v, i) => Math.max(-halfWidth(nodes[i]!), Math.min(halfWidth(nodes[i]!), v)));

  // --- 4. Speed envelope: brake into v_c, carry, full-throttle exit. ---
  const vProfile = new Array<number>(n).fill(stats.vMax);
  for (const c of corners) {
    const radius = 10;
    for (let i = 0; i < n; i++) {
      let ds = Math.abs(i - c.peak);
      ds = Math.min(ds, n - ds);
      const w = Math.exp(-((ds * ds) / (radius * radius)));
      if (vProfile[i]! > c.v) vProfile[i] = vProfile[i]! * (1 - w) + c.v * w;
    }
    // Brake point: the node where braking for this corner must begin
    const approach = vProfile[c.peak]!;
    if (approach > c.v) {
      const dBrake = ((approach * approach - c.v * c.v) / (2 * Math.max(0.5, stats.aBrake))) / 3;
      for (let i = 0; i < n; i++) {
        let back = c.peak - i;
        back = ((back % n) + n) % n;
        if (back > 0 && back <= dBrake && vProfile[i]! > c.v) {
          vProfile[i] = Math.min(vProfile[i]!, approach - (approach - c.v) * (back / dBrake));
        }
      }
      // Update corner's brakeDist with actual approach speed
      c.brakeDist = dBrake;
      c.turnInIdx = (c.peak - Math.max(4, Math.round(dBrake / 3 / 2))) % n;
      if (c.turnInIdx < 0) c.turnInIdx += n;
      c.trackOutIdx = (c.peak + Math.max(4, Math.round(dBrake / 3 / 2))) % n;
    }
  }
  const idealVLine = smooth(vProfile, 2);

  // --- 5. Extract brake/turn-in/apex/track-out arrays (per node, -1 if none). ---
  const brakeZoneStart = new Array<number>(n).fill(-1);
  const turnInPoint = new Array<number>(n).fill(-1);
  const apexNode = new Array<number>(n).fill(-1);
  const trackOutNode = new Array<number>(n).fill(-1);

  for (const c of corners) {
    // Mark brake zone start nodes (from brakeDist back to turnInIdx)
    const brakeStartIdx = (c.peak - Math.max(4, Math.round(c.brakeDist / 2))) % n;
    const brakeStartIdxNorm = brakeStartIdx < 0 ? brakeStartIdx + n : brakeStartIdx;
    for (let i = brakeStartIdxNorm; i !== c.peak; i = (i + 1) % n) {
      brakeZoneStart[i] = c.brakeDist;
    }
    // Mark turn-in approach zone: the node BEFORE the apex where the car
    // should begin turning.  Stored as 1 for approach nodes so the brain
    // can detect "approaching turn-in" without O(n) scanning.
    const approachWindow = Math.max(4, Math.round(c.brakeDist / 3));
    for (let d = -approachWindow; d <= 0; d++) {
      const i = (c.turnInIdx + d + n) % n;
      if (turnInPoint[i] === -1) turnInPoint[i] = 1;
    }
    apexNode[c.peak] = c.peak;
    trackOutNode[c.trackOutIdx] = c.trackOutIdx;
  }

  return { idealLineO, idealVLine, brakeZoneStart, turnInPoint, apexNode, trackOutNode };
}