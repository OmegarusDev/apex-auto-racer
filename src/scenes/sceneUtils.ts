import { BALANCE } from '../data/balance';
import { DISCIPLINES, getDiscipline } from '../data/disciplines';
import { getTrait } from '../data/traits';
import { PARTS, partCost } from '../data/parts';
import { generateDriver } from '../engine/DriverGenerator';
import { getGameContext } from '../engine/GameContext';
import { effectiveStats } from '../engine/stats';
import { OBJECTIVES } from '../data/objectives';
import type { ObjectiveKind } from '../data/objectives';
import { mulberry32, randInt } from '../engine/rng';
import type { DisciplineId } from '../data/disciplines';
import type { PartCategory } from '../data/parts';
import type { Driver, GameState, VehicleSave } from '../engine/types';
import type { RaceLaunchConfig } from '../engine/raceTypes';
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
  const rng = mulberry32((state.seed ^ discipline.charCodeAt(0) ^ Date.now()) >>> 0);
  const trackSeed = randInt(rng, 1, 0x7fffffff);
  const raceSeed = randInt(rng, 1, 0x7fffffff);
  const laps = randInt(rng, BALANCE.minLaps, Math.min(BALANCE.maxLaps, 5));
  const lineup = defaultLineup(state, 1);
  return {
    discipline,
    trackSeed,
    raceSeed,
    laps,
    formatId: '1v1',
    playerLineup: lineup,
    leadDriverId: defaultLeadDriver(state, lineup),
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

export async function launchRace(config: RaceLaunchConfig, toasts: ToastManager): Promise<void> {
  const g = getGameContext();
  try {
    const mod = await import('./RaceScene');
    g.scenes.push(new mod.RaceScene(g, config));
  } catch {
    toasts.push('Race loading...', accentForDiscipline(config.discipline));
  }
}

export function drawBackground(ctx: CanvasRenderingContext2D, w: number, h: number, token: ThemeTokens): void {
  ctx.fillStyle = token.bg;
  ctx.fillRect(0, 0, w, h);
}

export function drawRibbonTrack(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  time: number,
  token: ThemeTokens,
): void {
  const cx = w * 0.5;
  const cy = h * 0.38;
  const scale = Math.min(w, h) * 0.32;
  const segments = 64;
  const path: { x: number; y: number }[] = [];

  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    const r = scale * (0.85 + 0.15 * Math.sin(t * 3 + time * 0.4));
    path.push({
      x: cx + Math.cos(t + time * 0.15) * r,
      y: cy + Math.sin(t * 1.2 + time * 0.12) * r * 0.55,
    });
  }

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.strokeStyle = '#1c1c24';
  ctx.lineWidth = pad(token, 3.5);
  ctx.beginPath();
  for (let i = 0; i < path.length; i++) {
    const p = path[i]!;
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  ctx.stroke();

  ctx.strokeStyle = `${ACCENT_RIBBON}${Math.floor(0.35 * 255).toString(16).padStart(2, '0')}`;
  ctx.lineWidth = pad(token, 2.5);
  ctx.setLineDash([pad(token, 1.5), pad(token, 1)]);
  ctx.lineDashOffset = -time * 40;
  ctx.stroke();

  ctx.strokeStyle = ACCENT_RIBBON;
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  const markerT = (time * 0.2) % 1;
  const idx = Math.floor(markerT * segments);
  const p0 = path[idx]!;
  const p1 = path[(idx + 1) % segments]!;
  const local = (markerT * segments) % 1;
  const mx = p0.x + (p1.x - p0.x) * local;
  const my = p0.y + (p1.y - p0.y) * local;
  ctx.beginPath();
  ctx.arc(mx, my, pad(token, 0.6), 0, Math.PI * 2);
  ctx.fillStyle = ACCENT_RIBBON;
  ctx.fill();

  ctx.restore();
}

const ACCENT_RIBBON = '#22d3ee';

export function drawTitleLogo(
  ctx: CanvasRenderingContext2D,
  cx: number,
  y: number,
  token: ThemeTokens,
): void {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = `900 ${token.fontDisplay * 1.4}px ${token.fontFamily}`;
  ctx.fillStyle = token.text;
  ctx.fillText('APEX', cx, y);
  ctx.font = `700 ${token.fontTitle * 0.85}px ${token.fontFamily}`;
  ctx.fillStyle = ACCENT_RIBBON;
  ctx.fillText('AUTO-RACER', cx, y + token.fontDisplay * 1.35);
  ctx.restore();
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
