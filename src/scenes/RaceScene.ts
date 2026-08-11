import type { Scene } from '../engine/SceneManager';
import type { GameContext } from '../engine/GameContext';
import { BALANCE } from '../data/balance';
import { getTrait } from '../data/traits';
import { PHYSICS } from '../data/physics';
import { PRESENT } from '../data/present';
import {
  RaceDirector,
  type CountdownPhase,
  type GhostSample,
  type GhostTrace,
} from '../engine/RaceDirector';
import type { OnboardingFlags, RaceEvent } from '../engine/types';
import {
  intentHudLabel,
  intentTickerPhrase,
  type BrainIntentTag,
} from '../engine/BrainIntent';
import {
  buildRaceConfig,
  type RaceLaunchConfig,
} from '../career/raceLaunch';
import {
  buildResultsPayload,
  type RaceObjectiveStats,
} from '../career/resultsPayload';
import { loadGhostTrace, storeGhostTrace } from '../career/ghostStore';
import { RaceView } from '../graphics/RaceView';
import { writeCarWorld } from '../graphics/TrackSampler';
import type { CarFrameDto, FxImpulse, RaceFrameView } from '../graphics/types';
import {
  drawPegMeter,
  drawPreRaceCard,
  nearDeslotThreat,
  sampleKappaAt,
  shouldTeachAuthority,
  wantsShiftCue,
} from '../graphics/RaceFantasyHud';
import { raceChromeLayout, type RaceChromeLayout } from '../graphics/hud/raceChromeLayout';
import { buildCarFrame as buildCarFrameDto } from './race/frameBus';
import { setupCountdownCamera, updateCamera as updateRaceCamera } from './race/raceCamera';
import { updateCountdownAudio as bridgeCountdownAudio } from './race/audioBridge';
import { drawPedalDeck as drawPedalDeckChrome } from './race/RaceChrome';

import {
  drawButton,
  handleButton,
  drawModal,
  handleModal,
  layoutModalButtons,
  drawSlider,
  handleSlider,
  pad,
  ensureMinTouch,
  truncateText,
  drawHintBox,
  layoutHintBox,
  type ButtonDef,
  type ModalDef,
  type SliderDef,
} from '../ui/components';
import { accentForDiscipline, createTheme, type ThemeTokens } from '../ui/theme';
import { gearboxFor } from '../engine/Gearbox';
import { DEFAULT_RACE_ZOOM } from '../engine/types';

/** Avoid importing sceneUtils / ResultsScene here — that cycle breaks dynamic RaceScene load. */
function disciplineAccent(id: import('../data/disciplines').DisciplineId): string {
  return accentForDiscipline(id);
}

const FINISH_DELAY_SEC = 2.2;
const TICKER_MAX = 4;
const TICKER_TTL = 6;

const carPoseScratch = { x: 0, y: 0, tx: 0, ty: 0, heading: 0 };
const ghostScratch = { x: 0, y: 0, tx: 0, ty: 0, heading: 0 };

interface TickerLine {
  text: string;
  ttl: number;
}

function sampleGhost(trace: GhostTrace, carId: string, time: number): GhostSample | null {
  const car = trace.find((g) => g.carId === carId);
  if (car === undefined || car.samples.length === 0) return null;

  const samples = car.samples;
  if (time <= samples[0]!.time) return samples[0]!;
  if (time >= samples[samples.length - 1]!.time) return samples[samples.length - 1]!;

  let lo = 0;
  let hi = samples.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid]!.time <= time) lo = mid;
    else hi = mid;
  }
  return samples[lo] ?? null;
}

export class RaceScene implements Scene {
  private readonly g: GameContext;
  private readonly launch: RaceLaunchConfig;
  private director: RaceDirector | null = null;
  private view = new RaceView();
  private frameCars: CarFrameDto[] = [];
  private fxImpulses: FxImpulse[] = [];
  private camOut = { x: 0, y: 0, zoom: 1 };
  private chrome: RaceChromeLayout | null = null;
  private paused = false;
  private zoomDirty = false;
  private pauseModal: ModalDef = { open: false, title: '', body: '', buttons: [] };
  private finishTimer = 0;
  private transitioned = false;
  private prevCountdown: CountdownPhase | undefined;
  private prevPlayerWallHits = 0;
  private prevPlayerSpins = 0;
  private prevPlayerDeslots = 0;
  private prevClutchKickRem = 0;
  private prevCarSamples = new Map<string, { x: number; y: number; s: number; l: number }>();
  private prevCarDeslots = new Map<string, number>();
  private ticker: TickerLine[] = [];
  private seenEventSeq = 0;
  private hintText: string | null = null;
  private hintT = 0;
  /** One-shot lift warning before first deslot teaching toast. */
  private warnedDeslotLift = false;
  private nearDeslotFxCd = 0;
  private condScrapeFxCd = 0;
  private shiftCueArmed = false;
  private ghostCarId: string | null = null;
  private ghostTrace: GhostTrace | null = null;
  private lastDt = 1 / 60;
  private animTime = 0;
  private prevCarWallHits = new Map<string, number>();
  private enterError: string | null = null;
  /** Results dynamic import failed after finish — Escape/Back should leave to Campaign. */
  private resultsImportFailed = false;
  private stats: RaceObjectiveStats = {
    playerBrakeUsed: false,
    playerWallHits: 0,
    playerSpinCount: 0,
    playerDeslotCount: 0,
    playerOvertakes: 0,
    entertainmentScore: 0,
    startGridPosition: 1,
    vehicleConditionAtStart: 1,
    vehicleRepairedBeforeRace: false,
  };
  private prevPlayerContactHits = 0;
  constructor(ctx: GameContext, config: RaceLaunchConfig) {
    this.g = ctx;
    this.launch = config;
  }

  private resolveLeadDriver() {
    const id = this.launch.leadDriverId;
    const override = this.launch.playerDriversOverride?.find((d) => d.id === id);
    if (override !== undefined) return override;
    return this.g.state?.roster.find((d) => d.id === id);
  }

  private resolvePlayerVehicle() {
    return (
      this.launch.playerVehicleOverride ?? this.g.state?.vehicles[this.launch.discipline]
    );
  }

