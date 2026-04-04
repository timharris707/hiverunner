# Henry Avatar Integration Scaffold (Gemini Live + Video-Call Avatar Abstraction)

Status: **experimental scaffold** (mock provider works, external providers are placeholders)

Design bias: **Zoom-style live call sessions** where Tim webcam + Henry video avatar are both first-class participants.

## What shipped

- `src/lib/avatar-session.ts`
  - Provider abstraction for avatar render backends (`mock`, `fal-musetalk`, `replicate-musetalk`, `selfhost-musetalk`)
  - Runtime env detection for future providers (`FAL_KEY`, `REPLICATE_API_TOKEN`, `MUSE_TALK_BASE_URL`)
  - Call-session envelope generator (`buildAvatarSession`) with explicit call mode + participant tracks
  - Transport preference field for realtime-friendly integrations (`webrtc`, `websocket`, `http`)
- `GET /api/avatar/session`
  - Discovery/status endpoint for provider selection + capabilities
  - Includes call profile metadata for video-call composition
- `POST /api/avatar/session`
  - Returns placeholder call-session metadata (no provider call yet)
- `POST /api/voice/session`
  - Now includes additive `avatar` bootstrap info, without changing existing voice fields

## API contracts

### `GET /api/avatar/session`
Returns:
- `selectedProvider`
- `providers[]` with `status`, `configured`, and capability flags
- `callProfile` with expected tracks for Tim + Henry + Gemini audio
- `notes` for UI messaging

### `POST /api/avatar/session`
Request (optional):
```json
{
  "provider": "mock",
  "voiceSessionId": "voice_123",
  "callSessionId": "call_123",
  "persona": "henry-v1",
  "preferredTransport": "webrtc"
}
```
Response includes:
- `sessionId`
- `callSessionId`
- `provider`
- `mode` (`mock` or `experimental`)
- `call` section (video-call intent + expected media tracks)
- `transport` placeholder (mock / provider-webrtc / provider-websocket / provider-http)
- `sync` strategy placeholder
- `warnings[]`

## Env knobs

- `HENRY_AVATAR_PROVIDER` — optional preferred provider id (`mock` default)
- `FAL_KEY` — marks fal provider as configured
- `REPLICATE_API_TOKEN` — marks Replicate provider as configured
- `MUSE_TALK_BASE_URL` — marks self-host provider as configured

## Pixel handoff notes

- UI can call `GET /api/avatar/session` to drive provider chooser / badges + call layout defaults.
- On “start call mode”, call `POST /api/avatar/session`; store `sessionId`, `callSessionId`, `provider`, and `transport`.
- Build call UI with explicit tracks:
  - local webcam tile (Tim)
  - Henry avatar tile
  - Gemini/Henry audio state indicator
- For tonight, render mock UX states from `mode` + `warnings`.
- Later, when realtime adapters land, keep this API shape and swap only the provider internals.

## Next backend steps for real lip-sync/video

1. Add provider adapters behind this abstraction (`startSession`, `pushAudio`, `stopSession`, `getTrack`).
2. Establish call orchestration contract:
   - Tim local media negotiation (WebRTC)
   - Henry provider media negotiation (WebRTC or WS frames)
   - Gemini Live audio stream sync clock
3. Move from transcript timing to phoneme/viseme events for accurate mouth motion.
4. Add low-latency transport contract (WebRTC first, WS fallback) for frame/event delivery.
5. Add auth/request signing per provider and robust retry/rate-limit handling.
6. Add integration tests with mock adapter to validate call contract before external APIs.
