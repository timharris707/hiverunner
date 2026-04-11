#!/bin/sh
set -eu

# ─── Stop the stable lane gracefully ───
APP_DIR="/Users/timharris/.openclaw/workspace/projects/mission-control-app"
LOG_DIR="$APP_DIR/data"
PID_FILE="$LOG_DIR/mission-control-stable.pid"
PORT="${PORT:-3001}"
DOMAIN="gui/$(id -u)"
STABLE_LABEL="com.harris-autonomous.mc-stable"
WATCHDOG_LABEL="com.harrisautonomous.mission-control-stable.watchdog"
STABLE_TARGET="$DOMAIN/$STABLE_LABEL"
WATCHDOG_TARGET="$DOMAIN/$WATCHDOG_LABEL"

stop_pid() {
  PID="$1"
  if kill -0 "$PID" 2>/dev/null; then
    echo "[mc-stable] sending SIGTERM to PID $PID"
    kill "$PID" 2>/dev/null || true
    # Wait up to 5s for graceful shutdown
    i=0
    while [ "$i" -lt 10 ] && kill -0 "$PID" 2>/dev/null; do
      sleep 0.5
      i=$((i + 1))
    done
    if kill -0 "$PID" 2>/dev/null; then
      echo "[mc-stable] PID $PID did not exit; sending SIGKILL"
      kill -9 "$PID" 2>/dev/null || true
    fi
  fi
}

# ── Stop via PID file ──
if [ -f "$PID_FILE" ]; then
  PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "$PID" ]; then
    stop_pid "$PID"
  fi
  rm -f "$PID_FILE"
fi

launchctl bootout "$WATCHDOG_TARGET" >/dev/null 2>&1 || true
launchctl bootout "$STABLE_TARGET" >/dev/null 2>&1 || true

# ── Catch orphaned listener on the port ──
LISTEN_PID="$(lsof -tiTCP:$PORT -sTCP:LISTEN 2>/dev/null || true)"
if [ -n "$LISTEN_PID" ]; then
  echo "[mc-stable] killing orphaned listener PID $LISTEN_PID on port $PORT"
  stop_pid "$LISTEN_PID"
fi

echo "[mc-stable] stopped"
