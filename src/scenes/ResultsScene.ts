import type { Scene } from '../engine/SceneManager';
import { getGameContext } from '../engine/GameContext';
import { refillObjectives } from '../engine/SaveManager';
import { RANK_NAMES } from '../data/balance';
import type { ResultsPayload } from '../career/resultsPayload';
import type { DriverStatKey } from '../ui/components';
import {
  drawHeader,
  handleHeader,
  drawRow,
  drawSectionTitle,
  drawButton,
  handleButton,
  drawDriverSpendPanel,
  handleDriverSpendPanel,
  drawUpgradePanel,
  handleUpgradePanel,
  driverSpendPanelHeight,
  upgradePanelHeight,
  layoutShell,
  ContentScroller,
  drawFooterActions,
  handleFooterActions,
  fmtCash,
  pad,
  ensureMinTouch,
  ToastManager,
  truncateText,
  type ButtonDef,
  type UiContext,
} from '../ui/components';
import {
  buildUi,
  drawBackground,
  onSceneEnter,
  onSceneResize,
} from './sceneChrome';
import { disciplineAccent } from '../career/disciplinesUi';
import { buyPartWithDelta, driverSpendData, repairVehicle } from '../career/garage';
import { grantXp, spendStatPoint } from '../career/xp';
import { findDriver } from '../career/roster';
import { launchRace, makeQuickRaceConfig, makeTimeTrialConfig } from '../career/launchRace';
import { CampaignScene } from './CampaignScene';

export class ResultsScene implements Scene {
  readonly raceLaunchReplace = true;
  private readonly payload: ResultsPayload;
  private readonly tournamentMode: boolean;
  private toasts = new ToastManager();
  private upgradeCollapsed = false;
  private selectedDriverIdx = 0;
  private applied = false;
  private scroller = new ContentScroller();
  private detachWheel: (() => void) | null = null;

  constructor(payload: ResultsPayload) {
    this.payload = payload;
    this.tournamentMode = payload.config.mode === 'tournament';
  }

  enter(): void {
    onSceneEnter();
    this.applied = false;
    this.scroller.scroll.offset = 0;
    this.detachWheel = this.scroller.attachWheel(getGameContext().canvas);
    this.applyResults();
    this.showUnlockToasts();
  }

  exit(): void {
    this.detachWheel?.();
    this.detachWheel = null;
  }

  onResize(w: number, h: number): void {
    onSceneResize(w, h);
  }

  handleBack(): boolean {
    this.navigateBack();
    return true;
  }

  private applyResults(): void {
    if (this.applied) return;
    const g = getGameContext();
    const state = g.state;
    if (state === null) return;

    state.cash += this.payload.payout.total;
    state.careerStats.races += 1;
    if (this.payload.playerPosition === 1) state.careerStats.wins += 1;
    state.careerStats.earnings += this.payload.payout.total;

    for (const grant of this.payload.driverXp) {
      const driver = findDriver(state, grant.driverId);
      if (driver === undefined) continue;
      // grantXp preserves XP past a level-up and applies every level crossed.
      grantXp(driver, grant.xpEarned);
    }

    for (const obj of this.payload.objectivesCompleted) {
      if (!state.objectives.completed.includes(obj)) {
        state.objectives.completed.push(obj);
      }
      state.objectives.active = state.objectives.active.filter((a) => a !== obj);
    }
    refillObjectives(state);

    if (this.payload.rankUnlocked !== undefined) {
      const next = this.payload.rankUnlocked;
      if (state.rankUnlocked[this.payload.discipline] < next) {
        state.rankUnlocked[this.payload.discipline] = next;
      }
    }

    if (this.tournamentMode && this.payload.config.tournamentDefId !== undefined) {
      const progress = state.inProgressTournaments[this.payload.discipline];
      if (progress !== null) {
        if (this.payload.tournamentComplete) {
          state.inProgressTournaments[this.payload.discipline] = null;
        } else if (this.payload.tournamentRaceIndex !== undefined) {
          progress.raceIndex = this.payload.tournamentRaceIndex + 1;
        }
      }
    }

    g.autosave();
    this.applied = true;
  }

