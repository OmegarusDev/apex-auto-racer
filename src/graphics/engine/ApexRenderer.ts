/**
 * Apex custom WebGL graphics engine — lit track + cars + FX.
 * Presentation only; consumes RaceFrameView / FxImpulse.
 */

import { PHYSICS } from '../../data/physics';
import type { TrackPalette } from '../materials';
import { raceCameraPull } from '../raceCameraZoom';
import type { CarFrameDto, FxImpulse, RaceFrameView, TrackView } from '../types';
import { buildCarGeometry, buildPlayerRingGeometry } from './CarGeometry';
import {
  bindLitAttribs,
  createGL,
  createMesh,
  destroyMesh,
  linkProgram,
  type GpuMesh,
} from './gl';
import {
  hexToRgb,
  mat4,
  mat4Identity,
  mat4LookAt,
  mat4Multiply,
  mat4Perspective,
  mat4RotateY,
  mat4Scale,
  mat4Translate,
  type Mat4,
  type Vec3,
} from './math';
import { LIT_FRAG, LIT_VERT, SIMPLE_LIT_FRAG } from './shaders';
import { buildTrackGeometry } from './TrackGeometry';

export interface ApexRendererPrepareOpts {
  track: TrackView;
  palette: TrackPalette;
  night: boolean;
  rain: boolean;
}

interface FxParticle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  r: number;
  g: number;
  b: number;
  size: number;
  kind: 'dust' | 'smoke' | 'spark' | 'skid';
}

const MAX_FX = 512;

export class ApexRenderer {
  readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGLRenderingContext;
  private readonly litProg: WebGLProgram;
  private trackMesh: GpuMesh | null = null;
  private carMesh: GpuMesh | null = null;
  private playerRingMesh: GpuMesh | null = null;
  private minimap: Array<{ nx: number; ny: number }> = [];
  private minimapExtent: { minX: number; maxX: number; minY: number; maxY: number } = { minX: 0, maxX: 1, minY: 0, maxY: 1 };
  private night = false;
  private rain = false;
  private readonly fx: FxParticle[] = [];
  private fxCount = 0;
  private fxTick = 0;
  private contextLost = false;
  private readonly onContextLost: (ev: Event) => void;
  private readonly onContextRestored: () => void;

  private readonly view = mat4();
  private readonly proj = mat4();
  private readonly viewProj = mat4();
  private readonly model = mat4();
  private readonly mvp = mat4();
  private readonly tmp = mat4();
  private readonly normalMat = new Float32Array(9);

