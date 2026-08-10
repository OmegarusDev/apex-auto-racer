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
}

export interface RadarChartDef {
  x: number;
  y: number;
  radius: number;
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
  skill: number;
  bravery: number;
  focus: number;
  determination: number;
  unspentPoints: number;
  level: number;
  xp: number;
  xpToNext: number;
}

export interface DriverSpendPanelDef {
  x: number;
  y: number;
  w: number;
  driver: DriverSpendData;
  onSpend?: (stat: DriverStatKey) => void;
}

export interface UpgradePanelDef {
  x: number;
  y: number;
  w: number;
  partTiers: Record<PartCategory, number>;
  condition: number;
  cash: number;
  collapsed?: boolean;
  onBuy?: (part: PartCategory) => void;
  onRepair?: () => void;
  onToggleCollapse?: () => void;
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

function truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) {
    t = t.slice(0, -1);
  }
  return `${t}…`;
}

// ── Button ──────────────────────────────────────────────────────────────────

export function drawButton(ctx: CanvasRenderingContext2D, btn: ButtonDef, ui: UiContext): void {
  const { token, accent } = ui;
  const hovered = !btn.disabled && hitRect(ui.pointerX, ui.pointerY, btn.x, btn.y, btn.w, btn.h);
  // Sharp pit-plate corners — not soft app cards.
  const r = Math.max(2, pad(token, 0.25));
  const rail = Math.max(3, pad(token, 0.35));

  ctx.save();
  if (btn.disabled) {
    ctx.fillStyle = token.disabledBg;
    roundRectPath(ctx, btn.x, btn.y, btn.w, btn.h, r);
    ctx.fill();
    ctx.fillStyle = token.disabled;
  } else if (btn.primary) {
    const fill = hovered ? accent : accent;
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
    ctx.fillStyle = hovered ? accent : `${accent}99`;
    ctx.fillRect(btn.x, btn.y, rail, btn.h);
    ctx.strokeStyle = hovered ? `${accent}55` : token.cardStroke;
    ctx.lineWidth = 1;
    roundRectPath(ctx, btn.x, btn.y, btn.w, btn.h, r);
    ctx.stroke();
    ctx.fillStyle = token.text;
  }

  const label = truncateText(ctx, btn.label.toUpperCase(), btn.w - pad(token) - rail);
  setFont(ctx, token, token.fontBody, btn.primary ? '700' : '600', true);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Bebas Neue sits high — nudge baseline slightly for optical center.
  const ty = btn.y + btn.h * 0.52;
  ctx.fillText(label, btn.x + btn.w * 0.5 + (btn.primary ? 0 : rail * 0.25), ty);
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
    wheelScroll(this.scroll, deltaY);
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
  const track = Math.max(6, pad(token, 0.7));
  return token.fontCaption + pad(token, 0.5) + track + pad(token, 2.5);
}

