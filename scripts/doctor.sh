#!/bin/sh
set -eu

# ─── HiveRunner Doctor ───
# Comprehensive runtime health diagnostic.
# Shows PID/port/health alignment for both lanes.
# Does NOT modify anything — read-only inspection.
#
# Usage:
#   scripts/doctor.sh          # Full report
#   scripts/doctor.sh --fix    # Report + fix stale PIDs

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
# shellcheck source=scripts/lib/runtime-paths.sh
. "$SCRIPT_DIR/lib/runtime-paths.sh"

APP_DIR="$(resolve_mc_app_root "$0")"
LOG_DIR="$(resolve_mc_log_dir "$APP_DIR")"
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

printf "\n${BOLD}=== HiveRunner Doctor ===${NC}\n"
printf "  %s\n\n" "$(date '+%Y-%m-%d %H:%M:%S')"

# ────────────────────────────────────────
# Dev Lane (port 3010)
# ────────────────────────────────────────
printf "${BOLD}Dev Lane (:3010)${NC}\n"

DEV_PID_FILE="$LOG_DIR/hiverunner-dev.pid"
DEV_PORT=3010

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

# Health check + engine tick role
DEV_HEALTH_JSON="$(curl -sf --max-time 5 "http://127.0.0.1:$DEV_PORT/api/hiverunner/health" 2>/dev/null || true)"
if [ -n "$DEV_HEALTH_JSON" ]; then
  ok "Healthcheck: /api/hiverunner/health OK"
  DEV_ROLE="$(echo "$DEV_HEALTH_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('role','?'))" 2>/dev/null || echo "?")"
  DEV_TICK="$(echo "$DEV_HEALTH_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('engineTick','?'))" 2>/dev/null || echo "?")"
  DEV_TEST_GATE="$(echo "$DEV_HEALTH_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('devExecutionTestModeGate','disabled'))" 2>/dev/null || echo "disabled")"
  if [ "$DEV_TICK" = "disabled" ]; then
    ok "Engine tick: disabled (observer-only)"
  elif [ "$DEV_TICK" = "active" ]; then
    if [ "$DEV_TEST_GATE" = "enabled" ] && [ "$DEV_ROLE" = "observer" ]; then
      info "Engine tick: active (dev test mode ready; execution still company-scoped)"
    else
      warn "Engine tick: ACTIVE — dev lane is executing orchestration work"
      issues=$((issues + 1))
    fi
  else
    info "Engine tick: $DEV_TICK (role: $DEV_ROLE)"
  fi
elif curl -sf --max-time 5 "http://127.0.0.1:$DEV_PORT/api/orchestration/companies" >/dev/null 2>&1; then
  ok "Healthcheck: /api/orchestration/companies OK (HiveRunner health endpoint not yet available)"
  info "Engine tick: unknown (health endpoint too old)"
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

STABLE_PID_FILE="$LOG_DIR/hiverunner-stable.pid"
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

# Health check + engine tick role (only if port has listener)
if [ -n "${STABLE_PORT_PID:-}" ]; then
  STABLE_HEALTH_JSON="$(curl -sf --max-time 5 "http://127.0.0.1:$STABLE_PORT/api/hiverunner/health" 2>/dev/null || true)"
  if [ -n "$STABLE_HEALTH_JSON" ]; then
    ok "Healthcheck: /api/hiverunner/health OK"
    STABLE_TICK="$(echo "$STABLE_HEALTH_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('engineTick','?'))" 2>/dev/null || echo "?")"
    if [ "$STABLE_TICK" = "active" ]; then
      ok "Engine tick: active (execution owner)"
    elif [ "$STABLE_TICK" = "disabled" ]; then
      warn "Engine tick: disabled — stable is not executing orchestration work"
      issues=$((issues + 1))
    else
      info "Engine tick: $STABLE_TICK"
    fi
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
# Process manager
# ────────────────────────────────────────
printf "${BOLD}Process Manager${NC}\n"

if [ -f "$DEV_PID_FILE" ]; then
  ok "Dev manager: script-managed PID/log files"
else
  info "Dev manager: no PID file yet; use scripts/lane.sh dev start"
fi

if [ -f "$STABLE_PID_FILE" ]; then
  ok "Stable manager: script-managed PID/log files"
else
  info "Stable manager: no PID file yet; use scripts/lane.sh stable start after promotion"
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
