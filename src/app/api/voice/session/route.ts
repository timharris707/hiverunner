/**
 * /api/voice/session — Voice session configuration endpoint.
 *
 * Returns the Gemini Live API connection parameters for the client.
 * The actual WebSocket connection happens client-side (browser → Gemini directly).
 *
 * Security note: the API key is loaded server-side so it is not bundled into client JS,
 * but this endpoint still returns that key inside wsUrl for the browser's direct Gemini connection.
 * In production, this should use ephemeral tokens or a server-side WS proxy.
 */

import { NextResponse } from "next/server";
import {
  GEMINI_LIVE_MODEL,
  buildBoundAgentSystemPrompt,
  buildWebSocketUrl,
  HENRY_VOICE_SYSTEM_PROMPT,
  type BoundAgentPersona,
} from "@/lib/gemini-live";
import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { normalizeResolvedVoiceBinding, normalizeVoiceBindingRequest } from "@/lib/voice-binding";
import { buildCurrentVoiceContext } from "@/lib/voice-memory";
import { listRecentSessionSummaries, readAgentMemory } from "@/lib/voice-agent-memory";
import { resolveVoiceTaskContext } from "@/lib/voice-task-context";
import { VOICE_CATALOG } from "@/components/orchestration/voice-catalog";

const DEFAULT_VOICE_NAME = "Charon";
const KNOWN_VOICES = new Set(VOICE_CATALOG.map((v) => v.id));

function buildGlobalSystemPrompt(currentContext: string): string {
  return `${HENRY_VOICE_SYSTEM_PROMPT}\n\n## Fresh startup context\nThe following context was loaded fresh at voice-session startup. Treat it as more current than any older recollection.\n\n${currentContext}`;
}

/**
 * Bound session prompt.
 * When a real agent is bound, the agent is the speaker — Henry's identity is not involved.
 * When no agent is bound (rare), fall back to Henry speaking about the bound scope.
 */
function buildScopedSystemPrompt(
  promptContext: string,
  agent?: BoundAgentPersona,
  agentMemory?: string,
  recentSessions?: string[],
): string {
  const persona = agent
    ? buildBoundAgentSystemPrompt(agent)
    : HENRY_VOICE_SYSTEM_PROMPT;

  const memoryBlock = agentMemory?.trim()
    ? `\n\n## What You Remember About Tim\nThe following are durable facts and preferences you've saved across prior conversations with Tim. Treat them as authoritative until Tim updates them.\n\n${agentMemory.trim()}`
    : "";

  const recentBlock = recentSessions && recentSessions.length > 0
    ? `\n\n## Recent Voice Sessions With Tim\nThe most recent sessions are listed first. Use these to pick up threads naturally without asking Tim to repeat himself.\n\n${recentSessions.join("\n\n")}`
    : "";

  return `${persona}${memoryBlock}${recentBlock}\n\n## Fresh bound session context\nThe following context was resolved live from Mission Control for this bound voice session. Treat it as the current operating context for the conversation.\n\n${promptContext}`;
}

export async function POST(req: Request) {
  const apiKey = process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY;

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

    const bindingRequest = normalizeVoiceBindingRequest(requestBody);

    // Return connection config — client will open WebSocket directly
    const wsUrl = buildWebSocketUrl({
      apiKey,
      model: GEMINI_LIVE_MODEL,
    });

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

    const systemPrompt = bindingRequest.scope === "global"
      ? buildGlobalSystemPrompt(await buildCurrentVoiceContext())
      : buildScopedSystemPrompt(scopedContext!.promptContext, scopedContext!.agent, agentMemory, recentSessions);

    // Resolve voice: agent's chosen voice wins for task-bound sessions; otherwise default.
    // Unknown voice IDs (legacy/unset) fall back so we never hand Gemini an invalid name.
    const boundVoiceId = binding.agentVoiceId;
    const voiceName = boundVoiceId && KNOWN_VOICES.has(boundVoiceId) ? boundVoiceId : DEFAULT_VOICE_NAME;

    return NextResponse.json({
      wsUrl,
      model: GEMINI_LIVE_MODEL,
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
