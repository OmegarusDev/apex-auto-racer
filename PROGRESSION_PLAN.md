# Apex Auto-Racer — Gameplay-Core Plan (physics + input + driver + car)

Gameplay-first plan. The car, the driver, the physics, the input, and the three
disciplines — the *racing*, not the menus. Menus / progression / campaign come
after this core is real and feels right. Everything below is one coupled,
emergent system; nothing is a fudge.

---

## 1. The game, precisely

You do **not** drive the car. The car is a **real racing car**. A **driver** —
an RPG character with skill that genuinely grows — holds the wheel, reads the
corner, brakes, picks the line, and recovers slides. Your job is to **tell them
in real time how hard to gun it**, using an **analogue throttle** that feels
like a slot-car controller trigger: press the bottom of the pedal = full gas,
slide your finger up = lift. You also brake (rescue / trail), shift (powerband),
and kick (Street risk move). The driver's skill and the car's parts decide what
you can safely *trust*.

The **slot-car feel** is the *input and the vibe* — one finger, thrust-only,
tabletop miniature diorama — not a physical rail. There is no magnet, no groove,
no deslot. The "line-holding" is the driver's skill expressed through real tyre
physics. Running wide, understeering, spinning, and kissing barriers are all
emergent consequences of tyre limits × driver control × your thrust.

### The one satisfaction everything exists for

> Hold the pedal down, trust the driver, and watch the car **carve a corner at
> the physical limit** — the rear loading up mid-corner, the car rotating to
> the apex, then the full-gun exit pulling it away. When you've misread it —
> or the driver has over-committed — you *see* it coming: the understeer
> washing wide, the rear stepping out, a quick lift or a brake tap saving it,
> or the full spin if you don't.

---

## 2. Design laws (non-negotiable)

- **L0 — Nothing arbitrary.** Every outcome (wide run, understeer, oversteer,
  spin, crash, rejoin, driver mistake) is a consequence of physical or control
  state. "Why did that happen?" is always answered by a force or an input.
- **L1 — Models and collision are the same thing.** The visible mesh IS the
  physics shape — cars and track. No invisible hitboxes.
- **L2 — Emergence from fundamentals.** Understeer, oversteer, spin, drift,
  mistakes, confidence are *phenomena* of the tyre/vehicle/driver system, never
  bespoke subsystems or random rolls.
- **L3 — Physics-true but readable.** Real Newtonian dynamics; the HUD/broadcast
  translates it into one-finger decisions. The player never steers.
- **L4 — Zero assets, always.** All visuals procedural, all audio synthesized,
  no runtime deps.
- **L5 — Deterministic, seeded, gated.** Fully seeded sim; every phase ships
  named feel gates (`npm run validate:feel`).
- **L6 — Everything matters, everything composes.** Every sim quantity has a
  race consequence and a player lever. The absurd detail lives in the coupled
  *state*, never in the knob count.
- **L7 — The player has agency at every level.** At any driver level and any
  part tier, the player's thrust/brake/shift can cause a failure or save one.
  The driver fills in the gaps; it never makes the player's inputs decorative.

---

## 3. The greenfield decision (answer: yes, the sim layer is rebuilt from scratch)

The current `src/engine/vehicle/*` + `DriverBrain.ts` are architecturally built
around the **magnet → groove → deslot** constraint: `grooveAutopilot`,
`grooveStep`, `deslotDynamics`, `deslotStep`, `deslotMargin`, the vProfile /
vDriver speed profiles, and a driver-skill model that is a **target-speed
multiplier** (`vDriver = vProfile × confidence`).

A real racing car steered by a real driver model is **incompatible with keeping
that**. It would create two systems writing the same force (the magnet holding
the line vs. the driver steering it) and a skill model that contradicts the
fantasy (speed scalar vs. control quality). **The entire vehicle + driver layer
is thrown away and rebuilt greenfield.**

### 3.1 Tossed (greenfield)

- `grooveAutopilot.ts`, `grooveStep.ts`, `deslotStep.ts`, `deslotDynamics.ts`
  (latch/drift styling), `deslotMargin.ts` (vDeslot), the `slipAngle`/`steerRad`
  cosmetic proxy, the DRIFT_CFG quarantine.
