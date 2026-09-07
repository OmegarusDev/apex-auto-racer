import type { Scene } from '../engine/SceneManager';
import { getGameContext } from '../engine/GameContext';
import { getDiscipline, type DisciplineId } from '../data/disciplines';
import { DISCIPLINE_ORDER } from '../career/disciplinesUi';
import {
  drawHeader,
  handleHeader,
  drawCard,
  hitRect,
  pad,
  layoutShell,
  truncateText,
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

const DISCIPLINE_BLURB: Record<DisciplineId, string> = {
  track: 'Circuits. Downforce. Precision.',
  street: 'Night roads. Tight walls. Low grip.',
  rally: 'Dirt, jumps, and slides.',
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
    const g = getGameContext();
    g.cancelNewCareer();
    if (g.scenes.depth > 1) g.scenes.back();
    else {
      void import('./TitleScene').then(({ TitleScene }) => {
        getGameContext().scenes.replace(new TitleScene());
      });
    }
    return true;
  }

  render(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const { ui, token } = buildUi(w, h, 0, BRAND_SIGNAL);
    drawBackground(ctx, w, h, token);
    const shell = layoutShell(w, h, token);

    const header: HeaderDef = {
      x: shell.headerRect.x,
      y: shell.headerRect.y,
      w: shell.headerRect.w,
      h: shell.headerRect.h,
      title: 'New Career',
      back: true,
      onBack: () => this.handleBack(),
    };
    drawHeader(ctx, header, ui);
    handleHeader(header, ui);

    const view = shell.contentRect;
    ctx.save();
    ctx.fillStyle = token.textMuted;
    ctx.font = `400 ${token.fontBody}px ${token.fontFamily}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(
      truncateText(ctx, 'Pick a series. Each career is its own save.', view.w),
      view.x,
      view.y,
    );
    ctx.restore();

    const top = view.y + token.fontBody + pad(token, 2);
    const bottom = view.y + view.h;
    const gap = pad(token, 1.25);
    const cardH = Math.max(
      pad(token, 11),
      (bottom - top - gap * (DISCIPLINE_ORDER.length - 1)) / DISCIPLINE_ORDER.length,
    );
    const cardW = view.w;
    const cardX = view.x;

    this.cards = [];
    DISCIPLINE_ORDER.forEach((id, i) => {
      const y = top + i * (cardH + gap);
      this.cards.push({ id, x: cardX, y, w: cardW, h: cardH });

      const def = getDiscipline(id);
      drawCard(ctx, { x: cardX, y, w: cardW, h: cardH }, ui);

      ctx.save();
      ctx.fillStyle = def.accent;
      ctx.fillRect(cardX, y, Math.max(3, pad(token, 0.45)), cardH);

      const padX = cardX + pad(token, 2);
      ctx.fillStyle = '#f2efe6';
      ctx.font = `600 ${token.fontDisplay * 1.15}px ${token.fontDisplayFamily}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(def.name, padX, y + cardH * 0.38);

      ctx.fillStyle = 'rgba(242,239,230,0.62)';
      ctx.font = `400 ${token.fontBody}px ${token.fontFamily}`;
      ctx.fillText(DISCIPLINE_BLURB[id], padX, y + cardH * 0.62);

      ctx.fillStyle = def.accent;
      ctx.font = `600 ${token.fontCaption}px ${token.fontFamily}`;
      ctx.fillText('Start  →', padX, y + cardH * 0.82);
      ctx.restore();

      if (ui.pointerClicked && hitRect(ui.pointerX, ui.pointerY, cardX, y, cardW, cardH)) {
        getGameContext().scenes.push(new DriverCreateScene(id));
      }
    });
  }
}
