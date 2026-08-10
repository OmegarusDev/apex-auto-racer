import { BALANCE } from '../data/balance';
import { DISCIPLINES, getDiscipline } from '../data/disciplines';
import { getTrait } from '../data/traits';
import { PARTS, partCost } from '../data/parts';
import { generateDriver } from '../engine/DriverGenerator';
import { getGameContext } from '../engine/GameContext';
import { effectiveStats } from '../engine/stats';
import { FORMATS, formatsForRoster } from '../data/formats';
import { OBJECTIVES } from '../data/objectives';
import type { ObjectiveKind } from '../data/objectives';
import { mulberry32, pick, randInt, shuffleInPlace, weightedPick } from '../engine/rng';
import type { DisciplineId } from '../data/disciplines';
import type { PartCategory } from '../data/parts';
import type { Driver, GameState, VehicleSave } from '../engine/types';
import type { RaceLaunchConfig } from '../engine/raceTypes';
import { RaceScene } from './RaceScene';
import { generateTrack } from '../engine/TrackGenerator';
import type { TrackData } from '../engine/TrackGenerator';
import {
  createTheme,
  invalidateSafeArea,
  accentForDiscipline,
  type ThemeTokens,
} from '../ui/theme';
import type { UiContext } from '../ui/components';
import {
  pad,
  ToastManager,
  hitRect,
  ensureMinTouch,
} from '../ui/components';
import { drawSlotCarMesh } from '../graphics/CarMesh';
import { BRAND_DISPLAY_FONT, BRAND_SIGNAL, drawBrandAtmosphere } from '../ui/brand';

export const DISCIPLINE_ORDER: DisciplineId[] = ['track', 'street', 'rally'];

export function xpToNextLevel(level: number): number {
  return Math.round(BALANCE.levelCostBase * Math.pow(BALANCE.levelCostGrowth, level - 1));
}

export function grantXp(driver: Driver, amount: number): boolean {
  driver.xp += amount;
  const needed = xpToNextLevel(driver.level);
  if (driver.xp >= needed) {
    driver.xp -= needed;
    driver.level += 1;
    driver.unspentPoints += 1;
    return true;
  }
  return false;
}

export function spendStatPoint(driver: Driver, stat: keyof Pick<Driver, 'skill' | 'bravery' | 'focus' | 'determination'>): boolean {
  if (driver.unspentPoints <= 0) return false;
  driver.unspentPoints -= 1;
  driver[stat] = Math.min(100, driver[stat] + BALANCE.skillPointStatGain);
  return true;
}

export function repairVehicle(state: GameState, discipline: DisciplineId): boolean {
  const vehicle = state.vehicles[discipline];
  const pts = Math.max(0, Math.ceil((BALANCE.conditionMax - vehicle.condition) * 100));
  if (pts <= 0) return false;
  const cost = pts * BALANCE.repairCostPerPoint;
  if (state.cash < cost) return false;
  state.cash -= cost;
  vehicle.condition = BALANCE.conditionMax;
  getGameContext().autosave();
  return true;
}

export function buyPartTier(state: GameState, discipline: DisciplineId, part: PartCategory): boolean {
  const vehicle = state.vehicles[discipline];
  const tier = vehicle.partTiers[part] ?? 0;
  if (tier >= BALANCE.maxPartTier) return false;
  const cost = partCost(PARTS.find((p) => p.id === part)!.baseCost, tier + 1);
  if (state.cash < cost) return false;
  state.cash -= cost;
  vehicle.partTiers[part] = tier + 1;
  getGameContext().autosave();
  return true;
}

export function vehicleRadarValues(discipline: DisciplineId, vehicle: VehicleSave) {
  const stats = effectiveStats(discipline, vehicle.partTiers, vehicle.condition);
  return {
    topSpeed: stats.topSpeed,
    acceleration: stats.acceleration,
    braking: stats.braking,
    grip: stats.grip,
    downforce: stats.downforce,
  };
}

