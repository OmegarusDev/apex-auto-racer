/**
 * Presentation barrel — RaceView is the primary race graphics facade.
 * World pass: Apex WebGL engine (`./engine`) — the ONLY world path.
 * HUD / menus: Canvas2D (CarPainter for garage/title art).
 */
export { RaceView } from './RaceView';
export { ApexRenderer } from './engine/ApexRenderer';
export { Camera, type CameraTransform, type CameraMode } from './Camera';
export { drawSlotCarMesh, drawSlotCarShadow, type CarPaintOpts } from './car/CarPainter';
export { sampleTrack, sampleTrackInto, writeCarWorld } from './TrackSampler';
export { KERB_KAPPA } from './constants';
export { buildTrackPalette, shellAccentFor } from './materials';
export type { MinimapPoint } from './track/MinimapPoint';
export type {
  TrackView,
  TrackSample,
  CarFrameDto,
  RaceFrameView,
  FxImpulse,
  ScreenRect,
  VehiclePartsView,
} from './types';
