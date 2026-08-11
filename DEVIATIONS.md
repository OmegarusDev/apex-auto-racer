# Deviations from the Engineering Spec

Short log of where the live build differs from the plan. The plan file remains the process source of truth.

## Process / tooling

- Built as a Cursor subagent (no `move_agent_to_root`); work tree is `~/cursorthings/ONGOING/apex-auto-racer` with a separate gitdir pointer.
- Phases landed in fewer commits than one-per-phase; commits still mark known-good points where practical.
- Interactive browser play-through is manual (`npm run play`). Headless smoke / determinism checks cover seed reproducibility. Capacitor / native Android are deferred (web + Pages is the verification target).

## Implementation

- **Ownership extract in progress** — In-tree phased refactor (feel freeze sacred). Planned module paths: `src/engine/race/*` (pack/contact/draft/field/events/headless), `src/engine/vehicle/*` (updateVehicle step carve), `src/career/*` (xp/garage/launch/results), `src/data/present.ts` (pxPerM/dprCap out of PHYSICS), `src/scenes/race/*` (RaceChrome/frameBus/audioBridge). Public seams must stay stable: `RaceDirector.debugSnapshot()`, `runHeadless` / `runDeterminismCheck`, `RaceFrameView` / `CarFrameDto` / `FxImpulse`, `AudioTelemetry`. WebGL race world stays in-bundle (no CDN/fetch assets). Baseline: `validate:feel` 23/23 PASS (Phase 0).
- **Phase 1** — `pxPerM` / `dprCap` moved from `PHYSICS` to `PRESENT` (`src/data/present.ts`). Presentation-only; not feel-freeze.
- **Phase 2** — Pack extract under `src/engine/race/`: `trackMath`, `draft`, `rivals`, `contact` (`resolveContacts` → ContactStats), `modifiersSetup`, `types` (`RaceCarEntry`). RaceDirector calls `resolveContacts` and applies overlap frame deltas.
- **Phase 3** — Further thin: `fieldSetup`, `eventRing`, `standings`, `ghost`, `headless`, `quickRaceConfig` under `src/engine/race/`. RaceDirector re-exports `runHeadless` / `runDeterminismCheck` / `quickRaceConfig` / `teamColor`. ~799 LOC orchestrator.
- **Phase 4** — `Vehicle.ts` is a 34-LOC barrel under `src/engine/vehicle/*` (types/authority/zones/deslotMargin/create re-export seams; `updateVehicle.ts` holds the feel-identical body with section markers). Full step-body carve into groove/deslot/wall/drive deferred to avoid order-sensitive drift — seams ready for bisectable follow-up.
- **Phase 5** — Career domain under `src/career/*`; `sceneChrome` + `titleArt` under scenes; deleted `sceneUtils.ts` / `raceTypes.ts`. `launchRace` keeps static `RaceScene` import.
- **Phase 6** — `src/scenes/race/` owns `frameBus`, `raceCamera` (CameraDirector seam), `audioBridge` (countdown), `onboarding` helpers, `RaceChrome` seam. RaceScene host still holds car-audio/particles + HUD draw bodies (~1.4k LOC) — further chrome thin is presentation-only follow-up.
- **Phase 7** — Deleted graphics shims (`CarMesh`, `Particles`, `VectorRenderer`, `camera/Camera`). titleArt imports `CarPainter`. Canvas2D world path is silent emergency fallback only; do not add features to TrackBaker/Blit. No CDN/fetch graphics assets.
- **Phase 8** — `ui/components.ts` barrel; ownership modules `hit/button/slider/modal/toast/shell/charts/panels` re-export from `components.impl.ts` (body carve follow-up; call sites unchanged).
- **Phase 9** — `src/data/disciplineProfiles.ts` read seam; Vehicle wall/deslot/runoff use profile fields. Gate `DISCIPLINE_PROFILE_MATCH`.
- **Phase 10** — Custom engines path map updated; ownership extract complete (with noted follow-ups).
- **New-game seed** — `SaveManager.createNew()` / `GameContext.startNewGame()` may use `Date.now()` when unseeded. Race sim stays fully seeded (`trackSeed` / `raceSeed`). Quick Race seeds derive from career counters.
- **Race launch** — `launchRace` statically imports `RaceScene` (a dynamic-import cycle previously stuck on "Race loading..."). Results loads lazily from `RaceScene.finishRace`. Failures surface real errors, never a fake loading toast.
- **Tournament standings** — Standings length follows `format.teamCount` (You + Rival 1…N). Rank cups still use 2-team formats today; multi-team formats (e.g. 2v2v2) are supported by the same standings path.
- **RaceDirector split** — Pack/field/events/headless live under `engine/race/*`; `debugSnapshot()` remains the public feel-harness seam.

## Intentional physics (Scalextric groove)

Live model is groove/deslot, not free-yaw understeer as the primary limit:

