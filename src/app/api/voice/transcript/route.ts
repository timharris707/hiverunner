/**
 * /api/voice/transcript — Save voice session transcript to HiveRunner-owned voice memory.
 *
 * POST body:
 * {
 *   transcript: Array<{ role: "user" | "assistant", text: string, timestamp: number }>;
 *   binding?: ResolvedVoiceBinding;
 *   sessionId?: string;
 *   acceptedMarkers?: Array<{ id: string; kind: "note" | "decision" | "blocker" | "followup"; summary: string; body: string }>;
 * }
 */

import { NextResponse } from "next/server";
import { normalizeResolvedVoiceBinding } from "@/lib/voice-binding";
import { persistVoiceTranscript } from "@/lib/voice-memory";
import { persistTaskBoundVoiceOutcome } from "@/lib/voice-outcome-persistence";
import { persistVoiceCostEvent } from "@/lib/voice-cost-persistence";

export async function POST(req: Request) {
  try {
    const { transcript, binding, sessionId, acceptedMarkers, usage } = await req.json();

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
    const costEventId = normalizedBinding
      ? persistVoiceCostEvent({
          sessionId,
          binding: normalizedBinding,
          usage,
          durationSeconds: saved.durationSeconds,
          messages: saved.messages,
        })
      : null;

    return NextResponse.json({
      saved: true,
      path: saved.filePath,
      relativePath: saved.relativePath,
      messages: saved.messages,
      durationSeconds: saved.durationSeconds,
      costEventId,
      outcome,
    });
  } catch (err) {
    console.error("Failed to save voice transcript:", err);
    return NextResponse.json({ error: "Failed to save transcript" }, { status: 500 });
  }
}
