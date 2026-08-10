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
  headerHeight,
  pad,
  ensureMinTouch,
  statBarHeight,
  ToastManager,
  type ButtonDef,
  type ModalDef,
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

  enter(): void {
    onSceneEnter();
    const g = getGameContext();
    if (g.state !== null) {
      this.freeAgents = generateFreeAgents(g.state, this.rerollCount);
    }
    this.modal.open = false;
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

  private drawDriverCard(
    ctx: CanvasRenderingContext2D,
    driver: Driver,
    x: number,
    y: number,
    w: number,
    ui: ReturnType<typeof buildUi>['ui'],
    onRelease?: () => void,
  ): number {
    const { token, accent } = ui;
    const trait = getTrait(driver.trait);
    const barH = statBarHeight(token);
    const plusSize = ensureMinTouch(pad(token, 4), token);
    const stats: DriverStatKey[] = ['skill', 'bravery', 'focus', 'determination'];
    const cardH =
      pad(token, 2) +
      token.fontTitle +
      token.fontCaption +
      pad(token) +
      barH +
      pad(token) +
      stats.length * (barH + pad(token, 0.5)) +
      (onRelease !== undefined ? btnH(token) + pad(token) : 0) +
      pad(token);

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
        handleButton(plusBtn, ui);
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
      handleButton(relBtn, ui);
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
    ui: ReturnType<typeof buildUi>['ui'],
    state: NonNullable<ReturnType<typeof getGameContext>['state']>,
  ): number {
    const innerH = this.drawDriverCard(ctx, agent, x, y, w, ui);
    const cost = hireCost(agent);
    const hireBtn: ButtonDef = {
      x: x + w - pad(ui.token, 1.5) - pad(ui.token, 10),
      y: y + innerH - pad(ui.token, 1) - btnH(ui.token),
      w: pad(ui.token, 10),
      h: btnH(ui.token),
      label: `Hire $${cost}`,
      disabled: state.cash < cost || state.roster.length >= BALANCE.rosterCap,
      primary: state.cash >= cost && state.roster.length < BALANCE.rosterCap,
      onClick: () => this.hireAgent(agent),
    };
    drawButton(ctx, hireBtn, ui);
    handleButton(hireBtn, ui);
    return innerH;
  }

  render(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const g = getGameContext();
    const state = g.state;
    if (state === null) return;

    const { ui, token } = buildUi(w, h, 0, ACCENT_TRACK);
    drawBackground(ctx, w, h, token);

    const hh = headerHeight(token);
    const header = {
      x: 0,
      y: 0,
      w,
      h: hh + token.safe.top,
      title: 'Team',
      back: true,
      cash: state.cash,
      onBack: () => g.scenes.back(),
    };
    drawHeader(ctx, header, ui);

    const contentX = pad(token, 2) + token.safe.left;
    const contentW = w - pad(token, 4) - token.safe.left - token.safe.right;
    let y = hh + token.safe.top + pad(token);

    y += drawSectionTitle(
      ctx,
      contentX,
      y,
      `Roster (${state.roster.length}/${BALANCE.rosterCap})`,
      ui,
    );

    for (const driver of state.roster) {
      const cardH = this.drawDriverCard(ctx, driver, contentX, y, contentW, ui, () => this.releaseDriver(driver));
      y += cardH + pad(token, 0.75);
    }

    y += pad(token);
    y += drawSectionTitle(ctx, contentX, y, 'Free Agents', ui);

    for (const agent of this.freeAgents) {
      const agentCardH = this.drawAgentCard(ctx, agent, contentX, y, contentW, ui, state);
      y += agentCardH + pad(token, 0.75);
    }

    const rerollBtn: ButtonDef = {
      x: contentX,
      y: y,
      w: contentW,
      h: btnH(token),
      label: `Reroll Agents ($${BALANCE.freeAgentRerollCost})`,
      disabled: state.cash < BALANCE.freeAgentRerollCost,
      onClick: () => this.rerollAgents(),
    };
    drawButton(ctx, rerollBtn, ui);
    handleButton(rerollBtn, ui);

    handleHeader(header, ui);
    if (this.modal.open) layoutModalButtons(this.modal, ui);
    drawModal(ctx, this.modal, ui);
    handleModal(this.modal, ui);
    this.toasts.draw(ctx, ui);
  }
}

function btnH(token: ReturnType<typeof buildUi>['token']): number {
  return ensureMinTouch(pad(token, 5.5), token);
}
