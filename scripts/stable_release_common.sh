#!/bin/sh
set -eu

# ── Ensure Homebrew PATH for node/npm/npx ──
# Scripts may run from launchd or nohup with minimal PATH.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
# shellcheck source=scripts/lib/runtime-paths.sh
. "$SCRIPT_DIR/lib/runtime-paths.sh"

APP_DIR="$(resolve_mc_app_root "$0")"
STABLE_DIR="$APP_DIR/.stable"
LOG_DIR="$APP_DIR/data"
RELEASES_DIR="$LOG_DIR/releases/stable"
RELEASE_HISTORY_DIR="$RELEASES_DIR/history"
CURRENT_RELEASE_FILE="$RELEASES_DIR/current.env"
STOP_STABLE_SCRIPT="$APP_DIR/scripts/stop_stable_service.sh"
START_STABLE_SCRIPT="$APP_DIR/scripts/start_stable_service.sh"
HEALTHCHECK_URL="${HEALTHCHECK_URL:-http://127.0.0.1:3001/api/hiverunner/health}"
RELEASE_TAG_PREFIX="stable/"
TIMESTAMP_UTC="$(date -u +%Y%m%dT%H%M%SZ)"

ensure_release_dirs() {
  mkdir -p "$LOG_DIR" "$RELEASES_DIR" "$RELEASE_HISTORY_DIR"
}

current_git_commit() {
  git -C "$APP_DIR" rev-parse HEAD
}

current_git_short_commit() {
  git -C "$APP_DIR" rev-parse --short HEAD
}

current_git_branch() {
  git -C "$APP_DIR" rev-parse --abbrev-ref HEAD
}

require_git_repo() {
  if ! git -C "$APP_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "[release] ERROR: $APP_DIR is not a git work tree." >&2
    exit 1
  fi
}

release_tag_for_commit() {
  COMMIT_SHORT="$1"
  printf "%s%s-%s" "$RELEASE_TAG_PREFIX" "$TIMESTAMP_UTC" "$COMMIT_SHORT"
}

list_repo_dirty_files() {
  git -C "$APP_DIR" status --short --untracked-files=all
}

repo_is_dirty() {
  if [ -n "$(list_repo_dirty_files)" ]; then
    return 0
  fi
  return 1
}

release_paths_are_dirty() {
  DIRTY_RELEASE_FILES="$(git -C "$APP_DIR" status --short -- \
    .gitignore \
    package.json \
    package-lock.json \
    next.config.mjs \
    server.js \
    docs/two-lane-runtime.md \
    scripts/lane.sh \
    scripts/promote_to_stable.sh \
    scripts/run_stable_service.sh \
    scripts/rollback_stable.sh \
    scripts/start_stable_service.sh \
    scripts/stop_stable_service.sh \
    scripts/stable_release_common.sh)"
  if [ -n "$DIRTY_RELEASE_FILES" ]; then
    printf "%s\n" "$DIRTY_RELEASE_FILES" >&2
    return 0
  fi
  return 1
}

require_expected_git_state() {
  ALLOW_DIRTY="${1:-0}"

  require_git_repo

  if release_paths_are_dirty; then
    echo "[release] ERROR: release-critical files are dirty." >&2
    echo "[release] Commit or stash those changes before promoting or rolling back." >&2
    exit 1
  fi

  if repo_is_dirty && [ "$ALLOW_DIRTY" != "1" ]; then
    echo "[release] ERROR: repo has tracked or untracked changes." >&2
    echo "[release] Promotion should normally represent a committed checkpoint." >&2
    echo "[release] Use --allow-dirty only if you intentionally want stable to differ from HEAD." >&2
    echo "[release] Current dirty files:" >&2
    list_repo_dirty_files >&2
    exit 1
  fi
}

require_reconcile_git_state() {
  ALLOW_DIRTY="${1:-0}"

  require_git_repo

  if repo_is_dirty && [ "$ALLOW_DIRTY" != "1" ]; then
    echo "[release] ERROR: repo has tracked or untracked changes." >&2
    echo "[release] Reconcile creates a git tag for the current live stable checkpoint." >&2
    echo "[release] Use --allow-dirty only if the current stable lane intentionally differs from HEAD." >&2
    echo "[release] Current dirty files:" >&2
    list_repo_dirty_files >&2
    exit 1
  fi
}

