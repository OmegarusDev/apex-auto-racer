# Deviations from the Definitive Engineering Spec

The plan file remains the source of truth. This log records where the implementation differs or could not follow the stated process.

## Process

1. **`move_agent_to_root` skipped** — This build ran as a Cursor subagent, which cannot call `move_agent_to_root` / `move_agent_to_cloned_root`. Work continued at absolute path `~/cursorthings/ONGOING/apex-auto-racer` from the parent home workspace.

2. **Git init workaround** — Sandbox blocked writing an in-tree `.git/` directory. Repository uses a separate git dir:
   - Work tree: `~/cursorthings/ONGOING/apex-auto-racer`
   - Git dir: `~/cursorthings/ONGOING/apex-auto-racer.git`
   - Work-tree `.git` is a `gitdir:` pointer file.

3. **Phase commits** — Phases were implemented in one continuous pass (parallel module authors + integration). History may be fewer commits than one-per-phase; commits still mark known-good build points where practical.

## Implementation

4. **Capacitor** — `capacitor.config.json` is present (no `bundledWebRuntime`). `@capacitor/app` / Android native project were not added; web build is the verification target per spec.

5. **Date.now for new-game seed** — `SaveManager.createNew()` / `GameContext.startNewGame()` may seed from `Date.now()` when no seed is passed. Race simulation itself remains fully seeded (`trackSeed` / `raceSeed`); only career/new-game bootstrap uses wall-clock when unseeded. Quick Race seeds derive from career counters (no wall-clock).

6. **Code splitting / race launch** — `launchRace` statically imports `RaceScene` (no dynamic `import()`). A prior cycle (`sceneUtils` → dynamic `RaceScene` → `ResultsScene` → `CampaignScene` → `sceneUtils`) caused the dynamic import to throw; the catch showed a stuck **"Race loading..."** toast and never pushed the race. Results is loaded lazily from `RaceScene.finishRace` instead. Launch/enter failures log the real error and surface it in the toast / RaceScene error screen (never a fake "loading" toast). Total JS remains under budget.

7. **Browser play-test** — Automated headless determinism / track generation smoke tests are preferred in CI-less local verify; interactive browser play-through should be confirmed by the user via `npm run dev`.

8. **Tournament standings** — Rank series use 2-team formats only (1v1…6v6). Championship standings are always You vs one Rival team (not one row per opponent driver).

## Intentional physics: Scalextric groove / deslot

9. **Groove + deslot replaces free-yaw failure** — Spec §6 step 7 modelled progressive understeer/oversteer yaw as the primary limit. Live model is Scalextric-shaped: cars are magnetically held to the racing line `o(s)` while slotted; overspeed in meaningful curvature (`|κ| ≥ grooveKappaMin`) **deslots**. Off-slot lateral motion is **not** a fixed eject/spring: `a_excess = max(0, v²|κ| − a_lat_cap)` integrates as outward accel, spare grip steers toward `o(s)`, scrub scales with excess. Pin-throttle into a bend → deslot → runoff → wall as a continuous chain. Straights do not deslot at full throttle. Longitudinal friction-circle, draft, tyre temp, rain, and condition remain.

10. **Spin demoted** — Spin is no longer the common corner failure. It triggers only from high-speed wall smash while already deslotted (rare tumble). Spin end no longer teleports `l` to `o(s)`. `finish_no_spin` still tracks true spins; deslots are a separate `deslot` race event.

11. **Drift dormant** — Street/Rally drift latch is disabled in `DRIFT_CFG` so it does not fight the groove/deslot loop. Config retained for a later optional mode.

12. **v_deslot margins** — `v_deslot = v_safe × mDriver × √tempGrip` with `mDriver` from Skill × Focus × Bravery (`deslotSkill*` / `deslotFocus*` / `deslotBravery*`). Wide span: rookies ≈50% of v_safe Skill floor before Focus/Bravery; elites approach 100%. Bravery also pushes the AI `vDriver` target toward that ceiling (can overshoot → deslot). Player Authority is split: **brake assist is stronger at low Skill**; **throttle trim rises with Skill**; **pin-throttle overrule nearly kills brake assist** (and softens throttle trim) so washouts remain severe. Starting roster is nerfed (stats ~22–40) plus `playerPaceMult` (~0.75) on player `vDriver`. Cold tyre floor is harsher; low-tier/damaged cars lose extra early adhesion. Pin-throttle also cuts adhesion/`v_deslot` for low-Skill cars so Authority cannot save a held-Go corner.

