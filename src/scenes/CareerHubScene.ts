import type { Scene } from '../engine/SceneManager';
import { getGameContext } from '../engine/GameContext';
import { activeDriver } from '../engine/SaveManager';
import { getDiscipline, type DisciplineId } from '../data/disciplines';
import { disciplineLabel } from '../career/disciplinesUi';
import { RANK_NAMES } from '../data/balance';
import { TOURNAMENTS } from '../data/tournaments';
import {
  drawButton,
  handleButton,
  drawHeader,
  handleHeader,
  drawCard,
  pad,
  truncateText,
  type ButtonDef,
  type HeaderDef,
  ToastManager,
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
import { launchRace, makeTimeTrialConfig } from '../career/launchRace';
import { TitleScene } from './TitleScene';

type HubTab = 'garage' | 'team' | 'calendar' | 'standings' | 'unlocks';

export class CareerHubScene implements Scene {
  private tab: HubTab = 'garage';
  private toasts = new ToastManager();

  enter(): void {
    onSceneEnter();
  }

  exit(): void {}

  onResize(w: number, h: number): void {
    onSceneResize(w, h);
  }

  update(dt: number): void {
    this.toasts.update(dt);
  }

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

    ctx.save();
    ctx.fillStyle = '#0b0f0e';
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
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

    const header: HeaderDef = {
      x: pad(token, 2),
      y: pad(token, 2),
      w: w - pad(token, 4),
      h: Math.max(token.fontDisplay * 2.2, pad(token, 9)),
      title: driver.name,
      back: true,
      cash: state.cash,
      settings: true,
      onBack: () => this.handleBack(),
      onSettings: () => g.scenes.push(new OptionsScene()),
    };
    drawHeader(ctx, header, ui);
    handleHeader(header, ui);

    // Identity strip
    const idY = header.y + header.h + pad(token, 1);
    const idH = pad(token, 7);
    drawCard(ctx, { x: pad(token, 2), y: idY, w: w - pad(token, 4), h: idH }, ui);
    ctx.save();
    ctx.beginPath();
    ctx.arc(pad(token, 2) + pad(token, 2) + idH * 0.3, idY + idH / 2, idH * 0.3, 0, Math.PI * 2);
    ctx.fillStyle = driverColor(driver.color);
    ctx.fill();
    ctx.fillStyle = '#f2efe6';
    ctx.font = `600 ${token.fontDisplay}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(driver.name, pad(token, 2) + pad(token, 5) + idH * 0.6, idY + idH * 0.4);
    ctx.fillStyle = accent;
    ctx.font = `600 ${token.fontBody}px Inter, system-ui, sans-serif`;
    ctx.fillText(disciplineLabel(discipline).toUpperCase(), pad(token, 2) + pad(token, 5) + idH * 0.6, idY + idH * 0.74);
    ctx.fillStyle = 'rgba(242,239,230,0.6)';
    ctx.textAlign = 'right';
    ctx.fillText(`Lv ${driver.level} · ${RANK_NAMES[state.rankUnlocked[discipline]]}`, w - pad(token, 4), idY + idH / 2);
    ctx.restore();

    // Tab strip
    const tabs: { id: HubTab; label: string }[] = [
      { id: 'garage', label: 'Garage' },
      { id: 'team', label: 'Team' },
      { id: 'calendar', label: 'Calendar' },
      { id: 'standings', label: 'Standings' },
      { id: 'unlocks', label: 'Unlocks' },
    ];
    const tabTop = idY + idH + pad(token, 1);
    const tabH = pad(token, 6);
    const tabW = (w - pad(token, 4) - (tabs.length - 1) * pad(token, 0.6)) / tabs.length;
    tabs.forEach((t, i) => {
      const x = pad(token, 2) + i * (tabW + pad(token, 0.6));
      const btn: ButtonDef = {
        x,
        y: tabTop,
        w: tabW,
        h: tabH,
        label: t.label,
        primary: this.tab === t.id,
        onClick: () => {
          this.tab = t.id;
        },
      };
      drawButton(ctx, btn, ui);
      handleButton(btn, ui);
    });

    const contentY = tabTop + tabH + pad(token, 1);
    switch (this.tab) {
      case 'garage':
        this.renderGarage(ctx, ui, token, w, contentY, discipline);
        break;
      case 'team':
        this.renderTeam(ctx, ui, token, w, contentY, state);
        break;
      case 'calendar':
        this.renderCalendarEntry(ctx, ui, token, w, contentY, discipline);
        break;
      case 'standings':
        this.renderStandings(ctx, ui, token, w, contentY, state, discipline);
        break;
      case 'unlocks':
        this.renderUnlocks(ctx, ui, token, w, contentY, state, discipline);
        break;
    }

    this.toasts.draw(ctx, ui);
  }

  private renderGarage(
    ctx: CanvasRenderingContext2D,
    ui: import('../ui/components').UiContext,
    token: import('../ui/components').ThemeTokens,
    w: number,
    y: number,
    discipline: DisciplineId,
  ): void {
    const g = getGameContext();
    const v = (g.state?.vehicles[discipline]) ?? null;
    drawCard(ctx, { x: pad(token, 2), y, w: w - pad(token, 4), h: pad(token, 12) }, ui);
    ctx.save();
    ctx.fillStyle = '#f2efe6';
    ctx.font = `600 ${token.fontDisplay}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('Your Car', pad(token, 4), y + pad(token, 2));
    ctx.fillStyle = 'rgba(242,239,230,0.7)';
    ctx.font = `400 ${token.fontBody}px Inter, system-ui, sans-serif`;
    const tiers = v ? Object.values(v.partTiers) : [];
    const avg = tiers.length ? Math.round(tiers.reduce((a, b) => a + b, 0) / tiers.length) : 0;
    const cond = v ? Math.round(v.condition * 100) : 0;
    ctx.fillText(`Average part tier: T${avg}`, pad(token, 4), y + pad(token, 6));
    ctx.fillText(`Condition: ${cond}%`, pad(token, 4), y + pad(token, 9));
    ctx.restore();
    const btnW = (w - pad(token, 8) - pad(token, 1)) / 2;
    const btnY = y + pad(token, 12) - pad(token, 7);
    const open: ButtonDef = {
      x: pad(token, 4),
      y: btnY,
      w: btnW,
      h: pad(token, 5.5),
      label: 'Open Garage  →',
      primary: true,
      onClick: () => g.scenes.push(new GarageScene()),
    };
    drawButton(ctx, open, ui);
    handleButton(open, ui);
    const practice: ButtonDef = {
      x: pad(token, 4) + btnW + pad(token, 1),
      y: btnY,
      w: btnW,
      h: pad(token, 5.5),
      label: 'Practice Lap',
      onClick: () => {
        const st = getGameContext().state;
        if (!st) return;
        const lead = activeDriver(st)?.id;
        launchRace(makeTimeTrialConfig(st, discipline, 'campaign', lead), this.toasts);
      },
    };
    drawButton(ctx, practice, ui);
    handleButton(practice, ui);
  }

  private renderTeam(
    ctx: CanvasRenderingContext2D,
    ui: import('../ui/components').UiContext,
    token: import('../ui/components').ThemeTokens,
    w: number,
    y: number,
    state: NonNullable<ReturnType<typeof getGameContext>['state']>,
  ): void {
    const g = getGameContext();
    drawCard(ctx, { x: pad(token, 2), y, w: w - pad(token, 4), h: pad(token, 12) }, ui);
    ctx.save();
    ctx.fillStyle = '#f2efe6';
    ctx.font = `600 ${token.fontDisplay}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('Your Team', pad(token, 4), y + pad(token, 2));
    ctx.fillStyle = 'rgba(242,239,230,0.7)';
    ctx.font = `400 ${token.fontBody}px Inter, system-ui, sans-serif`;
    ctx.fillText(`Drivers on roster: ${state.roster.length}`, pad(token, 4), y + pad(token, 6));
    ctx.fillText('Hire rivals, train ratings, manage morale.', pad(token, 4), y + pad(token, 9));
    ctx.restore();
    const open: ButtonDef = {
      x: pad(token, 4),
      y: y + pad(token, 12) - pad(token, 7),
      w: w - pad(token, 8),
      h: pad(token, 5.5),
      label: 'Open Team  →',
      primary: true,
      onClick: () => g.scenes.push(new TeamManagementScene()),
    };
    drawButton(ctx, open, ui);
    handleButton(open, ui);
  }

  private renderCalendarEntry(
    ctx: CanvasRenderingContext2D,
    ui: import('../ui/components').UiContext,
    token: import('../ui/components').ThemeTokens,
    w: number,
    y: number,
    discipline: DisciplineId,
  ): void {
    const g = getGameContext();
    const open: ButtonDef = {
      x: pad(token, 4),
      y: y + pad(token, 2),
      w: w - pad(token, 8),
      h: pad(token, 6),
      label: 'Open Series & Calendar  →',
      primary: true,
      onClick: () => g.scenes.push(new CampaignScene(discipline)),
    };
    drawButton(ctx, open, ui);
    handleButton(open, ui);
    ctx.save();
    ctx.fillStyle = 'rgba(242,239,230,0.55)';
    ctx.font = `400 ${token.fontCaption}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const defs = TOURNAMENTS.filter((t) => t.discipline === discipline);
    const unlocked = g.state ? g.state.rankUnlocked[discipline] : 0;
    const next = defs.find((t) => t.rank <= unlocked);
    ctx.fillText(
      next ? `Next available: ${next.name} (${RANK_NAMES[next.rank]})` : 'No series unlocked yet.',
      pad(token, 4),
      y + pad(token, 10),
    );
    ctx.restore();
  }

  private renderStandings(
    ctx: CanvasRenderingContext2D,
    ui: import('../ui/components').UiContext,
    token: import('../ui/components').ThemeTokens,
    w: number,
    y: number,
    state: NonNullable<ReturnType<typeof getGameContext>['state']>,
    discipline: DisciplineId,
  ): void {
    const prog = state.inProgressTournaments[discipline];
    drawCard(ctx, { x: pad(token, 2), y, w: w - pad(token, 4), h: pad(token, 16) }, ui);
    ctx.save();
    ctx.fillStyle = '#f2efe6';
    ctx.font = `600 ${token.fontDisplay}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('Championship Standings', pad(token, 4), y + pad(token, 2));
    ctx.restore();

    if (prog === null) {
      ctx.save();
      ctx.fillStyle = 'rgba(242,239,230,0.55)';
      ctx.font = `400 ${token.fontBody}px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText('No active series. Enter one from the Calendar tab.', pad(token, 4), y + pad(token, 7));
      ctx.restore();
      return;
    }
    const sorted = [...prog.standings].sort((a, b) => b.points - a.points);
    let ry = y + pad(token, 7);
    const rowH = pad(token, 4.5);
    sorted.slice(0, 8).forEach((s, i) => {
      ctx.save();
      ctx.fillStyle = i === 0 ? getDiscipline(discipline).accent : 'rgba(242,239,230,0.85)';
      ctx.font = `600 ${token.fontBody}px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${i + 1}. ${truncateText(ctx, s.name, w - pad(token, 14))}`, pad(token, 4), ry + rowH / 2);
      ctx.textAlign = 'right';
      ctx.fillText(`${s.points} pts`, w - pad(token, 4), ry + rowH / 2);
      ctx.restore();
      ry += rowH;
    });
  }

  private renderUnlocks(
    ctx: CanvasRenderingContext2D,
    ui: import('../ui/components').UiContext,
    token: import('../ui/components').ThemeTokens,
    w: number,
    y: number,
    state: NonNullable<ReturnType<typeof getGameContext>['state']>,
    discipline: DisciplineId,
  ): void {
    const rank = state.rankUnlocked[discipline];
    const maxRank = RANK_NAMES.length - 1;
    drawCard(ctx, { x: pad(token, 2), y, w: w - pad(token, 4), h: pad(token, 16) }, ui);
    ctx.save();
    ctx.fillStyle = '#f2efe6';
    ctx.font = `600 ${token.fontDisplay}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('Progression', pad(token, 4), y + pad(token, 2));
    ctx.fillStyle = 'rgba(242,239,230,0.75)';
    ctx.font = `400 ${token.fontBody}px Inter, system-ui, sans-serif`;
    ctx.fillText(`Rank: ${RANK_NAMES[rank]}  (${rank}/${maxRank})`, pad(token, 4), y + pad(token, 7));
    const nextRank = rank + 1;
    if (nextRank <= maxRank) {
      ctx.fillText(`Win the current top series to reach ${RANK_NAMES[nextRank]}.`, pad(token, 4), y + pad(token, 10));
    } else {
      ctx.fillText('Top rank achieved — defend your title.', pad(token, 4), y + pad(token, 10));
    }
    ctx.fillStyle = 'rgba(242,239,230,0.55)';
    ctx.font = `400 ${token.fontCaption}px Inter, system-ui, sans-serif`;
    const objs = state.objectives.active;
    ctx.fillText(`Active objectives: ${objs.length ? objs.join(', ') : 'none'}`, pad(token, 4), y + pad(token, 13));
    ctx.restore();
  }
}

function driverColor(c: string | undefined): string {
  return typeof c === 'string' && c.length > 0 ? c : '#f0c41a';
}
