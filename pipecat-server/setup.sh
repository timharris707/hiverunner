#!/usr/bin/env bash
# setup.sh - Create venv and install dependencies for HiveRunner Voice.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "HiveRunner Voice - Pipecat backend setup"
echo "========================================"

# Check Python version — need 3.12 (3.14 breaks llvmlite/numba)
PYTHON=${PYTHON:-python3.12}
PY_VERSION=$($PYTHON --version 2>&1 | grep -oE '[0-9]+\.[0-9]+')
echo "Python: $($PYTHON --version)"

# Use uv for fast installs
if ! command -v uv &>/dev/null; then
    echo "uv not found. Install it: curl -LsSf https://astral.sh/uv/install.sh | sh"
    exit 1
fi
echo "uv: $(uv --version)"

# Create venv if needed
if [ ! -d ".venv" ]; then
    echo ""
    echo "Creating virtual environment..."
    uv venv --python "$PYTHON"
fi

# Install dependencies
echo ""
echo "Installing dependencies..."
uv pip install -r <(python3 -c "
import tomllib, sys
with open('pyproject.toml', 'rb') as f:
    d = tomllib.load(f)
for dep in d['project']['dependencies']:
    print(dep)
") 2>/dev/null || uv pip install \
    'pipecat-ai[tavus,google,deepgram,cartesia,daily,silero]' \
    'fastapi>=0.115.0' \
    'uvicorn[standard]>=0.34.0' \
    'aiohttp>=3.10.0' \
    'python-dotenv>=1.0.0' \
    'loguru>=0.7.0' \
    'httpx>=0.27.0'

echo ""
echo "Setup complete."
echo ""
echo "Next steps:"
echo "  1. Copy .env.example to .env and fill in your own provider keys"
echo ""
echo "  2. Required API keys:"
echo "     TAVUS_API_KEY     - https://www.tavus.io/"
echo "     GOOGLE_API_KEY    - https://ai.google.dev/"
echo "     DEEPGRAM_API_KEY  - https://console.deepgram.com/"
echo "     CARTESIA_API_KEY  - https://play.cartesia.ai/"
echo "     DAILY_API_KEY     - https://dashboard.daily.co/"
echo ""
echo "  3. Run: ./start.sh"
