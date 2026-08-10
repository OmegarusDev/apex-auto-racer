import { BALANCE } from '../data/balance';
import { DRIFT_CFG, PHYSICS } from '../data/physics';
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
import { driverStrength01, generateFieldDrivers, syncDriverIdsFrom } from './DriverGenerator';
import {
  buildSpeedProfiles,
  buildVDriverProfile,
  estimateLapTime,
  generateTrack,
} from './TrackGenerator';
import type { TrackData } from './TrackGenerator';
import {
  buildPersonalRacingLine,
  interpolateAtSInto,
  type InterpolatedNode,
} from './RacingLine';
import { EntertainmentMeter } from './EntertainmentMeter';
import type { EntertainmentSnapshot } from './EntertainmentMeter';
import {
  buildVehicleContext,
  computeBrakeAuthority,
  computeSDet,
  contactDeslot,
  createCarState,
  updateVehicle,
  wallLimitFor,
} from './Vehicle';
import type { BrainOutput, CarSimState, VehicleInputs } from './Vehicle';
import type { BrainIntent, BrainIntentTag } from './BrainIntent';
import { intentTickerPhrase, isStoryIntentTransition } from './BrainIntent';
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
  SlotMode,
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
  prevDeslotCount: number;
  prevDrift: boolean;
  prevPosition: number;
  prevMistakeActive: boolean;
  prevSlotMode: SlotMode | '';
  lastIntentTag: BrainIntentTag | null;
  lastIntentEventAt: number;
  draft: number;
  contactBlocked: boolean;
  partTiers: VehicleParts;
}

const INTENT_EVENT_COOLDOWN_SEC = 1.5;

const EVENT_BUFFER_SIZE = 128;
const GHOST_MAX_SAMPLES_PER_CAR = 1500;
const COUNTDOWN_STEP_SEC = 1;
const GO_FLASH_SEC = 0.5;

/** Scratch node for hot-path track lookups (no per-call alloc). */
const nodeScratch: InterpolatedNode = {
  pos: { x: 0, y: 0 },
  tangent: { x: 1, y: 0 },
  normal: { x: 0, y: 1 },
  width: 0,
  runoffWidth: 0,
  kappa: 0,
  kappaLine: 0,
  o: 0,
  s: 0,
};

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

/** Set arc-length progress from a non-negative race distance (handles lap wrap). */
function setRaceDistance(car: CarSimState, dist: number, trackLength: number): void {
  const d = Math.max(0, dist);
  const lap = Math.floor(d / trackLength);
  car.lap = lap;
  car.s = d - lap * trackLength;
  if (car.s < 0) car.s += trackLength;
}

function displaceAlongTrack(car: CarSimState, delta: number, trackLength: number): void {
  setRaceDistance(car, raceDistance(car, trackLength) + delta, trackLength);
}

function clampLateralToTrack(car: CarSimState, track: TrackData): void {
  const node = interpolateAtSInto(track.nodes, track.length, car.s, nodeScratch);
  const wallLimit = wallLimitFor(node.width, node.runoffWidth);
  if (Math.abs(car.l) > wallLimit) {
    car.l = Math.sign(car.l || 1) * wallLimit;
  }
}

/** True when AABB footprints overlap in track-space (s,l). */
function bodiesOverlap(a: CarSimState, b: CarSimState, trackLength: number): boolean {
  const dS = Math.abs(raceDistance(b, trackLength) - raceDistance(a, trackLength));
  if (dS >= PHYSICS.carLength) return false;
  return Math.abs(b.l - a.l) < PHYSICS.carWidth;
}

