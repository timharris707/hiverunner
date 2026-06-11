#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
MC_APP_ROOT="${MC_APP_ROOT:-}"
ALLOW_DIRTY=0
RELEASE_TAG=""
RECONCILE_LIVE=0
TRACKED_BUILD=0
BUILD_SOURCE_DIR=""
BUILD_TMP_DIR=""

# shellcheck disable=SC1091
. "$SCRIPT_DIR/stable_release_common.sh"

usage() {
  EXIT_CODE="${1:-1}"
  echo "Usage: $0 [--allow-dirty] [--tag <stable/tag-name>] [--reconcile-live] [--tracked-build]"
  echo ""
  echo "Promotes the current git commit to the stable lane on port 3001."
  echo "Use --reconcile-live to record bookkeeping for the currently running stable lane without rebuilding it."
  echo "Use --tracked-build to build from a temporary git-archive export of committed files only."
  echo "By default the repo must be clean so stable maps to a committed checkpoint."
  echo ""
  echo "Runtime gate env:"
  echo "  HIVERUNNER_RUNTIME_PROMOTION_GATE=1"
  echo "  HIVERUNNER_RUNTIME_PROMOTION_GOAL=<goal-key> (required when the gate is enabled; the goal the benchmark runs are scoped to)"
  echo "  HIVERUNNER_RUNTIME_PROMOTION_CANDIDATE_SUMMARIES=<json paths, comma or newline separated>"
  echo "  HIVERUNNER_RUNTIME_PROMOTION_BASELINE_SUMMARIES=<json paths, comma or newline separated>"
  echo "  HIVERUNNER_RUNTIME_PROMOTION_EVIDENCE=<promotion-evidence.json>"
  echo "  HIVERUNNER_RUNTIME_PROMOTION_REQUIRED_REPEATS=3"
  echo "  HIVERUNNER_RUNTIME_PROMOTION_EXPECTED_TASKS=10"
  echo "  HIVERUNNER_RUNTIME_PROMOTION_GATE_ONLY=1 validates the gate and exits before build/deploy."
  exit "$EXIT_CODE"
}

shell_quote() {
  SHELL_QUOTE_VALUE="$(printf "%s" "$1" | sed "s/'/'\\\\''/g")"
  printf "'%s'" "$SHELL_QUOTE_VALUE"
}

append_gate_arg() {
  GATE_CMD="$GATE_CMD $(shell_quote "$1") $(shell_quote "$2")"
}

append_gate_path_list() {
  GATE_LIST_FLAG="$1"
  GATE_LIST_VALUES="$2"
  [ -n "$GATE_LIST_VALUES" ] || return 0

  GATE_LIST_NORMALIZED="$(printf "%s\n" "$GATE_LIST_VALUES" | tr ',' '\n')"
  while IFS= read -r GATE_LIST_VALUE; do
    GATE_LIST_VALUE="$(printf "%s" "$GATE_LIST_VALUE" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    [ -n "$GATE_LIST_VALUE" ] || continue
    append_gate_arg "$GATE_LIST_FLAG" "$GATE_LIST_VALUE"
    GATE_PATH_COUNT=$((GATE_PATH_COUNT + 1))
  done <<EOF
$GATE_LIST_NORMALIZED
EOF
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
    --tracked-build)
      TRACKED_BUILD=1
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

if [ "${HIVERUNNER_RUNTIME_PROMOTION_GATE:-0}" = "1" ] && [ "${HIVERUNNER_RUNTIME_PROMOTION_GATE_ONLY:-0}" = "1" ]; then
  require_git_repo
else
  require_expected_git_state "$ALLOW_DIRTY"
fi

