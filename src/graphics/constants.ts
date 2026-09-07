import { PHYSICS } from '../data/physics';

/** Shared kerb paint ≡ zone kappa gate. */
export const KERB_KAPPA = PHYSICS.kerbKappa;

/**
 * Draw scale for race cars. 1 = one mesh metre per physics metre, so a
 * 150 km/h readout matches how fast the body covers the ribbon.
 */
export const CAR_WORLD_SCALE = 1;
