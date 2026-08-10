import { PHYSICS } from '../../data/physics';
import type { DisciplineId } from '../../data/disciplines';
import { KERB_KAPPA } from '../constants';
import { PX_PER_M } from '../coords';
import { buildTrackPalette, type TrackPalette } from '../materials';
import { sampleTrack } from '../TrackSampler';
import type { TrackBounds, TrackView } from '../types';

export interface BakeMeta {
  scale: number;
  offsetX: number;
  offsetY: number;
  worldW: number;
  worldH: number;
  canvasW: number;
  canvasH: number;
}

export interface MinimapPoint {
  nx: number;
  ny: number;
}

export interface TrackBakeResult {
  canvas: HTMLCanvasElement;
  meta: BakeMeta;
  minimap: MinimapPoint[];
  palette: TrackPalette;
  nightOverlay: HTMLCanvasElement | null;
}

const MINIMAP_SAMPLES = 96;
const PAD_M = 6;

export function bakeTrack(
  track: TrackView,
  disciplineId: DisciplineId,
  night = false,
  rain = false,
): TrackBakeResult {
  const palette = buildTrackPalette(disciplineId, night, rain);
  const b = track.bounds;
  const worldW = b.maxX - b.minX + PAD_M * 2;
  const worldH = b.maxY - b.minY + PAD_M * 2;
  const maxRes = PHYSICS.maxBakeRes;

  const scale = Math.min(
    maxRes / (worldW * PX_PER_M),
    maxRes / (worldH * PX_PER_M),
  );

  const canvasW = Math.ceil(worldW * PX_PER_M * scale);
  const canvasH = Math.ceil(worldH * PX_PER_M * scale);
  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to create bake canvas');

  const offsetX = b.minX - PAD_M;
  const offsetY = b.minY - PAD_M;
  const meta: BakeMeta = { scale, offsetX, offsetY, worldW, worldH, canvasW, canvasH };

  const toBake = (wx: number, wy: number): { x: number; y: number } => ({
    x: (wx - offsetX) * PX_PER_M * scale,
    y: canvasH - (wy - offsetY) * PX_PER_M * scale,
  });

  if (night) {
    ctx.fillStyle = palette.nightBg;
    ctx.fillRect(0, 0, canvasW, canvasH);
  } else {
    // Soft tabletop plate under the circuit.
    ctx.fillStyle = '#0c0c10';
    ctx.fillRect(0, 0, canvasW, canvasH);
    const plate = ctx.createRadialGradient(
      canvasW * 0.5,
      canvasH * 0.45,
      Math.min(canvasW, canvasH) * 0.1,
      canvasW * 0.5,
      canvasH * 0.5,
      Math.max(canvasW, canvasH) * 0.65,
    );
    plate.addColorStop(0, 'rgba(28,26,32,0.9)');
    plate.addColorStop(1, 'rgba(8,8,12,0.2)');
    ctx.fillStyle = plate;
    ctx.fillRect(0, 0, canvasW, canvasH);
  }

  drawRunoff(ctx, track, palette, toBake);
  drawAsphalt(ctx, track, palette, meta, toBake);
  drawKerbs(ctx, track, palette, toBake);
  drawBarriers(ctx, track, palette, meta, toBake);
  drawStartCheckered(ctx, track, palette, toBake);
  drawGridDashes(ctx, track, palette, toBake);

  if (rain) {
    ctx.fillStyle = palette.wetSheen;
    ctx.fillRect(0, 0, canvasW, canvasH);
  }
  if (night) {
    ctx.fillStyle = palette.nightWash;
    ctx.fillRect(0, 0, canvasW, canvasH);
  }

  const minimap = bakeMinimap(track, b);
  const nightOverlay = night ? bakeNightOverlay(canvasW, canvasH) : null;

  return { canvas, meta, minimap, palette, nightOverlay };
}

function bakeNightOverlay(_w: number, _h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  // Unit vignette template — RaceView rebuilds screen-sized overlay on draw.
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  const g = ctx.createRadialGradient(32, 28, 8, 32, 32, 40);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(4,8,20,0.42)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return c;
}

