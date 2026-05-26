#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
MC_APP_ROOT="${MC_APP_ROOT:-}"
TMP_ROOT="${TMPDIR:-/tmp}"
ALLOW_DIRTY=0
DRY_RUN=0
INSPECT_ONLY=0
TARGET_TAG=""
TARGET_COMMIT=""

# shellcheck disable=SC1091
. "$SCRIPT_DIR/stable_release_common.sh"

REPO_DIR="$APP_DIR"

usage() {
  EXIT_CODE="${1:-1}"
  echo "Usage: $0 [--inspect] [--dry-run] [--allow-dirty] [--to-tag <tag>] [--to-commit <commit>]"
  echo ""
  echo "Defaults to the previous promoted stable checkpoint recorded in data/releases/stable/current.env."
  echo "Use --inspect to print the current and previous promoted checkpoint metadata."
  echo "Examples:"
  echo "  $0 --inspect"
  echo "  $0 --dry-run"
  echo "  $0"
  echo "  $0 --to-tag stable/20260402T120000Z-abc1234"
  echo "  $0 --to-commit abc1234"
  exit "$EXIT_CODE"
}

print_release_value() {
  LABEL="$1"
  VALUE="$2"
  if [ -n "$VALUE" ]; then
    printf '[rollback]   %-12s %s\n' "$LABEL:" "$VALUE"
  else
    printf '[rollback]   %-12s %s\n' "$LABEL:" "(none)"
  fi
}

inspect_release_state() {
  if [ ! -f "$CURRENT_RELEASE_FILE" ]; then
    echo "[rollback] No stable promotion metadata is recorded yet."
    echo "[rollback] Promote stable at least once before using default rollback."
    return 0
  fi

  # shellcheck disable=SC1090
  . "$CURRENT_RELEASE_FILE"

  echo "[rollback] Current promoted checkpoint"
  print_release_value "tag" "${RELEASE_TAG:-}"
  print_release_value "commit" "${RELEASE_COMMIT:-}"
  print_release_value "branch" "${RELEASE_BRANCH:-}"
  print_release_value "reason" "${RELEASE_REASON:-}"
  print_release_value "promoted_at" "${RELEASE_PROMOTED_AT:-}"
  echo "[rollback] Previous promoted checkpoint"
  print_release_value "tag" "${PREVIOUS_RELEASE_TAG:-}"
  print_release_value "commit" "${PREVIOUS_RELEASE_COMMIT:-}"
  print_release_value "branch" "${PREVIOUS_RELEASE_BRANCH:-}"
  print_release_value "reason" "${PREVIOUS_RELEASE_REASON:-}"
  print_release_value "promoted_at" "${PREVIOUS_RELEASE_PROMOTED_AT:-}"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --inspect)
      INSPECT_ONLY=1
      ;;
    --dry-run)
      DRY_RUN=1
      ;;
    --allow-dirty)
      ALLOW_DIRTY=1
      ;;
    --to-tag)
      [ "$#" -ge 2 ] || usage
      TARGET_TAG="$2"
      shift
      ;;
    --to-commit)
      [ "$#" -ge 2 ] || usage
      TARGET_COMMIT="$2"
      shift
      ;;
    -h|--help)
      usage 0
      ;;
    *)
      echo "[rollback] ERROR: unknown argument: $1" >&2
      usage
      ;;
  esac
  shift
done

if [ "$INSPECT_ONLY" = "1" ]; then
  inspect_release_state
  exit 0
fi

