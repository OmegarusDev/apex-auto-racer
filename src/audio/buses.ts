/** Shared gain buses for the presentation audio graph. */
export interface AudioBuses {
  ctx: AudioContext;
  master: GainNode;
  engine: GainNode;
  fx: GainNode;
  crowd: GainNode;
  ui: GainNode;
}

export function createAudioBuses(
  ctx: AudioContext,
  volumes: { master: number; engine: number; fx: number; crowd: number; ui: number },
): AudioBuses {
  const master = ctx.createGain();
  master.gain.value = volumes.master;
  master.connect(ctx.destination);

  const engine = ctx.createGain();
  engine.gain.value = volumes.engine;
  engine.connect(master);

  const fx = ctx.createGain();
  fx.gain.value = volumes.fx;
  fx.connect(master);

  const crowd = ctx.createGain();
  crowd.gain.value = volumes.crowd;
  crowd.connect(master);

  const ui = ctx.createGain();
  ui.gain.value = volumes.ui;
  ui.connect(master);

  return { ctx, master, engine, fx, crowd, ui };
}
