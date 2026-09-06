import type { Scene } from '../engine/SceneManager';
import { getGameContext } from '../engine/GameContext';
import { BALANCE, RANK_NAMES } from '../data/balance';
import type { RankId } from '../data/balance';
import { FORMATS } from '../data/formats';
import { getTournament, TOURNAMENTS } from '../data/tournaments';
import { generateOpponents } from '../engine/DriverGenerator';
import { mulberry32 } from '../engine/rng';
import type { DisciplineId } from '../data/disciplines';
import { tournamentRaceSeed } from '../career/tournamentSeeds';
import type { RaceLaunchConfig } from '../career/raceLaunch';
import { buildTournamentStandings } from '../career/tournamentStandings';
import type { TournamentProgress } from '../engine/types';
import {
  drawButton,
  handleButton,
  drawHeader,
  handleHeader,
  drawCard,
  drawRow,
  drawSectionTitle,
  drawInfoIcon,
  infoIconRadius,
  drawModal,
  handleModal,
  layoutModalButtons,
  modalBoxRect,
  layoutShell,
  ContentScroller,
  TooltipManager,
  pad,
  ensureMinTouch,
  hitRect,
  beginClip,
  endClip,
  fmtCash,
  ToastManager,
  truncateText,
  type ButtonDef,
  type ModalDef,
  type ThemeTokens,
  type UiContext,
} from '../ui/components';
import {
  buildUi,
  drawBackground,
  onSceneEnter,
  onSceneResize,
} from './sceneChrome';
import { disciplineAccent, disciplineLabel } from '../career/disciplinesUi';
import { defaultLeadDriver, defaultLineup } from '../career/roster';
import { launchRace } from '../career/launchRace';
import { getObjectiveDef } from '../career/objectives';
import { QuickRaceSetupScene } from './QuickRaceSetupScene';

const LINEUP_VISIBLE_ROWS = 4;

export class CampaignScene implements Scene {
  private readonly discipline: DisciplineId;
  private toasts = new ToastManager();
  private tooltips = new TooltipManager();
  private modal: ModalDef = { open: false, title: '', body: '', buttons: [] };
  private lineupModalOpen = false;
  private pendingTournamentId: string | null = null;
  private lineupSelection: string[] = [];
  private leadDriverId = '';
  private scroller = new ContentScroller();
  private detachWheel: (() => void) | null = null;
  private lineupScroll = 0;
  private lineupBodyBase = '';
  private lineupDragFrom: number | null = null;
  private lineupScrollAtDrag = 0;
  private lineupDragMoved = false;

  private onLineupWheel = (ev: WheelEvent): void => {
    if (!this.lineupModalOpen || !this.modal.open) return;
    ev.preventDefault();
    const before = this.lineupScroll;
    this.lineupScroll += ev.deltaY;
    if (this.lineupScroll !== before) this.tooltips.close();
  };

  constructor(discipline: DisciplineId) {
    this.discipline = discipline;
  }

  enter(): void {
    onSceneEnter();
    this.modal.open = false;
    this.lineupModalOpen = false;
    this.pendingTournamentId = null;
    this.lineupScroll = 0;
    this.scroller.scroll.offset = 0;
    this.scroller.onUserScroll = () => this.tooltips.close();
    const canvas = getGameContext().canvas;
    this.detachWheel = this.scroller.attachWheel(canvas, () => !this.modal.open);
    canvas.addEventListener('wheel', this.onLineupWheel, { passive: false });
  }

  exit(): void {
    this.detachWheel?.();
    this.detachWheel = null;
    getGameContext().canvas.removeEventListener('wheel', this.onLineupWheel);
  }

  onResize(w: number, h: number): void {
    onSceneResize(w, h);
  }

  handleBack(): boolean {
    if (this.modal.open) {
      this.modal.open = false;
      this.lineupModalOpen = false;
      this.pendingTournamentId = null;
      this.lineupScroll = 0;
      return true;
    }
    getGameContext().scenes.back();
    return true;
  }

  update(dt: number): void {
    this.toasts.update(dt);
  }

  private tournamentsForDiscipline() {
    return TOURNAMENTS.filter((t) => t.discipline === this.discipline);
  }

  private inProgress(): TournamentProgress | null {
    const g = getGameContext();
    return g.state?.inProgressTournaments[this.discipline] ?? null;
  }

