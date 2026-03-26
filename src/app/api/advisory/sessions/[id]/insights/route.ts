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

// ─── GET: Return existing insights ──────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const filePath = path.join(DATA_DIR, `${id}.json`);

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const session = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return NextResponse.json({ insights: session.insights || null });
}

// ─── POST: Extract insights via LLM ────────────────────────────────────────

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

  // Build conversation text
  const conversationText = events
    .filter((e: { type: string; text: string; speaker: string }) => e.type !== "start" && e.text)
    .map((e: { speaker: string; text: string }) => `**${e.speaker}:** ${e.text.replace(/\*\*/g, "")}`)
    .join("\n\n");

  if (!conversationText.trim()) {
    return NextResponse.json({ error: "No conversation content to analyze" }, { status: 400 });
  }

  const model = resolveModel(session.model);

  const systemPrompt = `You are an expert analyst extracting structured insights from advisory board sessions at Harris Autonomous.

Analyze the full conversation and extract:
1. **Action Items** — specific tasks that should be done, with who should do them, by when (if mentioned), and priority
2. **Key Decisions** — concrete conclusions or consensus positions reached
3. **Open Questions** — unresolved issues that need follow-up
4. **Risks Identified** — potential risks, concerns, or red flags surfaced

You MUST respond with valid JSON only. No markdown, no explanation, no code fences. Just the raw JSON object.

The JSON schema:
{
  "actionItems": [
    {
      "description": "string — what needs to be done",
      "assignedAgent": "string — agent name who should own this (from session participants)",
      "priority": "high" | "medium" | "low",
      "status": "pending"
    }
  ],
  "keyDecisions": [
    "string — a concrete decision that was made"
  ],
  "openQuestions": [
    "string — an unresolved question"
  ],
  "risksIdentified": [
    "string — a risk or concern"
  ]
}

Rules:
- Be specific and actionable — no vague items
- Action items must have a clear owner from the session participants: ${(session.agents || []).join(", ")}
- Priority: "high" = urgent/blocking, "medium" = important but not urgent, "low" = nice-to-have
- Extract 3-8 action items, 2-5 decisions, 1-4 open questions, 1-4 risks
- If the conversation doesn't contain enough content for a category, use an empty array`;

  const userPrompt = `Session topic: ${session.topic}\nParticipants: ${(session.agents || []).join(", ")}\nMode: ${session.mode}\n\nFull conversation:\n\n${conversationText}`;

  try {
    const raw = await callGateway(systemPrompt, userPrompt, model);

    // Parse the JSON response — handle potential markdown fences
    let jsonStr = raw.trim();
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    }

    const insights = JSON.parse(jsonStr);

    // Validate structure
    if (!insights.actionItems || !Array.isArray(insights.actionItems)) {
      throw new Error("Invalid insights format: missing actionItems array");
    }

    // Ensure all action items have required fields
    insights.actionItems = insights.actionItems.map((item: Record<string, unknown>) => ({
      description: item.description || "Untitled action item",
      assignedAgent: item.assignedAgent || "Unassigned",
      priority: ["high", "medium", "low"].includes(item.priority as string) ? item.priority : "medium",
      status: "pending",
    }));

    insights.keyDecisions = insights.keyDecisions || [];
    insights.openQuestions = insights.openQuestions || [];
    insights.risksIdentified = insights.risksIdentified || [];
    insights.extractedAt = new Date().toISOString();

    // Save to session
    const freshRaw = fs.readFileSync(filePath, "utf-8");
    const freshSession = JSON.parse(freshRaw);
    freshSession.insights = insights;
    fs.writeFileSync(filePath, JSON.stringify(freshSession, null, 2));

    return NextResponse.json({ insights });
  } catch (err) {
    console.error("[Insights] Extraction failed:", err);
    return NextResponse.json(
      { error: `Failed to extract insights: ${String(err)}` },
      { status: 500 }
    );
  }
}

// ─── PATCH: Update action item status ───────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const filePath = path.join(DATA_DIR, `${id}.json`);

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const body = await req.json();
  const { actionIndex, status } = body;

  if (typeof actionIndex !== "number" || !["pending", "done"].includes(status)) {
    return NextResponse.json({ error: "Invalid actionIndex or status" }, { status: 400 });
  }

  const raw = fs.readFileSync(filePath, "utf-8");
  const session = JSON.parse(raw);

  if (!session.insights?.actionItems?.[actionIndex]) {
    return NextResponse.json({ error: "Action item not found" }, { status: 404 });
  }

  session.insights.actionItems[actionIndex].status = status;
  fs.writeFileSync(filePath, JSON.stringify(session, null, 2));

  return NextResponse.json({ insights: session.insights });
}
