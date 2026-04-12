#!/bin/sh
set -eu

# ─── Stable lane: runs a production build on port 3001 ───
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
# shellcheck source=scripts/lib/runtime-paths.sh
. "$SCRIPT_DIR/lib/runtime-paths.sh"

APP_DIR="$(resolve_mc_app_root "$0")"
STABLE_DIR="$APP_DIR/.stable"
LOG_DIR="$(resolve_mc_log_dir "$APP_DIR")"
PID_FILE="$LOG_DIR/mission-control-stable.pid"
PORT="${PORT:-3001}"
DOMAIN="gui/$(id -u)"
STABLE_LABEL="com.harris-autonomous.mc-stable"
WATCHDOG_LABEL="com.harrisautonomous.mission-control-stable.watchdog"
STABLE_TARGET="$DOMAIN/$STABLE_LABEL"
WATCHDOG_TARGET="$DOMAIN/$WATCHDOG_LABEL"
STABLE_PLIST="$APP_DIR/config/com.harris-autonomous.mc-stable.plist"
WATCHDOG_PLIST="$APP_DIR/config/com.harrisautonomous.mission-control-stable.watchdog.plist"

mkdir -p "$LOG_DIR"

# ── Pre-flight: stable build must exist ──
if [ ! -d "$STABLE_DIR/.next" ]; then
  echo "[mc-stable] ERROR: no production build found in $STABLE_DIR/.next"
  echo "[mc-stable] Run scripts/promote_to_stable.sh first."
  exit 1
fi

cd "$STABLE_DIR"

launchd_loaded() {
  launchctl print "$1" >/dev/null 2>&1
}

bootstrap_if_needed() {
  TARGET="$1"
  PLIST="$2"
  if ! launchd_loaded "$TARGET"; then
    launchctl bootstrap "$DOMAIN" "$PLIST"
  fi
}

service_pid() {
  launchctl print "$STABLE_TARGET" 2>/dev/null | awk '/^[[:space:]]*pid = / { print $3; exit }'
}

listener_pid() {
  lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true
}

bootstrap_if_needed "$STABLE_TARGET" "$STABLE_PLIST"
bootstrap_if_needed "$WATCHDOG_TARGET" "$WATCHDOG_PLIST"

SERVICE_PID="$(service_pid || true)"
EXISTING_PID="$(listener_pid)"
if [ -n "$EXISTING_PID" ] && [ "$EXISTING_PID" != "$SERVICE_PID" ]; then
  echo "[mc-stable] replacing unmanaged listener PID $EXISTING_PID with launchd-owned stable service"
  kill "$EXISTING_PID" 2>/dev/null || true
  sleep 2
  kill -9 "$EXISTING_PID" 2>/dev/null || true
  rm -f "$PID_FILE"
fi

launchctl kickstart "$STABLE_TARGET"
launchctl kickstart "$WATCHDOG_TARGET" >/dev/null 2>&1 || true

echo "[mc-stable] ensuring launchd-owned stable server on port $PORT"
i=0
while [ "$i" -lt 45 ]; do
  if curl -sf --max-time 5 "http://127.0.0.1:${PORT}/api/mc/health" >/dev/null 2>&1; then
    ACTUAL_PID="$(listener_pid)"
    echo "[mc-stable] healthy on PID ${ACTUAL_PID:-unknown}"
    exit 0
  fi
  sleep 2
  i=$((i + 1))
done

echo "[mc-stable] WARNING: service did not report healthy within 90s"
