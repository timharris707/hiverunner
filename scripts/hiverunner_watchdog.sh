#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
# shellcheck source=scripts/lib/runtime-paths.sh
. "$SCRIPT_DIR/lib/runtime-paths.sh"

APP_DIR="$(resolve_mc_app_root "$0")"
MC_SERVICE_ID="${MC_SERVICE_ID:-dev}"
case "$MC_SERVICE_ID" in
  exec-dev)
    DEFAULT_PORT=3020
    DEFAULT_LOG_DIR="$APP_DIR/data-exec-dev/logs"
    ;;
  *)
    DEFAULT_PORT=3010
    DEFAULT_LOG_DIR="$(resolve_mc_log_dir "$APP_DIR")"
    ;;
esac
LOG_DIR="${MC_LOG_DIR:-$DEFAULT_LOG_DIR}"
PORT="${PORT:-$DEFAULT_PORT}"
OUT_LOG="$LOG_DIR/hr-$MC_SERVICE_ID-watchdog.out.log"
ERR_LOG="$LOG_DIR/hr-$MC_SERVICE_ID-watchdog.err.log"
HEALTHCHECK_SCRIPT="$APP_DIR/scripts/healthcheck_dev_service.sh"
INTERVAL="${MC_WATCHDOG_INTERVAL:-15}"

mkdir -p "$LOG_DIR"

while true; do
  MC_SERVICE_ID="$MC_SERVICE_ID" MC_LOG_DIR="$LOG_DIR" PORT="$PORT" "$HEALTHCHECK_SCRIPT" >>"$OUT_LOG" 2>>"$ERR_LOG" || true
  sleep "$INTERVAL"
done
