import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { getAdvisorySessionsList } from "@/lib/advisory-sessions";

const DATA_DIR = path.join(process.cwd(), "data", "advisory");

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export async function GET() {
  try {
    return NextResponse.json({ sessions: getAdvisorySessionsList() });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    ensureDir();
    const body = await req.json();
    const { topic, mode, agents, reviewStyle, model, personaOverlays, personaOverlaysList, aiPersonas, rounds, pacing, responseLength, extendedThinking, specialist, specialistAgent, forkedFrom, forkedAtEvent, referenceContext, reviewLoop, agentPersonalityTraits, agentCommunicationStyles, agentIntensityLevels, agentResponseLengths, moderator } = body;

    if (!topic || !mode) {
      return NextResponse.json({ error: "topic and mode are required" }, { status: 400 });
    }

    const id = `session-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();

    const isCompetitive = mode === "competitive";
    const competitiveState = isCompetitive ? {
      phase: "pitch" as const,
      pitches: {} as Record<string, string>,
      votes: [] as Array<{ voter: string; votedFor: string; reasoning: string }>,
      winner: null,
      voteTally: {} as Record<string, number>,
    } : undefined;

    const startText = mode === "review" && reviewLoop
      ? `🚀 **Review Loop started.**\n\n**Topic:** ${topic}\n\n**Tasks:** ${reviewLoop.tasks?.length || 0} items\n**Worker:** ${reviewLoop.workerAgent} | **Reviewer:** ${reviewLoop.reviewerAgent} | **Supervisor:** ${reviewLoop.supervisorAgent}\n**Model:** ${model || "claude-opus-4-6"}\n\nLoop will execute tasks sequentially. Worker submits, Reviewer approves or rejects.`
      : isCompetitive
      ? `⚔️ **Competitive Ideation started.**\n\n**Topic:** ${topic}\n\n**Mode:** Competitive Ideation | **Model:** ${model || "claude-opus-4-6"}\n\n**Competitors:** ${(agents || []).join(", ") || "TBD"}\n\n**Round 1 — PITCH:** Each agent pitches their boldest idea.\n**Round 2 — CRITIQUE:** Agents tear apart each other's pitches by name.\n**Round 3 — VOTE:** Each agent votes for the best idea (not their own) with reasoning.\n\nLet the competition begin...`
      : `🚀 **Session started.**\n\n**Topic:** ${topic}\n\n**Mode:** ${mode} | **Review style:** ${reviewStyle || "open"} | **Model:** ${model || "claude-opus-4-6"}\n\n**Participants:** ${(agents || []).join(", ") || "TBD"}\n\nStanding by for agent inputs...`;

    const session = {
      id,
      topic,
      mode: mode || "roundtable",
      agents: agents || [],
      status: "active",
      createdAt: now,
      reviewStyle: reviewStyle || "open",
      model: model || "claude-opus-4-6",
      personaOverlays: personaOverlays || [],
      personaOverlaysList: personaOverlaysList || undefined,
      aiPersonas: aiPersonas || undefined,
      rounds: rounds ?? 3,
      pacing: pacing || "instant",
      responseLength: responseLength || "balanced",
      extendedThinking: extendedThinking || false,
      specialist: specialist || false,
      specialistAgent: specialistAgent || null,
      forkedFrom: forkedFrom || null,
      forkedAtEvent: forkedAtEvent || null,
      referenceContext: referenceContext ? String(referenceContext).slice(0, 10000) : undefined,
      paused: false,
      ...(agentPersonalityTraits && Object.keys(agentPersonalityTraits).length > 0 ? { agentPersonalityTraits } : {}),
      ...(agentCommunicationStyles && Object.keys(agentCommunicationStyles).length > 0 ? { agentCommunicationStyles } : {}),
      ...(agentIntensityLevels && Object.keys(agentIntensityLevels).length > 0 ? { agentIntensityLevels } : {}),
      ...(agentResponseLengths && Object.keys(agentResponseLengths).length > 0 ? { agentResponseLengths } : {}),
      ...(reviewLoop ? { reviewLoop } : {}),
      ...(competitiveState ? { competitive: competitiveState } : {}),
      ...(moderator ? { moderator } : {}),
      events: [
        {
          id: "evt_001",
          timestamp: now,
          type: "start",
          speaker: reviewLoop?.supervisorAgent || moderator || "Henry",
          emoji: isCompetitive ? "⚔️" : "⚡",
          role: moderator ? "moderator" : "supervisor",
          text: startText,
        },
      ],
    };

    const filePath = path.join(DATA_DIR, `${id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(session, null, 2));

    // TODO: Session Memory — When a session completes, write key decisions to each
    // participating agent's memory file (memory/agents/<agentId>/sessions.md) so they
    // retain context for future roundtables. This should be triggered from the PATCH
    // endpoint (status → "completed") and should summarize: topic, outcome, date, and
    // any action items the agent was assigned.

    return NextResponse.json({ session });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
