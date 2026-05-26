# Optional AI Avatar Generation

This feature must be portable for self-hosted HiveRunner installs.

## Contract

HiveRunner must remain fully usable when **no image-generation provider** is configured.
AI avatar generation is an optional enhancement, not a hard dependency.

## Required behavior

- The app boots and runs without `OPENAI_API_KEY`, `GOOGLE_AI_API_KEY`, or `GEMINI_API_KEY`
- Agent/company pages still render normally without broken controls
- Users can still use default/local avatars when no provider is configured
- First-run starter-team setup may encourage choosing recognizable avatar images,
  but it must not require an image provider key
- The avatar wizard must show a clear message when AI generation is unavailable
- No server route should crash just because a provider env var is missing
- Generated images should be stored in a company-scoped location, not left as temporary remote URLs

## Provider strategy

The frontend should call one internal HiveRunner API route.
That route decides which provider to use based on configured env vars.

Preferred order can evolve, but the key point is:
- UI does **not** talk directly to OpenAI/Fal/Google
- Provider choice stays server-side
- We can swap providers later without rewriting the UI

## Recommended env vars

- `OPENAI_API_KEY`
- `GOOGLE_AI_API_KEY` or `GEMINI_API_KEY` for voice preview/voice-session features

These should remain optional and be documented in:
- `.env.example`
- `README.md`
- any onboarding/setup flow

The `/companies/new` setup flow offers a server-side key entry panel for:

- OpenAI image generation for Avatar Wizard portraits.
- Gemini Live voice previews and agent voices.

The frontend must not receive the saved secret values back from the server.

## UX expectations

When no provider is configured:
- show default/local avatar choices
- allow preview/apply of non-AI options
- show a clear note like: "AI avatar generation is not configured for this install"

When a provider is configured:
- enable AI portrait generation in the wizard
- keep the fallback/default avatar path available anyway

## Packaging checklist

Before shipping this repo to outside users:

1. Verify fresh install works with **no** image provider env vars
2. Verify avatar UI degrades gracefully
3. Verify `.env.example` includes optional provider entries
4. Verify `README.md` explains optional setup
5. Verify generated files are stored locally in a stable company-scoped folder
6. Verify no hardcoded personal credentials or provider assumptions exist

## Why this matters

If we miss this, GitHub users will download the repo, click avatar generation, and conclude the app is broken.
That is a preventable packaging failure, so this contract should be treated as product behavior, not a future cleanup item.
