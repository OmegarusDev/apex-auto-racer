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

export function makeQuickRaceConfig(state: GameState, discipline: DisciplineId): RaceLaunchConfig {
  const seedMaterial =
    (state.seed +
      state.careerStats.races * 9973 +
      state.careerStats.earnings +
      discipline.charCodeAt(0) * 131) >>>
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

/** Push RaceScene synchronously. Never toast a fake "loading" state on failure. */
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
    g.scenes.push(new RaceScene(g, config));
  } catch (err) {
    console.error('[apex] launchRace failed', err);
    toasts.push(`Could not start race: ${formatLaunchError(err)}`, accent, 5);
  } finally {
    raceLaunchInFlight = false;
  }
}

export function drawBackground(ctx: CanvasRenderingContext2D, w: number, h: number, token: ThemeTokens): void {
  ctx.fillStyle = token.bg;
  ctx.fillRect(0, 0, w, h);
}

const ACCENT_RIBBON = '#22d3ee';
const TITLE_FONT =
  '"Arial Narrow", "Helvetica Neue Condensed", "Roboto Condensed", Impact, "Arial Black", sans-serif';

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

  type Proj = { sx: number; sy: number; z: number; visible: boolean };
  const project = (px: number, pz: number): Proj => {
    // Horizontal asphalt plane (px, 0, pz), then Y-spin + X-pitch.
    const x1 = px * cosY - pz * sinY;
    const z1 = px * sinY + pz * cosY;
    const y1 = 0;
    const x2 = x1;
    const y2 = y1 * cosX - z1 * sinX;
    const z2 = y1 * sinX + z1 * cosX;
    const depth = cameraDist + z2;
    if (depth < 0.35) return { sx: cx, sy: cy, z: z2, visible: false };
    const k = (focal * scale) / depth;
    return { sx: cx + x2 * k, sy: cy + y2 * k, z: z2, visible: true };
  };

  // Edge ribbons from planar normals (preserves flat-track silhouette under projection).
  const left: Proj[] = [];
  const right: Proj[] = [];
  const center: Proj[] = [];
  for (let i = 0; i < segments; i++) {
    const p = planar[i]!;
    const prev = planar[(i - 1 + segments) % segments]!;
    const next = planar[(i + 1) % segments]!;
    const tx = next.x - prev.x;
    const ty = next.y - prev.y;
    const len = Math.hypot(tx, ty) || 1;
    const nx = -ty / len;
    const ny = tx / len;
    left.push(project(p.x + nx * halfWidth, p.y + ny * halfWidth));
    right.push(project(p.x - nx * halfWidth, p.y - ny * halfWidth));
    center.push(project(p.x, p.y));
  }

  // Painter's algorithm: back segments first.
  const order = Array.from({ length: segments }, (_, i) => i);
  order.sort((a, b) => {
    const za = (center[a]!.z + center[(a + 1) % segments]!.z) * 0.5;
    const zb = (center[b]!.z + center[(b + 1) % segments]!.z) * 0.5;
    return za - zb;
  });

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
    ctx.fillStyle = `rgba(22,22,28,${0.75 * a})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(40,40,48,${0.9 * a})`;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Center dashed racing line
    const c0 = center[i]!;
    const c1 = center[j]!;
    ctx.beginPath();
    ctx.moveTo(c0.sx, c0.sy);
    ctx.lineTo(c1.sx, c1.sy);
    ctx.strokeStyle = `rgba(34,211,238,${0.22 * a})`;
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
  ctx.strokeStyle = 'rgba(244,244,245,0.14)';
  ctx.lineWidth = 1.25;
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
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(mx, my, r, 0, Math.PI * 2);
    ctx.fillStyle = ACCENT_RIBBON;
    ctx.fill();
    ctx.strokeStyle = 'rgba(244,244,245,0.55)';
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
): void {
  ctx.save();
  const g = ctx.createRadialGradient(w * 0.5, h * 0.42, 0, w * 0.5, h * 0.45, Math.max(w, h) * 0.72);
  g.addColorStop(0, 'rgba(28, 22, 18, 0.55)');
  g.addColorStop(0.45, 'rgba(14, 14, 18, 0.35)');
  g.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // Slow sweeping light streak (motorsport garage / night race feel)
  const sweep = ((time * 0.08) % 1) * (w + h);
  const streak = ctx.createLinearGradient(sweep - h * 0.4, 0, sweep + h * 0.2, h);
  streak.addColorStop(0, 'rgba(255,255,255,0)');
  streak.addColorStop(0.5, 'rgba(255, 196, 120, 0.03)');
  streak.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = streak;
  ctx.fillRect(0, 0, w, h);

  // Bottom fade so menu stays readable
  const fade = ctx.createLinearGradient(0, h * 0.55, 0, h);
  fade.addColorStop(0, 'rgba(10,10,12,0)');
  fade.addColorStop(1, 'rgba(10,10,12,0.82)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, h * 0.55, w, h * 0.45);
  ctx.restore();
}

export interface TitleLogoOpts {
  align?: 'center' | 'left';
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
  const apexSize = token.fontDisplay * 2.15;
  const subSize = token.fontTitle * 0.78;
  const gap = pad(token, 0.55);
  const ruleH = Math.max(2, pad(token, 0.22));

  ctx.save();
  ctx.textAlign = align;
  ctx.textBaseline = 'top';

  // Subtle depth plate behind wordmark
  ctx.font = `900 ${apexSize}px ${TITLE_FONT}`;
  const apexW = ctx.measureText('APEX').width;
  const blockW = Math.max(apexW, apexSize * 2.4);
  const left = align === 'left' ? cx : cx - blockW * 0.5;
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(left - pad(token, 0.5), y - pad(token, 0.3), blockW + pad(token, 1), apexSize + subSize + gap * 3);

  ctx.fillStyle = token.text;
  ctx.fillText('APEX', cx, y);

  const ruleY = y + apexSize + gap * 0.35;
  const ruleW = blockW * 0.92;
  const ruleX = align === 'left' ? cx : cx - ruleW * 0.5;
  ctx.fillStyle = ACCENT_RIBBON;
  ctx.fillRect(ruleX, ruleY, ruleW * 0.38, ruleH);
  ctx.fillStyle = 'rgba(244,244,245,0.35)';
  ctx.fillRect(ruleX + ruleW * 0.4, ruleY, ruleW * 0.6, ruleH);

  ctx.font = `700 ${subSize}px ${TITLE_FONT}`;
  ctx.fillStyle = ACCENT_RIBBON;
  const subY = ruleY + ruleH + gap * 0.7;
  // Tracked wordmark (letterSpacing when available; else manual advances)
  const sub = 'AUTO-RACER';
  const spacing = Math.max(1, token.scale * 2.5);
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
      const ch = sub[i]!;
      ctx.fillText(ch, x, subY);
      x += ctx.measureText(ch).width + spacing;
    }
  }

  ctx.restore();
  return apexSize + subSize + gap * 2.5 + ruleH;
}

