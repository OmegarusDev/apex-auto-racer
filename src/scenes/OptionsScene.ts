import type { Scene } from '../engine/SceneManager';
import { getGameContext } from '../engine/GameContext';
import { DEFAULT_RACE_ZOOM, DEFAULT_SPEED_UNIT, type VolumeOptions } from '../engine/types';
import type { SpeedUnit } from '../engine/units';
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
import { activeDriver } from '../engine/SaveManager';
import { getDiscipline } from '../data/disciplines';

export class OptionsScene implements Scene {
  private toasts = new ToastManager();
  private modal: ModalDef = { open: false, title: '', body: '', buttons: [] };
  private scroller = new ContentScroller();
  private detachWheel: (() => void) | null = null;
  /** Live fallback so sliders work before any save exists. */
  private localVols: VolumeOptions | null = null;
  private localZoom: number | null = null;
  private localSpeedUnit: SpeedUnit | null = null;

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

  private speedUnit(): SpeedUnit {
    const g = getGameContext();
    if (g.state !== null) {
      const u = g.state.options.speedUnit;
      return u === 'mph' ? 'mph' : DEFAULT_SPEED_UNIT;
    }
    return this.localSpeedUnit ?? DEFAULT_SPEED_UNIT;
  }

  private setSpeedUnit(unit: SpeedUnit): void {
    const g = getGameContext();
    if (g.state !== null) {
      g.state.options.speedUnit = unit;
      g.autosave();
    } else {
      this.localSpeedUnit = unit;
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

  private openDeleteConfirm(): void {
    const g = getGameContext();
    const driver = g.state !== null ? activeDriver(g.state) : null;
    const slot = g.save.currentSlot();
    const name = driver?.name ?? slot?.name ?? 'this career';
    const disc = driver !== null ? getDiscipline(driver.discipline).name : slot !== null ? getDiscipline(slot.discipline).name : '';
    const who = disc !== '' ? `${name}'s ${disc} career` : name;
    this.modal = {
      open: true,
      title: 'Delete save data?',
      body: `${who} will be gone.\nOther careers are kept.`,
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
          onClick: () => this.openDeleteConfirm2(),
        },
      ],
    };
  }

  private openDeleteConfirm2(): void {
    this.modal = {
      open: true,
      title: 'Are you sure?',
      body: 'This cannot be undone.',
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
          label: 'Delete',
          danger: true,
          onClick: () => {
            const g = getGameContext();
            const id = g.save.currentSlot()?.id;
            this.modal.open = false;
            if (id !== undefined) g.deleteCareer(id);
            void import('./TitleScene').then(({ TitleScene }) => {
              g.scenes.replaceRoot(new TitleScene());
            });
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
      rowH +
      sectionGap +
      token.fontCaption + pad(token, 0.75) + pad(token, 1) +
      btnH;
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
      x: 0,
      y,
      w: view.w,
      h: btnH,
      label: 'How to Play',
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

    y += sectionGap;
    y += drawSectionTitle(ctx, 0, y, 'Units', lui);
    y += pad(token, 1);
    const unit = this.speedUnit();
    const gap = pad(token, 1);
    const unitW = (view.w - gap) / 2;
    const kmhBtn: ButtonDef = {
      x: 0,
      y,
      w: unitW,
      h: btnH,
      label: 'KM/H',
      primary: unit === 'kmh',
      onClick: () => this.setSpeedUnit('kmh'),
    };
    const mphBtn: ButtonDef = {
      x: unitW + gap,
      y,
      w: unitW,
      h: btnH,
      label: 'MPH',
      primary: unit === 'mph',
      onClick: () => this.setSpeedUnit('mph'),
    };
    drawButton(ctx, kmhBtn, lui);
    drawButton(ctx, mphBtn, lui);
    if (!this.modal.open) {
      handleButton(kmhBtn, lui);
      handleButton(mphBtn, lui);
    }
    y += btnH;

    if (hasSave) {
      y += sectionGap;
      y += drawSectionTitle(ctx, 0, y, 'Save data', lui);
      y += pad(token, 1);
      const newBtn: ButtonDef = {
        x: 0,
        y,
        w: view.w,
        h: resetH,
        label: 'Delete save data',
        danger: true,
        onClick: () => this.openDeleteConfirm(),
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