export function drawSlider(ctx: CanvasRenderingContext2D, slider: SliderDef, ui: UiContext): void {
  const { token } = ui;
  const trackH = Math.max(6, Math.min(slider.h, pad(token, 1)));
  const labelH = token.fontCaption + pad(token, 0.35);
  const trackY = slider.y + labelH;

  ctx.save();
  setFont(ctx, token, token.fontCaption, '600');
  ctx.fillStyle = token.textMuted;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(slider.label, slider.x, slider.y);

  setFont(ctx, token, token.fontCaption, '500');
  ctx.fillStyle = token.textDim;
  ctx.textAlign = 'right';
  ctx.fillText(`${Math.round(slider.value * 100)}%`, slider.x + slider.w, slider.y);

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

export function handleSlider(slider: SliderDef, ui: UiContext): boolean {
  const { token } = ui;
  const trackH = Math.max(6, Math.min(slider.h, pad(token, 1)));
  const labelH = token.fontCaption + pad(token, 0.35);
  const trackY = slider.y + labelH;
  const hitPad = (token.touchMin - trackH) * 0.5;
  const hitY = trackY - hitPad;
  const hitH = trackH + hitPad * 2;
  if (!ui.pointerDown) return false;
  if (!hitRect(ui.pointerX, ui.pointerY, slider.x, hitY, slider.w, hitH)) return false;
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

  setFont(ctx, token, token.fontCaption, '600');
  ctx.textAlign = 'right';
  ctx.fillStyle = token.text;
  ctx.fillText(String(Math.round(value)), bar.x + bar.w, bar.y);

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
  for (let i = 0; i < n; i++) {
    const a = angles[i]!;
    const lx = cx + Math.cos(a) * (chart.radius + pad(token, 1.5));
    const ly = cy + Math.sin(a) * (chart.radius + pad(token, 1.5));
    ctx.fillText(RADAR_LABELS[i]!, lx, ly);
  }

  ctx.restore();
}

// ── Modal ───────────────────────────────────────────────────────────────────

export function drawModal(ctx: CanvasRenderingContext2D, modal: ModalDef, ui: UiContext): void {
  if (!modal.open) return;
  const { token, w, h } = ui;

  ctx.save();
  ctx.fillStyle = token.overlay;
  ctx.fillRect(0, 0, w, h);

  const boxW = Math.min(w - pad(token, 4), pad(token, 40));
  const btnH = ensureMinTouch(pad(token, 5.5), token);
  const btnGap = pad(token, 0.75);
  const btnRowH = modal.buttons.length > 0 ? btnH + pad(token, 2) : 0;
  const bodyLines = modal.body.split('\n').length;
  const bodyH = bodyLines * token.fontBody * 1.35 + pad(token);
  const boxH = pad(token, 3) + token.fontTitle + pad(token) + bodyH + btnRowH + pad(token);

  const boxX = (w - boxW) * 0.5;
  const boxY = (h - boxH) * 0.5;

  drawCard(ctx, { x: boxX, y: boxY, w: boxW, h: boxH }, ui);

  setFont(ctx, token, token.fontTitle, '700');
  ctx.fillStyle = token.text;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(modal.title, boxX + boxW * 0.5, boxY + pad(token, 1.5));

  setFont(ctx, token, token.fontBody, '400');
  ctx.fillStyle = token.textMuted;
  const bodyY = boxY + pad(token, 1.5) + token.fontTitle + pad(token, 0.75);
  const lines = modal.body.split('\n');
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i]!, boxX + boxW * 0.5, bodyY + i * token.fontBody * 1.35);
  }

  let btnX = boxX + pad(token, 1.5);
  const btnY = boxY + boxH - pad(token, 1.5) - btnH;
  const btnW =
    modal.buttons.length > 0
      ? (boxW - pad(token, 3) - btnGap * (modal.buttons.length - 1)) / modal.buttons.length
      : 0;

  for (const btn of modal.buttons) {
    drawButton(ctx, { ...btn, x: btnX, y: btnY, w: btnW, h: btnH }, ui);
    btnX += btnW + btnGap;
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
  const { token, w, h } = ui;
  const boxW = Math.min(w - pad(token, 4), pad(token, 40));
  const btnH = ensureMinTouch(pad(token, 5.5), token);
  const btnGap = pad(token, 0.75);
  const bodyLines = modal.body.split('\n').length;
  const bodyH = bodyLines * token.fontBody * 1.35 + pad(token);
  const btnRowH = modal.buttons.length > 0 ? btnH + pad(token, 2) : 0;
  const boxH = pad(token, 3) + token.fontTitle + pad(token) + bodyH + btnRowH + pad(token);
  const boxX = (w - boxW) * 0.5;
  const boxY = (h - boxH) * 0.5;
  const btnY = boxY + boxH - pad(token, 1.5) - btnH;
  const btnW =
    modal.buttons.length > 0
      ? (boxW - pad(token, 3) - btnGap * (modal.buttons.length - 1)) / modal.buttons.length
      : 0;
  let btnX = boxX + pad(token, 1.5);
  for (const btn of modal.buttons) {
    btn.x = btnX;
    btn.y = btnY;
    btn.w = btnW;
    btn.h = btnH;
    btnX += btnW + btnGap;
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

  draw(ctx: CanvasRenderingContext2D, ui: UiContext): void {
    if (this.items.length === 0) return;
    const { token, w } = ui;
    const toastW = Math.min(w - pad(token, 4), pad(token, 44));
    const toastH = ensureMinTouch(pad(token, 5), token);
    let y = ui.h - pad(token, 2) - token.safe.bottom;

    ctx.save();
    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i]!;
      y -= toastH + pad(token, 0.75);
      const x = (w - toastW) * 0.5;
      const alpha = Math.min(1, item.ttl / 0.35);

      ctx.globalAlpha = alpha;
      ctx.fillStyle = token.card;
      roundRectPath(ctx, x, y, toastW, toastH, pad(token, 0.75));
      ctx.fill();
      ctx.strokeStyle = item.accent ?? ui.accent;
      ctx.lineWidth = 1;
      ctx.stroke();

      setFont(ctx, token, token.fontBody, '500');
      ctx.fillStyle = token.text;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(truncateText(ctx, item.message, toastW - pad(token, 2)), x + toastW * 0.5, y + toastH * 0.5);
    }
    ctx.restore();
  }
}