export function driverSpendData(driver: Driver) {
  const trait = getTrait(driver.trait);
  return {
    name: driver.name,
    trait: trait.name,
    skill: driver.skill,
    bravery: driver.bravery,
    focus: driver.focus,
    determination: driver.determination,
    unspentPoints: driver.unspentPoints,
    level: driver.level,
    xp: driver.xp,
    xpToNext: xpToNextLevel(driver.level),
  };
}

export function findDriver(state: GameState, id: string): Driver | undefined {
  return state.roster.find((d) => d.id === id);
}

export function defaultLineup(state: GameState, count: number): string[] {
  return state.roster.slice(0, count).map((d) => d.id);
}

export function defaultLeadDriver(state: GameState, lineup: string[]): string {
  return lineup[0] ?? state.roster[0]?.id ?? '';
}

export function makeQuickRaceConfig(
  state: GameState,
  discipline: DisciplineId,
  returnTo: 'title' | 'campaign' = 'title',
): RaceLaunchConfig {
  state.quickRaceNonce = ((state.quickRaceNonce >>> 0) + 1) >>> 0;
  try {
    getGameContext().autosave();
  } catch {
    // Context may be absent in headless harnesses.
  }
  const seedMaterial =
    (state.seed +
      state.careerStats.races * 9973 +
      state.careerStats.earnings +
      discipline.charCodeAt(0) * 131 +
      state.quickRaceNonce * 7919) >>>
    0;
  const rng = mulberry32(seedMaterial);
  const raceSeed = randInt(rng, 1, 0x7fffffff);
  const trackSeed = randInt(rng, 1, 0x7fffffff);
  const eligible = formatsForRoster(state.roster.length);
  const format =
    eligible.length > 0
      ? weightedPick(
          rng,
          eligible.map((f) => ({ ...f, weight: f.weight })),
        )
      : FORMATS[0]!;
  const shuffled = [...state.roster];
  shuffleInPlace(rng, shuffled);
  const team = shuffled.slice(0, Math.min(format.teamSize, shuffled.length));
  const playerLineup = team.map((d) => d.id);
  const leadDriverId = playerLineup.length > 0 ? pick(rng, playerLineup) : '';
  const laps = randInt(rng, BALANCE.minLaps, Math.min(BALANCE.maxLaps, 5));
  return {
    discipline,
    trackSeed,
    raceSeed,
    laps,
    formatId: format.id,
    playerLineup,
    leadDriverId,
    mode: 'quick',
    returnTo,
  };
}

export function generateFreeAgents(state: GameState, rerollOffset = 0): Driver[] {
  const rank = Math.max(state.rankUnlocked.track, state.rankUnlocked.street, state.rankUnlocked.rally);
  const baseMin = BALANCE.freeAgentStatBase[0] + rank * BALANCE.freeAgentStatPerRank;
  const baseMax = Math.min(BALANCE.freeAgentStatCap, BALANCE.freeAgentStatBase[1] + rank * BALANCE.freeAgentStatPerRank);
  const rng = mulberry32((state.seed + rerollOffset * 7919) >>> 0);
  const used = new Set(state.roster.map((d) => d.name));
  const agents: Driver[] = [];
  for (let i = 0; i < BALANCE.freeAgentPoolSize; i++) {
    agents.push(generateDriver(rng, baseMin * 4, baseMax * 4, used));
  }
  return agents;
}

export function buildUi(
  w: number,
  h: number,
  dt: number,
  accent: string,
): { ui: UiContext; token: ThemeTokens } {
  const g = getGameContext();
  const token = createTheme(w, h);
  const click = g.input.consumeClick();
  return {
    token,
    ui: {
      pointerX: g.input.pointerX,
      pointerY: g.input.pointerY,
      pointerDown: g.input.peekClick() !== null || g.input.getActivePointers().length > 0,
      pointerClicked: click !== null,
      dt,
      w,
      h,
      token,
      accent,
    },
  };
}

export function onSceneEnter(): void {
  const g = getGameContext();
  g.input.setMode('menu');
  invalidateSafeArea();
}

export function onSceneResize(_w: number, _h: number): void {
  invalidateSafeArea();
}

let raceLaunchInFlight = false;

