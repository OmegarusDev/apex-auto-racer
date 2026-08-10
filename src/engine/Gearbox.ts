import { PHYSICS } from '../data/physics';
import type { DisciplineId } from '../data/disciplines';

/** Per-discipline gearbox personality. */
export interface GearboxProfile {
  gearCount: number;
  /** Peak speed fraction of vMax for each gear (1-indexed arrays padded). */
  topFrac: number[];
  /** Drive torque multiplier per gear (1st punchy, top lean). */
  torque: number[];
  /** Minimum RPM (0–1 bandFrac) to accept an upshift cleanly. */
  upshiftBand: number;
  /** BandFrac below this → auto downshift. */
  downshiftBand: number;
  /** Speed retained on a premature upshift (missed shift). */
  missSpeedMult: number;
  /** Extra long scrub (m/s²) on a missed shift. */
  missScrub: number;
}

const TRACK_BOX: GearboxProfile = {
  gearCount: 6,
  topFrac: [0, 0.22, 0.38, 0.55, 0.72, 0.88, 1.0],
  torque: [0, 1.35, 1.18, 1.05, 0.95, 0.88, 0.82],
  upshiftBand: 0.72,
  downshiftBand: 0.22,
  missSpeedMult: 0.94,
  missScrub: 4.5,
};

const STREET_BOX: GearboxProfile = {
  gearCount: 5,
  topFrac: [0, 0.28, 0.48, 0.68, 0.86, 1.0],
  torque: [0, 1.45, 1.2, 1.02, 0.9, 0.8],
  upshiftBand: 0.68,
  downshiftBand: 0.2,
  missSpeedMult: 0.91,
  missScrub: 6,
};

const RALLY_BOX: GearboxProfile = {
  gearCount: 4,
  topFrac: [0, 0.32, 0.58, 0.8, 1.0],
  torque: [0, 1.55, 1.15, 0.95, 0.85],
  upshiftBand: 0.65,
  downshiftBand: 0.18,
  missSpeedMult: 0.88,
  missScrub: 7.5,
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
  // Blip with throttle so coasting drops a little.
  return base * (0.85 + 0.15 * Math.max(0, Math.min(1, throttle)));
}
