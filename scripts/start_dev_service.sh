#!/bin/sh
set -eu

APP_DIR="/Users/timharris/.openclaw/workspace/projects/mission-control-app"
LOG_DIR="$APP_DIR/data"
PID_FILE="$LOG_DIR/mission-control-dev.pid"
OUT_LOG="$LOG_DIR/mission-control-dev.log"
ERR_LOG="$LOG_DIR/mission-control-dev.err.log"
PORT="${PORT:-3000}"

mkdir -p "$LOG_DIR"
cd "$APP_DIR"

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
  echo "[mc-dev] ERROR: cannot find node binary. Install Node.js or set PATH."
  exit 1
fi

# ── Boot diagnostic banner ──
echo ""
echo "=== Mission Control Dev Start ==="
echo "  Time:   $(date '+%Y-%m-%d %H:%M:%S')"
echo "  Port:   $PORT"
echo "  Mode:   development"
echo "  Dir:    $APP_DIR"

# ── Stale PID check ──
if [ -f "$PID_FILE" ]; then
  OLD_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "  Status: already running on PID $OLD_PID"
    echo "================================"
    exit 0
  fi
  echo "  Note:   removed stale PID file ($OLD_PID dead)"
  rm -f "$PID_FILE"
fi

# ── Port collision check ──
EXISTING_PID="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
if [ -n "$EXISTING_PID" ]; then
  echo "  !! Port $PORT already in use by PID $EXISTING_PID"
  echo "  !! Adopting that process as the managed dev server"
  echo "$EXISTING_PID" > "$PID_FILE"
  echo "================================"
  exit 0
fi

# ── Clear stale lock ──
if [ -f "$APP_DIR/.next/dev/lock" ]; then
  echo "  Note:   clearing stale .next/dev/lock"
  rm -f "$APP_DIR/.next/dev/lock"
fi

echo "================================"
echo "[mc-dev] starting Mission Control dev server on port $PORT"

# Use node directly (not npm run dev) so the PID file tracks the actual
# node process, not an npm wrapper that can exit before node is stable.
# MC_ENGINE_TICK=off: dev lane does not execute orchestration work.
# The stable lane (:3001) owns execution. Dev is for UI/build/testing.
# Override with MC_ENGINE_TICK=on if you want dev to tick (e.g., no stable lane).
MC_ENGINE_TICK="${MC_ENGINE_TICK:-off}"
nohup env NODE_ENV=development PORT="$PORT" MC_ENGINE_TICK="$MC_ENGINE_TICK" "$NODE_BIN" server.js >>"$OUT_LOG" 2>>"$ERR_LOG" &
PID=$!
echo "$PID" > "$PID_FILE"
echo "[mc-dev] started PID $PID"
echo "[mc-dev] logs: tail -f $OUT_LOG"
