import type { Scene } from '../engine/SceneManager';
import { getGameContext } from '../engine/GameContext';
import type { DisciplineId } from '../data/disciplines';
import {
  drawButton,
  handleButton,
  drawHeader,
  handleHeader,
  drawStatBar,
  drawRadarChart,
  drawSectionTitle,
  layoutShell,
  ContentScroller,
  pad,
  ensureMinTouch,
  statBarHeight,
  isPortrait,
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
import {
  DISCIPLINE_ORDER,
  disciplineAccent,
  disciplineLabel,
} from '../career/disciplinesUi';
import { vehicleRadarValues } from '../career/garage';
import { CampaignScene } from './CampaignScene';
import { TuningScene } from './TuningScene';
import { TeamManagementScene } from './TeamManagementScene';
import { OptionsScene } from './OptionsScene';
import { TitleScene } from './TitleScene';

export class GarageScene implements Scene {
  private disciplineIndex = 0;
  private scroller = new ContentScroller();
  private detachWheel: (() => void) | null = null;
  private swipeStartX: number | null = null;
  private swipeStartY: number | null = null;
  private swipeArmed = false;

  enter(): void {
    onSceneEnter();
    this.disciplineIndex = 0;
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
    getGameContext().scenes.replace(new TitleScene());
    return true;
  }

  update(_dt: number): void {}

  private currentDiscipline(): DisciplineId {
    return DISCIPLINE_ORDER[this.disciplineIndex] ?? 'track';
  }

  private prevDiscipline(): void {
    this.disciplineIndex = (this.disciplineIndex - 1 + DISCIPLINE_ORDER.length) % DISCIPLINE_ORDER.length;
  }

  private nextDiscipline(): void {
    this.disciplineIndex = (this.disciplineIndex + 1) % DISCIPLINE_ORDER.length;
  }

  render(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const g = getGameContext();
    const state = g.state;
    if (state === null) return;

    let discipline = this.currentDiscipline();
    let accent = disciplineAccent(discipline);
    const { ui, token } = buildUi(w, h, 0, accent);
    let swipeHandled = false;
    // Horizontal swipe — track press→release (same-frame dx was always ~0).
    if (ui.pointerDown) {
      if (this.swipeStartX === null) {
        this.swipeStartX = ui.pointerX;
        this.swipeStartY = ui.pointerY;
        this.swipeArmed = true;
      }
    } else if (this.swipeArmed && this.swipeStartX !== null && this.swipeStartY !== null) {
      const dx = ui.pointerX - this.swipeStartX;
      const dy = ui.pointerY - this.swipeStartY;
      if (
        Math.abs(dx) > Math.max(48, token.touchMin) &&
        Math.abs(dx) > Math.abs(dy) * 1.25 &&
        !this.scroller.isScrolling
      ) {
        if (dx < 0) this.nextDiscipline();
        else this.prevDiscipline();
        swipeHandled = true;
        discipline = this.currentDiscipline();
        accent = disciplineAccent(discipline);
        ui.accent = accent;
      }
      this.swipeStartX = null;
      this.swipeStartY = null;
      this.swipeArmed = false;
    }

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
    const btnH = ensureMinTouch(pad(token, 5.5), token);
    const btnGap = pad(token, 0.75);
    // Tighter hero so Tuning/Team sit nearer the action, not over empty floor.
    const carW = Math.min(view.w * (portrait ? 0.48 : 0.38), pad(token, 17));
    const carH = carW * 1.1;
    const radarR = portrait
      ? Math.min(view.w * 0.2, pad(token, 7))
      : Math.min(view.w * 0.16, pad(token, 7.5));
    // Extra inset so radar labels never clip the content edge.
    const radarInset = pad(token, 2.5) + token.fontCaption;

    // Measure content height
    let contentH = pad(token, 0.5) + navSize + pad(token, 1);
    if (portrait) {
      contentH += carH + pad(token, 0.75) + radarR * 2 + pad(token, 2.5) + pad(token, 1);
    } else {
      contentH += Math.max(carH, radarR * 2 + pad(token, 2)) + pad(token, 1);
    }
    contentH +=
      statBarHeight(token) +
      pad(token, 1) +
      token.fontCaption +
      pad(token, 0.75) +
      btnH * 1.15 +
      btnGap +
      pad(token, 0.35) +
      token.fontCaption +
      pad(token, 0.75) +
      btnH +
      pad(token, 1.5);

    this.scroller.layout(view, contentH);
    this.scroller.update(ui, view);
    const lui = this.scroller.localUi(ui, view);

    this.scroller.begin(ctx, view);
    let y = pad(token, 0.25);

    // Discipline nav — labeled prev/next instead of bare chevrons
    const discLabel = disciplineLabel(discipline).toUpperCase();
    const prevBtn: ButtonDef = {
      x: 0,
      y,
      w: navSize,
      h: navSize,
      label: '‹',
      onClick: () => this.prevDiscipline(),
    };
    const nextBtn: ButtonDef = {
      x: view.w - navSize,
      y,
      w: navSize,
      h: navSize,
      label: '›',
      onClick: () => this.nextDiscipline(),
    };
    drawButton(ctx, prevBtn, lui);
    drawButton(ctx, nextBtn, lui);
    ctx.save();
    ctx.font = `700 ${token.fontTitle}px ${token.fontDisplayFamily}`;
    ctx.fillStyle = accent;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const titleMax = view.w - navSize * 2 - pad(token, 1);
    ctx.fillText(truncateText(ctx, discLabel, titleMax), view.w * 0.5, y + navSize * 0.42);
    ctx.font = `500 ${token.fontCaption}px ${token.fontFamily}`;
    ctx.fillStyle = token.textDim;
    ctx.fillText('Swipe or tap arrows', view.w * 0.5, y + navSize * 0.78);
    ctx.restore();
    if (!swipeHandled && !this.scroller.isScrolling) {
      handleButton(prevBtn, lui);
      handleButton(nextBtn, lui);
    }
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
      drawRadarChart(
        ctx,
        {
          x: (view.w - radarR * 2) * 0.5,
          y: y + pad(token, 1.25),
          radius: radarR,
          values: vehicleRadarValues(discipline, vehicle),
        },
        lui,
      );
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
          values: vehicleRadarValues(discipline, vehicle),
        },
        lui,
      );
      y += blockH + pad(token, 1);
    }

    drawStatBar(
      ctx,
      {
        x: 0,
        y,
        w: view.w,
        label: 'Condition',
        value: vehicle.condition * 100,
        color: vehicle.condition < 0.75 ? token.danger : accent,
      },
      lui,
    );
    y += statBarHeight(token) + pad(token, 1);
    y += drawSectionTitle(ctx, 0, y, 'Race', lui);
    y += pad(token, 0.35);

    const campaignBtn: ButtonDef = {
      x: 0,
      y,
      w: view.w,
      h: btnH * 1.15,
      label: 'Enter Campaign',
      primary: true,
      onClick: () => g.scenes.push(new CampaignScene(discipline)),
    };
    y += campaignBtn.h + btnGap + pad(token, 0.25);
    y += drawSectionTitle(ctx, 0, y, 'Garage', lui);
    y += pad(token, 0.35);
    const rowW = (view.w - btnGap) * 0.5;
    const tuningBtn: ButtonDef = {
      x: 0,
      y,
      w: rowW,
      h: btnH,
      label: 'Tuning',
      onClick: () => g.scenes.push(new TuningScene(discipline)),
    };
    const teamBtn: ButtonDef = {
      x: rowW + btnGap,
      y,
      w: rowW,
      h: btnH,
      label: 'Team',
      onClick: () => g.scenes.push(new TeamManagementScene()),
    };

    drawButton(ctx, campaignBtn, lui);
    drawButton(ctx, tuningBtn, lui);
    drawButton(ctx, teamBtn, lui);
    if (!swipeHandled) {
      handleButton(campaignBtn, lui);
      handleButton(tuningBtn, lui);
      handleButton(teamBtn, lui);
    }
    this.scroller.end(ctx);

    handleHeader(header, ui);
  }
}