- `DriverBrain.ts` target-speed model; the `vDriver`/`vProfile`/`vSafe` baked
  speed profiles in `TrackGenerator` (`buildSpeedProfiles`,
  `buildVDriverProfile`); `computeVDeslot` and everything downstream.
- `parts.ts` linear sums + `stats.ts` display-stat collapse + the old
  `CarSetup` composition.
- `PHYSICS` groove/deslot/magnet constant blocks.

### 3.2 Kept (infrastructure, reused as-is or lightly upgraded)

- **Frenet ribbon** (`RacingLine` interpolation, track nodes, phase-shifted
  start) — position/heading, width/runoff/barrier zones (`zones.ts` survives
  conceptually: kerb/runoff/grass/wall grip-drag bands).
- **RaceDirector** orchestration, event ring, standings, ghost, headless
  harness, determinism.
- **`race/contact.ts`** pack layer (upgraded in Phase 6 to use mesh extents),
  **`draft.ts`**, `fieldSetup`, `rivals`, `quickRaceConfig`, `Gearbox` shell.
- WebGL engine + shaders + synths + camera + minimap + HUD chrome.
- Save manager, career scene skeleton, results payload (unused until later).

### 3.3 Why this is the right call

- The slot mechanics were a *crutch* for "no steering." A driver model makes
  them obsolete: the driver *is* the line-holder, and its skill is the game.
- One coherent force path (tyre → vehicle → path) instead of a constraint stack.
- Spins, running wide, and the "whip round the corner" all emerge from real
  physics — which is the entire brief.

---

## 4. The input — an analogue thrust pedal (the "slot-control feel")

### 4.1 The pedal geometry

- **GAS pad (right)** is a **vertical analogue strip**. Finger Y position
  inside the pad sets throttle demand:
  - Press **bottom of the pad** → demand 1.0 (full gas).
  - **Slide up** → demand falls to 0.0 at the top ("lifting off a pedal").
  - Release → demand returns to 0 (spring).
  - The pad renders a **bright fill from the finger down to the bottom** so the
    player sees their demand at a glance; a small % readout too.
- **BRAKE pad (left)** is the same vertical analogue strip → brake request 0..1.
  Press bottom = hard braking; slide up = lighter; release = off.
- **SHIFT pad (center)** stays a tap (edge-triggered upshift; Street kick).
- **Two-finger trail-braking** works: right finger on GAS easing up, left finger
  on BRAKE pressing down = a real trail-brake move.
- Keyboard fallback: Enter = full gas (hold), Space = full brake, Shift =
  upshift. Touch is the analogue path; keyboard is discrete.

### 4.2 What the input means (the interaction contract)

The player's throttle is a **ceiling the driver may run below but never above**:

```
player throttle demand ──► DRIVER PLAN (corner read, brake, line, throttle plan)
     brake request  ──►   DRIVER integrates (brake earlier/harder — a rescue)
     shift / kick   ──►   DRIVER powerband management / Street risk move
```

- **Full gas = trust.** The driver runs its plan as well as its skill allows.
  The outcome is the driver's skill × the car's parts × the physical limit.
- **Lift = back off / save.** Lowers the power envelope → the driver targets a
  safer margin and reduces exit-throttle oversteer. Feathering on exit is the
  high-skill player move.
- **Brake = rescue / technique.** The player's brake *adds* to the driver's plan:
  brake early, brake deep, trail-brake to rotate (Street).
- The **driver still owns the wheel and the corner braking.** You cannot force
  the car into a corner by holding gas — the driver still brakes. What you *can*
  do is expose the driver's skill limits (full gas into a corner a bad driver
  under-brakes), rescue them (brake/lift), and manage the powerband (shift).

### 4.3 The assist/automation axis (the hard design crux, solved)

