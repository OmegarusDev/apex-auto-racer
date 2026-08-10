import type { Scene } from '../engine/SceneManager';
import { getGameContext } from '../engine/GameContext';
import { refillObjectives } from '../engine/SaveManager';
import { RANK_NAMES } from '../data/balance';
import type { ResultsPayload } from '../engine/raceTypes';
import { effectiveStats } from '../engine/stats';
import type { DriverStatKey } from '../ui/components';
import {
  drawButton,
  handleButton,
  drawHeader,
  handleHeader,
  drawRow,
  drawSectionTitle,
  drawDriverSpendPanel,
  handleDriverSpendPanel,
  drawUpgradePanel,
  handleUpgradePanel,
  driverSpendPanelHeight,
  upgradePanelHeight,
  headerHeight,
  pad,
  ensureMinTouch,
  ToastManager,
  type ButtonDef,
} from '../ui/components';
import {
  buildUi,
  drawBackground,
  onSceneEnter,
  onSceneResize,
  disciplineAccent,
  driverSpendData,
  spendStatPoint,
  buyPartTier,
  repairVehicle,
  launchRace,
  findDriver,
  makeQuickRaceConfig,
} from './sceneUtils';
import { CampaignScene } from './CampaignScene';

type ResultsPhase = 'podium' | 'standings' | 'payout' | 'xp' | 'done';

export class ResultsScene implements Scene {
  readonly raceLaunchReplace = true;
  private readonly payload: ResultsPayload;
  private readonly tournamentMode: boolean;
  private phase: ResultsPhase = 'podium';
  private phaseT = 0;
  private readonly phaseDuration = 1.2;
  private toasts = new ToastManager();
  private upgradeCollapsed = false;
  private selectedDriverIdx = 0;
  private applied = false;

  constructor(payload: ResultsPayload, tournamentMode = false) {
    this.payload = payload;
    this.tournamentMode = tournamentMode || payload.config.mode === 'tournament';
  }

  enter(): void {
    onSceneEnter();
    this.phase = 'podium';
    this.phaseT = 0;
    this.applied = false;
    this.applyResults();
    this.showUnlockToasts();
  }

