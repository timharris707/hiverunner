#!/bin/bash
# ─── Mission Control Dev Server Watchdog ───
# Runs continuously. Every 15 seconds:
#   1. Kills zombie node server.js processes (keeps only the one owning port 3010)
#   2. If port 3010 is down entirely, cleans up lock files and restarts dev server
#   3. Logs all actions to data/watchdog.log
#
# Usage: nohup bash scripts/mc-watchdog.sh &
# Stop:  kill $(cat data/watchdog.pid)

set -u

APP_DIR="/Users/timharris/.openclaw/workspace/projects/mission-control-app"
LOG_FILE="$APP_DIR/data/watchdog.log"
PID_FILE="$APP_DIR/data/watchdog.pid"
LOCK_FILE="$APP_DIR/.next/dev/lock"
CHECK_INTERVAL=15
MAX_RESTART_ATTEMPTS=3
RESTART_COOLDOWN=30

mkdir -p "$APP_DIR/data"

# Write our own PID
echo $$ > "$PID_FILE"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

restart_count=0
last_restart_time=0

kill_zombies() {
  # Find the PID actually listening on port 3010
  local live_pid
  live_pid=$(lsof -i :3010 -sTCP:LISTEN -t 2>/dev/null | head -1)

  # Find all node server.js processes in our app dir
  local all_pids
  all_pids=$(pgrep -f "node server.js" 2>/dev/null)

  if [ -z "$all_pids" ]; then
    return 0
  fi

  local killed=0
  for pid in $all_pids; do
    # Skip the live one
    if [ -n "$live_pid" ] && [ "$pid" = "$live_pid" ]; then
      continue
    fi

    # Verify it's actually our app dir (don't kill stable lane on 3001)
    local pid_cwd
    pid_cwd=$(lsof -p "$pid" 2>/dev/null | grep cwd | awk '{print $NF}')
    
    # Check if this process is listening on 3001 — if so, leave it alone
    local on_3001
    on_3001=$(lsof -p "$pid" -i :3001 -sTCP:LISTEN 2>/dev/null | grep -c LISTEN)
    if [ "$on_3001" -gt 0 ]; then
      continue
    fi

    # Only kill if it's NOT the live 3010 process and NOT the 3001 stable process
    if [ "$pid" != "$live_pid" ]; then
      kill "$pid" 2>/dev/null
      killed=$((killed + 1))
    fi
  done

  if [ "$killed" -gt 0 ]; then
    log "CLEANUP: killed $killed zombie node process(es)"
  fi

  return $killed
}

check_and_restart() {
  # Is port 3010 responding?
  if curl -sf http://127.0.0.1:3010/NEV/dashboard -o /dev/null --connect-timeout 5 --max-time 10 2>/dev/null; then
    # Healthy — reset restart counter
    restart_count=0
    return 0
  fi

  local now
  now=$(date +%s)

  # Cooldown check
  local elapsed=$((now - last_restart_time))
  if [ "$elapsed" -lt "$RESTART_COOLDOWN" ]; then
    return 1
  fi

  # Max attempts check
  if [ "$restart_count" -ge "$MAX_RESTART_ATTEMPTS" ]; then
    log "ERROR: dev server failed $MAX_RESTART_ATTEMPTS restarts in a row — backing off for 2 minutes"
    sleep 120
    restart_count=0
    return 1
  fi

  log "DOWN: port 3010 not responding — attempting restart (#$((restart_count + 1)))"

  # Kill everything on 3010 first
  local stale_pids
  stale_pids=$(lsof -i :3010 -t 2>/dev/null)
  if [ -n "$stale_pids" ]; then
    echo "$stale_pids" | xargs kill 2>/dev/null
    sleep 2
    # Force kill if still around
    stale_pids=$(lsof -i :3010 -t 2>/dev/null)
    if [ -n "$stale_pids" ]; then
      echo "$stale_pids" | xargs kill -9 2>/dev/null
      sleep 1
    fi
  fi

  # Clear stale lock
  if [ -f "$LOCK_FILE" ]; then
    rm -f "$LOCK_FILE" 2>/dev/null
    log "CLEANUP: removed stale .next/dev/lock"
  fi

  # Restart
  cd "$APP_DIR" || return 1
  nohup npm run dev >> "$APP_DIR/data/dev-server.log" 2>&1 &
  local new_pid=$!
  log "RESTART: launched dev server (PID $new_pid)"

  restart_count=$((restart_count + 1))
  last_restart_time=$now

  # Wait for it to come up
  local wait=0
  while [ $wait -lt 30 ]; do
    sleep 2
    wait=$((wait + 2))
    if curl -sf http://127.0.0.1:3010/NEV/dashboard -o /dev/null --connect-timeout 3 --max-time 5 2>/dev/null; then
      log "RESTART: dev server healthy after ${wait}s"
      restart_count=0
      return 0
    fi
  done

  log "RESTART: dev server did not respond within 30s — will retry next cycle"
  return 1
}

# ─── Main loop ───
log "WATCHDOG: started (PID $$, checking every ${CHECK_INTERVAL}s)"

trap 'log "WATCHDOG: stopped"; rm -f "$PID_FILE"; exit 0' INT TERM

while true; do
  kill_zombies
  check_and_restart
  sleep "$CHECK_INTERVAL"
done
