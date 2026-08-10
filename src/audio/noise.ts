/** Deterministic pseudo-random for noise buffer generation (no Math.random). */
export function fillNoiseBuffer(buffer: AudioBuffer, seed = 0x6d2b79f5): void {
  const data = buffer.getChannelData(0);
  let s = seed >>> 0;
  for (let i = 0; i < data.length; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    data[i] = (s / 0x80000000) - 1;
  }
}

/** Pink-ish noise via simple Voss-McCartney-ish running average on white. */
export function fillPinkNoiseBuffer(buffer: AudioBuffer, seed = 0x9e3779b9): void {
  const data = buffer.getChannelData(0);
  let s = seed >>> 0;
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  for (let i = 0; i < data.length; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const white = (s / 0x80000000) - 1;
    b0 = 0.99765 * b0 + white * 0.099046;
    b1 = 0.963 * b1 + white * 0.2965164;
    b2 = 0.57 * b2 + white * 1.0526913;
    data[i] = Math.max(-1, Math.min(1, (b0 + b1 + b2 + white * 0.1848) * 0.35));
  }
}

export function makeNoiseBuffer(
  ctx: AudioContext,
  seconds = 1,
  pink = false,
  seed?: number,
): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * seconds)), ctx.sampleRate);
  if (pink) fillPinkNoiseBuffer(buffer, seed);
  else fillNoiseBuffer(buffer, seed);
  return buffer;
}
