/**
 * POST /api/advisory/sessions/[id]/full-round
 * Triggers one full round — every agent responds once — on a persistent session.
 * Used by the "Request Full Round" button in the UI.
 */
import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { readFileSync } from "fs";

const DATA_DIR = path.join(process.cwd(), "data", "advisory");
const INFERENCE_MODEL = "anthropic/claude-sonnet-4-6";

const AGENT_DEFS: Record<string, { name: string; emoji: string; role: string; expertise: string }> = {
  Henry: { name: "Henry", emoji: "⚡", role: "Chief of Staff / Orchestrator", expertise: "Strategic oversight, orchestrating teams, identifying priorities, cutting through noise." },
  Atlas: { name: "Atlas", emoji: "📈", role: "Stocks & Options Trader", expertise: "Equity analysis, options strategies, technical and fundamental analysis, trade signal generation, portfolio risk management." },
  Nimbus: { name: "Nimbus", emoji: "🌤️", role: "Weather Prediction Trader", expertise: "Weather data analysis, prediction markets (Polymarket, Kalshi), seasonal patterns, event-driven opportunities." },
  Cipher: { name: "Cipher", emoji: "₿", role: "Crypto Trader", expertise: "Cryptocurrency markets, DeFi, on-chain metrics, momentum strategies, risk management for digital assets." },
  Quant: { name: "Quant", emoji: "📊", role: "Trading Strategy Architect", expertise: "Quantitative strategy design, backtesting, optimization, factor models, statistical arbitrage, alpha generation." },
  Forge: { name: "Forge", emoji: "🔧", role: "Backend Engineer", expertise: "Infrastructure design, APIs, databases, system reliability, CI/CD, DevOps, performance optimization, security hardening." },
  Pixel: { name: "Pixel", emoji: "💻", role: "Senior Full-Stack Engineer", expertise: "Web application development, React/Next.js/TypeScript, UI/UX, API integrations, rapid prototyping, shipping production code." },
  Scout: { name: "Scout", emoji: "🔭", role: "Research & Intelligence Agent", expertise: "Market research, competitive intelligence, trend analysis, data gathering, opportunity identification." },
  Quill: { name: "Quill", emoji: "✍️", role: "Creative Writer & Marketing Strategist", expertise: "Marketing copy, content strategy, brand voice, SEO, audience engagement, storytelling." },
  Counsel: { name: "Counsel", emoji: "⚖️", role: "Legal Expert Agent", expertise: "Legal research, contract review, regulatory compliance, risk exposure, IP guidance." },
};

const PERSONA_CONTENT: Record<string, string> = {
  "trading-strategist": "Apply deep quantitative analysis: momentum signals, mean-reversion, risk-reward optimization, position sizing.",
  "seo-specialist": "Bring an SEO lens: keyword research, SERP competition, content gap analysis, organic growth potential.",
  "growth-hacker": "Think like a growth hacker: viral loops, acquisition funnels, retention mechanics, rapid experimentation.",
  "content-creator": "Approach as a content creator: audience-first storytelling, platform-native formats, engagement optimization.",
  "compliance-auditor": "Audit for compliance: regulatory risks, legal exposure, audit trails, policy adherence.",
  "security-engineer": "Apply security engineering: threat modeling, vulnerability identification, secure design, auth hardening.",
  "devops-automator": "Think DevOps: CI/CD pipelines, infrastructure-as-code, monitoring, incident response, automation.",
  "reality-checker": "Be a reality checker: cut through hype, stress-test assumptions, identify blind spots and risks.",
  "trend-researcher": "As a trend researcher: emerging signals, market timing, early-mover advantages, competitive intelligence.",
  "data-analytics-reporter": "Think in data: clear metrics, insights with numbers, KPIs, data-driven next steps.",
  "backend-architect": "Apply backend architecture thinking: system design, API contracts, scalability, database schema, technical debt.",
  "frontend-developer": "Apply frontend engineering thinking: component architecture, state management, accessibility, performance.",
  "rapid-prototyper": "Move fast: fastest path to working demo, what to cut for v1, validate assumptions before building.",
  "autonomous-optimization-architect": "Think autonomous optimization: AI agents replacing manual work, feedback loops, self-improving systems.",
};

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

function getAgentOverlay(
  personaOverlays: Record<string, string> | string[] | undefined,
  agentId: string
): string | undefined {
  if (!personaOverlays || Array.isArray(personaOverlays)) return undefined;
  return personaOverlays[agentId];
}

