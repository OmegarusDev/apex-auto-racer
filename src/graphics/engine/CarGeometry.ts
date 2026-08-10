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
