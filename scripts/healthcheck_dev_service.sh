#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
# shellcheck source=scripts/lib/runtime-paths.sh
. "$SCRIPT_DIR/lib/runtime-paths.sh"

APP_DIR="$(resolve_mc_app_root "$0")"
LOG_DIR="$(resolve_mc_log_dir "$APP_DIR")"
PID_FILE="$LOG_DIR/hiverunner-dev.pid"
FAILURE_FILE="$LOG_DIR/hiverunner-dev.health-failures"
PORT="${PORT:-3010}"
URL="http://127.0.0.1:${PORT}"

mkdir -p "$LOG_DIR"
cd "$APP_DIR"

BOOT_GRACE_SECS="${BOOT_GRACE_SECS:-90}"
MAX_RSS_MB="${MAX_RSS_MB:-6144}"
MAX_CONSECUTIVE_FAILURES="${MAX_CONSECUTIVE_FAILURES:-12}"

listener_pid() {
  lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -n 1 || true
}

in_boot_grace() {
  [ -f "$PID_FILE" ] || return 1
  FILE_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  [ -n "$FILE_PID" ] && kill -0 "$FILE_PID" 2>/dev/null || return 1

  PID_MTIME="$(stat -f %m "$PID_FILE" 2>/dev/null || echo 0)"
  NOW="$(date +%s)"
  AGE=$((NOW - PID_MTIME))
  [ "$AGE" -lt "$BOOT_GRACE_SECS" ]
}

reconcile_pid() {
  ACTUAL_PID="$(listener_pid)"
  if [ -f "$PID_FILE" ]; then
    FILE_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [ -n "$FILE_PID" ] && kill -0 "$FILE_PID" 2>/dev/null; then
      if [ -n "$ACTUAL_PID" ] && [ "$FILE_PID" != "$ACTUAL_PID" ]; then
        echo "[hr-dev] PID mismatch: file=$FILE_PID, port=$ACTUAL_PID — adopting port listener"
        echo "$ACTUAL_PID" > "$PID_FILE"
      fi
      return
    fi
    rm -f "$PID_FILE"
  fi

  if [ -n "$ACTUAL_PID" ]; then
    echo "[hr-dev] adopting untracked listener PID $ACTUAL_PID"
    echo "$ACTUAL_PID" > "$PID_FILE"
  fi
}

is_healthy() {
  ACTUAL_PID="$(listener_pid)"
  if [ -n "$ACTUAL_PID" ] && [ "$MAX_RSS_MB" -gt 0 ] 2>/dev/null; then
    RSS_KB="$(ps -o rss= -p "$ACTUAL_PID" 2>/dev/null | awk '{ print $1; exit }')"
    if [ -n "$RSS_KB" ]; then
      RSS_MB=$((RSS_KB / 1024))
      if [ "$RSS_MB" -gt "$MAX_RSS_MB" ]; then
        echo "[hr-dev] unhealthy memory: PID $ACTUAL_PID RSS ${RSS_MB}MB exceeds ${MAX_RSS_MB}MB"
        return 1
      fi
    fi
  fi

  curl -sf --max-time 10 "$URL/api/hiverunner/health" >/dev/null 2>&1 || return 1
  HTTP_CODE="$(curl -sf -o /dev/null -w '%{http_code}' --max-time 15 "$URL/" 2>/dev/null || echo "000")"
  [ "$HTTP_CODE" != "000" ]
}

reconcile_pid

if is_healthy; then
  rm -f "$FAILURE_FILE"
  echo "[hr-dev] healthy"
  exit 0
fi

ACTUAL_PID="$(listener_pid)"
if [ -n "$ACTUAL_PID" ]; then
  FAILURE_COUNT=0
  if [ -f "$FAILURE_FILE" ]; then
    FAILURE_COUNT="$(cat "$FAILURE_FILE" 2>/dev/null || echo 0)"
  fi
  case "$FAILURE_COUNT" in
    ''|*[!0-9]*) FAILURE_COUNT=0 ;;
  esac
  FAILURE_COUNT=$((FAILURE_COUNT + 1))
  echo "$FAILURE_COUNT" > "$FAILURE_FILE"

  if [ "$FAILURE_COUNT" -lt "$MAX_CONSECUTIVE_FAILURES" ]; then
    echo "[hr-dev] healthcheck failed for listener PID $ACTUAL_PID (${FAILURE_COUNT}/${MAX_CONSECUTIVE_FAILURES}); deferring restart"
    exit 0
  fi
fi

if in_boot_grace; then
  echo "[hr-dev] still booting (within ${BOOT_GRACE_SECS}s grace) — skipping restart"
  exit 0
fi

echo "[hr-dev] unhealthy; restarting script-managed dev lane"
rm -f "$FAILURE_FILE"

if [ -d "$APP_DIR/.next/dev" ]; then
  echo "[hr-dev] clearing .next/dev cache before restart"
  rm -rf "$APP_DIR/.next/dev"
fi

PORT="$PORT" "$APP_DIR/scripts/stop_dev_service.sh" >/dev/null 2>&1 || true
PORT="$PORT" "$APP_DIR/scripts/start_dev_service.sh"
