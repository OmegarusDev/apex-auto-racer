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
  layoutShell,
  ctaFooterH,
  paintFooterDock,
  heroFooterButton,
  ensureMinTouch,
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
import { careerHomeScene } from './careerHome';
import { mulberry32 } from '../engine/rng';

const NAME_MAX = 16;

export class DriverCreateScene implements Scene {
  private discipline: DisciplineId;
  private nameBuf = '';
  private editing = true;
  private colorIndex = 0;
  private traitIndex = 0;
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
    else {
      void import('./TitleScene').then(({ TitleScene }) => {
        getGameContext().scenes.replace(new TitleScene());
      });
    }
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

    const shell = layoutShell(w, h, token, {
      footer: true,
      footerH: ctaFooterH(token),
    });

    const header: HeaderDef = {
      x: shell.headerRect.x,
      y: shell.headerRect.y,
      w: shell.headerRect.w,
      h: shell.headerRect.h,
      title: def.name,
      back: true,
      onBack: () => this.handleBack(),
    };
    drawHeader(ctx, header, ui);
    handleHeader(header, ui);

    const view = shell.contentRect;
    const fieldW = view.w;
    const cx = view.x + fieldW / 2;

    ctx.save();
    ctx.fillStyle = token.textMuted;
    ctx.font = `400 ${token.fontBody}px ${token.fontFamily}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('Name your driver.', view.x, view.y);
    ctx.restore();

    const nameH = Math.max(pad(token, 7), token.fontDisplay * 1.7);
    const rerollW = ensureMinTouch(pad(token, 8), token);
    const nameY = view.y + token.fontBody + pad(token, 1.5);
    this.nameBox = {
      x: view.x,
      y: nameY,
      w: fieldW - rerollW - pad(token, 1),
      h: nameH,
    };

    ctx.save();
    ctx.fillStyle = this.editing ? 'rgba(240,196,26,0.10)' : 'rgba(255,255,255,0.04)';
    ctx.strokeStyle = this.editing ? def.accent : 'rgba(255,255,255,0.18)';
    ctx.lineWidth = this.editing ? 2 : 1;
    ctx.beginPath();
    ctx.roundRect(this.nameBox.x, this.nameBox.y, this.nameBox.w, this.nameBox.h, pad(token, 0.5));
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = this.nameBuf.length > 0 ? token.text : token.textDim;
    ctx.font = `600 ${token.fontDisplay}px ${token.fontDisplayFamily}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const display = this.nameBuf.length > 0 ? this.nameBuf : 'Type a name…';
    ctx.fillText(
      truncateText(ctx, display, this.nameBox.w - pad(token, 3)),
      this.nameBox.x + pad(token, 1.5),
      this.nameBox.y + nameH / 2,
    );
    if (this.editing && Math.floor(performance.now() / 500) % 2 === 0) {
      const tw = ctx.measureText(truncateText(ctx, display, this.nameBox.w - pad(token, 3))).width;
      ctx.fillStyle = def.accent;
      ctx.fillRect(
        this.nameBox.x + pad(token, 1.5) + tw + 2,
        this.nameBox.y + nameH * 0.28,
        2,
        nameH * 0.44,
      );
    }
    ctx.restore();

    const reroll: ButtonDef = {
      x: this.nameBox.x + this.nameBox.w + pad(token, 1),
      y: this.nameBox.y,
      w: rerollW,
      h: nameH,
      label: 'Reroll',
      onClick: () => {
        this.randomName();
        this.editing = true;
      },
    };
    drawButton(ctx, reroll, ui);
    handleButton(reroll, ui);

    if (ui.pointerClicked && hitRect(ui.pointerX, ui.pointerY, this.nameBox.x, this.nameBox.y, this.nameBox.w, this.nameBox.h)) {
      this.editing = true;
    } else if (
      ui.pointerClicked &&
      !hitRect(ui.pointerX, ui.pointerY, reroll.x, reroll.y, reroll.w, reroll.h)
    ) {
      this.editing = false;
    }

    const sw = pad(token, 4);
    const gap = pad(token, 1);
    const swatchY = this.nameBox.y + this.nameBox.h + pad(token, 3);
    ctx.save();
    ctx.fillStyle = token.textMuted;
    ctx.font = `600 ${token.fontCaption}px ${token.fontFamily}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('HELMET', view.x, swatchY - pad(token, 0.6));
    ctx.restore();

    const totalW = DRIVER_COLORS.length * sw + (DRIVER_COLORS.length - 1) * gap;
    let sx = cx - totalW / 2;
    DRIVER_COLORS.forEach((col, i) => {
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

    const traitY = swatchY + sw + pad(token, 3);
    const trait = TRAITS[this.traitIndex]!;
    const chevW = ensureMinTouch(pad(token, 5.5), token);
    const traitH = Math.max(pad(token, 9), token.fontBody * 3.4);
    const prev: ButtonDef = {
      x: view.x,
      y: traitY,
      w: chevW,
      h: traitH,
      label: '<',
      onClick: () => {
        this.traitIndex = (this.traitIndex + TRAITS.length - 1) % TRAITS.length;
      },
    };
    const next: ButtonDef = {
      x: view.x + fieldW - chevW,
      y: traitY,
      w: chevW,
      h: traitH,
      label: '>',
      onClick: () => {
        this.traitIndex = (this.traitIndex + 1) % TRAITS.length;
      },
    };
    drawButton(ctx, prev, ui);
    drawButton(ctx, next, ui);
    handleButton(prev, ui);
    handleButton(next, ui);

    ctx.save();
    const bodyX = prev.x + prev.w + pad(token, 1);
    const bodyW = next.x - bodyX - pad(token, 1);
    ctx.fillStyle = token.card;
    ctx.beginPath();
    ctx.roundRect(bodyX, traitY, bodyW, traitH, pad(token, 0.4));
    ctx.fill();
    ctx.fillStyle = def.accent;
    ctx.font = `600 ${token.fontBody}px ${token.fontFamily}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(trait.name, bodyX + pad(token, 1.5), traitY + pad(token, 1.2));
    ctx.fillStyle = token.textMuted;
    ctx.font = `400 ${token.fontCaption}px ${token.fontFamily}`;
    ctx.fillText(
      truncateText(ctx, trait.description, bodyW - pad(token, 3)),
      bodyX + pad(token, 1.5),
      traitY + pad(token, 1.2) + token.fontBody * 1.5,
    );
    ctx.restore();

    const footer = shell.footerRect;
    if (footer !== null) {
      paintFooterDock(ctx, w, h, footer, token);
      const confirm = heroFooterButton(footer, token, {
        label: 'Create Driver',
        onClick: () => this.confirm(),
      });
      drawButton(ctx, confirm, ui);
      handleButton(confirm, ui);
    }
  }

  private confirm(): void {
    const g = getGameContext();
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
    void import('./TitleScene').then(({ TitleScene }) => {
      g.scenes.replaceRoot(new TitleScene());
      g.scenes.push(careerHomeScene());
    });
  }
}
