import type { Scene } from '../engine/SceneManager';
import { getGameContext } from '../engine/GameContext';
import { mulberry32, pick } from '../engine/rng';
import { activeDriver } from '../engine/SaveManager';
import {
  drawButton,
  handleButton,
  drawHeader,
  handleHeader,
  drawModal,
  handleModal,
  layoutModalButtons,
  headerBandH,
  pad,
  ToastManager,
  type ButtonDef,
  type HeaderDef,
  type ModalDef,
} from '../ui/components';
import { BRAND_SIGNAL } from '../ui/brand';
import { HOW_TO_PLAY } from '../ui/howToPlay';
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
  type TitlePreviewTrack,
} from './titleArt';
import { DISCIPLINE_ORDER } from '../career/disciplinesUi';
import { OptionsScene } from './OptionsScene';
import { DisciplineSelectScene } from './DisciplineSelectScene';
import { QuickRaceSetupScene } from './QuickRaceSetupScene';
import { LoadCareerScene } from './LoadCareerScene';
import { careerHomeScene } from './careerHome';

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

  private openHowTo(): void {
    this.modal = {
      open: true,
      title: 'How to Play',
      body: HOW_TO_PLAY,
      buttons: [
        {
          x: 0,
          y: 0,
          w: 0,
          h: 0,
          label: 'Got it',
          primary: true,
          onClick: () => {
            this.modal.open = false;
          },
        },
      ],
    };
  }

  render(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const g = getGameContext();
    const state = g.state;
    const active = state !== null ? activeDriver(state) : null;
    const slots = g.save.listSaves();
    const canContinue = active !== null;
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

    const chrome: HeaderDef = {
      x: 0,
      y: 0,
      w,
      h: headerBandH(token),
      title: '',
      ghost: true,
      settings: true,
      onSettings: () => g.scenes.push(new OptionsScene()),
    };
    drawHeader(ctx, chrome, ui);

    const rows = titleMenuRowHeights(token, layout.btnH);
    const plateFont = layout.plateFont;
    const cta: ButtonDef = {
      x: layout.menuX,
      y: layout.menuY,
      w: layout.menuW,
      h: rows.primary,
      label: canContinue ? 'Continue' : 'New Career',
      primary: true,
      cta: true,
      fontSize: Math.max(layout.btnFont, token.fontTitle),
      onClick: () => {
        if (canContinue) g.scenes.push(careerHomeScene());
        else this.beginCareer();
      },
    };
    drawButton(ctx, cta, ui);
    if (!this.modal.open) handleButton(cta, ui);

    const linkY = layout.menuY + rows.primary + rows.gap;
    const linkW = (layout.menuW - pad(token, 1)) * 0.5;
    const left: ButtonDef = {
      x: layout.menuX,
      y: linkY,
      w: linkW,
      h: rows.linkRow,
      label: canContinue ? 'New Career' : 'Quick Race',
      fontSize: plateFont,
      onClick: () => {
        if (canContinue) this.beginCareer();
        else g.scenes.push(new QuickRaceSetupScene({ returnTo: 'title' }));
      },
    };
    const right: ButtonDef = {
      x: layout.menuX + linkW + pad(token, 1),
      y: linkY,
      w: linkW,
      h: rows.linkRow,
      label: slots.length > 0 ? 'Load Career' : 'How to Play',
      fontSize: plateFont,
      onClick: () => {
        if (slots.length > 0) g.scenes.push(new LoadCareerScene());
        else this.openHowTo();
      },
    };
    drawButton(ctx, left, ui);
    drawButton(ctx, right, ui);
    if (!this.modal.open) {
      handleButton(left, ui);
      handleButton(right, ui);
    }

    if (canContinue) {
      const qr: ButtonDef = {
        x: layout.menuX,
        y: linkY + rows.linkRow + rows.quietGap,
        w: layout.menuW,
        h: rows.quietRow,
        label: 'Quick Race',
        fontSize: plateFont,
        onClick: () => g.scenes.push(new QuickRaceSetupScene({ returnTo: 'title' })),
      };
      drawButton(ctx, qr, ui);
      if (!this.modal.open) handleButton(qr, ui);
    } else {
      ctx.save();
      ctx.font = `500 ${token.fontBody}px ${token.fontFamily}`;
      ctx.fillStyle = token.textDim;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        'Hold gas. The car steers.',
        layout.menuX + layout.menuW * 0.5,
        linkY + rows.linkRow + rows.quietGap + rows.quietRow * 0.5,
      );
      ctx.restore();
    }

    if (!this.modal.open) handleHeader(chrome, ui);

    if (this.modal.open) layoutModalButtons(this.modal, ui);
    drawModal(ctx, this.modal, ui);
    handleModal(this.modal, ui);

    this.toasts.draw(ctx, ui, {
      avoidBottomPx: h - layout.menuY + pad(token, 1),
    });
  }
}