  enter(): void {
    const state = this.g.state;
    if (state === null) {
      this.g.scenes.back();
      return;
    }

    this.enterError = null;
    try {
      this.g.input.setMode('race');
      this.g.input.resetRaceInput();
      this.paused = false;
      this.finishTimer = 0;
      this.transitioned = false;
      this.prevCountdown = undefined;
      this.prevPlayerWallHits = 0;
      this.prevPlayerSpins = 0;
      this.prevPlayerDeslots = 0;
      this.prevPlayerContactHits = 0;
      this.prevCarSamples.clear();
      this.prevCarDeslots.clear();
      this.ticker = [];
      this.seenEventSeq = 0;
      this.hintText = null;
      this.hintT = 0;
      this.warnedDeslotLift = false;
      this.nearDeslotFxCd = 0;
      this.shiftCueArmed = false;

      const vehicle =
        this.launch.playerVehicleOverride ?? state.vehicles[this.launch.discipline];
      if (vehicle === undefined) {
        throw new Error(`Missing vehicle for ${this.launch.discipline}`);
      }
      this.stats = {
        playerBrakeUsed: false,
        playerWallHits: 0,
        playerSpinCount: 0,
        playerDeslotCount: 0,
        playerOvertakes: 0,
        entertainmentScore: 0,
        startGridPosition: 1,
        vehicleConditionAtStart: vehicle.condition,
        vehicleRepairedBeforeRace: vehicle.condition >= BALANCE.conditionMax - 0.001,
      };

      const raceConfig = buildRaceConfig(state, this.launch);
      this.director = new RaceDirector(raceConfig);
      const worldEl = document.querySelector<HTMLCanvasElement>('#world');
      if (worldEl !== null) {
        this.view.attachWorldCanvas(worldEl);
      }
      this.view.prepare({
        track: this.director.track,
        discipline: this.launch.discipline,
        night: this.director.night,
        rain: this.director.rain,
      });
      if (worldEl !== null) {
        if (this.view.usingEngine) {
          worldEl.classList.add('is-live');
          this.view.resizeWorld(
            this.g.canvas.clientWidth,
            this.g.canvas.clientHeight,
            Math.min(window.devicePixelRatio || 1, PRESENT.dprCap),
          );
        } else {
          worldEl.classList.remove('is-live');
        }
      }
      this.g.audio.setDiscipline?.(this.launch.discipline);
      this.g.audio.setRain(this.director.rain);

      // Best-lap ghost whenever we have one (Race Again or prior PB).
      const stored = loadGhostTrace();
      if (stored !== null) {
        this.ghostTrace = stored.trace;
        this.ghostCarId = stored.carId;
      }

      const standings = this.director.currentStandings;
      const player = standings.find((s) => s.isPlayerControlled);
      if (player !== undefined) {
        this.stats.startGridPosition = player.position;
      }

      this.setupCountdownCamera();
      this.queueOnboardingHint();
    } catch (err) {
      console.error('[apex] RaceScene.enter failed', err);
      this.director = null;
      this.enterError = err instanceof Error ? err.message || err.name : String(err);
      this.g.input.setMode('menu');
    }
  }

  exit(): void {
    this.g.input.setMode('menu');
    this.g.input.setUiCapture(false);
    this.g.input.setRaceChrome(null);
    this.view.clearWorld();
    if (this.g.audio.silenceRace) {
      this.g.audio.silenceRace();
    } else {
      this.g.audio.setRain(false);
      this.g.audio.setKerb(false);
      this.g.audio.setScreech(0, false);
      this.g.audio.setCrowd(0);
      this.g.audio.updateEngine(0, 0);
    }
  }

  onResize(_w: number, _h: number): void {
    // Theme cache refreshed via main.ts invalidateSafeArea on window resize.
  }

  handleBack(): boolean {
    if (this.resultsImportFailed) {
      this.leaveToCampaign();
      return true;
    }
    if (this.enterError !== null || this.director === null) {
      this.g.scenes.back();
      return true;
    }
    if (this.director.isRaceFinished) return true;
    if (!this.paused) {
      this.openPause();
    }
    return true;
  }

  private leaveToCampaign(): void {
    const discipline = this.launch.discipline;
    void import('./CampaignScene')
      .then((mod) => {
        this.g.scenes.replace(new mod.CampaignScene(discipline));
      })
      .catch(() => {
        this.g.scenes.back();
      });
  }

  update(dt: number): void {
    const director = this.director;
    if (director === null) {
      this.handleEnterErrorInput();
      return;
    }

    this.lastDt = dt;
    this.animTime += dt;
    const token = createTheme(this.g.canvas.clientWidth, this.g.canvas.clientHeight);
    this.chrome = raceChromeLayout(this.g.canvas.clientWidth, this.g.canvas.clientHeight, token);
    this.g.input.setRaceChrome(this.chrome);

    if (this.paused) {
      this.handlePauseInput();
      return;
    }

    if (director.isRaceFinished) {
      this.finishTimer += dt;
      if (!this.transitioned && this.finishTimer >= FINISH_DELAY_SEC) {
        this.transitioned = true;
        this.finishRace();
      }
      return;
    }

    if (this.g.input.brake > 0.1) this.stats.playerBrakeUsed = true;

    const upEdge = this.g.input.consumeUpshift();
    const playerCar = director.cars.find((c) => c.isPlayerControlled);
    const armed =
      playerCar !== undefined &&
      (playerCar.driftState ||
        playerCar.driftArmed ||
        playerCar.gripUsage > 0.85 ||
        Math.abs(playerCar.slipAngle) > 0.1);
    const clutchKick = this.launch.discipline === 'street' && upEdge && armed;
    director.setPlayerPedals(
      this.g.input.throttle,
      this.g.input.brake,
      clutchKick ? false : upEdge,
      clutchKick,
    );
    director.update(dt);

    this.updateCountdownAudio(director.countdown);
    this.updateCarAudioAndParticles(director);
    this.updateCamera(director);
    this.updateTicker(director.recentEvents, director.eventSequence, dt);
    this.updateHints(dt);

    if (director.isRaceFinished) {
      this.finishTimer = 0;
    }
  }

