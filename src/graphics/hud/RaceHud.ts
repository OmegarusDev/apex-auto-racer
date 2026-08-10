/**
 * Race HUD helpers — minimap lives on RaceView; chrome helpers here.
 * Keep draw-only; teach predicates stay in RaceFantasyHud / RaceScene.
 */

import type { ThemeTokens } from '../../ui/theme';
import { pad } from '../../ui/theme';

export function drawPedalEdgeTint(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  throttle: number,
  brake: number,
  token: ThemeTokens,
): void {
  if (throttle <= 0.05 && brake <= 0.05) return;
  ctx.save();
  if (throttle > 0.05) {
    const g = ctx.createLinearGradient(w, 0, w - pad(token, 3), 0);
    g.addColorStop(0, `rgba(94,207,142,${0.1 + throttle * 0.14})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(w - pad(token, 4), 0, pad(token, 4), h);
  }
  if (brake > 0.05) {
    const g = ctx.createLinearGradient(0, 0, pad(token, 3), 0);
    g.addColorStop(0, `rgba(255,107,90,${0.1 + brake * 0.14})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, pad(token, 4), h);
  }
  ctx.restore();
}
