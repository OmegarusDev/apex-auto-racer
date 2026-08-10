import type { AudioBuses } from './buses';
import { fillNoiseBuffer, makeNoiseBuffer } from './noise';
import type { ShiftKind } from '../engine/AudioTelemetry';

/** One-shot FX: shifts, crashes, countdown, rain, UI clicks. */
export class FxOneShots {
  private buses: AudioBuses;
  private rainSrc: AudioBufferSourceNode | null = null;
  private rainFilter: BiquadFilterNode;
  private rainGain: GainNode;

  constructor(buses: AudioBuses) {
    this.buses = buses;
    this.rainFilter = buses.ctx.createBiquadFilter();
    this.rainFilter.type = 'bandpass';
    this.rainFilter.frequency.value = 1400;
    this.rainFilter.Q.value = 0.45;
    this.rainGain = buses.ctx.createGain();
    this.rainGain.gain.value = 0;
    this.rainFilter.connect(this.rainGain);
    this.rainGain.connect(buses.fx);
  }

  ensureRain(): void {
    if (this.rainSrc) return;
    const src = this.buses.ctx.createBufferSource();
    src.buffer = makeNoiseBuffer(this.buses.ctx, 1.2, true, 0x0a11face);
    src.loop = true;
    src.connect(this.rainFilter);
    src.start();
    this.rainSrc = src;
  }

  setRain(on: boolean): void {
    this.ensureRain();
    const t = this.buses.ctx.currentTime;
    this.rainGain.gain.setTargetAtTime(on ? 0.04 : 0, t, 0.2);
  }

  playTone(
    type: OscillatorType,
    freq: number,
    durationSec: number,
    bus: GainNode,
    peak = 0.45,
  ): void {
    const t = this.buses.ctx.currentTime;
    const osc = this.buses.ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const gain = this.buses.ctx.createGain();
    gain.gain.setValueAtTime(peak, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + durationSec);
    osc.connect(gain);
    gain.connect(bus);
    osc.start(t);
    osc.stop(t + durationSec + 0.01);
  }

  playNoiseBurst(durationMs: number, cutoffHz: number, peak: number): void {
    const t = this.buses.ctx.currentTime;
    const durationSec = durationMs / 1000;
    const src = this.buses.ctx.createBufferSource();
    const burst = this.buses.ctx.createBuffer(
      1,
      Math.ceil(this.buses.ctx.sampleRate * durationSec),
      this.buses.ctx.sampleRate,
    );
    fillNoiseBuffer(burst, (Date.now() * 2654435761) >>> 0);
    src.buffer = burst;
    const filter = this.buses.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoffHz;
    const gain = this.buses.ctx.createGain();
    gain.gain.setValueAtTime(peak, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + durationSec);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.buses.fx);
    src.start(t);
    src.stop(t + durationSec + 0.01);
  }

  playCountdown(_n: number): void {
    this.playTone('sine', 440, 0.12, this.buses.ui, 0.4);
  }

  playGo(): void {
    this.playTone('sine', 880, 0.35, this.buses.ui, 0.5);
  }

  playCrash(): void {
    this.playNoiseBurst(160, 380, 0.5);
  }

  playSoftContact(): void {
    this.playNoiseBurst(80, 500, 0.22);
  }

  playSpin(): void {
    this.playNoiseBurst(140, 280, 0.4);
  }

  playDeslot(): void {
    this.playNoiseBurst(110, 520, 0.34);
  }

  playShift(kind: ShiftKind): void {
    if (kind === 'miss') return; // assisted gearbox never emits miss
    const t = this.buses.ctx.currentTime;
    const f0 = kind === 'up' ? 220 : 160;
    const f1 = kind === 'up' ? 320 : 120;
    const osc = this.buses.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f1, t + 0.06);
    const g = this.buses.ctx.createGain();
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    osc.connect(g);
    g.connect(this.buses.fx);
    osc.start(t);
    osc.stop(t + 0.12);
  }

  click(): void {
    this.playTone('sine', 520, 0.045, this.buses.ui, 0.16);
  }
}
