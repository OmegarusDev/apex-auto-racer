import { BALANCE } from '../data/balance';
import { PHYSICS } from '../data/physics';
import { getDiscipline } from '../data/disciplines';
import type { DisciplineId } from '../data/disciplines';
import type { ArchetypeId } from '../data/archetypes';
import type { RaceFormat } from '../data/formats';
import { tickDriverBrain } from './DriverBrain';
import type { BrainTickContext } from './DriverBrain';
import { generateTrack } from './TrackGenerator';
import type { TrackData, TrackScaleOpts } from './TrackGenerator';
import { interpolateAtSInto } from './RacingLine';
import { EntertainmentMeter } from './EntertainmentMeter';
import type { EntertainmentSnapshot } from './EntertainmentMeter';
import { buildVehicleContext, updateVehicle } from './Vehicle';
import type { BrainOutput, CarSimState, VehicleInputs } from './Vehicle';
import type { BrainIntent, BrainIntentTag } from './BrainIntent';
import { isStoryIntentTransition } from './BrainIntent';
import type { Modifier } from './modifiers';
import { mulberry32 } from './rng';
import type { Rng } from './rng';
import type {
  Driver,
  RaceEvent,
  RaceEventKind,
  VehicleParts,
  VehicleSave,
} from './types';
import { emptyVehicleParts } from './types';
import { resolveContacts } from './race/contact';
import { computeDraft } from './race/draft';
import { buildEventsStory, pushEventOntoRing } from './race/eventRing';
import { setupRaceField } from './race/fieldSetup';
import { appendGhostSamples } from './race/ghost';
import { buildRainStack } from './race/modifiersSetup';
import { buildRivals } from './race/rivals';
import { rebuildStandings } from './race/standings';
import { arcGap, nodeScratch } from './race/trackMath';
import type { RaceCarEntry } from './race/types';

export type SessionKind = 'race' | 'timeTrial' | 'sprint';

export interface RaceConfig {
  discipline: DisciplineId;
  trackSeed: number;
  raceSeed: number;
  laps: number;
  format: RaceFormat;
  playerTeamDrivers: Driver[];
  leadDriverId: string;
  playerVehicle: VehicleSave;
  opponentBudget: [number, number];
  opponentPartRange: [number, number];
  isTournament?: boolean;
  opponentDrivers?: Driver[];
  archetypeHint?: ArchetypeId;
  /** Quick Race pace-band scale; tournament / feel harnesses omit (1.0). */
  trackScale?: TrackScaleOpts;
  /** Session structure: circuit race (default), single-car time trial, or a
   *  point-to-point sprint that finishes at sprintFinishS (no laps). */
  session?: SessionKind;
  /** Sprint finish line (arc length, m) — only for session === 'sprint'. */
  sprintFinishS?: number;
  /** Sprint finish as a fraction of the generated loop (default 0.5). */
  sprintFinishFrac?: number;
}

export interface PedalTraceSample {
  time: number;
  throttle: number;
  brake: number;
}

export interface GhostSample {
  time: number;
  s: number;
  l: number;
}

export interface GhostCarTrace {
  carId: string;
  samples: GhostSample[];
}

export type GhostTrace = GhostCarTrace[];

export interface StandingEntry {
  carId: string;
  driverId: string;
  driverName: string;
  teamId: number;
  position: number;
  lap: number;
  s: number;
  distance: number;
  finished: boolean;
  finishTime: number;
  /** Marshal/recovery time penalty (s) folded into finishTime. */
  penaltySec: number;
  isPlayerControlled: boolean;
}

export interface TeamScoreEntry {
  teamId: number;
  points: number;
  bestFinish: number;
}

export interface CarFinishEntry {
  carId: string;
  driverId: string;
  driverName: string;
  teamId: number;
  position: number;
  finishTime: number;
  /** Marshal/recovery time penalty (s) folded into finishTime. */
  penaltySec: number;
  finished: boolean;
}

export interface RaceResult {
  positions: CarFinishEntry[];
  teamScores: TeamScoreEntry[];
  eventsStory: string;
  inputTime: number;
  rain: boolean;
  trackSeed: number;
  raceSeed: number;
  ghostTrace: GhostTrace;
  retired: boolean;
}

export type CountdownPhase = 3 | 2 | 1 | 'go' | null;

