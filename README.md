# Apex Auto-Racer

Idle / Scalextric-style autobattler. Hold throttle and brake; steering is automatic. Drivers act as fallible autopilots — upgrades shift the game toward hands-off watching.

## Run

```bash
cd ~/cursorthings/ONGOING/apex-auto-racer
npm install
npm run dev
```

Open the Vite URL. Debug overlay: add `?debug=1`.

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
