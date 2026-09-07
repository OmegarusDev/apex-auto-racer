import { BALANCE } from '../data/balance';
import { PARTS, partCost } from '../data/parts';
import type { PartCategory } from '../data/parts';
import type { ThemeTokens } from './theme';
import {
  pad,
  headerContentH,
  headerContentTop,
  headerBandH,
} from './theme';

export type { ThemeTokens };
export {
  pad,
  createTheme,
  invalidateSafeArea,
  headerContentH,
  headerContentTop,
  headerBandH,
} from './theme';

export interface UiContext {
  pointerX: number;
  pointerY: number;
  pointerDown: boolean;
  pointerClicked: boolean;
  dt: number;
  w: number;
  h: number;
  token: ThemeTokens;
  accent: string;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ButtonDef {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  disabled?: boolean;
  primary?: boolean;
  /** Destructive action — red plate regardless of primary/secondary. */
  danger?: boolean;
  /** Hero CTA — filled accent with a play mark. */
  cta?: boolean;
  /** Text-only control — no plate. Secondary title/hub actions. */
  quiet?: boolean;
  /** Optional label size — defaults to fontBody. Title menu uses a larger display size. */
  fontSize?: number;
  onClick?: () => void;
}

export interface CardDef {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface StatBarDef {
  x: number;
  y: number;
  w: number;
  label: string;
  value: number;
  color?: string;
  /** Unit readout after the number, e.g. '%'. */
  suffix?: string;
  /** Suppress the numeric readout (label carries the numbers instead). */
  hideValue?: boolean;
  /** When present, an (i) hotspot is drawn beside the label. */
  info?: TooltipInfo;
}

export interface RadarChartDef {
  x: number;
  y: number;
  radius: number;
  /** Optional local viewport width — labels clamp to it instead of the chart
   *  footprint, so opposite labels keep their natural sides on small screens. */
  viewW?: number;
  values: {
    topSpeed: number;
    acceleration: number;
    braking: number;
    grip: number;
    downforce: number;
  };
}

export interface ModalDef {
  open: boolean;
  title: string;
  body: string;
  buttons: ButtonDef[];
}

export interface ToastItem {
  id: number;
  message: string;
  ttl: number;
  accent?: string;
}

export interface HeaderDef {
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  back?: boolean;
  cash?: number;
  settings?: boolean;
  onBack?: () => void;
  onSettings?: () => void;
}

export type DriverStatKey = 'skill' | 'bravery' | 'focus' | 'determination';

export interface DriverSpendData {
  name: string;
  trait: string;
  /** Optional plain-language trait description shown via an (i) hotspot. */
  traitDescription?: string;
  skill: number;
  bravery: number;
  focus: number;
  determination: number;
  unspentPoints: number;
  level: number;
  xp: number;
  xpToNext: number;
}

/** Optional full-width action row under a driver card (Release / Hire …). */
export interface DriverPanelAction {
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}

export interface DriverSpendPanelDef {
  x: number;
  y: number;
  w: number;
  driver: DriverSpendData;
  onSpend?: (stat: DriverStatKey) => void;
  /** Extra action buttons drawn under the stat block. */
  actions?: DriverPanelAction[];
  /** Receives stat ⓘ hotspots so hosts can feed their TooltipManager. */
  registerInfo?: (rect: Rect, info: TooltipInfo) => void;
}

/** What each driver rating does in a race — surfaced through the ⓘ hotspots. */
export const DRIVER_STAT_INFO: Record<DriverStatKey, string> = {
  skill: 'Control quality — carries corners closer to the limit, brakes later and straighter, catches slides faster.',
  bravery: 'Corner commitment — keeps momentum through bends and brakes later. Riskier in traffic and rain.',
  focus: 'Concentration — fewer lapses like missed braking points or line wobbles. Matters most in the wet.',
  determination: 'Fightback — finds extra pace when running behind in the field.',
};

const DRIVER_XP_INFO =
  'Races award XP. Every level-up grants one point to spend on the ratings below.';

export interface UpgradePanelDef {
  x: number;
  y: number;
  w: number;
  partTiers: Record<PartCategory, number>;
  condition: number;
  cash: number;
  collapsed?: boolean;
  /** Part whose row reads highlighted (e.g. hovered for a preview elsewhere). */
  activePart?: PartCategory | null;
  onBuy?: (part: PartCategory) => void;
  onRepair?: () => void;
  onToggleCollapse?: () => void;
  /** Per-part explanation for the row ⓘ hotspots. */
  infoForPart?: (part: PartCategory) => TooltipInfo | undefined;
  /** Receives ⓘ hotspots so hosts can feed their TooltipManager. */
  registerInfo?: (rect: Rect, info: TooltipInfo) => void;
}

/** Cash + points needed to go back to perfect condition. */
export function repairQuote(condition: number): { pts: number; cost: number } {
  const pts = Math.max(0, Math.ceil((BALANCE.conditionMax - condition) * 100));
  return { pts, cost: pts * BALANCE.repairCostPerPoint };
}

interface UpgradePanelMetrics {
  btnH: number;
  rowH: number;
  headerH: number;
}

function upgradePanelMetrics(token: ThemeTokens): UpgradePanelMetrics {
  const btnH = ensureMinTouch(pad(token, 4.5), token);
  // Rows must fully contain their buy button (a flat 5.5u row bled ±2px).
  return {
    btnH,
    rowH: Math.max(pad(token, 5.5), btnH + pad(token, 0.5)),
    headerH: pad(token, 5),
  };
}

/** Absolute y of the first part row — lets hosts do their own hover hit-tests. */
export function upgradePanelRowsTop(panel: UpgradePanelDef, token: ThemeTokens): number {
  const m = upgradePanelMetrics(token);
  return (
    panel.y +
    pad(token, 1) +
    m.headerH +
    (panel.collapsed
      ? 0
      : statBarHeight(token) + pad(token, 0.75) + m.btnH + pad(token, 1))
  );
}

/** Row pitch of the part rows — hosts use it with upgradePanelRowsTop. */
export function upgradePanelRowHeight(token: ThemeTokens): number {
  return upgradePanelMetrics(token).rowH;
}

const RADAR_LABELS = ['Top Speed', 'Accel', 'Braking', 'Grip', 'Downforce'] as const;
const RADAR_KEYS = ['topSpeed', 'acceleration', 'braking', 'grip', 'downforce'] as const;

const STAT_LABELS: Record<DriverStatKey, string> = {
  skill: 'Skill',
  bravery: 'Bravery',
  focus: 'Focus',
  determination: 'Determination',
};

// ── Layout helpers ──────────────────────────────────────────────────────────

export function isPortrait(w: number, h: number): boolean {
  return h >= w;
}

// ── Hit-test helpers ────────────────────────────────────────────────────────

export function hitRect(px: number, py: number, x: number, y: number, w: number, h: number): boolean {
  return px >= x && px <= x + w && py >= y && py <= y + h;
}

export function ensureMinTouch(size: number, token: ThemeTokens): number {
  return Math.max(size, token.touchMin);
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function setFont(
  ctx: CanvasRenderingContext2D,
  token: ThemeTokens,
  size: number,
  weight = '600',
  display = false,
): void {
  const family = display ? token.fontDisplayFamily : token.fontFamily;
  ctx.font = `${weight} ${size}px ${family}`;
}

/** Ellipsize to fit a single line. Call after setting ctx.font. */
export function truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (maxWidth <= 0) return '';
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) {
    t = t.slice(0, -1);
  }
  return t.length > 0 ? `${t}…` : '…';
}

/**
 * Word-wrap into lines that fit maxWidth. Optional maxLines ellipsizes the last line.
 * Call after setting ctx.font.
 */
export function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines = 0,
): string[] {
  const raw = text.trim();
  if (!raw || maxWidth <= 0) return [];
  const words = raw.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const word of words) {
    const test = cur ? `${cur} ${word}` : word;
    if (ctx.measureText(test).width <= maxWidth) {
      cur = test;
      continue;
    }
    if (cur) lines.push(cur);
    if (maxLines > 0 && lines.length >= maxLines) {
      cur = '';
      break;
    }
    // Long single word — hard truncate into the line.
    if (ctx.measureText(word).width > maxWidth) {
      lines.push(truncateText(ctx, word, maxWidth));
      cur = '';
      if (maxLines > 0 && lines.length >= maxLines) break;
    } else {
      cur = word;
    }
  }
  if (cur && (maxLines <= 0 || lines.length < maxLines)) lines.push(cur);
  if (maxLines > 0 && lines.length > maxLines) {
    return lines.slice(0, maxLines);
  }
  // If we stopped early with leftover words, ellipsize last line.
  if (maxLines > 0 && lines.length === maxLines) {
    const used = lines.join(' ').length;
    if (used < raw.length) {
      const last = lines[lines.length - 1]!;
      lines[lines.length - 1] = truncateText(ctx, last.replace(/…$/, ''), maxWidth);
    }
  }
  return lines;
}

