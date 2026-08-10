/**
 * Shared product brand — menus + race chrome read from one visual language.
 * Pit-night asphalt + signal amber (not cyan-on-zinc).
 */

import type { DisciplineId } from '../data/disciplines';
import { getDiscipline } from '../data/disciplines';
import type { ThemeTokens } from './theme';

/** Condensed timing-board display. Loaded via index.html Google Fonts. */
export const BRAND_DISPLAY_FONT =
  '"Bebas Neue", "Arial Narrow", "Helvetica Neue Condensed", Impact, sans-serif';

export const BRAND_BODY_FONT =
  '"IBM Plex Sans", "Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif';

export const BRAND_WORDMARK = 'APEX';

/** Default product accent when no discipline is active (title / splash). */
export const BRAND_SIGNAL = '#f0c41a';

export function brandAccent(discipline: DisciplineId): string {
  return getDiscipline(discipline).accent;
}

export function brandAccentDim(discipline: DisciplineId): string {
  return getDiscipline(discipline).accentDim;
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  if (!Number.isFinite(n)) return `rgba(240,196,26,${alpha})`;
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Soft tabletop / pit atmosphere shared by shell menus. */
export function drawBrandAtmosphere(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  token: ThemeTokens,
  accent?: string,
): void {
  ctx.fillStyle = token.bg;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  // Overhead bay light — warm sodium wash from upper third.
  const bay = ctx.createRadialGradient(
    w * 0.42,
    h * 0.08,
    0,
    w * 0.48,
    h * 0.28,
    Math.max(w, h) * 0.78,
  );
  bay.addColorStop(0, accent ? hexToRgba(accent, 0.14) : 'rgba(240,196,26,0.1)');
  bay.addColorStop(0.35, 'rgba(28, 36, 30, 0.22)');
  bay.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = bay;
  ctx.fillRect(0, 0, w, h);

  // Corner spill — cool asphalt edge so the bay doesn't flatten.
  const corner = ctx.createRadialGradient(w * 0.92, h * 0.88, 0, w * 0.92, h * 0.88, w * 0.55);
  corner.addColorStop(0, 'rgba(18, 40, 48, 0.28)');
  corner.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = corner;
  ctx.fillRect(0, 0, w, h);

  const bottom = ctx.createLinearGradient(0, h * 0.55, 0, h);
  bottom.addColorStop(0, 'rgba(0,0,0,0)');
  bottom.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = bottom;
  ctx.fillRect(0, h * 0.55, w, h * 0.45);

  // Fine asphalt grit (deterministic, cheap).
  ctx.globalAlpha = 0.045;
  ctx.fillStyle = '#ffffff';
  const step = Math.max(7, Math.floor(Math.min(w, h) / 64));
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      if (((x * 37 + y * 17) % 11) < 3) {
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  ctx.globalAlpha = 1;

  // Lane markers — horizontal hairlines, not card chrome.
  ctx.strokeStyle = 'rgba(242,239,230,0.035)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    const gy = h * (0.16 + i * 0.15);
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.lineTo(w, gy);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawBrandWordmark(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  token: ThemeTokens,
  accent: string,
  size = token.fontHero,
): void {
  ctx.save();
  ctx.font = `400 ${size}px ${token.fontDisplayFamily}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = token.text;
  ctx.fillText(BRAND_WORDMARK, x, y);
  const tw = ctx.measureText(BRAND_WORDMARK).width;
  ctx.fillStyle = accent;
  ctx.fillRect(x, y + size * 0.08, tw, Math.max(3, size * 0.07));
  ctx.restore();
}
