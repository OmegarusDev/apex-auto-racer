# Apex Auto-Racer — Driving Architecture Spec (P0–P4)

Authoritative implementation reference for the driving rework. If a decision
is ambiguous, this file decides. The GDD (`PROGRESSION_PLAN.md`) remains the
gameplay-intent source; this is the build contract.

---

## 1. Architecture (holistic layer map)

```
 ┌──────────────────────────────────────────────────────────────┐
 │  Track / Slot truth                                          │
 │  TrackGenerator → RacingLineNode[] (κ(s), width, o, tangent) │  the ONE mother line
 └───────────────▲──────────────────────────────────────────────┘
                 │ nodes
 ┌───────────────┴──────────────────────────────────────────────┐
 │  Car spec                                                     │
 │  partTiers → effectiveStats (aAccel/aBrake/grip/vMax/D/…)     │
 │            → CarSetup (mass/CG/drivetrain/diffLock/transmission) │  what the car CAN do
 └───────────────▲──────────────────────────────────────────────┘
                 │ effective + setup
 ┌───────────────┴──────────────────────────────────────────────┐
 │  Car-ideal-line engine  (NEW: engine/line/carLine.ts)         │
 │  per-corner: v_c(κ), brake point, turn-in, apex, exit         │
 │  output: ideal lineO + vLine(s)  ← the line THIS setup wants  │  P2
 └───────────────▲──────────────────────────────────────────────┘
                 │ ideal line + form
 ┌───────────────┴──────────────────────────────────────────────┐
 │  Racer brain  (driver/model.ts)                               │
 │  perception → plan(→Racer's lineO) → execute(δ,t,brake) → recover │  P3
 └───────────────▲──────────────────────────────────────────────┘
                 │ δ, throttle, brake
 ┌───────────────┴──────────────────────────────────────────────┐
 │  Real-car sim (sim/…)  tyres, loads, drive, vehicle           │
 └───────────────▲──────────────────────────────────────────────┘
                 │ state
 ┌───────────────┴──────────────────────────────────────────────┐
 │  Race flow (RaceDirector / fieldSetup)  form rolls, matching  │  P1/P4
 └──────────────────────────────────────────────────────────────┘
```

Data flows one way. The Racer never mutates the sim. The ideal-line engine is
pure (track + car → line), computed once per race per setup.

---

## 2. The three-tier line model

1. **Center Slot truth** — the κ-line. The world's single truth. The Racer does
   NOT follow this by default.
2. **Car ideal line** — `carLine(track, stats, setup)` → the per-setup optimal
   line (brake/turn-in/apex/exit). Differs per setup: a grippy high-downforce
   car takes a geometric line; a powerful low-grip car takes a late-apex exit
   line. **The Racer's target.**
3. **Racer's line** (personal `lineO`) — approaches the car ideal by skill,
   shaped by personality and wobbled by focus/form.

The Racer's skill is measured as: how close the *executed* path stays to the
Racer's line AND how close the Racer's line is to the car ideal.

---

## 3. Car spec — parts → stats → setup

### 3.1 Parts (P1 additions in `data/parts.ts`)

| Part | baseCost | display perTier | real effect (beyond display) |
|---|---|---|---|
| engine   | 600 | topSpeed 5, accel 1      | aAccel, vMax, finalDrive +0.018/tier |
| intake   | 300 | topSpeed 2, accel 2      | aAccel, vMax, finalDrive +0.012/tier |
| exhaust  | 350 | accel 4                  | aAccel, finalDrive −0.01/tier |
| tyres    | 400 | grip 5                   | gripFactor, compoundMu +0.04/tier |
| brakes   | 350 | braking 4                | aBrake (+0.6/tier), brakeBiasFront — **feeds ideal-line brake point** |
| suspension| 450 | grip 2                  | gripFactor, suspStiffness, cgHeight, lineNoise |
| spoiler  | 500 | downforce 5, topSpeed −1 | D, clScale, cdScale |
| **clutch** (NEW)      | 320 | accel 1 | `shiftTime` (faster), `launchMul`, `kickMul` |
| **gearbox** (NEW)     | 520 | topSpeed 2 | `shiftTime` (faster), AI shift-band quality, gear count |
| **differential** (NEW)| 460 | grip 1 | setup `diffLock` adjustability (LSD) |

