/**
 * Axle load transfer — the engineer's bread and butter.
 * Static weight + aero downforce, then pitch (accel/brake) and roll
 * (lateral) transfer, with a load-sensitivity grip penalty on roll.
 * Real-car: no magnet; downforce is pure aero.
 */
import { PHYSICS } from '../../data/physics';
import type { CarSetup } from '../vehicle/CarSetup';

export const RHO = 1.225;

export interface AeroState {
  downforceN: number;
  dragN: number;
}

/** Downforce + drag from speed, CL/CD and setup. */
export function aeroForces(v: number, setup: CarSetup): AeroState {
  const q = 0.5 * RHO * v * v;
  const cl = (setup.clScale ?? 1) * 0.35;
  const cd = (setup.cdScale ?? 1) * 0.32;
  return { downforceN: q * cl, dragN: q * cd };
}

export interface AxleLoads {
  fzFront: number;
  fzRear: number;
  fzTotal: number;
}

export interface LoadInputs {
  massKg: number;
  cgHeight: number;
  staticFront: number;
  wheelbase: number;
  trackWidth: number;
  suspStiffness: number;
  aLong: number;
  aLat: number;
  aeroDownforceN: number;
  /** Load-sensitivity exponent n<1 — doubling Fz does not double Fy. */
  loadSens: number;
}

/**
 * Quasi-steady pitch + roll load transfer.
 * aLong>0 = accelerating (rear loads), aLat = lateral g (outside loads).
 * Roll reduces TOTAL effective grip via the load-sensitivity penalty
 * (collapsed into an axle-level grip reduction below).
 */
export function computeAxleLoads(input: LoadInputs): AxleLoads {
  const { massKg, cgHeight, staticFront, wheelbase, trackWidth, suspStiffness } = input;
  const g = PHYSICS.g;
  const fzStatic = massKg * g + input.aeroDownforceN;

  const pitch = (massKg * input.aLong * cgHeight) / Math.max(0.5, wheelbase);
  const rollRaw = (massKg * Math.abs(input.aLat) * cgHeight) / Math.max(0.5, trackWidth);
  const rollFrac = Math.min(0.32, (rollRaw / Math.max(fzStatic, 1)) * (1.12 - 0.22 * suspStiffness));

  let fzFront = fzStatic * staticFront - pitch;
  let fzRear = fzStatic * (1 - staticFront) + pitch;
  // Roll collapse: unload the inside (reduces total usable grip via n<1).
  const rollUnload = fzStatic * rollFrac * 0.5;
  fzFront = Math.max(massKg * g * 0.06, fzFront - rollUnload * 0.45);
  fzRear = Math.max(massKg * g * 0.06, fzRear - rollUnload * 0.55);

  return { fzFront, fzRear, fzTotal: fzFront + fzRear };
}

/** Load-sensitivity grip scale for an axle given its share of total load. */
export function loadSensGrip(fz: number, fzRef: number, n: number): number {
  const ref = Math.max(1, fzRef);
  return Math.pow(Math.max(0.05, fz / ref), n);
}