const INTENT_EVENT_COOLDOWN_SEC = 1.5;

const COUNTDOWN_STEP_SEC = 1;
const GO_FLASH_SEC = 0.5;

export class RaceDirector {
  readonly config: RaceConfig;
  readonly track: TrackData;
  readonly rain: boolean;
  /** Visual-only session mood — does not touch µ / modifiers. */
  readonly night: boolean;
  /** Session structure: circuit race, single-car time trial, or sprint. */
  readonly session: SessionKind;
  /** Sprint finish line arc length (m); 0 for non-sprint sessions. */
  readonly sprintFinishS: number;
  /** Sprint progress 0..1 for the HUD — distance past the START line toward
   *  the finish. A car on the grid (just behind s=0, i.e. s≈L-δ) reads ~0. */
  get sprintProgress(): number {
    if (this.session !== 'sprint') return 0;
    const p = this.carsView.find((c) => c.isPlayerControlled);
    if (p === undefined) return 0;
    const dist = p.s <= this.sprintFinishS ? p.s : p.s - this.track.length;
    return Math.min(1, Math.max(0, dist / Math.max(1, this.sprintFinishS)));
  }

  private entries: RaceCarEntry[] = [];
  private drivers: Driver[] = [];
  private raceTime = 0;
  private tickIndex = 0;
  private accumulator = 0;
  private inputTime = 0;
  private playerThrottle = 0;
  private playerBrake = 0;
  private playerUpshift = false;
  private playerClutchKick = false;
  private paused = false;
  private retired = false;
  private finished = false;
  private finishWindowOpen = false;
  private finishWindowRemaining = 0;
  /**
   * Cars that crossed the line while the checkered flag was out — classified
   * (possibly lapped) by reaching the line, never by a timer cutting them off.
   */
  private flagClassified = new Set<string>();
  private countdownRemaining = 3 * COUNTDOWN_STEP_SEC + GO_FLASH_SEC;
  private countdownPhase: CountdownPhase = 3;
  private standings: StandingEntry[] = [];
  /** carId → index into standings (refreshed with standings). */
  private standingIndexById = new Map<string, number>();
  private standingsTimer = 0;
  private events: RaceEvent[] = [];
  private eventHead = 0;
  private eventSeq = 0;
  private ghostTrace: GhostTrace = [];
  private ghostSampleCounter = 0;
  /** Stable car refs — entries never reshuffle mid-race. */
  private carsView: CarSimState[] = [];
  private rng: Rng;
  private muSurface: number;
  private globalRainStack: Modifier[];
  private resultCache: RaceResult | null = null;
  /** Physics frames where any pair overlapped before solid resolve. */
  private overlapFrames = 0;
  /** Physics frames that still had a residual overlap after resolve. */
  private residualOverlapFrames = 0;
  private readonly entertainment = new EntertainmentMeter();
  private entertainmentEventCursor = 0;

  constructor(config: RaceConfig) {
    this.config = config;
    this.rng = mulberry32(config.raceSeed);
    this.rain = this.rng() < BALANCE.rainChance;
    // Visual-only — hash raceSeed; do NOT consume this.rng (feel/determinism).
    this.night = ((config.raceSeed * 2654435761) >>> 0) % 100 < 32;
    this.track = generateTrack(
      config.trackSeed,
      config.discipline,
      config.archetypeHint,
      config.trackScale,
    );
    // A sprint races a single pass of the (elongated, doubled) loop: finish at
    // sprintFinishS, which the launcher picks as a fraction of the loop.
    this.session = config.session ?? 'race';
    this.sprintFinishS =
      this.session === 'sprint'
        ? this.track.length * (config.sprintFinishFrac ?? 0.5)
        : 0;
    if (this.session === 'sprint') {
      // Tell the renderer where the point-to-point ribbon ends (the loop's
      // return half is never drawn).
      this.track.sprintFinishS = this.sprintFinishS;
    }
    this.globalRainStack = buildRainStack(this.rain);
    this.muSurface = getDiscipline(config.discipline).muSurface;
    if (this.rain) {
      this.muSurface *= BALANCE.rainMuMult;
    }
    this.setupRace();
  }

  get isPaused(): boolean {
    return this.paused;
  }

  get isRetired(): boolean {
    return this.retired;
  }

  get isRaceFinished(): boolean {
    return this.finished;
  }