export function drawTopDownCar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  w: number,
  h: number,
  accent: string,
  discipline: DisciplineId,
): void {
  const def = getDiscipline(discipline);
  ctx.save();
  ctx.translate(cx, cy);

  ctx.fillStyle = def.style.asphalt;
  ctx.beginPath();
  ctx.ellipse(0, 0, w * 0.55, h * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.roundRect(-w * 0.22, -h * 0.38, w * 0.44, h * 0.76, w * 0.08);
  ctx.fill();

  ctx.fillStyle = '#111118';
  ctx.beginPath();
  ctx.roundRect(-w * 0.16, -h * 0.28, w * 0.32, h * 0.18, 4);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(-w * 0.14, h * 0.08, w * 0.28, h * 0.14, 4);
  ctx.fill();

  ctx.fillStyle = '#0a0a0c';
  const wheelW = w * 0.12;
  const wheelH = h * 0.16;
  ctx.fillRect(-w * 0.3, -h * 0.32, wheelW, wheelH);
  ctx.fillRect(w * 0.18, -h * 0.32, wheelW, wheelH);
  ctx.fillRect(-w * 0.3, h * 0.16, wheelW, wheelH);
  ctx.fillRect(w * 0.18, h * 0.16, wheelW, wheelH);

  ctx.strokeStyle = `${accent}88`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, -h * 0.38);
  ctx.lineTo(0, h * 0.38);
  ctx.stroke();

  ctx.restore();
}

export interface SliderDef {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  value: number;
  onChange?: (v: number) => void;
}

export function drawSlider(ctx: CanvasRenderingContext2D, slider: SliderDef, ui: UiContext): void {
  const { token } = ui;
  ctx.save();
  ctx.font = `${token.fontBody}px ${token.fontFamily}`;
  ctx.fillStyle = token.textMuted;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText(slider.label, slider.x, slider.y - pad(token, 0.25));

  const trackY = slider.y;
  const trackH = slider.h;
  ctx.fillStyle = token.bgElevated;
  ctx.beginPath();
  ctx.roundRect(slider.x, trackY, slider.w, trackH, trackH * 0.5);
  ctx.fill();

  const fillW = slider.w * Math.max(0, Math.min(1, slider.value));
  ctx.fillStyle = ui.accent;
  ctx.beginPath();
  ctx.roundRect(slider.x, trackY, fillW, trackH, trackH * 0.5);
  ctx.fill();

  const knobX = slider.x + fillW;
  ctx.beginPath();
  ctx.arc(knobX, trackY + trackH * 0.5, trackH * 0.75, 0, Math.PI * 2);
  ctx.fillStyle = token.text;
  ctx.fill();

  ctx.font = `${token.fontCaption}px ${token.fontFamily}`;
  ctx.fillStyle = token.textDim;
  ctx.textAlign = 'right';
  ctx.fillText(`${Math.round(slider.value * 100)}%`, slider.x + slider.w, slider.y - pad(token, 0.25));
  ctx.restore();
}

export function handleSlider(slider: SliderDef, ui: UiContext): boolean {
  if (!ui.pointerDown) return false;
  if (!hitRect(ui.pointerX, ui.pointerY, slider.x, slider.y - pad(ui.token, 2), slider.w, slider.h + pad(ui.token, 2))) {
    return false;
  }
  const v = Math.max(0, Math.min(1, (ui.pointerX - slider.x) / slider.w));
  slider.onChange?.(v);
  return true;
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
