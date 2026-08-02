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
- **Tournament standings** — Rank series are 2-team formats only. Championship standings are You vs one Rival team.

## Intentional physics (Scalextric groove)

Live model is groove/deslot, not free-yaw understeer as the primary limit:

- Cars magnetically hold racing line `o(s)` while slotted; overspeed in meaningful curvature **deslots**. Off-slot: excess lateral accel outward, spare grip toward `o(s)`, scrub with excess. Straights do not deslot at full throttle.
- Spin is rare (high-speed wall smash while already deslotted). Drift latch is dormant so it does not fight groove/deslot.
- `v_deslot` spans Skill × Focus × Bravery; player Authority splits brake assist (stronger at low Skill) vs throttle trim (rises with Skill). Pin-throttle nearly kills brake assist.
- AI brakes for `vDriver` / live `v_deslot`, full throttle otherwise; draft hold then lateral pull-out. Soft bumper / grid-hold softens start rubs so the pack does not freeze at lights-out.
- Wall recovery is soft (stun cuts drive; no lateral freeze/teleport). Track width / normals / kerbs match painted asphalt.
- Opponent fields stratify weak→strong within the rank budget band (no dead stall-cars at novice).

### Driver stats → track (summary)

| Stat / trait | Effect |
|---|---|
| Skill | Large `v_deslot` / `vDriver` span; later braking when high; stronger throttle Authority |
| Bravery | Raises target toward peg (can overshoot); delays brake; harder wall stun accepted |
| Focus | Wider hold; fewer mistakes; cleaner wall recovery |
| Determination | Catch-up accel; stronger draft; shorter wake before pull-out |
| Slipstreamer / Hothead / Ice Cold / Showboat / Grinder / Loose Cannon | As in traits data (draft ×1.65, brake aggression, late-race calm, lead mistakes, XP, per-race jitter) |

## Deferred

- On-device Android LAN verify not run here.
- Exhaustive tier/rank balance matrices and dual-orientation visual QA remain manual.
