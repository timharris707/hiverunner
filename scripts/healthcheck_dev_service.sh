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
  curl -sf "$URL/api/orchestration/companies" >/dev/null 2>&1
}

cleanup_pid_if_stale() {
  if [ -f "$PID_FILE" ]; then
    PID="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [ -n "$PID" ] && ! kill -0 "$PID" 2>/dev/null; then
      rm -f "$PID_FILE"
    fi
  fi
}

cleanup_pid_if_stale

if is_healthy; then
  echo "[mc-dev] healthy"
  exit 0
fi

echo "[mc-dev] unhealthy; attempting restart"

if [ -f "$PID_FILE" ]; then
  PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null || true
    sleep 2
    kill -9 "$PID" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
fi

LISTEN_PID="$(lsof -tiTCP:$PORT -sTCP:LISTEN 2>/dev/null || true)"
if [ -n "$LISTEN_PID" ]; then
  kill "$LISTEN_PID" 2>/dev/null || true
  sleep 2
  kill -9 "$LISTEN_PID" 2>/dev/null || true
fi

exec "$START_SCRIPT"
