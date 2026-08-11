import type { AudioBuses } from './buses';
import { makeNoiseBuffer } from './noise';
import type { AudioTelemetry } from '../engine/AudioTelemetry';

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Continuous tyre scrub / squeal + kerb rumble. */
export class TyreSynth {
  private buses: AudioBuses;
  private started = false;

  private tyreFilter: BiquadFilterNode;
  private tyreGain: GainNode;

  private kerbOsc: OscillatorNode;
  private kerbGain: GainNode;
  private kerbStarted = false;

  constructor(buses: AudioBuses) {
    this.buses = buses;
    const ctx = buses.ctx;

    this.tyreFilter = ctx.createBiquadFilter();
    this.tyreFilter.type = 'bandpass';
    this.tyreFilter.frequency.value = 2200;
    this.tyreFilter.Q.value = 1.2;

    this.tyreGain = ctx.createGain();
    this.tyreGain.gain.value = 0;
    this.tyreFilter.connect(this.tyreGain);
    this.tyreGain.connect(buses.fx);

    this.kerbOsc = ctx.createOscillator();
    this.kerbOsc.type = 'triangle';
    this.kerbOsc.frequency.value = 48;
    this.kerbGain = ctx.createGain();
    this.kerbGain.gain.value = 0;
    this.kerbOsc.connect(this.kerbGain);
    this.kerbGain.connect(buses.fx);
  }

  start(): void {
    if (this.started) return;
    const t = this.buses.ctx.currentTime;
    const buf = makeNoiseBuffer(this.buses.ctx, 1, false, 0x7f4a7c15);
    const src = this.buses.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(this.tyreFilter);
    src.start(t);

    if (!this.kerbStarted) {
      this.kerbOsc.start(t);
      this.kerbStarted = true;
    }
    this.started = true;
  }

  update(tel: AudioTelemetry): void {
    this.start();
    const t = this.buses.ctx.currentTime;
    if (!tel.active) {
      this.tyreGain.gain.setTargetAtTime(0, t, 0.04);
      this.kerbGain.gain.setTargetAtTime(0, t, 0.04);
      return;
    }

    const deslot = tel.slotMode === 'deslot';
    const grip = tel.gripUsage;
    const drifting = tel.drifting === true;
    const kick = tel.clutchKick === true;
    // Audible only when loading the tyre hard or scrubbing off-slot.
    let amount = 0;
    if (kick) {
      amount = clamp(0.45 + grip * 0.2, 0, 0.7);
    } else if (drifting) {
      amount =
        tel.discipline === 'rally'
          ? clamp(0.28 + grip * 0.3, 0, 0.58) // gravel scrub
          : clamp(0.32 + grip * 0.35, 0, 0.62); // street squeal
    } else if (deslot) {
      amount = clamp(0.2 + grip * 0.35, 0, 0.55);
    } else if (grip > 0.92) {
      amount = clamp((grip - 0.92) / 0.25, 0, 0.42);
    }

    const freq =
      tel.discipline === 'rally' && (drifting || deslot)
        ? 900 + grip * 400
        : deslot || drifting
          ? 1400 + grip * 600
          : 2400 + grip * 800;
    this.tyreFilter.frequency.setTargetAtTime(freq, t, 0.05);
    this.tyreFilter.Q.setTargetAtTime(deslot || drifting ? 0.7 : 1.4, t, 0.05);
    this.tyreGain.gain.setTargetAtTime(amount, t, 0.04);

    this.kerbOsc.frequency.setTargetAtTime(42 + tel.speed * 0.9, t, 0.05);
    this.kerbGain.gain.setTargetAtTime(tel.onKerb ? 0.055 : 0, t, 0.03);
  }

  /** @deprecated thin alias for older call sites */
  setScreech(amount: number, drifting: boolean): void {
    this.start();
    const t = this.buses.ctx.currentTime;
    const gain = drifting ? 0.35 : clamp(amount - 1, 0, 0.45);
    this.tyreGain.gain.setTargetAtTime(gain, t, 0.03);
  }

  setKerb(on: boolean): void {
    this.start();
    const t = this.buses.ctx.currentTime;
    this.kerbGain.gain.setTargetAtTime(on ? 0.055 : 0, t, 0.03);
  }
}
