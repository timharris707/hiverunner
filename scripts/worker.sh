#!/bin/sh
set -e
API_URL="${API_URL:-http://localhost:3010}"
POLL_INTERVAL="${POLL_INTERVAL:-15}"
echo "[worker] Starting background worker"
echo "[worker] API target: $API_URL"
echo "[worker] Poll interval: ${POLL_INTERVAL}s"
while true; do
  curl -sf "${API_URL}/api/tasks/build" > /dev/null 2>&1 && {
    echo "[worker] $(date -u +%H:%M:%S) reconcile OK"
  } || {
    echo "[worker] $(date -u +%H:%M:%S) reconcile FAILED"
  }
  sleep "$POLL_INTERVAL"
done
