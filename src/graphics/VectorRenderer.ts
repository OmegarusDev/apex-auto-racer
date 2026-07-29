import { PHYSICS } from '../data/physics.ts';
import { getDiscipline } from '../data/disciplines.ts';
import type { DisciplineDef, DisciplineId } from '../data/disciplines.ts';
import type { Vec2 } from '../engine/types.ts';
import type { CameraTransform } from './Camera.ts';

export const PX_PER_M = PHYSICS.pxPerM;

/** Minimal track view — satisfied by TrackGenerator output. */
export interface TrackNodeView {
  pos: Vec2;
  tangent: Vec2;
  normal: Vec2;
  width: number;
  runoffWidth: number;
  kappa: number;
  s: number;
}

export interface TrackBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface TrackView {
  nodes: readonly TrackNodeView[];
  length: number;
  bounds: TrackBounds;
}

export interface CarRenderState {
  s: number;
  l: number;
  v: number;
  slipAngle: number;
  heading?: number;
}

export interface ScreenRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TrackSample {
  pos: Vec2;
  tangent: Vec2;
  normal: Vec2;
  width: number;
}

interface BakeMeta {
  scale: number;
  offsetX: number;
  offsetY: number;
  worldW: number;
  worldH: number;
}

interface MinimapPoint {
  nx: number;
  ny: number;
}

const KERB_KAPPA = 0.012;
const MINIMAP_SAMPLES = 96;

export class VectorRenderer {
  private baked: HTMLCanvasElement | null = null;
  private bakeMeta: BakeMeta | null = null;
  private minimapPoints: MinimapPoint[] = [];
  private track: TrackView | null = null;
  private discipline: DisciplineDef | null = null;

  bakeTrack(track: TrackView, disciplineId: DisciplineId): void {
    const discipline = getDiscipline(disciplineId);
    this.track = track;
    this.discipline = discipline;

    const padM = 6;
    const b = track.bounds;
    const worldW = b.maxX - b.minX + padM * 2;
    const worldH = b.maxY - b.minY + padM * 2;
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

    const offsetX = b.minX - padM;
    const offsetY = b.minY - padM;

    const toBake = (wx: number, wy: number): { x: number; y: number } => ({
      x: (wx - offsetX) * PX_PER_M * scale,
      y: canvasH - (wy - offsetY) * PX_PER_M * scale,
    });

    this.bakeMeta = { scale, offsetX, offsetY, worldW, worldH };
    this.baked = canvas;

    this.bakeMinimap(track, b);
    this.drawRunoff(ctx, track, discipline, toBake);
    this.drawAsphalt(ctx, track, discipline, toBake);
    this.drawKerbs(ctx, track, discipline, toBake);
    this.drawStartCheckered(ctx, track, toBake);
    this.drawGridDashes(ctx, track, toBake);
  }

  blitTrack(
    ctx: CanvasRenderingContext2D,
    camera: CameraTransform,
    screenW: number,
    screenH: number,
  ): void {
    if (!this.baked || !this.bakeMeta) return;

    const { offsetX, offsetY } = this.bakeMeta;
    const cx = screenW * 0.5;
    const cy = screenH * 0.5;
    const camScale = PX_PER_M * camera.zoom;

    const worldToScreen = (wx: number, wy: number): { x: number; y: number } => ({
      x: cx + (wx - camera.x) * camScale,
      y: cy - (wy - camera.y) * camScale,
    });

    const topLeft = worldToScreen(offsetX, offsetY + this.bakeMeta.worldH);
    const bottomRight = worldToScreen(offsetX + this.bakeMeta.worldW, offsetY);

    const destW = bottomRight.x - topLeft.x;
    const destH = bottomRight.y - topLeft.y;

    ctx.drawImage(this.baked, topLeft.x, topLeft.y, destW, destH);
  }

  drawCar(
    ctx: CanvasRenderingContext2D,
    car: CarRenderState,
    color: string,
    isPlayer: boolean,
    camera: CameraTransform,
    screenW: number,
    screenH: number,
  ): void {
    const sample = this.sampleCar(car);
    if (!sample) return;

    const { x, y } = worldToScreen(sample.pos.x, sample.pos.y, camera, screenW, screenH);
    const heading = sample.heading;
    const len = PHYSICS.carLength * PX_PER_M * camera.zoom;
    const wid = PHYSICS.carWidth * PX_PER_M * camera.zoom;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-heading);

    if (isPlayer) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 14 * camera.zoom;
      ctx.strokeStyle = `${color}88`;
      ctx.lineWidth = 3 * camera.zoom;
      roundRectPath(ctx, -len * 0.52, -wid * 0.62, len * 1.04, wid * 1.24, wid * 0.35);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    ctx.fillStyle = color;
    roundRectPath(ctx, -len * 0.5, -wid * 0.5, len, wid, wid * 0.22);
    ctx.fill();

    ctx.fillStyle = 'rgba(12,12,16,0.75)';
    roundRectPath(ctx, -len * 0.08, -wid * 0.32, len * 0.38, wid * 0.64, wid * 0.12);
    ctx.fill();

