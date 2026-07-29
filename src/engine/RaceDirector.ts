import { BALANCE } from '../data/balance';
import { PHYSICS } from '../data/physics';
import { PARTS } from '../data/parts';
import { getDiscipline } from '../data/disciplines';
import type { DisciplineId } from '../data/disciplines';
import type { ArchetypeId } from '../data/archetypes';
import { FORMATS, formatsForRoster } from '../data/formats';
import type { RaceFormat } from '../data/formats';
import {
  createBrainState,
  idleBrainOutput,
  tickDriverBrain,
} from './DriverBrain';
import type { BrainState, BrainTickContext, RivalSnapshot } from './DriverBrain';
import { generateDriver } from './DriverGenerator';
import {
  buildSpeedProfiles,
  buildVDriverProfile,
  estimateLapTime,
  generateTrack,
} from './TrackGenerator';
import type { TrackData } from './TrackGenerator';
import {
  buildVehicleContext,
  computeAuthority,
  createCarState,
  updateVehicle,
} from './Vehicle';
import type { BrainOutput, CarSimState, VehicleInputs } from './Vehicle';
import { effectiveStats } from './stats';
import type { Modifier } from './modifiers';
import { addModifier, createModifierStack } from './modifiers';
import {
  hashState,
  mulberry32,
  pick,
  randInt,
  randRange,
  shuffleInPlace,
  weightedPick,
} from './rng';
import type { Rng } from './rng';
import type {
  Driver,
  GameState,
  RaceEvent,
  RaceEventKind,
  VehicleParts,
  VehicleSave,
} from './types';
import { defaultVehicleSave, emptyVehicleParts } from './types';

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

interface RaceCarEntry {
  car: CarSimState;
  driver: Driver;
  brain: BrainState;
  modifierStack: Modifier[];
  brainOut: BrainOutput;
  prevS: number;
  prevLap: number;
  prevWallHits: number;
  prevSpinCount: number;
  prevDrift: boolean;
  prevPosition: number;
  prevMistakeActive: boolean;
  draft: number;
  contactBlocked: boolean;
  partTiers: VehicleParts;
}

const EVENT_BUFFER_SIZE = 128;
const GRID_ROW_SPACING = 8;
const GRID_COL_OFFSET = 2.5;
const COUNTDOWN_STEP_SEC = 1;
const GO_FLASH_SEC = 0.5;

function clampStat(v: number): number {
  return Math.max(1, Math.min(100, v));
}

function raceDistance(car: CarSimState, trackLength: number): number {
  return car.lap * trackLength + car.s;
}

function arcGap(follower: CarSimState, leader: CarSimState, trackLength: number): number {
  const gap = raceDistance(leader, trackLength) - raceDistance(follower, trackLength);
  return gap - PHYSICS.carLength;
}

function applyLooseCannon(driver: Driver, rng: Rng): Driver {
  if (driver.trait !== 'looseCannon') return driver;
  const jitter = (): number => randRange(rng, -10, 10);
  return {
    ...driver,
    skill: clampStat(driver.skill + jitter()),
    bravery: clampStat(driver.bravery + jitter()),
    focus: clampStat(driver.focus + jitter()),
    determination: clampStat(driver.determination + jitter()),
  };
}

function buildRainStack(rain: boolean): Modifier[] {
  const stack = createModifierStack();
  if (rain) {
    addModifier(stack, {
      source: 'rain',
      targetParam: 'muSurface',
      op: 'mul',
      value: BALANCE.rainMuMult,
    });
    addModifier(stack, {
      source: 'rain',
      targetParam: 'mistakeRate',
      op: 'mul',
      value: BALANCE.rainMistakeMult,
    });
  }
  return stack;
}

function buildTraitStack(driver: Driver): Modifier[] {
  const stack = createModifierStack();
  if (driver.trait === 'slipstreamer') {
    addModifier(stack, {
      source: 'trait:slipstreamer',
      targetParam: 'draft',
      op: 'mul',
      value: 1.5,
    });
  }
  return stack;
}

