/**
 * /api/voice/transcript — Save voice session transcript to Henry's memory.
 *
 * POST body: { transcript: Array<{ role: "user" | "henry", text: string, timestamp: number }> }
 * Writes to: /Users/timharris/.openclaw/workspace/memory/voice/YYYY-MM-DD-HHMMSS.md
 */

import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

export async function POST(req: Request) {
  try {
    const { transcript } = await req.json();

    if (!transcript || !Array.isArray(transcript) || transcript.length === 0) {
      return NextResponse.json({ error: "No transcript data" }, { status: 400 });
    }

    const workspacePath = process.env.OPENCLAW_WORKSPACE || "/Users/timharris/.openclaw/workspace";
    const voiceDir = path.join(workspacePath, "memory", "voice");

    // Ensure directory exists
    await mkdir(voiceDir, { recursive: true });

    // Generate filename
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const filename = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.md`;

    // Format transcript as markdown
    const duration = transcript.length > 1
      ? Math.round((transcript[transcript.length - 1].timestamp - transcript[0].timestamp) / 1000)
      : 0;
    const minutes = Math.floor(duration / 60);
    const seconds = duration % 60;

    let md = `# Voice Session — ${now.toLocaleDateString("en-US", { weekday: "short", year: "numeric", month: "short", day: "numeric" })} ${now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "America/Los_Angeles" })}\n\n`;
    md += `**Duration:** ${minutes}m ${seconds}s · **Messages:** ${transcript.length}\n\n---\n\n`;

    for (const entry of transcript) {
      const speaker = entry.role === "user" ? "**Tim:**" : "**Henry ⚡:**";
      md += `${speaker} ${entry.text}\n\n`;
    }

    const filePath = path.join(voiceDir, filename);
    await writeFile(filePath, md, "utf-8");

    return NextResponse.json({
      saved: true,
      path: filePath,
      messages: transcript.length,
    });
  } catch (err) {
    console.error("Failed to save voice transcript:", err);
    return NextResponse.json({ error: "Failed to save transcript" }, { status: 500 });
  }
}