    ctx.fillStyle = color;
    ctx.globalAlpha = 0.85;
    roundRectPath(ctx, -len * 0.54, -wid * 0.08, len * 0.12, wid * 0.16, wid * 0.04);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.restore();
  }

  drawGhost(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    heading: number,
    color: string,
    camera: CameraTransform,
    screenW: number,
    screenH: number,
  ): void {
    const p = worldToScreen(x, y, camera, screenW, screenH);
    const len = PHYSICS.carLength * PX_PER_M * camera.zoom;
    const wid = PHYSICS.carWidth * PX_PER_M * camera.zoom;

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(-heading);
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = color;
    roundRectPath(ctx, -len * 0.5, -wid * 0.5, len, wid, wid * 0.22);
    ctx.fill();
    ctx.restore();
  }

  drawMinimap(
    ctx: CanvasRenderingContext2D,
    rect: ScreenRect,
    cars: readonly CarRenderState[],
    playerIndex: number,
  ): void {
    if (this.minimapPoints.length < 2) return;

    ctx.save();
    ctx.fillStyle = 'rgba(10,10,12,0.72)';
    ctx.strokeStyle = 'rgba(42,42,50,0.9)';
    ctx.lineWidth = 1;
    roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, 6);
    ctx.fill();
    ctx.stroke();

    const pad = 6;
    const ix = rect.x + pad;
    const iy = rect.y + pad;
    const iw = rect.w - pad * 2;
    const ih = rect.h - pad * 2;

    ctx.beginPath();
    const first = this.minimapPoints[0]!;
    ctx.moveTo(ix + first.nx * iw, iy + first.ny * ih);
    for (let i = 1; i < this.minimapPoints.length; i++) {
      const p = this.minimapPoints[i]!;
      ctx.lineTo(ix + p.nx * iw, iy + p.ny * ih);
    }
    ctx.closePath();
    ctx.strokeStyle = this.discipline?.accentDim ?? '#0e7490';
    ctx.lineWidth = 2;
    ctx.stroke();

    for (let i = 0; i < cars.length; i++) {
      const sample = this.sampleCar(cars[i]!);
      if (!sample || !this.track) continue;
      const b = this.track.bounds;
      const nx = (sample.pos.x - b.minX) / Math.max(b.maxX - b.minX, 1);
      const ny = 1 - (sample.pos.y - b.minY) / Math.max(b.maxY - b.minY, 1);
      const dotR = i === playerIndex ? 4 : 3;
      ctx.fillStyle = i === playerIndex ? (this.discipline?.accent ?? '#22d3ee') : '#a1a1aa';
      ctx.beginPath();
      ctx.arc(ix + nx * iw, iy + ny * ih, dotR, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  /** World position and heading for a car on the current track. */
  sampleCar(car: CarRenderState): { pos: Vec2; heading: number } | null {
    if (!this.track) return null;
    const sample = sampleTrack(this.track, car.s);
    const pos = {
      x: sample.pos.x + sample.normal.x * car.l,
      y: sample.pos.y + sample.normal.y * car.l,
    };
    const tangAngle = Math.atan2(sample.tangent.y, sample.tangent.x);
    const heading = car.heading ?? tangAngle + car.slipAngle;
    return { pos, heading };
  }

  getTrack(): TrackView | null {
    return this.track;
  }

  private bakeMinimap(track: TrackView, bounds: TrackBounds): void {
    this.minimapPoints = [];
    const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 1);
    for (let i = 0; i <= MINIMAP_SAMPLES; i++) {
      const s = (i / MINIMAP_SAMPLES) * track.length;
      const sample = sampleTrack(track, s);
      this.minimapPoints.push({
        nx: (sample.pos.x - bounds.minX) / span,
        ny: 1 - (sample.pos.y - bounds.minY) / span,
      });
    }
  }

  private drawRunoff(
    ctx: CanvasRenderingContext2D,
    track: TrackView,
    discipline: DisciplineDef,
    toBake: (wx: number, wy: number) => { x: number; y: number },
  ): void {
    const nodes = track.nodes;
    if (nodes.length < 2) return;

    ctx.fillStyle = discipline.style.runoff;
    for (let side = -1; side <= 1; side += 2) {
      ctx.beginPath();
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i]!;
        const half = n.width * 0.5 + n.runoffWidth;
        const px = n.pos.x + n.normal.x * half * side;
        const py = n.pos.y + n.normal.y * half * side;
        const p = toBake(px, py);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i]!;
        const half = n.width * 0.5;
        const px = n.pos.x + n.normal.x * half * side;
        const py = n.pos.y + n.normal.y * half * side;
        const p = toBake(px, py);
        ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      ctx.fill();
    }
  }

  private drawAsphalt(
    ctx: CanvasRenderingContext2D,
    track: TrackView,
    discipline: DisciplineDef,
    toBake: (wx: number, wy: number) => { x: number; y: number },
  ): void {
    const nodes = track.nodes;
    if (nodes.length < 2) return;

    ctx.fillStyle = discipline.style.asphalt;
    ctx.beginPath();
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]!;
      const px = n.pos.x - n.normal.x * n.width * 0.5;
      const py = n.pos.y - n.normal.y * n.width * 0.5;
      const p = toBake(px, py);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i]!;
      const px = n.pos.x + n.normal.x * n.width * 0.5;
      const py = n.pos.y + n.normal.y * n.width * 0.5;
      const p = toBake(px, py);
      ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.fill();
  }

  private drawKerbs(
    ctx: CanvasRenderingContext2D,
    track: TrackView,
    discipline: DisciplineDef,
    toBake: (wx: number, wy: number) => { x: number; y: number },
  ): void {
    const nodes = track.nodes;
    const kerbDepth = PHYSICS.kerbOuterM;

    for (let i = 0; i < nodes.length - 1; i++) {
      const a = nodes[i]!;
      const b = nodes[i + 1]!;
      if (Math.abs(a.kappa) < KERB_KAPPA && Math.abs(b.kappa) < KERB_KAPPA) continue;

      const stripe = Math.floor(a.s / 2) % 2 === 0;
      ctx.fillStyle = stripe ? discipline.style.kerbA : discipline.style.kerbB;

      for (const side of [-1, 1] as const) {
        const inner = a.width * 0.5 * side;
        const outer = (a.width * 0.5 + kerbDepth) * side;
        const p0 = toBake(
          a.pos.x + a.normal.x * inner,
          a.pos.y + a.normal.y * inner,
        );
        const p1 = toBake(
          b.pos.x + b.normal.x * inner,
          b.pos.y + b.normal.y * inner,
        );
        const p2 = toBake(
          b.pos.x + b.normal.x * outer,
          b.pos.y + b.normal.y * outer,
        );
        const p3 = toBake(
          a.pos.x + a.normal.x * outer,
          a.pos.y + a.normal.y * outer,
        );
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.lineTo(p3.x, p3.y);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  private drawStartCheckered(
    ctx: CanvasRenderingContext2D,
    track: TrackView,
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
        ctx.fillStyle = light ? '#f8fafc' : '#111114';
        const cx =
          start.pos.x +
          tang.x * (c * cellAlong - along * 0.5) +
          norm.x * (r * cellAcross - across * 0.5);
        const cy =
          start.pos.y +
          tang.y * (c * cellAlong - along * 0.5) +
          norm.y * (r * cellAcross - across * 0.5);
        const corners = [
          { x: cx, y: cy },
          {
            x: cx + tang.x * cellAlong,
            y: cy + tang.y * cellAlong,
          },
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

  private drawGridDashes(
    ctx: CanvasRenderingContext2D,
    track: TrackView,
    toBake: (wx: number, wy: number) => { x: number; y: number },
  ): void {
    const slots = 6;
    const spacing = 8;
    ctx.strokeStyle = 'rgba(244,244,245,0.45)';
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
}

export function worldToScreen(
  wx: number,
  wy: number,
  camera: CameraTransform,
  screenW: number,
  screenH: number,
): { x: number; y: number } {
  const cx = screenW * 0.5;
  const cy = screenH * 0.5;
  const scale = PX_PER_M * camera.zoom;
  return {
    x: cx + (wx - camera.x) * scale,
    y: cy - (wy - camera.y) * scale,
  };
}

export function screenToWorld(
  sx: number,
  sy: number,
  camera: CameraTransform,
  screenW: number,
  screenH: number,
): { x: number; y: number } {
  const cx = screenW * 0.5;
  const cy = screenH * 0.5;
  const scale = PX_PER_M * camera.zoom;
  return {
    x: camera.x + (sx - cx) / scale,
    y: camera.y - (sy - cy) / scale,
  };
}

export function sampleTrack(track: TrackView, s: number): TrackSample {
  const nodes = track.nodes;
  const len = track.length;
  if (nodes.length === 0) {
    return {
      pos: { x: 0, y: 0 },
      tangent: { x: 1, y: 0 },
      normal: { x: 0, y: 1 },
      width: 10,
    };
  }
  if (nodes.length === 1) {
    const n = nodes[0]!;
    return { pos: n.pos, tangent: n.tangent, normal: n.normal, width: n.width };
  }

  let ss = s % len;
  if (ss < 0) ss += len;

  let lo = 0;
  let hi = nodes.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (nodes[mid]!.s <= ss) lo = mid;
    else hi = mid;
  }

  const a = nodes[lo]!;
  const b = nodes[hi === 0 ? 1 : hi]!;
  const segLen = b.s - a.s || 1;
  const t = clamp01((ss - a.s) / segLen);

  return {
    pos: lerpVec(a.pos, b.pos, t),
    tangent: normalizeVec(lerpVec(a.tangent, b.tangent, t)),
    normal: normalizeVec(lerpVec(a.normal, b.normal, t)),
    width: a.width + (b.width - a.width) * t,
  };
}

function lerpVec(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function normalizeVec(v: Vec2): Vec2 {
  const m = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / m, y: v.y / m };
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

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
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}
