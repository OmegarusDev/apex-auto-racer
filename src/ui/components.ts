import { BALANCE } from '../data/balance.ts';
import { PARTS, partCost } from '../data/parts.ts';
import type { PartCategory } from '../data/parts.ts';
import type { ThemeTokens } from './theme.ts';
import { pad } from './theme.ts';

export type { ThemeTokens };
export { pad, createTheme, invalidateSafeArea } from './theme.ts';

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

export interface ListItem {
  id: string;
  label: string;
  sublabel?: string;
  disabled?: boolean;
  onClick?: () => void;
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

export function panelRect(w: number, h: number, token: ThemeTokens, insetUnits = 2): Rect {
  const p = pad(token, insetUnits);
  const safe = token.safe;
  return {
    x: p + safe.left,
    y: p + safe.top,
    w: w - p * 2 - safe.left - safe.right,
    h: h - p * 2 - safe.top - safe.bottom,
  };
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

function setFont(ctx: CanvasRenderingContext2D, token: ThemeTokens, size: number, weight = '600'): void {
  ctx.font = `${weight} ${size}px ${token.fontFamily}`;
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
  const r = pad(token, 0.75);

  ctx.save();
  if (btn.disabled) {
    ctx.fillStyle = token.disabledBg;
    roundRectPath(ctx, btn.x, btn.y, btn.w, btn.h, r);
    ctx.fill();
    ctx.strokeStyle = token.cardStroke;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = token.disabled;
  } else if (btn.primary) {
    ctx.fillStyle = hovered ? accent : `${accent}cc`;
    roundRectPath(ctx, btn.x, btn.y, btn.w, btn.h, r);
    ctx.fill();
    ctx.fillStyle = token.bg;
  } else {
    ctx.fillStyle = hovered ? token.bgElevated : token.card;
    roundRectPath(ctx, btn.x, btn.y, btn.w, btn.h, r);
    ctx.fill();
    ctx.strokeStyle = token.cardStroke;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = token.text;
  }

  setFont(ctx, token, token.fontBody);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(truncateText(ctx, btn.label, btn.w - pad(token)), btn.x + btn.w * 0.5, btn.y + btn.h * 0.5);
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
  const { token } = ui;
  const r = pad(token, 0.75);
  ctx.save();
  ctx.fillStyle = token.card;
  roundRectPath(ctx, card.x, card.y, card.w, card.h, r);
  ctx.fill();
  ctx.strokeStyle = token.cardStroke;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
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

// ── ListView ────────────────────────────────────────────────────────────────

export class ListView {
  scrollY = 0;
  velocity = 0;
  rowHeight: number;
  friction: number;
  private dragging = false;
  private dragStartY = 0;
  private scrollStartY = 0;
  private activePointerId: number | null = null;

  constructor(rowHeight: number, friction = 8) {
    this.rowHeight = rowHeight;
    this.friction = friction;
  }

  update(rect: Rect, ui: UiContext, itemCount: number, pointerId?: number): void {
    const contentH = itemCount * this.rowHeight;
    const maxScroll = Math.max(0, contentH - rect.h);

    if (ui.pointerDown && !this.dragging) {
      if (hitRect(ui.pointerX, ui.pointerY, rect.x, rect.y, rect.w, rect.h)) {
        this.dragging = true;
        this.dragStartY = ui.pointerY;
        this.scrollStartY = this.scrollY;
        this.activePointerId = pointerId ?? null;
        this.velocity = 0;
      }
    }

    if (this.dragging && ui.pointerDown) {
      if (this.activePointerId === null || pointerId === undefined || pointerId === this.activePointerId) {
        this.scrollY = this.scrollStartY - (ui.pointerY - this.dragStartY);
        this.scrollY = Math.max(0, Math.min(maxScroll, this.scrollY));
      }
    }

    if (!ui.pointerDown && this.dragging) {
      this.dragging = false;
      this.activePointerId = null;
    }

    if (!this.dragging && Math.abs(this.velocity) > 1) {
      this.scrollY += this.velocity * ui.dt;
      this.scrollY = Math.max(0, Math.min(maxScroll, this.scrollY));
      this.velocity *= Math.exp(-this.friction * ui.dt);
      if (this.scrollY <= 0 || this.scrollY >= maxScroll) this.velocity *= 0.35;
    }
  }

  recordDragVelocity(deltaY: number, dt: number): void {
    if (dt > 0) this.velocity = -deltaY / dt;
  }

  draw(
    ctx: CanvasRenderingContext2D,
    rect: Rect,
    items: ListItem[],
    ui: UiContext,
  ): void {
    const { token } = ui;
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.w, rect.h);
    ctx.clip();

    const first = Math.floor(this.scrollY / this.rowHeight);
    const last = Math.min(items.length, first + Math.ceil(rect.h / this.rowHeight) + 1);

    for (let i = first; i < last; i++) {
      const item = items[i];
      if (!item) continue;
      const rowY = rect.y + i * this.rowHeight - this.scrollY;
      const hovered =
        !item.disabled &&
        hitRect(ui.pointerX, ui.pointerY, rect.x, rowY, rect.w, this.rowHeight);

      if (hovered) {
        ctx.fillStyle = token.bgElevated;
        ctx.fillRect(rect.x, rowY, rect.w, this.rowHeight);
      }

      setFont(ctx, token, token.fontBody, '600');
      ctx.fillStyle = item.disabled ? token.disabled : token.text;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(item.label, rect.x + pad(token), rowY + this.rowHeight * 0.5);

      if (item.sublabel) {
        setFont(ctx, token, token.fontCaption, '500');
        ctx.fillStyle = token.textDim;
        ctx.textAlign = 'right';
        ctx.fillText(item.sublabel, rect.x + rect.w - pad(token), rowY + this.rowHeight * 0.5);
      }

      ctx.strokeStyle = token.cardStroke;
      ctx.beginPath();
      ctx.moveTo(rect.x, rowY + this.rowHeight);
      ctx.lineTo(rect.x + rect.w, rowY + this.rowHeight);
      ctx.stroke();
    }

    ctx.restore();
  }

  handleClick(rect: Rect, items: ListItem[], ui: UiContext): boolean {
    if (!ui.pointerClicked) return false;
    if (!hitRect(ui.pointerX, ui.pointerY, rect.x, rect.y, rect.w, rect.h)) return false;

    const localY = ui.pointerY - rect.y + this.scrollY;
    const index = Math.floor(localY / this.rowHeight);
    const item = items[index];
    if (!item || item.disabled) return false;
    item.onClick?.();
    return true;
  }
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

  ctx.save();
  ctx.fillStyle = token.bgElevated;
  ctx.fillRect(header.x, header.y, header.w, header.h);
  ctx.strokeStyle = token.cardStroke;
  ctx.beginPath();
  ctx.moveTo(header.x, header.y + header.h);
  ctx.lineTo(header.x + header.w, header.y + header.h);
  ctx.stroke();

  let titleX = header.x + pad(token, 1.5);

  if (header.back) {
    const backBtn: ButtonDef = {
      x: header.x + pad(token, 0.75),
      y: header.y + (header.h - btnSize) * 0.5,
      w: btnSize,
      h: btnSize,
      label: '←',
      onClick: header.onBack,
    };
    drawButton(ctx, backBtn, ui);
    titleX = backBtn.x + backBtn.w + pad(token, 0.75);
  }

  setFont(ctx, token, token.fontTitle, '700');
  ctx.fillStyle = token.text;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(
    truncateText(ctx, header.title, header.w * 0.45),
    titleX,
    header.y + header.h * 0.5,
  );

  let rightX = header.x + header.w - pad(token, 0.75);

  if (header.settings) {
    const settingsBtn: ButtonDef = {
      x: rightX - btnSize,
      y: header.y + (header.h - btnSize) * 0.5,
      w: btnSize,
      h: btnSize,
      label: '⚙',
      onClick: header.onSettings,
    };
    drawButton(ctx, settingsBtn, ui);
    rightX -= btnSize + pad(token, 0.75);
  }

  if (header.cash !== undefined) {
    setFont(ctx, token, token.fontBody, '700');
    ctx.fillStyle = accent;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(`$${header.cash.toLocaleString()}`, rightX, header.y + header.h * 0.5);
  }

  ctx.restore();
}

export function handleHeader(header: HeaderDef, ui: UiContext): boolean {
  const { token } = ui;
  const btnSize = ensureMinTouch(pad(token, 5.5), token);
  let handled = false;

  if (header.back) {
    const backBtn: ButtonDef = {
      x: header.x + pad(token, 0.75),
      y: header.y + (header.h - btnSize) * 0.5,
      w: btnSize,
      h: btnSize,
      label: '←',
      onClick: header.onBack,
    };
    if (handleButton(backBtn, ui)) handled = true;
  }

  if (header.settings) {
    let rightX = header.x + header.w - pad(token, 0.75);
    const settingsBtn: ButtonDef = {
      x: rightX - btnSize,
      y: header.y + (header.h - btnSize) * 0.5,
      w: btnSize,
      h: btnSize,
      label: '⚙',
      onClick: header.onSettings,
    };
    if (handleButton(settingsBtn, ui)) handled = true;
  }

  return handled;
}

export function headerHeight(token: ThemeTokens): number {
  return ensureMinTouch(pad(token, 6.5), token);
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
