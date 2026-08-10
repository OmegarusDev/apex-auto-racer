import { PHYSICS } from '../data/physics';
import {
  pointInRect,
  type RaceChromeLayout,
} from '../graphics/hud/raceChromeLayout';

export type InputMode = 'menu' | 'race';

/** Enter = gas (primary). WASD/arrows kept as aliases. */
const THROTTLE_KEYS = new Set(['Enter', 'ArrowRight', 'ArrowUp', 'KeyW']);
/** Space = brake (primary). */
const BRAKE_KEYS = new Set(['Space', 'ArrowLeft', 'ArrowDown', 'KeyS']);
/** Shift = manual upshift (auto downshift when off throttle). */
const UPSHIFT_KEYS = new Set(['ShiftLeft', 'ShiftRight']);

export interface PointerSample {
  id: number;
  x: number;
  y: number;
  active: boolean;
  side: 'left' | 'right' | 'shift' | 'none';
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
  /** Edge-triggered: true for one update after Shift / SHIFT pad press. */
  upshiftPulse = false;

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
  private shiftKeysHeld = new Set<string>();
  private touchShiftHeld = false;
  private prevTouchShift = false;
  private raceChrome: RaceChromeLayout | null = null;
  /** When true (pause modal), all taps become UI clicks — no pedals. */
  private uiCapture = false;

  /** RaceScene pushes layout each frame so hit zones match draw. */
  setRaceChrome(layout: RaceChromeLayout | null): void {
    this.raceChrome = layout;
  }

  setUiCapture(on: boolean): void {
    this.uiCapture = on;
    if (on) {
      this.pointers.clear();
      this.targetThrottle = 0;
      this.targetBrake = 0;
      this.touchShiftHeld = false;
      this.syncPedalTargets();
    }
  }

  private onPointerDown = (ev: PointerEvent): void => {
    if (!this.canvas) return;
    this.canvas.setPointerCapture(ev.pointerId);
    const rect = this.canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    this.pointerX = x;
    this.pointerY = y;

    if (this.mode === 'menu' || this.uiCapture) {
      this.pendingClick = { x, y, consumed: false };
      // Keep the pointer active so sliders / drag-scroll see pointerDown
      // across frames (pendingClick alone is edge-consumed in buildUi).
      this.pointers.set(ev.pointerId, { id: ev.pointerId, x, y, active: true, side: 'none' });
      return;
    }

    if (this.hitDeadZone(x, y) || this.hitPause(x, y)) {
      this.pendingClick = { x, y, consumed: false };
      return;
    }

    const side = this.sideForPoint(x, y);
    if (side === 'none') return;
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
      if (this.mode === 'race' && !this.uiCapture) {
        if (this.hitDeadZone(x, y)) {
          p.side = 'none';
        } else {
          p.side = this.sideForPoint(x, y);
        }
        this.syncPedalTargets();
      }
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
    if (this.mode === 'race' && !this.uiCapture) {
      if (UPSHIFT_KEYS.has(ev.code) && !this.shiftKeysHeld.has(ev.code)) {
        this.shiftKeysHeld.add(ev.code);
        this.upshiftPulse = true;
      }
      this.syncPedalTargets();
      if (THROTTLE_KEYS.has(ev.code) || BRAKE_KEYS.has(ev.code) || UPSHIFT_KEYS.has(ev.code)) {
        ev.preventDefault();
      }
    }
  };

  private onKeyUp = (ev: KeyboardEvent): void => {
    this.keysDown.delete(ev.code);
    this.shiftKeysHeld.delete(ev.code);
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
      this.upshiftPulse = false;
      this.shiftKeysHeld.clear();
      this.uiCapture = false;
      this.raceChrome = null;
    }
    this.syncPedalTargets();
  }

  resetRaceInput(): void {
    this.inputTime = 0;
    this.targetThrottle = 0;
    this.targetBrake = 0;
    this.throttle = 0;
    this.brake = 0;
    this.upshiftPulse = false;
    this.shiftKeysHeld.clear();
    this.touchShiftHeld = false;
    this.prevTouchShift = false;
    this.pointers.clear();
    this.uiCapture = false;
    this.pendingClick = null;
  }

  /** Consume the one-frame upshift edge. */
  consumeUpshift(): boolean {
    const v = this.upshiftPulse;
    this.upshiftPulse = false;
    return v;
  }

  update(dt: number): void {
    const ease = this.pedalEaseRate(dt);
    this.throttle = this.easeToward(this.throttle, this.targetThrottle, ease);
    this.brake = this.easeToward(this.brake, this.targetBrake, ease);

    if (this.touchShiftHeld && !this.prevTouchShift && this.mode === 'race' && !this.uiCapture) {
      this.upshiftPulse = true;
    }
    this.prevTouchShift = this.touchShiftHeld;

    if (this.mode === 'race' && !this.uiCapture && (this.throttle > 0.1 || this.brake > 0.1)) {
      this.inputTime += dt;
    }
  }

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

  /** True while any pointer is held (menus need this for sliders / scroll). */
  isPointerDown(): boolean {
    return this.pointers.size > 0;
  }

  private hitDeadZone(x: number, y: number): boolean {
    const chrome = this.raceChrome;
    if (chrome === null) return false;
    for (const z of chrome.deadZones) {
      if (pointInRect(x, y, z)) return true;
    }
    return false;
  }

  private hitPause(x: number, y: number): boolean {
    const chrome = this.raceChrome;
    if (chrome === null) return false;
    return pointInRect(x, y, chrome.pause);
  }

  /**
   * Bottom deck: left = brake, right = gas, center = SHIFT.
   * Falls back to bottom-band halves if chrome layout not set yet.
   */
  private sideForPoint(x: number, y: number): 'left' | 'right' | 'shift' | 'none' {
    if (!this.canvas) return 'none';
    const chrome = this.raceChrome;
    if (chrome !== null) {
      if (this.hitDeadZone(x, y)) return 'none';
      if (pointInRect(x, y, chrome.shift)) return 'shift';
      if (pointInRect(x, y, chrome.brake)) return 'left';
      if (pointInRect(x, y, chrome.gas)) return 'right';
      return 'none';
    }
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w <= 0 || h <= 0) return 'none';
    const inShiftY = y > h * 0.78;
    const inShiftX = x > w * 0.36 && x < w * 0.64;
    if (inShiftY && inShiftX) return 'shift';
    if (y < h * 0.72) return 'none';
    return x < w * 0.5 ? 'left' : 'right';
  }

  private syncPedalTargets(): void {
    if (this.mode !== 'race' || this.uiCapture) {
      this.targetThrottle = 0;
      this.targetBrake = 0;
      this.touchShiftHeld = false;
      return;
    }

    let ptrThrottle = 0;
    let ptrBrake = 0;
    let ptrShift = false;
    for (const p of this.pointers.values()) {
      if (!p.active) continue;
      if (p.side === 'right') ptrThrottle = 1;
      if (p.side === 'left') ptrBrake = 1;
      if (p.side === 'shift') ptrShift = true;
    }
    this.touchShiftHeld = ptrShift;

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
