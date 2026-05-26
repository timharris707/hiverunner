#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
MC_APP_ROOT="${MC_APP_ROOT:-}"
ALLOW_DIRTY=0
RELEASE_TAG=""
RECONCILE_LIVE=0

# shellcheck disable=SC1091
. "$SCRIPT_DIR/stable_release_common.sh"

usage() {
  EXIT_CODE="${1:-1}"
  echo "Usage: $0 [--allow-dirty] [--tag <stable/tag-name>] [--reconcile-live]"
  echo ""
  echo "Promotes the current git commit to the stable lane on port 3001."
  echo "Use --reconcile-live to record bookkeeping for the currently running stable lane without rebuilding it."
  echo "By default the repo must be clean so stable maps to a committed checkpoint."
  exit "$EXIT_CODE"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --allow-dirty)
      ALLOW_DIRTY=1
      ;;
    --tag)
      [ "$#" -ge 2 ] || usage
      RELEASE_TAG="$2"
      shift
      ;;
    --reconcile-live)
      RECONCILE_LIVE=1
      ;;
    -h|--help)
      usage 0
      ;;
    *)
      echo "[promote] ERROR: unknown argument: $1" >&2
      usage
      ;;
  esac
  shift
done

cd "$APP_DIR"

echo "╔══════════════════════════════════════════════╗"
echo "║   HiveRunner: Promote to Stable Lane    ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

if [ "$RECONCILE_LIVE" = "1" ]; then
  require_reconcile_git_state "$ALLOW_DIRTY"

  DIRTY_STATUS_FILE="$(capture_dirty_status_file "reconcile-$TIMESTAMP_UTC")"
  REPO_DIRTY=0
  if repo_is_dirty; then
    REPO_DIRTY=1
  fi

  echo "[promote] Reconciling bookkeeping for the live stable lane..."
  reconcile_live_stable_release "$RELEASE_TAG" "promotion" "$REPO_DIRTY" "$DIRTY_STATUS_FILE"
  echo "[promote] Release bookkeeping repaired."
  exit 0
fi

require_expected_git_state "$ALLOW_DIRTY"

RELEASE_COMMIT="$(current_git_commit)"
RELEASE_BRANCH="$(current_git_branch)"
RELEASE_SHORT_COMMIT="$(current_git_short_commit)"
[ -n "$RELEASE_TAG" ] || RELEASE_TAG="$(release_tag_for_commit "$RELEASE_SHORT_COMMIT")"

echo "[promote] Step 1/4: Building production bundle..."
npm run build
echo "[promote] Build complete."

echo "[promote] Step 2/4: Tagging release checkpoint $RELEASE_TAG"
create_release_tag "$RELEASE_TAG" "$RELEASE_COMMIT" "$RELEASE_BRANCH" "promotion"

DIRTY_STATUS_FILE="$(capture_dirty_status_file "promote-$TIMESTAMP_UTC")"
REPO_DIRTY=0
if repo_is_dirty; then
  REPO_DIRTY=1
fi

echo "[promote] Step 3/4: Deploying stable lane..."
deploy_stable_from_dir \
  "$APP_DIR" \
  "$RELEASE_TAG" \
  "$RELEASE_COMMIT" \
  "$RELEASE_BRANCH" \
  "promotion" \
  "$REPO_DIRTY" \
  "$DIRTY_STATUS_FILE"

echo "[promote] Step 4/4: Release checkpoint created."
echo "[promote] Push the checkpoint when ready:"
echo "[promote]   git push origin $RELEASE_TAG"
echo ""
echo "Done. Stable lane promoted from $RELEASE_SHORT_COMMIT."
echo "  Dev:    http://localhost:3010  (unchanged)"
echo "  Stable: http://localhost:3001"
