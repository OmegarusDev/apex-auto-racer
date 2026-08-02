import { BALANCE } from '../data/balance';
import { OBJECTIVES } from '../data/objectives';
import { FIRST_NAMES, LAST_NAMES } from '../data/names';
import { TRAITS } from '../data/traits';
import type { DisciplineId } from '../data/disciplines';
import type { ObjectiveKind } from '../data/objectives';
import type { TraitId } from '../data/traits';
import type { Rng } from './rng';
import { mulberry32, randInt, pick, shuffleInPlace } from './rng';
import type {
  Driver,
  GameState,
  InProgressTournaments,
  ObjectivesState,
  RankUnlocked,
} from './types';
import {
  SAVE_VERSION,
  DEFAULT_VOLUMES,
  defaultVehicleSave,
} from './types';

const STORAGE_KEY = 'apex-save-v1';

export type SaveWarning = 'storage_unavailable' | 'corrupt_reset';

export interface SaveLoadResult {
  state: GameState | null;
  warning?: SaveWarning;
}

const DISCIPLINES: DisciplineId[] = ['track', 'street', 'rally'];
const PART_KEYS = [
  'engine',
  'intake',
  'exhaust',
  'tyres',
  'brakes',
  'suspension',
  'spoiler',
] as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isDriver(v: unknown): boolean {
  if (!isRecord(v)) return false;
  return (
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    typeof v.trait === 'string' &&
    isFiniteNumber(v.skill) &&
    isFiniteNumber(v.bravery) &&
    isFiniteNumber(v.focus) &&
    isFiniteNumber(v.determination) &&
    isFiniteNumber(v.xp) &&
    isFiniteNumber(v.level) &&
    isFiniteNumber(v.unspentPoints)
  );
}

function isVehicleSave(v: unknown): boolean {
  if (!isRecord(v) || !isRecord(v.partTiers) || !isFiniteNumber(v.condition)) return false;
  for (const key of PART_KEYS) {
    if (!isFiniteNumber(v.partTiers[key])) return false;
  }
  return true;
}

/** Minimal schema check so corrupt/partial JSON cannot crash later scenes. */
function isValidGameState(obj: Record<string, unknown>): boolean {
  if (!isFiniteNumber(obj.version) || !isFiniteNumber(obj.seed) || !isFiniteNumber(obj.cash)) {
    return false;
  }
  if (!isFiniteNumber(obj.lastSaveTimestamp)) return false;
  if (!isRecord(obj.vehicles)) return false;
  for (const d of DISCIPLINES) {
    if (!isVehicleSave(obj.vehicles[d])) return false;
  }
  if (!Array.isArray(obj.roster) || obj.roster.length === 0 || !obj.roster.every(isDriver)) {
    return false;
  }
  if (!isRecord(obj.rankUnlocked)) return false;
  for (const d of DISCIPLINES) {
    if (!isFiniteNumber(obj.rankUnlocked[d])) return false;
  }
  if (!isRecord(obj.inProgressTournaments)) return false;
  for (const d of DISCIPLINES) {
    if (!(d in obj.inProgressTournaments)) return false;
  }
  if (!isRecord(obj.careerStats)) return false;
  if (
    !isFiniteNumber(obj.careerStats.races) ||
    !isFiniteNumber(obj.careerStats.wins) ||
    !isFiniteNumber(obj.careerStats.earnings)
  ) {
    return false;
  }
  if (!isRecord(obj.objectives)) return false;
  if (!Array.isArray(obj.objectives.active) || !Array.isArray(obj.objectives.completed)) {
    return false;
  }
  if (!isFiniteNumber(obj.objectives.cycleSeed)) return false;
  if (!isRecord(obj.onboarding) || !isRecord(obj.options)) return false;
  if (!isRecord(obj.options.volumes)) return false;
  const vols = obj.options.volumes;
  if (
    !isFiniteNumber(vols.master) ||
    !isFiniteNumber(vols.engine) ||
    !isFiniteNumber(vols.fx) ||
    !isFiniteNumber(vols.ui)
  ) {
    return false;
  }
  return true;
}

let nextDriverId = 1;