  exit(): void {}

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
      if (grant.leveledUp) {
        driver.level = grant.newLevel ?? driver.level;
        driver.unspentPoints += 1;
        driver.xp = 0;
      } else {
        driver.xp += grant.xpEarned;
      }
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
          'Skill trims pin-throttle — lift less; trust Authority in bends',
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
    this.phaseT += dt;
    const g = getGameContext();
    if (g.input.consumeClick() !== null && this.phase !== 'done') {
      this.advancePhase();
    } else if (this.phaseT >= this.phaseDuration && this.phase !== 'done') {
      this.advancePhase();
    }
  }

  private advancePhase(): void {
    const order: ResultsPhase[] = ['podium', 'standings', 'payout', 'xp', 'done'];
    const idx = order.indexOf(this.phase);
    if (idx < order.length - 1) {
      this.phase = order[idx + 1]!;
      this.phaseT = 0;
    } else {
      this.phase = 'done';
    }
  }

  private navigateBack(): void {
    const g = getGameContext();
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
    if (g.state !== null && this.payload.config.mode === 'quick') {
      launchRace(makeQuickRaceConfig(g.state, this.payload.discipline), this.toasts);
      return;
    }
    this.navigateBack();
  }

  render(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const g = getGameContext();
    const state = g.state;
    if (state === null) return;

    const accent = disciplineAccent(this.payload.discipline);
    const { ui, token } = buildUi(w, h, 0, accent);
    drawBackground(ctx, w, h, token);

    const hh = headerHeight(token);
    const header = {
      x: 0,
      y: 0,
      w,
      h: hh + token.safe.top,
      title: this.tournamentMode ? 'Tournament Results' : 'Race Results',
      back: this.phase === 'done',
      cash: state.cash,
      onBack: () => this.navigateBack(),
    };
    drawHeader(ctx, header, ui);

    const contentX = pad(token, 2) + token.safe.left;
    const contentW = w - pad(token, 4) - token.safe.left - token.safe.right;
    let y = hh + token.safe.top + pad(token);

    if (this.phase === 'podium' || this.phase === 'done') {
      y += this.drawPodium(ctx, contentX, y, contentW, ui) + pad(token, 1.5);
    }

    if ((this.phase === 'standings' || this.phase === 'done') && this.tournamentMode) {
      y = this.drawStandings(ctx, contentX, y, contentW, ui);
    }

    if (this.phase === 'payout' || this.phase === 'done') {
      y = this.drawPayout(ctx, contentX, y, contentW, ui);
    }

    if (this.phase === 'xp' || this.phase === 'done') {
      y = this.drawXpSection(ctx, contentX, y, contentW, ui, state);
    }

    if (this.phase === 'done') {
      const btnH = ensureMinTouch(pad(token, 5.5), token);
      const btnGap = pad(token, 0.75);
      let btnY = h - token.safe.bottom - pad(token, 2) - btnH;
      const hasSeriesNext = this.payload.nextRaceConfig !== undefined;
      const isQuick = this.payload.config.mode === 'quick';
      const showNext = hasSeriesNext || isQuick;
      const btnCount = showNext ? 3 : 2;
      const btnW = (contentW - btnGap * (btnCount - 1)) / btnCount;
      let btnX = contentX;

      const againBtn: ButtonDef = {
        x: btnX,
        y: btnY,
        w: btnW,
        h: btnH,
        label: 'Race Again',
        onClick: () => this.raceAgain(),
      };
      btnX += btnW + btnGap;
      drawButton(ctx, againBtn, ui);
      handleButton(againBtn, ui);

      if (showNext) {
        const nextBtn: ButtonDef = {
          x: btnX,
          y: btnY,
          w: btnW,
          h: btnH,
          label: 'Next Race',
          primary: true,
          onClick: () => this.nextRace(),
        };
        btnX += btnW + btnGap;
        drawButton(ctx, nextBtn, ui);
        handleButton(nextBtn, ui);
      }

      const backBtn: ButtonDef = {
        x: btnX,
        y: btnY,
        w: btnW,
        h: btnH,
        label: 'Back',
        primary: !showNext,
        onClick: () => this.navigateBack(),
      };
      drawButton(ctx, backBtn, ui);
      handleButton(backBtn, ui);
    }

    if (this.phase !== 'done') {
      ctx.save();
      ctx.font = `${token.fontCaption}px ${token.fontFamily}`;
      ctx.fillStyle = token.textDim;
      ctx.textAlign = 'center';
      ctx.fillText('Tap to skip', w * 0.5, h - token.safe.bottom - pad(token));
      ctx.restore();
    }

    handleHeader(header, ui);
    this.toasts.draw(ctx, ui);
  }

  private drawPodium(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    ui: ReturnType<typeof buildUi>['ui'],
  ): number {
    const { token, accent } = ui;
    const top3 = [...this.payload.finishers].sort((a, b) => a.position - b.position).slice(0, 3);
    const h = pad(token, 16);
    const place = this.payload.playerPosition;
    const won = place === 1;

    ctx.save();
    // Place number — display font, winner gets accent + scale
    const placeSize = won ? token.fontDisplay * 1.35 : token.fontDisplay;
    ctx.font = `800 ${placeSize}px ${token.fontDisplayFamily}`;
    ctx.fillStyle = won ? accent : token.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(`P${place}`, x + w * 0.5, y + pad(token, 0.5));

    if (won) {
      ctx.font = `700 ${token.fontCaption}px ${token.fontDisplayFamily}`;
      ctx.fillStyle = accent;
      ctx.globalAlpha = 0.85;
      ctx.fillText('WINNER', x + w * 0.5, y + pad(token, 0.5) + placeSize + pad(token, 0.25));
      ctx.globalAlpha = 1;
    }

    const bonusY =
      y +
      pad(token, 0.5) +
      placeSize +
      (won ? token.fontCaption + pad(token, 0.5) : pad(token, 0.5));
    if (this.payload.handsOffBonus > 0) {
      ctx.font = `${token.fontCaption}px ${token.fontFamily}`;
      ctx.fillStyle = token.success;
      ctx.fillText(
        `Hands-off bonus: +$${this.payload.handsOffBonus} (${Math.round(this.payload.handsOffRatio * 100)}% idle)`,
        x + w * 0.5,
        bonusY,
      );
    } else if (this.payload.entertainmentBonus > 0) {
      ctx.font = `${token.fontCaption}px ${token.fontFamily}`;
      ctx.fillStyle = token.success;
      ctx.fillText(`Crowd bonus: +$${this.payload.entertainmentBonus}`, x + w * 0.5, bonusY);
    }

    const positions = [1, 0, 2];
    const podiumW = w / 3;
    for (let i = 0; i < 3; i++) {
      const finisher = top3[positions[i]!];
      if (finisher === undefined) continue;
      const px = x + i * podiumW + podiumW * 0.5;
      const isFirst = positions[i] === 0;
      const barH = pad(token, 3.5 + (isFirst ? 4.5 : positions[i] === 1 ? 2 : 0));
      const barW = podiumW * (isFirst ? 0.62 : 0.52);
      ctx.fillStyle = finisher.isPlayer ? accent : isFirst ? `${accent}55` : token.bgElevated;
      ctx.fillRect(px - barW * 0.5, y + h - pad(token) - barH, barW, barH);
      // Place numeral on bar
      ctx.font = `700 ${token.fontCaption}px ${token.fontDisplayFamily}`;
      ctx.fillStyle = finisher.isPlayer || isFirst ? token.bg : token.textMuted;
      ctx.textBaseline = 'middle';
      ctx.fillText(String((positions[i] ?? 0) + 1), px, y + h - pad(token) - barH * 0.5);
      ctx.font = `600 ${token.fontCaption}px ${token.fontFamily}`;
      ctx.fillStyle = isFirst ? token.text : token.textMuted;
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(
        finisher.name.split(' ')[0] ?? finisher.name,
        px,
        y + h - pad(token) - barH - pad(token, 0.5),
      );
    }
    ctx.restore();
    return h;
  }

  private drawStandings(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    ui: ReturnType<typeof buildUi>['ui'],
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
      ctx.fillStyle = isPlayer ? ui.accent : token.textDim;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${i + 1}`, x + pad(token, 1), y + rowH * 0.5);
      ctx.font = `600 ${token.fontBody}px ${token.fontFamily}`;
      ctx.fillStyle = isPlayer ? ui.accent : token.text;
      ctx.fillText(entry.name, x + pad(token, 4), y + rowH * 0.5);
      ctx.textAlign = 'right';
      ctx.fillText(`${entry.points} pts`, x + w - pad(token, 1), y + rowH * 0.5);
      ctx.restore();
      y += rowH;
    }
    return y + pad(token, 1.5);
  }

  private drawPayout(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    ui: ReturnType<typeof buildUi>['ui'],
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
      ctx.fillText(`+$${row.value}`, x + w - pad(token, 1), y + rowH * 0.5);
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
    ctx.fillText(`$${p.total}`, x + w - pad(token, 1), y + totalH * 0.5);
    ctx.restore();
    return y + totalH + pad(token, 1.5);
  }

  private drawXpSection(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    ui: ReturnType<typeof buildUi>['ui'],
    state: NonNullable<ReturnType<typeof getGameContext>['state']>,
  ): number {
    const grants = this.payload.driverXp;
    if (grants.length === 0) return y;
    const grant = grants[this.selectedDriverIdx % grants.length];
    if (grant === undefined) return y;
    const driver = findDriver(state, grant.driverId);
    if (driver === undefined) return y;

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
        const before = effectiveStats(
          this.payload.discipline,
          vehicle.partTiers,
          vehicle.condition,
        );
        if (buyPartTier(state, this.payload.discipline, part)) {
          const after = effectiveStats(
            this.payload.discipline,
            vehicle.partTiers,
            vehicle.condition,
          );
          const dGrip = after.gripFactor - before.gripFactor;
          const dV = after.vMax - before.vMax;
          const bits: string[] = [];
          if (Math.abs(dGrip) >= 0.001) {
            bits.push(`grip ${dGrip >= 0 ? '+' : ''}${dGrip.toFixed(3)}`);
          }
          if (Math.abs(dV) >= 0.05) {
            bits.push(`vMax ${dV >= 0 ? '+' : ''}${dV.toFixed(1)}`);
          }
          this.toasts.push(
            bits.length > 0 ? `Upgrade: ${bits.join(' · ')}` : 'Part upgraded',
            disciplineAccent(this.payload.discipline),
            3,
          );
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
  return new ResultsScene(payload, payload.config.mode === 'tournament');
}