function mergeModifierStacks(...stacks: readonly Modifier[][]): Modifier[] {
  const out = createModifierStack();
  for (const stack of stacks) {
    for (const mod of stack) out.push(mod);
  }
  return out;
}

function generateOpponentParts(rng: Rng, range: [number, number]): VehicleParts {
  const parts = emptyVehicleParts(0);
  for (const part of PARTS) {
    parts[part.id] = randInt(rng, range[0], range[1]);
  }
  return parts;
}

function computeDraft(
  idx: number,
  entries: readonly RaceCarEntry[],
  trackLength: number,
): number {
  const car = entries[idx]!.car;
  let best = 0;

  for (let j = 0; j < entries.length; j++) {
    if (j === idx) continue;
    const other = entries[j]!.car;
    const gap = arcGap(car, other, trackLength);
    if (gap <= 0 || gap > BALANCE.draftGapMax) continue;
    if (Math.abs(other.l - car.l) > BALANCE.draftLateralMax) continue;
    const raw = 1 - gap / BALANCE.draftGapMax;
    if (raw > best) best = raw;
  }

  return best;
}

function buildRivals(
  idx: number,
  entries: readonly RaceCarEntry[],
  trackLength: number,
): RivalSnapshot[] {
  const car = entries[idx]!.car;
  const rivals: RivalSnapshot[] = [];

  for (let j = 0; j < entries.length; j++) {
    if (j === idx) continue;
    const other = entries[j]!.car;
    rivals.push({
      arcGap: arcGap(car, other, trackLength),
      lateralSep: other.l - car.l,
      speed: other.v,
      s: other.s,
      l: other.l,
    });
  }

  return rivals;
}

function formatEvent(event: RaceEvent): string {
  const name = event.driverName ?? event.carId;
  switch (event.kind) {
    case 'overtake':
      return `${event.time.toFixed(1)}s — ${name} overtakes${event.detail ? ` ${event.detail}` : ''}`;
    case 'mistake':
      return `${event.time.toFixed(1)}s — ${name} makes a mistake`;
    case 'spin':
      return `${event.time.toFixed(1)}s — ${name} spins!`;
    case 'crash':
      return `${event.time.toFixed(1)}s — ${name} crashes into the wall`;
    case 'driftEntry':
      return `${event.time.toFixed(1)}s — ${name} initiates a drift`;
    case 'draftPass':
      return `${event.time.toFixed(1)}s — ${name} passes on the draft`;
    case 'wallHit':
      return `${event.time.toFixed(1)}s — ${name} clips the wall`;
    case 'finish':
      return `${event.time.toFixed(1)}s — ${name} crosses the line`;
    case 'lap':
      return `${event.time.toFixed(1)}s — ${name} completes lap ${event.detail ?? ''}`;
    default:
      return `${event.time.toFixed(1)}s — ${name}: ${event.kind}`;
  }
}

function buildEventsStory(events: readonly RaceEvent[]): string {
  if (events.length === 0) return 'A clean race with no major incidents.';
  return events.map(formatEvent).join('\n');
}

/** Evenly spaced HSL hues for team identification. */
export function teamColor(teamId: number, teamCount: number): string {
  if (teamCount <= 0) return 'hsl(200, 70%, 55%)';
  const hue = Math.round((teamId * 360) / teamCount) % 360;
  return `hsl(${hue}, 70%, 55%)`;
}

