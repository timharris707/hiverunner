#!/bin/sh
set -eu

APP_DIR="/Users/timharris/.openclaw/workspace/projects/mission-control-app"
LOG_DIR="$APP_DIR/data"
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
MC_DATA_DIR="${MC_DATA_DIR:-$APP_DIR/data-dev}"
NODE_HEAP_SIZE="${NODE_HEAP_SIZE:-8192}"
mkdir -p "$MC_DATA_DIR"

echo "$$" > "$PID_FILE"
echo "[mc-dev] launchd service starting on port $PORT (node: $NODE_BIN, tick: $MC_ENGINE_TICK, data: $MC_DATA_DIR)"

exec env \
  NODE_ENV=development \
  PORT="$PORT" \
  MC_ENGINE_TICK="$MC_ENGINE_TICK" \
  MC_DATA_DIR="$MC_DATA_DIR" \
  "$NODE_BIN" --max-old-space-size="$NODE_HEAP_SIZE" server.js
