#!/bin/sh
set -eu

# ─── Stop the dev lane gracefully ───
APP_DIR="/Users/timharris/.openclaw/workspace/projects/mission-control-app"
LOG_DIR="$APP_DIR/data"
PID_FILE="$LOG_DIR/mission-control-dev.pid"
PORT="${PORT:-3010}"
DOMAIN="gui/$(id -u)"
DEV_LABEL="com.harris-autonomous.mc-dev"
WATCHDOG_LABEL="com.harrisautonomous.mission-control-dev.watchdog"
DEV_TARGET="$DOMAIN/$DEV_LABEL"
WATCHDOG_TARGET="$DOMAIN/$WATCHDOG_LABEL"

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

launchctl bootout "$WATCHDOG_TARGET" >/dev/null 2>&1 || true
launchctl bootout "$DEV_TARGET" >/dev/null 2>&1 || true

LISTEN_PID="$(lsof -tiTCP:$PORT -sTCP:LISTEN 2>/dev/null || true)"
if [ -n "$LISTEN_PID" ]; then
  echo "[mc-dev] killing orphaned listener PID $LISTEN_PID on port $PORT"
  stop_pid "$LISTEN_PID"
fi

# ── Orphan cleanup ──
# Kill detached `node server.js` processes that aren't listening on any
# managed port (3010 dev, 3001 stable). These accumulate when a server
# crashes after binding but the PID file is never cleaned up.
STABLE_PORT=3001
STABLE_PID="$(lsof -tiTCP:$STABLE_PORT -sTCP:LISTEN 2>/dev/null || true)"
for ORPHAN in $(pgrep -f "node.*server\.js" 2>/dev/null || true); do
  # Skip stable lane
  [ -n "$STABLE_PID" ] && [ "$ORPHAN" = "$STABLE_PID" ] && continue
  # Skip if it's already our target (handled above)
  [ -n "${PID:-}" ] && [ "$ORPHAN" = "$PID" ] && continue
  [ -n "${LISTEN_PID:-}" ] && [ "$ORPHAN" = "$LISTEN_PID" ] && continue
  # Check if this process is on any port at all
  ORPHAN_PORT="$(lsof -p "$ORPHAN" -iTCP -sTCP:LISTEN 2>/dev/null | grep -c LISTEN || true)"
  if [ "$ORPHAN_PORT" = "0" ]; then
    echo "[mc-dev] killing orphan node process PID $ORPHAN (not bound to any port)"
    stop_pid "$ORPHAN"
  fi
done

if [ -f "$APP_DIR/.next/dev/lock" ]; then
  echo "[mc-dev] clearing stale next.js dev lockfile"
  rm -f "$APP_DIR/.next/dev/lock"
fi

echo "[mc-dev] stopped"
