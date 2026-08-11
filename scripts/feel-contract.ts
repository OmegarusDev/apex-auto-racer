/**
 * Feel contract — named Scalextric gates + existing validate suites.
 * Run: npm run validate:feel
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runAuthorityGates, runTyreGates, runTrackScaleGates } from '../src/engine/feel/unitGates.ts';
import { runHarnessGates } from '../src/engine/feel/harnessGates.ts';
import { runDisciplineGates } from '../src/engine/feel/disciplineGates.ts';
import { runHybridGates } from '../src/engine/feel/hybridGates.ts';
import type { FeelGateResult } from '../src/engine/feel/types.ts';
import { runDeterminismCheck } from '../src/engine/RaceDirector.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function runSuite(
  id: FeelGateResult['id'],
  script: string,
): FeelGateResult {
  const viteNode = path.join(root, 'node_modules', '.bin', 'vite-node');
  const r = spawnSync(viteNode, [script], { cwd: root, encoding: 'utf8' });
  const ok = r.status === 0;
  const tail = (r.stdout || r.stderr || '').trim().split('\n').slice(-3).join(' | ');
  return { id, ok, detail: ok ? 'suite exit 0' : `exit ${r.status}: ${tail}` };
}

async function main() {
  console.log('\n=== Feel contract ===\n');

  const results: FeelGateResult[] = [
    ...runAuthorityGates(),
    ...runTyreGates(),
    ...runTrackScaleGates(),
    ...runHarnessGates(),
    ...runDisciplineGates(),
    ...runHybridGates(),
    {
      id: 'DETERMINISM',
      ok: runDeterminismCheck(),
      detail: 'runDeterminismCheck',
    },
    runSuite('SUITE_START', 'scripts/start-validate.ts'),
    runSuite('SUITE_SLOT', 'scripts/scalextric-validate.ts'),
    runSuite('SUITE_PACK', 'scripts/collision-validate.ts'),
    runSuite('SUITE_FIELD', 'scripts/field-validate.ts'),
    runSuite('SUITE_SMOKE', 'scripts/smoke.ts'),
    runSuite('SUITE_STACK', 'scripts/stack-smoke.ts'),
    runSuite('STORY_INTENT_DENSITY', 'scripts/intent-validate.ts'),
    runSuite('META_TOURNAMENT_TEAMS', 'scripts/meta-validate.ts'),
  ];

  let failed = 0;
  for (const r of results) {
    const mark = r.ok ? 'PASS' : 'FAIL';
    if (!r.ok) failed += 1;
    console.log(`  ${r.id}: ${mark} — ${r.detail}`);
  }
  console.log(`\n${results.length - failed}/${results.length} gates passed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
