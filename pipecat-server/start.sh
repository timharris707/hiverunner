#!/usr/bin/env bash
# start.sh — Load env from macOS Keychain and start the Henry Avatar server
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ─── Keychain helper ────────────────────────────────────────────────
KEYCHAIN_SCRIPT="/Users/timharris/.openclaw/workspace/scripts/keychain.sh"

get_key() {
    local key="$1"
    if [ -x "$KEYCHAIN_SCRIPT" ]; then
        "$KEYCHAIN_SCRIPT" get "$key" 2>/dev/null || echo ""
    else
        echo ""
    fi
}

echo "⚡ Henry Avatar — Pipecat Server"
echo "================================="

# ─── Load from Keychain ─────────────────────────────────────────────
echo "🔑 Loading API keys from Keychain..."

# Keys we have in keychain
export TAVUS_API_KEY="${TAVUS_API_KEY:-$(get_key TAVUS_API_KEY)}"
export GOOGLE_API_KEY="${GOOGLE_API_KEY:-$(get_key GOOGLE_AI_API_KEY)}"

# Keys that may or may not be in keychain yet
export DEEPGRAM_API_KEY="${DEEPGRAM_API_KEY:-$(get_key DEEPGRAM_API_KEY)}"
export CARTESIA_API_KEY="${CARTESIA_API_KEY:-$(get_key CARTESIA_API_KEY)}"
export DAILY_API_KEY="${DAILY_API_KEY:-$(get_key DAILY_API_KEY)}"

# ─── Config defaults ────────────────────────────────────────────────
export TAVUS_REPLICA_ID="${TAVUS_REPLICA_ID:-rf4703150052}"
export HOST="${HOST:-0.0.0.0}"
export PORT="${PORT:-8108}"

# ─── Validate ────────────────────────────────────────────────────────
echo ""
READY=true
for key in TAVUS_API_KEY GOOGLE_API_KEY DEEPGRAM_API_KEY CARTESIA_API_KEY DAILY_API_KEY; do
    val="${!key}"
    if [ -n "$val" ]; then
        echo "  ✅ $key"
    else
        echo "  ❌ $key — missing!"
        READY=false
    fi
done

if [ "$READY" != "true" ]; then
    echo ""
    echo "⚠️  Some API keys are missing. The server will start but /start will fail."
    echo "   Add missing keys: ../../scripts/keychain.sh set KEY_NAME value"
    echo ""
fi

# ─── Activate venv ───────────────────────────────────────────────────
if [ ! -d ".venv" ]; then
    echo ""
    echo "❌ No .venv found. Run ./setup.sh first."
    exit 1
fi

source .venv/bin/activate

# ─── Start ───────────────────────────────────────────────────────────
echo ""
echo "🚀 Starting server on ${HOST}:${PORT}..."
echo "   POST /start  → Create voice session"
echo "   GET  /health → Health check"
echo ""

exec python server.py
