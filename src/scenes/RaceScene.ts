import type { Scene } from '../engine/SceneManager';
import type { GameContext } from '../engine/GameContext';
import { BALANCE } from '../data/balance';
import { getTrait } from '../data/traits';
import { PHYSICS } from '../data/physics';
import {
  RaceDirector,
  type CountdownPhase,
  type GhostSample,
  type GhostTrace,
} from '../engine/RaceDirector';
import type { OnboardingFlags, RaceEvent, VehicleParts } from '../engine/types';
import {
  intentHudLabel,
  intentTickerPhrase,
  type BrainIntentTag,
} from '../engine/BrainIntent';
import {
  buildRaceConfig,
  buildResultsPayload,
  loadGhostTrace,
  storeGhostTrace,
  type RaceLaunchConfig,
  type RaceObjectiveStats,
} from '../engine/raceTypes';
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
import {
  drawButton,
  handleButton,
  drawModal,
  handleModal,
  layoutModalButtons,
  pad,
  ensureMinTouch,
  type ButtonDef,
  type ModalDef,
} from '../ui/components';
import { accentForDiscipline, createTheme, type ThemeTokens } from '../ui/theme';
import { gearboxFor } from '../engine/Gearbox';

/** Avoid importing sceneUtils / ResultsScene here — that cycle breaks dynamic RaceScene load. */
function disciplineAccent(id: import('../data/disciplines').DisciplineId): string {
  return accentForDiscipline(id);
}

const FINISH_DELAY_SEC = 2.2;
const TICKER_MAX = 4;
const TICKER_TTL = 6;

const carPoseScratch = { x: 0, y: 0, tx: 0, ty: 0, heading: 0 };
const ghostScratch = { x: 0, y: 0, tx: 0, ty: 0, heading: 0 };

