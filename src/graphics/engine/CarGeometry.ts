/**
 * Slot-car mesh in meters. Forward = +X (matches CarPainter length axis + physics heading).
 * Boxes are placed with explicit centers — not piled at the origin.
 */

import { PHYSICS } from '../../data/physics';
import { MAT_GENERIC } from './materials';
import { MeshBuilder } from './MeshBuilder';

function boxAt(
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
  const y0 = cy;
  const y1 = cy + hy * 2;
  const z0 = cz - hz;
  const z1 = cz + hz;
  mb.addFace(x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1, 0, -1, 0, r * 0.55, g * 0.55, b * 0.55, MAT_GENERIC);
  mb.addFace(x0, y1, z1, x1, y1, z1, x1, y1, z0, x0, y1, z0, 0, 1, 0, r, g, b, MAT_GENERIC);
  mb.addFace(x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1, 0, 0, 1, r * 0.85, g * 0.85, b * 0.85, MAT_GENERIC);
  mb.addFace(x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0, 0, 0, -1, r * 0.75, g * 0.75, b * 0.75, MAT_GENERIC);
  mb.addFace(x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0, -1, 0, 0, r * 0.7, g * 0.7, b * 0.7, MAT_GENERIC);
  mb.addFace(x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y1, z1, 1, 0, 0, r * 0.95, g * 0.95, b * 0.95, MAT_GENERIC);
}

export function buildCarGeometry(): { vertices: Float32Array; indices: Uint16Array | Uint32Array } {
  const mb = new MeshBuilder();
  const L = PHYSICS.carLength;
  const W = PHYSICS.carWidth;

  // Chassis — elongated along +X (nose toward +X)
  boxAt(mb, 0, 0.1, 0, L * 0.42, 0.16, W * 0.38, 0.88, 0.88, 0.9);
  // Cabin slightly aft of center
  boxAt(mb, -L * 0.06, 0.38, 0, L * 0.16, 0.12, W * 0.28, 0.22, 0.26, 0.3);
  // Nose cone
  boxAt(mb, L * 0.32, 0.12, 0, L * 0.14, 0.1, W * 0.28, 0.78, 0.78, 0.8);
  // Rear wing / deck
  boxAt(mb, -L * 0.34, 0.36, 0, L * 0.06, 0.04, W * 0.42, 0.15, 0.15, 0.18);
  // Guide blade under nose (slot pin)
  boxAt(mb, L * 0.28, -0.02, 0, L * 0.12, 0.04, 0.06, 0.12, 0.12, 0.14);
  // Cockpit glass
  boxAt(mb, -L * 0.02, 0.58, 0, L * 0.1, 0.03, W * 0.2, 0.35, 0.55, 0.65);

  const wheelY = 0.04;
  const positions: Array<[number, number]> = [
    [L * 0.28, W * 0.38],
    [L * 0.28, -W * 0.38],
    [-L * 0.28, W * 0.38],
    [-L * 0.28, -W * 0.38],
  ];
  for (const [wx, wz] of positions) {
    boxAt(mb, wx, wheelY, wz, 0.16, 0.09, 0.1, 0.08, 0.08, 0.1);
  }

  return mb.build();
}

/**
 * Soft gold disc under the player — alpha-blended in the renderer.
 * Winding faces +Y so CULL_FACE doesn't erase it from the tabletop camera.
 */
