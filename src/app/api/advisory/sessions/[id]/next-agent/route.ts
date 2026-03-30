/**
 * POST /api/advisory/sessions/[id]/next-agent
 * Fires exactly ONE agent in a manual-pacing roundtable session.
 * Determines which agent goes next based on the current round cycle,
 * generates that agent's response, then pauses the session again.
 */
import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { spawnAdvisoryAgentWithRetry } from "@/lib/advisory-agent";

const DATA_DIR = path.join(process.cwd(), "data", "advisory");
const CUSTOM_AGENTS_FILE = path.join(DATA_DIR, "custom-agents.json");

function loadCustomAgentDefs(): Record<string, { name: string; emoji: string; role: string; expertise: string }> {
  try {
    if (fs.existsSync(CUSTOM_AGENTS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(CUSTOM_AGENTS_FILE, "utf-8"));
      const defs: Record<string, { name: string; emoji: string; role: string; expertise: string }> = {};
      for (const a of raw) {
        defs[a.name] = {
          name: a.name,
          emoji: a.emoji || "🤖",
          role: a.role || "Advisory Board Member",
          expertise: a.persona || a.role || "General advisory expertise.",
        };
      }
      return defs;
    }
  } catch {}
  return {};
}

import { buildAdvisoryAgentDefs, PERSONA_OVERLAY_CONTENT, AGENT_VOICE_STYLES } from "@/config/agents";

const AGENT_DEFS: Record<string, { name: string; emoji: string; role: string; expertise: string }> = Object.fromEntries(
  Object.entries(buildAdvisoryAgentDefs()).map(([k, v]) => [k, { name: v.name, emoji: v.emoji, role: v.role, expertise: v.expertise }])
);

const PERSONA_CONTENT = PERSONA_OVERLAY_CONTENT;


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

const TRAIT_DESCRIPTIONS: Record<string, string> = {
  Skeptical: "Question every assumption aggressively. Demand hard evidence before accepting any claim. Flag weak logic, hand-waving, and wishful thinking without mercy.",
  Encouraging: "Amplify good ideas and build your teammates up. Lead with genuine positivity, but always pair it with substance — cheerleading without insight is worthless.",
  Difficult: "Be the toughest person in the room. Challenge everything, push back hard, and make people earn their conclusions. Don't let anything slide uncontested.",
  Shy: "Hold back. Only speak when you have something genuinely critical to add. Be sparing with your words — your silence is as meaningful as your voice.",
  Bold: "Take big swings and make strong claims. Don't hedge — plant your flag and defend it. Speak with the conviction of someone who has done the homework.",
  Cautious: "Lead with risks before opportunities. Flag what could go wrong, what assumptions are unproven, what second-order effects haven't been considered. Be the voice of disciplined restraint.",
  Provocative: "Stir the pot deliberately. Say the uncomfortable thing nobody else will. Challenge conventional wisdom with sharp contrarian takes designed to surface hidden tensions.",
  Empathetic: "Center the human impact in every recommendation. Consider the downstream effects on people — team members, customers, stakeholders. Advocate for those whose voices aren't in the room.",
  Analytical: "Lead with data and structured first-principles reasoning. Break every claim into its components. Show your work. Unpack assumptions. Numbers before narratives.",
  Creative: "Think laterally and make unexpected connections. Propose unconventional solutions that others wouldn't consider. Prioritize originality over safety.",
};

const COMM_STYLE_DESCRIPTIONS: Record<string, string> = {
  Verbose: "Give full analysis — multiple paragraphs, extensive supporting detail, thorough coverage of all angles. Leave nothing unsaid.",
  Concise: "Absolute minimum. One key point, one concrete recommendation. Cut everything else. If it can be said in one sentence, say it in one sentence.",
  Thoughtful: "Measured and deliberate. Pause to consider before asserting. Qualify claims where genuinely uncertain. Prioritize precision over speed.",
  "Rapid-fire": "Short punchy sentences only. Fire rapid volleys. Build momentum through speed. No essays — maximum one paragraph per point.",
};