export function quickRaceConfig(
  state: GameState,
  discipline: DisciplineId,
  raceSeed: number,
): RaceConfig {
  const rng = mulberry32(raceSeed);
  const eligible = formatsForRoster(state.roster.length);
  const format =
    eligible.length > 0
      ? weightedPick(
          rng,
          eligible.map((f) => ({ ...f, weight: f.weight })),
        )
      : FORMATS[0]!;

  const shuffledRoster = [...state.roster];
  shuffleInPlace(rng, shuffledRoster);
  const playerTeamDrivers = shuffledRoster.slice(0, format.teamSize);
  const leadDriverId = pick(rng, playerTeamDrivers).id;

  const rank = state.rankUnlocked[discipline] ?? 0;
  const statRange = BALANCE.opponentStatRanges[rank] ?? BALANCE.opponentStatRanges[0]!;
  const opponentBudget: [number, number] = [statRange[0] * 4, statRange[1] * 4];
  const opponentPartRange = BALANCE.opponentPartTiers[rank] ?? BALANCE.opponentPartTiers[0]!;

  const trackSeed = randInt(rng, 1, 0x7fffffff);
  const track = generateTrack(trackSeed, discipline);
  const refVehicle = state.vehicles[discipline] ?? defaultVehicleSave(BALANCE.startingPartTier);
  const refStats = effectiveStats(discipline, refVehicle.partTiers, refVehicle.condition);
  const mu = getDiscipline(discipline).muSurface;
  const { vProfile } = buildSpeedProfiles(track, refStats, mu);
  const lapTime = Math.max(estimateLapTime(track, vProfile), 1);
  const targetDuration = randRange(rng, BALANCE.quickRaceDurationMin, BALANCE.quickRaceDurationMax);
  const laps = Math.max(
    BALANCE.minLaps,
    Math.min(BALANCE.maxLaps, Math.round(targetDuration / lapTime)),
  );

  return {
    discipline,
    trackSeed,
    raceSeed,
    laps,
    format,
    playerTeamDrivers,
    leadDriverId,
    playerVehicle: refVehicle,
    opponentBudget,
    opponentPartRange,
  };
}

export class RaceDirector {
  readonly config: RaceConfig;
  readonly track: TrackData;
  readonly rain: boolean;

  private entries: RaceCarEntry[] = [];
  private drivers: Driver[] = [];
  private raceTime = 0;
  private tickIndex = 0;
  private accumulator = 0;
  private inputTime = 0;
  private playerThrottle = 0;
  private playerBrake = 0;
  private paused = false;
  private retired = false;
  private finished = false;
  private finishWindowOpen = false;
  private finishWindowRemaining = 0;
  private countdownRemaining = 3 * COUNTDOWN_STEP_SEC + GO_FLASH_SEC;
  private countdownPhase: CountdownPhase = 3;
  private standings: StandingEntry[] = [];
  private standingsTimer = 0;
  private events: RaceEvent[] = [];
  private eventHead = 0;
  private ghostTrace: GhostTrace = [];
  private rng: Rng;
  private muSurface: number;
  private globalRainStack: Modifier[];
  private resultCache: RaceResult | null = null;

  constructor(config: RaceConfig) {
    this.config = config;
    this.rng = mulberry32(config.raceSeed);
    this.rain = this.rng() < BALANCE.rainChance;
    this.track = generateTrack(config.trackSeed, config.discipline, config.archetypeHint);
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
    return this.entries.map((e) => e.car);
  }

  get allDrivers(): readonly Driver[] {
    return this.drivers;
  }

