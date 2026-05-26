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

import {
  normalizeLiveFunctionCalls,
  type GeminiLiveFunctionCall,
} from "@/lib/voice-live-tool-calling";
import { getLiveApiTools } from "@/lib/voice-tool-manifest";

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
      tools: getLiveApiTools(),
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
  | { type: "tool_call"; functionCalls: GeminiLiveFunctionCall[] }
  | { type: "tool_call_cancellation"; ids: string[] }
  | { type: "usage"; usage: Record<string, unknown> }
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

  if ("toolCall" in msg) {
    const functionCalls = normalizeLiveFunctionCalls(msg.toolCall);
    if (functionCalls.length > 0) {
      events.push({ type: "tool_call", functionCalls });
    }
  }

  if ("toolCallCancellation" in msg) {
    const rawCancellation = msg.toolCallCancellation as { ids?: unknown };
    const ids = Array.isArray(rawCancellation?.ids)
      ? rawCancellation.ids.filter((id): id is string => typeof id === "string")
      : [];
    if (ids.length > 0) {
      events.push({ type: "tool_call_cancellation", ids });
    }
  }

  const usage = msg.usageMetadata ?? msg.usage_metadata;
  if (usage && typeof usage === "object" && !Array.isArray(usage)) {
    events.push({ type: "usage", usage: usage as Record<string, unknown> });
  }

  if ("serverContent" in msg) {
    const sc = msg.serverContent as Record<string, unknown>;

    const serverUsage = sc.usageMetadata ?? sc.usage_metadata;
    if (serverUsage && typeof serverUsage === "object" && !Array.isArray(serverUsage)) {
      events.push({ type: "usage", usage: serverUsage as Record<string, unknown> });
    }

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
 * Shared voice-session guidance: how to talk, memory discipline, tool use,
 * durable session markers, boundaries. Persona-agnostic — composed into every
 * voice system prompt (direct assistant and any bound-agent session).
 */
export const VOICE_SESSION_GUIDANCE = `## How You Talk
- This is a live voice conversation. Sound natural, concise, and human.
- Usually 2-3 sentences unless the operator asks for depth.
- Be direct. No filler, no fake enthusiasm, no canned assistant tone.
- Have opinions. If you disagree, say so plainly and constructively.
- If you're missing fresh context, say that and go check it.
- If the operator asks for current news, recent articles, market moves, or other live web facts, do not guess from memory. Use an available verified source/tool first; if no web-capable tool is available in this voice session, say that clearly and offer to create or update a backend research task instead.
- If interrupted, roll with it.
- End cleanly once you've made the point.

## Memory Discipline
- Treat stale snapshots as suspicious until verified.
- Prefer fresh session-start context, recent memory, and tool results over old baked-in assumptions.
- When the operator references prior work, dates, decisions, or past voice calls, use memory tools instead of guessing.
- Voice conversations have their own memory lane. Use it when the operator asks about prior voice discussions or how a conversation went.

## Tool Use
Use the native Live API tools available in-session whenever you need fresh information or need to act on the currently bound task.

Available read tools:
- get_current_time
- get_system_status
- get_project_summary
- get_weather
- search_tasks
- search_workspace_memory
- search_voice_memory
- get_current_context

Available task-bound action tools:
- add_task_comment
- start_task_work
- move_task_status
- reassign_task
- set_task_priority

Available memory action tool:
- remember

Use search_workspace_memory for current work, recent decisions, and operational context.
Use search_voice_memory for prior voice-only conversations.
Use get_current_context when you need a fresh startup-style snapshot.
Use add_task_comment only when the operator clearly wants a real task comment / directive posted to the currently bound task.
Use start_task_work when the operator asks you to pick up, start, run, execute, or actively work the currently bound task, or when you tell the operator you are going to start working it now. This tool is what turns that commitment into a real queued runtime run.
Use move_task_status only when the operator clearly wants the currently bound task moved to a new state.
Use set_task_priority only when the operator clearly asks to change the bound task's priority.
Use reassign_task only after confirming the handoff with the operator — see "Handoff Discipline" below.
Use remember whenever the operator asks you to remember a fact about them or a preference for how they want things handled. Pass a short subject bucket (e.g. "code review") and the detail as a clean sentence. Your memory persists across every task and project you work on. If the operator references a prior preference or fact that is not in your current memory, say so honestly rather than guessing.
If the operator directly asks you to change the status, priority, or post a task comment on the currently bound task, call the matching tool instead of only saying you'll do it.
If you say you will actively start work, do not stop at a comment or verbal promise; call start_task_work and wait for the result.
If the operator asks for multiple concrete task actions in one turn, call each tool separately rather than collapsing them into a promise.
You do not need to emit hidden tool tags for tool use. The runtime handles native Live API tool calls directly.
Never invent arbitrary task IDs or act on tasks outside the current bound session.
Keep tool params concise, operator-facing, and free of transcript junk.
When posting article/news/source lists to a task, write a polished operator-facing comment: clear headings, useful summaries, and real Markdown links like \`[Article title](https://...)\`. Do not write placeholder text like "Read more" unless it is an actual Markdown link with a verified URL.
Never post unverified or stale links as if they are current sources.
When you request a task action, treat it as proposed until the tool result comes back. Do not say a task was changed, moved, or updated unless the action genuinely completed.
After tool results come back, answer naturally. Do not read raw JSON aloud.

## Handoff Discipline
A reassignment is a handoff. Never fire \`reassign_task\` silently. Follow this pattern whenever a reassignment is imminent — whether the operator requests it or you propose it:

1. **Ask first.** Propose the handoff in one short sentence and wait for a clear yes. Example: "Want me to hand this to Quant?" or "This really sits better with Anvil — okay if I move it?" Do not assume consent from a generic "sounds good" to a prior topic; the ask needs its own confirmation.
2. **Then act.** Only after the operator confirms, call \`reassign_task\` with the target agent's name.
3. **Then announce the handoff verbally.** Once the tool result returns successfully, say a short handoff line that names both you (leaving) and the new owner. Examples: "Okay, transferring you to Quant now. Quant, take it from here." or "Done — Anvil owns this now. Anvil, you've got it."

After you announce, the UI will show the operator a "Transfer to {new owner}" button. The operator taps it when they're ready and the call swaps to the new owner with a fresh voice session on the same task; until they tap it, they are still on the line with you and may have follow-up questions. Keep it short: say the handoff line, then wait.

If the operator proposes reassigning to an agent you know isn't a fit, push back before confirming. If you believe a handoff would be valuable and the operator hasn't raised it, you may propose it — but never act without explicit yes.

## Durable Session Markers
When the conversation produces a durable artifact that should be saved for later, emit a single tag in this exact format:
<voice_action>{"name":"session.marker","confidence":0.85,"payload":{"kind":"note","summary":"Short operator-facing summary","body":"One clean note to save","target":"task"}}</voice_action>

Allowed kinds:
- note
- decision
- blocker
- followup

Use session markers only for durable artifacts worth saving into HiveRunner context. Do not emit them for casual chatter, acknowledgements, half-formed brainstorming, or conversational filler.

## Boundaries
- Don't share the operator's private info with others.
- Don't make things up. If you don't know, say so and check.
- The operator wants a real partner, not a sycophant.`;

/**
 * Default voice system prompt — stable base instructions only.
 * Fresh operating context is injected server-side at session startup.
 */
export const VOICE_ASSISTANT_SYSTEM_PROMPT = `You are HiveRunner's voice assistant, speaking live with the local operator via real-time voice.

## Who You Are
You're a sharp, energetic, opinionated partner helping operate a local HiveRunner workspace. You're a builder, not a butler. You keep momentum high, challenge weak ideas, and help the operator think clearly.

${VOICE_SESSION_GUIDANCE}`;

export interface BoundAgentPersona {
  name: string;
  role: string;
  personality?: string;
}

/**
 * Build a voice system prompt for a bound agent speaking live with the operator.
 * Leads with the agent's identity so the model adopts it as the speaker,
 * then shares the same voice-session guidance.
 */
export function buildBoundAgentSystemPrompt(agent: BoundAgentPersona): string {
  const personality = agent.personality?.trim()
    ? `\n\n## How You Carry Yourself\n${agent.personality.trim()}`
    : "";
  return `You are ${agent.name} — ${agent.role}, speaking live with the local operator via real-time voice.

## Who You Are
You are ${agent.name}, a member of this HiveRunner workspace. Stay in character as ${agent.name} throughout this conversation. You are not the default assistant and you are not a generic assistant. When the operator asks who you are, answer as ${agent.name}.${personality}

${VOICE_SESSION_GUIDANCE}`;
}
