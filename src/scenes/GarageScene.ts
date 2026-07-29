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
  headerHeight,
  pad,
  ensureMinTouch,
  statBarHeight,
  hitRect,
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

export class GarageScene implements Scene {
  private disciplineIndex = 0;

  enter(): void {
    onSceneEnter();
    this.disciplineIndex = 0;
  }

  exit(): void {}

  onResize(w: number, h: number): void {
    onSceneResize(w, h);
  }

  handleBack(): boolean {
    return false;
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
      if (Math.abs(dx) > 60) {
        if (dx < 0) this.nextDiscipline();
        else this.prevDiscipline();
        swipeHandled = true;
        discipline = this.currentDiscipline();
        accent = disciplineAccent(discipline);
        ui.accent = accent;
      }
    }

    const vehicle = state.vehicles[discipline];

    drawBackground(ctx, w, h, token);

    const hh = headerHeight(token);
    const header = {
      x: 0,
      y: 0,
      w,
      h: hh + token.safe.top,
      title: 'Garage',
      cash: state.cash,
      settings: true,
      onSettings: () => g.scenes.push(new OptionsScene()),
    };
    drawHeader(ctx, header, ui);

    const contentTop = hh + token.safe.top + pad(token);
    const navSize = ensureMinTouch(pad(token, 5), token);
    const navY = contentTop + pad(token, 2);

    ctx.save();
    ctx.font = `${token.fontTitle}px ${token.fontFamily}`;
    ctx.fillStyle = accent;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(disciplineLabel(discipline), w * 0.5, navY);
    ctx.restore();

    const leftX = pad(token) + token.safe.left;
    const rightX = w - pad(token) - navSize - token.safe.right;
    carouselNav(ui, leftX, rightX, navY + token.fontTitle, navSize, () => this.prevDiscipline(), () => this.nextDiscipline());

    ctx.save();
    ctx.font = `700 ${token.fontTitle}px ${token.fontFamily}`;
    ctx.fillStyle = token.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (hitRect(ui.pointerX, ui.pointerY, leftX, navY, navSize, navSize)) {
      ctx.fillStyle = accent;
      ctx.fillText('‹', leftX + navSize * 0.5, navY + navSize * 0.5);
    } else {
      ctx.fillText('‹', leftX + navSize * 0.5, navY + navSize * 0.5);
    }
    if (hitRect(ui.pointerX, ui.pointerY, rightX, navY, navSize, navSize)) {
      ctx.fillStyle = accent;
      ctx.fillText('›', rightX + navSize * 0.5, navY + navSize * 0.5);
    } else {
      ctx.fillText('›', rightX + navSize * 0.5, navY + navSize * 0.5);
    }
    ctx.restore();

    const carW = Math.min(w * 0.35, pad(token, 18));
    const carH = carW * 1.2;
    const carCx = w * 0.5;
    const carCy = contentTop + pad(token, 8) + carH * 0.5;
    drawTopDownCar(ctx, carCx, carCy, carW, carH, accent, discipline);

    const radarR = Math.min(w, h) * 0.14;
    const radarX = pad(token, 2) + token.safe.left;
    const radarY = carCy - radarR;
    drawRadarChart(
      ctx,
      {
        x: radarX,
        y: radarY,
        radius: radarR,
        values: vehicleRadarValues(discipline, vehicle),
      },
      ui,
    );

    const condBarW = w - pad(token, 4) - token.safe.left - token.safe.right;
    const condY = carCy + carH * 0.5 + pad(token, 2);
    drawStatBar(
      ctx,
      {
        x: pad(token, 2) + token.safe.left,
        y: condY,
        w: condBarW,
        label: 'Condition',
        value: vehicle.condition * 100,
        color: vehicle.condition < 0.75 ? token.danger : accent,
      },
      ui,
    );

    const btnH = ensureMinTouch(pad(token, 5.5), token);
    const btnGap = pad(token, 0.75);
    const btnW = Math.min(condBarW, pad(token, 22));
    let btnY = condY + statBarHeight(token) + pad(token, 3);

    const campaignBtn: ButtonDef = {
      x: (w - btnW) * 0.5,
      y: btnY,
      w: btnW,
      h: btnH,
      label: 'Campaign',
      primary: true,
      onClick: () => g.scenes.push(new CampaignScene(discipline)),
    };
    btnY += btnH + btnGap;

    const rowW = (condBarW - btnGap) * 0.5;
    const rowX = (w - condBarW) * 0.5;
    const tuningBtn: ButtonDef = {
      x: rowX,
      y: btnY,
      w: rowW,
      h: btnH,
      label: 'Tuning',
      onClick: () => g.scenes.push(new TuningScene(discipline)),
    };
    const teamBtn: ButtonDef = {
      x: rowX + rowW + btnGap,
      y: btnY,
      w: rowW,
      h: btnH,
      label: 'Team',
      onClick: () => g.scenes.push(new TeamManagementScene()),
    };

    drawButton(ctx, campaignBtn, ui);
    drawButton(ctx, tuningBtn, ui);
    drawButton(ctx, teamBtn, ui);

    if (!swipeHandled) {
      handleButton(campaignBtn, ui);
      handleButton(tuningBtn, ui);
      handleButton(teamBtn, ui);
    }
    handleHeader(header, ui);
  }
}
