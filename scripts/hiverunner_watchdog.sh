#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
# shellcheck source=scripts/lib/runtime-paths.sh
. "$SCRIPT_DIR/lib/runtime-paths.sh"

APP_DIR="$(resolve_mc_app_root "$0")"
LOG_DIR="$(resolve_mc_log_dir "$APP_DIR")"
OUT_LOG="$LOG_DIR/hr-dev-watchdog.out.log"
ERR_LOG="$LOG_DIR/hr-dev-watchdog.err.log"
HEALTHCHECK_SCRIPT="$APP_DIR/scripts/healthcheck_dev_service.sh"
INTERVAL="${MC_WATCHDOG_INTERVAL:-15}"

mkdir -p "$LOG_DIR"

while true; do
  "$HEALTHCHECK_SCRIPT" >>"$OUT_LOG" 2>>"$ERR_LOG" || true
  sleep "$INTERVAL"
done
