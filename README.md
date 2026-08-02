<p align="center">
  <a href="https://omegarusdev.github.io/apex-auto-racer/">
    <img src="https://img.shields.io/badge/▶_PLAY_NOW-playable_in_browser-brightgreen?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Play Now" height="40" />
  </a>
</p>

<p align="center"><sub>Offline shortcut: download <a href="PLAY.html"><code>PLAY.html</code></a> and open it locally — it launches the hosted game.</sub></p>

# Apex Auto-Racer

Idle / Scalextric-style autobattler. Hold throttle and brake; steering is automatic. Drivers act as fallible autopilots — upgrades shift the game toward hands-off watching.

## Run

```bash
npm run play
```

Opens http://127.0.0.1:5173/ (or `./scripts/play.sh` if already running). Debug: `?debug=1`.

## Build

```bash
npm run build
```

Production bundle target: &lt; 1MB (currently ~130KB JS across chunks).

## Stack

- Vite + TypeScript (strict), zero runtime dependencies
- Canvas 2D + Web Audio (no external media)
- localStorage save (`apex-save-v1`)
- Deterministic seeded PRNG (mulberry32) — no `Math.random`

## Spec

See the engineering plan and `DEVIATIONS.md` for process/implementation notes.
