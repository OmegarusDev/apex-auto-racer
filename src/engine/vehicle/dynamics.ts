/**
 * Shared physical constants for the real-car force path.
 * (The magnet-era force functions were superseded by src/engine/sim/loads.ts.)
 */

/** Base curb weight (kg) — inertia + normal load. */
export const HYBRID_MASS_KG = 1180;
/** Yaw inertia proxy — ~m·(2.1 + 0.3·cgH) so a 2.7 m wheelbase car rotates realistically. */
/** Load sensitivity exponent n<1 — doubling Fz does not double Fy max. */
export const HYBRID_LOAD_SENS_N = 0.88;
export const HYBRID_RHO = 1.225;
/** Maps stats.D into CL so mid-corner DF reads sensibly. */
export const HYBRID_CL_FROM_D = 10;
export const HYBRID_CD_BASE = 0.32;
export const HYBRID_CD_FROM_CL = 0.1;
