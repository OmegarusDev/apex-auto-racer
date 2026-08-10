import type { Scene } from '../engine/SceneManager';
import type { GameContext } from '../engine/GameContext';
import { BALANCE } from '../data/balance';
import { getTrait } from '../data/traits';
import { PHYSICS } from '../data/physics';
import {
  RaceDirector,
  teamColor,
  type CountdownPhase,
  type GhostSample,
  type GhostTrace,
} from '../engine/RaceDirector';
import type { CarSimState } from '../engine/Vehicle';
import type { OnboardingFlags, RaceEvent } from '../engine/types';
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
import { Camera } from '../graphics/Camera';
import { Particles } from '../graphics/Particles';
import { VectorRenderer, sampleTrack } from '../graphics/VectorRenderer';
import {
  drawPegMeter,
  drawPreRaceCard,
  nearDeslotThreat,
  sampleKappaAt,
  shouldTeachAuthority,
  wantsShiftCue,
} from '../graphics/RaceFantasyHud';
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
  private renderer = new VectorRenderer();
  private camera = new Camera();
  private particles = new Particles();
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
      this.renderer.bakeTrack(this.director.track, this.launch.discipline, this.director.night);
      this.particles.setRaining(this.director.rain);
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
    const cam = this.camera.getTransform();

    this.renderer.blitTrack(ctx, cam, w, h);
    if (director.night) {
      ctx.save();
      const g = ctx.createRadialGradient(w * 0.5, h * 0.45, h * 0.15, w * 0.5, h * 0.5, h * 0.85);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(4,8,20,0.42)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }

    if (this.ghostTrace !== null && this.ghostCarId !== null && director.countdown === null) {
      const sample = sampleGhost(this.ghostTrace, this.ghostCarId, director.raceClock);
      if (sample !== null) {
        const track = this.renderer.getTrack();
        if (track !== null) {
          const ts = sampleTrack(track, sample.s);
          const wx = ts.pos.x + ts.normal.x * sample.l;
          const wy = ts.pos.y + ts.normal.y * sample.l;
          const tang = Math.atan2(ts.tangent.y, ts.tangent.x);
          this.renderer.drawGhost(ctx, wx, wy, tang, `${accent}66`, cam, w, h);
        }
      }
    }

    // Ground FX under cars — tabletop depth.
    this.particles.renderGround(ctx, cam, w, h);

    const cars = director.cars;
    const teamCount = director.config.format.teamCount;
    const playerIdx = cars.findIndex((c) => c.isPlayerControlled);

    for (let i = 0; i < cars.length; i++) {
      const car = cars[i]!;
      const color = teamColor(car.teamId, teamCount);
      this.renderer.drawCar(ctx, car, color, car.isPlayerControlled, cam, w, h);
    }

    this.particles.renderAir(ctx, cam, w, h);
    this.particles.renderRain(ctx, w, h);

    this.drawHud(ctx, w, h, token, accent, director, cars, playerIdx);
    this.drawPedalTints(ctx, w, h, token);
    const leadDriver = this.g.state?.roster.find((d) => d.id === this.launch.leadDriverId);
    const traitName = leadDriver !== undefined ? getTrait(leadDriver.trait).name : 'Driver';
    drawPreRaceCard(ctx, w, h, token, accent, {
      discipline: this.launch.discipline,
      laps: director.config.laps,
      rain: director.rain,
      night: director.night,
      driverName: leadDriver?.name ?? 'Driver',
      traitName,
      phase: director.countdown,
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
      layoutModalButtons(this.pauseModal, {
        pointerX: this.g.input.pointerX,
        pointerY: this.g.input.pointerY,
        pointerDown: this.g.input.peekClick() !== null,
        pointerClicked: this.g.input.consumeClick() !== null,
        dt: 0,
        w,
        h,
        token,
        accent,
      });
      drawModal(ctx, this.pauseModal, {
        pointerX: this.g.input.pointerX,
        pointerY: this.g.input.pointerY,
        pointerDown: false,
        pointerClicked: false,
        dt: 0,
        w,
        h,
        token,
        accent,
      });
    }

    if (this.g.debug) {
      this.drawDebugOverlay(ctx, w, h, token, director);
    }
  }

  private openPause(): void {
    this.director?.pause();
    this.paused = true;
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
    const track = this.renderer.getTrack();
    if (track === null) return;

    const positions = director.cars.map((car) => {
      const sample = sampleTrack(track, car.s);
      return {
        x: sample.pos.x + sample.normal.x * car.l,
        y: sample.pos.y + sample.normal.y * car.l,
      };
    });

    this.camera.setCountdownTargets(
      positions,
      this.g.canvas.clientWidth,
      this.g.canvas.clientHeight,
    );
  }

  private updateCamera(director: RaceDirector): void {
    const track = this.renderer.getTrack();
    if (track === null) return;

    if (director.countdown !== null) {
      const positions = director.cars.map((car) => {
        const sample = sampleTrack(track, car.s);
        return {
          x: sample.pos.x + sample.normal.x * car.l,
          y: sample.pos.y + sample.normal.y * car.l,
        };
      });
      this.camera.setCountdownTargets(
        positions,
        this.g.canvas.clientWidth,
        this.g.canvas.clientHeight,
      );
    } else {
      const player = director.cars.find((c) => c.isPlayerControlled) ?? director.cars[0];
      if (player !== undefined) {
        const sample = sampleTrack(track, player.s);
        this.camera.setFollowTarget(
          {
            x: sample.pos.x + sample.normal.x * player.l,
            y: sample.pos.y + sample.normal.y * player.l,
          },
          player.v,
          sample.tangent,
        );
      }
    }

    this.camera.update(this.lastDt);
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
    const track = this.renderer.getTrack();
    if (track === null) return;

    const player = director.cars.find((c) => c.isPlayerControlled);
    const ent = director.entertainmentSnapshot;
    this.stats.entertainmentScore = ent.entertainmentScore;
    this.g.audio.setCrowd(ent.hype);

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

      // Near-deslot tell + Authority / peg / shift teach (presentation only).
      const kappa = sampleKappaAt(director.track.nodes, player.s);
      this.nearDeslotFxCd = Math.max(0, this.nearDeslotFxCd - this.lastDt);
      if (nearDeslotThreat(player, kappa) && this.nearDeslotFxCd <= 0) {
        const renderedP = this.renderer.sampleCar(player);
        if (renderedP !== null) {
          this.particles.emitSparks(renderedP.pos.x, renderedP.pos.y, 3, 2);
          this.particles.emitDust(renderedP.pos.x, renderedP.pos.y, 3, 0.95);
        }
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
        this.showHint('SHIFT optional — tap early to pull a gear sooner', 'shownShiftCue');
      }

      this.stats.playerWallHits = player.wallHits;
      this.stats.playerSpinCount = player.spinCount;
      this.stats.playerDeslotCount = player.deslotCount;
      this.stats.playerOvertakes = player.overtakeCount;
      this.prevPlayerWallHits = player.wallHits;
      this.prevPlayerSpins = player.spinCount;
      this.prevPlayerDeslots = player.deslotCount;
      this.prevPlayerContactHits = player.contactHits;
    }

    let tick = 0;
    for (const car of director.cars) {
      const rendered = this.renderer.sampleCar(car);
      if (rendered === null) continue;
      const prev = this.prevCarSamples.get(car.id);
      const px = rendered.pos.x;
      const py = rendered.pos.y;

      const scrubbing = car.driftState || car.slotMode === 'deslot';
      if (prev !== undefined && scrubbing && car.v > 4) {
        this.particles.emitSkid(prev.x, prev.y, px, py);
      }
      if (scrubbing && car.v > 6) {
        this.particles.emitDust(px, py, tick, Math.max(car.gripUsage, 1.1));
      }
      if (car.spinRemaining > 0) {
        this.particles.emitSmoke(px, py, tick);
      }
      const prevDeslots = this.prevCarDeslots.get(car.id) ?? 0;
      if (car.deslotCount > prevDeslots) {
        this.particles.emitSparks(px, py, tick);
      }
      this.prevCarDeslots.set(car.id, car.deslotCount);
      const prevHits = this.prevCarWallHits.get(car.id) ?? 0;
      if (car.wallHits > prevHits && car.v > PHYSICS.crashSpeed) {
        this.particles.emitSparks(px, py, tick);
      }
      this.prevCarWallHits.set(car.id, car.wallHits);

      this.prevCarSamples.set(car.id, { x: px, y: py, s: car.s, l: car.l });
      tick += 1;
    }

    this.particles.update(this.lastDt);
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
            if (ev.detail === 'miss') text = `${ev.time.toFixed(1)}s — ${name} misses a shift`;
            else if (ev.detail === 'down') text = `${ev.time.toFixed(1)}s — ${name} downshifts`;
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
      this.showHint('Enter = gas · Space = brake · gears shift themselves', 'shownPedalControls');
    } else if (!state.onboarding.shownBrakeHint) {
      this.showHint('Touch: right = gas, left = brake · SHIFT = early up (optional)', 'shownBrakeHint');
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
    cars: readonly CarSimState[],
    playerIdx: number,
  ): void {
    const player = cars.find((c) => c.isPlayerControlled);
    const standing = director.currentStandings.find((s) => s.isPlayerControlled);
    const leadDriver = this.g.state?.roster.find((d) => d.id === this.launch.leadDriverId);

    const safe = token.safe;
    // HUD zones: TL telemetry, TR minimap+pause, BL driver chip, BC SHIFT (pedals), BR clear of chip.
    const pauseSize = ensureMinTouch(pad(token, 4.5), token);
    const mmSize = Math.min(pad(token, 10), w * 0.22, h * 0.18);
    const mmX = w - safe.right - pad(token) - mmSize;
    const mmY = safe.top + pad(token);
    this.renderer.drawMinimap(
      ctx,
      { x: mmX, y: mmY, w: mmSize, h: mmSize * 0.72 },
      cars,
      playerIdx,
    );

    const pauseBtn: ButtonDef = {
      x: w - safe.right - pad(token) - pauseSize,
      y: mmY + mmSize * 0.72 + pad(token, 0.5),
      w: pauseSize,
      h: pauseSize,
      label: '⏸',
      onClick: () => this.openPause(),
    };

    ctx.save();
    ctx.font = `700 ${token.fontTitle}px ${token.fontFamily}`;
    ctx.fillStyle = token.text;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    const hudX = safe.left + pad(token);
    let hudY = safe.top + pad(token);
    const telemetryMaxW = Math.max(pad(token, 14), mmX - hudX - pad(token));

    if (standing !== undefined) {
      ctx.fillText(`P${standing.position}`, hudX, hudY);
      hudY += token.fontTitle + pad(token, 0.25);
    }

    ctx.font = `600 ${token.fontBody}px ${token.fontFamily}`;
    ctx.fillStyle = token.textMuted;
    const lap = player?.lap ?? 0;
    ctx.fillText(`Lap ${Math.min(lap + 1, director.config.laps)}/${director.config.laps}`, hudX, hudY);
    hudY += token.fontBody + pad(token, 0.5);

    if (player !== undefined) {
      const speedKmh = Math.round(player.v * 3.6);
      ctx.fillStyle = accent;
      ctx.fillText(`${speedKmh} km/h`, hudX, hudY);
      hudY += token.fontBody + pad(token, 0.35);
      hudY += drawPegMeter(
        ctx,
        hudX,
        hudY,
        Math.min(pad(token, 12), telemetryMaxW),
        player,
        token,
        accent,
      );
      // Gear ambient — assist owns shifting; RPM is flavour.
      ctx.fillStyle = token.textDim;
      ctx.font = `500 ${token.fontCaption}px ${token.fontFamily}`;
      const box = gearboxFor(this.launch.discipline);
      const early = this.shiftCueArmed ? ' · early OK' : '';
      ctx.fillText(
        `G${player.gear}/${box.gearCount} auto · ${Math.round(player.rpm)} rpm${early}`,
        hudX,
        hudY,
      );
      hudY += token.fontCaption + pad(token, 0.5);

      ctx.font = `600 ${token.fontBody}px ${token.fontFamily}`;
      ctx.fillStyle = token.textMuted;
      const cond = `Cond ${Math.round(player.condition * 100)}%`;
      const tyre = `Tyre ${Math.round(player.tyreTemp * 100)}%`;
      ctx.fillText(cond, hudX, hudY);
      const condW = ctx.measureText(cond).width;
      const tyreGap = pad(token, 1.25);
      if (condW + tyreGap + ctx.measureText(tyre).width <= telemetryMaxW) {
        ctx.fillText(tyre, hudX + condW + tyreGap, hudY);
      } else {
        hudY += token.fontBody + pad(token, 0.25);
        ctx.fillText(tyre, hudX, hudY);
      }
      hudY += token.fontBody + pad(token, 0.6);

      const barW = Math.min(pad(token, 12), telemetryMaxW);
      const barH = Math.max(4, pad(token, 0.45));
      const hype = this.director?.entertainmentSnapshot.hype ?? 0;
      ctx.fillStyle = token.textDim;
      ctx.font = `600 ${token.fontCaption}px ${token.fontDisplayFamily}`;
      ctx.textBaseline = 'bottom';
      ctx.fillText('CROWD', hudX, hudY);
      hudY += pad(token, 0.35);
      ctx.textBaseline = 'top';
      ctx.fillStyle = token.card;
      ctx.fillRect(hudX, hudY, barW, barH);
      ctx.fillStyle = accent;
      ctx.fillRect(hudX, hudY, barW * Math.max(0.02, hype), barH);
    }

    if (leadDriver !== undefined) {
      const trait = getTrait(leadDriver.trait);
      const playerIntent = player !== undefined ? director.intentForCar(player.id) : undefined;
      const chipW = Math.min(pad(token, 14), w * 0.34);
      const chipH = pad(token, playerIntent !== undefined ? 5.2 : 3.5);
      // Sit above SHIFT pad (bottom-center), left zone — clear of pause (now TR).
      const chipX = hudX;
      const chipY = h - safe.bottom - h * 0.22 - pad(token, 0.75) - chipH;
      ctx.fillStyle = token.card;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(chipX, chipY, chipW, chipH, pad(token, 0.5));
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = token.text;
      ctx.font = `600 ${token.fontCaption}px ${token.fontFamily}`;
      ctx.fillText(leadDriver.name, chipX + pad(token, 0.75), chipY + pad(token, 0.5));
      ctx.fillStyle = token.textDim;
      ctx.fillText(trait.name, chipX + pad(token, 0.75), chipY + pad(token, 1.5));
      if (playerIntent !== undefined) {
        ctx.fillStyle = accent;
        ctx.fillText(
          intentHudLabel(playerIntent.tag),
          chipX + pad(token, 0.75),
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

  private drawPedalTints(ctx: CanvasRenderingContext2D, w: number, h: number, token: ThemeTokens): void {
    const throttle = this.g.input.throttle;
    const brake = this.g.input.brake;
    const shifting = this.g.input.isKeyDown('ShiftLeft') || this.g.input.isKeyDown('ShiftRight');

    ctx.save();
    if (brake > 0) {
      ctx.fillStyle = `rgba(248,113,113,${0.08 + brake * 0.12})`;
      ctx.fillRect(0, 0, w * 0.5, h);
    }
    if (throttle > 0) {
      ctx.fillStyle = `rgba(74,222,128,${0.08 + throttle * 0.12})`;
      ctx.fillRect(w * 0.5, 0, w * 0.5, h);
    }
    // Bottom-center SHIFT pad.
    const sx = w * 0.36;
    const sy = h * 0.78;
    const sw = w * 0.28;
    const sh = h * 0.22;
    const shiftPulse = this.shiftCueArmed ? 0.12 + 0.08 * Math.sin(this.animTime * 10) : 0;
    ctx.fillStyle = shifting
      ? 'rgba(250,204,21,0.22)'
      : `rgba(250,204,21,${0.06 + shiftPulse})`;
    ctx.fillRect(sx, sy, sw, sh);
    ctx.strokeStyle = this.shiftCueArmed ? 'rgba(250,204,21,0.7)' : 'rgba(250,204,21,0.28)';
    ctx.lineWidth = this.shiftCueArmed ? 2.5 : 1.5;
    ctx.strokeRect(sx + 1, sy + 1, sw - 2, sh - 2);

    ctx.font = `${token.fontCaption}px ${token.fontFamily}`;
    ctx.fillStyle = token.textDim;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('BRAKE', w * 0.25, h - token.safe.bottom - pad(token, 0.5));
    ctx.fillText('GO', w * 0.75, h - token.safe.bottom - pad(token, 0.5));
    ctx.fillStyle = shifting || this.shiftCueArmed ? '#facc15' : token.textDim;
    ctx.font = `${token.fontCaption}px ${token.fontFamily}`;
    ctx.textBaseline = 'middle';
    ctx.fillText(this.shiftCueArmed ? 'EARLY' : 'AUTO', w * 0.5, sy + sh * 0.55);
    ctx.restore();
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
    ctx.fillStyle = 'rgba(10,10,12,0.28)';
    ctx.fillRect(0, 0, w, h);
    ctx.translate(w * 0.5, h * 0.38);
    ctx.scale(pulse, pulse);
    ctx.font = `900 ${Math.min(token.fontDisplay * 2.2, h * 0.16)}px ${token.fontDisplayFamily}`;
    ctx.fillStyle = phase === 'go' ? token.success : token.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = phase === 'go' ? 0.98 : 0.9;
    ctx.fillText(label, 0, 0);
    ctx.restore();
  }

  private drawRainChip(ctx: CanvasRenderingContext2D, w: number, h: number, token: ThemeTokens): void {
    const chipW = pad(token, 7);
    const chipH = pad(token, 2.6);
    const mmSize = Math.min(pad(token, 10), w * 0.22, h * 0.18);
    const pauseSize = ensureMinTouch(pad(token, 4.5), token);
    const x = w - token.safe.right - pad(token) - chipW;
    const y =
      token.safe.top +
      pad(token) +
      mmSize * 0.72 +
      pad(token, 0.5) +
      pauseSize +
      pad(token, 0.5);
    ctx.save();
    ctx.fillStyle = 'rgba(14, 28, 40, 0.82)';
    ctx.strokeStyle = 'rgba(125, 211, 252, 0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, chipW, chipH, pad(token, 0.4));
    ctx.fill();
    ctx.stroke();
    ctx.font = `700 ${token.fontCaption}px ${token.fontDisplayFamily}`;
    ctx.fillStyle = '#7dd3fc';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('RAIN', x + chipW * 0.5, y + chipH * 0.5);
    ctx.restore();
    void h;
  }

  private drawNightChip(ctx: CanvasRenderingContext2D, w: number, h: number, token: ThemeTokens): void {
    const chipW = pad(token, 7);
    const chipH = pad(token, 2.6);
    const mmSize = Math.min(pad(token, 10), w * 0.22, h * 0.18);
    const pauseSize = ensureMinTouch(pad(token, 4.5), token);
    const x = w - token.safe.right - pad(token) - chipW;
    let y =
      token.safe.top +
      pad(token) +
      mmSize * 0.72 +
      pad(token, 0.5) +
      pauseSize +
      pad(token, 0.5);
    if (this.director?.rain) y += chipH + pad(token, 0.4);
    ctx.save();
    ctx.fillStyle = 'rgba(12, 16, 32, 0.88)';
    ctx.strokeStyle = 'rgba(147, 197, 253, 0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, chipW, chipH, pad(token, 0.4));
    ctx.fill();
    ctx.stroke();
    ctx.font = `700 ${token.fontCaption}px ${token.fontDisplayFamily}`;
    ctx.fillStyle = '#93c5fd';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('NIGHT', x + chipW * 0.5, y + chipH * 0.5);
    ctx.restore();
    void h;
  }

  private drawTicker(ctx: CanvasRenderingContext2D, _w: number, h: number, token: ThemeTokens): void {
    if (this.ticker.length === 0) return;
    ctx.save();
    ctx.font = `${token.fontCaption}px ${token.fontFamily}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    let y = h - token.safe.bottom - pad(token, 5);
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
    const y = h * 0.72;
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
