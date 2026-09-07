import type { Scene } from '../engine/SceneManager';
import { getGameContext } from '../engine/GameContext';
import { activeDriver } from '../engine/SaveManager';
import {
  drawButton,
  handleButton,
  drawHeader,
  handleHeader,
  drawStatBar,
  drawRadarChart,
  drawInfoIcon,
  infoIconRadius,
  layoutShell,
  ContentScroller,
  TooltipManager,
  ctaHeight,
  pad,
  ensureMinTouch,
  statBarHeight,
  isPortrait,
  truncateText,
  type ButtonDef,
  type UiContext,
} from '../ui/components';
import {
  buildUi,
  drawBackground,
  onSceneEnter,
  onSceneResize,
} from './sceneChrome';
import { drawTopDownCar } from './titleArt';
import {
  disciplineAccent,
  disciplineLabel,
} from '../career/disciplinesUi';
import { vehicleRadarValues } from '../career/garage';
import { TuningScene } from './TuningScene';
import { OptionsScene } from './OptionsScene';

export class GarageScene implements Scene {
  private scroller = new ContentScroller();
  private tooltips = new TooltipManager();
  private detachWheel: (() => void) | null = null;

  enter(): void {
    onSceneEnter();
    this.scroller.scroll.offset = 0;
    this.scroller.onUserScroll = () => this.tooltips.close();
    this.detachWheel = this.scroller.attachWheel(getGameContext().canvas);
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

  update(_dt: number): void {}

  render(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const g = getGameContext();
    const state = g.state;
    if (state === null) return;

    // Career is discipline-locked: the garage always reflects the active driver.
    const discipline = activeDriver(state)?.discipline ?? 'track';
    const accent = disciplineAccent(discipline);
    const { ui, token } = buildUi(w, h, 0, accent);

    const vehicle = state.vehicles[discipline];
    const shell = layoutShell(w, h, token);
    const portrait = isPortrait(w, h);

    drawBackground(ctx, w, h, token);

    const header = {
      x: shell.headerRect.x,
      y: shell.headerRect.y,
      w: shell.headerRect.w,
      h: shell.headerRect.h,
      title: 'Garage',
      back: true,
      cash: state.cash,
      settings: true,
      onBack: () => this.handleBack(),
      onSettings: () => g.scenes.push(new OptionsScene()),
    };
    drawHeader(ctx, header, ui);

    const view = shell.contentRect;
    const navSize = ensureMinTouch(pad(token, 5), token);
    const carW = Math.min(view.w * (portrait ? 0.48 : 0.38), pad(token, 17));
    const carH = carW * 1.1;
    const radarR = portrait
      ? Math.min(view.w * 0.2, pad(token, 7))
      : Math.min(view.w * 0.16, pad(token, 7.5));
    const radarInset = pad(token, 2.5) + token.fontCaption;
    const tuneH = ctaHeight(token);

    let contentH = pad(token, 0.25) + navSize + pad(token, 1);
    if (portrait) {
      contentH += carH + pad(token, 0.75) + radarR * 2 + pad(token, 2.5) + pad(token, 1);
    } else {
      contentH += Math.max(carH, radarR * 2 + pad(token, 2.5)) + pad(token, 1);
    }
    contentH += tuneH + pad(token, 1.5) + statBarHeight(token) + pad(token, 1);

    this.scroller.layout(view, contentH);
    this.scroller.update(ui, view);
    const lui = this.scroller.localUi(ui, view);
    // Hotspots are registered in scroller-local space; tooltips draw in screen space.
    const tooltipOrigin = { x: view.x, y: view.y - this.scroller.scroll.offset };
    this.tooltips.beginFrame();

    this.scroller.begin(ctx, view);
    let y = pad(token, 0.25);

    // Discipline chip — the career is discipline-locked, so just show which one.
    ctx.save();
    ctx.font = `700 ${token.fontTitle}px ${token.fontDisplayFamily}`;
    ctx.fillStyle = accent;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const discLabel = disciplineLabel(discipline).toUpperCase();
    const titleMax = view.w - pad(token, 2);
    ctx.fillText(truncateText(ctx, discLabel, titleMax), view.w * 0.5, y + navSize * 0.5);
    ctx.restore();
    y += navSize + pad(token, 1);

    if (portrait) {
      const carCx = view.w * 0.5;
      const carCy = y + carH * 0.5;
      ctx.save();
      const glow = ctx.createRadialGradient(carCx, carCy, 0, carCx, carCy, carW * 0.85);
      glow.addColorStop(0, `${accent}28`);
      glow.addColorStop(0.55, `${accent}0a`);
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(carCx - carW, carCy - carH * 0.7, carW * 2, carH * 1.4);
      ctx.restore();
      drawTopDownCar(ctx, carCx, carCy, carW, carH, accent, discipline, {
        partTiers: vehicle.partTiers,
        condition: vehicle.condition,
      });
      y += carH + pad(token, 0.75);
      const chartX = (view.w - radarR * 2) * 0.5;
      const chartY = y + pad(token, 1.25);
      drawRadarChart(
        ctx,
        {
          x: chartX,
          y: chartY,
          radius: radarR,
          viewW: view.w,
          values: vehicleRadarValues(discipline, vehicle),
        },
        lui,
      );
      this.drawRadarInfo(ctx, chartX + radarR * 2, chartY, lui, tooltipOrigin);
      y += radarR * 2 + pad(token, 2.5) + pad(token, 1);
    } else {
      const blockH = Math.max(carH, radarR * 2 + pad(token, 2.5));
      const carCx = view.w * 0.58;
      const carCy = y + blockH * 0.5;
      ctx.save();
      const glow = ctx.createRadialGradient(carCx, carCy, 0, carCx, carCy, carW * 0.85);
      glow.addColorStop(0, `${accent}28`);
      glow.addColorStop(0.55, `${accent}0a`);
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(carCx - carW, carCy - carH * 0.7, carW * 2, carH * 1.4);
      ctx.restore();
      drawTopDownCar(ctx, carCx, carCy, carW, carH, accent, discipline, {
        partTiers: vehicle.partTiers,
        condition: vehicle.condition,
      });
      drawRadarChart(
        ctx,
        {
          x: radarInset,
          y: y + (blockH - radarR * 2) * 0.5,
          radius: radarR,
          viewW: view.w,
          values: vehicleRadarValues(discipline, vehicle),
        },
        lui,
      );
      this.drawRadarInfo(ctx, radarInset + radarR * 2, y + (blockH - radarR * 2) * 0.5, lui, tooltipOrigin);
      y += blockH + pad(token, 1);
    }

    const tuneBtn: ButtonDef = {
      x: pad(token, 1.5),
      y,
      w: view.w - pad(token, 3),
      h: tuneH,
      label: 'Tuning',
      cta: true,
      fontSize: token.fontDisplay,
      onClick: () => g.scenes.push(new TuningScene(discipline)),
    };
    drawButton(ctx, tuneBtn, { ...lui, accent });
    if (!this.scroller.isScrolling) handleButton(tuneBtn, lui);
    y += tuneH + pad(token, 1.5);

    // Condition bar
    const conditionBar = {
      x: 0,
      y,
      w: view.w,
      label: 'Condition',
      value: vehicle.condition * 100,
      suffix: '%',
      color: vehicle.condition < 0.75 ? token.danger : accent,
      info: {
        title: 'Condition',
        body: 'Wear from bumps and crashes. Low condition cuts grip and top speed and adds line wander — repair in Tuning or after a race.',
      },
    } as const;
    drawStatBar(ctx, conditionBar, lui);
    this.tooltips.registerStatBar(ctx, conditionBar, token, tooltipOrigin);
    y += statBarHeight(token) + pad(token, 1);
    this.scroller.end(ctx);

    this.tooltips.handle(lui, !this.scroller.isScrolling);
    this.tooltips.draw(ctx, ui);

    handleHeader(header, ui);
  }

  /** Painted ⓘ beside the radar explaining what its five axes mean. */
  private drawRadarInfo(
    ctx: CanvasRenderingContext2D,
    chartRightX: number,
    chartY: number,
    ui: UiContext,
    origin: { x: number; y: number },
  ): void {
    const { token } = ui;
    const r = infoIconRadius(token);
    const cx = chartRightX + r + pad(token, 0.5);
    const cy = chartY + r + pad(token, 0.25);
    drawInfoIcon(ctx, cx, cy, r, ui, false);
    this.tooltips.register(
      { x: cx - r * 1.6, y: cy - r * 1.6, w: r * 3.2, h: r * 3.2 },
      {
        title: 'Performance',
        body: 'Ratings come from your part tiers. Top Speed & Accel set straight-line pace; Braking stops later; Grip holds corners; Downforce pins the car in its slot.',
      },
      origin,
    );
  }
}