  get recentEvents(): readonly RaceEvent[] {
    return this.events;
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

  setPlayerPedals(throttle: number, brake: number): void {
    this.playerThrottle = Math.max(0, Math.min(1, throttle));
    this.playerBrake = Math.max(0, Math.min(1, brake));
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
    const { format, playerTeamDrivers, leadDriverId, opponentBudget, opponentPartRange } =
      this.config;
    const usedNames = new Set<string>();
    for (const d of playerTeamDrivers) usedNames.add(d.name);

    const opponentCount = (format.teamCount - 1) * format.teamSize;
    let opponentDrivers: Driver[];

    if (this.config.opponentDrivers !== undefined && this.config.opponentDrivers.length >= opponentCount) {
      opponentDrivers = this.config.opponentDrivers.slice(0, opponentCount);
    } else {
      opponentDrivers = [];
      for (let i = 0; i < opponentCount; i++) {
        opponentDrivers.push(generateDriver(this.rng, opponentBudget[0], opponentBudget[1], usedNames));
      }
    }

    this.drivers = [
      ...playerTeamDrivers.map((d) => applyLooseCannon(d, this.rng)),
      ...opponentDrivers.map((d) => applyLooseCannon(d, this.rng)),
    ];

    const carPlans: {
      driver: Driver;
      teamId: number;
      isPlayer: boolean;
      parts: VehicleParts;
      condition: number;
    }[] = [];

    for (let i = 0; i < playerTeamDrivers.length; i++) {
      carPlans.push({
        driver: this.drivers[i]!,
        teamId: 0,
        isPlayer: playerTeamDrivers[i]!.id === leadDriverId,
        parts: this.config.playerVehicle.partTiers,
        condition: this.config.playerVehicle.condition,
      });
    }

    for (let t = 1; t < format.teamCount; t++) {
      for (let s = 0; s < format.teamSize; s++) {
        const driverIdx = playerTeamDrivers.length + (t - 1) * format.teamSize + s;
        carPlans.push({
          driver: this.drivers[driverIdx]!,
          teamId: t,
          isPlayer: false,
          parts: generateOpponentParts(this.rng, opponentPartRange),
          condition: 1,
        });
      }
    }

    shuffleInPlace(this.rng, carPlans);

    this.entries = carPlans.map((plan, i) => {
      const row = Math.floor(i / 2);
      const col = i % 2;
      const gridL = col === 0 ? -GRID_COL_OFFSET : GRID_COL_OFFSET;
      const gridS = (this.track.length - row * GRID_ROW_SPACING + this.track.length) % this.track.length;

      const stats = effectiveStats(this.config.discipline, plan.parts, plan.condition, plan.driver);
      const { vProfile } = buildSpeedProfiles(this.track, stats, this.muSurface);
      const vDriver = buildVDriverProfile(vProfile, plan.driver.skill, plan.driver.bravery);
      const authority = plan.isPlayer ? computeAuthority(plan.driver.skill) : 1;

      const modifierStack = mergeModifierStacks(
        this.globalRainStack,
        buildTraitStack(plan.driver),
      );

      const car = createCarState(
        `car-${i}`,
        plan.driver.id,
        plan.teamId,
        plan.isPlayer,
        stats,
        vProfile,
        vDriver,
        plan.condition,
        gridS,
        gridL,
        authority,
      );

      return {
        car,
        driver: plan.driver,
        brain: createBrainState(),
        modifierStack,
        brainOut: idleBrainOutput(car, this.track),
        prevS: gridS,
        prevLap: 0,
        prevWallHits: 0,
        prevSpinCount: 0,
        prevDrift: false,
        prevPosition: i + 1,
        prevMistakeActive: false,
        draft: 0,
        contactBlocked: false,
        partTiers: plan.parts,
      };
    });

    this.ghostTrace = this.entries.map((e) => ({ carId: e.car.id, samples: [] }));
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

      entry.draft = computeDraft(i, this.entries, this.track.length);

      if (!entry.car.finished) {
        entry.prevS = entry.car.s;
        entry.prevLap = entry.car.lap;

        const inputs = this.buildInputs(entry);
        if (entry.car.isPlayerControlled && (inputs.throttle > 0 || inputs.brake > 0)) {
          this.inputTime += dt;
        }

        const position = this.standings.find((s) => s.carId === entry.car.id)?.position ?? i + 1;
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
        entry.draft = computeDraft(i, this.entries, this.track.length);
        entry.prevS = entry.car.s;
        const position = this.standings.find((s) => s.carId === entry.car.id)?.position ?? i + 1;
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
        updateVehicle(
          entry.car,
          this.track,
          dt,
          { throttle: entry.brainOut.desiredThrottle, brake: entry.brainOut.desiredBrake },
          entry.brainOut,
          ctx,
        );
      }

      this.detectCarEvents(entry);
    }

    this.resolveContacts(dt);

    if (brainTick) {
      this.recordGhostSamples();
    }

    this.standingsTimer += dt;
    if (this.standingsTimer >= BALANCE.standingsInterval) {
      this.standingsTimer = 0;
      this.refreshStandings(false);
    }

    this.updateFinishWindow(dt);
  }

