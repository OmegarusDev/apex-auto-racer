/**
 * Rival personality regression gate.
 *
 * Two identical base drivers given different archetypes must end up with
 * distinct, archetype-appropriate stat profiles (so rivals feel different on
 * track rather than statistically identical).
 *
 * Run via `npm run validate:feel` (feel-contract RIVAL_PERSONALITIES).
 */
import { applyArchetype, getArchetype } from '../src/engine/rivals';
import type { Driver } from '../src/engine/types';

function base(): Driver {
  return {
    id: 'drv-test',
    name: 'Test',
    trait: 'grinder',
    discipline: 'track',
    color: '#ffffff',
    skill: 60,
    bravery: 60,
    focus: 60,
    determination: 60,
    xp: 0,
    level: 1,
    unspentPoints: 0,
  };
}

const bulldog = { ...base() };
applyArchetype(bulldog, getArchetype('bulldog')!);
const professor = { ...base() };
applyArchetype(professor, getArchetype('professor')!);

let ok = true;
const fail = (m: string) => {
  ok = false;
  console.error(`[rivals] FAIL: ${m}`);
};

// Bulldog brakes late / defends hard -> higher bravery, lower focus than Professor.
if (!(bulldog.bravery > professor.bravery)) fail(`bulldog bravery ${bulldog.bravery} !> professor ${professor.bravery}`);
if (!(professor.focus > bulldog.focus)) fail(`professor focus ${professor.focus} !> bulldog ${bulldog.focus}`);

// Stats stay within the valid 1..100 range.
for (const d of [bulldog, professor]) {
  for (const k of ['skill', 'bravery', 'focus', 'determination'] as const) {
    if (d[k] < 1 || d[k] > 100 || Number.isNaN(d[k])) fail(`${d.archetype ?? '?'} ${k}=${d[k]} out of range`);
  }
}

if (!ok) process.exit(1);
console.log(
  `[rivals] PASS: bulldog(bravery=${bulldog.bravery}, focus=${bulldog.focus}) vs professor(bravery=${professor.bravery}, focus=${professor.focus})`,
);
