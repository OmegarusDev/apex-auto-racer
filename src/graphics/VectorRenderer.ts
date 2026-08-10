/**
 * @deprecated Compatibility shim — prefer RaceView + TrackBaker.
 * Re-exports types and sample helpers for any lingering imports.
 */
export { PX_PER_M, worldToScreen } from './coords';
export { sampleTrack } from './TrackSampler';
export type {
  TrackNodeView,
  TrackBounds,
  TrackView,
  TrackSample,
  ScreenRect,
  CarFrameDto as CarRenderState,
} from './types';
export { RaceView as VectorRenderer } from './RaceView';
