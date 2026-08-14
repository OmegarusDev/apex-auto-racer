/** Car factory + profile helpers. */
import { PHYSICS } from '../../data/physics';
import type { DisciplineId } from '../../data/disciplines';
import type { Driver, EffectiveStats } from '../types';
import type { Modifier } from '../modifiers';
import type { TrackData } from '../TrackGenerator';
import type { CarSimState, VehicleUpdateContext } from './types';
import { DEFAULT_CAR_SETUP, type CarSetup } from './CarSetup';

/** Determination catch-up scalar (plan 7.1). */
export function computeSDet(determination: number, position: number, totalCars: number): number {
  if (totalCars <= 1) return 1;
  return 1 + PHYSICS.detBonus * (determination / 100) * ((position - 1) / (totalCars - 1));
}

/** Piecewise-linear profile interpolation on the track nodes. */
export function interpolateProfile(profile: readonly number[], track: TrackData, s: number): number {
  const n = profile.length;
  if (n === 0) return 0;
  let distS = s % track.length;
  if (distS < 0) distS += track.length;

  let i0 = 0;
  if (distS > track.nodes[0]!.s) {
    let lo = 0;
    let hi = n - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (track.nodes[mid]!.s <= distS) lo = mid;
      else hi = mid;
    }
    i0 = lo;
  }
  const i1 = (i0 + 1) % n;
  const s0 = track.nodes[i0]!.s;
  const s1 = i1 === 0 ? track.length : track.nodes[i1]!.s;
  const ds = s1 - s0;
  const t = ds > 1e-6 ? (distS - s0) / ds : 0;
  return profile[i0]! * (1 - t) + profile[i1]! * t;
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
    authority,
    vDeslot: 0,
    yawRate: 0,
    steerRad: 0,
    fzFront: 0,
    fzRear: 0,
    gearBand: 0,
    shiftWindow: 'low',
    clutchKickRemaining: 0,
    setup,
    driftArmed: false,
    holdGear: false,
    alphaFront: 0,
    alphaRear: 0,
    headingErr: 0,
    lastLateralG: 0,
    tyreWear: 0,
    penaltySec: 0,
    stuckTime: 0,
    stuckS: 0,
    noiseSeed: (id.charCodeAt(0) * 2654435761) >>> 0,
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