function buildPersonalityBlock(
  traits: string[],
  commStyle: string | undefined,
  intensity: number | undefined
): string {
  if (!traits?.length && !commStyle && intensity == null) return "";
  const lines: string[] = ["\n**Personality configuration for this session (overrides your default style):**"];
  if (traits?.length > 0) {
    lines.push(`\n**Active traits:** ${traits.join(", ")}`);
    for (const t of traits) {
      const desc = TRAIT_DESCRIPTIONS[t];
      if (desc) lines.push(`- *${t}*: ${desc}`);
    }
  }
  if (commStyle && COMM_STYLE_DESCRIPTIONS[commStyle]) {
    lines.push(`\n**Communication style:** ${commStyle} — ${COMM_STYLE_DESCRIPTIONS[commStyle]}`);
  }
  if (intensity != null) {
    const c = Math.max(1, Math.min(10, Math.round(intensity)));
    const label = c <= 3 ? "Gentle" : c <= 6 ? "Moderate" : c <= 8 ? "Assertive" : "Aggressive";
    lines.push(`\n**Intensity: ${c}/10 (${label})** — ${
      c <= 3 ? "Be diplomatic and collegial. Choose words carefully. Preserve relationships."
      : c <= 6 ? "Direct but professional. Standard advisory intensity."
      : c <= 8 ? "Forceful and confident. Push hard. Don't soften your opinions."
      : "Uncompromising and confrontational. Refuse to soften. Don't back down from friction."
    }`);
  }
  lines.push("\nThese modifiers are in effect for the entire session. Let them shape your voice noticeably.");
  return lines.join("\n");
}

