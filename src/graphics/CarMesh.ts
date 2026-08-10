/**
 * Lightweight faux-3D slot-car mesh — pure canvas paths, no blur, no images.
 * Designed for top-down tabletop read: shadow → extrusion skirt → deck → cabin → wheels.
 */

import type { DisciplineId } from '../data/disciplines';

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** Discipline silhouette proportions (len/wid already set by caller). */
interface Silhouette {
  cabinScale: number;
  cabinShift: number;
  nose: number;
  wheelOut: number;
  extrusion: number;
  radius: number;
}

function silhouetteFor(discipline: DisciplineId | undefined): Silhouette {
  switch (discipline) {
    case 'street':
      return { cabinScale: 0.72, cabinShift: -0.02, nose: 0.38, wheelOut: 0.58, extrusion: 0.28, radius: 0.18 };
    case 'rally':
      return { cabinScale: 0.55, cabinShift: 0.04, nose: 0.28, wheelOut: 0.62, extrusion: 0.38, radius: 0.26 };
    case 'track':
    default:
      return { cabinScale: 0.62, cabinShift: -0.06, nose: 0.34, wheelOut: 0.52, extrusion: 0.3, radius: 0.22 };
  }
}

export interface SlotCarDrawOpts {
  len: number;
  wid: number;
  color: string;
  isPlayer?: boolean;
  alpha?: number;
  detail?: 'race' | 'hero';
  discipline?: DisciplineId;
  /** 0..~1.5 tyre temp — cold dulls deck, hot adds sheen. */
  tyreTemp?: number;
  /** Soft lift / scrub when deslotted. */
  deslot?: boolean;
  /** 0..1 vehicle condition — low darkens skirt. */
  condition?: number;
}

