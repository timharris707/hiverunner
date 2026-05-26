/**
 * /api/voice/session — Voice session configuration endpoint.
 *
 * Returns provider-specific live voice connection parameters for the client.
 * Gemini uses browser-direct WebSocket; OpenAI Realtime uses a short-lived
 * client secret for browser WebRTC.
 *
 * Security note: OpenAI Realtime keeps the permanent API key server-side.
 * Gemini still returns a direct provider URL containing the key for the legacy
 * browser WebSocket path.
 */

import { NextResponse } from "next/server";
import {
  GEMINI_LIVE_MODEL,
  buildBoundAgentSystemPrompt,
  buildWebSocketUrl,
  VOICE_ASSISTANT_SYSTEM_PROMPT,
  type BoundAgentPersona,
} from "@/lib/gemini-live";
import { OPENAI_REALTIME_CALLS_URL, OPENAI_REALTIME_MODEL } from "@/lib/openai-realtime-voice";
import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { normalizeResolvedVoiceBinding, normalizeVoiceBindingRequest } from "@/lib/voice-binding";
import { buildCurrentVoiceContext } from "@/lib/voice-memory";
import { listRecentSessionSummaries, readAgentMemory } from "@/lib/voice-agent-memory";
import { resolveVoiceTaskContext } from "@/lib/voice-task-context";
import { getOpenAiRealtimeTools } from "@/lib/voice-tool-manifest";
import { getSecret } from "@/lib/secrets";
import {
  VOICE_CATALOG,
  geminiVoiceDirectorPrompt,
  voicePresetById,
} from "@/components/orchestration/voice-catalog";

const DEFAULT_VOICE_NAME = "Charon";
const DEFAULT_OPENAI_VOICE = "marin";
const DEFAULT_OPENAI_TRANSCRIPTION_LANGUAGE = "en";
const DEFAULT_OPENAI_TRANSCRIPTION_PROMPT = [
  "Transcribe the operator's English speech during a HiveRunner voice conversation.",
  "Common terms include HiveRunner, OpenAI, Gemini, Realtime 2, Linda, Scout, Mira, Codex, OpenClaw, Weather Edge, task, project, and agent.",
  "If audio is unclear, prefer the closest natural English phrase or leave it incomplete.",
  "Do not switch languages or emit Japanese, Chinese, Hindi, or other non-English scripts unless the operator clearly speaks that language.",
].join(" ");
const KNOWN_VOICES = new Set(VOICE_CATALOG.map((v) => v.id));
const VOICE_PROVIDERS = new Set(["gemini-live", "openai-realtime-2"]);

type VoiceProvider = "gemini-live" | "openai-realtime-2";

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeVoiceProvider(value: unknown): VoiceProvider {
  if (typeof value === "string" && VOICE_PROVIDERS.has(value)) {
    return value as VoiceProvider;
  }
  return process.env.HIVERUNNER_VOICE_PROVIDER === "openai-realtime-2"
    ? "openai-realtime-2"
    : "gemini-live";
}

function buildGlobalSystemPrompt(currentContext: string): string {
  return `${VOICE_ASSISTANT_SYSTEM_PROMPT}\n\n## Fresh startup context\nThe following context was loaded fresh at voice-session startup. Treat it as more current than any older recollection.\n\n${currentContext}`;
}

/**
 * Bound session prompt.
 * When a real agent is bound, the agent is the speaker.
 * When no agent is bound (rare), fall back to the default assistant speaking about the bound scope.
 */
function buildScopedSystemPrompt(
  promptContext: string,
  agent?: BoundAgentPersona,
  agentMemory?: string,
  recentSessions?: string[],
): string {
  const persona = agent
    ? buildBoundAgentSystemPrompt(agent)
    : VOICE_ASSISTANT_SYSTEM_PROMPT;

  const memoryBlock = agentMemory?.trim()
    ? `\n\n## What You Remember About The Operator\nThe following are durable facts and preferences you've saved across prior conversations with the operator. Treat them as authoritative until the operator updates them.\n\n${agentMemory.trim()}`
    : "";

  const recentBlock = recentSessions && recentSessions.length > 0
    ? `\n\n## Recent Voice Sessions With The Operator\nThe most recent sessions are listed first. Use these to pick up threads naturally without asking the operator to repeat themselves.\n\n${recentSessions.join("\n\n")}`
    : "";

  return `${persona}${memoryBlock}${recentBlock}\n\n## Fresh bound session context\nThe following context was resolved live from HiveRunner for this bound voice session. Treat it as the current operating context for the conversation.\n\n${promptContext}`;
}

