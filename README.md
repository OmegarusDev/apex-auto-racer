<p align="center">
  <a href="https://omegarusdev.github.io/apex-auto-racer/">
    <img src="https://img.shields.io/badge/▶_PLAY_NOW-playable_in_browser-brightgreen?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Play Now" height="40" />
  </a>
</p>

<p align="center"><strong>No install.</strong> Works in the browser (desktop & mobile).</p>

# Apex Auto-Racer

Scalextric-style pedal autobattler. **Hold gas — steering is Mag autopilot** (no steer stick). Manage speed vs grip; advanced players use trail brake + SHIFT rev windows + Street clutch-kick. Drivers are fallible autopilots — upgrades push the game toward hands-off watching.

**Live fantasy:** hybrid tyre+yaw under groove Mag; Track fishtail / Street JDM latch / Rally loose slide; garage parts feed real mass/aero/bias tradeoffs; peg meter + SHIFT rev strip; zero runtime dependencies. **GDD hybrid contract:** groove = where Mag points, tyres = whether it holds, no chassis magnet — see `PROGRESSION_PLAN.md` §1.

**Visuals:** Procedural sky dome with dynamic sun/day-night cycle; discipline-specific environments (Track=forest green, Street=urban grey, Rally=dirt brown); self-hosted fonts; procedural sky dome with dynamic sun/day-night cycle; discipline-specific sky colors.

**Cars:** Team-based colors (uniform per team); player car visually distinct (+10 saturation, +5 lightness, 15% larger render scale); floating name label with gold "Bebas Neue" font; floating arrow marker above player car.

**Tracks:** Sprint finish arch/gantry with checkered banner; discipline-specific track geometries (Track=GP circuits, Street=city grids + car-park drift loops, Rally=winding stages).

## Play

| | |
|---|---|
| **Browser** | [omegarusdev.github.io/apex-auto-racer](https://omegarusdev.github.io/apex-auto-racer/) |
| **Local** | `npm install && npm run play` → http://127.0.0.1:5173/ |
| **Debug** | append `?debug=1` |

`PLAY.html` in this repo is a convenience redirect to the hosted build (requires network).

## Controls

- **Enter / right half** — throttle (one-finger default)
- **Space / left half** — brake (trail / threshold; Rally brake-pulse initiates slide)
- **Shift / bottom pad** — manual upshift (watch the rev strip; any valid-rev time, gas or not). Pin the throttle and the ~1s redline dwell auto-upshifts — but an early Shift is the fast path. **Street:** while armed/latched = clutch-kick
- **Escape** — back / pause

No steer axis — Mag + AI `steerTarget` hold the line. Quick Race picker: Track / Street / Rally each have a distinct look and blurb.

## Disciplines

| Discipline | Visual Theme | Track Style | Driving Character |
|------------|--------------|-------------|-------------------|
| **Track** | Forest green / cool blues | GP circuits, sweepers, esses, chicanes | Precision, high-speed sweepers, aero management |
| **Street** | Urban grey/asphalt | City grids, right-angle corners, car-park drift loops | Drift-line execution, tight walls, clutch-kick |
| **Rally** | Earth tones, dirt browns | Winding stages, loose surfaces, surface transitions | Loose sliding, brake-pulse initiation, loose-surface control |

## Controls

- **Enter / right half** — throttle (one-finger default)
- **Space / left half** — brake (trail / threshold; Rally brake-pulse initiates slide)
- **Shift / bottom pad** — manual upshift (watch the rev strip; any valid-rev time, gas or not). Pin the throttle and the ~1s redline dwell auto-upshifts — but an early Shift is the fast path. **Street:** while armed/latched = clutch-kick
- **Escape** — back / pause

No steer axis — Mag + AI `steerTarget` hold the line. Quick Race picker: Track / Street / Rally each have a distinct look and blurb.

## Visual Features

- **Procedural Sky Dome** — Dynamic sun position, day/night cycle, discipline-specific sky colors (Track=cool blues, Street=warm oranges, Rally=earthy tones), star field at night
- **Discipline-Specific Backgrounds** — Track=forest green, Street=urban grey, Rally=dirt brown; day/night variants
- **Team Colors** — Uniform per team; player car gets +10 saturation, +5 lightness boost
- **Player Car** — 15% larger visual scale (render only, collision unchanged); floating gold name label with "Bebas Neue" font; pulsing arrow marker
- **Sprint Finish** — Arch/gantry with checkered banner + "FINISH" text stripes
- **Skybox** — Procedural sky dome with dynamic sun position, day/night cycle, volumetric fog
- **Self-hosted Fonts** — Bebas Neue + IBM Plex Sans (5 woff2 files, no Google Fonts dependency)

## Controls

- **Enter / right half** — throttle (one-finger default)
- **Space / left half** — brake (trail / threshold; Rally brake-pulse initiates slide)
- **Shift / bottom pad** — manual upshift (watch the rev strip; any valid-rev time, gas or not). Pin the throttle and the ~1s redline dwell auto-upshifts — but an early Shift is the fast path. **Street:** while armed/latched = clutch-kick
- **Escape** — back / pause

No steer axis — Mag + AI `steerTarget` hold the line. Quick Race picker: Track / Street / Rally each have a distinct look and blurb.

## Develop

```bash
npm install
npm run play          # local game
npm run build         # production bundle
npm run validate:feel # named feel gates + suites
```

## Stack

Vite + TypeScript (strict), Canvas 2D, WebGL, Web Audio, `localStorage` (`apex-save-v1`). Race sim uses a seeded mulberry32 PRNG (career/title may use wall-clock seeds). Bundle target < 1MB. MIT licensed.

## Stack Architecture

- **Race Sim** (seeded, headless) — `RaceDirector` facade composing `engine/race/*`, Physics (`engine/vehicle/*`), Gearbox, Driver AI, Track, Modifiers, EntertainmentMeter
- **Presentation** — WebGL engine (`src/graphics/engine/*`), Canvas 2D HUD/menus, Web Audio, procedural sky dome
- **Career** (between races) — progression, garage, roster, tournaments, ghost replay

## Documentation

- **PROGRESSION_PLAN.md** — Gameplay-core plan (physics + driver + car + track)
- **DEVIATIONS.md** — Living engineering log of spec deviations
- **DRIVING_SPEC.md** — Driving system architecture spec
- **DEVIATIONS.md** — Engineering decision log

## License

MIT licensed.

---

**Live:** http://127.0.0.1:5173/ (local) | [omegarusdev.github.io/apex-auto-racer](https://omegarusdev.github.io/apex-auto-racer/) (hosted)