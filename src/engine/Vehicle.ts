/** Barrel — vehicle modules live under ./vehicle/* */
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
  computeDriverDeslotMargin,
  computeVDeslot,
  enterDeslot,
  contactDeslot,
} from './vehicle/deslotMargin';
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
  vDriverAt,
  vSafeAt,
  computeSDet,
} from './vehicle/create';
export { updateVehicle } from './vehicle/updateVehicle';
