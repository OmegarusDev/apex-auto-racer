import type { Scene } from '../engine/SceneManager';
import { getGameContext } from '../engine/GameContext';
import { mulberry32, pick } from '../engine/rng';
import { activeDriver } from '../engine/SaveManager';
import {
  drawButton,
  handleButton,
  drawModal,
  handleModal,
  layoutModalButtons,
  pad,
  ToastManager,
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
import {
  computeTitleLayout,
  createTitlePreviewTrack,
  drawRibbonTrack,
  drawTitleAtmosphere,
  drawTitleLogo,
  freshTitlePreviewSeed,
  titleMenuRowHeights,
  titleMenuStackHeight,
  type TitlePreviewTrack,
} from './titleArt';
import { DISCIPLINE_ORDER } from '../career/disciplinesUi';
import { OptionsScene } from './OptionsScene';
import { DisciplineSelectScene } from './DisciplineSelectScene';
import { CareerHubScene } from './CareerHubScene';
import { QuickRaceSetupScene } from './QuickRaceSetupScene';

export class TitleScene implements Scene {
  private time = 0;
  private audioUnlocked = false;
  private modal: ModalDef = { open: false, title: '', body: '', buttons: [] };
  private toasts = new ToastManager();
  private preview: TitlePreviewTrack = { planar: [], halfWidth: 0.085 };

  enter(): void {
    onSceneEnter();
    this.modal.open = false;
    if (this.preview.planar.length === 0) {
      const seed = freshTitlePreviewSeed();
      const discipline = pick(mulberry32(seed), DISCIPLINE_ORDER);
      this.preview = createTitlePreviewTrack(seed ^ 0x9e3779b9, discipline);
    }

    const g = getGameContext();
    const warn = g.save.consumeWarning();
    if (warn === 'corrupt_reset') {
      this.toasts.push('Save was corrupt — started a new career', '#f87171', 6);
    } else if (warn === 'storage_unavailable') {
      this.toasts.push('Storage unavailable — progress may not save', '#f87171', 5);
    }
  }

  exit(): void {}

  onResize(w: number, h: number): void {
    onSceneResize(w, h);
  }

  update(dt: number): void {
    this.time += dt;
    this.toasts.update(dt);
    const g = getGameContext();
    if (!this.audioUnlocked && g.input.peekClick() !== null) {
      void g.audio.unlock();
      this.audioUnlocked = true;
    }
  }

  handleBack(): boolean {
    if (this.modal.open) {
      this.modal.open = false;
      return true;
    }
    return false;
  }

  private beginCareer(): void {
    const g = getGameContext();
    g.startNewGame();
    g.scenes.push(new DisciplineSelectScene());
  }

  private confirmNewCareer(): void {
    this.modal = {
      open: true,
      title: 'New Career?',
      body: 'This replaces your current career.\nThere is no undo.',
      buttons: [
        {
          x: 0,
          y: 0,
          w: 0,
          h: 0,
          label: 'Cancel',
          onClick: () => {
            this.modal.open = false;
          },
        },
        {
          x: 0,
          y: 0,
          w: 0,
          h: 0,
          label: 'Start New',
          danger: true,
          onClick: () => {
            this.modal.open = false;
            this.beginCareer();
          },
        },
      ],
    };
  }

  private onNewCareer(): void {
    const g = getGameContext();
    if ((g.state?.roster.length ?? 0) > 0) {
      this.confirmNewCareer();
      return;
    }
    this.beginCareer();
  }

  render(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const g = getGameContext();
    const state = g.state;
    const active = state !== null ? activeDriver(state) : null;
    const { ui, token } = buildUi(w, h, 0, BRAND_SIGNAL);
    const layout = computeTitleLayout(w, h, token);

    drawBackground(ctx, w, h, token);
    drawTitleAtmosphere(ctx, w, h, this.time, layout.fadeTop);

    drawRibbonTrack(ctx, w, h, this.time, token, {
      cx: layout.trackCx,
      cy: layout.trackCy,
      scale: layout.trackScale,
      planar: this.preview.planar,
      halfWidth: this.preview.halfWidth,
    });

    drawTitleLogo(ctx, layout.logoX, layout.logoY, token, {
      align: layout.logoAlign,
      apexSize: layout.apexSize,
    });

    if (layout.menuScrim !== null) {
      const s = layout.menuScrim;
      ctx.save();
      const scrim = ctx.createLinearGradient(s.x, s.y, s.x, s.y + s.h);
      scrim.addColorStop(0, 'rgba(11,13,12,0)');
      scrim.addColorStop(1, 'rgba(11,13,12,0.72)');
      ctx.fillStyle = scrim;
      ctx.fillRect(s.x, s.y, s.w, s.h);
      ctx.restore();
    }

    const rows = titleMenuRowHeights(token, layout.btnH);
    const cta: ButtonDef = {
      x: layout.menuX,
      y: layout.menuY,
      w: layout.menuW,
      h: rows.primary,
      label: active !== null ? 'Continue' : 'New Career',
      primary: true,
      cta: true,
      fontSize: Math.max(layout.btnFont, token.fontBody),
      onClick: () => {
        if (active !== null) g.scenes.push(new CareerHubScene());
        else this.onNewCareer();
      },
    };
    drawButton(ctx, cta, ui);
    if (!this.modal.open) handleButton(cta, ui);

    const linkY = layout.menuY + rows.primary + rows.gap;
    const linkW = (layout.menuW - pad(token, 1)) * 0.5;
    const quick: ButtonDef = {
      x: layout.menuX,
      y: linkY,
      w: linkW,
      h: rows.linkRow,
      label: 'Quick Race',
      quiet: true,
      fontSize: token.fontBody,
      onClick: () => g.scenes.push(new QuickRaceSetupScene({ returnTo: 'title' })),
    };
    const opts: ButtonDef = {
      x: layout.menuX + linkW + pad(token, 1),
      y: linkY,
      w: linkW,
      h: rows.linkRow,
      label: 'Options',
      quiet: true,
      fontSize: token.fontBody,
      onClick: () => g.scenes.push(new OptionsScene()),
    };
    drawButton(ctx, quick, ui);
    drawButton(ctx, opts, ui);
    if (!this.modal.open) {
      handleButton(quick, ui);
      handleButton(opts, ui);
    }

    if (this.modal.open) layoutModalButtons(this.modal, ui);
    drawModal(ctx, this.modal, ui);
    handleModal(this.modal, ui);

    this.toasts.draw(ctx, ui, {
      avoidBottomPx: titleMenuStackHeight(token, layout.btnH) + pad(token, 2),
    });
  }
}
