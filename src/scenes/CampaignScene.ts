import type { Scene } from '../engine/SceneManager';
import { getGameContext } from '../engine/GameContext';
import { BALANCE, RANK_NAMES } from '../data/balance';
import type { RankId } from '../data/balance';
import { FORMATS } from '../data/formats';
import { getTournament, TOURNAMENTS } from '../data/tournaments';
import { generateOpponents } from '../engine/DriverGenerator';
import { mulberry32, randInt } from '../engine/rng';
import type { DisciplineId } from '../data/disciplines';
import type { RaceLaunchConfig } from '../engine/raceTypes';
import { buildTournamentStandings } from '../engine/raceTypes';
import type { TournamentProgress } from '../engine/types';
import {
  drawButton,
  handleButton,
  drawHeader,
  handleHeader,
  drawCard,
  drawRow,
  drawSectionTitle,
  drawModal,
  handleModal,
  layoutModalButtons,
  layoutShell,
  ContentScroller,
  pad,
  ensureMinTouch,
  hitRect,
  beginClip,
  endClip,
  ToastManager,
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
  disciplineLabel,
  disciplineAccent,
  defaultLineup,
  defaultLeadDriver,
  makeQuickRaceConfig,
  launchRace,
  getObjectiveDef,
} from './sceneUtils';

const LINEUP_VISIBLE_ROWS = 4;

export class CampaignScene implements Scene {
  private readonly discipline: DisciplineId;
  private toasts = new ToastManager();
  private modal: ModalDef = { open: false, title: '', body: '', buttons: [] };
  private lineupModalOpen = false;
  private pendingTournamentId: string | null = null;
  private lineupSelection: string[] = [];
  private leadDriverId = '';
  private scroller = new ContentScroller();
  private detachWheel: (() => void) | null = null;
  private lineupScroll = 0;
  private lineupBodyBase = '';

  private onLineupWheel = (ev: WheelEvent): void => {
    if (!this.lineupModalOpen || !this.modal.open) return;
    ev.preventDefault();
    this.lineupScroll += ev.deltaY;
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
    this.lineupBodyBase = `Pick ${teamSize} driver${teamSize > 1 ? 's' : ''} for this series.\nTap drivers to toggle.`;
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
    const def = getTournament(this.discipline, TOURNAMENTS.find((t) => t.id === progress.defId)!.rank);
    const raceDef = def.races[progress.raceIndex];
    if (raceDef === undefined) return;

    const config: RaceLaunchConfig = {
      discipline: this.discipline,
      trackSeed: raceDef.trackSeed,
      raceSeed: randInt(mulberry32(g.state.seed + progress.raceIndex), 1, 0x7fffffff),
      laps: raceDef.laps,
      formatId: raceDef.formatId,
      playerLineup: progress.playerLineup,
      leadDriverId: progress.leadDriverId,
      mode: 'tournament',
      tournamentDefId: def.id,
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

  /** Mirror drawModal / layoutModalButtons box math. */
  private modalLayout(ui: UiContext) {
    const { token, w, h } = ui;
    const boxW = Math.min(w - pad(token, 4), pad(token, 40));
    const btnH = ensureMinTouch(pad(token, 5.5), token);
    const btnGap = pad(token, 0.75);
    const btnRowH = this.modal.buttons.length > 0 ? btnH + pad(token, 2) : 0;
    const bodyLines = this.modal.body.split('\n').length;
    const bodyH = bodyLines * token.fontBody * 1.35 + pad(token);
    const boxH = pad(token, 3) + token.fontTitle + pad(token) + bodyH + btnRowH + pad(token);
    const boxX = (w - boxW) * 0.5;
    const boxY = (h - boxH) * 0.5;
    const bodyY = boxY + pad(token, 1.5) + token.fontTitle + pad(token, 0.75);
    return { boxX, boxY, boxW, boxH, bodyY, btnH, btnGap, token };
  }

  private reserveLineupBody(token: ThemeTokens, rosterLen: number): number {
    const rowH = pad(token, 5);
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
    const rowH = pad(token, 5);
    const listH = Math.min(LINEUP_VISIBLE_ROWS, Math.max(1, state.roster.length)) * rowH;
    const layout = this.modalLayout(ui);
    const baseLines = this.lineupBodyBase.split('\n').length;
    const listTop = layout.bodyY + baseLines * token.fontBody * 1.35 + pad(token, 0.5);
    const listX = layout.boxX + pad(token, 1.5);
    const listW = layout.boxW - pad(token, 3);
    const contentH = state.roster.length * rowH;
    const maxScroll = Math.max(0, contentH - listH);
    this.lineupScroll = Math.max(0, Math.min(maxScroll, this.lineupScroll));

    beginClip(ctx, listX, listTop, listW, listH);
    let rowY = listTop - this.lineupScroll;
    for (const driver of state.roster) {
      const selected = this.lineupSelection.includes(driver.id);
      const isLead = driver.id === this.leadDriverId;
      const rowVisible = rowY + rowH > listTop && rowY < listTop + listH;

      if (rowVisible && ui.pointerClicked && hitRect(ui.pointerX, ui.pointerY, listX, rowY, listW, rowH)) {
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
        `${selected ? '✓ ' : ''}${driver.name}${isLead ? ' ★' : ''}`,
        listX + pad(token),
        rowY + rowH * 0.5,
      );
      if (selected) {
        ctx.font = `${token.fontCaption}px ${token.fontFamily}`;
        ctx.fillStyle = isLead ? accent : token.textDim;
        ctx.textAlign = 'right';
        ctx.fillText(isLead ? 'Lead' : 'Set lead', listX + listW - pad(token, 0.5), rowY + rowH * 0.5);
      }
      ctx.restore();
      rowY += rowH;
    }
    endClip(ctx);
  }

  private drawDisciplineChip(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    ui: UiContext,
  ): number {
    const { token, accent } = ui;
    const label = disciplineLabel(this.discipline);
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
    if (state === null) return;

    const accent = disciplineAccent(this.discipline);
    const { ui, token } = buildUi(w, h, 0, accent);
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
    const objH = pad(token, 5.5);
    const cardH = pad(token, 10);
    const lockedH = cardH * 0.55;
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
      contentH += (locked ? lockedH : cardH) + objGap;
    }
    contentH += pad(token);

    this.scroller.layout(view, contentH);
    this.scroller.update(ui, view);
    const lui = this.scroller.localUi(ui, view);
    const interactive = !this.modal.open;

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
    ctx.fillText('Jump in for cash and XP', pad(token, 1.5), y + pad(token, 1.5) + token.fontTitle);
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
        const config = makeQuickRaceConfig(state, this.discipline);
        launchRace(config, this.toasts);
      },
    };
    drawButton(ctx, startBtn, lui);
    if (interactive) handleButton(startBtn, lui);
    y += heroH + pad(token, 1.5);