- Cars magnetically hold racing line `o(s)` while slotted; overspeed in meaningful curvature **deslots**. Off-slot: excess lateral accel outward, spare grip toward `o(s)`, scrub with excess. Straights do not deslot at full throttle.
- Spin is rare (high-speed wall smash while already deslotted). Drift latch is dormant so it does not fight groove/deslot.
- **P3 dormant cull:** free-yaw / understeer vocabulary (`kUnder`, oversteer*, coldYaw*, etc.) removed from the live path — groove-only. `DRIFT_CFG` stays quarantined with `enabled: false`.
- `v_deslot` spans Skill × Focus × Bravery; player Authority splits brake assist (stronger at low Skill) vs throttle trim (rises with Skill). Pin-throttle nearly kills brake assist.
- AI brakes for `vDriver` / live `v_deslot`, full throttle otherwise; draft hold then lateral pull-out. Soft bumper / grid-hold softens start rubs so the pack does not freeze at lights-out.
- **Line contact (2026-08-10)** — Same-lane overlaps stack in S (brake / speed-match); lateral peel only once centers clear ~0.5 carWidth (intentional pass). Soft bumper covers player+AI. Gate: `PACK_CONTACT`.
- Wall recovery is soft (stun cuts drive; no lateral freeze/teleport). Track width / normals / kerbs match painted asphalt.
- **Manual upshift gearbox:** Enter/gas, Space/brake; player Shift/tap upshifts (no miss slap). Auto downshift when off throttle in a low band. AI keeps assisted auto up/down. Mild torque/topFrac personality per discipline; soft gear-cap overshoot (`gearCapSoft`). Street = 5 gears + harder walls; Rally = 4 gears + longer deslot.
- Opponent fields stratify weak→strong within the rank budget band (no dead stall-cars at novice).
- **Quick Race challenge floor** — Quick Race uses `max(unlocked+1, 2)` into existing opponentStatRanges / opponentPartTiers (tournament keeps true rank). Field traits are cycled for style variety; part roll biases upgraded.
- **Player pace (2026-08-10)** — `playerPaceMult` (0.5) scales live `vMax`/`aAccel` as well as `vDriver` (was targets-only, so pin-throttle still felt overpowered). Gate: `PLAYER_PACE_PHYS`. Opponent early bands + part tiers raised; field budget distribute no longer clamps away standout totals. `GEAR_ASSIST` asserts manual up / auto-down for the player.
- **Manual upshift** — player must Shift/tap to upshift; auto downshift when throttle is low in the downshift band. AI keeps auto up/down.

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

- start-validate: 0 stalls; pin P1 ≤3/8; playerPaceMult=0.5 on vDriver+vMax+aAccel; manual player upshift
- scalextric: finish 100%; deslots/car≈1.65; pin deslots; street walls
- collision: residual overlap ≈0.03%; PACK_CONTACT (no same-lane peel-through)
- field: not always P1; finish 100%
- smoke determinism + stack-smoke PASS
- PLAYER_PACE_PHYS + GEAR_ASSIST (manual up) + PACK_CONTACT gates

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

1. **Race sim** (seeded, headless) — `RaceDirector` facade composing `engine/race/*` (pack/contact/draft/field/events/ghost/headless), Physics (`engine/vehicle/*` via `Vehicle` barrel), Gearbox, Brain, Track, Modifiers, **EntertainmentMeter**. No Web Audio / DOM on the hot path. Presentation knobs: `data/present.ts` (`PRESENT`); feel freeze stays in `PHYSICS` / `BALANCE`. Discipline branching reads: `data/disciplineProfiles.ts`.
2. **Presentation** — `AudioEngine`, **Apex WebGL engine** (`src/graphics/engine/*` via `RaceView`), Canvas2D HUD/menus (`ui/*` barrels), Race fantasy chrome (`RaceFantasyHud`), `scenes/race/*` (frameBus/camera/audioBridge). Dual canvas: `#world` (WebGL) under `#game` (HUD). Consume a per-frame snapshot (`RaceFrameView` / `AudioTelemetry`). Never write into physics except via Input pedals. Canvas2D world path is silent emergency fallback only — do not add features to TrackBaker/Blit.
3. **Career** (between races) — `src/career/*` (xp/garage/roster/launch/results/ghost/tournament) mutates `GameState` only after the flag. Scene chrome/title art: `scenes/sceneChrome.ts`, `scenes/titleArt.ts`.

**Presentation bus:** RaceScene builds telemetry + hype from the director; audio/HUD/engine read only that.

**Follow-ups (non-blocking):** vehicle step-body carve into groove/deslot/wall/drive; RaceScene HUD draw thin into `RaceChrome`; `ui/components.impl` body split into named files; CameraDirector.

## Deferred

- On-device Android LAN verify not run here (Capacitor scaffolding removed until needed).
- Exhaustive tier/rank balance matrices and dual-orientation visual QA remain manual.
- Full visual identity + menu-flow product overhaul deferred until playability soak.
- **Presentation rebuild (2026-08-10)** — Graphics engine split into `RaceView` + `TrackBaker` / `TrackBlit` / `CarPainter` / `materials` / `TrackSampler`. RaceScene consumes `RaceFrameView` DTOs; cars show part tiers / condition / tyre; garage+tuning share CarPainter; brand shell via `ui/brand.ts`. Feel-freeze physics untouched. Quick Race Results Back uses `returnTo: 'title'`.
- **Race chrome + track origin (2026-08-10)** — Bottom pedal deck + shared `raceChromeLayout` (pause/minimap dead-zone); Quick Race `quickRaceNonce` (save v2); TrackGenerator phase-shifts `s=0` to best straight; Pages `100dvh` + visualViewport + splash.
