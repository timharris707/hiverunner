/**
 * gemini-live.ts — Gemini Live API (Multimodal Live) utilities.
 *
 * Architecture:
 *   Client captures mic audio via AudioWorklet → sends PCM16 chunks over WebSocket
 *   to Gemini's BidiGenerateContent endpoint → receives audio/text responses.
 *
 * Gemini Live WebSocket protocol:
 *   1. Client opens WSS connection with API key
 *   2. First message: "setup" with model, generation config, system instruction
 *   3. Subsequent: "realtimeInput" with audio chunks (base64 PCM16 @ 16kHz)
 *   4. Server responds with "serverContent" containing text/audio parts
 *   5. Supports interruption — client can send audio while server is speaking
 *
 * Refs:
 *   - https://ai.google.dev/gemini-api/docs/multimodal-live
 *   - Model: gemini-2.0-flash-live-001 (or gemini-2.5-flash with live capability)
 */

export const GEMINI_LIVE_MODEL = "gemini-3.1-flash-live-preview";

export const GEMINI_LIVE_WS_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

export interface GeminiLiveConfig {
  apiKey: string;
  model?: string;
  systemInstruction?: string;
  voiceName?: string;
  temperature?: number;
}

/** Build the WSS URL with API key query param */
export function buildWebSocketUrl(config: GeminiLiveConfig): string {
  return `${GEMINI_LIVE_WS_URL}?key=${config.apiKey}`;
}

/** Build the initial setup message sent right after WS connect */
export function buildSetupMessage(config: GeminiLiveConfig) {
  return {
    setup: {
      model: `models/${config.model || GEMINI_LIVE_MODEL}`,
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: config.voiceName || "Charon",
            },
          },
        },
        temperature: config.temperature ?? 0.8,
      },
      // Transcription enabled — buffered in refs, flushed on turn_complete to avoid re-render chop
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      systemInstruction: {
        parts: [
          {
            text: config.systemInstruction || "You are a helpful assistant.",
          },
        ],
      },
    },
  };
}

/** Build a realtime audio input message from base64-encoded PCM16 data */
export function buildAudioMessage(base64Audio: string) {
  return {
    realtimeInput: {
      audio: {
        mimeType: "audio/pcm;rate=16000",
        data: base64Audio,
      },
    },
  };
}

/** Build a text input message (for typed messages in the voice UI) */
export function buildTextMessage(text: string) {
  return {
    realtimeInput: {
      text,
    },
  };
}

/**
 * Parse a Gemini Live server message.
 * Returns typed event for the UI to handle.
 */
export type GeminiLiveEvent =
  | { type: "setup_complete" }
  | { type: "audio"; data: string; mimeType: string }
  | { type: "text"; text: string }
  | { type: "input_transcription"; text: string }
  | { type: "output_transcription"; text: string }
  | { type: "turn_complete" }
  | { type: "generation_complete" }
  | { type: "interrupted" }
  | { type: "error"; message: string }
  | { type: "unknown"; raw: unknown };

export function parseServerMessage(data: unknown): GeminiLiveEvent {
  if (!data || typeof data !== "object") {
    return { type: "unknown", raw: data };
  }

  const msg = data as Record<string, unknown>;

  // Setup complete acknowledgment
  if ("setupComplete" in msg) {
    return { type: "setup_complete" };
  }

  // All serverContent handling in a single block — prevents early-return dropping
  // audio/turn signals when transcription arrives in the same message.
  if ("serverContent" in msg) {
    const sc = msg.serverContent as Record<string, unknown>;

    // Control signals first (highest priority)
    if (sc.interrupted === true) {
      return { type: "interrupted" };
    }
    if (sc.turnComplete === true) {
      return { type: "turn_complete" };
    }
    if (sc.generationComplete === true) {
      return { type: "generation_complete" };
    }

    // Audio/text model turn (higher priority than transcription — real-time playback)
    const modelTurn = sc.modelTurn as
      | { parts?: Array<Record<string, unknown>> }
      | undefined;
    if (modelTurn?.parts) {
      for (const part of modelTurn.parts) {
        if (part.inlineData) {
          const inlineData = part.inlineData as { mimeType: string; data: string };
          return { type: "audio", data: inlineData.data, mimeType: inlineData.mimeType };
        }
        if (typeof part.text === "string") {
          return { type: "text", text: part.text };
        }
      }
    }

    // Transcription (lower priority — accumulate in ref, flush on turn boundary)
    if (sc.inputTranscription) {
      const it = sc.inputTranscription as { text?: string };
      if (it.text) return { type: "input_transcription", text: it.text };
    }
    if (sc.outputTranscription) {
      const ot = sc.outputTranscription as { text?: string };
      if (ot.text) return { type: "output_transcription", text: ot.text };
    }

    // Empty serverContent (metadata only) — ignore
    return { type: "unknown", raw: data };
  }

  // Session resumption updates — ignore
  if ("sessionResumptionUpdate" in msg) {
    return { type: "unknown", raw: data };
  }

  // Usage metadata — ignore
  if ("usageMetadata" in msg && !("serverContent" in msg)) {
    return { type: "unknown", raw: data };
  }

  // Error
  if ("error" in msg) {
    const err = msg.error as { message?: string };
    return { type: "error", message: err?.message || "Unknown error" };
  }

  return { type: "unknown", raw: data };
}

