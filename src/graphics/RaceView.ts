/**
 * Race presentation facade.
 * Prefers the Apex WebGL engine for the world pass; Canvas2D remains HUD + fallback.
 */

import { PHYSICS } from '../data/physics';
import type { DisciplineId } from '../data/disciplines';
import type { VehicleParts } from '../engine/types';
import { emptyVehicleParts } from '../engine/types';
import { Camera, type CameraTransform } from './Camera';
import { PX_PER_M, writeWorldToScreen } from './coords';
import { drawSlotCarMesh, drawSlotCarShadow } from './car/CarPainter';
import { ApexRenderer } from './engine/ApexRenderer';
import { ParticleSystem } from './fx/ParticleSystem';
import type { TrackPalette } from './materials';
import { buildTrackPalette } from './materials';
import { bakeTrack, type BakeMeta, type MinimapPoint } from './track/TrackBaker';
import { blitNightVignette, blitTrack, buildNightVignette } from './track/TrackBlit';
import { writeCarWorld } from './TrackSampler';
import type {
  CarFrameDto,
  FxImpulse,
  RaceFrameView,
  RaceViewPrepareOpts,
  ScreenRect,
  TrackView,
} from './types';

const screenScratch = { x: 0, y: 0 };
const carWorldScratch = { x: 0, y: 0, tx: 0, ty: 0, heading: 0 };
const camScratch: CameraTransform = { x: 0, y: 0, zoom: 1 };

export class RaceView {
  readonly camera = new Camera();
  readonly particles = new ParticleSystem();

  private engine: ApexRenderer | null = null;
  private useEngine = false;

  private baked: HTMLCanvasElement | null = null;
  private bakeMeta: BakeMeta | null = null;
  private minimapPoints: MinimapPoint[] = [];
  private nightScreenOverlay: HTMLCanvasElement | null = null;
  private nightScreenKey = '';
  private track: TrackView | null = null;
  private discipline: DisciplineId | null = null;
  private palette: TrackPalette | null = null;

  /** Bind / create the WebGL world engine on the #world canvas. */
  attachWorldCanvas(canvas: HTMLCanvasElement | null): void {
    if (this.engine !== null) return;
    this.engine = ApexRenderer.tryCreate(canvas);
  }

  prepare(opts: RaceViewPrepareOpts): void {
    this.track = opts.track;
    this.discipline = opts.discipline;
    this.palette = buildTrackPalette(opts.discipline, opts.night, opts.rain);

    if (this.engine === null) {
      const el = typeof document !== 'undefined'
        ? document.querySelector<HTMLCanvasElement>('#world')
        : null;
      this.attachWorldCanvas(el);
    }

    this.useEngine = this.engine !== null;
    if (this.engine !== null) {
      try {
        this.engine.prepare({
          track: opts.track,
          palette: this.palette,
          night: opts.night,
          rain: opts.rain,
        });
        this.minimapPoints = this.engine.getMinimapPoints();
        this.baked = null;
        this.bakeMeta = null;
      } catch (err) {
        console.warn('[apex] WebGL track prepare failed — Canvas2D fallback', err);
        this.dropEngineToCanvas2d(opts.night, opts.rain);
      }
    } else {
      this.bakeCanvas2d(opts.track, opts.discipline, opts.night, opts.rain);
    }

    this.nightScreenOverlay = null;
    this.nightScreenKey = '';
    this.particles.setRaining(opts.rain);
  }

  /** Resize the GL surface (CSS pixels + DPR). */
  resizeWorld(cssW: number, cssH: number, dpr: number): void {
    this.engine?.resize(cssW, cssH, dpr);
  }

  /** Clear the world canvas when leaving race (menus own the HUD canvas). */
  clearWorld(): void {
    this.engine?.clear();
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

  /** Drop a dead GL context and bake a Canvas2D track so cars stay visible. */
  private dropEngineToCanvas2d(night: boolean, rain: boolean): void {
    if (this.engine !== null) {
      try {
        this.engine.dispose();
      } catch {
        /* ignore */
      }
    }
    this.engine = null;
    this.useEngine = false;
    if (typeof document !== 'undefined') {
      document.querySelector('#world')?.classList.remove('is-live');
    }
    if (this.track !== null && this.discipline !== null) {
      this.bakeCanvas2d(this.track, this.discipline, night, rain);
    }
  }

  private bakeCanvas2d(
    track: TrackView,
    discipline: DisciplineId,
    night: boolean,
    rain: boolean,
  ): void {
    const result = bakeTrack(track, discipline, night, rain);
    this.baked = result.canvas;
    this.bakeMeta = result.meta;
    this.minimapPoints = result.minimap;
    this.palette = result.palette;
    this.particles.setRaining(rain);
  }

  writeCamera(out: CameraTransform = camScratch): CameraTransform {
    return this.camera.writeTransform(out);
  }

  syncCameraCountdown(cars: readonly CarFrameDto[], screenW: number, screenH: number): void {
    const positions = cars.map((c) => ({ x: c.worldX, y: c.worldY }));
    this.camera.setCountdownTargets(positions, screenW, screenH);
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
      return;
    }
    for (const fx of impulses) {
      switch (fx.kind) {
        case 'skid':
          this.particles.emitSkid(fx.x, fx.y, fx.x2 ?? fx.x, fx.y2 ?? fx.y);
          break;
        case 'dust':
          this.particles.emitDust(fx.x, fx.y, fx.index, fx.intensity ?? 1);
          break;
        case 'smoke':
          this.particles.emitSmoke(fx.x, fx.y, fx.index);
          break;
        case 'sparks':
          this.particles.emitSparks(fx.x, fx.y, fx.index, fx.count ?? 4);
          break;
      }
    }
  }

