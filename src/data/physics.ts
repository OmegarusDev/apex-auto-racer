/** Centralized physics constants — mutated by debug overlay. */

export const PHYSICS = {
  dt: 1 / 120,
  brainEveryN: 4,
  g: 9.81,
  pxPerM: 5,
  carLength: 4.5,
  carWidth: 2.0,
  dprCap: 2.0,
  pedalEaseMs: 80,
  kerbOuterM: 0.8,
  kerbGrip: 0.95,
  runoffGrip: 0.5,
  runoffDrag: 3,
  runoffDragRally: 4,
  /**
   * Car-center inset from the painted barrier (outer edge at W/2+R).
   * Equals half carWidth so the body edge meets the visible wall/kerb rim —
   * never an arbitrary mid-asphalt clamp.
   */
  wallMargin: 1.0,
  crashSpeed: 15,
  /** Post-impact speed retained on hard wall hit (inelastic). */
  crashSpeedMult: 0.32,
  /**
   * Soft recovery after wall impact — throttles drive only; does not freeze
   * lateral dynamics or teleport the car.
   */
  crashStun: 0.55,
  scrapeSpeedMultPerSec: 0.55,
  /** Fraction of inbound lateral velocity reflected on wall contact. */
  wallRestitution: 0.18,
  /** Extra long decel (m/s²) while recovering from a wall hit. */
  crashRecoveryDecel: 9,
  /** Longitudinal scrub (m/s²) scale from wall impact severity. */
  wallImpactScrub: 14,

  // --- Scalextric groove / deslot ---
  /** |kappa| below this is treated as a straight — no deslot at any throttle. */
  grooveKappaMin: 0.012,
  /**
   * Grip-usage secondary deslot — only when already near v_deslot.
   * Primary failure is speed vs v_deslot (slot adhesion), not O alone.
   */
  oDeslot: 1.32,
  /** Fraction of v_deslot required before O can force a deslot. */
  oDeslotSpeedFrac: 0.96,
  /** Strong magnetic hold onto the racing line while slotted. */
  grooveFollowGain: 6.5,
  /** Scales Focus/condition line noise while in groove. */
  grooveWobbleScale: 0.48,
  /**
   * Off-slot lateral model (Frenet):
   *   a_excess = max(0, v²|κ| − a_lat_cap)  → outward accel
   *   spare grip steers back toward o(s); no fixed eject / spring shove.
   */
  /** Viscous damping on lateral velocity while deslotted (1/s). */
  deslotLatDamp: 1.05,
  /** Gain (1/s²) converting line error into steer accel when grip remains. */
  deslotSteerGain: 3.8,
  /** Fraction of spare (a_cap − a_req) usable to steer back to the line. */
  deslotSteerFrac: 0.75,
  /** Long scrub (m/s²) per unit excess lateral accel while sliding. */
  deslotScrubGain: 0.45,
  /** Cap on deslot scrub in g. */
  deslotScrubMaxG: 1.05,
  /** Small release impulse (m/s) when the peg pops — scales with overspeed. */
  deslotReleaseImpulse: 2.8,
  /** Minimum off-slot time before rejoin is allowed. */
  deslotMinTime: 0.7,
  /** |l − o| under this (and speed OK) → return to groove. */
  deslotRejoinL: 1.35,
  /** Must be under this × v_deslot to re-slot. */
  deslotRejoinVFrac: 0.78,
  /** Immunity after rejoin so cars don't chatter deslot/reslot. */
  deslotRejoinImmunity: 1.2,
  /** Cosmetic slip cap while deslotted (not a spin path). */
  deslotSlipMax: 0.28,
  /**
   * v_deslot = v_safe * mDriver * mCar.
   * Skill: rookies hold ~55% of v_safe; elites approach ~100%.
   * Low skills must hurt — wide RPG span, not a soft nanny.
   */
  deslotSkillBase: 0.5,
  deslotSkillSpan: 0.5,
  /** Focus widens the hold window (cleaner peg). Low Focus slips early. */
  deslotFocusBase: 0.86,
  deslotFocusSpan: 0.14,
  /**
   * Bravery rides closer to the slot limit (multiplies mDriver).
   * Low bravery leaves margin; high bravery risks deslot for pace.
   */
  deslotBraveryBase: 0.88,
  deslotBraverySpan: 0.14,

  // --- Spin demoted: rare wall smash / extreme abuse only ---
  /** Wall impact above this speed while deslotted can tumble. */
  spinWallSpeed: 28,
  spinAngle: 1.45,
  spinDecelTime: 0.55,
  spinStun: 1.0,
  driftSpinO: 2.5,

  /** Colder start — pin-throttle on T1 washouts harder before tyres warm. */
  tyreColdGrip: 0.88,
  tyreHotGrip: 0.94,
  tyreHeatSpeed: 0.03,
  tyreHeatOver: 0.15,
  tyreHeatDrift: 0.1,
  tyreCool: 0.003,
  loadTransferTau: 0.3,
  loadTransferScale: 10,
  /** Legacy yaw knobs kept dormant / minimal (groove path does not use them). */
  trailBrakeSlipRate: 0.05,
  liftOffImpulse: 0.01,
  lineFollowGain: 2.0,
  slipDecay: 8.0,
  oversteerRate: 0.15,
  oversteerThrottleLo: 0.85,
  oversteerThrottleHi: 0.98,
  oversteerKnee: 2.0,
  oversteerRearBiasMin: 0.5,
  oversteerMinSlip: 0.2,
  oversteerExcessForce: 0.9,
  coldYawFloor: 0.35,
  coldYawWarmTemp: 0.4,
  understeerScrub: 0.9,
  aiSlipBleed: 6.0,
  aiYawScale: 0.1,
  coastBase: 0.5,
  coastVel: 0.02,
  /** Slipstream top-speed bonus at full draft (aligned, straight). */
  draftSpeedBonus: 0.14,
  /** Slipstream accel bonus at full draft. */
  draftAccelBonus: 0.22,
  /** Draft fades with corner curvature above this |κ|. */
  draftCornerKappa: 0.02,
  /** Determination multiplies draft harvest when mid/back of pack. */
  draftDetBonus: 0.45,
  reactionBase: 0.1,
  reactionFocusSpan: 0.7,
  /** Low Focus mistakes accumulate — high Focus stays clean. */
  mistakeBasePerSec: 0.055,
  mistakeBrakeSuppress: 0.28,
  mistakeLateralShift: 2.8,
  mistakeLateralDuration: 1.35,
  /**
   * Player Authority split:
   * - Brake assist is stronger for low Skill (safer auto-brake).
   * - Throttle trim rises with Skill (elites self-manage pin-throttle).
   * Pin-throttle overrule nearly kills brake assist (see Vehicle).
   */
  brakeAuthorityBase: 0.72,
  brakeAuthoritySpan: -0.48,
  throttleAuthorityBase: 0.12,
  throttleAuthoritySpan: 0.7,
  horizonSec: 8,
  /** Mild launch caution — cold adhesion already lowers v_deslot. */
  aiLaunchSec: 1.6,
  /**
   * Hold grid lateral columns after GO so the pack does not magnet to o(s)
   * and overlap. Pure hold then blend into the racing line; curvature
   * releases early onto the peg (see DriverBrain.gridAwareLineTarget).
   */
  gridHoldSec: 1.8,
  /** Fraction of gridHoldSec spent on pure grid L before blending to o(s). */
  gridHoldPureFrac: 0.4,
  /** Minimum AI throttle while clearing the grid (avoids reaction-queue stalls). */
  aiLaunchMinThrottle: 0.68,
  detBonus: 0.12,
  cameraPosRate: 6,
  cameraZoomRate: 3,
  zoomMin: 0.7,
  zoomMax: 1.15,
  kUnderBase: 0.8,
  lineNoiseBase: 0.8,
  maxBakeRes: 2048,
  sampleDs: 2,
  racingLineIters: 400,
  racingLineGain: 0.1,
  racingLineMargin: 1.5,
  minCornerRadius: 18,
  maxGenAttempts: 20,
  baseRadiusMin: 140,
  baseRadiusMax: 260,
};

export const SURFACE_MU: Record<string, number> = {
  track: 1.0,
  street: 0.85,
  rally: 0.6,
};

/**
 * Drift kept dormant — Scalextric loop is groove/deslot.
 * Config retained so a later mode can re-enable without schema churn.
 */
export const DRIFT_CFG: Record<
  string,
  { enabled: boolean; initiate: number; target: number; muMult: number }
> = {
  track: { enabled: false, initiate: 0.35, target: 0.35, muMult: 1.0 },
  street: { enabled: false, initiate: 0.35, target: 0.45, muMult: 1.05 },
  rally: { enabled: false, initiate: 0.3, target: 0.35, muMult: 1.08 },
};
