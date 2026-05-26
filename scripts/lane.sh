#!/bin/sh
set -eu

# ─── Unified lane management CLI ───
# Usage: scripts/lane.sh <lane> <action>
#   lane:   dev | stable
#   action: start | stop | restart | status | logs | rollback

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
# shellcheck source=scripts/lib/runtime-paths.sh
. "$SCRIPT_DIR/lib/runtime-paths.sh"

APP_DIR="$(resolve_mc_app_root "$0")"
LOG_DIR="$(resolve_mc_log_dir "$APP_DIR")"

usage() {
  echo "Usage: $0 <dev|stable> <start|stop|restart|status|logs|rollback>"
  echo "       $0 promote   (build + deploy to stable lane)"
  echo "       $0 rollback  (restore stable to previous promoted checkpoint)"
  echo "       $0 doctor    (diagnose both lanes, PIDs, health)"
  echo ""
  echo "Examples:"
  echo "  $0 dev start       Start dev server on port 3010"
  echo "  $0 stable restart  Restart stable server on port 3001"
  echo "  $0 stable status   Check if stable lane is running"
  echo "  $0 stable logs     Tail stable lane logs"
  echo "  $0 promote         Build and promote to stable"
  echo "  $0 rollback        Roll back stable to previous checkpoint"
  echo "  $0 doctor          Full runtime health diagnostic"
  echo "  $0 doctor --fix    Diagnostic + auto-fix stale PIDs"
  exit 1
}

[ $# -lt 1 ] && usage

LANE="$1"
ACTION="${2:-}"

# Shortcut commands.
if [ "$LANE" = "promote" ]; then
  shift
  exec "$APP_DIR/scripts/promote_to_stable.sh" "$@"
fi
if [ "$LANE" = "rollback" ]; then
  shift
  exec "$APP_DIR/scripts/rollback_stable.sh" "$@"
fi
if [ "$LANE" = "doctor" ]; then
  shift
  exec "$APP_DIR/scripts/doctor.sh" "$@"
fi

[ -z "$ACTION" ] && usage

case "$LANE" in
  dev)
    PORT=3010
    PID_FILE="$LOG_DIR/hiverunner-dev.pid"
    LOG_FILE="$LOG_DIR/hiverunner-dev.log"
    START_SCRIPT="$APP_DIR/scripts/start_dev_service.sh"
    STOP_SCRIPT="$APP_DIR/scripts/stop_dev_service.sh"
    ;;
  stable)
    PORT=3001
    PID_FILE="$LOG_DIR/hiverunner-stable.pid"
    LOG_FILE="$LOG_DIR/hiverunner-stable.log"
    START_SCRIPT="$APP_DIR/scripts/start_stable_service.sh"
    STOP_SCRIPT="$APP_DIR/scripts/stop_stable_service.sh"
    ;;
  *)
    echo "Unknown lane: $LANE (must be dev or stable)"
    exit 1
    ;;
esac

case "$ACTION" in
  start)
    PORT="$PORT" exec "$START_SCRIPT"
    ;;
  stop)
    PORT="$PORT" exec "$STOP_SCRIPT"
    ;;
  restart)
    PORT="$PORT" "$STOP_SCRIPT" 2>/dev/null || true
    sleep 1
    PORT="$PORT" exec "$START_SCRIPT"
    ;;
  status)
    PID=""
    if [ -f "$PID_FILE" ]; then
      FILE_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
      if [ -n "$FILE_PID" ] && kill -0 "$FILE_PID" 2>/dev/null; then
        PID="$FILE_PID"
      fi
    fi
    PORT_PID="$(lsof -tiTCP:$PORT -sTCP:LISTEN 2>/dev/null | head -n 1 || true)"
    if [ -z "$PID" ] && [ -n "$PORT_PID" ]; then
      PID="$PORT_PID"
      echo "$PID" > "$PID_FILE" 2>/dev/null || true
    fi
    if [ -n "$PID" ]; then
      echo "[$LANE] running (PID $PID, port $PORT)"
      if curl -sf --max-time 15 "http://127.0.0.1:$PORT/api/hiverunner/health" >/dev/null 2>&1 ||
         curl -sf --max-time 15 "http://127.0.0.1:$PORT/api/orchestration/companies" >/dev/null 2>&1; then
        echo "[$LANE] health: OK"
      else
        echo "[$LANE] health: UNHEALTHY (process alive but not responding)"
      fi
      exit 0
    fi
    echo "[$LANE] not running"
    exit 1
    ;;
  logs)
    if [ -f "$LOG_FILE" ]; then
      tail -f "$LOG_FILE"
    else
      echo "No log file found at $LOG_FILE"
      exit 1
    fi
    ;;
  rollback)
    if [ "$LANE" != "stable" ]; then
      echo "Rollback is only supported for the stable lane."
      exit 1
    fi
    shift 2
    exec "$APP_DIR/scripts/rollback_stable.sh" "$@"
    ;;
  *)
    echo "Unknown action: $ACTION"
    usage
    ;;
esac