/** Soft rival paint — team hue nudged by loadout strength. */
function rivalPaint(teamId: number, teamCount: number, parts: VehicleParts): string {
  const hue = teamCount <= 0 ? 200 : Math.round((teamId * 360) / teamCount) % 360;
  let tierSum = 0;
  for (const k of Object.keys(parts) as (keyof VehicleParts)[]) {
    tierSum += parts[k] ?? 1;
  }
  const avg = tierSum / 7;
  const light = 48 + Math.min(12, avg * 2);
  const sat = 62 + Math.min(12, (avg - 1) * 3);
  return `hsl(${hue}, ${sat}%, ${light}%)`;
}

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
  private pauseModal: ModalDef = { open: false, title: '', body: '', buttons: [] };
  private finishTimer = 0;
  private transitioned = false;
  private prevCountdown: CountdownPhase | undefined;
  private prevPlayerWallHits = 0;
  private prevPlayerSpins = 0;
  private prevPlayerDeslots = 0;
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

      const vehicle = state.vehicles[this.launch.discipline];
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
        worldEl.classList.add('is-live');
        this.view.attachWorldCanvas(worldEl);
      }
      this.view.prepare({
        track: this.director.track,
        discipline: this.launch.discipline,
        night: this.director.night,
        rain: this.director.rain,
      });
      if (worldEl !== null) {
        this.view.resizeWorld(
          this.g.canvas.clientWidth,
          this.g.canvas.clientHeight,
          Math.min(window.devicePixelRatio || 1, PHYSICS.dprCap),
        );
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
    document.querySelector<HTMLCanvasElement>('#world')?.classList.remove('is-live');
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

    director.setPlayerPedals(
      this.g.input.throttle,
      this.g.input.brake,
      this.g.input.consumeUpshift(),
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
    };
    this.view.draw(ctx, frame);

    // Pedal deck under HUD so pause/minimap stay readable.
    this.drawPedalDeck(ctx, w, h, token, accent);
    this.drawHud(ctx, w, h, token, accent, director, cars, playerIdx);
    const leadDriver = this.g.state?.roster.find((d) => d.id === this.launch.leadDriverId);
    const traitName = leadDriver !== undefined ? getTrait(leadDriver.trait).name : 'Driver';
    const vehicle = this.g.state?.vehicles[this.launch.discipline];
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
    const track = this.view.getTrack();
    const teamCount = director.config.format.teamCount;
    const out = this.frameCars;
    out.length = 0;
    if (track === null) return out;

    for (const car of director.cars) {
      writeCarWorld(track, car.s, car.l, carPoseScratch, car.slipAngle);
      const parts = director.partTiersFor(car.id);
      const color = car.isPlayerControlled
        ? playerAccent
        : rivalPaint(car.teamId, teamCount, parts);
      out.push({
        id: car.id,
        s: car.s,
        l: car.l,
        v: car.v,
        slipAngle: car.slipAngle,
        heading: carPoseScratch.heading,
        color,
        isPlayer: car.isPlayerControlled,
        tyreTemp: car.tyreTemp,
        condition: car.condition,
        slotMode: car.slotMode,
        driftState: car.driftState,
        spinRemaining: car.spinRemaining,
        gripUsage: car.gripUsage,
        partTiers: parts,
        worldX: carPoseScratch.x,
        worldY: carPoseScratch.y,
        tangentX: carPoseScratch.tx,
        tangentY: carPoseScratch.ty,
        lineNoise: car.stats.lineNoise,
      });
    }
    this.frameCars = out;
    return out;
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
    const director = this.director;
    if (director === null) return;
    const accent = disciplineAccent(this.launch.discipline);
    const cars = this.buildCarFrame(director, accent);
    this.view.syncCameraCountdown(
      cars,
      this.g.canvas.clientWidth,
      this.g.canvas.clientHeight,
    );
  }

  private updateCamera(director: RaceDirector): void {
    const accent = disciplineAccent(this.launch.discipline);
    const cars = this.buildCarFrame(director, accent);
    const w = this.g.canvas.clientWidth;
    const h = this.g.canvas.clientHeight;

    if (director.countdown !== null) {
      this.view.syncCameraCountdown(cars, w, h);
    } else {
      const player = cars.find((c) => c.isPlayer) ?? cars[0];
      if (player !== undefined) {
        this.view.syncCameraFollow(player, w, h);
      }
    }

    this.view.updateCamera(this.lastDt);
  }

  private updateCountdownAudio(phase: CountdownPhase): void {
    if (phase === this.prevCountdown) return;
    if (phase === 3 || phase === 2 || phase === 1) {
      this.g.audio.playCountdown(phase);
    } else if (phase === 'go') {
      this.g.audio.playGo();
    }
    this.prevCountdown = phase;
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
      });

      if (player.lastShiftKind !== null) {
        this.g.audio.playShift(player.lastShiftKind);
        player.lastShiftKind = null;
      }

      if (player.wallHits > this.prevPlayerWallHits) {
        this.g.audio.playCrash();
        if (!this.g.state!.onboarding.shownCrashHint) {
          this.showHint('Wall contact reduces condition — brake earlier!', 'shownCrashHint');
        }
      }
      if (player.contactHits > this.prevPlayerContactHits) {
        this.g.audio.playSoftContact();
      }
      if (player.deslotCount > this.prevPlayerDeslots) {
        this.g.audio.playDeslot();
        if (!this.g.state!.onboarding.shownBrakeHint) {
          this.showHint('Too fast for the corner — brake before the bend!', 'shownBrakeHint');
        } else if (!this.g.state!.onboarding.shownDeslotHint) {
          this.showHint("Crawl back onto the peg.", 'shownDeslotHint');
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
          this.hintText = "Lift or you'll leave the peg.";
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
          this.showHint('Peg meter: keep under 100% in bends', 'shownPegHint');
        }
      }

      const lead = this.g.state?.roster.find((d) => d.id === this.launch.leadDriverId);
      const skill = lead?.skill ?? 40;
      if (
        !this.g.state!.onboarding.shownAuthorityHint &&
        this.hintText === null &&
        shouldTeachAuthority(skill, player, kappa)
      ) {
        this.showHint('Authority trims pin-throttle in bends — trust it', 'shownAuthorityHint');
      }

      this.shiftCueArmed = wantsShiftCue(player, this.launch.discipline);
      if (
        this.shiftCueArmed &&
        !this.g.state!.onboarding.shownShiftCue &&
        this.hintText === null
      ) {
        this.showHint('SHIFT to upshift — hold a gear until you pull the next', 'shownShiftCue');
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
        this.fxImpulses.push({
          kind: 'dust',
          x: px,
          y: py,
          index: tick,
          intensity: Math.max(car.gripUsage, 1.1),
        });
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
    this.view.updateFx(this.lastDt);
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
      this.showHint('Enter = gas · Space = brake · SHIFT = upshift', 'shownPedalControls');
    } else if (!state.onboarding.shownTouchControls) {
      this.showHint(
        'Touch: right = gas, left = brake · SHIFT = up · lift to downshift',
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
    const leadDriver = this.g.state?.roster.find((d) => d.id === this.launch.leadDriverId);

    const chrome = this.chrome ?? raceChromeLayout(w, h, token);
    this.chrome = chrome;
    this.g.input.setRaceChrome(chrome);

    this.view.drawMinimap(ctx, chrome.minimap, cars, playerIdx);

    const pauseBtn: ButtonDef = {
      x: chrome.pause.x,
      y: chrome.pause.y,
      w: chrome.pause.w,
      h: chrome.pause.h,
      label: 'II',
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
      const slim = `C${Math.round(player.condition * 100)} · T${Math.round(player.tyreTemp * 100)} · L${Math.round(clean * 100)}`;
      ctx.fillStyle = token.textMuted;
      ctx.fillText(slim, hudX, hudY);
    }

    if (leadDriver !== undefined) {
      const trait = getTrait(leadDriver.trait);
      const playerIntent = player !== undefined ? director.intentForCar(player.id) : undefined;
      const chipW = Math.min(pad(token, 14), w * 0.34);
      const chipH = pad(token, playerIntent !== undefined ? 5.2 : 3.5);
      const chipX = hudX;
      const chipY = chrome.deckTop - pad(token, 0.75) - chipH;
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
      ctx.fillText(leadDriver.name, chipX + pad(token, 0.9), chipY + pad(token, 0.5));
      ctx.fillStyle = token.textDim;
      ctx.fillText(trait.name, chipX + pad(token, 0.9), chipY + pad(token, 1.5));
      if (playerIntent !== undefined) {
        ctx.fillStyle = accent;
        ctx.fillText(
          intentHudLabel(playerIntent.tag),
          chipX + pad(token, 0.9),
          chipY + pad(token, 2.6),
        );
      }
    }

    if (!this.paused) {
      const pauseUi = {
        pointerX: this.g.input.pointerX,
        pointerY: this.g.input.pointerY,
        pointerDown: this.g.input.peekClick() !== null,
        pointerClicked: this.g.input.consumeClick() !== null,
        dt: 0,
        w,
        h,
        token,
        accent,
      };
      drawButton(ctx, pauseBtn, pauseUi);
      handleButton(pauseBtn, pauseUi);
    }

    ctx.restore();
  }

  private drawPedalDeck(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    token: ThemeTokens,
    accent: string,
  ): void {
    const chrome = this.chrome ?? raceChromeLayout(w, h, token);
    this.chrome = chrome;
    this.g.input.setRaceChrome(chrome);

    const throttle = this.g.input.throttle;
    const brake = this.g.input.brake;
    const shifting =
      this.g.input.isKeyDown('ShiftLeft') || this.g.input.isKeyDown('ShiftRight');

    const paintPad = (
      r: { x: number; y: number; w: number; h: number },
      idleFill: string,
      activeRgb: string,
      amount: number,
      label: string,
      labelColor: string,
    ): void => {
      const pressed = amount > 0.08;
      const radius = Math.max(2, pad(token, 0.3));
      ctx.save();
      // Base plate
      ctx.fillStyle = idleFill;
      ctx.beginPath();
      ctx.roundRect(r.x, r.y, r.w, r.h, radius);
      ctx.fill();

      // Pressure fill from bottom
      if (pressed) {
        const fillH = r.h * Math.min(1, 0.18 + amount * 0.82);
        const gy = ctx.createLinearGradient(r.x, r.y + r.h - fillH, r.x, r.y + r.h);
        gy.addColorStop(0, `rgba(${activeRgb},0.15)`);
        gy.addColorStop(1, `rgba(${activeRgb},0.55)`);
        ctx.fillStyle = gy;
        ctx.beginPath();
        ctx.roundRect(r.x, r.y + r.h - fillH, r.w, fillH, radius);
        ctx.fill();
      }

      // Bevel + stroke
      ctx.strokeStyle = pressed ? `rgba(${activeRgb},0.95)` : `rgba(${activeRgb},0.35)`;
      ctx.lineWidth = pressed ? 2.5 : 1.5;
      ctx.beginPath();
      ctx.roundRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, radius);
      ctx.stroke();

      // Top highlight rail
      ctx.fillStyle = pressed ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.05)';
      ctx.fillRect(r.x + radius, r.y + 2, r.w - radius * 2, 2);

      ctx.font = `400 ${Math.max(token.fontCaption, Math.min(r.h * 0.22, token.fontTitle))}px ${token.fontDisplayFamily}`;
      ctx.fillStyle = labelColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const ctxLs = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
      if (typeof ctxLs.letterSpacing === 'string') {
        ctxLs.letterSpacing = '0.18em';
        ctx.fillText(label, r.x + r.w * 0.5, r.y + r.h * 0.52);
        ctxLs.letterSpacing = '0px';
      } else {
        ctx.fillText(label, r.x + r.w * 0.5, r.y + r.h * 0.52);
      }
      ctx.restore();
    };

    // Soft deck plate behind pads — metal strip read.
    ctx.save();
    const deckGrad = ctx.createLinearGradient(0, chrome.deckTop, 0, h);
    deckGrad.addColorStop(0, 'rgba(8,10,9,0.2)');
    deckGrad.addColorStop(0.25, 'rgba(8,10,9,0.72)');
    deckGrad.addColorStop(1, 'rgba(6,8,7,0.92)');
    ctx.fillStyle = deckGrad;
    ctx.fillRect(0, chrome.deckTop, w, h - chrome.deckTop);
    const fade = ctx.createLinearGradient(0, chrome.deckTop - 28, 0, chrome.deckTop);
    fade.addColorStop(0, 'rgba(8,10,9,0)');
    fade.addColorStop(1, 'rgba(8,10,9,0.55)');
    ctx.fillStyle = fade;
    ctx.fillRect(0, chrome.deckTop - 28, w, 28);
    // Signal strip along deck top
    ctx.fillStyle = `${accent}55`;
    ctx.fillRect(0, chrome.deckTop, w, 2);
    ctx.restore();

    paintPad(
      chrome.brake,
      'rgba(28,14,14,0.78)',
      '255,107,90',
      brake,
      'BRAKE',
      brake > 0.08 ? token.text : 'rgba(255,107,90,0.7)',
    );
    paintPad(
      chrome.gas,
      'rgba(12,28,18,0.78)',
      '94,207,142',
      throttle,
      'GAS',
      throttle > 0.08 ? token.text : 'rgba(94,207,142,0.7)',
    );

    const shiftPulse = this.shiftCueArmed ? 0.15 + 0.1 * Math.sin(this.animTime * 10) : 0;
    const shiftAmt = shifting ? 1 : shiftPulse > 0 ? 0.35 + shiftPulse : 0;
    paintPad(
      chrome.shift,
      `rgba(36,30,10,${0.7 + shiftPulse})`,
      '240,196,26',
      shiftAmt,
      this.shiftCueArmed ? 'SHIFT!' : 'SHIFT',
      shifting || this.shiftCueArmed ? '#f0c41a' : token.textMuted,
    );
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
    const y = chrome.pause.y + chrome.pause.h + pad(token, 0.5);
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
    const y = chrome.pause.y + chrome.pause.h + pad(token, 0.5) + rainOffset;
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

  private drawTicker(ctx: CanvasRenderingContext2D, _w: number, h: number, token: ThemeTokens): void {
    if (this.ticker.length === 0) return;
    const chrome = this.chrome;
    ctx.save();
    ctx.font = `${token.fontCaption}px ${token.fontFamily}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    let y = (chrome?.deckTop ?? h - token.safe.bottom - pad(token, 5)) - pad(token, 0.75);
    for (const line of this.ticker) {
      ctx.globalAlpha = Math.min(1, line.ttl / TICKER_TTL);
      ctx.fillStyle = token.textMuted;
      ctx.fillText(line.text, token.safe.left + pad(token), y);
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
    ctx.save();
    const boxW = Math.min(w - pad(token, 4), pad(token, 36));
    const boxH = pad(token, 4);
    const x = (w - boxW) * 0.5;
    // Sit above the pedal deck (and driver chip), not on top of BRAKE/GAS/SHIFT.
    const deckTop = this.chrome?.deckTop ?? h * 0.74;
    const y = Math.max(token.safe.top + pad(token, 8), deckTop - boxH - pad(token, 1.5));
    ctx.fillStyle = token.overlay;
    ctx.beginPath();
    ctx.roundRect(x, y, boxW, boxH, pad(token, 0.75));
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.font = `600 ${token.fontBody}px ${token.fontFamily}`;
    ctx.fillStyle = token.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.hintText, x + boxW * 0.5, y + boxH * 0.5);
    ctx.restore();
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
