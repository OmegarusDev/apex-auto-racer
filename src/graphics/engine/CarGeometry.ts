/** Unit slot-car mesh — length along +X to match 2D painter / physics heading. */

import { PHYSICS } from '../../data/physics';
import { MeshBuilder } from './MeshBuilder';

export function buildCarGeometry(): { vertices: Float32Array; indices: Uint16Array | Uint32Array } {
  const mb = new MeshBuilder();
  const L = PHYSICS.carLength;
  const W = PHYSICS.carWidth;
  const hx = L * 0.5;
  const hz = W * 0.5;

  // Main body / cabin / nose / guide
  mb.box(hx * 0.95, 0.2, hz * 0.9, 0.88, 0.88, 0.9, 0.1);
  mb.box(hx * 0.35, 0.15, hz * 0.55, 0.22, 0.26, 0.3, 0.42);
  mb.box(hx * 0.22, 0.11, hz * 0.55, 0.78, 0.78, 0.8, 0.16);
  mb.box(0.4, 0.05, 0.07, 0.12, 0.12, 0.14, -0.02);

  const wheelY = 0.06;
  const positions: Array<[number, number]> = [
    [hx * 0.55, hz * 0.85],
    [hx * 0.55, -hz * 0.85],
    [-hx * 0.55, hz * 0.85],
    [-hx * 0.55, -hz * 0.85],
  ];
  for (const [wx, wz] of positions) {
    const ww = 0.18;
    const wh = 0.12;
    const r = 0.1;
    const dark = 0.07;
    mb.addFace(
      wx - ww, wheelY, wz - wh,
      wx + ww, wheelY, wz - wh,
      wx + ww, wheelY + r, wz - wh,
      wx - ww, wheelY + r, wz - wh,
      0, 0, -1, dark, dark, dark + 0.02,
    );
    mb.addFace(
      wx + ww, wheelY, wz + wh,
      wx - ww, wheelY, wz + wh,
      wx - ww, wheelY + r, wz + wh,
      wx + ww, wheelY + r, wz + wh,
      0, 0, 1, dark, dark, dark + 0.02,
    );
    mb.addFace(
      wx - ww, wheelY + r, wz + wh,
      wx + ww, wheelY + r, wz + wh,
      wx + ww, wheelY + r, wz - wh,
      wx - ww, wheelY + r, wz - wh,
      0, 1, 0, dark * 1.4, dark * 1.4, dark * 1.5,
    );
  }

  mb.box(hx * 0.22, 0.04, hz * 0.4, 0.3, 0.5, 0.6, 0.58);
  return mb.build();
}
