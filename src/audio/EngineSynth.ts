import type { AudioBuses } from './buses';
import { makeNoiseBuffer } from './noise';
import type { AudioTelemetry } from '../engine/AudioTelemetry';
import type { DisciplineId } from '../data/disciplines';

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

interface DiscTint {
  fundMul: number;
  exhaustGain: number;
  midGain: number;
  intakeGain: number;
  filterBase: number;
  filterSpan: number;
}

const TINT: Record<DisciplineId, DiscTint> = {
  track: {
    fundMul: 1.05,
    exhaustGain: 0.22,
    midGain: 0.16,
    intakeGain: 0.09,
    filterBase: 900,
    filterSpan: 3200,
  },
  street: {
    fundMul: 0.95,
    exhaustGain: 0.28,
    midGain: 0.14,
    intakeGain: 0.07,
    filterBase: 700,
    filterSpan: 2600,
  },
  rally: {
    fundMul: 0.88,
    exhaustGain: 0.3,
    midGain: 0.12,
    intakeGain: 0.05,
    filterBase: 550,
    filterSpan: 2000,
  },
};

/** Multi-layer full-size race engine — exhaust + block + intake + wind. */
export class EngineSynth {
  private buses: AudioBuses;
  private started = false;

  private exhaust: OscillatorNode;
  private mid: OscillatorNode;
  private mid2: OscillatorNode;
  private intake: OscillatorNode;
  private exhaustGain: GainNode;
  private midGain: GainNode;
  private intakeGain: GainNode;
  private filter: BiquadFilterNode;
  private voiceGain: GainNode;

  private windFilter: BiquadFilterNode;
  private windGain: GainNode;

  constructor(buses: AudioBuses) {
    this.buses = buses;
    const ctx = buses.ctx;

    this.exhaust = ctx.createOscillator();
    this.exhaust.type = 'sawtooth';
    this.mid = ctx.createOscillator();
    this.mid.type = 'sawtooth';
    this.mid2 = ctx.createOscillator();
    this.mid2.type = 'square';
    this.intake = ctx.createOscillator();
    this.intake.type = 'triangle';

    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 0.7;
    this.filter.frequency.value = 800;

    this.exhaustGain = ctx.createGain();
    this.midGain = ctx.createGain();
    this.intakeGain = ctx.createGain();
    this.voiceGain = ctx.createGain();
    this.exhaustGain.gain.value = 0;
    this.midGain.gain.value = 0;
    this.intakeGain.gain.value = 0;
    this.voiceGain.gain.value = 0;

    this.exhaust.connect(this.exhaustGain);
    this.mid.connect(this.midGain);
    this.mid2.connect(this.midGain);
    this.intake.connect(this.intakeGain);
    this.exhaustGain.connect(this.filter);
    this.midGain.connect(this.filter);
    this.intakeGain.connect(this.filter);
    this.filter.connect(this.voiceGain);
    this.voiceGain.connect(buses.engine);

    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 1800;
    this.windFilter.Q.value = 0.55;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.windFilter.connect(this.windGain);
    this.windGain.connect(buses.engine);
  }

  start(): void {
    if (this.started) return;
    const t = this.buses.ctx.currentTime;
    this.exhaust.start(t);
    this.mid.start(t);
    this.mid2.start(t);
    this.intake.start(t);

    const windBuf = makeNoiseBuffer(this.buses.ctx, 1.5, false, 0x51aced01);
    const wind = this.buses.ctx.createBufferSource();
    wind.buffer = windBuf;
    wind.loop = true;
    wind.connect(this.windFilter);
    wind.start(t);
    this.started = true;
  }

  update(tel: AudioTelemetry): void {
    this.start();
    const t = this.buses.ctx.currentTime;
    const tint = TINT[tel.discipline];
    const rpmN = clamp(tel.rpm / 8000, 0, 1.15);
    const fund = (48 + 420 * rpmN) * tint.fundMul;

    this.exhaust.frequency.setTargetAtTime(fund * 0.5, t, 0.025);
    this.mid.frequency.setTargetAtTime(fund, t, 0.02);
    this.mid2.frequency.setTargetAtTime(fund * 2.01, t, 0.02);
    this.intake.frequency.setTargetAtTime(fund * 3.2 + 80, t, 0.03);

    const th = clamp(tel.throttle, 0, 1);
    const brakeDuck = 1 - clamp(tel.brake, 0, 1) * 0.35;
    const loadOpen = 0.25 + th * 0.75;
    const cutoff = tint.filterBase + tint.filterSpan * loadOpen * (0.55 + 0.45 * rpmN);
    this.filter.frequency.setTargetAtTime(cutoff, t, 0.04);

    const muted = !tel.active;
    const voice = muted ? 0 : (0.04 + th * 0.32 + rpmN * 0.08) * brakeDuck;
    this.voiceGain.gain.setTargetAtTime(voice, t, 0.05);
    this.exhaustGain.gain.setTargetAtTime(muted ? 0 : tint.exhaustGain, t, 0.05);
    this.midGain.gain.setTargetAtTime(muted ? 0 : tint.midGain * (0.55 + 0.45 * th), t, 0.05);
    this.intakeGain.gain.setTargetAtTime(
      muted ? 0 : tint.intakeGain * th * th,
      t,
      0.04,
    );

    const windVol = muted ? 0 : clamp(tel.speed / 55, 0, 1) * 0.045;
    this.windGain.gain.setTargetAtTime(windVol, t, 0.08);
    this.windFilter.frequency.setTargetAtTime(900 + tel.speed * 28, t, 0.1);
  }

  /** Brief RPM dip on shift — cosmetic only. */
  blip(kind: 'up' | 'down' | 'miss'): void {
    if (!this.started) return;
    const t = this.buses.ctx.currentTime;
    const dip = kind === 'miss' ? 0.55 : kind === 'up' ? 0.72 : 0.85;
    const g = this.voiceGain.gain;
    g.cancelScheduledValues(t);
    const cur = g.value || 0.05;
    g.setValueAtTime(cur, t);
    g.linearRampToValueAtTime(cur * dip, t + 0.04);
    g.linearRampToValueAtTime(cur, t + 0.14);
  }
}
