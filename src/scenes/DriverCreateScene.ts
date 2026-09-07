import type { Scene } from '../engine/SceneManager';
import { getGameContext } from '../engine/GameContext';
import { createDriver, setActiveDriver } from '../engine/SaveManager';
import { getDiscipline, type DisciplineId } from '../data/disciplines';
import { TRAITS, type TraitId } from '../data/traits';
import { FIRST_NAMES, LAST_NAMES } from '../data/names';
import { DRIVER_COLORS } from '../ui/brand';
import {
  drawButton,
  handleButton,
  drawHeader,
  handleHeader,
  hitRect,
  pad,
  truncateText,
  type ButtonDef,
  type HeaderDef,
} from '../ui/components';
import {
  buildUi,
  drawBackground,
  onSceneEnter,
  onSceneResize,
} from './sceneChrome';
import { CareerHubScene } from './CareerHubScene';
import { TitleScene } from './TitleScene';
import { mulberry32 } from '../engine/rng';

const NAME_MAX = 16;

export class DriverCreateScene implements Scene {
  private discipline: DisciplineId;
  private nameBuf = '';
  private editing = true;
  private colorIndex = 0;
  private traitIndex = 0;
  private colorSwatches: { x: number; y: number; r: number; idx: number }[] = [];
  private nameBox = { x: 0, y: 0, w: 0, h: 0 };
  private keyHandler = (ev: KeyboardEvent) => this.onKey(ev);

  constructor(discipline: DisciplineId) {
    this.discipline = discipline;
  }

  enter(): void {
    onSceneEnter();
    const rng = mulberry32((Date.now() ^ (Math.random() * 1e9)) >>> 0);
    this.nameBuf = `${FIRST_NAMES[Math.floor(rng() * FIRST_NAMES.length)]!} ${LAST_NAMES[Math.floor(rng() * LAST_NAMES.length)]!}`;
    this.colorIndex = Math.floor(rng() * DRIVER_COLORS.length);
    this.traitIndex = Math.floor(rng() * TRAITS.length);
    this.editing = true;
    window.addEventListener('keydown', this.keyHandler);
  }

  exit(): void {
    window.removeEventListener('keydown', this.keyHandler);
  }

  onResize(w: number, h: number): void {
    onSceneResize(w, h);
  }

  update(_dt: number): void {}

  handleBack(): boolean {
    const s = getGameContext().scenes;
    if (s.depth > 1) s.back();
    else s.replace(new TitleScene());
    return true;
  }

  private onKey(ev: KeyboardEvent): void {
    if (!this.editing) return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (ev.key === 'Backspace') {
      ev.preventDefault();
      this.nameBuf = this.nameBuf.slice(0, -1);
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      this.confirm();
    } else if (ev.key.length === 1 && this.nameBuf.length < NAME_MAX) {
      this.nameBuf += ev.key;
    }
  }

  private randomName(): void {
    const rng = mulberry32((Date.now() ^ (Math.random() * 1e9)) >>> 0);
    this.nameBuf = `${FIRST_NAMES[Math.floor(rng() * FIRST_NAMES.length)]!} ${LAST_NAMES[Math.floor(rng() * LAST_NAMES.length)]!}`;
  }