  /** Car ids that crossed the line after the checkered flag was out. */
  get flagClassifiedIds(): ReadonlySet<string> {
    return this.flagClassified;
  }

  get raceClock(): number {
    return this.raceTime;
  }

  get playerInputTime(): number {
    return this.inputTime;
  }

  get countdown(): CountdownPhase {
    return this.countdownPhase;
  }

  get cars(): readonly CarSimState[] {
    return this.carsView;
  }

  /** Presentation seam — part tiers for CarPainter (not on CarSimState). */
  partTiersFor(carId: string): VehicleParts {
    const entry = this.entries.find((e) => e.car.id === carId);
    return entry?.partTiers ?? emptyVehicleParts(1);
  }

  /**
   * Headless/test harness — stable snapshot so validators need not cast private entries.
   * Full RaceDirector module split deferred; this is the public seam for feel gates.
   */
  debugSnapshot(): {
    raceTime: number;
    cars: {
      id: string;
      s: number;
      l: number;
      v: number;
      slotMode: string;
      tyreTemp: number;
      deslotCount: number;
      wallHits: number;
      stunRemaining: number;
      isPlayerControlled: boolean;
      intentTag?: string;
    }[];
    eventKinds: string[];
    contactStats: { overlapFrames: number; residualOverlapFrames: number; ticks: number };
  } {
    return {
      raceTime: this.raceTime,
      cars: this.entries.map((e) => ({
        id: e.car.id,
        s: e.car.s,
        l: e.car.l,
        v: e.car.v,
        slotMode: e.car.slotMode,
        tyreTemp: e.car.tyreTemp,
        deslotCount: e.car.deslotCount,
        wallHits: e.car.wallHits,
        stunRemaining: e.car.stunRemaining,
        isPlayerControlled: e.car.isPlayerControlled,
        intentTag: e.brainOut.intent?.tag,
      })),
      eventKinds: this.events.map((ev) => ev.kind),
      contactStats: this.contactStats,
    };
  }

  /** Monotonic event counter (increments even after the ring buffer is full). */
  get eventSequence(): number {
    return this.eventSeq;
  }

  /** Headless/debug: frames with pre-resolve body overlap / residual after resolve. */
  get contactStats(): { overlapFrames: number; residualOverlapFrames: number; ticks: number } {
    return {
      overlapFrames: this.overlapFrames,
      residualOverlapFrames: this.residualOverlapFrames,
      ticks: this.tickIndex,
    };
  }

  get allDrivers(): readonly Driver[] {
    return this.drivers;
  }

  get recentEvents(): readonly RaceEvent[] {
    return this.events;
  }

  get entertainmentSnapshot(): EntertainmentSnapshot {
    return this.entertainment.snapshot();
  }

  /** Live brain intent for HUD (player or any car). */
  intentForCar(carId: string): BrainIntent | undefined {
    const entry = this.entries.find((e) => e.car.id === carId);
    return entry?.brainOut.intent;
  }

  get currentStandings(): readonly StandingEntry[] {
    return this.standings;
  }

  get finishWindowSeconds(): number {
    return this.finishWindowRemaining;
  }

  get ghostRecording(): GhostTrace {
    return this.ghostTrace;
  }

