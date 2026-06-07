#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
# shellcheck source=scripts/lib/runtime-paths.sh
. "$SCRIPT_DIR/lib/runtime-paths.sh"

APP_DIR="$(resolve_mc_app_root "$0")"
MC_SERVICE_ID="${MC_SERVICE_ID:-dev}"
SERVICE_LABEL="hr-$MC_SERVICE_ID"
SERVICE_FILE_PREFIX="hiverunner-$MC_SERVICE_ID"
case "$MC_SERVICE_ID" in
  exec-dev)
    DEFAULT_PORT=3020
    DEFAULT_LOG_DIR="$APP_DIR/data-exec-dev/logs"
    SERVICE_TITLE="HiveRunner Exec Dev Start"
    ;;
  *)
    DEFAULT_PORT=3010
    DEFAULT_LOG_DIR="$(resolve_mc_log_dir "$APP_DIR")"
    SERVICE_TITLE="HiveRunner Dev Start"
    ;;
esac
LOG_DIR="${MC_LOG_DIR:-$DEFAULT_LOG_DIR}"
PID_FILE="$LOG_DIR/$SERVICE_FILE_PREFIX.pid"
LOG_FILE="$LOG_DIR/$SERVICE_FILE_PREFIX.log"
PORT="${PORT:-$DEFAULT_PORT}"
URL="http://127.0.0.1:${PORT}"

mkdir -p "$LOG_DIR"
cd "$APP_DIR"

listener_pids() {
  lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true
}

is_healthy() {
  curl -sf --max-time 10 "$URL/api/hiverunner/health" >/dev/null 2>&1 ||
    curl -sf --max-time 10 "$URL/api/health" >/dev/null 2>&1
}

stop_pid() {
  PID="$1"
  if kill -0 "$PID" 2>/dev/null; then
    echo "[$SERVICE_LABEL] sending SIGTERM to PID $PID"
    kill "$PID" 2>/dev/null || true
    i=0
    while [ "$i" -lt 20 ] && kill -0 "$PID" 2>/dev/null; do
      sleep 0.5
      i=$((i + 1))
    done
    if kill -0 "$PID" 2>/dev/null; then
      echo "[$SERVICE_LABEL] PID $PID did not exit; sending SIGKILL"
      kill -9 "$PID" 2>/dev/null || true
    fi
  fi
}

echo ""
echo "=== $SERVICE_TITLE ==="
echo "  Time:   $(date '+%Y-%m-%d %H:%M:%S')"
echo "  Port:   $PORT"
echo "  Mode:   development"
echo "  Dir:    $APP_DIR"
echo "  Logs:   $LOG_FILE"

EXISTING_PIDS="$(listener_pids)"
if [ -n "$EXISTING_PIDS" ]; then
  if is_healthy; then
    ACTUAL_PID="$(printf '%s\n' "$EXISTING_PIDS" | head -n 1)"
    echo "$ACTUAL_PID" > "$PID_FILE"
    echo "[$SERVICE_LABEL] already healthy on PID $ACTUAL_PID"
    exit 0
  fi

  echo "[$SERVICE_LABEL] replacing unhealthy listener(s) on port $PORT: $(printf '%s' "$EXISTING_PIDS" | tr '\n' ' ')"
  for PID in $EXISTING_PIDS; do
    stop_pid "$PID"
  done
  rm -f "$PID_FILE"
fi

if [ "$PORT" = "3010" ] && [ -f "$APP_DIR/.next/dev/lock" ]; then
  echo "[$SERVICE_LABEL] clearing stale Next.js dev lockfile"
  rm -f "$APP_DIR/.next/dev/lock"
fi

echo "[$SERVICE_LABEL] starting background dev service"
HIVERUNNER_MANAGED_START=1 MC_SERVICE_ID="$MC_SERVICE_ID" MC_LOG_DIR="$LOG_DIR" PORT="$PORT" nohup /bin/sh "$APP_DIR/scripts/run_dev_service.sh" >> "$LOG_FILE" 2>&1 &
STARTER_PID="$!"
echo "$STARTER_PID" > "$PID_FILE"

i=0
while [ "$i" -lt 60 ]; do
  if is_healthy; then
    ACTUAL_PID="$(listener_pids | head -n 1)"
    if [ -n "$ACTUAL_PID" ]; then
      echo "$ACTUAL_PID" > "$PID_FILE"
    fi
    echo "[$SERVICE_LABEL] healthy on PID ${ACTUAL_PID:-$STARTER_PID}"
    echo "[$SERVICE_LABEL] logs: tail -f $LOG_FILE"
    exit 0
  fi

  if ! kill -0 "$STARTER_PID" 2>/dev/null && [ -z "$(listener_pids)" ]; then
    echo "[$SERVICE_LABEL] service exited before becoming healthy"
    tail -n 80 "$LOG_FILE" 2>/dev/null || true
    exit 1
  fi

  sleep 2
  i=$((i + 1))
done

echo "[$SERVICE_LABEL] WARNING: service did not report healthy within 120s"
tail -n 80 "$LOG_FILE" 2>/dev/null || true
exit 1
