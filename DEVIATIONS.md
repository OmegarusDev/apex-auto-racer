# Deviations from the Engineering Spec

Short log of where the live build differs from the plan. The plan file remains the process source of truth.

## Process / tooling

- Built as a Cursor subagent (no `move_agent_to_root`); work tree is `~/cursorthings/ONGOING/apex-auto-racer` with a separate gitdir pointer.
- Phases landed in fewer commits than one-per-phase; commits still mark known-good points where practical.
- Interactive browser play-through is manual (`npm run play`). Headless smoke / determinism checks cover seed reproducibility. Capacitor / native Android are deferred (web + Pages is the verification target).

## Implementation

- **Ownership extract** — `src/engine/race/*`, `src/engine/vehicle/*` (real step carve + hybrid dynamics), `src/career/*`, `src/data/present.ts`, `src/scenes/race/*` (RaceChrome pedal deck + rev meter). Public seams: `RaceDirector.debugSnapshot()`, `runHeadless` / `runDeterminismCheck`, `RaceFrameView` / `CarFrameDto` / `FxImpulse`, `AudioTelemetry`. WebGL in-bundle only.
- **Hybrid overhaul (2026-08-11)** — see Intentional physics (hybrid) below. Feel: `validate:feel` (hybrid + drift/setup gates).
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

## Intentional physics (hybrid Mag + tyres — 2026-08-11)

**Constitution (§1 / expert doctrine):** real-ish Newton plane+yaw under a groove autopilot so one-finger play works. Player never gets a steer axis.

### State representation

- **Track binding:** Frenet `(s, l)` + forward speed `v` (ribbon projection).
- **Attitude:** `slipAngle` (sideslip β), `yawRate` ω, Mag `steerRad` (autopilot hands only).
- **Loads:** `fzFront` / `fzRear` from weight + aero DF + pitch/roll transfer.
- **Transmission:** `gear`, `rpm`, `gearBand`, `shiftWindow` (low/green/amber/red).

### Force inventory (every live effect traces here)

| Effect | Path |
|---|---|
| Weight | `massKg` × g → base Fz; inertia m a = ΣF |
| Downforce | q·CL → +Fz; induced drag q·CD (not a free µ bump) |
| Drive/brake | Long tyre demand → friction ellipse with lat |
| Lateral tyre | Two-axle brush/MF-lite from slip angle + κ; load sens n&lt;1 |
| Groove Mag | Bounded yaw-moment + lateral PD toward `steerTarget` — **saturates vs tyre budget**; never invents grip |
| Deslot | Mag authority collapse / overspeed / capacity / pin-bend / Mag saturation |
| Roll/pitch | Quasi-steady ΔFz from susp stiffness + CG (CarSetup) |
| Garage setup | `carSetupFromParts` → mass/CG/CL·CD/bias/compound/finalDrive into live dynamics |

`DRIFT_CFG.enabled` stays **false** — hybrid Mag+yaw + style latch replaced the free-yaw-as-slotted-primary path; do not flip the old flag.

### Drift styles (Phase 4 — hybrid latch)

| Discipline | Style | Behaviour |
|---|---|---|
| Track | fishtail | Damped yaw oscillation only; **latch off** |
| Rally | looseGround | Mag soft; progressive slide; brake-pulse initiate; hold-gear |
| Street | jdm | Latch + clutch-kick (Shift while armed); powerband hold; walls punish |

### Player fantasy

- **Casual:** hold gas — Mag tracks personal RPG line; Authority brake assist at low Skill.
- **Advanced:** trail brake + SHIFT rev windows + Street clutch-kick while armed/latched.
- **No steer stick / steer axis for the player.** AI `steerTarget` feeds Mag only.

### Modules

`vehicle/dynamics.ts`, `grooveAutopilot.ts`, `deslotDynamics.ts` (latch), `transmission.ts` (kick), `CarSetup.ts` (garage→forces), step files, `Gearbox` RPM/windows, `RaceChrome` SHIFT rev meter.

### Gates (hybrid+)

`HYBRID_FORCES`, `GROOVE_AUTOPILOT`, `ONE_FINGER_SURVIVE`, `GEAR_RPM`, `SHIFT_WINDOW`, `LINE_SKILL`, `DRIFT_RALLY`, `DRIFT_STREET`, `CLUTCH_KICK`, `SETUP_TRADEOFF`, `MASS_INERTIA`, `TRAIL_BIAS`, `OFFSLOT_DYNAMICS` — plus prior feel suite.
## Intentional physics (legacy notes — still true under hybrid)

Live failure mode is still groove/deslot (Scalextric peg), not free-yaw understeer as the primary limit:

