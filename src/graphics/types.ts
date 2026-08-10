import type { DisciplineId } from '../data/disciplines';
import type { PartCategory } from '../data/parts';
import type { Vec2 } from '../engine/types';
import type { CountdownPhase } from '../engine/RaceDirector';
import type { CameraTransform } from './Camera';

/** Minimal track view — satisfied by TrackGenerator output. */
export interface TrackNodeView {
  pos: Vec2;
  tangent: Vec2;
  normal: Vec2;
  width: number;
  runoffWidth: number;
  kappa: number;
  s: number;
}

export interface TrackBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface TrackView {
  nodes: readonly TrackNodeView[];
  length: number;
  bounds: TrackBounds;
}

export interface TrackSample {
  pos: Vec2;
  tangent: Vec2;
  normal: Vec2;
  width: number;
}

export interface ScreenRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type VehiclePartsView = Record<PartCategory, number>;

/** Per-car render DTO — presentation only, not CarSimState. */
export interface CarFrameDto {
  id: string;
  s: number;
  l: number;
  v: number;
  slipAngle: number;
  heading: number;
  color: string;
  isPlayer: boolean;
  tyreTemp: number;
  condition: number;
  slotMode: string;
  driftState: boolean;
  spinRemaining: number;
  gripUsage: number;
  partTiers: VehiclePartsView;
  /** World pos sampled once per frame. */
  worldX: number;
  worldY: number;
  /** Track tangent for camera look-ahead. */
  tangentX: number;
  tangentY: number;
  lineNoise: number;
}

export interface GhostFrameDto {
  worldX: number;
  worldY: number;
  heading: number;
  color: string;
}

export interface FxImpulse {
  kind: 'skid' | 'dust' | 'smoke' | 'sparks';
  x: number;
  y: number;
  x2?: number;
  y2?: number;
  index: number;
  intensity?: number;
  count?: number;
}

export interface RaceFrameView {
  camera: CameraTransform;
  screenW: number;
  screenH: number;
  night: boolean;
  rain: boolean;
  cars: readonly CarFrameDto[];
  playerIndex: number;
  ghost: GhostFrameDto | null;
  countdown: CountdownPhase;
  discipline: DisciplineId;
}

export interface RaceViewPrepareOpts {
  track: TrackView;
  discipline: DisciplineId;
  night: boolean;
  rain: boolean;
}