All parts live in the single `PARTS` array → garage/tuning/stats/validation are
generic (no per-part UI work needed).

### 3.2 EffectiveStats additions (`stats.ts`)

```
shiftTime   = 0.24 − 0.018·(clutch + gearbox)      // seconds; floor 0.10
launchMul   = 0.82 + 0.045·clutch                  // launch accel mult; cap 1.0
kickMul     = 1.0 + 0.15·clutch                    // street clutch-kick impulse
gearCount   = disciplineBase + min(2, gearbox)     // 6/5/4 base for track/street/rally
```

`diffLock` lives on the setup: `baseDrivetrain.diffLock + differential·0.12`
(street base 0.6, rally 0.1, track 0). A differential tier therefore tightens
the LSD: street gets a firmer drift-lock, rally/track gain an LSD.

### 3.3 Transmission wiring (`transmission.ts`, `drive.ts`, `Gearbox.ts`)

- `shiftCooldown = PHYSICS.shiftCooldown · shiftTime/0.24` on an upshift
  (downshift keeps its existing 0.55 factor).
- Launch: the grid-start applies `aAccel · launchMul`; a low clutch bogs
  (dip then recover) — see §5.4.
- Clutch-kick impulse scale: `0.18 → 0.18·kickMul` (street).
- AI upshift band already scales with skill (`aiUpshiftBand`); gearbox tier
  additionally lowers the effective band by `0.02·gearbox` (stays in the
  powerband).
- `driveForce` torque uses the live gear count so more gears = narrower
  spread = higher average torque (through `transmissionDriveScale`).

---

## 4. Car-ideal-line engine (P2) — `engine/vehicle/IdealLine.ts`

Pure function: `computeIdealLine(track, setup, stats, muSurface): IdealLineResult`
Computes a physics-optimal racing line for a specific car setup. Each car gets
its own ideal line based on its grip, power, braking, and drivetrain.

### 4.1 Corner segmentation
- Compute `|κ(s)|`; threshold `κ ≥ cornerKappaThreshold` (0.012) marks corners.
- Merge adjacent regions; each corner: entry straight start (first node with
  |κ| < straightKappa (0.004) before), peak node (max |κ|), exit straight end
  (first |κ| < straightKappa after).

### 4.2 Grip-limited corner speed
Iterate aero: `v_c = √(a_grip(v_c)/κ)` with `a_grip = muSurface·compoundMu·g`
plus one downforce pass (reuse `predictVDeslot`'s load-sensitivity pattern,
`CarSetup.ts:124`). Cap by `vMax·0.97`.

### 4.3 Apex optimization (the core tradeoff)
`powerRatio = aAccel / a_grip`. The exit-optimising apex fraction:

```
apexFrac = clamp(0.55 + 0.45·powerRatio, 0.5, 0.95)   // 0.5 = geometric, 0.95 = late
```
- Low `powerRatio` (grippy) → early/geometric apex (carry corner speed).
- High `powerRatio` (powerful) → late apex (straight exit to deploy power).
- RWD diffLock ≥ 0.5 adds `+0.06·diffLock` to apexFrac (drift car trades
  corner speed for exit rotation).

### 4.4 Brake point extraction
`d_brake = (v_entry² − v_c²) / (2·aBrake)`. `v_entry` = min(vMax·0.97,
exit speed of the previous corner). Brake point = entry start − d_brake
in arc length. **This is where the brakes part shows**: better brakes → later
point → faster entry.

### 4.5 Line assembly (per node)
- Outside of corner (entry): `line = sign(κ)·(0.9·halfWidth)` (wide approach).
- Ramp to apex over the entry region (smoothstep).
- Ramp back to `−sign(κ)·(0.85·halfWidth)` over the exit (track-out).
- Straights: keep the previous line (natural drift to the edge), clamped to
  `±outsideBias·halfWidth`.
- `idealVLine(s)` = min of (v_c at the peak, entry/exit caps) — the speed envelope.

