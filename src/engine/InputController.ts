import { PHYSICS } from '../data/physics';

export type InputMode = 'menu' | 'race';

const THROTTLE_KEYS = new Set(['ArrowRight', 'ArrowUp', 'Enter', 'KeyW']);
const BRAKE_KEYS = new Set(['ArrowLeft', 'ArrowDown', 'Space', 'KeyS']);

export interface PointerSample {
  id: number;
  x: number;
  y: number;
  active: boolean;
  side: 'left' | 'right' | 'none';
}

export interface ClickEvent {
  x: number;
  y: number;
  consumed: boolean;
}

export class InputController {
  mode: InputMode = 'menu';

  throttle = 0;
  brake = 0;

  /** Accumulated seconds with either pedal above 0.1 (race input tracking). */
  inputTime = 0;

  pointerX = 0;
  pointerY = 0;

  readonly keysDown = new Set<string>();

  private canvas: HTMLCanvasElement | null = null;
  private pointers = new Map<number, PointerSample>();
  private targetThrottle = 0;
  private targetBrake = 0;
  private pendingClick: ClickEvent | null = null;
  private bound = false;

  private onPointerDown = (ev: PointerEvent): void => {
    if (!this.canvas) return;
    this.canvas.setPointerCapture(ev.pointerId);
    const rect = this.canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    this.pointerX = x;
    this.pointerY = y;

    if (this.mode === 'menu') {
      this.pendingClick = { x, y, consumed: false };
      return;
    }

    const side = this.sideForX(x);
    this.pointers.set(ev.pointerId, { id: ev.pointerId, x, y, active: true, side });
    this.syncPedalTargets();
  };

  private onPointerMove = (ev: PointerEvent): void => {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    this.pointerX = x;
    this.pointerY = y;

    const p = this.pointers.get(ev.pointerId);
    if (p !== undefined) {
      p.x = x;
      p.y = y;
      p.side = this.sideForX(x);
    }
  };

  private onPointerUp = (ev: PointerEvent): void => {
    if (!this.canvas) return;
    if (this.canvas.hasPointerCapture(ev.pointerId)) {
      this.canvas.releasePointerCapture(ev.pointerId);
    }
    this.pointers.delete(ev.pointerId);
    this.syncPedalTargets();
  };

  private onPointerCancel = (ev: PointerEvent): void => {
    this.onPointerUp(ev);
  };

  private onKeyDown = (ev: KeyboardEvent): void => {
    this.keysDown.add(ev.code);
    if (this.mode === 'race') {
      this.syncPedalTargets();
    }
  };

  private onKeyUp = (ev: KeyboardEvent): void => {
    this.keysDown.delete(ev.code);
    if (this.mode === 'race') {
      this.syncPedalTargets();
    }
  };

  attach(canvas: HTMLCanvasElement): void {
    if (this.bound) this.detach();
    this.canvas = canvas;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerCancel);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.bound = true;
  }

  detach(): void {
    if (!this.canvas || !this.bound) return;
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerCancel);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.pointers.clear();
    this.bound = false;
  }

  setMode(mode: InputMode): void {
    this.mode = mode;
    if (mode === 'menu') {
      this.targetThrottle = 0;
      this.targetBrake = 0;
      this.pointers.clear();
    }
    this.syncPedalTargets();
  }

  resetRaceInput(): void {
    this.inputTime = 0;
    this.targetThrottle = 0;
    this.targetBrake = 0;
    this.throttle = 0;
    this.brake = 0;
    this.pointers.clear();
  }

  update(dt: number): void {
    const ease = this.pedalEaseRate(dt);
    this.throttle = this.easeToward(this.throttle, this.targetThrottle, ease);
    this.brake = this.easeToward(this.brake, this.targetBrake, ease);

    if (this.mode === 'race' && (this.throttle > 0.1 || this.brake > 0.1)) {
      this.inputTime += dt;
    }
  }

  /** Returns the latest menu click if not yet consumed. */
  peekClick(): ClickEvent | null {
    if (this.pendingClick === null || this.pendingClick.consumed) return null;
    return this.pendingClick;
  }

  consumeClick(): ClickEvent | null {
    const click = this.peekClick();
    if (click !== null) click.consumed = true;
    return click;
  }

  isKeyDown(code: string): boolean {
    return this.keysDown.has(code);
  }

  getActivePointers(): PointerSample[] {
    return [...this.pointers.values()];
  }

  private sideForX(x: number): 'left' | 'right' | 'none' {
    if (!this.canvas) return 'none';
    const w = this.canvas.clientWidth;
    if (w <= 0) return 'none';
    return x < w * 0.5 ? 'left' : 'right';
  }

  private syncPedalTargets(): void {
    if (this.mode !== 'race') {
      this.targetThrottle = 0;
      this.targetBrake = 0;
      return;
    }

    let ptrThrottle = 0;
    let ptrBrake = 0;
    for (const p of this.pointers.values()) {
      if (!p.active) continue;
      if (p.side === 'right') ptrThrottle = 1;
      if (p.side === 'left') ptrBrake = 1;
    }

    let keyThrottle = 0;
    let keyBrake = 0;
    for (const code of this.keysDown) {
      if (THROTTLE_KEYS.has(code)) keyThrottle = 1;
      if (BRAKE_KEYS.has(code)) keyBrake = 1;
    }

    this.targetThrottle = Math.max(ptrThrottle, keyThrottle);
    this.targetBrake = Math.max(ptrBrake, keyBrake);
  }

  private pedalEaseRate(dt: number): number {
    const ms = PHYSICS.pedalEaseMs;
    if (ms <= 0) return 1;
    return Math.min(1, dt / (ms / 1000));
  }

  private easeToward(current: number, target: number, rate: number): number {
    if (current === target) return current;
    if (target > current) return Math.min(target, current + rate);
    return Math.max(target, current - rate);
  }
}
