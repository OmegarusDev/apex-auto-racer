import type { Scene } from '../engine/SceneManager';
import { getGameContext } from '../engine/GameContext';
import { PARTS, type PartCategory } from '../data/parts';
import { getDiscipline, type DisciplineId } from '../data/disciplines';
import {
  drawHeader,
  handleHeader,
  drawRadarChart,
  drawSectionTitle,
  drawInfoIcon,
  infoIconRadius,
  layoutShell,
  ContentScroller,
  TooltipManager,
  drawUpgradePanel,
  handleUpgradePanel,
  upgradePanelHeight,
  upgradePanelRowsTop,
  upgradePanelRowHeight,
  pad,
  isPortrait,
  ToastManager,
} from '../ui/components';
import {
  buildUi,
  drawBackground,
  onSceneEnter,
  onSceneResize,
} from './sceneChrome';
import { drawTopDownCar } from './titleArt';
import { disciplineAccent, disciplineLabel } from '../career/disciplinesUi';
import {
  buyPartWithDelta,
  partInfoText,
  repairVehicle,
  vehicleRadarValues,
} from '../career/garage';
import { carSetupFromParts, tuningSpeedReadout } from '../engine/vehicle/CarSetup';
import { effectiveStats } from '../engine/stats';

/** One labeled pace row: caption left, value right, ⓘ at the edge. */
interface PaceRow {
  label: string;
  value: string;
  info: { title: string; body: string };
}

export class TuningScene implements Scene {
  private readonly discipline: DisciplineId;
  private toasts = new ToastManager();
  private tooltips = new TooltipManager();
  private scroller = new ContentScroller();
  private detachWheel: (() => void) | null = null;
  private previewPart: PartCategory | null = null;
  private upgradeCollapsed = false;

  constructor(discipline: DisciplineId) {
    this.discipline = discipline;
  }

  enter(): void {
    onSceneEnter();
    this.previewPart = null;
    this.scroller.scroll.offset = 0;
    this.scroller.onUserScroll = () => this.tooltips.close();
    this.detachWheel = this.scroller.attachWheel(getGameContext().canvas);
  }

