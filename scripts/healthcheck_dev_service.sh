#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
# shellcheck source=scripts/lib/runtime-paths.sh
. "$SCRIPT_DIR/lib/runtime-paths.sh"

APP_DIR="$(resolve_mc_app_root "$0")"
LOG_DIR="$(resolve_mc_log_dir "$APP_DIR")"
PID_FILE="$LOG_DIR/mission-control-dev.pid"
PORT="${PORT:-3010}"
URL="http://127.0.0.1:${PORT}"
DOMAIN="gui/$(id -u)"
DEV_LABEL="com.harris-autonomous.mc-dev"
DEV_TARGET="$DOMAIN/$DEV_LABEL"
DEV_PLIST="$APP_DIR/config/com.harris-autonomous.mc-dev.plist"

mkdir -p "$LOG_DIR"
cd "$APP_DIR"

# ── Boot grace period ──
# Webpack cold-start compilation takes 30–60 seconds. The watchdog runs
# every 15 seconds. Without a grace period the watchdog kills the server
# before it finishes compiling, creating a restart loop.
BOOT_GRACE_SECS="${BOOT_GRACE_SECS:-90}"

in_boot_grace() {
  # If the PID file was written recently, the server is still booting.
  [ -f "$PID_FILE" ] || return 1
  FILE_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  [ -n "$FILE_PID" ] && kill -0 "$FILE_PID" 2>/dev/null || return 1

  # macOS stat -f %m returns mtime as epoch seconds
  PID_MTIME="$(stat -f %m "$PID_FILE" 2>/dev/null || echo 0)"
  NOW="$(date +%s)"
  AGE=$(( NOW - PID_MTIME ))
  [ "$AGE" -lt "$BOOT_GRACE_SECS" ]
}

launchd_loaded() {
  launchctl print "$1" >/dev/null 2>&1
}

ensure_service_loaded() {
  if ! launchd_loaded "$DEV_TARGET"; then
    launchctl bootstrap "$DOMAIN" "$DEV_PLIST"
  fi
}

service_pid() {
  launchctl print "$DEV_TARGET" 2>/dev/null | awk '/^[[:space:]]*pid = / { print $3; exit }'
}

is_healthy() {
  # Two-tier health check:
  #   1. API health (fast, works even during recompilation)
  #   2. Page-level check (verifies the server actually serves HTML,
  #      catches the "API up but page hangs" failure mode)
  curl -sf --max-time 10 "$URL/api/mc/health" >/dev/null 2>&1 || return 1

  # Page check — only required after boot grace. During compilation the
  # API may respond while pages are still compiling; that's expected.
  # A 15s timeout catches the "page hangs indefinitely" symptom.
  HTTP_CODE="$(curl -sf -o /dev/null -w '%{http_code}' --max-time 15 "$URL/" 2>/dev/null || echo "000")"
  [ "$HTTP_CODE" != "000" ]
}

# ── PID reconciliation ──
# If the PID file is stale or missing but the port has a listener,
# adopt the actual listener PID. This handles the case where the server
# was started outside managed scripts (e.g., by Claude or npm run dev).
reconcile_pid() {
  ACTUAL_PID="$(lsof -tiTCP:$PORT -sTCP:LISTEN 2>/dev/null || true)"
  SERVICE_PID="$(service_pid || true)"

  if [ -n "$ACTUAL_PID" ] && [ -n "$SERVICE_PID" ] && [ "$ACTUAL_PID" != "$SERVICE_PID" ]; then
    echo "[mc-dev] listener PID $ACTUAL_PID is not launchd-owned service PID $SERVICE_PID"
    return
  fi

  if [ -f "$PID_FILE" ]; then
    FILE_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [ -n "$FILE_PID" ] && kill -0 "$FILE_PID" 2>/dev/null; then
      # PID file points to a live process — check if it matches port
      if [ -n "$ACTUAL_PID" ] && [ "$FILE_PID" != "$ACTUAL_PID" ]; then
        echo "[mc-dev] PID mismatch: file=$FILE_PID, port=$ACTUAL_PID — adopting port listener"
        echo "$ACTUAL_PID" > "$PID_FILE"
      fi
      return
    fi
    # PID file points to dead process
    rm -f "$PID_FILE"
  fi

  # No valid PID file — adopt port listener if present
  if [ -n "$ACTUAL_PID" ]; then
    echo "[mc-dev] adopting untracked listener PID $ACTUAL_PID"
    echo "$ACTUAL_PID" > "$PID_FILE"
  fi
}

ensure_service_loaded
reconcile_pid

ACTUAL_PID="$(lsof -tiTCP:$PORT -sTCP:LISTEN 2>/dev/null || true)"
SERVICE_PID="$(service_pid || true)"
if [ -n "$ACTUAL_PID" ] && [ -n "$SERVICE_PID" ] && [ "$ACTUAL_PID" != "$SERVICE_PID" ]; then
  echo "[mc-dev] unhealthy ownership; replacing unmanaged listener PID $ACTUAL_PID"
elif is_healthy; then
  echo "[mc-dev] healthy"
  exit 0
fi

if in_boot_grace; then
  echo "[mc-dev] still booting (within ${BOOT_GRACE_SECS}s grace) — skipping restart"
  exit 0
fi

echo "[mc-dev] unhealthy; attempting restart"

# Kill tracked PID if present
if [ -f "$PID_FILE" ]; then
  PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null || true
    sleep 2
    kill -9 "$PID" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
fi

# Kill anything still holding the port
LISTEN_PID="$(lsof -tiTCP:$PORT -sTCP:LISTEN 2>/dev/null || true)"
if [ -n "$LISTEN_PID" ]; then
  kill "$LISTEN_PID" 2>/dev/null || true
  sleep 2
  kill -9 "$LISTEN_PID" 2>/dev/null || true
fi

# Clear corrupted Turbopack dev cache before restarting — this is the
# key step that prevents resurrecting a corrupted .next/dev state
if [ -d "$APP_DIR/.next/dev" ]; then
  echo "[mc-dev] clearing .next/dev cache to prevent corrupted state"
  rm -rf "$APP_DIR/.next/dev"
fi

ensure_service_loaded
launchctl kickstart -k "$DEV_TARGET"
exit 0