export function drawSlotCarMesh(
  ctx: CanvasRenderingContext2D,
  opts: SlotCarDrawOpts,
  drawShadowLocal = false,
): void {
  const sil = silhouetteFor(opts.discipline);
  const len = opts.len;
  const wid = opts.wid;
  const color = opts.color;
  const alpha = opts.alpha ?? 1;
  const hero = opts.detail === 'hero';
  const tyre = opts.tyreTemp ?? 0.7;
  const cond = opts.condition ?? 1;
  const deslot = opts.deslot === true;
  const h = Math.max(2.2, wid * (hero ? sil.extrusion + 0.04 : sil.extrusion));
  const r = wid * sil.radius;

  ctx.save();
  ctx.globalAlpha = alpha * (deslot ? 0.92 : 1);
  if (deslot) {
    ctx.translate(0, -h * 0.35);
  }

  if (drawShadowLocal) {
    ctx.fillStyle = `rgba(0,0,0,${deslot ? 0.22 : 0.38})`;
    ctx.beginPath();
    ctx.ellipse(len * 0.04, h * (deslot ? 1.15 : 0.85), len * 0.52, wid * (deslot ? 0.55 : 0.48), 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const skirtDark = 0.45 + (1 - cond) * 0.25;
  ctx.fillStyle = `rgba(0,0,0,${skirtDark})`;
  roundRectPath(ctx, -len * 0.5, -wid * 0.5 + h * 0.15, len, wid, r);
  ctx.fill();

  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.moveTo(-len * 0.5 + r * 0.2, -wid * 0.5);
  ctx.lineTo(-len * 0.5 + r * 0.2, -wid * 0.5 + h);
  ctx.lineTo(len * 0.5 - r * 0.2, -wid * 0.5 + h);
  ctx.lineTo(len * 0.5 - r * 0.2, -wid * 0.5);
  ctx.closePath();
  ctx.fill();

  if (opts.isPlayer) {
    ctx.strokeStyle = `${color}44`;
    ctx.lineWidth = Math.max(2, wid * 0.18);
    roundRectPath(ctx, -len * 0.54, -wid * 0.58, len * 1.08, wid * 1.16, r * 1.2);
    ctx.stroke();
    ctx.strokeStyle = `${color}99`;
    ctx.lineWidth = Math.max(1.2, wid * 0.1);
    roundRectPath(ctx, -len * 0.52, -wid * 0.55, len * 1.04, wid * 1.1, r * 1.1);
    ctx.stroke();
  }

  // Deck — cold tyres dull, hot adds warm sheen via overlay later.
  ctx.fillStyle = color;
  roundRectPath(ctx, -len * 0.5, -wid * 0.5, len, wid, r);
  ctx.fill();

  if (tyre < 0.45) {
    ctx.fillStyle = `rgba(0,0,0,${0.22 * (1 - tyre / 0.45)})`;
    roundRectPath(ctx, -len * 0.5, -wid * 0.5, len, wid, r);
    ctx.fill();
  }

  const sheen = 0.1 + Math.max(0, Math.min(1, (tyre - 0.5) / 0.7)) * 0.14;
  ctx.fillStyle = `rgba(255,255,255,${sheen})`;
  roundRectPath(ctx, -len * 0.46, -wid * 0.5, len * 0.92, wid * 0.18, r * 0.5);
  ctx.fill();

  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  roundRectPath(ctx, -len * 0.46, wid * 0.18, len * 0.92, wid * 0.28, r * 0.4);
  ctx.fill();

  // Nose wedge — longer on track, stubbier on rally.
  const nose = sil.nose;
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  ctx.beginPath();
  ctx.moveTo(-len * 0.5, -wid * 0.12);
  ctx.lineTo(-len * 0.5, wid * 0.12);
  ctx.lineTo(-len * (0.5 - nose * 0.45), wid * 0.2);
  ctx.lineTo(-len * (0.5 - nose * 0.45), -wid * 0.2);
  ctx.closePath();
  ctx.fill();

  const cabW = len * 0.4 * (sil.cabinScale / 0.62);
  const cabH = wid * sil.cabinScale;
  const cabX = -len * 0.06 + len * sil.cabinShift;
  const cabY = -cabH * 0.5;
  const cabLift = h * 0.35;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  roundRectPath(ctx, cabX, cabY + cabLift * 0.5, cabW, cabH, wid * 0.1);
  ctx.fill();
  ctx.fillStyle = 'rgba(12,14,18,0.82)';
  roundRectPath(ctx, cabX, cabY, cabW, cabH, wid * 0.1);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  roundRectPath(ctx, cabX + cabW * 0.08, cabY, cabW * 0.84, cabH * 0.28, wid * 0.06);
  ctx.fill();

  const wx = len * 0.32;
  const wy = wid * sil.wheelOut;
  const wr = Math.max(1.2, wid * (opts.discipline === 'rally' ? 0.17 : 0.14));
  const wh = Math.max(1.0, wid * (opts.discipline === 'rally' ? 0.12 : 0.09));
  ctx.fillStyle = 'rgba(8,8,10,0.92)';
  for (const sx of [-1, 1] as const) {
    for (const sy of [-1, 1] as const) {
      ctx.beginPath();
      ctx.ellipse(sx * wx * 0.85, sy * wy, wr, wh, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = Math.max(0.75, wid * 0.04);
  roundRectPath(ctx, -len * 0.5, -wid * 0.5, len, wid, r);
  ctx.stroke();

  ctx.restore();
}

export function drawSlotCarShadow(
  ctx: CanvasRenderingContext2D,
  len: number,
  wid: number,
  alpha = 0.4,
  lifted = false,
): void {
  ctx.save();
  ctx.fillStyle = `rgba(0,0,0,${lifted ? alpha * 0.55 : alpha})`;
  ctx.beginPath();
  ctx.ellipse(
    len * 0.06,
    wid * (lifted ? 0.32 : 0.22),
    len * (lifted ? 0.56 : 0.5),
    wid * (lifted ? 0.5 : 0.42),
    0.15,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.restore();
}