function makeDriverId(): string {
  const id = `drv-${nextDriverId}`;
  nextDriverId += 1;
  return id;
}

function defaultRankUnlocked(): RankUnlocked {
  return { track: 0, street: 0, rally: 0 };
}

function defaultTournaments(): InProgressTournaments {
  return { track: null, street: null, rally: null };
}

function pickUniqueName(rng: Rng, used: Set<string>): string {
  for (let attempt = 0; attempt < 64; attempt++) {
    const name = `${pick(rng, FIRST_NAMES)} ${pick(rng, LAST_NAMES)}`;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  const fallback = `${pick(rng, FIRST_NAMES)} ${pick(rng, LAST_NAMES)} ${randInt(rng, 2, 99)}`;
  used.add(fallback);
  return fallback;
}

function rollStat(rng: Rng): number {
  return randInt(rng, BALANCE.startingDriverStatMin, BALANCE.startingDriverStatMax);
}

function createDriver(rng: Rng, usedNames: Set<string>): Driver {
  const trait = pick(rng, TRAITS).id as TraitId;
  return {
    id: makeDriverId(),
    name: pickUniqueName(rng, usedNames),
    trait,
    skill: rollStat(rng),
    bravery: rollStat(rng),
    focus: rollStat(rng),
    determination: rollStat(rng),
    xp: 0,
    level: 1,
    unspentPoints: 0,
  };
}

function drawObjectives(rng: Rng, count: number, exclude: ReadonlySet<string> = new Set()): ObjectiveKind[] {
  let pool = OBJECTIVES.map((o) => o.id).filter((id) => !exclude.has(id));
  if (pool.length < count) {
    pool = OBJECTIVES.map((o) => o.id);
  }
  shuffleInPlace(rng, pool);
  return pool.slice(0, count);
}

function defaultObjectives(rng: Rng): ObjectivesState {
  return {
    active: drawObjectives(rng, BALANCE.activeObjectives),
    completed: [],
    cycleSeed: randInt(rng, 1, 0x7fffffff),
  };
}

/** Refill active slots after completions; avoid repeats until the pool cycles. */
export function refillObjectives(state: GameState): void {
  const needed = BALANCE.activeObjectives - state.objectives.active.length;
  if (needed <= 0) return;

  const exclude = new Set<string>([
    ...state.objectives.active,
    ...state.objectives.completed,
  ]);
  const rng = mulberry32((state.objectives.cycleSeed + state.objectives.completed.length * 1337) >>> 0);
  let drawn = drawObjectives(rng, needed, exclude);

  if (drawn.length < needed) {
    state.objectives.completed = [];
    const retryExclude = new Set<string>(state.objectives.active);
    drawn = drawObjectives(
      mulberry32((state.objectives.cycleSeed + 99991) >>> 0),
      needed,
      retryExclude,
    );
  }

  state.objectives.active.push(...drawn);
  state.objectives.cycleSeed = randInt(rng, 1, 0x7fffffff);
}

function createDisciplineVehicles() {
  const tier = BALANCE.startingPartTier;
  return {
    track: defaultVehicleSave(tier),
    street: defaultVehicleSave(tier),
    rally: defaultVehicleSave(tier),
  } as GameState['vehicles'];
}

export function createNewGame(rng: Rng, seed: number): GameState {
  const usedNames = new Set<string>();
  const roster: Driver[] = [];
  for (let i = 0; i < BALANCE.startingRosterSize; i++) {
    roster.push(createDriver(rng, usedNames));
  }

  return {
    version: SAVE_VERSION,
    seed,
    lastSaveTimestamp: Date.now(),
    cash: BALANCE.startingCash,
    vehicles: createDisciplineVehicles(),
    roster,
    rankUnlocked: defaultRankUnlocked(),
    inProgressTournaments: defaultTournaments(),
    careerStats: { races: 0, wins: 0, earnings: 0 },
    objectives: defaultObjectives(rng),
    onboarding: {
      shownPedalControls: false,
      shownBrakeHint: false,
      shownCrashHint: false,
    },
    options: {
      volumes: { ...DEFAULT_VOLUMES },
    },
  };
}

function migrate(raw: unknown): GameState | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const version = typeof obj.version === 'number' ? obj.version : 0;

  if (version > SAVE_VERSION) return null;

  if (version < SAVE_VERSION) {
    obj.version = SAVE_VERSION;
  }

  if (!isValidGameState(obj)) return null;
  return obj as unknown as GameState;
}

