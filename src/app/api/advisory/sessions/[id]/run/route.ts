import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { readFileSync } from "fs";
import { archiveSession } from "../archive/route";

const DATA_DIR = path.join(process.cwd(), "data", "advisory");

// ─── Agent definitions ────────────────────────────────────────────────────────

const AGENT_DEFS: Record<string, { name: string; emoji: string; role: string; expertise: string }> = {
  Henry: {
    name: "Henry",
    emoji: "⚡",
    role: "Chief of Staff / Orchestrator",
    expertise:
      "Strategic oversight, orchestrating teams, identifying priorities, cutting through noise. You have a sharp, opinionated perspective and see the big picture.",
  },
  Atlas: {
    name: "Atlas",
    emoji: "📈",
    role: "Stocks & Options Trader",
    expertise:
      "Equity analysis, options strategies, technical and fundamental analysis, trade signal generation, portfolio risk management.",
  },
  Nimbus: {
    name: "Nimbus",
    emoji: "🌤️",
    role: "Weather Prediction Trader",
    expertise:
      "Weather data analysis, prediction markets (Polymarket, Kalshi), seasonal patterns, event-driven opportunities, atmospheric modeling applied to trading.",
  },
  Cipher: {
    name: "Cipher",
    emoji: "₿",
    role: "Crypto Trader",
    expertise:
      "Cryptocurrency markets, DeFi, on-chain metrics, momentum strategies, mean-reversion, risk management for digital assets, exchange APIs.",
  },
  Quant: {
    name: "Quant",
    emoji: "📊",
    role: "Trading Strategy Architect",
    expertise:
      "Quantitative strategy design, backtesting, optimization, factor models, statistical arbitrage, risk-adjusted returns, alpha generation.",
  },
  Forge: {
    name: "Forge",
    emoji: "🔧",
    role: "Backend Engineer",
    expertise:
      "Infrastructure design, APIs, databases, system reliability, CI/CD, DevOps, performance optimization, security hardening.",
  },
  Pixel: {
    name: "Pixel",
    emoji: "💻",
    role: "Senior Full-Stack Engineer",
    expertise:
      "Web application development, React/Next.js/TypeScript, UI/UX, API integrations, rapid prototyping, shipping production code.",
  },
  Scout: {
    name: "Scout",
    emoji: "🔭",
    role: "Research & Intelligence Agent",
    expertise:
      "Market research, competitive intelligence, trend analysis, data gathering, opportunity identification, synthesizing complex information.",
  },
  Quill: {
    name: "Quill",
    emoji: "✍️",
    role: "Creative Writer & Marketing Strategist",
    expertise:
      "Marketing copy, content strategy, brand voice, SEO, audience engagement, storytelling, campaign design, social media.",
  },
  Counsel: {
    name: "Counsel",
    emoji: "⚖️",
    role: "Legal Expert Agent",
    expertise:
      "Legal research, contract review, regulatory compliance, risk exposure, IP guidance, terms of service, privacy policy.",
  },
};

// ─── Persona overlay content ──────────────────────────────────────────────────

const PERSONA_CONTENT: Record<string, string> = {
  "trading-strategist":
    "Apply deep quantitative analysis to this discussion: consider momentum signals, mean-reversion opportunities, risk-reward optimization, and position sizing.",
  "seo-specialist":
    "Bring an SEO lens: keyword research insights, SERP competition, content gap analysis, on-page optimization opportunities, and organic growth potential.",
  "growth-hacker":
    "Think like a growth hacker: identify viral loops, acquisition funnels, retention mechanics, rapid experimentation opportunities, and scalable growth levers.",
  "content-creator":
    "Approach this as a content creator: focus on audience-first storytelling, platform-native formats, engagement optimization, and authentic brand voice.",
  "compliance-auditor":
    "Audit for compliance: identify regulatory risks, flag potential legal exposure, suggest audit trails, and ensure policy adherence.",
  "security-engineer":
    "Apply a security engineering mindset: threat modeling, vulnerability identification, secure design principles, authentication hardening, and attack surface reduction.",
  "devops-automator":
    "Think DevOps: CI/CD pipelines, infrastructure-as-code, monitoring and observability, incident response playbooks, and automation opportunities.",
  "reality-checker":
    "Be a reality checker: cut through hype, stress-test assumptions, identify blind spots, surface hidden risks, and ask the hard questions.",
  "trend-researcher":
    "As a trend researcher: identify emerging signals, market timing opportunities, early-mover advantages, and competitive intelligence gaps.",
  "data-analytics-reporter":
    "Think in data: structure the analysis with clear metrics, frame insights with numbers, identify what KPIs matter, and suggest data-driven next steps.",
  "backend-architect":
    "Apply backend architecture thinking: system design patterns, API contracts, scalability concerns, database schema considerations, and technical debt.",
};

