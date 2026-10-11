#!/bin/bash
# Screenshot of a page served from the repository: scripts/shot.sh <path?query> <width> <height> <out.png>
set -u
cd "$(dirname "$0")/.."
PAGE="$1"; W="$2"; H="$3"; OUT="$4"
CH="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
PORT=$((20000 + RANDOM % 20000))
python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
sleep 0.5
PROFILE="$PWD/test/browser/profile-shot-$W"; rm -rf "$PROFILE" "$OUT"
"$CH" --headless=new --disable-gpu --hide-scrollbars ${CHROME_FLAGS:-} --user-data-dir="$PROFILE" --window-size="$W,$H" \
  --virtual-time-budget=6000 --screenshot="$PWD/$OUT" "http://127.0.0.1:$PORT/$PAGE" >/dev/null 2>&1 &
for i in $(seq 1 60); do [ -s "$OUT" ] && break; sleep 1; done; sleep 1
pkill -9 -f "$PROFILE" 2>/dev/null; rm -rf "$PROFILE"
echo "$OUT"
