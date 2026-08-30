/**
 * Driver-follow regression gate.
 *
 * Reproduces the "beginner drives straight off at low speed in a tight corner"
 * bug: a low-skill driver (steering is brain-owned even for the player car) on a
 * tight rally loop with a flat-out pedal trace must still complete the laps. If
 * the brain fails to initiate the turn early enough, the car deslots and never
 * recovers → no finishTime → gate fails.
 *
 * Run via: npm run validate:feel (wired as DRIVER_FOLLOWS_TIGHT)
 */
import { runHeadless } from '../src/engine/race/headless';
import { FORMATS } from '../src/data/formats';
import { defaultVehicleSave } from '../src/engine/types';

function lowSkillDriver() {
  return {
    id: 'rookie',
    name: 'Rookie',
    trait: 'grinder' as const,
    discipline: 'rally' as const,
    color: '#f0c41a',
    skill: 18,
    bravery: 50,
    focus: 50,
    determination: 50,
    xp: 0,
    level: 1,
    unspentPoints: 0,
  };
}

const config = {
  discipline: 'rally' as const,
  trackSeed: 123_456, // rallyLoop — tight corners
  raceSeed: 777,
  laps: 2,
  format: FORMATS.find((f) => f.id === 'tt')!,
  playerTeamDrivers: [lowSkillDriver()],
  leadDriverId: 'rookie',
  playerVehicle: defaultVehicleSave(2),
  opponentBudget: [120, 180],
  opponentPartRange: [1, 2],
};

// Flat-out pedal trace: the brain owns braking + steering, so this purely tests
// whether a low-skill driver can follow the known line through tight corners.
const trace = [
  { time: 0, throttle: 1, brake: 0 },
  { time: 9999, throttle: 1, brake: 0 },
];

const result = runHeadless(config, trace, 50);
const entry = result.positions[0];
const finished = entry !== undefined && Number.isFinite(entry.finishTime) && entry.finishTime > 0;

console.log(
  `low-skill rookie (skill 18) on tight rally loop: ` +
    (finished ? `finished lap(s) in ${entry!.finishTime.toFixed(1)}s` : 'DID NOT FINISH'),
);

if (!finished) {
  console.error('FAIL: low-skill driver failed to follow tight corners (drove off / stuck).');
  process.exit(1);
}
console.log('PASS: low-skill driver follows tight corners without driving off');
