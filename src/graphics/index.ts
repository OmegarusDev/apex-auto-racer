/**
 * Presentation barrel — RaceView is the primary race graphics facade.
 */
export { RaceView } from './RaceView';
export { Camera, type CameraTransform, type CameraMode } from './Camera';
export { ParticleSystem } from './fx/ParticleSystem';
export { drawSlotCarMesh, drawSlotCarShadow, type CarPaintOpts } from './car/CarPainter';
export { sampleTrack, sampleTrackInto, writeCarWorld } from './TrackSampler';
export { PX_PER_M, worldToScreen, writeWorldToScreen } from './coords';
export { KERB_KAPPA } from './constants';
export { buildTrackPalette, shellAccentFor } from './materials';
export type {
  TrackView,
  TrackSample,
  CarFrameDto,
  RaceFrameView,
  FxImpulse,
  ScreenRect,
  VehiclePartsView,
} from './types';
