import type { DisciplineId } from './disciplines';

export type ArchetypeId = 'gp' | 'street' | 'oval' | 'rallyLoop';

export interface ArchetypeDef {
  id: ArchetypeId;
  waypointCount: [number, number];
  radialNoise: number;
  elongation: number;
  width: number;
  runoff: number;
  weights: Record<DisciplineId, number>;
}

export const ARCHETYPES: ArchetypeDef[] = [
  {
    id: 'gp',
    waypointCount: [10, 14],
    radialNoise: 0.3,
    elongation: 1.0,
    width: 33,
    runoff: 6,
    weights: { track: 9, street: 0, rally: 0 },
  },
  {
    id: 'street',
    waypointCount: [8, 12],
    radialNoise: 0.45,
    elongation: 1.0,
    width: 27,
    /** A little runoff so the drift character has room before the wall bites. */
    runoff: 4,
    weights: { track: 0, street: 9, rally: 0 },
  },
  {
    id: 'oval',
    waypointCount: [8, 8],
    radialNoise: 0.08,
    elongation: 1.8,
    width: 36,
    runoff: 3,
    weights: { track: 1, street: 0, rally: 0 },
  },
  {
    id: 'rallyLoop',
    waypointCount: [9, 13],
    radialNoise: 0.5,
    elongation: 1.1,
    width: 30,
    /** Open run-off: the loose slides run wide into grass, not walls. */
    runoff: 9,
    weights: { track: 0, street: 0, rally: 9 },
  },
];

/** Known-good oval fallback seed when generation exhausts attempts. */
export const FALLBACK_OVAL_SEED = 0x0a0e1a11;
