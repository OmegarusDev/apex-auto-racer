import { InputController } from './InputController';
import { mulberry32 } from './rng';
import { SaveManager } from './SaveManager';
import { SceneManager } from './SceneManager';
import type { GameState, VolumeOptions } from './types';

/** Audio surface used by scenes — satisfied by `AudioEngine`. */
export interface AudioEngine {
  unlock(): Promise<void>;
  suspend(): Promise<void>;
  resume(): Promise<void>;
  setVolumes(volumes: VolumeOptions): void;
  updateEngine(rpm: number, throttle: number): void;
  setScreech(amount: number, drifting: boolean): void;
  playCountdown(n: number): void;
  playGo(): void;
  playCrash(): void;
  playSpin(): void;
  playDeslot(): void;
  setKerb(on: boolean): void;
  setRain(on: boolean): void;
  click(): void;
}

class NullAudioEngine implements AudioEngine {
  unlock(): Promise<void> {
    return Promise.resolve();
  }
  suspend(): Promise<void> {
    return Promise.resolve();
  }
  resume(): Promise<void> {
    return Promise.resolve();
  }
  setVolumes(_volumes: VolumeOptions): void {}
  updateEngine(_rpm: number, _throttle: number): void {}
  setScreech(_amount: number, _drifting: boolean): void {}
  playCountdown(_n: number): void {}
  playGo(): void {}
  playCrash(): void {}
  playSpin(): void {}
  playDeslot(): void {}
  setKerb(_on: boolean): void {}
  setRain(_on: boolean): void {}
  click(): void {}
}

function readDebugFlag(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('debug') === '1';
}

export class GameContext {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly input: InputController;
  readonly save: SaveManager;
  readonly scenes: SceneManager;
  readonly audio: AudioEngine;
  readonly debug: boolean;

  private _state: GameState | null = null;

  constructor(canvas: HTMLCanvasElement, audio?: AudioEngine) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (ctx === null) {
      throw new Error('2D canvas context unavailable');
    }
    this.ctx = ctx;
    this.input = new InputController();
    this.save = new SaveManager();
    this.scenes = new SceneManager();
    this.audio = audio ?? new NullAudioEngine();
    this.debug = readDebugFlag();

    this.input.attach(canvas);
  }

  get state(): GameState | null {
    return this._state;
  }

  set state(value: GameState | null) {
    this._state = value;
    if (value !== null) {
      this.save.setState(value);
    }
  }

  /** Load save from storage into context, or null if none. */
  bootstrap(): GameState | null {
    const { state, warning } = this.save.load();
    this._state = state;
    if (state !== null) {
      this.audio.setVolumes(state.options.volumes);
    }
    void warning;
    return state;
  }

  startNewGame(seed?: number): GameState {
    const gameSeed = seed ?? (Date.now() >>> 0);
    const state = this.save.createNew(mulberry32(gameSeed));
    this._state = state;
    this.audio.setVolumes(state.options.volumes);
    return state;
  }

  autosave(): void {
    if (this._state !== null) {
      this.save.autosave();
    }
  }

  destroy(): void {
    this.input.detach();
  }
}

let singleton: GameContext | null = null;

export function initGameContext(canvas: HTMLCanvasElement, audio?: AudioEngine): GameContext {
  if (singleton !== null) {
    singleton.destroy();
  }
  singleton = new GameContext(canvas, audio);
  return singleton;
}

export function getGameContext(): GameContext {
  if (singleton === null) {
    throw new Error('GameContext not initialized — call initGameContext first');
  }
  return singleton;
}

export function tryGetGameContext(): GameContext | null {
  return singleton;
}
