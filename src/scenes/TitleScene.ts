import type { Scene } from '../engine/SceneManager';
import { getGameContext } from '../engine/GameContext';
import {
  drawButton,
  handleButton,
  drawModal,
  handleModal,
  layoutModalButtons,
  pad,
  ensureMinTouch,
  ToastManager,
  type ButtonDef,
  type ModalDef,
} from '../ui/components';
import {
  buildUi,
  drawBackground,
  drawRibbonTrack,
  drawTitleLogo,
  onSceneEnter,
  onSceneResize,
} from './sceneUtils';
import { GarageScene } from './GarageScene';
import { OptionsScene } from './OptionsScene';

export class TitleScene implements Scene {
  private time = 0;
  private audioUnlocked = false;
  private modal: ModalDef = { open: false, title: '', body: '', buttons: [] };
  private toasts = new ToastManager();

  enter(): void {
    onSceneEnter();
    this.time = 0;
    this.modal.open = false;
  }

  exit(): void {}

  onResize(w: number, h: number): void {
    onSceneResize(w, h);
  }

  handleBack(): boolean {
    return false;
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

  render(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const g = getGameContext();
    const { ui, token } = buildUi(w, h, 0, '#22d3ee');

    drawBackground(ctx, w, h, token);
    drawRibbonTrack(ctx, w, h, this.time, token);
    drawTitleLogo(ctx, w * 0.5, h * 0.12 + token.safe.top, token);

    const hasSave = g.save.hasSave();
    const btnW = Math.min(w - pad(token, 4), pad(token, 28));
    const btnH = ensureMinTouch(pad(token, 5.5), token);
    const btnGap = pad(token, 0.75);
    let btnY = h * 0.58;

    const continueBtn: ButtonDef = {
      x: (w - btnW) * 0.5,
      y: btnY,
      w: btnW,
      h: btnH,
      label: 'Continue',
      disabled: !hasSave,
      primary: hasSave,
      onClick: () => {
        if (!hasSave) return;
        g.bootstrap();
        g.scenes.replace(new GarageScene());
      },
    };
    btnY += btnH + btnGap;

    const newGameBtn: ButtonDef = {
      x: (w - btnW) * 0.5,
      y: btnY,
      w: btnW,
      h: btnH,
      label: 'New Game',
      onClick: () => {
        if (hasSave) {
          this.modal = {
            open: true,
            title: 'Overwrite Save?',
            body: 'Starting a new game will replace\nyour current progress.',
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
                label: 'New Game',
                primary: true,
                onClick: () => {
                  this.modal.open = false;
                  g.startNewGame();
                  g.scenes.replace(new GarageScene());
                },
              },
            ],
          };
        } else {
          g.startNewGame();
          g.scenes.replace(new GarageScene());
        }
      },
    };
    btnY += btnH + btnGap;

    const optionsBtn: ButtonDef = {
      x: (w - btnW) * 0.5,
      y: btnY,
      w: btnW,
      h: btnH,
      label: 'Options',
      onClick: () => g.scenes.push(new OptionsScene()),
    };

    drawButton(ctx, continueBtn, ui);
    drawButton(ctx, newGameBtn, ui);
    drawButton(ctx, optionsBtn, ui);

    handleButton(continueBtn, ui);
    handleButton(newGameBtn, ui);
    handleButton(optionsBtn, ui);

    if (this.modal.open) layoutModalButtons(this.modal, ui);
    drawModal(ctx, this.modal, ui);
    handleModal(this.modal, ui);

    this.toasts.draw(ctx, ui);
  }
}
