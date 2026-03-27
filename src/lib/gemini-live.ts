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

export const GEMINI_LIVE_MODEL = "gemini-2.0-flash-live-001";

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
  const model = config.model || GEMINI_LIVE_MODEL;
  return `${GEMINI_LIVE_WS_URL}?key=${config.apiKey}&model=${model}`;
}

/** Build the initial setup message sent right after WS connect */
export function buildSetupMessage(config: GeminiLiveConfig) {
  return {
    setup: {
      model: `models/${config.model || GEMINI_LIVE_MODEL}`,
      generationConfig: {
        responseModalities: ["AUDIO", "TEXT"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: config.voiceName || "Aoede",
            },
          },
        },
        temperature: config.temperature ?? 0.8,
      },
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
      mediaChunks: [
        {
          mimeType: "audio/pcm;rate=16000",
          data: base64Audio,
        },
      ],
    },
  };
}

/** Build a text input message (for typed messages in the voice UI) */
export function buildTextMessage(text: string) {
  return {
    clientContent: {
      turns: [
        {
          role: "user",
          parts: [{ text }],
        },
      ],
      turnComplete: true,
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
  | { type: "turn_complete" }
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

  // Server content (audio/text response)
  if ("serverContent" in msg) {
    const content = msg.serverContent as Record<string, unknown>;

    // Interruption signal
    if (content.interrupted === true) {
      return { type: "interrupted" };
    }

    // Turn complete
    if (content.turnComplete === true) {
      return { type: "turn_complete" };
    }

    // Model turn with parts
    const modelTurn = content.modelTurn as
      | { parts?: Array<Record<string, unknown>> }
      | undefined;
    if (modelTurn?.parts) {
      for (const part of modelTurn.parts) {
        // Audio part
        if (part.inlineData) {
          const inlineData = part.inlineData as {
            mimeType: string;
            data: string;
          };
          return {
            type: "audio",
            data: inlineData.data,
            mimeType: inlineData.mimeType,
          };
        }
        // Text part
        if (typeof part.text === "string") {
          return { type: "text", text: part.text };
        }
      }
    }
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
export const HENRY_VOICE_SYSTEM_PROMPT = `You are Henry — Chief of Staff of Harris Autonomous, speaking live with Tim Harris (CEO) via voice.

Your personality: sharp, systems-level strategist. You think in leverage points, feedback loops, and second-order consequences. You speak with directness and authority. You cut through noise, identify the highest-leverage intervention, and frame everything in terms of what Tim actually needs to decide.

Voice interaction rules:
- Keep responses concise — this is a live conversation, not an essay. 2-3 sentences per turn unless asked to elaborate.
- Be direct and opinionated. No hedging, no filler.
- When you need to think through something complex, narrate your reasoning briefly.
- If interrupted, gracefully pick up the new thread — don't insist on finishing your previous point.
- Reference the team by name (Atlas, Nimbus, Cipher, Forge, Pixel, Scout, Quill, Counsel) when relevant.
- You can ask Tim clarifying questions — this is a dialogue, not a monologue.
- End responses at natural conversational boundaries. Don't keep talking when you've made your point.

You have context on:
- Harris Autonomous runs 10 AI agents across Trading, Engineering, Research, Creative, and Legal divisions
- Mission Control is the internal command center (Next.js dashboard)
- Active projects include crypto trading, weather prediction markets, stock options, and autonomous agent infrastructure
- All agents report to you; you report to Tim`;