export interface HintBoxOpts {
  x: number;
  y: number;
  /** Max box width (content + padding). */
  maxW: number;
  text: string;
  accent: string;
  token: ThemeTokens;
  maxLines?: number;
  fontSize?: number;
  align?: 'center' | 'left';
  /** Plate fill — overlay for race teach, card for menu toasts. */
  fill?: 'overlay' | 'card';
}

export interface HintBoxLayout {
  x: number;
  y: number;
  w: number;
  h: number;
  lines: string[];
}

/** Measure a multi-line teach/toast box (does not draw). */
export function layoutHintBox(
  ctx: CanvasRenderingContext2D,
  opts: HintBoxOpts,
): HintBoxLayout {
  const { token } = opts;
  const maxLines = opts.maxLines ?? 3;
  const fontSize = opts.fontSize ?? token.fontBody;
  const padX = pad(token, 1.5);
  const padY = pad(token, 1);
  const lineH = fontSize * 1.35;
  const boxW = opts.maxW;
  setFont(ctx, token, fontSize, '600');
  const lines = wrapText(ctx, opts.text, boxW - padX * 2, maxLines);
  const textH = Math.max(lineH, lines.length * lineH);
  const boxH = Math.max(ensureMinTouch(pad(token, 4), token), textH + padY * 2);
  return { x: opts.x, y: opts.y, w: boxW, h: boxH, lines };
}

/** Draw a multi-line hint/toast plate. Returns layout used. */
export function drawHintBox(ctx: CanvasRenderingContext2D, opts: HintBoxOpts): HintBoxLayout {
  const { token, accent } = opts;
  const layout = layoutHintBox(ctx, opts);
  const fontSize = opts.fontSize ?? token.fontBody;
  const lineH = fontSize * 1.35;
  const align = opts.align ?? 'center';

  ctx.save();
  ctx.fillStyle = opts.fill === 'card' ? token.card : token.overlay;
  roundRectPath(ctx, layout.x, layout.y, layout.w, layout.h, pad(token, 0.75));
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1;
  roundRectPath(ctx, layout.x, layout.y, layout.w, layout.h, pad(token, 0.75));
  ctx.stroke();

  setFont(ctx, token, fontSize, '600');
  ctx.fillStyle = token.text;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  const textBlockH = layout.lines.length * lineH;
  const startY = layout.y + (layout.h - textBlockH) * 0.5 + lineH * 0.5;
  const tx =
    align === 'center' ? layout.x + layout.w * 0.5 : layout.x + pad(token, 1.5);
  for (let i = 0; i < layout.lines.length; i++) {
    ctx.fillText(layout.lines[i]!, tx, startY + i * lineH);
  }
  ctx.restore();
  return layout;
}

function drawGearIcon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  color: string,
): void {
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.5, r * 0.22);
  const teeth = 6;
  ctx.beginPath();
  for (let i = 0; i < teeth; i++) {
    const a0 = (i / teeth) * Math.PI * 2 - Math.PI / teeth;
    const a1 = ((i + 0.45) / teeth) * Math.PI * 2 - Math.PI / teeth;
    const a2 = ((i + 0.55) / teeth) * Math.PI * 2 - Math.PI / teeth;
    const a3 = ((i + 1) / teeth) * Math.PI * 2 - Math.PI / teeth;
    const outer = r;
    const inner = r * 0.68;
    if (i === 0) ctx.moveTo(cx + Math.cos(a0) * inner, cy + Math.sin(a0) * inner);
    ctx.lineTo(cx + Math.cos(a0) * outer, cy + Math.sin(a0) * outer);
    ctx.lineTo(cx + Math.cos(a1) * outer, cy + Math.sin(a1) * outer);
    ctx.lineTo(cx + Math.cos(a2) * inner, cy + Math.sin(a2) * inner);
    ctx.lineTo(cx + Math.cos(a3) * inner, cy + Math.sin(a3) * inner);
  }
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.32, 0, Math.PI * 2);
  ctx.fillStyle = '#0b0d0c';
  ctx.fill();
  ctx.restore();
}

// ── Button ──────────────────────────────────────────────────────────────────

export function drawButton(ctx: CanvasRenderingContext2D, btn: ButtonDef, ui: UiContext): void {
  const { token, accent } = ui;
  const actionAccent = btn.danger === true && !btn.disabled ? token.danger : accent;
  const hovered = !btn.disabled && hitRect(ui.pointerX, ui.pointerY, btn.x, btn.y, btn.w, btn.h);
  const r = Math.max(2, pad(token, 0.25));
  const rail = Math.max(3, pad(token, 0.35));
  const isCta = btn.cta === true && !btn.disabled;
  const isQuiet = btn.quiet === true;
  const isPrimary = (btn.primary === true || btn.danger === true || isCta) && !btn.disabled && !isQuiet;

  ctx.save();
  if (isQuiet) {
    setFont(ctx, token, btn.fontSize ?? token.fontBody, hovered ? '700' : '600', true);
    ctx.fillStyle = btn.disabled
      ? token.disabled
      : btn.danger
        ? token.danger
        : hovered
          ? actionAccent
          : token.textMuted;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const label = truncateText(ctx, btn.label.toUpperCase(), btn.w - pad(token));
    ctx.fillText(label, btn.x + btn.w * 0.5, btn.y + btn.h * 0.52);
    if (hovered && !btn.disabled) {
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = actionAccent;
      ctx.fillRect(btn.x + (btn.w - tw) * 0.5, btn.y + btn.h * 0.72, tw, 2);
    }
    ctx.restore();
    return;
  }

  if (btn.disabled) {
    ctx.fillStyle = token.disabledBg;
    roundRectPath(ctx, btn.x, btn.y, btn.w, btn.h, r);
    ctx.fill();
    ctx.fillStyle = token.disabled;
  } else if (isCta) {
    // CTA: solid signal plate + dark inset edge (reads hotter than a normal primary).
    ctx.fillStyle = actionAccent;
    roundRectPath(ctx, btn.x, btn.y, btn.w, btn.h, r);
    ctx.fill();
    ctx.fillStyle = hovered ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.16)';
    ctx.fillRect(btn.x + r, btn.y + 1, btn.w - r * 2, Math.max(2, btn.h * 0.1));
    ctx.strokeStyle = hovered ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.22)';
    ctx.lineWidth = Math.max(2, pad(token, 0.2));
    roundRectPath(ctx, btn.x + 1, btn.y + 1, btn.w - 2, btn.h - 2, Math.max(1, r - 1));
    ctx.stroke();
    if (hovered) {
      ctx.fillStyle = 'rgba(0,0,0,0.1)';
      roundRectPath(ctx, btn.x, btn.y, btn.w, btn.h, r);
      ctx.fill();
    }
    ctx.fillStyle = token.bg;
  } else if (isPrimary) {
    const fill = actionAccent;
    ctx.fillStyle = fill;
    roundRectPath(ctx, btn.x, btn.y, btn.w, btn.h, r);
    ctx.fill();
    // Inner top bevel
    ctx.fillStyle = hovered ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.12)';
    ctx.fillRect(btn.x + r, btn.y + 1, btn.w - r * 2, Math.max(2, btn.h * 0.08));
    if (hovered) {
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      roundRectPath(ctx, btn.x, btn.y, btn.w, btn.h, r);
      ctx.fill();
      ctx.fillStyle = fill;
      roundRectPath(ctx, btn.x + 1, btn.y + 1, btn.w - 2, btn.h - 2, Math.max(1, r - 1));
      ctx.fill();
    }
    ctx.fillStyle = token.bg;
  } else {
    ctx.fillStyle = hovered ? '#1f2622' : token.card;
    roundRectPath(ctx, btn.x, btn.y, btn.w, btn.h, r);
    ctx.fill();
    // Left signal rail
    ctx.fillStyle = hovered ? actionAccent : `${actionAccent}99`;
    ctx.fillRect(btn.x, btn.y, rail, btn.h);
    ctx.strokeStyle = hovered ? `${actionAccent}55` : token.cardStroke;
    ctx.lineWidth = 1;
    roundRectPath(ctx, btn.x, btn.y, btn.w, btn.h, r);
    ctx.stroke();
    ctx.fillStyle = token.text;
  }

  const playPad = isCta ? btn.h * 0.28 : 0;
  const label = truncateText(
    ctx,
    btn.label.toUpperCase(),
    btn.w - pad(token) - rail - playPad,
  );
  const labelSize = btn.fontSize ?? token.fontBody;
  setFont(ctx, token, labelSize, isPrimary || isCta ? '700' : '600', true);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Bebas Neue sits high — nudge baseline slightly for optical center.
  const ty = btn.y + btn.h * 0.52;
  const tx = btn.x + btn.w * 0.5 + (isPrimary || isCta ? -playPad * 0.15 : rail * 0.25);
  ctx.fillText(label, tx, ty);

  if (isCta) {
    // Play chevron — marks this as the go-now action.
    const tri = Math.min(btn.h * 0.22, pad(token, 1.6));
    const cx = btn.x + btn.w - pad(token, 1.75) - tri;
    const cy = btn.y + btn.h * 0.5;
    ctx.beginPath();
    ctx.moveTo(cx - tri * 0.35, cy - tri);
    ctx.lineTo(cx + tri * 0.85, cy);
    ctx.lineTo(cx - tri * 0.35, cy + tri);
    ctx.closePath();
    ctx.fillStyle = token.bg;
    ctx.fill();
  }
  ctx.restore();
}