// ── Header ──────────────────────────────────────────────────────────────────

export function drawHeader(ctx: CanvasRenderingContext2D, header: HeaderDef, ui: UiContext): void {
  const { token, accent } = ui;
  const btnSize = ensureMinTouch(pad(token, 5.5), token);
  const midY = headerContentTop(token) + headerContentH(token) * 0.5;
  const safeL = token.safe.left;
  const safeR = token.safe.right;

  ctx.save();
  // Translucent strip — reads as pit wall, not a solid app bar.
  const bar = ctx.createLinearGradient(0, header.y, 0, header.y + header.h);
  bar.addColorStop(0, 'rgba(11,13,12,0.55)');
  bar.addColorStop(0.7, 'rgba(14,18,16,0.82)');
  bar.addColorStop(1, 'rgba(14,18,16,0.92)');
  ctx.fillStyle = bar;
  ctx.fillRect(header.x, header.y, header.w, header.h);
  ctx.fillStyle = accent;
  ctx.fillRect(header.x, header.y + header.h - 3, header.w, 3);
  ctx.fillStyle = 'rgba(242,239,230,0.06)';
  ctx.fillRect(header.x, header.y + header.h - 1, header.w, 1);

  let titleX = header.x + pad(token, 1.5) + safeL;
  let rightEdge = header.x + header.w - pad(token, 0.75) - safeR;

  if (header.back) {
    const backBtn: ButtonDef = {
      x: header.x + pad(token, 0.75) + safeL,
      y: midY - btnSize * 0.5,
      w: btnSize,
      h: btnSize,
      label: '←',
      onClick: header.onBack,
    };
    drawButton(ctx, backBtn, ui);
    titleX = backBtn.x + backBtn.w + pad(token, 0.75);
  }

  if (header.settings) {
    const settingsBtn: ButtonDef = {
      x: rightEdge - btnSize,
      y: midY - btnSize * 0.5,
      w: btnSize,
      h: btnSize,
      label: 'OPT',
      onClick: header.onSettings,
    };
    drawButton(ctx, settingsBtn, ui);
    rightEdge = settingsBtn.x - pad(token, 0.75);
  }

  let cashW = 0;
  if (header.cash !== undefined) {
    setFont(ctx, token, token.fontBody, '700');
    const cashStr = `$${header.cash.toLocaleString()}`;
    cashW = ctx.measureText(cashStr).width;
    ctx.fillStyle = accent;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(cashStr, rightEdge, midY);
    rightEdge -= cashW + pad(token, 1);
  }

  const titleMax = Math.max(pad(token, 8), rightEdge - titleX - pad(token, 0.5));
  setFont(ctx, token, token.fontTitle, '400', true);
  ctx.fillStyle = token.text;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(truncateText(ctx, header.title.toUpperCase(), titleMax), titleX, midY);

  ctx.restore();
}