  updateFx(dt: number): void {
    if (this.useEngine && this.engine !== null) {
      this.engine.updateFx(dt);
      return;
    }
    this.particles.update(dt);
  }

  draw(ctx: CanvasRenderingContext2D, frame: RaceFrameView): void {
    if (this.useEngine && this.engine !== null) {
      if (this.engine.isLost()) {
        console.warn('[apex] WebGL context lost — falling back to Canvas2D');
        this.dropEngineToCanvas2d(frame.night, frame.rain);
      } else {
        this.engine.resize(
          frame.screenW,
          frame.screenH,
          Math.min(window.devicePixelRatio || 1, PHYSICS.dprCap),
        );
        this.engine.render(frame);
        // HUD canvas stays transparent over the GL world.
        ctx.clearRect(0, 0, frame.screenW, frame.screenH);
        return;
      }
    }

    if (!this.baked || !this.bakeMeta) return;
    const { camera, screenW, screenH } = frame;
    // Apply race zoom to 2D blit (GL path uses frame.raceZoom in ApexRenderer).
    const z = Math.max(0, Math.min(1, frame.raceZoom));
    const cam2d = {
      x: camera.x,
      y: camera.y,
      zoom: camera.zoom * (0.28 + z * 0.9),
    };

    blitTrack(ctx, this.baked, this.bakeMeta, cam2d, screenW, screenH);

    if (frame.night) {
      const key = `${screenW}x${screenH}`;
      if (this.nightScreenOverlay === null || this.nightScreenKey !== key) {
        this.nightScreenOverlay = buildNightVignette(screenW, screenH);
        this.nightScreenKey = key;
      }
      blitNightVignette(ctx, this.nightScreenOverlay, screenW, screenH);
    }

    if (frame.ghost !== null) {
      this.drawGhostAt(ctx, frame.ghost, cam2d, screenW, screenH);
    }

    this.particles.renderGround(ctx, cam2d, screenW, screenH);

    for (const car of frame.cars) {
      this.drawCarDto(ctx, car, cam2d, screenW, screenH);
    }

    this.particles.renderAir(ctx, cam2d, screenW, screenH);
    this.particles.renderRain(ctx, screenW, screenH);
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

    const b = this.track.bounds;
    const spanX = Math.max(b.maxX - b.minX, 1);
    const spanY = Math.max(b.maxY - b.minY, 1);
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
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.fill();
    ctx.strokeStyle = this.palette?.accentDim ?? '#a88410';
    ctx.lineWidth = 2;
    ctx.stroke();

    for (let i = 0; i < cars.length; i++) {
      const car = cars[i]!;
      const nx = (car.worldX - b.minX) / spanX;
      const ny = 1 - (car.worldY - b.minY) / spanY;
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

  private drawCarDto(
    ctx: CanvasRenderingContext2D,
    car: CarFrameDto,
    camera: CameraTransform,
    screenW: number,
    screenH: number,
  ): void {
    writeWorldToScreen(car.worldX, car.worldY, camera, screenW, screenH, screenScratch);
    const len = PHYSICS.carLength * PX_PER_M * camera.zoom;
    const wid = PHYSICS.carWidth * PX_PER_M * camera.zoom;
    const deslot = car.slotMode === 'deslot';
    const wobble = Math.min(1, car.lineNoise / 1.2);

    ctx.save();
    ctx.translate(screenScratch.x, screenScratch.y);
    drawSlotCarShadow(ctx, len, wid, car.isPlayer ? 0.42 : 0.34, deslot);
    ctx.restore();

    ctx.save();
    ctx.translate(screenScratch.x, screenScratch.y);
    ctx.rotate(-car.heading);
    drawSlotCarMesh(ctx, {
      len,
      wid,
      color: car.color,
      isPlayer: car.isPlayer,
      detail: 'race',
      discipline: this.discipline ?? undefined,
      tyreTemp: car.tyreTemp,
      deslot,
      condition: car.condition,
      partTiers: car.partTiers,
      lineWobble: deslot ? 0 : wobble * 0.35,
    });
    ctx.restore();
  }

  private drawGhostAt(
    ctx: CanvasRenderingContext2D,
    ghost: NonNullable<RaceFrameView['ghost']>,
    camera: CameraTransform,
    screenW: number,
    screenH: number,
  ): void {
    writeWorldToScreen(ghost.worldX, ghost.worldY, camera, screenW, screenH, screenScratch);
    const len = PHYSICS.carLength * PX_PER_M * camera.zoom;
    const wid = PHYSICS.carWidth * PX_PER_M * camera.zoom;

    ctx.save();
    ctx.translate(screenScratch.x, screenScratch.y);
    drawSlotCarShadow(ctx, len, wid, 0.12, false);
    ctx.restore();

    ctx.save();
    ctx.translate(screenScratch.x, screenScratch.y);
    ctx.rotate(-ghost.heading);
    drawSlotCarMesh(ctx, {
      len,
      wid,
      color: ghost.color,
      alpha: 0.32,
      detail: 'race',
      discipline: this.discipline ?? undefined,
      partTiers: emptyVehicleParts(1),
    });
    ctx.restore();
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
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

export type { VehicleParts as RaceViewParts };
