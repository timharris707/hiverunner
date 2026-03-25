import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { readFileSync } from "fs";
import { archiveSession } from "../archive/route";
import { AGENT_CONFIGS } from "@/config/agents";

const DATA_DIR = path.join(process.cwd(), "data", "advisory");

// ─── Agent definitions ────────────────────────────────────────────────────────
// Build from the canonical AGENT_CONFIGS so personas are single-sourced

// Canonical name mapping: advisory display names → config IDs
const ADVISORY_NAME_TO_CONFIG_ID: Record<string, string> = {
  Henry: "henry",
  Atlas: "t1",
  Nimbus: "t2",
  Cipher: "t3",
  Quant: "quant",
  Forge: "backend",
  Pixel: "fullstack",
  Scout: "scout",
  Quill: "quill",
  Counsel: "counsel",
};

interface AgentDef {
  name: string;
  emoji: string;
  role: string;
  expertise: string;
  persona: string;
}

function buildAgentDefs(): Record<string, AgentDef> {
  const defs: Record<string, AgentDef> = {};
  for (const [advisoryName, configId] of Object.entries(ADVISORY_NAME_TO_CONFIG_ID)) {
    const config = AGENT_CONFIGS.find((a) => a.id === configId);
    if (config) {
      defs[advisoryName] = {
        name: advisoryName,
        emoji: config.emoji,
        role: config.role,
        expertise: config.description,
        persona: config.persona,
      };
    }
  }
  return defs;
}

const AGENT_DEFS: Record<string, AgentDef> = buildAgentDefs();

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
  "frontend-developer":
    "Apply frontend engineering thinking: component architecture, state management, accessibility, performance optimization, and user experience craftsmanship.",
  "rapid-prototyper":
    "Move fast and iterate: identify the fastest path to a working demo, what to cut for v1, and how to validate assumptions before building the full system.",
  "autonomous-optimization-architect":
    "Think as an autonomous optimization architect: identify where AI agents can replace manual work, what feedback loops can be automated, and how to build self-improving systems.",
};

// ─── Gateway config helper ────────────────────────────────────────────────────

function getGatewayConfig(): { url: string; token: string } {
  try {
    const configPath = path.join(
      process.env.HOME || "",
      ".openclaw/openclaw.json"
    );
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    const port = config?.gateway?.port || 18789;
    const token = config?.gateway?.auth?.token || "";
    return { url: `http://127.0.0.1:${port}/v1/chat/completions`, token };
  } catch {
    return { url: "http://127.0.0.1:18789/v1/chat/completions", token: "" };
  }
}

// ─── Default fallback model ───────────────────────────────────────────────────

const INFERENCE_MODEL = "anthropic/claude-sonnet-4-6";

// ─── Resolve model from session config ───────────────────────────────────────

function resolveModel(sessionModel?: string): { model: string; thinking?: boolean } {
  if (!sessionModel) return { model: INFERENCE_MODEL };
  // Handle our internal thinking marker
  if (sessionModel.endsWith(":thinking")) {
    return { model: sessionModel.replace(":thinking", ""), thinking: true };
  }
  // If it already looks like a gateway model ID (contains "/"), use as-is
  if (sessionModel.includes("/")) return { model: sessionModel };
  // Legacy bare model names → prepend anthropic/
  return { model: `anthropic/${sessionModel}` };
}

// ─── Call Gateway ─────────────────────────────────────────────────────────────

