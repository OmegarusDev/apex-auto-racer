/**
 * Qualifying regression gate.
 *
 * Asserts the grid is ordered by qualifying score (driver ability + car pace),
 * not a random shuffle. A strong driver in a fast car must out-qualify a weak
 * driver in a slow car.
 *
 * Run via `npm run validate:feel` (feel-contract QUALIFYING_SORTED).
 */
import { qualiScore } from '../src/engine/race/fieldSetup';
import type { Driver, VehicleParts } from '../src/engine/types';

function partTiers(avg: number): VehicleParts {
  return {
    engine: avg,
    intake: avg,
    exhaust: avg,
    tyres: avg,
    brakes: avg,
    suspension: avg,
    spoiler: avg,
    clutch: avg,
    gearbox: avg,
    differential: avg,
  };
}

function driver(id: string, skill: number): Driver {
  // Minimal Driver satisfying qualiScore's driverStrength01 inputs.
  return {
    id,
    name: id,
    discipline: 'track',
    color: '#fff',
    level: 1,
    xp: 0,
    skill,
    bravery: skill,
    focus: skill,
    determination: skill,
    consistency: skill,
    reactions: skill,
    composure: skill,
    racecraft: skill,
    adaptability: skill,
    aggression: skill,
    traits: [],
  } as unknown as Driver;
}

const LO = 200;
const HI = 480;

const fastStrong: VehicleParts = partTiers(6);
const slowWeak: VehicleParts = partTiers(0);

const strongDriver = driver('strong', 90);
const weakDriver = driver('weak', 30);

const plans = [
  { driver: weakDriver, parts: slowWeak },
  { driver: strongDriver, parts: fastStrong },
];

const ordered = [...plans].sort((a, b) => qualiScore(b, LO, HI) - qualiScore(a, LO, HI));
const top = ordered[0]!;
const ok = top.driver.id === 'strong';

if (!ok) {
  console.error('[qualifying] FAIL: strongest driver did not take pole');
  process.exit(1);
}

const sStrong = qualiScore({ driver: strongDriver, parts: fastStrong }, LO, HI);
const sWeak = qualiScore({ driver: weakDriver, parts: slowWeak }, LO, HI);
if (!(sStrong > sWeak)) {
  console.error('[qualifying] FAIL: strong+fast not scored above weak+slow');
  process.exit(1);
}

console.log(`[qualifying] PASS: pole=strong (${sStrong.toFixed(3)} > ${sWeak.toFixed(3)})`);