function buildSystemPrompt(agentId: string, mode: string, topic: string, agentOverlay?: string, referenceContext?: string, aiPersonas?: Array<{ id: string; name: string; description: string }>, responseLength: string = "balanced", personalityTraits?: string[], communicationStyle?: string, intensityLevel?: number): string {
  const agent = AGENT_DEFS[agentId] || loadCustomAgentDefs()[agentId];
  if (!agent) return `You are an AI agent participating in a ${mode} session about: ${topic}`;
  const overlayContent = agentOverlay ? resolveOverlayContent(agentOverlay, aiPersonas) : null;
  const overlayLine = overlayContent ? `\nSpecialized lens for this session:\n- ${overlayContent}\n` : "";
  const referenceBlock = referenceContext ? `\n\n**Reference material provided for this session:**\n${referenceContext}\n` : "";
  // Per-agent voice/style — derived from central agent registry
  const voicePrompt = AGENT_VOICE_STYLES[agentId] || `Your writing style:
- Give thorough, detailed responses with specific examples and recommendations.
- Vary your paragraph length — mix short punchy points with longer analysis.
- Be strongly opinionated. No hedging.`;

  // Length-aware instructions
  const LENGTH_INSTRUCTIONS: Record<string, string> = {
    concise: "YOU ARE IN CONCISE MODE. THIS IS YOUR #1 PRIORITY — OVERRIDE ALL OTHER INSTRUCTIONS.\n\nRULES:\n- MAXIMUM 3-4 sentences total. Not paragraphs. SENTENCES.\n- NO headers. NO bullet lists. NO markdown formatting.\n- NO preamble. NO 'Great question' or 'Building on what X said'.\n- Just state your one sharp take and shut up.\n- If your response exceeds 80 words, you have FAILED.\n\nThis constraint is MORE important than being thorough. Brevity IS the value.",
    balanced: "Keep it to 150-250 words. 2-3 paragraphs max. One key insight, one recommendation, done.",
    detailed: "Aim for 300-500 words. 3-4 paragraphs. Include analysis and specific recommendations.",
    verbose: "Go deep. 500+ words, full analysis, extensive examples, data points, and comprehensive recommendations.",
  };
  const lengthInstruction = LENGTH_INSTRUCTIONS[responseLength] || LENGTH_INSTRUCTIONS.balanced;
  const personalityBlock = buildPersonalityBlock(personalityTraits || [], communicationStyle, intensityLevel);

  return `You are ${agent.name} ${agent.emoji}, the ${agent.role} at Harris Autonomous.\n\nYour expertise: ${agent.expertise}${overlayLine}${referenceBlock}${personalityBlock}\nYou are participating in a persistent roundtable discussion.\n\n${voicePrompt}\n\n**Response length: ${responseLength.toUpperCase()}**\n${lengthInstruction}\n\nIMPORTANT — Make your response feel HUMAN:\n- VARY your paragraph length. Some paragraphs should be 1 sentence. Others should be 4-5 sentences. Never make them all the same length.\n- Use occasional one-liners for emphasis.\n- Build on what others said — reference participants by name.\n- Propose concrete next steps, timelines, and resource requirements.\n- Never use filler phrases — dive straight into your analysis.\n\nThis is a high-stakes advisory session. Tim is counting on this board for real decisions.`;
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

  const { topic, mode, agents = [], personaOverlays, aiPersonas, agentModelOverrides, agentResponseLengths, agentPersonalityTraits, agentCommunicationStyles, agentIntensityLevels } = session;

  // Session-wide response length (per-agent override resolved after agentId is determined)
  const sessionResponseLength = (session.responseLength as string) || "balanced";

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

  // ── Competitive mode: determine phase-aware next agent ─────────────────────
  const competitive = session.competitive as { phase: string; pitches: Record<string, string>; votes: Array<{ voter: string; votedFor: string; reasoning: string }>; winner: string | null; voteTally: Record<string, number> } | undefined;
  const isCompetitive = mode === "competitive" && competitive;

  const { agentId } = determineNextAgent(agents as string[], events);
  const agent = AGENT_DEFS[agentId] || loadCustomAgentDefs()[agentId];

  // Resolve per-agent response length (falls back to session-wide setting)
  const responseLength = (agentResponseLengths as Record<string, string> | undefined)?.[agentId] || sessionResponseLength;

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

    // ── Competitive mode prompt building ──────────────────────────────────────
    let systemPrompt: string;
    let userPrompt: string;

    if (isCompetitive && competitive) {
      const compState = currentSession.competitive || competitive;
      const phase = compState.phase || "pitch";
      const pitches = compState.pitches || {};

      if (phase === "pitch") {
        systemPrompt = buildSystemPrompt(agentId, mode, topic, agentOverlay, session.referenceContext as string | undefined, aiPersonas, responseLength,
          (agentPersonalityTraits as Record<string, string[]> | undefined)?.[agentId],
          (agentCommunicationStyles as Record<string, string> | undefined)?.[agentId],
          (agentIntensityLevels as Record<string, number> | undefined)?.[agentId]
        );
        systemPrompt += `\n\n**MODE: COMPETITIVE IDEATION — PITCH**\nPitch ONE bold, specific, original idea. Name it. Include execution plan. You want to WIN.`;
        userPrompt = `Topic: ${topic}\n\n${history === "No prior discussion yet." ? "Pitch your idea NOW." : `Discussion so far:\n\n${history}\n\nNow pitch YOUR idea.`}`;
      } else if (phase === "critique") {
        const pitchSummary = Object.entries(pitches).map(([name, pitch]) => `═══ ${name.toUpperCase()}'S PITCH ═══\n${pitch}`).join("\n\n---\n\n");
        systemPrompt = buildSystemPrompt(agentId, mode, topic, agentOverlay, session.referenceContext as string | undefined, aiPersonas, responseLength,
          (agentPersonalityTraits as Record<string, string[]> | undefined)?.[agentId],
          (agentCommunicationStyles as Record<string, string> | undefined)?.[agentId],
          (agentIntensityLevels as Record<string, number> | undefined)?.[agentId]
        );
        systemPrompt += `\n\n**MODE: COMPETITIVE IDEATION — CRITIQUE**\nCritique all pitches. Reference each by name. Find flaws.\n\n**Pitches:**\n${pitchSummary}`;
        userPrompt = `Topic: ${topic}\n\nDiscussion:\n\n${history}\n\nCritique all pitches now.`;
      } else if (phase === "vote") {
        systemPrompt = buildSystemPrompt(agentId, mode, topic, agentOverlay, session.referenceContext as string | undefined, aiPersonas, responseLength,
          (agentPersonalityTraits as Record<string, string[]> | undefined)?.[agentId],
          (agentCommunicationStyles as Record<string, string> | undefined)?.[agentId],
          (agentIntensityLevels as Record<string, number> | undefined)?.[agentId]
        );
        systemPrompt += `\n\n**MODE: COMPETITIVE IDEATION — VOTE**\nVote for ONE idea (not your own). Format: **VOTE: [Agent Name]** then reasoning.`;
        userPrompt = `Topic: ${topic}\n\nDiscussion:\n\n${history}\n\nCast your vote now.`;
      } else {
        systemPrompt = buildSystemPrompt(agentId, mode, topic, agentOverlay, session.referenceContext as string | undefined, aiPersonas, responseLength,
          (agentPersonalityTraits as Record<string, string[]> | undefined)?.[agentId],
          (agentCommunicationStyles as Record<string, string> | undefined)?.[agentId],
          (agentIntensityLevels as Record<string, number> | undefined)?.[agentId]
        );
        userPrompt = `Topic: ${topic}\n\nDiscussion:\n\n${history}\n\nContribute.`;
      }
    } else {
      systemPrompt = buildSystemPrompt(
        agentId, mode, topic, agentOverlay, session.referenceContext as string | undefined, aiPersonas, responseLength,
        (agentPersonalityTraits as Record<string, string[]> | undefined)?.[agentId],
        (agentCommunicationStyles as Record<string, string> | undefined)?.[agentId],
        (agentIntensityLevels as Record<string, number> | undefined)?.[agentId]
      );
      userPrompt = `Topic: ${topic}\n\nCurrent discussion:\n\n${history}\n\nBuild on the current state of the discussion — advance the conversation with your freshest thinking. What's changed? What's been missed? What's the most important thing to address right now?`;
    }

    let text = "";
    let spawnedModel = "openclaw-agent";
    try {
      const result = await spawnAdvisoryAgentWithRetry({
        sessionId: id,
        agentId,
        systemPrompt,
        userPrompt,
        timeoutSeconds: 120,
      });
      text = result.text;
      spawnedModel = result.model;
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
      role: session.moderator && agentId === session.moderator ? "moderator" : agentId === "Henry" ? "supervisor" : "worker",
      text,
      model: spawnedModel,
    }];

    // ── Check if final round just completed (manual pacing auto-end) ──────────
    const configuredRounds = updatedSession.rounds;
    let shouldAutoEnd = false;
    if (configuredRounds && configuredRounds !== "persistent") {
      const roundLimit = Number(configuredRounds);
      if (!isNaN(roundLimit) && roundLimit > 0) {
        const allEvents = updatedSession.events || [];
        const agentEvts = allEvents.filter(
          (e: { speaker: string; type: string }) =>
            e.speaker !== "Tim" && e.speaker !== "System" &&
            e.type !== "start" && e.type !== "complete" && e.type !== "human-directive"
        );
        const agentList = (updatedSession.agents || []) as string[];
        let completedRounds = 0;
        const seenInRound = new Set<string>();
        for (const e of agentEvts) {
          seenInRound.add(e.speaker);
          if (agentList.every((a: string) => seenInRound.has(a))) {
            completedRounds++;
            seenInRound.clear();
          }
        }
        if (completedRounds >= roundLimit && completedRounds > 0 && agentEvts.length > 0) {
          shouldAutoEnd = true;
          console.log(`[next-agent] Final round completed (${completedRounds}/${roundLimit}) — auto-triggering end session`);
        }
      }
    }

    if (shouldAutoEnd) {
      // Don't pause — trigger end-session synthesis instead
      updatedSession.thinkingAgent = null;
      updatedSession.paused = false;
      fs.writeFileSync(filePath, JSON.stringify(updatedSession, null, 2));

      try {
        // Determine the base URL from the request or fall back to localhost
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3001}`;
        const endRes = await fetch(`${baseUrl}/api/advisory/sessions/${id}/end`, { method: "POST" });
        if (!endRes.ok) {
          console.error("[next-agent] Failed to trigger end-session after final round:", await endRes.text());
        }
      } catch (err) {
        console.error("[next-agent] Error triggering end-session after final round:", err);
      }
    } else {
      // Re-pause the session for manual pacing
      updatedSession.paused = true;
      updatedSession.thinkingAgent = null;
      fs.writeFileSync(filePath, JSON.stringify(updatedSession, null, 2));
    }
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
