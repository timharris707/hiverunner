#!/bin/sh
set -eu

# ─── Mission Control Doctor ───
# Comprehensive runtime health diagnostic.
# Shows PID/port/health alignment for both lanes.
# Does NOT modify anything — read-only inspection.
#
# Usage:
#   scripts/doctor.sh          # Full report
#   scripts/doctor.sh --fix    # Report + fix stale PIDs

APP_DIR="/Users/timharris/.openclaw/workspace/projects/mission-control-app"
FIX_MODE="${1:-}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

ok()   { printf "  ${GREEN}OK${NC}  %s\n" "$1"; }
warn() { printf "  ${YELLOW}!!${NC}  %s\n" "$1"; }
fail() { printf "  ${RED}XX${NC}  %s\n" "$1"; }
info() { printf "  ${CYAN}--${NC}  %s\n" "$1"; }

issues=0

printf "\n${BOLD}=== Mission Control Doctor ===${NC}\n"
printf "  %s\n\n" "$(date '+%Y-%m-%d %H:%M:%S')"

# ────────────────────────────────────────
# Dev Lane (port 3000)
# ────────────────────────────────────────
printf "${BOLD}Dev Lane (:3000)${NC}\n"

DEV_PID_FILE="$APP_DIR/data/mission-control-dev.pid"
DEV_PORT=3000

# PID file
if [ -f "$DEV_PID_FILE" ]; then
  DEV_FILE_PID="$(cat "$DEV_PID_FILE" 2>/dev/null || true)"
  if [ -n "$DEV_FILE_PID" ] && kill -0 "$DEV_FILE_PID" 2>/dev/null; then
    ok "PID file: $DEV_FILE_PID (alive)"
  else
    fail "PID file: $DEV_FILE_PID (STALE — process dead)"
    issues=$((issues + 1))
    if [ "$FIX_MODE" = "--fix" ]; then
      rm -f "$DEV_PID_FILE"
      info "Fixed: removed stale PID file"
    fi
  fi
else
  warn "PID file: not present"
fi

# Port listener
DEV_PORT_PID="$(lsof -tiTCP:$DEV_PORT -sTCP:LISTEN 2>/dev/null || true)"
if [ -n "$DEV_PORT_PID" ]; then
  ok "Port $DEV_PORT: listener PID $DEV_PORT_PID"
else
  fail "Port $DEV_PORT: no listener"
  issues=$((issues + 1))
fi

# PID ↔ Port alignment
if [ -n "${DEV_FILE_PID:-}" ] && [ -n "${DEV_PORT_PID:-}" ]; then
  if [ "$DEV_FILE_PID" = "$DEV_PORT_PID" ]; then
    ok "PID alignment: PID file matches port listener"
  else
    fail "PID MISMATCH: file=$DEV_FILE_PID, port=$DEV_PORT_PID"
    issues=$((issues + 1))
    if [ "$FIX_MODE" = "--fix" ]; then
      echo "$DEV_PORT_PID" > "$DEV_PID_FILE"
      info "Fixed: updated PID file to actual listener $DEV_PORT_PID"
    fi
  fi
fi

# Health check
if curl -sf --max-time 5 "http://127.0.0.1:$DEV_PORT/api/mc/health" >/dev/null 2>&1; then
  ok "Healthcheck: /api/mc/health OK"
elif curl -sf --max-time 5 "http://127.0.0.1:$DEV_PORT/api/orchestration/companies" >/dev/null 2>&1; then
  ok "Healthcheck: /api/orchestration/companies OK (mc/health not yet available)"
else
  if [ -n "${DEV_PORT_PID:-}" ]; then
    fail "Healthcheck: FAILED (process running but not responding)"
    issues=$((issues + 1))
  else
    info "Healthcheck: skipped (no listener)"
  fi
fi

# .next/dev state
if [ -d "$APP_DIR/.next/dev" ]; then
  DEV_CACHE_SIZE="$(du -sh "$APP_DIR/.next/dev" 2>/dev/null | cut -f1)"
  if [ -f "$APP_DIR/.next/dev/lock" ]; then
    warn ".next/dev: ${DEV_CACHE_SIZE} (lock file present)"
  else
    info ".next/dev: ${DEV_CACHE_SIZE}"
  fi
else
  info ".next/dev: not present"
fi

echo ""

# ────────────────────────────────────────
# Stable Lane (port 3001)
# ────────────────────────────────────────
printf "${BOLD}Stable Lane (:3001)${NC}\n"

STABLE_PID_FILE="$APP_DIR/data/mission-control-stable.pid"
STABLE_DIR="$APP_DIR/.stable"
STABLE_PORT=3001

# Stable build check
if [ -d "$STABLE_DIR/.next" ]; then
  ok "Stable build: present"
else
  info "Stable build: not promoted yet"
fi

