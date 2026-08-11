import { PRESENT } from '../data/present';
import type { CameraTransform } from './Camera';

export const PX_PER_M = PRESENT.pxPerM;

export interface ScreenPoint {
  x: number;
  y: number;
}

/** World (Y-up meters) → screen. Writes into `out` — no alloc on hot path. */
export function writeWorldToScreen(
  wx: number,
  wy: number,
  camera: CameraTransform,
  screenW: number,
  screenH: number,
  out: ScreenPoint,
): ScreenPoint {
  const scale = PX_PER_M * camera.zoom;
  out.x = screenW * 0.5 + (wx - camera.x) * scale;
  out.y = screenH * 0.5 - (wy - camera.y) * scale;
  return out;
}

/** Allocating convenience — prefer writeWorldToScreen on hot paths. */
export function worldToScreen(
  wx: number,
  wy: number,
  camera: CameraTransform,
  screenW: number,
  screenH: number,
): ScreenPoint {
  return writeWorldToScreen(wx, wy, camera, screenW, screenH, { x: 0, y: 0 });
}
