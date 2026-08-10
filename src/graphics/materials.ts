import { getDiscipline, type DisciplineDef, type DisciplineId } from '../data/disciplines';

/** Pre-built CSS colors for bake + runtime — built once at prepare. */
export interface TrackPalette {
  asphalt: string;
  kerbA: string;
  kerbB: string;
  runoff: string;
  groove: string;
  grooveHighlight: string;
  rimDark: string;
  rimLight: string;
  bevel: string;
  barrier: string;
  accent: string;
  accentDim: string;
  nightBg: string;
  nightWash: string;
  wetSheen: string;
  startLight: string;
  startDark: string;
  gridDash: string;
}

export interface ShellAccent {
  accent: string;
  accentDim: string;
  glow: string;
}

const nightPalettes = {
  rimDark: 'rgba(0,0,0,0.55)',
  rimLight: 'rgba(140,180,255,0.05)',
  groove: 'rgba(0,0,0,0.55)',
  grooveHighlight: 'rgba(180,200,255,0.08)',
  bevel: 'rgba(255,255,255,0.04)',
  nightBg: '#07070a',
  nightWash: 'rgba(8,12,28,0.28)',
  wetSheen: 'rgba(120,160,220,0.06)',
} as const;

const dayPalettes = {
  rimDark: 'rgba(0,0,0,0.4)',
  rimLight: 'rgba(255,255,255,0.06)',
  groove: 'rgba(0,0,0,0.45)',
  grooveHighlight: 'rgba(255,255,255,0.07)',
  bevel: 'rgba(255,255,255,0.05)',
  nightBg: '#0a0a0c',
  nightWash: 'rgba(0,0,0,0)',
  wetSheen: 'rgba(140,170,200,0.05)',
} as const;

export function buildTrackPalette(
  disciplineId: DisciplineId,
  night: boolean,
  rain = false,
): TrackPalette {
  const d = getDiscipline(disciplineId);
  const mode = night ? nightPalettes : dayPalettes;
  const groove = d.style.groove ?? mode.groove;
  return {
    asphalt: d.style.asphalt,
    kerbA: d.style.kerbA,
    kerbB: d.style.kerbB,
    runoff: d.style.runoff,
    groove,
    grooveHighlight: mode.grooveHighlight,
    rimDark: mode.rimDark,
    rimLight: mode.rimLight,
    bevel: mode.bevel,
    barrier: d.accentDim,
    accent: d.accent,
    accentDim: d.accentDim,
    nightBg: mode.nightBg,
    nightWash: mode.nightWash,
    wetSheen: rain ? mode.wetSheen : 'rgba(0,0,0,0)',
    startLight: '#f8fafc',
    startDark: '#111114',
    gridDash: 'rgba(244,244,245,0.45)',
  };
}

export function shellAccentFor(disciplineId: DisciplineId): ShellAccent {
  const d = getDiscipline(disciplineId);
  return {
    accent: d.accent,
    accentDim: d.accentDim,
    glow: `${d.accent}33`,
  };
}

export function disciplineFromDef(d: DisciplineDef): ShellAccent {
  return { accent: d.accent, accentDim: d.accentDim, glow: `${d.accent}33` };
}
