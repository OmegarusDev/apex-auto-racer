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
  ToastManager,
  type ButtonDef,
  type ModalDef,
} from '../ui/components';
import {
  buildUi,
  computeTitleLayout,
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
      scrim.addColorStop(0, 'rgba(10,10,12,0.15)');
      scrim.addColorStop(0.35, 'rgba(10,10,12,0.55)');
      scrim.addColorStop(1, 'rgba(10,10,12,0.78)');
      ctx.fillStyle = scrim;
      const r = pad(token, 1);
      ctx.beginPath();
      ctx.roundRect(s.x, s.y, s.w, s.h, r);
      ctx.fill();
      ctx.restore();
    }

    const hasSave = g.save.hasSave();
    let btnY = layout.menuY;
    const btnX = layout.menuX;
    const btnW = layout.menuW;
    const btnH = layout.btnH;
    const btnGap = layout.btnGap;

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
