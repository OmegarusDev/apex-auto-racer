import { runDeterminismCheck } from './RaceDirector';

/** Dev-only: verify headless races are deterministic. */
export function bootDeterminismCheck(): void {
  const ok = runDeterminismCheck();
  console.info(`[apex] determinism check: ${ok ? 'PASS' : 'FAIL'}`);
}
