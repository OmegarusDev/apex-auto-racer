/**
 * Build a lit 3D Scalextric-style track mesh from TrackView nodes.
 * Physics Frenet frame stays authoritative — this only extrudes presentation geometry.
 */

import { KERB_KAPPA } from '../constants';
import type { TrackPalette } from '../materials';
import type { TrackView } from '../types';
import {
  MAT_CONCRETE,
  MAT_DIRT,
  MAT_GENERIC,
  MAT_GRASS,
  MAT_GROOVE,
  MAT_RUMBLE,
  MAT_TARMAC,
} from './materials';
import { MeshBuilder } from './MeshBuilder';
import { sampleTrack } from '../TrackSampler';

/**
 * Checkered start/finish band across the track at arc position s — the "line"
 * the cars cross. Always drawn at the start (s=0) and again at the sprint
 * finish, wherever that lands on the loop.
 */
function buildLineBand(
  mb: MeshBuilder,
  track: TrackView,
  s: number,
): void {
  const halfLen = 1.5;
  const alongSteps = 2;
  const center = sampleTrack(track, s);
  const acrossCells = Math.max(3, Math.min(12, Math.round(center.width / 2)));
  const light: readonly [number, number, number] = [0.93, 0.93, 0.88];
  const dark: readonly [number, number, number] = [0.13, 0.13, 0.14];
  const yLift = 0.05;

  for (let i = 0; i < alongSteps; i++) {
    const a0 = sampleTrack(track, s - halfLen + (2 * halfLen * i) / alongSteps);
    const a1 = sampleTrack(track, s - halfLen + (2 * halfLen * (i + 1)) / alongSteps);
    const w0 = a0.width / 2;
    const w1 = a1.width / 2;
    for (let j = 0; j < acrossCells; j++) {
      const c = (i + j) % 2 === 0 ? light : dark;
      const t0 = -1 + (2 * j) / acrossCells;
      const t1 = -1 + (2 * (j + 1)) / acrossCells;
      const ax = a0.pos.x + a0.normal.x * t0 * w0;
      const ay = a0.pos.y + a0.normal.y * t0 * w0;
      const bx = a0.pos.x + a0.normal.x * t1 * w0;
      const by = a0.pos.y + a0.normal.y * t1 * w0;
      const cx = a1.pos.x + a1.normal.x * t1 * w1;
      const cy = a1.pos.y + a1.normal.y * t1 * w1;
      const dx = a1.pos.x + a1.normal.x * t0 * w1;
      const dy = a1.pos.y + a1.normal.y * t0 * w1;
      mb.addFace(
        ax, yLift, -ay,
        bx, yLift, -by,
        cx, yLift, -cy,
        dx, yLift, -dy,
        0, 1, 0,
        c[0], c[1], c[2],
        MAT_GENERIC,
      );
    }
  }
}

export interface BuiltTrackMesh {
  vertices: Float32Array;
  indices: Uint16Array | Uint32Array;
  /** Normalized polyline for minimap (nx, ny in 0..1). */
  minimap: Array<{ nx: number; ny: number }>;
}

