/**
 * Discipline surface profiles — the difference between the three sports.
 * Same tyre/vehicle model; the SURFACE is what makes Track precise,
 * Street drifty and Rally loose.
 */
import type { DisciplineId } from './disciplines';

export interface SurfaceProfile {
  /** Dry-asphalt peak lateral µ. */
  mu: number;
  /** Longitudinal µ peak. */
  muX: number;
  /** Slip angle at peak grip (deg) — later peak = more drift room. */
  alphaPeakDeg: number;
  /** Curve stiffness C — sharper peak + steeper falloff = less driftable. */
  stiffness: number;
  /** µ lost while braking hard (Rally loose-under-brake). */
  brakingMuLoss: number;
  /** Surface noise (small µ jitter) — Rally bumps. */
  noise: number;
  /** Rain multiplier on µ. */
  rainMuMult: number;
  /**
   * Post-peak grip decay: steep = snap breakaway (Track, precise, spins fast);
   * gentle = usable post-peak (Street, driftable); Rally in between.
   */
  postPeakDecay: number;
  /** Slip multiple of alphaPeak where the breakaway collapse begins. */
  breakawayMult: number;
  /** Runoff / grass drag decel (m/s²) when off the asphalt. */
  runoffDrag: number;
}

export const SURFACES: Record<DisciplineId, SurfaceProfile> = {
  track: {
    mu: 1.08,
    muX: 1.0,
    alphaPeakDeg: 10,
    stiffness: 2.0,
    brakingMuLoss: 0,
    noise: 0,
    rainMuMult: 0.82,
    postPeakDecay: 2.2,
    breakawayMult: 2.5,
    runoffDrag: 3,
  },
  street: {
    mu: 0.95,
    muX: 0.9,
    alphaPeakDeg: 14,
    stiffness: 1.8,
    brakingMuLoss: 0,
    noise: 0.02,
    rainMuMult: 0.78,
    postPeakDecay: 0.9,
    breakawayMult: 2.2,
    runoffDrag: 3,
  },
  rally: {
    mu: 0.72,
    muX: 0.72,
    alphaPeakDeg: 13,
    stiffness: 1.9,
    brakingMuLoss: 0.12,
    noise: 0.035,
    rainMuMult: 0.68,
    postPeakDecay: 1.3,
    breakawayMult: 3.0,
    runoffDrag: 4,
  },
};
