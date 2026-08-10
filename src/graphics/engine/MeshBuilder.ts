/** CPU-side mesh builder — interleaved pos/normal/color/mat. */

import { VERTEX_STRIDE } from './gl';
import { MAT_GENERIC } from './materials';

export class MeshBuilder {
  private verts: number[] = [];
  private indices: number[] = [];

  clear(): void {
    this.verts.length = 0;
    this.indices.length = 0;
  }

  get vertexCount(): number {
    return this.verts.length / VERTEX_STRIDE;
  }

  vertex(
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    r: number,
    g: number,
    b: number,
    mat = MAT_GENERIC,
  ): number {
    const i = this.vertexCount;
    this.verts.push(x, y, z, nx, ny, nz, r, g, b, mat);
    return i;
  }

  tri(a: number, b: number, c: number): void {
    this.indices.push(a, b, c);
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }

  /** Axis-aligned box centered at origin. */
  box(
    hx: number,
    hy: number,
    hz: number,
    r: number,
    g: number,
    b: number,
    y0 = 0,
    mat = MAT_GENERIC,
  ): void {
    const y1 = y0 + hy * 2;
    this.addFace(-hx, y0, -hz, hx, y0, -hz, hx, y0, hz, -hx, y0, hz, 0, -1, 0, r * 0.55, g * 0.55, b * 0.55, mat);
    this.addFace(-hx, y1, hz, hx, y1, hz, hx, y1, -hz, -hx, y1, -hz, 0, 1, 0, r, g, b, mat);
    this.addFace(-hx, y0, hz, hx, y0, hz, hx, y1, hz, -hx, y1, hz, 0, 0, 1, r * 0.85, g * 0.85, b * 0.85, mat);
    this.addFace(hx, y0, -hz, -hx, y0, -hz, -hx, y1, -hz, hx, y1, -hz, 0, 0, -1, r * 0.75, g * 0.75, b * 0.75, mat);
    this.addFace(-hx, y0, -hz, -hx, y0, hz, -hx, y1, hz, -hx, y1, -hz, -1, 0, 0, r * 0.7, g * 0.7, b * 0.7, mat);
    this.addFace(hx, y0, hz, hx, y0, -hz, hx, y1, -hz, hx, y1, hz, 1, 0, 0, r * 0.9, g * 0.9, b * 0.9, mat);
  }

  addFace(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    cx: number,
    cy: number,
    cz: number,
    dx: number,
    dy: number,
    dz: number,
    nx: number,
    ny: number,
    nz: number,
    r: number,
    g: number,
    b: number,
    mat = MAT_GENERIC,
  ): void {
    const i0 = this.vertex(ax, ay, az, nx, ny, nz, r, g, b, mat);
    const i1 = this.vertex(bx, by, bz, nx, ny, nz, r, g, b, mat);
    const i2 = this.vertex(cx, cy, cz, nx, ny, nz, r, g, b, mat);
    const i3 = this.vertex(dx, dy, dz, nx, ny, nz, r, g, b, mat);
    this.quad(i0, i1, i2, i3);
  }

  /** Extruded ribbon strip between two edge polylines (same length). */
  ribbon(
    left: Array<{ x: number; y: number; z: number }>,
    right: Array<{ x: number; y: number; z: number }>,
    yLift: number,
    r: number,
    g: number,
    b: number,
    mat = MAT_GENERIC,
    upBias = 1,
  ): void {
    const n = Math.min(left.length, right.length);
    if (n < 2) return;
    for (let i = 0; i < n - 1; i++) {
      const l0 = left[i]!;
      const l1 = left[i + 1]!;
      const r0 = right[i]!;
      const r1 = right[i + 1]!;
      const ex = l1.x - l0.x;
      const ey = l1.y - l0.y;
      const ez = l1.z - l0.z;
      const fx = r0.x - l0.x;
      const fy = r0.y - l0.y;
      const fz = r0.z - l0.z;
      let nx = ey * fz - ez * fy;
      let ny = ez * fx - ex * fz;
      let nz = ex * fy - ey * fx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx = (nx / len) * upBias;
      ny = (ny / len) * upBias;
      nz = (nz / len) * upBias;
      if (ny < 0) {
        nx = -nx;
        ny = -ny;
        nz = -nz;
      }
      const i0 = this.vertex(l0.x, l0.y + yLift, l0.z, nx, ny, nz, r, g, b, mat);
      const i1 = this.vertex(r0.x, r0.y + yLift, r0.z, nx, ny, nz, r, g, b, mat);
      const i2 = this.vertex(r1.x, r1.y + yLift, r1.z, nx, ny, nz, r, g, b, mat);
      const i3 = this.vertex(l1.x, l1.y + yLift, l1.z, nx, ny, nz, r, g, b, mat);
      this.quad(i0, i1, i2, i3);
    }
  }

  /**
   * Rumble strip with alternating red/white baked per segment along the ribbon.
   * Shader still adds chalk wear / edge grit on MAT_RUMBLE.
   */
  rumbleRibbon(
    left: Array<{ x: number; y: number; z: number }>,
    right: Array<{ x: number; y: number; z: number }>,
    yLift: number,
    mat: number,
  ): void {
    const n = Math.min(left.length, right.length);
    if (n < 2) return;
    const red = [0.72, 0.12, 0.1];
    const white = [0.9, 0.88, 0.82];
    for (let i = 0; i < n - 1; i++) {
      const stripe = i % 2 === 0 ? red : white;
      const l0 = left[i]!;
      const l1 = left[i + 1]!;
      const r0 = right[i]!;
      const r1 = right[i + 1]!;
      const ex = l1.x - l0.x;
      const ey = l1.y - l0.y;
      const ez = l1.z - l0.z;
      const fx = r0.x - l0.x;
      const fy = r0.y - l0.y;
      const fz = r0.z - l0.z;
      let nx = ey * fz - ez * fy;
      let ny = ez * fx - ex * fz;
      let nz = ex * fy - ey * fx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
      if (ny < 0) {
        nx = -nx;
        ny = -ny;
        nz = -nz;
      }
      const [r, g, b] = stripe;
      const i0 = this.vertex(l0.x, l0.y + yLift, l0.z, nx, ny, nz, r, g, b, mat);
      const i1 = this.vertex(r0.x, r0.y + yLift, r0.z, nx, ny, nz, r, g, b, mat);
      const i2 = this.vertex(r1.x, r1.y + yLift, r1.z, nx, ny, nz, r, g, b, mat);
      const i3 = this.vertex(l1.x, l1.y + yLift, l1.z, nx, ny, nz, r, g, b, mat);
      this.quad(i0, i1, i2, i3);
    }
  }

  build(): { vertices: Float32Array; indices: Uint16Array | Uint32Array } {
    const vertices = new Float32Array(this.verts);
    const indices =
      this.vertexCount > 65535
        ? new Uint32Array(this.indices)
        : new Uint16Array(this.indices);
    return { vertices, indices };
  }
}
