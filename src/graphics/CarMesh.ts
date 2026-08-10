/**
 * Lightweight faux-3D slot-car mesh — pure canvas paths, no blur, no images.
 * Designed for top-down tabletop read: shadow → extrusion skirt → deck → cabin → wheels.
 */

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

export interface SlotCarDrawOpts {
  /** Body length in screen px. */
  len: number;
  /** Body width in screen px. */
  wid: number;
  color: string;
  isPlayer?: boolean;
  /** 0..1 opacity (ghost). */
  alpha?: number;
  /** Extra scale for garage hero. */
  detail?: 'race' | 'hero';
}

/**
 * Draw at current transform origin (already translated to car center).
 * Caller applies rotation. Shadow is drawn in *pre-rotation* screen space by caller
 * when needed; pass `drawShadowLocal` for garage (axis-aligned).
 */
export function drawSlotCarMesh(
  ctx: CanvasRenderingContext2D,
  opts: SlotCarDrawOpts,
  drawShadowLocal = false,
): void {
  const len = opts.len;
  const wid = opts.wid;
  const color = opts.color;
  const alpha = opts.alpha ?? 1;
  const hero = opts.detail === 'hero';
  const h = Math.max(2.2, wid * (hero ? 0.34 : 0.3)); // extrusion height
  const r = wid * 0.22;

  ctx.save();
  ctx.globalAlpha = alpha;

  if (drawShadowLocal) {
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    ctx.beginPath();
    ctx.ellipse(len * 0.04, h * 0.85, len * 0.52, wid * 0.48, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // --- Extrusion skirt (darker “side walls” of the miniature) ---
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  roundRectPath(ctx, -len * 0.5, -wid * 0.5 + h * 0.15, len, wid, r);
  ctx.fill();

  // Left / right vertical faces as cheap quads (reads as thickness)
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.moveTo(-len * 0.5 + r * 0.2, -wid * 0.5);
  ctx.lineTo(-len * 0.5 + r * 0.2, -wid * 0.5 + h);
  ctx.lineTo(len * 0.5 - r * 0.2, -wid * 0.5 + h);
  ctx.lineTo(len * 0.5 - r * 0.2, -wid * 0.5);
  ctx.closePath();
  ctx.fill();

  // --- Player halo (stroke only — no shadowBlur) ---
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

  // --- Deck (top face) ---
  ctx.fillStyle = color;
  roundRectPath(ctx, -len * 0.5, -wid * 0.5, len, wid, r);
  ctx.fill();

  // Specular / light edge along “sun” side (local -Y)
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  roundRectPath(ctx, -len * 0.46, -wid * 0.5, len * 0.92, wid * 0.18, r * 0.5);
  ctx.fill();

  // Side shade (local +Y)
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  roundRectPath(ctx, -len * 0.46, wid * 0.18, len * 0.92, wid * 0.28, r * 0.4);
  ctx.fill();

  // Nose wedge
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  ctx.beginPath();
  ctx.moveTo(-len * 0.5, -wid * 0.12);
  ctx.lineTo(-len * 0.5, wid * 0.12);
  ctx.lineTo(-len * 0.34, wid * 0.2);
  ctx.lineTo(-len * 0.34, -wid * 0.2);
  ctx.closePath();
  ctx.fill();

  // Cabin (raised block with tiny extrusion)
  const cabX = -len * 0.06;
  const cabW = len * 0.4;
  const cabH = wid * 0.62;
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

  // Wheels — four dark ellipses, sit “under” deck edges
  const wx = len * 0.32;
  const wy = wid * 0.52;
  const wr = Math.max(1.2, wid * 0.14);
  const wh = Math.max(1.0, wid * 0.09);
  ctx.fillStyle = 'rgba(8,8,10,0.92)';
  for (const sx of [-1, 1] as const) {
    for (const sy of [-1, 1] as const) {
      ctx.beginPath();
      ctx.ellipse(sx * wx * 0.85, sy * wy, wr, wh, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Thin body outline for crisp miniatures at small zoom
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = Math.max(0.75, wid * 0.04);
  roundRectPath(ctx, -len * 0.5, -wid * 0.5, len, wid, r);
  ctx.stroke();

  ctx.restore();
}

/** Screen-space ground blob — call BEFORE rotating the car. */
export function drawSlotCarShadow(
  ctx: CanvasRenderingContext2D,
  len: number,
  wid: number,
  alpha = 0.4,
): void {
  ctx.save();
  ctx.fillStyle = `rgba(0,0,0,${alpha})`;
  ctx.beginPath();
  // Slight offset “away from light” (down-right in screen space)
  ctx.ellipse(len * 0.06, wid * 0.22, len * 0.5, wid * 0.42, 0.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
