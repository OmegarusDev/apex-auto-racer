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
    width: 12,
    runoff: 6,
    weights: { track: 5, street: 1, rally: 0 },
  },
  {
    id: 'street',
    waypointCount: [8, 12],
    radialNoise: 0.45,
    elongation: 1.0,
    width: 10,
    runoff: 0,
    weights: { track: 1, street: 5, rally: 1 },
  },
  {
    id: 'oval',
    waypointCount: [8, 8],
    radialNoise: 0.08,
    elongation: 1.8,
    width: 13,
    runoff: 3,
    weights: { track: 2, street: 1, rally: 0 },
  },
  {
    id: 'rallyLoop',
    waypointCount: [9, 13],
    radialNoise: 0.5,
    elongation: 1.1,
    width: 11,
    runoff: 4,
    weights: { track: 0, street: 1, rally: 5 },
  },
];

/** Known-good oval fallback seed when generation exhausts attempts. */
export const FALLBACK_OVAL_SEED = 0x0a0e1a11;
