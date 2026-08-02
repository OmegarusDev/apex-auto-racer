/**
 * Simulate Campaign → Quick Race → Start exactly.
 * Run: ./node_modules/.bin/vite-node scripts/repro-quick-race.ts
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
  canvas: { width: 2048, height: 2048 },
});
const canvas = {
  getContext: () => makeCtx(),
  clientWidth: 390,
  clientHeight: 844,
  width: 390,
  height: 844,
  addEventListener() {},
  removeEventListener() {},
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 390, height: 844 }),
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
  devicePixelRatio: 2,
  addEventListener() {},
  location: { search: '' },
  requestAnimationFrame: () => 0,
};
g.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
g.AudioContext = class {
  sampleRate = 44100;
  state = 'running';
  currentTime = 0;
  destination = {};
  createGain() {
    return { gain: { value: 0, setTargetAtTime() {} }, connect() { return this; } };
  }
  createOscillator() {
    return { type: '', frequency: { value: 0 }, connect() { return this; }, start() {} };
  }
  createBiquadFilter() {
    return { type: '', frequency: { value: 0 }, connect() { return this; } };
  }
  createBuffer() {
    return { getChannelData: () => new Float32Array(8) };
  }
  createBufferSource() {
    return { buffer: null, loop: false, connect() { return this; }, start() {} };
  }
  resume() {
    return Promise.resolve();
  }
  suspend() {
    return Promise.resolve();
  }
};

const game = initGameContext(canvas as any);
game.state = createNewGame(mulberry32(42), 42);

// Exact navigation stack when Quick Race Start is pressed.
game.scenes.replace(new CampaignScene('track'));
for (let i = 0; i < 20; i++) game.scenes.update(0.016);

const toasts: string[] = [];
const toastMgr = {
  push: (m: string) => {
    toasts.push(m);
    console.log('TOAST:', m);
  },
} as any;

// CampaignScene Start onClick body:
const state = game.state!;
if (state.roster.length < 1) {
  console.error('FAIL: empty roster');
  process.exit(1);
}
const config = makeQuickRaceConfig(state, 'track');
console.log('quick race config', {
  formatId: config.formatId,
  laps: config.laps,
  lineup: config.playerLineup.length,
  mode: config.mode,
});

launchRace(config, toastMgr);

const phases: Array<string | number | null | undefined> = [];
for (let i = 0; i < 400; i++) {
  game.scenes.update(0.016);
  const cur: any = game.scenes.current;
  const p = cur?.director?.countdown;
  if (phases.length === 0 || phases[phases.length - 1] !== p) phases.push(p);
}

const cur: any = game.scenes.current;
const loadingToast = toasts.some((t) => /loading/i.test(t));
const ok =
  cur?.constructor?.name === 'RaceScene' &&
  cur.director != null &&
  cur.enterError == null &&
  phases.includes(3) &&
  phases.includes('go') &&
  phases.includes(null) &&
  !loadingToast &&
  toasts.length === 0;

console.log({
  current: cur?.constructor?.name,
  director: !!cur?.director,
  enterError: cur?.enterError ?? null,
  phases,
  toasts,
  ok,
});

if (!ok) {
  console.error('FAIL: Quick Race Start did not open a playable RaceScene');
  process.exit(1);
}
console.log('PASS: Quick Race Start → RaceScene countdown → GO');
