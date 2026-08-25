import type { RaceDirector } from '../../engine/RaceDirector';
import type { RaceView } from '../../graphics/RaceView';
import type { CarFrameDto } from '../../graphics/types';
import { buildCarFrame } from './frameBus';

/** CameraDirector seam — countdown fit vs follow player. */
export function setupCountdownCamera(
  view: RaceView,
  director: RaceDirector | null,
  frameCars: CarFrameDto[],
  screenW: number,
  screenH: number,
): void {
  if (director === null) return;
  const cars = buildCarFrame(view, director, frameCars);
  view.syncCameraCountdown(cars, screenW, screenH);
  view.snapCamera();
}

export function updateCamera(
  view: RaceView,
  director: RaceDirector,
  
  frameCars: CarFrameDto[],
  screenW: number,
  screenH: number,
  lastDt: number,
): void {
  const cars = buildCarFrame(view, director, frameCars);
  if (director.countdown !== null) {
    view.syncCameraCountdown(cars, screenW, screenH);
  } else {
    const player = cars.find((c) => c.isPlayer) ?? cars[0];
    if (player !== undefined) {
      view.syncCameraFollow(player, screenW, screenH);
    }
  }
  view.updateCamera(lastDt);
}