create_release_tag() {
  RELEASE_TAG="$1"
  RELEASE_COMMIT="$2"
  RELEASE_BRANCH="$3"
  RELEASE_REASON="${4:-promotion}"

  if git -C "$APP_DIR" rev-parse "refs/tags/$RELEASE_TAG" >/dev/null 2>&1; then
    echo "[release] ERROR: git tag $RELEASE_TAG already exists." >&2
    exit 1
  fi

  git -C "$APP_DIR" tag -a "$RELEASE_TAG" "$RELEASE_COMMIT" -m "Stable $RELEASE_REASON

commit: $RELEASE_COMMIT
branch: $RELEASE_BRANCH
timestamp_utc: $TIMESTAMP_UTC"
}

ensure_release_tag() {
  RELEASE_TAG="$1"
  RELEASE_COMMIT="$2"
  RELEASE_BRANCH="$3"
  RELEASE_REASON="${4:-promotion}"

  if git -C "$APP_DIR" rev-parse "refs/tags/$RELEASE_TAG" >/dev/null 2>&1; then
    return 0
  fi

  create_release_tag "$RELEASE_TAG" "$RELEASE_COMMIT" "$RELEASE_BRANCH" "$RELEASE_REASON"
}

read_json_field() {
  JSON_FILE="$1"
  JSON_FIELD="$2"

  if [ ! -f "$JSON_FILE" ]; then
    return 0
  fi

  node -e '
    const fs = require("fs");
    const [file, field] = process.argv.slice(1);
    try {
      const raw = fs.readFileSync(file, "utf8");
      const data = JSON.parse(raw);
      const value = data[field];
      if (value !== undefined && value !== null) process.stdout.write(String(value));
    } catch (_) {}
  ' "$JSON_FILE" "$JSON_FIELD"
}

release_id_for_commit() {
  RELEASE_COMMIT="$1"
  RELEASE_PROMOTED_AT="$2"
  RELEASE_TIME_HINT="$RELEASE_PROMOTED_AT"
  [ -n "$RELEASE_TIME_HINT" ] || RELEASE_TIME_HINT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  RELEASE_TIME_COMPACT="$(printf "%s" "$RELEASE_TIME_HINT" | sed 's/-//g; s/://g')"
  printf "%s-%s" "$RELEASE_TIME_COMPACT" "$(printf "%s" "$RELEASE_COMMIT" | cut -c1-12)"
}

prepare_build_runtime() {
  SOURCE_DIR="$1"

  if [ ! -e "$SOURCE_DIR/node_modules" ]; then
    ln -s "$APP_DIR/node_modules" "$SOURCE_DIR/node_modules"
  fi

  if [ -f "$APP_DIR/.env" ] && [ ! -e "$SOURCE_DIR/.env" ]; then
    ln -s "$APP_DIR/.env" "$SOURCE_DIR/.env"
  fi

  if [ -f "$APP_DIR/.env.local" ] && [ ! -e "$SOURCE_DIR/.env.local" ]; then
    ln -s "$APP_DIR/.env.local" "$SOURCE_DIR/.env.local"
  fi
}

read_release_env_field() {
  ENV_FILE="$1"
  ENV_KEY="$2"

  if [ ! -f "$ENV_FILE" ]; then
    return 0
  fi

  env -i sh -c '
    FILE="$1"
    KEY="$2"
    # shellcheck disable=SC1090
    . "$FILE"
    eval "VALUE=\${$KEY-}"
    if [ -n "$VALUE" ]; then
      printf "%s" "$VALUE"
    fi
  ' sh "$ENV_FILE" "$ENV_KEY"
}

load_current_release() {
  PREVIOUS_RELEASE_ID=""
  PREVIOUS_RELEASE_TAG=""
  PREVIOUS_RELEASE_COMMIT=""
  PREVIOUS_RELEASE_BRANCH=""
  PREVIOUS_RELEASE_PROMOTED_AT=""
  PREVIOUS_RELEASE_REASON=""

  if [ -f "$CURRENT_RELEASE_FILE" ]; then
    PREVIOUS_RELEASE_ID="$(read_release_env_field "$CURRENT_RELEASE_FILE" RELEASE_ID)"
    PREVIOUS_RELEASE_TAG="$(read_release_env_field "$CURRENT_RELEASE_FILE" RELEASE_TAG)"
    PREVIOUS_RELEASE_COMMIT="$(read_release_env_field "$CURRENT_RELEASE_FILE" RELEASE_COMMIT)"
    PREVIOUS_RELEASE_BRANCH="$(read_release_env_field "$CURRENT_RELEASE_FILE" RELEASE_BRANCH)"
    PREVIOUS_RELEASE_PROMOTED_AT="$(read_release_env_field "$CURRENT_RELEASE_FILE" RELEASE_PROMOTED_AT)"
    PREVIOUS_RELEASE_REASON="$(read_release_env_field "$CURRENT_RELEASE_FILE" RELEASE_REASON)"
  fi
}

