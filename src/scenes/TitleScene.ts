import type { Scene } from '../engine/SceneManager';
import { getGameContext } from '../engine/GameContext';
import { createNewGame } from '../engine/SaveManager';
import { mulberry32, pick } from '../engine/rng';
import type { GameState } from '../engine/types';
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
  createTitlePreviewTrack,
  DISCIPLINE_ORDER,
  drawBackground,
  drawRibbonTrack,
  drawTitleAtmosphere,
  drawTitleLogo,
  freshTitlePreviewSeed,
  launchRace,
  makeQuickRaceConfig,
  onSceneEnter,
  onSceneResize,
  type TitlePreviewTrack,
} from './sceneUtils';
import { GarageScene } from './GarageScene';
import { OptionsScene } from './OptionsScene';

/** Load save if present; otherwise create an in-memory roster without persisting. */
function ensureQuickRaceState(): GameState {
  const g = getGameContext();
  if (g.state !== null) return g.state;
  const loaded = g.bootstrap();
  if (loaded !== null) return loaded;
  const seed = Date.now() >>> 0;
  const state = createNewGame(mulberry32(seed), seed);
  g.state = state; // setState only — does not autosave / wipe storage
  g.audio.setVolumes(state.options.volumes);
  return state;
}

export class TitleScene implements Scene {
  private time = 0;
  private audioUnlocked = false;
  private modal: ModalDef = { open: false, title: '', body: '', buttons: [] };
  private toasts = new ToastManager();
  private preview: TitlePreviewTrack = { planar: [], halfWidth: 0.085 };

  enter(): void {
    onSceneEnter();
    this.time = 0;
    this.modal.open = false;
    // Cosmetic-only RNG: new circuit each visit; does not touch race seeds.
    const seed = freshTitlePreviewSeed();
    const discipline = pick(mulberry32(seed), DISCIPLINE_ORDER);
    this.preview = createTitlePreviewTrack(seed ^ 0x9e3779b9, discipline);
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
    const landscape = w > h * 1.2;

    drawBackground(ctx, w, h, token);
    drawTitleAtmosphere(ctx, w, h, this.time);

    const hasSave = g.save.hasSave();
    const btnW = landscape
      ? Math.min(w * 0.36, pad(token, 30))
      : Math.min(w - pad(token, 4), pad(token, 28));
    const btnH = ensureMinTouch(pad(token, 5), token);
    const btnGap = pad(token, 0.55);
    const menuH = btnH * 4 + btnGap * 3;

    let logoX: number;
    let logoY: number;
    let logoAlign: 'center' | 'left';
    let trackCx: number;
    let trackCy: number;
    let trackScale: number;
    let btnX: number;
    let btnY: number;

    if (landscape) {
      const colX = token.safe.left + pad(token, 3);
      logoX = colX;
      logoY = h * 0.14 + token.safe.top;
      logoAlign = 'left';
      trackCx = w * 0.68;
      trackCy = h * 0.48;
      trackScale = Math.min(w, h) * 0.42;
      btnX = colX;
      btnY = Math.min(h - token.safe.bottom - menuH - pad(token, 2), h * 0.48);
    } else {
      logoX = w * 0.5;
      logoY = h * 0.08 + token.safe.top;
      logoAlign = 'center';
      trackCx = w * 0.5;
      trackCy = h * 0.36;
      trackScale = Math.min(w, h) * 0.36;
      btnX = (w - btnW) * 0.5;
      const menuBottom = h - token.safe.bottom - pad(token, 2);
      btnY = Math.max(h * 0.54, menuBottom - menuH);
    }

    drawRibbonTrack(ctx, w, h, this.time, token, {
      cx: trackCx,
      cy: trackCy,
      scale: trackScale,
      planar: this.preview.planar,
      halfWidth: this.preview.halfWidth,
    });

    drawTitleLogo(ctx, logoX, logoY, token, { align: logoAlign });

    const continueBtn: ButtonDef = {
      x: btnX,
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
      x: btnX,
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

    const quickRaceBtn: ButtonDef = {
      x: btnX,
      y: btnY,
      w: btnW,
      h: btnH,
      label: 'Quick Race',
      primary: !hasSave,
      onClick: () => {
        const state = ensureQuickRaceState();
        if (state.roster.length < 1) {
          this.toasts.push('Need a driver on the roster', '#22d3ee');
          return;
        }
        const seedMaterial =
          (state.seed + state.careerStats.races * 9973 + state.careerStats.earnings) >>> 0;
        const discipline = pick(mulberry32(seedMaterial), DISCIPLINE_ORDER);
        launchRace(makeQuickRaceConfig(state, discipline), this.toasts);
      },
    };
    btnY += btnH + btnGap;

    const optionsBtn: ButtonDef = {
      x: btnX,
      y: btnY,
      w: btnW,
      h: btnH,
      label: 'Options',
      onClick: () => g.scenes.push(new OptionsScene()),
    };

    drawButton(ctx, continueBtn, ui);
    drawButton(ctx, newGameBtn, ui);
    drawButton(ctx, quickRaceBtn, ui);
    drawButton(ctx, optionsBtn, ui);

    handleButton(continueBtn, ui);
    handleButton(newGameBtn, ui);
    handleButton(quickRaceBtn, ui);
    handleButton(optionsBtn, ui);

    if (this.modal.open) layoutModalButtons(this.modal, ui);
    drawModal(ctx, this.modal, ui);
    handleModal(this.modal, ui);

    this.toasts.draw(ctx, ui);
  }
}