  render(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const director = this.director;
    if (director === null) {
      this.renderEnterError(ctx, w, h);
      return;
    }

    const token = createTheme(w, h);
    const accent = disciplineAccent(this.launch.discipline);
    const cam = this.view.writeCamera(this.camOut);
    const cars = this.buildCarFrame(director, accent);
    const playerIdx = cars.findIndex((c) => c.isPlayer);

    let ghost: RaceFrameView['ghost'] = null;
    if (this.ghostTrace !== null && this.ghostCarId !== null && director.countdown === null) {
      const sample = sampleGhost(this.ghostTrace, this.ghostCarId, director.raceClock);
      if (sample !== null) {
        const track = this.view.getTrack();
        if (track !== null) {
          writeCarWorld(track, sample.s, sample.l, ghostScratch);
          ghost = {
            worldX: ghostScratch.x,
            worldY: ghostScratch.y,
            heading: ghostScratch.heading,
            color: `${accent}66`,
          };
        }
      }
    }

    const raceZoom = Math.max(
      0,
      Math.min(1, this.g.state?.options.raceZoom ?? DEFAULT_RACE_ZOOM),
    );
    const frame: RaceFrameView = {
      camera: cam,
      screenW: w,
      screenH: h,
      night: director.night,
      rain: director.rain,
      cars,
      playerIndex: playerIdx,
      ghost,
      countdown: director.countdown,
      discipline: this.launch.discipline,
      raceZoom,
    };
    this.view.draw(ctx, frame);

    // Pedal deck under HUD so pause/minimap stay readable.
    const playerCar = director.cars.find((c) => c.isPlayerControlled);
    this.drawPedalDeck(ctx, w, h, token, accent, playerCar);
    this.drawHud(ctx, w, h, token, accent, director, cars, playerIdx);
    const leadDriver = this.resolveLeadDriver();
    const traitName = leadDriver !== undefined ? getTrait(leadDriver.trait).name : 'Driver';
    const vehicle = this.resolvePlayerVehicle();
    drawPreRaceCard(ctx, w, h, token, accent, {
      discipline: this.launch.discipline,
      laps: director.config.laps,
      rain: director.rain,
      night: director.night,
      driverName: leadDriver?.name ?? 'Driver',
      traitName,
      phase: director.countdown,
      partTiers: vehicle?.partTiers,
    });
    this.drawCountdownBanner(ctx, w, h, token, director.countdown);
    if (director.rain) this.drawRainChip(ctx, w, h, token);
    if (director.night) this.drawNightChip(ctx, w, h, token);
    this.drawTicker(ctx, w, h, token);
    this.drawOnboardingHint(ctx, w, h, token, accent);

    if (director.isRaceFinished) {
      this.drawFinishOverlay(ctx, w, h, token, accent, director);
    }

    if (this.paused) {
      // Draw-only — handlePauseInput consumes clicks in update().
      const pauseUi = {
        pointerX: this.g.input.pointerX,
        pointerY: this.g.input.pointerY,
        pointerDown: false,
        pointerClicked: false,
        dt: 0,
        w,
        h,
        token,
        accent,
      };
      layoutModalButtons(this.pauseModal, pauseUi);
      drawModal(ctx, this.pauseModal, {
        ...pauseUi,
        token,
        accent,
      });
    }

    if (this.g.debug) {
      this.drawDebugOverlay(ctx, w, h, token, director);
    }
  }

  private buildCarFrame(director: RaceDirector, playerAccent: string): CarFrameDto[] {
    return buildCarFrameDto(this.view, director, playerAccent, this.frameCars);
  }

  private openPause(): void {
    this.director?.pause();
    this.paused = true;
    this.g.input.setUiCapture(true);
    this.pauseModal = {
      open: true,
      title: 'Paused',
      body: 'Resume racing or retire from the event.',
      buttons: [
        {
          x: 0,
          y: 0,
          w: 0,
          h: 0,
          label: 'Retire',
          onClick: () => {
            this.paused = false;
            this.pauseModal.open = false;
            this.g.input.setUiCapture(false);
            this.director?.retire();
          },
        },
        {
          x: 0,
          y: 0,
          w: 0,
          h: 0,
          label: 'Resume',
          primary: true,
          onClick: () => {
            this.paused = false;
            this.pauseModal.open = false;
            this.g.input.setUiCapture(false);
            this.director?.resume();
          },
        },
      ],
    };
  }

  private handlePauseInput(): void {
    const token = createTheme(this.g.canvas.clientWidth, this.g.canvas.clientHeight);
    const accent = disciplineAccent(this.launch.discipline);
    const ui = {
      pointerX: this.g.input.pointerX,
      pointerY: this.g.input.pointerY,
      pointerDown: this.g.input.peekClick() !== null,
      pointerClicked: this.g.input.consumeClick() !== null,
      dt: 0,
      w: this.g.canvas.clientWidth,
      h: this.g.canvas.clientHeight,
      token,
      accent,
    };
    layoutModalButtons(this.pauseModal, ui);
    handleModal(this.pauseModal, ui);
  }

  private finishRace(): void {
    const director = this.director;
    const state = this.g.state;
    if (director === null || state === null) return;

    const result = director.getResult();
    const playerCar = director.cars.find((c) => c.isPlayerControlled);
    if (playerCar !== undefined) {
      storeGhostTrace(result.ghostTrace, playerCar.id);
      this.stats.playerOvertakes = playerCar.overtakeCount;
    }
    this.stats.entertainmentScore = director.entertainmentSnapshot.entertainmentScore;

    const payload = buildResultsPayload(
      state,
      this.launch,
      result,
      this.stats,
      playerCar?.condition,
    );

    void import('./ResultsScene')
      .then((mod) => {
        this.g.scenes.replace(mod.createResultsScene(payload));
      })
      .catch((err) => {
        console.error('[apex] ResultsScene import failed', err);
        this.resultsImportFailed = true;
        this.enterError = err instanceof Error ? err.message || err.name : String(err);
        this.director = null;
        this.g.input.setMode('menu');
      });
  }

  private enterErrorBackButton(w: number, h: number, token: ThemeTokens): ButtonDef {
    const btnW = pad(token, 14);
    const btnH = ensureMinTouch(pad(token, 5.5), token);
    return {
      x: (w - btnW) * 0.5,
      y: h * 0.58,
      w: btnW,
      h: btnH,
      label: 'Back',
      primary: true,
      onClick: () => {
        if (this.resultsImportFailed) this.leaveToCampaign();
        else this.g.scenes.back();
      },
    };
  }

