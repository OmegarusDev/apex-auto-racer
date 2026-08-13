/** Lateral zones + tyre temp grip. */
import { PHYSICS } from '../../data/physics';
import type { DisciplineId } from '../../data/disciplines';
import { getDisciplineProfile } from '../../data/disciplineProfiles';
import type { ZoneModifiers } from './types';

/** Match the track kerb kappa gate so zones align with painted stripes. */
const KERB_KAPPA_THRESHOLD = PHYSICS.kerbKappa;

/** Tyre temperature grip multiplier (plan 4.1; cold floor from PHYSICS.tyreColdGrip). */
export function computeTempGrip(T: number): number {
  const cold = PHYSICS.tyreColdGrip;
  const hot = PHYSICS.tyreHotGrip;
  if (T <= 0.6) return cold + (1.0 - cold) * (T / 0.6);
  if (T <= 1.0) return 1.0;
  if (T >= 1.3) return hot;
  return 1.0 - ((1.0 - hot) * (T - 1.0)) / 0.3;
}

/**
 * Car-center lateral limit where the body edge meets the painted barrier
 * at |l| = W/2 + R (asphalt + runoff outer edge).
 */
export function wallLimitFor(width: number, runoffWidth: number): number {
  return width / 2 + runoffWidth - PHYSICS.wallMargin;
}

/** Painted barrier half-extent (visual outer edge). */
export function barrierHalfWidth(width: number, runoffWidth: number): number {
  return width / 2 + runoffWidth;
}

/** Lateral zone grip/drag modifiers (plan 4.1). */
export function computeZoneModifiers(
  absL: number,
  width: number,
  runoffWidth: number,
  kappa: number,
  discipline: DisciplineId,
): ZoneModifiers {
  const halfW = width / 2;
  const wallLimit = wallLimitFor(width, runoffWidth);

  if (absL > wallLimit) {
    return { gripMult: 1, dragDecel: 0, onKerb: false, inRunoff: false, atWall: true };
  }

  if (absL > halfW) {
    const drag = getDisciplineProfile(discipline).runoffDrag;
    const onKerb =
      Math.abs(kappa) >= KERB_KAPPA_THRESHOLD &&
      absL <= halfW + PHYSICS.kerbOuterM;
    return {
      gripMult: onKerb ? PHYSICS.kerbGrip : PHYSICS.runoffGrip,
      dragDecel: drag,
      onKerb,
      inRunoff: true,
      atWall: false,
    };
  }

  return {
    gripMult: 1,
    dragDecel: 0,
    onKerb: false,
    inRunoff: false,
    atWall: false,
  };
}
