<p align="center">
  <a href="https://omegarusdev.github.io/apex-auto-racer/">
    <img src="https://img.shields.io/badge/▶_PLAY_NOW-playable_in_browser-brightgreen?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Play Now" height="40" />
  </a>
</p>

<p align="center">
  <a href="https://omegarusdev.github.io/apex-auto-racer/"><strong>Play in browser</strong></a>
  ·
  <a href="PLAY.html">Quick link</a>
  ·
  <a href="LICENSE">MIT License</a>
</p>

# Apex Auto-Racer

Scalextric-style pedal autobattler. Hold gas and brake; steering is automatic. Gears shift themselves (Shift is an optional early nudge). Drivers are fallible autopilots — upgrades push the game toward hands-off watching.

**Live fantasy:** groove / deslot peg physics, peg meter on the race HUD, shared menu shell across career screens, zero runtime dependencies.

## Play

| | |
|---|---|
| **Browser** | [omegarusdev.github.io/apex-auto-racer](https://omegarusdev.github.io/apex-auto-racer/) |
| **Local** | `npm install && npm run play` → http://127.0.0.1:5173/ |
| **Debug** | append `?debug=1` |

`PLAY.html` in this repo is a convenience redirect to the hosted build (requires network).

## Controls

- **Enter / right half** — throttle  
- **Space / left half** — brake  
- **Shift / bottom pad** — optional early upshift (auto otherwise)  
- **Escape** — back / pause  

## Develop

```bash
npm install
npm run play          # local game
npm run build         # production bundle
npm run validate      # feel contract (21 gates)
```

## Stack

Vite + TypeScript (strict), Canvas 2D, Web Audio, `localStorage` (`apex-save-v1`). Race sim uses a seeded mulberry32 PRNG (career/title may use wall-clock seeds). Bundle target &lt; 1MB. MIT licensed.

Maintainer notes: [`DEVIATIONS.md`](DEVIATIONS.md).