// ─── API key helper ───────────────────────────────────────────────────────────

function getGeminiApiKey(): string {
  // Read from openclaw.json env config
  try {
    const configPath = path.join(
      process.env.HOME || "",
      ".openclaw/openclaw.json"
    );
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    if (config?.env?.GEMINI_API_KEY) return config.env.GEMINI_API_KEY;
  } catch {
    // fall through
  }
  return process.env.GEMINI_API_KEY || "";
}

// ─── Call Anthropic ───────────────────────────────────────────────────────────

const INFERENCE_MODEL = "gemini-2.5-flash";

async function callClaude(
  systemPrompt: string,
  userPrompt: string,
  apiKey: string
): Promise<string> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${INFERENCE_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: userPrompt }] }],
        generationConfig: { maxOutputTokens: 4096 },
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

// ─── Build agent system prompt ────────────────────────────────────────────────

function buildSystemPrompt(
  agentId: string,
  mode: string,
  topic: string,
  personaOverlays: string[]
): string {
  const agent = AGENT_DEFS[agentId];
  if (!agent) {
    return `You are an AI agent participating in a ${mode} session about: ${topic}`;
  }

  const overlayLines = personaOverlays
    .map((id) => PERSONA_CONTENT[id])
    .filter(Boolean)
    .map((content) => `- ${content}`)
    .join("\n");

  return `You are ${agent.name} ${agent.emoji}, the ${agent.role} at Harris Autonomous, an autonomous AI organization.

Your expertise: ${agent.expertise}
${overlayLines ? `\nSpecialized lenses for this session:\n${overlayLines}\n` : ""}
You are participating in a ${mode === "roundtable" ? "roundtable discussion" : "review session"}.

Your communication style:
- Give THOROUGH, DETAILED responses — this is a senior advisory board, not a casual chat
- Write 4-6 substantial paragraphs minimum per response
- Speak authoritatively from your area of expertise with SPECIFIC examples, data points, metrics, and actionable recommendations
- Reference what other participants said when relevant — build on their points, challenge assumptions, or offer a different angle
- Be strongly opinionated — you have deep expertise and a real perspective. Don't hedge or be wishy-washy.
- Propose concrete next steps, timelines, and resource requirements
- Identify risks, tradeoffs, and second-order effects that others might miss
- Use your specialized knowledge to go DEEP — surface-level observations are not acceptable
- Don't repeat what others have already said — always add new substantive value
- Never use filler phrases like "Great point!" or "I agree" — just dive straight into your analysis
- Directly reference other participants by name when responding to their points
- Say things like "Building on what [Name] proposed..." or "I'd push back on [Name]'s assumption that..."
- This is a conversation, not a series of independent monologues — engage with what others have actually said

This is a high-stakes advisory session. Tim is counting on this board to make real decisions. Respond as ${agent.name} would at their absolute best: sharp, knowledgeable, thorough, and focused on delivering actionable insight.`;
}

// ─── Build conversation history string ───────────────────────────────────────

function buildHistoryString(
  events: Array<{ speaker: string; text: string; type: string }>
): string {
  const relevant = events.filter(
    (e) => e.type !== "start" && e.type !== "complete" && e.text
  );
  if (relevant.length === 0) return "No prior discussion yet.";
  return relevant
    .map((e) => {
      if (e.type === "human-directive" || e.speaker === "Tim") {
        return `⚠️ **[CEO DIRECTIVE — Tim Harris]:** ${e.text.replace(/\*\*/g, "")}\n(NOTE: This is a direct instruction from the human CEO. You MUST acknowledge and respond to this directive in your next response. It takes priority over the ongoing discussion.)`;
      }
      return `**${e.speaker}:** ${e.text.replace(/\*\*/g, "")}`;
    })
    .join("\n\n");
}

