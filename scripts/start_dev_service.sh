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
nohup env NODE_ENV=development PORT="$PORT" node server.js >>"$OUT_LOG" 2>>"$ERR_LOG" &
PID=$!
echo "$PID" > "$PID_FILE"
echo "[mc-dev] started PID $PID"
echo "[mc-dev] logs: tail -f $OUT_LOG"
