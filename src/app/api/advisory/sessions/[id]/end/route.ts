import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { readFileSync } from "fs";
import { archiveSession } from "../archive/route";

const DATA_DIR = path.join(process.cwd(), "data", "advisory");
const INFERENCE_MODEL = "gemini-2.5-flash";

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

function getGeminiApiKey(): string {
  try {
    const configPath = path.join(process.env.HOME || "", ".openclaw/openclaw.json");
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    if (config?.env?.GEMINI_API_KEY) return config.env.GEMINI_API_KEY;
  } catch { /* fall through */ }
  return process.env.GEMINI_API_KEY || "";
}

async function callGemini(systemPrompt: string, userPrompt: string, apiKey: string): Promise<string> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${INFERENCE_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: userPrompt }] }],
        generationConfig: { maxOutputTokens: 2048 },
      }),
    }
  );
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${err}`);
  }
  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
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

  const apiKey = getGeminiApiKey();
  const { topic, agents = [], personaOverlays = [] } = session;

  // Pick the synthesizer — Henry if present, otherwise first agent
  const synthAgentId: string = agents.includes("Henry") ? "Henry" : (agents[0] as string);
  const synthAgent = AGENT_DEFS[synthAgentId];

  // Build the full discussion history
  const history = buildHistoryString(session.events || []);

  const overlayNames: string[] = (personaOverlays as string[])
    .map((id: string) => {
      const labels: Record<string, string> = {
        "trading-strategist": "Trading Strategist",
        "seo-specialist": "SEO Specialist",
        "growth-hacker": "Growth Hacker",
        "content-creator": "Content Creator",
        "compliance-auditor": "Compliance Auditor",
        "security-engineer": "Security Engineer",
        "devops-automator": "DevOps Automator",
        "reality-checker": "Reality Checker",
        "trend-researcher": "Trend Researcher",
        "data-analytics-reporter": "Data Analytics Reporter",
        "backend-architect": "Backend Architect",
      };
      return labels[id] || id;
    });

  const systemPrompt = `You are ${synthAgent?.name ?? synthAgentId} ${synthAgent?.emoji ?? "⚡"}, the ${synthAgent?.role ?? "Chief of Staff"} at Harris Autonomous.

You are delivering the final synthesis for an advisory board session that Tim has chosen to end. This is your closing statement.

Your synthesis must cover:
1. **Key Decisions** — concrete conclusions or consensus positions reached
2. **Key Findings** — the most important insights, data points, or recommendations surfaced
3. **Action Items** — specific next steps with suggested owners (from session participants)
4. **Open Questions** — unresolved issues that need follow-up
5. **Overall Assessment** — a brief verdict on where things stand and what Tim should do next

Be direct, specific, and crisp. No filler. Reference the actual content of the discussion. Tim is counting on this to be actionable.${overlayNames.length > 0 ? `\n\nSession context lenses: ${overlayNames.join(", ")}` : ""}`;

  const userPrompt = `Topic: ${topic}\n\nFull discussion:\n\n${history}\n\nDeliver the final synthesis. This session is now closing.`;

  // Fire-and-forget the synthesis (respond immediately, run async)
  const doEnd = async () => {
    let synthText = "";
    try {
      synthText = await callGemini(systemPrompt, userPrompt, apiKey);
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
      model: INFERENCE_MODEL,
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
