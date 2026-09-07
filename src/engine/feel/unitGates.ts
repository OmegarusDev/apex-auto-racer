import { PHYSICS } from '../../data/physics';
import {
  computeBrakeAuthority,
  computePinAuthorityBlend,
  computeTempGrip,
  createCarState,
} from '../Vehicle';
import { effectiveStats } from '../stats';
import { defaultVehicleSave, emptyVehicleParts } from '../types';
import { generateTrack } from '../TrackGenerator';
import { clutchBiteWindow } from '../vehicle/transmission';
import { toOrdinal } from '../../utils/helpers';
import type { FeelGateResult } from './types';

export function runAuthorityGates(): FeelGateResult[] {
  const skill30 = computeBrakeAuthority(30);
  const pin = computePinAuthorityBlend(30, 1, 0);
  const noPin = computePinAuthorityBlend(30, 0.5, 0.2);
  const results: FeelGateResult[] = [];

  const authOk = skill30 >= 0.2 && skill30 <= 0.35;
  results.push({
    id: 'PIN_AUTHORITY',
    ok:
      authOk &&
      pin.pinOverrule &&
      pin.brakeBlend <= pin.brakeAuth * 0.02 + 1e-9 &&
      Math.abs(pin.trim - pin.throttleAuth * 0.25) < 1e-9 &&
      !noPin.pinOverrule &&
      Math.abs(noPin.brakeBlend - noPin.brakeAuth) < 1e-9,
    detail: `skill30 brakeAuth=${skill30.toFixed(3)} pinBlend=${pin.brakeBlend.toFixed(4)} trim=${pin.trim.toFixed(3)}`,
  });
  return results;
}

export function runTyreGates(): FeelGateResult[] {
  const stats = effectiveStats('track', defaultVehicleSave(1).partTiers, 1);
  const car = createCarState(
    't',
    'd',
    0,
    true,
    stats,
    1,
    0,
    0,
    0.5,
  );

  const startOk = Math.abs(car.tyreTemp - PHYSICS.tyreStartTemp) < 1e-6;
  const cold0 = computeTempGrip(0);
  const coldStart = computeTempGrip(PHYSICS.tyreStartTemp);
  const coldLow = computeTempGrip(0.3);
  const opt = computeTempGrip(0.8);

  return [
    {
      id: 'TYRE_START_WARM',
      ok: startOk,
      detail: `tyreTemp=${car.tyreTemp} expect=${PHYSICS.tyreStartTemp}`,
    },
    {
      id: 'TYRE_COLD_GRIP',
      ok: coldStart > cold0 && coldLow < 1 && opt >= 0.99,
      detail: `grip(0)=${cold0.toFixed(3)} start=${coldStart.toFixed(3)} T0.3=${coldLow.toFixed(3)} opt=${opt.toFixed(3)}`,
    },
  ];
}

/** Quick Race pace-band track scale — early bands must shrink length (non-freeze BALANCE). */
export function runTrackScaleGates(): FeelGateResult[] {
  const seeds = [42_001, 42_101, 42_201, 42_301, 42_401];
  let fullSum = 0;
  let smallSum = 0;
  let widthOk = true;
  for (const seed of seeds) {
    const full = generateTrack(seed, 'track');
    const small = generateTrack(seed, 'track', undefined, { lengthMult: 0.68, widthMult: 0.88 });
    fullSum += full.length;
    smallSum += small.length;
    const fullW = full.nodes[0]?.width ?? 0;
    const smallW = small.nodes[0]?.width ?? 0;
    if (!(smallW < fullW * 0.95 && smallW > fullW * 0.75)) widthOk = false;
  }
  const ratio = smallSum / Math.max(1, fullSum);
  const lengthOk = ratio < 0.78 && ratio > 0.55;
  return [
    {
      id: 'QR_TRACK_SCALE',
      ok: lengthOk && widthOk,
      detail: `lenRatio=${ratio.toFixed(3)} (want ~0.68) widthOk=${widthOk}`,
    },
  ];
}

/** Stock clutch is a held clunk; max clutch + skill is a tap-and-release. */
export function runClutchFeelGates(): FeelGateResult[] {
  const stock = effectiveStats('track', emptyVehicleParts(0), 1);
  const elite = effectiveStats('track', emptyVehicleParts(5), 1);
  const stockWin = clutchBiteWindow({ stats: stock }, 0);
  const eliteWin = clutchBiteWindow({ stats: elite }, 1);
  const tap = 0.07;
  const stockTapDump = tap < stockWin.delay;
  const eliteTapPerfect = tap >= eliteWin.delay && tap <= eliteWin.delay + eliteWin.sweet;
  return [
    {
      id: 'CLUTCH_STOCK_CLUNK',
      ok: stockWin.delay >= 0.24 && stockTapDump && stock.shiftTime >= 0.28,
      detail: `stock delay=${stockWin.delay.toFixed(2)}s sweet=${stockWin.sweet.toFixed(2)}s shift=${stock.shiftTime.toFixed(2)}s tap=${stockTapDump ? 'dump' : 'hit'}`,
    },
    {
      id: 'CLUTCH_ELITE_TAP',
      ok: eliteWin.delay <= 0.05 && eliteTapPerfect && elite.shiftTime <= 0.12,
      detail: `elite+skill delay=${eliteWin.delay.toFixed(3)}s sweet=${eliteWin.sweet.toFixed(2)}s shift=${elite.shiftTime.toFixed(2)}s tap=${eliteTapPerfect ? 'perfect' : 'miss'}`,
    },
  ];
}

/** Race HUD "4th" — JS remainder of (n-20) used to stringify as 4undefined. */
export function runOrdinalGate(): FeelGateResult {
  const samples = [1, 2, 3, 4, 11, 12, 13, 21, 22];
  const want = ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd'];
  const got = samples.map(toOrdinal);
  const ok = got.every((s, i) => s === want[i]);
  return { id: 'ORDINAL_HUD', ok, detail: got.join(', ') };
}