function formatLaunchError(err: unknown): string {
  if (err instanceof Error) {
    const msg = err.message.trim();
    return msg.length > 0 ? msg : err.name;
  }
  return String(err);
}

/** Open RaceScene synchronously. Replaces Results (raceLaunchReplace) so again/next don't stack. */
export function launchRace(config: RaceLaunchConfig, toasts: ToastManager): void {
  if (raceLaunchInFlight) return;
  raceLaunchInFlight = true;
  const accent = accentForDiscipline(config.discipline);
  try {
    if (config.playerLineup.length === 0) {
      toasts.push('Need a driver on the roster', accent);
      return;
    }
    if (typeof RaceScene !== 'function') {
      throw new Error('RaceScene failed to load (circular import)');
    }
    const g = getGameContext();
    const race = new RaceScene(g, config);
    if (g.scenes.current?.raceLaunchReplace) {
      g.scenes.replace(race);
    } else {
      g.scenes.push(race);
    }
  } catch (err) {
    console.error('[apex] launchRace failed', err);
    toasts.push(`Could not start race: ${formatLaunchError(err)}`, accent, 5);
  } finally {
    raceLaunchInFlight = false;
  }
}

export function drawBackground(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  token: ThemeTokens,
  accent?: string,
): void {
  drawBrandAtmosphere(ctx, w, h, token, accent);
}

const ACCENT_RIBBON = BRAND_SIGNAL;
const TITLE_FONT = BRAND_DISPLAY_FONT;

export interface PlanarPoint {
  x: number;
  y: number;
}

export interface TitlePreviewTrack {
  planar: PlanarPoint[];
  halfWidth: number;
}

/** Fallback oval if generation ever returns an empty node list. */
function sampleFallbackCircuit(segments: number): PlanarPoint[] {
  const pts: PlanarPoint[] = [];
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    const r = 1.0 + 0.22 * Math.cos(2 * t) + 0.08 * Math.sin(3 * t);
    pts.push({
      x: Math.cos(t) * r,
      y: Math.sin(t) * r * 0.62,
    });
  }
  return pts;
}

function sampleTrackAtS(track: TrackData, sQuery: number): PlanarPoint {
  const nodes = track.nodes;
  const n = nodes.length;
  const length = track.length;
  const s = ((sQuery % length) + length) % length;
  let i = 0;
  while (i < n - 1 && nodes[i + 1]!.s <= s) i++;
  const a = nodes[i]!;
  const b = nodes[(i + 1) % n]!;
  // Closing segment runs from last.s up to track.length.
  const span = i === n - 1 ? Math.max(1e-6, length - a.s) : Math.max(1e-6, b.s - a.s);
  const local = Math.max(0, Math.min(1, (s - a.s) / span));
  return {
    x: a.pos.x + (b.pos.x - a.pos.x) * local,
    y: a.pos.y + (b.pos.y - a.pos.y) * local,
  };
}

/** Normalize a generated TrackData centerline into a closed unit planar polyline. */
export function planarCircuitFromTrack(track: TrackData, segments: number): TitlePreviewTrack {
  if (track.nodes.length < 3 || track.length <= 0) {
    return { planar: sampleFallbackCircuit(segments), halfWidth: 0.085 };
  }

  const { bounds } = track;
  const cx = (bounds.minX + bounds.maxX) * 0.5;
  const cy = (bounds.minY + bounds.maxY) * 0.5;
  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 1);
  const inv = 2 / span;

  let widthSum = 0;
  for (const node of track.nodes) widthSum += node.width;
  const avgHalf = (widthSum / track.nodes.length) * 0.5 * inv;

  const planar: PlanarPoint[] = [];
  for (let i = 0; i < segments; i++) {
    const p = sampleTrackAtS(track, (i / segments) * track.length);
    planar.push({
      x: (p.x - cx) * inv,
      y: (p.y - cy) * inv,
    });
  }

  return {
    planar,
    halfWidth: Math.max(0.04, Math.min(0.14, avgHalf)),
  };
}

/** Title-only non-deterministic seed — never used for race simulation. */
export function freshTitlePreviewSeed(): number {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    const v = buf[0]!;
    if (v !== 0) return v >>> 0;
  }
  return (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
}

