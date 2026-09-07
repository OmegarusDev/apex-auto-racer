/**
 * Race HUD chrome — footwell pedals (clutch · brake · gas).
 * Presentation-only; reads car RPM / shiftWindow / clutch DTOs.
 */
import { PHYSICS } from '../../data/physics';
import type { ThemeTokens } from '../../ui/theme';
import { raceChromeLayout, type ChromeRect, type RaceChromeLayout } from '../../graphics/hud/raceChromeLayout';
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
  gearBand: number;
  shiftWindow: ShiftWindowKind;
  gear: number;
  box: GearboxProfile;
  clutchIn?: boolean;
  clutchTimer?: number;
  clutchSweet?: number;
  clutchBiteDelay?: number;
  rpm?: number;
};

function windowColor(kind: ShiftWindowKind): string {
  if (kind === 'green') return '94,207,142';
  if (kind === 'amber') return '240,196,26';
  if (kind === 'red') return '255,107,90';
  return '140,150,145';
}

function platePath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  topInset: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + topInset, y);
  ctx.lineTo(x + w - topInset, y);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.closePath();
}

function drawFootPedal(
  ctx: CanvasRenderingContext2D,
  well: ChromeRect,
  token: ThemeTokens,
  args: {
    amount: number;
    rubber: string;
    metal: string;
    label: string;
    cue?: boolean;
  },
): { x: number; y: number; w: number; h: number } {
  const pressed = args.amount > 0.08;
  const travel = args.amount * Math.min(16, well.h * 0.1);
  const padX = well.w * 0.14;
  const plate = {
    x: well.x + padX,
    y: well.y + well.h * 0.1 + travel,
    w: well.w - padX * 2,
    h: well.h * 0.72,
  };
  const topInset = plate.w * 0.14;

  ctx.save();
  // Recess
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.roundRect(well.x + 2, well.y + 2, well.w - 4, well.h - 4, 6);
  ctx.fill();

  // Hinge pin
  const hx = plate.x + plate.w * 0.5;
  const hy = plate.y - 5;
  ctx.fillStyle = 'rgba(180,186,178,0.55)';
  ctx.beginPath();
  ctx.roundRect(hx - plate.w * 0.22, hy, plate.w * 0.44, 7, 3);
  ctx.fill();

  // Metal plate
  const gy = ctx.createLinearGradient(plate.x, plate.y, plate.x, plate.y + plate.h);
  gy.addColorStop(0, pressed ? 'rgba(58,62,56,0.95)' : args.metal);
  gy.addColorStop(1, 'rgba(18,20,18,0.95)');
  ctx.fillStyle = gy;
  platePath(ctx, plate.x, plate.y, plate.w, plate.h, topInset);
  ctx.fill();

  // Rubber face
  const rubberInset = 5;
  ctx.fillStyle = `rgba(${args.rubber},${pressed ? 0.82 : 0.55})`;
  platePath(
    ctx,
    plate.x + rubberInset,
    plate.y + 8,
    plate.w - rubberInset * 2,
    plate.h - 16,
    topInset * 0.7,
  );
  ctx.fill();

  // Grip ribs
  ctx.strokeStyle = `rgba(0,0,0,${pressed ? 0.35 : 0.22})`;
  ctx.lineWidth = 2;
  const ribCount = 6;
  for (let i = 1; i <= ribCount; i++) {
    const t = i / (ribCount + 1);
    const yy = plate.y + 10 + (plate.h - 20) * t;
    const insetAt = topInset * (1 - t) + 6;
    ctx.beginPath();
    ctx.moveTo(plate.x + insetAt, yy);
    ctx.lineTo(plate.x + plate.w - insetAt, yy);
    ctx.stroke();
  }

  ctx.strokeStyle = pressed ? `rgba(${args.rubber},0.95)` : 'rgba(255,255,255,0.12)';
  ctx.lineWidth = pressed || args.cue ? 2.4 : 1.2;
  platePath(ctx, plate.x, plate.y, plate.w, plate.h, topInset);
  ctx.stroke();

  ctx.font = `600 ${Math.max(10, Math.min(token.fontCaption, plate.w * 0.22))}px ${token.fontDisplayFamily}`;
  ctx.fillStyle = pressed || args.cue ? '#f2efe6' : 'rgba(242,239,230,0.55)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(args.label, well.x + well.w * 0.5, well.y + well.h * 0.92);
  ctx.restore();

  return plate;
}