  private openLineupPicker(tournamentDefId: string, teamSize: number): void {
    const g = getGameContext();
    if (g.state === null) return;
    if (g.state.roster.length < teamSize) {
      this.toasts.push(`Need ${teamSize} drivers on roster`, disciplineAccent(this.discipline));
      return;
    }
    this.pendingTournamentId = tournamentDefId;
    this.lineupSelection = defaultLineup(g.state, teamSize);
    this.leadDriverId = defaultLeadDriver(g.state, this.lineupSelection);
    this.lineupModalOpen = true;
    this.lineupScroll = 0;
    this.lineupBodyBase = `Pick ${teamSize} driver${teamSize > 1 ? 's' : ''} for this series.\nTap drivers to toggle · the ★ lead's style drives the car.`;
    this.modal = {
      open: true,
      title: 'Select Lineup',
      body: this.lineupBodyBase,
      buttons: [
        {
          x: 0,
          y: 0,
          w: 0,
          h: 0,
          label: 'Cancel',
          onClick: () => {
            this.lineupModalOpen = false;
            this.modal.open = false;
            this.pendingTournamentId = null;
            this.lineupScroll = 0;
          },
        },
        {
          x: 0,
          y: 0,
          w: 0,
          h: 0,
          label: 'Confirm',
          primary: true,
          onClick: () => this.confirmLineup(),
        },
      ],
    };
  }

  private confirmLineup(): void {
    const g = getGameContext();
    if (g.state === null || this.pendingTournamentId === null) return;
    const def = TOURNAMENTS.find((t) => t.id === this.pendingTournamentId);
    if (def === undefined) return;
    if (this.lineupSelection.length !== def.teamSize) {
      this.toasts.push(`Select exactly ${def.teamSize} drivers`, disciplineAccent(this.discipline));
      return;
    }

    const rng = mulberry32((g.state.seed ^ def.rank) >>> 0);
    const format = FORMATS.find((f) => f.id === def.races[0]?.formatId) ?? FORMATS[0]!;
    const opponentCount = Math.max(1, (format.teamCount - 1) * format.teamSize);
    const opponents = generateOpponents(rng, opponentCount, def.rank);
    const rivalNames: string[] = [];
    for (let t = 1; t < format.teamCount; t++) {
      const leadOpp = opponents[(t - 1) * format.teamSize];
      const short = leadOpp?.name.split(' ')[0];
      rivalNames.push(short ? `${short}'s Crew` : `Rival ${t}`);
    }
    const progress: TournamentProgress = {
      defId: def.id,
      raceIndex: 0,
      standings: buildTournamentStandings(format.teamCount, rivalNames),
      opponentDrivers: opponents,
      playerLineup: [...this.lineupSelection],
      leadDriverId: this.leadDriverId,
    };
    g.state.inProgressTournaments[this.discipline] = progress;
    g.autosave();
    this.lineupModalOpen = false;
    this.modal.open = false;
    this.pendingTournamentId = null;
    this.lineupScroll = 0;
    this.toasts.push(`${def.name} started`, disciplineAccent(this.discipline));
  }

  private abandonTournament(): void {
    const g = getGameContext();
    if (g.state === null) return;
    g.state.inProgressTournaments[this.discipline] = null;
    g.autosave();
    this.toasts.push('Tournament abandoned', '#f87171');
  }

  private startTournamentRace(): void {
    const g = getGameContext();
    const progress = this.inProgress();
    if (g.state === null || progress === null) return;
    // A save may reference a removed tournament def — bail out gracefully.
    const defId = TOURNAMENTS.find((t) => t.id === progress.defId);
    if (defId === undefined) {
      g.state.inProgressTournaments[this.discipline] = null;
      this.toasts.push('Series no longer exists', '#f87171');
      return;
    }
    const def = getTournament(this.discipline, defId.rank);
    const raceDef = def.races[progress.raceIndex];
    if (raceDef === undefined) return;

    const config: RaceLaunchConfig = {
      discipline: this.discipline,
      trackSeed: raceDef.trackSeed,
      raceSeed: tournamentRaceSeed(g.state.seed, progress.raceIndex),
      laps: raceDef.laps,
      formatId: raceDef.formatId,
      playerLineup: progress.playerLineup,
      leadDriverId: progress.leadDriverId,
      mode: 'tournament',
      tournamentDefId: def.id,
      returnTo: 'campaign',
    };
    launchRace(config, this.toasts);
  }