export function handleButton(btn: ButtonDef, ui: UiContext): boolean {
  if (btn.disabled || !ui.pointerClicked) return false;
  if (!hitRect(ui.pointerX, ui.pointerY, btn.x, btn.y, btn.w, btn.h)) return false;
  btn.onClick?.();
  return true;
}

// ── Card ────────────────────────────────────────────────────────────────────

export function drawCard(ctx: CanvasRenderingContext2D, card: CardDef, ui: UiContext): void {
  const { token, accent } = ui;
  const r = Math.max(2, pad(token, 0.3));
  ctx.save();
  ctx.fillStyle = token.card;
  roundRectPath(ctx, card.x, card.y, card.w, card.h, r);
  ctx.fill();
  ctx.strokeStyle = token.cardStroke;
  ctx.lineWidth = 1;
  ctx.stroke();
  // Top signal hairline
  ctx.fillStyle = `${accent}66`;
  ctx.fillRect(card.x + r, card.y, card.w - r * 2, 2);
  ctx.restore();
}

/** Quiet list row — no full card chrome. */
export function drawRow(
  ctx: CanvasRenderingContext2D,
  row: CardDef,
  ui: UiContext,
  opts: { hovered?: boolean; divider?: boolean } = {},
): void {
  const { token } = ui;
  ctx.save();
  if (opts.hovered) {
    ctx.fillStyle = token.bgElevated;
    ctx.fillRect(row.x, row.y, row.w, row.h);
  }
  if (opts.divider !== false) {
    ctx.strokeStyle = token.cardStroke;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.moveTo(row.x + pad(token, 0.5), row.y + row.h);
    ctx.lineTo(row.x + row.w - pad(token, 0.5), row.y + row.h);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

export function drawSectionTitle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  label: string,
  ui: UiContext,
): number {
  const { token, accent } = ui;
  ctx.save();
  setFont(ctx, token, token.fontCaption, '700', true);
  ctx.fillStyle = token.textMuted;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(label.toUpperCase(), x, y);
  const tw = ctx.measureText(label.toUpperCase()).width;
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.7;
  ctx.fillRect(x + tw + pad(token, 0.75), y + token.fontCaption * 0.45, pad(token, 3), 1.5);
  ctx.restore();
  return token.fontCaption + pad(token, 0.75);
}

export interface ScrollState {
  offset: number;
  max: number;
}

export function clampScroll(state: ScrollState): void {
  state.offset = Math.max(0, Math.min(state.max, state.offset));
}

export function beginClip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
}

export function endClip(ctx: CanvasRenderingContext2D): void {
  ctx.restore();
}

export function wheelScroll(state: ScrollState, deltaY: number, page = 48): void {
  state.offset += deltaY > 0 ? page * 0.35 : -page * 0.35;
  clampScroll(state);
}

// ── Menu shell + content scroller ───────────────────────────────────────────

export interface ShellLayout {
  headerRect: Rect;
  /** Vertical center line for header controls (under safe.top). */
  headerMidY: number;
  contentRect: Rect;
  footerRect: Rect | null;
}

export function layoutShell(
  w: number,
  h: number,
  token: ThemeTokens,
  opts: { footer?: boolean; footerH?: number } = {},
): ShellLayout {
  const band = headerBandH(token);
  const headerRect: Rect = { x: 0, y: 0, w, h: band };
  const headerMidY = headerContentTop(token) + headerContentH(token) * 0.5;

  const footerH = opts.footer
    ? (opts.footerH ?? ensureMinTouch(pad(token, 5.5), token) + pad(token, 2) + token.safe.bottom)
    : 0;
  const footerRect: Rect | null = opts.footer
    ? {
        x: pad(token, 2) + token.safe.left,
        y: h - footerH,
        w: w - pad(token, 4) - token.safe.left - token.safe.right,
        h: footerH,
      }
    : null;

  const contentRect: Rect = {
    x: pad(token, 2) + token.safe.left,
    y: band + pad(token, 1),
    w: w - pad(token, 4) - token.safe.left - token.safe.right,
    h: Math.max(
      pad(token, 4),
      h - band - pad(token, 1) - footerH - (opts.footer ? 0 : token.safe.bottom + pad(token, 1)),
    ),
  };

  return { headerRect, headerMidY, contentRect, footerRect };
}

/**
 * Clip + scroll region for menu bodies.
 * Content is drawn in local coords: x=0..view.w, y=0..contentH (after begin).
 * Use localUi() for hit-testing buttons drawn in that space.
 */
export class ContentScroller {
  readonly scroll: ScrollState = { offset: 0, max: 0 };
  /** Fired once per user-initiated scroll (drag commit or wheel) — dismiss tooltips. */
  onUserScroll: (() => void) | null = null;
  private dragging = false;
  private dragStartY = 0;
  private dragStartX = 0;
  private scrollAtDrag = 0;
  private dragDist = 0;
  private didScroll = false;
  private suppressClick = false;
  private bound: Rect = { x: 0, y: 0, w: 0, h: 0 };

  layout(view: Rect, contentH: number): void {
    this.bound = view;
    this.scroll.max = Math.max(0, contentH - view.h);
    clampScroll(this.scroll);
  }

  onWheel(deltaY: number): void {
    const before = this.scroll.offset;
    wheelScroll(this.scroll, deltaY);
    if (this.scroll.offset !== before) this.onUserScroll?.();
  }

  begin(ctx: CanvasRenderingContext2D, view: Rect = this.bound): void {
    beginClip(ctx, view.x, view.y, view.w, view.h);
    ctx.translate(view.x, view.y - this.scroll.offset);
  }

  end(ctx: CanvasRenderingContext2D): void {
    endClip(ctx);
  }

  /** True while this gesture has committed to vertical scrolling. */
  get isScrolling(): boolean {
    return this.didScroll;
  }

  /** Pointer in content-local space; clicks suppressed after a drag scroll. */
  localUi(ui: UiContext, view: Rect = this.bound): UiContext {
    const inside = hitRect(ui.pointerX, ui.pointerY, view.x, view.y, view.w, view.h);
    return {
      ...ui,
      pointerX: ui.pointerX - view.x,
      pointerY: ui.pointerY - view.y + this.scroll.offset,
      pointerClicked: ui.pointerClicked && inside && !this.suppressClick,
      // Block controls once the gesture is a scroll (keeps sliders from fighting).
      pointerDown: ui.pointerDown && inside && !this.didScroll,
    };
  }

  /** Call once per frame after measuring content. Handles drag-scroll. */
  update(ui: UiContext, view: Rect = this.bound): void {
    const inside = hitRect(ui.pointerX, ui.pointerY, view.x, view.y, view.w, view.h);

    if (ui.pointerDown && !this.dragging && inside) {
      this.dragging = true;
      this.dragStartY = ui.pointerY;
      this.dragStartX = ui.pointerX;
      this.scrollAtDrag = this.scroll.offset;
      this.dragDist = 0;
      this.didScroll = false;
    }

    if (this.dragging && ui.pointerDown) {
      const dy = ui.pointerY - this.dragStartY;
      const dx = ui.pointerX - this.dragStartX;
      this.dragDist = Math.max(this.dragDist, Math.abs(dy), Math.abs(dx));
      if (Math.abs(dy) > 8 && Math.abs(dy) >= Math.abs(dx) * 1.15) {
        if (!this.didScroll) this.onUserScroll?.();
        this.didScroll = true;
        this.scroll.offset = this.scrollAtDrag - dy;
        clampScroll(this.scroll);
      }
    }

    if (!ui.pointerDown && this.dragging) {
      if (this.didScroll || this.dragDist > 10) this.suppressClick = true;
      this.dragging = false;
      this.didScroll = false;
    } else if (!ui.pointerClicked) {
      this.suppressClick = false;
    }
  }

