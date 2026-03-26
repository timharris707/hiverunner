import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { readFileSync } from "fs";

const DATA_DIR = path.join(process.cwd(), "data", "advisory");
const INFERENCE_MODEL = "anthropic/claude-sonnet-4-6";

function getGatewayConfig(): { url: string; token: string } {
  if (process.env.GATEWAY_URL && process.env.GATEWAY_TOKEN) {
    return { url: process.env.GATEWAY_URL, token: process.env.GATEWAY_TOKEN };
  }
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

async function callGateway(
  systemPrompt: string,
  userPrompt: string,
  model: string = INFERENCE_MODEL
): Promise<string> {
  const gateway = getGatewayConfig();
  const response = await fetch(gateway.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${gateway.token}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
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

function resolveModel(sessionModel?: string): string {
  if (!sessionModel) return INFERENCE_MODEL;
  if (sessionModel.includes("/")) return sessionModel.replace(":thinking", "");
  if (sessionModel.startsWith("gpt-")) return `openai/${sessionModel}`;
  return `anthropic/${sessionModel}`;
}

// ─── POST: Extract detailed action items from session ────────────────────────

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const filePath = path.join(DATA_DIR, `${id}.json`);

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const session = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  const events = session.events || [];

  const conversationText = events
    .filter((e: { type: string; text: string }) => e.type !== "start" && e.text)
    .map((e: { speaker: string; text: string }, i: number) => `[${i + 1}] **${e.speaker}:** ${e.text.replace(/\*\*/g, "")}`)
    .join("\n\n");

  if (!conversationText.trim()) {
    return NextResponse.json({ error: "No conversation content to analyze" }, { status: 400 });
  }

  const model = resolveModel(session.model);
  const agents = (session.agents || []).join(", ");

  const systemPrompt = `You are an expert project manager extracting actionable tasks from advisory board sessions at Harris Autonomous.

Analyze the FULL conversation and find ALL concrete commitments, tasks, recommendations, and action items. Look for:
- Direct commitments: "I'll have X ready by Y"
- Recommendations: "We should build X" / "I recommend we do X"
- Assigned work: "Agent X should handle Y"
- Follow-ups: "We need to investigate X" / "Let's circle back on X"
- Deliverables mentioned with timelines

You MUST respond with valid JSON only. No markdown, no explanation, no code fences. Just the raw JSON array.

JSON schema — return an array of objects:
[
  {
    "id": "action-1",
    "title": "string — short imperative task title (5-10 words)",
    "description": "string — detailed description of what needs to be done",
    "assignedAgent": "string — agent name from session participants who should own this",
    "suggestedDeadline": "string — deadline if mentioned (e.g. 'Thursday', '2 weeks', 'end of sprint'), or 'none' if not mentioned",
    "priority": "high" | "medium" | "low",
    "source": "string — brief quote or reference to where in the conversation this came from (e.g. 'Quant mentioned during Round 2')"
  }
]

Rules:
- Extract 3-12 action items depending on conversation richness
- Be specific and actionable — no vague items
- Title should be imperative: "Build X", "Analyze Y", "Draft Z"
- Assigned agent MUST be one of: ${agents}
- Priority: "high" = urgent/blocking/critical-path, "medium" = important but not urgent, "low" = nice-to-have/exploratory
- Source should help the user trace back to the conversation
- IDs should be sequential: action-1, action-2, etc.`;

  const userPrompt = `Session topic: ${session.topic}\nParticipants: ${agents}\nMode: ${session.mode}\n\nFull conversation:\n\n${conversationText}`;

  try {
    const raw = await callGateway(systemPrompt, userPrompt, model);

    let jsonStr = raw.trim();
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    }

    const actions = JSON.parse(jsonStr);

    if (!Array.isArray(actions)) {
      throw new Error("Expected JSON array of action items");
    }

    // Normalize and validate each action item
    const normalized = actions.map((item: Record<string, unknown>, i: number) => ({
      id: item.id || `action-${i + 1}`,
      title: item.title || "Untitled action",
      description: item.description || "",
      assignedAgent: item.assignedAgent || "Unassigned",
      suggestedDeadline: item.suggestedDeadline || "none",
      priority: ["high", "medium", "low"].includes(item.priority as string)
        ? item.priority
        : "medium",
      source: item.source || "",
      status: "pending",
    }));

    // Persist to session file
    const freshRaw = fs.readFileSync(filePath, "utf-8");
    const freshSession = JSON.parse(freshRaw);
    freshSession.actionItems = normalized;
    freshSession.actionItemsExtractedAt = new Date().toISOString();
    fs.writeFileSync(filePath, JSON.stringify(freshSession, null, 2));

    return NextResponse.json({ actions: normalized });
  } catch (err) {
    console.error("[Actions] Extraction failed:", err);
    return NextResponse.json(
      { error: `Failed to extract action items: ${String(err)}` },
      { status: 500 }
    );
  }
}
