#!/bin/bash
# Runs the browser audit with headless Chrome at several widths.
# Usage: scripts/audit.sh [board path relative to test/browser/] [width...]
# Environment: CHROME (path of the browser; macOS default below), CHROME_FLAGS (extra flags, e.g.
# --no-sandbox in CI containers), EXTRA (query string added to the audit page, e.g. "&direction=up",
# "&hostvars=1", "&dist=1"), REAL=1 (real time instead of virtual time), HEIGHT (window height,
# 2400 by default; a short one puts the detail drawer over the board).
# Chrome writes the page and then does not exit on its own (seen on macOS 27), so the script waits
# for the dump and kills it.
set -u
cd "$(dirname "$0")/.."
BOARD="${1:-../../examples/incident-response/board.json}"; shift || true
EXTRA="${EXTRA:-}"
WIDTHS="${*:-1600 1300 1100 1000 900 700}"
CH="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
OUT=test/browser/out; mkdir -p "$OUT"
PORT=$((20000 + RANDOM % 20000))
python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
sleep 0.5
STATUS=0
for W in $WIDTHS; do
  PROFILE="$PWD/test/browser/profile-$W"; rm -rf "$PROFILE"
  DUMP="$OUT/dom-$W.html"; : > "$DUMP"
  "$CH" --headless=new --disable-gpu --hide-scrollbars ${CHROME_FLAGS:-} --user-data-dir="$PROFILE" --window-size="$W,${HEIGHT:-2400}" \
    ${REAL:+--timeout=60000} ${REAL:---virtual-time-budget=30000} --dump-dom "http://127.0.0.1:$PORT/test/browser/audit.html?board=$BOARD$EXTRA" > "$DUMP" 2>/dev/null &
  for i in $(seq 1 120); do grep -q "</html>" "$DUMP" && break; sleep 1; done
  pkill -9 -f "$PROFILE" 2>/dev/null; rm -rf "$PROFILE"
  python3 - "$W" "$DUMP" <<'PY' || STATUS=1
import sys, re, json, html
w, path = sys.argv[1], sys.argv[2]
m = re.search(r'<pre id="audit">(.*?)</pre>', open(path).read(), re.S)
if not m: print(w, "NO RESULT"); sys.exit(1)
r = json.loads(html.unescape(m.group(1)))
if "error" in r: print(w, "ERROR", r["error"][:800]); sys.exit(1)
bad = {k: r.get(k) for k in ["missing", "underNode", "crossings", "close", "shortTip", "outside", "moved", "unpainted", "covered", "stack", "groups", "motion", "behaviour", "hidden", "loops"] if r.get(k)}
print(f"{w}px  mode={r['mode']}  nodes={r['nodes']}  wires={r['wires']}  slowest={r.get('slowest')}  edits={r['edits']}")
for k, v in bad.items(): print(f"   {k}: {len(v)}  {v[:6]}")
sys.exit(1 if bad or any(("DIFFERENT" in e or "MOVED" in e or "missing" in e) for e in r["edits"]) else 0)
PY
done
exit $STATUS
