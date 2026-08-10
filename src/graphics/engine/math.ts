/** Minimal column-major mat4 / vec helpers for the Apex GL engine. */

export type Mat4 = Float32Array;
export type Vec3 = [number, number, number];

export function mat4(): Mat4 {
  const m = new Float32Array(16);
  m[0] = 1;
  m[5] = 1;
  m[10] = 1;
  m[15] = 1;
  return m;
}

export function mat4Copy(out: Mat4, a: Mat4): Mat4 {
  out.set(a);
  return out;
}

export function mat4Identity(out: Mat4): Mat4 {
  out.fill(0);
  out[0] = 1;
  out[5] = 1;
  out[10] = 1;
  out[15] = 1;
  return out;
}

export function mat4Multiply(out: Mat4, a: Mat4, b: Mat4): Mat4 {
  const a00 = a[0]!, a01 = a[1]!, a02 = a[2]!, a03 = a[3]!;
  const a10 = a[4]!, a11 = a[5]!, a12 = a[6]!, a13 = a[7]!;
  const a20 = a[8]!, a21 = a[9]!, a22 = a[10]!, a23 = a[11]!;
  const a30 = a[12]!, a31 = a[13]!, a32 = a[14]!, a33 = a[15]!;
  const b00 = b[0]!, b01 = b[1]!, b02 = b[2]!, b03 = b[3]!;
  const b10 = b[4]!, b11 = b[5]!, b12 = b[6]!, b13 = b[7]!;
  const b20 = b[8]!, b21 = b[9]!, b22 = b[10]!, b23 = b[11]!;
  const b30 = b[12]!, b31 = b[13]!, b32 = b[14]!, b33 = b[15]!;

  out[0] = a00 * b00 + a10 * b01 + a20 * b02 + a30 * b03;
  out[1] = a01 * b00 + a11 * b01 + a21 * b02 + a31 * b03;
  out[2] = a02 * b00 + a12 * b01 + a22 * b02 + a32 * b03;
  out[3] = a03 * b00 + a13 * b01 + a23 * b02 + a33 * b03;
  out[4] = a00 * b10 + a10 * b11 + a20 * b12 + a30 * b13;
  out[5] = a01 * b10 + a11 * b11 + a21 * b12 + a31 * b13;
  out[6] = a02 * b10 + a12 * b11 + a22 * b12 + a32 * b13;
  out[7] = a03 * b10 + a13 * b11 + a23 * b12 + a33 * b13;
  out[8] = a00 * b20 + a10 * b21 + a20 * b22 + a30 * b23;
  out[9] = a01 * b20 + a11 * b21 + a21 * b22 + a31 * b23;
  out[10] = a02 * b20 + a12 * b21 + a22 * b22 + a32 * b23;
  out[11] = a03 * b20 + a13 * b21 + a23 * b22 + a33 * b23;
  out[12] = a00 * b30 + a10 * b31 + a20 * b32 + a30 * b33;
  out[13] = a01 * b30 + a11 * b31 + a21 * b32 + a31 * b33;
  out[14] = a02 * b30 + a12 * b31 + a22 * b32 + a32 * b33;
  out[15] = a03 * b30 + a13 * b31 + a23 * b32 + a33 * b33;
  return out;
}

export function mat4Perspective(
  out: Mat4,
  fovy: number,
  aspect: number,
  near: number,
  far: number,
): Mat4 {
  const f = 1 / Math.tan(fovy * 0.5);
  const nf = 1 / (near - far);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) * nf;
  out[11] = -1;
  out[14] = 2 * far * near * nf;
  return out;
}

export function mat4LookAt(out: Mat4, eye: Vec3, center: Vec3, up: Vec3): Mat4 {
  let zx = eye[0] - center[0];
  let zy = eye[1] - center[1];
  let zz = eye[2] - center[2];
  let len = Math.hypot(zx, zy, zz) || 1;
  zx /= len;
  zy /= len;
  zz /= len;

  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  len = Math.hypot(xx, xy, xz) || 1;
  xx /= len;
  xy /= len;
  xz /= len;

  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;

  out[0] = xx;
  out[1] = yx;
  out[2] = zx;
  out[3] = 0;
  out[4] = xy;
  out[5] = yy;
  out[6] = zy;
  out[7] = 0;
  out[8] = xz;
  out[9] = yz;
  out[10] = zz;
  out[11] = 0;
  out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  out[15] = 1;
  return out;
}

