import type { DisciplineId } from '../data/disciplines';
import type { SlotMode } from './types';

/** Presentation-bus snapshot — sim never imports audio; RaceScene builds this. */
export interface AudioTelemetry {
  rpm: number;
  throttle: number;
  brake: number;
  gear: number;
  speed: number;
  gripUsage: number;
  slotMode: SlotMode;
  onKerb: boolean;
  discipline: DisciplineId;
  /** False when race exit / parked — full mute. */
  active: boolean;
  /** Hybrid latch / slide. */
  drifting?: boolean;
  /** Clutch-kick impulse active. */
  clutchKick?: boolean;
}

export type ShiftKind = 'up' | 'down' | 'miss';
