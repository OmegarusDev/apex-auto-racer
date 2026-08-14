/**
 * Driver brain barrel — the real driver model lives in ./driver/model.ts.
 * The RPG driver: skill = CONTROL QUALITY (perception, planning, execution,
 * slide recovery), never a target-speed multiplier.
 */
export {
  createBrainState,
  idleBrainOutput,
  tickDriverBrain,
  computeKBrake,
  cornerTargetSpeed,
} from './driver/model';
export type {
  BrainOutput,
  BrainState,
  BrainTickContext,
  RivalSnapshot,
} from './driver/model';
