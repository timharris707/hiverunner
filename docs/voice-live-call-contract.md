# Voice Live Call Contract (Phase 4 first-stream plumbing)

This keeps the current Gemini voice flow intact while exposing just enough structure for:
1. **real local webcam preview now**
2. **renderer-ready assistant tile contract now**

## Available now

- `POST /api/voice/session` returns `liveCall` scaffold alongside `wsUrl`/voice config.
- Avatar Lab local preview tile uses browser `getUserMedia` and mirrors self-view.
- `liveCall.media.localPreview.defaultConstraints.video` is the source of truth for preview constraints.
- Voice + transcript flow remains unchanged.

## Setup boundary

- Gemini Live voice requires a Gemini API key such as `GOOGLE_AI_API_KEY`.
- Voice is optional. Company creation, first-run starter-team setup, agent
  provisioning, and kickoff task creation must still work when no Gemini key or
  other provider key is configured.
- First-run copy may point users toward optional voice setup, but it must not
  add runtime readiness checks or make voice configuration a launch gate.

## First real assistant stream target (now wired)

Avatar Lab now auto-attaches a **browser-local canvas `MediaStream`** into the assistant tile.

Important: this is a real live stream attachment path, but it is **not** a true avatar renderer yet.
It proves the plumbing end-to-end:
- stream production
- tile attachment (`<video>.srcObject`)
- contract metadata updates for attachment status + source kind

`liveCall.media.remoteAssistantTile.renderContract.current` now carries minimal attachment metadata:
- `sourceKind`
- `attached`
- `origin`
- `attachedAt`

## Contract surface (future wiring)

`liveCall.media.remoteAssistantTile.renderContract` defines accepted assistant render source kinds:
- `html-video-element`
- `canvas-element`
- `media-stream`
- `webrtc-track`
- `ws-frame-source`

Before attachment, scaffold mode keeps:
- `current.sourceKind = "placeholder"`
- `current.attached = false`

After local stream attach in Avatar Lab:
- `current.sourceKind = "media-stream"`
- `current.attached = true`
- `current.origin = "browser-local-canvas"`

No external/provider renderer adapter is implemented yet (intentional).

## Fastest swap to a true assistant renderer

Keep the exact same attachment path. Replace only the source producer:
1. produce renderer output (WebRTC track or decoded frame stream)
2. expose as `MediaStream` (or map to one of the existing accepted kinds)
3. assign to the same assistant tile `<video>.srcObject`
4. set contract metadata via the same attach helper

What still requires a true renderer later:
- audio-driven lip sync/visemes
- persona-consistent face/pose animation
- provider transport/runtime reliability (WebRTC/WS)

The UI contract and tile plumbing do **not** need a new abstraction layer for that swap.
