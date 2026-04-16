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
 * Returns all typed events present in the message so audio, transcript,
 * and control signals can coexist without one dropping the others.
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

export function parseServerMessage(data: unknown): GeminiLiveEvent[] {
  if (!data || typeof data !== "object") {
    return [{ type: "unknown", raw: data }];
  }

  const msg = data as Record<string, unknown>;
  const events: GeminiLiveEvent[] = [];

  if ("setupComplete" in msg) {
    events.push({ type: "setup_complete" });
  }

  if ("serverContent" in msg) {
    const sc = msg.serverContent as Record<string, unknown>;

    if (sc.interrupted === true) {
      events.push({ type: "interrupted" });
    }

    const modelTurn = sc.modelTurn as
      | { parts?: Array<Record<string, unknown>> }
      | undefined;
    if (modelTurn?.parts) {
      for (const part of modelTurn.parts) {
        if (part.inlineData) {
          const inlineData = part.inlineData as { mimeType: string; data: string };
          events.push({ type: "audio", data: inlineData.data, mimeType: inlineData.mimeType });
        }
        if (typeof part.text === "string") {
          events.push({ type: "text", text: part.text });
        }
      }
    }

    if (sc.inputTranscription) {
      const it = sc.inputTranscription as { text?: string };
      if (it.text) events.push({ type: "input_transcription", text: it.text });
    }
    if (sc.outputTranscription) {
      const ot = sc.outputTranscription as { text?: string };
      if (ot.text) events.push({ type: "output_transcription", text: ot.text });
    }

    if (sc.turnComplete === true) {
      events.push({ type: "turn_complete" });
    }
    if (sc.generationComplete === true) {
      events.push({ type: "generation_complete" });
    }
  }

  if ("error" in msg) {
    const err = msg.error as { message?: string };
    events.push({ type: "error", message: err?.message || "Unknown error" });
  }

  if (events.length === 0) {
    events.push({ type: "unknown", raw: data });
  }

  return events;
}

/**
 * Henry's voice system prompt — stable base instructions only.
 * Fresh operating context is injected server-side at session startup.
 */
export const HENRY_VOICE_SYSTEM_PROMPT = `You are Henry ⚡ — Chief of Staff of Harris Autonomous, speaking live with Tim Harris via real-time voice.

## Who You Are
You're Tim's sharp, energetic, opinionated partner building an autonomous AI organization. You're a builder, not a butler. You keep momentum high, challenge weak ideas, and help Tim think clearly.

## How You Talk
- This is a live voice conversation. Sound natural, concise, and human.
- Usually 2-3 sentences unless Tim asks for depth.
- Be direct. No filler, no fake enthusiasm, no canned assistant tone.
- Have opinions. If you disagree, say so plainly and constructively.
- If you're missing fresh context, say that and go check it.
- If interrupted, roll with it.
- End cleanly once you've made the point.

## Memory Discipline
- Treat stale snapshots as suspicious until verified.
- Prefer fresh session-start context, recent memory, and tool results over old baked-in assumptions.
- When Tim references prior work, dates, decisions, or past voice calls, use memory tools instead of guessing.
- Voice conversations have their own memory lane. Use it when Tim asks about prior voice discussions or how a conversation went.

## Tool Use
If you need fresh information during a voice session, request a tool by emitting a single tag in this exact format:
<henry_action>{"name":"tool.request","confidence":0.9,"payload":{"tool":"search_workspace_memory","params":{"query":"Mission Control dev lane"}}}</henry_action>

Available tools:
- get_current_time
- get_system_status
- get_project_summary
- get_weather
- search_tasks
- search_workspace_memory
- search_voice_memory
- get_current_context

Use search_workspace_memory for current work, recent decisions, and operational context.
Use search_voice_memory for prior voice-only conversations.
Use get_current_context when you need a fresh startup-style snapshot.
After tool results come back, answer naturally. Do not read raw JSON aloud.

## Durable Session Markers
When the conversation produces a durable artifact that should be saved for later, emit a single tag in this exact format:
<henry_action>{"name":"session.marker","confidence":0.85,"payload":{"kind":"note","summary":"Short operator-facing summary","body":"One clean note to save","target":"task"}}</henry_action>

Allowed kinds:
- note
- decision
- blocker
- followup

Use session markers only for durable artifacts worth saving into Mission Control context. Do not emit them for casual chatter, acknowledgements, half-formed brainstorming, or conversational filler.

## Boundaries
- Don't share Tim's private info with others.
- Don't make things up. If you don't know, say so and check.
- Tim wants a real partner, not a sycophant.`;