/**
 * Draw pedal deck. Returns chrome layout for InputController.
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
    clutchIn = false,
    clutchTimer = 0,
    clutchSweet = 0.16,
    clutchBiteDelay = PHYSICS.clutchBiteDelay,
    rpm = PHYSICS.rpmIdle,
  } = args;
  const chrome = raceChromeLayout(w, h, token);

  ctx.save();
  const deckGrad = ctx.createLinearGradient(0, chrome.deckTop, 0, h);
  deckGrad.addColorStop(0, 'rgba(10,12,11,0.08)');
  deckGrad.addColorStop(0.18, 'rgba(12,14,13,0.78)');
  deckGrad.addColorStop(1, 'rgba(8,9,8,0.94)');
  ctx.fillStyle = deckGrad;
  ctx.fillRect(0, chrome.deckTop, w, h - chrome.deckTop);
  const fade = ctx.createLinearGradient(0, chrome.deckTop - 22, 0, chrome.deckTop);
  fade.addColorStop(0, 'rgba(8,10,9,0)');
  fade.addColorStop(1, 'rgba(8,10,9,0.45)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, chrome.deckTop - 22, w, 22);
  ctx.fillStyle = `${accent}66`;
  ctx.fillRect(0, chrome.deckTop, w, 2);
  ctx.restore();

  drawFootPedal(ctx, chrome.shift, token, {
    amount: shifting || clutchIn ? Math.max(0.55, clutchIn ? 0.85 : 0.55) : 0,
    rubber: '90,92,86',
    metal: 'rgba(70,74,68,0.95)',
    label: clutchIn
      ? clutchTimer >= clutchBiteDelay &&
        clutchTimer <= clutchBiteDelay + Math.max(0.05, clutchSweet)
        ? 'OUT'
        : clutchTimer > clutchBiteDelay + Math.max(0.05, clutchSweet)
          ? 'DUMP'
          : 'HOLD'
      : shiftCueArmed
        ? 'IN'
        : 'CLUTCH',
    cue: shiftCueArmed || clutchIn,
  });

  drawFootPedal(ctx, chrome.brake, token, {
    amount: brake,
    rubber: '190,70,58',
    metal: 'rgba(62,40,36,0.95)',
    label: 'BRAKE',
  });

  drawFootPedal(ctx, chrome.gas, token, {
    amount: throttle,
    rubber: '70,170,110',
    metal: 'rgba(36,52,42,0.95)',
    label: 'GAS',
  });

  drawShiftMeter(ctx, chrome.shiftMeter, token, {
    rpm,
    gear,
    gearBand,
    shiftWindow,
    box,
    clutchIn,
    clutchTimer,
    clutchSweet,
    clutchBiteDelay,
    shiftCueArmed,
    animTime,
  });

  if (shiftCueArmed && !clutchIn) {
    const cuePulse = 0.5 + 0.4 * Math.sin(animTime * 9);
    ctx.save();
    ctx.strokeStyle = `rgba(240,196,26,${0.45 + cuePulse * 0.5})`;
    ctx.lineWidth = 2;
    ctx.strokeRect(chrome.shift.x + 3, chrome.shift.y + 3, chrome.shift.w - 6, chrome.shift.h - 6);
    ctx.restore();
  }

  return chrome;
}

function drawShiftMeter(
  ctx: CanvasRenderingContext2D,
  r: ChromeRect,
  token: ThemeTokens,
  args: {
    rpm: number;
    gear: number;
    gearBand: number;
    shiftWindow: ShiftWindowKind;
    box: GearboxProfile;
    clutchIn: boolean;
    clutchTimer: number;
    clutchSweet: number;
    clutchBiteDelay: number;
    shiftCueArmed: boolean;
    animTime: number;
  },
): void {
  if (r.h < 24 || r.w < 24) return;

  const maxHold = PHYSICS.clutchMaxHold;
  const delay = args.clutchBiteDelay;
  const sweet = Math.max(0.05, args.clutchSweet);
  const rpmFrac = Math.max(
    0,
    Math.min(1, (args.rpm - PHYSICS.rpmIdle) / Math.max(1, PHYSICS.rpmMax - PHYSICS.rpmIdle)),
  );
  const biteLo = delay / maxHold;
  const biteHi = Math.min(1, (delay + sweet) / maxHold);
  const inBite =
    args.clutchIn &&
    args.clutchTimer >= delay &&
    args.clutchTimer <= delay + sweet;
  const late = args.clutchIn && args.clutchTimer > delay + sweet;

  const padX = 8;
  const gearH = Math.min(token.fontDisplay * 1.15, r.h * 0.18);
  const labelH = token.fontCaption + 4;
  const railX = r.x + padX;
  const railW = r.w - padX * 2;
  const railTop = r.y + 8 + gearH + 4;
  const railBot = r.y + r.h - labelH - 8;
  const railH = Math.max(12, railBot - railTop);

  ctx.save();
  ctx.fillStyle = 'rgba(8,10,9,0.72)';
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, 8);
  ctx.fill();
  ctx.strokeStyle = inBite
    ? 'rgba(94,207,142,0.85)'
    : args.shiftCueArmed
      ? `rgba(240,196,26,${0.45 + 0.4 * Math.sin(args.animTime * 9)})`
      : 'rgba(255,255,255,0.12)';
  ctx.lineWidth = inBite || args.shiftCueArmed ? 2 : 1;
  ctx.stroke();

  ctx.font = `700 ${Math.max(18, gearH)}px ${token.fontDisplayFamily}`;
  ctx.fillStyle = '#f2efe6';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(`G${args.gear}`, r.x + r.w * 0.5, r.y + 6);

  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath();
  ctx.roundRect(railX, railTop, railW, railH, 4);
  ctx.fill();

  const fillH = rpmFrac * railH;
  const rgb = windowColor(args.shiftWindow);
  ctx.fillStyle = `rgba(${rgb},0.85)`;
  ctx.fillRect(railX, railTop + railH - fillH, railW, fillH);

  if (args.clutchIn) {
    const loY = railTop + railH - biteHi * railH;
    const hiY = railTop + railH - biteLo * railH;
    ctx.fillStyle = inBite ? 'rgba(94,207,142,0.55)' : late ? 'rgba(255,107,90,0.4)' : 'rgba(240,196,26,0.35)';
    ctx.fillRect(railX, loY, railW, Math.max(3, hiY - loY));
    const cursor = Math.max(0, Math.min(1, args.clutchTimer / maxHold));
    const cy = railTop + railH - cursor * railH;
    ctx.fillStyle = '#f2efe6';
    ctx.fillRect(railX - 3, cy - 2, railW + 6, 4);
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    for (const t of [args.box.greenBandLo, args.box.greenBandHi, args.box.amberBandHi]) {
      const ty = railTop + railH - Math.max(0, Math.min(1, t)) * railH;
      ctx.fillRect(railX - 2, ty, railW + 4, 1);
    }
    const band = Math.max(0, Math.min(1, args.gearBand));
    const by = railTop + railH - band * railH;
    ctx.fillStyle = `rgba(${rgb},0.95)`;
    ctx.fillRect(railX - 3, by - 2, railW + 6, 4);
  }

  ctx.font = `600 ${token.fontCaption}px ${token.fontDisplayFamily}`;
  ctx.fillStyle = args.clutchIn ? (inBite ? 'rgba(94,207,142,0.95)' : '#f2efe6') : 'rgba(242,239,230,0.55)';
  ctx.textBaseline = 'bottom';
  ctx.fillText(args.clutchIn ? (inBite ? 'BITE' : late ? 'DUMP' : 'HOLD') : 'REV', r.x + r.w * 0.5, r.y + r.h - 6);
  ctx.restore();
}
