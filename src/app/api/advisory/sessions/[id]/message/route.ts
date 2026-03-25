import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data", "advisory");

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const filePath = path.join(DATA_DIR, `${id}.json`);
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    const raw = fs.readFileSync(filePath, "utf-8");
    const session = JSON.parse(raw);

    const { text } = await req.json();
    if (!text?.trim()) {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }

    const eventId = `evt_${String(Date.now()).slice(-6)}`;
    const event = {
      id: eventId,
      timestamp: new Date().toISOString(),
      type: "supervisor",
      speaker: "Tim",
      emoji: "👤",
      role: "supervisor",
      text: `**[Human Directive]** ${text}`,
    };

    session.events = [...(session.events || []), event];
    fs.writeFileSync(filePath, JSON.stringify(session, null, 2));

    // Trigger a follow-up response from the next agent (fire-and-forget)
    // We call the run endpoint with a special flag via a background task
    triggerFollowUp(id, session, text).catch(console.error);

    return NextResponse.json({ event });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// ─── Trigger a follow-up agent response to a human message ───────────────────

async function triggerFollowUp(
  sessionId: string,
  session: {
    agents: string[];
    topic: string;
    mode: string;
    personaOverlays?: string[];
    events: Array<{ speaker: string; text: string; type: string }>;
  },
  humanMessage: string
) {
  const { readFileSync } = await import("fs");

  // Get API key
  let apiKey = "";
  try {
    const profilesPath = path.join(
      process.env.HOME || "",
      ".openclaw/agents/main/agent/auth-profiles.json"
    );
    const profiles = JSON.parse(readFileSync(profilesPath, "utf-8"));
    apiKey = profiles?.profiles?.["anthropic:default"]?.token || "";
  } catch {
    apiKey = process.env.ANTHROPIC_API_KEY || "";
  }

  if (!apiKey) return;

  const filePath = path.join(DATA_DIR, `${sessionId}.json`);
  const { agents, topic, mode, personaOverlays = [] } = session;

  // Pick the most relevant agent to respond (Henry if available, else first non-Tim agent)
  const respondingAgentId = agents.includes("Henry") ? "Henry" : agents[0];
  if (!respondingAgentId) return;

  // Build agent identity
  const AGENT_DEFS: Record<string, { name: string; emoji: string; role: string; expertise: string }> = {
    Henry: { name: "Henry", emoji: "⚡", role: "Chief of Staff / Orchestrator", expertise: "Strategic oversight, orchestrating teams, identifying priorities." },
    Atlas: { name: "Atlas", emoji: "📈", role: "Stocks & Options Trader", expertise: "Equity analysis, options strategies, portfolio risk management." },
    Nimbus: { name: "Nimbus", emoji: "🌤️", role: "Weather Prediction Trader", expertise: "Weather data, prediction markets, seasonal patterns." },
    Cipher: { name: "Cipher", emoji: "₿", role: "Crypto Trader", expertise: "Crypto markets, DeFi, momentum strategies." },
    Quant: { name: "Quant", emoji: "📊", role: "Trading Strategy Architect", expertise: "Quantitative strategy, backtesting, optimization." },
    Forge: { name: "Forge", emoji: "🔧", role: "Backend Engineer", expertise: "Infrastructure, APIs, databases, DevOps." },
    Pixel: { name: "Pixel", emoji: "💻", role: "Senior Full-Stack Engineer", expertise: "Web apps, React/Next.js, UI/UX, rapid prototyping." },
    Scout: { name: "Scout", emoji: "🔭", role: "Research & Intelligence", expertise: "Market research, competitive intelligence, trend analysis." },
    Quill: { name: "Quill", emoji: "✍️", role: "Creative Writer & Marketing Strategist", expertise: "Marketing copy, content strategy, brand voice." },
    Counsel: { name: "Counsel", emoji: "⚖️", role: "Legal Expert", expertise: "Legal research, contracts, regulatory compliance." },
  };

  const agent = AGENT_DEFS[respondingAgentId];
  if (!agent) return;

  // Read current session for history
  const currentRaw = readFileSync(filePath, "utf-8");
  const currentSession = JSON.parse(currentRaw);
  if (currentSession.status !== "active") return;

  const historyLines = (currentSession.events || [])
    .filter((e: { type: string }) => e.type !== "start")
    .map((e: { speaker: string; text: string }) => `**${e.speaker}:** ${e.text.replace(/\*\*/g, "")}`)
    .join("\n\n");

  const systemPrompt = `You are ${agent.name} ${agent.emoji}, the ${agent.role} at Harris Autonomous.
Your expertise: ${agent.expertise}

You are in a ${mode === "roundtable" ? "roundtable discussion" : "review session"} about: ${topic}

Respond directly to the human's directive. Be helpful, specific, and use your expertise.`;

  const userPrompt = `Previous discussion:\n\n${historyLines}\n\nTim (Human) just said: "${humanMessage}"\n\nRespond as ${agent.name} to Tim's directive.`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!response.ok) return;
    const data = await response.json();
    const replyText = data.content?.[0]?.text || "";

    if (replyText) {
      const replyEvent = {
        id: `evt_reply_${Date.now()}`,
        timestamp: new Date().toISOString(),
        type: respondingAgentId === "Henry" ? "supervisor" : "worker",
        speaker: respondingAgentId,
        emoji: agent.emoji,
        role: respondingAgentId === "Henry" ? "supervisor" : "worker",
        text: replyText,
      };

      const latestRaw = readFileSync(filePath, "utf-8");
      const latestSession = JSON.parse(latestRaw);
      latestSession.events = [...(latestSession.events || []), replyEvent];
      fs.writeFileSync(filePath, JSON.stringify(latestSession, null, 2));
    }
  } catch (err) {
    console.error("Follow-up agent response error:", err);
  }
}
