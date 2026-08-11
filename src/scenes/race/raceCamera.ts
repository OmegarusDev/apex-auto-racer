import type { RaceDirector } from '../../engine/RaceDirector';
import type { RaceView } from '../../graphics/RaceView';
import type { CarFrameDto } from '../../graphics/types';
import { disciplineAccent } from '../../career/disciplinesUi';
import type { DisciplineId } from '../../data/disciplines';
import { buildCarFrame } from './frameBus';

/** CameraDirector seam — countdown fit vs follow player. */
export function setupCountdownCamera(
  view: RaceView,
  director: RaceDirector | null,
  discipline: DisciplineId,
  frameCars: CarFrameDto[],
  screenW: number,
  screenH: number,
): void {
  if (director === null) return;
  const accent = disciplineAccent(discipline);
  const cars = buildCarFrame(view, director, accent, frameCars);
  view.syncCameraCountdown(cars, screenW, screenH);
  view.snapCamera();
}

export function updateCamera(
  view: RaceView,
  director: RaceDirector,
  discipline: DisciplineId,
  frameCars: CarFrameDto[],
  screenW: number,
  screenH: number,
  lastDt: number,
): void {
  const accent = disciplineAccent(discipline);
  const cars = buildCarFrame(view, director, accent, frameCars);
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
