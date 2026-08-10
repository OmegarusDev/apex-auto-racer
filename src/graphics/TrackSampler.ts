import type { RacingLineNode } from '../engine/RacingLine';
import { interpolateAtSInto, type InterpolatedNode } from '../engine/RacingLine';
import type { TrackSample, TrackView } from './types';

const scratch: InterpolatedNode = {
  pos: { x: 0, y: 0 },
  tangent: { x: 1, y: 0 },
  normal: { x: 0, y: 1 },
  width: 0,
  runoffWidth: 0,
  kappa: 0,
  kappaLine: 0,
  o: 0,
  s: 0,
};

/**
 * Single Frenet source of truth — wraps physics interpolateAtSInto.
 * TrackView nodes are structurally compatible with RacingLineNode for sampling.
 */
export function sampleTrackInto(
  track: TrackView,
  s: number,
  out: TrackSample,
): TrackSample {
  const nodes = track.nodes as unknown as readonly RacingLineNode[];
  if (nodes.length === 0) {
    out.pos.x = 0;
    out.pos.y = 0;
    out.tangent.x = 1;
    out.tangent.y = 0;
    out.normal.x = 0;
    out.normal.y = 1;
    out.width = 10;
    return out;
  }
  interpolateAtSInto(nodes, track.length, s, scratch);
  out.pos.x = scratch.pos.x;
  out.pos.y = scratch.pos.y;
  out.tangent.x = scratch.tangent.x;
  out.tangent.y = scratch.tangent.y;
  out.normal.x = scratch.normal.x;
  out.normal.y = scratch.normal.y;
  out.width = scratch.width;
  return out;
}

/** Allocating convenience — prefer sampleTrackInto on hot paths. */
export function sampleTrack(track: TrackView, s: number): TrackSample {
  return sampleTrackInto(track, s, {
    pos: { x: 0, y: 0 },
    tangent: { x: 1, y: 0 },
    normal: { x: 0, y: 1 },
    width: 10,
  });
}

export function writeCarWorld(
  track: TrackView,
  s: number,
  l: number,
  out: { x: number; y: number; tx: number; ty: number; heading: number },
  slipAngle = 0,
  headingOverride?: number,
): void {
  sampleTrackInto(track, s, scratchSample);
  out.x = scratchSample.pos.x + scratchSample.normal.x * l;
  out.y = scratchSample.pos.y + scratchSample.normal.y * l;
  out.tx = scratchSample.tangent.x;
  out.ty = scratchSample.tangent.y;
  const tangAngle = Math.atan2(scratchSample.tangent.y, scratchSample.tangent.x);
  out.heading = headingOverride ?? tangAngle + slipAngle;
}

const scratchSample: TrackSample = {
  pos: { x: 0, y: 0 },
  tangent: { x: 1, y: 0 },
  normal: { x: 0, y: 1 },
  width: 10,
};
