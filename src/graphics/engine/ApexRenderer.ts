/**
 * Apex custom WebGL graphics engine — lit track + cars + FX.
 * Presentation only; consumes RaceFrameView / FxImpulse.
 */

import { PHYSICS } from '../../data/physics';
import type { TrackPalette } from '../materials';
import type { CarFrameDto, FxImpulse, RaceFrameView, TrackView } from '../types';
import { buildCarGeometry } from './CarGeometry';
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
import { LIT_FRAG, LIT_VERT } from './shaders';
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
  private minimap: Array<{ nx: number; ny: number }> = [];
  private night = false;
  private rain = false;
  private readonly fx: FxParticle[] = [];
  private fxCount = 0;
  private fxTick = 0;

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
    this.litProg = linkProgram(gl, LIT_VERT, LIT_FRAG);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
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

  getMinimapPoints(): Array<{ nx: number; ny: number }> {
    return this.minimap;
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
    if (this.trackMesh) destroyMesh(gl, this.trackMesh);
    if (this.carMesh) destroyMesh(gl, this.carMesh);

    const track = buildTrackGeometry(opts.track, opts.palette);
    this.trackMesh = createMesh(gl, track.vertices, track.indices);
    this.minimap = track.minimap;

    const car = buildCarGeometry();
    this.carMesh = createMesh(gl, car.vertices, car.indices);

    this.night = opts.night;
    this.rain = opts.rain;
    this.fxCount = 0;
  }

  clear(): void {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0.42, 0.48, 0.42, 1);
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

  updateFx(dt: number): void {
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
      for (let i = 0; i < 6; i++) {
        const h = hash(this.fxTick * 17 + i * 13);
        this.spawn(
          (h - 0.5) * 80,
          12 + h * 8,
          (hash(this.fxTick * 9 + i * 3) - 0.5) * 80,
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

  render(frame: RaceFrameView): void {
    const gl = this.gl;
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (w < 2 || h < 2 || !this.trackMesh || !this.carMesh) return;

    const bg = this.night ? [0.04, 0.045, 0.06] : [0.42, 0.48, 0.42];
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

    // Track
    mat4Identity(this.model);
    this.drawMesh(this.trackMesh, [1, 1, 1], 1);

    // Ghost
    if (frame.ghost) {
      this.placeCar(frame.ghost.worldX, frame.ghost.worldY, frame.ghost.heading, 1);
      this.drawMesh(this.carMesh, hexToRgb(frame.ghost.color), 0.35);
    }

    // Cars
    for (const car of frame.cars) {
      const lift = car.slotMode === 'deslot' ? 0.35 : 0.08;
      this.placeCar(car.worldX, car.worldY, car.heading, lift);
      const tint = hexToRgb(car.color);
      if (car.isPlayer) {
        tint[0] = Math.min(1, tint[0]! * 1.08 + 0.05);
        tint[1] = Math.min(1, tint[1]! * 1.05 + 0.04);
      }
      const cond = Math.max(0.45, car.condition);
      tint[0]! *= 0.55 + cond * 0.45;
      tint[1]! *= 0.55 + cond * 0.45;
      tint[2]! *= 0.55 + cond * 0.45;
      this.drawMesh(this.carMesh, tint, 1);
    }

    // FX as simple additive-ish lit points via tiny quads — use blend
    gl.enable(gl.BLEND);
    gl.depthMask(false);
    this.drawFxPoints(frame);
    gl.depthMask(true);
  }

  private buildCamera(frame: RaceFrameView, player: CarFrameDto | undefined): void {
    const cam = frame.camera;
    const aspect = frame.screenW / Math.max(1, frame.screenH);
    const look: Vec3 = [cam.x, 0.0, -cam.y];

    let tx = player?.tangentX ?? 0;
    let ty = player?.tangentY ?? 1;
    const tlen = Math.hypot(tx, ty) || 1;
    tx /= tlen;
    ty /= tlen;
    // Engine forward on XZ from world tangent
    const fX = tx;
    const fZ = -ty;

    const zoom = Math.max(0.35, cam.zoom);
    // Pulled back — tabletop overview, not bumper-cam.
    const elev = (78 / zoom) * (frame.countdown !== null ? 1.25 : 1);
    const back = (52 / zoom) * (frame.countdown !== null ? 1.15 : 1);
    const eye: Vec3 = [
      look[0] - fX * back,
      elev,
      look[2] - fZ * back,
    ];

    mat4Perspective(this.proj, (40 * Math.PI) / 180, aspect, 1.0, 520);
    mat4LookAt(this.view, eye, [look[0], 0.15, look[2]], [0, 1, 0]);
    mat4Multiply(this.viewProj, this.proj, this.view);

    // Stash eye for rim/fog in shader via uniform
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
    // Soft late-afternoon sun — warm, not neon
    gl.uniform3f(gl.getUniformLocation(p, 'uLightDir'), 0.35, 0.88, 0.28);
    if (frame.night) {
      gl.uniform3f(gl.getUniformLocation(p, 'uLightColor'), 0.42, 0.48, 0.62);
      gl.uniform3f(gl.getUniformLocation(p, 'uAmbient'), 0.1, 0.12, 0.16);
      gl.uniform3f(gl.getUniformLocation(p, 'uFogColor'), 0.05, 0.06, 0.09);
      gl.uniform1f(gl.getUniformLocation(p, 'uFogDensity'), 1.1);
    } else {
      gl.uniform3f(gl.getUniformLocation(p, 'uLightColor'), 0.92, 0.88, 0.78);
      gl.uniform3f(gl.getUniformLocation(p, 'uAmbient'), 0.28, 0.3, 0.26);
      gl.uniform3f(gl.getUniformLocation(p, 'uFogColor'), 0.55, 0.6, 0.52);
      gl.uniform1f(gl.getUniformLocation(p, 'uFogDensity'), 0.45);
    }
    gl.uniform1f(gl.getUniformLocation(p, 'uNight'), night);
    gl.uniform3f(gl.getUniformLocation(p, 'uCameraPos'), this.eyeX, this.eyeY, this.eyeZ);
  }

  private placeCar(worldX: number, worldY: number, heading: number, lift: number): void {
    // model = T * R — rotate in local space, then translate into world.
    mat4Identity(this.tmp);
    mat4RotateY(this.model, this.tmp, heading);
    mat4Identity(this.tmp);
    mat4Translate(this.tmp, this.tmp, worldX, lift, -worldY);
    mat4Multiply(this.mvp, this.tmp, this.model); // borrow mvp as scratch T*R
    mat4CopyInPlace(this.model, this.mvp);
    void PHYSICS;
  }

  private drawMesh(mesh: GpuMesh, tint: Vec3, alpha: number): void {
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
    bindLitAttribs(gl, p, mesh);
    const type = mesh.indexCount > 65535 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
    // OES_element_index_uint may be needed for UNSIGNED_INT — tracks stay under 65k with our builder
    gl.drawElements(gl.TRIANGLES, mesh.indexCount, gl.UNSIGNED_SHORT, 0);
    void type;
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

function hash(i: number): number {
  let x = (i | 0) * 374761393 + 668265263;
  x = (x ^ (x >>> 13)) * 1274126177;
  x ^= x >>> 16;
  return (x >>> 0) / 4294967295;
}
