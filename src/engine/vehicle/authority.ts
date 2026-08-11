/** Authority blend — player brake assist / throttle trim. */
import { PHYSICS } from '../../data/physics';

/** Low Skill → light auto-brake assist; elites manage braking themselves. */
export function computeBrakeAuthority(skill: number): number {
  return Math.max(
    0.12,
    Math.min(1, PHYSICS.brakeAuthorityBase + PHYSICS.brakeAuthoritySpan * (skill / 100)),
  );
}

/** High Skill → stronger throttle trim toward AI when pin-throttling. */
export function computeThrottleAuthority(skill: number): number {
  return Math.max(
    0,
    Math.min(1, PHYSICS.throttleAuthorityBase + PHYSICS.throttleAuthoritySpan * (skill / 100)),
  );
}

/**
 * Player Authority blend — shared by Vehicle and feel gates so pin ratios cannot drift.
 * Pin-throttle (pT>0.85, pB<0.08) nearly kills brake assist.
 */
export function computePinAuthorityBlend(
  skill: number,
  pT: number,
  pB: number,
): { brakeAuth: number; throttleAuth: number; pinOverrule: boolean; brakeBlend: number; trim: number } {
  const brakeAuth = computeBrakeAuthority(skill);
  const throttleAuth = computeThrottleAuthority(skill);
  const pinOverrule = pT > 0.85 && pB < 0.08;
  const brakeBlend = pinOverrule ? brakeAuth * 0.015 : brakeAuth;
  const trim = pinOverrule ? throttleAuth * 0.25 : throttleAuth;
  return { brakeAuth, throttleAuth, pinOverrule, brakeBlend, trim };
}
