/**
 * Shared product brand — menus + race chrome read from one visual language.
 */

import type { DisciplineId } from '../data/disciplines';
import { getDiscipline } from '../data/disciplines';
import type { ThemeTokens } from './theme';

/** Condensed display stack that falls back cleanly on iOS/Android. */
export const BRAND_DISPLAY_FONT =
  '"Arial Narrow", "Helvetica Neue Condensed", "Roboto Condensed", "Franklin Gothic Medium", Impact, sans-serif';

export const BRAND_BODY_FONT =
  '"Trebuchet MS", "Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif';

export const BRAND_WORDMARK = 'APEX';

export function brandAccent(discipline: DisciplineId): string {
  return getDiscipline(discipline).accent;
}

export function brandAccentDim(discipline: DisciplineId): string {
  return getDiscipline(discipline).accentDim;
}

/** Soft tabletop atmosphere shared by shell menus. */
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
  const warm = ctx.createRadialGradient(
    w * 0.5,
    h * 0.22,
    0,
    w * 0.5,
    h * 0.38,
    Math.max(w, h) * 0.72,
  );
  warm.addColorStop(0, accent ? `${accent}18` : 'rgba(40, 32, 26, 0.32)');
  warm.addColorStop(0.4, 'rgba(18, 18, 24, 0.14)');
  warm.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = warm;
  ctx.fillRect(0, 0, w, h);

  const bottom = ctx.createLinearGradient(0, h * 0.62, 0, h);
  bottom.addColorStop(0, 'rgba(0,0,0,0)');
  bottom.addColorStop(1, 'rgba(0,0,0,0.42)');
  ctx.fillStyle = bottom;
  ctx.fillRect(0, h * 0.62, w, h * 0.38);

  // Fine grain plate lines — tabletop read without cards.
  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 6; i++) {
    const gy = h * (0.12 + i * 0.14);
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
  ctx.font = `900 ${size}px ${token.fontDisplayFamily}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = token.text;
  ctx.fillText(BRAND_WORDMARK, x, y);
  const w = ctx.measureText(BRAND_WORDMARK).width;
  ctx.fillStyle = accent;
  ctx.fillRect(x, y + size * 0.12, w, Math.max(2, size * 0.06));
  ctx.restore();
}
