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

if [ -f "$PID_FILE" ]; then
  OLD_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "[mc-dev] already running on PID $OLD_PID"
    exit 0
  fi
  rm -f "$PID_FILE"
fi

if lsof -tiTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "[mc-dev] port $PORT already in use; refusing to start duplicate"
  exit 1
fi

if [ -f "$APP_DIR/.next/dev/lock" ]; then
  echo "[mc-dev] clearing stale next.js dev lockfile before start"
  rm -f "$APP_DIR/.next/dev/lock"
fi

echo "[mc-dev] starting Mission Control dev server on port $PORT"
nohup npm run dev >>"$OUT_LOG" 2>>"$ERR_LOG" &
PID=$!
echo "$PID" > "$PID_FILE"
echo "[mc-dev] started PID $PID"