export class SaveManager {
  private state: GameState | null = null;
  private storageAvailable = true;
  private warning: SaveWarning | undefined;

  get warningFlag(): SaveWarning | undefined {
    return this.warning;
  }

  /** Read and clear the one-shot load warning (for title toast). */
  consumeWarning(): SaveWarning | undefined {
    const w = this.warning;
    this.warning = undefined;
    return w;
  }

  getState(): GameState | null {
    return this.state;
  }

  setState(state: GameState): void {
    this.state = state;
  }

  hasSave(): boolean {
    if (this.state !== null) return true;
    if (!this.canUseStorage()) return false;
    return localStorage.getItem(STORAGE_KEY) !== null;
  }

  load(): SaveLoadResult {
    if (!this.canUseStorage()) {
      this.warning = 'storage_unavailable';
      return { state: this.state, warning: this.warning };
    }

    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      return { state: null };
    }

    try {
      const parsed = migrate(JSON.parse(raw));
      if (parsed === null) {
        // Corrupt / partial save — wipe and start fresh (caller shows toast).
        localStorage.removeItem(STORAGE_KEY);
        this.warning = 'corrupt_reset';
        const fresh = createNewGame(mulberry32(Date.now() >>> 0), Date.now() >>> 0);
        this.state = fresh;
        this.persist(fresh);
        return { state: fresh, warning: this.warning };
      }
      this.state = parsed;
      this.warning = undefined;
      this.syncDriverIdCounter(parsed);
      return { state: parsed };
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      this.warning = 'corrupt_reset';
      const fresh = createNewGame(mulberry32(Date.now() >>> 0), Date.now() >>> 0);
      this.state = fresh;
      this.persist(fresh);
      return { state: fresh, warning: this.warning };
    }
  }

  autosave(): boolean {
    if (this.state === null) return false;
    this.state.lastSaveTimestamp = Date.now();
    return this.persist(this.state);
  }

  save(state: GameState): boolean {
    this.state = state;
    state.lastSaveTimestamp = Date.now();
    return this.persist(state);
  }

  reset(): void {
    this.state = null;
    if (this.canUseStorage()) {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  createNew(rng?: Rng): GameState {
    const seed = rng !== undefined ? randInt(rng, 1, 0x7fffffff) : Date.now() >>> 0;
    const gameRng = rng ?? mulberry32(seed);
    const state = createNewGame(gameRng, seed);
    this.state = state;
    this.autosave();
    return state;
  }

  private persist(state: GameState): boolean {
    if (!this.canUseStorage()) {
      this.state = state;
      this.warning = 'storage_unavailable';
      return false;
    }

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      this.warning = undefined;
      return true;
    } catch {
      this.storageAvailable = false;
      this.state = state;
      this.warning = 'storage_unavailable';
      return false;
    }
  }

  private canUseStorage(): boolean {
    if (!this.storageAvailable) return false;
    try {
      const probe = '__apex_probe__';
      localStorage.setItem(probe, '1');
      localStorage.removeItem(probe);
      return true;
    } catch {
      this.storageAvailable = false;
      return false;
    }
  }

  private syncDriverIdCounter(state: GameState): void {
    let max = 0;
    for (const d of state.roster) {
      const m = /^drv-(\d+)$/.exec(d.id);
      if (m !== null) {
        max = Math.max(max, Number(m[1]));
      }
    }
    for (const key of ['track', 'street', 'rally'] as DisciplineId[]) {
      const t = state.inProgressTournaments[key];
      if (t === null) continue;
      for (const d of t.opponentDrivers) {
        const m = /^drv-(\d+)$/.exec(d.id);
        if (m !== null) max = Math.max(max, Number(m[1]));
      }
    }
    nextDriverId = max + 1;
  }
}