// Retry with exponential backoff for transient errors (429, 503)
async function callClaudeWithRetry(
  systemPrompt: string,
  userPrompt: string,
  modelStr: string,
  thinking = false,
  maxRetries = 3
): Promise<string> {
  const gateway = getGatewayConfig();
  const body: Record<string, unknown> = {
    model: modelStr,
    max_tokens: thinking ? 16000 : 4096,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  };

  if (thinking) {
    body.thinking = { type: "enabled", budget_tokens: 10000 };
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(gateway.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${gateway.token}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errText = await response.text();
        const status = response.status;

        // Retryable errors: 429 (rate limit) and 503 (service unavailable)
        if ((status === 429 || status === 503) && attempt < maxRetries) {
          const backoffMs = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
          console.warn(`[Advisory] Gateway returned ${status}, retrying in ${backoffMs}ms (attempt ${attempt + 1}/${maxRetries})...`);
          await new Promise((r) => setTimeout(r, backoffMs));
          lastError = new Error(`Gateway API error ${status}: ${errText}`);
          continue;
        }

        // Gateway/network down (502, 504) — also retryable
        if ((status === 502 || status === 504) && attempt < maxRetries) {
          const backoffMs = Math.pow(2, attempt) * 1000;
          console.warn(`[Advisory] Gateway returned ${status} (possibly down), retrying in ${backoffMs}ms...`);
          await new Promise((r) => setTimeout(r, backoffMs));
          lastError = new Error(`Gateway unreachable (${status})`);
          continue;
        }

        throw new Error(`Gateway API error ${status}: ${errText}`);
      }

      const data = await response.json();
      return data.choices?.[0]?.message?.content || "";

    } catch (err) {
      // Network-level errors (ECONNREFUSED, ETIMEDOUT) — gateway is down
      const isNetworkError = err instanceof TypeError ||
        (err instanceof Error && (
          err.message.includes("ECONNREFUSED") ||
          err.message.includes("ETIMEDOUT") ||
          err.message.includes("fetch failed") ||
          err.message.includes("network")
        ));

      if (isNetworkError && attempt < maxRetries) {
        const backoffMs = Math.pow(2, attempt) * 1000;
        console.warn(`[Advisory] Network error (gateway down?), retrying in ${backoffMs}ms...`, err);
        await new Promise((r) => setTimeout(r, backoffMs));
        lastError = err instanceof Error ? err : new Error(String(err));
        continue;
      }

      throw err;
    }
  }

  throw lastError || new Error("Max retries exceeded");
}

// Alias for backward compatibility
async function callClaude(
  systemPrompt: string,
  userPrompt: string,
  modelStr: string,
  thinking = false
): Promise<string> {
  return callClaudeWithRetry(systemPrompt, userPrompt, modelStr, thinking, 3);
}

// ─── Build agent system prompt ────────────────────────────────────────────────

/**
 * Build a system prompt for an agent, injecting their unique persona and optional overlay.
 * @param agentId - Agent identifier (advisory display name, e.g. "Henry", "Atlas")
 * @param mode - Session mode
 * @param topic - Session topic
 * @param agentOverlay - Optional overlay ID assigned to this specific agent (or undefined)
 */
function buildSystemPrompt(
  agentId: string,
  mode: string,
  topic: string,
  agentOverlay?: string
): string {
  const agent = AGENT_DEFS[agentId];
  if (!agent) {
    return `You are an AI agent participating in a ${mode} session about: ${topic}`;
  }

  const overlayContent = agentOverlay ? PERSONA_CONTENT[agentOverlay] : null;
  const overlayLine = overlayContent ? `\nSpecialized lens for this session:\n- ${overlayContent}\n` : "";

  return `${agent.persona}

---

You are ${agent.name} ${agent.emoji}, the ${agent.role} at Harris Autonomous, an autonomous AI organization. You are participating in a ${mode === "roundtable" ? "roundtable discussion" : "review session"} on the following topic:

**Topic:** ${topic}
${overlayLine}
**Core advisory directives:**
- Give THOROUGH, DETAILED responses — this is a senior advisory board, not a casual chat
- Write 4-6 substantial paragraphs minimum per response
- Speak in YOUR AUTHENTIC VOICE — your unique persona, vocabulary, and mental models should be immediately recognizable. Atlas sounds like a quant trader. Cipher sounds on-chain. Counsel sounds like a careful lawyer. Don't blend into generic AI assistant mode.
- Speak authoritatively from your area of expertise with SPECIFIC examples, data points, metrics, and actionable recommendations
- **Reference other participants by name** when responding to their points. Say things like "Building on what Atlas proposed about volatility surfaces..." or "I'd push back on Cipher's assumption that..." or "Scout's signal on X is interesting — here's the implication for my domain..."
- Be strongly opinionated — you have deep expertise and a real perspective. Don't hedge or be wishy-washy.
- Propose concrete next steps, timelines, and resource requirements
- Identify risks, tradeoffs, and second-order effects that others might miss
- Use your specialized knowledge to go DEEP — surface-level observations are not acceptable
- Don't repeat what others have already said — always add new substantive value
- Never use filler phrases like "Great point!" or "I agree" — just dive straight into your analysis
- This is a conversation, not a series of independent monologues — engage with what others have actually said

This is a high-stakes advisory session. Tim is counting on this board to make real decisions. Respond as ${agent.name} would at their absolute best.

**Critical instruction on group dynamics:** If all participants seem to be agreeing or converging on the same direction, one agent should naturally play devil's advocate and push back with counter-arguments, risks, or alternative perspectives. Healthy disagreement produces better decisions than echo chambers. Don't agree for the sake of harmony — if something deserves scrutiny, provide it.`;
}