function bakeMinimap(track: TrackView, bounds: TrackBounds): MinimapPoint[] {
  const points: MinimapPoint[] = [];
  const spanX = Math.max(bounds.maxX - bounds.minX, 1);
  const spanY = Math.max(bounds.maxY - bounds.minY, 1);
  // Aspect-correct: normalize each axis independently (no squash).
  for (let i = 0; i <= MINIMAP_SAMPLES; i++) {
    const s = (i / MINIMAP_SAMPLES) * track.length;
    const sample = sampleTrack(track, s);
    points.push({
      nx: (sample.pos.x - bounds.minX) / spanX,
      ny: 1 - (sample.pos.y - bounds.minY) / spanY,
    });
  }
  return points;
}

function drawRunoff(
  ctx: CanvasRenderingContext2D,
  track: TrackView,
  palette: TrackPalette,
  toBake: (wx: number, wy: number) => { x: number; y: number },
): void {
  const nodes = track.nodes;
  if (nodes.length < 2) return;

  ctx.fillStyle = palette.runoff;
  for (let side = -1; side <= 1; side += 2) {
    ctx.beginPath();
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]!;
      const half = n.width * 0.5 + n.runoffWidth;
      const p = toBake(n.pos.x + n.normal.x * half * side, n.pos.y + n.normal.y * half * side);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i]!;
      const half = n.width * 0.5;
      const p = toBake(n.pos.x + n.normal.x * half * side, n.pos.y + n.normal.y * half * side);
      ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.fill();
  }
}

function drawAsphalt(
  ctx: CanvasRenderingContext2D,
  track: TrackView,
  palette: TrackPalette,
  meta: BakeMeta,
  toBake: (wx: number, wy: number) => { x: number; y: number },
): void {
  const nodes = track.nodes;
  if (nodes.length < 2) return;
  const s = meta.scale;

  ctx.fillStyle = palette.asphalt;
  ctx.beginPath();
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!;
    const p = toBake(n.pos.x - n.normal.x * n.width * 0.5, n.pos.y - n.normal.y * n.width * 0.5);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i]!;
    const p = toBake(n.pos.x + n.normal.x * n.width * 0.5, n.pos.y + n.normal.y * n.width * 0.5);
    ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = palette.rimDark;
  ctx.lineWidth = Math.max(1.5, 2.4 * s);
  ctx.stroke();
  ctx.strokeStyle = palette.rimLight;
  ctx.lineWidth = Math.max(1, 1.4 * s);
  ctx.stroke();

  // Slot groove channel — Scalextric center rail (dark trench + highlight).
  ctx.beginPath();
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!;
    const p = toBake(n.pos.x, n.pos.y);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.strokeStyle = palette.groove;
  ctx.lineWidth = Math.max(2.2, 3.2 * s);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.strokeStyle = palette.grooveHighlight;
  ctx.lineWidth = Math.max(0.7, 1.0 * s);
  ctx.stroke();

  // Outer bevel ribbon.
  ctx.beginPath();
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!;
    const p = toBake(n.pos.x - n.normal.x * n.width * 0.42, n.pos.y - n.normal.y * n.width * 0.42);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i]!;
    const p = toBake(n.pos.x + n.normal.x * n.width * 0.42, n.pos.y + n.normal.y * n.width * 0.42);
    ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  ctx.strokeStyle = palette.bevel;
  ctx.lineWidth = Math.max(1, 1.2 * s);
  ctx.stroke();
}

function drawKerbs(
  ctx: CanvasRenderingContext2D,
  track: TrackView,
  palette: TrackPalette,
  toBake: (wx: number, wy: number) => { x: number; y: number },
): void {
  const nodes = track.nodes;
  const kerbDepth = PHYSICS.kerbOuterM;

  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i]!;
    const b = nodes[i + 1]!;
    if (Math.abs(a.kappa) < KERB_KAPPA && Math.abs(b.kappa) < KERB_KAPPA) continue;
    const side = a.kappa + b.kappa >= 0 ? -1 : 1;
    const stripe = Math.floor(a.s / 2.6) % 2 === 0;
    ctx.fillStyle = stripe ? palette.kerbA : palette.kerbB;

    const inner = a.width * 0.5 * side;
    const outer = (a.width * 0.5 + kerbDepth) * side;
    const p0 = toBake(a.pos.x + a.normal.x * inner, a.pos.y + a.normal.y * inner);
    const p1 = toBake(b.pos.x + b.normal.x * inner, b.pos.y + b.normal.y * inner);
    const p2 = toBake(b.pos.x + b.normal.x * outer, b.pos.y + b.normal.y * outer);
    const p3 = toBake(a.pos.x + a.normal.x * outer, a.pos.y + a.normal.y * outer);
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.lineTo(p3.x, p3.y);
    ctx.closePath();
    ctx.fill();
  }
}

