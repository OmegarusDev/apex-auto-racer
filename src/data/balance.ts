/** Centralized gameplay balance tunables — mutated by debug overlay. */

export const BALANCE = {
  startingCash: 1100,
  rosterCap: 6,
  freeAgentPoolSize: 4,
  freeAgentRerollCost: 250,
  repairCostPerPoint: 10,
  conditionMin: 0.6,
  conditionMax: 1.0,
  /** Soft career ding per hard wall — repairable, not race-ending. */
  wallCrashConditionLoss: 0.022,
  hireCostMultiplier: 12,
  /** Early roster sits under mid-pack so default careers are challenges, not stomps. */
  startingDriverStatMin: 22,
  startingDriverStatMax: 40,
  startingRosterSize: 3,
  startingPartTier: 1,
  maxPartTier: 5,
  /** Player vDriver pace trim — unupgraded careers should lose to a clean field. */
  playerPaceMult: 0.65,
  rainChance: 0.1,
  /** Softened from 0.75 so rain + cold + novice does not auto-spin early ranks. */
  rainMuMult: 0.82,
  rainMistakeMult: 1.35,
  handsOffBonusMax: 0.5,
  pointsPerPosition: [12, 9, 7, 5, 4, 3, 2, 1] as number[],
  rankBasePayout: [200, 400, 800, 1600, 2800, 4500] as number[],
  placementMult: [1.0, 0.55, 0.30, 0.15] as number[],
  tournamentRacePayoutMult: 1.25,
  tournamentPrizePools: [2500, 6000, 14000, 30000, 60000, 120000] as number[],
  tournamentPrizeSplit: [0.6, 0.25, 0.1, 0.05] as number[],
  xpBase: 20,
  xpPerPoint: 6,
  rankXpMult: [1.0, 1.3, 1.6, 2.0, 2.5, 3.0] as number[],
  levelCostBase: 100,
  levelCostGrowth: 1.3,
  skillPointStatGain: 2,
  quickRaceDurationMin: 90,
  quickRaceDurationMax: 150,
  maxLaps: 9,
  minLaps: 1,
  /**
   * Per-rank average-stat band. Floors stay high enough that no AI is a
   * dead stall-car; ceilings keep standouts. Variance lives inside the band.
   */
  opponentStatRanges: [
    [44, 78],
    [52, 84],
    [62, 90],
    [72, 95],
    [80, 98],
    [86, 99],
  ] as [number, number][],
  /** Part tier band per rank — standouts can sit at the top of the band. */
  opponentPartTiers: [
    [2, 3],
    [2, 3],
    [2, 4],
    [3, 5],
    [3, 5],
    [4, 5],
  ] as [number, number][],
  freeAgentStatBase: [26, 55] as [number, number],
  freeAgentStatPerRank: 8,
  freeAgentStatCap: 98,
  draftGapMax: 28,
  draftLateralMax: 1.8,
  overtakeDraftThreshold: 0.36,
  overtakeHoldSec: 0.85,
  overtakeDurationSec: 3.5,
  /** Lateral offset onto a clear lane — sized for ~27–36 m asphalt. */
  overtakeLateralShift: 3.9,
  /** Bumper clearance used by AI sensing (matches PHYSICS.carLength). */
  contactGap: 5.1,
  /** Follower speed cap vs leader on longitudinal contact. */
  contactSpeedCap: 0.92,
  /** Extra lateral separation rate (m/s) while bodies overlap. */
  contactNudge: 4.8,
  /** Iterative pack resolve passes per physics step. */
  contactIters: 4,
  /** Fraction of closing speed transferred as a leader bump. */
  contactBounce: 0.32,
  /** Closing speed (m/s) that counts as a hard car-car hit. */
  contactCrashClosing: 7.5,
  /** Side-impact |Δl| rate / overlap that can pop a peg. */
  contactDeslotClosing: 9,
  /** Condition loss scale on hard car contact (player). */
  contactCrashConditionLoss: 0.012,
  /** Min rear-end severity before condition is charged (kiss bumps are free). */
  contactConditionSeverityMin: 0.55,
  /** AI target time gap (s) to the car ahead in the same lane. */
  followTimeGap: 0.38,
  /** AI starts lifting/braking inside this bumper gap (m). */
  followMinGap: 2.6,
  /** Low-skill AI brakes earlier for traffic (extra time-gap mult). */
  followSkillGapSpan: 0.72,
  finishWindowSec: 10,
  standingsInterval: 0.25,
  ghostSampleEveryN: 4,
  activeObjectives: 3,
};

export const RANK_NAMES = [
  'Novice',
  'Amateur',
  'Semi-Pro',
  'Pro',
  'Elite',
  'Legend',
] as const;

export type RankId = 0 | 1 | 2 | 3 | 4 | 5;