/** Build a fresh title demo circuit from the real track generator. */
export function createTitlePreviewTrack(
  seed: number,
  discipline: DisciplineId,
  segments = 96,
): TitlePreviewTrack {
  const track = generateTrack(seed, discipline);
  return planarCircuitFromTrack(track, segments);
}

export interface RibbonTrackLayout {
  cx?: number;
  cy?: number;
  /** World-to-screen scale before perspective foreshortening. */
  scale?: number;
  /** Closed planar circuit in unit space (XZ when posed). */
  planar?: readonly PlanarPoint[];
  /** Track half-width in planar units. */
  halfWidth?: number;
}

type RibbonProj = { sx: number; sy: number; z: number; visible: boolean };

const ribbonLeft: RibbonProj[] = [];
const ribbonRight: RibbonProj[] = [];
const ribbonCenter: RibbonProj[] = [];
let ribbonOrder: number[] = [];
let ribbonOrderRotY = Number.NaN;
let ribbonOrderRotX = Number.NaN;
let ribbonOrderSegs = -1;

function ensureRibbonProj(slot: RibbonProj[], i: number): RibbonProj {
  let p = slot[i];
  if (p === undefined) {
    p = { sx: 0, sy: 0, z: 0, visible: true };
    slot[i] = p;
  }
  return p;
}

/**
 * Draw a flat 2D track path rigidly rotated in 3D, then perspective-projected.
 * Circuit lies in the horizontal XZ plane (table-top); only orientation changes with time.
 */
