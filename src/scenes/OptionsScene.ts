import type { Scene } from '../engine/SceneManager';
import { getGameContext } from '../engine/GameContext';
import type { VolumeOptions } from '../engine/types';
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
import { buildUi, drawBackground, onSceneEnter, onSceneResize } from './sceneUtils';
import { TitleScene } from './TitleScene';

type ResetStep = 'none' | 'confirm1' | 'confirm2';

export class OptionsScene implements Scene {
  private toasts = new ToastManager();
  private resetStep: ResetStep = 'none';
  private modal: ModalDef = { open: false, title: '', body: '', buttons: [] };
  private scroller = new ContentScroller();
  private detachWheel: (() => void) | null = null;

  enter(): void {
    onSceneEnter();
    this.resetStep = 'none';
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
      this.resetStep = 'none';
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
    return { master: 0.8, engine: 0.28, fx: 0.5, crowd: 0.45, ui: 0.6 };
  }

  private setVolume(key: keyof VolumeOptions, value: number): void {
    const g = getGameContext();
    if (g.state === null) return;
    g.state.options.volumes[key] = value;
    g.audio.setVolumes(g.state.options.volumes);
    g.autosave();
  }

  private openResetConfirm(): void {
    this.resetStep = 'confirm1';
    this.modal = {
      open: true,
      title: 'Reset Save?',
      body: 'This will permanently delete\nyour career progress.',
      buttons: [
        {
          x: 0,
          y: 0,
          w: 0,
          h: 0,
          label: 'Cancel',
          onClick: () => {
            this.resetStep = 'none';
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
          onClick: () => this.openResetConfirm2(),
        },
      ],
    };
  }

  private openResetConfirm2(): void {
    this.resetStep = 'confirm2';
    this.modal = {
      open: true,
      title: 'Are you absolutely sure?',
      body: 'There is no undo.\nAll progress will be lost.',
      buttons: [
        {
          x: 0,
          y: 0,
          w: 0,
          h: 0,
          label: 'Cancel',
          onClick: () => {
            this.resetStep = 'none';
            this.modal.open = false;
          },
        },
        {
          x: 0,
          y: 0,
          w: 0,
          h: 0,
          label: 'Delete Save',
          primary: true,
          onClick: () => {
            const g = getGameContext();
            g.save.reset();
            g.state = null;
            this.modal.open = false;
            this.resetStep = 'none';
            this.toasts.push('Save deleted', '#f87171');
            g.scenes.replace(new TitleScene());
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
    const trackH = Math.max(6, pad(token, 0.7));
    const btnH = ensureMinTouch(pad(token, 5.5), token);
    const sectionGap = pad(token, 2);
    const contentH =
      token.fontCaption +
      pad(token, 1.5) +
      rowH * 5 +
      sectionGap +
      token.fontCaption +
      pad(token, 1) +
      btnH +
      pad(token, 2);

    this.scroller.layout(view, contentH);
    this.scroller.update(ui, view);
    const lui = this.scroller.localUi(ui, view);

    this.scroller.begin(ctx, view);
    let y = 0;
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
    y += drawSectionTitle(ctx, 0, y, 'Save Data', lui);
    y += pad(token, 1);
    const resetBtn: ButtonDef = {
      x: 0,
      y,
      w: view.w,
      h: btnH,
      label: 'Reset Save',
      onClick: () => this.openResetConfirm(),
    };
    drawButton(ctx, resetBtn, lui);
    if (!this.modal.open) handleButton(resetBtn, lui);
    this.scroller.end(ctx);

    handleHeader(header, ui);

    if (this.modal.open) layoutModalButtons(this.modal, ui);
    drawModal(ctx, this.modal, ui);
    handleModal(this.modal, ui);

    this.toasts.draw(ctx, ui);
    void this.resetStep;
  }
}
