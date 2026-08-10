import { PHYSICS } from './data/physics';
import { AudioEngine } from './audio/AudioEngine';
import { initGameContext } from './engine/GameContext';
import { TitleScene } from './scenes/TitleScene';
import { validateRegistry } from './data/validate';
import { bootDeterminismCheck } from './engine/determinismBoot';
import { invalidateSafeArea } from './ui/theme';

function setupCanvas(canvas: HTMLCanvasElement): { w: number; h: number; dpr: number } {
  const dpr = Math.min(window.devicePixelRatio || 1, PHYSICS.dprCap);
  const vv = window.visualViewport;
  const w = Math.max(1, Math.floor(vv?.width ?? canvas.clientWidth));
  const h = Math.max(1, Math.floor(vv?.height ?? canvas.clientHeight));
  // Keep CSS size in sync with visual viewport (mobile URL bar).
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  canvas.width = Math.max(1, Math.floor(w * dpr));
  canvas.height = Math.max(1, Math.floor(h * dpr));
  const ctx = canvas.getContext('2d');
  if (ctx !== null) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  return { w, h, dpr };
}

function hideSplash(): void {
  const splash = document.querySelector<HTMLElement>('#splash');
  if (splash === null) return;
  splash.style.opacity = '0';
  window.setTimeout(() => splash.remove(), 400);
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
  hideSplash();

  let visible = !document.hidden;
  let lastTs = 0;

  const resize = (): void => {
    invalidateSafeArea();
    const dims = setupCanvas(canvas);
    game.scenes.onResize(dims.w, dims.h);
  };

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', resize);
    window.visualViewport.addEventListener('scroll', resize);
  }
  resize();

  document.addEventListener('visibilitychange', () => {
    visible = !document.hidden;
    if (visible) {
      void audio.resume();
      resize();
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