export function handleHeader(header: HeaderDef, ui: UiContext): boolean {
  const { token } = ui;
  const btnSize = ensureMinTouch(pad(token, 5.5), token);
  const midY = headerContentTop(token) + headerContentH(token) * 0.5;
  const safeL = token.safe.left;
  const safeR = token.safe.right;
  let handled = false;

  if (header.back) {
    const backBtn: ButtonDef = {
      x: header.x + pad(token, 0.75) + safeL,
      y: midY - btnSize * 0.5,
      w: btnSize,
      h: btnSize,
      label: '←',
      onClick: header.onBack,
    };
    if (handleButton(backBtn, ui)) handled = true;
  }

  if (header.settings) {
    const rightEdge = header.x + header.w - pad(token, 0.75) - safeR;
    const settingsBtn: ButtonDef = {
      x: rightEdge - btnSize,
      y: midY - btnSize * 0.5,
      w: btnSize,
      h: btnSize,
      label: 'OPT',
      onClick: header.onSettings,
    };
    if (handleButton(settingsBtn, ui)) handled = true;
  }

  return handled;
}

// ── DriverSpendPanel ────────────────────────────────────────────────────────

export function drawDriverSpendPanel(
  ctx: CanvasRenderingContext2D,
  panel: DriverSpendPanelDef,
  ui: UiContext,
): void {
  const { token, accent } = ui;
  const d = panel.driver;
  const barH = statBarHeight(token);
  const plusSize = ensureMinTouch(pad(token, 4.5), token);
  const rowGap = pad(token, 0.5);
  const stats: DriverStatKey[] = ['skill', 'bravery', 'focus', 'determination'];
  const contentH =
    pad(token, 2) +
    token.fontTitle +
    pad(token, 0.5) +
    token.fontCaption +
    pad(token) +
    stats.length * (barH + rowGap) +
    pad(token);

  drawCard(ctx, { x: panel.x, y: panel.y, w: panel.w, h: contentH }, ui);

  let y = panel.y + pad(token, 1.5);
  setFont(ctx, token, token.fontTitle, '700');
  ctx.fillStyle = token.text;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(d.name, panel.x + pad(token, 1.5), y);
  y += token.fontTitle + pad(token, 0.25);

  setFont(ctx, token, token.fontCaption, '500');
  ctx.fillStyle = accent;
  ctx.fillText(`${d.trait} · Lv ${d.level}`, panel.x + pad(token, 1.5), y);
  y += token.fontCaption + pad(token, 0.75);

  if (d.unspentPoints > 0) {
    setFont(ctx, token, token.fontCaption, '600');
    ctx.fillStyle = token.success;
    ctx.fillText(`${d.unspentPoints} point${d.unspentPoints === 1 ? '' : 's'} to spend`, panel.x + pad(token, 1.5), y);
    y += token.fontCaption + pad(token, 0.5);
  }

  const xpRatio = d.xpToNext > 0 ? d.xp / d.xpToNext : 0;
  drawStatBar(
    ctx,
    {
      x: panel.x + pad(token, 1.5),
      y,
      w: panel.w - pad(token, 3),
      label: 'XP',
      value: xpRatio * 100,
      color: token.textDim,
    },
    ui,
  );
  y += barH + pad(token, 0.75);

  for (const key of stats) {
    const value = d[key];
    const barW = panel.w - pad(token, 3) - (d.unspentPoints > 0 ? plusSize + pad(token, 0.5) : 0);

    drawStatBar(
      ctx,
      {
        x: panel.x + pad(token, 1.5),
        y,
        w: barW,
        label: STAT_LABELS[key],
        value,
      },
      ui,
    );

    if (d.unspentPoints > 0) {
      const plusBtn: ButtonDef = {
        x: panel.x + panel.w - pad(token, 1.5) - plusSize,
        y: y + (barH - plusSize) * 0.5,
        w: plusSize,
        h: plusSize,
        label: '+',
        primary: true,
        onClick: () => panel.onSpend?.(key),
      };
      drawButton(ctx, plusBtn, ui);
    }

    y += barH + rowGap;
  }
}

export function driverSpendPanelHeight(panel: DriverSpendPanelDef, token: ThemeTokens): number {
  const barH = statBarHeight(token);
  const rowGap = pad(token, 0.5);
  const stats = 4;
  let h =
    pad(token, 2) +
    token.fontTitle +
    pad(token, 0.5) +
    token.fontCaption +
    pad(token) +
    barH +
    pad(token, 0.75) +
    stats * (barH + rowGap) +
    pad(token);
  if (panel.driver.unspentPoints > 0) {
    h += token.fontCaption + pad(token, 0.5);
  }
  return h;
}

