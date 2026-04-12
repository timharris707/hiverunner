#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
# shellcheck source=scripts/lib/runtime-paths.sh
. "$SCRIPT_DIR/lib/runtime-paths.sh"

APP_DIR="$(resolve_mc_app_root "$0")"
STABLE_DIR="$APP_DIR/.stable"
LOG_DIR="$(resolve_mc_log_dir "$APP_DIR")"
PID_FILE="$LOG_DIR/mission-control-stable.pid"
PORT="${PORT:-3001}"

mkdir -p "$LOG_DIR"

if [ ! -d "$STABLE_DIR/.next" ]; then
  echo "[mc-stable] ERROR: no production build found in $STABLE_DIR/.next"
  echo "[mc-stable] Run scripts/promote_to_stable.sh first."
  exit 1
fi

cd "$STABLE_DIR"

NODE_BIN=""
for candidate in /opt/homebrew/bin/node /usr/local/bin/node /Users/timharris/.local/share/fnm/node-versions/*/installation/bin/node; do
  if [ -x "$candidate" ]; then
    NODE_BIN="$candidate"
    break
  fi
done
if [ -z "$NODE_BIN" ]; then
  echo "[mc-stable] ERROR: cannot find node binary. Install Node.js or set PATH."
  exit 1
fi

EXISTING_PID="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
if [ -n "$EXISTING_PID" ] && [ "$EXISTING_PID" != "$$" ]; then
  echo "[mc-stable] ERROR: port $PORT already in use by PID $EXISTING_PID"
  exit 1
fi

MC_ENGINE_TICK="${MC_ENGINE_TICK:-on}"
MC_DATA_DIR="$(resolve_mc_data_dir "$APP_DIR" "data")"
MC_WORKSPACE_ROOT="$(resolve_mc_workspace_root "${HOME:-/Users/timharris}/.mission-control/stable/workspaces")"
mkdir -p "$MC_DATA_DIR"
mkdir -p "$MC_WORKSPACE_ROOT"

echo "$$" > "$PID_FILE"
echo "[mc-stable] launchd service starting on port $PORT (node: $NODE_BIN, tick: $MC_ENGINE_TICK, data: $MC_DATA_DIR, workspaces: $MC_WORKSPACE_ROOT)"

exec env \
  NODE_ENV=production \
  PORT="$PORT" \
  MC_APP_ROOT="$APP_DIR" \
  MC_LOG_DIR="$LOG_DIR" \
  MC_ENGINE_TICK="$MC_ENGINE_TICK" \
  MC_DATA_DIR="$MC_DATA_DIR" \
  MC_WORKSPACE_ROOT="$MC_WORKSPACE_ROOT" \
  "$NODE_BIN" "$APP_DIR/server.js"