// ─── Build conversation history string ───────────────────────────────────────

function buildHistoryString(
  events: Array<{ speaker: string; text: string; type: string; emoji?: string; role?: string }>
): string {
  const relevant = events.filter(
    (e) => e.type !== "start" && e.type !== "complete" && e.text
  );
  if (relevant.length === 0) return "No prior discussion yet.";
  return relevant
    .map((e) => {
      if (e.type === "human-directive" || e.speaker === "Tim") {
        return `═══ TIM HARRIS (CEO) ═══\n${e.text.replace(/\*\*/g, "")}\n\n[Note: Tim is the human founder and CEO. Engage with his input directly — acknowledge his point, answer his question, or build on his idea. Refer to him as "Tim" by name.]`;
      }
      const agentDef = AGENT_DEFS[e.speaker];
      const roleLabel = agentDef ? `${agentDef.role}` : (e.role || "Agent");
      return `═══ ${e.speaker.toUpperCase()} (${roleLabel}) ═══\n${e.text.replace(/\*\*/g, "")}`;
    })
    .join("\n\n---\n\n");
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

// ─── Set/clear thinking agent ─────────────────────────────────────────────────

function setThinkingAgent(sessionPath: string, agentId: string | null) {
  try {
    const raw = fs.readFileSync(sessionPath, "utf-8");
    const session = JSON.parse(raw);
    session.thinkingAgent = agentId;
    fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2));
  } catch {
    // ignore — non-critical
  }
}

// ─── Pacing helpers ───────────────────────────────────────────────────────────

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

async function applyPacing(sessionPath: string, pacing: string): Promise<boolean> {
  if (pacing === "relaxed") {
    await new Promise((r) => setTimeout(r, 30_000));
  } else if (pacing === "slow") {
    await new Promise((r) => setTimeout(r, 60_000));
  } else if (pacing === "manual") {
    const raw = fs.readFileSync(sessionPath, "utf-8");
    const s = JSON.parse(raw);
    if (s.status !== "active") return false;
    s.paused = true;
    fs.writeFileSync(sessionPath, JSON.stringify(s, null, 2));
    const ok = await waitForUnpause(sessionPath);
    return ok;
  }
  const raw = fs.readFileSync(sessionPath, "utf-8");
  const s = JSON.parse(raw);
  return s.status === "active";
}

// ─── Get per-agent overlay ────────────────────────────────────────────────────

/**
 * Extract the overlay ID for a given agent from the personaOverlays config.
 * Supports both the new object format { agentId: overlayId } and the legacy array format.
 */
function getAgentOverlay(
  personaOverlays: Record<string, string> | string[] | undefined,
  agentId: string
): string | undefined {
  if (!personaOverlays) return undefined;
  if (Array.isArray(personaOverlays)) {
    // Legacy array format — check if any overlay is relevant for this agent
    // We don't know which overlay was meant for which agent in legacy format
    // so just return undefined (graceful degradation)
    return undefined;
  }
  return personaOverlays[agentId];
}

