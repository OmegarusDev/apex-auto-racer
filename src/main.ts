import { PRESENT } from './data/present';
import { AudioEngine } from './audio/AudioEngine';
import { initGameContext } from './engine/GameContext';
import { TitleScene } from './scenes/TitleScene';
import { validateRegistry } from './data/validate';
import { bootDeterminismCheck } from './engine/determinismBoot';
import { invalidateSafeArea } from './ui/theme';

function setupHudCanvas(canvas: HTMLCanvasElement): { w: number; h: number; dpr: number } {
  const dpr = Math.min(window.devicePixelRatio || 1, PRESENT.dprCap);
  const vv = window.visualViewport;
  const w = Math.max(1, Math.floor(vv?.width ?? canvas.clientWidth));
  const h = Math.max(1, Math.floor(vv?.height ?? canvas.clientHeight));
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  canvas.width = Math.max(1, Math.floor(w * dpr));
  canvas.height = Math.max(1, Math.floor(h * dpr));
  const ctx = canvas.getContext('2d', { alpha: true });
  if (ctx !== null) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  return { w, h, dpr };
}

function setupWorldCanvas(canvas: HTMLCanvasElement, w: number, h: number, dpr: number): void {
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  // GL surface sizing is owned by ApexRenderer.resize — keep CSS in sync here.
  void dpr;
}

function hideSplash(): void {
  const splash = document.querySelector<HTMLElement>('#splash');
  if (splash === null) return;
  splash.dataset.apexBoot = 'done';
  splash.style.opacity = '0';
  window.setTimeout(() => splash.remove(), 400);
}

/** Never leave a dead splash: show the real error on the splash plate. */
function showBootError(err: unknown): void {
  const splash = document.querySelector<HTMLElement>('#splash');
  const message = err instanceof Error ? err.message : String(err);
  console.error('[apex] boot failed:', err);
  if (splash === null) {
    window.alert(`Apex failed to start:\n${message}`);
    return;
  }
  splash.dataset.apexBoot = 'error';
  splash.style.pointerEvents = 'auto';
  splash.style.opacity = '1';
  splash.innerHTML = '';
  const mark = document.createElement('span');
  mark.className = 'mark';
  mark.textContent = 'APEX';
  const sub = document.createElement('span');
  sub.className = 'sub';
  sub.textContent = 'BOOT FAILED';
  const detail = document.createElement('pre');
  detail.style.cssText =
    'max-width:min(92vw,42rem);margin:1.25rem 1rem 0;padding:0;white-space:pre-wrap;word-break:break-word;' +
    'font:500 12px/1.45 "IBM Plex Sans","Segoe UI",sans-serif;letter-spacing:0.02em;color:#f2efe6;opacity:0.85;text-align:center';
  detail.textContent = message;
  splash.append(mark, sub, detail);
}

function runDevBootChecks(): void {
  if (!import.meta.env.DEV) return;
  try {
    const errors = validateRegistry();
    if (errors.length > 0) {
      console.warn('[apex] registry validation:', errors);
    } else {
      console.info('[apex] registry validation: ok');
    }
    // Headless races can take seconds — never block splash/title on this.
    bootDeterminismCheck();
  } catch (err) {
    console.warn('[apex] deferred boot check failed:', err);
  }
}

function main(): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#game');
  const world = document.querySelector<HTMLCanvasElement>('#world');
  if (canvas === null) {
    throw new Error('Missing canvas#game');
  }

  const audio = new AudioEngine();
  const game = initGameContext(canvas, audio);
  game.bootstrap();
  game.scenes.replace(new TitleScene());

  let visible = !document.hidden;
  let lastTs = 0;

  const resize = (): void => {
    invalidateSafeArea();
    const dims = setupHudCanvas(canvas);
    if (world !== null) setupWorldCanvas(world, dims.w, dims.h, dims.dpr);
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
    // Transparent clear — menus paint opaque plates; race leaves GL world visible.
    game.ctx.clearRect(0, 0, w, h);
    game.scenes.render(game.ctx, w, h);
  };

  requestAnimationFrame(loop);
  // After first frame is scheduled — keep the title interactive while checks run.
  window.setTimeout(runDevBootChecks, 0);
}

// Mark module evaluation so index.html's timeout can distinguish "never loaded"
// from "main is running".
document.querySelector('#splash')?.setAttribute('data-apex-boot', 'loading');

try {
  main();
  // Gate the splash→title handoff on the brand font being ready. The HTML
  // splash uses display=block (text invisible until the font loads), and the
  // canvas title would otherwise draw with a FALLBACK font first, then pop to
  // Bebas Neue mid-title — the "font changes, then changes again" jank. One
  // clean reveal: splash (Bebas) → title (Bebas), no fallback flash.
  const fontsReady =
    typeof document !== 'undefined' && 'fonts' in document
      ? (document as Document & { fonts: { ready: Promise<unknown> } }).fonts.ready
      : Promise.resolve();
  const fontTimeout = new Promise<void>((res) => window.setTimeout(res, 2500));
  Promise.race([fontsReady, fontTimeout]).then(() => hideSplash());
} catch (err) {
  showBootError(err);
}