  setPlayerPedals(
    throttle: number,
    brake: number,
    upshift = false,
    clutchKick = false,
  ): void {
    this.playerThrottle = Math.max(0, Math.min(1, throttle));
    this.playerBrake = Math.max(0, Math.min(1, brake));
    this.playerUpshift = upshift;
    this.playerClutchKick = clutchKick;
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  retire(): void {
    if (this.finished) return;
    this.retired = true;
    for (const entry of this.entries) {
      if (entry.car.isPlayerControlled) {
        entry.car.finished = true;
        entry.car.finishTime = this.raceTime;
      }
    }
    this.finishWindowOpen = true;
    this.finishWindowRemaining = 0;
    this.tryFinalize();
  }

  update(dt: number): void {
    if (this.finished || this.paused) return;

    if (this.countdownRemaining > 0) {
      this.advanceCountdown(dt);
      return;
    }

    this.accumulator += dt;
    const step = PHYSICS.dt;
    while (this.accumulator >= step) {
      this.physicsStep(step);
      this.accumulator -= step;
    }
  }

  getResult(): RaceResult {
    if (this.resultCache !== null) return this.resultCache;
    this.resultCache = this.buildResult();
    return this.resultCache;
  }

  private setupRace(): void {
    const field = setupRaceField({
      config: this.config,
      track: this.track,
      rng: this.rng,
      globalRainStack: this.globalRainStack,
    });
    this.drivers = field.drivers;
    this.entries = field.entries;
    this.carsView = field.carsView;
    this.ghostTrace = field.ghostTrace;
    this.ghostSampleCounter = 0;
    this.eventSeq = 0;
    this.entertainmentEventCursor = 0;
    this.entertainment.reset();
    this.refreshStandings(true);
  }

  private advanceCountdown(dt: number): void {
    this.countdownRemaining -= dt;
    const elapsed = 3 * COUNTDOWN_STEP_SEC + GO_FLASH_SEC - this.countdownRemaining;

    if (elapsed < COUNTDOWN_STEP_SEC) this.countdownPhase = 3;
    else if (elapsed < 2 * COUNTDOWN_STEP_SEC) this.countdownPhase = 2;
    else if (elapsed < 3 * COUNTDOWN_STEP_SEC) this.countdownPhase = 1;
    else if (this.countdownRemaining > 0) this.countdownPhase = 'go';
    else this.countdownPhase = null;
  }

  private physicsStep(dt: number): void {
    this.raceTime += dt;
    this.tickIndex += 1;
    const brainTick = this.tickIndex % PHYSICS.brainEveryN === 0;
    const totalCars = this.entries.length;

    if (brainTick) {
      this.refreshStandings(false);
    }

    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i]!;

      if (brainTick && !entry.car.finished) {
        entry.brainOut = this.tickBrain(i);
      }
    }