  private showUnlockToasts(): void {
    const accent = disciplineAccent(this.payload.discipline);
    const state = getGameContext().state;
    for (const grant of this.payload.driverXp) {
      if (grant.leveledUp) {
        const driver = findDriver(state!, grant.driverId);
        this.toasts.push(`${driver?.name ?? 'Driver'} reached Lv ${grant.newLevel}!`, accent, 3.5);
      }
    }
    if (this.payload.rankUnlocked !== undefined) {
      this.toasts.push(
        `${RANK_NAMES[this.payload.rankUnlocked]} rank unlocked!`,
        accent,
        3.5,
      );
    }
    if (state !== null && !state.onboarding.shownAuthorityHint) {
      const lead = findDriver(state, this.payload.config.leadDriverId);
      if ((lead?.skill ?? 0) >= 55) {
        this.toasts.push(
          'Higher skill helps hold full gas through bends',
          accent,
          4.5,
        );
        state.onboarding.shownAuthorityHint = true;
        getGameContext().autosave();
      }
    }
  }

  update(dt: number): void {
    this.toasts.update(dt);
  }

  private navigateBack(): void {
    const g = getGameContext();
    if (this.payload.config.returnTo === 'title' || this.payload.config.mode === 'quick') {
      void import('./TitleScene').then((mod) => {
        g.scenes.replace(new mod.TitleScene());
      });
      return;
    }
    g.scenes.replace(new CampaignScene(this.payload.discipline));
  }

  private raceAgain(): void {
    const config = {
      ...this.payload.config,
      again: true,
      raceSeed: (this.payload.config.raceSeed + 1) >>> 0,
    };
    launchRace(config, this.toasts);
  }

  private nextRace(): void {
    if (this.payload.nextRaceConfig !== undefined) {
      launchRace(this.payload.nextRaceConfig, this.toasts);
      return;
    }
    const g = getGameContext();
    if (g.state !== null) {
      if (this.payload.config.session === 'timeTrial') {
        launchRace(
          makeTimeTrialConfig(g.state, this.payload.discipline, this.payload.config.returnTo ?? 'title'),
          this.toasts,
        );
        return;
      }
      if (this.payload.config.mode === 'quick') {
        launchRace(
          makeQuickRaceConfig(
            g.state,
            this.payload.discipline,
            this.payload.config.returnTo ?? 'title',
            this.payload.config.quickPresetId ?? 'garage',
          ),
          this.toasts,
        );
        return;
      }
    }
    this.navigateBack();
  }

  private measureDoneContentH(
    ui: UiContext,
    state: NonNullable<ReturnType<typeof getGameContext>['state']>,
  ): number {
    const { token } = ui;
    let h = this.podiumH(token) + pad(token, 1.25);
    if (this.tournamentMode) {
      h += token.fontCaption + pad(token, 1.25);
      h += this.payload.standings.length * pad(token, 4) + pad(token, 1.25);
    }
    h += this.payoutBlockH(token);
    h += pad(token, 0.75);
    h += token.fontCaption + pad(token, 0.75);
    h += this.xpBlockH(ui, state);
    h += pad(token, 1.5);
    return h;
  }

  private playerFinisher() {
    return this.payload.finishers.find((f) => f.isPlayer);
  }

  /**
   * Podium block: a left-aligned player-result header (big P-place + name +
   * status), three pedestals with names, then a bonus caption strip. The
   * height formula below is the single source both measure and draw use.
   */
  private podiumH(token: UiContext['token']): number {
    const placeH = token.fontDisplay * 1.35;
    const headerH = pad(token) + placeH + pad(token, 0.5) + token.fontCaption + pad(token, 1);
    const barsH = pad(token, 11);
    const bonusH = token.fontCaption + pad(token, 1);
    return headerH + barsH + bonusH;
  }

