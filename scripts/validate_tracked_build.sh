#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"

KEEP=0
REF="HEAD"
TMP_PARENT="${TMPDIR:-/tmp}"

usage() {
  cat <<'USAGE'
Usage: scripts/validate_tracked_build.sh [--keep] [--ref <git-ref>] [--tmp-parent <dir>]

Exports only tracked files from the selected git ref into a temp directory,
installs dependencies from package-lock.json, then runs the public local
validation chain:

  npm ci
  npm audit --json
  npx tsc --noEmit --incremental false --pretty false
  npm run build

Options:
  --keep              Keep the temp directory for debugging.
  --ref <git-ref>    Git ref to export. Defaults to HEAD.
  --tmp-parent <dir> Parent directory for the temp export. Defaults to TMPDIR or /tmp.
  -h, --help         Show this help.
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --keep)
      KEEP=1
      shift
      ;;
    --ref)
      [ "$#" -ge 2 ] || { echo "Missing value for --ref" >&2; exit 2; }
      REF="$2"
      shift 2
      ;;
    --tmp-parent)
      [ "$#" -ge 2 ] || { echo "Missing value for --tmp-parent" >&2; exit 2; }
      TMP_PARENT="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

command -v git >/dev/null 2>&1 || { echo "git is required" >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "npm is required" >&2; exit 1; }
command -v tar >/dev/null 2>&1 || { echo "tar is required" >&2; exit 1; }

mkdir -p "$TMP_PARENT"
TMP_DIR="$(mktemp -d "$TMP_PARENT/hiverunner-tracked-build.XXXXXX")"

cleanup() {
  if [ "$KEEP" -eq 1 ]; then
    echo "[tracked-build] kept temp directory: $TMP_DIR"
  else
    rm -rf "$TMP_DIR"
  fi
}
trap cleanup EXIT INT TERM

echo "[tracked-build] repo: $REPO_ROOT"
echo "[tracked-build] ref: $REF"
echo "[tracked-build] temp: $TMP_DIR"
echo "[tracked-build] node: $(node -v 2>/dev/null || echo unavailable)"
echo "[tracked-build] npm: $(npm -v 2>/dev/null || echo unavailable)"

cd "$REPO_ROOT"
git rev-parse --verify "$REF" >/dev/null

echo "[tracked-build] exporting tracked files"
git archive "$REF" | tar -x -C "$TMP_DIR"

cd "$TMP_DIR"

if [ ! -f package-lock.json ]; then
  echo "[tracked-build] package-lock.json missing from tracked export" >&2
  exit 1
fi

echo "[tracked-build] npm ci"
npm ci

echo "[tracked-build] npm audit --json"
npm audit --json

echo "[tracked-build] typecheck"
npx tsc --noEmit --incremental false --pretty false

echo "[tracked-build] build"
npm run build

echo "[tracked-build] ok"
