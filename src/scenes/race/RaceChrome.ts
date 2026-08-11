/**
 * Race HUD chrome ownership module.
 * drawHud / pedal deck / chips / ticker / finish overlay currently still live on
 * RaceScene host and call into fantasy HUD + ui/components — extract draw bodies here
 * when RaceScene host is further thinned (presentation-only; no feel impact).
 */
export type RaceChromeDrawArgs = {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
};