function buildSystemPrompt(agentId: string, mode: string, topic: string, agentOverlay?: string, referenceContext?: string): string {
  const agent = AGENT_DEFS[agentId];
  if (!agent) return `You are an AI agent participating in a ${mode} session about: ${topic}`;
  const overlayContent = agentOverlay ? PERSONA_CONTENT[agentOverlay] : null;
  const overlayLine = overlayContent ? `\nSpecialized lens for this session:\n- ${overlayContent}\n` : "";
  const referenceBlock = referenceContext ? `\n\n**Reference material provided for this session:**\n${referenceContext}\n` : "";
  return `You are ${agent.name} ${agent.emoji}, the ${agent.role} at Harris Autonomous.\n\nYour expertise: ${agent.expertise}${overlayLine}${referenceBlock}\nYou are participating in a persistent roundtable discussion.\n\nYour communication style:\n- Give THOROUGH, DETAILED responses — this is a senior advisory board\n- Write 4-6 substantial paragraphs minimum\n- Speak authoritatively from your expertise with specific examples, data points, and actionable recommendations\n- Build on what others said — challenge assumptions, add new angles\n- Be strongly opinionated — no hedging\n- Propose concrete next steps, timelines, and resource requirements\n- Never use filler phrases — dive straight into your analysis\n- Reference other participants by name when responding to their points\n\nThis is a high-stakes advisory session. Tim is counting on this board for real decisions.`;
}

function buildHistoryString(events: Array<{ speaker: string; text: string; type: string }>): string {
  const relevant = events.filter((e) => e.type !== "start" && e.type !== "complete" && e.text);
  if (relevant.length === 0) return "No prior discussion yet.";
  return relevant.map((e) => {
    if (e.type === "human-directive" || e.speaker === "Tim") {
      return `**Tim (CEO):** ${e.text.replace(/\*\*/g, "")}\n(Tim is the human founder — treat him as the most senior person in the room.)`;
    }
    return `**${e.speaker}:** ${e.text.replace(/\*\*/g, "")}`;
  }).join("\n\n");
}

function appendEvent(sessionPath: string, event: Record<string, unknown>) {
  const raw = fs.readFileSync(sessionPath, "utf-8");
  const session = JSON.parse(raw);
  session.events = [...(session.events || []), event];
  fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2));
}

async function callGateway(systemPrompt: string, userPrompt: string, model: string, maxTokens = 2048): Promise<string> {
  const gateway = getGatewayConfig();
  const response = await fetch(gateway.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${gateway.token}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gateway error ${response.status}: ${err}`);
  }
  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

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

  const { topic, mode, agents = [], personaOverlays, agentModelOverrides } = session;

  // Resolve model
  const sessionModel = session.model;
  let resolvedModel = INFERENCE_MODEL;
  if (sessionModel) {
    if (sessionModel.includes("/")) {
      resolvedModel = sessionModel.replace(":thinking", "");
    } else {
      resolvedModel = `anthropic/${sessionModel}`.replace(":thinking", "");
    }
  }

  // Resolve response length
  const responseLength = (session.responseLength as string) || "balanced";
  const LENGTH_MAX_TOKENS: Record<string, number> = {
    concise: 1024,
    balanced: 2048,
    detailed: 3072,
    verbose: 4096,
  };
  const maxTokens = LENGTH_MAX_TOKENS[responseLength] ?? 2048;

  // Fire-and-forget: run one full round for all agents
  const runFullRound = async () => {
    for (const agentId of agents as string[]) {
      const currentRaw = fs.readFileSync(filePath, "utf-8");
      const currentSession = JSON.parse(currentRaw);
      if (currentSession.status !== "active") return;

      // Resolve per-agent model override
      let agentModel = resolvedModel;
      const agentOverrideModel = agentModelOverrides?.[agentId];
      if (agentOverrideModel) {
        if (agentOverrideModel.includes("/")) {
          agentModel = agentOverrideModel.replace(":thinking", "");
        } else {
          const prefix = agentOverrideModel.startsWith("gpt") ? "openai/"
            : agentOverrideModel.startsWith("gemini") ? "google/" : "anthropic/";
          agentModel = `${prefix}${agentOverrideModel}`.replace(":thinking", "");
        }
      }

      const events = currentSession.events || [];
      const history = buildHistoryString(events);
      const agentOverlay = getAgentOverlay(personaOverlays, agentId);
      const systemPrompt = buildSystemPrompt(agentId, mode, topic, agentOverlay, session.referenceContext as string | undefined);
      const userPrompt = `Topic: ${topic}\n\nCurrent discussion:\n\n${history}\n\nThis is a new full round. Build on the current state of the discussion — advance the conversation with your freshest thinking. What's changed? What's been missed? What's the most important thing to address right now?`;

      let text = "";
      try {
        text = await callGateway(systemPrompt, userPrompt, agentModel, maxTokens);
      } catch (err) {
        text = `⚠️ Failed to generate response: ${String(err)}`;
      }

      const agent = AGENT_DEFS[agentId];
      appendEvent(filePath, {
        id: `evt_fullround_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        timestamp: new Date().toISOString(),
        type: "worker",
        speaker: agentId,
        emoji: agent?.emoji || "💬",
        role: agentId === "Henry" ? "supervisor" : "worker",
        text,
        model: agentModel,
      });

      // Small delay between agents
      await new Promise((r) => setTimeout(r, 500));
    }
  };

  runFullRound().catch(console.error);

  return NextResponse.json({ ok: true, message: "Full round triggered" });
}
