import type { Scene } from '../engine/SceneManager';
import { getGameContext } from '../engine/GameContext';
import type { SaveSlot } from '../engine/SaveManager';
import { getDiscipline } from '../data/disciplines';
import {
  drawButton,
  handleButton,
  drawHeader,
  handleHeader,
  drawCard,
  drawModal,
  handleModal,
  layoutModalButtons,
  layoutShell,
  ContentScroller,
  pad,
  ensureMinTouch,
  hitRect,
  truncateText,
  type ButtonDef,
  type ModalDef,
} from '../ui/components';
import { BRAND_SIGNAL } from '../ui/brand';
import {
  buildUi,
  drawBackground,
  onSceneEnter,
  onSceneResize,
} from './sceneChrome';
import { careerHomeScene } from './careerHome';

function fmtPlayed(ts: number): string {
  const delta = Date.now() - ts;
  if (delta < 60_000) return 'Just now';
  if (delta < 3_600_000) return `${Math.max(1, Math.floor(delta / 60_000))}m ago`;
  if (delta < 86_400_000) return `${Math.max(1, Math.floor(delta / 3_600_000))}h ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export class LoadCareerScene implements Scene {
  private modal: ModalDef = { open: false, title: '', body: '', buttons: [] };
  private scroller = new ContentScroller();
  private detachWheel: (() => void) | null = null;
  private pendingDelete: SaveSlot | null = null;

  enter(): void {
    onSceneEnter();
    this.modal.open = false;
    this.pendingDelete = null;
    this.scroller.scroll.offset = 0;
    this.detachWheel = this.scroller.attachWheel(getGameContext().canvas, () => !this.modal.open);
  }

  exit(): void {
    this.detachWheel?.();
    this.detachWheel = null;
  }

  onResize(w: number, h: number): void {
    onSceneResize(w, h);
  }

  update(_dt: number): void {}

  handleBack(): boolean {
    if (this.modal.open) {
      this.modal.open = false;
      this.pendingDelete = null;
      return true;
    }
    const s = getGameContext().scenes;
    if (s.depth > 1) s.back();
    else this.goTitle(false);
    return true;
  }

  private goTitle(thenHome: boolean): void {
    void import('./TitleScene').then(({ TitleScene }) => {
      const g = getGameContext();
      g.scenes.replaceRoot(new TitleScene());
      if (thenHome) g.scenes.push(careerHomeScene());
    });
  }

  private confirmDelete(slot: SaveSlot): void {
    const def = getDiscipline(slot.discipline);
    this.pendingDelete = slot;
    this.modal = {
      open: true,
      title: 'Delete career?',
      body: `${slot.name}'s ${def.name} save will be gone.\nOther careers are kept.`,
      buttons: [
        {
          x: 0,
          y: 0,
          w: 0,
          h: 0,
          label: 'Cancel',
          onClick: () => {
            this.modal.open = false;
            this.pendingDelete = null;
          },
        },
        {
          x: 0,
          y: 0,
          w: 0,
          h: 0,
          label: 'Delete',
          danger: true,
          onClick: () => this.deletePending(),
        },
      ],
    };
  }

  private deletePending(): void {
    const slot = this.pendingDelete;
    this.modal.open = false;
    this.pendingDelete = null;
    if (slot === null) return;
    const g = getGameContext();
    g.deleteCareer(slot.id);
    if (g.save.listSaves().length === 0) {
      this.goTitle(false);
    }
  }

  private loadSlot(slot: SaveSlot): void {
    const g = getGameContext();
    if (g.loadCareer(slot.id) === null) return;
    this.goTitle(true);
  }

  render(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const g = getGameContext();
    const slots = g.save.listSaves();
    const currentId = g.save.currentSlot()?.id ?? null;
    const { ui, token } = buildUi(w, h, 0, BRAND_SIGNAL);
    const shell = layoutShell(w, h, token);

    drawBackground(ctx, w, h, token);

    const header = {
      x: shell.headerRect.x,
      y: shell.headerRect.y,
      w: shell.headerRect.w,
      h: shell.headerRect.h,
      title: 'Load Career',
      back: true,
      onBack: () => this.handleBack(),
    };
    drawHeader(ctx, header, ui);

    const view = shell.contentRect;
    const cardH = Math.max(pad(token, 10), token.fontDisplay * 2.4);
    const gap = pad(token, 1);
    const delW = ensureMinTouch(pad(token, 7), token);
    const hintH = slots.length > 0 ? token.fontBody + pad(token, 1.5) : 0;
    const contentH = Math.max(view.h, hintH + slots.length * (cardH + gap) + pad(token, 2));

    this.scroller.layout(view, contentH);
    this.scroller.update(ui, view);
    const lui = this.scroller.localUi(ui, view);
    const interactive = !this.modal.open;

    this.scroller.begin(ctx, view);
    if (slots.length === 0) {
      ctx.save();
      ctx.fillStyle = token.textMuted;
      ctx.font = `500 ${token.fontBody}px ${token.fontFamily}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('No careers saved.', view.w * 0.5, view.h * 0.3);
      ctx.restore();
    }

    let y = 0;
    if (slots.length > 0) {
      ctx.save();
      ctx.fillStyle = token.textMuted;
      ctx.font = `400 ${token.fontBody}px ${token.fontFamily}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText('Tap a career to load.', pad(token, 0.25), y);
      ctx.restore();
      y += token.fontBody + pad(token, 1.5);
    }
    for (const slot of slots) {
      const def = getDiscipline(slot.discipline);
      const isCurrent = slot.id === currentId;
      drawCard(ctx, { x: 0, y, w: view.w, h: cardH }, lui);

      ctx.save();
      ctx.fillStyle = def.accent;
      ctx.fillRect(0, y, Math.max(3, pad(token, 0.4)), cardH);
      ctx.fillStyle = token.text;
      ctx.font = `600 ${token.fontDisplay}px ${token.fontDisplayFamily}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      const textMax = view.w - delW - pad(token, 4);
      ctx.fillText(truncateText(ctx, slot.name, textMax), pad(token, 2), y + pad(token, 3.2));
      ctx.font = `600 ${token.fontCaption}px ${token.fontFamily}`;
      ctx.fillStyle = def.accent;
      const tag = isCurrent ? `${def.name}  ·  Playing` : def.name;
      ctx.fillText(tag, pad(token, 2), y + pad(token, 3.2) + token.fontBody + pad(token, 0.4));
      ctx.font = `400 ${token.fontCaption}px ${token.fontFamily}`;
      ctx.fillStyle = token.textDim;
      ctx.fillText(fmtPlayed(slot.savedAt), pad(token, 2), y + cardH - pad(token, 1.4));
      ctx.restore();

      let loaded = false;
      const del: ButtonDef = {
        x: view.w - pad(token, 1.5) - delW,
        y: y + (cardH - ensureMinTouch(pad(token, 5), token)) * 0.5,
        w: delW,
        h: ensureMinTouch(pad(token, 5), token),
        label: 'Delete',
        danger: true,
        onClick: () => this.confirmDelete(slot),
      };
      drawButton(ctx, del, lui);
      if (interactive && handleButton(del, lui)) loaded = true;

      const loadHit = {
        x: 0,
        y,
        w: view.w - delW - pad(token, 2),
        h: cardH,
      };
      if (
        !loaded &&
        interactive &&
        lui.pointerClicked &&
        hitRect(lui.pointerX, lui.pointerY, loadHit.x, loadHit.y, loadHit.w, loadHit.h)
      ) {
        this.loadSlot(slot);
      }

      y += cardH + gap;
    }
    this.scroller.end(ctx);

    handleHeader(header, ui);

    if (this.modal.open) layoutModalButtons(this.modal, ui);
    drawModal(ctx, this.modal, ui);
    handleModal(this.modal, ui);
  }
}