  private payoutBlockH(token: UiContext['token']): number {
    const p = this.payload.payout;
    const lines = [p.base, p.placement, p.objective, p.handsOff, p.entertainment, p.tournament].filter(
      (v) => v > 0,
    ).length;
    const rowH = token.fontBody * 1.55;
    return (
      token.fontCaption +
      pad(token, 1.25) +
      lines * rowH +
      token.fontTitle +
      pad(token, 1) +
      pad(token, 1.25)
    );
  }

  private xpBlockH(
    ui: UiContext,
    state: NonNullable<ReturnType<typeof getGameContext>['state']>,
  ): number {
    const grants = this.payload.driverXp;
    if (grants.length === 0) return 0;
    const grant = grants[this.selectedDriverIdx % grants.length];
    if (grant === undefined) return 0;
    const driver = findDriver(state, grant.driverId);
    if (driver === undefined) return 0;
    const navH =
      grants.length > 1
        ? ensureMinTouch(pad(ui.token, 4.5), ui.token) + pad(ui.token, 0.75)
        : 0;
    const spendH = driverSpendPanelHeight(
      { x: 0, y: 0, w: 100, driver: driverSpendData(driver) },
      ui.token,
    );
    const vehicle = state.vehicles[this.payload.discipline];
    const upgradeH = upgradePanelHeight(
      {
        x: 0,
        y: 0,
        w: 100,
        partTiers: vehicle.partTiers,
        condition: vehicle.condition,
        cash: state.cash,
        collapsed: this.upgradeCollapsed,
      },
      ui.token,
    );
    return navH + spendH + pad(ui.token, 1.5) + upgradeH;
  }

  render(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const g = getGameContext();
    const state = g.state;
    if (state === null) return;

    const accent = disciplineAccent(this.payload.discipline);
    const { ui, token } = buildUi(w, h, 0, accent);
    const shell = layoutShell(w, h, token, { footer: true });

    drawBackground(ctx, w, h, token);

    const header = {
      x: shell.headerRect.x,
      y: shell.headerRect.y,
      w: shell.headerRect.w,
      h: shell.headerRect.h,
      title: this.tournamentMode ? 'Tournament Results' : 'Race Results',
      back: true,
      cash: state.cash,
      onBack: () => this.handleBack(),
    };
    drawHeader(ctx, header, ui);

    const view = shell.contentRect;
    const contentH = this.measureDoneContentH(ui, state);
    this.scroller.layout(view, contentH);
    this.scroller.update(ui, view);
    const lui = this.scroller.localUi(ui, view);

    this.scroller.begin(ctx, view);
    let y = 0;
    y += this.drawPodium(ctx, 0, y, view.w, lui) + pad(token, 1.25);
    if (this.tournamentMode) {
      y = this.drawStandings(ctx, 0, y, view.w, lui);
    }
    y = this.drawPayout(ctx, 0, y, view.w, lui);
    y += pad(token, 0.75);
    y += drawSectionTitle(ctx, 0, y, 'Invest', lui);
    y += pad(token, 0.25);
    y = this.drawXpSection(ctx, 0, y, view.w, lui, state);
    this.scroller.end(ctx);

    const hasSeriesNext = this.payload.nextRaceConfig !== undefined;
    const isQuick = this.payload.config.mode === 'quick';
    const showNext = hasSeriesNext || isQuick;
    const footerBtns: ButtonDef[] = [];
    // Race Again is Quick-only: replaying a tournament race would double-advance
    // the series (applyResults already bumped raceIndex before the button shows).
    if (isQuick) {
      footerBtns.push({
        x: 0,
        y: 0,
        w: 0,
        h: 0,
        label: 'Race Again',
        onClick: () => this.raceAgain(),
      });
    }
    if (showNext) {
      footerBtns.push({
        x: 0,
        y: 0,
        w: 0,
        h: 0,
        label: 'Next Race',
        primary: true,
        onClick: () => this.nextRace(),
      });
    }
    footerBtns.push({
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      label: 'Back',
      primary: !showNext,
      onClick: () => this.navigateBack(),
    });

    if (shell.footerRect !== null) {
      drawFooterActions(ctx, shell.footerRect, footerBtns, ui);
      handleFooterActions(footerBtns, ui);
    }

    handleHeader(header, ui);
    // Level-up/rank toasts must not sit on the footer CTAs.
    this.toasts.draw(ctx, ui, { avoidBottomPx: shell.footerRect?.h ?? 0 });
  }

