#!/bin/sh
set -eu

# ─── Stop the dev lane gracefully ───
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
# shellcheck source=scripts/lib/runtime-paths.sh
. "$SCRIPT_DIR/lib/runtime-paths.sh"

APP_DIR="$(resolve_mc_app_root "$0")"
LOG_DIR="$(resolve_mc_log_dir "$APP_DIR")"
PID_FILE="$LOG_DIR/hiverunner-dev.pid"
PORT="${PORT:-3010}"
FAILURE_FILE="$LOG_DIR/hiverunner-dev.health-failures"

stop_pid() {
  PID="$1"
  if kill -0 "$PID" 2>/dev/null; then
    echo "[hr-dev] sending SIGTERM to PID $PID"
    kill "$PID" 2>/dev/null || true
    i=0
    while [ "$i" -lt 10 ] && kill -0 "$PID" 2>/dev/null; do
      sleep 0.5
      i=$((i + 1))
    done
    if kill -0 "$PID" 2>/dev/null; then
      echo "[hr-dev] PID $PID did not exit; sending SIGKILL"
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
  echo "[hr-dev] killing orphaned listener PID $LISTEN_PID on port $PORT"
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
    echo "[hr-dev] killing orphan node process PID $ORPHAN (not bound to any port)"
    stop_pid "$ORPHAN"
  fi
done

if [ -f "$APP_DIR/.next/dev/lock" ]; then
  echo "[hr-dev] clearing stale next.js dev lockfile"
  rm -f "$APP_DIR/.next/dev/lock"
fi

rm -f "$FAILURE_FILE"

echo "[hr-dev] stopped"
