import type { Scene } from '../engine/SceneManager';
import { getGameContext } from '../engine/GameContext';
import { activeDriver } from '../engine/SaveManager';
import { getDiscipline, type DisciplineId } from '../data/disciplines';
import { disciplineLabel } from '../career/disciplinesUi';
import { RANK_NAMES } from '../data/balance';
import {
  drawButton,
  handleButton,
  drawHeader,
  handleHeader,
  pad,
  layoutShell,
  ctaHeight,
  ensureMinTouch,
  truncateText,
  type ButtonDef,
  type HeaderDef,
} from '../ui/components';
import {
  buildUi,
  drawBackground,
  onSceneEnter,
  onSceneResize,
} from './sceneChrome';
import { GarageScene } from './GarageScene';
import { TeamManagementScene } from './TeamManagementScene';
import { CampaignScene } from './CampaignScene';
import { OptionsScene } from './OptionsScene';
import { DisciplineSelectScene } from './DisciplineSelectScene';
import { TitleScene } from './TitleScene';

export class CareerHubScene implements Scene {
  enter(): void {
    onSceneEnter();
  }

  exit(): void {}

  onResize(w: number, h: number): void {
    onSceneResize(w, h);
  }

  update(_dt: number): void {}

  handleBack(): boolean {
    const s = getGameContext().scenes;
    if (s.depth > 1) s.back();
    else s.replace(new TitleScene());
    return true;
  }

  render(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const g = getGameContext();
    const state = g.state;
    const driver = state !== null ? activeDriver(state) : null;
    const discipline: DisciplineId = driver?.discipline ?? 'track';
    const accent = getDiscipline(discipline).accent;
    const { ui, token } = buildUi(w, h, 0, accent);

    drawBackground(ctx, w, h, token, accent);

    if (driver === null || state === null) {
      const back: ButtonDef = {
        x: w / 2 - token.fontDisplay * 5,
        y: h / 2,
        w: token.fontDisplay * 10,
        h: pad(token, 6),
        label: 'Back',
        onClick: () => g.scenes.replace(new DisciplineSelectScene()),
      };
      drawButton(ctx, back, ui);
      handleButton(back, ui);
      return;
    }

    const shell = layoutShell(w, h, token);
    const header: HeaderDef = {
      x: shell.headerRect.x,
      y: shell.headerRect.y,
      w: shell.headerRect.w,
      h: shell.headerRect.h,
      title: '',
      back: true,
      cash: state.cash,
      settings: true,
      onBack: () => this.handleBack(),
      onSettings: () => g.scenes.push(new OptionsScene()),
    };
    drawHeader(ctx, header, ui);

    const view = shell.contentRect;
    const ox = view.x;
    const nameSize = Math.min(token.fontHero, view.w * 0.14);
    const raceH = ctaHeight(token);
    const linkH = ensureMinTouch(pad(token, 5), token);

    let y = view.y + pad(token, 2);
    ctx.save();
    ctx.font = `400 ${nameSize}px ${token.fontDisplayFamily}`;
    ctx.fillStyle = token.text;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(truncateText(ctx, driver.name.toUpperCase(), view.w), ox, y);
    y += nameSize + pad(token, 0.6);
    ctx.font = `600 ${token.fontBody}px ${token.fontFamily}`;
    ctx.fillStyle = accent;
    const rank = RANK_NAMES[state.rankUnlocked[discipline]] ?? RANK_NAMES[0];
    ctx.fillText(
      truncateText(ctx, `${disciplineLabel(discipline)}  ·  ${rank}`, view.w),
      ox,
      y,
    );
    ctx.restore();
    y += token.fontBody + pad(token, 3);

    const raceBtn: ButtonDef = {
      x: ox,
      y,
      w: view.w,
      h: raceH,
      label: 'Race',
      cta: true,
      primary: true,
      fontSize: token.fontDisplay,
      onClick: () => g.scenes.push(new CampaignScene(discipline)),
    };
    drawButton(ctx, raceBtn, { ...ui, accent });
    handleButton(raceBtn, ui);
    y += raceH + pad(token, 1);

    const colW = (view.w - pad(token, 1)) * 0.5;
    const garageBtn: ButtonDef = {
      x: ox,
      y,
      w: colW,
      h: linkH,
      label: 'Garage',
      quiet: true,
      onClick: () => g.scenes.push(new GarageScene()),
    };
    const teamBtn: ButtonDef = {
      x: ox + colW + pad(token, 1),
      y,
      w: colW,
      h: linkH,
      label: 'Team',
      quiet: true,
      onClick: () => g.scenes.push(new TeamManagementScene()),
    };
    drawButton(ctx, garageBtn, ui);
    drawButton(ctx, teamBtn, ui);
    handleButton(garageBtn, ui);
    handleButton(teamBtn, ui);

    handleHeader(header, ui);
  }
}
