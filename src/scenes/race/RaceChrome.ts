/**
 * Race HUD chrome — pedal deck with SHIFT rev meter (Phase 3).
 * Presentation-only; reads car RPM / shiftWindow DTOs.
 */
import type { ThemeTokens } from '../../ui/theme';
import { pad } from '../../ui/theme';
import { raceChromeLayout, type RaceChromeLayout } from '../../graphics/hud/raceChromeLayout';
import { revMeterNorm } from '../../engine/Gearbox';
import type { ShiftWindowKind } from '../../engine/Gearbox';

export type RaceChromeDrawArgs = {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
};

export type PedalDeckArgs = {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  token: ThemeTokens;
  accent: string;
  throttle: number;
  brake: number;
  shifting: boolean;
  shiftCueArmed: boolean;
  animTime: number;
  /** Player RPM for SHIFT rev strip. */
  rpm: number;
  shiftWindow: ShiftWindowKind;
  gear: number;
};

function windowColor(kind: ShiftWindowKind): string {
  if (kind === 'green') return '94,207,142';
  if (kind === 'amber') return '240,196,26';
  if (kind === 'red') return '255,107,90';
  return '140,150,145';
}

/**
 * Draw pedal deck + SHIFT rev meter. Returns chrome layout for InputController.
 */
export function drawPedalDeck(args: PedalDeckArgs): RaceChromeLayout {
  const {
    ctx,
    w,
    h,
    token,
    accent,
    throttle,
    brake,
    shifting,
    shiftCueArmed,
    animTime,
    rpm,
    shiftWindow,
    gear,
  } = args;
  const chrome = raceChromeLayout(w, h, token);

  const paintPad = (
    r: { x: number; y: number; w: number; h: number },
    idleFill: string,
    activeRgb: string,
    amount: number,
    label: string,
    labelColor: string,
  ): void => {
    const pressed = amount > 0.08;
    const radius = Math.max(2, pad(token, 0.3));
    ctx.save();
    ctx.fillStyle = idleFill;
    ctx.beginPath();
    ctx.roundRect(r.x, r.y, r.w, r.h, radius);
    ctx.fill();

    if (pressed) {
      const fillH = r.h * Math.min(1, 0.18 + amount * 0.82);
      const gy = ctx.createLinearGradient(r.x, r.y + r.h - fillH, r.x, r.y + r.h);
      gy.addColorStop(0, `rgba(${activeRgb},0.15)`);
      gy.addColorStop(1, `rgba(${activeRgb},0.55)`);
      ctx.fillStyle = gy;
      ctx.beginPath();
      ctx.roundRect(r.x, r.y + r.h - fillH, r.w, fillH, radius);
      ctx.fill();
    }

    ctx.strokeStyle = pressed ? `rgba(${activeRgb},0.95)` : `rgba(${activeRgb},0.35)`;
    ctx.lineWidth = pressed ? 2.5 : 1.5;
    ctx.beginPath();
    ctx.roundRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, radius);
    ctx.stroke();

    ctx.fillStyle = pressed ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.05)';
    ctx.fillRect(r.x + radius, r.y + 2, r.w - radius * 2, 2);

    ctx.font = `400 ${Math.max(token.fontCaption * 0.9, Math.min(r.h * 0.2, token.fontTitle * 0.85))}px ${token.fontDisplayFamily}`;
    ctx.fillStyle = labelColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const ctxLs = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
    const labelY = r.y + r.h * 0.52;
    if (typeof ctxLs.letterSpacing === 'string') {
      ctxLs.letterSpacing = r.h < token.touchMin * 1.1 ? '0.08em' : '0.18em';
      ctx.fillText(label, r.x + r.w * 0.5, labelY);
      ctxLs.letterSpacing = '0px';
    } else {
      ctx.fillText(label, r.x + r.w * 0.5, labelY);
    }
    ctx.restore();
  };

  ctx.save();
  const deckGrad = ctx.createLinearGradient(0, chrome.deckTop, 0, h);
  deckGrad.addColorStop(0, 'rgba(8,10,9,0.2)');
  deckGrad.addColorStop(0.25, 'rgba(8,10,9,0.72)');
  deckGrad.addColorStop(1, 'rgba(6,8,7,0.92)');
  ctx.fillStyle = deckGrad;
  ctx.fillRect(0, chrome.deckTop, w, h - chrome.deckTop);
  const fade = ctx.createLinearGradient(0, chrome.deckTop - 28, 0, chrome.deckTop);
  fade.addColorStop(0, 'rgba(8,10,9,0)');
  fade.addColorStop(1, 'rgba(8,10,9,0.55)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, chrome.deckTop - 28, w, 28);
  ctx.fillStyle = `${accent}55`;
  ctx.fillRect(0, chrome.deckTop, w, 2);
  ctx.restore();

  paintPad(
    chrome.brake,
    'rgba(28,14,14,0.78)',
    '255,107,90',
    brake,
    'BRAKE',
    brake > 0.08 ? token.text : 'rgba(255,107,90,0.7)',
  );
  paintPad(
    chrome.gas,
    'rgba(12,28,18,0.78)',
    '94,207,142',
    throttle,
    'GAS',
    throttle > 0.08 ? token.text : 'rgba(94,207,142,0.7)',
  );

  const shiftPulse = shiftCueArmed ? 0.15 + 0.1 * Math.sin(animTime * 10) : 0;
  const shiftAmt = shifting ? 1 : shiftPulse > 0 ? 0.35 + shiftPulse : 0;
  paintPad(
    chrome.shift,
    `rgba(36,30,10,${0.7 + shiftPulse})`,
    '240,196,26',
    shiftAmt,
    shiftCueArmed ? 'SHIFT!' : 'SHIFT',
    shifting || shiftCueArmed ? '#f0c41a' : token.textMuted,
  );

  // Rev meter strip along top of SHIFT pad — green/amber/red window.
  const rev = revMeterNorm(rpm);
  const rgb = windowColor(shiftWindow);
  const stripH = Math.max(4, chrome.shift.h * 0.08);
  const stripY = chrome.shift.y + pad(token, 0.4);
  const stripX = chrome.shift.x + pad(token, 0.5);
  const stripW = chrome.shift.w - pad(token, 1);
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(stripX, stripY, stripW, stripH);
  ctx.fillStyle = `rgba(${rgb},0.9)`;
  ctx.fillRect(stripX, stripY, stripW * rev, stripH);
  // Window tick marks
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  for (const t of [0.55, 0.72, 0.88]) {
    ctx.fillRect(stripX + stripW * t, stripY, 1, stripH);
  }
  ctx.font = `500 ${Math.max(9, token.fontCaption * 0.85)}px ${token.fontFamily}`;
  ctx.fillStyle = `rgba(${rgb},0.95)`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(`G${gear}`, chrome.shift.x + chrome.shift.w * 0.5, stripY + stripH + 2);
  ctx.restore();

  return chrome;
}
