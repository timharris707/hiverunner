#!/bin/sh
set -eu

APP_DIR="/Users/timharris/.openclaw/workspace/projects/mission-control-app"
LOG_DIR="$APP_DIR/data"
PID_FILE="$LOG_DIR/mission-control-dev.pid"
OUT_LOG="$LOG_DIR/mission-control-dev.log"
ERR_LOG="$LOG_DIR/mission-control-dev.err.log"
PORT="${PORT:-3010}"

mkdir -p "$LOG_DIR"
cd "$APP_DIR"

# ── Resolve node binary ──
# launchd and nohup run with minimal PATH; Homebrew node may not be found.
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

# ── Boot diagnostic banner ──
echo ""
echo "=== Mission Control Dev Start ==="
echo "  Time:   $(date '+%Y-%m-%d %H:%M:%S')"
echo "  Port:   $PORT"
echo "  Mode:   development"
echo "  Dir:    $APP_DIR"

# ── Stale PID check ──
if [ -f "$PID_FILE" ]; then
  OLD_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "  Status: already running on PID $OLD_PID"
    echo "================================"
    exit 0
  fi
  echo "  Note:   removed stale PID file ($OLD_PID dead)"
  rm -f "$PID_FILE"
fi

# ── Port collision check ──
EXISTING_PID="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
if [ -n "$EXISTING_PID" ]; then
  echo "  !! Port $PORT already in use by PID $EXISTING_PID"
  echo "  !! Adopting that process as the managed dev server"
  echo "$EXISTING_PID" > "$PID_FILE"
  echo "================================"
  exit 0
fi

# ── Orphan cleanup ──
# Kill detached `node server.js` processes not bound to any managed port.
STABLE_PORT=3001
STABLE_PID="$(lsof -tiTCP:$STABLE_PORT -sTCP:LISTEN 2>/dev/null || true)"
for ORPHAN in $(pgrep -f "node.*server\.js" 2>/dev/null || true); do
  [ -n "$STABLE_PID" ] && [ "$ORPHAN" = "$STABLE_PID" ] && continue
  ORPHAN_LISTEN="$(lsof -p "$ORPHAN" -iTCP -sTCP:LISTEN 2>/dev/null | grep -c LISTEN || true)"
  if [ "$ORPHAN_LISTEN" = "0" ]; then
    echo "  Note:   killing orphan node process PID $ORPHAN"
    kill "$ORPHAN" 2>/dev/null || true
  fi
done

# ── Clear stale lock ──
if [ -f "$APP_DIR/.next/dev/lock" ]; then
  echo "  Note:   clearing stale .next/dev/lock"
  rm -f "$APP_DIR/.next/dev/lock"
fi

echo "================================"
echo "[mc-dev] starting Mission Control dev server on port $PORT"

# Use node directly (not npm run dev) so the PID file tracks the actual
# node process, not an npm wrapper that can exit before node is stable.
# MC_ENGINE_TICK=off: dev lane does not execute orchestration work.
# The stable lane (:3001) owns execution. Dev is for UI/build/testing.
# Override with MC_ENGINE_TICK=on if you want dev to tick (e.g., no stable lane).
MC_ENGINE_TICK="${MC_ENGINE_TICK:-off}"
# MC_DATA_DIR: dev lane uses a separate database directory so writes
# cannot corrupt the stable lane's production data.
MC_DATA_DIR="${MC_DATA_DIR:-$APP_DIR/data-dev}"
mkdir -p "$MC_DATA_DIR"
# Webpack dev mode for a large app can reach 2–3 GB RSS.  Default Node heap
# limit (~4 GB) leaves almost no headroom, causing OOM crashes after ~2 hours
# of accumulated HMR recompilation + snapshot polling churn.  8 GB gives
# comfortable room while still bounding runaway growth.
NODE_HEAP_SIZE="${NODE_HEAP_SIZE:-8192}"
nohup env NODE_ENV=development PORT="$PORT" MC_ENGINE_TICK="$MC_ENGINE_TICK" MC_DATA_DIR="$MC_DATA_DIR" "$NODE_BIN" --max-old-space-size="$NODE_HEAP_SIZE" server.js >>"$OUT_LOG" 2>>"$ERR_LOG" &
PID=$!
echo "$PID" > "$PID_FILE"
echo "[mc-dev] started PID $PID"
echo "[mc-dev] logs: tail -f $OUT_LOG"