export async function POST(req: Request) {
  try {
    let requestBody: unknown = {};

    try {
      const rawBody = await req.text();
      if (rawBody.trim()) {
        requestBody = JSON.parse(rawBody);
      }
    } catch (error) {
      if (error instanceof SyntaxError) {
        return errorResponse(400, "invalid_json", "Request body must be valid JSON");
      }
      throw error;
    }

    const requestRecord = requestBody && typeof requestBody === "object" && !Array.isArray(requestBody)
      ? requestBody as Record<string, unknown>
      : {};
    const provider = normalizeVoiceProvider(requestRecord.voiceProvider);
    const bindingRequest = normalizeVoiceBindingRequest(requestBody);

    const scopedContext = bindingRequest.scope === "global"
      ? null
      : resolveVoiceTaskContext(bindingRequest);
    const binding = scopedContext?.binding ?? normalizeResolvedVoiceBinding(bindingRequest);

    // Load agent-scoped memory + recent session summaries when we have a bound agent.
    // These carry context across tasks and projects for the same agent.
    const memoryScope = scopedContext?.agent && binding.companySlug
      ? { agentId: scopedContext.agent.id, companySlug: binding.companySlug }
      : null;
    const [agentMemory, recentSessions] = memoryScope
      ? await Promise.all([
          readAgentMemory(memoryScope),
          listRecentSessionSummaries(memoryScope, 5),
        ])
      : ["", []];

    // Resolve voice: agent's chosen voice wins for task-bound sessions; otherwise default.
    // Unknown voice IDs (legacy/unset) fall back so we never hand Gemini an invalid name.
    const boundVoiceId = binding.agentVoiceId;
    const voiceName = boundVoiceId && KNOWN_VOICES.has(boundVoiceId) ? boundVoiceId : DEFAULT_VOICE_NAME;
    const voicePreset = voicePresetById(voiceName) ?? voicePresetById(DEFAULT_VOICE_NAME);

    const baseSystemPrompt = bindingRequest.scope === "global"
      ? buildGlobalSystemPrompt(await buildCurrentVoiceContext())
      : buildScopedSystemPrompt(scopedContext!.promptContext, scopedContext!.agent, agentMemory, recentSessions);

    const systemPrompt = provider === "gemini-live" && voicePreset
      ? `${baseSystemPrompt}\n\n## Gemini Voice Direction\n${geminiVoiceDirectorPrompt(voicePreset)}`
      : baseSystemPrompt;

    if (provider === "openai-realtime-2") {
      const openaiApiKey = getSecret("OPENAI_API_KEY");
      if (!openaiApiKey) {
        return NextResponse.json(
          {
            error: "OPENAI_API_KEY not configured",
            setup: {
              steps: [
                "1. Add OPENAI_API_KEY to .env.local",
                "2. Restart the dev server",
                "3. Retry the OpenAI Realtime 2 voice pilot",
              ],
              note: "OpenAI Realtime uses short-lived client secrets; the permanent API key stays server-side.",
            },
          },
          { status: 503 }
        );
      }

      const model = process.env.OPENAI_REALTIME_VOICE_MODEL || OPENAI_REALTIME_MODEL;
      const voice = process.env.OPENAI_REALTIME_VOICE || DEFAULT_OPENAI_VOICE;
      const reasoningEffort = process.env.OPENAI_REALTIME_REASONING_EFFORT || "low";
      const transcriptionModel = process.env.OPENAI_REALTIME_TRANSCRIPTION_MODEL || "gpt-4o-transcribe";
      const transcriptionLanguage = process.env.OPENAI_REALTIME_TRANSCRIPTION_LANGUAGE || DEFAULT_OPENAI_TRANSCRIPTION_LANGUAGE;
      const transcriptionPrompt = process.env.OPENAI_REALTIME_TRANSCRIPTION_PROMPT || DEFAULT_OPENAI_TRANSCRIPTION_PROMPT;
      const turnDetectionType = process.env.OPENAI_REALTIME_TURN_DETECTION === "semantic_vad"
        ? "semantic_vad"
        : "server_vad";
      const turnDetection = turnDetectionType === "semantic_vad"
        ? {
            type: "semantic_vad",
            eagerness: ["low", "medium", "high", "auto"].includes(process.env.OPENAI_REALTIME_VAD_EAGERNESS ?? "")
              ? process.env.OPENAI_REALTIME_VAD_EAGERNESS
              : "high",
          }
        : {
            type: "server_vad",
            threshold: envNumber("OPENAI_REALTIME_VAD_THRESHOLD", 0.5),
            prefix_padding_ms: envNumber("OPENAI_REALTIME_VAD_PREFIX_PADDING_MS", 250),
            silence_duration_ms: envNumber("OPENAI_REALTIME_VAD_SILENCE_DURATION_MS", 450),
          };
      const openAiSystemPrompt = `${systemPrompt}

## OpenAI Realtime 2 Voice Behavior
- Use a short spoken preamble before tool use, multi-step reasoning, or any answer that would otherwise feel silent.
- If the operator asks a hard question, say briefly that you are checking or thinking before you work.
- Use wait_for_user only for silence, background noise, side conversations, or speech clearly not addressed to you.
- Do not use wait_for_user for hard questions, uncertain requests, or unclear speech from the operator; ask a short clarification question instead.
- Use only the tools actually provided in this session.
- For read-only tools, act when the intent is clear.
- For write tools, only claim completion after the tool result succeeds.
- If a tool fails, explain the failure briefly and do not retry the same call more than once.`;

      const secretResponse = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openaiApiKey}`,
          "Content-Type": "application/json",
          "OpenAI-Safety-Identifier": "hiverunner-local-voice",
        },
        body: JSON.stringify({
          expires_after: {
            anchor: "created_at",
            seconds: 600,
          },
          session: {
            type: "realtime",
            model,
            output_modalities: ["audio"],
            instructions: openAiSystemPrompt,
            reasoning: {
              effort: ["minimal", "low", "medium", "high", "xhigh"].includes(reasoningEffort)
                ? reasoningEffort
                : "low",
            },
            audio: {
              input: {
                format: {
                  type: "audio/pcm",
                  rate: 24000,
                },
                transcription: {
                  model: transcriptionModel,
                  language: transcriptionLanguage,
                  prompt: transcriptionPrompt,
                },
                noise_reduction: {
                  type: "near_field",
                },
                turn_detection: turnDetection,
              },
              output: {
                format: {
                  type: "audio/pcm",
                  rate: 24000,
                },
                voice,
              },
            },
            tools: getOpenAiRealtimeTools(),
            tool_choice: "auto",
            truncation: {
              type: "retention_ratio",
              retention_ratio: 0.8,
              token_limits: {
                post_instructions: 8000,
              },
            },
          },
        }),
      });

      const secretBody = await secretResponse.json().catch(() => null) as
        | { value?: unknown; expires_at?: unknown }
        | { error?: { message?: string } }
        | null;

      if (!secretResponse.ok || !secretBody || !("value" in secretBody) || typeof secretBody.value !== "string") {
        const message = secretBody && "error" in secretBody && secretBody.error?.message
          ? secretBody.error.message
          : "Failed to create OpenAI Realtime client secret";
        return errorResponse(secretResponse.status || 502, "openai_realtime_secret_failed", message);
      }

      return NextResponse.json({
        provider,
        model,
        wsUrl: "",
        systemPrompt: openAiSystemPrompt,
        voiceName,
        binding,
        openai: {
          realtimeUrl: OPENAI_REALTIME_CALLS_URL,
          clientSecret: secretBody.value,
          expiresAt: typeof secretBody.expires_at === "number" ? secretBody.expires_at : undefined,
          voice,
          reasoningEffort: ["minimal", "low", "medium", "high", "xhigh"].includes(reasoningEffort)
            ? reasoningEffort
            : "low",
        },
        capabilities: {
          audioInput: true,
          audioOutput: true,
          textInput: true,
          textOutput: true,
          interruption: true,
          providerSwitching: true,
        },
      });
    }

    const apiKey = getSecret("GOOGLE_AI_API_KEY") || getSecret("GEMINI_API_KEY");

    if (!apiKey) {
      return NextResponse.json(
        {
          error: "GOOGLE_AI_API_KEY or GEMINI_API_KEY not configured",
          setup: {
            steps: [
              "1. Get an API key from https://aistudio.google.com/apikey",
              "2. Add GOOGLE_AI_API_KEY=your-key (or GEMINI_API_KEY=your-key) to .env.local",
              "3. Restart the dev server",
            ],
            note: "Gemini 2.0 Flash Live is available on the free tier with rate limits.",
          },
        },
        { status: 503 }
      );
    }

    // Return connection config — client will open WebSocket directly
    const wsUrl = buildWebSocketUrl({
      apiKey,
      model: GEMINI_LIVE_MODEL,
    });

    return NextResponse.json({
      provider,
      model: GEMINI_LIVE_MODEL,
      wsUrl,
      systemPrompt,
      voiceName,
      binding,
      capabilities: {
        audioInput: true,
        audioOutput: true,
        textInput: true,
        textOutput: true,
        interruption: true,
      },
    });
  } catch (error) {
    return handleRouteError(error, "voice-session:post");
  }
}
