import type { Scene } from '../engine/SceneManager';
import { getGameContext } from '../engine/GameContext';
import { mulberry32, pick } from '../engine/rng';
import { activeDriver, createDriver } from '../engine/SaveManager';
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
import { DRIVER_COLORS } from '../ui/brand';
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
  titleMenuStackHeight,
  type TitlePreviewTrack,
} from './titleArt';
import { DISCIPLINE_ORDER } from '../career/disciplinesUi';
import { ensureQuickRaceState } from '../career/quickPlayState';
import { OptionsScene } from './OptionsScene';
import { makeTimeTrialConfig, launchRace } from '../career/launchRace';
import { DisciplineSelectScene } from './DisciplineSelectScene';
import { CareerHubScene } from './CareerHubScene';

const HOW_TO =
  'Steer: ← →  /  A D\nBrake: ↓ Space  /  S\nThrottle: ↑  /  W\n' +
  'Shift up: E  ·  Shift down: Q\nDrift (Street): hold Shift\n\n' +
  'Win series to climb the ranks. Build your car, hire your team,\nand chase the championship in your chosen discipline.';

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
    return false;
  }

  private launchQuickRace(): void {
    const state = ensureQuickRaceState();
    if (state.roster.length < 1) {
      const rng = mulberry32((Date.now() >>> 0) ^ 0x1234);
      const used = new Set(state.roster.map((d) => d.name));
      const discipline = activeDriver(state)?.discipline ?? 'track';
      const driver = createDriver(rng, used, discipline, DRIVER_COLORS[0]!);
      state.roster.push(driver);
      getGameContext().state = state;
    }
    const discipline = activeDriver(state)?.discipline ?? 'track';
    launchRace(makeTimeTrialConfig(state, discipline, 'title'), this.toasts);
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

    const btnFont = layout.btnFont;
    const btnH = Math.max(layout.btnH, pad(token, 5));
    const gap = pad(token, 1);
    let y = layout.menuY;

    const buttons: Omit<ButtonDef, 'x' | 'y' | 'w' | 'h'>[] = [];
    if (active !== null) {
      buttons.push({
        label: 'Continue',
        primary: true,
        onClick: () => g.scenes.replace(new CareerHubScene()),
      });
    }
    buttons.push({
      label: 'New Career',
      primary: active === null,
      onClick: () => {
        if (!g.save.hasSave() || g.state === null) {
          g.startNewGame();
        }
        g.scenes.push(new DisciplineSelectScene());
      },
    });
    buttons.push({
      label: 'Quick Race',
      onClick: () => this.launchQuickRace(),
    });
    buttons.push({
      label: 'Options',
      onClick: () => g.scenes.push(new OptionsScene()),
    });
    buttons.push({
      label: 'How to Play',
      onClick: () => {
        this.modal = {
          open: true,
          title: 'How to Play',
          body: HOW_TO,
          buttons: [
            { x: 0, y: 0, w: 0, h: 0, label: 'Got it', primary: true, onClick: () => { this.modal.open = false; } },
          ],
        };
      },
    });

    for (const def of buttons) {
      const btn: ButtonDef = {
        x: layout.menuX,
        y,
        w: layout.menuW,
        h: btnH,
        label: def.label,
        primary: def.primary,
        fontSize: def.primary ? Math.max(btnFont, token.fontBody) : btnFont,
        onClick: def.onClick,
      };
      drawButton(ctx, btn, ui);
      handleButton(btn, ui);
      y += btnH + gap;
    }

    if (this.modal.open) layoutModalButtons(this.modal, ui);
    drawModal(ctx, this.modal, ui);
    handleModal(this.modal, ui);

    this.toasts.draw(ctx, ui, {
      avoidBottomPx: titleMenuStackHeight(token, btnH) + pad(token, 2),
    });
  }
}
