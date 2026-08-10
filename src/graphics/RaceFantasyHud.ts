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
  // Optional early-nudge window — not a mandatory shift alarm.
  return (
    band >= box.earlyUpshiftBand &&
    band < box.autoUpshiftBand &&
    car.throttle > 0.45
  );
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
  ctx.fillText('PEG', x, y);
  ctx.textAlign = 'right';
  const pct = Math.round(Math.min(1.35, ratio) * 100);
  ctx.fillStyle =
    ratio >= 1 ? token.danger : ratio >= 0.9 ? '#fbbf24' : token.textMuted;
  ctx.fillText(`${pct}%`, x + w, y);

  const trackY = y + labelH;
  ctx.fillStyle = token.card;
  ctx.fillRect(x, trackY, w, barH);
  const fill = Math.max(0.02, Math.min(1, ratio));
  ctx.fillStyle = ratio >= 1 ? token.danger : ratio >= 0.9 ? '#fbbf24' : accent;
  ctx.fillRect(x, trackY, w * Math.min(1, fill), barH);
  // Soft overshoot tick
  if (ratio > 1) {
    ctx.fillStyle = 'rgba(248,113,113,0.45)';
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
  },
): void {
  if (opts.phase !== 3 && opts.phase !== 2) return;
  const def = getDiscipline(opts.discipline);
  const cardW = Math.min(w - pad(token, 4), pad(token, 36));
  const cardH = pad(token, 14);
  const x = (w - cardW) * 0.5;
  const y = h * 0.18;

  ctx.save();
  ctx.globalAlpha = opts.phase === 3 ? 0.96 : 0.55;
  ctx.fillStyle = 'rgba(10,10,14,0.82)';
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(x, y, cardW, cardH, pad(token, 0.75));
  ctx.fill();
  ctx.stroke();

  ctx.font = `800 ${token.fontTitle}px ${token.fontDisplayFamily}`;
  ctx.fillStyle = accent;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(def.name.toUpperCase(), x + cardW * 0.5, y + pad(token, 1.25));

  ctx.font = `600 ${token.fontBody}px ${token.fontFamily}`;
  ctx.fillStyle = token.text;
  ctx.fillText(
    `${opts.laps} lap${opts.laps === 1 ? '' : 's'} · ${opts.driverName}`,
    x + cardW * 0.5,
    y + pad(token, 1.25) + token.fontTitle + pad(token, 0.5),
  );

  ctx.font = `500 ${token.fontCaption}px ${token.fontFamily}`;
  ctx.fillStyle = token.textMuted;
  const bits = [opts.traitName];
  if (opts.rain) bits.push('Rain');
  if (opts.night) bits.push('Night');
  bits.push('Gears auto · Shift early optional');
  ctx.fillText(bits.join(' · '), x + cardW * 0.5, y + cardH - pad(token, 2) - token.fontCaption);
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