### 4.6 Output arrays (stored on CarSimState)
- `idealLineO` — the car's ideal lateral offset per node
- `idealVLine` — speed envelope at each node (O(1) lookup)
- `brakeZoneStart` — arc length where braking begins (O(1) lookup)
- `turnInPoint` — arc length where turn-in begins (O(1) lookup)
- `apexNode` — index of the apex node
- `trackOutNode` — index of the track-out node

### 4.7 Personal line from ideal (driver style blend)
```typescript
personalLineO = idealLineO * (1 - driverStyleWeight) + driverStyle * driverStyleWeight
```
Where `driverStyleWeight = 0.3` (30% driver, 70% car physics). Driver style
adjustments:
- **Skill** → apex cut: up to `maxSkillApexCut` (2.5m) toward inside
- **Bravery** → wide carry: up to `maxBraveryWideCarry` (2.5m) toward outside
- **Focus** → smoothing passes: 2–6 passes to reduce line noise

The personal line is built from the car's ideal line, NOT from forced
grid-column lanes. This means different car setups produce genuinely different
racing lines.

---

## 5. The Racer (P3) — `driver/model.ts`

### 5.1 The Racer's line (per race, replaces grid-column lanes)
```
personalLineO = lerp(carIdeal, driverStyle, driverStyleWeight)
```
The driver blends toward the car's ideal line using:
- **Skill** → apex cut: ±2.5m toward/away from apex
- **Bravery** → wide carry: ±2.5m on corner exit
- **Focus** → line smoothing: 2–6 passes

The personal line is built from the car's ideal line (computed by `IdealLine.ts`),
NOT from forced grid-column lanes. This means different car setups produce
genuinely different racing lines.

### 5.2 The hook (execution — O(1) perception)
Steering uses O(1) lookups from the car's ideal line arrays:

```typescript
// O(1) perception — no more O(n) kappaAhead search
const braking = car.s >= (car.brakeZoneStart ?? 0);
const turnIn = car.s >= (car.turnInPoint ?? 0);
const approachingApex = car.apexNode !== undefined && car.s < car.nodes[car.apexNode].s;

// Steering = curvature feedforward + proportional + derivative
κLine   = curvature of the personal lineO at the lookahead
steerFF = atan(wb · (v·κLine))                          // follows the line's bend
steerP  = Kp · errLatTerm,   errLatTerm = lineAhead − (l + lookahead·sin(β))
steerD  = −Kd · (dl/v)                                  // lateral-velocity damp
steer   = clamp(steerFF + Kp·errLatTerm + steerD, ±steerCap)
Kp      = 1.2 + 2.0·skill01                             // skilled = tight hook
Kd      = 0.35
```

**Key improvement**: The driver now uses O(1) lookups for:
- `idealVLine` — speed target at current position
- `brakeZoneStart` — when to begin braking
- `turnInPoint` — when to begin turning

This replaces the old O(n) `kappaAhead` search that sampled discrete nodes
and often missed the true peak curvature.
Target: a skill-1.0 driver holds the personal line within **≤0.6 m avg**, a
skill-0.3 driver within ~3.5 m (natural, non-oscillatory — the feedforward
prevents the weave; the low Kp lets rookies run wide under momentum). This
replaces the `2·err/λ²` low-gain tracker and the removed stabilizers.

### 5.3 Plan (brake/throttle)
- Brake point = car-ideal brake point ± skill error (perception error
  `∝ (1−skill01)`), clipped to the "safe" band. Low skill = earlier/looser.
- Exit throttle: the existing grip-budget both-axle solve stays (it is the
  physics-driven limit). Skill adds throttle-ramp precision.
- Low-skill assist: a skill-scaled "assist level" raises the perceived grip
  for *planning* (so rookies under-drive safely) and auto-lifts on hard slides.
  The assist fades to zero at skill 1.0. This is the "needs help lifting/braking"
  knob, expressed as planning, never a pace handicap.

### 5.4 Shifting
- AI upshift band from `aiUpshiftBand(box, skill01)` − `0.02·gearbox`.
- Shift time from `shiftTime` (clutch/gearbox). A rookie shifts at the redline
  (late) and slowly; a skilled driver shifts at peak torque, fast.
