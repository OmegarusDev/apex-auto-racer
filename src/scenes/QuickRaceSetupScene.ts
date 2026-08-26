import type { Scene } from '../engine/SceneManager';
import { getGameContext } from '../engine/GameContext';
import type { DisciplineId } from '../data/disciplines';
import {
  drawButton,
  handleButton,
  drawHeader,
  handleHeader,
  drawRow,
  drawSectionTitle,
  drawInfoIcon,
  infoIconRadius,
  layoutShell,
  ContentScroller,
  TooltipManager,
  ctaHeight,
  pad,
  ensureMinTouch,
  hitRect,
  wrapText,
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
import { ensureQuickRaceState } from '../career/quickPlayState';

export class QuickRaceSetupScene implements Scene {
  private toasts = new ToastManager();
  private tooltips = new TooltipManager();
  private scroller = new ContentScroller();
  private detachWheel: (() => void) | null = null;
  private discipline: DisciplineId;
  private presetId: QuickRacePresetId = 'rookie';
  private returnTo: 'title' | 'campaign';

  constructor(opts?: {
    discipline?: DisciplineId;
    returnTo?: 'title' | 'campaign';
  }) {
    this.discipline = opts?.discipline ?? 'track';
    this.returnTo = opts?.returnTo ?? 'title';
    this.presetId = 'rookie';
  }

  enter(): void {
    onSceneEnter();
    this.scroller.scroll.offset = 0;
    this.scroller.onUserScroll = () => this.tooltips.close();
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

    const shell = layoutShell(w, h, token, { footer: false });
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
    const discH = ensureMinTouch(pad(token, 5.5), token);
    const rowH = ensureMinTouch(
      pad(token, 1.5) + token.fontBody + pad(token, 0.5) + token.fontCaption + pad(token, 0.5) + token.fontCaption + pad(token, 1.5),
      token,
    );
    // Coaching blurbs wrap to two lines instead of ellipsizing control advice.
    setBlurbFont(ctx, token);
    const blurbLines = wrapText(ctx, disciplineQrBlurb(this.discipline), view.w - pad(token), 2).length;

    // Content height — mirrors the draw chain below exactly.
    const heroCtaH = ctaHeight(token);
    const contentH =
      heroCtaH + pad(token, 1.5) +
      token.fontCaption + pad(token, 0.75) + discH + pad(token, 0.75) +
      blurbLines * token.fontCaption + pad(token, 1.5) +
      token.fontCaption + pad(token, 0.75) +
      presets.length * rowH;

    this.scroller.layout(view, contentH);
    this.scroller.update(ui, view);
    const lui = this.scroller.localUi(ui, view);
    const tooltipOrigin = { x: view.x, y: view.y - this.scroller.scroll.offset };
    this.tooltips.beginFrame();

    this.scroller.begin(ctx, view);
    let y = 0;

    // ════════════════════════════════════════════
    // PRIMARY CTA - START RACE (top, prominent)
    // ════════════════════════════════════════════
    const ctaBtn: ButtonDef = {
      x: pad(token, 1.5),
      y,
      w: view.w - pad(token, 3),
      h: heroCtaH,
      label: 'Start Race',
      cta: true,
      fontSize: token.fontDisplay,
      onClick: () => this.startRace(),
    };
    drawButton(ctx, ctaBtn, { ...lui, accent });
    handleButton(ctaBtn, lui);
    y += heroCtaH + pad(token, 1.5);

    // ════════════════════════════════════════════
    // DISCIPLINE SELECTOR (compact row)
    // ════════════════════════════════════════════
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
        onClick: () => { this.tooltips.close(); this.discipline = id; },
      };
      drawButton(ctx, btn, { ...lui, accent: disciplineAccent(id) });
      handleButton(btn, lui);
    }
    y += discH + pad(token, 0.75);

    // Discipline blurb — wraps to two lines so tips survive narrow phones.
    ctx.save();
    setBlurbFont(ctx, token);
    ctx.fillStyle = token.textMuted;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    for (const line of wrapText(ctx, disciplineQrBlurb(this.discipline), view.w - pad(token), 2)) {
      ctx.fillText(line, pad(token, 0.5), y);
      y += token.fontCaption;
    }
    ctx.restore();
    y += pad(token, 1.5);

    // ════════════════════════════════════════════
    // PRESET SELECTOR (Car & Driver)
    // ════════════════════════════════════════════
    y += drawSectionTitle(ctx, 0, y, 'Car & Driver', lui);

    for (const preset of presets) {
      const selected = preset.id === this.presetId;
      const hovered = hitRect(lui.pointerX, lui.pointerY, 0, y, view.w, rowH);
      drawRow(ctx, { x: 0, y, w: view.w, h: rowH }, lui, { hovered: hovered || selected });

      // Selection rail sits left of the text column — real clearance, no graze.
      const railX = pad(token, 0.75);
      const padX = pad(token, 2.25);
      const labelY = y + pad(token, 1.5);
      const blurbY = labelY + token.fontBody + pad(token, 0.5);
      const statsY = blurbY + token.fontCaption + pad(token, 0.5);
      const textMax = view.w - padX - pad(token, 5.5);

      ctx.save();
      ctx.font = `700 ${token.fontBody}px ${token.fontDisplayFamily}`;
      ctx.fillStyle = selected ? accent : token.text;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(truncateText(ctx, preset.label, textMax), padX, labelY);
      ctx.font = `${token.fontCaption}px ${token.fontFamily}`;
      ctx.fillStyle = token.textMuted;
      ctx.fillText(truncateText(ctx, preset.blurb, textMax), padX, blurbY);
      const stats = presetStatSummary(preset);
      if (stats) {
        ctx.fillStyle = token.textMuted;
        ctx.fillText(truncateText(ctx, stats, textMax), padX, statsY);
      }
      if (selected) {
        ctx.fillStyle = accent;
        ctx.fillRect(railX, y + pad(token, 0.75), 4, rowH - pad(token, 1.5));
      }
      ctx.restore();

      // ⓘ — what the driver stat shorthand actually does in a race.
      if (stats) {
        const r = infoIconRadius(token);
        const icx = view.w - pad(token, 2.5);
        const icy = statsY + token.fontCaption * 0.45;
        drawInfoIcon(ctx, icx, icy, r, lui, false);
        this.tooltips.register(
          { x: icx - r * 1.8, y: icy - r * 1.8, w: r * 3.6, h: r * 3.6 },
          {
            title: 'Driver Ratings',
            body: 'Sk Skill drives precisely and saves slides · Br Bravery carries speed through corners · Fo Focus avoids mistakes (rain matters) · Det Determination pushes harder when running behind.',
          },
          tooltipOrigin,
        );
      }

      if (lui.pointerClicked && hovered) {
        this.presetId = preset.id;
      }
      y += rowH;
    }

    this.scroller.end(ctx);

    this.tooltips.handle(lui, !this.scroller.isScrolling);
    this.tooltips.draw(ctx, ui);

    handleHeader(header, ui);
    this.toasts.draw(ctx, ui);
  }
}

function setBlurbFont(ctx: CanvasRenderingContext2D, token: ReturnType<typeof buildUi>['token']): void {
  ctx.font = `500 ${token.fontCaption}px ${token.fontFamily}`;
}
