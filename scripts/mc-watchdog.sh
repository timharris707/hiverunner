#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
# shellcheck source=scripts/lib/runtime-paths.sh
. "$SCRIPT_DIR/lib/runtime-paths.sh"

APP_DIR="$(resolve_mc_app_root "$0")"

echo "[hr-dev] mc-watchdog.sh now delegates to the script-managed dev service"
exec /bin/sh "$APP_DIR/scripts/start_dev_service.sh"