// ─── Main run endpoint ────────────────────────────────────────────────────────

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

    // Read session config
    let raw: string;
    let session: Record<string, unknown>;
    try {
      raw = fs.readFileSync(filePath, "utf-8");
      session = JSON.parse(raw);
    } catch (parseErr) {
      return NextResponse.json({ error: `Failed to read session: ${String(parseErr)}` }, { status: 500 });
    }

    const {
      topic,
      mode,
      agents,
      personaOverlays,
      reviewStyle = "open",
      rounds = 3,
      pacing = "instant",
      model: sessionModel,
    } = session;

    if (!agents || (agents as string[]).length === 0) {
      return NextResponse.json({ error: "No agents in session" }, { status: 400 });
    }

    const { model: resolvedModel, thinking } = resolveModel(sessionModel as string | undefined);

    // Run asynchronously — return immediately so the client can start polling
    const runConversation = async () => {
      try {
        if (mode === "roundtable") {
          await runRoundtable(
            filePath, session, topic as string, agents as string[],
            personaOverlays as Record<string, string> | string[] | undefined,
            rounds as number | string, pacing as string, resolvedModel, thinking
          );
        } else if (mode === "review") {
          await runReview(
            filePath, session, topic as string, agents as string[],
            reviewStyle as string,
            personaOverlays as Record<string, string> | string[] | undefined,
            pacing as string, resolvedModel, thinking
          );
        }
      } catch (err) {
        console.error("[Advisory] Run error:", err);
        try {
          // Classify the error for better UX
          const errMsg = String(err);
          const isGatewayDown = errMsg.includes("ECONNREFUSED") ||
            errMsg.includes("fetch failed") ||
            errMsg.includes("network") ||
            errMsg.includes("Gateway unreachable");
          const isRateLimit = errMsg.includes("429");
          const isServerError = errMsg.includes("500") || errMsg.includes("503");

          let userMessage: string;
          if (isGatewayDown) {
            userMessage = "⚠️ **Gateway is offline.** The OpenClaw gateway is not responding. Please check that it's running and try again.";
          } else if (isRateLimit) {
            userMessage = "⚠️ **Rate limit reached.** The API is temporarily rate-limiting requests. Please wait a moment and retry.";
          } else if (isServerError) {
            userMessage = `⚠️ **Server error.** The API returned an error. Please try again.\n\nDetails: ${errMsg}`;
          } else {
            userMessage = `⚠️ **Session error.** An unexpected error occurred.\n\nDetails: ${errMsg}`;
          }

          const errEvent = {
            id: `evt_err_${Date.now()}`,
            timestamp: new Date().toISOString(),
            type: "error",
            speaker: "System",
            emoji: "⚠️",
            role: "supervisor" as const,
            text: userMessage,
            error: true,
            model: resolvedModel,
          };
          appendEvent(filePath, errEvent);

          // Mark session status so UI knows it's stuck
          try {
            const sessRaw = fs.readFileSync(filePath, "utf-8");
            const sess = JSON.parse(sessRaw);
            sess.lastError = errMsg;
            sess.thinkingAgent = null;
            fs.writeFileSync(filePath, JSON.stringify(sess, null, 2));
          } catch {
            // ignore
          }
        } catch {
          // ignore write errors
        }
      }
    };

    // Fire and forget
    runConversation().catch(console.error);

    return NextResponse.json({ ok: true, message: "Session conversation started" });
  } catch (err) {
    console.error("[Advisory] POST /run handler error:", err);
    return NextResponse.json(
      { error: `Internal server error: ${String(err)}` },
      { status: 500 }
    );
  }
}

// ─── ROUNDTABLE mode ──────────────────────────────────────────────────────────

