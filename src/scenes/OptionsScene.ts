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
  headerHeight,
  pad,
  ensureMinTouch,
  ToastManager,
  type ButtonDef,
  type ModalDef,
} from '../ui/components';
import { ACCENT_TRACK } from '../ui/theme';
import {
  buildUi,
  drawBackground,
  drawSlider,
  handleSlider,
  onSceneEnter,
  onSceneResize,
  type SliderDef,
} from './sceneUtils';
import { TitleScene } from './TitleScene';

type ResetStep = 'none' | 'confirm1' | 'confirm2';

export class OptionsScene implements Scene {
  private toasts = new ToastManager();
  private resetStep: ResetStep = 'none';
  private modal: ModalDef = { open: false, title: '', body: '', buttons: [] };

  enter(): void {
    onSceneEnter();
    this.resetStep = 'none';
    this.modal.open = false;
  }

  exit(): void {}

  onResize(w: number, h: number): void {
    onSceneResize(w, h);
  }

  handleBack(): boolean {
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

    drawBackground(ctx, w, h, token);

    const hh = headerHeight(token);
    const header = {
      x: 0,
      y: 0,
      w,
      h: hh + token.safe.top,
      title: 'Options',
      back: true,
      onBack: () => g.scenes.back(),
    };
    drawHeader(ctx, header, ui);

    const contentX = pad(token, 2) + token.safe.left;
    const contentW = w - pad(token, 4) - token.safe.left - token.safe.right;
    let y = hh + token.safe.top + pad(token, 2);
    const sliderH = ensureMinTouch(pad(token, 1.5), token);
    const sliderGap = pad(token, 4);

    y += drawSectionTitle(ctx, contentX, y, 'Audio', ui);
    y += pad(token, 1.5);

    const sliders: SliderDef[] = [
      {
        x: contentX,
        y,
        w: contentW,
        h: sliderH,
        label: 'Master Volume',
        value: vols.master,
        onChange: (v) => this.setVolume('master', v),
      },
      {
        x: contentX,
        y: y + sliderGap,
        w: contentW,
        h: sliderH,
        label: 'Engine Volume',
        value: vols.engine,
        onChange: (v) => this.setVolume('engine', v),
      },
      {
        x: contentX,
        y: y + sliderGap * 2,
        w: contentW,
        h: sliderH,
        label: 'FX Volume',
        value: vols.fx,
        onChange: (v) => this.setVolume('fx', v),
      },
      {
        x: contentX,
        y: y + sliderGap * 3,
        w: contentW,
        h: sliderH,
        label: 'Crowd Volume',
        value: vols.crowd,
        onChange: (v) => this.setVolume('crowd', v),
      },
      {
        x: contentX,
        y: y + sliderGap * 4,
        w: contentW,
        h: sliderH,
        label: 'UI Volume',
        value: vols.ui,
        onChange: (v) => this.setVolume('ui', v),
      },
    ];

    for (const slider of sliders) {
      drawSlider(ctx, slider, ui);
      handleSlider(slider, ui);
    }

    y += sliderGap * 5 + pad(token, 3);
    y += drawSectionTitle(ctx, contentX, y, 'Save Data', ui);
    y += pad(token, 1);
    const btnH = ensureMinTouch(pad(token, 5.5), token);
    const resetBtn: ButtonDef = {
      x: contentX,
      y,
      w: contentW,
      h: btnH,
      label: 'Reset Save',
      onClick: () => this.openResetConfirm(),
    };
    drawButton(ctx, resetBtn, ui);
    handleButton(resetBtn, ui);
    handleHeader(header, ui);

    if (this.modal.open) layoutModalButtons(this.modal, ui);
    drawModal(ctx, this.modal, ui);
    handleModal(this.modal, ui);

    this.toasts.draw(ctx, ui);
    void this.resetStep;
  }
}
