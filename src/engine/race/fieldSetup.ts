import { BALANCE } from '../../data/balance';
import { PHYSICS } from '../../data/physics';
import { createBrainState, idleBrainOutput } from '../DriverBrain';
import { driverStrength01, generateFieldDrivers, syncDriverIdsFrom } from '../DriverGenerator';
import type { RaceConfig, GhostTrace } from '../RaceDirector';
import { buildPersonalRacingLine } from '../RacingLine';
import { effectiveStats } from '../stats';
import type { Modifier } from '../modifiers';
import type { Rng } from '../rng';
import { shuffleInPlace } from '../rng';
import type { TrackData } from '../TrackGenerator';
import { buildSpeedProfiles, buildVDriverProfile } from '../TrackGenerator';
import type { Driver, VehicleParts } from '../types';
import {
  computeBrakeAuthority,
  createCarState,
  type CarSimState,
} from '../Vehicle';
import { carSetupFromParts } from '../vehicle/CarSetup';
import {
  applyLooseCannon,
  buildTraitStack,
  generateOpponentParts,
  mergeModifierStacks,
} from './modifiersSetup';
import type { RaceCarEntry } from './types';

export interface FieldSetupInput {
  config: RaceConfig;
  track: TrackData;
  rng: Rng;
  muSurface: number;
  globalRainStack: Modifier[];
}

export interface FieldSetupResult {
  drivers: Driver[];
  entries: RaceCarEntry[];
  carsView: CarSimState[];
  ghostTrace: GhostTrace;
}

export function setupRaceField(input: FieldSetupInput): FieldSetupResult {
  const { config, track, rng, muSurface, globalRainStack } = input;
  const { format, playerTeamDrivers, leadDriverId, opponentBudget, opponentPartRange } = config;
  const usedNames = new Set<string>();
  for (const d of playerTeamDrivers) usedNames.add(d.name);

  const opponentCount = (format.teamCount - 1) * format.teamSize;
  let opponentDrivers: Driver[];

  if (config.opponentDrivers !== undefined && config.opponentDrivers.length >= opponentCount) {
    opponentDrivers = config.opponentDrivers.slice(0, opponentCount);
  } else {
    // Roster ids come from SaveManager; field generation must not reuse them.
    syncDriverIdsFrom(playerTeamDrivers);
    // Stratified weak→strong within the rank band (backmarkers + standouts).
    opponentDrivers = generateFieldDrivers(
      rng,
      opponentCount,
      opponentBudget[0],
      opponentBudget[1],
      usedNames,
    );
  }

  const drivers = [
    ...playerTeamDrivers.map((d) => applyLooseCannon(d, rng)),
    ...opponentDrivers.map((d) => applyLooseCannon(d, rng)),
  ];

  const carPlans: {
    driver: Driver;
    teamId: number;
    isPlayer: boolean;
    parts: VehicleParts;
    condition: number;
  }[] = [];

  for (let i = 0; i < playerTeamDrivers.length; i++) {
    carPlans.push({
      driver: drivers[i]!,
      teamId: 0,
      isPlayer: playerTeamDrivers[i]!.id === leadDriverId,
      parts: config.playerVehicle.partTiers,
      condition: config.playerVehicle.condition,
    });
  }

  for (let t = 1; t < format.teamCount; t++) {
    for (let s = 0; s < format.teamSize; s++) {
      const driverIdx = playerTeamDrivers.length + (t - 1) * format.teamSize + s;
      const oppDriver = drivers[driverIdx]!;
      const strength = driverStrength01(oppDriver, opponentBudget[0], opponentBudget[1]);
      carPlans.push({
        driver: oppDriver,
        teamId: t,
        isPlayer: false,
        parts: generateOpponentParts(rng, opponentPartRange, strength),
        condition: 1,
      });
    }
  }

  shuffleInPlace(rng, carPlans);

  const entries: RaceCarEntry[] = carPlans.map((plan, i) => {
    const row = Math.floor(i / 2);
    const col = i % 2;
    const gridL = col === 0 ? -PHYSICS.gridColOffset : PHYSICS.gridColOffset;
    const gridS =
      (track.length - row * PHYSICS.gridRowSpacing + track.length) % track.length;

    const rawStats = effectiveStats(config.discipline, plan.parts, plan.condition, plan.driver);
    const { vProfile, vSafe } = buildSpeedProfiles(track, rawStats, muSurface);
    let vDriver = buildVDriverProfile(vProfile, plan.driver.skill, plan.driver.bravery);
    // Player pace handicap applies to targets AND live top-speed/accel —
    // previously only vDriver was trimmed so pin-throttle still felt overpowered.
    let stats = rawStats;
    if (plan.isPlayer) {
      const pace = BALANCE.playerPaceMult;
      stats = {
        ...rawStats,
        vMax: rawStats.vMax * pace,
        aAccel: rawStats.aAccel * pace,
      };
      vDriver = vDriver.map((v) => v * pace);
    }
    const authority = plan.isPlayer ? computeBrakeAuthority(plan.driver.skill) : 1;

    const modifierStack = mergeModifierStacks(
      globalRainStack,
      buildTraitStack(plan.driver),
    );

    const laneSign = col === 0 ? -1 : 1;
    const lineO = buildPersonalRacingLine(
      track.nodes,
      track.length,
      plan.driver.skill,
      plan.driver.bravery,
      stats.gripFactor * stats.condGrip,
      laneSign,
      gridS,
      gridL,
      plan.driver.focus,
    );

    const car = createCarState(
      `car-${i}`,
      plan.driver.id,
      plan.teamId,
      plan.isPlayer,
      stats,
      vProfile,
      vDriver,
      vSafe,
      plan.condition,
      gridS,
      gridL,
      authority,
      lineO,
      carSetupFromParts(plan.parts),
    );

    return {
      car,
      driver: plan.driver,
      brain: createBrainState(),
      modifierStack,
      brainOut: idleBrainOutput(car, track),
      prevS: gridS,
      prevLap: 0,
      prevWallHits: 0,
      prevSpinCount: 0,
      prevDeslotCount: 0,
      prevDrift: false,
      prevPosition: i + 1,
      prevMistakeActive: false,
      prevSlotMode: car.slotMode,
      lastIntentTag: null,
      lastIntentEventAt: -Infinity,
      draft: 0,
      contactBlocked: false,
      partTiers: plan.parts,
    };
  });

  const carsView = entries.map((e) => e.car);
  const ghostTrace: GhostTrace = entries.map((e) => ({ carId: e.car.id, samples: [] }));

  return { drivers, entries, carsView, ghostTrace };
}
