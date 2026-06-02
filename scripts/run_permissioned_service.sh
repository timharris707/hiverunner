#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_BIN="${NODE_BIN:-node}"

if ! "$NODE_BIN" --help 2>/dev/null | grep -q -- "--permission"; then
  echo "[hr-permission] ERROR: $NODE_BIN does not support Node's permission model." >&2
  echo "[hr-permission] Use HiveRunner's supported Node 22 runtime, or run npm start without this wrapper." >&2
  exit 1
fi

export NODE_ENV="${NODE_ENV:-production}"
export HOST="${HOST:-127.0.0.1}"
export PORT="${PORT:-3010}"
export MC_AUTH_MODE="${MC_AUTH_MODE:-local-single-user}"

HOME_DIR="${HOME:-/tmp}"
TMP_ROOT="${TMPDIR:-/tmp}"
MC_DATA_DIR="${MC_DATA_DIR:-$APP_DIR/data}"
MC_WORKSPACE_ROOT="${MC_WORKSPACE_ROOT:-$HOME_DIR/.hiverunner/workspace}"
OPENCLAW_DIR="${OPENCLAW_DIR:-$HOME_DIR/.openclaw}"
OPENCLAW_WORKSPACE_ROOT="${OPENCLAW_WORKSPACE_ROOT:-$OPENCLAW_DIR/workspace}"

export MC_DATA_DIR MC_WORKSPACE_ROOT OPENCLAW_DIR OPENCLAW_WORKSPACE_ROOT

if [ "$NODE_ENV" = "production" ] && [ ! -d "$APP_DIR/.next" ]; then
  echo "[hr-permission] ERROR: missing production build at $APP_DIR/.next." >&2
  echo "[hr-permission] Run npm run build before starting the permissioned production service." >&2
  exit 1
fi

mkdir -p "$MC_DATA_DIR" "$MC_WORKSPACE_ROOT" "$OPENCLAW_DIR" "$OPENCLAW_WORKSPACE_ROOT" "$APP_DIR/output"

FLAGS=(
  "--permission"
  "--allow-net"
  "--allow-child-process"
  "--allow-worker"
)

SEEN_PATHS=":"
add_unique_path_flag() {
  local flag_name="$1"
  local flag_path="$2"
  [ -n "$flag_path" ] || return 0
  case "$SEEN_PATHS" in
    *":$flag_name=$flag_path:"*) return 0 ;;
  esac
  SEEN_PATHS="${SEEN_PATHS}${flag_name}=${flag_path}:"
  FLAGS+=("$flag_name=$flag_path")
}

add_unique_path_flag "--allow-fs-read" "$APP_DIR"
add_unique_path_flag "--allow-fs-read" "$MC_DATA_DIR"
add_unique_path_flag "--allow-fs-read" "$MC_WORKSPACE_ROOT"
add_unique_path_flag "--allow-fs-read" "$OPENCLAW_DIR"
add_unique_path_flag "--allow-fs-read" "$OPENCLAW_WORKSPACE_ROOT"
add_unique_path_flag "--allow-fs-read" "$TMP_ROOT"

add_unique_path_flag "--allow-fs-write" "$MC_DATA_DIR"
add_unique_path_flag "--allow-fs-write" "$MC_WORKSPACE_ROOT"
add_unique_path_flag "--allow-fs-write" "$OPENCLAW_DIR"
add_unique_path_flag "--allow-fs-write" "$OPENCLAW_WORKSPACE_ROOT"
add_unique_path_flag "--allow-fs-write" "$APP_DIR/.next"
add_unique_path_flag "--allow-fs-write" "$APP_DIR/output"
add_unique_path_flag "--allow-fs-write" "$TMP_ROOT"

echo "[hr-permission] starting HiveRunner with Node permissions"
echo "[hr-permission] host=$HOST port=$PORT node_env=$NODE_ENV auth=$MC_AUTH_MODE"
echo "[hr-permission] data=$MC_DATA_DIR"
echo "[hr-permission] workspaces=$MC_WORKSPACE_ROOT"

exec "$NODE_BIN" "${FLAGS[@]}" "$APP_DIR/server.js"
