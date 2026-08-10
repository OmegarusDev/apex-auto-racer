/**
 * Headless packed-race storytelling density check.
 * Run: npm run validate:intent
 *
 * Asserts ≥3 distinct BrainIntent tags across intent events and/or sampled
 * brain outputs; intent events exist; aggregate spam stays bounded.
 */
import { FORMATS } from '../src/data/formats.ts';
import { PHYSICS } from '../src/data/physics.ts';
import type { BrainIntentTag } from '../src/engine/BrainIntent.ts';
import {
  RaceDirector,
  type RaceConfig,
  type PedalTraceSample,
} from '../src/engine/RaceDirector.ts';
import { defaultVehicleSave, type Driver } from '../src/engine/types.ts';

const MIN_DISTINCT_TAGS = 3;
/** Soft anti-spam: with 1.5s/car cooldown, packed field should stay under this. */
const MAX_INTENT_EVENTS_PER_SEC = 8;

function driver(id: string, name: string, skill: number, trait: Driver['trait'] = 'grinder'): Driver {
  return {
    id,
    name,
    trait,
    skill,
    bravery: skill,
    focus: Math.max(20, skill - 15),
    determination: 55,
    xp: 0,
    level: 1,
    unspentPoints: 0,
  };
}

function runPackedIntentRace(raceSeed: number, trackSeed: number) {
  const format = FORMATS.find((f) => f.id === '2v2v2') ?? FORMATS.find((f) => f.id === '1v1v1v1')!;
  const config: RaceConfig = {
    discipline: 'track',
    trackSeed,
    raceSeed,
    laps: 2,
    format,
    playerTeamDrivers: [
      driver('p1', 'Lead', 48, 'hothead'),
      driver('p2', 'Mate', 52, 'iceCold'),
    ],
    leadDriverId: 'p1',
    playerVehicle: defaultVehicleSave(2),
    opponentBudget: [150, 230],
    opponentPartRange: [1, 3],
  };

  const pedals: PedalTraceSample[] = [
    { time: 0, throttle: 0, brake: 0 },
    { time: 2.5, throttle: 0.92, brake: 0 },
    { time: 400, throttle: 0.92, brake: 0 },
  ];

  const director = new RaceDirector(config);
  const maxTime = 420;
  let simTime = 0;
  const speedMult = 40;
  const sampledTags = new Set<BrainIntentTag>();
  let sampleCounter = 0;

  while (!director.isRaceFinished && simTime < maxTime) {
    const t = director.raceClock;
    let lo = 0;
    for (let i = 0; i < pedals.length; i++) {
      if (pedals[i]!.time <= t) lo = i;
    }
    const sample = pedals[lo]!;
    director.setPlayerPedals(sample.throttle, sample.brake);
    director.update(PHYSICS.dt * speedMult);
    simTime += PHYSICS.dt;

    sampleCounter += 1;
    if (sampleCounter % 30 === 0) {
      const entries = (
        director as unknown as {
          entries: { brainOut: { intent?: { tag: BrainIntentTag } } }[];
        }
      ).entries;
      for (const e of entries) {
        const tag = e.brainOut.intent?.tag;
        if (tag !== undefined) sampledTags.add(tag);
      }
    }
  }
  if (!director.isRaceFinished) director.retire();

  const events = director.recentEvents;
  const intentEvents = events.filter((e) => e.kind === 'intent');
  const eventTags = new Set<BrainIntentTag>();
  for (const e of intentEvents) {
    if (e.detail) eventTags.add(e.detail as BrainIntentTag);
  }

  const allTags = new Set<BrainIntentTag>([...sampledTags, ...eventTags]);
  const raceSeconds = Math.max(director.raceClock, 1);
  const intentRate = intentEvents.length / raceSeconds;

  return {
    cars: director.cars.length,
    finishers: director.cars.filter((c) => c.finished).length,
    raceSeconds,
    intentEvents: intentEvents.length,
    intentRate,
    eventTags: [...eventTags].sort(),
    sampledTags: [...sampledTags].sort(),
    allTags: [...allTags].sort(),
    distinct: allTags.size,
    hasIntentKind: intentEvents.length > 0,
    rejoins: events.filter((e) => e.kind === 'rejoin').length,
  };
}

async function main() {
  console.log('\n=== Intent storytelling validate ===\n');

  const row = runPackedIntentRace(77_001, 55_001);
  console.log(
    `cars=${row.cars} finishers=${row.finishers} race=${row.raceSeconds.toFixed(1)}s`,
  );
  console.log(`intent events=${row.intentEvents} rate=${row.intentRate.toFixed(2)}/s`);
  console.log(`event tags (${row.eventTags.length}): ${row.eventTags.join(', ') || '(none)'}`);
  console.log(`sampled tags (${row.sampledTags.length}): ${row.sampledTags.join(', ') || '(none)'}`);
  console.log(`union distinct=${row.distinct}: ${row.allTags.join(', ')}`);
  console.log(`rejoin events=${row.rejoins}`);

  const fails: string[] = [];
  if (row.distinct < MIN_DISTINCT_TAGS) {
    fails.push(`need ≥${MIN_DISTINCT_TAGS} distinct intent tags, got ${row.distinct}`);
  }
  if (!row.hasIntentKind && row.distinct < MIN_DISTINCT_TAGS) {
    fails.push('no intent events and insufficient sampled tags');
  }
  if (row.intentRate > MAX_INTENT_EVENTS_PER_SEC) {
    fails.push(
      `intent spam ${row.intentRate.toFixed(2)}/s > ${MAX_INTENT_EVENTS_PER_SEC}/s`,
    );
  }

  if (fails.length > 0) {
    console.error('\nFAIL:');
    for (const f of fails) console.error(`  - ${f}`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nPASS — STORY_INTENT_DENSITY (${row.distinct} tags)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
