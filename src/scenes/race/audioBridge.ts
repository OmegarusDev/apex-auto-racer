import type { CountdownPhase } from '../../engine/RaceDirector';

/** Countdown beep / go — returns updated prev phase. */
export function updateCountdownAudio(
  audio: {
    playCountdown: (n: number) => void;
    playGo: () => void;
  },
  phase: CountdownPhase,
  prevCountdown: CountdownPhase | undefined,
): CountdownPhase | undefined {
  if (phase === prevCountdown) return prevCountdown;
  if (phase === 3 || phase === 2 || phase === 1) {
    audio.playCountdown(phase);
  } else if (phase === 'go') {
    audio.playGo();
  }
  return phase;
}
