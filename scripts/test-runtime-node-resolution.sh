#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
# shellcheck source=scripts/lib/runtime-paths.sh
. "$SCRIPT_DIR/lib/runtime-paths.sh"

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/hiverunner-node-resolution.XXXXXX")"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT INT TERM

make_fake_node() {
  TARGET="$1"
  mkdir -p "$(dirname "$TARGET")"
  {
    printf '%s\n' '#!/bin/sh'
    printf '%s\n' 'echo fake-node'
  } > "$TARGET"
  chmod +x "$TARGET"
}

assert_equals() {
  EXPECTED="$1"
  ACTUAL="$2"
  MESSAGE="$3"
  if [ "$EXPECTED" != "$ACTUAL" ]; then
    echo "FAIL: $MESSAGE" >&2
    echo "  expected: $EXPECTED" >&2
    echo "  actual:   $ACTUAL" >&2
    exit 1
  fi
  echo "PASS: $MESSAGE"
}

OVERRIDE_NODE="$TMP_DIR/override/bin/node"
PATH_NODE="$TMP_DIR/path/bin/node"
make_fake_node "$OVERRIDE_NODE"
make_fake_node "$PATH_NODE"

RESOLVED="$(
  HIVERUNNER_NODE_BIN="$OVERRIDE_NODE" \
  NODE_BIN="" \
  HOME="$TMP_DIR/home" \
  PATH="$TMP_DIR/path/bin:/usr/bin:/bin" \
  resolve_hiverunner_node_bin "node-resolution-test"
)"
assert_equals "$OVERRIDE_NODE" "$RESOLVED" "HIVERUNNER_NODE_BIN override wins"

RESOLVED="$(
  HIVERUNNER_NODE_BIN="" \
  NODE_BIN="" \
  HOME="$TMP_DIR/home" \
  PATH="$TMP_DIR/path/bin:/usr/bin:/bin" \
  resolve_hiverunner_node_bin "node-resolution-test"
)"
assert_equals "$PATH_NODE" "$RESOLVED" "PATH node is discovered"

ERROR_LOG="$TMP_DIR/missing-node.err"
if HIVERUNNER_NODE_BIN="$TMP_DIR/missing/node" NODE_BIN="" HOME="$TMP_DIR/home" PATH="/usr/bin:/bin" resolve_hiverunner_node_bin "node-resolution-test" >"$TMP_DIR/missing-node.out" 2>"$ERROR_LOG"; then
  echo "FAIL: missing override should fail" >&2
  exit 1
fi

if ! grep -q "cannot find a usable Node.js binary" "$ERROR_LOG"; then
  echo "FAIL: missing-node error did not explain the failure" >&2
  cat "$ERROR_LOG" >&2
  exit 1
fi

if ! grep -q "HIVERUNNER_NODE_BIN=/absolute/path/to/node" "$ERROR_LOG"; then
  echo "FAIL: missing-node error did not explain HIVERUNNER_NODE_BIN" >&2
  cat "$ERROR_LOG" >&2
  exit 1
fi

echo "PASS: missing node gives a helpful error"