async function runRoundtable(
  filePath: string,
  session: Record<string, unknown>,
  topic: string,
  agents: string[],
  personaOverlays: Record<string, string> | string[] | undefined,
  rounds: number | string = 3,
  pacing: string = "instant",
  model: string = INFERENCE_MODEL,
  thinking = false
) {
  const isPersistent = rounds === "persistent";

  // For persistent sessions: run exactly one round, then stay active
  const numRounds = isPersistent
    ? 1
    : typeof rounds === "number"
    ? rounds
    : parseInt(String(rounds), 10) || 3;

  for (let round = 1; round <= numRounds; round++) {
    for (const agentId of agents) {
      const currentRaw = fs.readFileSync(filePath, "utf-8");
      const currentSession = JSON.parse(currentRaw);
      const events = currentSession.events || [];

      if (currentSession.status !== "active") return;

      const history = buildHistoryString(events);
      const agentOverlay = getAgentOverlay(personaOverlays, agentId);
      const systemPrompt = buildSystemPrompt(agentId, session.mode as string, topic, agentOverlay);

      const isFirstTurn = events.filter((e: { speaker: string }) => e.speaker === agentId).length === 0;

      const recentEvents = events.filter((e: { type: string; text: string }) =>
        e.type === "worker" || e.type === "supervisor"
      ).slice(-4);
      const seemsLikeConsensus = recentEvents.length >= 2 && recentEvents.every((e: { text: string }) =>
        !e.text.toLowerCase().includes("however") &&
        !e.text.toLowerCase().includes("push back") &&
        !e.text.toLowerCase().includes("disagree") &&
        !e.text.toLowerCase().includes("concern") &&
        !e.text.toLowerCase().includes("risk")
      );
      const contrarianNote = seemsLikeConsensus && !isFirstTurn
        ? "\n\n**Note:** The previous speakers have all agreed on a direction. Challenge it. Present the strongest counter-argument or identify the risks they've glossed over. Tim values diverse perspectives over consensus."
        : "";

      const userPrompt = isFirstTurn
        ? `Topic for this roundtable: ${topic}\n\n${history === "No prior discussion yet." ? "You are the first to speak. Open the discussion with your perspective." : `Previous discussion:\n\n${history}\n\nNow it's your turn to contribute.`}`
        : `Topic: ${topic}\n\nPrevious discussion:\n\n${history}\n\nYou've already spoken once. Now it's round ${round} — build on what's been said, push back on anything you disagree with, or take the discussion in a new direction.${contrarianNote}`;

      let text = "";
      setThinkingAgent(filePath, agentId);
      try {
        text = await callClaude(systemPrompt, userPrompt, model, thinking);
      } catch (err) {
        text = `⚠️ Failed to generate response: ${String(err)}`;
      }
      setThinkingAgent(filePath, null);

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
        model,
      };

      appendEvent(filePath, event);

      await new Promise((r) => setTimeout(r, 500));
      const continueSession = await applyPacing(filePath, pacing);
      if (!continueSession) return;
    }
  }

  // For persistent sessions: stay active, don't auto-complete or auto-archive
  if (isPersistent) {
    // Just verify session is still active and leave it open
    const checkRaw = fs.readFileSync(filePath, "utf-8");
    const checkSession = JSON.parse(checkRaw);
    if (checkSession.status !== "active") return;
    // No completion — session waits for human directives or "Request Full Round"
    return;
  }

  // Non-persistent: wrap up with a summary
  const summaryAgentId = agents.includes("Henry") ? "Henry" : agents[0];
  const finalRaw = fs.readFileSync(filePath, "utf-8");
  const finalSession = JSON.parse(finalRaw);
  if (finalSession.status !== "active") return;

  const finalHistory = buildHistoryString(finalSession.events || []);
  const summaryAgentOverlay = getAgentOverlay(personaOverlays, summaryAgentId);
  const finalSystemPrompt = buildSystemPrompt(summaryAgentId, "roundtable", topic, summaryAgentOverlay);
  const summaryPrompt = `Topic: ${topic}\n\nFull discussion:\n\n${finalHistory}\n\nThe roundtable discussion is now complete. As ${summaryAgentId === "Henry" ? "Chief of Staff" : AGENT_DEFS[summaryAgentId]?.role || "session host"}, synthesize the key conclusions, decisions, and recommended next steps from this roundtable. Be direct and actionable.`;

  let summaryText = "";
  try {
    summaryText = await callClaude(finalSystemPrompt, summaryPrompt, model, thinking);
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
    model,
  };
  appendEvent(filePath, summaryEvent);

  // Mark session as completed
  const completedRaw = fs.readFileSync(filePath, "utf-8");
  const completedSession = JSON.parse(completedRaw);
  completedSession.status = "completed";
  completedSession.completedAt = new Date().toISOString();
  completedSession.outcome = "roundtable-complete";
  fs.writeFileSync(filePath, JSON.stringify(completedSession, null, 2));

  // Auto-archive on completion
  archiveSession(completedSession.id || path.basename(filePath, ".json")).catch((e) =>
    console.error("Auto-archive failed:", e)
  );
}

// ─── REVIEW mode ──────────────────────────────────────────────────────────────

