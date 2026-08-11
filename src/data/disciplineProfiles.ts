/**
 * Read-only discipline profile seam — branching reads without feel retunes.
 * Values must equal today's legacy `if (discipline === …)` behaviour.
 *
 * PHYSICS keys discipline-multiplied today:
 * - streetWallStunMult (street walls)
 * - deslotMinTime ×1.35 (rally)
 * - deslotScrubGain ×1.2 (rally)
 * - runoffDrag vs runoffDragRally
 * Gearbox gear counts live in Gearbox.ts (street 5 / rally 4 / track 6).
 */
import { PHYSICS } from './physics';
import { getDiscipline, type DisciplineDef, type DisciplineId } from './disciplines';
import { gearboxFor, type GearboxProfile } from '../engine/Gearbox';

export interface DisciplineProfile extends DisciplineDef {
  /** Multiplier on PHYSICS.crashStun for wall hits. */
  wallStunMult: number;
  /** Multiplier on PHYSICS.deslotMinTime. */
  deslotMinTimeMult: number;
  /** Multiplier on PHYSICS.deslotScrubGain while deslotted. */
  deslotScrubMult: number;
  /** Absolute runoff drag decel (m/s²). */
  runoffDrag: number;
  /** Assisted gearbox for this discipline. */
  gearbox: GearboxProfile;
  /** Off-slot drift style (Phase 4) — Mag schedule differs; latch stays off for Track. */
  driftStyle: 'fishtail' | 'looseGround' | 'jdm';
  /** Mag bandwidth multiplier (Rally softer). */
  magBandwidthMult: number;
  /** Extra deslot washout scale (Street walls need bite). */
  deslotWashoutMult: number;
  /** Release impulse scale when peg pops. */
  deslotReleaseMult: number;
}

export function getDisciplineProfile(id: DisciplineId): DisciplineProfile {
  const def = getDiscipline(id);
  return {
    ...def,
    wallStunMult: id === 'street' ? PHYSICS.streetWallStunMult : 1,
    deslotMinTimeMult: id === 'rally' ? 1.35 : 1,
    deslotScrubMult: id === 'rally' ? 1.2 : 1,
    runoffDrag: id === 'rally' ? PHYSICS.runoffDragRally : PHYSICS.runoffDrag,
    gearbox: gearboxFor(id),
    driftStyle: id === 'rally' ? 'looseGround' : id === 'street' ? 'jdm' : 'fishtail',
    magBandwidthMult: id === 'rally' ? 0.78 : id === 'street' ? 0.88 : 1,
    deslotWashoutMult: id === 'street' ? 1.55 : id === 'rally' ? 1.08 : 1,
    deslotReleaseMult: id === 'street' ? 2.1 : 1,
  };
}

/** Legacy-equivalent deslot min time (seconds). */
export function profileDeslotMinTime(id: DisciplineId): number {
  return PHYSICS.deslotMinTime * getDisciplineProfile(id).deslotMinTimeMult;
}
