import { PHYSICS } from '../../data/physics';
import {
  interpolateAtSInto,
  type InterpolatedNode,
} from '../RacingLine';
import type { TrackData } from '../TrackGenerator';
import { wallLimitFor } from '../Vehicle';
import type { CarSimState } from '../Vehicle';

/** Scratch node for hot-path track lookups (no per-call alloc). */
export const nodeScratch: InterpolatedNode = {
  pos: { x: 0, y: 0 },
  tangent: { x: 1, y: 0 },
  normal: { x: 0, y: 1 },
  width: 0,
  runoffWidth: 0,
  kappa: 0,
  kappaLine: 0,
  o: 0,
  s: 0,
};

export function raceDistance(car: CarSimState, trackLength: number): number {
  return car.lap * trackLength + car.s;
}

export function arcGap(follower: CarSimState, leader: CarSimState, trackLength: number): number {
  const gap = raceDistance(leader, trackLength) - raceDistance(follower, trackLength);
  return gap - PHYSICS.carLength;
}

/** Set arc-length progress from a non-negative race distance (handles lap wrap). */
export function setRaceDistance(car: CarSimState, dist: number, trackLength: number): void {
  const d = Math.max(0, dist);
  const lap = Math.floor(d / trackLength);
  car.lap = lap;
  car.s = d - lap * trackLength;
  if (car.s < 0) car.s += trackLength;
}

export function displaceAlongTrack(car: CarSimState, delta: number, trackLength: number): void {
  setRaceDistance(car, raceDistance(car, trackLength) + delta, trackLength);
}

export function clampLateralToTrack(car: CarSimState, track: TrackData): void {
  const node = interpolateAtSInto(track.nodes, track.length, car.s, nodeScratch);
  const wallLimit = wallLimitFor(node.width, node.runoffWidth);
  if (Math.abs(car.l) > wallLimit) {
    car.l = Math.sign(car.l || 1) * wallLimit;
  }
}

/** True when AABB footprints overlap in track-space (s,l). */
export function bodiesOverlap(a: CarSimState, b: CarSimState, trackLength: number): boolean {
  const dS = Math.abs(raceDistance(b, trackLength) - raceDistance(a, trackLength));
  if (dS >= PHYSICS.carLength) return false;
  return Math.abs(b.l - a.l) < PHYSICS.carWidth;
}
