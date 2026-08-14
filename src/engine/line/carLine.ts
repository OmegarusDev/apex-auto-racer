/**
 * Car-ideal-line engine (spec §4).
 *
 * Pure: track + car spec → the line THIS setup wants. Racer skill lives
 * elsewhere; this is the physics-optimal per-setup line (brake point, turn-in,
 * apex, exit), computed once per race per setup.
 *
 * Sign convention matches the rest of the code: +lineO is toward the node's
 * normal. For κ>0 (a right-hand turn) the apex is on the −normal side, so
 * apex = −sign(κ)·apexFrac·halfWidth and the wide outside = +sign(κ)·0.85·half.
 */
import type { TrackData } from '../TrackGenerator';
import type { RacingLineNode } from '../RacingLine';
import type { EffectiveStats } from '../types';
import type { CarSetup } from '../vehicle/CarSetup';
import { HYBRID_CL_FROM_D, HYBRID_LOAD_SENS_N, HYBRID_RHO } from '../vehicle/dynamics';

export interface CarLine {
  /** Lateral offset per node (m) — the line the setup can physically run. */
  lineO: number[];
  /** Target speed per node (m/s) — the speed envelope (brake → corner → exit). */
  vLine: number[];
}

/** |κ| above this counts as a corner for segmentation. */
const CORNER_KAPPA = 0.012;
/** |κ| below this counts as a straight (used to bracket corners). */
const STRAIGHT_KAPPA = 0.004;

function cornerSpeedAt(
  kappa: number,
  muSurface: number,
  setup: CarSetup,
  vMax: number,
): number {
  const compound = setup.compoundMu ?? 1;
  const g = 9.81;
  const k = Math.max(0.02, Math.abs(kappa));
  const loadSens = HYBRID_LOAD_SENS_N;
  // Aero one-pass: downforce at v raises Fz → grip (load sensitivity), so a
  // downforce car genuinely carries more corner speed.
  let v = Math.sqrt(Math.max(1, (muSurface * compound * g) / k));
  for (let iter = 0; iter < 2; iter++) {
    const q = 0.5 * HYBRID_RHO * v * v;
    const cl = Math.max(0, 0.25) * HYBRID_CL_FROM_D * (setup.clScale ?? 1);
    const fz = setup.massKg * g + q * cl;
    const aGrip =
      (muSurface * compound * (setup.massKg * g) * Math.pow(fz / (setup.massKg * g), loadSens)) /
      setup.massKg;
    v = Math.sqrt(Math.max(1, aGrip / k));
  }
  return Math.min(v, vMax * 0.97);
}

interface Corner {
  peak: number;
  kappa: number;
  v: number;
  apexFrac: number;
}

/** Smooth a periodic profile with a few moving-average passes (nodes are 1-D). */
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

/**
 * Build the per-setup ideal line and speed envelope.
 * @param muSurface the discipline's surface µ (rain-adjusted by the director).
 */
export function carLine(
  track: TrackData,
  stats: EffectiveStats,
  setup: CarSetup,
  muSurface: number,
): CarLine {
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
  const powerRatio = stats.aAccel / Math.max(0.5, muSurface * (setup.compoundMu ?? 1) * 9.81);
  const corners: Corner[] = peaks.map((peak) => {
    const kappa = nodes[peak]!.kappaLine;
    const v = cornerSpeedAt(kappa, muSurface, setup, stats.vMax);
    // Exit-line tradeoff: grippy → geometric apex; powerful → late apex.
    let apexFrac = Math.max(0.45, Math.min(0.98, 0.3 + 0.7 * powerRatio));
    apexFrac += (setup.diffLock ?? 0) * 0.06;
    apexFrac = Math.min(0.98, apexFrac);
    return { peak, kappa, v, apexFrac };
  });

  // --- 3. Build the lateral line: wide outside, cut to the apex, blur. ---
  const line = new Array<number>(n).fill(0);
  let side = 1;
  // Outside bias: carry the sign of the last significant corner along straights.
  for (let i = 0; i < n; i++) {
    const k = nodes[i]!.kappaLine;
    if (Math.abs(k) > STRAIGHT_KAPPA) side = Math.sign(k);
    line[i] = side * 0.85 * halfWidth(nodes[i]!);
  }
  // Apex zone at each corner: pull a window of nodes inward, ramping back to
  // the outside. The zone (not a single point) is what survives smoothing and
  // is where setup differences show in the line SHAPE.
  const apexHalfWindow = 6;
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
  const lineO = smooth(line, 4).map((v, i) => Math.max(-halfWidth(nodes[i]!), Math.min(halfWidth(nodes[i]!), v)));

  // --- 4. Speed envelope: brake into v_c, carry, full-throttle exit. ---
  // Pull the speed down near corner peaks; the BRAKE part shows as a later
  // brake point (speed stays high longer toward the corner).
  const vProfile = new Array<number>(n).fill(stats.vMax);
  for (const c of corners) {
    const radius = 10;
    for (let i = 0; i < n; i++) {
      let ds = Math.abs(i - c.peak);
      ds = Math.min(ds, n - ds);
      const w = Math.exp(-((ds * ds) / (radius * radius)));
      if (vProfile[i]! > c.v) vProfile[i] = vProfile[i]! * (1 - w) + c.v * w;
    }
    // Brake point: the node where braking for this corner must begin, from the
    // current approach speed down to v_c using the car's aBrake.
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
    }
  }
  const vLine = smooth(vProfile, 2);

  return { lineO, vLine };
}
