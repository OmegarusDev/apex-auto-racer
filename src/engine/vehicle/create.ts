/** Car factory + profile helpers. */
import { PHYSICS } from '../../data/physics';
import type { DisciplineId } from '../../data/disciplines';
import type { Driver, EffectiveStats } from '../types';
import type { Modifier } from '../modifiers';
import type { TrackData } from '../TrackGenerator';
import type { CarSimState, VehicleUpdateContext } from './types';
import { interpolateProfile } from './deslotMargin';
import { DEFAULT_CAR_SETUP, type CarSetup } from './CarSetup';

/** Determination catch-up scalar (plan 7.1). */
export function computeSDet(determination: number, position: number, totalCars: number): number {
  if (totalCars <= 1) return 1;
  return 1 + PHYSICS.detBonus * (determination / 100) * ((position - 1) / (totalCars - 1));
}

/** Personal racing-line lateral offset at arc length s. */
export function personalLineAt(car: CarSimState, track: TrackData, s: number): number {
  if (car.lineO.length === 0) return 0;
  return interpolateProfile(car.lineO, track, s);
}

export function createCarState(
  id: string,
  driverId: string,
  teamId: number,
  isPlayerControlled: boolean,
  stats: EffectiveStats,
  vProfile: number[],
  vDriver: number[],
  vSafe: number[],
  condition: number,
  gridS: number,
  gridL: number,
  authority: number,
  lineO: number[] = [],
  setup: CarSetup = DEFAULT_CAR_SETUP,
): CarSimState {
  return {
    id,
    driverId,
    teamId,
    isPlayerControlled,
    s: gridS,
    l: gridL,
    v: 0,
    slipAngle: 0,
    tyreTemp: PHYSICS.tyreStartTemp,
    balanceB: 0,
    driftState: false,
    slotMode: 'groove',
    deslotRemaining: 0,
    deslotImmunity: 0,
    stunRemaining: 0,
    spinRemaining: 0,
    throttle: 0,
    brake: 0,
    condition,
    lap: 0,
    finished: false,
    finishTime: 0,
    wallHits: 0,
    spinCount: 0,
    deslotCount: 0,
    overtakeCount: 0,
    contactHits: 0,
    lastShiftKind: null,
    onKerb: false,
    stats,
    lTarget: gridL,
    gridL,
    lineO,
    dl: 0,
    aLong: 0,
    gripUsage: 0,
    prevThrottle: 0,
    throttleDropTime: -1,
    gear: 1,
    rpm: PHYSICS.rpmIdle,
    shiftCooldown: 0,
    redlineDwell: 0,
    easedThrottle: 0,
    easedBrake: 0,
    vProfile,
    vDriver,
    vSafe,
    authority,
    vDeslot: 0,
    yawRate: 0,
    steerRad: 0,
    magAuthority: 1,
    fzFront: 0,
    fzRear: 0,
    gearBand: 0,
    shiftWindow: 'low',
    clutchKickRemaining: 0,
    magInterrupt: 0,
    setup,
    driftArmed: false,
    holdGear: false,
  };
}

/** Convenience: build update context with SDet from driver. */
export function buildVehicleContext(
  driver: Driver,
  position: number,
  totalCars: number,
  stats: EffectiveStats,
  modifierStack: readonly Modifier[],
  discipline: DisciplineId,
  muSurface: number,
  draft: number,
  rain: boolean,
  raceTime: number,
  debug?: boolean,
): VehicleUpdateContext {
  return {
    discipline,
    stats,
    modifierStack,
    muSurface,
    draft,
    sDet: computeSDet(driver.determination, position, totalCars),
    position,
    totalCars,
    rain,
    raceTime,
    debug,
    skill: driver.skill,
    bravery: driver.bravery,
    focus: driver.focus,
  };
}

export function vDriverAt(vDriver: readonly number[], track: TrackData, s: number): number {
  return interpolateProfile(vDriver, track, s);
}

export function vSafeAt(vSafe: readonly number[], track: TrackData, s: number): number {
  return interpolateProfile(vSafe, track, s);
}
