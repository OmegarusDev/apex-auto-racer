import { BALANCE } from '../../data/balance';
import type { DisciplineId } from '../../data/disciplines';
import { PHYSICS } from '../../data/physics';
import { interpolateAtSInto } from '../RacingLine';
import type { TrackData } from '../TrackGenerator';
import { contactDeslot } from '../Vehicle';
import {
  bodiesOverlap,
  clampLateralToTrack,
  displaceAlongTrack,
  nodeScratch,
  raceDistance,
} from './trackMath';
import type { RaceCarEntry } from './types';

export interface ContactContext {
  entries: RaceCarEntry[];
  track: TrackData;
  dt: number;
  raceTime: number;
  discipline: DisciplineId;
}

export interface ContactStats {
  overlapFramesDelta: number;
  residualOverlapFramesDelta: number;
}

export function resolveContacts(ctx: ContactContext): ContactStats {
  const { entries, track, dt, raceTime, discipline } = ctx;
  const trackLength = track.length;
  const n = entries.length;
  /** Exact body AABB in track-space — no soft pad that glues packs. */
  const minS = PHYSICS.carLength;
  const minL = PHYSICS.carWidth;
  const iters = Math.max(1, BALANCE.contactIters);
  /** Same-lane closing only; side-by-side / overtakes must not accordion-match. */
  const proxS = PHYSICS.carLength + BALANCE.followMinGap * 0.85;
  /** Match traffic-brain lane sense so soft bumper covers shared racing lines. */
  const proxL = PHYSICS.carWidth * 0.58;
  /** Centers inside this share a lane — stack in S, never peel-through. */
  const laneShareL = PHYSICS.carWidth * 0.48;
  /** Soften stun / drive-kill while the pack is still clearing grid columns. */
  const launchSoft = raceTime < PHYSICS.gridHoldSec;
  const launchStunScale = launchSoft ? 0.2 : 1;
  const launchBlockThresh = launchSoft ? 0.85 : 0.5;

  let overlapFramesDelta = 0;
  let residualOverlapFramesDelta = 0;

  let hadOverlap = false;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (bodiesOverlap(entries[i]!.car, entries[j]!.car, trackLength)) {
        hadOverlap = true;
        break;
      }
    }
    if (hadOverlap) break;
  }
  if (hadOverlap) overlapFramesDelta += 1;

  for (let iter = 0; iter < iters; iter++) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = entries[i]!;
        const b = entries[j]!;

        const dS = raceDistance(b.car, trackLength) - raceDistance(a.car, trackLength);
        const absS = Math.abs(dS);
        // Far along-track: neither soft bumper nor solid AABB can fire.
        if (absS >= proxS) continue;
        const dL = b.car.l - a.car.l;
        const absL = Math.abs(dL);
        if (absL >= minL) continue;

        let leader: RaceCarEntry;
        let follower: RaceCarEntry;
        if (dS > 0) {
          leader = b;
          follower = a;
        } else if (dS < 0) {
          leader = a;
          follower = b;
        } else {
          leader = a;
          follower = b;
        }

        // Soft bumper match — same lane only, never marks blocked (draft glue killer).
        // Applies to player + AI so pin-throttle cannot tunnel a leader.
        // Skip only when already clear of the lane for a pass.
        if (absS < proxS && absS >= minS && absL < proxL) {
          const gap = absS - minS;
          const closing = follower.car.v - leader.car.v;
          if (closing > 0.6 && gap < BALANCE.followMinGap * 1.1) {
            const cap =
              gap < BALANCE.followMinGap * 0.35
                ? BALANCE.contactSpeedCap
                : Math.min(1, BALANCE.contactSpeedCap + 0.06);
            follower.car.v = Math.min(follower.car.v, leader.car.v * cap);
          }
        }

        if (absS >= minS || absL >= minL) continue;

        const penS = minS - absS;
        const penL = minL - absL;
        // Line behaviour: shared lane stacks in S. Peel only once cars are
        // already offset for a pass — otherwise they phantom-slide past.
        const separateLateral = absL >= laneShareL;
        const closing = follower.car.v - leader.car.v;

        if (separateLateral) {
          // Geometric peel + tiny epsilon so float residual cannot re-overlap.
          const push = penL * 0.5 + 1e-3;
          const sign = absL < 1e-6 ? 1 : Math.sign(dL);
          a.car.l -= sign * push;
          b.car.l += sign * push;
          clampLateralToTrack(a.car, track);
          clampLateralToTrack(b.car, track);
          a.car.lTarget = a.car.l;
          b.car.lTarget = b.car.l;
          a.brainOut.lTarget = a.car.l;
          b.brainOut.lTarget = b.car.l;

          // Lateral impulse from relative long speed + penetration — keep dl alive
          // on mild rubs so side-by-side racing doesn't feel sticky/teleported.
          const sideRel = Math.abs(closing);
          const sideSeverity = Math.max(
            0,
            Math.min(1, sideRel / BALANCE.contactDeslotClosing + penL / 2.2),
          );
          const latImpulse = (0.35 + 1.8 * sideSeverity) * Math.sign(sign);
          if (a.car.slotMode === 'deslot') a.car.dl -= latImpulse * 0.55;
          if (b.car.slotMode === 'deslot') b.car.dl += latImpulse * 0.55;
          // Groove cars: damp only hard slams; mild peel keeps natural lateral rate.
          if (sideSeverity > 0.45) {
            if (a.car.slotMode === 'groove') a.car.dl *= 0.35;
            if (b.car.slotMode === 'groove') b.car.dl *= 0.35;
          }

          if (sideSeverity > 0.25) {
            // Partial momentum share — not a full stop for both.
            const avgV = 0.5 * (a.car.v + b.car.v);
            const scrub = 1 - 0.1 * sideSeverity * (launchSoft ? 0.35 : 1);
            a.car.v = (a.car.v * 0.55 + avgV * 0.45) * scrub;
            b.car.v = (b.car.v * 0.55 + avgV * 0.45) * scrub;
            a.car.stunRemaining = Math.max(
              a.car.stunRemaining,
              0.1 * sideSeverity * launchStunScale,
            );
            b.car.stunRemaining = Math.max(
              b.car.stunRemaining,
              0.1 * sideSeverity * launchStunScale,
            );
            // Only hard side hits block AI drive — clean side-by-side must race.
            if (sideSeverity > launchBlockThresh) {
              a.contactBlocked = true;
              b.contactBlocked = true;
            }
            if (
              !launchSoft &&
              sideSeverity > 0.55 &&
              sideRel > BALANCE.contactCrashClosing * 0.6
            ) {
              const victim = a.car.v <= b.car.v ? a : b;
              const pushDir = victim === a ? -sign : sign;
              contactDeslot(
                victim.car,
                pushDir * (1.2 + sideSeverity),
                sideSeverity,
                discipline,
              );
              if (victim.car.isPlayerControlled) {
                victim.car.condition = Math.max(
                  BALANCE.conditionMin,
                  victim.car.condition - BALANCE.contactCrashConditionLoss * sideSeverity,
                );
              }
            }
          }
          // Mild peel: geometry only — keep both cars driving side-by-side.
        } else {
          // Rear-end / line block: separate along track, then inelastic match.
          const pushBack = penS * 0.9;
          const pushFwd = penS * 0.1;
          displaceAlongTrack(follower.car, -pushBack, trackLength);
          displaceAlongTrack(leader.car, pushFwd, trackLength);

          if (closing > 0) {
            const severity = Math.max(
              0,
              Math.min(1, (closing - 0.35) / BALANCE.contactCrashClosing),
            );
            // Follower dumps closing speed; leader gets a fraction (inelastic bump).
            const transfer = closing * (BALANCE.contactBounce + 0.35 * severity);
            const followerDrop = closing * (0.55 + 0.4 * severity) * (launchSoft ? 0.5 : 1);
            follower.car.v = Math.max(0, follower.car.v - followerDrop);
            leader.car.v += transfer * (launchSoft ? 0.45 : 1);
            // Hard speed match — no residual tunnel through the leader.
            follower.car.v = Math.min(
              follower.car.v,
              Math.max(0, leader.car.v * BALANCE.contactSpeedCap),
            );

            if (severity > 0.22) {
              follower.car.stunRemaining = Math.max(
                follower.car.stunRemaining,
                (0.14 + 0.35 * severity) * launchStunScale,
              );
              leader.car.stunRemaining = Math.max(
                leader.car.stunRemaining,
                (0.06 + 0.14 * severity) * launchStunScale,
              );
              const node = interpolateAtSInto(
                track.nodes,
                trackLength,
                follower.car.s,
                nodeScratch,
              );
              const curved =
                Math.abs(node.kappaLine) >= PHYSICS.grooveKappaMin * 0.7;
              // Hard rear-end can scrub/deslot — bends easier, straights need more.
              if (!launchSoft && severity > (curved ? 0.55 : 0.78)) {
                contactDeslot(
                  follower.car,
                  Math.sign(follower.car.l || 1) * (0.7 + 0.6 * severity),
                  severity,
                  discipline,
                );
              }
              if (
                follower.car.isPlayerControlled &&
                severity >= BALANCE.contactConditionSeverityMin
              ) {
                follower.car.condition = Math.max(
                  BALANCE.conditionMin,
                  follower.car.condition - BALANCE.contactCrashConditionLoss * severity,
                );
                follower.car.contactHits += 1;
              }
            }
            // Stacked in-lane → AI must lift / look for a pass.
            if (!launchSoft || penS > PHYSICS.carLength * 0.2) {
              follower.contactBlocked = true;
            }
          } else {
            follower.car.v = Math.min(follower.car.v, leader.car.v * BALANCE.contactSpeedCap);
            if (!launchSoft || penS > PHYSICS.carLength * 0.1) follower.contactBlocked = true;
          }
        }

        // Lateral nudge only for cars already offset into a pass lane.
        // Same-lane stacks must not be walked sideways into a phantom slide.
        if (separateLateral && Math.abs(b.car.l - a.car.l) < minL) {
          const sign = a.car.l >= b.car.l ? 1 : -1;
          const nudge = BALANCE.contactNudge * dt;
          a.car.l += sign * nudge;
          b.car.l -= sign * nudge;
          clampLateralToTrack(a.car, track);
          clampLateralToTrack(b.car, track);
          a.car.lTarget = a.car.l;
          b.car.lTarget = b.car.l;
          a.brainOut.lTarget = a.car.l;
          b.brainOut.lTarget = b.car.l;
        }
      }
    }
  }

  let residual = false;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (bodiesOverlap(entries[i]!.car, entries[j]!.car, trackLength)) {
        residual = true;
        break;
      }
    }
    if (residual) break;
  }
  if (residual) residualOverlapFramesDelta += 1;

  return { overlapFramesDelta, residualOverlapFramesDelta };
}
