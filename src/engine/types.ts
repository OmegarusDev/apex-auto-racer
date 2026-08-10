import type { DisciplineId } from '../data/disciplines';
import type { PartCategory } from '../data/parts';
import type { TraitId } from '../data/traits';
import type { RankId } from '../data/balance';
import type { ObjectiveKind } from '../data/objectives';

export type { DisciplineId };

export interface Vec2 {
  x: number;
  y: number;
}

export interface DriverStats {
  skill: number;
  bravery: number;
  focus: number;
  determination: number;
}

export interface Driver {
  id: string;
  name: string;
  trait: TraitId;
  skill: number;
  bravery: number;
  focus: number;
  determination: number;
  xp: number;
  level: number;
  unspentPoints: number;
}

export type VehicleParts = Record<PartCategory, number>;

export interface VehicleSave {
  partTiers: VehicleParts;
  condition: number;
}

export type DisciplineVehicles = Record<DisciplineId, VehicleSave>;

export interface EffectiveStats {
  topSpeed: number;
  acceleration: number;
  braking: number;
  grip: number;
  downforce: number;
  vMax: number;
  aAccel: number;
  aBrake: number;
  gripFactor: number;
  D: number;
  lineNoise: number;
  condGrip: number;
  condTop: number;
}

export type SlotMode = 'groove' | 'deslot';

export interface VehicleState {
  id: string;
  driverId: string;
  teamId: number;
  isPlayerControlled: boolean;
  s: number;
  l: number;
  v: number;
  slipAngle: number;
  tyreTemp: number;
  balanceB: number;
  driftState: boolean;
  /** Scalextric: slotted on racing line, or off-slot after overspeed. */
  slotMode: SlotMode;
  deslotRemaining: number;
  /** Seconds of deslot immunity after rejoining the groove. */
  deslotImmunity: number;
  stunRemaining: number;
  spinRemaining: number;
  throttle: number;
  brake: number;
  condition: number;
  lap: number;
  finished: boolean;
  finishTime: number;
  wallHits: number;
  spinCount: number;
  deslotCount: number;
  overtakeCount: number;
  /** Pack contact dings that cost condition (player). */
  contactHits: number;
  /** Cleared by RaceDirector after emitting shift audio/events. */
  lastShiftKind: 'up' | 'down' | 'miss' | null;
}

export type RaceEventKind =
  | 'overtake'
  | 'mistake'
  | 'spin'
  | 'deslot'
  | 'crash'
  | 'driftEntry'
  | 'draftPass'
  | 'wallHit'
  | 'finish'
  | 'lap'
  | 'intent'
  | 'rejoin'
  | 'shift';

export interface RaceEvent {
  kind: RaceEventKind;
  time: number;
  carId: string;
  driverName?: string;
  detail?: string;
  /** Monotonic id — survives ring-buffer overwrite so UI can detect new events. */
  seq: number;
}

export interface VolumeOptions {
  master: number;
  engine: number;
  fx: number;
  crowd: number;
  ui: number;
}

export interface GameOptions {
  volumes: VolumeOptions;
}

export interface CareerStats {
  races: number;
  wins: number;
  earnings: number;
}

export interface TournamentStandingsEntry {
  teamId: number;
  points: number;
  name: string;
}

export interface TournamentProgress {
  defId: string;
  raceIndex: number;
  standings: TournamentStandingsEntry[];
  opponentDrivers: Driver[];
  playerLineup: string[];
  leadDriverId: string;
}

export type InProgressTournaments = Record<DisciplineId, TournamentProgress | null>;

export type RankUnlocked = Record<DisciplineId, RankId>;

export interface ObjectivesState {
  active: ObjectiveKind[];
  completed: ObjectiveKind[];
  cycleSeed: number;
}

export interface OnboardingFlags {
  shownPedalControls: boolean;
  shownBrakeHint: boolean;
  shownCrashHint: boolean;
  shownDeslotHint?: boolean;
  shownAuthorityHint?: boolean;
}

export interface GameState {
  version: number;
  seed: number;
  lastSaveTimestamp: number;
  cash: number;
  vehicles: DisciplineVehicles;
  roster: Driver[];
  rankUnlocked: RankUnlocked;
  inProgressTournaments: InProgressTournaments;
  careerStats: CareerStats;
  objectives: ObjectivesState;
  onboarding: OnboardingFlags;
  options: GameOptions;
}

export const SAVE_VERSION = 1;

export const DEFAULT_VOLUMES: VolumeOptions = {
  master: 0.8,
  engine: 0.28,
  fx: 0.5,
  crowd: 0.45,
  ui: 0.6,
};

export function emptyVehicleParts(startTier: number): VehicleParts {
  return {
    engine: startTier,
    intake: startTier,
    exhaust: startTier,
    tyres: startTier,
    brakes: startTier,
    suspension: startTier,
    spoiler: startTier,
  };
}

export function defaultVehicleSave(startTier: number, condition = 1.0): VehicleSave {
  return {
    partTiers: emptyVehicleParts(startTier),
    condition,
  };
}