  private constructor(canvas: HTMLCanvasElement, gl: WebGLRenderingContext) {
    this.canvas = canvas;
    this.gl = gl;
    this.litProg = buildLitProgram(gl);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    this.onContextLost = (ev) => {
      ev.preventDefault();
      this.contextLost = true;
    };
    this.onContextRestored = () => {
      this.contextLost = true; // still force RaceView to rebuild / fall back
    };
    canvas.addEventListener('webglcontextlost', this.onContextLost, false);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored, false);
  }

  static tryCreate(canvas: HTMLCanvasElement | null): ApexRenderer | null {
    if (canvas === null) return null;
    try {
      const gl = createGL(canvas);
      if (gl === null) return null;
      return new ApexRenderer(canvas, gl);
    } catch (err) {
      console.warn('[apex] WebGL engine unavailable', err);
      return null;
    }
  }

  /** True when the GL context died — caller should fall back to Canvas2D. */
  isLost(): boolean {
    return this.contextLost || this.gl.isContextLost();
  }

  dispose(): void {
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost, false);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored, false);
    const gl = this.gl;
    if (this.trackMesh) destroyMesh(gl, this.trackMesh);
    if (this.carMesh) destroyMesh(gl, this.carMesh);
    if (this.playerRingMesh) destroyMesh(gl, this.playerRingMesh);
    this.trackMesh = null;
    this.carMesh = null;
    this.playerRingMesh = null;
    gl.deleteProgram(this.litProg);
  }

  getMinimapPoints(): Array<{ nx: number; ny: number }> {
    return this.minimap;
  }

  getMinimapExtent(): { minX: number; maxX: number; minY: number; maxY: number } {
    return this.minimapExtent;
  }

  resize(cssW: number, cssH: number, dpr: number): void {
    const w = Math.max(1, Math.floor(cssW * dpr));
    const h = Math.max(1, Math.floor(cssH * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.gl.viewport(0, 0, w, h);
  }

  prepare(opts: ApexRendererPrepareOpts): void {
    const gl = this.gl;
    if (this.trackMesh) {
      destroyMesh(gl, this.trackMesh);
      this.trackMesh = null;
    }
    if (this.carMesh) {
      destroyMesh(gl, this.carMesh);
      this.carMesh = null;
    }
    if (this.playerRingMesh) {
      destroyMesh(gl, this.playerRingMesh);
      this.playerRingMesh = null;
    }

    const track = buildTrackGeometry(opts.track, opts.palette);
    this.trackMesh = createMesh(gl, track.vertices, track.indices);
    this.minimap = track.minimap;
    this.minimapExtent = track.minimapExtent;

    const car = buildCarGeometry();
    this.carMesh = createMesh(gl, car.vertices, car.indices);
    const ring = buildPlayerRingGeometry();
    this.playerRingMesh = createMesh(gl, ring.vertices, ring.indices);

    this.night = opts.night;
    this.rain = opts.rain;
    this.fxCount = 0;
  }

  clear(): void {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0.52, 0.62, 0.68, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  }

  applyFx(impulses: readonly FxImpulse[]): void {
    for (const fx of impulses) {
      switch (fx.kind) {
        case 'skid':
          this.spawn(fx.x, 0.03, -fx.y, 0, 0, 0, 0.8, 0.08, 0.08, 0.08, 10, 'skid');
          if (fx.x2 !== undefined && fx.y2 !== undefined) {
            this.spawn(fx.x2, 0.03, -fx.y2, 0, 0, 0, 0.7, 0.08, 0.08, 0.08, 10, 'skid');
          }
          break;
        case 'dust': {
          const n = Math.max(1, Math.floor((fx.intensity ?? 1) * 3));
          for (let i = 0; i < n; i++) {
            const h = hash(fx.index + i * 17);
            this.spawn(
              fx.x + (h - 0.5) * 1.2,
              0.1,
              -fx.y + (hash(fx.index + i * 31) - 0.5) * 1.2,
              (h - 0.5) * 2,
              1.5 + h,
              (hash(fx.index + i * 7) - 0.5) * 2,
              0.6 + h * 0.4,
              0.45,
              0.4,
              0.32,
              14,
              'dust',
            );
          }
          break;
        }
        case 'smoke':
          this.spawn(fx.x, 0.2, -fx.y, 0.2, 1.2, 0.1, 1.1, 0.35, 0.35, 0.38, 22, 'smoke');
          break;
        case 'sparks': {
          const count = fx.count ?? 4;
          for (let i = 0; i < count; i++) {
            const h = hash(fx.index + i * 13);
            this.spawn(
              fx.x,
              0.15,
              -fx.y,
              (h - 0.5) * 8,
              2 + h * 4,
              (hash(fx.index + i * 3) - 0.5) * 8,
              0.25 + h * 0.2,
              1,
              0.75,
              0.25,
              6,
              'spark',
            );
          }
          break;
        }
      }
    }
  }

  updateFx(dt: number, camX = 0, camY = 0): void {
    let w = 0;
    for (let i = 0; i < this.fxCount; i++) {
      const p = this.fx[i]!;
      p.life -= dt;
      if (p.life <= 0) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vy -= 4 * dt;
      if (p.y < 0.02) {
        p.y = 0.02;
        p.vy *= -0.1;
        p.vx *= 0.8;
        p.vz *= 0.8;
      }
      this.fx[w++] = p;
    }
    this.fxCount = w;

    if (this.rain) {
      this.fxTick++;
      // Engine Z = -worldY — spawn rain around the follow camera, not origin.
      const ox = camX;
      const oz = -camY;
      for (let i = 0; i < 6; i++) {
        const h = hash(this.fxTick * 17 + i * 13);
        this.spawn(
          ox + (h - 0.5) * 80,
          12 + h * 8,
          oz + (hash(this.fxTick * 9 + i * 3) - 0.5) * 80,
          0,
          -28,
          0,
          0.35,
          0.55,
          0.65,
          0.75,
          3,
          'dust',
        );
      }
    }
  }

  /** @returns false when the frame was skipped (tiny canvas / missing mesh). */
  render(frame: RaceFrameView): boolean {
    const gl = this.gl;
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (w < 2 || h < 2 || !this.trackMesh || !this.carMesh) return false;

    const bg = this.night ? [0.07, 0.09, 0.12] : [0.52, 0.62, 0.68];
    gl.viewport(0, 0, w, h);
    gl.clearColor(bg[0]!, bg[1]!, bg[2]!, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);

    const player = frame.cars[frame.playerIndex] ?? frame.cars[0];
    this.buildCamera(frame, player);

    gl.useProgram(this.litProg);
    this.setLitGlobals(frame);

    // Track — push its depth away from the camera so cars resting on it always
    // win the depth test. On low-precision (16-bit) mobile depth buffers the
    // ~0.1 unit car lift is below depth resolution at race distances, so the
    // dark track rendered OVER moving cars on some phones. polygonOffset scales
    // with the buffer's own resolution (units = depth-buffer levels).
    mat4Identity(this.model);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1, 4);
    this.drawMesh(this.trackMesh, [1, 1, 1], 1);
    gl.disable(gl.POLYGON_OFFSET_FILL);

    // Player glow ring — subtle pulsing halo under the car so it is always
    // findable in the pack. Additive, drawn under the solid cars.
    if (this.playerRingMesh !== null && player !== undefined && player.isPlayer) {
      const t = performance.now() / 1000;
      const glow = 0.26 + 0.12 * Math.sin(t * 2.6);
      gl.enable(gl.BLEND);
      gl.depthMask(false);
      this.placeRing(player.worldX, player.worldY);
      gl.blendFunc(gl.ONE, gl.ONE);
      this.drawMesh(this.playerRingMesh, hexToRgb(player.color), glow);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    // Solid cars first (no blend)
    for (const car of frame.cars) {
      const lift = car.slotMode === 'deslot' ? 0.35 : 0.12;
      this.placeCar(car.worldX, car.worldY, car.heading, lift);
      const tint = hexToRgb(car.color);
      if (car.isPlayer) {
        tint[0] = Math.min(1, tint[0]! * 1.12 + 0.06);
        tint[1] = Math.min(1, tint[1]! * 1.08 + 0.05);
        tint[2] = Math.min(1, tint[2]! * 1.05 + 0.04);
      }
      // Keep cars colourful — condition only gently desaturates
      const cond = Math.max(0.65, car.condition);
      tint[0]! = tint[0]! * (0.7 + cond * 0.35);
      tint[1]! = tint[1]! * (0.7 + cond * 0.35);
      tint[2]! = tint[2]! * (0.7 + cond * 0.35);
      // Player keeps a steady rim highlight (subtle border glow on the body).
      this.drawMesh(this.carMesh, tint, 1, car.isPlayer ? 0.8 : 0, tint);
    }

    // Ghost + FX need blending (ghost alpha is ignored with blend off).
    gl.enable(gl.BLEND);
    gl.depthMask(false);
    if (frame.ghost) {
      this.placeCar(frame.ghost.worldX, frame.ghost.worldY, frame.ghost.heading, 1);
      this.drawMesh(this.carMesh, hexToRgb(frame.ghost.color), 0.35);
    }
    // Player halo — an additive silhouette glow poking out around the car's
    // outline. Depth writes are off and the solid car already occupies the
    // centre, so only the ring of body poking outside shows: a clear border
    // that reads from the tabletop angle (the fresnel rim alone is invisible
    // at ~45° elevation).
    if (player !== undefined && player.isPlayer) {
      this.placeCar(player.worldX, player.worldY, player.heading, 0.12, 1.1);
      gl.blendFunc(gl.ONE, gl.ONE);
      this.drawMesh(this.carMesh, hexToRgb(player.color), 0.5);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }
    this.drawFxPoints(frame);
    gl.depthMask(true);
    return true;
  }

  private buildCamera(frame: RaceFrameView, player: CarFrameDto | undefined): void {
    void player;
    const cam = frame.camera;
    const aspect = frame.screenW / Math.max(1, frame.screenH);
    // Pan target only — viewpoint orientation is fixed in world space
    // (Scalextric tabletop, not a chase cam behind the car).
    const look: Vec3 = [cam.x, 0.12, -cam.y];

    const zoom = Math.max(0.35, cam.zoom);
    const countdown = frame.countdown !== null;
    const pull = raceCameraPull(frame.raceZoom);
    const elev = ((108 * pull) / zoom) * (countdown ? 1.18 : 1);
    const dist = ((78 * pull) / zoom) * (countdown ? 1.12 : 1);

    // Fixed SE tabletop azimuth in engine XZ (never follows car tangent).
    const azX = 0.58;
    const azZ = 0.81;
    const azLen = Math.hypot(azX, azZ);
    const eye: Vec3 = [
      look[0] + (azX / azLen) * dist,
      elev,
      look[2] + (azZ / azLen) * dist,
    ];

    const far = Math.max(2000, dist * 4);
    mat4Perspective(this.proj, (40 * Math.PI) / 180, aspect, 1.2, far);
    mat4LookAt(this.view, eye, look, [0, 1, 0]);
    mat4Multiply(this.viewProj, this.proj, this.view);

    this.eyeX = eye[0];
    this.eyeY = eye[1];
    this.eyeZ = eye[2];
  }

  private eyeX = 0;
  private eyeY = 40;
  private eyeZ = 0;

  private setLitGlobals(frame: RaceFrameView): void {
    const gl = this.gl;
    const p = this.litProg;
    const night = frame.night ? 1 : 0;
    gl.uniform3f(gl.getUniformLocation(p, 'uLightDir'), 0.32, 0.9, 0.24);
    if (frame.night) {
      gl.uniform3f(gl.getUniformLocation(p, 'uLightColor'), 0.62, 0.7, 0.88);
      gl.uniform3f(gl.getUniformLocation(p, 'uAmbient'), 0.2, 0.23, 0.3);
      gl.uniform3f(gl.getUniformLocation(p, 'uFogColor'), 0.08, 0.1, 0.14);
      gl.uniform1f(gl.getUniformLocation(p, 'uFogDensity'), 0.7);
      gl.uniform1f(gl.getUniformLocation(p, 'uExposure'), 1.05);
    } else {
      // Mid exposure — between cave-dark and washed-out
      gl.uniform3f(gl.getUniformLocation(p, 'uLightColor'), 1.02, 0.98, 0.9);
      gl.uniform3f(gl.getUniformLocation(p, 'uAmbient'), 0.34, 0.36, 0.33);
      gl.uniform3f(gl.getUniformLocation(p, 'uFogColor'), 0.58, 0.66, 0.7);
      gl.uniform1f(gl.getUniformLocation(p, 'uFogDensity'), 0.32);
      gl.uniform1f(gl.getUniformLocation(p, 'uExposure'), 1.06);
    }
    gl.uniform1f(gl.getUniformLocation(p, 'uNight'), night);
    gl.uniform3f(gl.getUniformLocation(p, 'uCameraPos'), this.eyeX, this.eyeY, this.eyeZ);
  }

  private placeCar(worldX: number, worldY: number, heading: number, lift: number, scale = 1.2): void {
    // Engine Z = -worldY, so yaw must match Canvas2D's rotate(-heading).
    // Local +X is car forward (same as CarPainter length axis).
    // Mild toy scale — distance is user-controlled via raceZoom.
    const s = scale;
    mat4Identity(this.tmp);
    mat4RotateY(this.model, this.tmp, -heading);
    mat4Scale(this.tmp, this.model, s, s, s);
    mat4CopyInPlace(this.model, this.tmp);
    mat4Identity(this.tmp);
    mat4Translate(this.tmp, this.tmp, worldX, lift, -worldY);
    mat4Multiply(this.mvp, this.tmp, this.model); // T * R * S
    mat4CopyInPlace(this.model, this.mvp);
    void PHYSICS;
  }

  private placeRing(worldX: number, worldY: number): void {
    mat4Identity(this.tmp);
    mat4Translate(this.model, this.tmp, worldX, 0.015, -worldY);
    mat4CopyInPlace(this.model, this.tmp);
  }

  private drawMesh(mesh: GpuMesh, tint: Vec3, alpha: number, highlight = 0, highlightColor: Vec3 = tint): void {
    const gl = this.gl;
    const p = this.litProg;
    mat4Multiply(this.mvp, this.viewProj, this.model);
    gl.uniformMatrix4fv(gl.getUniformLocation(p, 'uMVP'), false, this.mvp);
    gl.uniformMatrix4fv(gl.getUniformLocation(p, 'uModel'), false, this.model);
    // Normal matrix ≈ upper 3x3 of model (uniform scale / rotation only)
    this.normalMat[0] = this.model[0]!;
    this.normalMat[1] = this.model[1]!;
    this.normalMat[2] = this.model[2]!;
    this.normalMat[3] = this.model[4]!;
    this.normalMat[4] = this.model[5]!;
    this.normalMat[5] = this.model[6]!;
    this.normalMat[6] = this.model[8]!;
    this.normalMat[7] = this.model[9]!;
    this.normalMat[8] = this.model[10]!;
    gl.uniformMatrix3fv(gl.getUniformLocation(p, 'uNormalMat'), false, this.normalMat);
    gl.uniform3f(gl.getUniformLocation(p, 'uTint'), tint[0], tint[1], tint[2]);
    gl.uniform1f(gl.getUniformLocation(p, 'uAlpha'), alpha);
    gl.uniform1f(gl.getUniformLocation(p, 'uHighlight'), highlight);
    gl.uniform3f(
      gl.getUniformLocation(p, 'uHighlightColor'),
      highlightColor[0],
      highlightColor[1],
      highlightColor[2],
    );
    bindLitAttribs(gl, p, mesh);
    // indexType must match the buffer uploaded in createMesh (Uint16 vs Uint32).
    // Inferring from indexCount alone drew UNSIGNED_INT into Uint16 meshes when
    // triangle count crossed 65k — blank / garbled tracks on larger layouts.
    gl.drawElements(gl.TRIANGLES, mesh.indexCount, mesh.indexType, 0);
  }

  private drawFxPoints(frame: RaceFrameView): void {
    void frame;
    if (this.fxCount === 0 || !this.carMesh) return;
    // Reuse car mesh scaled tiny as spark proxies — cheap and lit.
    const gl = this.gl;
    for (let i = 0; i < this.fxCount; i++) {
      const p = this.fx[i]!;
      const t = p.life / p.maxLife;
      mat4Identity(this.tmp);
      mat4Translate(this.model, this.tmp, p.x, p.y, p.z);
      const s = (p.size / 40) * (0.4 + t);
      mat4Scale(this.tmp, this.model, s, s, s);
      mat4CopyInPlace(this.model, this.tmp);
      this.drawMesh(this.carMesh, [p.r, p.g, p.b], t * 0.7);
    }
    void gl;
  }

  private spawn(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    r: number,
    g: number,
    b: number,
    size: number,
    kind: FxParticle['kind'],
  ): void {
    if (this.fxCount >= MAX_FX) return;
    let p = this.fx[this.fxCount];
    if (!p) {
      p = {
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        maxLife: 1,
        r: 1,
        g: 1,
        b: 1,
        size: 1,
        kind: 'dust',
      };
      this.fx[this.fxCount] = p;
    }
    p.x = x;
    p.y = y;
    p.z = z;
    p.vx = vx;
    p.vy = vy;
    p.vz = vz;
    p.life = life;
    p.maxLife = life;
    p.r = r;
    p.g = g;
    p.b = b;
    p.size = size;
    p.kind = kind;
    this.fxCount++;
  }
}

function mat4CopyInPlace(out: Mat4, a: Mat4): void {
  out.set(a);
}

/** highp in fragment shaders is optional in GLES2/WebGL1 — detect it. */
function highpInFragmentSupported(gl: WebGLRenderingContext): boolean {
  try {
    const fmt = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
    return fmt !== null && fmt.rangeMin > 0 && fmt.rangeMax > 0;
  } catch {
    return false;
  }
}

/**
 * Full procedural shader needs highp (large track UVs overflow mediump and
 * NaN the fuzz noise on fp16 GPUs). Without highp, use the flat simple shader
 * so the track is still visible — never black.
 */
function buildLitProgram(gl: WebGLRenderingContext): WebGLProgram {
  if (highpInFragmentSupported(gl)) {
    try {
      return linkProgram(gl, LIT_VERT, LIT_FRAG);
    } catch (err) {
      console.warn('[apex] highp lit shader failed, using simple shader', err);
    }
  } else {
    console.warn('[apex] GPU lacks highp fragment precision — using simple shader');
  }
  return linkProgram(gl, LIT_VERT, SIMPLE_LIT_FRAG);
}

function hash(i: number): number {
  let x = (i | 0) * 374761393 + 668265263;
  x = (x ^ (x >>> 13)) * 1274126177;
  x ^= x >>> 16;
  return (x >>> 0) / 4294967295;
}