export function buildPlayerRingGeometry(): { vertices: Float32Array; indices: Uint16Array | Uint32Array } {
  const mb = new MeshBuilder();
  // Soft disc under the chassis, then a thin rim — world metres, 1:1 with the car.
  const disc = PHYSICS.carWidth * 0.72;
  const rimIn = PHYSICS.carWidth * 0.82;
  const rimOut = PHYSICS.carWidth * 1.05;
  const segs = 28;
  const y = 0.028;
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2;
    const a1 = ((i + 1) / segs) * Math.PI * 2;
    const c0 = Math.cos(a0);
    const s0 = Math.sin(a0);
    const c1 = Math.cos(a1);
    const s1 = Math.sin(a1);
    const z = mb.vertex(0, y, 0, 0, 1, 0, 1, 1, 1, MAT_GENERIC);
    const d0 = mb.vertex(disc * c0, y, disc * s0, 0, 1, 0, 1, 1, 1, MAT_GENERIC);
    const d1 = mb.vertex(disc * c1, y, disc * s1, 0, 1, 0, 1, 1, 1, MAT_GENERIC);
    // CCW from +Y — opposite of the old culled winding.
    mb.tri(z, d1, d0);
    const i0 = mb.vertex(rimIn * c0, y, rimIn * s0, 0, 1, 0, 1, 1, 1, MAT_GENERIC);
    const i1 = mb.vertex(rimIn * c1, y, rimIn * s1, 0, 1, 0, 1, 1, 1, MAT_GENERIC);
    const i2 = mb.vertex(rimOut * c1, y, rimOut * s1, 0, 1, 0, 1, 1, 1, MAT_GENERIC);
    const i3 = mb.vertex(rimOut * c0, y, rimOut * s0, 0, 1, 0, 1, 1, 1, MAT_GENERIC);
    mb.quad(i0, i3, i2, i1);
  }
  return mb.build();
}

/**
 * Golden marker hovering above the player, tip pointing down at the roof.
 * Built in world metres; Y is up.
 */
export function buildPlayerArrowGeometry(): { vertices: Float32Array; indices: Uint16Array | Uint32Array } {
  const mb = new MeshBuilder();
  const tipY = 1.55;
  const headHeight = 0.55;
  const headRadius = 0.42;
  const shaftHeight = 0.9;
  const shaftRadius = 0.12;
  const segs = 10;
  const baseY = tipY + headHeight;
  const topY = baseY + shaftHeight;
  const gold: [number, number, number] = [0.94, 0.74, 0.22];

  const tipIdx = mb.vertex(0, tipY, 0, 0, -1, 0, gold[0], gold[1], gold[2], MAT_GENERIC);
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2;
    const a1 = ((i + 1) / segs) * Math.PI * 2;
    const c0 = Math.cos(a0);
    const s0 = Math.sin(a0);
    const c1 = Math.cos(a1);
    const s1 = Math.sin(a1);
    const h0 = mb.vertex(headRadius * c0, baseY, headRadius * s0, c0, 0.35, s0, gold[0], gold[1], gold[2], MAT_GENERIC);
    const h1 = mb.vertex(headRadius * c1, baseY, headRadius * s1, c1, 0.35, s1, gold[0], gold[1], gold[2], MAT_GENERIC);
    mb.tri(tipIdx, h1, h0);

    const n0x = c0;
    const n0z = s0;
    const n1x = c1;
    const n1z = s1;
    const s0i = mb.vertex(shaftRadius * c0, baseY, shaftRadius * s0, n0x, 0, n0z, gold[0], gold[1], gold[2], MAT_GENERIC);
    const s1i = mb.vertex(shaftRadius * c1, baseY, shaftRadius * s1, n1x, 0, n1z, gold[0], gold[1], gold[2], MAT_GENERIC);
    const s2i = mb.vertex(shaftRadius * c1, topY, shaftRadius * s1, n1x, 0, n1z, gold[0], gold[1], gold[2], MAT_GENERIC);
    const s3i = mb.vertex(shaftRadius * c0, topY, shaftRadius * s0, n0x, 0, n0z, gold[0], gold[1], gold[2], MAT_GENERIC);
    mb.quad(s0i, s3i, s2i, s1i);
  }

  const cap = mb.vertex(0, topY, 0, 0, 1, 0, gold[0], gold[1], gold[2], MAT_GENERIC);
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2;
    const a1 = ((i + 1) / segs) * Math.PI * 2;
    const t0 = mb.vertex(shaftRadius * Math.cos(a0), topY, shaftRadius * Math.sin(a0), 0, 1, 0, gold[0], gold[1], gold[2], MAT_GENERIC);
    const t1 = mb.vertex(shaftRadius * Math.cos(a1), topY, shaftRadius * Math.sin(a1), 0, 1, 0, gold[0], gold[1], gold[2], MAT_GENERIC);
    mb.tri(cap, t1, t0);
  }

  return mb.build();
}