export function handleDriverSpendPanel(panel: DriverSpendPanelDef, ui: UiContext): boolean {
  if (panel.driver.unspentPoints <= 0) return false;
  const { token } = ui;
  const plusSize = ensureMinTouch(pad(token, 4.5), token);
  const barH = statBarHeight(token);
  const rowGap = pad(token, 0.5);
  const stats: DriverStatKey[] = ['skill', 'bravery', 'focus', 'determination'];

  let y =
    panel.y +
    pad(token, 1.5) +
    token.fontTitle +
    pad(token, 0.25) +
    token.fontCaption +
    pad(token, 0.75);

  if (panel.driver.unspentPoints > 0) {
    y += token.fontCaption + pad(token, 0.5);
  }

  y += barH + pad(token, 0.75);

  let handled = false;
  for (const key of stats) {
    const plusBtn: ButtonDef = {
      x: panel.x + panel.w - pad(token, 1.5) - plusSize,
      y: y + (barH - plusSize) * 0.5,
      w: plusSize,
      h: plusSize,
      label: '+',
      primary: true,
      onClick: () => panel.onSpend?.(key),
    };
    if (handleButton(plusBtn, ui)) handled = true;
    y += barH + rowGap;
  }

  return handled;
}

// ── UpgradePanel ────────────────────────────────────────────────────────────

export function drawUpgradePanel(ctx: CanvasRenderingContext2D, panel: UpgradePanelDef, ui: UiContext): void {
  const { token, accent } = ui;
  const btnH = ensureMinTouch(pad(token, 4.5), token);
  const rowH = pad(token, 5.5);
  const headerH = pad(token, 5);
  const conditionH = statBarHeight(token) + pad(token, 1.5) + btnH + pad(token);
  const partRows = panel.collapsed ? 0 : PARTS.length;
  const totalH = headerH + (panel.collapsed ? 0 : conditionH + partRows * rowH) + pad(token);

  drawCard(ctx, { x: panel.x, y: panel.y, w: panel.w, h: totalH }, ui);

  let y = panel.y + pad(token, 1);
  const toggleLabel = panel.collapsed ? '▸ Upgrades' : '▾ Upgrades';
  const toggleBtn: ButtonDef = {
    x: panel.x + pad(token, 0.75),
    y,
    w: panel.w - pad(token, 1.5),
    h: headerH - pad(token, 0.5),
    label: toggleLabel,
    onClick: panel.onToggleCollapse,
  };
  drawButton(ctx, toggleBtn, ui);
  y += headerH;

  if (panel.collapsed) return;

  const condPct = Math.max(0, Math.min(100, panel.condition * 100));
  drawStatBar(
    ctx,
    {
      x: panel.x + pad(token, 1.5),
      y,
      w: panel.w - pad(token, 3),
      label: 'Condition',
      value: condPct,
      color: condPct < BALANCE.conditionMin * 100 ? token.danger : accent,
    },
    ui,
  );
  y += statBarHeight(token) + pad(token, 0.75);

  const repairPts = Math.max(0, Math.ceil((BALANCE.conditionMax - panel.condition) * 100));
  const repairCost = repairPts * BALANCE.repairCostPerPoint;
  const repairBtn: ButtonDef = {
    x: panel.x + pad(token, 1.5),
    y,
    w: panel.w - pad(token, 3),
    h: btnH,
    label: repairPts > 0 ? `Repair ($${repairCost})` : 'Fully Repaired',
    disabled: repairPts <= 0 || panel.cash < repairCost,
    primary: repairPts > 0 && panel.cash >= repairCost,
    onClick: panel.onRepair,
  };
  drawButton(ctx, repairBtn, ui);
  y += btnH + pad(token, 1);

  for (const part of PARTS) {
    const tier = panel.partTiers[part.id] ?? 0;
    const nextTier = tier + 1;
    const cost = partCost(part.baseCost, nextTier);
    const atMax = tier >= BALANCE.maxPartTier;
    const broke = panel.cash < cost;

    ctx.save();
    setFont(ctx, token, token.fontBody, '600');
    ctx.fillStyle = token.text;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(part.name, panel.x + pad(token, 1.5), y + rowH * 0.5);

    const pipR = pad(token, 0.4);
    const pipGap = pad(token, 0.5);
    let pipX = panel.x + pad(token, 1.5) + token.fontBody * 4;
    for (let p = 0; p <= BALANCE.maxPartTier; p++) {
      ctx.beginPath();
      ctx.arc(pipX, y + rowH * 0.5, pipR, 0, Math.PI * 2);
      ctx.fillStyle = p <= tier ? accent : token.bgElevated;
      ctx.fill();
      ctx.strokeStyle = token.cardStroke;
      ctx.stroke();
      pipX += pipR * 2 + pipGap;
    }

    const buyW = pad(token, 10);
    const buyBtn: ButtonDef = {
      x: panel.x + panel.w - pad(token, 1.5) - buyW,
      y: y + (rowH - btnH) * 0.5,
      w: buyW,
      h: btnH,
      label: atMax ? 'MAX' : `$${cost}`,
      disabled: atMax || broke,
      primary: !atMax && !broke,
      onClick: () => panel.onBuy?.(part.id),
    };
    drawButton(ctx, buyBtn, ui);
    ctx.restore();

    ctx.strokeStyle = token.cardStroke;
    ctx.beginPath();
    ctx.moveTo(panel.x + pad(token, 1.5), y + rowH);
    ctx.lineTo(panel.x + panel.w - pad(token, 1.5), y + rowH);
    ctx.stroke();

    y += rowH;
  }
}

