/**
 * Build a lit 3D Scalextric-style track mesh from TrackView nodes.
 * Physics Frenet frame stays authoritative — this only extrudes presentation geometry.
 */

import { KERB_KAPPA } from '../constants';
import type { TrackPalette } from '../materials';
import type { TrackView } from '../types';
import type { DisciplineId } from '../../data/disciplines';
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
const FINISH_ARCH_HEIGHT = 4.5;
const FINISH_ARCH_WIDTH_EXTRA = 3.0;
const FINISH_BANNER_HEIGHT = 1.2;

function buildLineBand(
  mb: MeshBuilder,
  track: TrackView,
  s: number,
  isSprintFinish = false,
): void {
  const center = sampleTrack(track, s);

  // Checkered line on the track surface (simplified - just 2 segments across)
  for (let i = 0; i < 2; i++) {
    const a0 = sampleTrack(track, s - 1.5 + (3 * i) / 2);
    const a1 = sampleTrack(track, s - 1.5 + (3 * (i + 1)) / 2);
    for (let j = 0; j < 12; j++) {
      const t0 = -1 + (2 * j) / 12;
      const t1 = -1 + (2 * (j + 1)) / 12;
      const w0 = (center.width / 2) * (1 - Math.abs(-1 + (2 * i) / 2) * 0.1);
      const w1 = (center.width / 2) * (1 - Math.abs(-1 + (2 * (i + 1)) / 2) * 0.1);
      const ax = a0.pos.x + a0.normal.x * t0 * w0;
      const ay = a0.pos.y + a0.normal.y * t0 * w0;
      const bx = a0.pos.x + a0.normal.x * t1 * w0;
      const by = a0.pos.y + a0.normal.y * t1 * w0;
      const cx = a1.pos.x + a1.normal.x * t1 * w1;
      const cy = a1.pos.y + a1.normal.y * t1 * w1;
      const dx = a1.pos.x + a1.normal.x * t0 * w1;
      const dy = a1.pos.y + a1.normal.y * t0 * w1;
      mb.addFace(
        ax, 0.05, -ay,
        bx, 0.05, -by,
        cx, 0.05, -cy,
        dx, 0.05, -dy,
        0, 1, 0,
        0.93, 0.93, 0.88,
        MAT_GENERIC,
      );
    }
  }

  if (isSprintFinish) {
    const archWidth = center.width / 2 + FINISH_ARCH_WIDTH_EXTRA;
    
    // Arch posts (vertical supports)
    const postWidth = 0.4;
    const postDepth = 0.6;
    for (const side of [-1, 1] as const) {
      const px = center.pos.x + side * center.normal.x * archWidth;
      
      // Post base
      mb.addFace(
        px - postWidth/2, 0, -center.normal.y * archWidth - postDepth/2,
        px + postWidth/2, 0, -center.normal.y * archWidth - postDepth/2,
        px + postWidth/2, FINISH_ARCH_HEIGHT, -center.normal.y * archWidth - postDepth/2,
        px - postWidth/2, FINISH_ARCH_HEIGHT, -center.normal.y * archWidth - postDepth/2,
        side * center.normal.x, 0, side * center.normal.y,
        0.18, 0.18, 0.2,
        MAT_CONCRETE,
      );
      // Post top cap
      mb.addFace(
        px - postWidth/2, FINISH_ARCH_HEIGHT, -center.normal.y * archWidth - postDepth/2,
        px + postWidth/2, FINISH_ARCH_HEIGHT, -center.normal.y * archWidth - postDepth/2,
        px + postWidth/2, FINISH_ARCH_HEIGHT, -center.normal.y * archWidth + postDepth/2,
        px - postWidth/2, FINISH_ARCH_HEIGHT, -center.normal.y * archWidth + postDepth/2,
        0, 1, 0,
        0.12, 0.12, 0.14,
        MAT_CONCRETE,
      );
    }
    
    // Arch crossbeam
    const beamY = FINISH_ARCH_HEIGHT;
    const beamHeight = 0.5;
    const beamDepth = 1.0;
    
    mb.addFace(
      center.pos.x - center.normal.x * archWidth, beamY, -center.normal.y * archWidth - beamDepth/2,
      center.pos.x + center.normal.x * archWidth, beamY, -center.normal.y * archWidth - beamDepth/2,
      center.pos.x + center.normal.x * archWidth, beamY + beamHeight, -center.normal.y * archWidth - beamDepth/2,
      center.pos.x - center.normal.x * archWidth, beamY + beamHeight, -center.normal.y * archWidth - beamDepth/2,
      -center.normal.x, 0, -center.normal.y,
      0.15, 0.15, 0.18,
      MAT_CONCRETE,
    );
    
    // Finish banner on the arch
    const bannerY = FINISH_ARCH_HEIGHT + 0.3;
    const bannerHeight = FINISH_BANNER_HEIGHT;
    const bannerDepth = 0.15;
    for (let j = 0; j < 12; j++) {
      const c = j % 2 === 0 ? [0.93, 0.93, 0.88] : [0.13, 0.13, 0.14];
      const t0 = -1 + (2 * j) / 12;
      const t1 = -1 + (2 * (j + 1)) / 12;
      const bannerWidth = center.width + 4;
      const bx0 = center.pos.x + center.normal.x * t0 * bannerWidth/2;
      const bz0 = -center.pos.y + center.normal.y * t0 * bannerWidth/2;
      const bx1 = center.pos.x + center.normal.x * t1 * bannerWidth/2;
      const bz1 = -center.pos.y + center.normal.y * t1 * bannerWidth/2;
      
      mb.addFace(
        bx0, bannerY, -bz0 + bannerDepth/2,
        bx1, bannerY, -bz1 + bannerDepth/2,
        bx1, bannerY + bannerHeight, -bz1 + bannerDepth/2,
        bx0, bannerY + bannerHeight, -bz0 + bannerDepth/2,
        0, 1, 0,
        c[0], c[1], c[2],
        MAT_GENERIC,
      );
    }
    
    // "FINISH" text placeholder - vertical stripes on banner
    const textY = FINISH_ARCH_HEIGHT + 0.5;
    for (let k = 0; k < 6; k++) {
      const t0 = -1 + (2 * k) / 6;
      const t1 = -1 + (2 * (k + 1)) / 6;
      const c = k % 2 === 0 ? [0.13, 0.13, 0.14] : [0.93, 0.93, 0.88];
      const bannerWidth = center.width + 4;
      const bx0 = center.pos.x + center.normal.x * t0 * bannerWidth/2;
      const bz0 = -center.pos.y + center.normal.y * t0 * bannerWidth/2;
      const bx1 = center.pos.x + center.normal.x * t1 * bannerWidth/2;
      const bz1 = -center.pos.y + center.normal.y * t1 * bannerWidth/2;
      
      mb.addFace(
        bx0, textY, -bz0 + bannerDepth/2,
        bx1, textY, -bz1 + bannerDepth/2,
        bx1, textY + 0.4, -bz1 + bannerDepth/2,
        bx0, textY + 0.4, -bz0 + bannerDepth/2,
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
  /** World extent the minimap is normalized to (the RACED ribbon only — the
   *  full loop for circuits, the point-to-point trip for sprints). */
  minimapExtent: { minX: number; maxX: number; minY: number; maxY: number };
}

interface RibbonSample {
  x: number;
  z: number;
  tx: number;
  tz: number;
  nx: number;
  nz: number;
  halfW: number;
  runoff: number;
  kappa: number;
}

/**
 * Sample the ribbon between two arc positions (open polyline, inclusive of both
 * ends). A circuit samples 0 → length (which closes on itself because s=0 ≡
 * s=length); a sprint samples only the raced portion and stays OPEN — a sprint
 * is point-to-point, never a loop.
 */
function sampleTrackRibbon(
  track: TrackView,
  fromS: number,
  toS: number,
  segments: number,
): RibbonSample[] {
  const nodes = track.nodes;
  const n = nodes.length;
  const length = track.length;
  const out: RibbonSample[] = [];
  const span = toS - fromS;

  for (let i = 0; i <= segments; i++) {
    const sQuery = fromS + (i / segments) * span;
    let lo = 0;
    while (lo < n - 1 && nodes[lo + 1]!.s <= sQuery) lo++;
    const a = nodes[lo]!;
    const b = nodes[(lo + 1) % n]!;
    const segSpan = lo === n - 1 ? Math.max(1e-6, length - a.s) : Math.max(1e-6, b.s - a.s);
    const t = Math.max(0, Math.min(1, (sQuery - a.s) / segSpan));
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
  return out;
}

function placeBox(
  mb: MeshBuilder,
  cx: number,
  cy: number,
  cz: number,
  hx: number,
  hy: number,
  hz: number,
  r: number,
  g: number,
  b: number,
  mat = MAT_GENERIC,
): void {
  const x0 = cx - hx;
  const x1 = cx + hx;
  const y0 = cy - hy;
  const y1 = cy + hy;
  const z0 = cz - hz;
  const z1 = cz + hz;
  const dark = 0.62;
  const mid = 0.82;
  mb.addFace(x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1, 0, -1, 0, r * dark, g * dark, b * dark, mat);
  mb.addFace(x0, y1, z1, x1, y1, z1, x1, y1, z0, x0, y1, z0, 0, 1, 0, r, g, b, mat);
  mb.addFace(x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1, 0, 0, 1, r * mid, g * mid, b * mid, mat);
  mb.addFace(x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0, 0, 0, -1, r * 0.74, g * 0.74, b * 0.74, mat);
  mb.addFace(x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0, -1, 0, 0, r * 0.7, g * 0.7, b * 0.7, mat);
  mb.addFace(x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y1, z1, 1, 0, 0, r * 0.92, g * 0.92, b * 0.92, mat);
}

/** Axis-aligned in world XZ but oriented with a 2D heading (tx, tz). */
function placeOrientedBox(
  mb: MeshBuilder,
  cx: number,
  cy: number,
  cz: number,
  halfAlong: number,
  hy: number,
  halfAcross: number,
  tx: number,
  tz: number,
  r: number,
  g: number,
  b: number,
  mat = MAT_GENERIC,
): void {
  const len = Math.hypot(tx, tz) || 1;
  const fx = tx / len;
  const fz = tz / len;
  const rx = -fz;
  const rz = fx;
  const y0 = cy - hy;
  const y1 = cy + hy;
  const corners: Array<[number, number]> = [
    [cx - fx * halfAlong - rx * halfAcross, cz - fz * halfAlong - rz * halfAcross],
    [cx + fx * halfAlong - rx * halfAcross, cz + fz * halfAlong - rz * halfAcross],
    [cx + fx * halfAlong + rx * halfAcross, cz + fz * halfAlong + rz * halfAcross],
    [cx - fx * halfAlong + rx * halfAcross, cz - fz * halfAlong + rz * halfAcross],
  ];
  const c0 = corners[0]!;
  const c1 = corners[1]!;
  const c2 = corners[2]!;
  const c3 = corners[3]!;
  const dark = 0.62;
  const mid = 0.82;
  mb.addFace(c0[0], y0, c0[1], c1[0], y0, c1[1], c2[0], y0, c2[1], c3[0], y0, c3[1], 0, -1, 0, r * dark, g * dark, b * dark, mat);
  mb.addFace(c3[0], y1, c3[1], c2[0], y1, c2[1], c1[0], y1, c1[1], c0[0], y1, c0[1], 0, 1, 0, r, g, b, mat);
  mb.addFace(c0[0], y0, c0[1], c3[0], y0, c3[1], c3[0], y1, c3[1], c0[0], y1, c0[1], -rx, 0, -rz, r * mid, g * mid, b * mid, mat);
  mb.addFace(c1[0], y0, c1[1], c2[0], y0, c2[1], c2[0], y1, c2[1], c1[0], y1, c1[1], rx, 0, rz, r * 0.9, g * 0.9, b * 0.9, mat);
  mb.addFace(c0[0], y0, c0[1], c1[0], y0, c1[1], c1[0], y1, c1[1], c0[0], y1, c0[1], -fx, 0, -fz, r * 0.74, g * 0.74, b * 0.74, mat);
  mb.addFace(c3[0], y0, c3[1], c2[0], y0, c2[1], c2[0], y1, c2[1], c3[0], y1, c3[1], fx, 0, fz, r * 0.85, g * 0.85, b * 0.85, mat);
}

function scatterBush(mb: MeshBuilder, x: number, z: number, size: number, r: number, g: number, b: number): void {
  placeBox(mb, x, size * 0.5 - 0.04, z, size * 0.72, size * 0.5, size * 0.72, r, g, b);
  placeBox(mb, x + size * 0.3, size * 0.36 - 0.04, z - size * 0.22, size * 0.45, size * 0.36, size * 0.45, r * 0.8, g * 0.82, b * 0.78);
}

function scatterTree(mb: MeshBuilder, x: number, z: number, size: number, r: number, g: number, b: number): void {
  placeBox(mb, x, size * 0.55 - 0.04, z, size * 0.16, size * 0.55, size * 0.16, 0.34, 0.23, 0.14);
  placeBox(mb, x, size * 1.25 - 0.04, z, size * 0.62, size * 0.38, size * 0.62, r, g, b);
  placeBox(mb, x, size * 1.85 - 0.04, z, size * 0.48, size * 0.32, size * 0.48, r * 1.06, g * 1.08, b * 1.02);
  placeBox(mb, x, size * 2.35 - 0.04, z, size * 0.3, size * 0.26, size * 0.3, r * 1.12, g * 1.14, b * 1.05);
}

function scatterRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Clearance = { x: number; z: number; minR: number };

function buildClearance(raced: readonly RibbonSample[]): Clearance[] {
  const clearance: Clearance[] = [];
  for (const s of raced) {
    clearance.push({ x: s.x, z: s.z, minR: s.halfW + s.runoff + 7 });
  }
  return clearance;
}

function clearOfRibbon(x: number, z: number, clearance: readonly Clearance[], minRBoost = 0): boolean {
  for (const c of clearance) {
    const r = c.minR + minRBoost;
    const dx = x - c.x;
    const dz = z - c.z;
    if (dx * dx + dz * dz < r * r) return false;
  }
  return true;
}

function placeWaterQuad(
  mb: MeshBuilder,
  cx: number,
  cz: number,
  hx: number,
  hz: number,
  r: number,
  g: number,
  b: number,
): void {
  mb.addFace(
    cx - hx,
    -0.02,
    cz - hz,
    cx + hx,
    -0.02,
    cz - hz,
    cx + hx,
    -0.02,
    cz + hz,
    cx - hx,
    -0.02,
    cz + hz,
    0,
    1,
    0,
    r,
    g,
    b,
    MAT_GENERIC,
  );
}

/** Low grandstand parallel to a straight — Track circuits. */
function placeGrandstand(
  mb: MeshBuilder,
  s: RibbonSample,
  side: 1 | -1,
  length: number,
): void {
  const out = s.halfW + s.runoff + 14;
  const cx = s.x + side * s.nx * out;
  const cz = s.z + side * s.nz * out;
  const baseH = 1.4;
  const roofH = 3.6;
  // Concrete base
  placeOrientedBox(mb, cx, baseH * 0.5, cz, length * 0.5, baseH * 0.5, 4.2, s.tx, s.tz, 0.55, 0.54, 0.5, MAT_CONCRETE);
  // Seating terrace (crowd tint)
  placeOrientedBox(mb, cx + side * s.nx * 0.6, baseH + 0.55, cz, length * 0.46, 0.55, 3.2, s.tx, s.tz, 0.55, 0.18, 0.16);
  placeOrientedBox(mb, cx + side * s.nx * 1.4, baseH + 1.15, cz, length * 0.42, 0.5, 2.6, s.tx, s.tz, 0.2, 0.28, 0.55);
  // Roof slab
  placeOrientedBox(mb, cx + side * s.nx * 0.4, roofH, cz, length * 0.5, 0.18, 5.0, s.tx, s.tz, 0.72, 0.72, 0.7, MAT_CONCRETE);
  // Support posts
  for (const t of [-0.38, 0, 0.38] as const) {
    const px = cx + s.tx * length * t;
    const pz = cz + s.tz * length * t;
    placeBox(mb, px, roofH * 0.5, pz, 0.22, roofH * 0.5, 0.22, 0.45, 0.45, 0.42, MAT_CONCRETE);
  }
}

/** City block building for Street. */
function placeBuilding(
  mb: MeshBuilder,
  x: number,
  z: number,
  footprint: number,
  height: number,
  shade: number,
): void {
  const warm = 0.55 + shade * 0.2;
  const cool = 0.48 + shade * 0.15;
  placeBox(mb, x, height * 0.5, z, footprint * 0.5, height * 0.5, footprint * 0.5, warm, cool * 0.95, cool * 0.88);
  // Flat roof
  placeBox(mb, x, height + 0.12, z, footprint * 0.52, 0.12, footprint * 0.52, 0.35, 0.36, 0.38, MAT_CONCRETE);
  // Window strip suggestion
  if (height > 6) {
    placeBox(mb, x, height * 0.55, z + footprint * 0.48, footprint * 0.38, height * 0.28, 0.08, 0.35, 0.55, 0.7);
  }
}

/** Cosmetic bridge over a straight — Rally rivers. */
function placeBridge(mb: MeshBuilder, s: RibbonSample): void {
  const span = s.halfW + s.runoff + 6;
  const deckY = 4.2;
  const deckThick = 0.35;
  // Deck across the ribbon
  placeOrientedBox(
    mb,
    s.x,
    deckY,
    s.z,
    3.2,
    deckThick * 0.5,
    span,
    s.tx,
    s.tz,
    0.42,
    0.4,
    0.36,
    MAT_CONCRETE,
  );
  // Side rails
  for (const side of [1, -1] as const) {
    const rx = s.x + side * s.nx * (span * 0.92);
    const rz = s.z + side * s.nz * (span * 0.92);
    placeOrientedBox(mb, rx, deckY + 0.55, rz, 3.0, 0.45, 0.22, s.tx, s.tz, 0.55, 0.55, 0.5, MAT_CONCRETE);
  }
  // Piers outside the racing surface
  for (const side of [1, -1] as const) {
    const px = s.x + side * s.nx * (s.halfW + s.runoff + 2.5);
    const pz = s.z + side * s.nz * (s.halfW + s.runoff + 2.5);
    placeBox(mb, px, deckY * 0.5, pz, 1.1, deckY * 0.5, 1.1, 0.4, 0.38, 0.34, MAT_CONCRETE);
  }
}

/**
 * Discipline diorama dressing — trees, stands, city blocks, water. Pure
 * presentation; never within clearance of the ribbon/stubs.
 */
function scatterScenery(
  mb: MeshBuilder,
  track: TrackView,
  raced: readonly RibbonSample[],
  discipline: DisciplineId,
): void {
  const b = track.bounds;
  const seed =
    (Math.abs(Math.round(b.minX * 97.3 + b.minY * 41.7 + b.maxX * 13.1 + b.maxY * 61.9)) ^
      (discipline === 'street' ? 0x51e : discipline === 'rally' ? 0xa17 : 0x7c3)) >>>
    0;
  const rng = scatterRng(seed);
  const margin = discipline === 'street' ? 220 : 200;
  const x0 = b.minX - margin;
  const x1 = b.maxX + margin;
  const y0 = b.minY - margin;
  const y1 = b.maxY + margin;
  const clearance = buildClearance(raced);

  if (discipline === 'track') {
    // Grandstands on long straights
    let lastStandS = -999;
    for (let i = 8; i < raced.length - 8; i += 6) {
      const s = raced[i]!;
      if (s.kappa > 0.006) continue;
      const arc = i * 2; // rough spacing proxy
      if (arc - lastStandS < 55) continue;
      const side: 1 | -1 = rng() < 0.5 ? 1 : -1;
      placeGrandstand(mb, s, side, 18 + rng() * 14);
      lastStandS = arc;
    }
    // Sparse park trees beyond the circuit
    let placed = 0;
    for (let attempt = 0; attempt < 4000 && placed < 70; attempt++) {
      const x = x0 + rng() * (x1 - x0);
      const z = -(y0 + rng() * (y1 - y0));
      if (!clearOfRibbon(x, z, clearance, 10)) continue;
      const size = 1.1 + rng() * 1.5;
      const shade = 0.75 + rng() * 0.25;
      if (rng() < 0.45) {
        scatterBush(mb, x, z, size * 0.75, 0.14 * shade, 0.38 * shade, 0.12 * shade);
      } else {
        scatterTree(mb, x, z, size * 0.65, 0.12 * shade, 0.36 * shade, 0.1 * shade);
      }
      placed++;
    }
    return;
  }

  if (discipline === 'street') {
    // City blocks / buildings on a coarse grid, skipping the ribbon corridor.
    const cell = 22;
    for (let gx = x0; gx < x1; gx += cell) {
      for (let gy = y0; gy < y1; gy += cell) {
        const jx = gx + (rng() - 0.5) * 6;
        const jz = -(gy + (rng() - 0.5) * 6);
        if (!clearOfRibbon(jx, jz, clearance, 14)) continue;
        if (rng() < 0.22) continue; // leave some empty lots / streets
        const footprint = 8 + rng() * 12;
        const height = 5 + rng() * rng() * 28;
        placeBuilding(mb, jx, jz, footprint, height, rng());
      }
    }
    return;
  }

  // Rally — denser woods, lakes, and sometimes a river + bridge.
  let trees = 0;
  const treeTarget = 220;
  for (let attempt = 0; attempt < 9000 && trees < treeTarget; attempt++) {
    const x = x0 + rng() * (x1 - x0);
    const z = -(y0 + rng() * (y1 - y0));
    if (!clearOfRibbon(x, z, clearance, 4)) continue;
    const size = 1.2 + rng() * 2.2;
    const shade = 0.7 + rng() * 0.3;
    const r = 0.1 * shade + rng() * 0.04;
    const g = 0.32 * shade + rng() * 0.14;
    const bl = 0.08 * shade + rng() * 0.04;
    if (rng() < 0.35) scatterBush(mb, x, z, size * 0.85, r, g, bl);
    else scatterTree(mb, x, z, size * 0.8, r, g, bl);
    trees++;
  }

  // One or two lakes away from the ribbon.
  const lakeCount = 1 + (rng() < 0.55 ? 1 : 0);
  for (let i = 0; i < lakeCount; i++) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const x = x0 + 40 + rng() * Math.max(20, x1 - x0 - 80);
      const z = -(y0 + 40 + rng() * Math.max(20, y1 - y0 - 80));
      if (!clearOfRibbon(x, z, clearance, 28)) continue;
      const hx = 18 + rng() * 28;
      const hz = 12 + rng() * 22;
      placeWaterQuad(mb, x, z, hx, hz, 0.18, 0.38, 0.48);
      // Reed bushes on the shore
      for (let k = 0; k < 6; k++) {
        const ang = (k / 6) * Math.PI * 2;
        scatterBush(
          mb,
          x + Math.cos(ang) * hx * 0.95,
          z + Math.sin(ang) * hz * 0.95,
          0.9 + rng() * 0.5,
          0.2,
          0.4,
          0.16,
        );
      }
      break;
    }
  }

  // River crossing a mid-length straight + bridge over the road.
  const mid = Math.floor(raced.length * (0.35 + rng() * 0.3));
  let bridgeAt: RibbonSample | null = null;
  for (let i = mid; i < Math.min(raced.length - 4, mid + 40); i++) {
    const s = raced[i]!;
    if (s.kappa < 0.004) {
      bridgeAt = s;
      break;
    }
  }
  if (bridgeAt) {
    const along = bridgeAt.nx;
    const across = bridgeAt.nz;
    // River band roughly perpendicular to the road, under the deck height.
    const riverLen = 90;
    const riverHalf = 7;
    placeOrientedBox(
      mb,
      bridgeAt.x + along * (bridgeAt.halfW + bridgeAt.runoff + 8),
      -0.03,
      bridgeAt.z + across * (bridgeAt.halfW + bridgeAt.runoff + 8),
      riverLen * 0.5,
      0.02,
      riverHalf,
      -bridgeAt.nz,
      bridgeAt.nx,
      0.16,
      0.36,
      0.46,
    );
    placeOrientedBox(
      mb,
      bridgeAt.x - along * (bridgeAt.halfW + bridgeAt.runoff + 8),
      -0.03,
      bridgeAt.z - across * (bridgeAt.halfW + bridgeAt.runoff + 8),
      riverLen * 0.5,
      0.02,
      riverHalf,
      -bridgeAt.nz,
      bridgeAt.nx,
      0.16,
      0.36,
      0.46,
    );
    // Water under the road corridor (cars fly over visually via bridge deck;
    // physics ignores this mesh).
    placeOrientedBox(
      mb,
      bridgeAt.x,
      -0.05,
      bridgeAt.z,
      4,
      0.02,
      bridgeAt.halfW + bridgeAt.runoff + 2,
      bridgeAt.tx,
      bridgeAt.tz,
      0.15,
      0.34,
      0.44,
    );
    placeBridge(mb, bridgeAt);
  }
}

// Brighter mesh bases (shader fuzz owns detail; these help fallback tinting).
const TARMAC_BASE = [0.4, 0.4, 0.42] as const;
const DIRT_BASE = [0.7, 0.58, 0.38] as const;
const GRASS_BASE = [0.35, 0.62, 0.28] as const;
const PAVEMENT_BASE = [0.48, 0.48, 0.46] as const;
const GROOVE_BASE = [0.25, 0.25, 0.26] as const;

const GROOVE_HALF = 0.55;
const GRASS_EXTRA = 22;

/** Roll-out past a sprint's finish line so its banner sits fully on tarmac. */
const SPRINT_ROLLOUT = 8;
/** Fake-road stub length (m) — long enough to leave the pulled-back camera. */
const STUB_LENGTH = 720;
const STUB_STEP = 8;

/**
 * Extrude the full road cross-section (grass verge → dirt runoff → tarmac →
 * recessed groove) along an OPEN ribbon of samples. Circuits pass a closed
 * ribbon (first == last); sprints pass an open one, plus fake-road stubs.
 */
function buildRoadBands(mb: MeshBuilder, samples: readonly RibbonSample[]): void {
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
      x: s.x + s.nx * GROOVE_HALF,
      y: -0.045,
      z: s.z + s.nz * GROOVE_HALF,
    });
    rightGroove.push({
      x: s.x - s.nx * GROOVE_HALF,
      y: -0.045,
      z: s.z - s.nz * GROOVE_HALF,
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
      x: s.x + s.nx * (s.halfW + dirtW + GRASS_EXTRA),
      y: -0.04,
      z: s.z + s.nz * (s.halfW + dirtW + GRASS_EXTRA),
    });
    rightGrassOuter.push({
      x: s.x - s.nx * (s.halfW + dirtW + GRASS_EXTRA),
      y: -0.04,
      z: s.z - s.nz * (s.halfW + dirtW + GRASS_EXTRA),
    });
  }

  // Grass verges beyond dirt
  mb.ribbon(
    leftGrassOuter,
    leftDirtOuter,
    0,
    GRASS_BASE[0],
    GRASS_BASE[1],
    GRASS_BASE[2],
    MAT_GRASS,
  );
  mb.ribbon(
    rightDirtOuter,
    rightGrassOuter,
    0,
    GRASS_BASE[0],
    GRASS_BASE[1],
    GRASS_BASE[2],
    MAT_GRASS,
  );

  // Dirt / gravel runoff
  mb.ribbon(
    leftDirtOuter,
    leftDirtInner,
    0,
    DIRT_BASE[0],
    DIRT_BASE[1],
    DIRT_BASE[2],
    MAT_DIRT,
  );
  mb.ribbon(
    rightDirtInner,
    rightDirtOuter,
    0,
    DIRT_BASE[0],
    DIRT_BASE[1],
    DIRT_BASE[2],
    MAT_DIRT,
  );

  // Tarmac decks
  mb.ribbon(
    leftAsphalt,
    leftGroove,
    0,
    TARMAC_BASE[0],
    TARMAC_BASE[1],
    TARMAC_BASE[2],
    MAT_TARMAC,
  );
  mb.ribbon(
    rightGroove,
    rightAsphalt,
    0,
    TARMAC_BASE[0],
    TARMAC_BASE[1],
    TARMAC_BASE[2],
    MAT_TARMAC,
  );

  // Recessed groove
  mb.ribbon(
    leftGroove,
    rightGroove,
    0,
    GROOVE_BASE[0],
    GROOVE_BASE[1],
    GROOVE_BASE[2],
    MAT_GROOVE,
  );
}

