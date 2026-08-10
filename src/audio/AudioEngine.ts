import type { VolumeOptions } from '../engine/types';
import type { AudioTelemetry, ShiftKind } from '../engine/AudioTelemetry';
import type { DisciplineId } from '../data/disciplines';
import { createAudioBuses, type AudioBuses } from './buses';
import { EngineSynth } from './EngineSynth';
import { TyreSynth } from './TyreSynth';
import { CrowdSynth } from './CrowdSynth';
import { FxOneShots } from './FxOneShots';

const DEFAULT_VOLUMES: Required<VolumeOptions> = {
  master: 0.8,
  engine: 0.28,
  fx: 0.5,
  crowd: 0.45,
  ui: 0.6,
};

/** Presentation audio facade — layered race car + reactive crowd. */
export class AudioEngine {
  private ctx: AudioContext;
  private buses: AudioBuses;
  private engine: EngineSynth;
  private tyres: TyreSynth;
  private crowd: CrowdSynth;
  private fx: FxOneShots;
  private unlocked = false;
  private volumes: Required<VolumeOptions>;

  constructor(options: Partial<VolumeOptions> = {}) {
    this.volumes = { ...DEFAULT_VOLUMES, ...options };
    this.ctx = new AudioContext();
    this.buses = createAudioBuses(this.ctx, this.volumes);
    this.engine = new EngineSynth(this.buses);
    this.tyres = new TyreSynth(this.buses);
    this.crowd = new CrowdSynth(this.buses);
    this.fx = new FxOneShots(this.buses);
  }

  async unlock(): Promise<void> {
    if (this.unlocked) return;
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
    this.engine.start();
    this.tyres.start();
    this.crowd.start();
    this.fx.ensureRain();
    this.unlocked = true;
  }

  setVolumes(volumes: Partial<VolumeOptions>): void {
    if (volumes.master !== undefined) {
      this.volumes.master = volumes.master;
      this.buses.master.gain.value = volumes.master;
    }
    if (volumes.engine !== undefined) {
      this.volumes.engine = volumes.engine;
      this.buses.engine.gain.value = volumes.engine;
    }
    if (volumes.fx !== undefined) {
      this.volumes.fx = volumes.fx;
      this.buses.fx.gain.value = volumes.fx;
    }
    if (volumes.crowd !== undefined) {
      this.volumes.crowd = volumes.crowd;
      this.buses.crowd.gain.value = volumes.crowd;
    }
    if (volumes.ui !== undefined) {
      this.volumes.ui = volumes.ui;
      this.buses.ui.gain.value = volumes.ui;
    }
  }

  setDiscipline(id: DisciplineId): void {
    this.crowd.setDiscipline(id);
  }

  updateVehicleAudio(tel: AudioTelemetry): void {
    this.engine.update(tel);
    this.tyres.update(tel);
  }

  /** Thin compat wrapper. */
  updateEngine(rpm: number, throttle: number): void {
    this.updateVehicleAudio({
      rpm,
      throttle,
      brake: 0,
      gear: 1,
      speed: 0,
      gripUsage: 0,
      slotMode: 'groove',
      onKerb: false,
      discipline: 'track',
      active: rpm > 0 || throttle > 0,
    });
  }

  setScreech(amount: number, drifting: boolean): void {
    this.tyres.setScreech(amount, drifting);
  }

  setCrowd(hype: number): void {
    this.crowd.setHype(hype);
  }

  crowdRoar(intensity = 0.5): void {
    this.crowd.roar(intensity);
  }

  playShift(kind: ShiftKind): void {
    this.fx.playShift(kind);
    this.engine.blip(kind);
  }

  playCountdown(n: number): void {
    this.fx.playCountdown(n);
  }

  playGo(): void {
    this.fx.playGo();
  }

  playCrash(): void {
    this.fx.playCrash();
  }

  playSoftContact(): void {
    this.fx.playSoftContact();
  }

  playSpin(): void {
    this.fx.playSpin();
  }

  playDeslot(): void {
    this.fx.playDeslot();
  }

  setKerb(on: boolean): void {
    this.tyres.setKerb(on);
  }

  setRain(on: boolean): void {
    this.fx.setRain(on);
  }

  click(): void {
    this.fx.click();
  }

  async suspend(): Promise<void> {
    if (this.ctx.state === 'running') {
      await this.ctx.suspend();
    }
  }

  async resume(): Promise<void> {
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
    this.unlocked = true;
  }

  get context(): AudioContext {
    return this.ctx;
  }

  /** Mute continuous voices on race exit. */
  silenceRace(): void {
    this.updateVehicleAudio({
      rpm: 0,
      throttle: 0,
      brake: 0,
      gear: 1,
      speed: 0,
      gripUsage: 0,
      slotMode: 'groove',
      onKerb: false,
      discipline: 'track',
      active: false,
    });
    this.crowd.silence();
    this.setRain(false);
  }
}
