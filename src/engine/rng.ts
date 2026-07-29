/** Mulberry32 PRNG — sole randomness source. No Math.random anywhere. */

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randRange(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

export function randInt(rng: Rng, minInclusive: number, maxInclusive: number): number {
  return Math.floor(randRange(rng, minInclusive, maxInclusive + 1));
}

export function pick<T>(rng: Rng, arr: readonly T[]): T {
  if (arr.length === 0) throw new Error('pick from empty');
  return arr[Math.floor(rng() * arr.length)]!;
}

export function weightedPick<T extends { weight: number }>(rng: Rng, arr: readonly T[]): T {
  let total = 0;
  for (const a of arr) total += a.weight;
  let r = rng() * total;
  for (const a of arr) {
    r -= a.weight;
    if (r <= 0) return a;
  }
  return arr[arr.length - 1]!;
}

export function shuffleInPlace<T>(rng: Rng, arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
}

export function hashState(values: number[]): number {
  let h = 2166136261;
  for (const v of values) {
    const bits = floatToBits(v);
    h ^= bits;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function floatToBits(v: number): number {
  const buf = new ArrayBuffer(8);
  new Float64Array(buf)[0] = v;
  const u = new Uint32Array(buf);
  return (u[0]! ^ u[1]!) >>> 0;
}
