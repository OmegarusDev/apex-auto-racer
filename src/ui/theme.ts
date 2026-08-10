import type { DisciplineId } from '../data/disciplines.ts';

/** Reference viewport short edge for token scaling. */
const BASE_MIN = 720;

export const ACCENT_TRACK = '#22d3ee';
export const ACCENT_STREET = '#fbbf24';
export const ACCENT_RALLY = '#fb923c';

export const ACCENTS: Record<DisciplineId, string> = {
  track: ACCENT_TRACK,
  street: ACCENT_STREET,
  rally: ACCENT_RALLY,
};

export interface SafeAreaInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ThemeTokens {
  scale: number;
  grid: number;
  touchMin: number;
  fontDisplay: number;
  fontTitle: number;
  fontBody: number;
  fontCaption: number;
  fontFamily: string;
  bg: string;
  bgElevated: string;
  card: string;
  cardStroke: string;
  text: string;
  textMuted: string;
  textDim: string;
  disabled: string;
  disabledBg: string;
  overlay: string;
  danger: string;
  success: string;
  safe: SafeAreaInsets;
}

let cachedSafe: SafeAreaInsets | null = null;

function parsePx(value: string): number {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

/** Read safe-area insets once; call `invalidateSafeArea()` on resize/orientation. */
export function readSafeAreaInsets(): SafeAreaInsets {
  if (cachedSafe !== null) return cachedSafe;
  if (typeof document === 'undefined') {
    cachedSafe = { top: 0, right: 0, bottom: 0, left: 0 };
    return cachedSafe;
  }

  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;top:0;left:0;width:0;height:0;padding-top:env(safe-area-inset-top,0px);padding-right:env(safe-area-inset-right,0px);padding-bottom:env(safe-area-inset-bottom,0px);padding-left:env(safe-area-inset-left,0px);pointer-events:none;visibility:hidden;';
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  cachedSafe = {
    top: parsePx(cs.paddingTop),
    right: parsePx(cs.paddingRight),
    bottom: parsePx(cs.paddingBottom),
    left: parsePx(cs.paddingLeft),
  };
  document.body.removeChild(probe);
  return cachedSafe;
}

let cachedTheme: ThemeTokens | null = null;
let cachedThemeW = -1;
let cachedThemeH = -1;

export function invalidateSafeArea(): void {
  cachedSafe = null;
  cachedTheme = null;
  cachedThemeW = -1;
  cachedThemeH = -1;
}

export function createTheme(w: number, h: number): ThemeTokens {
  if (cachedTheme !== null && cachedThemeW === w && cachedThemeH === h) {
    return cachedTheme;
  }

  const min = Math.min(w, h);
  const scale = Math.max(0.75, Math.min(1.25, min / BASE_MIN));

  cachedTheme = {
    scale,
    grid: 8 * scale,
    touchMin: Math.max(44, 44 * scale),
    fontDisplay: 32 * scale,
    fontTitle: 24 * scale,
    fontBody: 16 * scale,
    fontCaption: 12 * scale,
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    bg: '#0a0a0c',
    bgElevated: '#121216',
    card: '#16161a',
    cardStroke: '#2a2a32',
    text: '#f4f4f5',
    textMuted: '#a1a1aa',
    textDim: '#71717a',
    disabled: '#52525b',
    disabledBg: '#1c1c22',
    overlay: 'rgba(0,0,0,0.72)',
    danger: '#f87171',
    success: '#4ade80',
    safe: readSafeAreaInsets(),
  };
  cachedThemeW = w;
  cachedThemeH = h;
  return cachedTheme;
}

/** Snap a length to the 8px grid (scaled). */
export function snapGrid(token: ThemeTokens, value: number): number {
  const g = token.grid;
  return Math.round(value / g) * g;
}

/** Padding helper: n grid units. */
export function pad(token: ThemeTokens, units = 1): number {
  return token.grid * units;
}

export function accentForDiscipline(id: DisciplineId): string {
  return ACCENTS[id];
}
