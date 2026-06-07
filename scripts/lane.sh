#!/bin/sh
set -eu

# ─── Unified lane management CLI ───
# Usage: scripts/lane.sh <lane> <action>
#   lane:   dev | exec-dev | stable
#   action: start | stop | restart | status | logs | rollback

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
# shellcheck source=scripts/lib/runtime-paths.sh
. "$SCRIPT_DIR/lib/runtime-paths.sh"

APP_DIR="$(resolve_mc_app_root "$0")"
LOG_DIR="$(resolve_mc_log_dir "$APP_DIR")"

usage() {
  echo "Usage: $0 <dev|exec-dev|stable> <start|stop|restart|status|logs|rollback>"
  echo "       $0 <dev|exec-dev|stable> logs watchdog"
  echo "       $0 promote   (build + deploy to stable lane)"
  echo "       $0 rollback  (restore stable to previous promoted checkpoint)"
  echo "       $0 doctor    (diagnose both lanes, PIDs, health)"
  echo ""
  echo "Examples:"
  echo "  $0 dev start       Start observer dev server on port 3010"
  echo "  $0 exec-dev start  Start execution dev server on port 3020"
  echo "  $0 stable restart  Restart stable server on port 3001"
  echo "  $0 stable status   Check if stable lane is running"
  echo "  $0 stable logs     Tail stable lane logs"
  echo "  $0 dev logs watchdog Tail dev watchdog logs"
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
    MC_SERVICE_ID=dev
    PID_FILE="$LOG_DIR/hiverunner-dev.pid"
    LOG_FILE="$LOG_DIR/hiverunner-dev.log"
    FAILURE_FILE="$LOG_DIR/hiverunner-dev.health-failures"
    WATCHDOG_OUT_LOG="$LOG_DIR/hr-dev-watchdog.out.log"
    WATCHDOG_ERR_LOG="$LOG_DIR/hr-dev-watchdog.err.log"
    START_SCRIPT="$APP_DIR/scripts/start_dev_service.sh"
    STOP_SCRIPT="$APP_DIR/scripts/stop_dev_service.sh"
    ;;
  exec-dev)
    PORT="${PORT:-3020}"
    MC_SERVICE_ID=exec-dev
    MC_DATA_DIR="${MC_DATA_DIR:-$APP_DIR/data-exec-dev}"
    MC_WORKSPACE_ROOT="${MC_WORKSPACE_ROOT:-${HOME:-}/.hiverunner/exec-dev/workspaces}"
    MC_LOG_DIR="${MC_LOG_DIR:-$APP_DIR/data-exec-dev/logs}"
    MC_ENGINE_TICK="${MC_ENGINE_TICK:-on}"
    MC_DEV_EXECUTION_TEST_MODE="${MC_DEV_EXECUTION_TEST_MODE:-0}"
    LOG_DIR="$MC_LOG_DIR"
    PID_FILE="$LOG_DIR/hiverunner-exec-dev.pid"
    LOG_FILE="$LOG_DIR/hiverunner-exec-dev.log"
    FAILURE_FILE="$LOG_DIR/hiverunner-exec-dev.health-failures"
    WATCHDOG_OUT_LOG="$LOG_DIR/hr-exec-dev-watchdog.out.log"
    WATCHDOG_ERR_LOG="$LOG_DIR/hr-exec-dev-watchdog.err.log"
    START_SCRIPT="$APP_DIR/scripts/start_dev_service.sh"
    STOP_SCRIPT="$APP_DIR/scripts/stop_dev_service.sh"
    ;;
  stable)
    PORT=3001
    PID_FILE="$LOG_DIR/hiverunner-stable.pid"
    LOG_FILE="$LOG_DIR/hiverunner-stable.log"
    FAILURE_FILE="$LOG_DIR/hiverunner-stable.health-failures"
    WATCHDOG_OUT_LOG="$LOG_DIR/hr-stable-watchdog.out.log"
    WATCHDOG_ERR_LOG="$LOG_DIR/hr-stable-watchdog.err.log"
    START_SCRIPT="$APP_DIR/scripts/start_stable_service.sh"
    STOP_SCRIPT="$APP_DIR/scripts/stop_stable_service.sh"
    ;;
  *)
    echo "Unknown lane: $LANE (must be dev, exec-dev, or stable)"
    exit 1
    ;;
esac

export PORT
if [ -n "${MC_SERVICE_ID:-}" ]; then
  export MC_SERVICE_ID
fi
if [ "$LANE" = "exec-dev" ]; then
  export MC_DATA_DIR MC_WORKSPACE_ROOT MC_LOG_DIR MC_ENGINE_TICK MC_DEV_EXECUTION_TEST_MODE
fi

case "$ACTION" in
  start)
    exec "$START_SCRIPT"
    ;;
  stop)
    exec "$STOP_SCRIPT"
    ;;
  restart)
    "$STOP_SCRIPT" 2>/dev/null || true
    sleep 1
    exec "$START_SCRIPT"
    ;;
  status)
    mkdir -p "$LOG_DIR" 2>/dev/null || true
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
      if curl -sf --max-time 15 "http://127.0.0.1:$PORT/api/hiverunner/health" >/dev/null 2>&1; then
        echo "[$LANE] health: OK"
      elif { [ "$LANE" = "dev" ] || [ "$LANE" = "exec-dev" ]; } &&
           curl -sf --max-time 15 "http://127.0.0.1:$PORT/api/orchestration/companies" >/dev/null 2>&1; then
        echo "[$LANE] health: OK (legacy companies fallback)"
      else
        echo "[$LANE] health: UNHEALTHY (process alive but not responding)"
      fi
      if [ -f "$FAILURE_FILE" ]; then
        FAILURE_COUNT="$(cat "$FAILURE_FILE" 2>/dev/null || true)"
        [ -n "$FAILURE_COUNT" ] && echo "[$LANE] watchdog pending failures: $FAILURE_COUNT"
      fi
      if [ -f "$WATCHDOG_OUT_LOG" ] || [ -f "$WATCHDOG_ERR_LOG" ]; then
        echo "[$LANE] watchdog logs: $WATCHDOG_OUT_LOG $WATCHDOG_ERR_LOG"
      fi
      exit 0
    fi
    echo "[$LANE] not running"
    if [ -f "$FAILURE_FILE" ]; then
      FAILURE_COUNT="$(cat "$FAILURE_FILE" 2>/dev/null || true)"
      [ -n "$FAILURE_COUNT" ] && echo "[$LANE] watchdog pending failures: $FAILURE_COUNT"
    fi
    exit 1
    ;;
  logs)
    LOG_KIND="${3:-main}"
    if [ "$LOG_KIND" = "watchdog" ]; then
      WATCHDOG_LOGS=""
      [ -f "$WATCHDOG_OUT_LOG" ] && WATCHDOG_LOGS="$WATCHDOG_LOGS $WATCHDOG_OUT_LOG"
      [ -f "$WATCHDOG_ERR_LOG" ] && WATCHDOG_LOGS="$WATCHDOG_LOGS $WATCHDOG_ERR_LOG"
      if [ -n "$WATCHDOG_LOGS" ]; then
        # shellcheck disable=SC2086
        tail -f $WATCHDOG_LOGS
      else
        echo "No watchdog log files found at $WATCHDOG_OUT_LOG or $WATCHDOG_ERR_LOG"
        exit 1
      fi
    elif [ -f "$LOG_FILE" ]; then
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
