import type { RaceDirector } from '../../engine/RaceDirector';
import type { VehicleParts } from '../../engine/types';
import { writeCarWorld } from '../../graphics/TrackSampler';
import { hslToHex } from '../../graphics/engine/math';
import type { CarFrameDto } from '../../graphics/types';
import type { RaceView } from '../../graphics/RaceView';

const carPoseScratch = { x: 0, y: 0, heading: 0, tx: 0, ty: 0 };

function rivalPaint(teamId: number, teamCount: number, parts: VehicleParts): string {
  const hue = teamCount <= 0 ? 200 : Math.round((teamId * 360) / teamCount) % 360;
  let tierSum = 0;
  for (const k of Object.keys(parts) as (keyof VehicleParts)[]) {
    tierSum += parts[k] ?? 1;
  }
  const avg = tierSum / 7;
  const light = 48 + Math.min(12, avg * 2);
  const sat = 62 + Math.min(12, (avg - 1) * 3);
  return hslToHex(hue, sat, light);
}


export function buildCarFrame(
  view: RaceView,
  director: RaceDirector,
  playerAccent: string,
  frameCars: CarFrameDto[],
): CarFrameDto[] {
  const track = view.getTrack();

  const teamCount = director.config.format.teamCount;

  const out = frameCars;

  out.length = 0;

  if (track === null) return out;



  for (const car of director.cars) {

    writeCarWorld(track, car.s, car.l, carPoseScratch, car.slipAngle);

    const parts = director.partTiersFor(car.id);

    const color = car.isPlayerControlled

      ? playerAccent

      : rivalPaint(car.teamId, teamCount, parts);

    out.push({

      id: car.id,

      s: car.s,

      l: car.l,

      v: car.v,

      slipAngle: car.slipAngle,

      heading: carPoseScratch.heading,

      color,

      isPlayer: car.isPlayerControlled,

      tyreTemp: car.tyreTemp,

      condition: car.condition,

      slotMode: car.slotMode,

      driftState: car.driftState,

      spinRemaining: car.spinRemaining,

      gripUsage: car.gripUsage,

      partTiers: parts,

      worldX: carPoseScratch.x,

      worldY: carPoseScratch.y,

      tangentX: carPoseScratch.tx,

      tangentY: carPoseScratch.ty,

      lineNoise: car.stats.lineNoise,

    });

  }

  frameCars = out;

  return out;


}
