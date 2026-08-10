<p align="center">
  <a href="https://omegarusdev.github.io/apex-auto-racer/">
    <img src="https://img.shields.io/badge/▶_PLAY_NOW-playable_in_browser-brightgreen?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Play Now" height="40" />
  </a>
</p>

<p align="center"><sub>Offline shortcut: <a href="PLAY.html"><code>PLAY.html</code></a> opens the hosted game.</sub></p>

# Apex Auto-Racer

Idle / Scalextric-style autobattler. You hold throttle and brake; steering is automatic. Gears shift themselves (Shift is an optional early nudge). Drivers are fallible autopilots — upgrades push the game toward hands-off watching.

## How to run

```bash
npm install
npm run play
```

Serves at http://127.0.0.1:5173/ (`npm run build` / `npm run preview` for production). Debug: `?debug=1`.

## Stack

Vite + TypeScript (strict), Canvas 2D, Web Audio, localStorage (`apex-save-v1`). Zero runtime dependencies. Deterministic mulberry32 PRNG — no `Math.random`. Bundle target &lt; 1MB.

Maintainer notes: see `DEVIATIONS.md`.
