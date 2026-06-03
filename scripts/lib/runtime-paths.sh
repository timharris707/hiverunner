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

node_major_version() {
  NODE_CANDIDATE="$1"
  "$NODE_CANDIDATE" -e 'process.stdout.write(String(process.versions.node.split(".")[0]))' 2>/dev/null || true
}

is_hiverunner_node_compatible() {
  NODE_CANDIDATE="$1"
  [ -x "$NODE_CANDIDATE" ] || return 1

  NODE_MAJOR="$(node_major_version "$NODE_CANDIDATE")"
  [ "$NODE_MAJOR" = "22" ]
}

resolve_hiverunner_node_bin() {
  LABEL="$1"

  if [ -n "${HIVERUNNER_NODE_BIN:-}" ]; then
    if is_hiverunner_node_compatible "$HIVERUNNER_NODE_BIN"; then
      printf '%s\n' "$HIVERUNNER_NODE_BIN"
      return 0
    fi
    echo "[$LABEL] ERROR: cannot find a usable Node.js binary for HiveRunner." >&2
    echo "[$LABEL] Required: Node.js >=22 <23." >&2
    echo "[$LABEL] HIVERUNNER_NODE_BIN is not usable: $HIVERUNNER_NODE_BIN" >&2
    echo "[$LABEL] Set HIVERUNNER_NODE_BIN=/absolute/path/to/node to choose one explicitly." >&2
    return 1
  fi

  if [ -n "${NODE_BIN:-}" ]; then
    if is_hiverunner_node_compatible "$NODE_BIN"; then
      printf '%s\n' "$NODE_BIN"
      return 0
    fi
    echo "[$LABEL] ERROR: cannot find a usable Node.js binary for HiveRunner." >&2
    echo "[$LABEL] Required: Node.js >=22 <23." >&2
    echo "[$LABEL] NODE_BIN is not usable: $NODE_BIN" >&2
    echo "[$LABEL] Set HIVERUNNER_NODE_BIN=/absolute/path/to/node to choose one explicitly." >&2
    return 1
  fi

  SEEN=":"
  for candidate in \
    "$(command -v node 2>/dev/null || true)" \
    "${HOME:-}/.local/share/fnm/node-versions/"*/installation/bin/node \
    /usr/local/bin/node \
    /opt/homebrew/bin/node
  do
    [ -n "$candidate" ] || continue
    case "$candidate" in
      *'*'*) continue ;;
    esac
    case "$SEEN" in
      *:"$candidate":*) continue ;;
    esac
    SEEN="$SEEN$candidate:"
    if is_hiverunner_node_compatible "$candidate"; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  echo "[$LABEL] ERROR: cannot find a usable Node.js binary for HiveRunner." >&2
  echo "[$LABEL] Required: Node.js >=22 <23." >&2
  echo "[$LABEL] Set HIVERUNNER_NODE_BIN=/absolute/path/to/node to choose one explicitly." >&2
  return 1
}
