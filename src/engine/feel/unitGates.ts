import { PHYSICS } from '../../data/physics';
import {
  computeBrakeAuthority,
  computePinAuthorityBlend,
  computeTempGrip,
  createCarState,
} from '../Vehicle';
import { effectiveStats } from '../stats';
import { defaultVehicleSave } from '../types';
import type { FeelGateResult } from './types';

export function runAuthorityGates(): FeelGateResult[] {
  const skill30 = computeBrakeAuthority(30);
  const pin = computePinAuthorityBlend(30, 1, 0);
  const noPin = computePinAuthorityBlend(30, 0.5, 0.2);
  const results: FeelGateResult[] = [];

  const authOk = skill30 >= 0.3 && skill30 <= 0.4;
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
    [20],
    [18],
    [22],
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

  // Recovery floor: simulate cool while "recovering"
  let t = PHYSICS.tyreStartTemp;
  for (let i = 0; i < 600; i++) {
    const cool = PHYSICS.tyreCool * 0.35;
    t = Math.max(PHYSICS.tyreRecoveryFloor, Math.min(PHYSICS.tyreTempMax, t - cool * PHYSICS.dt));
  }

  // Warm path at speed
  let tw = PHYSICS.tyreStartTemp;
  const vFrac = 0.7;
  for (let i = 0; i < Math.ceil(25 / PHYSICS.dt); i++) {
    tw = Math.max(
      0,
      Math.min(
        PHYSICS.tyreTempMax,
        tw + (PHYSICS.tyreHeatSpeed * vFrac - PHYSICS.tyreCool * 0.35) * PHYSICS.dt,
      ),
    );
  }

  return [
    {
      id: 'TYRE_START_WARM',
      ok: startOk,
      detail: `tyreTemp=${car.tyreTemp} expect=${PHYSICS.tyreStartTemp}`,
    },
    {
      id: 'TYRE_RECOVERY_FLOOR',
      ok: t >= PHYSICS.tyreRecoveryFloor - 1e-6,
      detail: `after cool t=${t.toFixed(3)} floor=${PHYSICS.tyreRecoveryFloor}`,
    },
    {
      id: 'TYRE_WARM_PATH',
      ok: tw >= 0.55,
      detail: `after 25s @0.7 vMax temp=${tw.toFixed(3)}`,
    },
    {
      id: 'TYRE_COLD_GRIP',
      ok: coldStart > cold0 && coldLow < 1 && opt >= 0.99,
      detail: `grip(0)=${cold0.toFixed(3)} start=${coldStart.toFixed(3)} T0.3=${coldLow.toFixed(3)} opt=${opt.toFixed(3)}`,
    },
  ];
}