function sampleClosed(
  track: TrackView,
  segments: number,
): Array<{
  x: number;
  z: number;
  tx: number;
  tz: number;
  nx: number;
  nz: number;
  halfW: number;
  runoff: number;
  kappa: number;
}> {
  const nodes = track.nodes;
  const n = nodes.length;
  // A sprint is a point-to-point ribbon: sample up to just past the finish so
  // the banner sits fully on tarmac with a short roll-out strip, and leave it
  // OPEN (no closing vertex) — the loop's return half is never drawn.
  const sprintRunoff = 8;
  const sprintEnd = track.sprintFinishS !== undefined ? track.sprintFinishS + sprintRunoff : null;
  const length = sprintEnd ?? track.length;
  const out: Array<{
    x: number;
    z: number;
    tx: number;
    tz: number;
    nx: number;
    nz: number;
    halfW: number;
    runoff: number;
    kappa: number;
  }> = [];

  for (let i = 0; i < segments; i++) {
    const sQuery = (i / segments) * length;
    let lo = 0;
    while (lo < n - 1 && nodes[lo + 1]!.s <= sQuery) lo++;
    const a = nodes[lo]!;
    const b = nodes[(lo + 1) % n]!;
    const span = lo === n - 1 ? Math.max(1e-6, length - a.s) : Math.max(1e-6, b.s - a.s);
    const t = Math.max(0, Math.min(1, (sQuery - a.s) / span));
    const x = a.pos.x + (b.pos.x - a.pos.x) * t;
    const y = a.pos.y + (b.pos.y - a.pos.y) * t;
    const tx = a.tangent.x + (b.tangent.x - a.tangent.x) * t;
    const ty = a.tangent.y + (b.tangent.y - a.tangent.y) * t;
    const tlen = Math.hypot(tx, ty) || 1;
    const nx = a.normal.x + (b.normal.x - a.normal.x) * t;
    const ny = a.normal.y + (b.normal.y - a.normal.y) * t;
    const nlen = Math.hypot(nx, ny) || 1;
    const halfW = (a.width + (b.width - a.width) * t) * 0.5;
    const runoff = a.runoffWidth + (b.runoffWidth - a.runoffWidth) * t;
    const kappa = Math.abs(a.kappa) * (1 - t) + Math.abs(b.kappa) * t;
    out.push({
      x,
      z: -y,
      tx: tx / tlen,
      tz: -ty / tlen,
      nx: nx / nlen,
      nz: -ny / nlen,
      halfW,
      runoff,
      kappa,
    });
  }
  if (sprintEnd === null) out.push(out[0]!);
  return out;
}
export function buildTrackGeometry(track: TrackView, _palette: TrackPalette): BuiltTrackMesh {
  void _palette;
  const mb = new MeshBuilder();
  const samples = sampleClosed(track, Math.max(120, track.nodes.length * 2));

  // Brighter mesh bases (shader fuzz owns detail; these help fallback tinting).
  const tarmacBase = [0.4, 0.4, 0.42] as const;
  const dirtBase = [0.7, 0.58, 0.38] as const;
  const grassBase = [0.35, 0.62, 0.28] as const;
  const grooveBase = [0.25, 0.25, 0.26] as const;
  const concreteBase = [0.65, 0.64, 0.6] as const;

  const leftAsphalt: Array<{ x: number; y: number; z: number }> = [];
  const rightAsphalt: Array<{ x: number; y: number; z: number }> = [];
  const leftGroove: Array<{ x: number; y: number; z: number }> = [];
  const rightGroove: Array<{ x: number; y: number; z: number }> = [];
  const leftDirtInner: Array<{ x: number; y: number; z: number }> = [];
  const rightDirtInner: Array<{ x: number; y: number; z: number }> = [];
  const leftDirtOuter: Array<{ x: number; y: number; z: number }> = [];
  const rightDirtOuter: Array<{ x: number; y: number; z: number }> = [];
  const leftGrassOuter: Array<{ x: number; y: number; z: number }> = [];
  const rightGrassOuter: Array<{ x: number; y: number; z: number }> = [];

  const grooveHalf = 0.55;
  const grassExtra = 18;

  for (const s of samples) {
    const dirtW = Math.max(s.runoff * 1.15, 3.2);
    leftAsphalt.push({
      x: s.x + s.nx * s.halfW,
      y: 0.02,
      z: s.z + s.nz * s.halfW,
    });
    rightAsphalt.push({
      x: s.x - s.nx * s.halfW,
      y: 0.02,
      z: s.z - s.nz * s.halfW,
    });
    leftGroove.push({
      x: s.x + s.nx * grooveHalf,
      y: -0.045,
      z: s.z + s.nz * grooveHalf,
    });
    rightGroove.push({
      x: s.x - s.nx * grooveHalf,
      y: -0.045,
      z: s.z - s.nz * grooveHalf,
    });
    leftDirtInner.push({
      x: s.x + s.nx * s.halfW,
      y: 0.0,
      z: s.z + s.nz * s.halfW,
    });
    rightDirtInner.push({
      x: s.x - s.nx * s.halfW,
      y: 0.0,
      z: s.z - s.nz * s.halfW,
    });
    leftDirtOuter.push({
      x: s.x + s.nx * (s.halfW + dirtW),
      y: -0.015,
      z: s.z + s.nz * (s.halfW + dirtW),
    });
    rightDirtOuter.push({
      x: s.x - s.nx * (s.halfW + dirtW),
      y: -0.015,
      z: s.z - s.nz * (s.halfW + dirtW),
    });
    leftGrassOuter.push({
      x: s.x + s.nx * (s.halfW + dirtW + grassExtra),
      y: -0.04,
      z: s.z + s.nz * (s.halfW + dirtW + grassExtra),
    });
    rightGrassOuter.push({
      x: s.x - s.nx * (s.halfW + dirtW + grassExtra),
      y: -0.04,
      z: s.z - s.nz * (s.halfW + dirtW + grassExtra),
    });
  }

  // Grass verges beyond dirt
  mb.ribbon(
    leftGrassOuter,
    leftDirtOuter,
    0,
    grassBase[0],
    grassBase[1],
    grassBase[2],
    MAT_GRASS,
  );
  mb.ribbon(
    rightDirtOuter,
    rightGrassOuter,
    0,
    grassBase[0],
    grassBase[1],
    grassBase[2],
    MAT_GRASS,
  );

  // Dirt / gravel runoff
  mb.ribbon(
    leftDirtOuter,
    leftDirtInner,
    0,
    dirtBase[0],
    dirtBase[1],
    dirtBase[2],
    MAT_DIRT,
  );
  mb.ribbon(
    rightDirtInner,
    rightDirtOuter,
    0,
    dirtBase[0],
    dirtBase[1],
    dirtBase[2],
    MAT_DIRT,
  );

  // Tarmac decks
  mb.ribbon(
    leftAsphalt,
    leftGroove,
    0,
    tarmacBase[0],
    tarmacBase[1],
    tarmacBase[2],
    MAT_TARMAC,
  );
  mb.ribbon(
    rightGroove,
    rightAsphalt,
    0,
    tarmacBase[0],
    tarmacBase[1],
    tarmacBase[2],
    MAT_TARMAC,
  );

  // Recessed groove
  mb.ribbon(
    leftGroove,
    rightGroove,
    0,
    grooveBase[0],
    grooveBase[1],
    grooveBase[2],
    MAT_GROOVE,
  );

  // Red/white rumble strips on corners + muted concrete barriers
  for (let i = 0; i < samples.length - 1; i++) {
    const s0 = samples[i]!;
    const s1 = samples[i + 1]!;
    if (s0.kappa >= KERB_KAPPA || s1.kappa >= KERB_KAPPA) {
      const kerbW = 0.65;
      for (const side of [1, -1] as const) {
        const inner0 = {
          x: s0.x + side * s0.nx * s0.halfW,
          y: 0.04,
          z: s0.z + side * s0.nz * s0.halfW,
        };
        const outer0 = {
          x: s0.x + side * s0.nx * (s0.halfW + kerbW),
          y: 0.07,
          z: s0.z + side * s0.nz * (s0.halfW + kerbW),
        };
        const inner1 = {
          x: s1.x + side * s1.nx * s1.halfW,
          y: 0.04,
          z: s1.z + side * s1.nz * s1.halfW,
        };
        const outer1 = {
          x: s1.x + side * s1.nx * (s1.halfW + kerbW),
          y: 0.07,
          z: s1.z + side * s1.nz * (s1.halfW + kerbW),
        };
        if (side > 0) {
          mb.rumbleRibbon([outer0, outer1], [inner0, inner1], 0, MAT_RUMBLE);
        } else {
          mb.rumbleRibbon([inner0, inner1], [outer0, outer1], 0, MAT_RUMBLE);
        }
      }
    }

    // Low concrete barriers — no neon accents
    const wallH = 0.38;
    for (const side of [1, -1] as const) {
      const dirtW = Math.max(s0.runoff, 2.2);
      const ox0 = s0.x + side * s0.nx * (s0.halfW + dirtW * 0.55);
      const oz0 = s0.z + side * s0.nz * (s0.halfW + dirtW * 0.55);
      const dirtW1 = Math.max(s1.runoff, 2.2);
      const ox1 = s1.x + side * s1.nx * (s1.halfW + dirtW1 * 0.55);
      const oz1 = s1.z + side * s1.nz * (s1.halfW + dirtW1 * 0.55);
      mb.addFace(
        ox0,
        0.0,
        oz0,
        ox1,
        0.0,
        oz1,
        ox1,
        wallH,
        oz1,
        ox0,
        wallH,
        oz0,
        side * s0.nx,
        0,
        side * s0.nz,
        concreteBase[0],
        concreteBase[1],
        concreteBase[2],
        MAT_CONCRETE,
      );
    }
  }

  // Far grass ground plate
  const b = track.bounds;
  const pad = 36;
  const minX = b.minX - pad;
  const maxX = b.maxX + pad;
  const minZ = -(b.maxY + pad);
  const maxZ = -(b.minY - pad);
  mb.addFace(
    minX,
    -0.08,
    minZ,
    maxX,
    -0.08,
    minZ,
    maxX,
    -0.08,
    maxZ,
    minX,
    -0.08,
    maxZ,
    0,
    1,
    0,
    grassBase[0],
    grassBase[1],
    grassBase[2],
    MAT_GRASS,
  );

  // Start line (s=0) always; a sprint also banners its finish wherever it
  // lands on the loop. Circuits share one line (start == finish).
  buildLineBand(mb, track, 0);
  if (track.sprintFinishS !== undefined) {
    buildLineBand(mb, track, track.sprintFinishS);
  }

  const { vertices, indices } = mb.build();

  // Normalize the minimap to the SAMPLED extent — for a sprint the samples are
  // the raced portion only, so the minimap shows the point-to-point ribbon
  // filling its own box rather than squishing into the full-loop bounds.
  let mmMinX = Infinity;
  let mmMaxX = -Infinity;
  let mmMinY = Infinity;
  let mmMaxY = -Infinity;
  for (const s of samples) {
    mmMinX = Math.min(mmMinX, s.x);
    mmMaxX = Math.max(mmMaxX, s.x);
    mmMinY = Math.min(mmMinY, -s.z);
    mmMaxY = Math.max(mmMaxY, -s.z);
  }
  const spanX = Math.max(mmMaxX - mmMinX, 1);
  const spanY = Math.max(mmMaxY - mmMinY, 1);
  const minimap = samples.slice(0, -1).map((s) => ({
    nx: (s.x - mmMinX) / spanX,
    ny: 1 - (-s.z - mmMinY) / spanY,
  }));

  return { vertices, indices, minimap };
}