  attachWheel(canvas: HTMLCanvasElement, shouldScroll: () => boolean = () => true): () => void {
    const onWheel = (ev: WheelEvent): void => {
      if (!shouldScroll()) return;
      ev.preventDefault();
      this.onWheel(ev.deltaY);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }
}

// ── Slider (thin track, fat hit) ─────────────────────────────────────────────

export interface SliderDef {
  x: number;
  y: number;
  w: number;
  /** Visual track height (keep thin — not touchMin). */
  h: number;
  label: string;
  value: number;
  onChange?: (v: number) => void;
}

/** Full vertical pitch for one labeled slider row. */
export function sliderRowH(token: ThemeTokens): number {
  const track = pad(token, 0.75);
  return token.fontCaption + pad(token, 0.5) + track + pad(token, 2.5);
}

export function drawSlider(ctx: CanvasRenderingContext2D, slider: SliderDef, ui: UiContext): void {
  const { token } = ui;
  const trackH = Math.min(slider.h, pad(token, 1));
  const labelH = token.fontCaption + pad(token, 0.35);
  const trackY = slider.y + labelH;

  ctx.save();
  setFont(ctx, token, token.fontCaption, '600');
  ctx.fillStyle = token.textMuted;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const pct = `${Math.round(slider.value * 100)}%`;
  setFont(ctx, token, token.fontCaption, '500');
  const pctW = ctx.measureText(pct).width;
  setFont(ctx, token, token.fontCaption, '600');
  ctx.fillText(
    truncateText(ctx, slider.label, Math.max(pad(token, 4), slider.w - pctW - pad(token, 1))),
    slider.x,
    slider.y,
  );

  setFont(ctx, token, token.fontCaption, '500');
  ctx.fillStyle = token.textDim;
  ctx.textAlign = 'right';
  ctx.fillText(pct, slider.x + slider.w, slider.y);

  ctx.fillStyle = token.bgElevated;
  roundRectPath(ctx, slider.x, trackY, slider.w, trackH, trackH * 0.5);
  ctx.fill();

  const fillW = slider.w * Math.max(0, Math.min(1, slider.value));
  ctx.fillStyle = ui.accent;
  roundRectPath(ctx, slider.x, trackY, Math.max(trackH, fillW), trackH, trackH * 0.5);
  ctx.fill();

  const knobR = Math.max(trackH * 0.85, pad(token, 0.7));
  const knobX = slider.x + Math.max(knobR, Math.min(slider.w - knobR, fillW));
  ctx.beginPath();
  ctx.arc(knobX, trackY + trackH * 0.5, knobR, 0, Math.PI * 2);
  ctx.fillStyle = token.text;
  ctx.fill();
  ctx.restore();
}

/** Slider currently held — keeps the gesture alive when the drag leaves the track. */
let capturedSlider: SliderDef | null = null;

export function handleSlider(slider: SliderDef, ui: UiContext): boolean {
  const { token } = ui;
  const trackH = Math.min(slider.h, pad(token, 1));
  const labelH = token.fontCaption + pad(token, 0.35);
  const trackY = slider.y + labelH;
  const hitPad = (token.touchMin - trackH) * 0.5;
  const hitY = trackY - hitPad;
  const hitH = trackH + hitPad * 2;
  if (!ui.pointerDown) {
    if (capturedSlider === slider) capturedSlider = null;
    return false;
  }
  const captured = capturedSlider === slider;
  if (!captured && !hitRect(ui.pointerX, ui.pointerY, slider.x, hitY, slider.w, hitH)) return false;
  capturedSlider = slider;
  const v = Math.max(0, Math.min(1, (ui.pointerX - slider.x) / slider.w));
  slider.onChange?.(v);
  return true;
}

/** Draw a row of footer action buttons; returns true if any handled. */
export function drawFooterActions(
  ctx: CanvasRenderingContext2D,
  footer: Rect,
  buttons: ButtonDef[],
  ui: UiContext,
): void {
  const { token } = ui;
  const gap = pad(token, 0.75);
  const btnH = ensureMinTouch(pad(token, 5.5), token);
  const n = buttons.length;
  if (n === 0) return;
  const btnW = (footer.w - gap * (n - 1)) / n;
  const y = footer.y + pad(token, 0.75);
  buttons.forEach((btn, i) => {
    btn.x = footer.x + i * (btnW + gap);
    btn.y = y;
    btn.w = btnW;
    btn.h = btnH;
    drawButton(ctx, btn, ui);
  });
}

export function handleFooterActions(buttons: ButtonDef[], ui: UiContext): boolean {
  let handled = false;
  for (const btn of buttons) {
    if (handleButton(btn, ui)) handled = true;
  }
  return handled;
}

// ── StatBar ─────────────────────────────────────────────────────────────────

export function drawStatBar(ctx: CanvasRenderingContext2D, bar: StatBarDef, ui: UiContext): void {
  const { token, accent } = ui;
  const value = Math.max(0, Math.min(100, bar.value));
  const barH = pad(token, 0.75);
  const labelH = token.fontCaption + pad(token, 0.25);
  const trackY = bar.y + labelH;
  const fillColor = bar.color ?? accent;

  ctx.save();
  setFont(ctx, token, token.fontCaption, '500');
  ctx.fillStyle = token.textMuted;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(bar.label, bar.x, bar.y);

  if (bar.info !== undefined) {
    const r = infoIconRadius(token);
    drawInfoIcon(ctx, statBarInfoIconX(ctx, bar, token) + r, bar.y + token.fontCaption * 0.45, r, ui, false);
  }

  if (!bar.hideValue) {
    setFont(ctx, token, token.fontCaption, '600');
    ctx.textAlign = 'right';
    ctx.fillStyle = token.text;
    ctx.fillText(`${String(Math.round(value))}${bar.suffix ?? ''}`, bar.x + bar.w, bar.y);
  }

  ctx.fillStyle = token.bgElevated;
  roundRectPath(ctx, bar.x, trackY, bar.w, barH, barH * 0.5);
  ctx.fill();

  if (value > 0) {
    ctx.fillStyle = fillColor;
    roundRectPath(ctx, bar.x, trackY, bar.w * (value / 100), barH, barH * 0.5);
    ctx.fill();
  }
  ctx.restore();
}

export function statBarHeight(token: ThemeTokens): number {
  return token.fontCaption + pad(token, 0.25) + pad(token, 0.75);
}

// ── Info tooltips ───────────────────────────────────────────────────────────

/** Explanation payload attached to a stat via its (i) hotspot. */
export interface TooltipInfo {
  title: string;
  body: string;
}

interface InfoHotspot {
  /** Rect in the coordinate space where the stat was drawn (scroller-local OK). */
  rect: Rect;
  /** Local→screen translation (e.g. scroller view origin minus scroll offset). */
  origin: { x: number; y: number };
  info: TooltipInfo;
}

/** Painted ⓘ glyph — ring + dot/stem, tinted accent while its tooltip is open. */
export function drawInfoIcon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  ui: UiContext,
  active: boolean,
): void {
  ctx.save();
  const ink = active ? ui.accent : `${ui.token.textMuted}cc`;
  ctx.lineWidth = Math.max(1.2, r * 0.26);
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy - r * 0.44, r * 0.13, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(cx - r * 0.12, cy - r * 0.08, r * 0.24, r * 0.6, r * 0.12);
  ctx.fill();
  ctx.restore();
}

/** Visual radius for an inline stat (i). */
export function infoIconRadius(token: ThemeTokens): number {
  return Math.max(7, token.fontCaption * 0.66);
}

/** X where a stat-bar's (i) starts, just past its measured label. */
function statBarInfoIconX(
  ctx: CanvasRenderingContext2D,
  bar: StatBarDef,
  token: ThemeTokens,
): number {
  setFont(ctx, token, token.fontCaption, '500');
  return bar.x + ctx.measureText(bar.label).width + pad(token, 0.6);
}

/**
 * Hit rect for a stat-bar's (i). Slightly under touchMin so dense card stacks
 * don't overlap neighbouring rows' targets.
 */
export function statBarInfoHit(
  ctx: CanvasRenderingContext2D,
  bar: StatBarDef,
  token: ThemeTokens,
): Rect {
  const r = infoIconRadius(token);
  const cx = statBarInfoIconX(ctx, bar, token) + r;
  const cy = bar.y + token.fontCaption * 0.45;
  const side = Math.max(Math.round(r * 2.8), pad(token, 3));
  return { x: cx - side * 0.5, y: cy - side * 0.5, w: side, h: side };
}

