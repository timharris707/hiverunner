/**
 * /api/voice/transcript — Save voice session transcript to Henry's memory.
 *
 * POST body: { transcript: Array<{ role: "user" | "henry", text: string, timestamp: number }> }
 * Writes to: /Users/timharris/.openclaw/workspace/memory/voice/YYYY-MM-DD-HHMMSS.md
 */

import { NextResponse } from "next/server";
import { execSync } from "child_process";
import { persistVoiceTranscript } from "@/lib/voice-memory";

export async function POST(req: Request) {
  try {
    const { transcript } = await req.json();

    if (!transcript || !Array.isArray(transcript) || transcript.length === 0) {
      return NextResponse.json({ error: "No transcript data" }, { status: 400 });
    }

    const saved = await persistVoiceTranscript(transcript);

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
    });
  } catch (err) {
    console.error("Failed to save voice transcript:", err);
    return NextResponse.json({ error: "Failed to save transcript" }, { status: 500 });
  }
}