- **Assist** = how much the driver completes and corrects the player's requests
  (existing Authority, deepened and made part of the driver's control params).
- **Automation** = the driver's plan quality (skill). At low skill the driver
  under-brakes, early-apexes, and snaps on exit → full gas is *dangerous*, and
  the player must actively manage every corner. At high skill the driver is
  near-perfect → the player holds full gas and intervenes only at the moments
  of maximum leverage.
- **Hands-off watching is the earned payoff**, not a compromise. The player is
  never decorative (L7): even a perfect driver needs the player to choose when
  to commit full power, when to shift, and when to take the risk.

---

## 5. The physics core (greenfield spec)

One coupled system. All quantities integrate cheaply at 120 Hz; ~50 floats per
car.

### 5.1 Tyres — the whole game lives here

Per-axle slip-force model with a **grip peak and post-peak falloff**, plus full
thermal/mechanical state:

- Lateral `F_y = Fz·µ(α)`: µ rises to `µ_peak` at `α_peak`, then falls with
  `s_falloff`. Longitudinal `F_x = Fz·µ_x(κ)`.
- Friction coupling per axle: inside the circle whose radius is the *current*
  F(α,κ) — running past peak eats long grip and vice-versa. **This single
  feature produces understeer (front past peak), oversteer (rear past peak),
  drift (deliberately past peak), and spin (rear past peak, driver can't
  catch).**
- **Tyre state**: carcass temp `T_tyre` (cold→optimal→hot→greasy window),
  pressure (contact patch + heat build), wear (grip fade over a race).
  Compound = a full profile (see §8).

### 5.2 Vehicle — two-axle real plane + yaw + drivetrain

- Frenet position `(s, l)` + heading `ψ`; states `v`, body slip `β`, yaw rate
  `ω`. Axle slip angles `α_f, α_r` from `β, ω, v, δ_f`. Axle forces from §5.1.
  Yaw from axle-force moments; load transfer from pitch/roll.
- **Drivetrain**: real motor model — torque **curve** vs RPM (not a flat
  accel), redline, back-EMF/current sag, **motor temperature** derating torque,
  gear stack + final drive that place the power band. Gearbox rev/shift logic
  keeps its structure; the curves become real.
- **Brakes**: peak decel, **temperature → fade**, bias. Trail-braking is a real
  load-transfer move.
- **Aero**: `q·CL` downforce + `q·CD` drag, rake sensitivity. No magnet — the
  aero is the downforce that loads the tyres at speed (real-car physics).
- **Surfaces**: per-band grip/drag from `zones.ts` (asphalt / kerb / runoff /
  grass / barrier), plus discipline surface curves (§9). Off-track is real:
  grass and gravel bleed speed; barriers stop you.

### 5.3 Off-track, rejoin, recovery

- The car runs wide **on the physics** (tyre limit + driver error); `l` grows
  toward the barrier/verge. Kerbs buzz (µ drop), runoff drags, grass/gravel
  stop the car.
- **Natural rejoin** is automatic: the driver steers back toward the racing
  line whenever there's grip. There is no "slot" to re-catch — the driver just
  recovers the line.
- **Marshal recovery** (diegetic, priced) only when physically stuck: stopped,
  facing backward (|β| ≥ ~70°), or wedged. A marshal re-slots the car on the
  line; worst outcome, never a DNF, never a mid-arc teleport.
- The tabletop diorama is bounded; cars never leave the world.

### 5.4 The danger envelope (the natural difficulty)

The player's moment-to-moment game is risk management:

```
clean ──► minor scrub ──► wide entry/exit (0.3–1s) ──► kerb/runoff (bleed)
    ──► grass/gravel (stop) ──► barrier (stun + damage) ──► spin (big time)
```

All of it caused by the player's thrust × the driver's skill × the car's state
(cold tyres, hot motor, worn compound). The starter car + rookie driver are
naturally, honestly slow: corners must be taken under the limit or the cascade
costs seconds.

---

## 6. The driver model (greenfield spec) — the RPG, as control quality

A layered controller that produces the same interface the player uses (steer δ,
throttle, brake), integrated with the player's requests (§4.2).

### 6.1 Layers

1. **Perception** — lookahead (∝ v × skill), reads curvature, surface, track
   edge, rivals ahead. Skill sets lookahead + perception noise.
2. **Plan** — target entry speed from the **real tyre limit at the corner**
   (computed from the car's actual grip, not a baked profile) with a
   skill-scaled margin; brake point via required decel; the line (racing line +
   personal bias); throttle plan (trail + exit ramp).
3. **Execute** — steering via a human model: rate-limited δ, reaction delay,
   tracking error ∝ (1 − skill). **This is where line quality lives**: an
   unskilled driver early-apexes, late-enters, understeers wide, oscillates
   (overcorrection → fishtail); a skilled driver clips apexes lap after lap.
4. **Recover** — slide detection (rear α past peak / ω high) → countersteer
   with skill-scaled quality. A skilled driver catches; a rookie spins.

### 6.2 Skill → control parameters (the RPG table)

| Stat | What it controls (all control, no speed fudge) |
|---|---|
| **Skill** | brake-point accuracy, entry-speed target (how close to the limit), lookahead, exit-throttle ramp, countersteer quality |
| **Focus** | tracking-error variance, mistake rate, late-race fatigue decay |
| **Bravery** | safety margin (closer to limit), brake-point lateness, willingness to carry a slide |
| **Determination** | draft commitment, comeback drive, overtake aggression |

**Traits** nudge control params + psychology (iceCold steadies under pressure;
showboat edges closer to the limit when ahead; hothead brakes later in
traffic). Never dice on outcomes.

### 6.3 XP and growth

XP per race → levels → unspent points → control params, one point at a time,
visible as "+ brake accuracy", "+ slide catch", "+ exit throttle control". The
driver measurably gets faster at a *fixed car* — gateable (`RPG_PROGRESSION_MEASURABLE`).

### 6.4 Confidence & form (the drama engine, emergent)

Clean passes / caught slides / near-limit holds build confidence → the driver
edges closer to the limit. Deslots-style events (now: wide runs, spins, barrier
hits), crashes, being gapped drain it → the driver goes safe. Fed by crowd hype;
fully emergent from race events (L2).

---

## 7. The parts that matter in the car (gameplay)

All parts are **physical components with profiles**, not +N sliders. Upgrading
is component selection; tiers are characters. `parts.ts` linear sums are gone.

| Component | What it changes (profile) | The driving character it creates |
|---|---|---|
| **Motor** | torque curve, redline, mass, heat | peaky top-end screamer vs midrange punch; mass penalty; heat sag on stints |
| **Intake / Exhaust** | breathing (power curve top-end vs midrange), response | where the power sits — Track sweepers vs Rally exits vs Street |
| **Tyres (compound)** | µ/α/falloff curve, heat window, wear, pressure, driftability | **the cornering lever** — peak grip vs driftable vs durable |
| **Brakes** | peak decel, fade, bias | stopping distance, rotation under trail, exit stability |
| **Suspension** | roll stiffness, compliance, ride height | corner balance, kerb/Rally riding, aero rake |
| **Aero** | CL, CD, rake, ground-effect | corner speed vs top speed; balance shift at speed |

- **No rail**: value is situational — by discipline (§9), by chassis, by track,
  by driver. A twitchy high-grip car needs a skilled driver to exploit; a
  forgiving car suits a rookie.
- **Tuning** (post-core, later phase): brake bias, pressure, final drive, ride
  height/rake, roll bar, compound falloff — sliders gated by part tier.
- **Tuning readouts predict from the same composition the sim uses** — what you
  see is what happens (`PREDICTION_MATCHES_SIM`).

---

## 8. The three disciplines — three sports, one core

Same vehicle/tyre/driver model. Differences are **surface curves, track
geometry, and driver personality priorities** — never new physics.

### 8.1 Track — momentum / aero

High-µ compound with **late falloff** (small slides); aero is the corner-speed
lever; line errors cost the most. Driver: long lookahead, aggressive exit
throttle. Geometry: sweepers, esses, high-speed kinks, chicanes. The corner is
aero-limited and fast. Fantasy: carrying huge speed through a sweeper.

### 8.2 Street — rotation / drift

Drift-friendly compound (usable post-peak regime); rotation via trail-brake +
mid-corner throttle; **fishtail is the visible recovery mechanic** (rear breaks
away, driver counters, exits clean — rewarded; not caught = spin). Walls close
and punish. Driver: short lookahead, big rotation inputs, precise throttle,
kick. Geometry: hairpins, tight chicanes, street canyons. Fantasy: drift-line
execution.

### 8.3 Rally — loose / brake-and-exit

Loose-surface µ curve that **falls under braking load** + surface noise + big
load transfer. The fast way is a 4-wheel slide that brakes late and exits on
power. Slides are constant; spins happen on throttle mistakes. Driver:
late-brake bias, slide-tolerant, throttle-careful on exits. Geometry: tight
technical stages, hairpins, surface transitions, crests. Fantasy: hanging on
through a rough stage.

---

## 9. The track (gameplay-relevant)

- **Corner grammar** replaces the radial-noise ellipses: `hairpin`, `tight-S`,
  `sweeper`, `esse`, `kink`, `chicane`, `double-apex`, `off-camber`, `crest`,
  `surface-transition` — weighted per discipline.
- **Rank/technicality** scaling adds corners, compound corners, narrower width.
- **Surface bands** per discipline feed the surface curves + visuals.
- The racing line is the **driver's job**; the generator only seeds the driver's
  perception (curvature, width, surfaces) — never a pre-scaled speed target.

---

## 10. Race-feel targets + telemetry (what "it feels right" means)

- **The whip moment**: a corner taken at the limit reads as: rear loads up
  (visual: body roll + tyre smoke scaling with slip past peak), the car rotates
  to the apex, full-gun exit. The peg-equivalent telemetry: **grip usage** vs
  the current limit, and **tyre temp/wear**, live.
- **Readability of danger**: the HUD shows grip usage, tyre temp, motor temp,
  gear/rev, and a "why" line ("rear unloaded — too early on power") fed by the
  physical state that caused it (L2). You should *see* danger before it happens.
- **Sound**: tyre scream tied to actual slip past peak; kerb/loose/surface
  contacts from the surface model; motor tone from RPM × heat.
- **Audit gate**: every §5 quantity is either actionable or readable (L6).

---

## 11. New module map (greenfield)

```
src/engine/sim/state.ts            // CarSimState v2 — the ~50-float state
src/engine/sim/tyre.ts             // peak-and-falloff + temp/pressure/wear
src/engine/sim/vehicle.ts          // two-axle real-plane integration
src/engine/sim/drivetrain.ts       // motor curve, heat, gear stack, final drive
src/engine/sim/aero.ts             // CL/CD/rake + ground effect
src/engine/sim/surface.ts          // zones + discipline surface curves
src/engine/driver/{percept,plan,execute,throttle,recover}.ts
src/engine/driver/control.ts       // skill → control params + confidence/form
src/engine/controller.ts           // player request → driver plan integration
src/engine/input/analoguePedal.ts  // vertical-slide pad input + HUD fill
src/data/components.ts             // motor/tyre/aero/brake/susp profiles
src/data/chassis.ts                // 9 full vehicle configurations
src/data/surfaces.ts               // discipline surface curves
src/engine/track/grammar.ts        // corner-token generator + surfaces
```

The old `vehicle/*` + `DriverBrain.ts` + TrackGenerator speed-profile code is
deleted as the new modules land, phase by phase.

---

## 12. Execution phases (gameplay first; menus/progression deferred)

Each phase ends green on `npm run validate:feel` (new gates in bold) + tsc +
build. Headless probes drive every phase before any presentation.

### Phase 1 — Tyre + vehicle core (greenfield start)
- `sim/tyre.ts`, `sim/vehicle.ts`, `sim/drivetrain.ts`, `sim/aero.ts`;
  Frenet (s,l,ψ) + v, β, ω integration. Constant-radius probe: scan entry
  speed → record understeer-wide / spin boundaries.
- **Gates:** `TYRE_PEAK_FALLOFF`, `UNDERSTEER_EMERGES`, `OVERSTEER_EMERGES`,
  `SPIN_EMERGENT` (scripted physical exit-throttle → high-skill catches,
  low-skill spins, neutral no-spin), `NO_ARBITRARY_SPIN`.

### Phase 2 — Driver model (the RPG as control)
- `driver/*` layers, `driver/control.ts`. Delete `DriverBrain` + vDriver
  profiles. Driver plan integrates the player's throttle ceiling (§4.2).
- **Gates:** `DRIVER_MODEL_ACTIVE`, `SKILL_IS_CONTROL` (same car, high vs low
  skill: lap delta emerges from line quality), `NO_TARGET_SPEED_FUDGE`,
  `CONFIDENCE_EMERGENT`.

### Phase 3 — Input + interaction (the crux)
- `input/analoguePedal.ts` (vertical-slide pads + HUD fill), `controller.ts`
  (request → plan integration), keyboard fallback. Two-finger trail-braking.
- **Gates:** `THRUST_IS_CEILING` (driver never exceeds player demand),
  `BRAKE_IS_REQUEST` (player brake adds to plan), `PLAYER_AGENCY_ALWAYS`
  (a request can cause and save the cascade at any level),
  `ASSIST_VS_AUTOMATION` (assist/automation split responds to driver skill).

### Phase 4 — Off-track, surfaces, recovery
- `sim/surface.ts` + zones, grass/gravel/kerb/barrier, natural rejoin,
  diegetic marshal recovery.
- **Gates:** `RUN_WIDE_EMERGENT`, `SURFACE_IS_REAL`, `REJOIN_NATURAL`,
  `MARSHAL_ONLY_WHEN_STUCK`.

### Phase 5 — Thermal / mechanical state
- Motor heat + derate, brake fade, tyre temp/wear/pressure, surface
  rubber-in, driver fatigue. Completes the §5 state.
- **Gates:** `HEAT_MATTERS` (sustained full-power stint sags; recoverable by
  lifting), `BRAKE_FADE_REAL`, `TYRE_WEAR_REAL`, `RUBBER_IN`.

### Phase 6 — Chassis + components (the car is a character)
- `data/chassis.ts` (9 full configs), `data/components.ts` (profiles), delete
  `parts.ts`/`stats.ts` linear sums. Mesh = collision extents.
- **Gates:** `NINE_CHASSIS`, `MESH_IS_COLLISION`, `CHASSIS_IDENTITY`,
  `PARTS_ARE_PROFILES`, `NO_LINEAR_SUM`, `PREDICTION_MATCHES_SIM`.

### Phase 7 — Discipline driving character
- `data/surfaces.ts` per discipline, driver personality priorities, Street
  drift regime, Rally loose model, Track aero game.
- **Gates:** `DISCIPLINE_IDENTITY` (measurable signatures: Track aero-limited
  lap, Street drift-line lap, Rally brake/exit lap), `DRIFT_IS_USABLE_STREET`,
  `RALLY_LOOSE_UNDER_BRAKE`.

### Phase 8 — Track grammar
- `track/grammar.ts`: discipline corner tokens + technicality + surface bands.
- **Gates:** `TRACK_GRAMMAR`, `TECHNICALITY_SCALES`, `SURFACE_BANDS_MATCH`.

### Phase 9 — Race feel + telemetry + core-loop balance
- Grip-usage / temp HUD, "why" telemetry, audio ties. Balance the core loop:
  starter car + rookie driver *naturally* corner-limited; every car/discipline
  feels distinct; long headless soak.
- **Gates:** `RACE_FEEL_TARGETS` (the whip moment measurable: a reference
  corner at the limit produces the defined sequence), `EVERY_ROOM_IS_A_LEVER`
  (L6 audit), `NATURAL_STARTER_DIFFICULTY`, `RPG_PROGRESSION_MEASURABLE`,
  `FIELD_FAIRNESS`, `SOAK_100_RACES`.

### After Phase 9 (deferred, not part of this plan)
Menus, garage/tuning UI, progression/economy, campaign, tournaments,
broadcast/drama layer, save v3. Built on the greenfield core once the racing
is right.

---

## 13. Risks & what NOT to do

- **Do not** keep the magnet/groove/deslot system "for the feel." Real cars +
  a driver model is the feel; the slot machinery would fight it (L2).
- **Do not** reintroduce a target-speed multiplier for driver skill. Skill =
  control quality, or the fantasy collapses.
- **Do not** let the player's throttle *force* a crash (driver always brakes) —
  agency is exposure + rescue, not override.
- **Do not** special-case "spin chance" or "random mistake." Both emerge from
  §5 + the driver model.
- **Do not** let two systems write the same force. One tyre, one vehicle, one
  driver, one controller — surfaces are *inputs*.
- **Do not** add assets or runtime deps.
- **Do not** let detail become knobs. If a §5 row has no lever or no
  consequence, cut it.
- **Do not** touch menus/progression until Phase 9 is green. The racing is the
  product.

---

## 14. Immediate next step

Phase 1: **tyre curve + two-axle real-plane + drivetrain/aero, with the
`SPIN_EMERGENT` / `UNDERSTEER_EMERGES` / `OVERSTEER_EMERGES` gates as a
headless single-car probe**, standing up `src/engine/sim/*`. Say "Phase 1"
and I'll start there.
