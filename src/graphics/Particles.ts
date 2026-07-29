import { PHYSICS } from '../data/physics.ts';
import type { CameraTransform } from './Camera.ts';

const SKID_CAP = 600;
const DUST_CAP = 300;
const SMOKE_CAP = 200;
const SPARK_CAP = 100;
const RAIN_CAP = 150;

interface SkidSeg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  life: number;
  maxLife: number;
}

interface DustPuff {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
}

interface SmokePuff {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
}

interface RainStreak {
  x: number;
  y: number;
  vy: number;
  len: number;
  life: number;
  maxLife: number;
}

/** Deterministic unit float in [0, 1) from slot index — no Math.random. */
function hashUnit(index: number, salt: number): number {
  let h = (Math.imul(index, 374761393) + Math.imul(salt, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function hashSigned(index: number, salt: number): number {
  return hashUnit(index, salt) * 2 - 1;
}

export class Particles {
  private skids: SkidSeg[] = new Array(SKID_CAP);
  private dust: DustPuff[] = new Array(DUST_CAP);
  private smoke: SmokePuff[] = new Array(SMOKE_CAP);
  private sparks: Spark[] = new Array(SPARK_CAP);
  private rain: RainStreak[] = new Array(RAIN_CAP);

  private skidHead = 0;
  private dustHead = 0;
  private smokeHead = 0;
  private sparkHead = 0;
  private rainHead = 0;

  private raining = false;
  private rainSpawnAcc = 0;

  setRaining(on: boolean): void {
    this.raining = on;
  }

  emitSkid(x1: number, y1: number, x2: number, y2: number, life = 1.8): void {
    const i = this.skidHead;
    this.skids[i] = { x1, y1, x2, y2, life, maxLife: life };
    this.skidHead = (i + 1) % SKID_CAP;
  }

  emitDust(x: number, y: number, index: number, intensity = 1): void {
    const i = this.dustHead;
    const spread = 2.5 * intensity;
    this.dust[i] = {
      x,
      y,
      vx: hashSigned(index, 11) * spread,
      vy: hashSigned(index, 17) * spread,
      life: 0.6 + hashUnit(index, 23) * 0.4,
      maxLife: 1,
      size: 3 + hashUnit(index, 29) * 4 * intensity,
    };
    this.dust[i]!.maxLife = this.dust[i]!.life;
    this.dustHead = (i + 1) % DUST_CAP;
  }

  emitSmoke(x: number, y: number, index: number): void {
    const i = this.smokeHead;
    this.smoke[i] = {
      x,
      y,
      vx: hashSigned(index, 31) * 1.2,
      vy: hashSigned(index, 37) * 1.2 + 0.8,
      life: 1.2 + hashUnit(index, 41) * 0.8,
      maxLife: 2,
      size: 8 + hashUnit(index, 43) * 10,
    };
    this.smoke[i]!.maxLife = this.smoke[i]!.life;
    this.smokeHead = (i + 1) % SMOKE_CAP;
  }

  emitSparks(x: number, y: number, index: number, count = 4): void {
    for (let n = 0; n < count; n++) {
      const i = this.sparkHead;
      const sub = index * 7 + n;
      const speed = 4 + hashUnit(sub, 47) * 8;
      const angle = hashUnit(sub, 53) * Math.PI * 2;
      this.sparks[i] = {
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.15 + hashUnit(sub, 59) * 0.25,
        maxLife: 0.4,
      };
      this.sparks[i]!.maxLife = this.sparks[i]!.life;
      this.sparkHead = (i + 1) % SPARK_CAP;
    }
  }

  update(dt: number): void {
    this.tickSkids(dt);
    this.tickPuffs(this.dust, DUST_CAP, dt, 0.92);
    this.tickPuffs(this.smoke, SMOKE_CAP, dt, 0.96);
    this.tickSparks(dt);
    this.tickRain(dt);
  }

  render(ctx: CanvasRenderingContext2D, camera: CameraTransform, screenW: number, screenH: number): void {
    const cx = screenW * 0.5;
    const cy = screenH * 0.5;
    const scale = PHYSICS.pxPerM * camera.zoom;

    const toScreen = (wx: number, wy: number): { x: number; y: number } => ({
      x: cx + (wx - camera.x) * scale,
      y: cy - (wy - camera.y) * scale,
    });

    ctx.save();
    ctx.lineCap = 'round';

    for (let i = 0; i < SKID_CAP; i++) {
      const s = this.skids[i];
      if (!s || s.life <= 0) continue;
      const t = s.life / s.maxLife;
      const a = t * 0.55;
      const p1 = toScreen(s.x1, s.y1);
      const p2 = toScreen(s.x2, s.y2);
      ctx.strokeStyle = `rgba(20,20,24,${a})`;
      ctx.lineWidth = 2.5 * camera.zoom;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }

    for (let i = 0; i < DUST_CAP; i++) {
      const d = this.dust[i];
      if (!d || d.life <= 0) continue;
      const t = d.life / d.maxLife;
      const p = toScreen(d.x, d.y);
      ctx.fillStyle = `rgba(180,160,130,${t * 0.35})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, d.size * camera.zoom * (1 + (1 - t) * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }

    for (let i = 0; i < SMOKE_CAP; i++) {
      const s = this.smoke[i];
      if (!s || s.life <= 0) continue;
      const t = s.life / s.maxLife;
      const p = toScreen(s.x, s.y);
      ctx.fillStyle = `rgba(80,80,88,${t * 0.25})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, s.size * camera.zoom * (1 + (1 - t)), 0, Math.PI * 2);
      ctx.fill();
    }

    for (let i = 0; i < SPARK_CAP; i++) {
      const s = this.sparks[i];
      if (!s || s.life <= 0) continue;
      const t = s.life / s.maxLife;
      const p = toScreen(s.x, s.y);
      const tail = toScreen(s.x - s.vx * 0.04, s.y - s.vy * 0.04);
      ctx.strokeStyle = `rgba(255,200,80,${t})`;
      ctx.lineWidth = 1.5 * camera.zoom;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(tail.x, tail.y);
      ctx.stroke();
    }

    ctx.restore();
  }

  renderRain(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    this.screenW = w;
    this.screenH = h;
    if (!this.raining) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(160,190,220,0.35)';
    ctx.lineWidth = 1;

    for (let i = 0; i < RAIN_CAP; i++) {
      const r = this.rain[i];
      if (!r || r.life <= 0) continue;
      const t = r.life / r.maxLife;
      ctx.globalAlpha = t * 0.6;
      ctx.beginPath();
      ctx.moveTo(r.x, r.y);
      ctx.lineTo(r.x - 2, r.y + r.len);
      ctx.stroke();
    }

    ctx.restore();
  }

  private tickSkids(dt: number): void {
    for (let i = 0; i < SKID_CAP; i++) {
      const s = this.skids[i];
      if (s && s.life > 0) s.life -= dt;
    }
  }

  private tickPuffs<T extends { life: number; x: number; y: number; vx: number; vy: number }>(
    arr: T[],
    cap: number,
    dt: number,
    drag: number,
  ): void {
    for (let i = 0; i < cap; i++) {
      const p = arr[i];
      if (!p || p.life <= 0) continue;
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= drag;
      p.vy *= drag;
    }
  }

  private tickSparks(dt: number): void {
    for (let i = 0; i < SPARK_CAP; i++) {
      const s = this.sparks[i];
      if (!s || s.life <= 0) continue;
      s.life -= dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vx *= 0.9;
      s.vy *= 0.9;
    }
  }

  private screenW = 800;
  private screenH = 600;

  private tickRain(dt: number): void {
    for (let i = 0; i < RAIN_CAP; i++) {
      const r = this.rain[i];
      if (!r || r.life <= 0) continue;
      r.life -= dt;
      r.y += r.vy * dt;
      if (r.y > this.screenH + r.len) r.life = 0;
    }

    if (!this.raining) return;

    this.rainSpawnAcc += dt * 120;
    while (this.rainSpawnAcc >= 1) {
      this.rainSpawnAcc -= 1;
      const i = this.rainHead;
      const idx = i;
      this.rain[i] = {
        x: hashUnit(idx, 61) * this.screenW,
        y: -hashUnit(idx, 67) * this.screenH * 0.25,
        vy: 420 + hashUnit(idx, 71) * 180,
        len: 12 + hashUnit(idx, 73) * 16,
        life: 0.8 + hashUnit(idx, 79) * 0.4,
        maxLife: 1.2,
      };
      this.rain[i]!.maxLife = this.rain[i]!.life;
      this.rainHead = (i + 1) % RAIN_CAP;
    }
  }
}
