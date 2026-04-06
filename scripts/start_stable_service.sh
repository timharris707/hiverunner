#!/bin/sh
set -eu

# ─── Stable lane: runs a production build on port 3001 ───
APP_DIR="/Users/timharris/.openclaw/workspace/projects/mission-control-app"
STABLE_DIR="$APP_DIR/.stable"
LOG_DIR="$APP_DIR/data"
PID_FILE="$LOG_DIR/mission-control-stable.pid"
OUT_LOG="$LOG_DIR/mission-control-stable.log"
ERR_LOG="$LOG_DIR/mission-control-stable.err.log"
PORT="${PORT:-3001}"

mkdir -p "$LOG_DIR"

# ── Resolve node binary ──
# launchd and nohup run with minimal PATH; Homebrew node may not be found.
NODE_BIN=""
for candidate in /opt/homebrew/bin/node /usr/local/bin/node /Users/timharris/.local/share/fnm/node-versions/*/installation/bin/node; do
  if [ -x "$candidate" ]; then
    NODE_BIN="$candidate"
    break
  fi
done
if [ -z "$NODE_BIN" ]; then
  echo "[mc-stable] ERROR: cannot find node binary. Install Node.js or set PATH."
  exit 1
fi

# ── Pre-flight: stable build must exist ──
if [ ! -d "$STABLE_DIR/.next" ]; then
  echo "[mc-stable] ERROR: no production build found in $STABLE_DIR/.next"
  echo "[mc-stable] Run scripts/promote_to_stable.sh first."
  exit 1
fi

cd "$STABLE_DIR"

# ── Stale PID guard ──
if [ -f "$PID_FILE" ]; then
  OLD_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "[mc-stable] already running on PID $OLD_PID"
    exit 0
  fi
  echo "[mc-stable] removing stale PID file (PID $OLD_PID not running)"
  rm -f "$PID_FILE"
fi

# ── Port conflict guard ──
if lsof -tiTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "[mc-stable] port $PORT already in use; refusing to start duplicate"
  exit 1
fi

echo "[mc-stable] starting Mission Control stable server on port $PORT (node: $NODE_BIN)"
NODE_ENV=production PORT="$PORT" nohup "$NODE_BIN" server.js >>"$OUT_LOG" 2>>"$ERR_LOG" &
PID=$!
echo "$PID" > "$PID_FILE"
echo "[mc-stable] started PID $PID"