/**
 * Tap-to-toggle explainer cards for stat (i) hotspots.
 * Per-frame contract: beginFrame() → register()/registerStatBar() while drawing
 * → handle() once after content input → draw() after all other content layers.
 */
export class TooltipManager {
  private hotspots: InfoHotspot[] = [];
  private activeIndex = -1;

  beginFrame(): void {
    this.hotspots = [];
  }

  close(): void {
    this.activeIndex = -1;
  }

  get isOpen(): boolean {
    return this.activeIndex >= 0 && this.activeIndex < this.hotspots.length;
  }

  /**
   * Register an (i) hotspot for this frame. `rect` lives in the same space the
   * stat was drawn in; pass the local→screen origin when inside a scroller.
   */
  register(rect: Rect, info: TooltipInfo, origin: { x: number; y: number } = { x: 0, y: 0 }): void {
    this.hotspots.push({ rect, origin, info });
  }

  /** Convenience for stats drawn via drawStatBar. */
  registerStatBar(
    ctx: CanvasRenderingContext2D,
    bar: StatBarDef,
    token: ThemeTokens,
    origin: { x: number; y: number } = { x: 0, y: 0 },
  ): void {
    if (bar.info !== undefined) this.register(statBarInfoHit(ctx, bar, token), bar.info, origin);
  }

  /** Resolve taps: toggle on (i), switch between them, dismiss on anywhere else. */
  handle(ui: UiContext, allowInput = true): void {
    if (!allowInput || !ui.pointerClicked) return;
    let tapped = -1;
    for (let i = this.hotspots.length - 1; i >= 0; i--) {
      const h = this.hotspots[i]!;
      const { x, y } = h.rect;
      if (hitRect(ui.pointerX, ui.pointerY, x, y, h.rect.w, h.rect.h)) {
        tapped = i;
        break;
      }
    }
    this.activeIndex = tapped >= 0 ? (this.activeIndex === tapped ? -1 : tapped) : -1;
  }

  /** Draw the open tooltip card, viewport-clamped near its hotspot. */
  draw(ctx: CanvasRenderingContext2D, ui: UiContext): void {
    const spot = this.hotspots[this.activeIndex];
    if (!spot) return;
    const { token } = ui;
    // Hotspot in screen space for placement.
    const hx = spot.rect.x + spot.origin.x;
    const hy = spot.rect.y + spot.origin.y;
    const boxW = Math.min(ui.w - pad(token, 4) - token.safe.left - token.safe.right, pad(token, 36));
    const padX = pad(token, 1.25);
    const padY = pad(token, 1);
    const lineH = token.fontCaption * 1.4;

    setFont(ctx, token, token.fontCaption, '700', true);
    const titleLines = wrapText(ctx, spot.info.title.toUpperCase(), boxW - padX * 2, 1);
    setFont(ctx, token, token.fontCaption, '500');
    const bodyLines = wrapText(ctx, spot.info.body, boxW - padX * 2, 8);
    const titleH = titleLines.length > 0 ? token.fontCaption + pad(token, 0.4) : 0;
    const boxH = padY * 2 + titleH + bodyLines.length * lineH;

    // Prefer above the hotspot; flip below when clipped; clamp into view.
    let x = hx + spot.rect.w * 0.5 - boxW * 0.5;
    x = Math.max(token.safe.left + pad(token, 1), Math.min(x, ui.w - token.safe.right - pad(token, 1) - boxW));
    let y = hy - pad(token, 0.75) - boxH;
    if (y < token.safe.top + pad(token, 1)) {
      y = hy + spot.rect.h + pad(token, 0.75);
    }
    y = Math.min(y, ui.h - token.safe.bottom - pad(token, 1) - boxH);

    ctx.save();
    ctx.fillStyle = token.card;
    roundRectPath(ctx, x, y, boxW, boxH, pad(token, 0.5));
    ctx.fill();
    ctx.strokeStyle = `${ui.accent}88`;
    ctx.lineWidth = 1;
    roundRectPath(ctx, x, y, boxW, boxH, pad(token, 0.5));
    ctx.stroke();

    let ty = y + padY;
    if (titleLines.length > 0) {
      setFont(ctx, token, token.fontCaption, '700', true);
      ctx.fillStyle = ui.accent;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(titleLines[0]!, x + padX, ty);
      ty += titleH;
    }
    setFont(ctx, token, token.fontCaption, '500');
    ctx.fillStyle = token.text;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    for (const line of bodyLines) {
      ctx.fillText(line, x + padX, ty);
      ty += lineH;
    }
    ctx.restore();
  }
}

// ── RadarChart ──────────────────────────────────────────────────────────────

export function drawRadarChart(ctx: CanvasRenderingContext2D, chart: RadarChartDef, ui: UiContext): void {
  const { token, accent } = ui;
  const cx = chart.x + chart.radius;
  const cy = chart.y + chart.radius;
  const n = RADAR_KEYS.length;
  const angles = Array.from({ length: n }, (_, i) => -Math.PI / 2 + (i * 2 * Math.PI) / n);

  ctx.save();

  for (let ring = 1; ring <= 4; ring++) {
    const rr = (chart.radius * ring) / 4;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const a = angles[i]!;
      const px = cx + Math.cos(a) * rr;
      const py = cy + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.strokeStyle = token.cardStroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  for (let i = 0; i < n; i++) {
    const a = angles[i]!;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * chart.radius, cy + Math.sin(a) * chart.radius);
    ctx.strokeStyle = token.cardStroke;
    ctx.stroke();
  }

  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const key = RADAR_KEYS[i]!;
    const v = Math.max(0, Math.min(100, chart.values[key])) / 100;
    const a = angles[i]!;
    const px = cx + Math.cos(a) * chart.radius * v;
    const py = cy + Math.sin(a) * chart.radius * v;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = `${accent}44`;
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  ctx.stroke();

  setFont(ctx, token, token.fontCaption, '500');
  ctx.fillStyle = token.textMuted;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Clamp labels to the drawing surface when viewW is given; otherwise keep
  // them inside the chart footprint. Chart-footprint clamping pulled opposite
  // labels (e.g. Accel/Downforce) toward the center at the same height and
  // they collided on narrow phones.
  const labelInset = pad(token, 0.25);
  const hasView = chart.viewW !== undefined;
  const minX = hasView ? labelInset : chart.x + labelInset;
  const maxX = hasView ? chart.viewW! - labelInset : chart.x + chart.radius * 2 - labelInset;
  for (let i = 0; i < n; i++) {
    const a = angles[i]!;
    const label = RADAR_LABELS[i]!;
    let lx = cx + Math.cos(a) * (chart.radius + pad(token, 1.25));
    const ly = cy + Math.sin(a) * (chart.radius + pad(token, 1.25));
    const half = ctx.measureText(label).width * 0.5;
    lx = Math.max(minX + half, Math.min(maxX - half, lx));
    ctx.fillText(label, lx, ly);
  }

  ctx.restore();
}

// ── Modal ───────────────────────────────────────────────────────────────────

/** Shared modal geometry — drawing, hit-testing, and overlays must agree. */
export interface ModalBoxRect {
  boxX: number;
  boxY: number;
  boxW: number;
  boxH: number;
  bodyY: number;
  btnX: number;
  btnY: number;
  btnW: number;
  btnH: number;
}

export function modalBoxRect(modal: ModalDef, ui: UiContext): ModalBoxRect {
  const { token, w, h } = ui;
  const boxW = Math.min(w - pad(token, 4), pad(token, 40));
  const btnH = ensureMinTouch(pad(token, 5.5), token);
  const btnGap = pad(token, 0.75);
  const hasButtons = modal.buttons.length > 0;
  const btnRowH = hasButtons ? btnH + pad(token, 2) : 0;
  const bodyLines = modal.body.split('\n').length;
  const bodyH = bodyLines * token.fontBody * 1.35 + pad(token);
  const boxH = pad(token, 3) + token.fontTitle + pad(token) + bodyH + btnRowH + pad(token);
  const boxX = (w - boxW) * 0.5;
  const boxY = (h - boxH) * 0.5;
  const btnW = hasButtons
    ? (boxW - pad(token, 3) - btnGap * (modal.buttons.length - 1)) / modal.buttons.length
    : 0;
  return {
    boxX,
    boxY,
    boxW,
    boxH,
    bodyY: boxY + pad(token, 1.5) + token.fontTitle + pad(token, 0.75),
    btnX: boxX + pad(token, 1.5),
    btnY: boxY + boxH - pad(token, 1.5) - btnH,
    btnW,
    btnH,
  };
}