  exit(): void {
    this.detachWheel?.();
    this.detachWheel = null;
    this.previewPart = null;
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

  private paceRows(): PaceRow[] {
    const state = getGameContext().state!;
    const vehicle = state.vehicles[this.discipline];
    const setup = carSetupFromParts(vehicle.partTiers, this.discipline);
    const stats = effectiveStats(this.discipline, vehicle.partTiers, vehicle.condition);
    const mu = getDiscipline(this.discipline).muSurface;
    const readout = tuningSpeedReadout(setup, mu, stats.aAccel, stats.D);
    return [
      {
        label: 'Corner peg',
        value: `~${readout.vDeslot.toFixed(1)} m/s`,
        info: {
          title: 'Corner peg',
          body: 'Predicted speed through a typical tight corner at the very edge of grip — the anchor your braking points hang off.',
        },
      },
      {
        label: 'Aero limit',
        value: `~${readout.vMax.toFixed(1)} m/s`,
        info: {
          title: 'Aero limit',
          body: 'Straight-line top speed after paying the drag bill — wings add corner grip but bleed straight-line pace.',
        },
      },
      {
        label: 'Mass',
        value: `${setup.massKg.toFixed(0)} kg`,
        info: {
          title: 'Mass',
          body: 'Powertrain parts add weight; suspension sheds it. Heavier cars carry momentum but stop and turn harder.',
        },
      },
      {
        label: 'Brake bias',
        value: `${(setup.brakeBiasFront * 100).toFixed(0)}% F`,
        info: {
          title: 'Brake bias',
          body: 'Share of braking force at the front. Brake upgrades push it forward — stabler stops, less rear stability under power.',
        },
      },
      {
        label: 'Wing CL / CD',
        value: `×${setup.clScale.toFixed(2)} / ×${setup.cdScale.toFixed(2)}`,
        info: {
          title: 'Wing CL / CD',
          body: 'Spoiler effect on downforce vs drag. Both rise with spoiler tiers: more grip in fast corners, lower aero limit.',
        },
      },
    ];
  }

  render(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const g = getGameContext();
    const state = g.state;
    if (state === null) return;

    const accent = disciplineAccent(this.discipline);
    const { ui, token } = buildUi(w, h, 0, accent);
    const vehicle = state.vehicles[this.discipline];
    const portrait = isPortrait(w, h);
    const shell = layoutShell(w, h, token);

    drawBackground(ctx, w, h, token);

    const header = {
      x: shell.headerRect.x,
      y: shell.headerRect.y,
      w: shell.headerRect.w,
      h: shell.headerRect.h,
      title: `${disciplineLabel(this.discipline)} Tuning`,
      back: true,
      cash: state.cash,
      onBack: () => g.scenes.back(),
    };
    drawHeader(ctx, header, ui);

    const view = shell.contentRect;
    const radarR = portrait
      ? Math.min((view.w - pad(token, 5)) * 0.32, pad(token, 9))
      : pad(token, 7.5);
    // Hotspots are registered in scroller-local space; tooltips draw in screen space.
    const tooltipOrigin = { x: view.x, y: view.y - this.scroller.scroll.offset };

    // Loadout preview box — tall enough that the rotated mesh (which overflows
    // a square footprint by ~10% each way) and its caption both stay inside.
    const previewH = pad(token, 12);
    const paceRows = this.paceRows();
    const paceRowH = token.fontCaption * 1.7;

    const panel = {
      x: 0,
      y: 0,
      w: view.w,
      partTiers: vehicle.partTiers,
      condition: vehicle.condition,
      cash: state.cash,
      collapsed: this.upgradeCollapsed,
      activePart: this.previewPart,
      onBuy: (part: PartCategory) => {
        const result = buyPartWithDelta(state, this.discipline, part);
        if (result.bought) {
          this.toasts.push(result.summary, accent, 3);
          g.autosave();
        }
      },
      onRepair: () => {
        if (repairVehicle(state, this.discipline)) {
          this.toasts.push('Vehicle repaired', accent);
        }
      },
      onToggleCollapse: () => {
        this.tooltips.close();
        this.upgradeCollapsed = !this.upgradeCollapsed;
      },
      infoForPart: (part: PartCategory) => ({ title: part, body: partInfoText(part) }),
      registerInfo: (rect: { x: number; y: number; w: number; h: number }, info: { title: string; body: string }) => {
        this.tooltips.register(rect, info, tooltipOrigin);
      },
    };

    // Content height — mirrors the draw chain below exactly.
    const contentH =
      // Performance radar
      token.fontCaption + pad(token, 0.75) + radarR * 2 + pad(token, 2.5) + pad(token, 1) +
      // Loadout preview
      token.fontCaption + pad(token, 0.75) + previewH + pad(token, 1.5) +
      // Predicted pace
      token.fontCaption + pad(token, 0.75) + paceRows.length * paceRowH + pad(token, 1.5) +
      // Condition + repair + parts (shared panel)
      upgradePanelHeight(panel, token) +
      pad(token, 1);

    this.scroller.layout(view, contentH);
    this.scroller.update(ui, view);
    const lui = this.scroller.localUi(ui, view);
    this.tooltips.beginFrame();

    this.scroller.begin(ctx, view);
    let y = 0;
    y += drawSectionTitle(ctx, 0, y, 'Performance', lui);

    const radarX = portrait
      ? (view.w - radarR * 2) * 0.5
      : pad(token, 2.5) + token.fontCaption;
    const radarY = y + pad(token, 1.25) + token.fontCaption * 0.5;
    drawRadarChart(
      ctx,
      { x: radarX, y: radarY, radius: radarR, viewW: view.w, values: vehicleRadarValues(this.discipline, vehicle) },
      lui,
    );
    {
      const r = infoIconRadius(token);
      const icx = radarX + radarR * 2 + r + pad(token, 0.6);
      const icy = radarY + r + pad(token, 0.25);
      drawInfoIcon(ctx, icx, icy, r, lui, false);
      this.tooltips.register(
        { x: icx - r * 1.6, y: icy - r * 1.6, w: r * 3.2, h: r * 3.2 },
        {
          title: 'Performance',
          body: 'Ratings come from part tiers. Top Speed & Accel set straight-line pace; Braking stops later; Grip holds corners; Downforce pins the car in its slot.',
        },
        tooltipOrigin,
      );
    }
    y += radarR * 2 + pad(token, 2.5) + pad(token, 1);

    // ════════════════════════════════════════════
    // LOADOUT PREVIEW (large, central)
    // ════════════════════════════════════════════
    y += drawSectionTitle(ctx, 0, y, 'Loadout preview', lui);
    const previewCy = y + previewH * 0.55;
    drawTopDownCar(ctx, view.w * 0.5, previewCy, pad(token, 14), previewH, accent, this.discipline, {
      partTiers: vehicle.partTiers,
      condition: vehicle.condition,
      highlightPart: this.previewPart ?? undefined,
    });
    if (this.previewPart !== null) {
      ctx.save();
      ctx.font = `500 ${token.fontCaption}px ${token.fontFamily}`;
      ctx.fillStyle = accent;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(
        `Preview: next ${this.previewPart} tier`,
        view.w * 0.5,
        y + previewH - pad(token, 0.4),
      );
      ctx.restore();
    }
    y += previewH + pad(token, 1.5);

    // ════════════════════════════════════════════
    // PREDICTED PACE (aligned label/value rows)
    // ════════════════════════════════════════════
    y += drawSectionTitle(ctx, 0, y, 'Predicted pace', lui);
    {
      const r = infoIconRadius(token);
      for (const row of paceRows) {
        ctx.save();
        ctx.font = `500 ${token.fontCaption}px ${token.fontFamily}`;
        ctx.fillStyle = token.textMuted;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(row.label, pad(token, 0.5), y + paceRowH * 0.5);
        ctx.fillStyle = token.text;
        ctx.fillText(row.value, view.w - pad(token, 1) - r * 3, y + paceRowH * 0.5);
        ctx.restore();

        const icx = view.w - pad(token, 1) - r;
        const icy = y + paceRowH * 0.5;
        drawInfoIcon(ctx, icx, icy, r, lui, false);
        this.tooltips.register(
          { x: icx - r * 1.8, y: icy - r * 1.8, w: r * 3.6, h: r * 3.6 },
          row.info,
          tooltipOrigin,
        );
        y += paceRowH;
      }
    }
    y += pad(token, 1.5);

    // ════════════════════════════════════════════
    // CONDITION + REPAIR + PARTS (shared UpgradePanel)
    // ════════════════════════════════════════════
    // Hover a part row to preview its effect on the car above.
    const rowsTop = upgradePanelRowsTop({ ...panel, y }, token);
    const rowHp = upgradePanelRowHeight(token);
    let hoveredPart: PartCategory | null = null;
    if (!panel.collapsed && lui.pointerY >= rowsTop && lui.pointerX >= 0 && lui.pointerX <= view.w) {
      const idx = Math.floor((lui.pointerY - rowsTop) / rowHp);
      const part = PARTS[idx];
      if (part !== undefined) hoveredPart = part.id;
    }
    this.previewPart = hoveredPart;

    drawUpgradePanel(ctx, panel, ui);
    handleUpgradePanel(panel, ui);
    y += upgradePanelHeight(panel, token);

    this.scroller.end(ctx);

    this.tooltips.handle(lui, !this.scroller.isScrolling);
    this.tooltips.draw(ctx, ui);

    handleHeader(header, ui);
    this.toasts.draw(ctx, ui);
  }
}
