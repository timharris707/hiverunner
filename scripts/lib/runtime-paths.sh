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