export function upgradePanelHeight(panel: UpgradePanelDef, token: ThemeTokens): number {
  const btnH = ensureMinTouch(pad(token, 4.5), token);
  const rowH = pad(token, 5.5);
  const headerH = pad(token, 5);
  if (panel.collapsed) return headerH + pad(token);
  const conditionH = statBarHeight(token) + pad(token, 1.5) + btnH + pad(token);
  return headerH + conditionH + PARTS.length * rowH + pad(token);
}

export function handleUpgradePanel(panel: UpgradePanelDef, ui: UiContext): boolean {
  const { token } = ui;
  const btnH = ensureMinTouch(pad(token, 4.5), token);
  const rowH = pad(token, 5.5);
  const headerH = pad(token, 5);
  let handled = false;

  const toggleBtn: ButtonDef = {
    x: panel.x + pad(token, 0.75),
    y: panel.y + pad(token, 1),
    w: panel.w - pad(token, 1.5),
    h: headerH - pad(token, 0.5),
    label: panel.collapsed ? '▸ Upgrades' : '▾ Upgrades',
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

  const repairPts = Math.max(0, Math.ceil((BALANCE.conditionMax - panel.condition) * 100));
  const repairCost = repairPts * BALANCE.repairCostPerPoint;
  const repairBtn: ButtonDef = {
    x: panel.x + pad(token, 1.5),
    y,
    w: panel.w - pad(token, 3),
    h: btnH,
    label: repairPts > 0 ? `Repair ($${repairCost})` : 'Fully Repaired',
    disabled: repairPts <= 0 || panel.cash < repairCost,
    onClick: panel.onRepair,
  };
  if (handleButton(repairBtn, ui)) handled = true;
  y += btnH + pad(token, 1);

  for (const part of PARTS) {
    const tier = panel.partTiers[part.id] ?? 0;
    const nextTier = tier + 1;
    const cost = partCost(part.baseCost, nextTier);
    const atMax = tier >= BALANCE.maxPartTier;
    const broke = panel.cash < cost;
    const buyW = pad(token, 10);
    const buyBtn: ButtonDef = {
      x: panel.x + panel.w - pad(token, 1.5) - buyW,
      y: y + (rowH - btnH) * 0.5,
      w: buyW,
      h: btnH,
      label: atMax ? 'MAX' : `$${cost}`,
      disabled: atMax || broke,
      onClick: () => panel.onBuy?.(part.id),
    };
    if (handleButton(buyBtn, ui)) handled = true;
    y += rowH;
  }

  return handled;
}
