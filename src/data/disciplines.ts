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
    accent: '#f0c41a',
    accentDim: '#a88410',
    muSurface: 1.0,
    baseStats: {
      topSpeed: 48,
      acceleration: 42,
      braking: 45,
      grip: 50,
      downforce: 55,
    },
    style: {
      asphalt: '#1a1c1a',
      kerbA: '#f0c41a',
      kerbB: '#f2efe6',
      runoff: '#262b28',
      groove: 'rgba(0,0,0,0.5)',
    },
  },
  {
    id: 'street',
    name: 'Street',
    accent: '#ff5e3a',
    accentDim: '#b83a22',
    muSurface: 0.85,
    baseStats: {
      topSpeed: 40,
      acceleration: 52,
      braking: 55,
      grip: 48,
      downforce: 30,
    },
    style: {
      asphalt: '#2a2624',
      kerbA: '#ff5e3a',
      kerbB: '#f2efe6',
      runoff: '#3a3430',
      groove: 'rgba(0,0,0,0.48)',
    },
  },
  {
    id: 'rally',
    name: 'Rally',
    accent: '#5ecf8e',
    accentDim: '#2f8a58',
    muSurface: 0.6,
    baseStats: {
      topSpeed: 35,
      acceleration: 58,
      braking: 42,
      grip: 45,
      downforce: 20,
    },
    style: {
      asphalt: '#3a322c',
      kerbA: '#5ecf8e',
      kerbB: '#f2efe6',
      runoff: '#4a4038',
      groove: 'rgba(20,10,0,0.45)',
    },
  },
];

export function getDiscipline(id: DisciplineId): DisciplineDef {
  const d = DISCIPLINES.find((x) => x.id === id);
  if (!d) throw new Error(`Unknown discipline ${id}`);
  return d;
}