export function drawRibbonTrack(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  time: number,
  token: ThemeTokens,
  layout: RibbonTrackLayout = {},
): void {
  const cx = layout.cx ?? w * 0.5;
  const cy = layout.cy ?? h * 0.38;
  const scale = layout.scale ?? Math.min(w, h) * 0.34;
  const planar =
    layout.planar && layout.planar.length >= 3
      ? layout.planar
      : sampleFallbackCircuit(96);
  const segments = planar.length;
  const halfWidth = layout.halfWidth ?? 0.085;
  const cameraDist = 3.4;
  const focal = 2.6;

  // Turntable spin about vertical Y; pitch ~55° from edge-on → mostly top-down table, not a upright wheel.
  const rotY = time * 0.32;
  const rotX = 0.95 + Math.sin(time * 0.25) * 0.06;

  const cosY = Math.cos(rotY);
  const sinY = Math.sin(rotY);
  const cosX = Math.cos(rotX);
  const sinX = Math.sin(rotX);

  const projectInto = (px: number, pz: number, out: RibbonProj): void => {
    // Horizontal asphalt plane (px, 0, pz), then Y-spin + X-pitch.
    const x1 = px * cosY - pz * sinY;
    const z1 = px * sinY + pz * cosY;
    const y2 = -z1 * sinX;
    const z2 = z1 * cosX;
    const depth = cameraDist + z2;
    if (depth < 0.35) {
      out.sx = cx;
      out.sy = cy;
      out.z = z2;
      out.visible = false;
      return;
    }
    const k = (focal * scale) / depth;
    out.sx = cx + x1 * k;
    out.sy = cy + y2 * k;
    out.z = z2;
    out.visible = true;
  };

  // Edge ribbons from planar normals (preserves flat-track silhouette under projection).
  for (let i = 0; i < segments; i++) {
    const p = planar[i]!;
    const prev = planar[(i - 1 + segments) % segments]!;
    const next = planar[(i + 1) % segments]!;
    const tx = next.x - prev.x;
    const ty = next.y - prev.y;
    const len = Math.hypot(tx, ty) || 1;
    const nx = -ty / len;
    const ny = tx / len;
    projectInto(p.x + nx * halfWidth, p.y + ny * halfWidth, ensureRibbonProj(ribbonLeft, i));
    projectInto(p.x - nx * halfWidth, p.y - ny * halfWidth, ensureRibbonProj(ribbonRight, i));
    projectInto(p.x, p.y, ensureRibbonProj(ribbonCenter, i));
  }

  // Painter's algorithm: only re-sort when orientation moves enough.
  const needSort =
    ribbonOrderSegs !== segments ||
    !Number.isFinite(ribbonOrderRotY) ||
    Math.abs(rotY - ribbonOrderRotY) > 0.04 ||
    Math.abs(rotX - ribbonOrderRotX) > 0.04;
  if (needSort) {
    if (ribbonOrder.length !== segments) {
      ribbonOrder = Array.from({ length: segments }, (_, i) => i);
    }
    ribbonOrder.sort((a, b) => {
      const za = (ribbonCenter[a]!.z + ribbonCenter[(a + 1) % segments]!.z) * 0.5;
      const zb = (ribbonCenter[b]!.z + ribbonCenter[(b + 1) % segments]!.z) * 0.5;
      return za - zb;
    });
    ribbonOrderRotY = rotY;
    ribbonOrderRotX = rotX;
    ribbonOrderSegs = segments;
  }
  const order = ribbonOrder;
  const left = ribbonLeft;
  const right = ribbonRight;
  const center = ribbonCenter;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const i of order) {
    const j = (i + 1) % segments;
    const l0 = left[i]!;
    const l1 = left[j]!;
    const r0 = right[i]!;
    const r1 = right[j]!;
    if (!l0.visible || !l1.visible || !r0.visible || !r1.visible) continue;

    const depthFade = 0.55 + 0.45 * ((center[i]!.z + 1.2) / 2.4);
    const a = Math.max(0.25, Math.min(1, depthFade));

    ctx.beginPath();
    ctx.moveTo(l0.sx, l0.sy);
    ctx.lineTo(l1.sx, l1.sy);
    ctx.lineTo(r1.sx, r1.sy);
    ctx.lineTo(r0.sx, r0.sy);
    ctx.closePath();
    ctx.fillStyle = `rgba(18,22,20,${0.82 * a})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(46,54,48,${0.95 * a})`;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Center dashed racing line
    const c0 = center[i]!;
    const c1 = center[j]!;
    ctx.beginPath();
    ctx.moveTo(c0.sx, c0.sy);
    ctx.lineTo(c1.sx, c1.sy);
    ctx.strokeStyle = `rgba(240,196,26,${0.28 * a})`;
    ctx.lineWidth = Math.max(1, pad(token, 0.15));
    ctx.setLineDash([pad(token, 0.9), pad(token, 0.7)]);
    ctx.lineDashOffset = -time * 28;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Outer edge highlight (full loop, front-biased alpha via z)
  ctx.beginPath();
  let started = false;
  for (let i = 0; i <= segments; i++) {
    const p = left[i % segments]!;
    if (!p.visible) {
      started = false;
      continue;
    }
    if (!started) {
      ctx.moveTo(p.sx, p.sy);
      started = true;
    } else {
      ctx.lineTo(p.sx, p.sy);
    }
  }
  ctx.strokeStyle = 'rgba(242,239,230,0.18)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Car marker along centerline
  const markerT = ((time * 0.18) % 1 + 1) % 1;
  const idxF = markerT * segments;
  const idx = Math.floor(idxF) % segments;
  const local = idxF - Math.floor(idxF);
  const m0 = center[idx]!;
  const m1 = center[(idx + 1) % segments]!;
  if (m0.visible && m1.visible) {
    const mx = m0.sx + (m1.sx - m0.sx) * local;
    const my = m0.sy + (m1.sy - m0.sy) * local;
    const r = Math.max(2.5, pad(token, 0.55));
    ctx.beginPath();
    ctx.arc(mx, my, r + 2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(mx, my, r, 0, Math.PI * 2);
    ctx.fillStyle = ACCENT_RIBBON;
    ctx.fill();
    ctx.strokeStyle = 'rgba(242,239,230,0.65)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  ctx.restore();
}

/** Soft vignette + warm asphalt wash for the title screen only. */
export function drawTitleAtmosphere(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  time: number,
  fadeTop = h * 0.55,
): void {
  ctx.save();
  const g = ctx.createRadialGradient(w * 0.48, h * 0.28, 0, w * 0.5, h * 0.4, Math.max(w, h) * 0.78);
  g.addColorStop(0, 'rgba(240, 196, 26, 0.12)');
  g.addColorStop(0.35, 'rgba(28, 36, 30, 0.4)');
  g.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // Slow sweeping garage fluorescent
  const sweep = ((time * 0.07) % 1) * (w + h * 0.5);
  const streak = ctx.createLinearGradient(sweep - h * 0.5, 0, sweep + h * 0.15, h);
  streak.addColorStop(0, 'rgba(255,255,255,0)');
  streak.addColorStop(0.48, 'rgba(240, 196, 26, 0.05)');
  streak.addColorStop(0.52, 'rgba(242, 239, 230, 0.04)');
  streak.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = streak;
  ctx.fillRect(0, 0, w, h);

  // Bottom fade so menu stays readable — start just above the menu column.
  const top = Math.max(h * 0.35, Math.min(h * 0.72, fadeTop));
  const fade = ctx.createLinearGradient(0, top, 0, h);
  fade.addColorStop(0, 'rgba(11,13,12,0)');
  fade.addColorStop(0.45, 'rgba(11,13,12,0.5)');
  fade.addColorStop(1, 'rgba(11,13,12,0.94)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, top, w, h - top);
  ctx.restore();
}

export interface TitleLogoOpts {
  align?: 'center' | 'left';
  /** Override APEX size (px). Subtitle scales with it. */
  apexSize?: number;
}

/** Estimate title logo block height without measuring canvas (for layout). */
export function measureTitleLogoHeight(apexSize: number, _token?: ThemeTokens): number {
  const subSize = apexSize * 0.28;
  const gap = Math.max(4, apexSize * 0.08);
  const ruleH = Math.max(2, apexSize * 0.035);
  return apexSize + subSize + gap * 2.5 + ruleH;
}

/** Returns total block height for layout. */
export function drawTitleLogo(
  ctx: CanvasRenderingContext2D,
  cx: number,
  y: number,
  token: ThemeTokens,
  opts: TitleLogoOpts = {},
): number {
  const align = opts.align ?? 'center';
  const apexSize = opts.apexSize ?? token.fontHero;
  const subSize = Math.max(11, apexSize * 0.28);
  const gap = Math.max(4, apexSize * 0.08);
  const ruleH = Math.max(2, apexSize * 0.035);

  ctx.save();
  ctx.textAlign = align;
  ctx.textBaseline = 'top';

  // Subtle depth plate behind wordmark
  ctx.font = `400 ${apexSize}px ${TITLE_FONT}`;
  const apexW = ctx.measureText('APEX').width;
  const blockW = Math.max(apexW, apexSize * 2.4);
  const left = align === 'left' ? cx : cx - blockW * 0.5;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(left - pad(token, 0.6), y - pad(token, 0.35), blockW + pad(token, 1.2), apexSize + subSize + gap * 3.2);

  ctx.fillStyle = token.text;
  ctx.fillText('APEX', cx, y);

  const ruleY = y + apexSize + gap * 0.2;
  const ruleW = blockW * 0.95;
  const ruleX = align === 'left' ? cx : cx - ruleW * 0.5;
  ctx.fillStyle = ACCENT_RIBBON;
  ctx.fillRect(ruleX, ruleY, ruleW * 0.42, ruleH);
  ctx.fillStyle = 'rgba(242,239,230,0.28)';
  ctx.fillRect(ruleX + ruleW * 0.44, ruleY, ruleW * 0.56, ruleH);

  ctx.font = `400 ${subSize}px ${TITLE_FONT}`;
  ctx.fillStyle = ACCENT_RIBBON;
  const subY = ruleY + ruleH + gap * 0.85;
  // Tracked wordmark (letterSpacing when available; else manual advances)
  const sub = 'AUTO-RACER';
  const spacing = Math.max(2, apexSize * 0.055);
  const ctxLs = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  if (typeof ctxLs.letterSpacing === 'string') {
    ctxLs.letterSpacing = `${spacing}px`;
    ctx.fillText(sub, cx, subY);
    ctxLs.letterSpacing = '0px';
  } else {
    ctx.textAlign = 'left';
    let total = 0;
    for (let i = 0; i < sub.length; i++) total += ctx.measureText(sub[i]!).width + (i > 0 ? spacing : 0);
    let x = align === 'left' ? cx : cx - total * 0.5;
    for (let i = 0; i < sub.length; i++) {
      ctx.fillText(sub[i]!, x, subY);
      x += ctx.measureText(sub[i]!).width + spacing;
    }
    ctx.textAlign = align;
  }

  ctx.restore();
  return apexSize + subSize + gap * 2.5 + ruleH;
}

export type TitleLayoutMode = 'portrait' | 'landscape';

export interface TitleScreenLayout {
  mode: TitleLayoutMode;
  logoX: number;
  logoY: number;
  logoAlign: 'center' | 'left';
  apexSize: number;
  trackCx: number;
  trackCy: number;
  trackScale: number;
  menuX: number;
  menuY: number;
  menuW: number;
  btnH: number;
  btnGap: number;
  /** Y where bottom readability fade should begin. */
  fadeTop: number;
  /** Optional scrim behind the menu column (portrait). */
  menuScrim: { x: number; y: number; w: number; h: number } | null;
}

/**
 * Non-overlapping title regions for portrait phones, landscape, and resizable desktop.
 * Priority: brand → menu → track (track shrinks first).
 */
export function computeTitleLayout(w: number, h: number, token: ThemeTokens): TitleScreenLayout {
  const safe = token.safe;
  const margin = Math.max(12, Math.min(w, h) * 0.035);
  const innerL = safe.left + margin;
  const innerR = w - safe.right - margin;
  const innerT = safe.top + margin;
  const innerB = h - safe.bottom - margin;
  const innerW = Math.max(1, innerR - innerL);
  const innerH = Math.max(1, innerB - innerT);
  const landscape = w / Math.max(h, 1) >= 1.15;
  const shortH = h < 520;
  const btnCount = 4;

  let btnH = Math.max(token.touchMin, pad(token, 5.25));
  let btnGap = Math.max(6, pad(token, 0.7));
  let menuH = btnCount * btnH + (btnCount - 1) * btnGap;

  if (landscape) {
    const menuBudget = innerH * (shortH ? 0.78 : 0.58);
    if (menuH > menuBudget) {
      const s = menuBudget / menuH;
      btnH = Math.max(token.touchMin, btnH * s);
      btnGap = Math.max(4, btnGap * s);
      menuH = btnCount * btnH + (btnCount - 1) * btnGap;
    }

    const colMax = Math.min(innerW * 0.4, 420);
    const colW = Math.max(200, colMax);
    const colX = innerL;
    const brandBudget = Math.max(48, innerH - menuH - margin * 2);
    const apexSize = Math.max(
      shortH ? 34 : 44,
      Math.min(
        colW * 0.24,
        h * (shortH ? 0.13 : 0.12),
        brandBudget * 0.62,
        shortH ? 48 : 70,
      ),
    );
    const logoH = measureTitleLogoHeight(apexSize, token);
    const logoY = innerT + Math.min(margin, brandBudget * 0.08);
    const menuY = Math.min(innerB - menuH, Math.max(logoY + logoH + margin, innerT + innerH * 0.42));

    const trackLeft = colX + colW + margin;
    const trackRight = innerR;
    const trackW = Math.max(80, trackRight - trackLeft);
    const trackCx = trackLeft + trackW * 0.5;
    const trackCy = innerT + innerH * (shortH ? 0.48 : 0.46);
    const trackScale = Math.min(trackW * 0.55, innerH * (shortH ? 0.5 : 0.58), Math.min(w, h) * 0.48);

    return {
      mode: 'landscape',
      logoX: colX,
      logoY,
      logoAlign: 'left',
      apexSize,
      trackCx,
      trackCy,
      trackScale,
      menuX: colX,
      menuY,
      menuW: colW,
      btnH,
      btnGap,
      fadeTop: menuY - margin,
      menuScrim: null,
    };
  }

  // Portrait / square — brand top, track mid, menu bottom.
  const menuBudget = innerH * (h < 700 ? 0.36 : 0.34);
  if (menuH > menuBudget) {
    const s = menuBudget / menuH;
    btnH = Math.max(token.touchMin, btnH * s);
    btnGap = Math.max(5, btnGap * s);
    menuH = btnCount * btnH + (btnCount - 1) * btnGap;
  }

  const menuW = Math.min(innerW, Math.min(420, Math.max(260, w * 0.86)));
  const menuX = innerL + (innerW - menuW) * 0.5;
  const menuY = innerB - menuH;

  const brandCeiling = menuY - margin * 1.5;
  const apexSize = Math.min(
    token.fontHero * 1.15,
    w * 0.168,
    (brandCeiling - innerT) * 0.28,
    70,
  );
  const logoH = measureTitleLogoHeight(Math.max(34, apexSize), token);
  const logoY = innerT;
  const logoBottom = logoY + logoH;

  const trackTop = logoBottom + margin * 0.5;
  const trackBottom = menuY - margin;
  const trackBand = Math.max(40, trackBottom - trackTop);
  const trackCy = trackTop + trackBand * 0.48;
  const trackScale = Math.min(
    innerW * 0.48,
    trackBand * 0.72,
    Math.min(w, h) * 0.4,
  );

  const scrimPad = margin * 0.75;
  const menuScrim = {
    x: menuX - scrimPad,
    y: menuY - scrimPad,
    w: menuW + scrimPad * 2,
    h: menuH + scrimPad * 2,
  };

  return {
    mode: 'portrait',
    logoX: w * 0.5,
    logoY,
    logoAlign: 'center',
    apexSize: Math.max(34, apexSize),
    trackCx: w * 0.5,
    trackCy,
    trackScale,
    menuX,
    menuY,
    menuW,
    btnH,
    btnGap,
    fadeTop: menuY - trackBand * 0.35,
    menuScrim,
  };
}

export function drawTopDownCar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  w: number,
  h: number,
  accent: string,
  discipline: DisciplineId,
  opts?: {
    partTiers?: import('../engine/types').VehicleParts;
    condition?: number;
    highlightPart?: import('../data/parts').PartCategory;
  },
): void {
  const def = getDiscipline(discipline);
  ctx.save();
  ctx.translate(cx, cy);
  // Soft asphalt pad under the hero — grounds the faux-3D mesh.
  ctx.fillStyle = def.style.asphalt;
  ctx.beginPath();
  ctx.ellipse(0, h * 0.06, w * 0.55, h * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
  // Nose up for garage read (matches race heading convention).
  ctx.rotate(-Math.PI / 2);
  const previewTiers = opts?.partTiers ? { ...opts.partTiers } : undefined;
  if (previewTiers && opts?.highlightPart) {
    previewTiers[opts.highlightPart] = Math.min(5, (previewTiers[opts.highlightPart] ?? 1) + 1);
  }
  drawSlotCarMesh(
    ctx,
    {
      len: Math.max(h * 0.72, w * 0.9),
      wid: Math.max(w * 0.42, h * 0.28),
      color: accent,
      isPlayer: true,
      detail: 'hero',
      discipline,
      partTiers: previewTiers,
      condition: opts?.condition ?? 1,
      tyreTemp: 0.75,
    },
    true,
  );
  ctx.restore();
}

export function disciplineLabel(id: DisciplineId): string {
  return getDiscipline(id).name;
}

export function disciplineAccent(id: DisciplineId): string {
  return accentForDiscipline(id);
}

export function allDisciplines() {
  return DISCIPLINES;
}

export function carouselNav(
  ui: UiContext,
  leftX: number,
  rightX: number,
  y: number,
  size: number,
  onLeft: () => void,
  onRight: () => void,
): void {
  const { token } = ui;
  const btnH = ensureMinTouch(size, token);
  if (ui.pointerClicked) {
    if (hitRect(ui.pointerX, ui.pointerY, leftX, y, btnH, btnH)) onLeft();
    if (hitRect(ui.pointerX, ui.pointerY, rightX, y, btnH, btnH)) onRight();
  }
}

export function getObjectiveDef(id: ObjectiveKind) {
  return OBJECTIVES.find((o) => o.id === id);
}
