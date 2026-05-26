#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
# shellcheck source=scripts/lib/runtime-paths.sh
. "$SCRIPT_DIR/lib/runtime-paths.sh"

APP_DIR="$(resolve_mc_app_root "$0")"
STABLE_DIR="$APP_DIR/.stable"
LOG_DIR="$(resolve_mc_log_dir "$APP_DIR")"
PID_FILE="$LOG_DIR/hiverunner-stable.pid"
FAILURE_FILE="$LOG_DIR/hiverunner-stable.health-failures"
PORT="${PORT:-3001}"
URL="http://127.0.0.1:${PORT}"
MAX_RSS_MB="${MAX_RSS_MB:-6144}"
MAX_CONSECUTIVE_FAILURES="${MAX_CONSECUTIVE_FAILURES:-12}"

mkdir -p "$LOG_DIR"

if [ ! -d "$STABLE_DIR/.next" ]; then
  echo "[hr-stable] no stable build present; skipping healthcheck"
  exit 0
fi

listener_pid() {
  lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -n 1 || true
}

reconcile_pid() {
  ACTUAL_PID="$(listener_pid)"
  if [ -f "$PID_FILE" ]; then
    FILE_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [ -n "$FILE_PID" ] && kill -0 "$FILE_PID" 2>/dev/null; then
      if [ -n "$ACTUAL_PID" ] && [ "$FILE_PID" != "$ACTUAL_PID" ]; then
        echo "[hr-stable] PID mismatch: file=$FILE_PID, port=$ACTUAL_PID — adopting port listener"
        echo "$ACTUAL_PID" > "$PID_FILE"
      fi
      return
    fi
    echo "[hr-stable] removing stale PID $FILE_PID"
    rm -f "$PID_FILE"
  fi

  if [ -n "$ACTUAL_PID" ]; then
    echo "[hr-stable] adopting untracked listener PID $ACTUAL_PID"
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
        echo "[hr-stable] unhealthy memory: PID $ACTUAL_PID RSS ${RSS_MB}MB exceeds ${MAX_RSS_MB}MB"
        return 1
      fi
    fi
  fi

  curl -sf --max-time 5 "$URL/api/hiverunner/health" >/dev/null 2>&1 ||
    curl -sf --max-time 5 "$URL/api/orchestration/companies" >/dev/null 2>&1
}

reconcile_pid

if is_healthy; then
  rm -f "$FAILURE_FILE"
  echo "[hr-stable] healthy"
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
    echo "[hr-stable] healthcheck failed for listener PID $ACTUAL_PID (${FAILURE_COUNT}/${MAX_CONSECUTIVE_FAILURES}); deferring restart"
    exit 0
  fi
fi

echo "[hr-stable] unhealthy; restarting script-managed stable lane"
rm -f "$FAILURE_FILE"
PORT="$PORT" "$APP_DIR/scripts/stop_stable_service.sh" >/dev/null 2>&1 || true
PORT="$PORT" "$APP_DIR/scripts/start_stable_service.sh"
