# HiveRunner Voice - Optional Pipecat Backend

This directory contains an optional local voice-avatar backend for HiveRunner.
HiveRunner itself boots and works without this service. Enable it only when you
want browser voice sessions backed by Pipecat, Daily WebRTC, Deepgram, Gemini,
Cartesia, and Tavus.

## Architecture

```text
Browser
  <-> Daily.co WebRTC
Pipecat backend
  -> Deepgram STT
  -> Gemini LLM
  -> Cartesia TTS
  -> Tavus avatar video
  <-> Daily.co WebRTC
Browser receives voice audio and avatar video
```

## Quick Start

```bash
cd pipecat-server
./setup.sh
cp .env.example .env
# Fill in your own provider keys in .env.
./start.sh
```

The HiveRunner app proxies this backend through `/api/voice/avatar`. The
default backend URL is `http://127.0.0.1:8108`; override it in the main app with
`PIPECAT_URL`.

## Required Provider Keys

| Key | Required For | Where To Configure |
|---|---|---|
| `TAVUS_API_KEY` | Avatar video session | `pipecat-server/.env` |
| `GOOGLE_API_KEY` | Gemini LLM response generation | `pipecat-server/.env` |
| `DEEPGRAM_API_KEY` | Speech-to-text | `pipecat-server/.env` |
| `CARTESIA_API_KEY` | Text-to-speech | `pipecat-server/.env` |
| `DAILY_API_KEY` | WebRTC room and token creation | `pipecat-server/.env` |

Missing keys do not break HiveRunner core onboarding. They only prevent this
optional backend from starting a live voice-avatar session.

## Configuration

| Env Var | Default | Description |
|---|---|---|
| `HOST` | `0.0.0.0` | Backend bind address |
| `PORT` | `8108` | Backend port |
| `TAVUS_REPLICA_ID` | Tavus stock example replica | Tavus replica to render |
| `CARTESIA_VOICE_ID` | Cartesia example voice | Voice used by Cartesia TTS |
| `HIVERUNNER_VOICE_BOT_NAME` | `HiveRunner Voice` | Display name inside the Daily room |
| `HIVERUNNER_VOICE_SYSTEM_PROMPT` | built-in neutral prompt | Optional prompt override |
| `HIVERUNNER_VOICE_CORS_ORIGINS` | `http://localhost:3010,http://localhost:3001` | Comma-separated allowed frontend origins |

## API

### `GET /health`

Returns local backend liveness and active session count. It does not verify or
call every provider.

### `POST /start`

Creates a Daily room, starts the Pipecat bot, and returns:

```json
{
  "room_url": "https://example.daily.co/room",
  "room_name": "room",
  "user_token": "token"
}
```

## Development

```bash
uv pip install -e ".[dev]"
ruff check .
ruff format .
```
