/**
 * Meta / career structure gates — tournament standings shape, etc.
 * Run: npm run validate:meta
 */
import { FORMATS } from '../src/data/formats.ts';
import { buildTournamentStandings } from '../src/engine/raceTypes.ts';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function main(): void {
  console.log('\n=== Meta validation ===\n');

  const format = FORMATS.find((f) => f.id === '2v2v2');
  assert(format !== undefined, '2v2v2 format missing');
  assert(format!.teamCount === 3, `2v2v2 teamCount expected 3, got ${format!.teamCount}`);

  const standings = buildTournamentStandings(format!.teamCount, [
    "Alex's Crew",
    "Blake's Crew",
  ]);
  assert(
    standings.length === format!.teamCount,
    `standings.length ${standings.length} !== teamCount ${format!.teamCount}`,
  );
  assert(standings[0]?.name === 'You' && standings[0]?.teamId === 0, 'team 0 must be You');
  assert(standings[1]?.teamId === 1, 'team 1 missing');
  assert(standings[2]?.teamId === 2, 'team 2 missing');

  const fallback = buildTournamentStandings(format!.teamCount);
  assert(fallback.length === 3, 'fallback standings length');
  assert(fallback[1]?.name === 'Rival 1', `expected Rival 1, got ${fallback[1]?.name}`);
  assert(fallback[2]?.name === 'Rival 2', `expected Rival 2, got ${fallback[2]?.name}`);

  // Points apply path: every team id from a multi-team race must map onto standings.
  const teamScores = [
    { teamId: 0, points: 10 },
    { teamId: 1, points: 6 },
    { teamId: 2, points: 4 },
  ];
  for (const ts of teamScores) {
    const entry = standings.find((s) => s.teamId === ts.teamId);
    assert(entry !== undefined, `missing standings row for team ${ts.teamId}`);
    entry!.points += ts.points;
  }
  assert(
    standings.every((s) => s.points > 0),
    'all teams should receive points',
  );

  console.log(`  META_TOURNAMENT_TEAMS: PASS — 2v2v2 standings.length=${standings.length}`);
  console.log('\nMeta validation OK\n');
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