- If the player forgets to shift a low-skill car, it hangs at the limiter
  (redline-dwell) until the auto-shift safety net.

### 5.5 Drift mastery
- High skill: the countersteer catch is precise (`catchQuality` scales with
  skill already) and the drift-throttle taper is fine — the car holds a slide
  (front tyres point in the direction of travel, body yawed) without lifting
  if the setup suits (RWD + diffLock). Keep the existing slide-recovery but
  let `skill01` raise the slide angle it will hold before countering
  (driftHold = 0.20 + 0.18·skill01).

---

## 6. Form / RNG (P4) — `engine/driver/form.ts`

- **Form roll** per race per driver (seeded by raceSeed + driverId):
  `form = 0.9 + 0.2·rng()`. Scales the execution-noise amplitude and a small
  confidence bias on the margin.
- **Execution noise**: a low-frequency, corner-correlated noise field over s,
  amplitude `(1 − skill01)·(2 − form)·0.35`, mean-zero. It shifts the steering
  and brake targets. Correlated = a driver is "on it" for a stretch, then
  sloppy — human, not white noise.
- Determinism contract: same (trackSeed, raceSeed, driverId, setup) ⇒ identical
  simulation. Different raceSeed ⇒ the same driver drifts between laps/races.
  **Time trials are therefore not deterministic across attempts.**

---

## 7. Opponent matching (P1) — `race/modifiersSetup.ts`, `DriverGenerator.ts`

- **Field spread**: the quick-race opponent part band widens to span the
  metaprogression (e.g. `[1, 5]` at mid ranks) so one map shows a mix of
  car tiers.
- **Coherence**: `generateOpponentParts` tightens the driver↔car link — jitter
  factor `0.7 → 0.2`, so a strong driver lands in the top of the band, a weak
  driver in the bottom, never a genius-in-a-shitbox. Small variance kept
  (a form-flat strong driver might still be off).
- Matchup itself stays random (new field each race). The result: you can watch
  different metaprogression points race the same map.

---

## 8. The three starter car setups (insta-match)

Replaces the uniform `defaultVehicleSave(startingPartTier)` in
`SaveManager.createDisciplineVehicles` (and used as the quick-race garage
fallback). Each is a `VehicleSave` (partTiers + condition 1.0):

| Discipline | Starter build (partTiers) | Character |
|---|---|---|
| **Track**  | engine 1, intake 0, exhaust 0, tyres 1, brakes 1, suspension 0, spoiler 0 | Balanced RWD GT: decent top speed, real brakes, open diff — a circuit starter that rewards clean corner speed |
| **Street** | engine 1, intake 1, tyres 1, brakes 1, **differential 1**, others 0 | The drift starter: RWD + locked diff (LSD), punchy, less top end — the fine-control/drift-mastery car |
| **Rally**  | engine 0, tyres 1, brakes 0, **suspension 1**, **differential 1**, others 0 | AWD starter: softer suspension, tyres + an LSD for the loose — momentum-slide character |

`DEFAULT_CAR_SETUP.driveBias`/`diffLock` are derived by
`drivetrainForDiscipline` (track 0.06/0, street 0.06/0.6, rally 0.5/0.1), then
`differential` part tiers push diffLock up (`+0.12/tier`, see §3.2).

---

## 9. Gates & acceptance (P5)

- **P1 parts**: each of clutch/gearbox/differential moves a sim observable:
  clutch ⇒ faster shifts + launch; gearbox ⇒ shift speed + gear count;
  differential ⇒ diffLock change. Field shows a spread of part tiers with
  coherent driver↔car pairs.
- **P2 line**: two setups (tier-1 vs tier-4) yield measurably different
  `lineO` on the same track; a higher-downforce car takes a flatter line.
- **P3 Racer**: skill-1.0 tracks its personal line within ≤0.6 m avg;
  skill-0.3 within ~3.5 m, non-oscillatory. Rookie shift/assist behaviors hold.
- **P4 form**: same seeds identical; different raceSeed ⇒ same skill different
  lap times.
- **Starter setups**: the three disciplines' starter cars lap distinctly on
  their own discipline (measurably different latG/drift/vMax signatures).
