# HiveRunner Voice Avatar Backend

HiveRunner voice is optional. The core app can boot, create workspaces, create
starter teams, and run local/manual workflows without any voice provider keys or
avatar backend.

The optional Pipecat backend in `pipecat-server/` can provide a talking avatar
session when an operator supplies their own provider keys.

## Supported Optional Stack

| Piece | Purpose | Required For Core Boot? |
|---|---|---:|
| `GOOGLE_API_KEY` | Gemini LLM inside the Pipecat backend | No |
| `DEEPGRAM_API_KEY` | Speech-to-text | No |
| `CARTESIA_API_KEY` | Text-to-speech | No |
| `TAVUS_API_KEY` | Avatar video | No |
| `DAILY_API_KEY` | WebRTC room and token creation | No |

## Setup

```bash
cd pipecat-server
./setup.sh
cp .env.example .env
# Fill in your own provider keys.
./start.sh
```

The main HiveRunner app proxies the backend at `/api/voice/avatar`. By default
it expects the backend at `http://127.0.0.1:8108`; set `PIPECAT_URL` in the main
app `.env.local` to point somewhere else.

## Graceful Degradation

If the backend is not running or provider keys are missing:

- HiveRunner core onboarding still works.
- `/api/voice/avatar` reports that the optional backend is unavailable.
- The voice UI should present this as setup-required, not as an app boot
  failure.

Use `/HIVE/runtime-inventory` and `/HIVE/hives` for runtime readiness. Voice
provider keys are separate from agent runtime CLIs.