- Cars Mag-track personal line `lineO(s)` while slotted; overspeed / Mag saturation in meaningful curvature **deslots**. Off-slot: excess lateral accel outward (Street biases toward near wall), spare grip toward line, scrub with excess. Straights do not deslot at full throttle.
- Spin is rare (high-speed wall smash while already deslotted). Quarantined `DRIFT_CFG.enabled` stays false; hybrid Street/Rally latch uses `driftState` under Mag soft.
- `v_deslot` spans Skill × Focus × Bravery; player Authority splits brake assist (stronger at low Skill) vs throttle trim (rises with Skill). Pin-throttle nearly kills brake assist.
- AI brakes for `vDriver` / live `v_deslot`, full throttle otherwise; draft hold then lateral pull-out. Soft bumper / grid-hold softens start rubs so the pack does not freeze at lights-out.
- **Line contact (2026-08-10)** — Same-lane overlaps stack in S (brake / speed-match); lateral peel only once centers clear ~0.5 carWidth (intentional pass). Soft bumper covers player+AI. Gate: `PACK_CONTACT`.
- Wall recovery is soft (stun cuts drive; no lateral freeze/teleport). Track width / normals / kerbs match painted asphalt.
- **Manual upshift gearbox:** Enter/gas, Space/brake; player Shift/tap upshifts (no miss slap). Auto downshift when off throttle in a low band. AI keeps assisted auto up/down. RPM/torque curves + SHIFT rev meter (green/amber/red). Street = 5 gears + harder walls + clutch-kick while armed/latched; Rally = 4 gears + longer deslot + softer Mag + brake-pulse slide.
- Opponent fields stratify weak→strong within the rank budget band (no dead stall-cars at novice).
- **Quick Race challenge floor** — Quick Race uses `max(unlocked+1, 2)` into existing opponentStatRanges / opponentPartTiers (tournament keeps true rank). Field traits are cycled for style variety; part roll biases upgraded.
- **Player pace (2026-08-10)** — `playerPaceMult` (0.5) scales live `vMax`/`aAccel` as well as `vDriver` (was targets-only, so pin-throttle still felt overpowered). Gate: `PLAYER_PACE_PHYS`. Opponent early bands + part tiers raised; field budget distribute no longer clamps away standout totals. `GEAR_ASSIST` asserts manual up / auto-down for the player.
- **Manual upshift** — player must Shift/tap to upshift; auto downshift when throttle is low in the downshift band. AI keeps auto up/down.
- **Quick Race track scale (2026-08-11)** — Early / slower Quick Race circuits shrink via non-freeze `BALANCE.quickRaceTrackScale` + duration/lap caps by pace band (`engine/race/paceTrackScale.ts`). `generateTrack(..., trackScale)` scales waypoint radius + modest asphalt width. Tournament / feel harnesses omit scale (1.0). Gate: `QR_TRACK_SCALE`.
- **Quick Race picker (2026-08-11)** — Title / Campaign Quick Race open `QuickRaceSetupScene`: discipline + curated presets (My Garage → Rookie → Factory Ace). Presets set driver/vehicle overrides + challenge/pace bands without rewriting career garage. Synthetic preset drivers skip garage condition writeback.

### Hybrid overhaul ship log (2026-08-11)

| Phase | Status |
|---|---|
| A0/A QR stabilize | Done (uncommitted QR scale + picker verified green) |
| 0 Vehicle carve + RaceChrome | Done — real step bodies; pedal deck + rev meter in `RaceChrome` |
| 1 Hybrid dynamics core | Done — two-axle tyres, Mag autopilot, Fz path, AI steerTarget |
| 2 LINE_SKILL | Done — Skill/Focus Mag bandwidth + line smoothing |
| 3 Gears + SHIFT rev | Done — windows/RPM curves; clutch-kick stub (Street) |
| 4 Drift styles | Done — fishtail / looseGround latch / jdm latch+kick; DRIFT_* + CLUTCH_KICK + OFFSLOT_DYNAMICS |
| 5 CarSetup | Done — parts→mass/CG/aero/bias/compound/FD live; Tuning v_deslot vs vMax; SETUP_* gates |
| 6 One-finger UX | Done light — Authority + teach stack (trail/shift/kick); `ONE_FINGER_SURVIVE` |
| 7 QR×3 GFX | Done — distinct palettes, dust vs smoke, QR blurbs, slide/kick audio hooks |
| 8 Docs/soak | DEVIATIONS + README updated; full story/pack polish still light |

### Driver stats → track (summary)

| Stat / trait | Effect |
|---|---|
| Skill | Large `v_deslot` / `vDriver` span; later braking when high; stronger throttle Authority; **Mag bandwidth** + apex cut |
| Bravery | Raises target toward peg (can overshoot); delays brake; harder wall stun accepted; wider carry |
| Focus | Wider hold; fewer mistakes; cleaner wall recovery; **Mag damp** + smoother baked line |
| Determination | Catch-up accel; stronger draft; shorter wake before pull-out |
| Slipstreamer / Hothead / Ice Cold / Showboat / Grinder / Loose Cannon | As in traits data (draft ×1.65, brake aggression, late-race calm, lead mistakes, XP, per-race jitter) |