  private tickBrain(idx: number): BrainOutput {
    const entry = this.entries[idx]!;
    const standing = this.standings.find((s) => s.carId === entry.car.id);
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
      return { throttle: this.playerThrottle, brake: this.playerBrake };
    }
    return { throttle: 0, brake: 0 };
  }

  private handleLapCrossing(entry: RaceCarEntry): void {
    const car = entry.car;
    if (car.lap >= this.config.laps) return;

    const crossed =
      car.v > 0.5 &&
      (car.s < entry.prevS || entry.prevS + car.v * PHYSICS.dt >= this.track.length - 0.01);

    if (!crossed) return;

    car.lap += 1;
    this.pushEvent('lap', car, entry.driver.name, String(car.lap));

    if (car.lap >= this.config.laps && !car.finished) {
      car.finished = true;
      car.finishTime = this.raceTime;
      this.pushEvent('finish', car, entry.driver.name);

      if (!this.finishWindowOpen) {
        this.finishWindowOpen = true;
        this.finishWindowRemaining = BALANCE.finishWindowSec;
      }
    }
  }

  private resolveContacts(dt: number): void {
    const trackLength = this.track.length;
    const n = this.entries.length;

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = this.entries[i]!;
        const b = this.entries[j]!;
        if (a.car.finished && b.car.finished) continue;

        const lateral = Math.abs(a.car.l - b.car.l);
        if (lateral >= BALANCE.contactLateral) continue;

        const gapAB = arcGap(a.car, b.car, trackLength);
        const gapBA = arcGap(b.car, a.car, trackLength);

        let follower: RaceCarEntry | null = null;
        let leader: RaceCarEntry | null = null;

        if (gapAB > 0 && gapAB < BALANCE.contactGap) {
          follower = a;
          leader = b;
        } else if (gapBA > 0 && gapBA < BALANCE.contactGap) {
          follower = b;
          leader = a;
        }

        if (follower === null || leader === null) continue;

        follower.car.v = Math.min(follower.car.v, leader.car.v * BALANCE.contactSpeedCap);
        follower.contactBlocked = true;

        const sign = a.car.l >= b.car.l ? 1 : -1;
        a.car.l += sign * BALANCE.contactNudge * dt;
        b.car.l -= sign * BALANCE.contactNudge * dt;
      }
    }
  }

  private detectCarEvents(entry: RaceCarEntry): void {
    const car = entry.car;
    const name = entry.driver.name;

    if (car.spinCount > entry.prevSpinCount) {
      this.pushEvent('spin', car, name);
    }

    if (car.wallHits > entry.prevWallHits) {
      const kind: RaceEventKind = car.v > PHYSICS.crashSpeed * PHYSICS.crashSpeedMult ? 'crash' : 'wallHit';
      this.pushEvent(kind, car, name);
    }

    if (car.driftState && !entry.prevDrift) {
      this.pushEvent('driftEntry', car, name);
    }

    const mistakeActive =
      entry.brain.mistakeLUntil > this.raceTime && entry.brain.mistakeLShift !== 0;
    if (mistakeActive && !entry.prevMistakeActive) {
      this.pushEvent('mistake', car, name);
    }
    entry.prevMistakeActive = mistakeActive;

    entry.prevSpinCount = car.spinCount;
    entry.prevWallHits = car.wallHits;
    entry.prevDrift = car.driftState;
  }

  private refreshStandings(force: boolean): void {
    const sorted = [...this.entries].sort(
      (a, b) =>
        raceDistance(b.car, this.track.length) - raceDistance(a.car, this.track.length),
    );

    this.standings = sorted.map((entry, idx) => ({
      carId: entry.car.id,
      driverId: entry.driver.id,
      driverName: entry.driver.name,
      teamId: entry.car.teamId,
      position: idx + 1,
      lap: entry.car.lap,
      s: entry.car.s,
      distance: raceDistance(entry.car, this.track.length),
      finished: entry.car.finished,
      finishTime: entry.car.finishTime,
      isPlayerControlled: entry.car.isPlayerControlled,
    }));

    for (const entry of this.entries) {
      const st = this.standings.find((s) => s.carId === entry.car.id);
      if (st === undefined) continue;
      if (entry.prevPosition > st.position && st.position <= 3) {
        this.pushEvent('overtake', entry.car, entry.driver.name, `P${st.position}`);
      }
      if (entry.draft > BALANCE.overtakeDraftThreshold && entry.prevPosition > st.position) {
        this.pushEvent('draftPass', entry.car, entry.driver.name);
      }
      entry.prevPosition = st.position;
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
    const event: RaceEvent = {
      kind,
      time: this.raceTime,
      carId: car.id,
      driverName,
      detail,
    };

    if (this.events.length < EVENT_BUFFER_SIZE) {
      this.events.push(event);
    } else {
      this.events[this.eventHead] = event;
      this.eventHead = (this.eventHead + 1) % EVENT_BUFFER_SIZE;
    }
  }

  private recordGhostSamples(): void {
    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i]!;
      this.ghostTrace[i]!.samples.push({
        time: this.raceTime,
        s: entry.car.s,
        l: entry.car.l,
      });
    }
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
      finishTime: s.finishTime,
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

