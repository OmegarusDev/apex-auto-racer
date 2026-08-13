<p align="center">
  <a href="https://omegarusdev.github.io/apex-auto-racer/">
    <img src="https://img.shields.io/badge/▶_PLAY_NOW-playable_in_browser-brightgreen?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Play Now" height="40" />
  </a>
</p>

<p align="center"><strong>No install.</strong> Works in the browser (desktop &amp; mobile).</p>

# Apex Auto-Racer

Scalextric-style pedal autobattler. **Hold gas — steering is Mag autopilot** (no steer stick). Manage speed vs grip; advanced players use trail brake + SHIFT rev windows + Street clutch-kick. Drivers are fallible autopilots — upgrades push the game toward hands-off watching.

**Live fantasy:** hybrid tyre+yaw under groove Mag; Track fishtail / Street JDM latch / Rally loose slide; garage parts feed real mass/aero/bias tradeoffs; peg meter + SHIFT rev strip; zero runtime dependencies.

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
- **Shift / bottom pad** — manual upshift (watch the rev strip); **Street:** while armed/latched = clutch-kick
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

Vite + TypeScript (strict), Canvas 2D, Web Audio, `localStorage` (`apex-save-v1`). Race sim uses a seeded mulberry32 PRNG (career/title may use wall-clock seeds). Bundle target &lt; 1MB. MIT licensed.

Maintainer notes: [`DEVIATIONS.md`](DEVIATIONS.md).