export function drawModal(ctx: CanvasRenderingContext2D, modal: ModalDef, ui: UiContext): void {
  if (!modal.open) return;
  const { token } = ui;

  ctx.save();
  ctx.fillStyle = token.overlay;
  ctx.fillRect(0, 0, ui.w, ui.h);

  const box = modalBoxRect(modal, ui);
  drawCard(ctx, { x: box.boxX, y: box.boxY, w: box.boxW, h: box.boxH }, ui);

  setFont(ctx, token, token.fontTitle, '700');
  ctx.fillStyle = token.text;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(modal.title, box.boxX + box.boxW * 0.5, box.boxY + pad(token, 1.5));

  setFont(ctx, token, token.fontBody, '400');
  ctx.fillStyle = token.textMuted;
  const lines = modal.body.split('\n');
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i]!, box.boxX + box.boxW * 0.5, box.bodyY + i * token.fontBody * 1.35);
  }

  let btnX = box.btnX;
  for (const btn of modal.buttons) {
    drawButton(ctx, { ...btn, x: btnX, y: box.btnY, w: box.btnW, h: box.btnH }, ui);
    btnX += box.btnW + pad(token, 0.75);
  }

  ctx.restore();
}

export function handleModal(modal: ModalDef, ui: UiContext): boolean {
  if (!modal.open) return false;
  let handled = false;
  for (const btn of modal.buttons) {
    if (handleButton(btn, ui)) handled = true;
  }
  return handled;
}

export function layoutModalButtons(modal: ModalDef, ui: UiContext): void {
  if (!modal.open) return;
  const box = modalBoxRect(modal, ui);
  let btnX = box.btnX;
  for (const btn of modal.buttons) {
    btn.x = btnX;
    btn.y = box.btnY;
    btn.w = box.btnW;
    btn.h = box.btnH;
    btnX += box.btnW + pad(ui.token, 0.75);
  }
}

// ── Toast manager ───────────────────────────────────────────────────────────

export class ToastManager {
  private items: ToastItem[] = [];
  private nextId = 1;
  readonly defaultTtl = 2.8;

  push(message: string, accent?: string, ttl = this.defaultTtl): void {
    this.items.push({ id: this.nextId++, message, ttl, accent });
  }

  update(dt: number): void {
    for (const item of this.items) {
      item.ttl -= dt;
    }
    this.items = this.items.filter((t) => t.ttl > 0);
  }

  draw(ctx: CanvasRenderingContext2D, ui: UiContext, opts: { avoidBottomPx?: number } = {}): void {
    if (this.items.length === 0) return;
    const { token, w } = ui;
    const toastW = Math.min(w - pad(token, 4), pad(token, 44));
    let y = ui.h - (opts.avoidBottomPx ?? 0) - pad(token, 2) - token.safe.bottom;

    ctx.save();
    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i]!;
      const measured = layoutHintBox(ctx, {
        x: (w - toastW) * 0.5,
        y: 0,
        maxW: toastW,
        text: item.message,
        accent: item.accent ?? ui.accent,
        token,
        maxLines: 2,
        fontSize: token.fontBody,
        fill: 'card',
      });
      y -= measured.h + pad(token, 0.75);
      const alpha = Math.min(1, item.ttl / 0.35);
      ctx.globalAlpha = alpha;
      drawHintBox(ctx, {
        x: measured.x,
        y,
        maxW: toastW,
        text: item.message,
        accent: item.accent ?? ui.accent,
        token,
        maxLines: 2,
        fontSize: token.fontBody,
        fill: 'card',
      });
    }
    ctx.restore();
  }
}

// ── Shared formatting / sizing helpers ──────────────────────────────────────

/** Standard full-width hero CTA height (hub + setup screens). */
export function ctaHeight(token: ThemeTokens): number {
  return ensureMinTouch(pad(token, 7), token);
}

