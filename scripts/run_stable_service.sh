#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
# shellcheck source=scripts/lib/runtime-paths.sh
. "$SCRIPT_DIR/lib/runtime-paths.sh"
# shellcheck source=scripts/lib/next-app-router-guard.sh
. "$SCRIPT_DIR/lib/next-app-router-guard.sh"

APP_DIR="$(resolve_mc_app_root "$0")"
STABLE_DIR="$APP_DIR/.stable"
LOG_DIR="$(resolve_mc_log_dir "$APP_DIR")"
PID_FILE="$LOG_DIR/hiverunner-stable.pid"
PORT="${PORT:-3001}"

mkdir -p "$LOG_DIR"

if [ ! -d "$STABLE_DIR/.next" ]; then
  echo "[hr-stable] ERROR: no production build found in $STABLE_DIR/.next"
  echo "[hr-stable] Run scripts/promote_to_stable.sh first."
  exit 1
fi

assert_no_root_app_router_shadow "$APP_DIR" "hr-stable"
assert_no_root_app_router_shadow "$STABLE_DIR" "hr-stable"

cd "$STABLE_DIR"

NODE_BIN="$(resolve_hiverunner_node_bin "hr-stable")"

EXISTING_PID="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
if [ -n "$EXISTING_PID" ] && [ "$EXISTING_PID" != "$$" ]; then
  echo "[hr-stable] ERROR: port $PORT already in use by PID $EXISTING_PID"
  exit 1
fi

MC_ENGINE_TICK="${MC_ENGINE_TICK:-on}"
HEARTBEAT_ENABLED="${HEARTBEAT_ENABLED:-}"
HEARTBEAT_INTERVAL_SECONDS="${HEARTBEAT_INTERVAL_SECONDS:-}"
MC_DATA_DIR="$(resolve_mc_data_dir "$APP_DIR" "data")"
MC_WORKSPACE_ROOT="$(resolve_mc_workspace_root "${HOME:-}/.hiverunner/stable/workspaces")"

dotenv_value() {
  KEY="$1"
  FILE="$APP_DIR/.env.local"
  if [ ! -f "$FILE" ]; then
    return 0
  fi
  awk -v key="$KEY" '
    /^[[:space:]]*#/ || /^[[:space:]]*$/ { next }
    {
      line = $0
      split(line, parts, "=")
      candidate = parts[1]
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", candidate)
      if (candidate == key) {
        sub(/^[^=]*=/, "", line)
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", line)
        if (line ~ /^".*"$/ || line ~ /^\047.*\047$/) {
          line = substr(line, 2, length(line) - 2)
        }
        print line
        exit
      }
    }
  ' "$FILE"
}

NEXT_PUBLIC_SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL:-$(dotenv_value NEXT_PUBLIC_SUPABASE_URL)}"
NEXT_PUBLIC_SUPABASE_ANON_KEY="${NEXT_PUBLIC_SUPABASE_ANON_KEY:-$(dotenv_value NEXT_PUBLIC_SUPABASE_ANON_KEY)}"
SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-$(dotenv_value SUPABASE_SERVICE_ROLE_KEY)}"
mkdir -p "$MC_DATA_DIR"
mkdir -p "$MC_WORKSPACE_ROOT"

echo "$$" > "$PID_FILE"
echo "[hr-stable] service starting on port $PORT (node: $NODE_BIN, tick: $MC_ENGINE_TICK, data: $MC_DATA_DIR, workspaces: $MC_WORKSPACE_ROOT)"

exec env \
  NODE_ENV=production \
  PORT="$PORT" \
  HIVERUNNER_MANAGED_START="${HIVERUNNER_MANAGED_START:-0}" \
  MC_APP_ROOT="$APP_DIR" \
  MC_LOG_DIR="$LOG_DIR" \
  MC_ENGINE_TICK="$MC_ENGINE_TICK" \
  NEXT_PUBLIC_SUPABASE_URL="$NEXT_PUBLIC_SUPABASE_URL" \
  NEXT_PUBLIC_SUPABASE_ANON_KEY="$NEXT_PUBLIC_SUPABASE_ANON_KEY" \
  SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" \
  HEARTBEAT_ENABLED="$HEARTBEAT_ENABLED" \
  HEARTBEAT_INTERVAL_SECONDS="$HEARTBEAT_INTERVAL_SECONDS" \
  MC_DATA_DIR="$MC_DATA_DIR" \
  MC_WORKSPACE_ROOT="$MC_WORKSPACE_ROOT" \
  "$NODE_BIN" "$APP_DIR/server.js"
