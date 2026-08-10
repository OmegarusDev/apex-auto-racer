import type { AudioBuses } from './buses';
import { makeNoiseBuffer } from './noise';
import type { DisciplineId } from '../data/disciplines';

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

const DISC_BED: Record<DisciplineId, number> = {
  track: 1,
  street: 0.7,
  rally: 0.4,
};

/** Stadium murmur + cheer spikes driven by hype. */
export class CrowdSynth {
  private buses: AudioBuses;
  private started = false;
  private bedFilter: BiquadFilterNode;
  private bedGain: GainNode;
  private cheerGain: GainNode;
  private discipline: DisciplineId = 'track';
  private hype = 0;

  constructor(buses: AudioBuses) {
    this.buses = buses;
    const ctx = buses.ctx;

    this.bedFilter = ctx.createBiquadFilter();
    this.bedFilter.type = 'bandpass';
    this.bedFilter.frequency.value = 650;
    this.bedFilter.Q.value = 0.55;

    this.bedGain = ctx.createGain();
    this.bedGain.gain.value = 0;
    this.bedFilter.connect(this.bedGain);
    this.bedGain.connect(buses.crowd);

    this.cheerGain = ctx.createGain();
    this.cheerGain.gain.value = 0;
    this.cheerGain.connect(buses.crowd);
  }

  start(): void {
    if (this.started) return;
    const t = this.buses.ctx.currentTime;
    const buf = makeNoiseBuffer(this.buses.ctx, 2, true, 0xc0ffee11);
    const src = this.buses.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(this.bedFilter);
    src.start(t);
    this.started = true;
  }

  setDiscipline(id: DisciplineId): void {
    this.discipline = id;
  }

  setHype(hype: number): void {
    this.start();
    this.hype = clamp(hype, 0, 1);
    const t = this.buses.ctx.currentTime;
    const bed = (0.02 + this.hype * 0.1) * DISC_BED[this.discipline];
    this.bedGain.gain.setTargetAtTime(bed, t, 0.2);
    this.bedFilter.frequency.setTargetAtTime(480 + this.hype * 420, t, 0.25);
  }

  /** Short crowd surge on overtakes / brilliant moments. */
  roar(intensity = 0.5): void {
    this.start();
    const t = this.buses.ctx.currentTime;
    const peak = clamp(0.08 + intensity * 0.22, 0.05, 0.32) * DISC_BED[this.discipline];
    const src = this.buses.ctx.createBufferSource();
    src.buffer = makeNoiseBuffer(this.buses.ctx, 0.45, true, (Date.now() * 2654435761) >>> 0);
    const filter = this.buses.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 900 + intensity * 600;
    filter.Q.value = 0.8;
    const g = this.buses.ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.buses.crowd);
    src.start(t);
    src.stop(t + 0.6);
  }

  silence(): void {
    if (!this.started) return;
    const t = this.buses.ctx.currentTime;
    this.bedGain.gain.setTargetAtTime(0, t, 0.15);
    this.hype = 0;
  }
}
