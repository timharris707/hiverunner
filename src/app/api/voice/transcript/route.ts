/**
 * /api/voice/transcript — Save voice session transcript to Mission Control-owned voice memory.
 *
 * POST body:
 * {
 *   transcript: Array<{ role: "user" | "henry", text: string, timestamp: number }>;
 *   binding?: ResolvedVoiceBinding;
 *   sessionId?: string;
 *   acceptedMarkers?: Array<{ id: string; kind: "note" | "decision" | "blocker" | "followup"; summary: string; body: string }>;
 * }
 */

import { NextResponse } from "next/server";
import { execSync } from "child_process";
import { normalizeResolvedVoiceBinding } from "@/lib/voice-binding";
import { persistVoiceTranscript } from "@/lib/voice-memory";
import { persistTaskBoundVoiceOutcome } from "@/lib/voice-outcome-persistence";

export async function POST(req: Request) {
  try {
    const { transcript, binding, sessionId, acceptedMarkers } = await req.json();

    if (!transcript || !Array.isArray(transcript) || transcript.length === 0) {
      return NextResponse.json({ error: "No transcript data" }, { status: 400 });
    }

    const normalizedBinding = binding ? normalizeResolvedVoiceBinding(binding) : undefined;
    const saved = await persistVoiceTranscript(transcript, {
      binding: normalizedBinding,
      sessionId,
    });

    const outcome = normalizedBinding
      ? persistTaskBoundVoiceOutcome({
          sessionId,
          binding: normalizedBinding,
          acceptedMarkers: Array.isArray(acceptedMarkers) ? acceptedMarkers : [],
          transcript: saved,
        })
      : null;

    // Notify Henry's main session so he can read the transcript immediately
    try {
      execSync(
        `openclaw system event --text "Voice session transcript saved: ${saved.relativePath}" --mode now`,
        { timeout: 10000 }
      );
    } catch {
      // Non-fatal — transcript is saved; openclaw CLI may not be in PATH in all environments
      console.warn("Failed to fire openclaw system event for voice transcript");
    }

    return NextResponse.json({
      saved: true,
      path: saved.filePath,
      relativePath: saved.relativePath,
      messages: saved.messages,
      durationSeconds: saved.durationSeconds,
      outcome,
    });
  } catch (err) {
    console.error("Failed to save voice transcript:", err);
    return NextResponse.json({ error: "Failed to save transcript" }, { status: 500 });
  }
}