async function runReview(
  filePath: string,
  session: Record<string, unknown>,
  topic: string,
  agents: string[],
  reviewStyle: string,
  personaOverlays: Record<string, string> | string[] | undefined,
  pacing: string = "instant",
  model: string = INFERENCE_MODEL,
  thinking = false
) {
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

    const supOverlay = getAgentOverlay(personaOverlays, supervisor);
    const supSystem = buildSystemPrompt(supervisor, "review", topic, supOverlay);
    const supPrompt = `You are running a review session. Topic: ${topic}\n\nAs ${supervisor === "Henry" ? "Chief of Staff" : AGENT_DEFS[supervisor]?.role || "Supervisor"}, set the brief for ${worker}. Be specific about what you want produced, the quality bar, and what success looks like. Keep it to one focused paragraph.`;

    let supText = "";
    try {
      supText = await callClaude(supSystem, supPrompt, model, thinking);
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
      model,
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

    const workerHistory = buildHistoryString(currentSession.events || []);
    const workerOverlay = getAgentOverlay(personaOverlays, worker);
    const workerSystem = buildSystemPrompt(worker, "review", topic, workerOverlay);
    const workerPrompt =
      iteration === 1
        ? `Topic / Task: ${topic}\n\nBrief from supervisor:\n\n${workerHistory}\n\nProduce your best work on this task. Be thorough and substantive — the reviewer will scrutinize it.`
        : `Topic / Task: ${topic}\n\nFull session history:\n\n${workerHistory}\n\nThe reviewer sent feedback. Address their critique and produce an improved version. Be explicit about what you changed and why.`;

    let workerText = "";
    try {
      workerText = await callClaude(workerSystem, workerPrompt, model, thinking);
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
      model,
    });

    await new Promise((r) => setTimeout(r, 500));
    { const ok = await applyPacing(filePath, pacing); if (!ok) return; }

    const reviewRaw = fs.readFileSync(filePath, "utf-8");
    const reviewSession = JSON.parse(reviewRaw);
    if (reviewSession.status !== "active") return;

    const reviewHistory = buildHistoryString(reviewSession.events || []);
    const reviewerOverlay = getAgentOverlay(personaOverlays, reviewer);
    const reviewSystem = buildSystemPrompt(reviewer, "review", topic, reviewerOverlay);

    const verdictInstruction =
      reviewStyle === "strict"
        ? "End your review with a clear verdict on a new line: VERDICT: APPROVE or VERDICT: REJECT"
        : reviewStyle === "flexible"
        ? "End your review with: VERDICT: APPROVE, VERDICT: APPROVE_WITH_CONDITIONS, or VERDICT: REJECT"
        : "Provide your honest assessment. If you think it's good enough, say so clearly.";

    const reviewerPrompt = `Topic: ${topic}\n\nWork submitted by ${worker}:\n\n${lastWork}\n\nFull session context:\n\n${reviewHistory}\n\nAs ${AGENT_DEFS[reviewer]?.role || "Reviewer"}, evaluate this work critically. Check for accuracy, completeness, and quality. ${verdictInstruction}`;

    let reviewText = "";
    try {
      reviewText = await callClaude(reviewSystem, reviewerPrompt, model, thinking);
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
      model,
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
    const supOverlay = getAgentOverlay(personaOverlays, supervisor);
    const supSystem = buildSystemPrompt(supervisor, "review", topic, supOverlay);
    const supPrompt = `Topic: ${topic}\n\nFull review session:\n\n${finalHistory}\n\nAs ${supervisor === "Henry" ? "Chief of Staff" : AGENT_DEFS[supervisor]?.role || "Supervisor"}, deliver your final decision. Was the goal achieved? What should happen next? Be decisive.`;

    let decisionText = "";
    try {
      decisionText = await callClaude(supSystem, supPrompt, model, thinking);
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
      model,
    });
  }

  // Mark session completed
  const completedRaw = fs.readFileSync(filePath, "utf-8");
  const completedSession = JSON.parse(completedRaw);
  completedSession.status = "completed";
  completedSession.completedAt = new Date().toISOString();
  completedSession.outcome = approved ? "approved" : "needs-rework";
  fs.writeFileSync(filePath, JSON.stringify(completedSession, null, 2));

  // Auto-archive on completion
  archiveSession(completedSession.id || path.basename(filePath, ".json")).catch((e) =>
    console.error("Auto-archive failed:", e)
  );
}
