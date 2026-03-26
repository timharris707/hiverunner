/**
 * POST /api/advisory/sessions/[id]/next-agent
 * Fires exactly ONE agent in a manual-pacing roundtable session.
 * Determines which agent goes next based on the current round cycle,
 * generates that agent's response, then pauses the session again.
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

function determineNextAgent(agents: string[], events: Array<{ speaker: string; type: string }>): { agentId: string; isNewRound: boolean } {
  // Filter to only agent response events (not human, not system, not start/complete)
  const agentEvents = events.filter(
    (e) => e.speaker !== "Tim" && e.speaker !== "System" && e.type !== "start" && e.type !== "complete" && e.type !== "human-directive"
  );

  // Track which agents have spoken in the current round
  const seenInCurrentRound = new Set<string>();
  for (const e of agentEvents) {
    if (seenInCurrentRound.has(e.speaker)) {
      // New round started — reset
      seenInCurrentRound.clear();
    }
    seenInCurrentRound.add(e.speaker);
  }

  // Find the first agent that hasn't spoken in this round
  for (const agentId of agents) {
    if (!seenInCurrentRound.has(agentId)) {
      return { agentId, isNewRound: seenInCurrentRound.size === 0 };
    }
  }

  // All agents have spoken — start a new round with the first agent
  return { agentId: agents[0], isNewRound: true };
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

  // Determine which agent goes next
  const events = session.events || [];

  // ── Round limit enforcement ──────────────────────────────────────────────
  const configuredRounds = session.rounds;
  if (configuredRounds && configuredRounds !== "persistent") {
    const roundLimit = Number(configuredRounds);
    if (!isNaN(roundLimit) && roundLimit > 0) {
      // Count completed rounds: a round is complete when every agent in session.agents has spoken once
      const agentEvents = events.filter(
        (e: { speaker: string; type: string }) =>
          e.speaker !== "Tim" && e.speaker !== "System" &&
          e.type !== "start" && e.type !== "complete" && e.type !== "human-directive"
      );
      const agentList = agents as string[];
      let completedRounds = 0;
      const seenInRound = new Set<string>();
      for (const e of agentEvents) {
        seenInRound.add(e.speaker);
        if (agentList.every((a: string) => seenInRound.has(a))) {
          completedRounds++;
          seenInRound.clear();
        }
      }

      if (completedRounds >= roundLimit) {
        // Round limit reached — trigger synthesis and complete the session
        const endRes = await fetch(
          new URL(`/api/advisory/sessions/${id}/end`, _req.url).toString(),
          { method: "POST" }
        );
        const endOk = endRes.ok;
        if (!endOk) {
          console.error("Failed to trigger end-session from round limit enforcement");
        }
        return NextResponse.json({
          ok: true,
          sessionComplete: true,
          message: `Round limit (${roundLimit}) reached — session ending with synthesis.`,
        });
      }
    }
  }

  const { agentId } = determineNextAgent(agents as string[], events);
  const agent = AGENT_DEFS[agentId];

  // Check for per-agent model override
  const agentOverrideModel = agentModelOverrides?.[agentId];
  if (agentOverrideModel) {
    if (agentOverrideModel.includes("/")) {
      resolvedModel = agentOverrideModel.replace(":thinking", "");
    } else {
      // Determine provider prefix based on model name
      const prefix = agentOverrideModel.startsWith("gpt") ? "openai/"
        : agentOverrideModel.startsWith("gemini") ? "google/" : "anthropic/";
      resolvedModel = `${prefix}${agentOverrideModel}`.replace(":thinking", "");
    }
  }

  // Set thinkingAgent so the UI can show who's about to respond
  try {
    const s = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    s.thinkingAgent = agentId;
    s.paused = false;
    fs.writeFileSync(filePath, JSON.stringify(s, null, 2));
  } catch { /* ignore */ }

  // Fire-and-forget: generate the single agent response, then re-pause
  const generateResponse = async () => {
    const currentRaw = fs.readFileSync(filePath, "utf-8");
    const currentSession = JSON.parse(currentRaw);
    if (currentSession.status !== "active" || currentSession.aborted) return;

    const currentEvents = currentSession.events || [];
    const history = buildHistoryString(currentEvents);
    const agentOverlay = getAgentOverlay(personaOverlays, agentId);
    const systemPrompt = buildSystemPrompt(agentId, mode, topic, agentOverlay, session.referenceContext as string | undefined);
    const userPrompt = `Topic: ${topic}\n\nCurrent discussion:\n\n${history}\n\nBuild on the current state of the discussion — advance the conversation with your freshest thinking. What's changed? What's been missed? What's the most important thing to address right now?`;

    let text = "";
    try {
      const gateway = getGatewayConfig();
      const response = await fetch(gateway.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${gateway.token}`,
        },
        body: JSON.stringify({
          model: resolvedModel,
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
      text = data.choices?.[0]?.message?.content || "";
    } catch (err) {
      text = `⚠️ Failed to generate response: ${String(err)}`;
    }

    // Check if session was aborted (user clicked End while we were generating)
    const checkRaw = fs.readFileSync(filePath, "utf-8");
    const checkSession = JSON.parse(checkRaw);
    if (checkSession.aborted || checkSession.status !== "active") {
      // Session was ended — discard this response silently
      return;
    }

    // Append the event
    const updatedRaw = fs.readFileSync(filePath, "utf-8");
    const updatedSession = JSON.parse(updatedRaw);
    updatedSession.events = [...(updatedSession.events || []), {
      id: `evt_next_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      type: "worker",
      speaker: agentId,
      emoji: agent?.emoji || "💬",
      role: agentId === "Henry" ? "supervisor" : "worker",
      text,
      model: resolvedModel,
    }];

    // Re-pause the session for manual pacing
    updatedSession.paused = true;
    updatedSession.thinkingAgent = null;
    fs.writeFileSync(filePath, JSON.stringify(updatedSession, null, 2));
  };

  generateResponse().catch((err) => {
    console.error("next-agent error:", err);
    // Clear thinking state on error
    try {
      const s = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      s.thinkingAgent = null;
      s.paused = true;
      fs.writeFileSync(filePath, JSON.stringify(s, null, 2));
    } catch { /* ignore */ }
  });

  return NextResponse.json({
    ok: true,
    nextAgent: agentId,
    message: `${agentId} is responding...`,
  });
}
