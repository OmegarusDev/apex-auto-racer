# Deviations from the Engineering Spec

Short log of where the live build differs from the plan. The plan file remains the process source of truth.

## Process / tooling

- Built as a Cursor subagent (no `move_agent_to_root`); work tree is `~/cursorthings/ONGOING/apex-auto-racer` with a separate gitdir pointer.
- Phases landed in fewer commits than one-per-phase; commits still mark known-good points where practical.
- Capacitor config is present; native Android / `@capacitor/app` were not added — web build is the verification target.
- Interactive browser play-through is manual (`npm run play`). Headless smoke / determinism checks cover seed reproducibility.

## Implementation

- **New-game seed** — `SaveManager.createNew()` / `GameContext.startNewGame()` may use `Date.now()` when unseeded. Race sim stays fully seeded (`trackSeed` / `raceSeed`). Quick Race seeds derive from career counters.
- **Race launch** — `launchRace` statically imports `RaceScene` (a dynamic-import cycle previously stuck on "Race loading..."). Results loads lazily from `RaceScene.finishRace`. Failures surface real errors, never a fake loading toast.
- **Tournament standings** — Standings length follows `format.teamCount` (You + Rival 1…N). Rank cups still use 2-team formats today; multi-team formats (e.g. 2v2v2) are supported by the same standings path.
- **RaceDirector split** — Full `race/*` module extract deferred; `debugSnapshot()` is the public feel-harness seam. Split when contact/draft tests need isolation.

## Intentional physics (Scalextric groove)

Live model is groove/deslot, not free-yaw understeer as the primary limit:

- Cars magnetically hold racing line `o(s)` while slotted; overspeed in meaningful curvature **deslots**. Off-slot: excess lateral accel outward, spare grip toward `o(s)`, scrub with excess. Straights do not deslot at full throttle.
- Spin is rare (high-speed wall smash while already deslotted). Drift latch is dormant so it does not fight groove/deslot.
- **P3 dormant cull:** free-yaw / understeer vocabulary (`kUnder`, oversteer*, coldYaw*, etc.) removed from the live path — groove-only. `DRIFT_CFG` stays quarantined with `enabled: false`.
- `v_deslot` spans Skill × Focus × Bravery; player Authority splits brake assist (stronger at low Skill) vs throttle trim (rises with Skill). Pin-throttle nearly kills brake assist.
- AI brakes for `vDriver` / live `v_deslot`, full throttle otherwise; draft hold then lateral pull-out. Soft bumper / grid-hold softens start rubs so the pack does not freeze at lights-out.
- Wall recovery is soft (stun cuts drive; no lateral freeze/teleport). Track width / normals / kerbs match painted asphalt.
- **Assisted gearbox:** Enter/gas, Space/brake; gears auto up/down. Shift = optional early upshift nudge (no miss slap). Mild torque/topFrac personality per discipline; soft gear-cap overshoot (`gearCapSoft`). Street = 5 gears + harder walls; Rally = 4 gears + longer deslot.
- Opponent fields stratify weak→strong within the rank budget band (no dead stall-cars at novice).

### Driver stats → track (summary)

| Stat / trait | Effect |
|---|---|
| Skill | Large `v_deslot` / `vDriver` span; later braking when high; stronger throttle Authority |
| Bravery | Raises target toward peg (can overshoot); delays brake; harder wall stun accepted |
| Focus | Wider hold; fewer mistakes; cleaner wall recovery |
| Determination | Catch-up accel; stronger draft; shorter wake before pull-out |
| Slipstreamer / Hothead / Ice Cold / Showboat / Grinder / Loose Cannon | As in traits data (draft ×1.65, brake aggression, late-race calm, lead mistakes, XP, per-race jitter) |

## Feel baseline (2026-08-10)

Headless suite green after groove rethink + crash recovery + tyre warm-up:

- start-validate: 0 stalls; pin P1 ≤3/8; playerPaceMult=0.5 (assisted gearbox — pin no longer self-sabotages via miss-shifts)
- scalextric: finish 100%; deslots/car≈1.65; pin deslots; street walls
- collision: residual overlap ≈0.03%
- field: not always P1; finish 100%
- smoke determinism + stack-smoke PASS

