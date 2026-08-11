import type { BrainIntentTag } from '../BrainIntent';
import type { BrainState } from '../DriverBrain';
import type { Modifier } from '../modifiers';
import type { Driver, SlotMode, VehicleParts } from '../types';
import type { BrainOutput, CarSimState } from '../Vehicle';

export interface RaceCarEntry {
  car: CarSimState;
  driver: Driver;
  brain: BrainState;
  modifierStack: Modifier[];
  brainOut: BrainOutput;
  prevS: number;
  prevLap: number;
  prevWallHits: number;
  prevSpinCount: number;
  prevDeslotCount: number;
  prevDrift: boolean;
  prevPosition: number;
  prevMistakeActive: boolean;
  prevSlotMode: SlotMode | '';
  lastIntentTag: BrainIntentTag | null;
  lastIntentEventAt: number;
  draft: number;
  contactBlocked: boolean;
  partTiers: VehicleParts;
}
