#!/bin/sh
set -eu

APP_DIR="/Users/timharris/.openclaw/workspace/projects/mission-control-app"

echo "[mc-dev] mc-watchdog.sh now delegates to the launchd-managed dev service"
exec /bin/sh "$APP_DIR/scripts/start_dev_service.sh"
