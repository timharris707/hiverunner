# Henry Avatar — Pipecat + Tavus Server

Real-time talking-head avatar for Henry ⚡, powered by [Pipecat](https://github.com/pipecat-ai/pipecat) and [Tavus CVI](https://www.tavus.io/).

## Architecture

```
User (browser)
  ↕ Daily.co WebRTC
Bot (this server)
  ├── Deepgram STT (speech → text)
  ├── Gemini LLM (text → response text)
  ├── Cartesia TTS (response text → speech audio)
  └── Tavus Video (speech audio → lip-synced avatar video)
  ↕ Daily.co WebRTC
User sees: talking Henry avatar + hears his voice
```

## Quick Start

```bash
# 1. Install dependencies
./setup.sh

# 2. Add API keys to keychain
../../scripts/keychain.sh set DEEPGRAM_API_KEY dgp_xxx
../../scripts/keychain.sh set CARTESIA_API_KEY sk_car_xxx
../../scripts/keychain.sh set DAILY_API_KEY xxx

# 3. Start the server
./start.sh
```

## API

### `POST /start`
Creates a new voice avatar session. Returns:
```json
{
  "room_url": "https://harrisa.daily.co/abc123",
  "room_name": "abc123",
  "user_token": "eyJ..."
}
```

The frontend joins `room_url` with `user_token` using the Daily.co JS SDK.

### `GET /health`
```json
{
  "status": "ok",
  "uptime": 123.4,
  "active_sessions": 1
}
```

## Required API Keys

| Key | Status | Sign Up |
|-----|--------|---------|
| `TAVUS_API_KEY` | ✅ Have it | [tavus.io](https://www.tavus.io/) |
| `GOOGLE_API_KEY` | ✅ Have it | [ai.google.dev](https://ai.google.dev/) |
| `DEEPGRAM_API_KEY` | ❌ Need it | [console.deepgram.com](https://console.deepgram.com/) — $200 free credit |
| `CARTESIA_API_KEY` | ❌ Need it | [play.cartesia.ai](https://play.cartesia.ai/) — free tier |
| `DAILY_API_KEY` | ❌ Need it | [dashboard.daily.co](https://dashboard.daily.co/) — 10K min/mo free |

## Configuration

| Env Var | Default | Description |
|---------|---------|-------------|
| `TAVUS_REPLICA_ID` | `rf4703150052` | Stock "Charlie" replica |
| `CARTESIA_VOICE_ID` | `a0e99841-...` | "Barbershop Man" voice |
| `HOST` | `0.0.0.0` | Server bind address |
| `PORT` | `8108` | Server port |

## Development

```bash
# Install with dev deps
uv pip install -e ".[dev]"

# Lint
ruff check .

# Format
ruff format .
```
