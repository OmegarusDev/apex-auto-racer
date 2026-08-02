#!/usr/bin/env bash
# Start Vite if needed, otherwise just open the game in the browser.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
URL="http://127.0.0.1:5173/"

if curl -sf -o /dev/null "$URL"; then
  echo "Already running at $URL"
  open "$URL" 2>/dev/null || true
  exit 0
fi

cd "$ROOT"
exec npm run play
