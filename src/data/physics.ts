/** Centralized physics constants — mutated by debug overlay. */

export const PHYSICS = {
  dt: 1 / 120,
  brainEveryN: 4,
  g: 9.81,
  pxPerM: 5,
  carLength: 5.1,
  carWidth: 2.3,
  dprCap: 2.0,
  pedalEaseMs: 80,
  /** Cosmetic/engine RPM anchors for the assisted gearbox. */
  rpmIdle: 900,
  rpmMin: 2500,
  rpmMax: 8000,
  /** Seconds after a shift before another upshift is accepted. */
  shiftCooldown: 0.2,
  /**
   * Soft drive-cap overshoot past gear topFrac — stops a bogged gear from
   * hard-bricking accel for a frame while auto-upshift lands.
   */
  gearCapSoft: 1.08,
  kerbOuterM: 0.8,
  /** Kappa gate for painted kerbs — must match Vehicle zone detection. */
  kerbKappa: 0.012,
  kerbGrip: 0.95,
  runoffGrip: 0.5,
  runoffDrag: 3,
  runoffDragRally: 4,
  /**
   * Car-center inset from the painted barrier (outer edge at W/2+R).
   * Equals half carWidth so the body edge meets the visible wall/kerb rim —
   * never an arbitrary mid-asphalt clamp.
   */
  wallMargin: 1.15,
  /** Starting-grid row spacing along the track (m). */
  gridRowSpacing: 12,
  /** Starting-grid column offset from centerline (m). */
  gridColOffset: 4.6,
  crashSpeed: 15,
  /** Post-impact speed retained on hard wall hit (inelastic). */
  crashSpeedMult: 0.42,
  /**
   * Soft recovery after wall impact — throttles drive only; does not freeze
   * lateral dynamics or teleport the car.
   */
  crashStun: 0.38,
  /** Street discipline: harder wall stun (discipline mult — not a groove base retune). */
  streetWallStunMult: 1.45,
  scrapeSpeedMultPerSec: 0.55,
  /** Fraction of inbound lateral velocity reflected on wall contact. */
  wallRestitution: 0.18,
  /** Extra long decel (m/s²) while recovering from a wall hit. */
  crashRecoveryDecel: 5.5,
  /** Softer recovery decel while deslotted (let cars crawl off the wall). */
  crashRecoveryDecelDeslot: 2.2,
  /** Longitudinal scrub (m/s²) scale from wall impact severity. */
  wallImpactScrub: 10,
  /** Minimum roll factor for deslot steer-home (stranded cars can still crawl). */
  deslotSteerMinRoll: 0.38,
  /** Soft inward nudge (m/s²) when stuck on the wall while deslotted. */
  deslotWallPush: 4.5,
  /** Seconds of raw (undelayed) brain output after rejoining the groove. */
  recoveryBrainSec: 0.85,

  // --- Scalextric groove / deslot ---
  /** |kappa| below this is treated as a straight — no deslot at any throttle. */
  grooveKappaMin: 0.012,
  /**
   * Grip-usage secondary deslot — near peg + overloaded friction circle.
   * Primary failure is speed vs v_deslot; capacity fail is the pin-throttle path.
   */
  oDeslot: 1.26,
  /** Fraction of v_deslot required before O / capacity can force a deslot. */
  oDeslotSpeedFrac: 0.92,
  /**
   * Groove magnet: restoring lateral accel toward personal line.
   * magnet = roll(v) × (1 − loadKill×longLoad) × (1 − cornerKill×cornerLoad)
   * aLat = spring×magnet×err − damp×dl; |dl| ≤ maxDlPerV×v
   */
  grooveSpring: 18,
  grooveDamp: 7.5,
  /** How hard accel/brake kills magnet (0–1 scale on |aLongDemand|/aGrip). */
  grooveLoadKill: 0.72,
  /** How hard corner load (aLat/aGrip) kills magnet. */
  grooveCornerKill: 0.55,
  /** Below this forward speed (m/s), magnet is fully off. */
  grooveLatMinV: 1.2,
  /** Forward speed (m/s) at which roll(v) reaches full strength. */
  grooveLatFullV: 10,
  /** Max |dl| as a fraction of forward speed (no sideways teleport). */
  grooveMaxDlPerV: 0.38,
  /**
   * Capacity-fail deslot: magnet collapsed + off personal line + loaded corner.
   * |l − line| must exceed this (m) while magnet is near zero.
   */
  grooveCapacityDeslotL: 0.85,
  /** Magnet strength below this (0–1) counts as collapsed for capacity deslot. */
  grooveCapacityMagnetMin: 0.18,
  /** Scales Focus/condition line noise while in groove. */
  grooveWobbleScale: 0.32,
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
   * Skill: rookies ~42% of v_safe; elites approach ~100%.
   * Stock careers must lift in corners — not a soft nanny.
   */
  deslotSkillBase: 0.45,
  deslotSkillSpan: 0.55,
  /** Focus widens the hold window (cleaner peg). Low Focus slips early. */
  deslotFocusBase: 0.84,
  deslotFocusSpan: 0.16,
  /**
   * Bravery rides closer to the slot limit (multiplies mDriver).
   * Low bravery leaves margin; high bravery risks deslot for pace.
   */
  deslotBraveryBase: 0.87,
  deslotBraverySpan: 0.15,

  // --- Spin demoted: rare wall smash / extreme abuse only ---
  /** Wall impact above this speed while deslotted can tumble. */
  spinWallSpeed: 28,
  spinAngle: 1.45,
  spinDecelTime: 0.55,
  spinStun: 1.0,

  /**
   * Tyres start garage-warm, not ice-cold. Pin-throttle still hurts via the
   * cold window below optimal; stalled wrecks must not cool back to zero.
   */
  tyreStartTemp: 0.42,
  tyreTempMax: 1.45,
  tyreColdGrip: 0.88,
  tyreHotGrip: 0.94,
  tyreHeatSpeed: 0.045,
  tyreHeatOver: 0.12,
  tyreHeatDrift: 0.08,
  tyreCool: 0.0025,
  /** Floor while moving / recovering — prevents ice-cold restart after a crash. */
  tyreRecoveryFloor: 0.28,
  loadTransferTau: 0.3,
  loadTransferScale: 10,
  /** Cosmetic slip decay while in groove (not a free-yaw model). */
  slipDecay: 8.0,
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
   * - Rookies get light brake assist only — stock car must be driven in corners.
   * - Throttle trim rises with Skill (elites self-manage pin-throttle).
   * Pin-throttle overrule nearly kills brake assist (see Vehicle).
   */
  brakeAuthorityBase: 0.28,
  brakeAuthoritySpan: -0.16,
  throttleAuthorityBase: 0.08,
  throttleAuthoritySpan: 0.75,
  horizonSec: 8,
  /** Mild launch caution — cold adhesion already lowers v_deslot. */
  aiLaunchSec: 1.6,
  /**
   * Hold grid lateral columns after GO so the pack does not magnet sideways
   * into one shared line. Pure hold then slow blend into each car's personal line.
   */
  gridHoldSec: 2.6,
  /** Fraction of gridHoldSec spent on pure grid L before blending to personal line. */
  gridHoldPureFrac: 0.62,
  /** Groove spring multiplier during gridHoldSec (soft pack-clear after GO). */
  gridFollowGainMult: 0.28,
  /** Cap on |dl| (m/s) during grid hold — prevents sideways teleport. */
  gridMaxDl: 2.2,
  /** Minimum AI throttle while clearing the grid (avoids reaction-queue stalls). */
  aiLaunchMinThrottle: 0.68,
  detBonus: 0.12,
  cameraPosRate: 6,
  cameraZoomRate: 3,
  zoomMin: 0.48,
  zoomMax: 0.88,
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
 * QUARANTINED — drift latch is dormant for Scalextric groove/deslot.
 * Keep `enabled: false` on every surface. `VehicleState.driftState` remains on
 * the car schema; latch / muMult / tyreHeatDrift / driftEntry only run when
 * a mode flips `enabled` true. Do not delete — re-enable without schema churn.
 */
export const DRIFT_CFG: Record<
  string,
  { enabled: boolean; initiate: number; target: number; muMult: number }
> = {
  track: { enabled: false, initiate: 0.35, target: 0.35, muMult: 1.0 },
  street: { enabled: false, initiate: 0.35, target: 0.45, muMult: 1.05 },
  rally: { enabled: false, initiate: 0.3, target: 0.35, muMult: 1.08 },
};
