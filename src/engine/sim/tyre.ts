/**
 * Tyre model — peak-and-falloff slip curves (the whole game lives here).
 *
 * Pacejka-lite closed form:  F = Fz · D · sin(C · atan(B·α))
 * The grip PEAK at α_peak and the FALLOFF past it are what produce understeer
 * (front past peak), oversteer (rear past peak), drift (deliberately past
 * peak) and spin (rear past peak, uncontrolled) — all emergent, never special-cased.
 */
import { PHYSICS } from '../../data/physics';

export interface TyreCurve {
  /** Lateral peak coefficient µ. */
  muPeak: number;
  /** Slip angle at peak grip (rad). */
  alphaPeak: number;
  /** Curve stiffness C — higher = sharper peak + steeper falloff. */
  stiffness: number;
  /** Longitudinal peak coefficient. */
  muXPeak: number;
  /** Longitudinal slip at peak. */
  kappaPeak: number;
  /** 0..1 how usable the post-peak regime is (driftability). */
  driftable: number;
  /** Post-peak grip decay — steep = snap breakaway (spin), gentle = driftable. */
  postPeakDecay: number;
  /** Slip multiple of alphaPeak at which the breakaway collapse begins. */
  breakawayMult: number;
}

export function lateralMu(curve: TyreCurve, alpha: number): number {
  const C = curve.stiffness;
  const B = Math.tan(Math.PI / (2 * Math.max(C, 1.05))) / Math.max(curve.alphaPeak, 1e-3);
  const base = curve.muPeak * Math.sin(C * Math.atan(B * alpha));
  const abs = Math.abs(alpha);
  const breakaway = curve.alphaPeak * (curve.breakawayMult ?? 2.4);
  if (abs > breakaway) {
    const over = abs / breakaway - 1;
    const k = curve.postPeakDecay ?? 3.0;
    return base * Math.exp(-k * over);
  }
  return base;
}

export function longitudinalMu(curve: TyreCurve, kappa: number): number {
  const Cx = 1.6;
  const Bx = Math.tan(Math.PI / (2 * Cx)) / Math.max(curve.kappaPeak, 1e-3);
  return curve.muXPeak * Math.sin(Cx * Math.atan(Bx * kappa));
}

export interface AxleForces {
  fy: number;
  fx: number;
  /** Current lateral µ (post-peak possible). */
  muLat: number;
  /** Current longitudinal µ. */
  muLong: number;
}

/**
 * Per-axle lateral + longitudinal forces with friction-circle coupling.
 * The circle radius uses the CURRENT (possibly post-peak) µ — running past the
 * grip peak shrinks the budget, which is how high slip eats long grip.
 */
export function axleForces(
  curve: TyreCurve,
  alpha: number,
  kappa: number,
  Fz: number,
  tempGrip: number,
  wearGrip: number,
): AxleForces {
  const muLat = Math.max(0, lateralMu(curve, alpha)) * tempGrip * wearGrip;
  const muLong = Math.max(0, longitudinalMu(curve, kappa)) * tempGrip * wearGrip;
  const fy = muLat * Fz;
  const fx = muLong * Fz;
  const fyMax = Math.max(1e-6, muLat * Fz);
  const fxMax = Math.max(1e-6, muLong * Fz);
  const usage = Math.hypot(fx / fxMax, fy / fyMax);
  const scale = usage > 1 ? 1 / usage : 1;
  return { fy: fy * scale, fx: fx * scale, muLat, muLong };
}

/** Temperature → grip window (cold slippery → optimal → hot greasy). */
export function tyreTempGrip(T: number): number {
  const cold = PHYSICS.tyreColdGrip;
  const hot = PHYSICS.tyreHotGrip;
  if (T <= 0.6) return cold + (1 - cold) * (T / 0.6);
  if (T <= 1.0) return 1;
  if (T >= 1.3) return hot;
  return 1 - ((1 - hot) * (T - 1.0)) / 0.3;
}

/** Heat-in / heat-out integration for a tyre. */
export function updateTyreTemp(
  T: number,
  dt: number,
  slipMagnitude: number,
  v: number,
  recovering: boolean,
): number {
  const heat =
    PHYSICS.tyreHeatSpeed * (v / Math.max(30, v + 1)) +
    PHYSICS.tyreHeatOver * Math.max(0, slipMagnitude - 0.5) +
    (recovering ? -PHYSICS.tyreCool * 0.5 : 0);
  const cool = recovering || v > 2 ? PHYSICS.tyreCool * 0.35 : PHYSICS.tyreCool;
  const floor = recovering ? PHYSICS.tyreRecoveryFloor : 0;
  return Math.max(floor, Math.min(PHYSICS.tyreTempMax, T + (heat - cool) * dt));
}

/** Default reference curve from a surface µ + compound scale. */
export function curveFromMu(muPeak: number, alphaPeakDeg: number, stiffness: number, postPeakDecay = 2.2): TyreCurve {
  return {
    muPeak,
    alphaPeak: (alphaPeakDeg * Math.PI) / 180,
    stiffness,
    muXPeak: Math.max(0.7, muPeak * 0.95),
    kappaPeak: 0.1,
    driftable: 0.5,
    postPeakDecay,
    breakawayMult: 2.4,
  };
}