write_release_history() {
  RELEASE_ID="$1"
  RELEASE_TAG="$2"
  RELEASE_COMMIT="$3"
  RELEASE_BRANCH="$4"
  RELEASE_REASON="$5"
  RELEASE_SOURCE_DIR="$6"
  RELEASE_REPO_DIRTY="$7"
  RELEASE_PROMOTED_BY="$8"
  RELEASE_DIRTY_STATUS_FILE="$9"

  HISTORY_JSON="$RELEASE_HISTORY_DIR/$RELEASE_ID.json"
  cat > "$HISTORY_JSON" <<EOF
{
  "release_id": "$RELEASE_ID",
  "release_tag": "$RELEASE_TAG",
  "release_commit": "$RELEASE_COMMIT",
  "release_branch": "$RELEASE_BRANCH",
  "release_reason": "$RELEASE_REASON",
  "promoted_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "promoted_by": "$RELEASE_PROMOTED_BY",
  "source_dir": "$RELEASE_SOURCE_DIR",
  "stable_dir": "$STABLE_DIR",
  "healthcheck_url": "$HEALTHCHECK_URL",
  "repo_dirty": "$RELEASE_REPO_DIRTY",
  "dirty_status_file": "$RELEASE_DIRTY_STATUS_FILE",
  "previous_release_id": "$PREVIOUS_RELEASE_ID",
  "previous_release_tag": "$PREVIOUS_RELEASE_TAG",
  "previous_release_commit": "$PREVIOUS_RELEASE_COMMIT",
  "previous_release_branch": "$PREVIOUS_RELEASE_BRANCH",
  "previous_release_promoted_at": "$PREVIOUS_RELEASE_PROMOTED_AT",
  "previous_release_reason": "$PREVIOUS_RELEASE_REASON"
}
EOF

  cat > "$CURRENT_RELEASE_FILE" <<EOF
RELEASE_ID=$RELEASE_ID
RELEASE_TAG=$RELEASE_TAG
RELEASE_COMMIT=$RELEASE_COMMIT
RELEASE_BRANCH=$RELEASE_BRANCH
RELEASE_REASON=$RELEASE_REASON
RELEASE_PROMOTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
RELEASE_PROMOTED_BY=$RELEASE_PROMOTED_BY
RELEASE_SOURCE_DIR=$RELEASE_SOURCE_DIR
RELEASE_REPO_DIRTY=$RELEASE_REPO_DIRTY
RELEASE_DIRTY_STATUS_FILE=$RELEASE_DIRTY_STATUS_FILE
PREVIOUS_RELEASE_ID=$PREVIOUS_RELEASE_ID
PREVIOUS_RELEASE_TAG=$PREVIOUS_RELEASE_TAG
PREVIOUS_RELEASE_COMMIT=$PREVIOUS_RELEASE_COMMIT
PREVIOUS_RELEASE_BRANCH=$PREVIOUS_RELEASE_BRANCH
PREVIOUS_RELEASE_PROMOTED_AT=$PREVIOUS_RELEASE_PROMOTED_AT
PREVIOUS_RELEASE_REASON=$PREVIOUS_RELEASE_REASON
EOF
}

record_stable_metadata() {
  RELEASE_ID="$1"
  RELEASE_TAG="$2"
  RELEASE_COMMIT="$3"
  RELEASE_BRANCH="$4"
  RELEASE_REASON="$5"
  RELEASE_PROMOTED_BY="$6"
  RELEASE_REPO_DIRTY="$7"
  RELEASE_DIRTY_STATUS_FILE="$8"

  cat > "$STABLE_DIR/.promotion-metadata.json" <<EOF
{
  "release_id": "$RELEASE_ID",
  "release_tag": "$RELEASE_TAG",
  "release_commit": "$RELEASE_COMMIT",
  "release_branch": "$RELEASE_BRANCH",
  "release_reason": "$RELEASE_REASON",
  "promoted_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "promoted_by": "$RELEASE_PROMOTED_BY",
  "repo_dirty": "$RELEASE_REPO_DIRTY",
  "dirty_status_file": "$RELEASE_DIRTY_STATUS_FILE",
  "current_release_state_file": "$CURRENT_RELEASE_FILE"
}
EOF
}