resolve_default_target() {
  if [ -f "$CURRENT_RELEASE_FILE" ]; then
    # shellcheck disable=SC1090
    . "$CURRENT_RELEASE_FILE"
    if [ -n "${PREVIOUS_RELEASE_TAG:-}" ]; then
      TARGET_TAG="$PREVIOUS_RELEASE_TAG"
      return 0
    fi
    if [ -n "${PREVIOUS_RELEASE_COMMIT:-}" ]; then
      TARGET_COMMIT="$PREVIOUS_RELEASE_COMMIT"
      return 0
    fi
  fi

  echo "[rollback] ERROR: default rollback needs a previous promoted checkpoint, but none is recorded yet." >&2
  if [ -f "$CURRENT_RELEASE_FILE" ]; then
    echo "[rollback] This usually means stable has only been promoted once, so the current checkpoint has no older promoted checkpoint to roll back to." >&2
    inspect_release_state >&2
  else
    echo "[rollback] No stable promotion metadata exists yet, so there is no recorded current or previous checkpoint." >&2
  fi
  echo "[rollback] Next steps:" >&2
  echo "[rollback]   1. Promote stable again to create a second promoted checkpoint for future default rollback." >&2
  echo "[rollback]   2. Or roll back explicitly with --to-tag <stable/...> or --to-commit <sha>." >&2
  echo "[rollback]   3. Use --inspect to review the recorded current/previous checkpoint metadata." >&2
  exit 1
}

if [ -n "$TARGET_TAG" ] && [ -n "$TARGET_COMMIT" ]; then
  echo "[rollback] ERROR: specify either --to-tag or --to-commit, not both." >&2
  exit 1
fi

if [ -z "$TARGET_TAG" ] && [ -z "$TARGET_COMMIT" ]; then
  resolve_default_target
fi

require_expected_git_state "$ALLOW_DIRTY"

if [ -n "$TARGET_TAG" ]; then
  TARGET_COMMIT="$(git -C "$REPO_DIR" rev-list -n 1 "$TARGET_TAG" 2>/dev/null || true)"
  if [ -z "$TARGET_COMMIT" ]; then
    echo "[rollback] ERROR: tag not found: $TARGET_TAG" >&2
    exit 1
  fi
else
  TARGET_COMMIT="$(git -C "$REPO_DIR" rev-parse "$TARGET_COMMIT^{commit}" 2>/dev/null || true)"
  if [ -z "$TARGET_COMMIT" ]; then
    echo "[rollback] ERROR: commit not found." >&2
    exit 1
  fi
  TARGET_TAG="manual/$TARGET_COMMIT"
fi

TARGET_BRANCH="$(git -C "$REPO_DIR" branch --contains "$TARGET_COMMIT" --format='%(refname:short)' | head -n 1 || true)"
[ -n "$TARGET_BRANCH" ] || TARGET_BRANCH="detached"

echo "[rollback] Target checkpoint"
echo "[rollback]   tag:    $TARGET_TAG"
echo "[rollback]   commit: $TARGET_COMMIT"
echo "[rollback]   branch: $TARGET_BRANCH"

if [ "$DRY_RUN" = "1" ]; then
  echo "[rollback] Dry run only. No files or processes were changed."
  exit 0
fi

WORKTREE_DIR="$(mktemp -d "$TMP_ROOT/hiverunner-stable-rollback.XXXXXX")"
cleanup() {
  git -C "$REPO_DIR" worktree remove --force "$WORKTREE_DIR" >/dev/null 2>&1 || rm -rf "$WORKTREE_DIR"
}
trap cleanup EXIT INT TERM

echo "[rollback] Creating temporary worktree at $WORKTREE_DIR"
git -C "$REPO_DIR" worktree add --detach "$WORKTREE_DIR" "$TARGET_COMMIT" >/dev/null

prepare_build_runtime "$WORKTREE_DIR"

echo "[rollback] Building target checkpoint..."
(cd "$WORKTREE_DIR" && npm run build)

DIRTY_STATUS_FILE="$(capture_dirty_status_file "rollback-$TIMESTAMP_UTC")"
REPO_DIRTY=0
if repo_is_dirty; then
  REPO_DIRTY=1
fi

deploy_stable_from_dir \
  "$WORKTREE_DIR" \
  "$TARGET_TAG" \
  "$TARGET_COMMIT" \
  "$TARGET_BRANCH" \
  "rollback" \
  "$REPO_DIRTY" \
  "$DIRTY_STATUS_FILE"

echo "[rollback] Stable lane rolled back to $TARGET_TAG"