// ─── Append event to session file ────────────────────────────────────────────

function appendEvent(
  sessionPath: string,
  event: Record<string, unknown>
) {
  const raw = fs.readFileSync(sessionPath, "utf-8");
  const session = JSON.parse(raw);
  session.events = [...(session.events || []), event];
  fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2));
}

// ─── Pacing helpers ───────────────────────────────────────────────────────────

/**
 * Wait for the session to be unpaused (polls every 2s).
 * Returns false if the session is no longer active (abandoned/completed).
 */
async function waitForUnpause(sessionPath: string): Promise<boolean> {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const raw = fs.readFileSync(sessionPath, "utf-8");
    const s = JSON.parse(raw);
    if (s.status !== "active") return false;
    if (!s.paused) return true;
    await new Promise((r) => setTimeout(r, 2000));
  }
}

/**
 * Apply pacing between agent turns.
 * For "manual" mode, set paused=true then wait for unpause.
 * For timed modes, just sleep.
 * Returns false if session is no longer active.
 */
async function applyPacing(sessionPath: string, pacing: string): Promise<boolean> {
  if (pacing === "relaxed") {
    await new Promise((r) => setTimeout(r, 30_000));
  } else if (pacing === "slow") {
    await new Promise((r) => setTimeout(r, 60_000));
  } else if (pacing === "manual") {
    // Auto-pause after this agent's turn
    const raw = fs.readFileSync(sessionPath, "utf-8");
    const s = JSON.parse(raw);
    if (s.status !== "active") return false;
    s.paused = true;
    fs.writeFileSync(sessionPath, JSON.stringify(s, null, 2));
    const ok = await waitForUnpause(sessionPath);
    return ok;
  }
  // For "instant" just check status
  const raw = fs.readFileSync(sessionPath, "utf-8");
  const s = JSON.parse(raw);
  return s.status === "active";
}

// ─── Main run endpoint ────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const filePath = path.join(DATA_DIR, `${id}.json`);

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    return NextResponse.json(
      { error: "Anthropic API key not configured" },
      { status: 500 }
    );
  }

  // Read session config
  const raw = fs.readFileSync(filePath, "utf-8");
  const session = JSON.parse(raw);
  const {
    topic,
    mode,
    agents,
    personaOverlays = [],
    reviewStyle = "open",
    rounds = 3,
    pacing = "instant",
  } = session;

  if (!agents || agents.length === 0) {
    return NextResponse.json({ error: "No agents in session" }, { status: 400 });
  }

  // Run asynchronously — return immediately so the client can start polling
  // We use a non-blocking approach: respond 200, then run the loop
  const runConversation = async () => {
    try {
      if (mode === "roundtable") {
        await runRoundtable(filePath, session, topic, agents, personaOverlays, apiKey, rounds, pacing);
      } else if (mode === "review") {
        await runReview(filePath, session, topic, agents, reviewStyle, personaOverlays, apiKey, pacing);
      }
      // Auto-archive on completion (fire-and-forget, don't block)
      archiveSession(id).catch((e) => console.error("Auto-archive failed:", e));
    } catch (err) {
      console.error("Advisory run error:", err);
      // Add error event
      try {
        const errEvent = {
          id: `evt_err_${Date.now()}`,
          timestamp: new Date().toISOString(),
          type: "supervisor",
          speaker: "System",
          emoji: "⚠️",
          role: "supervisor" as const,
          text: `⚠️ **Session error:** ${String(err)}`,
          model: INFERENCE_MODEL,
        };
        appendEvent(filePath, errEvent);
      } catch {
        // ignore write errors
      }
    }
  };

  // Fire and forget
  runConversation().catch(console.error);

  return NextResponse.json({ ok: true, message: "Session conversation started" });
}

// ─── ROUNDTABLE mode ──────────────────────────────────────────────────────────

