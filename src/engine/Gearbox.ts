import { PHYSICS } from '../data/physics';
import type { DisciplineId } from '../data/disciplines';

/**
 * Assisted gearbox — Scalextric-light.
 * Auto up/down for everyone; player Shift is an early-upshift nudge (no miss slap).
 */
export interface GearboxProfile {
  gearCount: number;
  /** Peak speed fraction of vMax for each gear (1-indexed arrays padded). */
  topFrac: number[];
  /** Drive torque multiplier per gear (mild spread — assist keeps you near right gear). */
  torque: number[];
  /** BandFrac for assisted auto-upshift (player + AI). */
  autoUpshiftBand: number;
  /** Player Shift may upshift from this band (below auto). */
  earlyUpshiftBand: number;
  /** BandFrac below this → auto downshift. */
  downshiftBand: number;
}

const TRACK_BOX: GearboxProfile = {
  gearCount: 6,
  topFrac: [0, 0.22, 0.38, 0.55, 0.72, 0.88, 1.0],
  torque: [0, 1.18, 1.1, 1.04, 0.98, 0.94, 0.9],
  autoUpshiftBand: 0.76,
  earlyUpshiftBand: 0.52,
  downshiftBand: 0.18,
};

const STREET_BOX: GearboxProfile = {
  gearCount: 5,
  topFrac: [0, 0.28, 0.48, 0.68, 0.86, 1.0],
  torque: [0, 1.22, 1.1, 1.02, 0.94, 0.88],
  autoUpshiftBand: 0.74,
  earlyUpshiftBand: 0.5,
  downshiftBand: 0.16,
};

const RALLY_BOX: GearboxProfile = {
  gearCount: 4,
  topFrac: [0, 0.32, 0.58, 0.8, 1.0],
  torque: [0, 1.25, 1.08, 0.98, 0.9],
  autoUpshiftBand: 0.72,
  earlyUpshiftBand: 0.48,
  downshiftBand: 0.14,
};

export function gearboxFor(discipline: DisciplineId): GearboxProfile {
  if (discipline === 'street') return STREET_BOX;
  if (discipline === 'rally') return RALLY_BOX;
  return TRACK_BOX;
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

export function rpmFromBand(band: number, throttle: number): number {
  const idle = PHYSICS.rpmIdle;
  const min = PHYSICS.rpmMin;
  const max = PHYSICS.rpmMax;
  const base = idle + (max - min) * Math.max(0, Math.min(1, band));
  return base * (0.85 + 0.15 * Math.max(0, Math.min(1, throttle)));
}
