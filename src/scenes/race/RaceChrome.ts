/**
 * Race HUD chrome — pedal deck with SHIFT rev meter (Phase 3).
 * Presentation-only; reads car RPM / shiftWindow DTOs.
 */
import type { ThemeTokens } from '../../ui/theme';
import { pad } from '../../ui/theme';
import { raceChromeLayout, type RaceChromeLayout } from '../../graphics/hud/raceChromeLayout';
import type { GearboxProfile, ShiftWindowKind } from '../../engine/Gearbox';

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
  /** Position inside the current gear 0..1+ (the SHIFT pad fill IS this). */
  gearBand: number;
  shiftWindow: ShiftWindowKind;
  gear: number;
  /** Window tick positions come from the live gearbox profile. */
  box: GearboxProfile;
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
    gearBand,
    shiftWindow,
    gear,
    box,
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

  // The SHIFT pad IS the rev bar. Fill height = the live band inside the
  // current gear (0 bottom → 1 top), so it always reads the real gearing;
  // colour tracks the shift window. The only animation is the border cue
  // when it is time to shift — never the meter itself.
  const r = chrome.shift;
  const band = Math.max(0, Math.min(1, gearBand));
  const rgb = windowColor(shiftWindow);
  const radius = Math.max(2, pad(token, 0.3));
  ctx.save();
  ctx.fillStyle = 'rgba(22,19,13,0.82)';
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, radius);
  ctx.fill();

  // Window tick marks — where green starts, where green ends, redline.
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  for (const t of [box.greenBandLo, box.greenBandHi, box.amberBandHi]) {
    const ty = r.y + r.h - Math.max(0, Math.min(1, t)) * r.h;
    ctx.fillRect(r.x + 3, ty - 0.5, r.w - 6, 1);
  }

  // Rev fill from the bottom — height is the gear's band, not a pulse.
  const fillH = r.h * band;
  if (fillH > 1) {
    const gy = ctx.createLinearGradient(r.x, r.y + r.h - fillH, r.x, r.y + r.h);
    gy.addColorStop(0, `rgba(${rgb},0.16)`);
    gy.addColorStop(1, `rgba(${rgb},0.62)`);
    ctx.fillStyle = gy;
    ctx.beginPath();
    ctx.roundRect(r.x, r.y + r.h - fillH, r.w, fillH, radius);
    ctx.fill();
  }

  const inWindow = shiftWindow === 'green' || shiftWindow === 'amber';
  const cuePulse = shiftCueArmed ? 0.5 + 0.4 * Math.sin(animTime * 9) : 0;
  ctx.strokeStyle = shifting
    ? 'rgba(255,255,255,0.9)'
    : inWindow
      ? `rgba(${rgb},${0.6 + cuePulse * 0.4})`
      : `rgba(${rgb},0.35)`;
  ctx.lineWidth = shifting || shiftCueArmed ? 3 : 2;
  ctx.beginPath();
  ctx.roundRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, radius);
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.min(r.h * 0.24, token.fontDisplay * 1.05)}px ${token.fontDisplayFamily}`;
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fillText(`G${gear}`, r.x + r.w * 0.5, r.y + r.h * 0.5);
  ctx.font = `400 ${Math.max(9, token.fontCaption * 0.85)}px ${token.fontDisplayFamily}`;
  ctx.fillStyle = shiftCueArmed ? '#f0c41a' : token.textMuted;
  ctx.fillText(shiftCueArmed ? 'SHIFT!' : 'SHIFT', r.x + r.w * 0.5, r.y + r.h * 0.84);
  ctx.restore();

  return chrome;
}