function drawBarriers(
  ctx: CanvasRenderingContext2D,
  track: TrackView,
  palette: TrackPalette,
  meta: BakeMeta,
  toBake: (wx: number, wy: number) => { x: number; y: number },
): void {
  const nodes = track.nodes;
  if (nodes.length < 2) return;

  ctx.strokeStyle = palette.barrier;
  ctx.lineWidth = Math.max(2.5, 3.2 * meta.scale);
  ctx.lineJoin = 'round';

  for (const side of [-1, 1] as const) {
    ctx.beginPath();
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]!;
      const half = n.width * 0.5 + n.runoffWidth;
      const p = toBake(n.pos.x + n.normal.x * half * side, n.pos.y + n.normal.y * half * side);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    const n0 = nodes[0]!;
    const half0 = n0.width * 0.5 + n0.runoffWidth;
    const p0 = toBake(
      n0.pos.x + n0.normal.x * half0 * side,
      n0.pos.y + n0.normal.y * half0 * side,
    );
    ctx.lineTo(p0.x, p0.y);
    ctx.stroke();
  }
}

function drawStartCheckered(
  ctx: CanvasRenderingContext2D,
  track: TrackView,
  palette: TrackPalette,
  toBake: (wx: number, wy: number) => { x: number; y: number },
): void {
  const start = sampleTrack(track, 0);
  const cols = 8;
  const rows = 2;
  const along = 2.5;
  const across = start.width;
  const tang = start.tangent;
  const norm = start.normal;
  const cellAlong = along / cols;
  const cellAcross = across / rows;

  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const light = (c + r) % 2 === 0;
      ctx.fillStyle = light ? palette.startLight : palette.startDark;
      const cx =
        start.pos.x + tang.x * (c * cellAlong - along * 0.5) + norm.x * (r * cellAcross - across * 0.5);
      const cy =
        start.pos.y + tang.y * (c * cellAlong - along * 0.5) + norm.y * (r * cellAcross - across * 0.5);
      const corners = [
        { x: cx, y: cy },
        { x: cx + tang.x * cellAlong, y: cy + tang.y * cellAlong },
        {
          x: cx + tang.x * cellAlong + norm.x * cellAcross,
          y: cy + tang.y * cellAlong + norm.y * cellAcross,
        },
        { x: cx + norm.x * cellAcross, y: cy + norm.y * cellAcross },
      ];
      ctx.beginPath();
      const p0 = toBake(corners[0]!.x, corners[0]!.y);
      ctx.moveTo(p0.x, p0.y);
      for (let k = 1; k < corners.length; k++) {
        const p = toBake(corners[k]!.x, corners[k]!.y);
        ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      ctx.fill();
    }
  }
}

function drawGridDashes(
  ctx: CanvasRenderingContext2D,
  track: TrackView,
  palette: TrackPalette,
  toBake: (wx: number, wy: number) => { x: number; y: number },
): void {
  const slots = 6;
  const spacing = 8;
  ctx.strokeStyle = palette.gridDash;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 6]);

  for (let slot = 0; slot < slots; slot++) {
    const s = -spacing * (slot + 1);
    const sample = sampleTrack(track, s);
    const half = sample.width * 0.5;
    const p0 = toBake(
      sample.pos.x - sample.normal.x * half,
      sample.pos.y - sample.normal.y * half,
    );
    const p1 = toBake(
      sample.pos.x + sample.normal.x * half,
      sample.pos.y + sample.normal.y * half,
    );
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
  }

  ctx.setLineDash([]);
}