assert_release_bookkeeping() {
  RELEASE_ID="$1"
  RELEASE_TAG="$2"

  if [ ! -f "$CURRENT_RELEASE_FILE" ]; then
    echo "[release] ERROR: missing current release state file: $CURRENT_RELEASE_FILE" >&2
    exit 1
  fi

  if [ ! -f "$RELEASE_HISTORY_DIR/$RELEASE_ID.json" ]; then
    echo "[release] ERROR: missing release history file: $RELEASE_HISTORY_DIR/$RELEASE_ID.json" >&2
    exit 1
  fi

  if [ ! -f "$STABLE_DIR/.promotion-metadata.json" ]; then
    echo "[release] ERROR: missing stable promotion metadata: $STABLE_DIR/.promotion-metadata.json" >&2
    exit 1
  fi

  if ! git -C "$APP_DIR" rev-parse "refs/tags/$RELEASE_TAG" >/dev/null 2>&1; then
    echo "[release] ERROR: missing git tag: $RELEASE_TAG" >&2
    exit 1
  fi
}

reconcile_live_stable_release() {
  RELEASE_TAG_OVERRIDE="${1:-}"
  RELEASE_REASON="${2:-promotion}"
  RELEASE_REPO_DIRTY="${3:-0}"
  RELEASE_DIRTY_STATUS_FILE="${4:-}"

  ensure_release_dirs
  load_current_release

  if [ ! -d "$STABLE_DIR/.next" ]; then
    echo "[release] ERROR: no live stable build found in $STABLE_DIR/.next" >&2
    exit 1
  fi

  LIVE_METADATA_FILE="$STABLE_DIR/.promotion-metadata.json"
  LIVE_PROMOTED_AT="$(read_json_field "$LIVE_METADATA_FILE" promoted_at)"
  LIVE_PROMOTED_BY="$(read_json_field "$LIVE_METADATA_FILE" promoted_by)"
  LIVE_RELEASE_COMMIT="$(read_json_field "$LIVE_METADATA_FILE" release_commit)"
  [ -n "$LIVE_RELEASE_COMMIT" ] || LIVE_RELEASE_COMMIT="$(read_json_field "$LIVE_METADATA_FILE" git_sha)"
  [ -n "$LIVE_RELEASE_COMMIT" ] || LIVE_RELEASE_COMMIT="$(current_git_commit)"
  LIVE_RELEASE_BRANCH="$(read_json_field "$LIVE_METADATA_FILE" release_branch)"
  [ -n "$LIVE_RELEASE_BRANCH" ] || LIVE_RELEASE_BRANCH="$(read_json_field "$LIVE_METADATA_FILE" git_branch)"
  [ -n "$LIVE_RELEASE_BRANCH" ] || LIVE_RELEASE_BRANCH="$(current_git_branch)"
  LIVE_RELEASE_TAG="$(read_json_field "$LIVE_METADATA_FILE" release_tag)"
  [ -n "$LIVE_RELEASE_TAG" ] || LIVE_RELEASE_TAG="${PREVIOUS_RELEASE_TAG:-}"
  if [ -n "$RELEASE_TAG_OVERRIDE" ]; then
    LIVE_RELEASE_TAG="$RELEASE_TAG_OVERRIDE"
  fi
  if [ -z "$LIVE_RELEASE_TAG" ]; then
    LIVE_RELEASE_TAG_PREFIX_TIME="$LIVE_PROMOTED_AT"
    [ -n "$LIVE_RELEASE_TAG_PREFIX_TIME" ] || LIVE_RELEASE_TAG_PREFIX_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    LIVE_RELEASE_TAG="${RELEASE_TAG_PREFIX}$(printf "%s" "$LIVE_RELEASE_TAG_PREFIX_TIME" | sed 's/-//g; s/://g')-$(printf "%s" "$LIVE_RELEASE_COMMIT" | cut -c1-7)"
  fi
  [ -n "$LIVE_PROMOTED_BY" ] || LIVE_PROMOTED_BY="$(whoami)"
  LIVE_RELEASE_ID="$(release_id_for_commit "$LIVE_RELEASE_COMMIT" "$LIVE_PROMOTED_AT")"

  ensure_release_tag "$LIVE_RELEASE_TAG" "$LIVE_RELEASE_COMMIT" "$LIVE_RELEASE_BRANCH" "$RELEASE_REASON"

  write_release_history \
    "$LIVE_RELEASE_ID" \
    "$LIVE_RELEASE_TAG" \
    "$LIVE_RELEASE_COMMIT" \
    "$LIVE_RELEASE_BRANCH" \
    "$RELEASE_REASON" \
    "$STABLE_DIR" \
    "$RELEASE_REPO_DIRTY" \
    "$LIVE_PROMOTED_BY" \
    "$RELEASE_DIRTY_STATUS_FILE"

  record_stable_metadata \
    "$LIVE_RELEASE_ID" \
    "$LIVE_RELEASE_TAG" \
    "$LIVE_RELEASE_COMMIT" \
    "$LIVE_RELEASE_BRANCH" \
    "$RELEASE_REASON" \
    "$LIVE_PROMOTED_BY" \
    "$RELEASE_REPO_DIRTY" \
    "$RELEASE_DIRTY_STATUS_FILE"

  assert_release_bookkeeping "$LIVE_RELEASE_ID" "$LIVE_RELEASE_TAG"

  echo "[release] Reconciled live stable release: $LIVE_RELEASE_TAG ($LIVE_RELEASE_COMMIT)"
}