export function mat4Translate(out: Mat4, a: Mat4, x: number, y: number, z: number): Mat4 {
  mat4Copy(out, a);
  out[12] = a[0]! * x + a[4]! * y + a[8]! * z + a[12]!;
  out[13] = a[1]! * x + a[5]! * y + a[9]! * z + a[13]!;
  out[14] = a[2]! * x + a[6]! * y + a[10]! * z + a[14]!;
  out[15] = a[3]! * x + a[7]! * y + a[11]! * z + a[15]!;
  return out;
}

export function mat4RotateY(out: Mat4, a: Mat4, rad: number): Mat4 {
  const s = Math.sin(rad);
  const c = Math.cos(rad);
  const a00 = a[0]!, a01 = a[1]!, a02 = a[2]!, a03 = a[3]!;
  const a20 = a[8]!, a21 = a[9]!, a22 = a[10]!, a23 = a[11]!;
  mat4Copy(out, a);
  out[0] = a00 * c + a20 * s;
  out[1] = a01 * c + a21 * s;
  out[2] = a02 * c + a22 * s;
  out[3] = a03 * c + a23 * s;
  out[8] = a20 * c - a00 * s;
  out[9] = a21 * c - a01 * s;
  out[10] = a22 * c - a02 * s;
  out[11] = a23 * c - a03 * s;
  return out;
}

export function mat4Scale(out: Mat4, a: Mat4, x: number, y: number, z: number): Mat4 {
  mat4Copy(out, a);
  out[0]! *= x;
  out[1]! *= x;
  out[2]! *= x;
  out[3]! *= x;
  out[4]! *= y;
  out[5]! *= y;
  out[6]! *= y;
  out[7]! *= y;
  out[8]! *= z;
  out[9]! *= z;
  out[10]! *= z;
  out[11]! *= z;
  return out;
}

/** Physics world (x,y) → engine world (x, height, -y). */
export function worldToEngine(wx: number, wy: number, height = 0): Vec3 {
  return [wx, height, -wy];
}

export function hexToRgb(hex: string): Vec3 {
  return parseCssColor(hex);
}

/** Parse #rgb / #rrggbb / #rrggbbaa / hsl(...) / rgb(...) into 0–1 RGB. */
export function parseCssColor(color: string): Vec3 {
  const c = color.trim();
  if (c.startsWith('#')) {
    let h = c.slice(1);
    if (h.length === 3 || h.length === 4) {
      h = h
        .slice(0, 3)
        .split('')
        .map((ch) => ch + ch)
        .join('');
    } else if (h.length >= 8) {
      h = h.slice(0, 6);
    } else if (h.length > 6) {
      h = h.slice(0, 6);
    }
    const n = parseInt(h, 16);
    if (!Number.isFinite(n)) return [0.85, 0.2, 0.2];
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  const hsl = /^hsla?\(\s*([-\d.]+)(?:deg)?\s*,\s*([-\d.]+)%\s*,\s*([-\d.]+)%/i.exec(c);
  if (hsl) {
    return hslToRgb(Number(hsl[1]), Number(hsl[2]) / 100, Number(hsl[3]) / 100);
  }
  const rgb = /^rgba?\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)/i.exec(c);
  if (rgb) {
    return [
      Math.max(0, Math.min(1, Number(rgb[1]) / 255)),
      Math.max(0, Math.min(1, Number(rgb[2]) / 255)),
      Math.max(0, Math.min(1, Number(rgb[3]) / 255)),
    ];
  }
  // Unknown format — vivid red so missing paints are obvious in QA, not cream-on-asphalt.
  return [0.85, 0.2, 0.2];
}

function hslToRgb(hDeg: number, s: number, l: number): Vec3 {
  const h = ((hDeg % 360) + 360) % 360;
  const sat = Math.max(0, Math.min(1, s));
  const lit = Math.max(0, Math.min(1, l));
  if (sat <= 1e-6) return [lit, lit, lit];
  const q = lit < 0.5 ? lit * (1 + sat) : lit + sat - lit * sat;
  const p = 2 * lit - q;
  const hk = h / 360;
  const tr = hueToRgb(p, q, hk + 1 / 3);
  const tg = hueToRgb(p, q, hk);
  const tb = hueToRgb(p, q, hk - 1 / 3);
  return [tr, tg, tb];
}

function hueToRgb(p: number, q: number, tIn: number): number {
  let t = tIn;
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

/** Convert HSL (deg, 0–100, 0–100) to #rrggbb for Canvas2D + WebGL. */
export function hslToHex(hDeg: number, sPct: number, lPct: number): string {
  const [r, g, b] = hslToRgb(hDeg, sPct / 100, lPct / 100);
  const to = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v * 255)))
      .toString(16)
      .padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}
