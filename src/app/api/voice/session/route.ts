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
  buildWebSocketUrl,
  HENRY_VOICE_SYSTEM_PROMPT,
} from "@/lib/gemini-live";
import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { normalizeResolvedVoiceBinding, normalizeVoiceBindingRequest } from "@/lib/voice-binding";
import { buildCurrentVoiceContext } from "@/lib/voice-memory";
import { resolveVoiceTaskContext } from "@/lib/voice-task-context";
import { VOICE_CATALOG } from "@/components/orchestration/voice-catalog";

const DEFAULT_VOICE_NAME = "Charon";
const KNOWN_VOICES = new Set(VOICE_CATALOG.map((v) => v.id));

function buildGlobalSystemPrompt(currentContext: string): string {
  return `${HENRY_VOICE_SYSTEM_PROMPT}\n\n## Fresh startup context\nThe following context was loaded fresh at voice-session startup. Treat it as more current than any older recollection.\n\n${currentContext}`;
}

function buildScopedSystemPrompt(promptContext: string): string {
  return `${HENRY_VOICE_SYSTEM_PROMPT}\n\n## Fresh bound session context\nThe following context was resolved live from Mission Control for this bound voice session. Treat it as the current operating context for the conversation.\n\n${promptContext}`;
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
    const systemPrompt = bindingRequest.scope === "global"
      ? buildGlobalSystemPrompt(await buildCurrentVoiceContext())
      : buildScopedSystemPrompt(scopedContext!.promptContext);

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
