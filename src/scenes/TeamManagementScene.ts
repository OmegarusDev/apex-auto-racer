import type { Scene } from '../engine/SceneManager';
import { getGameContext } from '../engine/GameContext';
import { BALANCE } from '../data/balance';
import { hireCost } from '../engine/DriverGenerator';
import { getTrait } from '../data/traits';
import type { Driver } from '../engine/types';
import type { DriverStatKey } from '../ui/components';
import {
  drawButton,
  handleButton,
  drawHeader,
  handleHeader,
  drawStatBar,
  drawSectionTitle,
  drawModal,
  handleModal,
  layoutModalButtons,
  layoutShell,
  ContentScroller,
  pad,
  ensureMinTouch,
  statBarHeight,
  ToastManager,
  type ButtonDef,
  type ModalDef,
  type ThemeTokens,
  type UiContext,
} from '../ui/components';
import { ACCENT_TRACK } from '../ui/theme';
import {
  buildUi,
  drawBackground,
  onSceneEnter,
  onSceneResize,
  generateFreeAgents,
  spendStatPoint,
  xpToNextLevel,
} from './sceneUtils';

export class TeamManagementScene implements Scene {
  private toasts = new ToastManager();
  private modal: ModalDef = { open: false, title: '', body: '', buttons: [] };
  private freeAgents: Driver[] = [];
  private rerollCount = 0;
  private scroller = new ContentScroller();
  private detachWheel: (() => void) | null = null;

  enter(): void {
    onSceneEnter();
    const g = getGameContext();
    if (g.state !== null) {
      this.freeAgents = generateFreeAgents(g.state, this.rerollCount);
    }
    this.modal.open = false;
    this.scroller.scroll.offset = 0;
    this.detachWheel = this.scroller.attachWheel(g.canvas, () => !this.modal.open);
  }

  exit(): void {
    this.detachWheel?.();
    this.detachWheel = null;
  }

  onResize(w: number, h: number): void {
    onSceneResize(w, h);
  }

  handleBack(): boolean {
    if (this.modal.open) {
      this.modal.open = false;
      return true;
    }
    getGameContext().scenes.back();
    return true;
  }

  update(dt: number): void {
    this.toasts.update(dt);
  }

  private isTournamentLocked(driverId: string): boolean {
    const g = getGameContext();
    if (g.state === null) return false;
    for (const key of ['track', 'street', 'rally'] as const) {
      const t = g.state.inProgressTournaments[key];
      if (t !== null && t.playerLineup.includes(driverId)) return true;
    }
    return false;
  }

  private releaseDriver(driver: Driver): void {
    const g = getGameContext();
    if (g.state === null) return;
    if (this.isTournamentLocked(driver.id)) {
      this.toasts.push('Driver locked in a tournament', '#f87171');
      return;
    }
    if (g.state.roster.length <= 1) {
      this.toasts.push('Need at least one driver', '#f87171');
      return;
    }
    this.modal = {
      open: true,
      title: 'Release Driver?',
      body: `Release ${driver.name} from your roster?\nThis cannot be undone.`,
      buttons: [
        { x: 0, y: 0, w: 0, h: 0, label: 'Cancel', onClick: () => { this.modal.open = false; } },
        {
          x: 0,
          y: 0,
          w: 0,
          h: 0,
          label: 'Release',
          primary: true,
          onClick: () => {
            if (g.state === null) return;
            g.state.roster = g.state.roster.filter((d) => d.id !== driver.id);
            g.autosave();
            this.modal.open = false;
            this.toasts.push(`${driver.name} released`, '#f87171');
          },
        },
      ],
    };
  }

  private hireAgent(agent: Driver): void {
    const g = getGameContext();
    if (g.state === null) return;
    if (g.state.roster.length >= BALANCE.rosterCap) {
      this.toasts.push('Roster full', '#f87171');
      return;
    }
    const cost = hireCost(agent);
    if (g.state.cash < cost) {
      this.toasts.push('Not enough cash', '#f87171');
      return;
    }
    g.state.cash -= cost;
    g.state.roster.push({ ...agent });
    this.freeAgents = this.freeAgents.filter((a) => a.id !== agent.id);
    g.autosave();
    this.toasts.push(`${agent.name} hired`, '#4ade80');
  }

