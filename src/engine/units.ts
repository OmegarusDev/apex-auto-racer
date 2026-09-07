/**
 * Display units. Sim speed is metres per second of the same world as
 * PHYSICS.carLength and the track (HUD km/h = v × 3.6).
 * mph  = v × 3600 / 1609.344 (international mile).
 */
export type SpeedUnit = 'kmh' | 'mph';

export const DEFAULT_SPEED_UNIT: SpeedUnit = 'kmh';

const MS_TO_KMH = 3.6;
const MS_TO_MPH = 3600 / 1609.344;

export function isSpeedUnit(v: unknown): v is SpeedUnit {
  return v === 'kmh' || v === 'mph';
}

export function speedFromMs(vMs: number, unit: SpeedUnit): number {
  return vMs * (unit === 'mph' ? MS_TO_MPH : MS_TO_KMH);
}

export function formatSpeed(vMs: number, unit: SpeedUnit): string {
  return `${Math.round(speedFromMs(vMs, unit))}`;
}

export function speedUnitLabel(unit: SpeedUnit): string {
  return unit === 'mph' ? 'MPH' : 'KM/H';
}
