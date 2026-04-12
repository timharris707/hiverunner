#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
# shellcheck source=scripts/lib/runtime-paths.sh
. "$SCRIPT_DIR/lib/runtime-paths.sh"

APP_DIR="$(resolve_mc_app_root "$0")"
LOG_DIR="$(resolve_mc_log_dir "$APP_DIR")"
PID_FILE="$LOG_DIR/mission-control-dev.pid"
PORT="${PORT:-3010}"
DOMAIN="gui/$(id -u)"
DEV_LABEL="com.harris-autonomous.mc-dev"
WATCHDOG_LABEL="com.harrisautonomous.mission-control-dev.watchdog"
DEV_TARGET="$DOMAIN/$DEV_LABEL"
WATCHDOG_TARGET="$DOMAIN/$WATCHDOG_LABEL"
DEV_PLIST="$APP_DIR/config/com.harris-autonomous.mc-dev.plist"
WATCHDOG_PLIST="$APP_DIR/config/com.harrisautonomous.mission-control-dev.watchdog.plist"

mkdir -p "$LOG_DIR"
cd "$APP_DIR"

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
  launchctl print "$DEV_TARGET" 2>/dev/null | awk '/^[[:space:]]*pid = / { print $3; exit }'
}

listener_pid() {
  lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true
}

# ── Boot diagnostic banner ──
echo ""
echo "=== Mission Control Dev Start ==="
echo "  Time:   $(date '+%Y-%m-%d %H:%M:%S')"
echo "  Port:   $PORT"
echo "  Mode:   development"
echo "  Dir:    $APP_DIR"
bootstrap_if_needed "$DEV_TARGET" "$DEV_PLIST"
bootstrap_if_needed "$WATCHDOG_TARGET" "$WATCHDOG_PLIST"

SERVICE_PID="$(service_pid || true)"
EXISTING_PID="$(listener_pid)"
if [ -n "$EXISTING_PID" ] && [ "$EXISTING_PID" != "$SERVICE_PID" ]; then
  echo "  Note:   replacing unmanaged listener PID $EXISTING_PID with launchd-owned dev service"
  kill "$EXISTING_PID" 2>/dev/null || true
  sleep 2
  kill -9 "$EXISTING_PID" 2>/dev/null || true
  rm -f "$PID_FILE"
fi

launchctl kickstart "$DEV_TARGET"
launchctl kickstart "$WATCHDOG_TARGET" >/dev/null 2>&1 || true

echo "================================"
echo "[mc-dev] ensuring launchd-owned dev server on port $PORT"

i=0
while [ "$i" -lt 45 ]; do
  if curl -sf --max-time 5 "http://127.0.0.1:${PORT}/api/mc/health" >/dev/null 2>&1; then
    ACTUAL_PID="$(listener_pid)"
    echo "[mc-dev] healthy on PID ${ACTUAL_PID:-unknown}"
    echo "[mc-dev] logs: tail -f $LOG_DIR/mission-control-dev.log"
    exit 0
  fi
  sleep 2
  i=$((i + 1))
done

echo "[mc-dev] WARNING: service did not report healthy within 90s"