/**
 * A synthetic, gently winding road continuation for a sprint's start (dir -1,
 * running backward out of the start line) or finish (dir +1, running forward
 * from the finish). Presentation only — it never enters physics, the minimap,
 * kerbs, barriers, or line bands. It is deliberately NOT the mother loop's
 * geometry: a sprint is point-to-point, and this only makes the raced section
 * look like a stretch of a longer road that runs off into the fog.
 */
function buildRoadStub(
  anchor: RibbonSample,
  dir: 1 | -1,
  track: TrackView,
): RibbonSample[] {
  const steps = Math.max(20, Math.round(STUB_LENGTH / STUB_STEP));
  const seed =
    ((Math.round(track.bounds.minX * 13.7 + track.bounds.minY * 29.3) >>> 0) ^ 0x5a17c9e3) >>> 0;
  const rng = scatterRng(seed);
  const out: RibbonSample[] = [];
  let x = anchor.x;
  let z = anchor.z;
  // Forward tangent heading in engine XZ. The road normal is the tangent
  // rotated -90°: (sin φ, -cos φ) — matching the track sampler's convention, so
  // the stub's edges line up with the raced ribbon at the junction.
  let phi = Math.atan2(anchor.tz, anchor.tx);
  let bend = 0;
  const { halfW, runoff } = anchor;

  for (let i = 0; i <= steps; i++) {
    out.push({
      x,
      z,
      tx: Math.cos(phi),
      tz: Math.sin(phi),
      nx: Math.sin(phi),
      nz: -Math.cos(phi),
      halfW,
      runoff,
      kappa: 0,
    });
    x += dir * Math.cos(phi) * STUB_STEP;
    z += dir * Math.sin(phi) * STUB_STEP;
    // Gentle, mean-reverting wander — the road drifts naturally but never
    // doubles back on itself.
    bend = (bend + (rng() - 0.5) * 0.012) * 0.97;
    phi += bend;
  }
  return out;
}

