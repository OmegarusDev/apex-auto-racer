export type DisciplineId = 'track' | 'street' | 'rally';

export interface DisciplineDef {
  id: DisciplineId;
  name: string;
  accent: string;
  accentDim: string;
  muSurface: number;
  baseStats: {
    topSpeed: number;
    acceleration: number;
    braking: number;
    grip: number;
    downforce: number;
  };
  style: {
    asphalt: string;
    kerbA: string;
    kerbB: string;
    runoff: string;
    /** Center-groove channel tint for TrackBaker Scalextric rail. */
    groove?: string;
  };
}

export const DISCIPLINES: DisciplineDef[] = [
  {
    id: 'track',
    name: 'Track',
    accent: '#22d3ee',
    accentDim: '#0e7490',
    muSurface: 1.0,
    baseStats: {
      topSpeed: 48,
      acceleration: 42,
      braking: 45,
      grip: 50,
      downforce: 55,
    },
    style: {
      asphalt: '#1a1a1e',
      kerbA: '#3b82f6',
      kerbB: '#f8fafc',
      runoff: '#2a2a30',
      groove: 'rgba(0,0,0,0.5)',
    },
  },
  {
    id: 'street',
    name: 'Street',
    accent: '#fbbf24',
    accentDim: '#b45309',
    muSurface: 0.85,
    baseStats: {
      topSpeed: 40,
      acceleration: 52,
      braking: 55,
      grip: 48,
      downforce: 30,
    },
    style: {
      asphalt: '#2c2c2e',
      kerbA: '#eab308',
      kerbB: '#fefce8',
      runoff: '#3a3a3c',
      groove: 'rgba(0,0,0,0.48)',
    },
  },
  {
    id: 'rally',
    name: 'Rally',
    accent: '#fb923c',
    accentDim: '#c2410c',
    muSurface: 0.6,
    baseStats: {
      topSpeed: 35,
      acceleration: 58,
      braking: 42,
      grip: 45,
      downforce: 20,
    },
    style: {
      asphalt: '#5c4033',
      kerbA: '#a16207',
      kerbB: '#fef3c7',
      runoff: '#6b5344',
      groove: 'rgba(20,10,0,0.45)',
    },
  },
];

export function getDiscipline(id: DisciplineId): DisciplineDef {
  const d = DISCIPLINES.find((x) => x.id === id);
  if (!d) throw new Error(`Unknown discipline ${id}`);
  return d;
}
