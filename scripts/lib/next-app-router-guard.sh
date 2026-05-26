#!/bin/sh

assert_no_root_app_router_shadow() {
  ROOT_DIR="$1"
  LABEL="${2:-hiverunner}"

  if [ -d "$ROOT_DIR/app" ] && [ -d "$ROOT_DIR/src/app" ]; then
    echo "[$LABEL] ERROR: refusing to start because $ROOT_DIR/app exists next to $ROOT_DIR/src/app."
    echo "[$LABEL] Next.js will treat the root app/ directory as the app router and shadow src/app, causing routes to 404."
    echo "[$LABEL] Verification artifacts belong under $ROOT_DIR/output/... or a system temp directory, never $ROOT_DIR/app/output/..."
    exit 1
  fi
}