  private toggleLineupDriver(id: string, maxSize: number): void {
    const idx = this.lineupSelection.indexOf(id);
    if (idx >= 0) {
      this.lineupSelection.splice(idx, 1);
      if (this.leadDriverId === id) {
        this.leadDriverId = this.lineupSelection[0] ?? '';
      }
    } else if (this.lineupSelection.length < maxSize) {
      this.lineupSelection.push(id);
      if (this.leadDriverId === '') this.leadDriverId = id;
    }
  }

  /** Shared modal geometry — same source as drawModal/layoutModalButtons. */
  private modalLayout(ui: UiContext) {
    const box = modalBoxRect(this.modal, ui);
    return { ...box, token: ui.token };
  }

  /** Full touch-target row height — shared by the body reservation and the draw. */
  private lineupRowH(token: ThemeTokens): number {
    return ensureMinTouch(pad(token, 4.25), token);
  }

  private reserveLineupBody(token: ThemeTokens, rosterLen: number): number {
    const rowH = this.lineupRowH(token);
    const listH = Math.min(LINEUP_VISIBLE_ROWS, Math.max(1, rosterLen)) * rowH;
    const lineH = token.fontBody * 1.35;
    const blankLines = Math.ceil(listH / lineH);
    this.modal.body = this.lineupBodyBase + '\n'.repeat(blankLines);
    return listH;
  }

  private drawLineupList(
    ctx: CanvasRenderingContext2D,
    ui: UiContext,
    state: NonNullable<ReturnType<typeof getGameContext>['state']>,
  ): void {
    if (!this.lineupModalOpen || this.pendingTournamentId === null) return;
    const def = TOURNAMENTS.find((t) => t.id === this.pendingTournamentId);
    if (def === undefined) return;

    const accent = ui.accent;
    const { token } = ui;
    const rowH = this.lineupRowH(token);
    const listH = Math.min(LINEUP_VISIBLE_ROWS, Math.max(1, state.roster.length)) * rowH;
    const layout = this.modalLayout(ui);
    const baseLines = this.lineupBodyBase.split('\n').length;
    const listTop = layout.bodyY + baseLines * token.fontBody * 1.35 + pad(token, 0.5);
    const listX = layout.boxX + pad(token, 1.5);
    const listW = layout.boxW - pad(token, 3);
    const contentH = state.roster.length * rowH;
    const maxScroll = Math.max(0, contentH - listH);
    this.lineupScroll = Math.max(0, Math.min(maxScroll, this.lineupScroll));

    // Drag-to-scroll (touch users had no way to reach rows past the fourth).
    const insideList = hitRect(ui.pointerX, ui.pointerY, listX, listTop, listW, listH);
    if (ui.pointerDown && insideList && this.lineupDragFrom === null) {
      this.lineupDragFrom = ui.pointerY;
      this.lineupScrollAtDrag = this.lineupScroll;
      this.lineupDragMoved = false;
    }
    if (!ui.pointerDown) {
      this.lineupDragFrom = null;
    } else if (this.lineupDragFrom !== null) {
      const dy = ui.pointerY - this.lineupDragFrom;
      if (Math.abs(dy) > 8) {
        this.lineupDragMoved = true;
        this.tooltips.close();
        this.lineupScroll = Math.max(0, Math.min(maxScroll, this.lineupScrollAtDrag - dy));
      }
    }

    beginClip(ctx, listX, listTop, listW, listH);
    let rowY = listTop - this.lineupScroll;
    for (const driver of state.roster) {
      const selected = this.lineupSelection.includes(driver.id);
      const isLead = driver.id === this.leadDriverId;
      const rowVisible = rowY + rowH > listTop && rowY < listTop + listH;

      if (
        rowVisible &&
        !this.lineupDragMoved &&
        ui.pointerClicked &&
        hitRect(ui.pointerX, ui.pointerY, listX, rowY, listW, rowH)
      ) {
        const leadHit = hitRect(
          ui.pointerX,
          ui.pointerY,
          listX + listW - pad(token, 8),
          rowY,
          pad(token, 8),
          rowH,
        );
        if (selected && leadHit) {
          this.leadDriverId = driver.id;
        } else {
          this.toggleLineupDriver(driver.id, def.teamSize);
        }
      }

      ctx.save();
      ctx.fillStyle = selected ? `${accent}33` : 'transparent';
      ctx.fillRect(listX, rowY, listW, rowH);
      ctx.font = `600 ${token.fontBody}px ${token.fontFamily}`;
      ctx.fillStyle = selected ? token.text : token.textMuted;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        truncateText(ctx, `${selected ? '✓ ' : ''}${driver.name}${isLead ? ' ★' : ''}`, listW - pad(token, 9.5)),
        listX + pad(token),
        rowY + rowH * 0.5,
      );
      if (selected) {
        ctx.font = `${token.fontCaption}px ${token.fontFamily}`;
        ctx.fillStyle = isLead ? accent : token.textMuted;
        ctx.textAlign = 'right';
        ctx.fillText(isLead ? 'Lead' : 'Set lead', listX + listW - pad(token, 0.5), rowY + rowH * 0.5);
      }
      ctx.restore();
      rowY += rowH;
    }
    endClip(ctx);

