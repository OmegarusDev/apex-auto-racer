/**
 * Unified slot-car painter — garage hero and race field share one mesh language.
 * Part tiers drive cosmetic tells only (no physics).
 */

import type { DisciplineId } from '../../data/disciplines';
import type { VehicleParts } from '../../engine/types';
import { emptyVehicleParts } from '../../engine/types';

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

export interface CarPaintOpts {
  len: number;
  wid: number;
  color: string;
  isPlayer?: boolean;
  alpha?: number;
  detail?: 'race' | 'hero';
  discipline?: DisciplineId;
  tyreTemp?: number;
  deslot?: boolean;
  condition?: number;
  partTiers?: VehicleParts;
  /** 0..1 presentation amp from lineNoise (read-only). */
  lineWobble?: number;
}

function tier(parts: VehicleParts | undefined, key: keyof VehicleParts): number {
  return parts?.[key] ?? 1;
}

/** Rubber color: cold blue-grey → hot charcoal/reddish. */
function tyreRubberColor(tyreTemp: number): string {
  const t = Math.max(0, Math.min(1.4, tyreTemp));
  if (t < 0.5) {
    const a = 1 - t / 0.5;
    return `rgba(${30 + a * 20},${40 + a * 30},${55 + a * 40},0.95)`;
  }
  if (t > 1.05) {
    const a = Math.min(1, (t - 1.05) / 0.35);
    return `rgba(${20 + a * 40},${12},${10},0.95)`;
  }
  return 'rgba(8,8,10,0.92)';
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

export function drawSlotCarMesh(
  ctx: CanvasRenderingContext2D,
  opts: CarPaintOpts,
  drawShadowLocal = false,
): void {
  const parts = opts.partTiers ?? emptyVehicleParts(1);
  const sil = silhouetteFor(opts.discipline);
  const spoilerTier = tier(parts, 'spoiler');
  const tyreTier = tier(parts, 'tyres');
  const engineTier = tier(parts, 'engine');
  const exhaustTier = tier(parts, 'exhaust');
  const brakeTier = tier(parts, 'brakes');
  const suspTier = tier(parts, 'suspension');

  const rideDrop = (6 - Math.min(5, suspTier)) * 0.012; // low susp = taller stance cue
  const tyreWidthBoost = 1 + Math.max(0, tyreTier - 1) * 0.06;
  const len = opts.len;
  const wid = opts.wid;
  const color = opts.color;
  const alpha = opts.alpha ?? 1;
  const hero = opts.detail === 'hero';
  const tyre = opts.tyreTemp ?? 0.7;
  const cond = opts.condition ?? 1;
  const deslot = opts.deslot === true;
  const wobble = opts.lineWobble ?? 0;
  const h = Math.max(2.2, wid * (hero ? sil.extrusion + 0.04 : sil.extrusion));
  const r = wid * sil.radius;

  ctx.save();
  ctx.globalAlpha = alpha * (deslot ? 0.92 : 1);
  if (deslot) {
    ctx.translate(0, -h * 0.35);
  }
  if (wobble > 0.01) {
    ctx.translate(wobble * wid * 0.04, 0);
    ctx.rotate(wobble * 0.03);
  }
  ctx.translate(0, rideDrop * wid);

  if (drawShadowLocal) {
    ctx.fillStyle = `rgba(0,0,0,${deslot ? 0.22 : 0.38})`;
    ctx.beginPath();
    ctx.ellipse(len * 0.04, h * (deslot ? 1.15 : 0.85), len * 0.52, wid * (deslot ? 0.55 : 0.48), 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Skirt — condition scars darken + chip marks when low.
  const skirtDark = 0.45 + (1 - cond) * 0.32;
  ctx.fillStyle = `rgba(0,0,0,${skirtDark})`;
  roundRectPath(ctx, -len * 0.5, -wid * 0.5 + h * 0.15, len, wid, r);
  ctx.fill();

  if (cond < 0.85) {
    const scars = Math.ceil((0.85 - cond) * 8);
    ctx.strokeStyle = `rgba(0,0,0,${0.35 + (1 - cond) * 0.3})`;
    ctx.lineWidth = Math.max(0.6, wid * 0.03);
    for (let i = 0; i < scars; i++) {
      const sx = -len * 0.35 + (i / scars) * len * 0.7;
      const sy = -wid * 0.2 + (i % 2) * wid * 0.35;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + len * 0.08, sy + wid * 0.06);
      ctx.stroke();
    }
  }

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

  // Deck — engine/exhaust tier warms deck tint slightly.
  const deckHeat = Math.min(0.12, (engineTier + exhaustTier - 2) * 0.015);
  ctx.fillStyle = color;
  roundRectPath(ctx, -len * 0.5, -wid * 0.5, len, wid, r);
  ctx.fill();
  if (deckHeat > 0) {
    ctx.fillStyle = `rgba(255,120,40,${deckHeat})`;
    roundRectPath(ctx, -len * 0.5, -wid * 0.5, len, wid, r);
    ctx.fill();
  }

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

  // Nose wedge.
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

  // Spoiler wing (tier ≥ 2 readable; scales with tier).
  if (spoilerTier >= 2) {
    const wingW = len * (0.22 + spoilerTier * 0.03);
    const wingH = wid * (0.08 + spoilerTier * 0.012);
    const wingX = len * 0.28;
    ctx.fillStyle = 'rgba(20,20,24,0.92)';
    roundRectPath(ctx, wingX, -wingH * 0.5, wingW * 0.22, wingH, wid * 0.04);
    ctx.fill();
    ctx.fillStyle = color;
    roundRectPath(ctx, wingX + wingW * 0.18, -wingH * (0.55 + spoilerTier * 0.04), wingW * 0.7, wingH * 0.35, wid * 0.03);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    roundRectPath(ctx, wingX + wingW * 0.18, -wingH * (0.55 + spoilerTier * 0.04), wingW * 0.7, wingH * 0.12, wid * 0.02);
    ctx.fill();
  }

  // Exhaust tips (engine/exhaust tiers).
  if (exhaustTier >= 2 || engineTier >= 3) {
    const tipN = exhaustTier >= 4 ? 2 : 1;
    ctx.fillStyle = `rgba(180,160,120,${0.45 + exhaustTier * 0.06})`;
    for (let i = 0; i < tipN; i++) {
      const oy = (i - (tipN - 1) * 0.5) * wid * 0.12;
      ctx.beginPath();
      ctx.ellipse(len * 0.48, oy, wid * 0.05, wid * 0.035, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Wheels + brake caliper accent.
  const wx = len * 0.32;
  const wy = wid * sil.wheelOut;
  const wr = Math.max(1.2, wid * (opts.discipline === 'rally' ? 0.17 : 0.14) * tyreWidthBoost);
  const wh = Math.max(1.0, wid * (opts.discipline === 'rally' ? 0.12 : 0.09) * tyreWidthBoost);
  const rubber = tyreRubberColor(tyre);
  for (const sx of [-1, 1] as const) {
    for (const sy of [-1, 1] as const) {
      ctx.fillStyle = rubber;
      ctx.beginPath();
      ctx.ellipse(sx * wx * 0.85, sy * wy, wr, wh, 0, 0, Math.PI * 2);
      ctx.fill();
      if (brakeTier >= 2 && (hero || opts.detail === 'race')) {
        ctx.fillStyle = brakeTier >= 4 ? 'rgba(220,40,40,0.85)' : 'rgba(200,60,40,0.65)';
        ctx.beginPath();
        ctx.ellipse(sx * wx * 0.85, sy * wy, wr * 0.35, wh * 0.35, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = Math.max(0.75, wid * 0.04);
  roundRectPath(ctx, -len * 0.5, -wid * 0.5, len, wid, r);
  ctx.stroke();

  ctx.restore();
}

/** @deprecated alias — use drawSlotCarMesh */
export type SlotCarDrawOpts = CarPaintOpts;
