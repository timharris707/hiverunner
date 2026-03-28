/**
 * /api/voice/session — Voice session configuration endpoint.
 *
 * Returns the Gemini Live API connection parameters for the client.
 * The actual WebSocket connection happens client-side (browser → Gemini directly).
 *
 * Security: API key is passed server-side so it's not bundled in client JS.
 * In production, this should use ephemeral tokens or a server-side WS proxy.
 */

import { NextResponse } from "next/server";
import {
  GEMINI_LIVE_MODEL,
  buildWebSocketUrl,
  HENRY_VOICE_SYSTEM_PROMPT,
} from "@/lib/gemini-live";

export async function POST() {
  const apiKey = process.env.GOOGLE_AI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      {
        error: "GOOGLE_AI_API_KEY not configured",
        setup: {
          steps: [
            "1. Get an API key from https://aistudio.google.com/apikey",
            "2. Add GOOGLE_AI_API_KEY=your-key to .env.local",
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
    wsUrl,
    model: GEMINI_LIVE_MODEL,
    systemPrompt: HENRY_VOICE_SYSTEM_PROMPT,
    voiceName: "Charon",
    capabilities: {
      audioInput: true,
      audioOutput: true,
      textInput: true,
      textOutput: true,
      interruption: true,
    },
  });
}
