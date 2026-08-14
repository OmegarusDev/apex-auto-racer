/**
 * Race presentation facade — Apex WebGL engine is the ONLY world path.
 * Canvas2D is reserved for the HUD; the old TrackBaker/TrackBlit world
 * fallback was removed (WebGL is required to render the race world).
 */

import { PRESENT } from '../data/present';
import type { VehicleParts } from '../engine/types';
import { Camera, type CameraTransform } from './Camera';
import { ApexRenderer } from './engine/ApexRenderer';
import type { TrackPalette } from './materials';
import { buildTrackPalette } from './materials';
import type { MinimapPoint } from './track/MinimapPoint';
import { writeCarWorld } from './TrackSampler';
import type {
  CarFrameDto,
  FxImpulse,
  RaceFrameView,
  RaceViewPrepareOpts,
  ScreenRect,
  TrackView,
} from './types';

const carWorldScratch = { x: 0, y: 0, tx: 0, ty: 0, heading: 0 };
const camScratch: CameraTransform = { x: 0, y: 0, zoom: 1 };

export class RaceView {
  readonly camera = new Camera();

  private engine: ApexRenderer | null = null;
  private useEngine = false;

  private minimapPoints: MinimapPoint[] = [];
  private minimapExtent: { minX: number; maxX: number; minY: number; maxY: number } = { minX: 0, maxX: 1, minY: 0, maxY: 1 };
  private track: TrackView | null = null;
  private palette: TrackPalette | null = null;

  /** Bind / create the WebGL world engine on the #world canvas. */
  attachWorldCanvas(canvas: HTMLCanvasElement | null): void {
    if (this.engine !== null) return;
    this.engine = ApexRenderer.tryCreate(canvas);
  }

  prepare(opts: RaceViewPrepareOpts): void {
    this.track = opts.track;
    this.palette = buildTrackPalette(opts.discipline, opts.night, opts.rain);

    if (this.engine === null) {
      const el = typeof document !== 'undefined'
        ? document.querySelector<HTMLCanvasElement>('#world')
        : null;
      this.attachWorldCanvas(el);
    }

    if (this.engine === null) {
      console.error('[apex] WebGL unavailable — no 3D world (WebGL is required)');
      this.useEngine = false;
      return;
    }

    try {
      this.engine.prepare({
        track: opts.track,
        palette: this.palette,
        night: opts.night,
        rain: opts.rain,
      });
      this.minimapPoints = this.engine.getMinimapPoints();
      this.minimapExtent = this.engine.getMinimapExtent();
      this.useEngine = true;
    } catch (err) {
      // WebGL-only: do not fall back to a Canvas2D track. Keep the race
      // running (HUD + physics intact) with the world blank.
      console.error('[apex] WebGL track prepare failed — no 3D world', err);
      this.useEngine = false;
    }
  }

  /** Resize the GL surface (CSS pixels + DPR). */
  resizeWorld(cssW: number, cssH: number, dpr: number): void {
    this.engine?.resize(cssW, cssH, dpr);
  }

  /** Clear the world canvas when leaving race (menus own the HUD canvas). */
  clearWorld(): void {
    this.engine?.clear();
    if (typeof document !== 'undefined') {
      // CSS keeps #world pointer-events:none; drop is-live so menus aren't covered.
      document.querySelector('#world')?.classList.remove('is-live');
    }
  }

  getTrack(): TrackView | null {
    return this.track;
  }

  getPalette(): TrackPalette | null {
    return this.palette;
  }

  /** True when the WebGL engine is driving the race world. */
  get usingEngine(): boolean {
    return this.useEngine;
  }

  writeCamera(out: CameraTransform = camScratch): CameraTransform {
    return this.camera.writeTransform(out);
  }

  syncCameraCountdown(cars: readonly CarFrameDto[], screenW: number, screenH: number): void {
    const positions = cars.map((c) => ({ x: c.worldX, y: c.worldY }));
    this.camera.setCountdownTargets(positions, screenW, screenH);
  }

  /** Instantly align live camera to current targets (race enter). */
  snapCamera(): void {
    this.camera.snapToTargets();
  }

  syncCameraFollow(player: CarFrameDto, screenW: number, screenH: number): void {
    void screenW;
    void screenH;
    this.camera.setFollowTarget(
      { x: player.worldX, y: player.worldY },
      player.v,
      { x: player.tangentX, y: player.tangentY },
    );
  }

  updateCamera(dt: number): void {
    this.camera.update(dt);
  }

