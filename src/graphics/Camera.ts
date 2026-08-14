import { PHYSICS } from '../data/physics';
import { PRESENT } from '../data/present';
import type { Vec2 } from '../engine/types';

export type CameraMode = 'countdown' | 'follow';

export interface CameraTransform {
  x: number;
  y: number;
  zoom: number;
}

export class Camera {
  mode: CameraMode = 'follow';
  x = 0;
  y = 0;
  zoom = 1;

  private targetX = 0;
  private targetY = 0;
  private targetZoom = 1;
  /** Speed-based follow zoom (no start boost). */
  private baseTargetZoom = 1;
  /**
   * Extra zoom-in on the player's car just after lights-out — the race starts
   * tight on the player, then eases out to the normal speed-based frame.
   */
  private startBoost = 0;

  private static readonly START_ZOOM_BOOST = 0.28;
  private static readonly START_ZOOM_DECAY = 1.1;
  /** How much of the remaining boost may push zoom past zoomMax. */
  private static readonly BOOST_OVERSHOOT = 0.75;

  private maxZoomNow(): number {
    return PHYSICS.zoomMax + this.startBoost * Camera.BOOST_OVERSHOOT;
  }

  /** Fit all car world positions on screen (countdown). */
  setCountdownTargets(
    carPositions: readonly Vec2[],
    screenW: number,
    screenH: number,
    padding = 40,
  ): void {
    this.mode = 'countdown';
    if (carPositions.length === 0) {
      this.targetX = 0;
      this.targetY = 0;
      this.targetZoom = 1;
      return;
    }

    let minX = carPositions[0]!.x;
    let maxX = carPositions[0]!.x;
    let minY = carPositions[0]!.y;
    let maxY = carPositions[0]!.y;
    for (let i = 1; i < carPositions.length; i++) {
      const p = carPositions[i]!;
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }

    const spanX = Math.max(maxX - minX, 20);
    const spanY = Math.max(maxY - minY, 20);
    this.targetX = (minX + maxX) * 0.5;
    this.targetY = (minY + maxY) * 0.5;

    const worldPxX = spanX * PRESENT.pxPerM;
    const worldPxY = spanY * PRESENT.pxPerM;
    const fitZoom = Math.min(
      (screenW - padding * 2) / worldPxX,
      (screenH - padding * 2) / worldPxY,
    );
    this.targetZoom = clamp(fitZoom, PHYSICS.zoomMin, PHYSICS.zoomMax);
  }

  /**
   * Pan the tabletop window onto a car. Mild look-ahead only —
   * orientation stays fixed in the WebGL pass (not a chase cam).
   */
  setFollowTarget(worldPos: Vec2, speedMs: number, lookAhead?: Vec2): void {
    // Countdown → follow transition = lights-out: arm the start punch-in.
    const enteringFollow = this.mode !== 'follow';
    this.mode = 'follow';
    const ahead = clamp(speedMs * 0.08, 1.5, 7);
    if (lookAhead !== undefined) {
      const len = Math.hypot(lookAhead.x, lookAhead.y) || 1;
      this.targetX = worldPos.x + (lookAhead.x / len) * ahead;
      this.targetY = worldPos.y + (lookAhead.y / len) * ahead;
    } else {
      this.targetX = worldPos.x;
      this.targetY = worldPos.y;
    }
    this.baseTargetZoom = clamp(0.68 - 0.18 * (speedMs / 70), PHYSICS.zoomMin, PHYSICS.zoomMax);
    if (enteringFollow) {
      this.startBoost = Camera.START_ZOOM_BOOST;
    }
    // The punch-in may exceed zoomMax — the countdown fit for a long sprint
    // already sits at zoomMax, so without overshoot the start zoom is invisible.
    this.targetZoom = clamp(
      this.baseTargetZoom + this.startBoost,
      PHYSICS.zoomMin,
      this.maxZoomNow(),
    );
  }

  update(dt: number): void {
    const posK = 1 - Math.exp(-PHYSICS.cameraPosRate * dt);
    const zoomK = 1 - Math.exp(-PHYSICS.cameraZoomRate * dt);
    this.x += (this.targetX - this.x) * posK;
    this.y += (this.targetY - this.y) * posK;
    if (this.mode === 'follow' && this.startBoost > 0.001) {
      this.startBoost *= Math.exp(-Camera.START_ZOOM_DECAY * dt);
      this.targetZoom = clamp(
        this.baseTargetZoom + this.startBoost,
        PHYSICS.zoomMin,
        this.maxZoomNow(),
      );
    }
    this.zoom += (this.targetZoom - this.zoom) * zoomK;
    this.zoom = clamp(this.zoom, PHYSICS.zoomMin, this.maxZoomNow());
  }

  /** Jump live pose onto current targets (race enter / countdown setup). */
  snapToTargets(): void {
    this.x = this.targetX;
    this.y = this.targetY;
    this.zoom = clamp(this.targetZoom, PHYSICS.zoomMin, PHYSICS.zoomMax);
  }

  getTransform(): CameraTransform {
    return this.writeTransform(this.transformScratch);
  }

  /** Write current transform into `out` — no alloc. */
  writeTransform(out: CameraTransform): CameraTransform {
    out.x = this.x;
    out.y = this.y;
    out.zoom = this.zoom;
    return out;
  }

  private transformScratch: CameraTransform = { x: 0, y: 0, zoom: 1 };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
