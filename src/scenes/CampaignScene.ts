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
  headerHeight,
  pad,
  ensureMinTouch,
  hitRect,
  beginClip,
  endClip,
  clampScroll,
  wheelScroll,
  ToastManager,
  type ButtonDef,
  type ModalDef,
  type ScrollState,
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

export class CampaignScene implements Scene {
  private readonly discipline: DisciplineId;
  private toasts = new ToastManager();
  private modal: ModalDef = { open: false, title: '', body: '', buttons: [] };
  private lineupModalOpen = false;
  private pendingTournamentId: string | null = null;
  private lineupSelection: string[] = [];
  private leadDriverId = '';
  private scroll: ScrollState = { offset: 0, max: 0 };

  private onWheel = (ev: WheelEvent): void => {
    if (this.modal.open) return;
    ev.preventDefault();
    wheelScroll(this.scroll, ev.deltaY);
  };

  constructor(discipline: DisciplineId) {
    this.discipline = discipline;
  }

  enter(): void {
    onSceneEnter();
    this.modal.open = false;
    this.lineupModalOpen = false;
    this.pendingTournamentId = null;
    this.scroll.offset = 0;
    getGameContext().canvas.addEventListener('wheel', this.onWheel, { passive: false });
  }

  exit(): void {
    getGameContext().canvas.removeEventListener('wheel', this.onWheel);
  }

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
    this.modal = {
      open: true,
      title: 'Select Lineup',
      body: `Pick ${teamSize} driver${teamSize > 1 ? 's' : ''} for this series.\nTap drivers to toggle.`,
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

  render(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const g = getGameContext();
    const state = g.state;
    if (state === null) return;

    const accent = disciplineAccent(this.discipline);
    const { ui, token } = buildUi(w, h, 0, accent);
    drawBackground(ctx, w, h, token);

    const hh = headerHeight(token);
    const header = {
      x: 0,
      y: 0,
      w,
      h: hh + token.safe.top,
      title: `${disciplineLabel(this.discipline)} Campaign`,
      back: true,
      cash: state.cash,
      onBack: () => g.scenes.back(),
    };
    drawHeader(ctx, header, ui);

    const contentTop = hh + token.safe.top + pad(token);
    const contentBottom = h - token.safe.bottom - pad(token);
    const contentX = pad(token, 2) + token.safe.left;
    const contentW = w - pad(token, 4) - token.safe.left - token.safe.right;
    const btnH = ensureMinTouch(pad(token, 5.5), token);
    const objGap = pad(token, 0.5);

    // Layout in content space (y=0 at top of scrollable region)
    let contentH = 0;
    const heroH = pad(token, 12);
    contentH += heroH + pad(token, 1.5);
    contentH += token.fontCaption + pad(token, 0.75); // objectives title
    const objH = pad(token, 5.5);
    const objCount = Math.min(state.objectives.active.length, BALANCE.activeObjectives);
    contentH += objCount * (objH + objGap);
    contentH += pad(token, 0.75);
    contentH += token.fontCaption + pad(token, 0.75); // tournaments title
    const cardH = pad(token, 10);
    const lockedH = cardH * 0.55;
    const tournaments = this.tournamentsForDiscipline();
    const progress = this.inProgress();
    for (const t of tournaments) {
      const unlocked = state.rankUnlocked[this.discipline] >= t.rank;
      const isActive = progress?.defId === t.id;
      const locked = !unlocked && !isActive;
      contentH += (locked ? lockedH : cardH) + objGap;
    }
    contentH += pad(token);

    this.scroll.max = Math.max(0, contentH - (contentBottom - contentTop));
    clampScroll(this.scroll);

    beginClip(ctx, 0, contentTop, w, contentBottom - contentTop);
    let y = contentTop - this.scroll.offset;
    const inScroll =
      !this.modal.open &&
      ui.pointerY >= contentTop &&
      ui.pointerY <= contentBottom;

    // Quick Race — single interactive hero (kept as card: primary CTA)
    drawCard(ctx, { x: contentX, y, w: contentW, h: heroH }, ui);
    ctx.save();
    ctx.font = `700 ${token.fontTitle}px ${token.fontDisplayFamily}`;
    ctx.fillStyle = token.text;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('Quick Race', contentX + pad(token, 1.5), y + pad(token, 1.5));
    ctx.font = `${token.fontBody}px ${token.fontFamily}`;
    ctx.fillStyle = token.textMuted;
    ctx.fillText('Jump in for cash and XP', contentX + pad(token, 1.5), y + pad(token, 1.5) + token.fontTitle);
    ctx.restore();

    const startBtn: ButtonDef = {
      x: contentX + contentW - pad(token, 1.5) - pad(token, 12),
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
    drawButton(ctx, startBtn, ui);
    if (inScroll) handleButton(startBtn, ui);
    y += heroH + pad(token, 1.5);

    y += drawSectionTitle(ctx, contentX, y, 'Objectives', ui);

    for (const objId of state.objectives.active.slice(0, BALANCE.activeObjectives)) {
      const def = getObjectiveDef(objId);
      drawRow(ctx, { x: contentX, y, w: contentW, h: objH }, ui);
      ctx.save();
      ctx.font = `600 ${token.fontBody}px ${token.fontFamily}`;
      ctx.fillStyle = token.text;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(def?.title ?? objId, contentX + pad(token, 1), y + objH * 0.35);
      ctx.font = `${token.fontCaption}px ${token.fontFamily}`;
      ctx.fillStyle = token.textDim;
      ctx.fillText(def?.description ?? '', contentX + pad(token, 1), y + objH * 0.68);
      ctx.font = `700 ${token.fontCaption}px ${token.fontDisplayFamily}`;
      ctx.fillStyle = accent;
      ctx.textAlign = 'right';
      ctx.fillText(`$${def?.reward ?? 0}`, contentX + contentW - pad(token, 1), y + objH * 0.5);
      ctx.restore();
      y += objH + objGap;
    }

    y += pad(token, 0.75);
    y += drawSectionTitle(ctx, contentX, y, 'Tournaments', ui);

    for (const t of tournaments) {
      const rank = t.rank as RankId;
      const unlocked = state.rankUnlocked[this.discipline] >= rank;
      const isActive = progress?.defId === t.id;
      const locked = !unlocked && !isActive;

      // Interactive series cards kept; locked rows stay quieter
      if (locked) {
        drawRow(ctx, { x: contentX, y, w: contentW, h: lockedH }, ui);
        ctx.save();
        ctx.font = `600 ${token.fontBody}px ${token.fontFamily}`;
        ctx.fillStyle = token.disabled;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(t.name, contentX + pad(token, 1), y + lockedH * 0.5);
        ctx.font = `${token.fontCaption}px ${token.fontFamily}`;
        ctx.fillStyle = token.disabled;
        ctx.textAlign = 'right';
        ctx.fillText('Locked', contentX + contentW - pad(token, 1), y + lockedH * 0.5);
        ctx.restore();
        y += lockedH + objGap;
        continue;
      }

      drawCard(ctx, { x: contentX, y, w: contentW, h: cardH }, ui);
      ctx.save();
      ctx.font = `700 ${token.fontBody}px ${token.fontFamily}`;
      ctx.fillStyle = token.text;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(t.name, contentX + pad(token, 1.5), y + pad(token, 1));
      ctx.font = `${token.fontCaption}px ${token.fontFamily}`;
      ctx.fillStyle = token.textDim;
      ctx.fillText(
        `${RANK_NAMES[rank]} · ${t.races.length} races · ${t.teamSize}-car team`,
        contentX + pad(token, 1.5),
        y + pad(token, 1) + token.fontBody,
      );
      if (isActive && progress !== null) {
        ctx.fillStyle = accent;
        ctx.textAlign = 'right';
        ctx.fillText(
          `Race ${progress.raceIndex + 1}/${t.races.length}`,
          contentX + contentW - pad(token, 1.5),
          y + pad(token, 1),
        );
      }
      ctx.restore();

      const actionY = y + cardH - pad(token, 1) - btnH;
      if (isActive && progress !== null) {
        const resumeBtn: ButtonDef = {
          x: contentX + pad(token, 1.5),
          y: actionY,
          w: (contentW - pad(token, 4)) * 0.55,
          h: btnH,
          label: 'Resume',
          primary: true,
          onClick: () => this.startTournamentRace(),
        };
        const abandonBtn: ButtonDef = {
          x: contentX + pad(token, 2) + (contentW - pad(token, 4)) * 0.55,
          y: actionY,
          w: (contentW - pad(token, 4)) * 0.4,
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
        drawButton(ctx, resumeBtn, ui);
        drawButton(ctx, abandonBtn, ui);
        if (inScroll) {
          handleButton(resumeBtn, ui);
          handleButton(abandonBtn, ui);
        }
      } else if (!isActive && progress === null) {
        const enterBtn: ButtonDef = {
          x: contentX + contentW - pad(token, 1.5) - pad(token, 10),
          y: actionY,
          w: pad(token, 10),
          h: btnH,
          label: 'Enter',
          primary: true,
          onClick: () => this.openLineupPicker(t.id, t.teamSize),
        };
        drawButton(ctx, enterBtn, ui);
        if (inScroll) handleButton(enterBtn, ui);
      }

      y += cardH + objGap;
    }

    endClip(ctx);

    if (this.lineupModalOpen && this.pendingTournamentId !== null) {
      const def = TOURNAMENTS.find((t) => t.id === this.pendingTournamentId);
      if (def !== undefined) {
        const listY = h * 0.5;
        const rowH = pad(token, 5);
        let rowY = listY;
        for (const driver of state.roster) {
          const selected = this.lineupSelection.includes(driver.id);
          const isLead = driver.id === this.leadDriverId;
          if (hitRect(ui.pointerX, ui.pointerY, contentX, rowY, contentW, rowH) && ui.pointerClicked) {
            this.toggleLineupDriver(driver.id, def.teamSize);
          }
          ctx.save();
          ctx.fillStyle = selected ? `${accent}33` : 'transparent';
          ctx.fillRect(contentX, rowY, contentW, rowH);
          ctx.font = `600 ${token.fontBody}px ${token.fontFamily}`;
          ctx.fillStyle = selected ? token.text : token.textMuted;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(`${selected ? '✓ ' : ''}${driver.name}${isLead ? ' ★' : ''}`, contentX + pad(token), rowY + rowH * 0.5);
          if (selected && ui.pointerClicked && hitRect(ui.pointerX, ui.pointerY, contentX + contentW - pad(token, 8), rowY, pad(token, 8), rowH)) {
            this.leadDriverId = driver.id;
          }
          ctx.restore();
          rowY += rowH;
        }
      }
    }

    handleHeader(header, ui);
    if (this.modal.open) layoutModalButtons(this.modal, ui);
    drawModal(ctx, this.modal, ui);
    handleModal(this.modal, ui);
    this.toasts.draw(ctx, ui);
  }
}
