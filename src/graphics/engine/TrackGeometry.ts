/**
 * Build a lit 3D Scalextric-style track mesh from TrackView nodes.
 * Physics Frenet frame stays authoritative — this only extrudes presentation geometry.
 */

import { KERB_KAPPA } from '../constants';
import type { TrackPalette } from '../materials';
import type { TrackView } from '../types';
import { MeshBuilder } from './MeshBuilder';
import { hexToRgb } from './math';

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
  const length = track.length;
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
      z: -y, // engine Z
      tx: tx / tlen,
      tz: -ty / tlen,
      nx: nx / nlen,
      nz: -ny / nlen,
      halfW,
      runoff,
      kappa,
    });
  }
  // Close ring by repeating first
  out.push(out[0]!);
  return out;
}

export function buildTrackGeometry(track: TrackView, palette: TrackPalette): BuiltTrackMesh {
  const mb = new MeshBuilder();
  const samples = sampleClosed(track, Math.max(96, track.nodes.length * 2));
  const asphalt = hexToRgb(palette.asphalt);
  const runoffC = hexToRgb(palette.runoff);
  const kerbA = hexToRgb(palette.kerbA);
  const kerbB = hexToRgb(palette.kerbB);
  const accent = hexToRgb(palette.accent);
  const rim = hexToRgb(palette.accentDim);

  const leftAsphalt: Array<{ x: number; y: number; z: number }> = [];
  const rightAsphalt: Array<{ x: number; y: number; z: number }> = [];
  const leftGroove: Array<{ x: number; y: number; z: number }> = [];
  const rightGroove: Array<{ x: number; y: number; z: number }> = [];
  const leftRun: Array<{ x: number; y: number; z: number }> = [];
  const rightRun: Array<{ x: number; y: number; z: number }> = [];

  const grooveHalf = 0.55;

  for (const s of samples) {
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
      y: -0.04,
      z: s.z + s.nz * grooveHalf,
    });
    rightGroove.push({
      x: s.x - s.nx * grooveHalf,
      y: -0.04,
      z: s.z - s.nz * grooveHalf,
    });
    leftRun.push({
      x: s.x + s.nx * (s.halfW + s.runoff),
      y: -0.01,
      z: s.z + s.nz * (s.halfW + s.runoff),
    });
    rightRun.push({
      x: s.x - s.nx * (s.halfW + s.runoff),
      y: -0.01,
      z: s.z - s.nz * (s.halfW + s.runoff),
    });
  }

  // Plate / runoff
  mb.ribbon(leftRun, leftAsphalt, 0, runoffC[0] * 0.85, runoffC[1] * 0.85, runoffC[2] * 0.85);
  mb.ribbon(rightAsphalt, rightRun, 0, runoffC[0] * 0.85, runoffC[1] * 0.85, runoffC[2] * 0.85);

  // Main asphalt decks (left of groove / right of groove)
  mb.ribbon(leftAsphalt, leftGroove, 0, asphalt[0], asphalt[1], asphalt[2]);
  mb.ribbon(rightGroove, rightAsphalt, 0, asphalt[0], asphalt[1], asphalt[2]);

  // Recessed Scalextric groove channel
  mb.ribbon(
    leftGroove,
    rightGroove,
    0,
    asphalt[0] * 0.35,
    asphalt[1] * 0.35,
    asphalt[2] * 0.38,
  );

  // Kerbs on high-kappa segments + barrier walls
  for (let i = 0; i < samples.length - 1; i++) {
    const s0 = samples[i]!;
    const s1 = samples[i + 1]!;
    if (s0.kappa >= KERB_KAPPA || s1.kappa >= KERB_KAPPA) {
      const stripe = i % 2 === 0 ? kerbA : kerbB;
      const kerbW = 0.55;
      // Outer kerb left
      const l0a = {
        x: s0.x + s0.nx * s0.halfW,
        y: 0.05,
        z: s0.z + s0.nz * s0.halfW,
      };
      const l0b = {
        x: s0.x + s0.nx * (s0.halfW + kerbW),
        y: 0.08,
        z: s0.z + s0.nz * (s0.halfW + kerbW),
      };
      const l1a = {
        x: s1.x + s1.nx * s1.halfW,
        y: 0.05,
        z: s1.z + s1.nz * s1.halfW,
      };
      const l1b = {
        x: s1.x + s1.nx * (s1.halfW + kerbW),
        y: 0.08,
        z: s1.z + s1.nz * (s1.halfW + kerbW),
      };
      mb.ribbon([l0b, l1b], [l0a, l1a], 0, stripe[0], stripe[1], stripe[2]);
    }

    // Barrier walls (thin upright quads)
    const wallH = 0.42;
    const wallT = 0.12;
    for (const side of [1, -1] as const) {
      const ox0 = s0.x + side * s0.nx * (s0.halfW + s0.runoff * 0.15);
      const oz0 = s0.z + side * s0.nz * (s0.halfW + s0.runoff * 0.15);
      const ox1 = s1.x + side * s1.nx * (s1.halfW + s1.runoff * 0.15);
      const oz1 = s1.z + side * s1.nz * (s1.halfW + s1.runoff * 0.15);
      const c = i % 3 === 0 ? accent : rim;
      mb.addFace(
        ox0,
        0.02,
        oz0,
        ox1,
        0.02,
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
        c[0] * 0.55,
        c[1] * 0.55,
        c[2] * 0.55,
      );
      void wallT;
    }
  }

  // Ground plate under circuit (bounds)
  const b = track.bounds;
  const pad = 18;
  const minX = b.minX - pad;
  const maxX = b.maxX + pad;
  const minZ = -(b.maxY + pad);
  const maxZ = -(b.minY - pad);
  const plate = hexToRgb('#0b0d0c');
  mb.addFace(
    minX,
    -0.2,
    minZ,
    maxX,
    -0.2,
    minZ,
    maxX,
    -0.2,
    maxZ,
    minX,
    -0.2,
    maxZ,
    0,
    1,
    0,
    plate[0],
    plate[1],
    plate[2],
  );

  const { vertices, indices } = mb.build();

  const spanX = Math.max(b.maxX - b.minX, 1);
  const spanY = Math.max(b.maxY - b.minY, 1);
  const minimap = samples.slice(0, -1).map((s) => ({
    nx: (s.x - b.minX) / spanX,
    ny: 1 - (-s.z - b.minY) / spanY,
  }));

  return { vertices, indices, minimap };
}
