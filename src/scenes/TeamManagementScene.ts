import type { Scene } from '../engine/SceneManager';
import { getGameContext } from '../engine/GameContext';
import { BALANCE } from '../data/balance';
import { hireCost } from '../engine/DriverGenerator';
import type { Driver } from '../engine/types';
import type { DriverStatKey } from '../ui/components';
import {
  drawButton,
  handleButton,
  drawHeader,
  handleHeader,
  drawSectionTitle,
  drawModal,
  handleModal,
  layoutModalButtons,
  layoutShell,
  ContentScroller,
  TooltipManager,
  drawDriverSpendPanel,
  handleDriverSpendPanel,
  driverSpendPanelHeight,
  pad,
  ensureMinTouch,
  fmtCash,
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
} from './sceneChrome';
import { generateFreeAgents } from '../career/roster';
import { driverSpendData } from '../career/garage';
import { spendStatPoint } from '../career/xp';

interface PanelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface PanelInfo {
  title: string;
  body: string;
}

export class TeamManagementScene implements Scene {
  private toasts = new ToastManager();
  private tooltips = new TooltipManager();
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
    this.scroller.onUserScroll = () => this.tooltips.close();
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
          danger: true,
          onClick: () => {
            if (g.state === null) return;
            g.state.roster = g.state.roster.filter((d) => d.id !== driver.id);
            g.autosave();
            this.modal.open = false;
            this.tooltips.close();
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
    this.tooltips.close();
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
    this.tooltips.close();
    this.toasts.push('Free agents refreshed', ACCENT_TRACK);
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
    const rerollBtnH = Math.max(ensureMinTouch(pad(token, 5.5), token), pad(token, 6));
    const interactive = !this.modal.open;

    // Hotspots are registered in scroller-local space; tooltips draw in screen space.
    const tooltipOrigin = { x: view.x, y: view.y - this.scroller.scroll.offset };
    const registerInfo = (rect: PanelRect, info: PanelInfo): void => {
      this.tooltips.register(rect, info, tooltipOrigin);
    };

    // Panel definitions are built once and reused by measure + draw + handle,
    // so the three can never drift apart again.
    const rosterDefs = state.roster.map((driver) => ({
      x: 0,
      y: 0,
      w: view.w,
      driver: driverSpendData(driver),
      onSpend: (stat: DriverStatKey) => {
        const d = state.roster.find((r) => r.id === driver.id);
        if (d !== undefined && spendStatPoint(d, stat)) g.autosave();
      },
      actions: [
        { label: 'Release', danger: true, onClick: () => this.releaseDriver(driver) },
      ],
      registerInfo,
    }));
    const agentDefs = this.freeAgents.map((agent) => {
      const cost = hireCost(agent);
      const full = state.roster.length >= BALANCE.rosterCap;
      return {
        x: 0,
        y: 0,
        w: view.w,
        driver: driverSpendData(agent),
        actions: [
          {
            label: `Hire ${fmtCash(cost)}`,
            disabled: full || state.cash < cost,
            onClick: () => this.hireAgent(agent),
          },
        ],
        registerInfo,
      };
    });

    // Content height — mirrors the draw chain below exactly.
    const contentH =
      token.fontCaption + pad(token, 1.5) +
      rosterDefs.reduce((sum, def) => sum + driverSpendPanelHeight(def, token) + gap, 0) +
      pad(token) +
      token.fontCaption + pad(token, 1.5) +
      agentDefs.reduce((sum, def) => sum + driverSpendPanelHeight(def, token) + gap, 0) +
      rerollBtnH +
      pad(token, 2);

    this.scroller.layout(view, contentH);
    this.scroller.update(ui, view);
    const lui = this.scroller.localUi(ui, view);
    this.tooltips.beginFrame();

    this.scroller.begin(ctx, view);
    let y = 0;

    // ══════════════════════════════════════════
    // ROSTER
    // ══════════════════════════════════════════
    y += drawSectionTitle(
      ctx,
      0,
      y,
      `Roster (${state.roster.length}/${BALANCE.rosterCap})`,
      lui,
    );

    for (const def of rosterDefs) {
      def.y = y;
      drawDriverSpendPanel(ctx, def, lui);
      if (interactive) handleDriverSpendPanel(def, lui);
      y += driverSpendPanelHeight(def, token) + gap;
    }

    // ══════════════════════════════════════════
    // FREE AGENTS
    // ══════════════════════════════════════════
    y += pad(token);
    y += drawSectionTitle(ctx, 0, y, 'Free Agents', lui);

    for (const def of agentDefs) {
      def.y = y;
      drawDriverSpendPanel(ctx, def, lui);
      if (interactive) handleDriverSpendPanel(def, lui);
      y += driverSpendPanelHeight(def, token) + gap;
    }

    // Single refresh entry point — labelled as what it actually does.
    const rerollBtn: ButtonDef = {
      x: 0,
      y,
      w: view.w,
      h: rerollBtnH,
      label: `Refresh Agents (${fmtCash(BALANCE.freeAgentRerollCost)})`,
      disabled: state.cash < BALANCE.freeAgentRerollCost,
      onClick: () => this.rerollAgents(),
    };
    drawButton(ctx, rerollBtn, lui);
    if (interactive) handleButton(rerollBtn, lui);

    this.scroller.end(ctx);

    this.tooltips.handle(lui, interactive && !this.scroller.isScrolling);
    this.tooltips.draw(ctx, ui);

    handleHeader(header, ui);
    if (this.modal.open) layoutModalButtons(this.modal, ui);
    drawModal(ctx, this.modal, ui);
    handleModal(this.modal, ui);
    this.toasts.draw(ctx, ui);
  }
}
