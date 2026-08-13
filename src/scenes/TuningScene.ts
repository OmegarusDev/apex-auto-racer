import type { Scene } from '../engine/SceneManager';
import { getGameContext } from '../engine/GameContext';
import { BALANCE } from '../data/balance';
import { PARTS, partCost } from '../data/parts';
import type { PartCategory } from '../data/parts';
import type { DisciplineId } from '../data/disciplines';
import {
  drawButton,
  handleButton,
  drawHeader,
  handleHeader,
  drawStatBar,
  drawRadarChart,
  drawSectionTitle,
  drawRow,
  layoutShell,
  ContentScroller,
  pad,
  ensureMinTouch,
  statBarHeight,
  isPortrait,
  ToastManager,
  truncateText,
  type ButtonDef,
} from '../ui/components';
import {
  buildUi,
  drawBackground,
  onSceneEnter,
  onSceneResize,
} from './sceneChrome';
import { drawTopDownCar } from './titleArt';
import { disciplineAccent, disciplineLabel } from '../career/disciplinesUi';
import { buyPartTier, repairVehicle, vehicleRadarValues } from '../career/garage';
import { carSetupFromParts, tuningSpeedReadout } from '../engine/vehicle/CarSetup';
import { effectiveStats } from '../engine/stats';
import { getDiscipline } from '../data/disciplines';

export class TuningScene implements Scene {
  private readonly discipline: DisciplineId;
  private toasts = new ToastManager();
  private scroller = new ContentScroller();
  private detachWheel: (() => void) | null = null;
  private previewPart: PartCategory | null = null;

  constructor(discipline: DisciplineId) {
    this.discipline = discipline;
  }