function samplePedals(trace: readonly PedalTraceSample[] | undefined, time: number): VehicleInputs {
  if (trace === undefined || trace.length === 0) return { throttle: 1, brake: 0 };

  let lo = 0;
  for (let i = 0; i < trace.length; i++) {
    if (trace[i]!.time <= time) lo = i;
  }
  const hi = Math.min(lo + 1, trace.length - 1);
  const a = trace[lo]!;
  const b = trace[hi]!;
  if (lo === hi || b.time <= a.time) return { throttle: a.throttle, brake: a.brake };
  const t = (time - a.time) / (b.time - a.time);
  return {
    throttle: a.throttle + (b.throttle - a.throttle) * t,
    brake: a.brake + (b.brake - a.brake) * t,
  };
}

/** Run a full race without rendering; optional pedal trace for player car. */
export function runHeadless(
  config: RaceConfig,
  pedalTrace?: PedalTraceSample[],
  speedMult = 1,
): RaceResult {
  const director = new RaceDirector(config);
  const maxTime = 600;
  let simTime = 0;

  while (!director.isRaceFinished && simTime < maxTime) {
    const pedals = samplePedals(pedalTrace, director.raceClock);
    director.setPlayerPedals(pedals.throttle, pedals.brake);
    director.update(PHYSICS.dt * Math.max(1, speedMult));
    simTime += PHYSICS.dt;
  }

  if (!director.isRaceFinished) {
    director.retire();
  }

  return director.getResult();
}

function resultFingerprint(result: RaceResult): number {
  const values: number[] = [
    result.rain ? 1 : 0,
    result.inputTime,
    result.trackSeed,
    result.raceSeed,
  ];
  for (const p of result.positions) {
    values.push(p.position, p.finishTime, p.teamId);
  }
  for (const t of result.teamScores) {
    values.push(t.teamId, t.points, t.bestFinish);
  }
  return hashState(values);
}

/** Dev helper: two identical headless runs must produce the same fingerprint. */
export function runDeterminismCheck(): boolean {
  const config: RaceConfig = {
    discipline: 'track',
    trackSeed: 42_001,
    raceSeed: 99_001,
    laps: 2,
    format: FORMATS.find((f) => f.id === '1v1v1v1') ?? FORMATS[0]!,
    playerTeamDrivers: [
      {
        id: 'p1',
        name: 'Test Alpha',
        trait: 'grinder',
        skill: 50,
        bravery: 50,
        focus: 50,
        determination: 50,
        xp: 0,
        level: 1,
        unspentPoints: 0,
      },
    ],
    leadDriverId: 'p1',
    playerVehicle: defaultVehicleSave(2),
    opponentBudget: [120, 180],
    opponentPartRange: [1, 2],
  };

  const trace: PedalTraceSample[] = [
    { time: 0, throttle: 0, brake: 0 },
    { time: 4, throttle: 1, brake: 0 },
    { time: 120, throttle: 0.8, brake: 0 },
  ];

  const a = runHeadless(config, trace, 50);
  const b = runHeadless(config, trace, 50);
  return resultFingerprint(a) === resultFingerprint(b);
}
