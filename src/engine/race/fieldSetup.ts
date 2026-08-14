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
  globalRainStack: Modifier[];
}

export interface FieldSetupResult {
  drivers: Driver[];
  entries: RaceCarEntry[];
  carsView: CarSimState[];
  ghostTrace: GhostTrace;
}

export function setupRaceField(input: FieldSetupInput): FieldSetupResult {
  const { config, track, rng, globalRainStack } = input;
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
    // Grid sits fully behind the start/finish line (s=0 is the line): front
    // row is gridPoleGap back, each row stacks behind it. Placing row 0 on the
    // line gave back rows a ~lap head start (they crossed s=0 after a few m).
    const gridS =
      (track.length -
        PHYSICS.gridPoleGap -
        row * PHYSICS.gridRowSpacing +
        track.length) %
      track.length;

    const stats = effectiveStats(config.discipline, plan.parts, plan.condition, plan.driver);
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
      plan.condition,
      gridS,
      gridL,
      authority,
      lineO,
      carSetupFromParts(plan.parts, config.discipline),
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
