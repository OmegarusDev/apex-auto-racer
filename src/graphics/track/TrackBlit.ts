import type { CameraTransform } from '../Camera';
import { PX_PER_M, writeWorldToScreen } from '../coords';
import type { BakeMeta } from './TrackBaker';

const tl = { x: 0, y: 0 };
const br = { x: 0, y: 0 };

export function blitTrack(
  ctx: CanvasRenderingContext2D,
  baked: HTMLCanvasElement,
  meta: BakeMeta,
  camera: CameraTransform,
  screenW: number,
  screenH: number,
): void {
  writeWorldToScreen(meta.offsetX, meta.offsetY + meta.worldH, camera, screenW, screenH, tl);
  writeWorldToScreen(meta.offsetX + meta.worldW, meta.offsetY, camera, screenW, screenH, br);
  ctx.drawImage(baked, tl.x, tl.y, br.x - tl.x, br.y - tl.y);
}

export function blitNightVignette(
  ctx: CanvasRenderingContext2D,
  overlay: HTMLCanvasElement,
  screenW: number,
  screenH: number,
): void {
  ctx.drawImage(overlay, 0, 0, screenW, screenH);
}

/** Rebuild screen-sized night vignette when viewport changes. */
export function buildNightVignette(screenW: number, screenH: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.floor(screenW));
  c.height = Math.max(1, Math.floor(screenH));
  const gctx = c.getContext('2d');
  if (!gctx) return c;
  const g = gctx.createRadialGradient(
    screenW * 0.5,
    screenH * 0.45,
    screenH * 0.15,
    screenW * 0.5,
    screenH * 0.5,
    screenH * 0.85,
  );
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(4,8,20,0.42)');
  gctx.fillStyle = g;
  gctx.fillRect(0, 0, screenW, screenH);
  return c;
}

/** @deprecated scale helper — kept for callers that need cam scale. */
export function cameraScale(camera: CameraTransform): number {
  return PX_PER_M * camera.zoom;
}
