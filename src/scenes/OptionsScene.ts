import type { Scene } from '../engine/SceneManager';
import { getGameContext } from '../engine/GameContext';
import { DEFAULT_RACE_ZOOM, type VolumeOptions } from '../engine/types';
import {
  drawButton,
  handleButton,
  drawHeader,
  handleHeader,
  drawModal,
  handleModal,
  layoutModalButtons,
  drawSectionTitle,
  drawSlider,
  handleSlider,
  sliderRowH,
  layoutShell,
  ContentScroller,
  pad,
  ensureMinTouch,
  ToastManager,
  type ButtonDef,
  type ModalDef,
  type SliderDef,
} from '../ui/components';
import { ACCENT_TRACK } from '../ui/theme';
import { HOW_TO_PLAY } from '../ui/howToPlay';
import { buildUi, drawBackground, onSceneEnter, onSceneResize } from './sceneChrome';
import { DisciplineSelectScene } from './DisciplineSelectScene';

export class OptionsScene implements Scene {
  private toasts = new ToastManager();
  private modal: ModalDef = { open: false, title: '', body: '', buttons: [] };
  private scroller = new ContentScroller();
  private detachWheel: (() => void) | null = null;
  /** Live fallback so sliders work before any save exists. */
  private localVols: VolumeOptions | null = null;
  private localZoom: number | null = null;

  enter(): void {
    onSceneEnter();
    this.modal.open = false;
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

  handleBack(): boolean {
    if (this.modal.open) {
      this.modal.open = false;
      return true;
    }
    getGameContext().scenes.back();
    return true;
  }

  update(dt: number): void {
    this.toasts.update(dt);
  }

  private volumes(): VolumeOptions {
    const g = getGameContext();
    if (g.state !== null) return g.state.options.volumes;
    if (this.localVols === null) {
      this.localVols = { master: 0.8, engine: 0.28, fx: 0.5, crowd: 0.45, ui: 0.6 };
    }
    return this.localVols;
  }

  private setVolume(key: keyof VolumeOptions, value: number): void {
    const g = getGameContext();
    const vols = this.volumes();
    vols[key] = value;
    g.audio.setVolumes(vols);
    if (g.state !== null) {
      g.state.options.volumes[key] = value;
      g.autosave();
    }
  }

  private raceZoom(): number {
    const g = getGameContext();
    if (g.state !== null) {
      const z = g.state.options.raceZoom;
      return typeof z === 'number' && Number.isFinite(z) ? Math.max(0, Math.min(1, z)) : DEFAULT_RACE_ZOOM;
    }
    return this.localZoom ?? DEFAULT_RACE_ZOOM;
  }

  private setRaceZoom(value: number): void {
    const z = Math.max(0, Math.min(1, value));
    const g = getGameContext();
    if (g.state !== null) {
      g.state.options.raceZoom = z;
      g.autosave();
    } else {
      this.localZoom = z;
    }
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

  private openNewCareerConfirm(): void {
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
          label: 'Continue',
          primary: true,
          onClick: () => this.openNewCareerConfirm2(),
        },
      ],
    };
  }

  private openNewCareerConfirm2(): void {
    this.modal = {
      open: true,
      title: 'Are you absolutely sure?',
      body: 'All progress will be lost.',
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
            const g = getGameContext();
            g.startNewGame();
            this.modal.open = false;
            g.scenes.replaceRoot(new DisciplineSelectScene());
          },
        },
      ],
    };
  }

  render(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const g = getGameContext();
    const { ui, token } = buildUi(w, h, 0, ACCENT_TRACK);
    const vols = this.volumes();
    const shell = layoutShell(w, h, token);
    const hasSave = g.save.hasSave();

    drawBackground(ctx, w, h, token);

    const header = {
      x: shell.headerRect.x,
      y: shell.headerRect.y,
      w: shell.headerRect.w,
      h: shell.headerRect.h,
      title: 'Options',
      back: true,
      onBack: () => g.scenes.back(),
    };
    drawHeader(ctx, header, ui);

    const view = shell.contentRect;
    const rowH = sliderRowH(token);
    const trackH = pad(token, 0.75);
    const btnH = ensureMinTouch(pad(token, 5.5), token);
    const sectionGap = pad(token, 2);
    const resetH = Math.max(btnH, pad(token, 6));

    let contentH =
      btnH + sectionGap +
      token.fontCaption + pad(token, 0.75) + pad(token, 1) +
      rowH * 5 +
      sectionGap +
      token.fontCaption + pad(token, 0.75) + pad(token, 1) +
      rowH;
    if (hasSave) {
      contentH +=
        sectionGap +
        token.fontCaption + pad(token, 0.75) + pad(token, 1) +
        resetH;
    }

    this.scroller.layout(view, contentH);
    this.scroller.update(ui, view);
    const lui = this.scroller.localUi(ui, view);

    this.scroller.begin(ctx, view);
    let y = 0;

    const howBtn: ButtonDef = {
      x: pad(token, 1.5),
      y,
      w: view.w - pad(token, 3),
      h: btnH,
      label: 'How to Play',
      primary: true,
      onClick: () => this.openHowTo(),
    };
    drawButton(ctx, howBtn, lui);
    if (!this.modal.open) handleButton(howBtn, lui);
    y += btnH + sectionGap;

    y += drawSectionTitle(ctx, 0, y, 'Audio', lui);
    y += pad(token, 1);

    const keys: { key: keyof VolumeOptions; label: string }[] = [
      { key: 'master', label: 'Master Volume' },
      { key: 'engine', label: 'Engine Volume' },
      { key: 'fx', label: 'FX Volume' },
      { key: 'crowd', label: 'Crowd Volume' },
      { key: 'ui', label: 'UI Volume' },
    ];

    for (const { key, label } of keys) {
      const slider: SliderDef = {
        x: 0,
        y,
        w: view.w,
        h: trackH,
        label,
        value: vols[key],
        onChange: (v) => this.setVolume(key, v),
      };
      drawSlider(ctx, slider, lui);
      if (!this.modal.open) handleSlider(slider, lui);
      y += rowH;
    }

    y += sectionGap;
    y += drawSectionTitle(ctx, 0, y, 'Camera', lui);
    y += pad(token, 1);
    const zoomSlider: SliderDef = {
      x: 0,
      y,
      w: view.w,
      h: trackH,
      label: 'Race Zoom',
      value: this.raceZoom(),
      onChange: (v) => this.setRaceZoom(v),
    };
    drawSlider(ctx, zoomSlider, lui);
    if (!this.modal.open) handleSlider(zoomSlider, lui);
    y += rowH;

    if (hasSave) {
      y += sectionGap;
      y += drawSectionTitle(ctx, 0, y, 'Career', lui);
      y += pad(token, 1);
      const newBtn: ButtonDef = {
        x: pad(token, 1.5),
        y,
        w: view.w - pad(token, 3),
        h: resetH,
        label: 'New Career',
        onClick: () => this.openNewCareerConfirm(),
      };
      drawButton(ctx, newBtn, lui);
      if (!this.modal.open) handleButton(newBtn, lui);
    }

    this.scroller.end(ctx);

    handleHeader(header, ui);

    if (this.modal.open) layoutModalButtons(this.modal, ui);
    drawModal(ctx, this.modal, ui);
    handleModal(this.modal, ui);

    this.toasts.draw(ctx, ui);
  }
}
