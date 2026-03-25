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
  // GPT models → prepend openai/
  if (sessionModel.startsWith("gpt-")) return { model: `openai/${sessionModel}` };
  // Claude / other bare model names → prepend anthropic/
  return { model: `anthropic/${sessionModel}` };
}

// ─── Call Gateway ─────────────────────────────────────────────────────────────

// Retry with exponential backoff for transient errors (429, 503)
async function callClaudeWithRetry(
  systemPrompt: string,
  userPrompt: string,
  modelStr: string,
  thinking = false,
  maxRetries = 3,
  maxTokensOverride?: number
): Promise<string> {
  const gateway = getGatewayConfig();
  const body: Record<string, unknown> = {
    model: modelStr,
    max_tokens: thinking ? 16000 : (maxTokensOverride ?? 4096),
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
  thinking = false,
  maxTokensOverride?: number
): Promise<string> {
  return callClaudeWithRetry(systemPrompt, userPrompt, modelStr, thinking, 3, maxTokensOverride);
}

// ─── Response length settings ─────────────────────────────────────────────────

export type ResponseLength = "concise" | "balanced" | "detailed" | "verbose";

const RESPONSE_LENGTH_CONFIG: Record<ResponseLength, { maxTokens: number; instruction: string }> = {
  concise: {
    maxTokens: 1024,
    instruction: "Be brief and punchy — 1-2 focused paragraphs max.",
  },
  balanced: {
    maxTokens: 2048,
    instruction: "Give thorough but focused responses — 2-3 paragraphs.",
  },
  detailed: {
    maxTokens: 3072,
    instruction: "Give comprehensive analysis — 3-5 paragraphs with supporting detail.",
  },
  verbose: {
    maxTokens: 4096,
    instruction: "Give exhaustive analysis — cover every angle in depth.",
  },
};

const DEFAULT_RESPONSE_LENGTH: ResponseLength = "balanced";

// ─── Build agent system prompt ────────────────────────────────────────────────

/**
 * Build a system prompt for an agent, injecting their unique persona and optional overlay.
 * @param agentId - Agent identifier (advisory display name, e.g. "Henry", "Atlas")
 * @param mode - Session mode
 * @param topic - Session topic
 * @param agentOverlay - Optional overlay ID assigned to this specific agent (or undefined)
 * @param responseLength - Response length setting
 */
function buildSystemPrompt(
  agentId: string,
  mode: string,
  topic: string,
  agentOverlay?: string,
  responseLength?: ResponseLength,
  reviewRole?: "author" | "reviewer" | "supervisor"
): string {
  const agent = AGENT_DEFS[agentId];
  if (!agent) {
    return `You are an AI agent participating in a ${mode} session about: ${topic}`;
  }

  const overlayContent = agentOverlay ? PERSONA_CONTENT[agentOverlay] : null;
  const overlayLine = overlayContent ? `\nSpecialized lens for this session:\n- ${overlayContent}\n` : "";

  const lengthConfig = RESPONSE_LENGTH_CONFIG[responseLength || DEFAULT_RESPONSE_LENGTH];
  const lengthInstruction = lengthConfig.instruction;

  const isReview = mode === "review";

  // ── Review mode: fundamentally different prompts per role ──────────────────
  if (isReview && reviewRole) {
    const baseIdentity = `${agent.persona}

---

You are ${agent.name} ${agent.emoji}, the ${agent.role} at Harris Autonomous, an autonomous AI organization.

**Topic:** ${topic}
${overlayLine}
**Response length:** ${lengthInstruction}`;

    if (reviewRole === "author") {
      return `${baseIdentity}

**YOUR ROLE: AUTHOR / PRESENTER**

You are presenting your work for scrutiny by expert reviewers. This is NOT a friendly discussion — this is a formal review where every claim, assumption, and gap will be challenged.

**How to operate as the author:**
- Present your work with conviction but intellectual honesty — acknowledge uncertainties rather than hiding them
- Structure your submission so it's easy for reviewers to evaluate: clear thesis, supporting evidence, methodology, conclusions
- Anticipate the toughest objections and address them preemptively — don't leave obvious holes for reviewers to exploit
- Use your domain expertise (${agent.role}) to bring depth that generalists would miss
- Show your reasoning chain — reviewers will attack unsupported assertions, so make your logic explicit
- When revising after feedback, don't just patch the surface — if a reviewer found a real flaw, fix the root cause and explain what changed
- Your reputation is on the line. Sloppy, shallow, or hand-wavy work will be torn apart. Bring your absolute best.

Speak in YOUR AUTHENTIC VOICE — your unique persona and mental models should be immediately recognizable.
This is a high-stakes review. Tim is counting on rigorous work product. Respond as ${agent.name} would when presenting to the most demanding audience imaginable.`;
    }

    if (reviewRole === "reviewer") {
      return `${baseIdentity}

**YOUR ROLE: EXPERT REVIEWER / CRITIC**

You are reviewing work submitted by another agent. Your job is to be the toughest, most thorough reviewer this work has ever faced — like a senior principal engineer reviewing a critical PR, a journal peer reviewer, or a senior partner red-teaming a strategy deck.

**How to operate as a reviewer:**
- **Cite specific issues**: Quote or paraphrase the exact text you're critiquing. Never say "this section is weak" — say exactly WHAT is weak and WHY
- **Attack assumptions**: What did the author take for granted? What evidence is missing? What alternative explanations were ignored?
- **Check the logic chain**: Does each conclusion actually follow from the evidence? Are there logical leaps, circular reasoning, or cherry-picked data?
- **Identify what's missing**: What angles weren't covered? What risks weren't addressed? What stakeholders were ignored?
- **Suggest specific improvements**: Don't just say "do better" — explain exactly what a strong version would look like
- **Grade the ambition**: Is the author playing it safe with obvious points, or taking real intellectual risks?
- **Be unsparing but constructive**: The goal is to make the work excellent, not to humiliate. Every critique should come with a path to improvement
- **Don't pad with praise**: If it's good, say so briefly and move on. Spend your words on what needs to change.
- Use your domain expertise (${agent.role}) to catch issues that a generalist reviewer would miss

Your review should feel fundamentally different from a roundtable comment. You are not "adding your perspective" — you are systematically evaluating whether this work meets the bar.
Speak in YOUR AUTHENTIC VOICE. Respond as ${agent.name} would when reviewing work that will ship to production or go to the board.`;
    }

    // supervisor role in review mode
    return `${baseIdentity}

**YOUR ROLE: REVIEW SUPERVISOR**

You are overseeing this review session. You set the brief, define the quality bar, and deliver the final verdict. You are not a participant — you are the authority who decides whether the work ships.

**How to operate as supervisor:**
- Set clear, exacting standards — vague briefs produce vague work
- When delivering final decisions, be decisive and specific about what met the bar and what didn't
- Synthesize the reviewer's feedback and the author's responses — did the author actually address the critiques or just paper over them?
- Your word is final. Don't hedge. If it's not ready, say so and explain exactly what needs to change.

Speak in YOUR AUTHENTIC VOICE. Respond as ${agent.name} would when running the most important review of the quarter.`;
  }

  // ── Roundtable mode (default) ─────────────────────────────────────────────
  return `${agent.persona}

---

You are ${agent.name} ${agent.emoji}, the ${agent.role} at Harris Autonomous, an autonomous AI organization. You are participating in a roundtable discussion on the following topic:

**Topic:** ${topic}
${overlayLine}
**Response length:** ${lengthInstruction}

**Core advisory directives:**
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

**Critical instruction on group dynamics:** If all participants seem to be agreeing or converging on the same direction, one agent should naturally play devil's advocate and push back with counter-arguments, risks, or alternative perspectives. Healthy disagreement produces better decisions than echo chambers. Don't agree for the sake of harmony — if something deserves scrutiny, provide it.

This is a high-stakes advisory session. Tim is counting on this board to make real decisions. Respond as ${agent.name} would at their absolute best.`;
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

// ─── Auto-title generation ────────────────────────────────────────────────────

/**
 * Generate a short descriptive title for a session based on its topic and first few responses.
 * Stores the title in the session JSON.
 */
async function generateSessionTitle(
  filePath: string,
  topic: string,
  firstEvents: Array<{ speaker: string; text: string }>,
  model: string
): Promise<void> {
  try {
    // Only generate if no title exists yet
    const raw = fs.readFileSync(filePath, "utf-8");
    const session = JSON.parse(raw);
    if (session.title) return; // already titled

    const snippets = firstEvents
      .slice(0, 3)
      .map((e) => `${e.speaker}: ${e.text.slice(0, 200)}`)
      .join("\n\n");

    const titlePrompt = `Generate a short, punchy, descriptive title for an advisory board session.

Topic: ${topic}

First responses:
${snippets}

Rules:
- 4-8 words maximum
- Descriptive and specific (not generic like "Advisory Session" or "Discussion")
- Captures the core theme or decision being explored
- No punctuation at the end
- No quotes around the title
- Just output the title, nothing else

Example good titles:
- Q3 Trading Strategy Pivot Analysis
- Insight Platform Security Architecture Review  
- DeFi Yield Optimization for Volatile Markets
- Mission Control Mobile App Launch Plan`;

    const { url, token } = getGatewayConfig();
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 50,
        messages: [
          {
            role: "user",
            content: titlePrompt,
          },
        ],
      }),
    });

    if (!response.ok) return;

    const data = await response.json();
    const title = (data.choices?.[0]?.message?.content || "").trim()
      .replace(/^["']|["']$/g, "") // strip surrounding quotes
      .replace(/[.!?]$/, "") // strip trailing punctuation
      .slice(0, 80); // hard cap

    if (title && title.length > 3) {
      const updatedRaw = fs.readFileSync(filePath, "utf-8");
      const updatedSession = JSON.parse(updatedRaw);
      updatedSession.title = title;
      fs.writeFileSync(filePath, JSON.stringify(updatedSession, null, 2));
    }
  } catch (err) {
    // Non-critical — just log and continue
    console.warn("[Advisory] Auto-title generation failed:", err);
  }
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
      responseLength,
    } = session;

    if (!agents || (agents as string[]).length === 0) {
      return NextResponse.json({ error: "No agents in session" }, { status: 400 });
    }

    const { model: resolvedModel, thinking } = resolveModel(sessionModel as string | undefined);
    const resolvedLength = (responseLength as ResponseLength | undefined) || DEFAULT_RESPONSE_LENGTH;

    // Run asynchronously — return immediately so the client can start polling
    const runConversation = async () => {
      try {
        if (mode === "roundtable") {
          await runRoundtable(
            filePath, session, topic as string, agents as string[],
            personaOverlays as Record<string, string> | string[] | undefined,
            rounds as number | string, pacing as string, resolvedModel, thinking, resolvedLength
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
  thinking = false,
  responseLength: ResponseLength = DEFAULT_RESPONSE_LENGTH
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
      const systemPrompt = buildSystemPrompt(agentId, session.mode as string, topic, agentOverlay, responseLength);

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

      const lengthMaxTokens = RESPONSE_LENGTH_CONFIG[responseLength].maxTokens;
      let text = "";
      setThinkingAgent(filePath, agentId);
      try {
        text = await callClaude(systemPrompt, userPrompt, model, thinking, lengthMaxTokens);
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

    // After first round: generate auto-title (fire-and-forget, non-blocking)
    if (round === 1) {
      const afterFirstRound = fs.readFileSync(filePath, "utf-8");
      const afterFirstSession = JSON.parse(afterFirstRound);
      const firstRoundEvents = (afterFirstSession.events || []).filter(
        (e: { type: string; text: string; speaker: string }) =>
          e.type === "worker" || e.type === "supervisor"
      );
      generateSessionTitle(filePath, topic, firstRoundEvents, model).catch(console.warn);
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
  const finalSystemPrompt = buildSystemPrompt(summaryAgentId, "roundtable", topic, summaryAgentOverlay, responseLength);
  const summaryPrompt = `Topic: ${topic}\n\nFull discussion:\n\n${finalHistory}\n\nThe roundtable discussion is now complete. As ${summaryAgentId === "Henry" ? "Chief of Staff" : AGENT_DEFS[summaryAgentId]?.role || "session host"}, synthesize the key conclusions, decisions, and recommended next steps from this roundtable. Be direct and actionable.`;

  let summaryText = "";
  const summaryMaxTokens = RESPONSE_LENGTH_CONFIG[responseLength].maxTokens;
  try {
    summaryText = await callClaude(finalSystemPrompt, summaryPrompt, model, thinking, summaryMaxTokens);
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
  thinking = false,
  responseLength: ResponseLength = DEFAULT_RESPONSE_LENGTH
) {
  const supervisor = agents.includes("Henry") ? "Henry" : agents[0];
  const nonSupervisors = agents.filter((a) => a !== supervisor);
  // Last agent is the reviewer, first non-supervisor is the primary worker
  const reviewer = nonSupervisors.length > 1 ? nonSupervisors[nonSupervisors.length - 1] : nonSupervisors[0];
  const workers = nonSupervisors.filter((a) => a !== reviewer);
  const worker = workers.length > 0 ? workers[0] : nonSupervisors[0];

  const lengthMaxTokens = RESPONSE_LENGTH_CONFIG[responseLength].maxTokens;

  // Step 1: Supervisor sets the brief
  {
    const currentRaw = fs.readFileSync(filePath, "utf-8");
    const currentSession = JSON.parse(currentRaw);
    if (currentSession.status !== "active") return;

    const supOverlay = getAgentOverlay(personaOverlays, supervisor);
    const supSystem = buildSystemPrompt(supervisor, "review", topic, supOverlay, responseLength, "supervisor");
    const supPrompt = `You are commissioning a review session on the following topic/task:

**Topic:** ${topic}

As ${supervisor === "Henry" ? "Chief of Staff" : AGENT_DEFS[supervisor]?.role || "Supervisor"}, deliver a precise brief to ${worker} (the ${AGENT_DEFS[worker]?.role || "worker"}). Your brief must specify:
1. Exactly what deliverable you want
2. The quality bar — what "excellent" looks like
3. Key criteria the reviewer (${reviewer}, ${AGENT_DEFS[reviewer]?.role || "Reviewer"}) will evaluate against
4. Any specific constraints, format requirements, or angles to cover

Be crisp and exacting. This brief sets the standard for the entire review.`;

    let supText = "";
    try {
      supText = await callClaude(supSystem, supPrompt, model, thinking, Math.min(lengthMaxTokens, 1024));
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
      text: `**📋 Review Brief**\n\n${supText}`,
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
    const workerSystem = buildSystemPrompt(worker, "review", topic, workerOverlay, responseLength, "author");
    const workerPrompt =
      iteration === 1
        ? `**Your task:** ${topic}

**Brief from ${supervisor}:**
${workerHistory}

You are the author/worker presenting your work for review. ${reviewer} (${AGENT_DEFS[reviewer]?.role || "Reviewer"}) will scrutinize every claim, gap, and assumption.

Produce your strongest possible work. Structure it clearly. Be thorough — a sloppy first submission wastes everyone's time. This is your chance to show ${reviewer} that there's nothing to critique.`
        : `**Your task:** ${topic}

**Full session history (including reviewer feedback):**
${workerHistory}

${reviewer} identified specific issues with your previous submission. Now produce a revised version that directly addresses every critique. Be explicit: note what you changed and why. Don't just patch — if the feedback revealed a deeper flaw, fix the root cause.`;

    let workerText = "";
    try {
      workerText = await callClaude(workerSystem, workerPrompt, model, thinking, lengthMaxTokens);
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
      text: iteration === 1 ? `**📄 Submission (v${iteration})**\n\n${workerText}` : `**📄 Revised Submission (v${iteration})**\n\n${workerText}`,
      model,
    });

    // Auto-title after first worker submission
    if (iteration === 1) {
      const afterWork = fs.readFileSync(filePath, "utf-8");
      const afterWorkSession = JSON.parse(afterWork);
      const reviewEvents = (afterWorkSession.events || []).filter(
        (e: { type: string; text: string; speaker: string }) =>
          e.type === "worker" || e.type === "supervisor"
      );
      generateSessionTitle(filePath, topic, reviewEvents, model).catch(console.warn);
    }

    await new Promise((r) => setTimeout(r, 500));
    { const ok = await applyPacing(filePath, pacing); if (!ok) return; }

    const reviewRaw = fs.readFileSync(filePath, "utf-8");
    const reviewSession = JSON.parse(reviewRaw);
    if (reviewSession.status !== "active") return;

    const reviewerOverlay = getAgentOverlay(personaOverlays, reviewer);
    const reviewSystem = buildSystemPrompt(reviewer, "review", topic, reviewerOverlay, responseLength, "reviewer");

    const verdictInstruction =
      reviewStyle === "strict"
        ? "Close your review with a verdict on a new line: VERDICT: APPROVE or VERDICT: REJECT"
        : reviewStyle === "flexible"
        ? "Close your review with: VERDICT: APPROVE, VERDICT: APPROVE_WITH_CONDITIONS, or VERDICT: REJECT"
        : "Close with your honest bottom line — does this meet the bar or not? Be direct.";

    const reviewerPrompt = `**Review Assignment**

**Topic/Task:** ${topic}
**Submission by:** ${worker} (${AGENT_DEFS[worker]?.role || "Worker"}) — Version ${iteration}

**Their submission:**
${lastWork}

You are the expert reviewer. Your job is to evaluate this work like a senior principal reviewing a junior's PR, or a partner reviewing an associate's strategy memo. You are NOT trying to be nice — you are trying to make the work better.

**Your review should:**
- Quote or paraphrase specific parts of the submission when you critique them
- Identify logical gaps, missing considerations, unsupported claims, and quality issues
- Be constructive — explain what's wrong AND what good looks like
- Check it against the original brief
- If the work has genuine strengths, acknowledge them briefly — but don't pad

${verdictInstruction}`;

    let reviewText = "";
    try {
      reviewText = await callClaude(reviewSystem, reviewerPrompt, model, thinking, lengthMaxTokens);
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
      text: `**🔍 Review (Round ${iteration})**\n\n${reviewText}`,
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
    const supSystem = buildSystemPrompt(supervisor, "review", topic, supOverlay, responseLength, "supervisor");
    const supPrompt = `**Review session complete.**

**Topic:** ${topic}

**Full review session:**
${finalHistory}

As ${supervisor === "Henry" ? "Chief of Staff" : AGENT_DEFS[supervisor]?.role || "Supervisor"}, deliver your final decision and synthesis:
1. Was the deliverable achieved to the required standard?
2. What were the key strengths and weaknesses surfaced during review?
3. What are the concrete next steps — ship it, revise it, or escalate?
4. Any process observations for future sessions?

Be decisive. No hedging.`;

    let decisionText = "";
    try {
      decisionText = await callClaude(supSystem, supPrompt, model, thinking, lengthMaxTokens);
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
      text: `**⚖️ Final Decision**\n\n${decisionText}`,
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
