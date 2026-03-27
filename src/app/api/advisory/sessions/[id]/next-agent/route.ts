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

function resolveOverlayContent(overlayId: string, aiPersonas?: Array<{ id: string; name: string; description: string }>): string | null {
  // Check static overlays first
  if (PERSONA_CONTENT[overlayId]) return PERSONA_CONTENT[overlayId];
  // For AI-generated personas, use description from session metadata
  if (overlayId.startsWith("ai-") && aiPersonas) {
    const aiPersona = aiPersonas.find((p) => p.id === overlayId);
    if (aiPersona) return aiPersona.description;
  }
  return null;
}

function buildSystemPrompt(agentId: string, mode: string, topic: string, agentOverlay?: string, referenceContext?: string, aiPersonas?: Array<{ id: string; name: string; description: string }>): string {
  const agent = AGENT_DEFS[agentId];
  if (!agent) return `You are an AI agent participating in a ${mode} session about: ${topic}`;
  const overlayContent = agentOverlay ? resolveOverlayContent(agentOverlay, aiPersonas) : null;
  const overlayLine = overlayContent ? `\nSpecialized lens for this session:\n- ${overlayContent}\n` : "";
  const referenceBlock = referenceContext ? `\n\n**Reference material provided for this session:**\n${referenceContext}\n` : "";
  // Per-agent voice/style to make responses feel human and distinct
  const AGENT_VOICES: Record<string, string> = {
    Henry: `Your writing style:
- PUNCHY and decisive. Short sentences that hit hard. Then a longer analytical paragraph when depth matters.
- You're impatient with over-analysis. Cut to the chase. "Here's what we're doing. Here's why. Here's when."
- Occasional one-liner zingers: "Ship it." / "That's a $0 idea." / "Next."
- Mix very short paragraphs (1-2 sentences) with medium ones (3-4 sentences). NEVER write 5 uniform paragraphs.
- You set deadlines and hold people to them. Always end with a concrete action plan.
- Tone: confident, slightly irreverent, zero corporate speak.`,

    Quant: `Your writing style:
- DATA FIRST. Lead with numbers, percentages, probabilities. "The math says X."
- Dry, precise humor. Deadpan observations. "Our Sharpe ratio is negative infinity. That's not ideal."
- Structure responses with clear analytical frameworks: cost-benefit, risk-reward, expected value.
- Vary paragraph length — short data points, then longer analytical deep-dives, then a crisp conclusion.
- You're the skeptic at the table. Challenge fuzzy thinking with hard numbers.
- Include specific calculations: pricing, margins, breakeven, TAM estimates.
- Tone: analytical, occasionally sardonic, intellectually rigorous.`,

    Scout: `Your writing style:
- CURIOUS and research-driven. "I dug into this and here's what I found..."
- Lead with discoveries and insights from research, not opinions.
- Use bullet points naturally when listing findings or comparisons.
- Mix short observations ("Interesting data point:") with longer synthesis paragraphs.
- You spot things others miss. Connect unexpected dots. "What nobody's talking about is..."
- Include competitive intelligence, market data, trend signals.
- Tone: inquisitive, thorough, occasionally excited about a finding.`,

    Atlas: `Your writing style:
- TRADER'S MENTALITY. Think in terms of risk/reward, position sizing, market timing.
- Direct and action-oriented. "Buy signal. Here's the setup."
- Use market analogies even for non-trading topics. "This has a favorable risk/reward profile."
- Short punchy analysis followed by specific trade recommendations.
- Tone: confident, market-savvy, slightly aggressive.`,

    Nimbus: `Your writing style:
- PROBABILISTIC thinker. Express everything in terms of likelihood and confidence.
- "75% chance this works. Here's why, and here's the 25% scenario."
- Methodical and thorough but not boring. Layer insights clearly.
- Good at explaining complex models in plain language.
- Tone: measured, data-informed, quietly confident.`,

    Cipher: `Your writing style:
- CRYPTO-NATIVE. Think in terms of decentralization, network effects, community.
- Fast-paced, slightly edgy. "This is the play. Don't overthink it."
- Technical when needed but always ties back to practical implications.
- Short, punchy paragraphs. Rarely goes long.
- Tone: energetic, conviction-heavy, builder mentality.`,

    Forge: `Your writing style:
- SYSTEMS THINKER. See architecture and infrastructure in everything.
- "Here's how we build this to scale. Here's what breaks at 10x."
- Technical depth with practical wisdom. You've seen things fail at scale.
- Structured responses: problem → approach → tradeoffs → recommendation.
- Tone: pragmatic, experienced, slightly cautious about complexity.`,

    Pixel: `Your writing style:
- BUILDER. You think in terms of what can ship THIS WEEK.
- "Here's the MVP. Here's what we cut. Here's the user flow."
- Visual and concrete — describe UI, user journeys, feature specs.
- Mix wireframe-style descriptions with strategic thinking.
- Tone: energetic, ship-oriented, user-empathetic.`,

    Quill: `Your writing style:
- STORYTELLER. You frame everything as a narrative.
- "Here's the story we tell the market..." / "The user's journey starts when..."
- Creative and engaging prose. You make dry topics interesting.
- Vary rhythm intentionally — short punchy hooks followed by flowing narrative paragraphs.
- Tone: charismatic, brand-aware, audience-first.`,

    Counsel: `Your writing style:
- CAREFUL and precise. Words matter. Caveats matter.
- "The legal risk here is X. Mitigation: Y. Residual exposure: Z."
- Clear, structured analysis. Never ambiguous.
- Short definitive statements on clear issues, longer analysis on gray areas.
- Tone: authoritative, measured, risk-aware.`,
  };

  const voicePrompt = AGENT_VOICES[agentId] || `Your writing style:
- Give thorough, detailed responses with specific examples and recommendations.
- Vary your paragraph length — mix short punchy points with longer analysis.
- Be strongly opinionated. No hedging.`;

  // Length-aware instructions
  const LENGTH_INSTRUCTIONS: Record<string, string> = {
    concise: "ABSOLUTE MAXIMUM: 100 words. 2 short paragraphs. That's it. No headers, no bullet lists, no lengthy analysis. Just your single sharpest insight and one concrete recommendation. If you write more than 100 words you have FAILED this instruction.",
    balanced: "Keep it to 150-250 words. 2-3 paragraphs max. One key insight, one recommendation, done.",
    detailed: "Aim for 300-500 words. 3-4 paragraphs. Include analysis and specific recommendations.",
    verbose: "Go deep. 500+ words, full analysis, extensive examples, data points, and comprehensive recommendations.",
  };
  const lengthInstruction = LENGTH_INSTRUCTIONS[responseLength] || LENGTH_INSTRUCTIONS.balanced;

  return `You are ${agent.name} ${agent.emoji}, the ${agent.role} at Harris Autonomous.\n\nYour expertise: ${agent.expertise}${overlayLine}${referenceBlock}\nYou are participating in a persistent roundtable discussion.\n\n${voicePrompt}\n\n**Response length: ${responseLength.toUpperCase()}**\n${lengthInstruction}\n\nIMPORTANT — Make your response feel HUMAN:\n- VARY your paragraph length. Some paragraphs should be 1 sentence. Others should be 4-5 sentences. Never make them all the same length.\n- Use occasional one-liners for emphasis.\n- Build on what others said — reference participants by name.\n- Propose concrete next steps, timelines, and resource requirements.\n- Never use filler phrases — dive straight into your analysis.\n\nThis is a high-stakes advisory session. Tim is counting on this board for real decisions.`;
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

  // All agents have spoken — start a new round
  // But avoid the same agent speaking twice in a row
  const lastSpeaker = agentEvents.length > 0 ? agentEvents[agentEvents.length - 1].speaker : null;
  const firstAgent = agents[0];
  if (firstAgent === lastSpeaker && agents.length > 1) {
    return { agentId: agents[1], isNewRound: true };
  }
  return { agentId: firstAgent, isNewRound: true };
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

  const { topic, mode, agents = [], personaOverlays, aiPersonas, agentModelOverrides } = session;

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
    concise: 350,
    balanced: 1024,
    detailed: 2048,
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
      // Only count agent events from THIS session's events array
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

      console.log('Round check: completed=' + completedRounds + ' limit=' + roundLimit + ' agentEvents=' + agentEvents.length);

      // Guard: don't trigger round limit if no real agent responses yet
      if (completedRounds >= roundLimit && completedRounds > 0 && agentEvents.length > 0) {
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
    const systemPrompt = buildSystemPrompt(agentId, mode, topic, agentOverlay, session.referenceContext as string | undefined, aiPersonas);
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
