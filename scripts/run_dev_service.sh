#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
# shellcheck source=scripts/lib/runtime-paths.sh
. "$SCRIPT_DIR/lib/runtime-paths.sh"

APP_DIR="$(resolve_mc_app_root "$0")"
LOG_DIR="$(resolve_mc_log_dir "$APP_DIR")"
PID_FILE="$LOG_DIR/mission-control-dev.pid"
PORT="${PORT:-3010}"

mkdir -p "$LOG_DIR"
cd "$APP_DIR"

NODE_BIN=""
for candidate in /opt/homebrew/bin/node /usr/local/bin/node /Users/timharris/.local/share/fnm/node-versions/*/installation/bin/node; do
  if [ -x "$candidate" ]; then
    NODE_BIN="$candidate"
    break
  fi
done
if [ -z "$NODE_BIN" ]; then
  echo "[mc-dev] ERROR: cannot find node binary. Install Node.js or set PATH."
  exit 1
fi

EXISTING_PID="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
if [ -n "$EXISTING_PID" ] && [ "$EXISTING_PID" != "$$" ]; then
  echo "[mc-dev] ERROR: port $PORT already in use by PID $EXISTING_PID"
  exit 1
fi

if [ -f "$APP_DIR/.next/dev/lock" ] && [ -z "$EXISTING_PID" ]; then
  rm -f "$APP_DIR/.next/dev/lock"
fi

MC_ENGINE_TICK="${MC_ENGINE_TICK:-off}"
MC_DEV_EXECUTION_TEST_MODE="${MC_DEV_EXECUTION_TEST_MODE:-0}"
MC_DATA_DIR="$(resolve_mc_data_dir "$APP_DIR" "data-dev")"
MC_WORKSPACE_ROOT="$(resolve_mc_workspace_root "${HOME:-/Users/timharris}/.mission-control/dev/workspaces")"
NODE_HEAP_SIZE="${NODE_HEAP_SIZE:-8192}"
mkdir -p "$MC_DATA_DIR"
mkdir -p "$MC_WORKSPACE_ROOT"

echo "$$" > "$PID_FILE"
echo "[mc-dev] launchd service starting on port $PORT (node: $NODE_BIN, tick: $MC_ENGINE_TICK, dev-test-mode: $MC_DEV_EXECUTION_TEST_MODE, data: $MC_DATA_DIR, workspaces: $MC_WORKSPACE_ROOT)"

exec env \
  NODE_ENV=development \
  PORT="$PORT" \
  MC_APP_ROOT="$APP_DIR" \
  MC_LOG_DIR="$LOG_DIR" \
  MC_ENGINE_TICK="$MC_ENGINE_TICK" \
  MC_DEV_EXECUTION_TEST_MODE="$MC_DEV_EXECUTION_TEST_MODE" \
  MC_DATA_DIR="$MC_DATA_DIR" \
  MC_WORKSPACE_ROOT="$MC_WORKSPACE_ROOT" \
  "$NODE_BIN" --max-old-space-size="$NODE_HEAP_SIZE" server.js
