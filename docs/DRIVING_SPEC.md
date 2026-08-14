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

## 4. Car-ideal-line engine (P2) — `engine/line/carLine.ts`

Pure function: `carLine(track, stats, setup): { lineO: number[]; vLine: number[] }`
(lineO = lateral offset per node, matching the existing `lineO` convention; + is
toward the node's normal, so apex side = −sign(κ)·|off|).

### 4.1 Corner segmentation
- Compute `|κ(s)|`; threshold `κ ≥ 0.012` (≈ R>82) marks corner regions.
- Merge adjacent regions; each corner: entry straight start (first node with
  |κ| < 0.004 before), peak node (max |κ|), exit straight end (first |κ| < 0.004
  after).

### 4.2 Grip-limited corner speed
Iterate aero: `v_c = √(a_grip(v_c)/κ)` with `a_grip = muSurface·compoundMu·g`
plus one downforce pass (reuse `predictVDeslot`'s load-sensitivity pattern,
`CarSetup.ts:124`). Cap by `vMax·0.97`.

### 4.3 Exit-line vs geometric-line (the core tradeoff)
`powerRatio = aAccel / a_grip`. The exit-optimising apex offset:

```
apexFrac = clamp(0.55 + 0.45·powerRatio, 0.5, 0.95)   // 0.5 = geometric, 0.95 = late
```
- Low `powerRatio` (grippy) → early/geometric apex (carry corner speed).
- High `powerRatio` (powerful) → late apex (straight exit to deploy power).

Apex lateral offset = `−sign(κ) · apexFrac · halfWidth`. RWD diffLock ≥ 0.5
(street) adds `+0.06·diffLock` to apexFrac (the drift car trades corner speed
for exit rotation).

### 4.4 Brake point
`d_brake = (v_entry² − v_c²) / (2·aBrake)`. `v_entry` = min(vMax·0.97,
exit speed of the previous corner). Brake point node = entry start − d_brake
in arc length. **This is where the brakes part shows**: better brakes → later
point → faster entry.

### 4.5 Line assembly (per node)
- Outside of corner (entry): `line = sign(κ)·(0.9·halfWidth)` (wide approach).
- Ramp to apex over the entry region (smoothstep).
- Ramp back to `−sign(κ)·(0.85·halfWidth)` over the exit (track-out).
- Straights: keep the previous line (natural drift to the edge), clamped to
  `±0.85·halfWidth`.
- `vLine(s)` = min of (v_c at the peak, entry/exit caps) — the speed envelope.

---

## 5. The Racer (P3) — `driver/model.ts`

### 5.1 The Racer's line (per race, replaces `buildPersonalRacingLine` intent)
```
personalLineO = lerp(centerSlot, carIdeal, skillWeight) + personalityBias + formWobble
skillWeight   = 0.15 + 0.8·skill01          // rookie ≈ slot truth; elite ≈ ideal
personalityBias = bravery01·0.4·lateApexBias  // bold: later apex, wider exit; cautious: −
formWobble      = focus01-scaled low-freq noise (P4)
```
The executed line is the personal lineO, NOT the slot truth. The lineO is
computed per race (seeded) so two races differ slightly (P4).

### 5.2 The hook (execution — replaces the loose pursuit)
Steering = **curvature feedforward + proportional + derivative**:

```
κLine   = curvature of the personal lineO at the lookahead
steerFF = atan(wb · (v·κLine))                          // follows the line's bend
steerP  = Kp · errLatTerm,   errLatTerm = lineAhead − (l + lookahead·sin(β))
steerD  = −Kd · (dl/v)                                  // lateral-velocity damp
steer   = clamp(steerFF + Kp·errLatTerm + steerD, ±steerCap)
Kp      = 1.2 + 2.0·skill01                             // skilled = tight hook
Kd      = 0.35
```
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
- **P2 DONE (vLine only)** — `engine/line/carLine.ts` builds a per-setup lineO
  (edge-to-edge sweep) + vLine envelope (corner speed + brake ramp via aBrake).
  The lateral shape is deliberately near-identical across setups (correct
  physics); the per-setup difference lives in the SPEED envelope (mean |Δv|
  ≈ 7 m/s between tier-1 and tier-4). NOT YET wired into the Racer.
- **P3 PARTIAL** — momentum/confidence braking done (§5.3): brave carries speed
  (16.4 vs 15.8 m/s cornering; 1.2 s/lap), timid brakes early/hard and is safe,
  confidence edges the margin. The hook (§5.2), personal-line approach to the
  car ideal (§5.1), shift-assist precision, and skill-scaled drift-hold remain.
- **P4 NOT DONE** — form roll + corner-correlated noise (spec §6) pending.
- Session extras: sprint minimap tied to the sampled (drawn) ribbon (not the
  mother loop) — `minimapExtent` + no closePath for sprints; wall-crash now
  STOPS the car (momentum gone) and the marshal re-slots it in ~0.3 s (was
  ~12 s grinding).

