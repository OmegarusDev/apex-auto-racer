import type { CarSimState } from './Vehicle';
import type { BrainIntentTag } from './BrainIntent';
import type { RaceEvent } from './types';
import type { DisciplineId } from '../data/disciplines';

export interface EntertainmentSnapshot {
  hype: number;
  entertainmentScore: number;
}

export interface EntertainmentTickInput {
  dt: number;
  player: CarSimState | null;
  /** |κ| at player s */
  kappaAbs: number;
  position: number;
  totalCars: number;
  draft: number;
  newEvents: readonly RaceEvent[];
  nearbyIntent: BrainIntentTag | null;
  discipline: DisciplineId;
  /** Clean upshift this frame */
  cleanUpshift: boolean;
}

/**
 * Deterministic crowd hype meter — sim-side only.
 * Build from spectacle; drain from mistakes / idle.
 */
export class EntertainmentMeter {
  hype = 0;
  entertainmentScore = 0;
  private brilliantHold = 0;

  reset(): void {
    this.hype = 0;
    this.entertainmentScore = 0;
    this.brilliantHold = 0;
  }

  snapshot(): EntertainmentSnapshot {
    return { hype: this.hype, entertainmentScore: this.entertainmentScore };
  }

  tick(input: EntertainmentTickInput): void {
    const { dt, player } = input;
    if (player === null || dt <= 0) {
      this.hype = Math.max(0, this.hype - 0.08 * Math.max(dt, 0));
      return;
    }

    let impulse = 0;
    let drain = 0.035 * dt;

    for (const ev of input.newEvents) {
      if (ev.carId !== player.id) {
        if (ev.kind === 'intent' && input.nearbyIntent !== null) {
          if (
            input.nearbyIntent === 'SHOWBOAT_RISK' ||
            input.nearbyIntent === 'PULL_OUT'
          ) {
            impulse += 0.04;
          }
        }
        continue;
      }
      switch (ev.kind) {
        case 'overtake':
          impulse += 0.22;
          break;
        case 'draftPass':
          impulse += 0.12;
          break;
        case 'finish':
          impulse += player.overtakeCount > 0 || input.position <= 3 ? 0.18 : 0.06;
          break;
        case 'deslot':
        case 'spin':
          drain += 0.28;
          break;
        case 'crash':
        case 'wallHit':
          drain += 0.18;
          break;
        case 'shift':
          if (ev.detail === 'up') impulse += 0.05;
          if (ev.detail === 'miss') drain += 0.06;
          break;
        default:
          break;
      }
    }

    if (input.cleanUpshift) impulse += 0.06;

    // Brilliant cornering: near the peg, still slotted, meaningful bend.
    const vLim = Math.max(1, player.vDeslot);
    const pace = player.v / vLim;
    const brilliant =
      player.slotMode === 'groove' &&
      input.kappaAbs >= 0.012 &&
      pace >= 0.82 &&
      pace <= 0.98 &&
      player.gripUsage >= 0.72 &&
      player.gripUsage < 1.05;
    if (brilliant) {
      this.brilliantHold += dt;
      if (this.brilliantHold > 0.35) {
        impulse += 0.11 * dt;
        this.entertainmentScore += 14 * dt;
      }
    } else {
      this.brilliantHold = Math.max(0, this.brilliantHold - dt * 2);
    }

    // Close racing / draft tow
    if (input.draft > 0.35) {
      impulse += 0.04 * dt * input.draft;
    }

    // Pin without payoff in bends
    if (
      input.kappaAbs >= 0.012 &&
      player.throttle > 0.85 &&
      player.brake < 0.08 &&
      player.slotMode === 'groove' &&
      pace > 1.02
    ) {
      drain += 0.05 * dt;
    }

    // Idle mid-pack
    if (
      player.throttle < 0.08 &&
      player.brake < 0.08 &&
      input.position > 3 &&
      player.v < 8
    ) {
      drain += 0.06 * dt;
    }

    const discMult =
      input.discipline === 'track' ? 1.15 : input.discipline === 'street' ? 1 : 0.75;

    this.hype = clamp01(this.hype + impulse * discMult - drain);
    this.entertainmentScore += impulse * 40 * discMult;
    // Slow natural decay toward a floor while racing hard
    if (player.v > 12 && this.hype > 0.15) {
      this.hype = clamp01(this.hype - 0.012 * dt);
    }
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
