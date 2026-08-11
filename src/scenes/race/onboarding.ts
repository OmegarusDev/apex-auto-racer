import type { OnboardingFlags } from '../../engine/types';

export interface TickerLine {
  text: string;
  ttl: number;
}

export interface OnboardingState {
  ticker: TickerLine[];
  seenEventSeq: number;
  hintText: string | null;
  hintT: number;
  warnedDeslotLift: boolean;
}

export function createOnboardingState(): OnboardingState {
  return {
    ticker: [],
    seenEventSeq: 0,
    hintText: null,
    hintT: 0,
    warnedDeslotLift: false,
  };
}

export function showHint(
  state: OnboardingState,
  flags: OnboardingFlags,
  text: string,
  flag: keyof OnboardingFlags,
): void {
  state.hintText = text;
  state.hintT = 4.5;
  flags[flag] = true;
}

export function updateHints(state: OnboardingState, dt: number): void {
  if (state.hintT > 0) {
    state.hintT = Math.max(0, state.hintT - dt);
    if (state.hintT <= 0) state.hintText = null;
  }
}
