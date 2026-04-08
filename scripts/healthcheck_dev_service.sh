#!/bin/sh
set -eu

APP_DIR="/Users/timharris/.openclaw/workspace/projects/mission-control-app"
LOG_DIR="$APP_DIR/data"
PID_FILE="$LOG_DIR/mission-control-dev.pid"
PORT="${PORT:-3000}"
URL="http://127.0.0.1:${PORT}"
START_SCRIPT="$APP_DIR/scripts/start_dev_service.sh"

mkdir -p "$LOG_DIR"
cd "$APP_DIR"

is_healthy() {
  # Dual verification: API route AND page render.
  # Turbopack corruption can break page rendering while API routes still work.
  curl -sf --max-time 10 "$URL/api/mc/health" >/dev/null 2>&1 \
    && curl -sf --max-time 15 "$URL/NEV/inbox" >/dev/null 2>&1
}

# ── PID reconciliation ──
# If the PID file is stale or missing but the port has a listener,
# adopt the actual listener PID. This handles the case where the server
# was started outside managed scripts (e.g., by Claude or npm run dev).
reconcile_pid() {
  ACTUAL_PID="$(lsof -tiTCP:$PORT -sTCP:LISTEN 2>/dev/null || true)"

  if [ -f "$PID_FILE" ]; then
    FILE_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [ -n "$FILE_PID" ] && kill -0 "$FILE_PID" 2>/dev/null; then
      # PID file points to a live process — check if it matches port
      if [ -n "$ACTUAL_PID" ] && [ "$FILE_PID" != "$ACTUAL_PID" ]; then
        echo "[mc-dev] PID mismatch: file=$FILE_PID, port=$ACTUAL_PID — adopting port listener"
        echo "$ACTUAL_PID" > "$PID_FILE"
      fi
      return
    fi
    # PID file points to dead process
    rm -f "$PID_FILE"
  fi

  # No valid PID file — adopt port listener if present
  if [ -n "$ACTUAL_PID" ]; then
    echo "[mc-dev] adopting untracked listener PID $ACTUAL_PID"
    echo "$ACTUAL_PID" > "$PID_FILE"
  fi
}

reconcile_pid

if is_healthy; then
  echo "[mc-dev] healthy"
  exit 0
fi

echo "[mc-dev] unhealthy; attempting restart"

# Kill tracked PID if present
if [ -f "$PID_FILE" ]; then
  PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null || true
    sleep 2
    kill -9 "$PID" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
fi

# Kill anything still holding the port
LISTEN_PID="$(lsof -tiTCP:$PORT -sTCP:LISTEN 2>/dev/null || true)"
if [ -n "$LISTEN_PID" ]; then
  kill "$LISTEN_PID" 2>/dev/null || true
  sleep 2
  kill -9 "$LISTEN_PID" 2>/dev/null || true
fi

# NOTE: Previously used `pkill -f "node server.js"` here, which could
# kill the stable lane (:3001) too since both match that pattern.
# Removed: port-specific kill above is sufficient and safe.
sleep 1

# Clear corrupted Turbopack dev cache before restarting — this is the
# key step that prevents resurrecting a corrupted .next/dev state
if [ -d "$APP_DIR/.next/dev" ]; then
  echo "[mc-dev] clearing .next/dev cache to prevent corrupted state"
  rm -rf "$APP_DIR/.next/dev"
fi

exec "$START_SCRIPT"