    // Scroll affordance — show there are more drivers beyond the fold.
    if (maxScroll > 0) {
      const trackW = Math.max(3, pad(token, 0.4));
      const thumbH = Math.max(pad(token, 1.5), listH * (listH / contentH));
      const thumbY =
        listTop +
        (this.lineupScroll / maxScroll) * (listH - thumbH);
      ctx.save();
      ctx.fillStyle = token.bgElevated;
      ctx.fillRect(listX + listW - trackW * 2, listTop, trackW, listH);
      ctx.fillStyle = token.textDim;
      ctx.fillRect(listX + listW - trackW * 2, thumbY, trackW, thumbH);
      ctx.restore();
    }
  }

  private drawDisciplineChip(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    ui: UiContext,
  ): number {
    const { token, accent } = ui;
    const label = disciplineLabel(this.discipline).toUpperCase();
    const chipH = token.fontCaption + pad(token, 1);
    ctx.save();
    ctx.font = `600 ${token.fontCaption}px ${token.fontFamily}`;
    const tw = ctx.measureText(label).width;
    const chipW = tw + pad(token, 2);
    ctx.fillStyle = `${accent}33`;
    ctx.beginPath();
    ctx.roundRect(x, y, chipW, chipH, chipH * 0.5);
    ctx.fill();
    ctx.fillStyle = accent;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + pad(token), y + chipH * 0.5);
    ctx.restore();
    return chipH;
  }

  render(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const g = getGameContext();
    const state = g.state;
    const accent = disciplineAccent(this.discipline);
    const { ui, token } = buildUi(w, h, 0, accent);
    if (state === null) {
      drawBackground(ctx, w, h, token);
      const shell = layoutShell(w, h, token);
      drawHeader(
        ctx,
        {
          x: shell.headerRect.x,
          y: shell.headerRect.y,
          w: shell.headerRect.w,
          h: shell.headerRect.h,
          title: 'Campaign',
          back: true,
          onBack: () => this.handleBack(),
        },
        ui,
      );
      ctx.save();
      ctx.fillStyle = token.textMuted;
      ctx.font = `500 ${token.fontBody}px ${token.fontFamily}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('No career loaded.', w * 0.5, h * 0.5);
      ctx.restore();
      return;
    }

    const shell = layoutShell(w, h, token);

    drawBackground(ctx, w, h, token);

    const header = {
      x: shell.headerRect.x,
      y: shell.headerRect.y,
      w: shell.headerRect.w,
      h: shell.headerRect.h,
      title: 'Campaign',
      back: true,
      cash: state.cash,
      onBack: () => this.handleBack(),
    };
    drawHeader(ctx, header, ui);

    const view = shell.contentRect;
    const btnH = ensureMinTouch(pad(token, 5.5), token);
    const objGap = pad(token, 0.5);
    const heroH = pad(token, 12);
    // Objective rows stack title (fontBody) + description (fontCaption) with
    // explicit positions — fractional anchors overlapped the two on phones.
    const objH = ensureMinTouch(
      pad(token, 0.5) + token.fontBody + pad(token, 0.25) + token.fontCaption + pad(token, 0.75),
      token,
    );
    const cardH = pad(token, 10);
    const lockedH = cardH * 0.55;
    const schedRowH = token.fontCaption + pad(token, 1.4);
    const objCount = Math.min(state.objectives.active.length, BALANCE.activeObjectives);
    const tournaments = this.tournamentsForDiscipline();
    const progress = this.inProgress();
    const chipH = token.fontCaption + pad(token, 1);

    let contentH = chipH + pad(token, 1) + heroH + pad(token, 1.5);
    contentH += token.fontCaption + pad(token, 0.75);
    contentH += objCount * (objH + objGap);
    contentH += pad(token, 0.75);
    contentH += token.fontCaption + pad(token, 0.75);
    for (const t of tournaments) {
      const unlocked = state.rankUnlocked[this.discipline] >= t.rank;
      const isActive = progress?.defId === t.id;
      const locked = !unlocked && !isActive;
      contentH += (locked ? lockedH : isActive && progress ? cardH + schedRowH : cardH) + objGap;
    }
    contentH += pad(token);

    this.scroller.layout(view, contentH);
    this.scroller.update(ui, view);
    const lui = this.scroller.localUi(ui, view);
    const interactive = !this.modal.open;
    const tooltipOrigin = { x: view.x, y: view.y - this.scroller.scroll.offset };
    this.tooltips.beginFrame();

    this.scroller.begin(ctx, view);
    let y = 0;
    y += this.drawDisciplineChip(ctx, 0, y, lui) + pad(token, 1);

    drawCard(ctx, { x: 0, y, w: view.w, h: heroH }, lui);
    ctx.save();
    ctx.font = `700 ${token.fontTitle}px ${token.fontDisplayFamily}`;
    ctx.fillStyle = token.text;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('Quick Race', pad(token, 1.5), y + pad(token, 1.5));
    ctx.font = `${token.fontBody}px ${token.fontFamily}`;
    ctx.fillStyle = token.textMuted;
    // Keep clear of the Start button on the right.
    const subtitleMax = view.w - pad(token, 3) - pad(token, 12);
    ctx.fillText(
      truncateText(ctx, 'Jump in for cash and XP', subtitleMax),
      pad(token, 1.5),
      y + pad(token, 1.5) + token.fontTitle,
    );
    ctx.restore();

    const startBtn: ButtonDef = {
      x: view.w - pad(token, 1.5) - pad(token, 12),
      y: y + heroH - pad(token, 1.5) - btnH,
      w: pad(token, 12),
      h: btnH,
      label: 'Start',
      primary: true,
      onClick: () => {
        if (state.roster.length < 1) {
          this.toasts.push('Need a driver on the roster', accent);
          return;
        }
        getGameContext().scenes.push(
          new QuickRaceSetupScene({
            discipline: this.discipline,
            returnTo: 'campaign',
          }),
        );
      },
    };
    drawButton(ctx, startBtn, lui);
    if (interactive) handleButton(startBtn, lui);
    y += heroH + pad(token, 1.5);

    y += drawSectionTitle(ctx, 0, y, 'Objectives', lui);

    for (const objId of state.objectives.active.slice(0, BALANCE.activeObjectives)) {
      const def = getObjectiveDef(objId);
      drawRow(ctx, { x: 0, y, w: view.w, h: objH }, lui);
      const rewardStr = fmtCash(def?.reward ?? 0);
      const infoR = infoIconRadius(token);
      const titleY = y + pad(token, 0.5) + token.fontBody * 0.5;
      const descY = y + pad(token, 0.5) + token.fontBody + pad(token, 0.25) + token.fontCaption * 0.5;
      ctx.save();
      ctx.font = `700 ${token.fontCaption}px ${token.fontDisplayFamily}`;
      const rewardW = ctx.measureText(rewardStr).width;
      // Reserve room for the ⓘ between text and the payout figure.
      const textMax = view.w - pad(token, 2) - rewardW - infoR * 3.6;
      ctx.font = `600 ${token.fontBody}px ${token.fontFamily}`;
      ctx.fillStyle = token.text;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(truncateText(ctx, def?.title ?? objId, textMax), pad(token, 1), titleY);
      ctx.font = `${token.fontCaption}px ${token.fontFamily}`;
      ctx.fillStyle = token.textMuted;
      ctx.fillText(truncateText(ctx, def?.description ?? '', textMax), pad(token, 1), descY);
      ctx.font = `700 ${token.fontCaption}px ${token.fontDisplayFamily}`;
      ctx.fillStyle = accent;
      ctx.textAlign = 'right';
      ctx.fillText(rewardStr, view.w - pad(token, 1), y + objH * 0.5);
      ctx.restore();

      // ⓘ — when the cash lands.
      const icx = view.w - pad(token, 1) - rewardW - infoR * 2.2;
      const icy = y + objH * 0.5;
      drawInfoIcon(ctx, icx, icy, infoR, lui, false);
      this.tooltips.register(
        { x: icx - infoR * 1.6, y: icy - infoR * 1.6, w: infoR * 3.2, h: infoR * 3.2 },
        { title: 'Reward', body: 'Cash bonus, paid the moment the objective completes.' },
        tooltipOrigin,
      );
      y += objH + objGap;
    }

    y += pad(token, 0.75);
    y += drawSectionTitle(ctx, 0, y, 'Tournaments', lui);

    for (const t of tournaments) {
      const rank = t.rank as RankId;
      const unlocked = state.rankUnlocked[this.discipline] >= rank;
      const isActive = progress?.defId === t.id;
      const locked = !unlocked && !isActive;

      if (locked) {
        drawRow(ctx, { x: 0, y, w: view.w, h: lockedH }, lui);
        ctx.save();
        ctx.font = `600 ${token.fontBody}px ${token.fontFamily}`;
        ctx.fillStyle = token.disabled;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const lockLabel = `Locked · ${RANK_NAMES[rank]}`;
        ctx.font = `${token.fontCaption}px ${token.fontFamily}`;
        const lockW = ctx.measureText(lockLabel).width;
        const infoR2 = infoIconRadius(token);
        ctx.font = `600 ${token.fontBody}px ${token.fontFamily}`;
        ctx.fillText(
          truncateText(ctx, t.name, view.w - pad(token, 1.5) - lockW - infoR2 * 3.6),
          pad(token, 1),
          y + lockedH * 0.5,
        );
        ctx.font = `${token.fontCaption}px ${token.fontFamily}`;
        ctx.fillStyle = token.textMuted;
        ctx.textAlign = 'right';
        ctx.fillText(lockLabel, view.w - pad(token, 1), y + lockedH * 0.5);
        ctx.restore();
        // ⓘ — how ranks unlock (winning the current top series promotes you).
        const icx = view.w - pad(token, 1) - lockW - infoR2 * 2.4;
        const icy = y + lockedH * 0.5;
        drawInfoIcon(ctx, icx, icy, infoR2, lui, false);
        this.tooltips.register(
          { x: icx - infoR2 * 1.6, y: icy - infoR2 * 1.6, w: infoR2 * 3.2, h: infoR2 * 3.2 },
          { title: 'Locked', body: `Reach ${RANK_NAMES[rank]} rank to enter — win the current top series in this discipline to promote.` },
          tooltipOrigin,
        );
        y += lockedH + objGap;
        continue;
      }

      const ch = isActive && progress ? cardH + schedRowH : cardH;
      drawCard(ctx, { x: 0, y, w: view.w, h: ch }, lui);
      ctx.save();
      ctx.font = `700 ${token.fontBody}px ${token.fontFamily}`;
      ctx.fillStyle = token.text;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      const progressStr =
        isActive && progress !== null ? `Race ${progress.raceIndex + 1}/${t.races.length}` : '';
      ctx.font = `600 ${token.fontCaption}px ${token.fontFamily}`;
      const progressW = progressStr !== '' ? ctx.measureText(progressStr).width : 0;
      ctx.font = `700 ${token.fontBody}px ${token.fontFamily}`;
      const nameMax = view.w - pad(token, 3) - progressW - pad(token, 1.5);
      ctx.fillText(truncateText(ctx, t.name, nameMax), pad(token, 1.5), y + pad(token, 1));
      ctx.font = `${token.fontCaption}px ${token.fontFamily}`;
      ctx.fillStyle = token.textMuted;
      const meta = `${RANK_NAMES[rank]} · ${t.races.length} races · ${t.teamSize}-car team`;
      ctx.fillText(
        truncateText(ctx, meta, nameMax),
        pad(token, 1.5),
        y + pad(token, 1) + token.fontBody,
      );
      if (isActive && progress !== null) {
        ctx.fillStyle = accent;
        ctx.textAlign = 'right';
        ctx.fillText(
          progressStr,
          view.w - pad(token, 1.5),
          y + pad(token, 1),
        );
      }
      ctx.restore();

      if (isActive && progress !== null) {
        const sy = y + pad(token, 1) + token.fontBody + token.fontCaption + pad(token, 0.7);
        const chipH = token.fontCaption + pad(token, 0.7);
        const chipGap = pad(token, 0.4);
        const chipW = pad(token, 4.5);
        let cx = pad(token, 1.5);
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `600 ${token.fontCaption}px ${token.fontFamily}`;
        for (let i = 0; i < t.races.length; i++) {
          const done = i < progress.raceIndex;
          const next = i === progress.raceIndex;
          ctx.fillStyle = done ? 'rgba(255,255,255,0.08)' : next ? accent : 'rgba(255,255,255,0.04)';
          ctx.beginPath();
          ctx.roundRect(cx, sy, chipW, chipH, chipH * 0.3);
          ctx.fill();
          ctx.fillStyle = done ? token.textMuted : next ? '#0b0f0e' : token.textMuted;
          ctx.fillText(`R${i + 1}`, cx + chipW / 2, sy + chipH / 2);
          cx += chipW + chipGap;
        }
        ctx.restore();
      }

      const actionY = y + ch - pad(token, 1) - btnH;
      if (isActive && progress !== null) {
        // Even split with a real gap — two adjacent primaries were 2-3px apart.
        const availW = view.w - pad(token, 3);
        const resumeW = availW * 0.55;
        const abandonW = availW - resumeW - pad(token, 0.75);
        const resumeBtn: ButtonDef = {
          x: pad(token, 1.5),
          y: actionY,
          w: resumeW,
          h: btnH,
          label: 'Resume',
          primary: true,
          onClick: () => this.startTournamentRace(),
        };
        const abandonBtn: ButtonDef = {
          x: pad(token, 1.5) + resumeW + pad(token, 0.75),
          y: actionY,
          w: abandonW,
          h: btnH,
          label: 'Abandon',
          onClick: () => {
            this.modal = {
              open: true,
              title: 'Abandon Tournament?',
              body: 'Progress in this series will be lost.',
              buttons: [
                { x: 0, y: 0, w: 0, h: 0, label: 'Cancel', onClick: () => { this.modal.open = false; } },
                { x: 0, y: 0, w: 0, h: 0, label: 'Abandon', danger: true, onClick: () => { this.modal.open = false; this.abandonTournament(); } },
              ],
            };
          },
        };
        drawButton(ctx, resumeBtn, lui);
        drawButton(ctx, abandonBtn, lui);
        if (interactive) {
          handleButton(resumeBtn, lui);
          handleButton(abandonBtn, lui);
        }
      } else if (!isActive && progress === null) {
        const enterBtn: ButtonDef = {
          x: view.w - pad(token, 1.5) - pad(token, 10),
          y: actionY,
          w: pad(token, 10),
          h: btnH,
          label: 'Enter',
          primary: true,
          onClick: () => this.openLineupPicker(t.id, t.teamSize),
        };
        drawButton(ctx, enterBtn, lui);
        if (interactive) handleButton(enterBtn, lui);
      } else if (!isActive && progress !== null) {
        // Another series is already underway — don't leave a blank action strip.
        ctx.save();
        ctx.font = `600 ${token.fontCaption}px ${token.fontFamily}`;
        ctx.fillStyle = token.textMuted;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText('Finish current series', view.w - pad(token, 1.5), actionY + btnH * 0.5);
        ctx.restore();
      }

      y += ch + objGap;
    }

    this.scroller.end(ctx);

    // Tooltips live above content, below modal chrome.
    this.tooltips.handle(lui, interactive && !this.scroller.isScrolling);
    this.tooltips.draw(ctx, ui);

    handleHeader(header, ui);

    if (this.lineupModalOpen) {
      this.reserveLineupBody(token, state.roster.length);
    }
    if (this.modal.open) layoutModalButtons(this.modal, ui);
    drawModal(ctx, this.modal, ui);
    if (this.lineupModalOpen) this.drawLineupList(ctx, ui, state);
    handleModal(this.modal, ui);
    this.toasts.draw(ctx, ui);
  }
}
