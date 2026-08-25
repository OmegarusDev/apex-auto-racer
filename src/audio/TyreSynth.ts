import type { AudioBuses } from './buses';
import { makeNoiseBuffer } from './noise';
import type { AudioTelemetry } from '../engine/AudioTelemetry';

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Continuous tyre scrub / squeal + kerb rumble.
 *
 * Tarmac squeal is a TONAL stick-slip vibration (tread blocks resonating at
 * 800–1500 Hz).  Gravel / loose-surface scrub is BROADBAND white noise.
 * We model this with two separate sources: a narrow-band noise layer for
 * tarmac squeal, and a wider white-noise layer for gravel scrub.
 */
export class TyreSynth {
  private buses: AudioBuses;
  private started = false;

  // Tarmac: narrow-band noise (tonal-ish squeal)
  private tyreFilter: BiquadFilterNode;
  private tyreGain: GainNode;

  // Gravel: wider white-noise layer
  private gravelFilter: BiquadFilterNode;
  private gravelGain: GainNode;

  // Kerb rumble
  private kerbOsc: OscillatorNode;
  private kerbGain: GainNode;
  private kerbStarted = false;

  constructor(buses: AudioBuses) {
    this.buses = buses;
    const ctx = buses.ctx;

    // --- Tarmac squeal layer (narrow bandpass → more tonal) ---
    this.tyreFilter = ctx.createBiquadFilter();
    this.tyreFilter.type = 'bandpass';
    this.tyreFilter.frequency.value = 1100;
    this.tyreFilter.Q.value = 6; // narrow Q → resonant / tonal

    this.tyreGain = ctx.createGain();
    this.tyreGain.gain.value = 0;
    this.tyreFilter.connect(this.tyreGain);
    this.tyreGain.connect(buses.fx);

    // --- Gravel scrub layer (wide bandpass → noisy / static) ---
    this.gravelFilter = ctx.createBiquadFilter();
    this.gravelFilter.type = 'bandpass';
    this.gravelFilter.frequency.value = 1200;
    this.gravelFilter.Q.value = 0.5;

    this.gravelGain = ctx.createGain();
    this.gravelGain.gain.value = 0;
    this.gravelFilter.connect(this.gravelGain);
    this.gravelGain.connect(buses.fx);

    // --- Kerb rumble ---
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
    this.tyreGain.gain.value = 0;
    this.gravelGain.gain.value = 0;

    // Single noise buffer feeds both layers
    const buf = makeNoiseBuffer(this.buses.ctx, 1, false, 0x7f4a7c15);

    // Tarmac source
    const tSrc = this.buses.ctx.createBufferSource();
    tSrc.buffer = buf;
    tSrc.loop = true;
    tSrc.connect(this.tyreFilter);
    tSrc.start(t);

    // Gravel source (same buffer, separate filter)
    const gSrc = this.buses.ctx.createBufferSource();
    gSrc.buffer = buf;
    gSrc.loop = true;
    gSrc.connect(this.gravelFilter);
    gSrc.start(t);

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
      this.gravelGain.gain.setTargetAtTime(0, t, 0.04);
      this.kerbGain.gain.setTargetAtTime(0, t, 0.04);
      return;
    }

    const deslot = tel.slotMode === 'deslot';
    const grip = tel.gripUsage;
    const drifting = tel.drifting === true;
    const kick = tel.clutchKick === true;
    const isRally = tel.discipline === 'rally';

    // ── Gravel layer (broadband white noise — only on loose surfaces) ──
    let gravelAmt = 0;
    if (isRally && (drifting || deslot || kick)) {
      gravelAmt = clamp(0.18 + grip * 0.28, 0, 0.46);
    }
    const gravelFreq = isRally ? 900 + grip * 400 : 0;
    const gravelQ = 0.45; // very wide → static / white noise
    this.gravelFilter.frequency.setTargetAtTime(gravelFreq, t, 0.05);
    this.gravelFilter.Q.setTargetAtTime(gravelQ, t, 0.05);
    this.gravelGain.gain.setTargetAtTime(gravelAmt, t, 0.04);

    // ── Tarmac layer (tonal squeal — track / street only) ──
    let tarmacAmt = 0;
    let tarmacFreq = 1100;
    let tarmacQ = 5; // narrow → resonant / tonal

    if (isRally) {
      // Rally: no tarmac squeal, keep layer silent
      tarmacAmt = 0;
    } else if (kick) {
      tarmacAmt = clamp(0.22 + grip * 0.1, 0, 0.34);
      tarmacFreq = 900 + grip * 300;
      tarmacQ = 3.5;
    } else if (drifting) {
      // Drift on tarmac: lower-pitched dull squeal
      tarmacAmt = clamp(0.18 + grip * 0.16, 0, 0.36);
      tarmacFreq = 850 + grip * 450;
      tarmacQ = 4;
    } else if (deslot) {
      tarmacAmt = clamp(0.12 + grip * 0.14, 0, 0.28);
      tarmacFreq = 950 + grip * 350;
      tarmacQ = 4;
    } else if (grip > 0.92) {
      // Hard cornering: gentle tonal hint
      tarmacAmt = clamp((grip - 0.92) / 0.25, 0, 0.18);
      tarmacFreq = 1200 + grip * 500;
      tarmacQ = 6;
    }

    this.tyreFilter.frequency.setTargetAtTime(tarmacFreq, t, 0.05);
    this.tyreFilter.Q.setTargetAtTime(tarmacQ, t, 0.05);
    this.tyreGain.gain.setTargetAtTime(tarmacAmt, t, 0.04);

    // ── Kerb rumble ──
    this.kerbOsc.frequency.setTargetAtTime(42 + tel.speed * 0.9, t, 0.05);
    this.kerbGain.gain.setTargetAtTime(tel.onKerb ? 0.055 : 0, t, 0.03);
  }

  /** @deprecated thin alias for older call sites */
  setScreech(amount: number, drifting: boolean): void {
    this.start();
    const t = this.buses.ctx.currentTime;
    const gain = drifting ? 0.25 : clamp(amount - 1, 0, 0.3);
    this.tyreGain.gain.setTargetAtTime(gain, t, 0.03);
  }

  setKerb(on: boolean): void {
    this.start();
    const t = this.buses.ctx.currentTime;
    this.kerbGain.gain.setTargetAtTime(on ? 0.055 : 0, t, 0.03);
  }
}