  private drawPodium(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    ui: UiContext,
  ): number {
    const { token, accent } = ui;
    const top3 = [...this.payload.finishers].sort((a, b) => a.position - b.position).slice(0, 3);
    const h = this.podiumH(token);
    const placeH = token.fontDisplay * 1.35;
    const barsTop = y + pad(token) + placeH + pad(token, 0.5) + token.fontCaption + pad(token, 1);
    const barsBottom = barsTop + pad(token, 11) - pad(token, 0.5);
    const place = this.payload.playerPosition;
    const won = place === 1;
    const player = this.playerFinisher();

    ctx.save();

    // ── Player result header ────────────────────────────────────────────
    const placeSize = won ? token.fontDisplay * 1.35 : token.fontDisplay * 1.15;
    const placeStr = `P${place}`;
    ctx.font = `800 ${placeSize}px ${token.fontDisplayFamily}`;
    ctx.fillStyle = won ? accent : token.text;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const placeY = y + pad(token) + placeH * 0.82;
    ctx.fillText(placeStr, x + pad(token, 1.5), placeY);
    const nameX = x + pad(token, 1.5) + ctx.measureText(placeStr).width + pad(token, 1);

    ctx.font = `700 ${token.fontTitle}px ${token.fontDisplayFamily}`;
    ctx.fillStyle = token.text;
    ctx.fillText(
      truncateText(ctx, player?.name ?? 'You', w - (nameX - x) - pad(token, 2)),
      nameX,
      y + pad(token) + placeH * 0.62,
    );

    // Status line: WINNER / time for a win; blank otherwise (P-place says it).
    if (won) {
      ctx.font = `700 ${token.fontCaption}px ${token.fontDisplayFamily}`;
      ctx.fillStyle = accent;
      const isTT = this.payload.config.session === 'timeTrial';
      const t = player?.finishTime;
      let status = 'WINNER';
      if (isTT && t !== undefined) {
        const m = Math.floor(t / 60);
        const s = (t % 60).toFixed(1);
        status = `WINNER · TIME ${m > 0 ? `${m}:` : ''}${s.padStart(m > 0 ? 2 : 1, '0')}s`;
      }
      ctx.fillText(status, nameX, y + pad(token) + placeH * 0.62 + token.fontCaption + pad(token, 0.35));
    }

    // ── Pedestals ────────────────────────────────────────────────────────
    const positions = [1, 0, 2];
    const podiumW = w / 3;
    for (let i = 0; i < 3; i++) {
      const finisher = top3[positions[i]!];
      if (finisher === undefined) continue;
      const px = x + i * podiumW + podiumW * 0.5;
      const isFirst = positions[i] === 0;
      const barH = pad(token, 3.5 + (isFirst ? 4.5 : positions[i] === 1 ? 2 : 0));
      const barW = podiumW * (isFirst ? 0.52 : 0.44);
      // Pedestal first — text never gets tinted by translucent fills.
      ctx.fillStyle = finisher.isPlayer ? accent : isFirst ? `${accent}55` : token.bgElevated;
      ctx.fillRect(px - barW * 0.5, barsBottom - barH, barW, barH);
      ctx.font = `700 ${token.fontCaption}px ${token.fontDisplayFamily}`;
      ctx.fillStyle = finisher.isPlayer || isFirst ? token.bg : token.textMuted;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String((positions[i] ?? 0) + 1), px, barsBottom - barH * 0.5);
      // Name above the bar, truncated to its column.
      ctx.font = `600 ${token.fontCaption}px ${token.fontFamily}`;
      ctx.fillStyle = isFirst ? token.text : token.textMuted;
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(
        truncateText(ctx, finisher.name.split(' ')[0] ?? finisher.name, podiumW * 0.9),
        px,
        barsBottom - barH - pad(token, 0.6),
      );
    }

