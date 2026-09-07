/**
 * Smoke: Race Again / Next Race must replace Results, not stack them.
 * Simulates SceneManager push/replace semantics used by launchRace.
 */
import { SceneManager, type Scene } from '../src/engine/SceneManager';

class StubScene implements Scene {
  constructor(
    readonly name: string,
    readonly raceLaunchReplace = false,
  ) {}
  enter(): void {}
  exit(): void {}
  update(): void {}
  render(): void {}
}

function drain(sm: SceneManager, frames = 20): void {
  for (let i = 0; i < frames; i++) sm.update(0.05);
}

function launch(sm: SceneManager, race: StubScene): void {
  if (sm.current?.raceLaunchReplace) sm.replace(race);
  else sm.push(race);
}

const sm = new SceneManager();
sm.replace(new StubScene('campaign'));
drain(sm);

launch(sm, new StubScene('race-1'));
drain(sm);
sm.replace(new StubScene('results-1', true));
drain(sm);

for (let i = 0; i < 10; i++) {
  launch(sm, new StubScene(`race-${i + 2}`));
  drain(sm);
  sm.replace(new StubScene(`results-${i + 2}`, true));
  drain(sm);
}

const depth = sm.depth;
const top = (sm.current as StubScene | null)?.name ?? 'null';
if (depth !== 2) {
  console.error(`FAIL: expected stack depth 2 (campaign+results), got ${depth}, top=${top}`);
  process.exit(1);
}
if (!top.startsWith('results-')) {
  console.error(`FAIL: expected Results on top, got ${top}`);
  process.exit(1);
}

const sm2 = new SceneManager();
sm2.replace(new StubScene('title'));
drain(sm2);
sm2.push(new StubScene('hub'));
drain(sm2);
sm2.push(new StubScene('options'));
drain(sm2);
sm2.replaceRoot(new StubScene('discipline'));
drain(sm2);
if (sm2.depth !== 1 || (sm2.current as StubScene | null)?.name !== 'discipline') {
  console.error(
    `FAIL: replaceRoot expected depth 1 discipline, got depth=${sm2.depth} top=${(sm2.current as StubScene | null)?.name}`,
  );
  process.exit(1);
}

console.log(`PASS: stack depth=${depth}, top=${top} after 10× Race Again`);
console.log('PASS: replaceRoot clears the stack');
