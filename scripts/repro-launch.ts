/**
 * End-to-end: Campaign-style Quick Race config → launchRace → countdown → GO.
 * Run: ./node_modules/.bin/vite-node scripts/repro-launch.ts
 */
import { CampaignScene } from '../src/scenes/CampaignScene.ts';
import { launchRace, makeQuickRaceConfig } from '../src/scenes/sceneUtils.ts';
import { createNewGame } from '../src/engine/SaveManager.ts';
import { mulberry32 } from '../src/engine/rng.ts';
import { initGameContext } from '../src/engine/GameContext.ts';

const g: any = globalThis as any;
const makeCtx = () => ({
  setTransform() {},
  clearRect() {},
  fillRect() {},
  drawImage() {},
  save() {},
  restore() {},
  beginPath() {},
  moveTo() {},
  lineTo() {},
  closePath() {},
  stroke() {},
  fill() {},
  fillText() {},
  measureText: () => ({ width: 10 }),
  createLinearGradient: () => ({ addColorStop() {} }),
  setLineDash() {},
  canvas: { width: 800, height: 600 },
});
const canvas = {
  getContext: () => makeCtx(),
  clientWidth: 800,
  clientHeight: 600,
  width: 800,
  height: 600,
  addEventListener() {},
  removeEventListener() {},
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
};
g.document = {
  createElement: (tag: string) =>
    tag === 'canvas'
      ? { ...canvas, width: 2048, height: 2048, getContext: () => makeCtx() }
      : {},
  querySelector: () => canvas,
  addEventListener() {},
  hidden: false,
};
g.window = {
  devicePixelRatio: 1,
  addEventListener() {},
  location: { search: '' },
  requestAnimationFrame: () => 0,
};
g.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const game = initGameContext(canvas as any);
game.state = createNewGame(mulberry32(42), 42);

// Mimic real navigation stack: Campaign is current when Start is pressed.
game.scenes.replace(new CampaignScene('track'));
for (let i = 0; i < 20; i++) game.scenes.update(0.016);

const toasts: string[] = [];
const toastMgr = {
  push: (m: string) => {
    toasts.push(m);
    console.log('TOAST:', m);
  },
} as any;

const t0 = performance.now();
const config = makeQuickRaceConfig(game.state, 'track');
console.log('config', {
  formatId: config.formatId,
  laps: config.laps,
  lineup: config.playerLineup.length,
});
launchRace(config, toastMgr);
const launchMs = performance.now() - t0;

const phases: Array<string | number | null | undefined> = [];
for (let i = 0; i < 400; i++) {
  game.scenes.update(0.016);
  const cur: any = game.scenes.current;
  const p = cur?.director?.countdown;
  if (phases.length === 0 || phases[phases.length - 1] !== p) phases.push(p);
}

const cur: any = game.scenes.current;
const ok =
  cur?.constructor?.name === 'RaceScene' &&
  cur.director != null &&
  phases.includes(3) &&
  phases.includes('go') &&
  phases.includes(null) &&
  toasts.length === 0;

console.log({
  launchMs: launchMs.toFixed(1),
  current: cur?.constructor?.name,
  director: !!cur?.director,
  phases,
  toasts,
  ok,
});
if (!ok) process.exit(1);
console.log('PASS: Campaign Start → RaceScene countdown → GO');
