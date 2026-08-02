/**
 * Simulate browser-ish dynamic import of RaceScene after sceneUtils is loaded.
 */
import { makeQuickRaceConfig, launchRace } from '../src/scenes/sceneUtils.ts';
import { createNewGame } from '../src/engine/SaveManager.ts';
import { mulberry32 } from '../src/engine/rng.ts';
import { initGameContext } from '../src/engine/GameContext.ts';
import { SceneManager } from '../src/engine/SceneManager.ts';

// Minimal DOM stubs for module side effects
const g: any = globalThis as any;
if (typeof g.document === 'undefined') {
  const canvas = {
    getContext: () => ({
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
    }),
    clientWidth: 800,
    clientHeight: 600,
    width: 800,
    height: 600,
    addEventListener() {},
    removeEventListener() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
  };
  g.document = {
    createElement: (tag: string) => (tag === 'canvas' ? { ...canvas, getContext: canvas.getContext } : {}),
    querySelector: () => canvas,
    addEventListener() {},
    hidden: false,
  };
  g.window = {
    devicePixelRatio: 1,
    addEventListener() {},
    location: { search: '' },
    requestAnimationFrame: (cb: any) => setTimeout(() => cb(performance.now()), 16),
  };
  g.HTMLCanvasElement = function () {};
  g.AudioContext = undefined;
  g.webkitAudioContext = undefined;
  // localStorage stub
  const store = new Map();
  g.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  };
}

const canvas = document.querySelector('#game') as any;
const game = initGameContext(canvas as any);
const state = createNewGame(mulberry32(42), 42);
game.state = state;

class DummyScene {
  enter() { console.log('dummy enter'); }
  exit() {}
  update() {}
  render() {}
}
game.scenes.replace(new DummyScene() as any);

// Advance fade so stack has dummy
for (let i = 0; i < 20; i++) game.scenes.update(0.016);

const config = makeQuickRaceConfig(state, 'track');
console.log('config', config.formatId, config.laps, config.playerLineup.length);

const toasts = { push: (msg: string) => console.log('TOAST', msg) } as any;

console.log('launching...');
await launchRace(config, toasts);
console.log('launch returned, depth', game.scenes.depth);

// Advance through fadeOut into RaceScene.enter
for (let i = 0; i < 30; i++) {
  try {
    game.scenes.update(0.016);
  } catch (e) {
    console.error('UPDATE THROW', e);
    break;
  }
}
const cur: any = game.scenes.current;
console.log('current', cur?.constructor?.name, 'director', cur?.director != null, 'countdown', cur?.director?.countdown);