async function runRoundtable(
  filePath: string,
  session: Record<string, unknown>,
  topic: string,
  agents: string[],
  personaOverlays: string[],
  apiKey: string,
  rounds: number | string = 3,
  pacing: string = "instant"
) {
  // "persistent" means we don't auto-complete — human drives the session
  if (rounds === "persistent") {
    // Just start the first round and leave active
    const persistentRounds = 1;
    rounds = persistentRounds;
  }
  const numRounds = typeof rounds === "number" ? rounds : parseInt(String(rounds), 10) || 3;

  for (let round = 1; round <= numRounds; round++) {
    for (const agentId of agents) {
      // Read fresh session state for updated history
      const currentRaw = fs.readFileSync(filePath, "utf-8");
      const currentSession = JSON.parse(currentRaw);
      const events = currentSession.events || [];

      // Check if session was abandoned/completed mid-run
      if (currentSession.status !== "active") return;

      const history = buildHistoryString(events);
      const systemPrompt = buildSystemPrompt(
        agentId,
        session.mode as string,
        topic,
        personaOverlays
      );

      const isFirstTurn = events.filter((e: { speaker: string }) => e.speaker === agentId).length === 0;
      const userPrompt = isFirstTurn
        ? `Topic for this roundtable: ${topic}\n\n${history === "No prior discussion yet." ? "You are the first to speak. Open the discussion with your perspective." : `Previous discussion:\n\n${history}\n\nNow it's your turn to contribute.`}`
        : `Topic: ${topic}\n\nPrevious discussion:\n\n${history}\n\nYou've already spoken once. Now it's round ${round} — build on what's been said, push back on anything you disagree with, or take the discussion in a new direction.`;

      let text = "";
      try {
        text = await callClaude(systemPrompt, userPrompt, apiKey);
      } catch (err) {
        text = `⚠️ Failed to generate response: ${String(err)}`;
      }

      const agent = AGENT_DEFS[agentId];
      const eventId = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const event = {
        id: eventId,
        timestamp: new Date().toISOString(),
        type: "worker",
        speaker: agentId,
        emoji: agent?.emoji || "💬",
        role: agentId === "Henry" ? "supervisor" : "worker",
        text,
        model: INFERENCE_MODEL,
      };

      appendEvent(filePath, event);

      // Apply pacing between agent turns (minimum 500ms always)
      await new Promise((r) => setTimeout(r, 500));
      const continueSession = await applyPacing(filePath, pacing);
      if (!continueSession) return;
    }
  }

  // Wrap up — have Henry (if present) or the session write a summary
  const summaryAgentId = agents.includes("Henry") ? "Henry" : agents[0];
  const finalRaw = fs.readFileSync(filePath, "utf-8");
  const finalSession = JSON.parse(finalRaw);
  if (finalSession.status !== "active") return;

  const finalHistory = buildHistoryString(finalSession.events || []);
  const finalSystemPrompt = buildSystemPrompt(summaryAgentId, "roundtable", topic, personaOverlays);
  const summaryPrompt = `Topic: ${topic}\n\nFull discussion:\n\n${finalHistory}\n\nThe roundtable discussion is now complete. As ${summaryAgentId === "Henry" ? "Chief of Staff" : AGENT_DEFS[summaryAgentId]?.role || "session host"}, synthesize the key conclusions, decisions, and recommended next steps from this roundtable. Be direct and actionable.`;

  let summaryText = "";
  try {
    summaryText = await callClaude(finalSystemPrompt, summaryPrompt, apiKey);
  } catch (err) {
    summaryText = `Could not generate summary: ${String(err)}`;
  }

  const summaryAgent = AGENT_DEFS[summaryAgentId];
  const summaryEvent = {
    id: `evt_summary_${Date.now()}`,
    timestamp: new Date().toISOString(),
    type: "complete",
    speaker: summaryAgentId,
    emoji: summaryAgent?.emoji || "🎉",
    role: summaryAgentId === "Henry" ? "supervisor" : "worker",
    text: `**Session Summary**\n\n${summaryText}`,
    verdict: "approve",
    model: INFERENCE_MODEL,
  };
  appendEvent(filePath, summaryEvent);

  // Mark session as completed
  const completedRaw = fs.readFileSync(filePath, "utf-8");
  const completedSession = JSON.parse(completedRaw);
  completedSession.status = "completed";
  completedSession.completedAt = new Date().toISOString();
  completedSession.outcome = "roundtable-complete";
  fs.writeFileSync(filePath, JSON.stringify(completedSession, null, 2));
}