  private rerollAgents(): void {
    const g = getGameContext();
    if (g.state === null) return;
    if (g.state.cash < BALANCE.freeAgentRerollCost) {
      this.toasts.push('Not enough cash', '#f87171');
      return;
    }
    g.state.cash -= BALANCE.freeAgentRerollCost;
    this.rerollCount += 1;
    this.freeAgents = generateFreeAgents(g.state, this.rerollCount);
    g.autosave();
    this.toasts.push('Free agents refreshed', ACCENT_TRACK);
  }

  private driverCardH(driver: Driver, token: ThemeTokens, withRelease: boolean): number {
    const barH = statBarHeight(token);
    const stats = 4;
    let h =
      pad(token, 2) +
      token.fontTitle +
      token.fontCaption +
      pad(token) +
      barH +
      pad(token) +
      stats * (barH + pad(token, 0.5)) +
      pad(token);
    if (driver.unspentPoints > 0) h += token.fontCaption + pad(token, 0.5);
    if (withRelease) h += btnH(token) + pad(token);
    return h;
  }

  private agentBlockH(agent: Driver, token: ThemeTokens): number {
    return this.driverCardH(agent, token, false) + pad(token, 0.5) + btnH(token);
  }

  private drawDriverCard(
    ctx: CanvasRenderingContext2D,
    driver: Driver,
    x: number,
    y: number,
    w: number,
    ui: UiContext,
    onRelease?: () => void,
  ): number {
    const { token, accent } = ui;
    const trait = getTrait(driver.trait);
    const barH = statBarHeight(token);
    const plusSize = ensureMinTouch(pad(token, 4), token);
    const stats: DriverStatKey[] = ['skill', 'bravery', 'focus', 'determination'];
    const cardH = this.driverCardH(driver, token, onRelease !== undefined);
    const interactive = !this.modal.open;

    ctx.save();
    ctx.fillStyle = token.card;
    ctx.strokeStyle = token.cardStroke;
    ctx.beginPath();
    ctx.roundRect(x, y, w, cardH, pad(token, 0.75));
    ctx.fill();
    ctx.stroke();

    let cy = y + pad(token, 1.5);
    ctx.font = `700 ${token.fontTitle}px ${token.fontFamily}`;
    ctx.fillStyle = token.text;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(driver.name, x + pad(token, 1.5), cy);
    cy += token.fontTitle + pad(token, 0.25);

    ctx.font = `${token.fontCaption}px ${token.fontFamily}`;
    ctx.fillStyle = accent;
    ctx.fillText(`${trait.name} · Lv ${driver.level}`, x + pad(token, 1.5), cy);
    cy += token.fontCaption + pad(token, 0.5);

    if (driver.unspentPoints > 0) {
      ctx.fillStyle = token.success;
      ctx.font = `600 ${token.fontCaption}px ${token.fontFamily}`;
      ctx.fillText(`${driver.unspentPoints} pts to spend`, x + pad(token, 1.5), cy);
      cy += token.fontCaption + pad(token, 0.5);
    }

    const xpNeeded = xpToNextLevel(driver.level);
    drawStatBar(ctx, { x: x + pad(token, 1.5), y: cy, w: w - pad(token, 3), label: 'XP', value: (driver.xp / xpNeeded) * 100, color: token.textDim }, ui);
    cy += barH + pad(token, 0.75);

    for (const key of stats) {
      const statW = w - pad(token, 3) - (driver.unspentPoints > 0 ? plusSize + pad(token, 0.5) : 0);
      drawStatBar(ctx, { x: x + pad(token, 1.5), y: cy, w: statW, label: key.charAt(0).toUpperCase() + key.slice(1), value: driver[key] }, ui);
      if (driver.unspentPoints > 0) {
        const plusBtn: ButtonDef = {
          x: x + w - pad(token, 1.5) - plusSize,
          y: cy + (barH - plusSize) * 0.5,
          w: plusSize,
          h: plusSize,
          label: '+',
          primary: true,
          onClick: () => {
            const g = getGameContext();
            if (g.state === null) return;
            const d = g.state.roster.find((r) => r.id === driver.id);
            if (d !== undefined && spendStatPoint(d, key)) g.autosave();
          },
        };
        drawButton(ctx, plusBtn, ui);
        if (interactive) handleButton(plusBtn, ui);
      }
      cy += barH + pad(token, 0.5);
    }

    if (onRelease !== undefined) {
      const relBtn: ButtonDef = {
        x: x + pad(token, 1.5),
        y: cy,
        w: w - pad(token, 3),
        h: btnH(token),
        label: 'Release',
        onClick: onRelease,
      };
      drawButton(ctx, relBtn, ui);
      if (interactive) handleButton(relBtn, ui);
    }

    ctx.restore();
    return cardH;
  }

