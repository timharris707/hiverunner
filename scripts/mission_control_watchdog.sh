#!/bin/sh
set -eu

APP_DIR="/Users/timharris/.openclaw/workspace/projects/mission-control-app"
LOG_DIR="$APP_DIR/data"
OUT_LOG="$LOG_DIR/mc-dev-watchdog.out.log"
ERR_LOG="$LOG_DIR/mc-dev-watchdog.err.log"
HEALTHCHECK_SCRIPT="$APP_DIR/scripts/healthcheck_dev_service.sh"
INTERVAL="${MC_WATCHDOG_INTERVAL:-15}"

mkdir -p "$LOG_DIR"

while true; do
  "$HEALTHCHECK_SCRIPT" >>"$OUT_LOG" 2>>"$ERR_LOG" || true
  sleep "$INTERVAL"
done
