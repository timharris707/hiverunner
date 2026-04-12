#!/bin/sh
set -eu

# ─── Stable lane watchdog (called periodically by launchd) ───
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
# shellcheck source=scripts/lib/runtime-paths.sh
. "$SCRIPT_DIR/lib/runtime-paths.sh"

APP_DIR="$(resolve_mc_app_root "$0")"
STABLE_DIR="$APP_DIR/.stable"
LOG_DIR="$(resolve_mc_log_dir "$APP_DIR")"
PID_FILE="$LOG_DIR/mission-control-stable.pid"
PORT="${PORT:-3001}"
URL="http://127.0.0.1:${PORT}"
DOMAIN="gui/$(id -u)"
STABLE_LABEL="com.harris-autonomous.mc-stable"
STABLE_TARGET="$DOMAIN/$STABLE_LABEL"
STABLE_PLIST="$APP_DIR/config/com.harris-autonomous.mc-stable.plist"

mkdir -p "$LOG_DIR"

# ── Skip if no stable build exists (not promoted yet) ──
if [ ! -d "$STABLE_DIR/.next" ]; then
  echo "[mc-stable] no stable build present; skipping healthcheck"
  exit 0
fi

launchd_loaded() {
  launchctl print "$1" >/dev/null 2>&1
}

ensure_service_loaded() {
  if ! launchd_loaded "$STABLE_TARGET"; then
    launchctl bootstrap "$DOMAIN" "$STABLE_PLIST"
  fi
}

service_pid() {
  launchctl print "$STABLE_TARGET" 2>/dev/null | awk '/^[[:space:]]*pid = / { print $3; exit }'
}

is_healthy() {
  curl -sf --max-time 5 "$URL/api/mc/health" >/dev/null 2>&1 \
    || curl -sf --max-time 5 "$URL/api/orchestration/companies" >/dev/null 2>&1
}

# ── PID reconciliation ──
reconcile_pid() {
  ACTUAL_PID="$(lsof -tiTCP:$PORT -sTCP:LISTEN 2>/dev/null || true)"
  SERVICE_PID="$(service_pid || true)"

  if [ -n "$ACTUAL_PID" ] && [ -n "$SERVICE_PID" ] && [ "$ACTUAL_PID" != "$SERVICE_PID" ]; then
    echo "[mc-stable] listener PID $ACTUAL_PID is not launchd-owned service PID $SERVICE_PID"
    return
  fi

  if [ -f "$PID_FILE" ]; then
    FILE_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [ -n "$FILE_PID" ] && kill -0 "$FILE_PID" 2>/dev/null; then
      if [ -n "$ACTUAL_PID" ] && [ "$FILE_PID" != "$ACTUAL_PID" ]; then
        echo "[mc-stable] PID mismatch: file=$FILE_PID, port=$ACTUAL_PID — adopting port listener"
        echo "$ACTUAL_PID" > "$PID_FILE"
      fi
      return
    fi
    echo "[mc-stable] removing stale PID $FILE_PID"
    rm -f "$PID_FILE"
  fi

  if [ -n "$ACTUAL_PID" ]; then
    echo "[mc-stable] adopting untracked listener PID $ACTUAL_PID"
    echo "$ACTUAL_PID" > "$PID_FILE"
  fi
}

ensure_service_loaded
reconcile_pid

ACTUAL_PID="$(lsof -tiTCP:$PORT -sTCP:LISTEN 2>/dev/null || true)"
SERVICE_PID="$(service_pid || true)"
if [ -n "$ACTUAL_PID" ] && [ -n "$SERVICE_PID" ] && [ "$ACTUAL_PID" != "$SERVICE_PID" ]; then
  echo "[mc-stable] unhealthy ownership; replacing unmanaged listener PID $ACTUAL_PID"
elif is_healthy; then
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

ensure_service_loaded
launchctl kickstart -k "$STABLE_TARGET"
exit 0