  applyFx(impulses: readonly FxImpulse[]): void {
    if (this.useEngine && this.engine !== null) {
      this.engine.applyFx(impulses);
    }
  }

  updateFx(dt: number): void {
    if (this.useEngine && this.engine !== null) {
      this.engine.updateFx(dt, this.camera.x, this.camera.y);
    }
  }

  draw(ctx: CanvasRenderingContext2D, frame: RaceFrameView): void {
    if (this.engine === null) {
      // WebGL-only: no world. Keep the HUD canvas transparent/cleared.
      ctx.clearRect(0, 0, frame.screenW, frame.screenH);
      return;
    }

    if (this.engine.isLost()) {
      console.error('[apex] WebGL context lost — race world disabled');
      try {
        this.engine.dispose();
      } catch {
        /* ignore */
      }
      this.engine = null;
      this.useEngine = false;
      if (typeof document !== 'undefined') {
        document.querySelector('#world')?.classList.remove('is-live');
      }
      ctx.clearRect(0, 0, frame.screenW, frame.screenH);
      return;
    }

    this.engine.resize(
      frame.screenW,
      frame.screenH,
      Math.min(window.devicePixelRatio || 1, PRESENT.dprCap),
    );
    if (this.engine.render(frame)) {
      // HUD canvas stays transparent over the GL world.
      ctx.clearRect(0, 0, frame.screenW, frame.screenH);
    }
  }

  drawMinimap(
    ctx: CanvasRenderingContext2D,
    rect: ScreenRect,
    cars: readonly CarFrameDto[],
    playerIndex: number,
  ): void {
    if (this.minimapPoints.length < 2 || !this.track) return;

    ctx.save();
    ctx.fillStyle = 'rgba(11,13,12,0.82)';
    ctx.strokeStyle = 'rgba(46,54,48,0.95)';
    ctx.lineWidth = 1.5;
    roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, 4);
    ctx.fill();
    ctx.stroke();

    const pad = Math.max(5, rect.w * 0.08);
    const ix = rect.x + pad;
    const iy = rect.y + pad;
    const iw = rect.w - pad * 2;
    const ih = rect.h - pad * 2;

    // The minimap is tied to what is DRAWN — the full closed loop, for
    // circuits and sprints alike.
    const me = this.minimapExtent;
    const spanX = Math.max(me.maxX - me.minX, 1);
    const spanY = Math.max(me.maxY - me.minY, 1);
    const aspect = spanX / spanY;
    let drawW = iw;
    let drawH = ih;
    let ox = 0;
    let oy = 0;
    if (aspect > iw / ih) {
      drawH = iw / aspect;
      oy = (ih - drawH) * 0.5;
    } else {
      drawW = ih * aspect;
      ox = (iw - drawW) * 0.5;
    }

    ctx.beginPath();
    const first = this.minimapPoints[0]!;
    ctx.moveTo(ix + ox + first.nx * drawW, iy + oy + first.ny * drawH);
    for (let i = 1; i < this.minimapPoints.length; i++) {
      const p = this.minimapPoints[i]!;
      ctx.lineTo(ix + ox + p.nx * drawW, iy + oy + p.ny * drawH);
    }
    // The full loop always closes on itself.
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.fill();
    ctx.strokeStyle = this.palette?.accentDim ?? '#a88410';
    ctx.lineWidth = 2;
    ctx.stroke();

    for (let i = 0; i < cars.length; i++) {
      const car = cars[i]!;
      const nx = (car.worldX - me.minX) / spanX;
      const ny = 1 - (car.worldY - me.minY) / spanY;
      const dotR = i === playerIndex ? 4 : 3;
      ctx.fillStyle = i === playerIndex ? (this.palette?.accent ?? '#f0c41a') : '#9a9f96';
      ctx.beginPath();
      ctx.arc(ix + ox + nx * drawW, iy + oy + ny * drawH, dotR, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  sampleCarWorld(
    s: number,
    l: number,
    slipAngle = 0,
    heading?: number,
  ): { x: number; y: number; heading: number; tx: number; ty: number } | null {
    if (!this.track) return null;
    writeCarWorld(this.track, s, l, carWorldScratch, slipAngle, heading);
    return {
      x: carWorldScratch.x,
      y: carWorldScratch.y,
      heading: carWorldScratch.heading,
      tx: carWorldScratch.tx,
      ty: carWorldScratch.ty,
    };
  }
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
  ctx.quadraticCurveTo(x, y + h, x, y + radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

export type { VehicleParts as RaceViewParts };
