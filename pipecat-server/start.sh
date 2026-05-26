#!/usr/bin/env bash
# Start the optional HiveRunner Voice Pipecat backend.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "HiveRunner Voice - Pipecat backend"
echo "==================================="

if [ -f ".env" ]; then
  set -a
  # shellcheck disable=SC1091
  source ".env"
  set +a
fi

export HOST="${HOST:-0.0.0.0}"
export PORT="${PORT:-8108}"
export HIVERUNNER_VOICE_BOT_NAME="${HIVERUNNER_VOICE_BOT_NAME:-HiveRunner Voice}"

echo ""
READY=true
for key in TAVUS_API_KEY GOOGLE_API_KEY DEEPGRAM_API_KEY CARTESIA_API_KEY DAILY_API_KEY; do
  val="${!key:-}"
  if [ -n "$val" ]; then
    echo "  ok: $key"
  else
    echo "  missing: $key"
    READY=false
  fi
done

if [ "$READY" != "true" ]; then
  echo ""
  echo "Missing provider keys. HiveRunner can still run, but /start will return a setup error."
  echo "Copy .env.example to .env, fill in your own provider keys, and restart this backend."
fi

if [ ! -d ".venv" ]; then
  echo ""
  echo "No .venv found. Run ./setup.sh first."
  exit 1
fi

# shellcheck disable=SC1091
source .venv/bin/activate

echo ""
echo "Starting backend on ${HOST}:${PORT}"
echo "  POST /start  - create voice session"
echo "  GET  /health - health check"
echo ""

exec python server.py
