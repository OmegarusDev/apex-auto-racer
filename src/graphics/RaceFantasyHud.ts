/**
 * Presentation-only race fantasy chrome — peg meter, shift cue, pre-race card.
 * Reads CarSim telemetry; never writes physics.
 */

import { PHYSICS } from '../data/physics';
import type { DisciplineId } from '../data/disciplines';
import { getDiscipline } from '../data/disciplines';
import { gearBandFrac, gearboxFor } from '../engine/Gearbox';
import type { CarSimState } from '../engine/Vehicle';
import { computePinAuthorityBlend } from '../engine/Vehicle';
import { pad, type ThemeTokens } from '../ui/theme';

export function pegRatio(car: CarSimState): number {
  return car.v / Math.max(car.vDeslot, 1);
}

export function playerGearBand(car: CarSimState, discipline: DisciplineId): number {
  const box = gearboxFor(discipline);
  return gearBandFrac(car.v, car.stats.vMax, car.gear, box);
}

export function wantsShiftCue(car: CarSimState, discipline: DisciplineId): boolean {
  const box = gearboxFor(discipline);
  if (car.gear >= box.gearCount) return false;
  const band = playerGearBand(car, discipline);
  // Manual upshift reminder once the band will accept Shift — gas or not.
  // Pin-throttle players also get the cue so they know a Shift is the fast path.
  return band >= box.earlyUpshiftBand && car.v > 1;
}

/** Draw compact v / v_deslot peg bar under speed. Returns height used. */
export function drawPegMeter(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  car: CarSimState,
  token: ThemeTokens,
  accent: string,
): number {
  const ratio = pegRatio(car);
  const barH = Math.max(5, pad(token, 0.55));
  const labelH = token.fontCaption + pad(token, 0.25);
  ctx.save();
  ctx.font = `600 ${token.fontCaption}px ${token.fontDisplayFamily}`;
  ctx.fillStyle = token.textDim;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('GROOVE', x, y);
  ctx.textAlign = 'right';
  const pct = Math.round(Math.min(1.35, ratio) * 100);
  ctx.fillStyle =
    ratio >= 1 ? token.danger : ratio >= 0.9 ? '#f0c41a' : token.textMuted;
  ctx.fillText(`${pct}%`, x + w, y);

  const trackY = y + labelH;
  ctx.fillStyle = token.card;
  ctx.fillRect(x, trackY, w, barH);
  const fill = Math.max(0.02, Math.min(1, ratio));
  ctx.fillStyle = ratio >= 1 ? token.danger : ratio >= 0.9 ? '#f0c41a' : accent;
  ctx.fillRect(x, trackY, w * Math.min(1, fill), barH);
  // Soft overshoot tick
  if (ratio > 1) {
    ctx.fillStyle = 'rgba(255,107,90,0.45)';
    ctx.fillRect(x + w - 2, trackY - 1, 2, barH + 2);
  }
  ctx.restore();
  return labelH + barH + pad(token, 0.5);
}

export function drawPreRaceCard(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  token: ThemeTokens,
  accent: string,
  opts: {
    discipline: DisciplineId;
    laps: number;
    rain: boolean;
    night: boolean;
    driverName: string;
    traitName: string;
    phase: 3 | 2 | 1 | 'go' | null;
    partTiers?: import('../engine/types').VehicleParts;
    session?: 'race' | 'timeTrial' | 'sprint';
  },
): void {
  // Only on the first countdown beat so the big numeral has room.
  if (opts.phase !== 3) return;
  const def = getDiscipline(opts.discipline);
  const cardW = Math.min(w - pad(token, 4), pad(token, 34));
  const lineH = token.fontCaption * 1.35;
  const cardH = pad(token, 2) + token.fontTitle + pad(token, 0.5) + token.fontBody + lineH + pad(token, 1.5);
  const x = (w - cardW) * 0.5;
  // Sit high — leave the mid-screen clear for the countdown numeral.
  const y = Math.max(token.safe.top + pad(token, 1), h * 0.1);

  ctx.save();
  ctx.globalAlpha = 0.94;
  ctx.fillStyle = 'rgba(10,10,14,0.82)';
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(x, y, cardW, cardH, pad(token, 0.75));
  ctx.fill();
  ctx.stroke();

  let ty = y + pad(token, 1);
  ctx.font = `800 ${token.fontTitle}px ${token.fontDisplayFamily}`;
  ctx.fillStyle = accent;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(def.name.toUpperCase(), x + cardW * 0.5, ty);
  ty += token.fontTitle + pad(token, 0.4);

  ctx.font = `600 ${token.fontBody}px ${token.fontFamily}`;
  ctx.fillStyle = token.text;
  const sessionLabel =
    opts.session === 'sprint'
      ? 'SPRINT'
      : opts.session === 'timeTrial'
        ? 'TIME TRIAL'
        : `${opts.laps} lap${opts.laps === 1 ? '' : 's'}`;
  const driverLine = `${sessionLabel} · ${opts.driverName}`;
  // Soft truncate long driver names.
  let shown = driverLine;
  const maxW = cardW - pad(token, 3);
  if (ctx.measureText(shown).width > maxW) {
    let t = opts.driverName;
    while (t.length > 2 && ctx.measureText(`${sessionLabel} · ${t}…`).width > maxW) {
      t = t.slice(0, -1);
    }
    shown = `${sessionLabel} · ${t}…`;
  }
  ctx.fillText(shown, x + cardW * 0.5, ty);
  ty += token.fontBody + pad(token, 0.35);

  ctx.font = `500 ${token.fontCaption}px ${token.fontFamily}`;
  ctx.fillStyle = token.textMuted;
  const bits = [opts.traitName];
  if (opts.rain) bits.push('Rain');
  if (opts.night) bits.push('Night');
  bits.push('SHIFT up · lift down');
  let footer = bits.join(' · ');
  if (ctx.measureText(footer).width > maxW) {
    footer = bits.slice(0, Math.min(3, bits.length)).join(' · ');
  }
  ctx.fillText(footer, x + cardW * 0.5, ty);
  ctx.restore();
}

export function sampleKappaAt(trackNodes: readonly { s: number; kappaLine?: number; kappa?: number }[], s: number): number {
  let kappa = 0;
  for (const n of trackNodes) {
    if (n.s <= s) kappa = n.kappaLine ?? n.kappa ?? 0;
  }
  return kappa;
}

export function nearDeslotThreat(
  car: CarSimState,
  kappa: number,
): boolean {
  if (car.slotMode !== 'groove') return false;
  if (Math.abs(kappa) < PHYSICS.grooveKappaMin) return false;
  const r = pegRatio(car);
  return r >= 0.9 && r < 1.02;
}

export function shouldTeachAuthority(
  skill: number,
  car: CarSimState,
  kappa: number,
): boolean {
  if (skill < 50) return false;
  if (car.slotMode !== 'groove') return false;
  if (Math.abs(kappa) < PHYSICS.grooveKappaMin) return false;
  const pin = computePinAuthorityBlend(skill, car.throttle, car.brake);
  return pin.pinOverrule && pegRatio(car) >= 0.88;
}