/** "$12,400" — the one currency format across HUD + menus. */
export function fmtCash(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

// ── Header ──────────────────────────────────────────────────────────────────

function headerIconSize(token: ThemeTokens): number {
  return ensureMinTouch(pad(token, 5), token);
}

function headerBackRect(header: HeaderDef, token: ThemeTokens): Rect {
  const btnSize = headerIconSize(token);
  const midY = headerContentTop(token) + headerContentH(token) * 0.5;
  return {
    x: header.x + pad(token, 0.5) + token.safe.left,
    y: midY - btnSize * 0.5,
    w: btnSize,
    h: btnSize,
  };
}

function headerSettingsRect(header: HeaderDef, token: ThemeTokens): Rect {
  const btnSize = headerIconSize(token);
  const midY = headerContentTop(token) + headerContentH(token) * 0.5;
  const rightEdge = header.x + header.w - pad(token, 0.5) - token.safe.right;
  return {
    x: rightEdge - btnSize,
    y: midY - btnSize * 0.5,
    w: btnSize,
    h: btnSize,
  };
}

function drawHeaderIconHit(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  hovered: boolean,
  accent: string,
): void {
  if (!hovered) return;
  ctx.save();
  ctx.fillStyle = `${accent}22`;
  ctx.beginPath();
  ctx.arc(rect.x + rect.w * 0.5, rect.y + rect.h * 0.5, rect.h * 0.42, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBackChevron(ctx: CanvasRenderingContext2D, rect: Rect, color: string): void {
  const cx = rect.x + rect.w * 0.5;
  const cy = rect.y + rect.h * 0.5;
  const s = rect.h * 0.16;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(cx + s * 0.4, cy - s * 1.3);
  ctx.lineTo(cx - s, cy);
  ctx.lineTo(cx + s * 0.4, cy + s * 1.3);
  ctx.stroke();
  ctx.restore();
}

export function drawHeader(ctx: CanvasRenderingContext2D, header: HeaderDef, ui: UiContext): void {
  const { token, accent } = ui;
  const midY = headerContentTop(token) + headerContentH(token) * 0.5;

  ctx.save();
  ctx.fillStyle = 'rgba(11,13,12,0.78)';
  ctx.fillRect(header.x, header.y, header.w, header.h);
  ctx.fillStyle = `${accent}99`;
  ctx.fillRect(header.x, header.y + header.h - 1, header.w, 1);

  let left = header.x + pad(token, 0.5) + token.safe.left;
  let right = header.x + header.w - pad(token, 0.5) - token.safe.right;

  if (header.back) {
    const back = headerBackRect(header, token);
    const hovered = hitRect(ui.pointerX, ui.pointerY, back.x, back.y, back.w, back.h);
    drawHeaderIconHit(ctx, back, hovered, accent);
    drawBackChevron(ctx, back, hovered ? accent : token.text);
    left = back.x + back.w + pad(token, 0.5);
  }

  if (header.settings) {
    const settings = headerSettingsRect(header, token);
    const hovered = hitRect(ui.pointerX, ui.pointerY, settings.x, settings.y, settings.w, settings.h);
    drawHeaderIconHit(ctx, settings, hovered, accent);
    drawGearIcon(
      ctx,
      settings.x + settings.w * 0.5,
      settings.y + settings.h * 0.5,
      Math.min(settings.w, settings.h) * 0.18,
      hovered ? accent : token.textMuted,
    );
    right = settings.x - pad(token, 0.5);
  }

  if (header.cash !== undefined) {
    setFont(ctx, token, token.fontCaption, '700');
    const cashStr = fmtCash(header.cash);
    const cashW = ctx.measureText(cashStr).width;
    ctx.fillStyle = accent;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(cashStr, right, midY);
    right -= cashW + pad(token, 1);
  }

  if (header.title !== '') {
    const titleMax = Math.max(0, right - left);
    setFont(ctx, token, token.fontBody, '600', true);
    ctx.fillStyle = token.textMuted;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(truncateText(ctx, header.title.toUpperCase(), titleMax), left, midY);
  }

  ctx.restore();
}

export function handleHeader(header: HeaderDef, ui: UiContext): boolean {
  const { token } = ui;
  let handled = false;

  if (header.back) {
    const back = headerBackRect(header, token);
    const backBtn: ButtonDef = {
      x: back.x,
      y: back.y,
      w: back.w,
      h: back.h,
      label: '←',
      onClick: header.onBack,
    };
    if (handleButton(backBtn, ui)) handled = true;
  }

  if (header.settings) {
    const settings = headerSettingsRect(header, token);
    const settingsBtn: ButtonDef = {
      x: settings.x,
      y: settings.y,
      w: settings.w,
      h: settings.h,
      label: 'Options',
      onClick: header.onSettings,
    };
    if (handleButton(settingsBtn, ui)) handled = true;
  }

  return handled;
}

// ── DriverSpendPanel ────────────────────────────────────────────────────────

const PLUS_SIZE_UNITS = 4.5;

function driverPlusSize(token: ThemeTokens): number {
  return ensureMinTouch(pad(token, PLUS_SIZE_UNITS), token);
}

/**
 * Vertical pitch of one stat row. When the + button shows, the pitch grows to
 * contain it — a 48px button on a ~20px row painted four overlapping plates.
 */
function driverRowPitch(token: ThemeTokens, showPlus: boolean): number {
  const barH = statBarHeight(token);
  if (!showPlus) return barH + pad(token, 0.5);
  return Math.max(barH + pad(token, 0.5), driverPlusSize(token) + pad(token, 0.5));
}

export function drawDriverSpendPanel(
  ctx: CanvasRenderingContext2D,
  panel: DriverSpendPanelDef,
  ui: UiContext,
): void {
  const { token, accent } = ui;
  const d = panel.driver;
  const plusSize = driverPlusSize(token);
  const showPlus = d.unspentPoints > 0;
  const pitch = driverRowPitch(token, showPlus);
  const actionBtnH = ensureMinTouch(pad(token, 4.5), token);
  const stats: DriverStatKey[] = ['skill', 'bravery', 'focus', 'determination'];

  drawCard(ctx, { x: panel.x, y: panel.y, w: panel.w, h: driverSpendPanelHeight(panel, token) }, ui);

  let y = panel.y + pad(token, 1.5);
  setFont(ctx, token, token.fontTitle, '700');
  ctx.fillStyle = token.text;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  let nameMax = panel.w - pad(token, 3);
  if (d.traitDescription !== undefined) nameMax -= infoIconRadius(token) * 3;
  ctx.fillText(truncateText(ctx, d.name, nameMax), panel.x + pad(token, 1.5), y);
  y += token.fontTitle + pad(token, 0.25);

  // Trait line + optional ⓘ describing what the trait does.
  setFont(ctx, token, token.fontCaption, '500');
  ctx.fillStyle = accent;
  const traitStr = truncateText(ctx, `${d.trait} · Lv ${d.level}`, nameMax);
  ctx.fillText(traitStr, panel.x + pad(token, 1.5), y);
  if (d.traitDescription !== undefined && panel.registerInfo !== undefined) {
    const r = infoIconRadius(token);
    const icx = panel.x + pad(token, 1.5) + ctx.measureText(traitStr).width + r * 1.6;
    const icy = y + token.fontCaption * 0.45;
    drawInfoIcon(ctx, icx, icy, r, ui, false);
    panel.registerInfo(
      { x: icx - r * 1.6, y: icy - r * 1.6, w: r * 3.2, h: r * 3.2 },
      { title: d.trait, body: d.traitDescription },
    );
  }
  y += token.fontCaption + pad(token, 0.75);

  if (d.unspentPoints > 0) {
    setFont(ctx, token, token.fontCaption, '600');
    ctx.fillStyle = token.success;
    ctx.fillText(`${d.unspentPoints} point${d.unspentPoints === 1 ? '' : 's'} to spend`, panel.x + pad(token, 1.5), y);
    y += token.fontCaption + pad(token, 0.5);
  }

  const xpRatio = d.xpToNext > 0 ? d.xp / d.xpToNext : 0;
  const xpBar: StatBarDef = {
    x: panel.x + pad(token, 1.5),
    y,
    w: panel.w - pad(token, 3),
    label: `XP ${Math.round(d.xp)}/${Math.round(d.xpToNext)}`,
    value: xpRatio * 100,
    color: token.textDim,
    // The label carries the real numbers — a bare percent next to them misreads.
    hideValue: true,
    info: { title: 'Experience', body: DRIVER_XP_INFO },
  };
  drawStatBar(ctx, xpBar, ui);
  if (panel.registerInfo !== undefined && xpBar.info !== undefined) {
    setFont(ctx, token, token.fontCaption, '500');
    panel.registerInfo(statBarInfoHit(ctx, xpBar, token), xpBar.info);
  }
  y += statBarHeight(token) + pad(token, 0.75);

  for (const key of stats) {
    const value = d[key];
    const barW = panel.w - pad(token, 3) - (showPlus ? plusSize + pad(token, 0.5) : 0);

    const statBar: StatBarDef = {
      x: panel.x + pad(token, 1.5),
      y,
      w: barW,
      label: STAT_LABELS[key],
      value,
      info: { title: STAT_LABELS[key], body: DRIVER_STAT_INFO[key] },
    };
    drawStatBar(ctx, statBar, ui);
    if (panel.registerInfo !== undefined && statBar.info !== undefined) {
      setFont(ctx, token, token.fontCaption, '500');
      panel.registerInfo(statBarInfoHit(ctx, statBar, token), statBar.info);
    }

    if (showPlus) {
      const plusBtn: ButtonDef = {
        x: panel.x + panel.w - pad(token, 1.5) - plusSize,
        y: y + (pitch - plusSize) * 0.5,
        w: plusSize,
        h: plusSize,
        label: '+',
        primary: true,
        onClick: () => panel.onSpend?.(key),
      };
      drawButton(ctx, plusBtn, ui);
    }

    y += pitch;
  }

  if (panel.actions !== undefined && panel.actions.length > 0) {
    y += pad(token, 0.25);
    for (const action of panel.actions) {
      drawButton(
        ctx,
        {
          x: panel.x + pad(token, 1.5),
          y,
          w: panel.w - pad(token, 3),
          h: actionBtnH,
          label: action.label,
          disabled: action.disabled,
          danger: action.danger,
          onClick: action.onClick,
        },
        ui,
      );
      y += actionBtnH + pad(token, 0.5);
    }
  }
}

export function driverSpendPanelHeight(panel: DriverSpendPanelDef, token: ThemeTokens): number {
  const stats = 4;
  const showPlus = panel.driver.unspentPoints > 0;
  const pitch = driverRowPitch(token, showPlus);
  const hasActions = panel.actions !== undefined && panel.actions.length > 0;
  // Mirrors the draw chain: name/trait header, optional spend line, XP, stats, actions.
  let h =
    pad(token, 1.5) +
    token.fontTitle +
    pad(token, 0.25) +
    token.fontCaption +
    pad(token, 0.75);
  if (showPlus) {
    h += token.fontCaption + pad(token, 0.5);
  }
  h += statBarHeight(token) + pad(token, 0.75) + stats * pitch;
  if (hasActions) {
    const btnH = ensureMinTouch(pad(token, 4.5), token);
    h += pad(token, 0.25) + panel.actions!.length * (btnH + pad(token, 0.5));
  }
  return h + pad(token, 0.75);
}

export function handleDriverSpendPanel(panel: DriverSpendPanelDef, ui: UiContext): boolean {
  const hasActions = panel.actions !== undefined && panel.actions.length > 0;
  const showPlus = panel.driver.unspentPoints > 0;
  if (!showPlus && !hasActions) return false;
  const { token } = ui;
  const plusSize = driverPlusSize(token);
  const pitch = driverRowPitch(token, showPlus);
  const stats: DriverStatKey[] = ['skill', 'bravery', 'focus', 'determination'];

  let y =
    panel.y +
    pad(token, 1.5) +
    token.fontTitle +
    pad(token, 0.25) +
    token.fontCaption +
    pad(token, 0.75);

  if (showPlus) {
    y += token.fontCaption + pad(token, 0.5);
  }

  y += statBarHeight(token) + pad(token, 0.75);

  let handled = false;
  for (const key of stats) {
    if (showPlus) {
      const plusBtn: ButtonDef = {
        x: panel.x + panel.w - pad(token, 1.5) - plusSize,
        y: y + (pitch - plusSize) * 0.5,
        w: plusSize,
        h: plusSize,
        label: '+',
        primary: true,
        onClick: () => panel.onSpend?.(key),
      };
      if (handleButton(plusBtn, ui)) handled = true;
    }
    y += pitch;
  }

  if (hasActions) {
    const btnH = ensureMinTouch(pad(token, 4.5), token);
    y += pad(token, 0.25);
    for (const action of panel.actions!) {
      const btn: ButtonDef = {
        x: panel.x + pad(token, 1.5),
        y,
        w: panel.w - pad(token, 3),
        h: btnH,
        label: action.label,
        disabled: action.disabled,
        danger: action.danger,
        onClick: action.onClick,
      };
      if (handleButton(btn, ui)) handled = true;
      y += btnH + pad(token, 0.5);
    }
  }

  return handled;
}

// ── UpgradePanel ────────────────────────────────────────────────────────────

export function drawUpgradePanel(ctx: CanvasRenderingContext2D, panel: UpgradePanelDef, ui: UiContext): void {
  const { token, accent } = ui;
  const { btnH, rowH, headerH } = upgradePanelMetrics(token);
  const totalH = upgradePanelHeight(panel, token);

  drawCard(ctx, { x: panel.x, y: panel.y, w: panel.w, h: totalH }, ui);

  let y = panel.y + pad(token, 1);
  // Collapse toggle painted as plate + chevron (no font-dependent glyphs).
  const collapsed = panel.collapsed === true;
  const toggleRect = {
    x: panel.x + pad(token, 0.75),
    y,
    w: panel.w - pad(token, 1.5),
    h: headerH - pad(token, 0.5),
  };
  const toggleHovered = hitRect(ui.pointerX, ui.pointerY, toggleRect.x, toggleRect.y, toggleRect.w, toggleRect.h);
  if (toggleHovered) {
    ctx.fillStyle = token.bgElevated;
    roundRectPath(ctx, toggleRect.x, toggleRect.y, toggleRect.w, toggleRect.h, Math.max(2, pad(token, 0.25)));
    ctx.fill();
  }
  drawChevron(ctx, panel.x + pad(token, 0.9), y + (headerH - pad(token, 0.5)) * 0.5, pad(token, 0.55), collapsed ? -Math.PI / 2 : Math.PI / 2, token.textMuted);
  setFont(ctx, token, token.fontBody, '600', true);
  ctx.fillStyle = token.text;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('Upgrades', panel.x + pad(token, 2.2), y + (headerH - pad(token, 0.5)) * 0.5);
  handleButton({ ...toggleRect, h: toggleRect.h, w: toggleRect.w, label: '', onClick: panel.onToggleCollapse }, ui);
  y += headerH;

  if (collapsed) return;

  const condPct = Math.max(0, Math.min(100, panel.condition * 100));
  drawStatBar(
    ctx,
    {
      x: panel.x + pad(token, 1.5),
      y,
      w: panel.w - pad(token, 3),
      label: 'Condition',
      value: condPct,
      suffix: '%',
      color: condPct < BALANCE.conditionMin * 100 ? token.danger : accent,
    },
    ui,
  );
  y += statBarHeight(token) + pad(token, 0.75);

  const quote = repairQuote(panel.condition);
  const repairBtn: ButtonDef = {
    x: panel.x + pad(token, 1.5),
    y,
    w: panel.w - pad(token, 3),
    h: btnH,
    label: quote.pts > 0 ? `Repair (${fmtCash(quote.cost)})` : 'Fully Repaired',
    disabled: quote.pts <= 0 || panel.cash < quote.cost,
    primary: quote.pts > 0 && panel.cash >= quote.cost,
    onClick: panel.onRepair,
  };
  drawButton(ctx, repairBtn, ui);
  y += btnH + pad(token, 1);

  // Wide enough for the priciest label at max scale ('$1,102' truncated at pad(10)).
  const buyW = Math.min(pad(token, 12), panel.w * 0.3);
  const pipR = pad(token, 0.4);
  const pipGap = pad(token, 0.5);
  const pipsW = (BALANCE.maxPartTier + 1) * pipR * 2 + BALANCE.maxPartTier * pipGap;
  const infoR = panel.infoForPart !== undefined ? infoIconRadius(token) * 2.8 : 0;

  for (const part of PARTS) {
    const tier = panel.partTiers[part.id] ?? 0;
    const nextTier = tier + 1;
    const cost = partCost(part.baseCost, nextTier);
    const atMax = tier >= BALANCE.maxPartTier;
    const broke = panel.cash < cost;

    const nameX = panel.x + pad(token, 1.5);
    const nameMaxW = panel.w - buyW - pipsW - infoR - pad(token, 3) - pad(token, 1);
    setFont(ctx, token, token.fontBody, '600');
    ctx.fillStyle = panel.activePart === part.id ? accent : token.text;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const nameStr = truncateText(ctx, part.name, Math.max(pad(token, 4), nameMaxW));
    ctx.fillText(nameStr, nameX, y + rowH * 0.5);
    const nameW = ctx.measureText(nameStr).width;

    // ⓘ — what this part does per tier.
    const info = panel.infoForPart?.(part.id);
    if (info !== undefined && panel.registerInfo !== undefined) {
      const r = infoIconRadius(token);
      const icx = nameX + nameW + r * 1.6;
      const icy = y + rowH * 0.5;
      drawInfoIcon(ctx, icx, icy, r, ui, false);
      panel.registerInfo(
        { x: icx - r * 1.6, y: icy - r * 1.6, w: r * 3.2, h: r * 3.2 },
        info,
      );
    }

    let pipX = nameX + nameW + infoR + pad(token, 1);
    for (let p = 0; p <= BALANCE.maxPartTier; p++) {
      if (pipX + pipR * 2 > panel.x + panel.w - buyW - pad(token, 1.5)) break;
      ctx.beginPath();
      ctx.arc(pipX, y + rowH * 0.5, pipR, 0, Math.PI * 2);
      ctx.fillStyle = p <= tier && tier > 0 ? accent : p === 0 && tier === 0 ? `${accent}66` : token.bgElevated;
      ctx.fill();
      ctx.strokeStyle = token.cardStroke;
      ctx.stroke();
      pipX += pipR * 2 + pipGap;
    }

    const buyBtn: ButtonDef = {
      x: panel.x + panel.w - pad(token, 1.5) - buyW,
      y: y + (rowH - btnH) * 0.5,
      w: buyW,
      h: btnH,
      label: atMax ? 'MAX' : fmtCash(cost),
      disabled: atMax || broke,
      primary: !atMax && !broke,
      onClick: () => panel.onBuy?.(part.id),
    };
    drawButton(ctx, buyBtn, ui);

    ctx.strokeStyle = token.cardStroke;
    ctx.beginPath();
    ctx.moveTo(panel.x + pad(token, 1.5), y + rowH);
    ctx.lineTo(panel.x + panel.w - pad(token, 1.5), y + rowH);
    ctx.stroke();

    y += rowH;
  }
}

/** Small filled triangle — collapse/pager chevrons without font glyph roulette. */
function drawChevron(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  rotation: number,
  color: string,
): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotation);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-size * 0.6, -size * 0.8);
  ctx.lineTo(size * 0.75, 0);
  ctx.lineTo(-size * 0.6, size * 0.8);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function upgradePanelHeight(panel: UpgradePanelDef, token: ThemeTokens): number {
  const m = upgradePanelMetrics(token);
  if (panel.collapsed) return m.headerH + pad(token);
  // Mirrors the draw chain: top pad + toggle + condition bar + repair + rows.
  return (
    pad(token) +
    m.headerH +
    statBarHeight(token) +
    pad(token, 0.75) +
    m.btnH +
    pad(token, 1) +
    PARTS.length * m.rowH
  );
}

export function handleUpgradePanel(panel: UpgradePanelDef, ui: UiContext): boolean {
  const { token } = ui;
  const { btnH, rowH, headerH } = upgradePanelMetrics(token);
  let handled = false;

  const toggleBtn: ButtonDef = {
    x: panel.x + pad(token, 0.75),
    y: panel.y + pad(token, 1),
    w: panel.w - pad(token, 1.5),
    h: headerH - pad(token, 0.5),
    label: '',
    onClick: panel.onToggleCollapse,
  };
  if (handleButton(toggleBtn, ui)) handled = true;

  if (panel.collapsed) return handled;

  let y =
    panel.y +
    pad(token, 1) +
    headerH +
    statBarHeight(token) +
    pad(token, 0.75);

  const quote = repairQuote(panel.condition);
  const repairBtn: ButtonDef = {
    x: panel.x + pad(token, 1.5),
    y,
    w: panel.w - pad(token, 3),
    h: btnH,
    label: quote.pts > 0 ? `Repair (${fmtCash(quote.cost)})` : 'Fully Repaired',
    disabled: quote.pts <= 0 || panel.cash < quote.cost,
    onClick: panel.onRepair,
  };
  if (handleButton(repairBtn, ui)) handled = true;
  y += btnH + pad(token, 1);

  // Wide enough for the priciest label at max scale ('$1,102' truncated at pad(10)).
  const buyW = Math.min(pad(token, 12), panel.w * 0.3);
  for (const part of PARTS) {
    const tier = panel.partTiers[part.id] ?? 0;
    const nextTier = tier + 1;
    const cost = partCost(part.baseCost, nextTier);
    const atMax = tier >= BALANCE.maxPartTier;
    const broke = panel.cash < cost;
    const buyBtn: ButtonDef = {
      x: panel.x + panel.w - pad(token, 1.5) - buyW,
      y: y + (rowH - btnH) * 0.5,
      w: buyW,
      h: btnH,
      label: atMax ? 'MAX' : fmtCash(cost),
      disabled: atMax || broke,
      onClick: () => panel.onBuy?.(part.id),
    };
    if (handleButton(buyBtn, ui)) handled = true;
    y += rowH;
  }

  return handled;
}