  enter(): void {
    onSceneEnter();
    this.scroller.scroll.offset = 0;
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

  update(dt: number): void {
    this.toasts.update(dt);
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
    const btnH = ensureMinTouch(pad(token, 4.5), token);
    const rowH = Math.max(btnH + pad(token, 0.5), pad(token, 5.5));
    const radarR = portrait
      ? Math.min((view.w - pad(token, 5)) * 0.32, pad(token, 9))
      : pad(token, 7.5);

    const contentH =
      token.fontCaption +
      pad(token, 0.75) +
      radarR * 2 +
      pad(token, 3.5) +
      pad(token, 10) +
      pad(token, 1) +
      token.fontCaption +
      pad(token, 0.75) +
      token.fontCaption * 2 +
      pad(token, 1.5) +
      token.fontCaption +
      pad(token, 0.75) +
      statBarHeight(token) +
      pad(token, 0.75) +
      btnH +
      pad(token, 1.5) +
      token.fontCaption +
      pad(token, 0.75) +
      PARTS.length * rowH +
      pad(token, 2);

    this.scroller.layout(view, contentH);
    this.scroller.update(ui, view);
    const lui = this.scroller.localUi(ui, view);

    this.scroller.begin(ctx, view);
    let y = 0;
    y += drawSectionTitle(ctx, 0, y, 'Performance', lui);
    const radarX = portrait
      ? (view.w - radarR * 2) * 0.5
      : pad(token, 2.5) + token.fontCaption;
    // Clearance so the radar's top label clears the section title above it.
    const radarY = y + pad(token, 1.25) + token.fontCaption * 0.5;
    drawRadarChart(
      ctx,
      { x: radarX, y: radarY, radius: radarR, viewW: view.w, values: vehicleRadarValues(this.discipline, vehicle) },
      lui,
    );
    y += radarR * 2 + pad(token, 2.5) + pad(token, 1);

    y += drawSectionTitle(ctx, 0, y, 'Loadout preview', lui);
    const previewH = pad(token, 9);
    const previewCx = view.w * 0.5;
    const previewCy = y + previewH * 0.5;
    drawTopDownCar(ctx, previewCx, previewCy, pad(token, 14), previewH, accent, this.discipline, {
      partTiers: vehicle.partTiers,
      condition: vehicle.condition,
      highlightPart: this.previewPart ?? undefined,
    });
    if (this.previewPart) {
      ctx.save();
      ctx.font = `500 ${token.fontCaption}px ${token.fontFamily}`;
      ctx.fillStyle = accent;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(`Preview: next ${this.previewPart} tier`, previewCx, y + previewH - token.fontCaption);
      ctx.restore();
    }
    y += previewH + pad(token, 1);

    const setup = carSetupFromParts(vehicle.partTiers);
    const stats = effectiveStats(this.discipline, vehicle.partTiers, vehicle.condition);
    const mu = getDiscipline(this.discipline).muSurface;
    const readout = tuningSpeedReadout(setup, mu, stats.aAccel, stats.D, 0.08);
    y += drawSectionTitle(ctx, 0, y, 'Predicted pace', lui);
    ctx.save();
    ctx.font = `500 ${token.fontCaption}px ${token.fontFamily}`;
    ctx.fillStyle = token.textMuted;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(
      `Corner peg ~${readout.vDeslot.toFixed(1)} m/s · Aero limit ~${readout.vMax.toFixed(1)} m/s`,
      pad(token, 0.5),
      y,
    );
    ctx.fillStyle = token.textDim;
    ctx.fillText(
      `Mass ${setup.massKg.toFixed(0)} kg · Bias ${(setup.brakeBiasFront * 100).toFixed(0)}%F · CL×${setup.clScale.toFixed(2)} / CD×${setup.cdScale.toFixed(2)}`,
      pad(token, 0.5),
      y + token.fontCaption + 4,
    );
    ctx.restore();
    y += token.fontCaption * 2 + pad(token, 1.5);

    y += drawSectionTitle(ctx, 0, y, 'Condition', lui);
    drawStatBar(
      ctx,
      {
        x: 0,
        y,
        w: view.w,
        label: 'Condition',
        value: vehicle.condition * 100,
        color: vehicle.condition < BALANCE.conditionMin + 0.05 ? token.danger : accent,
      },
      lui,
    );
    y += statBarHeight(token) + pad(token, 0.75);

    const repairPts = Math.max(0, Math.ceil((BALANCE.conditionMax - vehicle.condition) * 100));
    const repairCost = repairPts * BALANCE.repairCostPerPoint;
    const repairBtn: ButtonDef = {
      x: 0,
      y,
      w: view.w,
      h: btnH,
      label: repairPts > 0 ? `Repair ($${repairCost})` : 'Fully Repaired',
      disabled: repairPts <= 0 || state.cash < repairCost,
      primary: repairPts > 0 && state.cash >= repairCost,
      onClick: () => {
        if (repairVehicle(state, this.discipline)) {
          this.toasts.push('Vehicle repaired', accent);
        }
      },
    };
    drawButton(ctx, repairBtn, lui);
    handleButton(repairBtn, lui);
    y += btnH + pad(token, 1.5);

    y += drawSectionTitle(ctx, 0, y, 'Parts', lui);

    for (const part of PARTS) {
      const tier = vehicle.partTiers[part.id] ?? 0;
      const nextTier = tier + 1;
      const cost = partCost(part.baseCost, nextTier);
      const atMax = tier >= BALANCE.maxPartTier;

      drawRow(ctx, { x: 0, y, w: view.w, h: rowH }, lui);
      // lui is content-local (0..view.w, content y) — don't mix with view screen coords.
      if (
        lui.pointerX >= 0 &&
        lui.pointerX <= view.w &&
        lui.pointerY >= y &&
        lui.pointerY <= y + rowH
      ) {
        this.previewPart = part.id;
      }

      ctx.save();
      ctx.font = `600 ${token.fontBody}px ${token.fontFamily}`;
      ctx.fillStyle = this.previewPart === part.id ? accent : token.text;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const buyW = Math.min(pad(token, 10), view.w * 0.28);
      const nameMax = view.w - buyW - pad(token, 8);
      ctx.fillText(
        truncateText(ctx, part.name, Math.max(pad(token, 6), nameMax)),
        pad(token, 0.5),
        y + rowH * 0.5,
      );

      const pipR = pad(token, 0.4);
      let pipX =
        pad(token, 0.5) +
        ctx.measureText(truncateText(ctx, part.name, Math.max(pad(token, 6), nameMax))).width +
        pad(token, 1);
      const pipMax = view.w - buyW - pad(token, 1.5);
      for (let p = 0; p <= BALANCE.maxPartTier; p++) {
        if (pipX + pipR > pipMax) break;
        ctx.beginPath();
        ctx.arc(pipX, y + rowH * 0.5, pipR, 0, Math.PI * 2);
        ctx.fillStyle = p <= tier ? accent : token.bgElevated;
        ctx.fill();
        ctx.strokeStyle = token.cardStroke;
        ctx.stroke();
        pipX += pipR * 2 + pad(token, 0.5);
      }
      ctx.restore();

      const buyBtn: ButtonDef = {
        x: view.w - buyW,
        y: y + (rowH - btnH) * 0.5,
        w: buyW,
        h: btnH,
        label: atMax ? 'MAX' : `$${cost}`,
        disabled: atMax || state.cash < cost,
        primary: !atMax && state.cash >= cost,
        onClick: () => {
          if (buyPartTier(state, this.discipline, part.id as PartCategory)) {
            this.toasts.push(`${part.name} upgraded`, accent);
          }
        },
      };
      drawButton(ctx, buyBtn, lui);
      handleButton(buyBtn, lui);
      y += rowH;
    }

    this.scroller.end(ctx);
    handleHeader(header, ui);
    this.toasts.draw(ctx, ui);
  }
}