    y += drawSectionTitle(ctx, 0, y, 'Objectives', lui);

    for (const objId of state.objectives.active.slice(0, BALANCE.activeObjectives)) {
      const def = getObjectiveDef(objId);
      drawRow(ctx, { x: 0, y, w: view.w, h: objH }, lui);
      ctx.save();
      ctx.font = `600 ${token.fontBody}px ${token.fontFamily}`;
      ctx.fillStyle = token.text;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(def?.title ?? objId, pad(token, 1), y + objH * 0.35);
      ctx.font = `${token.fontCaption}px ${token.fontFamily}`;
      ctx.fillStyle = token.textDim;
      ctx.fillText(def?.description ?? '', pad(token, 1), y + objH * 0.68);
      ctx.font = `700 ${token.fontCaption}px ${token.fontDisplayFamily}`;
      ctx.fillStyle = accent;
      ctx.textAlign = 'right';
      ctx.fillText(`$${def?.reward ?? 0}`, view.w - pad(token, 1), y + objH * 0.5);
      ctx.restore();
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
        ctx.fillText(t.name, pad(token, 1), y + lockedH * 0.5);
        ctx.font = `${token.fontCaption}px ${token.fontFamily}`;
        ctx.fillStyle = token.disabled;
        ctx.textAlign = 'right';
        ctx.fillText('Locked', view.w - pad(token, 1), y + lockedH * 0.5);
        ctx.restore();
        y += lockedH + objGap;
        continue;
      }

      drawCard(ctx, { x: 0, y, w: view.w, h: cardH }, lui);
      ctx.save();
      ctx.font = `700 ${token.fontBody}px ${token.fontFamily}`;
      ctx.fillStyle = token.text;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(t.name, pad(token, 1.5), y + pad(token, 1));
      ctx.font = `${token.fontCaption}px ${token.fontFamily}`;
      ctx.fillStyle = token.textDim;
      ctx.fillText(
        `${RANK_NAMES[rank]} · ${t.races.length} races · ${t.teamSize}-car team`,
        pad(token, 1.5),
        y + pad(token, 1) + token.fontBody,
      );
      if (isActive && progress !== null) {
        ctx.fillStyle = accent;
        ctx.textAlign = 'right';
        ctx.fillText(
          `Race ${progress.raceIndex + 1}/${t.races.length}`,
          view.w - pad(token, 1.5),
          y + pad(token, 1),
        );
      }
      ctx.restore();

      const actionY = y + cardH - pad(token, 1) - btnH;
      if (isActive && progress !== null) {
        const resumeBtn: ButtonDef = {
          x: pad(token, 1.5),
          y: actionY,
          w: (view.w - pad(token, 4)) * 0.55,
          h: btnH,
          label: 'Resume',
          primary: true,
          onClick: () => this.startTournamentRace(),
        };
        const abandonBtn: ButtonDef = {
          x: pad(token, 2) + (view.w - pad(token, 4)) * 0.55,
          y: actionY,
          w: (view.w - pad(token, 4)) * 0.4,
          h: btnH,
          label: 'Abandon',
          onClick: () => {
            this.modal = {
              open: true,
              title: 'Abandon Tournament?',
              body: 'Progress in this series will be lost.',
              buttons: [
                { x: 0, y: 0, w: 0, h: 0, label: 'Cancel', onClick: () => { this.modal.open = false; } },
                { x: 0, y: 0, w: 0, h: 0, label: 'Abandon', primary: true, onClick: () => { this.modal.open = false; this.abandonTournament(); } },
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
      }

      y += cardH + objGap;
    }

    this.scroller.end(ctx);

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
