import type { Scene } from '../engine/SceneManager';
import { getGameContext } from '../engine/GameContext';
import { createNewGame } from '../engine/SaveManager';
import { mulberry32 } from '../engine/rng';
import type { GameState } from '../engine/types';
import type { DisciplineId } from '../data/disciplines';
import {
  drawButton,
  handleButton,
  drawHeader,
  handleHeader,
  drawRow,
  drawSectionTitle,
  drawFooterActions,
  handleFooterActions,
  layoutShell,
  ContentScroller,
  pad,
  ensureMinTouch,
  hitRect,
  ToastManager,
  truncateText,
  type ButtonDef,
} from '../ui/components';
import {
  DISCIPLINE_ORDER,
  disciplineAccent,
  disciplineLabel,
} from '../career/disciplinesUi';
import { launchRace, makeQuickRaceConfig } from '../career/launchRace';
import {
  listQuickRacePresets,
  presetStatSummary,
  type QuickRacePresetId,
} from '../career/quickRacePresets';
import { buildUi, drawBackground, onSceneEnter, onSceneResize } from './sceneChrome';
import { disciplineQrBlurb } from '../graphics/materials';

function ensureQuickRaceState(): GameState {
  const g = getGameContext();
  if (g.state !== null) return g.state;
  const loaded = g.bootstrap();
  if (loaded !== null) return loaded;
  const seed = Date.now() >>> 0;
  const state = createNewGame(mulberry32(seed), seed);
  g.state = state;
  g.audio.setVolumes(state.options.volumes);
  return state;
}

export class QuickRaceSetupScene implements Scene {
  private toasts = new ToastManager();
  private scroller = new ContentScroller();
  private detachWheel: (() => void) | null = null;
  private discipline: DisciplineId;
  private presetId: QuickRacePresetId = 'rookie';
  private returnTo: 'title' | 'campaign';

  constructor(opts?: {
    discipline?: DisciplineId;
    returnTo?: 'title' | 'campaign';
    presetId?: QuickRacePresetId;
  }) {
    this.discipline = opts?.discipline ?? 'track';
    this.returnTo = opts?.returnTo ?? 'title';
    this.presetId = opts?.presetId ?? 'rookie';
  }

  enter(): void {
    onSceneEnter();
    this.scroller.scroll.offset = 0;
    this.detachWheel = this.scroller.attachWheel(getGameContext().canvas);
    const g = getGameContext();
    if (g.save.hasSave() && this.presetId === 'rookie') {
      this.presetId = 'garage';
    }
  }

  exit(): void {
    this.detachWheel?.();
    this.detachWheel = null;
  }

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

  private startRace(): void {
    const state = ensureQuickRaceState();
    if (this.presetId === 'garage' && state.roster.length < 1) {
      this.toasts.push('Need a driver on the roster', disciplineAccent(this.discipline));
      return;
    }
    const config = makeQuickRaceConfig(
      state,
      this.discipline,
      this.returnTo,
      this.presetId,
    );
    launchRace(config, this.toasts);
  }

  render(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const accent = disciplineAccent(this.discipline);
    const { ui, token } = buildUi(w, h, 0, accent);
    drawBackground(ctx, w, h, token, accent);

    const shell = layoutShell(w, h, token, { footer: true });
    const header = {
      x: shell.headerRect.x,
      y: shell.headerRect.y,
      w: shell.headerRect.w,
      h: shell.headerRect.h,
      title: 'Quick Race',
      back: true,
      onBack: () => this.handleBack(),
    };
    drawHeader(ctx, header, ui);

    const view = shell.contentRect;
    const presets = listQuickRacePresets();
    const discH = ensureMinTouch(pad(token, 4.5), token);
    const rowH = ensureMinTouch(pad(token, 7.5), token);
    const contentH =
      pad(token, 0.5) +
      token.fontCaption +
      pad(token, 0.75) +
      discH +
      pad(token, 0.75) +
      token.fontCaption +
      pad(token, 1.5) +
      token.fontCaption +
      pad(token, 0.75) +
      presets.length * rowH +
      pad(token, 1);

    this.scroller.layout(view, contentH);
    this.scroller.update(ui, view);
    const lui = this.scroller.localUi(ui, view);

    this.scroller.begin(ctx, view);
    let y = 0;
    y += drawSectionTitle(ctx, 0, y, 'Discipline', lui);

    const gap = pad(token, 1);
    const discW = (view.w - gap * 2) / 3;
    for (let i = 0; i < DISCIPLINE_ORDER.length; i++) {
      const id = DISCIPLINE_ORDER[i]!;
      const x = i * (discW + gap);
      const selected = id === this.discipline;
      const btn: ButtonDef = {
        x,
        y,
        w: discW,
        h: discH,
        label: disciplineLabel(id),
        primary: selected,
        onClick: () => {
          this.discipline = id;
        },
      };
      drawButton(ctx, btn, { ...lui, accent: disciplineAccent(id) });
      handleButton(btn, lui);
    }
    y += discH + pad(token, 0.75);

    ctx.save();
    ctx.font = `500 ${token.fontCaption}px ${token.fontFamily}`;
    ctx.fillStyle = token.textMuted;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(
      truncateText(ctx, disciplineQrBlurb(this.discipline), view.w - pad(token)),
      pad(token, 0.5),
      y,
    );
    ctx.restore();
    y += token.fontCaption + pad(token, 1.5);

    y += drawSectionTitle(ctx, 0, y, 'Car & driver', lui);

    for (const preset of presets) {
      const selected = preset.id === this.presetId;
      const hovered = hitRect(lui.pointerX, lui.pointerY, 0, y, view.w, rowH);
      drawRow(ctx, { x: 0, y, w: view.w, h: rowH }, lui, { hovered: hovered || selected });

      ctx.save();
      ctx.font = `700 ${token.fontBody}px ${token.fontDisplayFamily}`;
      ctx.fillStyle = selected ? accent : token.text;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      const textMax = view.w - pad(token, 2);
      ctx.fillText(truncateText(ctx, preset.label, textMax), pad(token, 1), y + pad(token, 1));
      ctx.font = `${token.fontCaption}px ${token.fontFamily}`;
      ctx.fillStyle = token.textMuted;
      ctx.fillText(
        truncateText(ctx, preset.blurb, textMax),
        pad(token, 1),
        y + pad(token, 1) + token.fontBody + 2,
      );
      const stats = presetStatSummary(preset);
      if (stats) {
        ctx.fillStyle = token.textDim;
        ctx.fillText(
          truncateText(ctx, stats, textMax),
          pad(token, 1),
          y + rowH - pad(token, 1) - token.fontCaption,
        );
      }
      if (selected) {
        ctx.fillStyle = accent;
        ctx.fillRect(0, y + pad(token, 0.5), Math.max(3, pad(token, 0.35)), rowH - pad(token));
      }
      ctx.restore();

      if (lui.pointerClicked && hovered) {
        this.presetId = preset.id;
      }
      y += rowH;
    }
    this.scroller.end(ctx);

    if (shell.footerRect !== null) {
      const footerBtns: ButtonDef[] = [
        {
          x: 0,
          y: 0,
          w: 0,
          h: 0,
          label: 'Start Race',
          cta: true,
          onClick: () => this.startRace(),
        },
      ];
      drawFooterActions(ctx, shell.footerRect, footerBtns, ui);
      handleFooterActions(footerBtns, ui);
    }

    handleHeader(header, ui);
    this.toasts.draw(ctx, ui);
  }
}
