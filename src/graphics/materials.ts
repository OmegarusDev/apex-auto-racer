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
  /** FX tint for dust (rally) / smoke (street). */
  dustTint: string;
  smokeTint: string;
}

export interface ShellAccent {
  accent: string;
  accentDim: string;
  glow: string;
}

/** Per-discipline atmosphere — Track cool asphalt, Street warm city, Rally dirt. */
const DISCIPLINE_ATMOSPHERE: Record<
  DisciplineId,
  {
    asphalt: string;
    runoff: string;
    nightBg: string;
    dustTint: string;
    smokeTint: string;
    grooveDay: string;
  }
> = {
  track: {
    asphalt: '#16181a',
    runoff: '#22262a',
    nightBg: '#06080c',
    dustTint: 'rgba(180,190,200,0.35)',
    smokeTint: 'rgba(200,205,210,0.4)',
    grooveDay: 'rgba(0,0,0,0.52)',
  },
  street: {
    asphalt: '#2c2420',
    runoff: '#3e342c',
    nightBg: '#0a0608',
    dustTint: 'rgba(160,140,120,0.3)',
    smokeTint: 'rgba(220,210,200,0.55)',
    grooveDay: 'rgba(0,0,0,0.5)',
  },
  rally: {
    asphalt: '#3f342c',
    runoff: '#5a4a3a',
    nightBg: '#0a0806',
    dustTint: 'rgba(196,168,120,0.65)',
    smokeTint: 'rgba(170,150,120,0.35)',
    grooveDay: 'rgba(30,18,8,0.48)',
  },
};

const nightPalettes = {
  rimDark: 'rgba(0,0,0,0.55)',
  rimLight: 'rgba(140,180,255,0.05)',
  groove: 'rgba(0,0,0,0.55)',
  grooveHighlight: 'rgba(180,200,255,0.08)',
  bevel: 'rgba(255,255,255,0.04)',
  nightWash: 'rgba(8,12,28,0.28)',
  wetSheen: 'rgba(120,160,220,0.06)',
} as const;

const dayPalettes = {
  rimDark: 'rgba(0,0,0,0.4)',
  rimLight: 'rgba(255,255,255,0.06)',
  groove: 'rgba(0,0,0,0.45)',
  grooveHighlight: 'rgba(255,255,255,0.07)',
  bevel: 'rgba(255,255,255,0.05)',
  nightWash: 'rgba(0,0,0,0)',
  wetSheen: 'rgba(140,170,200,0.05)',
} as const;

export function buildTrackPalette(
  disciplineId: DisciplineId,
  night: boolean,
  rain = false,
): TrackPalette {
  const d = getDiscipline(disciplineId);
  const atm = DISCIPLINE_ATMOSPHERE[disciplineId];
  const mode = night ? nightPalettes : dayPalettes;
  const groove = d.style.groove ?? (night ? mode.groove : atm.grooveDay);
  return {
    asphalt: atm.asphalt,
    kerbA: d.style.kerbA,
    kerbB: d.style.kerbB,
    runoff: atm.runoff,
    groove,
    grooveHighlight: mode.grooveHighlight,
    rimDark: mode.rimDark,
    rimLight: mode.rimLight,
    bevel: mode.bevel,
    barrier: d.accentDim,
    accent: d.accent,
    accentDim: d.accentDim,
    nightBg: atm.nightBg,
    nightWash: mode.nightWash,
    wetSheen: rain ? mode.wetSheen : 'rgba(0,0,0,0)',
    startLight: '#f2efe6',
    startDark: '#0b0d0c',
    gridDash: 'rgba(242,239,230,0.45)',
    dustTint: atm.dustTint,
    smokeTint: atm.smokeTint,
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

/** One-line QR setup blurb per discipline fantasy. */
export function disciplineQrBlurb(id: DisciplineId): string {
  if (id === 'street') return 'Walls bite · SHIFT while sliding = clutch-kick · watch the rev strip';
  if (id === 'rally') return 'Loose ground · brake-pulse to slide · hold a gear through the dirt';
  return 'High grip · one-finger gas · stay in the groove on bends';
}
