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
): void {
  const x0 = cx - hx;
  const x1 = cx + hx;
  const y0 = cy - hy;
  const y1 = cy + hy;
  const z0 = cz - hz;
  const z1 = cz + hz;
  const dark = 0.62;
  const mid = 0.82;
  mb.addFace(x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1, 0, -1, 0, r * dark, g * dark, b * dark, MAT_GENERIC);
  mb.addFace(x0, y1, z1, x1, y1, z1, x1, y1, z0, x0, y1, z0, 0, 1, 0, r, g, b, MAT_GENERIC);
  mb.addFace(x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1, 0, 0, 1, r * mid, g * mid, b * mid, MAT_GENERIC);
  mb.addFace(x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0, 0, 0, -1, r * 0.74, g * 0.74, b * 0.74, MAT_GENERIC);
  mb.addFace(x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0, -1, 0, 0, r * 0.7, g * 0.7, b * 0.7, MAT_GENERIC);
  mb.addFace(x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y1, z1, 1, 0, 0, r * 0.92, g * 0.92, b * 0.92, MAT_GENERIC);
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

/**
 * Toy trees and bushes scattered over the grass around the track — pure
 * tabletop-diorama dressing. Deterministic per track; never within clearance
 * of the ribbon, so nothing overlaps the racing surface or the barriers.
 */
function scatterScenery(
  mb: MeshBuilder,
  track: TrackView,
  raced: readonly RibbonSample[],
): void {
  const b = track.bounds;
  const seed = Math.abs(Math.round(b.minX * 97.3 + b.minY * 41.7 + b.maxX * 13.1 + b.maxY * 61.9)) >>> 0;
  const rng = scatterRng(seed);
  // Scatter region: the track locus plus a generous margin of quiet grass.
  const margin = 160;
  const x0 = b.minX - margin;
  const x1 = b.maxX + margin;
  const y0 = b.minY - margin;
  const y1 = b.maxY + margin;
  const clearance: Array<{ x: number; z: number; minR: number }> = [];
  for (const s of raced) {
    clearance.push({ x: s.x, z: s.z, minR: s.halfW + s.runoff + 7 });
  }

  const target = 120;
  let placed = 0;
  for (let attempt = 0; attempt < 6000 && placed < target; attempt++) {
    const x = x0 + rng() * (x1 - x0);
    const z = -(y0 + rng() * (y1 - y0));
    let ok = true;
    for (const c of clearance) {
      const dx = x - c.x;
      const dz = z - c.z;
      if (dx * dx + dz * dz < c.minR * c.minR) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    const size = 1.0 + rng() * 1.6;
    const shade = 0.75 + rng() * 0.25;
    const r = 0.12 * shade + rng() * 0.05;
    const g = 0.34 * shade + rng() * 0.12;
    const bl = 0.1 * shade + rng() * 0.05;
    if (rng() < 0.55) {
      scatterBush(mb, x, z, size * 0.8, r, g, bl);
    } else {
      scatterTree(mb, x, z, size * 0.7, r, g, bl);
    }
    placed++;
  }
}
// Brighter mesh bases (shader fuzz owns detail; these help fallback tinting).
const TARMAC_BASE = [0.4, 0.4, 0.42] as const;
const DIRT_BASE = [0.7, 0.58, 0.38] as const;
const GRASS_BASE = [0.35, 0.62, 0.28] as const;
const GROOVE_BASE = [0.25, 0.25, 0.26] as const;

const GROOVE_HALF = 0.55;
const GRASS_EXTRA = 18;

/** Roll-out past a sprint's finish line so its banner sits fully on tarmac. */
const SPRINT_ROLLOUT = 8;
/** Fake-road stub length (m) and sample spacing — long enough to vanish in fog. */
const STUB_LENGTH = 240;
const STUB_STEP = 6;

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

export function buildTrackGeometry(track: TrackView, _palette: TrackPalette): BuiltTrackMesh {
  void _palette;
  const mb = new MeshBuilder();

  const isSprint = track.sprintFinishS !== undefined;
  const segCount = Math.max(120, track.nodes.length * 2);
  // Raced ribbon: the full loop for circuits, or the point-to-point trip
  // (open) for sprints.
  const racedEnd = isSprint ? track.sprintFinishS! + SPRINT_ROLLOUT : track.length;
  const raced = sampleTrackRibbon(track, 0, racedEnd, segCount);

  // Fake-road stubs so the sprint reads as part of a longer road, not a road
  // that stops dead at the start/finish banners.
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

  // Far grass ground plate — covers the WHOLE background, far beyond the
  // track locus, so the tabletop reads as sitting on grass to the horizon
  // (no clear-colour seams anywhere the camera can reach).
  const b = track.bounds;
  const span = Math.max(b.maxX - b.minX, b.maxY - b.minY);
  const pad = Math.max(36, span * 4);
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
    GRASS_BASE[0],
    GRASS_BASE[1],
    GRASS_BASE[2],
    MAT_GRASS,
  );

  // Diorama dressing — toy trees/bushes around the grass, clear of the ribbon
  // AND the fake-road stubs.
  const clearance = stubBefore ? [...raced, ...stubBefore, ...(stubAfter ?? [])] : raced;
  scatterScenery(mb, track, clearance);

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
