#!/bin/sh
set -eu

# ─── Stop the dev lane gracefully ───
APP_DIR="/Users/timharris/.openclaw/workspace/projects/mission-control-app"
LOG_DIR="$APP_DIR/data"
PID_FILE="$LOG_DIR/mission-control-dev.pid"
PORT="${PORT:-3000}"

stop_pid() {
  PID="$1"
  if kill -0 "$PID" 2>/dev/null; then
    echo "[mc-dev] sending SIGTERM to PID $PID"
    kill "$PID" 2>/dev/null || true
    i=0
    while [ "$i" -lt 10 ] && kill -0 "$PID" 2>/dev/null; do
      sleep 0.5
      i=$((i + 1))
    done
    if kill -0 "$PID" 2>/dev/null; then
      echo "[mc-dev] PID $PID did not exit; sending SIGKILL"
      kill -9 "$PID" 2>/dev/null || true
    fi
  fi
}

if [ -f "$PID_FILE" ]; then
  PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "$PID" ]; then
    stop_pid "$PID"
  fi
  rm -f "$PID_FILE"
fi

LISTEN_PID="$(lsof -tiTCP:$PORT -sTCP:LISTEN 2>/dev/null || true)"
if [ -n "$LISTEN_PID" ]; then
  echo "[mc-dev] killing orphaned listener PID $LISTEN_PID on port $PORT"
  stop_pid "$LISTEN_PID"
fi

echo "[mc-dev] stopped"
