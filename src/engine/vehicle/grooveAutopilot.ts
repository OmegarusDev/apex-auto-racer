/**
 * Groove Mag autopilot — bounded yaw-moment + lateral force actuator.
 * Stands in for the driver's hands (§1.2 / doctrine §1.3b).
 * Never invents free grip: demanded Mag force saturates against tyre budget.
 */
import { PHYSICS } from '../../data/physics';
import { HYBRID_IZ, HYBRID_MASS_KG } from './dynamics';

export interface MagCommand {
  /** Lateral accel Mag applies toward line (m/s²) after saturation. */
  aLat: number;
  /** Yaw moment from Mag (N·m) after saturation. */
  mz: number;
  /** 0 = collapsed (deslot authority), 1 = full. */
  authority: number;
  /** True when Mag demand exceeded tyre budget this tick. */
  saturated: boolean;
  /** Uncapped lateral demand before tyre budget (m/s²). */
  aLatDemand: number;
  /** Rate-limited steer angle (rad) Mag would command. */
  steerRad: number;
}

export interface MagInput {
  l: number;
  /** AI / line Mag setpoint (lateral offset target). */
  steerTarget: number;
  dl: number;
  v: number;
  /** Heading / slip error vs path (rad). */
  headingError: number;
  yawRate: number;
  /** Previous steer (rad) for rate limit. */
  prevSteer: number;
  /** Remaining lateral tyre capacity after long load (m/s²). */
  aLatBudget: number;
  /** Long + corner load kills (0–1 each). */
  longLoad: number;
  cornerLoad: number;
  raceTime: number;
  /** Skill raises Mag bandwidth; Focus tightens tracking (line RPG). */
  skill: number;
  focus?: number;
  dt: number;
}

/**
 * Stanley/PD path tracker → Mag forces, saturated by tyre lateral budget.
 * Uses freeze grooveSpring/Damp as Mag gains so feel gates stay comparable.
 */
export function computeGrooveMag(input: MagInput): MagCommand {
  const {
    l,
    steerTarget,
    dl,
    v,
    headingError,
    yawRate,
    prevSteer,
    aLatBudget,
    longLoad,
    cornerLoad,
    raceTime,
    skill,
    focus = 50,
    dt,
  } = input;

  const roll = Math.max(
    0,
    Math.min(
      1,
      (v - PHYSICS.grooveLatMinV) /
        Math.max(1e-3, PHYSICS.grooveLatFullV - PHYSICS.grooveLatMinV),
    ),
  );

  // Mag schedule: speed roll × long kill × corner kill (same story as pre-hybrid magnet).
  let schedule =
    roll *
    (1 - PHYSICS.grooveLoadKill * longLoad) *
    (1 - PHYSICS.grooveCornerKill * cornerLoad);

  // Skill = Mag bandwidth; Focus = damping quality (doctrine §6) — not free µ.
  const bw = 0.88 + 0.18 * Math.min(1, skill / 100);
  const focusDamp = 0.9 + 0.2 * Math.min(1, focus / 100);
  schedule *= bw;

  if (roll <= 1e-4) {
    return {
      aLat: 0,
      mz: 0,
      authority: 0,
      saturated: false,
      aLatDemand: 0,
      steerRad: 0,
    };
  }

  let spring = PHYSICS.grooveSpring * schedule;
  let damp = PHYSICS.grooveDamp * focusDamp;
  let maxDl = v * PHYSICS.grooveMaxDlPerV;
  if (raceTime < PHYSICS.gridHoldSec) {
    spring *= PHYSICS.gridFollowGainMult;
    maxDl = Math.min(maxDl, PHYSICS.gridMaxDl * roll);
  }

  const errL = steerTarget - l;
  // PD on cross-track + heading (Stanley-lite).
  const aLatRaw = spring * errL - damp * dl + spring * 0.35 * (-headingError) * Math.max(v, 1);
  const aLatDemand = aLatRaw;

  // Steer command from cross-track + heading — rate limited (neuromuscular proxy).
  const steerCmd = Math.max(-0.35, Math.min(0.35, errL * 0.045 + headingError * 0.55));
  const steerRate = 2.8 + 1.2 * Math.min(1, skill / 100);
  const steerRad = prevSteer + Math.max(-steerRate * dt, Math.min(steerRate * dt, steerCmd - prevSteer));

  // Yaw-moment Mag: drive yaw toward path (hands on wheel).
  const mzDemand =
    schedule *
    HYBRID_IZ *
    (4.2 * (-headingError) - 2.4 * yawRate + 0.9 * errL / Math.max(1.5, v));

  // Saturate against tyre budget — Mag cannot invent grip.
  const budget = Math.max(0, aLatBudget);
  const saturated = Math.abs(aLatDemand) > budget + 1e-6;
  let aLat = Math.max(-budget, Math.min(budget, aLatDemand));
  // Also respect max lateral rate of change via maxDl proxy.
  const maxA = maxDl / Math.max(dt, 1e-4);
  aLat = Math.max(-maxA, Math.min(maxA, aLat));

  const mzBudget = budget * HYBRID_MASS_KG * 1.1; // moment capacity proxy from lat force×lever
  const mz = Math.max(-mzBudget, Math.min(mzBudget, mzDemand));

  const authority = schedule * (saturated ? Math.min(1, budget / Math.max(Math.abs(aLatDemand), 1e-3)) : 1);

  return {
    aLat,
    mz,
    authority,
    saturated,
    aLatDemand,
    steerRad,
  };
}

/** Heading error vs path tangent — positive = nose pointed to +l. */
export function headingErrorFromSlip(slipAngle: number, pathYawRate: number, yawRate: number): number {
  // Prefer measured slip; blend yaw tracking error on slow speeds.
  return slipAngle + 0.15 * (yawRate - pathYawRate);
}