rotate_stable_backup() {
  if [ -d "$STABLE_DIR" ]; then
    BACKUP_DIR="$APP_DIR/.stable.backup-${TIMESTAMP_UTC}"
    echo "[release] Backing up previous stable to $(basename "$BACKUP_DIR")"
    mv "$STABLE_DIR" "$BACKUP_DIR"
    ls -dt "$APP_DIR"/.stable.backup-* 2>/dev/null | tail -n +3 | xargs rm -rf 2>/dev/null || true
  else
    echo "[release] No previous stable build to back up."
  fi
}

deploy_stable_from_dir() {
  SOURCE_DIR="$1"
  RELEASE_TAG="$2"
  RELEASE_COMMIT="$3"
  RELEASE_BRANCH="$4"
  RELEASE_REASON="$5"
  RELEASE_REPO_DIRTY="$6"
  RELEASE_DIRTY_STATUS_FILE="$7"

  ensure_release_dirs
  load_current_release

  RELEASE_ID="$(date -u +%Y%m%dT%H%M%SZ)-$(printf "%s" "$RELEASE_COMMIT" | cut -c1-12)"
  RELEASE_PROMOTED_BY="$(whoami)"

  echo "[release] Stopping stable lane (if running)..."
  "$STOP_STABLE_SCRIPT" 2>/dev/null || true

  rotate_stable_backup

  echo "[release] Deploying build artifacts from $SOURCE_DIR"
  mkdir -p "$STABLE_DIR"
  cp "$SOURCE_DIR/server.js" "$STABLE_DIR/server.js"
  cp "$SOURCE_DIR/package.json" "$STABLE_DIR/package.json"
  cp "$SOURCE_DIR/next.config.mjs" "$STABLE_DIR/next.config.mjs"

  if [ -f "$APP_DIR/.env" ]; then
    cp "$APP_DIR/.env" "$STABLE_DIR/.env"
  fi
  if [ -f "$APP_DIR/.env.local" ]; then
    cp "$APP_DIR/.env.local" "$STABLE_DIR/.env.local"
  fi

  cp -R "$SOURCE_DIR/.next" "$STABLE_DIR/.next"
  ln -s "$APP_DIR/node_modules" "$STABLE_DIR/node_modules"
  ln -s "$APP_DIR/data" "$STABLE_DIR/data"

  if [ -f "$SOURCE_DIR/scripts/hiverunner-symphony-runner.mjs" ]; then
    mkdir -p "$STABLE_DIR/scripts"
    cp \
      "$SOURCE_DIR/scripts/hiverunner-symphony-runner.mjs" \
      "$STABLE_DIR/scripts/hiverunner-symphony-runner.mjs"
    chmod +x "$STABLE_DIR/scripts/hiverunner-symphony-runner.mjs"
  fi

  if [ -f "$SOURCE_DIR/scripts/hiverunner-claude-runner.mjs" ]; then
    mkdir -p "$STABLE_DIR/scripts"
    cp \
      "$SOURCE_DIR/scripts/hiverunner-claude-runner.mjs" \
      "$STABLE_DIR/scripts/hiverunner-claude-runner.mjs"
    chmod +x "$STABLE_DIR/scripts/hiverunner-claude-runner.mjs"
  fi

  if [ -f "$SOURCE_DIR/scripts/hiverunner-gemini-runner.mjs" ]; then
    mkdir -p "$STABLE_DIR/scripts"
    cp \
      "$SOURCE_DIR/scripts/hiverunner-gemini-runner.mjs" \
      "$STABLE_DIR/scripts/hiverunner-gemini-runner.mjs"
    chmod +x "$STABLE_DIR/scripts/hiverunner-gemini-runner.mjs"
  fi

  if [ -f "$SOURCE_DIR/scripts/hiverunner-hermes-runner.mjs" ]; then
    mkdir -p "$STABLE_DIR/scripts"
    cp \
      "$SOURCE_DIR/scripts/hiverunner-hermes-runner.mjs" \
      "$STABLE_DIR/scripts/hiverunner-hermes-runner.mjs"
    chmod +x "$STABLE_DIR/scripts/hiverunner-hermes-runner.mjs"
  fi

  if [ -f "$SOURCE_DIR/scripts/hiverunner-openclaw-runner.mjs" ]; then
    mkdir -p "$STABLE_DIR/scripts"
    cp \
      "$SOURCE_DIR/scripts/hiverunner-openclaw-runner.mjs" \
      "$STABLE_DIR/scripts/hiverunner-openclaw-runner.mjs"
    chmod +x "$STABLE_DIR/scripts/hiverunner-openclaw-runner.mjs"
  fi

  if [ -d "$APP_DIR/public" ]; then
    ln -s "$APP_DIR/public" "$STABLE_DIR/public"
  fi

  # Onboarding assets (CEO/default HEARTBEAT.md, AGENTS.md, SOUL.md) are loaded
  # from the filesystem at runtime via process.cwd() + src/lib/orchestration/...
  # Without this symlink, loadOnboardingAssets returns an empty bucket and the
  # role-specific heartbeat instructions silently disappear from the prompt.
  if [ -d "$APP_DIR/src/lib/orchestration/engine/onboarding-assets" ]; then
    mkdir -p "$STABLE_DIR/src/lib/orchestration/engine"
    ln -s \
      "$APP_DIR/src/lib/orchestration/engine/onboarding-assets" \
      "$STABLE_DIR/src/lib/orchestration/engine/onboarding-assets"
  fi

  write_release_history \
    "$RELEASE_ID" \
    "$RELEASE_TAG" \
    "$RELEASE_COMMIT" \
    "$RELEASE_BRANCH" \
    "$RELEASE_REASON" \
    "$SOURCE_DIR" \
    "$RELEASE_REPO_DIRTY" \
    "$RELEASE_PROMOTED_BY" \
    "$RELEASE_DIRTY_STATUS_FILE"

  record_stable_metadata \
    "$RELEASE_ID" \
    "$RELEASE_TAG" \
    "$RELEASE_COMMIT" \
    "$RELEASE_BRANCH" \
    "$RELEASE_REASON" \
    "$RELEASE_PROMOTED_BY" \
    "$RELEASE_REPO_DIRTY" \
    "$RELEASE_DIRTY_STATUS_FILE"

  assert_release_bookkeeping "$RELEASE_ID" "$RELEASE_TAG"

  echo "[release] Starting stable lane on port 3001..."
  "$START_STABLE_SCRIPT"

  echo "[release] Waiting 8s for stable lane to boot..."
  sleep 8

  if curl -sf --max-time 5 "$HEALTHCHECK_URL" >/dev/null 2>&1; then
    echo "[release] Stable lane is healthy on port 3001"
  else
    echo "[release] WARNING: stable lane may still be booting."
    echo "[release] Check logs at data/hiverunner-stable.log"
  fi

  echo "[release] Current stable release: $RELEASE_TAG ($RELEASE_COMMIT)"
}

capture_dirty_status_file() {
  RELEASE_ID_HINT="$1"
  DIRTY_STATUS_FILE=""
  ensure_release_dirs

  if repo_is_dirty; then
    DIRTY_STATUS_FILE="$RELEASE_HISTORY_DIR/$RELEASE_ID_HINT.dirty-status.txt"
    list_repo_dirty_files > "$DIRTY_STATUS_FILE"
  fi

  printf "%s" "$DIRTY_STATUS_FILE"
}
