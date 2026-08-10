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
  headerHeight,
  pad,
  ensureMinTouch,
  statBarHeight,
  isPortrait,
  ToastManager,
  type ButtonDef,
} from '../ui/components';
import {
  buildUi,
  drawBackground,
  onSceneEnter,
  onSceneResize,
  vehicleRadarValues,
  disciplineLabel,
  disciplineAccent,
  buyPartTier,
  repairVehicle,
} from './sceneUtils';

export class TuningScene implements Scene {
  private readonly discipline: DisciplineId;
  private toasts = new ToastManager();

  constructor(discipline: DisciplineId) {
    this.discipline = discipline;
  }

  enter(): void {
    onSceneEnter();
  }

  exit(): void {}

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

    drawBackground(ctx, w, h, token);

    const hh = headerHeight(token);
    const header = {
      x: 0,
      y: 0,
      w,
      h: hh + token.safe.top,
      title: `${disciplineLabel(this.discipline)} Tuning`,
      back: true,
      cash: state.cash,
      onBack: () => g.scenes.back(),
    };
    drawHeader(ctx, header, ui);

    const contentX = pad(token, 2) + token.safe.left;
    const contentW = w - pad(token, 4) - token.safe.left - token.safe.right;
    let y = hh + token.safe.top + pad(token);
    const btnH = ensureMinTouch(pad(token, 4.5), token);
    const rowH = pad(token, 5.5);

    const radarR = portrait ? Math.min(contentW * 0.35, pad(token, 10)) : pad(token, 8);
    const radarX = portrait ? contentX + (contentW - radarR * 2) * 0.5 : contentX;
    y += drawSectionTitle(ctx, contentX, y, 'Performance', ui);
    drawRadarChart(
      ctx,
      { x: radarX, y, radius: radarR, values: vehicleRadarValues(this.discipline, vehicle) },
      ui,
    );
    y += radarR * 2 + pad(token, 1.5);

    y += drawSectionTitle(ctx, contentX, y, 'Condition', ui);
    drawStatBar(
      ctx,
      {
        x: contentX,
        y,
        w: contentW,
        label: 'Condition',
        value: vehicle.condition * 100,
        color: vehicle.condition < BALANCE.conditionMin + 0.05 ? token.danger : accent,
      },
      ui,
    );
    y += statBarHeight(token) + pad(token, 0.75);

    const repairPts = Math.max(0, Math.ceil((BALANCE.conditionMax - vehicle.condition) * 100));
    const repairCost = repairPts * BALANCE.repairCostPerPoint;
    const repairBtn: ButtonDef = {
      x: contentX,
      y,
      w: contentW,
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
    drawButton(ctx, repairBtn, ui);
    handleButton(repairBtn, ui);
    y += btnH + pad(token, 1.5);

    y += drawSectionTitle(ctx, contentX, y, 'Parts', ui);

    for (const part of PARTS) {
      const tier = vehicle.partTiers[part.id] ?? 0;
      const nextTier = tier + 1;
      const cost = partCost(part.baseCost, nextTier);
      const atMax = tier >= BALANCE.maxPartTier;

      drawRow(ctx, { x: contentX, y, w: contentW, h: rowH }, ui);

      ctx.save();
      ctx.font = `600 ${token.fontBody}px ${token.fontFamily}`;
      ctx.fillStyle = token.text;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(part.name, contentX + pad(token, 0.5), y + rowH * 0.5);

      const pipR = pad(token, 0.4);
      let pipX = contentX + pad(token, 10);
      for (let p = 0; p <= BALANCE.maxPartTier; p++) {
        ctx.beginPath();
        ctx.arc(pipX, y + rowH * 0.5, pipR, 0, Math.PI * 2);
        ctx.fillStyle = p <= tier ? accent : token.bgElevated;
        ctx.fill();
        ctx.strokeStyle = token.cardStroke;
        ctx.stroke();
        pipX += pipR * 2 + pad(token, 0.5);
      }
      ctx.restore();

      const buyW = pad(token, 10);
      const buyBtn: ButtonDef = {
        x: contentX + contentW - buyW,
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
      drawButton(ctx, buyBtn, ui);
      handleButton(buyBtn, ui);
      y += rowH;
    }

    handleHeader(header, ui);
    this.toasts.draw(ctx, ui);
  }
}
