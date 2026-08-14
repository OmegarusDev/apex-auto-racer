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
  authority: number;
  /** Live corner limit speed at s (the "peg" — how fast this car can carry the corner). */
  vDeslot: number;
  // --- Real-car dynamics ---
  /** Yaw rate ω (rad/s). */
  yawRate: number;
  /** Steering angle (rad) — the driver's hands. */
  steerRad: number;
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
  /** Live garage force-path setup (mass/CG/aero/bias/compound). */
  setup: CarSetup;
  /** Street/Rally: Shift may clutch-kick when armed. */
  driftArmed: boolean;
  /** Rally/Street: prefer hold gear while sliding. */
  holdGear: boolean;
  // --- Real-car sim (greenfield) ---
  /** Heading relative to the path tangent (ψ − ψ_p) — the car's yaw vs the track. */
  headingErr: number;
  /** Front axle slip angle (rad). */
  alphaFront: number;
  /** Rear axle slip angle (rad). */
  alphaRear: number;
  /** Last-tick lateral accel (g) — for load-transfer iteration. */
  lastLateralG: number;
  /** Accumulated tyre wear 0..1 (grip fade). */
  tyreWear: number;
  /** Accumulated marshal/recovery time penalty (s) added to finish time. */
  penaltySec: number;
  /** Seconds the car has been physically stuck (marshal trigger). */
  stuckTime: number;
  /** Arc position when the stuck window began — a car must be NOT progressing. */
  stuckS: number;
  /** Per-car deterministic seed for surface noise. */
  noiseSeed: number;
}

export interface ZoneModifiers {
  gripMult: number;
  dragDecel: number;
  onKerb: boolean;
  inRunoff: boolean;
  atWall: boolean;
}

export type { SlotMode, Driver, EffectiveStats };
