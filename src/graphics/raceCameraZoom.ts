/**
 * Shared raceZoom → camera pull mapping for WebGL + Canvas2D.
 * raceZoom 0 = far tabletop, 1 = close-in.
 */

/** Eye-distance / elevation multiplier used by the GL tabletop camera. */
export function raceCameraPull(raceZoom: number): number {
  const z = Math.max(0, Math.min(1, raceZoom));
  return 2.35 - z * 1.45; // 2.35x far … 0.9x close
}

/**
 * Canvas2D blit zoom scale from the same pull curve so GL→2D fallback
 * keeps similar framing (higher pull → smaller on-screen track).
 */
export function raceCamera2dZoomScale(raceZoom: number): number {
  return 0.78 / raceCameraPull(raceZoom);
}