    // ── Bonus caption strip ─────────────────────────────────────────────
    const bonusY = barsBottom + pad(token, 0.9);
    ctx.font = `${token.fontCaption}px ${token.fontFamily}`;
    ctx.textAlign = 'center';
    if (this.payload.handsOffBonus > 0) {
      ctx.fillStyle = token.success;
      ctx.fillText(
        `Hands-off bonus: +${fmtCash(this.payload.handsOffBonus)} (${Math.round(this.payload.handsOffRatio * 100)}% idle)`,
        x + w * 0.5,
        bonusY,
      );
    } else if (this.payload.entertainmentBonus > 0) {
      ctx.fillStyle = token.success;
      ctx.fillText(`Crowd bonus: +${fmtCash(this.payload.entertainmentBonus)}`, x + w * 0.5, bonusY);
    }
    ctx.restore();
    return h;
  }

  private drawStandings(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    ui: UiContext,
  ): number {
    const { token } = ui;
    y += drawSectionTitle(ctx, x, y, 'Championship Standings', ui);
    const sorted = [...this.payload.standings].sort((a, b) => b.points - a.points);
    const rowH = pad(token, 4);
    for (let i = 0; i < sorted.length; i++) {
      const entry = sorted[i]!;
      const isPlayer = entry.teamId === 0;
      drawRow(ctx, { x, y, w, h: rowH }, ui, { hovered: isPlayer });
      ctx.save();
      ctx.font = `700 ${token.fontCaption}px ${token.fontDisplayFamily}`;
      ctx.fillStyle = isPlayer ? ui.accent : token.textMuted;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${i + 1}`, x + pad(token, 1), y + rowH * 0.5);
      ctx.font = `700 ${token.fontCaption}px ${token.fontDisplayFamily}`;
      const pts = `${entry.points} pts`;
      const ptsW = ctx.measureText(pts).width;
      ctx.font = `600 ${token.fontBody}px ${token.fontFamily}`;
      ctx.fillStyle = isPlayer ? ui.accent : token.text;
      ctx.fillText(
        truncateText(ctx, entry.name, w - pad(token, 5) - ptsW - pad(token, 1)),
        x + pad(token, 4),
        y + rowH * 0.5,
      );
      ctx.textAlign = 'right';
      ctx.fillText(`${entry.points} pts`, x + w - pad(token, 1), y + rowH * 0.5);
      ctx.restore();
      y += rowH;
    }
    return y + pad(token, 1.25);
  }

  private drawPayout(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    ui: UiContext,
  ): number {
    const { token } = ui;
    const p = this.payload.payout;
    const lines: { label: string; value: number }[] = [
      { label: 'Base', value: p.base },
      { label: 'Placement', value: p.placement },
      { label: 'Objectives', value: p.objective },
      { label: 'Hands-off', value: p.handsOff },
      { label: 'Crowd', value: p.entertainment },
      { label: 'Tournament', value: p.tournament },
    ].filter((row) => row.value > 0);

    y += drawSectionTitle(ctx, x, y, 'Payout', ui);
    const rowH = token.fontBody * 1.55;
    for (const row of lines) {
      drawRow(ctx, { x, y, w, h: rowH }, ui);
      ctx.save();
      ctx.font = `500 ${token.fontBody}px ${token.fontFamily}`;
      ctx.fillStyle = token.textMuted;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(row.label, x + pad(token, 1), y + rowH * 0.5);
      ctx.textAlign = 'right';
      ctx.fillStyle = ui.accent;
      ctx.fillText(fmtCash(row.value), x + w - pad(token, 1), y + rowH * 0.5);
      ctx.restore();
      y += rowH;
    }
    const totalH = token.fontTitle + pad(token, 1);
    ctx.save();
    ctx.font = `700 ${token.fontTitle}px ${token.fontDisplayFamily}`;
    ctx.fillStyle = token.text;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('Total', x + pad(token, 1), y + totalH * 0.5);
    ctx.textAlign = 'right';
    ctx.fillStyle = token.success;
    ctx.fillText(fmtCash(p.total), x + w - pad(token, 1), y + totalH * 0.5);
    ctx.restore();
    return y + totalH + pad(token, 1.25);
  }

  private drawXpSection(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    ui: UiContext,
    state: NonNullable<ReturnType<typeof getGameContext>['state']>,
  ): number {
    const grants = this.payload.driverXp;
    if (grants.length === 0) return y;
    const grant = grants[this.selectedDriverIdx % grants.length];
    if (grant === undefined) return y;
    const driver = findDriver(state, grant.driverId);
    if (driver === undefined) return y;

    const { token } = ui;
    if (grants.length > 1) {
      // Compact centered pager — arrows hug the counter instead of the edges.
      const navH = ensureMinTouch(pad(token, 4.5), token);
      const navW = navH; // square arrows — full touch target both axes
      const pagerW = Math.min(w, navW * 2 + pad(token, 8));
      const pagerX = x + (w - pagerW) * 0.5;
      const prevBtn: ButtonDef = {
        x: pagerX,
        y,
        w: navW,
        h: navH,
        label: '‹',
        onClick: () => {
          this.selectedDriverIdx =
            (this.selectedDriverIdx - 1 + grants.length) % grants.length;
        },
      };
      const nextBtn: ButtonDef = {
        x: pagerX + pagerW - navW,
        y,
        w: navW,
        h: navH,
        label: '›',
        onClick: () => {
          this.selectedDriverIdx = (this.selectedDriverIdx + 1) % grants.length;
        },
      };
      ctx.save();
      ctx.font = `600 ${token.fontCaption}px ${token.fontFamily}`;
      ctx.fillStyle = token.textMuted;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        `${this.selectedDriverIdx + 1} / ${grants.length}`,
        pagerX + pagerW * 0.5,
        y + navH * 0.5,
      );
      ctx.restore();
      drawButton(ctx, prevBtn, ui);
      drawButton(ctx, nextBtn, ui);
      handleButton(prevBtn, ui);
      handleButton(nextBtn, ui);
      y += navH + pad(token, 0.75);
    }

    const spendPanel = {
      x,
      y,
      w,
      driver: driverSpendData(driver),
      onSpend: (stat: DriverStatKey) => {
        if (spendStatPoint(driver, stat)) getGameContext().autosave();
      },
    };
    drawDriverSpendPanel(ctx, spendPanel, ui);
    handleDriverSpendPanel(spendPanel, ui);
    y += driverSpendPanelHeight(spendPanel, ui.token) + pad(ui.token, 1.5);

    const vehicle = state.vehicles[this.payload.discipline];
    const upgradePanel = {
      x,
      y,
      w,
      partTiers: vehicle.partTiers,
      condition: vehicle.condition,
      cash: state.cash,
      collapsed: this.upgradeCollapsed,
      onToggleCollapse: () => {
        this.upgradeCollapsed = !this.upgradeCollapsed;
      },
      onBuy: (part: import('../data/parts').PartCategory) => {
        const result = buyPartWithDelta(state, this.payload.discipline, part);
        if (result.bought) {
          this.toasts.push(result.summary, disciplineAccent(this.payload.discipline), 3);
          getGameContext().autosave();
        }
      },
      onRepair: () => {
        if (repairVehicle(state, this.payload.discipline)) getGameContext().autosave();
      },
    };
    drawUpgradePanel(ctx, upgradePanel, ui);
    handleUpgradePanel(upgradePanel, ui);
    return y + upgradePanelHeight(upgradePanel, ui.token);
  }
}

export function createResultsScene(payload: ResultsPayload): ResultsScene {
  return new ResultsScene(payload);
}