function applyLooseCannon(driver: Driver, rng: Rng): Driver {
  if (driver.trait !== 'looseCannon') return driver;
  const jitter = (): number => Math.round(randRange(rng, -10, 10));
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
    // muSurface rain factor is applied once on RaceDirector.muSurface (profiles + vehicle).
    // Do not also mul muSurface here — that squared wet grip and auto-spun early races.
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
      value: 1.65,
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

/**
 * Opponent loadout: strength biases toward the top of the rank band, with
 * per-part jitter so the field is not uniform scrap / uniform rockets.
 */
function generateOpponentParts(
  rng: Rng,
  range: [number, number],
  strength01 = 0.5,
): VehicleParts {
  const parts = emptyVehicleParts(0);
  const [lo, hi] = range;
  const span = hi - lo;
  for (const part of PARTS) {
    if (span <= 0) {
      parts[part.id] = lo;
      continue;
    }
    // Center near strength percentile; ±~40% of band as noise.
    const center = lo + span * (0.15 + 0.7 * strength01);
    const jitter = (rng() - 0.5) * span * 0.85;
    parts[part.id] = Math.max(lo, Math.min(hi, Math.round(center + jitter)));
  }
  return parts;
}

/**
 * Slipstream: tow from a car ahead when aligned on a straight.
 * Fades with lateral offset and corner curvature (Scalextric wake).
 */
function computeDraft(
  idx: number,
  entries: readonly RaceCarEntry[],
  trackLength: number,
  track: TrackData,
  determination: number,
  position: number,
  totalCars: number,
): number {
  const car = entries[idx]!.car;
  const node = interpolateAtSInto(track.nodes, trackLength, car.s, nodeScratch);
  const kappaAbs = Math.abs(node.kappaLine);
  // Corners kill the tow; mild bends still allow a trickle.
  const cornerFade = Math.max(
    0,
    1 - kappaAbs / Math.max(PHYSICS.draftCornerKappa, 1e-3),
  );
  if (cornerFade <= 0.05) return 0;

  let best = 0;
  for (let j = 0; j < entries.length; j++) {
    if (j === idx) continue;
    const other = entries[j]!.car;
    // Ribbon proximity reject before full race-distance gap.
    const ds = Math.abs(other.s - car.s);
    const wrapDs = Math.min(ds, trackLength - ds);
    if (wrapDs > BALANCE.draftGapMax) continue;
    const gap = arcGap(car, other, trackLength);
    if (gap <= 0 || gap > BALANCE.draftGapMax) continue;
    const lat = Math.abs(other.l - car.l);
    if (lat > BALANCE.draftLateralMax) continue;
    const align = 1 - lat / BALANCE.draftLateralMax;
    const gapFactor = 1 - gap / BALANCE.draftGapMax;
    const raw = gapFactor * align * cornerFade;
    if (raw > best) best = raw;
  }

  // Determination harvests the wake harder when chasing (catch-up RPG).
  const chase =
    totalCars > 1 ? (position - 1) / (totalCars - 1) : 0;
  const detMul = 1 + PHYSICS.draftDetBonus * (determination / 100) * chase;
  // Mild sDet echo so mid-pack fighters feel the tow more.
  const sDet = computeSDet(determination, position, totalCars);
  return Math.min(1.15, best * detMul * (0.92 + 0.08 * sDet));
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
      deslotted: other.slotMode === 'deslot' || other.spinRemaining > 0,
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
    case 'deslot':
      return `${event.time.toFixed(1)}s — ${name} deslots!`;
    case 'crash':
      return `${event.time.toFixed(1)}s — ${name} crashes into the wall`;
    case 'driftEntry':
      return `${event.time.toFixed(1)}s — ${name} initiates a drift`;
    case 'draftPass':
      return `${event.time.toFixed(1)}s — ${name} slingshots past`;
    case 'wallHit':
      return `${event.time.toFixed(1)}s — ${name} clips the wall`;
    case 'finish':
      return `${event.time.toFixed(1)}s — ${name} crosses the line`;
    case 'lap':
      return `${event.time.toFixed(1)}s — ${name} completes lap ${event.detail ?? ''}`;
    case 'intent':
      return `${event.time.toFixed(1)}s — ${intentTickerPhrase(name, event.detail as BrainIntentTag)}`;
    case 'rejoin':
      return `${event.time.toFixed(1)}s — ${name} finds the peg`;
    case 'shift':
      return `${event.time.toFixed(1)}s — ${name} ${
        event.detail === 'miss' ? 'misses a shift' : event.detail === 'down' ? 'downshifts' : 'upshifts'
      }`;
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
  const highestRank = Math.max(
    state.rankUnlocked.track,
    state.rankUnlocked.street,
    state.rankUnlocked.rally,
  ) as 0 | 1 | 2 | 3 | 4 | 5;
  const difficultyRank = Math.max(rank, highestRank) as 0 | 1 | 2 | 3 | 4 | 5;
  const statRange = BALANCE.opponentStatRanges[difficultyRank] ?? BALANCE.opponentStatRanges[0]!;
  const opponentBudget: [number, number] = [statRange[0] * 4, statRange[1] * 4];
  const opponentPartRange = BALANCE.opponentPartTiers[difficultyRank] ?? BALANCE.opponentPartTiers[0]!;

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
  /** Visual-only session mood — does not touch µ / modifiers. */
  readonly night: boolean;

  private entries: RaceCarEntry[] = [];
  private drivers: Driver[] = [];
  private raceTime = 0;
  private tickIndex = 0;
  private accumulator = 0;
  private inputTime = 0;
  private playerThrottle = 0;
  private playerBrake = 0;
  private playerUpshift = false;
  private paused = false;
  private retired = false;
  private finished = false;
  private finishWindowOpen = false;
  private finishWindowRemaining = 0;
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
    return this.carsView;
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

  setPlayerPedals(throttle: number, brake: number, upshift = false): void {
    this.playerThrottle = Math.max(0, Math.min(1, throttle));
    this.playerBrake = Math.max(0, Math.min(1, brake));
    this.playerUpshift = upshift;
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
      // Roster ids come from SaveManager; field generation must not reuse them.
      syncDriverIdsFrom(playerTeamDrivers);
      // Stratified weak→strong within the rank band (backmarkers + standouts).
      opponentDrivers = generateFieldDrivers(
        this.rng,
        opponentCount,
        opponentBudget[0],
        opponentBudget[1],
        usedNames,
      );
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
        const oppDriver = this.drivers[driverIdx]!;
        const strength = driverStrength01(oppDriver, opponentBudget[0], opponentBudget[1]);
        carPlans.push({
          driver: oppDriver,
          teamId: t,
          isPlayer: false,
          parts: generateOpponentParts(this.rng, opponentPartRange, strength),
          condition: 1,
        });
      }
    }

    shuffleInPlace(this.rng, carPlans);

    this.entries = carPlans.map((plan, i) => {
      const row = Math.floor(i / 2);
      const col = i % 2;
      const gridL = col === 0 ? -PHYSICS.gridColOffset : PHYSICS.gridColOffset;
      const gridS =
        (this.track.length - row * PHYSICS.gridRowSpacing + this.track.length) % this.track.length;

      const stats = effectiveStats(this.config.discipline, plan.parts, plan.condition, plan.driver);
      const { vProfile, vSafe } = buildSpeedProfiles(this.track, stats, this.muSurface);
      let vDriver = buildVDriverProfile(vProfile, plan.driver.skill, plan.driver.bravery);
      // Slight player pace handicap so equal-looking stats still feel contested.
      if (plan.isPlayer) {
        const pace = BALANCE.playerPaceMult;
        vDriver = vDriver.map((v) => v * pace);
      }
      const authority = plan.isPlayer ? computeBrakeAuthority(plan.driver.skill) : 1;

      const modifierStack = mergeModifierStacks(
        this.globalRainStack,
        buildTraitStack(plan.driver),
      );

      const laneSign = col === 0 ? -1 : 1;
      const lineO = buildPersonalRacingLine(
        this.track.nodes,
        this.track.length,
        plan.driver.skill,
        plan.driver.bravery,
        stats.gripFactor * stats.condGrip,
        laneSign,
        gridS,
        gridL,
      );

      const car = createCarState(
        `car-${i}`,
        plan.driver.id,
        plan.teamId,
        plan.isPlayer,
        stats,
        vProfile,
        vDriver,
        vSafe,
        plan.condition,
        gridS,
        gridL,
        authority,
        lineO,
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
        prevDeslotCount: 0,
        prevDrift: false,
        prevPosition: i + 1,
        prevMistakeActive: false,
        prevSlotMode: car.slotMode,
        lastIntentTag: null,
        lastIntentEventAt: -Infinity,
        draft: 0,
        contactBlocked: false,
        partTiers: plan.parts,
      };
    });

    this.carsView = this.entries.map((e) => e.car);
    this.ghostTrace = this.entries.map((e) => ({ carId: e.car.id, samples: [] }));
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
      this.playerUpshift = false;
      return { throttle: this.playerThrottle, brake: this.playerBrake, upshift: up };
    }
    return { throttle: 0, brake: 0, upshift: false };
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
    /** Exact body AABB in track-space — no soft pad that glues packs. */
    const minS = PHYSICS.carLength;
    const minL = PHYSICS.carWidth;
    const iters = Math.max(1, BALANCE.contactIters);
    /** Same-lane closing only; side-by-side / overtakes must not accordion-match. */
    const proxS = PHYSICS.carLength + BALANCE.followMinGap * 0.7;
    const proxL = PHYSICS.carWidth * 0.42;
    /** Soften stun / drive-kill while the pack is still clearing grid columns. */
    const launchSoft = this.raceTime < PHYSICS.gridHoldSec;
    const launchStunScale = launchSoft ? 0.2 : 1;
    const launchBlockThresh = launchSoft ? 0.85 : 0.5;

    let hadOverlap = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (bodiesOverlap(this.entries[i]!.car, this.entries[j]!.car, trackLength)) {
          hadOverlap = true;
          break;
        }
      }
      if (hadOverlap) break;
    }
    if (hadOverlap) this.overlapFrames += 1;

    for (let iter = 0; iter < iters; iter++) {
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const a = this.entries[i]!;
          const b = this.entries[j]!;

          const dS = raceDistance(b.car, trackLength) - raceDistance(a.car, trackLength);
          const absS = Math.abs(dS);
          // Far along-track: neither soft bumper nor solid AABB can fire.
          if (absS >= proxS) continue;
          const dL = b.car.l - a.car.l;
          const absL = Math.abs(dL);
          if (absL >= minL) continue;

          let leader: RaceCarEntry;
          let follower: RaceCarEntry;
          if (dS > 0) {
            leader = b;
            follower = a;
          } else if (dS < 0) {
            leader = a;
            follower = b;
          } else {
            leader = a;
            follower = b;
          }

          // Soft bumper match — same lane only, never marks blocked (draft glue killer).
          // Skip when already offset for a pass or harvesting a strong tow.
          if (
            absS < proxS &&
            absS >= minS &&
            absL < proxL &&
            follower.draft < BALANCE.overtakeDraftThreshold * 0.85 &&
            !follower.car.isPlayerControlled
          ) {
            const gap = absS - minS;
            const closing = follower.car.v - leader.car.v;
            if (closing > 1.0 && gap < BALANCE.followMinGap * 0.75) {
              const cap =
                gap < BALANCE.followMinGap * 0.25
                  ? BALANCE.contactSpeedCap
                  : Math.min(1, BALANCE.contactSpeedCap + 0.08);
              follower.car.v = Math.min(follower.car.v, leader.car.v * cap);
            }
          }

          if (absS >= minS || absL >= minL) continue;

          const penS = minS - absS;
          const penL = minL - absL;
          // Prefer peel when abreast / already offset so packs can run side-by-side.
          const abreast = absS < PHYSICS.carLength * 0.85;
          const alreadyOffset = absL > PHYSICS.carWidth * 0.18;
          const separateLateral = abreast || alreadyOffset || penL <= penS * 1.15;
          const closing = follower.car.v - leader.car.v;

          if (separateLateral) {
            // Geometric peel + tiny epsilon so float residual cannot re-overlap.
            const push = penL * 0.5 + 1e-3;
            const sign = absL < 1e-6 ? 1 : Math.sign(dL);
            a.car.l -= sign * push;
            b.car.l += sign * push;
            clampLateralToTrack(a.car, this.track);
            clampLateralToTrack(b.car, this.track);
            a.car.lTarget = a.car.l;
            b.car.lTarget = b.car.l;
            a.brainOut.lTarget = a.car.l;
            b.brainOut.lTarget = b.car.l;

            // Lateral impulse from relative long speed + penetration — keep dl alive
            // on mild rubs so side-by-side racing doesn't feel sticky/teleported.
            const sideRel = Math.abs(closing);
            const sideSeverity = Math.max(
              0,
              Math.min(1, sideRel / BALANCE.contactDeslotClosing + penL / 2.2),
            );
            const latImpulse = (0.35 + 1.8 * sideSeverity) * Math.sign(sign);
            if (a.car.slotMode === 'deslot') a.car.dl -= latImpulse * 0.55;
            if (b.car.slotMode === 'deslot') b.car.dl += latImpulse * 0.55;
            // Groove cars: damp only hard slams; mild peel keeps natural lateral rate.
            if (sideSeverity > 0.45) {
              if (a.car.slotMode === 'groove') a.car.dl *= 0.35;
              if (b.car.slotMode === 'groove') b.car.dl *= 0.35;
            }

            if (sideSeverity > 0.25) {
              // Partial momentum share — not a full stop for both.
              const avgV = 0.5 * (a.car.v + b.car.v);
              const scrub = 1 - 0.1 * sideSeverity * (launchSoft ? 0.35 : 1);
              a.car.v = (a.car.v * 0.55 + avgV * 0.45) * scrub;
              b.car.v = (b.car.v * 0.55 + avgV * 0.45) * scrub;
              a.car.stunRemaining = Math.max(
                a.car.stunRemaining,
                0.1 * sideSeverity * launchStunScale,
              );
              b.car.stunRemaining = Math.max(
                b.car.stunRemaining,
                0.1 * sideSeverity * launchStunScale,
              );
              // Only hard side hits block AI drive — clean side-by-side must race.
              if (sideSeverity > launchBlockThresh) {
                a.contactBlocked = true;
                b.contactBlocked = true;
              }
              if (
                !launchSoft &&
                sideSeverity > 0.55 &&
                sideRel > BALANCE.contactCrashClosing * 0.6
              ) {
                const victim = a.car.v <= b.car.v ? a : b;
                const pushDir = victim === a ? -sign : sign;
                contactDeslot(
                  victim.car,
                  pushDir * (1.2 + sideSeverity),
                  sideSeverity,
                  this.config.discipline,
                );
                if (victim.car.isPlayerControlled) {
                  victim.car.condition = Math.max(
                    BALANCE.conditionMin,
                    victim.car.condition - BALANCE.contactCrashConditionLoss * sideSeverity,
                  );
                }
              }
            }
            // Mild peel: geometry only — keep both cars driving side-by-side.
          } else {
            // Rear-end: separate along track, then inelastic-ish momentum transfer.
            const pushBack = penS * 0.85;
            const pushFwd = penS * 0.15;
            displaceAlongTrack(follower.car, -pushBack, trackLength);
            displaceAlongTrack(leader.car, pushFwd, trackLength);

            if (closing > 0) {
              const severity = Math.max(
                0,
                Math.min(1, (closing - 0.5) / BALANCE.contactCrashClosing),
              );
              // Follower dumps closing speed; leader gets a fraction (inelastic bump).
              const transfer = closing * (BALANCE.contactBounce + 0.4 * severity);
              const followerDrop = closing * (0.5 + 0.4 * severity) * (launchSoft ? 0.45 : 1);
              follower.car.v = Math.max(0, follower.car.v - followerDrop);
              leader.car.v += transfer * (launchSoft ? 0.5 : 1);
              // Cap residual tunnel — soft follow only after the bump.
              follower.car.v = Math.min(
                follower.car.v,
                Math.max(0, leader.car.v * (BALANCE.contactSpeedCap + 0.04 * (1 - severity))),
              );

              if (severity > 0.28) {
                follower.car.stunRemaining = Math.max(
                  follower.car.stunRemaining,
                  (0.18 + 0.4 * severity) * launchStunScale,
                );
                leader.car.stunRemaining = Math.max(
                  leader.car.stunRemaining,
                  (0.08 + 0.18 * severity) * launchStunScale,
                );
                const node = interpolateAtSInto(
                  this.track.nodes,
                  trackLength,
                  follower.car.s,
                  nodeScratch,
                );
                const curved =
                  Math.abs(node.kappaLine) >= PHYSICS.grooveKappaMin * 0.7;
                // Hard rear-end can scrub/deslot — bends easier, straights need more.
                if (!launchSoft && severity > (curved ? 0.5 : 0.72)) {
                  contactDeslot(
                    follower.car,
                    Math.sign(follower.car.l || 1) * (0.7 + 0.6 * severity),
                    severity,
                    this.config.discipline,
                  );
                }
                if (
                  follower.car.isPlayerControlled &&
                  severity >= BALANCE.contactConditionSeverityMin
                ) {
                  follower.car.condition = Math.max(
                    BALANCE.conditionMin,
                    follower.car.condition - BALANCE.contactCrashConditionLoss * severity,
                  );
                  follower.car.contactHits += 1;
                }
              }
              // Only mark blocked when actually stacked (not a draft kiss / launch rub).
              if (!launchSoft && (severity > 0.15 || penS > PHYSICS.carLength * 0.12)) {
                follower.contactBlocked = true;
              }
            } else {
              follower.car.v = Math.min(follower.car.v, leader.car.v * BALANCE.contactSpeedCap);
              if (!launchSoft && penS > PHYSICS.carLength * 0.08) follower.contactBlocked = true;
            }
          }

          // Residual lateral nudge while still overlapping in L after peel/stack.
          if (Math.abs(b.car.l - a.car.l) < minL) {
            const sign = a.car.l >= b.car.l ? 1 : -1;
            const nudge = BALANCE.contactNudge * dt;
            a.car.l += sign * nudge;
            b.car.l -= sign * nudge;
            clampLateralToTrack(a.car, this.track);
            clampLateralToTrack(b.car, this.track);
            a.car.lTarget = a.car.l;
            b.car.lTarget = b.car.l;
            a.brainOut.lTarget = a.car.l;
            b.brainOut.lTarget = b.car.l;
          }
        }
      }
    }

    let residual = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (bodiesOverlap(this.entries[i]!.car, this.entries[j]!.car, trackLength)) {
          residual = true;
          break;
        }
      }
      if (residual) break;
    }
    if (residual) this.residualOverlapFrames += 1;
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

    // Quarantined with DRIFT_CFG — no driftEntry while latch is dormant.
    const driftEnabled =
      (DRIFT_CFG[this.config.discipline]?.enabled ?? DRIFT_CFG.track?.enabled) === true;
    if (driftEnabled && car.driftState && !entry.prevDrift) {
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
    // Finishers rank by finishTime; everyone else by race distance.
    // (Finished cars still roll — distance sort alone inverted true results.)
    const sorted = [...this.entries].sort((a, b) => {
      if (a.car.finished && b.car.finished) {
        return a.car.finishTime - b.car.finishTime;
      }
      if (a.car.finished !== b.car.finished) {
        return a.car.finished ? -1 : 1;
      }
      return (
        raceDistance(b.car, this.track.length) - raceDistance(a.car, this.track.length)
      );
    });

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

    this.standingIndexById.clear();
    for (let i = 0; i < this.standings.length; i++) {
      this.standingIndexById.set(this.standings[i]!.carId, i);
    }

    for (const entry of this.entries) {
      const idx = this.standingIndexById.get(entry.car.id);
      if (idx === undefined) continue;
      const st = this.standings[idx]!;
      if (entry.prevPosition > st.position) {
        this.pushEvent('overtake', entry.car, entry.driver.name, `P${st.position}`);
        entry.car.overtakeCount += 1;
      }
      // Draft often drops as the car pulls out — credit a tow pass if wake was
      // held recently or still partially aligned at the moment of the pass.
      if (
        entry.prevPosition > st.position &&
        (entry.draft > BALANCE.overtakeDraftThreshold * 0.45 ||
          entry.brain.draftHoldTime >= BALANCE.overtakeHoldSec * 0.4)
      ) {
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
    this.eventSeq += 1;
    const event: RaceEvent = {
      kind,
      time: this.raceTime,
      carId: car.id,
      driverName,
      detail,
      seq: this.eventSeq,
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
      // Player always; rivals only while under the hard sample cap.
      if (!entry.car.isPlayerControlled) {
        const rivalSamples = this.ghostTrace[i]!.samples.length;
        if (rivalSamples >= GHOST_MAX_SAMPLES_PER_CAR) continue;
      }
      const samples = this.ghostTrace[i]!.samples;
      if (samples.length >= GHOST_MAX_SAMPLES_PER_CAR) continue;
      samples.push({
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
