#!/bin/sh

resolve_mc_script_dir() {
  SCRIPT_PATH="$1"
  CDPATH= cd -- "$(dirname -- "$SCRIPT_PATH")" && pwd -P
}

resolve_mc_app_root() {
  SCRIPT_PATH="$1"

  if [ -n "${MC_APP_ROOT:-}" ]; then
    printf '%s\n' "$MC_APP_ROOT"
    return 0
  fi

  SCRIPT_DIR="$(resolve_mc_script_dir "$SCRIPT_PATH")"
  if [ "$(basename "$SCRIPT_DIR")" = "scripts" ]; then
    CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P
    return 0
  fi

  printf '%s\n' "$SCRIPT_DIR"
}

resolve_mc_log_dir() {
  APP_DIR="$1"
  if [ -n "${MC_LOG_DIR:-}" ]; then
    printf '%s\n' "$MC_LOG_DIR"
    return 0
  fi

  printf '%s/data\n' "$APP_DIR"
}

resolve_mc_data_dir() {
  APP_DIR="$1"
  DEFAULT_LEAF="$2"
  if [ -n "${MC_DATA_DIR:-}" ]; then
    printf '%s\n' "$MC_DATA_DIR"
    return 0
  fi

  printf '%s/%s\n' "$APP_DIR" "$DEFAULT_LEAF"
}

resolve_mc_workspace_root() {
  DEFAULT_ROOT="$1"
  if [ -n "${MC_WORKSPACE_ROOT:-}" ]; then
    printf '%s\n' "$MC_WORKSPACE_ROOT"
    return 0
  fi

  printf '%s\n' "$DEFAULT_ROOT"
}

hiverunner_db_has_real_company() {
  DB_PATH="$1"
  if [ ! -s "$DB_PATH" ]; then
    return 1
  fi
  if ! command -v sqlite3 >/dev/null 2>&1; then
    return 1
  fi

  REAL_COMPANY_COUNT="$(sqlite3 "$DB_PATH" "select count(*) from companies where coalesce(company_code, '') <> 'HIVE' or coalesce(slug, '') <> 'hiverunner-workspace';" 2>/dev/null || printf '0')"
  case "$REAL_COMPANY_COUNT" in
    ''|*[!0-9]*) return 1 ;;
  esac
  [ "$REAL_COMPANY_COUNT" -gt 0 ]
}

assert_no_empty_stable_data_dir_when_legacy_exists() {
  LABEL="${1:-hr-stable}"
  APP_DIR="$2"
  DATA_DIR="$3"

  if [ "${HIVERUNNER_ALLOW_EMPTY_STABLE_DATA:-}" = "1" ]; then
    return 0
  fi
  if [ -n "${ORCHESTRATION_DB_PATH:-}" ]; then
    return 0
  fi
  if [ -z "${HOME:-}" ]; then
    return 0
  fi

  LEGACY_APP_DIR="$HOME/.mission-control/app"
  LEGACY_DATA_DIR="$LEGACY_APP_DIR/data"
  LEGACY_DB="$LEGACY_DATA_DIR/orchestration.db"
  CURRENT_DB="$DATA_DIR/orchestration.db"

  if [ "$APP_DIR" = "$LEGACY_APP_DIR" ] || [ "$DATA_DIR" = "$LEGACY_DATA_DIR" ]; then
    return 0
  fi

  if ! hiverunner_db_has_real_company "$CURRENT_DB" && hiverunner_db_has_real_company "$LEGACY_DB"; then
    echo "[$LABEL] ERROR: refusing to start stable with an empty/new data directory while a populated legacy HiveRunner DB exists." >&2
    echo "[$LABEL] Current app root: $APP_DIR" >&2
    echo "[$LABEL] Current data dir: $DATA_DIR" >&2
    echo "[$LABEL] Legacy data dir:  $LEGACY_DATA_DIR" >&2
    echo "[$LABEL] This usually means the app root moved but the stable data directory was not migrated." >&2
    echo "[$LABEL] Fix one of these ways:" >&2
    echo "[$LABEL]   1. Start with MC_DATA_DIR=$LEGACY_DATA_DIR to keep using the existing data." >&2
    echo "[$LABEL]   2. Copy/migrate the legacy data into $DATA_DIR before starting stable." >&2
    echo "[$LABEL]   3. If you intentionally want a fresh stable install, set HIVERUNNER_ALLOW_EMPTY_STABLE_DATA=1." >&2
    return 1
  fi
}

append_node_search_path() {
  PATH_TO_ADD="$1"
  if [ -n "$PATH_TO_ADD" ]; then
    if [ -n "${HIVERUNNER_NODE_SEARCHED_PATHS:-}" ]; then
      HIVERUNNER_NODE_SEARCHED_PATHS="${HIVERUNNER_NODE_SEARCHED_PATHS}
$PATH_TO_ADD"
    else
      HIVERUNNER_NODE_SEARCHED_PATHS="$PATH_TO_ADD"
    fi
  fi
}

print_node_resolution_error() {
  LABEL="${1:-hiverunner}"
  echo "[$LABEL] ERROR: cannot find a usable Node.js binary." >&2
  echo "[$LABEL] Searched:" >&2
  if [ -n "${HIVERUNNER_NODE_SEARCHED_PATHS:-}" ]; then
    printf '%s\n' "$HIVERUNNER_NODE_SEARCHED_PATHS" | sed "s/^/[$LABEL]   - /" >&2
  else
    echo "[$LABEL]   - no search paths recorded" >&2
  fi
  echo "[$LABEL] Set HIVERUNNER_NODE_BIN=/absolute/path/to/node to use a non-standard Node install." >&2
}

resolve_hiverunner_node_bin() {
  LABEL="${1:-hiverunner}"
  HIVERUNNER_NODE_SEARCHED_PATHS=""

  if [ -n "${HIVERUNNER_NODE_BIN:-}" ]; then
    append_node_search_path "$HIVERUNNER_NODE_BIN"
    if [ -x "$HIVERUNNER_NODE_BIN" ]; then
      printf '%s\n' "$HIVERUNNER_NODE_BIN"
      return 0
    fi
    print_node_resolution_error "$LABEL"
    return 1
  fi

  if [ -n "${NODE_BIN:-}" ]; then
    append_node_search_path "$NODE_BIN"
    if [ -x "$NODE_BIN" ]; then
      printf '%s\n' "$NODE_BIN"
      return 0
    fi
    print_node_resolution_error "$LABEL"
    return 1
  fi

  PATH_NODE="$(command -v node 2>/dev/null || true)"
  append_node_search_path "PATH: node${PATH_NODE:+ -> $PATH_NODE}"
  if [ -n "$PATH_NODE" ] && [ -x "$PATH_NODE" ]; then
    printf '%s\n' "$PATH_NODE"
    return 0
  fi

  for candidate in \
    /opt/homebrew/bin/node \
    /usr/local/bin/node \
    "${HOME:-}/.local/share/fnm/node-versions/"*/installation/bin/node \
    "${HOME:-}/.fnm/node-versions/"*/installation/bin/node \
    "${HOME:-}/.local/bin/node" \
    "${HOME:-}/.volta/bin/node" \
    "${HOME:-}/.asdf/shims/node"
  do
    append_node_search_path "$candidate"
    if [ -x "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  print_node_resolution_error "$LABEL"
  return 1
}
