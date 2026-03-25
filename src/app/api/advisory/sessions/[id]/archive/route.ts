import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { readFileSync } from "fs";

const DATA_DIR = path.join(process.cwd(), "data", "advisory");
const WORKSPACE_DIR = "/Users/timharris/.openclaw/workspace";
const INFERENCE_MODEL = "anthropic/claude-sonnet-4-6";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getGatewayConfig(): { url: string; token: string } {
  try {
    const configPath = path.join(process.env.HOME || "", ".openclaw/openclaw.json");
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    const port = config?.gateway?.port || 18789;
    const token = config?.gateway?.auth?.token || "";
    return { url: `http://127.0.0.1:${port}/v1/chat/completions`, token };
  } catch {
    return { url: "http://127.0.0.1:18789/v1/chat/completions", token: "" };
  }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ensureDir(dirPath: string) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// ─── Gateway summarization ────────────────────────────────────────────────────

async function callGateway(prompt: string): Promise<string> {
  const gateway = getGatewayConfig();
  if (!gateway.token) throw new Error("No gateway token configured");

  const response = await fetch(gateway.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${gateway.token}`,
    },
    body: JSON.stringify({
      model: INFERENCE_MODEL,
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gateway API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

// ─── Build transcript markdown ────────────────────────────────────────────────

function buildTranscriptMarkdown(session: Record<string, unknown>): string {
  const topic = session.topic as string;
  const mode = session.mode as string;
  const agents = (session.agents as string[]) || [];
  const createdAt = session.createdAt as string;
  const pacing = (session.pacing as string) || "instant";
  const events = (session.events as Array<Record<string, unknown>>) || [];

  const dateStr = new Date(createdAt).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const modelsUsed = [...new Set(events.map((e) => e.model as string).filter(Boolean))];
  const modelsStr = modelsUsed.length > 0 ? modelsUsed.join(", ") : "N/A";

  const lines: string[] = [
    `# Advisory Board: ${topic}`,
    ``,
    `**Date:** ${dateStr} | **Mode:** ${mode} | **Pacing:** ${pacing}`,
    `**Participants:** ${agents.join(", ")}`,
    `**Model(s):** ${modelsStr}`,
    ``,
    `---`,
    ``,
  ];

  for (const event of events) {
    const speaker = event.speaker as string;
    const emoji = event.emoji as string;
    const text = event.text as string;
    const timestamp = event.timestamp as string;
    const role = (event.role as string) || "";
    const model = (event.model as string) || "";

    if (!text || !speaker) continue;

    const modelSuffix = model ? ` | *${model}*` : "";
    lines.push(`## ${emoji} ${speaker} (${role})${modelSuffix}`);
    lines.push(`*${formatTimestamp(timestamp)}*`);
    lines.push(``);
    lines.push(text);
    lines.push(``);
    lines.push(`---`);
    lines.push(``);
  }

  if (session.outcome) {
    lines.push(`**Outcome:** ${session.outcome}`);
    lines.push(``);
  }

  return lines.join("\n");
}

// ─── Archive logic ────────────────────────────────────────────────────────────

export async function archiveSession(sessionId: string): Promise<{ success: boolean; error?: string; transcriptPath?: string }> {
  const filePath = path.join(DATA_DIR, `${sessionId}.json`);
  if (!fs.existsSync(filePath)) {
    return { success: false, error: "Session not found" };
  }

  const raw = fs.readFileSync(filePath, "utf-8");
  const session = JSON.parse(raw);

  const topic = session.topic as string;
  const agents = (session.agents as string[]) || [];
  const events = (session.events as Array<Record<string, unknown>>) || [];
  const createdAt = session.createdAt as string;

  const dateSlug = new Date(createdAt).toISOString().split("T")[0];
  const topicSlug = slugify(topic);
  const fileName = `${dateSlug}-${topicSlug}.md`;

  // ── 1. Save transcript ──────────────────────────────────────────────────────
  const advisoryMemDir = path.join(WORKSPACE_DIR, "memory", "advisory");
  ensureDir(advisoryMemDir);

  const transcriptPath = path.join(advisoryMemDir, fileName);
  const transcriptMarkdown = buildTranscriptMarkdown(session);
  fs.writeFileSync(transcriptPath, transcriptMarkdown, "utf-8");

  // ── 2. Per-agent memory notes ───────────────────────────────────────────────
  const dateLabel = new Date(createdAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  for (const agentId of agents) {
    const agentEvents = events.filter(
      (e) =>
        e.speaker === agentId &&
        e.type !== "start" &&
        e.type !== "complete" &&
        e.text
    );

    if (agentEvents.length === 0) continue;

    const agentContributions = agentEvents
      .map((e) => `${e.text}`)
      .join("\n\n---\n\n");

    const firstEvent = agentEvents[0];
    const role = (firstEvent?.role as string) || "participant";

    const outcomeStr = session.outcome
      ? `Outcome: ${session.outcome}`
      : "Outcome: session completed";

    // Generate summary via Gateway
    let summaryBlock = "";
    try {
      const summaryPrompt = `You are summarizing an AI agent's contributions to an advisory board session.

Agent: ${agentId}
Session Topic: ${topic}
Date: ${dateLabel}

This agent's contributions:
${agentContributions}

Generate a concise memory note for this agent. Format it exactly like this (fill in the brackets):

- Key points made:
  - [bullet 1 — specific point or recommendation they made]
  - [bullet 2 — specific point or recommendation they made]
  - [bullet 3 if applicable]
- Decisions: [key outcomes or decisions from the session, 1 sentence]
- Action items: [any specific action items this agent was assigned, or "None identified"]

Be specific and concrete. Reference actual content from their contributions. Keep each bullet to 1-2 sentences.`;

      summaryBlock = await callGateway(summaryPrompt);
    } catch (err) {
      summaryBlock = `- Key points made:\n  - ${agentId} contributed to the advisory session\n- Decisions: ${outcomeStr}\n- Action items: None identified`;
      console.error(`Gateway summary failed for ${agentId}:`, err);
    }

    const agentMemDir = path.join(WORKSPACE_DIR, "memory", "agents", agentId);
    ensureDir(agentMemDir);

    const sessionsFile = path.join(agentMemDir, "sessions.md");
    const entryHeader = `### ${dateLabel} — ${topic}\n- Role: ${role}\n`;
    const entry = `${entryHeader}${summaryBlock}\n\n`;

    fs.appendFileSync(sessionsFile, entry, "utf-8");
  }

  // ── 3. Mark session as archived ─────────────────────────────────────────────
  session.archived = true;
  session.archivedAt = new Date().toISOString();
  session.transcriptPath = transcriptPath;
  fs.writeFileSync(filePath, JSON.stringify(session, null, 2));

  return { success: true, transcriptPath };
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const result = await archiveSession(id);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      message: "Session archived successfully",
      transcriptPath: result.transcriptPath,
    });
  } catch (err) {
    console.error("Archive error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