  private handleEnterErrorInput(): void {
    if (this.enterError === null) return;
    const w = this.g.canvas.clientWidth;
    const h = this.g.canvas.clientHeight;
    const token = createTheme(w, h);
    const accent = disciplineAccent(this.launch.discipline);
    const click = this.g.input.consumeClick();
    const ui = {
      pointerX: this.g.input.pointerX,
      pointerY: this.g.input.pointerY,
      pointerDown: this.g.input.peekClick() !== null || this.g.input.getActivePointers().length > 0,
      pointerClicked: click !== null,
      dt: 0,
      w,
      h,
      token,
      accent,
    };
    handleButton(this.enterErrorBackButton(w, h, token), ui);
  }

  private renderEnterError(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const token = createTheme(w, h);
    const accent = disciplineAccent(this.launch.discipline);
    ctx.fillStyle = token.bg;
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${token.fontTitle}px ${token.fontFamily}`;
    ctx.fillStyle = token.text;
    ctx.fillText('Could not start race', w * 0.5, h * 0.38);
    ctx.font = `${token.fontBody}px ${token.fontFamily}`;
    ctx.fillStyle = '#f87171';
    const msg = this.enterError ?? 'Unknown error';
    const maxChars = 64;
    const line = msg.length > maxChars ? `${msg.slice(0, maxChars - 1)}…` : msg;
    ctx.fillText(line, w * 0.5, h * 0.38 + token.fontTitle + pad(token));
    ctx.restore();

    const btn = this.enterErrorBackButton(w, h, token);
    const ui = {
      pointerX: this.g.input.pointerX,
      pointerY: this.g.input.pointerY,
      pointerDown: false,
      pointerClicked: false,
      dt: 0,
      w,
      h,
      token,
      accent,
    };
    drawButton(ctx, btn, ui);
  }

  private setupCountdownCamera(): void {
    // CameraDirector seam
    setupCountdownCamera(
      this.view,
      this.director,
      this.launch.discipline,
      this.frameCars,
      this.g.canvas.clientWidth,
      this.g.canvas.clientHeight,
    );
  }

  private updateCamera(director: RaceDirector): void {
    // CameraDirector seam
    updateRaceCamera(
      this.view,
      director,
      this.launch.discipline,
      this.frameCars,
      this.g.canvas.clientWidth,
      this.g.canvas.clientHeight,
      this.lastDt,
    );
  }

  private updateCountdownAudio(phase: CountdownPhase): void {
    this.prevCountdown = bridgeCountdownAudio(this.g.audio, phase, this.prevCountdown);
  }

  private updateCarAudioAndParticles(director: RaceDirector): void {
    const track = this.view.getTrack();
    if (track === null) return;

    const player = director.cars.find((c) => c.isPlayerControlled);
    const ent = director.entertainmentSnapshot;
    this.stats.entertainmentScore = ent.entertainmentScore;
    this.g.audio.setCrowd(ent.hype);
    this.fxImpulses.length = 0;

    if (player !== undefined) {
      this.g.audio.updateVehicleAudio({
        rpm: player.rpm,
        throttle: player.throttle,
        brake: player.brake,
        gear: player.gear,
        speed: player.v,
        gripUsage: player.gripUsage,
        slotMode: player.slotMode,
        onKerb: player.onKerb,
        discipline: this.launch.discipline,
        active: true,
        drifting: player.driftState,
        clutchKick: player.clutchKickRemaining > 0,
      });

      if (player.lastShiftKind !== null) {
        this.g.audio.playShift(player.lastShiftKind);
        player.lastShiftKind = null;
      }

      if (
        player.clutchKickRemaining > 0.2 &&
        this.prevClutchKickRem <= 0.05
      ) {
        this.g.audio.playClutchKick();
      }
      this.prevClutchKickRem = player.clutchKickRemaining;

      if (player.wallHits > this.prevPlayerWallHits) {
        this.g.audio.playCrash();
        if (!this.g.state!.onboarding.shownCrashHint) {
          this.showHint('Hit a wall — brake earlier next time', 'shownCrashHint');
        }
      }
      if (player.contactHits > this.prevPlayerContactHits) {
        this.g.audio.playSoftContact();
      }
      if (player.deslotCount > this.prevPlayerDeslots) {
        this.g.audio.playDeslot();
        if (!this.g.state!.onboarding.shownBrakeHint) {
          this.showHint('Too fast — brake before the bend', 'shownBrakeHint');
        } else if (!this.g.state!.onboarding.shownDeslotHint) {
          this.showHint('Crawl back onto the groove', 'shownDeslotHint');
        }
      } else if (
        !this.g.state!.onboarding.shownDeslotHint &&
        !this.warnedDeslotLift &&
        this.hintText === null &&
        player.slotMode === 'groove' &&
        player.throttle > 0.85 &&
        player.brake < 0.08
      ) {
        let kappa = 0;
        for (const n of director.track.nodes) {
          if (n.s <= player.s) kappa = n.kappaLine;
        }
        if (Math.abs(kappa) >= PHYSICS.grooveKappaMin) {
          this.hintText = "Lift or you'll leave the groove";
          this.hintT = 4;
          this.warnedDeslotLift = true;
        }
      }
      if (player.spinCount > this.prevPlayerSpins) {
        this.g.audio.playSpin();
      }

      const kappa = sampleKappaAt(director.track.nodes, player.s);
      this.nearDeslotFxCd = Math.max(0, this.nearDeslotFxCd - this.lastDt);
      if (nearDeslotThreat(player, kappa) && this.nearDeslotFxCd <= 0) {
        writeCarWorld(track, player.s, player.l, carPoseScratch, player.slipAngle);
        this.fxImpulses.push(
          { kind: 'sparks', x: carPoseScratch.x, y: carPoseScratch.y, index: 2, count: 3 },
          { kind: 'dust', x: carPoseScratch.x, y: carPoseScratch.y, index: 3, intensity: 0.95 },
        );
        this.nearDeslotFxCd = 0.35;
        if (!this.g.state!.onboarding.shownPegHint && this.hintText === null) {
          this.showHint('Keep the groove meter under 100% in bends', 'shownPegHint');
        }
      }

      const lead = this.resolveLeadDriver();
      const skill = lead?.skill ?? 40;
      if (
        !this.g.state!.onboarding.shownAuthorityHint &&
        this.hintText === null &&
        shouldTeachAuthority(skill, player, kappa)
      ) {
        this.showHint('Higher skill helps hold full gas through bends', 'shownAuthorityHint');
      }

      this.shiftCueArmed = wantsShiftCue(player, this.launch.discipline);
      if (
        this.shiftCueArmed &&
        !this.g.state!.onboarding.shownShiftCue &&
        this.hintText === null
      ) {
        this.showHint('Tap SHIFT to upshift — hold a gear until you need the next', 'shownShiftCue');
      }

      // Teach stack: trail brake → then Street kick (after shift cue seen).
      if (
        !this.g.state!.onboarding.shownTrailHint &&
        this.g.state!.onboarding.shownBrakeHint &&
        this.hintText === null &&
        player.brake > 0.35 &&
        player.v > 10 &&
        Math.abs(sampleKappaAt(director.track.nodes, player.s)) >= PHYSICS.grooveKappaMin
      ) {
        this.showHint(
          'Ease off the brake into the bend — keep a little gas',
          'shownTrailHint',
        );
      }
      if (
        this.launch.discipline === 'street' &&
        !this.g.state!.onboarding.shownKickHint &&
        this.g.state!.onboarding.shownShiftCue &&
        this.hintText === null &&
        (player.driftArmed || player.gripUsage > 0.88)
      ) {
        this.showHint(
          'Street: SHIFT while sliding = clutch-kick — hold gas to keep it',
          'shownKickHint',
        );
      }

      this.stats.playerWallHits = player.wallHits;
      this.stats.playerSpinCount = player.spinCount;
      this.stats.playerDeslotCount = player.deslotCount;
      this.stats.playerOvertakes = player.overtakeCount;
      this.prevPlayerWallHits = player.wallHits;
      this.prevPlayerSpins = player.spinCount;
      this.prevPlayerDeslots = player.deslotCount;
      this.prevPlayerContactHits = player.contactHits;

      // Condition scrape escalation when Cond drops mid-race.
      this.condScrapeFxCd = Math.max(0, this.condScrapeFxCd - this.lastDt);
      if (
        this.condScrapeFxCd <= 0 &&
        player.condition < this.stats.vehicleConditionAtStart - 0.02 &&
        player.v > 8
      ) {
        writeCarWorld(track, player.s, player.l, carPoseScratch, player.slipAngle);
        this.fxImpulses.push({
          kind: 'sparks',
          x: carPoseScratch.x,
          y: carPoseScratch.y,
          index: 11,
          count: 2,
        });
        this.condScrapeFxCd = 0.55;
      }
    }

    let tick = 0;
    for (const car of director.cars) {
      writeCarWorld(track, car.s, car.l, carPoseScratch, car.slipAngle);
      const px = carPoseScratch.x;
      const py = carPoseScratch.y;
      const prev = this.prevCarSamples.get(car.id);

      const scrubbing = car.driftState || car.slotMode === 'deslot';
      if (prev !== undefined && scrubbing && car.v > 4) {
        this.fxImpulses.push({
          kind: 'skid',
          x: prev.x,
          y: prev.y,
          x2: px,
          y2: py,
          index: tick,
        });
      }
      if (scrubbing && car.v > 6) {
        const disc = this.launch.discipline;
        // Rally slide → dust; Street drift latch → tyre smoke; Track → light dust.
        if (disc === 'street' && (car.driftState || Math.abs(car.slipAngle) > 0.18)) {
          this.fxImpulses.push({ kind: 'smoke', x: px, y: py, index: tick });
        } else if (disc === 'rally' || car.slotMode === 'deslot') {
          this.fxImpulses.push({
            kind: 'dust',
            x: px,
            y: py,
            index: tick,
            intensity: Math.max(car.gripUsage, disc === 'rally' ? 1.25 : 1.05),
          });
        }
      }
      if (car.clutchKickRemaining > 0.15) {
        this.fxImpulses.push({ kind: 'smoke', x: px, y: py, index: tick + 40 });
      }
      if (car.spinRemaining > 0) {
        this.fxImpulses.push({ kind: 'smoke', x: px, y: py, index: tick });
      }
      const prevDeslots = this.prevCarDeslots.get(car.id) ?? 0;
      if (car.deslotCount > prevDeslots) {
        this.fxImpulses.push({ kind: 'sparks', x: px, y: py, index: tick });
      }
      this.prevCarDeslots.set(car.id, car.deslotCount);
      const prevHits = this.prevCarWallHits.get(car.id) ?? 0;
      if (car.wallHits > prevHits && car.v > PHYSICS.crashSpeed) {
        this.fxImpulses.push({ kind: 'sparks', x: px, y: py, index: tick });
      }
      this.prevCarWallHits.set(car.id, car.wallHits);

      this.prevCarSamples.set(car.id, { x: px, y: py, s: car.s, l: car.l });
      tick += 1;
    }

    this.view.applyFx(this.fxImpulses);
    this.view.updateFx(
      this.lastDt,
      this.g.canvas.clientWidth,
      this.g.canvas.clientHeight,
    );
  }

  private updateTicker(events: readonly RaceEvent[], eventSeq: number, dt: number): void {
    if (eventSeq > this.seenEventSeq) {
      const fresh = events
        .filter((ev) => ev.seq > this.seenEventSeq)
        .sort((a, b) => a.seq - b.seq);
      for (const ev of fresh) {
        const name = ev.driverName ?? ev.carId;
        let text = `${ev.time.toFixed(1)}s — ${name}`;
        switch (ev.kind) {
          case 'overtake':
            text = `${ev.time.toFixed(1)}s — ${name} overtakes${ev.detail ? ` ${ev.detail}` : ''}`;
            if (this.isPlayerEvent(ev, name)) this.g.audio.crowdRoar(0.75);
            break;
          case 'spin':
            text = `${ev.time.toFixed(1)}s — ${name} spins!`;
            break;
          case 'deslot':
            text = `${ev.time.toFixed(1)}s — ${name} pops the peg`;
            break;
          case 'crash':
            text = `${ev.time.toFixed(1)}s — ${name} crashes!`;
            break;
          case 'finish':
            text = `${ev.time.toFixed(1)}s — ${name} finishes`;
            break;
          case 'lap':
            text = `${ev.time.toFixed(1)}s — ${name} lap ${ev.detail ?? ''}`;
            break;
          case 'mistake':
            text = `${ev.time.toFixed(1)}s — ${name} makes a mistake`;
            break;
          case 'draftPass':
            text = `${ev.time.toFixed(1)}s — ${name} slingshots past`;
            break;
          case 'wallHit':
            text = `${ev.time.toFixed(1)}s — ${name} clips the wall`;
            break;
          case 'intent':
            text = `${ev.time.toFixed(1)}s — ${intentTickerPhrase(name, ev.detail as BrainIntentTag)}`;
            break;
          case 'rejoin':
            text = `${ev.time.toFixed(1)}s — ${name} finds the peg`;
            break;
          case 'shift':
            if (ev.detail === 'down') text = `${ev.time.toFixed(1)}s — ${name} downshifts`;
            else text = `${ev.time.toFixed(1)}s — ${name} upshifts`;
            break;
          case 'driftEntry':
            text = `${ev.time.toFixed(1)}s — ${name} slides`;
            break;
          default:
            text = `${ev.time.toFixed(1)}s — ${name}: ${ev.kind}`;
            break;
        }
        this.ticker.unshift({ text, ttl: TICKER_TTL });
      }
      this.seenEventSeq = eventSeq;
      this.ticker = this.ticker.slice(0, TICKER_MAX);
    }

    for (const line of this.ticker) {
      line.ttl -= dt;
    }
    this.ticker = this.ticker.filter((l) => l.ttl > 0);
  }

  private isPlayerEvent(ev: RaceEvent, _name: string): boolean {
    const director = this.director;
    if (director === null) return false;
    const car = director.cars.find((c) => c.id === ev.carId);
    return car?.isPlayerControlled === true;
  }

  private queueOnboardingHint(): void {
    const state = this.g.state;
    if (state === null) return;

    if (!state.onboarding.shownPedalControls) {
      this.showHint(
        'Hold GAS — the car steers itself. Space = brake · SHIFT = upshift',
        'shownPedalControls',
      );
    } else if (!state.onboarding.shownTouchControls) {
      this.showHint(
        'Touch: right = gas, left = brake · SHIFT = up · lift gas to downshift',
        'shownTouchControls',
      );
    }
  }

  private showHint(text: string, flag: keyof OnboardingFlags): void {
    this.hintText = text;
    this.hintT = 5;
    const state = this.g.state;
    if (state !== null) {
      state.onboarding[flag] = true;
      this.g.autosave();
    }
  }

  private updateHints(dt: number): void {
    if (this.hintText === null) return;
    this.hintT -= dt;
    if (this.hintT <= 0) this.hintText = null;
  }

  private drawHud(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    token: ThemeTokens,
    accent: string,
    director: RaceDirector,
    cars: readonly CarFrameDto[],
    playerIdx: number,
  ): void {
    const player = director.cars.find((c) => c.isPlayerControlled);
    const standing = director.currentStandings.find((s) => s.isPlayerControlled);
    const leadDriver = this.resolveLeadDriver();

    const chrome = this.chrome ?? raceChromeLayout(w, h, token);
    this.chrome = chrome;
    this.g.input.setRaceChrome(chrome);

    this.view.drawMinimap(ctx, chrome.minimap, cars, playerIdx);

    const pauseBtn: ButtonDef = {
      x: chrome.pause.x,
      y: chrome.pause.y,
      w: chrome.pause.w,
      h: chrome.pause.h,
      label: 'Pause',
      onClick: () => this.openPause(),
    };

    ctx.save();
    // Position plate — big timing-board numeral
    ctx.font = `400 ${Math.max(token.fontDisplay * 1.15, token.fontTitle * 1.4)}px ${token.fontDisplayFamily}`;
    ctx.fillStyle = token.text;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    const safe = token.safe;
    const hudX = safe.left + pad(token);
    let hudY = safe.top + pad(token);
    const telemetryMaxW = Math.max(pad(token, 14), chrome.minimap.x - hudX - pad(token));

    if (standing !== undefined) {
      ctx.fillStyle = accent;
      ctx.fillText(`P${standing.position}`, hudX, hudY);
      // Hairline under position
      const pw = ctx.measureText(`P${standing.position}`).width;
      ctx.fillStyle = `${accent}88`;
      ctx.fillRect(hudX, hudY + token.fontDisplay * 1.05, Math.min(pw, pad(token, 6)), 3);
      hudY += token.fontDisplay * 1.15 + pad(token, 0.35);
    }

    ctx.font = `600 ${token.fontBody}px ${token.fontFamily}`;
    ctx.fillStyle = token.textMuted;
    const lap = player?.lap ?? 0;
    ctx.fillText(`Lap ${Math.min(lap + 1, director.config.laps)}/${director.config.laps}`, hudX, hudY);
    hudY += token.fontBody + pad(token, 0.45);

    if (player !== undefined) {
      const speedKmh = Math.round(player.v * 3.6);
      ctx.fillStyle = token.text;
      ctx.font = `400 ${token.fontTitle}px ${token.fontDisplayFamily}`;
      ctx.fillText(`${speedKmh}`, hudX, hudY);
      const sw = ctx.measureText(`${speedKmh}`).width;
      ctx.font = `600 ${token.fontCaption}px ${token.fontFamily}`;
      ctx.fillStyle = accent;
      ctx.fillText(' KM/H', hudX + sw + 4, hudY + token.fontTitle * 0.35);
      hudY += token.fontTitle + pad(token, 0.35);
      hudY += drawPegMeter(
        ctx,
        hudX,
        hudY,
        Math.min(pad(token, 12), telemetryMaxW),
        player,
        token,
        accent,
      );
      ctx.fillStyle = token.textDim;
      ctx.font = `500 ${token.fontCaption}px ${token.fontFamily}`;
      const box = gearboxFor(this.launch.discipline);
      const early = this.shiftCueArmed ? ' · early' : '';
      ctx.fillText(`G${player.gear}/${box.gearCount}${early}`, hudX, hudY);
      hudY += token.fontCaption + pad(token, 0.35);

      const clean = Math.max(0, Math.min(1, 1.2 - player.stats.lineNoise));
      const slim = `Car ${Math.round(player.condition * 100)} · Tyres ${Math.round(player.tyreTemp * 100)} · Line ${Math.round(clean * 100)}`;
      ctx.fillStyle = token.textMuted;
      ctx.font = `500 ${token.fontCaption}px ${token.fontFamily}`;
      ctx.fillText(truncateText(ctx, slim, telemetryMaxW), hudX, hudY);
    }

    // Teach band above deck: onboarding owns the channel when present;
    // otherwise driver chip + ticker may use it (chip left, ticker right/above).
    const hintUp = this.hintText !== null;
    if (leadDriver !== undefined && !hintUp) {
      const trait = getTrait(leadDriver.trait);
      const playerIntent = player !== undefined ? director.intentForCar(player.id) : undefined;
      const chipW = Math.min(pad(token, 14), w * 0.34);
      const chipH = pad(token, playerIntent !== undefined ? 5.2 : 3.5);
      const chipX = hudX;
      // Leave room for ticker lines above the deck when no hint.
      const tickerReserve =
        this.ticker.length > 0
          ? Math.min(this.ticker.length, 2) * (token.fontCaption + 4) + pad(token, 0.5)
          : 0;
      const chipY = chrome.deckTop - pad(token, 0.75) - chipH - tickerReserve;
      ctx.fillStyle = 'rgba(11,13,12,0.88)';
      ctx.strokeStyle = `${accent}99`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(chipX, chipY, chipW, chipH, Math.max(2, pad(token, 0.25)));
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = accent;
      ctx.fillRect(chipX, chipY, Math.max(3, pad(token, 0.35)), chipH);
      ctx.fillStyle = token.text;
      ctx.font = `600 ${token.fontCaption}px ${token.fontFamily}`;
      ctx.textBaseline = 'top';
      const nameMax = chipW - pad(token, 1.8);
      ctx.fillText(
        truncateText(ctx, leadDriver.name, nameMax),
        chipX + pad(token, 0.9),
        chipY + pad(token, 0.5),
      );
      ctx.fillStyle = token.textDim;
      ctx.fillText(
        truncateText(ctx, trait.name, nameMax),
        chipX + pad(token, 0.9),
        chipY + pad(token, 1.5),
      );
      if (playerIntent !== undefined) {
        ctx.fillStyle = accent;
        ctx.fillText(
          truncateText(ctx, intentHudLabel(playerIntent.tag), nameMax),
          chipX + pad(token, 0.9),
          chipY + pad(token, 2.6),
        );
      }
    }

    if (!this.paused) {
      const pauseUi = {
        pointerX: this.g.input.pointerX,
        pointerY: this.g.input.pointerY,
        pointerDown: this.g.input.isPointerDown(),
        pointerClicked: this.g.input.consumeClick() !== null,
        dt: 0,
        w,
        h,
        token,
        accent,
      };
      drawButton(ctx, pauseBtn, pauseUi);
      handleButton(pauseBtn, pauseUi);
      this.drawZoomSlider(ctx, chrome, pauseUi, accent);
    }

    ctx.restore();
  }

  private drawZoomSlider(
    ctx: CanvasRenderingContext2D,
    chrome: RaceChromeLayout,
    ui: {
      pointerX: number;
      pointerY: number;
      pointerDown: boolean;
      pointerClicked: boolean;
      dt: number;
      w: number;
      h: number;
      token: ThemeTokens;
      accent: string;
    },
    _accent: string,
  ): void {
    const state = this.g.state;
    if (state === null) return;
    if (typeof state.options.raceZoom !== 'number') {
      state.options.raceZoom = DEFAULT_RACE_ZOOM;
    }
    const z = Math.max(0, Math.min(1, state.options.raceZoom));
    const r = chrome.zoomSlider;
    const slider: SliderDef = {
      x: r.x,
      y: r.y,
      w: r.w,
      h: r.h,
      label: 'Zoom',
      value: z,
      onChange: (v) => {
        state.options.raceZoom = Math.max(0, Math.min(1, v));
        this.zoomDirty = true;
      },
    };
    drawSlider(ctx, slider, ui);
    handleSlider(slider, ui);
    if (!ui.pointerDown && this.zoomDirty) {
      this.zoomDirty = false;
      this.g.autosave();
    }
  }

  private drawPedalDeck(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    token: ThemeTokens,
    accent: string,
    player?: { rpm: number; shiftWindow: import('../engine/Gearbox').ShiftWindowKind; gear: number } | null,
  ): void {
    const chrome = drawPedalDeckChrome({
      ctx,
      w,
      h,
      token,
      accent,
      throttle: this.g.input.throttle,
      brake: this.g.input.brake,
      shifting:
        this.g.input.isKeyDown('ShiftLeft') || this.g.input.isKeyDown('ShiftRight'),
      shiftCueArmed: this.shiftCueArmed,
      animTime: this.animTime,
      rpm: player?.rpm ?? 900,
      shiftWindow: player?.shiftWindow ?? 'low',
      gear: player?.gear ?? 1,
    });
    this.chrome = chrome;
    this.g.input.setRaceChrome(chrome);
  }

  private drawCountdownBanner(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    token: ThemeTokens,
    phase: CountdownPhase,
  ): void {
    if (phase === null) return;
    const label = phase === 'go' ? 'GO!' : String(phase);
    const pulse =
      phase === 'go'
        ? 1.08
        : 1 + 0.04 * Math.sin(this.animTime * 10);
    ctx.save();
    ctx.fillStyle = 'rgba(10,12,11,0.35)';
    ctx.fillRect(0, 0, w, h);
    ctx.translate(w * 0.5, h * 0.38);
    ctx.scale(pulse, pulse);
    ctx.font = `400 ${Math.min(token.fontDisplay * 2.4, h * 0.18)}px ${token.fontDisplayFamily}`;
    ctx.fillStyle = phase === 'go' ? token.success : token.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = phase === 'go' ? 0.98 : 0.9;
    ctx.fillText(label, 0, 0);
    ctx.restore();
  }

  private drawRainChip(ctx: CanvasRenderingContext2D, w: number, h: number, token: ThemeTokens): void {
    const chrome = this.chrome ?? raceChromeLayout(w, h, token);
    const chipW = pad(token, 7);
    const chipH = pad(token, 2.6);
    const x = w - token.safe.right - pad(token) - chipW;
    const y = chrome.zoomSlider.y + chrome.zoomSlider.h + pad(token, 0.5);
    ctx.save();
    ctx.fillStyle = 'rgba(12, 22, 18, 0.88)';
    ctx.strokeStyle = 'rgba(94, 207, 142, 0.45)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(x, y, chipW, chipH, Math.max(2, pad(token, 0.25)));
    ctx.fill();
    ctx.stroke();
    ctx.font = `400 ${token.fontCaption}px ${token.fontDisplayFamily}`;
    ctx.fillStyle = '#5ecf8e';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('RAIN', x + chipW * 0.5, y + chipH * 0.52);
    ctx.restore();
  }

  private drawNightChip(ctx: CanvasRenderingContext2D, w: number, h: number, token: ThemeTokens): void {
    void h;
    const chrome = this.chrome ?? raceChromeLayout(w, h, token);
    const chipW = pad(token, 7);
    const chipH = pad(token, 2.6);
    const rainOffset = this.director?.rain ? chipH + pad(token, 0.4) : 0;
    const x = w - token.safe.right - pad(token) - chipW;
    const y = chrome.zoomSlider.y + chrome.zoomSlider.h + pad(token, 0.5) + rainOffset;
    ctx.save();
    ctx.fillStyle = 'rgba(14, 16, 14, 0.9)';
    ctx.strokeStyle = 'rgba(240, 196, 26, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(x, y, chipW, chipH, Math.max(2, pad(token, 0.25)));
    ctx.fill();
    ctx.stroke();
    ctx.font = `400 ${token.fontCaption}px ${token.fontDisplayFamily}`;
    ctx.fillStyle = '#f0c41a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('NIGHT', x + chipW * 0.5, y + chipH * 0.52);
    ctx.restore();
  }

  private drawTicker(ctx: CanvasRenderingContext2D, w: number, h: number, token: ThemeTokens): void {
    if (this.ticker.length === 0) return;
    // Onboarding owns the teach channel — demote ticker while a hint is up.
    if (this.hintText !== null) return;
    const chrome = this.chrome;
    const deckTop = chrome?.deckTop ?? h - token.safe.bottom - pad(token, 5);
    const maxW = Math.min(w - pad(token, 4) - token.safe.left - token.safe.right, pad(token, 40));
    ctx.save();
    ctx.font = `${token.fontCaption}px ${token.fontFamily}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    let y = deckTop - pad(token, 0.75);
    const lines = this.ticker.slice(0, 2);
    for (const line of lines) {
      ctx.globalAlpha = Math.min(1, line.ttl / TICKER_TTL);
      ctx.fillStyle = token.textMuted;
      ctx.fillText(
        truncateText(ctx, line.text, maxW),
        token.safe.left + pad(token),
        y,
      );
      y -= token.fontCaption + 4;
    }
    ctx.restore();
  }

