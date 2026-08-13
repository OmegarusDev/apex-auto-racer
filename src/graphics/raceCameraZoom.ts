/**
 * Shared raceZoom → camera pull mapping for the GL tabletop camera.
 * raceZoom 0 = far tabletop, 1 = close-in.
 */

/** Eye-distance / elevation multiplier used by the GL tabletop camera. */
export function raceCameraPull(raceZoom: number): number {
  const z = Math.max(0, Math.min(1, raceZoom));
  return 2.35 - z * 1.45; // 2.35x far … 0.9x close
}