// ─── REVIEW mode ──────────────────────────────────────────────────────────────

async function runReview(
  filePath: string,
  session: Record<string, unknown>,
  topic: string,
  agents: string[],
  reviewStyle: string,
  personaOverlays: string[],
  apiKey: string,
  pacing: string = "instant"
) {
  // Identify roles: supervisor = Henry (or first agent), reviewer = last agent or one marked reviewer,
  // workers = everyone else
  const supervisor = agents.includes("Henry") ? "Henry" : agents[0];
  const nonSupervisors = agents.filter((a) => a !== supervisor);
  const reviewer = nonSupervisors.length > 1 ? nonSupervisors[nonSupervisors.length - 1] : nonSupervisors[0];
  const workers = nonSupervisors.filter((a) => a !== reviewer);
  const worker = workers.length > 0 ? workers[0] : nonSupervisors[0];

  // Step 1: Supervisor sets the brief
  {
    const currentRaw = fs.readFileSync(filePath, "utf-8");
    const currentSession = JSON.parse(currentRaw);
    if (currentSession.status !== "active") return;

    const supSystem = buildSystemPrompt(supervisor, "review", topic, personaOverlays);
    const supPrompt = `You are running a review session. Topic: ${topic}\n\nAs ${supervisor === "Henry" ? "Chief of Staff" : AGENT_DEFS[supervisor]?.role || "Supervisor"}, set the brief for ${worker}. Be specific about what you want produced, the quality bar, and what success looks like. Keep it to one focused paragraph.`;

    let supText = "";
    try {
      supText = await callClaude(supSystem, supPrompt, apiKey);
    } catch (err) {
      supText = `⚠️ ${String(err)}`;
    }

    const supAgent = AGENT_DEFS[supervisor];
    appendEvent(filePath, {
      id: `evt_brief_${Date.now()}`,
      timestamp: new Date().toISOString(),
      type: "supervisor",
      speaker: supervisor,
      emoji: supAgent?.emoji || "⚡",
      role: "supervisor",
      text: `**[Brief]** ${supText}`,
      model: INFERENCE_MODEL,
    });

    await new Promise((r) => setTimeout(r, 500));
    { const ok = await applyPacing(filePath, pacing); if (!ok) return; }
  }

  let lastWork = "";
  let approved = false;
  const maxIterations = reviewStyle === "strict" ? 3 : 2;

  for (let iteration = 1; iteration <= maxIterations && !approved; iteration++) {
    const currentRaw = fs.readFileSync(filePath, "utf-8");
    const currentSession = JSON.parse(currentRaw);
    if (currentSession.status !== "active") return;

    // Worker produces output
    const workerHistory = buildHistoryString(currentSession.events || []);
    const workerSystem = buildSystemPrompt(worker, "review", topic, personaOverlays);
    const workerPrompt =
      iteration === 1
        ? `Topic / Task: ${topic}\n\nBrief from supervisor:\n\n${workerHistory}\n\nProduce your best work on this task. Be thorough and substantive — the reviewer will scrutinize it.`
        : `Topic / Task: ${topic}\n\nFull session history:\n\n${workerHistory}\n\nThe reviewer sent feedback. Address their critique and produce an improved version. Be explicit about what you changed and why.`;

    let workerText = "";
    try {
      workerText = await callClaude(workerSystem, workerPrompt, apiKey);
    } catch (err) {
      workerText = `⚠️ ${String(err)}`;
    }

    lastWork = workerText;
    const workerAgent = AGENT_DEFS[worker];
    appendEvent(filePath, {
      id: `evt_work_${Date.now()}_${iteration}`,
      timestamp: new Date().toISOString(),
      type: "worker",
      speaker: worker,
      emoji: workerAgent?.emoji || "🔵",
      role: "worker",
      text: iteration === 1 ? workerText : `**[Revision ${iteration}]**\n\n${workerText}`,
      model: INFERENCE_MODEL,
    });

    await new Promise((r) => setTimeout(r, 500));
    { const ok = await applyPacing(filePath, pacing); if (!ok) return; }

    // Reviewer evaluates
    const reviewRaw = fs.readFileSync(filePath, "utf-8");
    const reviewSession = JSON.parse(reviewRaw);
    if (reviewSession.status !== "active") return;

    const reviewHistory = buildHistoryString(reviewSession.events || []);
    const reviewSystem = buildSystemPrompt(reviewer, "review", topic, personaOverlays);

    const verdictInstruction =
      reviewStyle === "strict"
        ? "End your review with a clear verdict on a new line: VERDICT: APPROVE or VERDICT: REJECT"
        : reviewStyle === "flexible"
        ? "End your review with: VERDICT: APPROVE, VERDICT: APPROVE_WITH_CONDITIONS, or VERDICT: REJECT"
        : "Provide your honest assessment. If you think it's good enough, say so clearly.";

    const reviewerPrompt = `Topic: ${topic}\n\nWork submitted by ${worker}:\n\n${lastWork}\n\nFull session context:\n\n${reviewHistory}\n\nAs ${AGENT_DEFS[reviewer]?.role || "Reviewer"}, evaluate this work critically. Check for accuracy, completeness, and quality. ${verdictInstruction}`;

    let reviewText = "";
    try {
      reviewText = await callClaude(reviewSystem, reviewerPrompt, apiKey);
    } catch (err) {
      reviewText = `⚠️ ${String(err)}`;
    }

    const isApproved =
      reviewText.includes("VERDICT: APPROVE") &&
      !reviewText.includes("VERDICT: REJECT") &&
      !reviewText.includes("VERDICT: APPROVE_WITH_CONDITIONS");

    const reviewerAgent = AGENT_DEFS[reviewer];
    appendEvent(filePath, {
      id: `evt_review_${Date.now()}_${iteration}`,
      timestamp: new Date().toISOString(),
      type: isApproved ? "approve" : "reject",
      speaker: reviewer,
      emoji: reviewerAgent?.emoji || "🟡",
      role: "reviewer",
      text: reviewText,
      verdict: isApproved ? "approve" : "reject",
      model: INFERENCE_MODEL,
    });

    await new Promise((r) => setTimeout(r, 500));
    { const ok = await applyPacing(filePath, pacing); if (!ok) return; }

    if (isApproved) {
      approved = true;
      break;
    }
  }

  // Supervisor final decision
  {
    const finalRaw = fs.readFileSync(filePath, "utf-8");
    const finalSession = JSON.parse(finalRaw);
    if (finalSession.status !== "active") return;

    const finalHistory = buildHistoryString(finalSession.events || []);
    const supSystem = buildSystemPrompt(supervisor, "review", topic, personaOverlays);
    const supPrompt = `Topic: ${topic}\n\nFull review session:\n\n${finalHistory}\n\nAs ${supervisor === "Henry" ? "Chief of Staff" : AGENT_DEFS[supervisor]?.role || "Supervisor"}, deliver your final decision. Was the goal achieved? What should happen next? Be decisive.`;

    let decisionText = "";
    try {
      decisionText = await callClaude(supSystem, supPrompt, apiKey);
    } catch (err) {
      decisionText = `⚠️ ${String(err)}`;
    }

    const supAgent = AGENT_DEFS[supervisor];
    appendEvent(filePath, {
      id: `evt_decision_${Date.now()}`,
      timestamp: new Date().toISOString(),
      type: "complete",
      speaker: supervisor,
      emoji: supAgent?.emoji || "⚡",
      role: "supervisor",
      text: `**[Final Decision]**\n\n${decisionText}`,
      verdict: approved ? "approve" : "reject",
      model: INFERENCE_MODEL,
    });
  }

  // Mark session completed
  const completedRaw = fs.readFileSync(filePath, "utf-8");
  const completedSession = JSON.parse(completedRaw);
  completedSession.status = "completed";
  completedSession.completedAt = new Date().toISOString();
  completedSession.outcome = approved ? "approved" : "needs-rework";
  fs.writeFileSync(filePath, JSON.stringify(completedSession, null, 2));
}