# PID file
if [ -f "$STABLE_PID_FILE" ]; then
  STABLE_FILE_PID="$(cat "$STABLE_PID_FILE" 2>/dev/null || true)"
  if [ -n "$STABLE_FILE_PID" ] && kill -0 "$STABLE_FILE_PID" 2>/dev/null; then
    ok "PID file: $STABLE_FILE_PID (alive)"
  else
    fail "PID file: $STABLE_FILE_PID (STALE — process dead)"
    issues=$((issues + 1))
    if [ "$FIX_MODE" = "--fix" ]; then
      rm -f "$STABLE_PID_FILE"
      info "Fixed: removed stale PID file"
    fi
  fi
else
  info "PID file: not present"
fi

# Port listener
STABLE_PORT_PID="$(lsof -tiTCP:$STABLE_PORT -sTCP:LISTEN 2>/dev/null || true)"
if [ -n "$STABLE_PORT_PID" ]; then
  ok "Port $STABLE_PORT: listener PID $STABLE_PORT_PID"
else
  if [ -d "$STABLE_DIR/.next" ]; then
    warn "Port $STABLE_PORT: no listener (stable build exists but not running)"
    issues=$((issues + 1))
  else
    info "Port $STABLE_PORT: no listener (no build)"
  fi
fi

# Health check (only if port has listener)
if [ -n "${STABLE_PORT_PID:-}" ]; then
  if curl -sf --max-time 5 "http://127.0.0.1:$STABLE_PORT/api/mc/health" >/dev/null 2>&1; then
    ok "Healthcheck: /api/mc/health OK"
  elif curl -sf --max-time 5 "http://127.0.0.1:$STABLE_PORT/api/orchestration/companies" >/dev/null 2>&1; then
    ok "Healthcheck: /api/orchestration/companies OK"
  else
    fail "Healthcheck: FAILED"
    issues=$((issues + 1))
  fi
fi

# Promotion metadata
if [ -f "$STABLE_DIR/.promotion-metadata.json" ]; then
  PROMO_DATE="$(python3 -c "import json; print(json.load(open('$STABLE_DIR/.promotion-metadata.json')).get('promoted_at','?'))" 2>/dev/null || echo "?")"
  info "Last promoted: $PROMO_DATE"
fi

echo ""

# ────────────────────────────────────────
# Watchdog Status
# ────────────────────────────────────────
printf "${BOLD}Watchdog${NC}\n"

DEV_PLIST="$HOME/Library/LaunchAgents/com.harris-autonomous.mc-dev.plist"
if [ -f "$DEV_PLIST" ]; then
  if launchctl list 2>/dev/null | grep -q "com.harris-autonomous.mc-dev"; then
    ok "Dev watchdog: loaded"
  else
    warn "Dev watchdog: plist exists but not loaded"
    issues=$((issues + 1))
  fi
elif [ -f "${DEV_PLIST}.DISABLED" ]; then
  warn "Dev watchdog: DISABLED (rename to .plist to enable)"
  issues=$((issues + 1))
else
  warn "Dev watchdog: not installed"
  issues=$((issues + 1))
fi

STABLE_PLIST="$HOME/Library/LaunchAgents/com.harris-autonomous.mc-stable.plist"
if [ -f "$STABLE_PLIST" ]; then
  if launchctl list 2>/dev/null | grep -q "com.harris-autonomous.mc-stable"; then
    ok "Stable watchdog: loaded"
  else
    warn "Stable watchdog: plist exists but not loaded"
  fi
elif [ -f "${STABLE_PLIST}.DISABLED" ]; then
  info "Stable watchdog: DISABLED"
else
  info "Stable watchdog: not installed"
fi

echo ""

# ────────────────────────────────────────
# Database
# ────────────────────────────────────────
printf "${BOLD}Database${NC}\n"

DB_FILE="$APP_DIR/data/orchestration.db"
if [ -f "$DB_FILE" ]; then
  DB_SIZE="$(du -sh "$DB_FILE" 2>/dev/null | cut -f1)"
  ok "orchestration.db: ${DB_SIZE}"
  # Check for WAL bloat
  WAL_FILE="$DB_FILE-wal"
  if [ -f "$WAL_FILE" ]; then
    WAL_SIZE="$(du -sh "$WAL_FILE" 2>/dev/null | cut -f1)"
    info "WAL file: ${WAL_SIZE}"
  fi
else
  fail "orchestration.db: not found"
  issues=$((issues + 1))
fi

echo ""

# ────────────────────────────────────────
# Summary
# ────────────────────────────────────────
if [ $issues -eq 0 ]; then
  printf "${GREEN}${BOLD}All checks passed.${NC}\n\n"
else
  printf "${YELLOW}${BOLD}$issues issue(s) found.${NC}\n"
  if [ "$FIX_MODE" != "--fix" ]; then
    printf "  Run ${CYAN}scripts/doctor.sh --fix${NC} to auto-fix stale PIDs.\n"
  fi
  echo ""
fi