13. **Scalextric AI** — Brain brakes for `vDriver` / live `v_deslot` (onset earlier at low Skill; Bravery delays), full throttle otherwise, scrub+rejoin when deslotted. Draft hold then lateral pull-out for passes; Determination shortens wake time. Soft bumper match skips strong-tow followers. Not immune: mistakes and bravery overshoot still deslot. Anti-spin feathering / equal-caution governors removed. **Launch:** reaction-queue delay is bypassed for `aiLaunchSec`; AI gets a minimum launch throttle; soft traffic brakes are ignored while clearing the grid so cars cannot stall at throttle 0 on the lights.

14. **Solid car-car contact** — Exact AABB overlap in `(s,l)` with iterative resolve. Side-by-side prefers lateral peel **without** zeroing `dl` or marking `contactBlocked` on mild rubs; hard side hits share long speed + possible contact deslot. Rear-ends transfer momentum (follower drop + leader nudge), stun on severity, and can deslot the follower (easier in bends). Soft same-lane proximity speed-matches without `contactBlocked` (draft glue killer). Deslotted cars remain solid obstacles. **During `gridHoldSec` after GO**, stun / `contactBlocked` / contact-deslot are softened so a start rub cannot freeze the pack into a blob.

14b. **Grid lateral hold** — Cars spawn in ±grid columns and keep `lTarget ≈ gridL` for the first half of `gridHoldSec`, then ease into the racing line `o(s)`. Prevents the groove magnet from stacking the whole field on centerline at lights-out. Curvature releases the hold early onto the peg so T1 does not deslot the pack off a grid stub.

14c. **Standings after finish** — Live standings rank finishers by `finishTime` (not post-finish rolled distance). Finished cars keep moving for spectacle, so distance-only order was inverting true results.

15. **Wall recovery is soft** — Hard wall contact clamps car **center** at `W/2+R−wallMargin` so the body edge meets the painted barrier at `W/2+R` (drawn in `VectorRenderer.drawBarriers`). Impact severity from long speed + lateral slam; Focus shortens stun, Bravery accepts a harder hit. `stunRemaining` only cuts drive / adds recovery decel — no lateral freeze / teleport.

16. **Track width ↔ visuals** — Asphalt is ~27–36 m by archetype (~1.5× after the prior ~1.8× bump). Street runoff stays 1.5 m (thin barrier strip) so the hard wall is never inside asphalt paint. `sampleTrack` derives normals from lerped tangents (same Frenet frame as physics). Physics kerbs sit outside asphalt to match the bake.

17. **Draft / slipstream** — Wake requires alignment + straight (fades with `|κ|` and lateral offset). Determination boosts draft harvest when chasing; Slipstreamer trait ×1.65. Long bonuses: +14% vMax / +22% accel at full draft. AI holds throttle in the wake then pulls out laterally; tow credit persists through the pass.

18. **Opponent field variance** — Rank sets the budget/part-tier band; `generateFieldDrivers` stratifies weak→strong within that band (backmarkers + standouts). Floors are high enough that novice fields have **no dead stall-cars** (novice average-stat band ~44–78) with a per-stat floor from budget. Part tiers bias with driver strength plus per-part jitter. Quick Race, title Quick Race, and tournaments share this path.

### Driver upgrade → on-track behavior

| Stat / trait | On-track effect |
|---|---|
| **Skill** | Large `v_deslot` / `vDriver` span (low Skill crawls + brakes early); later `kBrake` + slot onset when high; stronger throttle Authority; pin-throttle cuts adhesion for low Skill; tighter traffic gaps; launch throttle |
| **Bravery** | Raises `vDriver` toward the peg (can overshoot); delays brake / slot onset; raises `mDriver`; accepts harder wall stun |
| **Focus** | Wider `mDriver` hold; much lower mistake rate + faster reactions; less groove wobble; cleaner wall recovery |
| **Determination** | Catch-up accel (`sDet`); stronger draft harvest; shorter draft-hold before overtake pull-out |
| **Slipstreamer** | Draft multiplier ×1.65 |
| **Hothead** | `kBrake − 0.1` when rival within 12 m behind |
| **Ice Cold** | Mistake rate ×0.5 on final lap / close rival |
| **Showboat** | Mistake ×1.5 when leading >3 s; XP ×1.3 |
| **Grinder** | XP ×1.25 |
| **Loose Cannon** | ±10 jitter on all four stats per race |

## None / deferred (still in scope of MVP intent)

- On-device Android LAN verify (`vite --host`) not run in this session.
- Headless balance matrices (tier-N vs rank-N) not exhaustively tabulated; `runDeterminismCheck` covers seed reproducibility.
- Dual-orientation layouts are implemented via portrait/landscape helpers; exhaustive visual QA of every scene in both orientations is manual.
- Interactive canvas UI automation was unavailable in the agent browser; serve check used HTTP 200 + `npm run build` + headless smoke.

(none of the above changes the plan file.)
