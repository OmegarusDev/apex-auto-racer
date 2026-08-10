import type { DisciplineId } from '../data/disciplines';

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
  /** Hero wordmark size — viewport-aware, for title/brand surfaces. */
  fontHero: number;
  fontFamily: string;
  /** Condensed stack for titles / headers (Title-grade). */
  fontDisplayFamily: string;
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

  const short = Math.min(w, h);
  const long = Math.max(w, h);
  // Fluid UI scale: short edge drives density; slight boost when the long edge
  // has room so desktop/tablet don't feel sparse or cramped.
  const base = short / BASE_MIN;
  const room = Math.min(1.12, 0.92 + (long / 1400) * 0.2);
  const scale = Math.max(0.7, Math.min(1.35, base * room));

  // Hero wordmark tracks the readable width, not only the short edge — so
  // portrait phones get a strong brand and ultrawide doesn't explode.
  const heroFromW = Math.min(w * 0.14, h * 0.09, 72);
  const fontHero = Math.max(36, Math.min(72, heroFromW * (0.85 + scale * 0.25)));

  cachedTheme = {
    scale,
    grid: 8 * scale,
    touchMin: Math.max(44, Math.min(52, 44 * scale)),
    // Floors keep titles readable at the 0.7 scale clamp.
    fontDisplay: Math.max(22, 32 * scale),
    fontTitle: Math.max(18, 24 * scale),
    fontBody: Math.max(14, 16 * scale),
    fontCaption: Math.max(11, 12 * scale),
    fontHero,
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    fontDisplayFamily:
      '"Arial Narrow", "Helvetica Neue Condensed", "Roboto Condensed", Impact, "Arial Black", sans-serif',
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

/**
 * Header control band height (excluding safe.top).
 * Visual track heights must NOT use touchMin — only hit targets should.
 */
export function headerContentH(token: ThemeTokens): number {
  return Math.max(token.touchMin, pad(token, 6.5));
}

/** Y where header controls (back/title/cash) are vertically centered. */
export function headerContentTop(token: ThemeTokens): number {
  return token.safe.top;
}

/** Full header chrome height including safe inset. */
export function headerBandH(token: ThemeTokens): number {
  return token.safe.top + headerContentH(token);
}

export function accentForDiscipline(id: DisciplineId): string {
  return ACCENTS[id];
}