## Feel freeze set (do not retune without a failing gate)

Change protocol:

1. Add/adjust a named gate that fails on current tree (`npm run validate:feel`).
2. Change the knob.
3. Re-run `npm run validate:feel` until green.
4. Note why here.

### PHYSICS (freeze-critical)

`dt`, `brainEveryN`, `grooveKappaMin`, `grooveSpring`, `grooveDamp`, `grooveLoadKill`, `grooveCornerKill`, `grooveLatMinV`, `grooveLatFullV`, `grooveMaxDlPerV`, `oDeslot`, `oDeslotSpeedFrac`, `grooveCapacityDeslotL`, `grooveCapacityMagnetMin`, `deslotSkillBase`, `deslotSkillSpan`, `deslotFocusBase`, `deslotFocusSpan`, `deslotBraveryBase`, `deslotBraverySpan`, `deslotMinTime`, `deslotRejoinL`, `deslotRejoinVFrac`, `deslotRejoinImmunity`, `deslotSteerGain`, `deslotSteerFrac`, `deslotSteerMinRoll`, `deslotScrubGain`, `deslotScrubMaxG`, `deslotReleaseImpulse`, `deslotWallPush`, `deslotLatDamp`, `gridHoldSec`, `gridHoldPureFrac`, `gridFollowGainMult`, `gridMaxDl`, `gridColOffset`, `gridRowSpacing`, `aiLaunchSec`, `aiLaunchMinThrottle`, `recoveryBrainSec`, `brakeAuthorityBase`, `brakeAuthoritySpan`, `throttleAuthorityBase`, `throttleAuthoritySpan`, `wallMargin`, `crashSpeed`, `crashSpeedMult`, `crashStun`, `streetWallStunMult` (discipline mult), `crashRecoveryDecel`, `crashRecoveryDecelDeslot`, `wallRestitution`, `wallImpactScrub`, `spinWallSpeed`, `spinStun`, `tyreStartTemp`, `tyreTempMax`, `tyreRecoveryFloor`, `tyreColdGrip`, `tyreHotGrip`, `tyreHeatSpeed`, `tyreHeatOver`, `tyreHeatDrift`, `tyreCool`, `draftSpeedBonus`, `draftAccelBonus`, `draftCornerKappa`, `draftDetBonus`

### BALANCE (freeze-critical)

`playerPaceMult`, `opponentStatRanges`, `opponentPartTiers`, `contactGap`, `contactSpeedCap`, `contactNudge`, `contactIters`, `contactBounce`, `contactCrashClosing`, `contactDeslotClosing`, `contactConditionSeverityMin`, `followTimeGap`, `followMinGap`, `followSkillGapSpan`, `draftGapMax`, `draftLateralMax`, `overtakeDraftThreshold`, `overtakeHoldSec`, `overtakeDurationSec`, `overtakeLateralShift`, `rainMuMult`, `finishWindowSec`, `wallCrashConditionLoss`, `contactCrashConditionLoss`

## Custom engines (layer map)

Three layers — keep new work in the right one:

1. **Race sim** (seeded, headless) — `RaceDirector` facade composing Physics (`Vehicle`), Gearbox, Brain, Track, Modifiers, **EntertainmentMeter**, and the event ring. No Web Audio / DOM on the hot path.
2. **Presentation** — `AudioEngine`, Render (Camera/VectorRenderer/Particles), UITheme, Race HUD. Consume a per-frame snapshot (`AudioTelemetry` + event cursor + hype). Never write into physics except via Input pedals.
3. **Career** (between races) — payouts/XP/objectives/tournaments/garage mutate `GameState` only after the flag.

**Presentation bus:** RaceScene builds telemetry + hype from the director; audio/HUD/particles read only that.

**Deferred extracts:** full `race/*` split; Economy / Tournament / Garage domain modules; DisciplineProfiles; CameraDirector; NativeShell. Audio/Entertainment land first along these seams.

## Deferred

- On-device Android LAN verify not run here.
- Exhaustive tier/rank balance matrices and dual-orientation visual QA remain manual.