## Feel baseline (2026-08-11)

Headless suite green after hybrid Mag+tyre rewrite + Phase 4–7 finish:

- `validate:feel` including HYBRID_* / DRIFT_* / CLUTCH_KICK / SETUP_* / MASS_INERTIA / TRAIL_BIAS / OFFSLOT_DYNAMICS
- start-validate / scalextric / collision / field / smoke / stack PASS
- PLAYER_PACE_PHYS + GEAR_ASSIST + PACK_CONTACT + QR_TRACK_SCALE gates

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

## Physics depth roadmap (race-engineer brief)

Goal: deepen **feel + garage RPG impact** inside the Scalextric groove/deslot fantasy — not a free-yaw Assetto clone. Every phase ships a named feel gate before freeze knobs move.

### What “realistic” means here

Keep `slotMode` / `v_deslot` / groove spring as the primary limit. Map real vehicle dynamics onto **proxies that already exist** (or extend them), not onto yaw DOF:

| Real concept | Apex seam | Proxy |
|---|---|---|
| Load transfer / roll stiffness | `Vehicle` groove capacity, `deslot*` spans, suspension tier → `lineNoise` / grip | Soft → easier deslot + noisier line; stiff → higher hold, harsher wall stun |
| Tyre temp / pressure / compound | Live `tyreTemp` + `computeTempGrip`; compound as part tier / discipline µ | Temp already warms; pressure/compound → gripFactor + heat rates (new non-freeze first) |
| Aero balance / downforce | Parts `spoiler` → `D` / `downforce`; balanceB | High DF → corner peg + drag on straights (explicit tradeoff) |
| Brake bias | Brakes tier + player Authority | Front bias → shorter stops, earlier deslot under trail; rear → rotate off-slot recovery |
| Gear ratios / powerband | `Gearbox` topFrac/torque per discipline | Garage “final drive” / short vs tall stacks as profiles, not free yaw |
| Mass / CG | New display→physics: mass↑ slows accel + raises deslot inertia; CG height↑ → load-transfer proxy | Gate before touching `playerPaceMult` |
| Suspension as grip/deslot capacity | Already partial (`lineNoise`); deepen into `grooveCapacity*` / rejoin | **Freeze-critical** — gate first |

Traits (`BrainIntent` / DriverBrain) stay storytelling + pedal psychology (late brake, draft greed), not fake physics.

### Highest fun / interactivity ROI

1. **Pedal skill ceiling** — readable peg meter + Authority teach; expand “trail brake into groove” feedback (haptic/audio already near deslot).
2. **Setup tradeoffs** — every upgrade costs something elsewhere (DF vs top, soft susp vs hold, short gears vs redline work).
3. **Readable telemetry** — tyre / peg / gear band already on HUD; add one setup readout on Tuning (predicted `v_deslot` vs `vMax` on a reference corner).
4. **EntertainmentMeter + intents** — keep spectacle scoring tied to real risk (near-deslot, draft pass, clean upshift), not random fireworks.

### Garage upgrades → real effects (no placebo)

- **Engine / intake / exhaust** → `aAccel` / `vMax` / powerband shape (Gearbox torque curve), fuel/heat cost later.
- **Aero (spoiler)** → `D` + straight drag; visible top-speed vs corner peg trade.
- **Tyres** → gripFactor + heat/cool rates + cold window (compound choices).
- **Brakes** → `aBrake` + bias proxy affecting deslot under trail.
- **Chassis / suspension** → lineNoise + deslot capacity + wall stun; the “handling” budget.

RPG stats (Skill/Focus/Bravery/Det) remain **driver** — they shift targets / Authority / mistakes, never silently inflate car grip.

### Phased roadmap (gates first)

1. ~~**Telemetry + Tuning readout**~~ — Tuning shows predicted `v_deslot` vs aero `vMax`.
2. ~~**Setup tradeoff knobs**~~ — `carSetupFromParts` + gate `SETUP_TRADEOFF`.
3. ~~**Mass / CG proxies**~~ — live mass inertia + gate `MASS_INERTIA`.
4. **Suspension → deslot capacity** — only after a failing gate on current tree; document in freeze protocol.
5. ~~**Brake bias + trail-deslot**~~ — gate `TRAIL_BIAS` (front bias loads front Fz under brake).
6. **Deep Entertainment / BrainIntent** coupling to setup risk — story density gate already exists.

### What NOT to do

- Do **not** revive dormant free-yaw / understeer / `DRIFT_CFG.enabled` as the primary limit.
- Do **not** casually retune freeze `PHYSICS` groove/deslot/`playerPaceMult` without a failing named gate.
- Do **not** add CDN/runtime physics libs; keep zero runtime deps + in-bundle WebGL.
- Do **not** turn garage tiers into flat “+2% everything” — every part family needs a counter-cost.
