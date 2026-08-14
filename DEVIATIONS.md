# Deviations from the Engineering Spec

Short log of where the live build differs from the plan. The plan file remains the process source of truth.

## TT/Sprint polish pass (2026-08-14)

- **TT payout is a modest flat fee** (~12% of rank base) instead of full winner's
  cash — a single-car TT could otherwise farm money.
- **Sprint progress fix**: the HUD bar measured the wrong car (cars[0]) AND read
  ~100% on the grid (a grid car sits at s≈L−δ, so s/finishS≈2). It now uses the
  player car and measures distance past the START line (grid → 0%, finish → 100%).
- **Sprint HUD**: adds a progress bar under the `SPRINT xx%` readout.
- **TT results**: shows `TIME m:ss.s` where "WINNER" would be (a TT's result IS
  the time); the podium already handled a 1-car field safely.
- **Pre-race card** is session-aware: `SPRINT · name` / `TIME TRIAL · name` instead
  of a wrong lap count.
- **Checkered start/finish band** on the track mesh: always at s=0 (start), and at
  `sprintFinishS` for sprints wherever it lands. The sprint ribbon extends 8 m past
  the line as a roll-out so the banner sits fully on tarmac.
- Confirmed tournaments never spawn sprints (the 25% roll lives only in
  `makeQuickRaceConfig`).

## Time Trial + Sprint sessions (2026-08-14)

Two new session kinds beside the circuit race, plumbed through
`RaceLaunchConfig.session` / `RaceConfig.session` (`raceLaunch.ts`, `RaceDirector.ts`):