export function buildTrackGeometry(
  track: TrackView,
  _palette: TrackPalette,
  discipline: DisciplineId = 'track',
): BuiltTrackMesh {
  void _palette;
  const mb = new MeshBuilder();

  const isSprint = track.sprintFinishS !== undefined;
  const segCount = Math.max(120, track.nodes.length * 2);
  // Raced ribbon: the full loop for circuits, or the point-to-point trip
  // (open) for sprints.
  const racedEnd = isSprint ? track.sprintFinishS! + SPRINT_ROLLOUT : track.length;
  const raced = sampleTrackRibbon(track, 0, racedEnd, segCount);

  // Cosmetic stubs so a sprint's road continues past start/finish until it
  // leaves the camera. Circuits already have the full loop behind the grid —
  // a stub there would double-draw the ribbon.
  const stubBefore = isSprint ? buildRoadStub(raced[0]!, -1, track) : null;
  const stubAfter = isSprint ? buildRoadStub(raced[raced.length - 1]!, 1, track) : null;

  if (stubBefore) buildRoadBands(mb, stubBefore);
  buildRoadBands(mb, raced);
  if (stubAfter) buildRoadBands(mb, stubAfter);

  const concreteBase = [0.65, 0.64, 0.6] as const;

  // Red/white rumble strips on corners + muted concrete barriers — raced ribbon
  // only (fake stubs carry no kerbs or walls).
  for (let i = 0; i < raced.length - 1; i++) {
    const s0 = raced[i]!;
    const s1 = raced[i + 1]!;
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

  // Far ground plate — sized for the pulled-back tabletop camera so the
  // frustum never falls into clear-color void.
  const b = track.bounds;
  const span = Math.max(b.maxX - b.minX, b.maxY - b.minY, 80);
  const pad = Math.max(2200, span * 14);
  const minX = b.minX - pad;
  const maxX = b.maxX + pad;
  const minZ = -(b.maxY + pad);
  const maxZ = -(b.minY - pad);
  const ground =
    discipline === 'street'
      ? ([PAVEMENT_BASE[0], PAVEMENT_BASE[1], PAVEMENT_BASE[2], MAT_CONCRETE] as const)
      : ([GRASS_BASE[0], GRASS_BASE[1], GRASS_BASE[2], MAT_GRASS] as const);
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
    ground[0],
    ground[1],
    ground[2],
    ground[3],
  );

  const clearanceRibbon = stubBefore
    ? [...raced, ...stubBefore, ...(stubAfter ?? [])]
    : raced;
  scatterScenery(mb, track, clearanceRibbon, discipline);

  // Start line (s=0) always; a sprint also banners its finish wherever it
  // lands on the loop. Circuits share one line (start == finish).
  buildLineBand(mb, track, 0, false);
  if (isSprint) {
    buildLineBand(mb, track, track.sprintFinishS!, true);
  }

  const { vertices, indices } = mb.build();

  // Minimap normalizes to the RACED ribbon only — the loop for circuits, the
  // point-to-point trip for sprints (fake stubs are never drawn on the map).
  let mmMinX = Infinity;
  let mmMaxX = -Infinity;
  let mmMinY = Infinity;
  let mmMaxY = -Infinity;
  for (const s of raced) {
    mmMinX = Math.min(mmMinX, s.x);
    mmMaxX = Math.max(mmMaxX, s.x);
    mmMinY = Math.min(mmMinY, -s.z);
    mmMaxY = Math.max(mmMaxY, -s.z);
  }
  const spanX = Math.max(mmMaxX - mmMinX, 1);
  const spanY = Math.max(mmMaxY - mmMinY, 1);
  const mmSamples = isSprint ? raced : raced.slice(0, -1);
  const minimap = mmSamples.map((s) => ({
    nx: (s.x - mmMinX) / spanX,
    ny: 1 - (-s.z - mmMinY) / spanY,
  }));

  return {
    vertices,
    indices,
    minimap,
    minimapExtent: { minX: mmMinX, maxX: mmMaxX, minY: mmMinY, maxY: mmMaxY },
  };
}