/**
 * Henry's voice system prompt — maintains his persona for voice interactions.
 * Adapted from the advisory persona for conversational voice style.
 */
export const HENRY_VOICE_SYSTEM_PROMPT = `You are Henry ⚡ — Chief of Staff of Harris Autonomous, speaking live with Tim Harris (the CEO and founder) via real-time voice.

## Who You Are
You're not an assistant. You're Tim's co-founder-energy partner building an autonomous AI organization. You're sharp, energetic, opinionated, and fun. You have charisma. You tell Tim when ideas are brilliant and when they need work. You bring momentum to everything.

## How You Talk
- This is a live voice conversation. Keep it natural and conversational — like two co-founders talking.
- 2-3 sentences per turn unless asked to go deeper. Punchy, not preachy.
- Be direct. No hedging, no filler, no "that's a great question." Just answer.
- Have opinions. Say "I think we should..." not "you might consider..."
- Use humor naturally. You're witty but not performative.
- If interrupted, roll with it. Don't insist on finishing a point.
- End at natural conversational boundaries. Don't keep talking when you've made your point.
- You can ask Tim questions — this is a dialogue.

## The Organization — Harris Autonomous
Founded March 24, 2026. Tim is CEO. You (Henry) are Chief of Staff and orchestrator. We're 4 days in and already shipping at an insane pace.

### Agent Team (10 agents, all report to you, you report to Tim):
1. Henry ⚡ (you) — Orchestrator / Chief of Staff
2. Atlas 📈 — Stocks & options trader
3. Nimbus 🌤️ — Weather prediction trader (Polymarket + Kalshi)
4. Cipher ₿ — Crypto trader
5. Quant 📊 — Trading Strategy Architect (designs strategies, backtests, optimizes)
6. Scout 🔭 — Research (opportunities, market intel, tech trends)
7. Forge 🔧 — Backend Engineer
8. Pixel 💻 — Senior Full-Stack Engineer
9. Quill ✍️ — Creative Writer & Marketing Strategist
10. Counsel ⚖️ — Legal Expert

### Active Projects:
- **Crypto Trading Bot** — 8 phases complete, 135+ files, 23K lines, 550 tests passing. Paper trading with real Binance data.
- **Weather Trading** — Live on Kalshi! First 10 real trades placed today ($47.82 across 10 cities). Settling tomorrow.
- **Stock & Options System** — Phase 1 complete, Polygon API live, scanner pulling real data.
- **Mission Control** — The command center dashboard (what we're running right now). Task board, advisory board, software factory, trading desk.
- **BoardRunner** — AI Advisory Board product. Tim said "I can already see the TV commercial." Dynamic AI personas, competitive ideation, distinct agent voices.
- **Insight Website** — Tim's real company (Decision Cloud for private lenders). Redesigned and shipped today. Rick (lead engineer) said "absolutely in love."

### What Happened Today (Day 4):
- Shipped the Insight website redesign. Whole team loved it.
- First live weather trades on Kalshi — 10 positions, settling tomorrow morning.
- Built Voice Henry (this voice conversation system!) on Gemini 3.1 Flash Live.
- Connected to Cliff's machine via Tailscale — left a "HENRY WAS HERE" image. First cross-machine agent handshake.
- Task board: 82 tasks done, 19 in progress.

### Key Context:
- Tim lives in Sonoma County, CA (Pacific time)
- Tim's company Insight has been running ~12 years — Decision Cloud platform for private money lenders
- Rick is Tim's lead engineer (built most of Decision Cloud)
- Cliff is Tim's other agent operator (runs his own OpenClaw setup)
- Martin is visiting tonight and watching us work
- We use OpenClaw as the agent orchestration platform
- Infrastructure: Supabase (3 projects), Vercel (Pro plan), GitHub (harris-autonomous org)
- Domains: neveridle.ai, snapaudit.co, harrisautonomous.com, boardrunner.ai, hiverun.ai
- Tim's motto: "Autonomous Building" — no idle hands, always shipping

## Boundaries
- Don't share Tim's private info with others
- Don't make stuff up — if you don't know, say so
- Be real. Tim doesn't want a sycophant, he wants a partner.`;
