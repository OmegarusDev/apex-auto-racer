import { PHYSICS } from './data/physics';
import { AudioEngine } from './audio/AudioEngine';
import { initGameContext } from './engine/GameContext';
import { TitleScene } from './scenes/TitleScene';
import { validateRegistry } from './data/validate';
import { bootDeterminismCheck } from './engine/determinismBoot';

function setupCanvas(canvas: HTMLCanvasElement): { w: number; h: number; dpr: number } {
  const dpr = Math.min(window.devicePixelRatio || 1, PHYSICS.dprCap);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = Math.max(1, Math.floor(w * dpr));
  canvas.height = Math.max(1, Math.floor(h * dpr));
  const ctx = canvas.getContext('2d');
  if (ctx !== null) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  return { w, h, dpr };
}

function main(): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#game');
  if (canvas === null) {
    throw new Error('Missing canvas#game');
  }

  if (import.meta.env.DEV) {
    const errors = validateRegistry();
    if (errors.length > 0) {
      console.warn('[apex] registry validation:', errors);
    } else {
      console.info('[apex] registry validation: ok');
    }
    bootDeterminismCheck();
  }

  const audio = new AudioEngine();
  const game = initGameContext(canvas, audio);
  game.bootstrap();
  game.scenes.replace(new TitleScene());

  let visible = !document.hidden;
  let lastTs = 0;

  const resize = (): void => {
    const dims = setupCanvas(canvas);
    game.scenes.onResize(dims.w, dims.h);
  };

  window.addEventListener('resize', resize);
  resize();

  document.addEventListener('visibilitychange', () => {
    visible = !document.hidden;
    if (visible) {
      void audio.resume();
    } else {
      void audio.suspend();
    }
  });

  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      game.scenes.handleBack();
    }
  });

  const loop = (ts: number): void => {
    requestAnimationFrame(loop);
    if (!visible) return;

    const dt = lastTs === 0 ? 0 : Math.min(0.05, (ts - lastTs) / 1000);
    lastTs = ts;

    game.input.update(dt);
    game.scenes.update(dt);

    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    game.ctx.clearRect(0, 0, w, h);
    game.scenes.render(game.ctx, w, h);
  };

  requestAnimationFrame(loop);
}

main();
