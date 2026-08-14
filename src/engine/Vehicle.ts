/** Barrel — the greenfield real-car sim. */
export type {
  BrainOutput,
  VehicleInputs,
  VehicleUpdateContext,
  CarSimState,
  ZoneModifiers,
} from './vehicle/types';
export {
  computeBrakeAuthority,
  computeThrottleAuthority,
  computePinAuthorityBlend,
} from './vehicle/authority';
export {
  wallLimitFor,
  barrierHalfWidth,
  computeZoneModifiers,
  computeTempGrip,
} from './vehicle/zones';
export {
  createCarState,
  buildVehicleContext,
  personalLineAt,
  computeSDet,
} from './vehicle/create';
export { updateVehicle } from './sim/update';
export { contactDeslot } from './sim/vehicle';