- **`timeTrial`** — a single car (new `tt` format, `teamCount: 1` → zero opponents via
  `fieldSetup`'s `(teamCount-1)·teamSize`), a timer that starts at GO, and 1–3 laps
  scaled to the pace band. HUD shows `TIME …s` + `Lap x/y`. New "Time Trial" button on
  the Title screen; "Next" from the results starts a fresh TT.
- **`sprint`** — a point-to-point race on a loop that never visibly loops. The track is
  generated as a **doubled-length, elongated loop** (`TrackScaleOpts.sprint` →
  `lengthMult` 2.0, `elongation` 2.0, low radial noise for long straights), and the
  finish line lands at a random **42–58% of the loop**. The ribbon is rendered open,
  truncated at `sprintFinishS`, and the loop's return half is never drawn — a "trip
  from A to B", not a circuit. The minimap normalizes to the raced portion only.
  The director finishes a car on a single crossing of `sprintFinishS` (no laps, no
  wrap). ~25% of Quick Races roll a sprint (`rng() < 0.25` in `makeQuickRaceConfig`).

Track `lengthMult` clamp is raised to 2.6 for sprints (was 1.35). `phaseShiftStartToStraight`
still places the grid on the start straight. All 27 feel gates + build green; 36-race
sanity: ~31% sprints, no sprint DNFs, normal circuits unaffected.

Follow-ups: TT payout/economy (currently awards winner cash), TT discipline choice,
Custom Race UI (sliders for shape/laps/sprint), dedicated Quick Race garage, driver→racer rename (deferred).

## Bug-fix audit pass (2026-08-14)

Audit of the whole engine (sim + driver + race flow) found and fixed:

- **`deslotImmunity` never decayed** — the first hard contact permanently disabled
  contact-deslot for the rest of the race. Now decays each tick (vehicle.ts).
- **Marshal left a stale `headingErr`** — a recovered car's tyres read a huge body
  slip and instantly re-stuck (recover→crawl→recover). Recovery resets `headingErr`,
  and the heading integration is now wrapped so a full spin can't unboundedly grow it.
- **Marshal penalties were free** — `penaltySec` was accumulated but never applied to
  results. Now folded into `finishTime` for standings AND exposed as `penaltySec` on
  `CarFinishEntry`/`StandingEntry`.
- **driveBias sentinel mismatch** — the sim resolved `driveBias===0` as "pure RWD"
  while the driver resolved it to a discipline default; and drive.ts had a stale
  `street ? 0.12 : 0.5` fallback contradicting the new drivetrain. Both now use the
  shared `resolveDriveBias(setup, discipline)` (street/track 0.06 RWD, rally 0.5 AWD).
- **Grip-budget throttle was one-directional** — `Math.max(0, κ)` zeroed the corner
  load share on every left-hand corner, so the throttle plan never limited power there.
  Now `Math.abs(κ)` — symmetric cornering.
- **`driveForce` ignored the live top speed** — draft/condition/modifier top-speed
  bonuses shifted the gearbox but the drive stayed capped at the raw gear top. Now uses
  `vMaxEff` (the intended bonuses work; slight pace-gap widening is the honest effect).
- **`driftState` was a latch** — once set by a clutch-kick it stuck for the whole race.
  Now cleared when the slide is gone.

All validation suites green: 27/27 feel gates, intent/meta/start/slot/pack/field/smoke.

## Drivetrain + emergent drift (2026-08-14) — RWD/AWD, and the car slides naturally

The drivetrain is now a per-car-class property, not a discipline sentinel:

- **Track** = RWD, open diff (`driveBias 0.06, diffLock 0`) — holds the limit, precise.
- **Street** = RWD, locked-ish diff (`driveBias 0.06, diffLock 0.6`) — the drift cars: the
  locked diff crisps the rear breakaway so the drift starts predictably. Not fully
  locked — a full lock snapped the rear at R28 hairpins (spin-recover-spin loops).
- **Rally** = AWD (`driveBias 0.5, diffLock 0.1`).
- The old sentinel (`driveBias 0` → FWD street 0.12) is gone: the setup carries the
  drivetrain, `carSetupFromParts(parts, discipline)`.

The drift now EMERGES from the physics (no scripted effect):

- **Driven-axle breakaway is fixed for drivetrain**: the driven axle gets the soft
  post-peak (holdable slide). It was hard-wired to the FRONT (an FWD assumption);
  now RWD/AWD cars drift off the REAR.
- **Steering is pure pursuit**: the stabilizers that silently erased the body slip are
  cut from (0.45 yaw, 0.45 lateral) to (0.15, 0.18). The wheels point where the Racer
  aims the nose; the drift lives in the body slip. The small residual lateral damper
  catches momentum plows at hairpins without erasing the drift.
- **Low-speed kinematic glue dropped 4 → 1.2 m/s** — below ~1.2 m/s the velocity
  follows the forces, so the body can slide at any cornering speed.
- **Drift throttle taper**: the driver feathers the pedal as the slide grows (instead
  of panic-cutting), so the drift settles and holds.
- **Street breakaway pulled in (3.2 → 2.2·alphaPeak)** — the street's grip held to 48°
  slip, so a big slide couldn't shed momentum until the collapse → spins. Now the grip
  drops past 30°, the driver catches the smaller slides, and the big ones collapse
  controllably. (The 8-seed street went from 6/8 with 2.1 spins to 8/8 with 0.5.)

Measured drift (sustained body slip in corners, latG>0.3): Track 6°, Street 7°, Rally 8°.
Street max 41° (a big caught fishtail — the drift car's signature), Track 16° (precise).
Baseline: Track 8/8 P3.1 (0.1 spins), Street 8/8 P2.6 (0.5 spins), Rally 8/8 P3.1 (0 spins).
27/27 gates green, build green.

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
- **Manual upshift gearbox:** Enter/gas, Space/brake; player Shift/tap upshifts any time the rev band will accept it (gas or not) — no miss slap. Pin-throttle safety net: ~1s held at the redline band auto-upshifts (no crawl). Auto downshift when off throttle in a low band. AI upshift band is governed by driver skill (`aiUpshiftBand`), never a fixed timer or pace trim — low-skill drivers hold gears into the redline and lose time, skilled drivers shift at green-window start. RPM/torque curves + SHIFT rev meter (green/amber/red). Street = 5 gears + harder walls + clutch-kick while armed/latched; Rally = 4 gears + longer deslot + softer Mag + brake-pulse slide.
- Opponent fields stratify weak→strong within the rank budget band (no dead stall-cars at novice).
- **Quick Race challenge floor** — Quick Race uses `max(unlocked+1, 2)` into existing opponentStatRanges / opponentPartTiers (tournament keeps true rank). Field traits are cycled for style variety; part roll biases upgraded.
- **No player pace handicap (2026-08-13)** — `playerPaceMult` removed: the player's live `vMax`/`aAccel`/`vDriver` are raw part+driver stats. Race pace emerges from parts, driver skill, and gear/brake execution — player and AI follow the same physics. Player safety net: redline-dwell auto-upshift (`PHYSICS.redlineAutoShiftSec`). AI shift quality scales with driver skill only. Gates: `PLAYER_PACE_PHYS`, `GEAR_ASSIST` (pin-throttle auto-climbs; coast upshift at valid band; low-rev Shift refused).
- **Manual upshift** — player must Shift/tap to upshift (or ride the redline for the auto safety net); auto downshift when throttle is low in the downshift band. AI upshift band from driver skill.
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

## Brake-force bug + finish/launch/gear fixes (2026-08-14)

- **Brakes were always zero** — `clampFx` used `Math.max(0, muLong)·Fz` as the
  cap, but `muLong` is *negative* for a braking demand (negative slip), so the
  cap was 0 and the car could never slow down. This single bug caused every
  corner crash, the "painfully slow" crawling (post-crash downshifts), and the
  premature finishes (lapped and cut off). Fixed to `Math.abs(muLong)`. This is
  the big one — with braking working, cars brake 21→9 m/s into hairpins.
- **Finish window** — a lapped starter car was cut off mid-lap by the 45 s cap;
  with the braking fix the starter car completes its laps.
- **Marshal** — only truly-stuck cars get picked up (sustained slide needs
  v<6 / |β|>0.8 for 1.2 s; stalled needs v<2 off-line) so recoverable slides
  aren't punished.
- **Gears** — verified working (1→2→3); the earlier "can't upshift" was the
  downshift-after-crash cascade, now mostly gone.

## General improvement pass (2026-08-14) — "it works, just not as intended"

The game drove but didn't behave how it was meant to. Three structural fixes:

- **Disciplines now generate their OWN circuits.** The oval archetype was being
  picked ~75% of the time for EVERY discipline (the RNG-heavy weights), so a
  "street race" was just the same wide oval with a different surface. Weights
  are now 9:0:1 per discipline (Track→GP 33m, Street→27m tight, Rally→open
  rally-loop 30m + 9m run-off). Each discipline now feels like its own place:
  Track open+fast, Street tight+walled, Rally loose+open.
- **The wall-grind is dead.** A car pinned against a wall scraped along at
  v~0.5 FOREVER (the peel pushed `dl`, but `dl` is recomputed from the heading
  every tick so the push was erased). The scrape now rotates the velocity
  heading away from the wall, so a pinned car arcs back on-track. Also fixed
  the marshal's wall-limit: it used node[0]'s width instead of the car's
  current node, so "wedged" never fired on narrower street sections.
- **Marshal recoveries now work properly.** A recovered car was left in 2nd
  gear at idle revs (band 0 = zero torque) and could never drive away — it
  bounced recover→crawl→recover until lapped. The recovery now resets the
  transmission to 1st. And the "long-stopped" marshal only fires when the car
  is truly NOT progressing (s not advancing), not when it's just crawling
  through a tight corner.

Plus the driving feel:

- **The whip**: corner commitment raised (margin 0.78–0.95) so the car carries
  real speed (latG 0.80 vs 0.56 before) — the car carves corners near the
  limit instead of pootling around them.
- **The de-slot pop**: sharper tyre breakaway (postPeakDecay up, breakawayMult
  down) — the grip holds then releases dramatically; the driver's broadened
  slide recovery (yaw OR lateral) catches the pops.
- **Both-axle throttle budget**: the grip budget checked only the front axle;
  a powerful AWD/RWD car's exits broke the rear loose. Now both axles must hold
  their drive share → the AI's faster cars stay on the loose surface.
- **Brake cutoff at target**: the brake formula kept 0.25 residual braking at
  vTarget, overslowing into corners (brake→crawl→re-accelerate wobble that
  killed average speed and caused stalls). The brake now cuts off within 5% of
  the corner target. This single change fixed the last DNFs everywhere.
- **Rally grip raised to 0.84** so the loose character comes from the dynamics
  (bumpy noise, poor brakes, open run-off) rather than a base grip below the
  cars' power — the AI can now hang instead of spinning itself into last.

Balance (8-seed baseline, starter car vs parts-3/4 AI, 2 laps):
- Track: 7–8/8 complete, ~0.4 walls, ~0.3 spins, P3.0–3.5 — the starter is
  naturally last (power game), clean races.
- Street: 8/8 complete, ~0.4 walls, 0 spins, P2.8 — the starter is naturally
  mid/last (walls punish), races are tight.
- Rally: 8/8 complete, ~0 walls, ~0.1 spins, P1 — the starter CAN win the
  loose surface (control rewards — coherent, but the "easy" discipline).

27/27 gates green, build green.

## Feel-tuning pass (2026-08-14) — car feel dialled in

Physics testing across 8 seeds × 3 disciplines (starter car vs parts-3/4 AI):

- **Track** — dialled in: 8/8 complete, ~0.1 spins/race, ~1 wall, ~3 s marshal,
  competitive (P2–P4, a few seconds/lap off the AI). latG 0.72–0.82 (cornering
  near the limit). Track is the power game — the low-power starter is naturally
  last, on brief.
- **Rally** — drivable after: loose-surface tuning (µ 0.6→0.72 so power < grip,
  gentler braking-loss 0.12, softer breakaway for catchable slides, surface
  noise 0.035), a rally-specific exit-throttle cap, and a **broadened slide
  recovery** that now catches LATERAL slides (body slip growing with little yaw
  — the rally case) not just yaw oversteer. Result: ~2.5 spins/race, competitive.
- **Street** — the drift/wall character is real but still the scrappy one
  (walls+penalties on some tracks); its close walls vs driftable compound need
  more work (Phase 9 target).
- **Track generation**: `minCornerRadius` 18→28 — the R=18 go-kart hairpins
  were physically unmakeable by the real-car model (constant wall-washouts).
  Circuits are now real-radius.
- **Stuck-car fix**: a car nearly-stopped for 3 s is marshal-recovered (a spun
  car at β≈0.46, v≈0 sat forever — the marshal's slide/off-line thresholds
  missed it).
- Discipline margins: Rally 0.9×, Street 0.95× of the Track corner commitment.

Feel summary: all three disciplines complete races and feel distinct (Track
precision / Street walls / Rally loose). Track is the hard one for the starter
car; Street/Rally reward control. 27/27 gates green.

## Driving-system overhaul (2026-08-14) — the game was broken, now it drives

The rewrite shipped with a broken driving model (cars couldn't get off the line,
spun "in place", and the player's car barely moved). Full bug pass:

1. **Broken `gripUsage`** — it divided by the *current* force (≈0 on straights),
   so the driver's throttle was capped to 0.45 constantly → cars crawled.
   Now: demand ÷ available grip.
2. **Yaw spun "in place"** — `slipAngle` was used as the velocity-path angle
   *and* the body slip (tyre slip), so a huge yaw rate didn't rotate the
   velocity → the car spun like a top while traveling straight. Added a
   `headingErr` state (heading−path) and made the tyre slip angles use the real
   body slip (`θ − headingErr`).
3. **Lateral force sign was inverted** (`F = +C·α` instead of `−C·α`) — the
   body slip AMPLIFIED instead of restoring, causing the spin/wide spiral.
   Fixed to the standard `F = −C·α` bicycle model (and inverted the pursuit +
   recovery steering to match).
4. **Under-damped yaw** — no tyre aligning moments, so yaw oscillated/ran away.
   Added `PHYSICS.yawDamping`.
5. **Traffic brake fired for cars BEHIND** (any `arcGap ≤ 2.6`, including
   negative) → every car braked at the grid → launch stalls. Now only rivals
   ahead matter.
6. **Brake-and-floor at once** — throttle was `1 − brake`, so the car
   net-accelerated into corners. Corner braking now lifts the throttle fully.
7. **Too-late braking** — the braking lookahead was ~39 m at speed, so the car
   floored it until the corner was near. Braking now scans ~110 m+ ahead.
8. **Over-steering at speed** — the pursuit demanded up to 34° of lock at 11 m/s
   (physically impossible → front slide → spin). Steering is now capped by the
   grip-limited angle `atan(1.1·g·L/v²)`.
9. **Unrealistic acceleration** — the starter car's `aAccel` was ~1g, equal to
   its grip, so the pitch transfer unloaded the front and it understeered
   everywhere. `aAccel` mapping lowered to ~0.6g starter / 0.87g elite, CG
   height 0.42→0.36.
10. **Tight-corner safety** — hairpins (κ>0.02) get an extra 0.9× margin, and
    the front-axle grip budget limits throttle so the pitch doesn't unload the
    front mid-corner.

Result: cars launch, drive, brake, and complete races; the starter car finishes
last (on brief). 27/27 gates green. Remaining tuning (Phase 9): the starter
car still brushes walls on the tightest hairpins — wall-hit frequency and
hairpin line quality are the balance pass targets.

## Cleanup pass (2026-08-14) — one truth, no magnet-era scaffolding

### Integrity audit findings (things the refactor silently lost, now restored)

A general sweep found two real mechanics were lost in the rewrite and are now
**wired back** (both applied to locals per-tick — never mutated into the car's
raw stats, which would compound exponentially):

- **Slipstream** — `draftSpeedBonus`/`draftAccelBonus` had zero consumers; a
  drafted car got no speed/accel lift. Restored in `sim/update`: `vMaxEff` and
  `aAccelEff` scale by `computeDraft`'s per-tick value. Fixing this also caught
  a latent compounding bug (the earlier write-back of mods into `car.stats`
  would have made drafted cars fly off).
- **Live condition** — wall/contact damage no longer affected performance after
  the rewrite. Restored: `conditionLiveMods` feeds `condTop`/`condGrip` into
  the locals. Also fixed a double-µ in the peg-meter `vDeslot` readout.

### Stripped (dead slot-era scaffolding, ~47 constants + a module)

- Removed 47 unused `PHYSICS` keys (all the groove/deslot/spin/magnet-era knobs
  with zero consumers) — verified by a usage scan; kept every knob still
  referenced (e.g. `grooveKappaMin`, `spinStun`, `mistakeBasePerSec`) and wired
  `streetWallStunMult` + `tyreRecoveryFloor` back as data instead of magic numbers.
- Deleted `data/disciplineProfiles.ts` (only live value was `runoffDrag`, now on
  `data/surfaces.ts` per discipline).
- `draftDetBonus`/`draftCornerKappa` remain in `race/draft.ts` (still used).

After the greenfield rewrite the codebase was caught between the old slot
identity and the new real-car physics. Cleaned so the Frenet ribbon is the
single source and nothing lies about the physics:

- **Garage readout fixed**: `predictVDeslot` no longer adds the deleted magnet —
  the "Corner peg" now predicts the real tyre limit (the grip the driver plans
  against). The Tuning readout finally matches the track.
- **Dead car state stripped**: removed `vProfile`/`vDriver`/`vSafe`,
  `magAuthority`, `magInterrupt`, and the unwired `motorTemp`/`brakeTemp` from
  `CarSimState`. fieldSetup no longer computes per-race speed profiles;
  `buildVDriverProfile` and `vDriverAt`/`vSafeAt` deleted.
- **`dynamics.ts` reduced to its real constants** (the magnet-era force
  functions and `HYBRID_MAG_*` are gone; the sim's loads live in
  `src/engine/sim/loads.ts`). Dead `predictCornerGrip` removed.
- `magInterrupt` handling dropped from the transmission clutch-kick.
- Net since the rewrite began: **~3,800 lines removed**, 27/27 gates green,
  tsc + build clean. `vProfile`/`estimateLapTime` stay only as a standalone
  Quick Race duration estimate (`quickRaceConfig`), not on the car.

## Greenfield sim rewrite (2026-08-14) — real cars, driver model, three sports

The Scalextric groove/deslot/magnet machinery is **deleted** and the vehicle +
driver layer rebuilt from scratch per `PROGRESSION_PLAN.md`:

- **Real-car physics (`src/engine/sim/*`)**: two-axle real-plane (body slip β,
  yaw rate ω) on the Frenet ribbon, per-axle tyre curves with a grip **peak and
  post-peak falloff** (+ breakaway collapse), load transfer (pitch/roll),
  aero CL/CD, drivetrain torque curve, low-speed kinematic regime, diegetic
  **marshal recovery** for physically-stuck cars. Understeer (front slides →
  runs wide), oversteer (rear slides → rotates), and spin-out emerge from the
  tyre model + load transfer — nothing is rolled.
- **Driver model (`src/engine/driver/model.ts`)**: the RPG is control quality,
  not a speed multiplier. Perception (lookahead + skill-scaled error), corner
  plan (target from the real tyre limit × skill margin), pure-pursuit steering
  with neuromuscular rate limit, grip-budget throttle management, reaction-gated
  slide recovery. Player throttle is a **ceiling**, brake **adds**, shift/kick
  on top — "assisted but not automated."
- **Three sports, one core**: `data/surfaces.ts` — Track (high µ, late falloff,
  steep breakaway = precise), Street (later peak, gentle falloff = driftable,
  usable post-peak), Rally (µ falls under braking, surface noise).
- **Feel gates re-gated** (27/27 green): `TYRE_PEAK_FALLOFF`,
  `UNDERSTEER_EMERGES`, `OVERSTEER_EMERGES`, `SPIN_EMERGENT`, `SKILL_IS_CONTROL`,
  `PLAYER_AGENCY_ALWAYS`, `REJOIN_NATURAL`, `MARSHAL_ONLY_WHEN_STUCK`,
  `DISCIPLINE_IDENTITY`, `RALLY_LOOSE_UNDER_BRAKE`, `DRIFT_IS_USABLE_STREET`,
  plus kept PACK_CONTACT / FINISH_LAP_CUTOFF / suites. The slot-era suites were
  re-gated to real-car sanity (finish rate, bounded spins).
- **Known follow-up (Phase 9 of the plan)**: full-field stability — cars are
  twitchy (avg ~12 spins/race, slow grid launches in a few seeds) and need the
  dedicated balance/soak pass once the chassis + components (Phase 6-7) land.

## General bugfix pass (2026-08-13)

Meta/career correctness fixes (no balance retunes; all on top of green `validate:feel`):

- **XP overflow + multi-level (career)** — `ResultsScene.applyResults` discarded XP past a level-up and only ever granted one level. `grantXp` now loops level thresholds (keeps the remainder, awards a point per level); `computeDriverXp` predicts the same on a copy so the Lv toast and the real application can never drift.
- **`spendStatPoint` wasted points at the stat cap** — spending a point on a stat at 99/100 consumed it for nothing; now refused when the stat is already at 100.
- **`repair_then_podium` objective was tautologically true** — the flag was actually "vehicle at full condition" and the check was `repaired || condition < max`, one of which always holds on a podium. Added a persisted per-discipline `repairedSinceLastRace` flag (save v2 migrate defaults it to `{}`), set by `repairVehicle`, consumed on race entry for garage vehicles only (presets skipped), and the objective now requires an actual paid repair + podium.
- **Tournament Next-Race seed divergence** — the results "Next Race" seed (`launch.raceSeed + index + 2`) differed from the campaign-resume seed, so the same tournament race played differently depending on the path. Extracted one formula `career/tournamentSeeds.ts` used by both paths; `META_TOURNAMENT_TEAMS` now also asserts `TOURNAMENT_SEED_CONSISTENCY`.
- **Tournament "Race Again" double-advance** — `applyResults` bumps `progress.raceIndex` on enter, so replaying a tournament race via "Race Again" applied as the *next* race and skipped one. Race Again is now Quick-only; tournament flow is Next Race / Back.

## Feel baseline (2026-08-13 — finish-window / premature end fix)

Headless suite green (39/39) after fixing races ending before the pack finishes:

- **Premature-end root cause (2026-08-13)** — the race ended on a fixed `finishWindowSec` (10 s) clock that started when the leader crossed and cut off any car that couldn't reach the line inside it. With a spread pack that was effectively everyone: headless probes showed **every** race finalizing with the AI field marked `finished` at 2/3 laps (mid-final-lap), so results appeared while cars were still circulating. Two-part fix:
  1. **Adaptive flag window** — `RaceDirector.computeFinishWindow()` budgets the window from the slowest unfinished car's time to the line (floor `finishWindowSec`, cap `finishWindowMax` 45 s, `finishWindowMinPace` 5 m/s, `finishWindowMargin` 1.5×). Close fields finish naturally; the cap is only a stranded-car backstop.
  2. **Checkered-flag classification** — once the flag is out, a car is classified the next time it **crosses the line** (lapped cars honestly finish a lap down, `flagClassifiedIds`), not by a timer. Classified cars cruise at 30% throttle (cool-down) so the tail doesn't stack deslots while stragglers race to the line.
- `FINISH_LAP_CUTOFF` gate (see freeze section): no finished car ends short of its scheduled laps unless it crossed after the flag; also guards the old lap-0 instant-finish bug. Suite threshold `deslots/car ≤ 5.5 → 6.5` in `scalextric-validate.ts` because the fair tail lets stragglers race ~45 s longer (5.8–5.9 measured).
- Note: with the field far slower than a pin-throttle player (known balance gap, below) cars are legitimately *lapped* rather than cut off — the field still frequently finishes a lap down until the AI-pace tuning target lands.

## Feel baseline (2026-08-13)

Headless suite green after the slot-breakout force balance + magnetic downforce:

- **Slot-breakout consolidation (2026-08-13)** — the five special-cased deslot triggers (`gripBreak`/`capacityFail`/`magPop`/`pinBendPop` + overspeed) collapsed into one force-balance test in `grooveStep`: the guide holds while centrifugal `v²|κ|` + Mag steering pressure + long-load stays within the slot capacity (which carries the driver margin through `v_deslot`). Removed the now-orphaned `oDeslot`/`oDeslotSpeedFrac`/`grooveCapacityDeslotL`/`grooveCapacityMagnetMin` constants.
- **Magnetic rail downforce (2026-08-13)** — `aeroForces` adds a speed-independent magnet (`HYBRID_MAG_FORCE`) and `computeAxleLoads` applies a corner/brake "squat" load-up (`HYBRID_MAG_LOADUP`) so cars load into the rail under lateral g — the Scalextric soul, replacing flat grip knobs. `HYBRID_CL_FROM_D` 14→10 to keep high-speed DF sane; garage previews (`predictVDeslot`) include the magnet. Balance re-verified: pin P1 ≤7/8, shift 8/8.
- **Smooth rejoin (2026-08-13)** — `tryRejoinGroove` ramps lateral momentum (dl×0.35) instead of snapping to zero; guide re-catches with reduced Mag authority over the immunity window.
- **Dead code sweep (2026-08-13)** — removed the un-wired two-axle tyre/yaw facade (`resolveTwoAxleTyres`/`integrateYaw`/`updateSlipAngle`/`axleBrushForces`/`applyTyreYawStep`), the dead `scenes/race/onboarding.ts`, `raceCamera2dZoomScale`, and the unreferenced `graphics/index.ts` + `graphics/engine/index.ts` barrels. 38/38 gates green.

## Feel baseline (2026-08-13 — gearbox + race-start)

Headless suite green after removing the player pace handicap and adding the redline auto-upshift safety net:

- `validate:feel` 38/38 incl. rewritten `GEAR_ASSIST` (pin-throttle auto-climbs ≥gear 3, coast upshift at valid band, low-rev Shift refused) and `PLAYER_PACE_PHYS` (player vMax/aAccel == raw part+driver stats)
- **Race-start fairness (2026-08-13)** — two bugs made the start unfair:
  - Grid placed the front row ON the line (s=0) and the back row 12 m BEFORE it → back rows crossed s=0 after a few metres, counted a ~lap head start, and won every race; everyone else was retired at +10 s. Fixed with `PHYSICS.gridPoleGap` (whole pack grids behind the line).
  - `handleLapCrossing` was level-triggered (`prevS + v·dt ≥ line`) so a slow/lingering crossing re-fired the lap counter on consecutive steps → back-row cars could "finish" in ~1.6 s. Now edge-triggered on `prevS` (one pass = one lap).
- start-validate PASS: pin P1 ≤ 7/8 vs novice field — pin-throttle is intentionally viable at the entry band (see balance notes).
- AI upshift band from driver skill (`aiUpshiftBand(box, skill01)`) — no fixed-band assist, no pace trim.
- `scripts/balance-probe.ts` — headless difficulty probe (`npm run` via vite-node) across Quick Race bands; known follow-up: pin-throttle currently beats all AI bands by ~10 s because overspeed deslots are rare/cheap — the feel-tuning target for playtesting (see below).

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

`dt`, `brainEveryN`, `grooveKappaMin`, `grooveSpring`, `grooveDamp`, `grooveLoadKill`, `grooveCornerKill`, `grooveLatMinV`, `grooveLatFullV`, `grooveMaxDlPerV`, `deslotSkillBase`, `deslotSkillSpan`, `deslotFocusBase`, `deslotFocusSpan`, `deslotBraveryBase`, `deslotBraverySpan`, `deslotMinTime`, `deslotRejoinL`, `deslotRejoinVFrac`, `deslotRejoinImmunity`, `deslotSteerGain`, `deslotSteerFrac`, `deslotSteerMinRoll`, `deslotScrubGain`, `deslotScrubMaxG`, `deslotReleaseImpulse`, `deslotWallPush`, `deslotLatDamp`, `gridHoldSec`, `gridHoldPureFrac`, `gridFollowGainMult`, `gridMaxDl`, `gridColOffset`, `gridRowSpacing`, `aiLaunchSec`, `aiLaunchMinThrottle`, `recoveryBrainSec`, `brakeAuthorityBase`, `brakeAuthoritySpan`, `throttleAuthorityBase`, `throttleAuthoritySpan`, `wallMargin`, `crashSpeed`, `crashSpeedMult`, `crashStun`, `streetWallStunMult` (discipline mult), `crashRecoveryDecel`, `crashRecoveryDecelDeslot`, `wallRestitution`, `wallImpactScrub`, `spinWallSpeed`, `spinStun`, `tyreStartTemp`, `tyreTempMax`, `tyreRecoveryFloor`, `tyreColdGrip`, `tyreHotGrip`, `tyreHeatSpeed`, `tyreHeatOver`, `tyreHeatDrift`, `tyreCool`, `draftSpeedBonus`, `draftAccelBonus`, `draftCornerKappa`, `draftDetBonus`

### BALANCE (freeze-critical)

`opponentStatRanges`, `opponentPartTiers`, `contactGap`, `contactSpeedCap`, `contactNudge`, `contactIters`, `contactBounce`, `contactCrashClosing`, `contactDeslotClosing`, `contactConditionSeverityMin`, `followTimeGap`, `followMinGap`, `followSkillGapSpan`, `draftGapMax`, `draftLateralMax`, `overtakeDraftThreshold`, `overtakeHoldSec`, `overtakeDurationSec`, `overtakeLateralShift`, `rainMuMult`, `finishWindowSec`, `wallCrashConditionLoss`, `contactCrashConditionLoss`

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
- **Depth-fighting fix (2026-08-13)** — Cars vanished "under a black (dark tarmac) layer" once moving on some phones. The ~0.1 unit car lift sits below the resolution of low-precision (16-bit) depth buffers at race distances (near 1.2 / far up to 2000), so the track won the depth test on those GPUs. Fixed in `ApexRenderer`: `gl.polygonOffset(1, 4)` biases the track's depth away from the camera (scales with the buffer's own resolution), plus a modest car-lift bump 0.08→0.12.

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