  render(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const def = getDiscipline(this.discipline);
    const { ui, token } = buildUi(w, h, 0, def.accent);
    drawBackground(ctx, w, h, token, def.accent);

    const header: HeaderDef = {
      x: pad(token, 2),
      y: pad(token, 2),
      w: w - pad(token, 4),
      h: Math.max(token.fontDisplay * 2.2, pad(token, 9)),
      title: `New ${def.name} Driver`,
      back: true,
      onBack: () => this.handleBack(),
    };
    drawHeader(ctx, header, ui);
    handleHeader(header, ui);

    const top = header.y + header.h + pad(token, 3);
    const cx = w / 2;
    const fieldW = Math.min(w - pad(token, 4), token.fontDisplay * 22);

    // Name field
    const nameY = top;
    const nameH = Math.max(pad(token, 9), token.fontDisplay * 1.8);
    this.nameBox = { x: cx - fieldW / 2, y: nameY, w: fieldW, h: nameH };
    ctx.save();
    ctx.fillStyle = this.editing ? 'rgba(240,196,26,0.10)' : 'rgba(255,255,255,0.04)';
    ctx.strokeStyle = this.editing ? def.accent : 'rgba(255,255,255,0.18)';
    ctx.lineWidth = this.editing ? 2 : 1;
    ctx.beginPath();
    ctx.roundRect(this.nameBox.x, this.nameBox.y, this.nameBox.w, this.nameBox.h, pad(token, 0.5));
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = this.nameBuf.length > 0 ? '#f2efe6' : 'rgba(242,239,230,0.4)';
    ctx.font = `600 ${token.fontDisplay}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const display = this.nameBuf.length > 0 ? this.nameBuf : 'Type a name…';
    ctx.fillText(display, this.nameBox.x + pad(token, 1.5), this.nameBox.y + nameH / 2);
    if (this.editing && Math.floor(performance.now() / 500) % 2 === 0) {
      const tw = ctx.measureText(display).width;
      ctx.fillRect(this.nameBox.x + pad(token, 1.5) + tw + 2, this.nameBox.y + nameH * 0.25, 2, nameH * 0.5);
    }
    ctx.fillStyle = 'rgba(242,239,230,0.5)';
    ctx.font = `400 ${token.fontCaption}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'right';
    ctx.fillText(`${this.nameBuf.length}/${NAME_MAX}`, this.nameBox.x + this.nameBox.w - pad(token, 1), this.nameBox.y - pad(token, 0.6));
    ctx.restore();

    const reroll: ButtonDef = {
      x: this.nameBox.x,
      y: this.nameBox.y + this.nameBox.h + pad(token, 1),
      w: this.nameBox.w,
      h: Math.max(pad(token, 5), token.fontBody * 2.4),
      label: 'Reroll Name',
      onClick: () => {
        this.randomName();
        this.editing = true;
      },
    };
    drawButton(ctx, reroll, ui);
    handleButton(reroll, ui);
    if (ui.pointerClicked && hitRect(ui.pointerX, ui.pointerY, this.nameBox.x, this.nameBox.y, this.nameBox.w, this.nameBox.h)) {
      this.editing = true;
    } else if (ui.pointerClicked && !hitRect(ui.pointerX, ui.pointerY, reroll.x, reroll.y, reroll.w, reroll.h)) {
      this.editing = false;
    }

    // Colour picker
    const swatchY = reroll.y + reroll.h + pad(token, 3);
    ctx.save();
    ctx.fillStyle = 'rgba(242,239,230,0.7)';
    ctx.font = `600 ${token.fontBody}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('Helmet Colour', this.nameBox.x, swatchY - pad(token, 0.6));
    ctx.restore();

    const sw = pad(token, 4);
    const gap = pad(token, 1);
    const totalW = DRIVER_COLORS.length * sw + (DRIVER_COLORS.length - 1) * gap;
    let sx = cx - totalW / 2;
    this.colorSwatches = [];
    DRIVER_COLORS.forEach((col, i) => {
      this.colorSwatches.push({ x: sx, y: swatchY, r: sw / 2, idx: i });
      ctx.save();
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(sx + sw / 2, swatchY + sw / 2, sw / 2, 0, Math.PI * 2);
      ctx.fill();
      if (i === this.colorIndex) {
        ctx.strokeStyle = '#f2efe6';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(sx + sw / 2, swatchY + sw / 2, sw / 2 + pad(token, 0.4), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
      if (ui.pointerClicked && hitRect(ui.pointerX, ui.pointerY, sx, swatchY, sw, sw)) {
        this.colorIndex = i;
      }
      sx += sw + gap;
    });

    // Trait picker
    const traitY = swatchY + sw + pad(token, 3);
    const trait = TRAITS[this.traitIndex]!;
    const traitBtn: ButtonDef = {
      x: this.nameBox.x,
      y: traitY,
      w: this.nameBox.w,
      h: Math.max(pad(token, 7), token.fontBody * 3),
      label: '',
      onClick: () => {
        this.traitIndex = (this.traitIndex + 1) % TRAITS.length;
      },
    };
    drawButton(ctx, traitBtn, ui);
    handleButton(traitBtn, ui);
    ctx.save();
    ctx.fillStyle = def.accent;
    ctx.font = `600 ${token.fontBody}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`Trait: ${trait.name}`, traitBtn.x + pad(token, 1.5), traitBtn.y + pad(token, 1));
    ctx.fillStyle = 'rgba(242,239,230,0.62)';
    ctx.font = `400 ${token.fontCaption}px Inter, system-ui, sans-serif`;
    const desc = truncateText(ctx, trait.description, traitBtn.w - pad(token, 3));
    ctx.fillText(desc, traitBtn.x + pad(token, 1.5), traitBtn.y + pad(token, 1) + token.fontBody * 1.6);
    ctx.fillStyle = 'rgba(242,239,230,0.4)';
    ctx.textAlign = 'right';
    ctx.fillText('tap to change', traitBtn.x + traitBtn.w - pad(token, 1.5), traitBtn.y + pad(token, 1));
    ctx.restore();

    // Confirm
    const confirm: ButtonDef = {
      x: this.nameBox.x,
      y: traitBtn.y + traitBtn.h + pad(token, 3),
      w: this.nameBox.w,
      h: Math.max(pad(token, 8), token.fontDisplay * 1.6),
      label: 'Create Driver  →',
      primary: true,
      onClick: () => this.confirm(),
    };
    drawButton(ctx, confirm, ui);
    handleButton(confirm, ui);
  }

  private confirm(): void {
    const g = getGameContext();
    if (g.state === null) g.bootstrap();
    const state = g.state;
    if (state === null) return;
    const rng = mulberry32((Date.now() ^ (Math.random() * 1e9)) >>> 0);
    const used = new Set(state.roster.map((d) => d.name));
    const driver = createDriver(rng, used, this.discipline, DRIVER_COLORS[this.colorIndex]!);
    const trimmed = this.nameBuf.trim();
    if (trimmed.length > 0) driver.name = trimmed;
    driver.trait = TRAITS[this.traitIndex]!.id as TraitId;
    state.roster.push(driver);
    setActiveDriver(state, driver.id);
    g.state = state;
    g.autosave();
    g.scenes.replaceRoot(new CareerHubScene());
  }
}