    if (brainTick) {
      for (const entry of this.entries) {
        entry.contactBlocked = false;
      }
    }

    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i]!;
      const standingIdx = this.standingIndexById.get(entry.car.id);
      const position =
        standingIdx !== undefined ? this.standings[standingIdx]!.position : i + 1;

      entry.draft = computeDraft(
        i,
        this.entries,
        this.track.length,
        this.track,
        entry.driver.determination,
        position,
        totalCars,
      );

      if (!entry.car.finished) {
        entry.prevS = entry.car.s;
        entry.prevLap = entry.car.lap;

        const inputs = this.buildInputs(entry);
        if (entry.car.isPlayerControlled && (inputs.throttle > 0 || inputs.brake > 0)) {
          this.inputTime += dt;
        }

        const ctx = buildVehicleContext(
          entry.driver,
          position,
          totalCars,
          entry.car.stats,
          entry.modifierStack,
          this.config.discipline,
          this.muSurface,
          entry.draft,
          this.rain,
          this.raceTime,
        );

        updateVehicle(entry.car, this.track, dt, inputs, entry.brainOut, ctx);
        this.handleLapCrossing(entry);
      } else if (entry.car.finished && entry.car.spinRemaining <= 0 && entry.car.stunRemaining <= 0) {
        entry.brainOut = this.tickBrain(i);
        entry.draft = computeDraft(
          i,
          this.entries,
          this.track.length,
          this.track,
          entry.driver.determination,
          position,
          totalCars,
        );
        entry.prevS = entry.car.s;
        const ctx = buildVehicleContext(
          entry.driver,
          position,
          totalCars,
          entry.car.stats,
          entry.modifierStack,
          this.config.discipline,
          this.muSurface,
          entry.draft,
          this.rain,
          this.raceTime,
        );
        // After the flag, classified cars cruise (cool-down) instead of racing
        // — keeps the pack moving on screen without stacking deslots while the
        // stragglers still on track race to the line for their classification.
        const cruise = this.finishWindowOpen ? 0.3 : 1;
        updateVehicle(
          entry.car,
          this.track,
          dt,
          { throttle: entry.brainOut.desiredThrottle * cruise, brake: 0 },
          entry.brainOut,
          ctx,
        );
      }

      this.detectCarEvents(entry);
    }

    const contactStats = resolveContacts({
      entries: this.entries,
      track: this.track,
      dt,
      raceTime: this.raceTime,
      discipline: this.config.discipline,
    });
    this.overlapFrames += contactStats.overlapFramesDelta;
    this.residualOverlapFrames += contactStats.residualOverlapFramesDelta;

    if (brainTick) {
      this.ghostSampleCounter += 1;
      if (this.ghostSampleCounter % BALANCE.ghostSampleEveryN === 0) {
        this.recordGhostSamples();
      }
    }

    this.standingsTimer += dt;
    if (this.standingsTimer >= BALANCE.standingsInterval) {
      this.standingsTimer = 0;
      this.refreshStandings(false);
    }

    this.tickEntertainment(dt);
    this.updateFinishWindow(dt);
  }

  private tickEntertainment(dt: number): void {
    const player = this.entries.find((e) => e.car.isPlayerControlled);
    const newEvents = this.recentEvents.filter((e) => e.seq > this.entertainmentEventCursor);
    if (newEvents.length > 0) {
      this.entertainmentEventCursor = this.eventSeq;
    }

    let kappaAbs = 0;
    let position = 8;
    let draft = 0;
    let nearbyIntent: BrainIntentTag | null = null;
    let cleanUpshift = false;

    if (player !== undefined) {
      const node = interpolateAtSInto(
        this.track.nodes,
        this.track.length,
        player.car.s,
        nodeScratch,
      );
      kappaAbs = Math.abs(node.kappaLine);
      const stIdx = this.standingIndexById.get(player.car.id);
      position = stIdx !== undefined ? (this.standings[stIdx]?.position ?? 8) : 8;
      draft = player.draft;
      cleanUpshift = player.car.lastShiftKind === 'up';

      // Nearby showboat / pull-out intents from rivals within ~25m arc.
      for (const e of this.entries) {
        if (e.car.isPlayerControlled) continue;
        const tag = e.brainOut.intent?.tag ?? null;
        if (tag !== 'SHOWBOAT_RISK' && tag !== 'PULL_OUT') continue;
        const gap = Math.abs(arcGap(player.car, e.car, this.track.length));
        if (gap < 25) {
          nearbyIntent = tag;
          break;
        }
      }
    }

    this.entertainment.tick({
      dt,
      player: player?.car ?? null,
      kappaAbs,
      position,
      totalCars: this.entries.length,
      draft,
      newEvents,
      nearbyIntent,
      discipline: this.config.discipline,
      cleanUpshift,
    });
  }

  private tickBrain(idx: number): BrainOutput {
    const entry = this.entries[idx]!;
    const standingIdx = this.standingIndexById.get(entry.car.id);
    const standing = standingIdx !== undefined ? this.standings[standingIdx] : undefined;
    const position = standing?.position ?? idx + 1;
    const leader = this.standings[0];
    const leadingMarginSec =
      leader !== undefined && standing !== undefined && leader.carId !== entry.car.id
        ? (standing.distance - leader.distance) / Math.max(leader.finished ? 1 : 30, 1)
        : 0;

    const ctx: BrainTickContext = {
      track: this.track,
      driver: entry.driver,
      discipline: this.config.discipline,
      modifierStack: entry.modifierStack,
      rivals: buildRivals(idx, this.entries, this.track.length),
      draft: entry.draft,
      rain: this.rain,
      muSurface: this.muSurface,
      raceTime: this.raceTime,
      isFinalLap: entry.car.lap >= this.config.laps - 1,
      isLeading: position === 1,
      leadingMarginSec,
      position,
      totalCars: this.entries.length,
      rng: this.rng,
      contactBlocked: entry.contactBlocked,
    };

    return tickDriverBrain(entry.brain, entry.car, ctx);
  }

  private buildInputs(entry: RaceCarEntry): VehicleInputs {
    if (entry.car.isPlayerControlled) {
      const up = this.playerUpshift;
      const kick = this.playerClutchKick;
      this.playerUpshift = false;
      this.playerClutchKick = false;
      return {
        throttle: this.playerThrottle,
        brake: this.playerBrake,
        upshift: up,
        clutchKick: kick,
      };
    }
    return { throttle: 0, brake: 0, upshift: false };
  }

  private handleLapCrossing(entry: RaceCarEntry): void {
    const car = entry.car;
    if (car.finished) return;

    // Sprint: a single pass to the finish line — no laps, no wrap. The car
    // launches from the grid just before s=0 and crosses sprintFinishS once.
    if (this.session === 'sprint') {
      const line = this.sprintFinishS;
      const crossed =
        car.v > 0.5 && entry.prevS <= line - 0.5 && car.s >= line - 0.5;
      if (!crossed) return;
      car.finished = true;
      car.finishTime = this.raceTime;
      car.lap = 1;
      this.pushEvent('finish', car, entry.driver.name, 'sprint');
      if (!this.finishWindowOpen) {
        this.finishWindowOpen = true;
        this.finishWindowRemaining = this.computeFinishWindow();
      }
      return;
    }

    if (car.lap >= this.config.laps) return;

    const line = this.track.length;
    // Edge-triggered: count the line pass exactly once. The prevS guard stops
    // a slow or lingering crossing from firing on consecutive steps — the old
    // level-triggered projection re-fired while a car sat near the line and
    // granted back-row grid cars multiple laps at lights-out.
    const crossed =
      car.v > 0.5 &&
      entry.prevS <= line - 0.5 &&
      (car.s < entry.prevS || car.s >= line - 0.5);

    if (!crossed) return;

    car.lap += 1;
    this.pushEvent('lap', car, entry.driver.name, String(car.lap));

    // Checkered flag out: the next line crossing classifies the car — lapped
    // cars finish a lap (or more) down instead of being cut off mid-lap by a
    // fixed clock, and the flag-out period stays bounded by one lap.
    const flagOut = this.finishWindowOpen;
    if (flagOut && !car.finished) {
      this.flagClassified.add(car.id);
    }
    if (!car.finished && (car.lap >= this.config.laps || flagOut)) {
      car.finished = true;
      car.finishTime = this.raceTime;
      this.pushEvent('finish', car, entry.driver.name, flagOut ? 'flag' : undefined);

      if (!this.finishWindowOpen) {
        this.finishWindowOpen = true;
        this.finishWindowRemaining = this.computeFinishWindow();
      }
    }
  }

  /**
   * Budget the checkered-flag window from the trailing field, not a fixed clock.
   * The old fixed 10 s cut cars off mid-final-lap whenever the pack spread past
   * it — every race finalized with AI marked finished while 2/3 laps in. Now the
   * window is the slowest unfinished car's estimated time to the line, floored
   * at finishWindowSec and capped at finishWindowMax (stranded-car backstop).
   * Normal races end earlier via allDone once everyone crosses.
   */
  private computeFinishWindow(): number {
    const line = this.session === 'sprint' ? this.sprintFinishS : this.track.length;
    let worst = 0;
    for (const entry of this.entries) {
      if (entry.car.finished) continue;
      const toLine =
        this.session === 'sprint' ? line - entry.car.s : (line - entry.car.s) % line;
      const pace = Math.max(entry.car.v, BALANCE.finishWindowMinPace);
      const need = toLine / pace;
      if (need > worst) worst = need;
    }
    return Math.min(
      BALANCE.finishWindowMax,
      Math.max(BALANCE.finishWindowSec, worst * BALANCE.finishWindowMargin),
    );
  }

  private detectCarEvents(entry: RaceCarEntry): void {
    const car = entry.car;
    const name = entry.driver.name;

    if (car.deslotCount > entry.prevDeslotCount) {
      this.pushEvent('deslot', car, name);
    }

    if (
      entry.prevSlotMode === 'deslot' &&
      car.slotMode === 'groove' &&
      car.spinRemaining <= 0
    ) {
      this.pushEvent('rejoin', car, name);
    }

    if (car.spinCount > entry.prevSpinCount) {
      this.pushEvent('spin', car, name);
    }

    if (car.wallHits > entry.prevWallHits) {
      const kind: RaceEventKind = car.v > PHYSICS.crashSpeed * PHYSICS.crashSpeedMult ? 'crash' : 'wallHit';
      this.pushEvent(kind, car, name);
    }

    if (car.lastShiftKind !== null && car.isPlayerControlled) {
      this.pushEvent('shift', car, name, car.lastShiftKind);
    }

    // Hybrid latch entry (Street/Rally) — not the quarantined DRIFT_CFG path.
    if (car.driftState && !entry.prevDrift) {
      this.pushEvent('driftEntry', car, name);
    }

    const mistakeActive =
      entry.brain.mistakeLUntil > this.raceTime && entry.brain.mistakeLShift !== 0;
    if (mistakeActive && !entry.prevMistakeActive) {
      this.pushEvent('mistake', car, name);
    }
    entry.prevMistakeActive = mistakeActive;

    const intentTag = entry.brainOut.intent?.tag ?? null;
    if (
      intentTag !== null &&
      intentTag !== entry.lastIntentTag &&
      isStoryIntentTransition(intentTag, entry.lastIntentTag) &&
      this.raceTime - entry.lastIntentEventAt >= INTENT_EVENT_COOLDOWN_SEC
    ) {
      this.pushEvent('intent', car, name, intentTag);
      entry.lastIntentEventAt = this.raceTime;
    }
    entry.lastIntentTag = intentTag;

    entry.prevDeslotCount = car.deslotCount;
    entry.prevSpinCount = car.spinCount;
    entry.prevWallHits = car.wallHits;
    entry.prevDrift = car.driftState;
    entry.prevSlotMode = car.slotMode;
  }

  private refreshStandings(force: boolean): void {
    const rebuilt = rebuildStandings(this.entries, this.track.length);
    this.standings = rebuilt.standings;
    this.standingIndexById = rebuilt.standingIndexById;
    for (const ev of rebuilt.events) {
      this.pushEvent(ev.kind, ev.car, ev.driverName, ev.detail);
    }
    if (force) {
      this.standingsTimer = 0;
    }
  }

  private updateFinishWindow(dt: number): void {
    if (!this.finishWindowOpen) return;
    this.finishWindowRemaining -= dt;
    if (this.finishWindowRemaining > 0) return;
    this.tryFinalize();
  }

  private tryFinalize(): void {
    if (this.finished) return;

    const allDone = this.entries.every((e) => e.car.finished);
    const windowExpired = this.finishWindowOpen && this.finishWindowRemaining <= 0;

    if (!allDone && !windowExpired && !this.retired) return;

    for (const entry of this.entries) {
      if (!entry.car.finished) {
        entry.car.finished = true;
        entry.car.finishTime = this.raceTime;
      }
    }

    this.refreshStandings(true);
    this.finished = true;
    this.resultCache = this.buildResult();
  }

  private pushEvent(
    kind: RaceEventKind,
    car: CarSimState,
    driverName: string,
    detail?: string,
  ): void {
    const ring = {
      events: this.events,
      eventHead: this.eventHead,
      eventSeq: this.eventSeq,
    };
    pushEventOntoRing(ring, kind, this.raceTime, car, driverName, detail);
    this.eventHead = ring.eventHead;
    this.eventSeq = ring.eventSeq;
  }

  private recordGhostSamples(): void {
    appendGhostSamples(this.entries, this.ghostTrace, this.raceTime);
  }

  private buildResult(): RaceResult {
    const finished = [...this.standings].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.distance - a.distance;
    });

    const positions: CarFinishEntry[] = finished.map((s, idx) => ({
      carId: s.carId,
      driverId: s.driverId,
      driverName: s.driverName,
      teamId: s.teamId,
      position: idx + 1,
      // Marshal recoveries cost real time — fold the penalty into the finish.
      finishTime: s.finishTime + s.penaltySec,
      penaltySec: s.penaltySec,
      finished: s.finished,
    }));

    const teamMap = new Map<number, { points: number; bestFinish: number }>();
    for (const p of positions) {
      const pts = BALANCE.pointsPerPosition[p.position - 1] ?? 0;
      const cur = teamMap.get(p.teamId) ?? { points: 0, bestFinish: 999 };
      cur.points += pts;
      cur.bestFinish = Math.min(cur.bestFinish, p.position);
      teamMap.set(p.teamId, cur);
    }

    const teamScores: TeamScoreEntry[] = [...teamMap.entries()]
      .map(([teamId, data]) => ({ teamId, points: data.points, bestFinish: data.bestFinish }))
      .sort((a, b) => b.points - a.points || a.bestFinish - b.bestFinish);

    return {
      positions,
      teamScores,
      eventsStory: buildEventsStory(this.events),
      inputTime: this.inputTime,
      rain: this.rain,
      trackSeed: this.config.trackSeed,
      raceSeed: this.config.raceSeed,
      ghostTrace: this.ghostTrace,
      retired: this.retired,
    };
  }
}


export { runHeadless, runDeterminismCheck } from './race/headless';
export { quickRaceConfig, teamColor } from './race/quickRaceConfig';