- Full regression: 27 feel gates + the P-series gates, `npm run build`, all
  green.

---

## 10. Implementation order

P1 (parts + transmission + matching + starters) → P2 (line engine) → P3
(Racer: line + hook + plan + shifts + drift) → P4 (form) → P5 (gates + GDD
amendment). Each phase compiles and passes the existing gates before the next.

---

## 11. Build status

- **P1 DONE** — clutch/gearbox/differential parts (wired into `stats.ts`,
  `CarSetup.ts` diffLock, `transmission.ts` shiftTime/kickMul, `update.ts`
  launchMul); opponent matching widened ([1,4]→[3,5] per rank) with tight
  driver↔car correlation (jitter 0.2); three distinctive starter builds
  (`SaveManager.starterPartTiers`). Gates green.
- **P2 DONE** — car-ideal-line engine (`engine/vehicle/IdealLine.ts`) computes
  physics-optimal line per car setup. Personal line built from ideal + driver
  style (30% driver, 70% car physics). O(1) perception replaces O(n) search.
  Racing lines debug toggle shows ideal (white dashed), personal (team color),
  brake zones (red), and apex markers (yellow).
- **P3 PARTIAL** — momentum/confidence braking done (§5.3): brave carries speed
  (16.4 vs 15.8 m/s cornering; 1.2 s/lap), timid brakes early/hard and is safe,
  confidence edges the margin. O(1) perception with ideal line arrays done.
  Shift-assist precision and skill-scaled drift-hold remain.
- **P4 NOT DONE** — form roll + corner-correlated noise (spec §6) pending.
- Session extras: sprint minimap tied to the sampled (drawn) ribbon (not the
  mother loop) — `minimapExtent` + no closePath for sprints; wall-crash now
  STOPS the car (momentum gone) and the marshal re-slots it in ~0.3 s (was
  ~12 s grinding).


---

## 12. Future realism roadmap (deferred ideas)

These are aspirational, captured for later — none are needed for the current
career-mode game, but each would raise sim fidelity if/when we want it.

- **Endurance / NASCAR-style mode.** Races are currently too short for fuel
  weight to matter, so there is no fuel-load model today. A long-format mode
  (multi-stint, tyre/brake/fuel degradation over time) is what would make fuel
  weight, tyre falloff and brake fade genuinely strategic. A NASCAR-style
  "constant looping" mode (just watching the car circulate) could be a relaxing
  incremental layer.
- **Visual tyre marks / track rubber.** Cosmetic skid marks are a nice touch and
  do NOT need to feed back into the surface-sim (rubber build-up affecting grip
  is a deeper change; cosmetic-only is fine and cheaper).
- **Thermal brake model.** Brake fade from heat is currently absent (only brake
  bias exists). A brake-temperature state with fade would add a real endurance
  dimension.
- **Per-wheel (four-wheel independent) simulation.** The current model is a
  lumped 2-axle bicycle (front/rear loads only). Per-wheel tyre forces, left/right
  load transfer as independent tyres, and wheel-individual slip would be the
  biggest single realism leap (and is what makes diff behaviour emergent).
- **Differential slip / locked-diff dynamics.** `diffLock` today is a scalar on
  drive bias, not true per-wheel slip control. Real open/limited-slip/locked
  behaviour (inside-wheel spin, yaw from diff torque) follows naturally from the
  per-wheel model above.
- **Engine inertia + turbo lag (with turbos).** Torque-curve is band-based today;
  rotational inertia and turbo spool lag (with a turbo part) would add throttle
  realism, especially out of slow corners.
- **Suspension kinematics + visual body roll.** Suspension stiffness currently
  only scales roll load-transfer; there is no camber gain, anti-roll, or damper
  model, and no visual body roll. Kinematic suspension + matching visual roll is
  the headline "feel" upgrade — the chassis should visibly lean into corners.

Note: brake-while-steering is already physically penalised by the tyre
friction circle (`tyre.ts` `axleForces`), so trail-braking emerges naturally;
the driver brain only models the *preference* to ease brake while steering
(rookies reluctant, elites trail-brake freely) — it never suppresses steering.
