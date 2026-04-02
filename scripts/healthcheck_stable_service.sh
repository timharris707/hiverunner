#!/bin/sh
set -eu

# ─── Stable lane watchdog (called periodically by launchd) ───
APP_DIR="/Users/timharris/.openclaw/workspace/projects/mission-control-app"
STABLE_DIR="$APP_DIR/.stable"
LOG_DIR="$APP_DIR/data"
PID_FILE="$LOG_DIR/mission-control-stable.pid"
PORT="${PORT:-3001}"
URL="http://127.0.0.1:${PORT}"
START_SCRIPT="$APP_DIR/scripts/start_stable_service.sh"

mkdir -p "$LOG_DIR"

# ── Skip if no stable build exists (not promoted yet) ──
if [ ! -d "$STABLE_DIR/.next" ]; then
  echo "[mc-stable] no stable build present; skipping healthcheck"
  exit 0
fi

is_healthy() {
  curl -sf --max-time 5 "$URL/api/orchestration/companies" >/dev/null 2>&1
}

cleanup_pid_if_stale() {
  if [ -f "$PID_FILE" ]; then
    PID="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [ -n "$PID" ] && ! kill -0 "$PID" 2>/dev/null; then
      echo "[mc-stable] removing stale PID $PID"
      rm -f "$PID_FILE"
    fi
  fi
}

cleanup_pid_if_stale

if is_healthy; then
  echo "[mc-stable] healthy"
  exit 0
fi

echo "[mc-stable] unhealthy; attempting restart"

# ── Kill existing process ──
if [ -f "$PID_FILE" ]; then
  PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null || true
    sleep 2
    kill -9 "$PID" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
fi

# ── Kill orphaned port listener ──
LISTEN_PID="$(lsof -tiTCP:$PORT -sTCP:LISTEN 2>/dev/null || true)"
if [ -n "$LISTEN_PID" ]; then
  kill "$LISTEN_PID" 2>/dev/null || true
  sleep 2
  kill -9 "$LISTEN_PID" 2>/dev/null || true
fi

exec "$START_SCRIPT"
