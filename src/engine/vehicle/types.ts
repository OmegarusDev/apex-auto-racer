import type { DisciplineId } from '../../data/disciplines';
import type { Driver, EffectiveStats, SlotMode, VehicleState } from '../types';
import type { Modifier } from '../modifiers';
import type { BrainIntent } from '../BrainIntent';
import type { ShiftWindowKind } from '../Gearbox';
import type { CarSetup } from './CarSetup';

export interface BrainOutput {
  desiredThrottle: number;
  desiredBrake: number;
  /**
   * Lateral Mag setpoint (racing-line offset, m). Alias for line tracking.
   * Player never sets this — AI / autopilot only.
   */
  lTarget: number;
  /**
   * Internal AI steer target for Mag (same units as lTarget for line mode;
   * Phase 4 may encode drift angle setpoint). Never a player axis.
   */
  steerTarget?: number;
  /** Optional storytelling tag from DriverBrain (not consumed by physics). */
  intent?: BrainIntent;
}

export interface VehicleInputs {
  /** Player pedal 0-1 (eased externally or here). */
  throttle: number;
  brake: number;
  /** Edge-triggered upshift request (player Shift / touch SHIFT). */
  upshift?: boolean;
  /** Street clutch-kick while Shift held near limit (advanced). */
  clutchKick?: boolean;
}

export interface VehicleUpdateContext {
  discipline: DisciplineId;
  stats: EffectiveStats;
  modifierStack: readonly Modifier[];
  muSurface: number;
  draft: number;
  sDet: number;
  position: number;
  totalCars: number;
  rain: boolean;
  debug?: boolean;
  raceTime: number;
  skill: number;
  bravery: number;
  focus: number;
}

export interface CarSimState extends VehicleState {
  stats: EffectiveStats;
  lTarget: number;
  /** Starting-grid lateral column — held briefly after GO so pack doesn't collapse. */
  gridL: number;
  /**
   * Personal racing-line offsets (m from centerline), one sample per track node.
   * Centerline (l=0) is for bounds/graphics; cars magnetize to this profile.
   */
  lineO: number[];
  dl: number;
  aLong: number;
  gripUsage: number;
  prevThrottle: number;
  throttleDropTime: number;
  gear: number;
  rpm: number;
  /** Cooldown after shift before another upshift lands. */
  shiftCooldown: number;
  /** Seconds pinned at the redline band (player auto-upshift dwell). */
  redlineDwell: number;
  /** Cached zone flag for presentation bus. */
  onKerb: boolean;
  easedThrottle: number;
  easedBrake: number;
  vProfile: number[];
  vDriver: number[];
  vSafe: number[];
  authority: number;
  /** Live v_deslot cached for HUD / AI (updated each tick). */
  vDeslot: number;
  // --- Hybrid dynamics (§1.2) ---
  /** Yaw rate ω (rad/s). */
  yawRate: number;
  /** Mag-commanded front steer (rad) — autopilot hands, not player. */
  steerRad: number;
  /** Mag authority 0..1 (collapsed → deslot). */
  magAuthority: number;
  /** Front axle normal load (N). */
  fzFront: number;
  /** Rear axle normal load (N). */
  fzRear: number;
  /** Gear band fraction 0..1+ for HUD. */
  gearBand: number;
  /** SHIFT rev window. */
  shiftWindow: ShiftWindowKind;
  /** Clutch-kick timer (s). */
  clutchKickRemaining: number;
  /** Mag interrupt from kick / handbrake-lite (0..1). */
  magInterrupt: number;
  /** Live garage force-path setup (mass/CG/aero/bias/compound). */
  setup: CarSetup;
  /** Street/Rally: Shift may clutch-kick when armed. */
  driftArmed: boolean;
  /** Rally/Street: prefer hold gear while sliding. */
  holdGear: boolean;
}

export interface ZoneModifiers {
  gripMult: number;
  dragDecel: number;
  onKerb: boolean;
  inRunoff: boolean;
  atWall: boolean;
}

export type { SlotMode, Driver, EffectiveStats };
