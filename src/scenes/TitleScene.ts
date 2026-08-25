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
  type TitlePreviewTrack,
} from './titleArt';
import { DISCIPLINE_ORDER } from '../career/disciplinesUi';
import { GarageScene } from './GarageScene';
import { OptionsScene } from './OptionsScene';
import { QuickRaceSetupScene } from './QuickRaceSetupScene';
import { makeTimeTrialConfig } from '../career/launchRace';
import { launchRace } from '../career/launchRace';

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
      scrim.addColorStop(0, 'rgba(11,13,12,0.1)');
      scrim.addColorStop(0.3, 'rgba(18, 40, 48, 0.35)');
      scrim.addColorStop(1, 'rgba(11,13,12,0.82)');
      ctx.fillStyle = scrim;
      const r = Math.max(2, pad(token, 0.35));
      ctx.beginPath();
      ctx.roundRect(s.x, s.y, s.w, s.h, r);
      ctx.fill();
      ctx.fillStyle = BRAND_SIGNAL;
      ctx.fillRect(s.x, s.y + pad(token, 0.5), Math.max(3, pad(token, 0.35)), s.h - pad(token));
      ctx.restore();
    }

const hasSave = g.save.hasSave();
    const btnFont = layout.btnFont;

    // ═══════════════════════════════════════════
    // PRIMARY CTA — QUICK RACE (large, prominent, top)
    // ═══════════════════════════════════════════
    let btnY = layout.menuY;

    const quickRaceBtn: ButtonDef = {
      x: layout.menuX,
      y: layout.menuY,
      w: layout.menuW,
      h: Math.max(layout.btnH + pad(token, 2), pad(token, 8)),
      label: '▶  Quick Race',
      cta: true,
      fontSize: Math.max(layout.btnFont, token.fontDisplay),
      onClick: () => {
        const state = ensureQuickRaceState();
        if (state.roster.length < 1) {
          this.toasts.push('Need a driver on the roster', BRAND_SIGNAL);
          return;
        }
        getGameContext().scenes.push(new QuickRaceSetupScene({ returnTo: 'title' }));
      },
    };
    drawButton(ctx, quickRaceBtn, { ...ui, accent: BRAND_SIGNAL });
    handleButton(quickRaceBtn, ui);

btnY = layout.menuY + Math.max(layout.btnH + pad(token, 2), pad(token, 8)) + pad(token, 2);

    // ═══════════════════════════════════════════
    // SECONDARY ACTIONS — Quick play modes
    // ═══════════════════════════════════════════
    const secondaryGap = pad(token, 1);
    const secondaryH = Math.max(layout.btnH, pad(token, 5.5));

    const timeTrialBtn: ButtonDef = {
      x: layout.menuX,
      y: btnY,
      w: Math.floor((layout.menuW - secondaryGap) * 0.5),
      h: secondaryH,
      label: '⏱  Time Trial',
      cta: false,
      fontSize: btnFont,
      onClick: () => {
        const state = ensureQuickRaceState();
        if (state.roster.length < 1) {
          this.toasts.push('Need a driver on the roster', BRAND_SIGNAL);
          return;
        }
        launchRace(makeTimeTrialConfig(state, 'track', 'title'), this.toasts);
      },
    };
    const continueBtn: ButtonDef = {
      x: layout.menuX + Math.floor((layout.menuW - secondaryGap) * 0.5) + secondaryGap,
      y: btnY,
      w: Math.floor((layout.menuW - secondaryGap) * 0.5),
      h: secondaryH,
      label: hasSave ? '↻  Continue' : 'Continue',
      disabled: !hasSave,
      fontSize: btnFont,
      onClick: () => {
        if (!hasSave) return;
        g.bootstrap();
        g.scenes.replace(new GarageScene());
      },
    };

    drawButton(ctx, timeTrialBtn, ui);
    drawButton(ctx, continueBtn, ui);
    handleButton(timeTrialBtn, ui);
    handleButton(continueBtn, ui);

    btnY += secondaryH + pad(token, 2);

    // ════════════════════════════════════════════
    // TERTIARY ACTIONS — Account / Settings
    // ════════════════════════════════════════════
    const tertiaryGap = pad(token, 1);
    const tertiaryH = Math.max(layout.btnH - pad(token, 1), pad(token, 5));

    const newGameBtn: ButtonDef = {
      x: layout.menuX,
      y: btnY,
      w: Math.floor((layout.menuW - tertiaryGap) * 0.5),
      h: tertiaryH,
      label: 'New Game',
      fontSize: btnFont,
      onClick: () => {
        if (hasSave) {
          this.modal = {
            open: true,
            title: 'Overwrite Save?',
            body: 'Starting a new game will replace\nyour current progress.',
            buttons: [
              {
                x: 0, y: 0, w: 0, h: 0, label: 'Cancel',
                onClick: () => { this.modal.open = false; },
              },
              {
                x: 0, y: 0, w: 0, h: 0, label: 'New Game',
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
    const optionsBtn: ButtonDef = {
      x: layout.menuX + Math.floor((layout.menuW - tertiaryGap) * 0.5) + tertiaryGap,
      y: btnY,
      w: Math.floor((layout.menuW - tertiaryGap) * 0.5),
      h: tertiaryH,
      label: 'Options',
      fontSize: btnFont,
      onClick: () => g.scenes.push(new OptionsScene()),
    };

    drawButton(ctx, newGameBtn, ui);
    drawButton(ctx, optionsBtn, ui);
    handleButton(newGameBtn, ui);
    handleButton(optionsBtn, ui);

    // Draw primary button (already handled above)
    drawButton(ctx, quickRaceBtn, { ...ui, accent: BRAND_SIGNAL });
    handleButton(quickRaceBtn, ui);

    // Draw secondary buttons
    drawButton(ctx, timeTrialBtn, ui);
    drawButton(ctx, continueBtn, ui);
    handleButton(timeTrialBtn, ui);
    handleButton(continueBtn, ui);

    // Draw tertiary buttons
    drawButton(ctx, newGameBtn, ui);
    drawButton(ctx, optionsBtn, ui);
    handleButton(newGameBtn, ui);
    handleButton(optionsBtn, ui);

    if (this.modal.open) layoutModalButtons(this.modal, ui);
    drawModal(ctx, this.modal, ui);
    handleModal(this.modal, ui);

    this.toasts.draw(ctx, ui);
  }
}
