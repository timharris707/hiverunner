import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { readFileSync } from "fs";
import { archiveSession } from "../archive/route";

const DATA_DIR = path.join(process.cwd(), "data", "advisory");
const INFERENCE_MODEL = "anthropic/claude-sonnet-4-6";

const AGENT_DEFS: Record<string, { name: string; emoji: string; role: string }> = {
  Henry: { name: "Henry", emoji: "⚡", role: "Chief of Staff / Orchestrator" },
  Atlas: { name: "Atlas", emoji: "📈", role: "Stocks & Options Trader" },
  Nimbus: { name: "Nimbus", emoji: "🌤️", role: "Weather Prediction Trader" },
  Cipher: { name: "Cipher", emoji: "₿", role: "Crypto Trader" },
  Quant: { name: "Quant", emoji: "📊", role: "Trading Strategy Architect" },
  Forge: { name: "Forge", emoji: "🔧", role: "Backend Engineer" },
  Pixel: { name: "Pixel", emoji: "💻", role: "Senior Full-Stack Engineer" },
  Scout: { name: "Scout", emoji: "🔭", role: "Research & Intelligence Agent" },
  Quill: { name: "Quill", emoji: "✍️", role: "Creative Writer & Marketing" },
  Counsel: { name: "Counsel", emoji: "⚖️", role: "Legal Expert Agent" },
};

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
      "Authorization": `Bearer ${gateway.token}`,
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

function appendEvent(sessionPath: string, event: Record<string, unknown>) {
  const raw = fs.readFileSync(sessionPath, "utf-8");
  const session = JSON.parse(raw);
  session.events = [...(session.events || []), event];
  fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2));
}

function buildHistoryString(events: Array<{ speaker: string; text: string; type: string }>): string {
  const relevant = events.filter((e) => e.type !== "start" && e.type !== "complete" && e.text);
  if (relevant.length === 0) return "No prior discussion yet.";
  return relevant.map((e) => `**${e.speaker}:** ${e.text.replace(/\*\*/g, "")}`).join("\n\n");
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const filePath = path.join(DATA_DIR, `${id}.json`);

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const raw = fs.readFileSync(filePath, "utf-8");
  const session = JSON.parse(raw);

  if (session.status !== "active") {
    return NextResponse.json({ error: "Session is not active" }, { status: 400 });
  }

  const { topic, agents = [], personaOverlays = {} } = session;

  // Resolve model from session config
  const sessionModel = session.model;
  let resolvedModel = INFERENCE_MODEL;
  if (sessionModel) {
    if (sessionModel.includes("/")) {
      resolvedModel = sessionModel.replace(":thinking", "");
    } else {
      resolvedModel = `anthropic/${sessionModel}`.replace(":thinking", "");
    }
  }

  // Pick the synthesizer — Henry if present, otherwise first agent
  const synthAgentId: string = (agents as string[]).includes("Henry") ? "Henry" : ((agents as string[])[0] || "Henry");
  const synthAgent = AGENT_DEFS[synthAgentId];

  // Build the full discussion history
  const history = buildHistoryString(session.events || []);

  // Overlay names for context
  const overlayObj = Array.isArray(personaOverlays) ? {} : personaOverlays as Record<string, string>;
  const overlayNames = Object.values(overlayObj).filter(Boolean);
  const overlayContext = overlayNames.length > 0 ? `\n\nSession context lenses: ${overlayNames.join(", ")}` : "";

  const systemPrompt = `You are ${synthAgent?.name ?? synthAgentId} ${synthAgent?.emoji ?? "⚡"}, the ${synthAgent?.role ?? "Chief of Staff"} at Harris Autonomous.

You are delivering the final synthesis for an advisory board session that Tim has chosen to end. This is your closing statement.

Your synthesis must cover:
1. **Key Decisions** — concrete conclusions or consensus positions reached
2. **Key Findings** — the most important insights, data points, or recommendations surfaced
3. **Action Items** — specific next steps with suggested owners (from session participants)
4. **Open Questions** — unresolved issues that need follow-up
5. **Overall Assessment** — a brief verdict on where things stand and what Tim should do next

Be direct, specific, and crisp. No filler. Reference the actual content of the discussion. Tim is counting on this to be actionable.${overlayContext}`;

  const userPrompt = `Topic: ${topic}\n\nFull discussion:\n\n${history}\n\nDeliver the final synthesis. This session is now closing.`;

  // Fire-and-forget the synthesis
  const doEnd = async () => {
    let synthText = "";
    try {
      synthText = await callGateway(systemPrompt, userPrompt, resolvedModel);
    } catch (err) {
      synthText = `⚠️ Could not generate synthesis: ${String(err)}\n\nSession has been marked as completed.`;
    }

    appendEvent(filePath, {
      id: `evt_synthesis_${Date.now()}`,
      timestamp: new Date().toISOString(),
      type: "complete",
      speaker: synthAgentId,
      emoji: synthAgent?.emoji ?? "⚡",
      role: synthAgentId === "Henry" ? "supervisor" : "worker",
      text: `**⚡ Final Synthesis**\n\n${synthText}`,
      verdict: "approve",
      model: resolvedModel,
    });

    // Mark session completed
    const freshRaw = fs.readFileSync(filePath, "utf-8");
    const freshSession = JSON.parse(freshRaw);
    freshSession.status = "completed";
    freshSession.completedAt = new Date().toISOString();
    freshSession.outcome = "ended-by-user";
    freshSession.paused = false;
    fs.writeFileSync(filePath, JSON.stringify(freshSession, null, 2));

    // Auto-archive
    archiveSession(id).catch((e) => console.error("End-session archive failed:", e));
  };

  doEnd().catch(console.error);

  return NextResponse.json({ ok: true, message: "End session triggered" });
}
