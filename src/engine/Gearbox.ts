/**
 * Assisted gearbox — Scalextric-light with real-ish RPM/torque curves.
 * AI: auto up/down. Player: manual upshift (Shift/tap); auto downshift when off throttle.
 * Clutch-kick is a Shift dual-use channel (Street) — not a fourth pedal.
 */
import { PHYSICS } from '../data/physics';
import type { DisciplineId } from '../data/disciplines';

export interface GearboxProfile {
  gearCount: number;
  /** Peak speed fraction of vMax for each gear (1-indexed arrays padded). */
  topFrac: number[];
  /** Drive torque multiplier per gear. */
  torque: number[];
  /** Player Shift may upshift from this band. */
  earlyUpshiftBand: number;
  /** BandFrac below this → auto downshift (player only when throttle is low). */
  downshiftBand: number;
  /** Player must be below this throttle to auto-downshift. */
  playerDownshiftThrottle: number;
  /** Green SHIFT window start (band). */
  greenBandLo: number;
  /** Green SHIFT window end (band). */
  greenBandHi: number;
  /** Amber caution above green until redline. */
  amberBandHi: number;
}

export type ShiftWindowKind = 'low' | 'green' | 'amber' | 'red';

const TRACK_BOX: GearboxProfile = {
  gearCount: 6,
  topFrac: [0, 0.22, 0.38, 0.55, 0.72, 0.88, 1.0],
  torque: [0, 1.18, 1.1, 1.04, 0.98, 0.94, 0.9],
  earlyUpshiftBand: 0.42,
  downshiftBand: 0.18,
  playerDownshiftThrottle: 0.28,
  greenBandLo: 0.62,
  greenBandHi: 0.82,
  amberBandHi: 0.94,
};

const STREET_BOX: GearboxProfile = {
  gearCount: 5,
  topFrac: [0, 0.28, 0.48, 0.68, 0.86, 1.0],
  torque: [0, 1.22, 1.1, 1.02, 0.94, 0.88],
  earlyUpshiftBand: 0.4,
  downshiftBand: 0.16,
  playerDownshiftThrottle: 0.28,
  greenBandLo: 0.58,
  greenBandHi: 0.78,
  amberBandHi: 0.92,
};

const RALLY_BOX: GearboxProfile = {
  gearCount: 4,
  topFrac: [0, 0.32, 0.58, 0.8, 1.0],
  torque: [0, 1.25, 1.08, 0.98, 0.9],
  earlyUpshiftBand: 0.38,
  downshiftBand: 0.14,
  playerDownshiftThrottle: 0.3,
  greenBandLo: 0.55,
  greenBandHi: 0.8,
  amberBandHi: 0.93,
};

export function gearboxFor(discipline: DisciplineId): GearboxProfile {
  if (discipline === 'street') return STREET_BOX;
  if (discipline === 'rally') return RALLY_BOX;
  return TRACK_BOX;
}

/**
 * AI auto-upshift band, governed by driver skill (0..1).
 * Skilled drivers shift at the green-window start (peak torque); rookies hold
 * gears into the redline and lose time — no arbitrary pace handicap.
 */
export function aiUpshiftBand(box: GearboxProfile, skill01: number): number {
  const s = Math.max(0, Math.min(1, skill01));
  return box.greenBandLo + (1 - s) * (box.amberBandHi - box.greenBandLo);
}

export function gearTopSpeed(vMaxEff: number, gear: number, box: GearboxProfile): number {
  const g = Math.max(1, Math.min(box.gearCount, gear));
  return Math.max(1, vMaxEff * (box.topFrac[g] ?? 1));
}

export function gearTorque(gear: number, box: GearboxProfile): number {
  const g = Math.max(1, Math.min(box.gearCount, gear));
  return box.torque[g] ?? 1;
}

/** Band fraction inside current gear (0 = bottom, 1 = redline / top of gear). */
export function gearBandFrac(v: number, vMaxEff: number, gear: number, box: GearboxProfile): number {
  const g = Math.max(1, Math.min(box.gearCount, gear));
  const lo = g <= 1 ? 0 : vMaxEff * (box.topFrac[g - 1] ?? 0);
  const hi = gearTopSpeed(vMaxEff, g, box);
  const span = Math.max(0.5, hi - lo);
  return Math.max(0, Math.min(1.15, (v - lo) / span));
}

/** Torque curve vs band — peak near green window; Street peakier, Rally fatter low. */
export function torqueCurveAtBand(band: number, discipline: DisciplineId): number {
  const b = Math.max(0, Math.min(1.1, band));
  if (discipline === 'street') {
    const peak = 0.7;
    return Math.max(0.75, 1.12 - 2.8 * (b - peak) * (b - peak));
  }
  if (discipline === 'rally') {
    return Math.max(0.85, 1.15 - 0.35 * b);
  }
  return Math.max(0.88, 1.05 - 1.4 * (b - 0.68) * (b - 0.68));
}

export function shiftWindow(band: number, box: GearboxProfile): ShiftWindowKind {
  if (band < box.greenBandLo) return 'low';
  if (band <= box.greenBandHi) return 'green';
  if (band <= box.amberBandHi) return 'amber';
  return 'red';
}

export function rpmFromBand(band: number, throttle: number): number {
  const idle = PHYSICS.rpmIdle;
  const min = PHYSICS.rpmMin;
  const max = PHYSICS.rpmMax;
  const base = idle + (max - min) * Math.max(0, Math.min(1, band));
  return base * (0.85 + 0.15 * Math.max(0, Math.min(1, throttle)));
}

/** Normalized rev meter 0..1 for SHIFT HUD (idle→redline). */
export function revMeterNorm(rpm: number): number {
  const lo = PHYSICS.rpmIdle;
  const hi = PHYSICS.rpmMax;
  return Math.max(0, Math.min(1, (rpm - lo) / Math.max(1, hi - lo)));
}
