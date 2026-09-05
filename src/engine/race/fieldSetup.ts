import { PHYSICS } from '../../data/physics';
import { createBrainState, idleBrainOutput } from '../DriverBrain';
import { driverStrength01, generateFieldDrivers, syncDriverIdsFrom } from '../DriverGenerator';
import type { RaceConfig, GhostTrace } from '../RaceDirector';
import { buildPersonalLineFromIdeal } from '../RacingLine';
import { effectiveStats } from '../stats';
import type { Modifier } from '../modifiers';
import type { Rng } from '../rng';
import type { TrackData } from '../TrackGenerator';
import type { Driver, VehicleParts } from '../types';
import {
  computeBrakeAuthority,
  createCarState,
  type CarSimState,
} from '../Vehicle';
import { carSetupFromParts } from '../vehicle/CarSetup';
import { computeIdealLine } from '../vehicle/IdealLine';
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
  muSurface: number;
}

export interface FieldSetupResult {
  drivers: Driver[];
  entries: RaceCarEntry[];
  carsView: CarSimState[];
  ghostTrace: GhostTrace;
}

/** Qualifying score (0..1) used to order the grid: driver ability blended
 * with car pace. Higher = better grid slot. */
export function qualiScore(
  plan: { driver: Driver; parts: VehicleParts },
  budgetLo: number,
  budgetHi: number,
): number {
  const driver = driverStrength01(plan.driver, budgetLo, budgetHi);
  const tiers = Object.values(plan.parts);
  const avgTier = tiers.length ? tiers.reduce((s, t) => s + t, 0) / tiers.length : 0;
  const carPace = Math.max(0, Math.min(1, avgTier / 6));
  return 0.65 * driver + 0.35 * carPace;
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

  // Skill-based qualifying: order the grid by a qualifying score (driver
  // ability blended with car pace) instead of a random shuffle, so the grid
  // reflects competence rather than luck.
  const [qLo, qHi] = opponentBudget;
  carPlans.sort((a, b) => {
    const diff = qualiScore(b, qLo, qHi) - qualiScore(a, qLo, qHi);
    if (Math.abs(diff) < 1e-6) return a.driver.id < b.driver.id ? -1 : 1;
    return diff;
  });

  const entries: RaceCarEntry[] = carPlans.map((plan, i) => {
    const row = Math.floor(i / 2);
    const col = i % 2;
    const gridL = col === 0 ? -PHYSICS.gridColOffset : PHYSICS.gridColOffset;
    // Grid position: for sprints, start ON the track just after s=0 (start line).
    // For circuits, use full loop with grid behind the start/finish line.
    const isSprint = config.session === 'sprint';
    let gridS: number;
    if (isSprint) {
      // Sprint: grid ON the track (after start line), rows stack forward
      gridS = PHYSICS.gridPoleGap + row * PHYSICS.gridRowSpacing;
    } else {
      // Circuit: grid fully behind the start/finish line
      gridS =
        (track.length -
          PHYSICS.gridPoleGap -
          row * PHYSICS.gridRowSpacing +
          track.length) %
        track.length;
    }

    const stats = effectiveStats(config.discipline, plan.parts, plan.condition, plan.driver);
    const authority = plan.isPlayer ? computeBrakeAuthority(plan.driver.skill) : 1;

    const modifierStack = mergeModifierStacks(
      globalRainStack,
      buildTraitStack(plan.driver),
    );

    // muSurface is passed in from RaceDirector (already includes rain factor)
    // Build car-specific ideal line (physics-optimal per setup)
    const setup = carSetupFromParts(plan.parts, config.discipline);
    const idealLine = computeIdealLine(track, setup, stats, input.muSurface);

    // Build personal line from ideal line + driver style (replaces grid-column lanes)
    const lineO = buildPersonalLineFromIdeal(
      idealLine.idealLineO,
      { skill: plan.driver.skill, bravery: plan.driver.bravery, focus: plan.driver.focus },
      track,
      gridS,
      gridL,
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
      setup,
    );

    // Store ideal line on car for driver brain
    car.idealLineO = idealLine.idealLineO;
    car.idealVLine = idealLine.idealVLine;
    car.brakeZoneStart = idealLine.brakeZoneStart;
    car.turnInPoint = idealLine.turnInPoint;
    car.apexNode = idealLine.apexNode;
    car.trackOutNode = idealLine.trackOutNode;

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
