import { PHYSICS } from '../data/physics';
import type { DisciplineId } from '../data/disciplines';
import type { VehicleParts } from '../engine/types';
import { emptyVehicleParts } from '../engine/types';
import { Camera, type CameraTransform } from './Camera';
import { PX_PER_M, writeWorldToScreen } from './coords';
import { drawSlotCarMesh, drawSlotCarShadow } from './car/CarPainter';
import { ParticleSystem } from './fx/ParticleSystem';
import type { TrackPalette } from './materials';
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

  private baked: HTMLCanvasElement | null = null;
  private bakeMeta: BakeMeta | null = null;
  private minimapPoints: MinimapPoint[] = [];
  private nightScreenOverlay: HTMLCanvasElement | null = null;
  private nightScreenKey = '';
  private track: TrackView | null = null;
  private discipline: DisciplineId | null = null;
  private palette: TrackPalette | null = null;

  prepare(opts: RaceViewPrepareOpts): void {
    this.track = opts.track;
    this.discipline = opts.discipline;
    const result = bakeTrack(opts.track, opts.discipline, opts.night, opts.rain);
    this.baked = result.canvas;
    this.bakeMeta = result.meta;
    this.minimapPoints = result.minimap;
    this.palette = result.palette;
    this.nightScreenOverlay = null;
    this.nightScreenKey = '';
    this.particles.setRaining(opts.rain);
  }

  getTrack(): TrackView | null {
    return this.track;
  }

  getPalette(): TrackPalette | null {
    return this.palette;
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
    this.particles.update(dt);
  }

  draw(ctx: CanvasRenderingContext2D, frame: RaceFrameView): void {
    if (!this.baked || !this.bakeMeta) return;
    const { camera, screenW, screenH } = frame;

    blitTrack(ctx, this.baked, this.bakeMeta, camera, screenW, screenH);

    if (frame.night) {
      const key = `${screenW}x${screenH}`;
      if (this.nightScreenOverlay === null || this.nightScreenKey !== key) {
        this.nightScreenOverlay = buildNightVignette(screenW, screenH);
        this.nightScreenKey = key;
      }
      blitNightVignette(ctx, this.nightScreenOverlay, screenW, screenH);
    }

    if (frame.ghost !== null) {
      this.drawGhostAt(ctx, frame.ghost, camera, screenW, screenH);
    }

    this.particles.renderGround(ctx, camera, screenW, screenH);

    for (const car of frame.cars) {
      this.drawCarDto(ctx, car, camera, screenW, screenH);
    }

    this.particles.renderAir(ctx, camera, screenW, screenH);
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
    ctx.fillStyle = 'rgba(10,10,12,0.78)';
    ctx.strokeStyle = 'rgba(42,42,50,0.95)';
    ctx.lineWidth = 1;
    roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, 6);
    ctx.fill();
    ctx.stroke();

    const pad = Math.max(5, rect.w * 0.08);
    const ix = rect.x + pad;
    const iy = rect.y + pad;
    const iw = rect.w - pad * 2;
    const ih = rect.h - pad * 2;

    // Letterbox aspect-correct polyline into the square panel.
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
    ctx.strokeStyle = this.palette?.accentDim ?? '#0e7490';
    ctx.lineWidth = 2;
    ctx.stroke();

    for (let i = 0; i < cars.length; i++) {
      const car = cars[i]!;
      const nx = (car.worldX - b.minX) / spanX;
      const ny = 1 - (car.worldY - b.minY) / spanY;
      const dotR = i === playerIndex ? 4 : 3;
      ctx.fillStyle = i === playerIndex ? (this.palette?.accent ?? '#22d3ee') : '#a1a1aa';
      ctx.beginPath();
      ctx.arc(ix + ox + nx * drawW, iy + oy + ny * drawH, dotR, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  /** Sample car world pose onto track (for FX that need live positions). */
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
