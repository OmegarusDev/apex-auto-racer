import { getGameContext } from '../engine/GameContext';
import {
  createTheme,
  invalidateSafeArea,
  type ThemeTokens,
} from '../ui/theme';
import type { UiContext } from '../ui/components';
import { drawBrandAtmosphere } from '../ui/brand';

export function buildUi(
  w: number,
  h: number,
  dt: number,
  accent: string,
): { ui: UiContext; token: ThemeTokens } {
  const g = getGameContext();
  const token = createTheme(w, h);
  const click = g.input.consumeClick();
  return {
    token,
    ui: {
      pointerX: g.input.pointerX,
      pointerY: g.input.pointerY,
      // Held pointers only — peekClick is edge-consumed above and must not
      // be the sole source of pointerDown (breaks sliders + drag-scroll).
      pointerDown: g.input.isPointerDown(),
      pointerClicked: click !== null,
      dt,
      w,
      h,
      token,
      accent,
    },
  };
}

export function onSceneEnter(): void {
  const g = getGameContext();
  g.input.setMode('menu');
  // Menus draw on #game; #world must never sit above HUD hits after a race.
  // CSS keeps pointer-events:none; drop is-live so the GL surface stays hidden.
  document.querySelector<HTMLCanvasElement>('#world')?.classList.remove('is-live');
  invalidateSafeArea();
}

export function onSceneResize(_w: number, _h: number): void {
  invalidateSafeArea();
}

export function drawBackground(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  token: ThemeTokens,
  accent?: string,
): void {
  drawBrandAtmosphere(ctx, w, h, token, accent);
}