  private drawOnboardingHint(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    token: ThemeTokens,
    accent: string,
  ): void {
    if (this.hintText === null) return;
    const boxW = Math.min(w - pad(token, 4), pad(token, 36));
    const deckTop = this.chrome?.deckTop ?? h * 0.74;
    const measured = layoutHintBox(ctx, {
      x: (w - boxW) * 0.5,
      y: 0,
      maxW: boxW,
      text: this.hintText,
      accent,
      token,
      maxLines: 3,
      fontSize: token.fontBody,
    });
    const y = Math.max(
      token.safe.top + pad(token, 8),
      deckTop - measured.h - pad(token, 1.5),
    );
    drawHintBox(ctx, {
      x: measured.x,
      y,
      maxW: boxW,
      text: this.hintText,
      accent,
      token,
      maxLines: 3,
      fontSize: token.fontBody,
    });
  }

  private drawFinishOverlay(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    token: ThemeTokens,
    accent: string,
    director: RaceDirector,
  ): void {
    const standing = director.currentStandings.find((s) => s.isPlayerControlled);
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, w, h);
    ctx.font = `900 ${token.fontDisplay}px ${token.fontFamily}`;
    ctx.fillStyle = token.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const label = director.isRetired ? 'RETIRED' : 'FINISH';
    ctx.fillText(label, w * 0.5, h * 0.42);
    if (standing !== undefined) {
      ctx.font = `700 ${token.fontTitle}px ${token.fontFamily}`;
      ctx.fillStyle = accent;
      ctx.fillText(`P${standing.position}`, w * 0.5, h * 0.42 + token.fontDisplay);
    }
    ctx.font = `${token.fontCaption}px ${token.fontFamily}`;
    ctx.fillStyle = token.textDim;
    ctx.fillText('Loading results…', w * 0.5, h * 0.42 + token.fontDisplay + token.fontTitle);
    ctx.restore();
  }

  private drawDebugOverlay(
    ctx: CanvasRenderingContext2D,
    _w: number,
    _h: number,
    token: ThemeTokens,
    director: RaceDirector,
  ): void {
    const player = director.cars.find((c) => c.isPlayerControlled);
    const lines = [
      `t=${director.raceClock.toFixed(2)} paused=${director.isPaused}`,
      `cars=${director.cars.length} rain=${director.rain}`,
      `dt=${PHYSICS.dt} inputT=${director.playerInputTime.toFixed(2)}`,
      player !== undefined
        ? `v=${player.v.toFixed(1)} grip=${player.gripUsage.toFixed(2)} slot=${player.slotMode} deslots=${player.deslotCount}`
        : 'no player',
    ];
    ctx.save();
    ctx.font = `${token.fontCaption}px monospace`;
    ctx.fillStyle = '#4ade80';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    let y = token.safe.top + pad(token, 12);
    for (const line of lines) {
      ctx.fillText(line, token.safe.left + pad(token), y);
      y += token.fontCaption + 2;
    }
    ctx.restore();
  }
}
