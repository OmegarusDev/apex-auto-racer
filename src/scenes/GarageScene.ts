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
  hitRect,
  isPortrait,
  type ButtonDef,
} from '../ui/components';
import {
  buildUi,
  drawBackground,
  drawTopDownCar,
  onSceneEnter,
  onSceneResize,
  vehicleRadarValues,
  disciplineLabel,
  disciplineAccent,
  DISCIPLINE_ORDER,
  carouselNav,
} from './sceneUtils';
import { CampaignScene } from './CampaignScene';
import { TuningScene } from './TuningScene';
import { TeamManagementScene } from './TeamManagementScene';
import { OptionsScene } from './OptionsScene';
import { TitleScene } from './TitleScene';

export class GarageScene implements Scene {
  private disciplineIndex = 0;
  private scroller = new ContentScroller();
  private detachWheel: (() => void) | null = null;

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

    const preClick = g.input.peekClick();
    let discipline = this.currentDiscipline();
    let accent = disciplineAccent(discipline);
    const { ui, token } = buildUi(w, h, 0, accent);
    let swipeHandled = false;
    if (preClick !== null && ui.pointerClicked) {
      const dx = g.input.pointerX - preClick.x;
      if (Math.abs(dx) > Math.max(48, token.touchMin)) {
        if (dx < 0) this.nextDiscipline();
        else this.prevDiscipline();
        swipeHandled = true;
        discipline = this.currentDiscipline();
        accent = disciplineAccent(discipline);
        ui.accent = accent;
      }
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
    const carW = Math.min(view.w * (portrait ? 0.55 : 0.42), pad(token, 20));
    const carH = carW * 1.15;
    const radarR = portrait
      ? Math.min(view.w * 0.22, pad(token, 8))
      : Math.min(view.w * 0.18, pad(token, 9));

    // Measure content height
    let contentH = pad(token, 1) + navSize + pad(token, 1.5);
    if (portrait) {
      contentH += carH + pad(token, 1) + radarR * 2 + pad(token, 1.5);
    } else {
      contentH += Math.max(carH, radarR * 2) + pad(token, 1.5);
    }
    contentH +=
      statBarHeight(token) +
      pad(token, 1.5) +
      token.fontCaption +
      pad(token, 1) +
      btnH * 1.15 +
      btnGap +
      pad(token, 0.5) +
      token.fontCaption +
      pad(token, 1) +
      btnH +
      pad(token, 2);

    this.scroller.layout(view, contentH);
    this.scroller.update(ui, view);
    const lui = this.scroller.localUi(ui, view);

    this.scroller.begin(ctx, view);
    let y = pad(token, 0.5);

    // Discipline nav — draw and hit at same Y
    ctx.save();
    ctx.font = `700 ${token.fontTitle}px ${token.fontDisplayFamily}`;
    ctx.fillStyle = accent;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(disciplineLabel(discipline).toUpperCase(), view.w * 0.5, y + navSize * 0.5);
    ctx.restore();

    const leftX = 0;
    const rightX = view.w - navSize;
    ctx.save();
    ctx.font = `700 ${token.fontTitle}px ${token.fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = hitRect(lui.pointerX, lui.pointerY, leftX, y, navSize, navSize) ? accent : token.text;
    ctx.fillText('‹', leftX + navSize * 0.5, y + navSize * 0.5);
    ctx.fillStyle = hitRect(lui.pointerX, lui.pointerY, rightX, y, navSize, navSize) ? accent : token.text;
    ctx.fillText('›', rightX + navSize * 0.5, y + navSize * 0.5);
    ctx.restore();
    if (!swipeHandled && !this.scroller.isScrolling) {
      carouselNav(lui, leftX, rightX, y, navSize, () => this.prevDiscipline(), () => this.nextDiscipline());
    }
    y += navSize + pad(token, 1.5);

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
      y += carH + pad(token, 1);
      drawRadarChart(
        ctx,
        {
          x: (view.w - radarR * 2) * 0.5,
          y,
          radius: radarR,
          values: vehicleRadarValues(discipline, vehicle),
        },
        lui,
      );
      y += radarR * 2 + pad(token, 1.5);
    } else {
      const blockH = Math.max(carH, radarR * 2);
      const carCx = view.w * 0.55;
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
          x: pad(token, 0.5),
          y: y + (blockH - radarR * 2) * 0.5,
          radius: radarR,
          values: vehicleRadarValues(discipline, vehicle),
        },
        lui,
      );
      y += blockH + pad(token, 1.5);
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
    y += statBarHeight(token) + pad(token, 1.5);
    y += drawSectionTitle(ctx, 0, y, 'Race', lui);
    y += pad(token, 0.5);

    const campaignBtn: ButtonDef = {
      x: 0,
      y,
      w: view.w,
      h: btnH * 1.15,
      label: 'Enter Campaign',
      primary: true,
      onClick: () => g.scenes.push(new CampaignScene(discipline)),
    };
    y += campaignBtn.h + btnGap + pad(token, 0.5);
    y += drawSectionTitle(ctx, 0, y, 'Garage', lui);
    y += pad(token, 0.5);
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