if [ "${HIVERUNNER_RUNTIME_PROMOTION_GATE:-0}" = "1" ]; then
  RUNTIME_PROMOTION_DB="${HIVERUNNER_RUNTIME_PROMOTION_DB:-${ORCHESTRATION_DB_PATH:-$APP_DIR/data/orchestration.db}}"
  RUNTIME_PROMOTION_BASELINE_DB="${HIVERUNNER_RUNTIME_PROMOTION_BASELINE_DB:-}"
  RUNTIME_PROMOTION_CANDIDATE_SUMMARY="${HIVERUNNER_RUNTIME_PROMOTION_CANDIDATE_SUMMARY:-}"
  RUNTIME_PROMOTION_CANDIDATE_SUMMARIES="${HIVERUNNER_RUNTIME_PROMOTION_CANDIDATE_SUMMARIES:-}"
  RUNTIME_PROMOTION_BASELINE_SUMMARY="${HIVERUNNER_RUNTIME_PROMOTION_BASELINE_SUMMARY:-}"
  RUNTIME_PROMOTION_BASELINE_SUMMARIES="${HIVERUNNER_RUNTIME_PROMOTION_BASELINE_SUMMARIES:-}"
  RUNTIME_PROMOTION_EVIDENCE="${HIVERUNNER_RUNTIME_PROMOTION_EVIDENCE:-}"
  RUNTIME_PROMOTION_GOAL="${HIVERUNNER_RUNTIME_PROMOTION_GOAL:-}"
  RUNTIME_PROMOTION_OUT="${HIVERUNNER_RUNTIME_PROMOTION_OUT:-$APP_DIR/output/runtime-promotion-gate.md}"
  RUNTIME_PROMOTION_REQUIRED_REPEATS="${HIVERUNNER_RUNTIME_PROMOTION_REQUIRED_REPEATS:-3}"
  RUNTIME_PROMOTION_EXPECTED_TASKS="${HIVERUNNER_RUNTIME_PROMOTION_EXPECTED_TASKS:-10}"
  RUNTIME_PROMOTION_FORMAT="${HIVERUNNER_RUNTIME_PROMOTION_FORMAT:-markdown}"
  RUNTIME_PROMOTION_GATE_ONLY="${HIVERUNNER_RUNTIME_PROMOTION_GATE_ONLY:-0}"

  echo "[promote] Runtime promotion gate enabled."

  GATE_CMD="node ./scripts/run-tsx.mjs scripts/runtime-promotion-gate.ts"

  GATE_PATH_COUNT=0
  append_gate_path_list "--candidate-summary" "$RUNTIME_PROMOTION_CANDIDATE_SUMMARY"
  append_gate_path_list "--candidate-summary" "$RUNTIME_PROMOTION_CANDIDATE_SUMMARIES"
  RUNTIME_PROMOTION_CANDIDATE_SUMMARY_COUNT="$GATE_PATH_COUNT"
  if [ "$RUNTIME_PROMOTION_CANDIDATE_SUMMARY_COUNT" -eq 0 ]; then
    append_gate_arg "--db" "$RUNTIME_PROMOTION_DB"
  fi

  GATE_PATH_COUNT=0
  append_gate_path_list "--baseline-summary" "$RUNTIME_PROMOTION_BASELINE_SUMMARY"
  append_gate_path_list "--baseline-summary" "$RUNTIME_PROMOTION_BASELINE_SUMMARIES"
  RUNTIME_PROMOTION_BASELINE_SUMMARY_COUNT="$GATE_PATH_COUNT"
  if [ "$RUNTIME_PROMOTION_BASELINE_SUMMARY_COUNT" -eq 0 ]; then
    if [ -n "$RUNTIME_PROMOTION_BASELINE_DB" ]; then
      append_gate_arg "--baseline-db" "$RUNTIME_PROMOTION_BASELINE_DB"
    else
      echo "[promote] ERROR: HIVERUNNER_RUNTIME_PROMOTION_GATE=1 requires HIVERUNNER_RUNTIME_PROMOTION_BASELINE_DB, HIVERUNNER_RUNTIME_PROMOTION_BASELINE_SUMMARY, or HIVERUNNER_RUNTIME_PROMOTION_BASELINE_SUMMARIES." >&2
      exit 1
    fi
  fi

  if [ -n "$RUNTIME_PROMOTION_EVIDENCE" ]; then
    append_gate_arg "--evidence" "$RUNTIME_PROMOTION_EVIDENCE"
  else
    echo "[promote] ERROR: HIVERUNNER_RUNTIME_PROMOTION_GATE=1 requires HIVERUNNER_RUNTIME_PROMOTION_EVIDENCE." >&2
    exit 1
  fi

  if [ -z "$RUNTIME_PROMOTION_GOAL" ]; then
    echo "[promote] ERROR: HIVERUNNER_RUNTIME_PROMOTION_GATE=1 requires HIVERUNNER_RUNTIME_PROMOTION_GOAL (the goal key the benchmark runs are scoped to)." >&2
    exit 1
  fi

  append_gate_arg "--goal" "$RUNTIME_PROMOTION_GOAL"
  append_gate_arg "--required-repeats" "$RUNTIME_PROMOTION_REQUIRED_REPEATS"
  append_gate_arg "--expected-tasks" "$RUNTIME_PROMOTION_EXPECTED_TASKS"
  append_gate_arg "--format" "$RUNTIME_PROMOTION_FORMAT"
  append_gate_arg "--out" "$RUNTIME_PROMOTION_OUT"

  echo "[promote] Runtime promotion gate inputs: candidate_summaries=$RUNTIME_PROMOTION_CANDIDATE_SUMMARY_COUNT baseline_summaries=$RUNTIME_PROMOTION_BASELINE_SUMMARY_COUNT evidence=$RUNTIME_PROMOTION_EVIDENCE"
  eval "$GATE_CMD"
  echo "[promote] Runtime promotion gate passed: $RUNTIME_PROMOTION_OUT"
  if [ "$RUNTIME_PROMOTION_GATE_ONLY" = "1" ]; then
    echo "[promote] Runtime promotion gate-only mode complete; skipping build/deploy."
    exit 0
  fi
fi

RELEASE_COMMIT="$(current_git_commit)"
RELEASE_BRANCH="$(current_git_branch)"
RELEASE_SHORT_COMMIT="$(current_git_short_commit)"
[ -n "$RELEASE_TAG" ] || RELEASE_TAG="$(release_tag_for_commit "$RELEASE_SHORT_COMMIT")"

cleanup_build_tmp() {
  if [ -n "$BUILD_TMP_DIR" ] && [ -d "$BUILD_TMP_DIR" ]; then
    rm -rf "$BUILD_TMP_DIR"
  fi
}

prepare_tracked_build_source() {
  BUILD_TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/hiverunner-stable-promote.XXXXXX")"
  echo "[promote] Exporting tracked source to $BUILD_TMP_DIR"
  git archive "$RELEASE_COMMIT" | tar -x -C "$BUILD_TMP_DIR"
  prepare_build_runtime "$BUILD_TMP_DIR"
  BUILD_SOURCE_DIR="$BUILD_TMP_DIR"
}

trap cleanup_build_tmp EXIT INT TERM

BUILD_SOURCE_DIR="$APP_DIR"
if [ "$TRACKED_BUILD" = "1" ]; then
  prepare_tracked_build_source
fi

echo "[promote] Step 1/4: Building production bundle..."
(cd "$BUILD_SOURCE_DIR" && npm run build)
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
  "$BUILD_SOURCE_DIR" \
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
