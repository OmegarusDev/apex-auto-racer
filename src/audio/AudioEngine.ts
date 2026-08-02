/** Deterministic pseudo-random for noise buffer generation (no Math.random). */
function fillNoiseBuffer(buffer: AudioBuffer, seed = 0x6d2b79f5): void {
  const data = buffer.getChannelData(0);
  let s = seed >>> 0;
  for (let i = 0; i < data.length; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    data[i] = (s / 0x80000000) - 1;
  }
}

export interface AudioVolumeOptions {
  master?: number;
  engine?: number;
  fx?: number;
  ui?: number;
}

const DEFAULT_VOLUMES: Required<AudioVolumeOptions> = {
  master: 0.8,
  engine: 0.25,
  fx: 0.5,
  ui: 0.6,
};

/** Soft low-register voicings for generative pad motion (Hz). */
const AMBIENT_VOICINGS: ReadonlyArray<readonly number[]> = [
  [55.0, 82.41, 110.0],
  [49.0, 73.42, 98.0],
  [65.41, 98.0, 130.81],
  [41.2, 82.41, 123.47],
  [55.0, 82.41, 164.81],
  [61.74, 92.5, 146.83],
];

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export class AudioEngine {
  private ctx: AudioContext;
  private masterGain: GainNode;
  private engineBus: GainNode;
  private fxBus: GainNode;
  private uiBus: GainNode;

  private engineOsc: OscillatorNode;
  private engineFilter: BiquadFilterNode;
  private engineGain: GainNode;
  private engineStarted = false;

  private noiseBuffer: AudioBuffer;
  private screechFilter: BiquadFilterNode;
  private screechGain: GainNode;

  private kerbOsc: OscillatorNode;
  private kerbGain: GainNode;
  private kerbStarted = false;

  private rainSource: AudioBufferSourceNode | null = null;
  private rainFilter: BiquadFilterNode;
  private rainGain: GainNode;

  /** Quiet generative ambient bed (routed under FX bus). */
  private musicBus: GainNode;
  private musicStarted = false;
  private padOscs: OscillatorNode[] = [];
  private padGains: GainNode[] = [];
  private padFilter: BiquadFilterNode | null = null;
  private ambienceSource: AudioBufferSourceNode | null = null;
  private musicSeed = 0x5f3759df;
  private musicEvolveTimer: ReturnType<typeof setTimeout> | null = null;

  private unlocked = false;
  private volumes: Required<AudioVolumeOptions>;

  constructor(options: AudioVolumeOptions = {}) {
    this.volumes = { ...DEFAULT_VOLUMES, ...options };
    this.ctx = new AudioContext();

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this.volumes.master;
    this.masterGain.connect(this.ctx.destination);

    this.engineBus = this.ctx.createGain();
    this.engineBus.gain.value = this.volumes.engine;
    this.engineBus.connect(this.masterGain);

    this.fxBus = this.ctx.createGain();
    this.fxBus.gain.value = this.volumes.fx;
    this.fxBus.connect(this.masterGain);

    this.uiBus = this.ctx.createGain();
    this.uiBus.gain.value = this.volumes.ui;
    this.uiBus.connect(this.masterGain);

    // Music sits under FX so Options FX volume covers the bed.
    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = 0;
    this.musicBus.connect(this.fxBus);

    this.engineOsc = this.ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 55;

    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 800;

    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0;

    this.engineOsc.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.engineBus);

    this.noiseBuffer = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
    fillNoiseBuffer(this.noiseBuffer);

    this.screechFilter = this.ctx.createBiquadFilter();
    this.screechFilter.type = 'highpass';
    this.screechFilter.frequency.value = 1800;

    this.screechGain = this.ctx.createGain();
    this.screechGain.gain.value = 0;
    this.screechFilter.connect(this.screechGain);
    this.screechGain.connect(this.fxBus);
    this.startScreechLoop();

    this.kerbOsc = this.ctx.createOscillator();
    this.kerbOsc.type = 'square';
    this.kerbOsc.frequency.value = 60;

    this.kerbGain = this.ctx.createGain();
    this.kerbGain.gain.value = 0;
    this.kerbOsc.connect(this.kerbGain);
    this.kerbGain.connect(this.fxBus);

    this.rainFilter = this.ctx.createBiquadFilter();
    this.rainFilter.type = 'bandpass';
    this.rainFilter.frequency.value = 1200;
    this.rainFilter.Q.value = 0.4;

    this.rainGain = this.ctx.createGain();
    this.rainGain.gain.value = 0;
    this.rainFilter.connect(this.rainGain);
    this.rainGain.connect(this.fxBus);
  }

  private startScreechLoop(): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    src.connect(this.screechFilter);
    src.start();
  }

  private startRainLoop(): void {
    if (this.rainSource) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    src.connect(this.rainFilter);
    src.start();
    this.rainSource = src;
  }

  private nextMusicRand(): number {
    this.musicSeed = (Math.imul(this.musicSeed, 1664525) + 1013904223) >>> 0;
    return this.musicSeed / 0x100000000;
  }

  /** Soft pads + filtered noise bed with slow LFO motion and sparse voicing changes. */
  private startAmbientMusic(): void {
    if (this.musicStarted) return;
    this.musicStarted = true;

    const t0 = this.ctx.currentTime;
    const voicing = AMBIENT_VOICINGS[0]!;

    const bedGain = this.ctx.createGain();
    bedGain.gain.value = 0.12;
    bedGain.connect(this.musicBus);

    const padFilter = this.ctx.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.value = 420;
    padFilter.Q.value = 0.55;
    padFilter.connect(bedGain);
    this.padFilter = padFilter;

    // Slow filter breathe
    const filterLfo = this.ctx.createOscillator();
    filterLfo.type = 'sine';
    filterLfo.frequency.value = 0.04;
    const filterLfoGain = this.ctx.createGain();
    filterLfoGain.gain.value = 160;
    filterLfo.connect(filterLfoGain);
    filterLfoGain.connect(padFilter.frequency);
    filterLfo.start(t0);

    // Slow overall bed swell (stays positive around base 0.12)
    const bedLfo = this.ctx.createOscillator();
    bedLfo.type = 'sine';
    bedLfo.frequency.value = 0.02;
    const bedLfoDepth = this.ctx.createGain();
    bedLfoDepth.gain.value = 0.03;
    bedLfo.connect(bedLfoDepth);
    bedLfoDepth.connect(bedGain.gain);
    bedLfo.start(t0);

    const types: OscillatorType[] = ['sine', 'triangle', 'sawtooth'];
    const baseGains = [0.11, 0.07, 0.035];

    for (let i = 0; i < 3; i++) {
      const osc = this.ctx.createOscillator();
      osc.type = types[i]!;
      osc.frequency.value = voicing[i]!;

      const gain = this.ctx.createGain();
      gain.gain.value = 0;

      osc.connect(gain);
      gain.connect(padFilter);
      osc.start(t0);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(baseGains[i]!, t0 + 2.8);

      this.padOscs.push(osc);
      this.padGains.push(gain);
    }

    // Gentle filtered noise bed
    if (!this.ambienceSource) {
      const noise = this.ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;
      noise.loop = true;

      const noiseFilter = this.ctx.createBiquadFilter();
      noiseFilter.type = 'lowpass';
      noiseFilter.frequency.value = 280;
      noiseFilter.Q.value = 0.4;

      const noiseGain = this.ctx.createGain();
      noiseGain.gain.value = 0;

      noise.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(bedGain);
      noise.start(t0);
      noiseGain.gain.setValueAtTime(0.0001, t0);
      noiseGain.gain.exponentialRampToValueAtTime(0.028, t0 + 3.5);
      this.ambienceSource = noise;
    }

    // Fade music bus in (LFO modulates bedGain, not this)
    this.musicBus.gain.setValueAtTime(0.0001, t0);
    this.musicBus.gain.exponentialRampToValueAtTime(1, t0 + 3.2);

    this.scheduleAmbientEvolve();
  }

  private scheduleAmbientEvolve(): void {
    if (this.musicEvolveTimer !== null) {
      clearTimeout(this.musicEvolveTimer);
    }
    const delayMs = 9000 + this.nextMusicRand() * 9000;
    this.musicEvolveTimer = setTimeout(() => {
      this.musicEvolveTimer = null;
      if (!this.unlocked || this.ctx.state === 'closed') return;
      this.evolveAmbientVoicing();
      this.scheduleAmbientEvolve();
    }, delayMs);
  }

  private evolveAmbientVoicing(): void {
    if (this.padOscs.length === 0 || this.padFilter === null) return;
    const idx = Math.floor(this.nextMusicRand() * AMBIENT_VOICINGS.length);
    const voicing = AMBIENT_VOICINGS[idx]!;
    const t = this.ctx.currentTime;
    const glide = 4 + this.nextMusicRand() * 4;

    for (let i = 0; i < this.padOscs.length; i++) {
      const osc = this.padOscs[i]!;
      const target = voicing[i] ?? voicing[voicing.length - 1]!;
      osc.frequency.cancelScheduledValues(t);
      osc.frequency.setTargetAtTime(target, t, glide / 3);
    }

    // Soft filter retarget — LFO continues to breathe around the new base
    const cutoff = 320 + this.nextMusicRand() * 220;
    this.padFilter.frequency.cancelScheduledValues(t);
    this.padFilter.frequency.setTargetAtTime(cutoff, t, 2.5);
  }

  private ensureEngineRunning(): void {
    if (this.engineStarted) return;
    const t = this.ctx.currentTime;
    this.engineOsc.start(t);
    this.engineStarted = true;
  }

  private ensureKerbRunning(): void {
    if (this.kerbStarted) return;
    const t = this.ctx.currentTime;
    this.kerbOsc.start(t);
    this.kerbStarted = true;
  }

  /** Resume suspended context on first user gesture. */
  async unlock(): Promise<void> {
    if (this.unlocked) return;
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
    this.ensureEngineRunning();
    this.ensureKerbRunning();
    this.startRainLoop();
    this.startAmbientMusic();
    this.unlocked = true;
  }

  setVolumes(volumes: AudioVolumeOptions): void {
    if (volumes.master !== undefined) {
      this.volumes.master = volumes.master;
      this.masterGain.gain.value = volumes.master;
    }
    if (volumes.engine !== undefined) {
      this.volumes.engine = volumes.engine;
      this.engineBus.gain.value = volumes.engine;
    }
    if (volumes.fx !== undefined) {
      this.volumes.fx = volumes.fx;
      this.fxBus.gain.value = volumes.fx;
    }
    if (volumes.ui !== undefined) {
      this.volumes.ui = volumes.ui;
      this.uiBus.gain.value = volumes.ui;
    }
  }

  updateEngine(rpm: number, throttle: number): void {
    this.ensureEngineRunning();
    const f = 55 + 350 * (rpm / 8000);
    const t = this.ctx.currentTime;
    this.engineOsc.frequency.setTargetAtTime(f, t, 0.02);
    // Full mute when parked (race exit); otherwise keep a quiet idle floor.
    const vol =
      rpm <= 0 && throttle <= 0 ? 0 : clamp(throttle, 0, 1) * 0.35 + 0.05;
    this.engineGain.gain.setTargetAtTime(vol, t, 0.05);
  }

  setScreech(amount: number, drifting: boolean): void {
    const t = this.ctx.currentTime;
    const gain = drifting ? 0.4 : clamp(amount - 1, 0, 0.8);
    this.screechGain.gain.setTargetAtTime(gain, t, 0.03);
  }

  playCountdown(_n: number): void {
    this.playTone('sine', 440, 0.15, this.uiBus);
  }

  playGo(): void {
    this.playTone('sine', 880, 0.4, this.uiBus);
  }

  playCrash(): void {
    this.playNoiseBurst(150, 400, 0.55);
  }

  playSpin(): void {
    this.playNoiseBurst(150, 300, 0.45);
  }

  /** Off-slot scrub — shorter / brighter than a full spin tumble. */
  playDeslot(): void {
    this.playNoiseBurst(120, 500, 0.38);
  }

  setKerb(on: boolean): void {
    this.ensureKerbRunning();
    const t = this.ctx.currentTime;
    this.kerbGain.gain.setTargetAtTime(on ? 0.08 : 0, t, 0.02);
  }

  setRain(on: boolean): void {
    this.startRainLoop();
    const t = this.ctx.currentTime;
    this.rainGain.gain.setTargetAtTime(on ? 0.06 : 0, t, 0.15);
  }

  click(): void {
    // Soft tick — was a piercing square beep
    this.playTone('sine', 520, 0.05, this.uiBus, 0.18);
  }

  async suspend(): Promise<void> {
    if (this.ctx.state === 'running') {
      await this.ctx.suspend();
    }
  }

  async resume(): Promise<void> {
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
    this.unlocked = true;
    // If unlock path was skipped somehow, ensure bed exists after resume.
    if (!this.musicStarted && this.ctx.state === 'running') {
      this.startAmbientMusic();
    }
  }

  get context(): AudioContext {
    return this.ctx;
  }

  private playTone(
    type: OscillatorType,
    freq: number,
    durationSec: number,
    bus: GainNode,
    peak = 0.5,
  ): void {
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(peak, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + durationSec);

    osc.connect(gain);
    gain.connect(bus);
    osc.start(t);
    osc.stop(t + durationSec + 0.01);
  }

  private playNoiseBurst(durationMs: number, cutoffHz: number, peak: number): void {
    const t = this.ctx.currentTime;
    const durationSec = durationMs / 1000;

    const src = this.ctx.createBufferSource();
    const burst = this.ctx.createBuffer(1, Math.ceil(this.ctx.sampleRate * durationSec), this.ctx.sampleRate);
    fillNoiseBuffer(burst, (Date.now() * 2654435761) >>> 0);
    src.buffer = burst;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoffHz;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(peak, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + durationSec);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.fxBus);
    src.start(t);
    src.stop(t + durationSec + 0.01);
  }
}
