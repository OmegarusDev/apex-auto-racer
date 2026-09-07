import type { Scene } from '../engine/SceneManager';
import { getGameContext } from '../engine/GameContext';
import { setActiveDriver } from '../engine/SaveManager';
import type { GameState } from '../engine/types';
import { getDiscipline, type DisciplineId } from '../data/disciplines';
import { DISCIPLINE_ORDER } from '../career/disciplinesUi';
import {
  drawButton,
  handleButton,
  drawCard,
  drawHeader,
  handleHeader,
  hitRect,
  pad,
  truncateText,
  type ButtonDef,
  type HeaderDef,
} from '../ui/components';
import { BRAND_SIGNAL } from '../ui/brand';
import {
  buildUi,
  drawBackground,
  onSceneEnter,
  onSceneResize,
} from './sceneChrome';
import { DriverCreateScene } from './DriverCreateScene';
import { CareerHubScene } from './CareerHubScene';
import { TitleScene } from './TitleScene';

const DISCIPLINE_BLURB: Record<DisciplineId, string> = {
  track: 'Smooth tarmac circuits. High downforce, precise lines, late braking.',
  street: 'Illegal night street races. Tight, technical, low grip.',
  rally: 'Loose-surface stages. Slides, jumps, raw acceleration.',
};

export class DisciplineSelectScene implements Scene {
  private cards: { id: DisciplineId; x: number; y: number; w: number; h: number }[] = [];

  enter(): void {
    onSceneEnter();
  }

  exit(): void {}

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

  private driverFor(state: GameState, id: DisciplineId) {
    return state.roster.find((d) => d.discipline === id) ?? null;
  }

  render(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const g = getGameContext();
    const state = g.state;
    const { ui, token } = buildUi(w, h, 0, BRAND_SIGNAL);
    drawBackground(ctx, w, h, token);

    const header: HeaderDef = {
      x: pad(token, 2),
      y: pad(token, 2),
      w: w - pad(token, 4),
      h: Math.max(token.fontDisplay * 2.2, pad(token, 9)),
      title: 'Choose Your Discipline',
      back: true,
      onBack: () => this.handleBack(),
    };
    drawHeader(ctx, header, ui);
    handleHeader(header, ui);

    const top = header.y + header.h + pad(token, 2);
    const bottom = h - pad(token, 2);
    const contentH = bottom - top;
    const gap = pad(token, 1.5);
    const cardH = Math.max(pad(token, 10), (contentH - gap * (DISCIPLINE_ORDER.length - 1)) / DISCIPLINE_ORDER.length);
    const cardW = Math.min(w - pad(token, 4), token.fontDisplay * 26);
    const cardX = (w - cardW) / 2;

    this.cards = [];
    DISCIPLINE_ORDER.forEach((id, i) => {
      const y = top + i * (cardH + gap);
      this.cards.push({ id, x: cardX, y, w: cardW, h: cardH });

      const def = getDiscipline(id);
      const existing = state !== null ? this.driverFor(state, id) : null;
      drawCard(ctx, { x: cardX, y, w: cardW, h: cardH }, ui);

      // Accent stripe
      ctx.save();
      ctx.fillStyle = def.accent;
      ctx.fillRect(cardX, y, Math.max(3, pad(token, 0.4)), cardH);
      ctx.restore();

      const padX = cardX + pad(token, 2);
      const nameY = y + cardH * 0.32;
      ctx.save();
      ctx.fillStyle = '#f2efe6';
      ctx.font = `600 ${token.fontDisplay * 1.4}px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(def.name, padX, nameY);

      ctx.fillStyle = 'rgba(242,239,230,0.62)';
      ctx.font = `400 ${token.fontBody}px Inter, system-ui, sans-serif`;
      const blurb = truncateText(ctx, DISCIPLINE_BLURB[id], cardW - pad(token, 4));
      ctx.fillText(blurb, padX, y + cardH * 0.58);

      ctx.fillStyle = def.accent;
      ctx.font = `600 ${token.fontBody}px Inter, system-ui, sans-serif`;
      const footer = existing ? `Resume  ·  ${existing.name}` : 'Start Career  →';
      ctx.fillText(footer, padX, y + cardH * 0.8);
      ctx.restore();

      if (ui.pointerClicked && hitRect(ui.pointerX, ui.pointerY, cardX, y, cardW, cardH)) {
        this.select(id);
      }
    });

    // Keep a footer hint if no save context (shouldn't normally happen).
    if (state === null) {
      const hint: ButtonDef = {
        x: cardX,
        y: bottom - pad(token, 6),
        w: cardW,
        h: pad(token, 5),
        label: 'Back',
        onClick: () => this.handleBack(),
      };
      drawButton(ctx, hint, ui);
      handleButton(hint, ui);
    }
  }

  private select(id: DisciplineId): void {
    const g = getGameContext();
    const state = g.state;
    if (state === null) {
      g.bootstrap();
    }
    const cur = g.state;
    if (cur === null) return;
    const existing = this.driverFor(cur, id);
    if (existing !== null) {
      setActiveDriver(cur, existing.id);
      g.state = cur;
      g.autosave();
      g.scenes.replaceRoot(new CareerHubScene());
    } else {
      g.scenes.push(new DriverCreateScene(id));
    }
  }
}