  private drawAgentCard(
    ctx: CanvasRenderingContext2D,
    agent: Driver,
    x: number,
    y: number,
    w: number,
    ui: UiContext,
    state: NonNullable<ReturnType<typeof getGameContext>['state']>,
  ): number {
    const token = ui.token;
    const innerH = this.drawDriverCard(ctx, agent, x, y, w, ui);
    const gap = pad(token, 0.5);
    const cost = hireCost(agent);
    const hireBtn: ButtonDef = {
      x,
      y: y + innerH + gap,
      w,
      h: btnH(token),
      label: `Hire $${cost}`,
      disabled: state.cash < cost || state.roster.length >= BALANCE.rosterCap,
      primary: state.cash >= cost && state.roster.length < BALANCE.rosterCap,
      onClick: () => this.hireAgent(agent),
    };
    drawButton(ctx, hireBtn, ui);
    if (!this.modal.open) handleButton(hireBtn, ui);
    return innerH + gap + btnH(token);
  }

  render(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const g = getGameContext();
    const state = g.state;
    if (state === null) return;

    const { ui, token } = buildUi(w, h, 0, ACCENT_TRACK);
    const shell = layoutShell(w, h, token);

    drawBackground(ctx, w, h, token);

    const header = {
      x: shell.headerRect.x,
      y: shell.headerRect.y,
      w: shell.headerRect.w,
      h: shell.headerRect.h,
      title: 'Team',
      back: true,
      cash: state.cash,
      onBack: () => this.handleBack(),
    };
    drawHeader(ctx, header, ui);

    const view = shell.contentRect;
    const gap = pad(token, 0.75);
    let contentH =
      token.fontCaption +
      pad(token, 1.5) +
      state.roster.reduce((sum, d) => sum + this.driverCardH(d, token, true) + gap, 0) +
      pad(token) +
      token.fontCaption +
      pad(token, 1.5) +
      this.freeAgents.reduce((sum, a) => sum + this.agentBlockH(a, token) + gap, 0) +
      btnH(token) +
      pad(token, 2);

    this.scroller.layout(view, contentH);
    this.scroller.update(ui, view);
    const lui = this.scroller.localUi(ui, view);

    this.scroller.begin(ctx, view);
    let y = 0;
    y += drawSectionTitle(
      ctx,
      0,
      y,
      `Roster (${state.roster.length}/${BALANCE.rosterCap})`,
      lui,
    );

    for (const driver of state.roster) {
      const cardH = this.drawDriverCard(ctx, driver, 0, y, view.w, lui, () => this.releaseDriver(driver));
      y += cardH + gap;
    }

    y += pad(token);
    y += drawSectionTitle(ctx, 0, y, 'Free Agents', lui);

    for (const agent of this.freeAgents) {
      const agentCardH = this.drawAgentCard(ctx, agent, 0, y, view.w, lui, state);
      y += agentCardH + gap;
    }

    const rerollBtn: ButtonDef = {
      x: 0,
      y,
      w: view.w,
      h: btnH(token),
      label: `Reroll Agents ($${BALANCE.freeAgentRerollCost})`,
      disabled: state.cash < BALANCE.freeAgentRerollCost,
      onClick: () => this.rerollAgents(),
    };
    drawButton(ctx, rerollBtn, lui);
    if (!this.modal.open) handleButton(rerollBtn, lui);
    this.scroller.end(ctx);

    handleHeader(header, ui);
    if (this.modal.open) layoutModalButtons(this.modal, ui);
    drawModal(ctx, this.modal, ui);
    handleModal(this.modal, ui);
    this.toasts.draw(ctx, ui);
  }
}

function btnH(token: ThemeTokens): number {
  return ensureMinTouch(pad(token, 5.5), token);
}
