import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { consumeSessionCredit } from "@/lib/billing";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

const DATA_DIR = path.join(process.cwd(), "data", "advisory");

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadSessions() {
  ensureDir();
  const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith(".json"));
  return files
    .map((file) => {
      try {
        const raw = fs.readFileSync(path.join(DATA_DIR, file), "utf-8");
        return JSON.parse(raw);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

async function getAuthUser() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function GET() {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const allSessions = loadSessions();
    // Filter to this user's sessions (sessions without userId are legacy dev sessions)
    const sessions = allSessions.filter((s) => !s.userId || s.userId === user.id);

    // Return lightweight list (no events)
    const list = sessions.map(({ events: _events, ...rest }) => ({
      ...rest,
      eventCount: _events?.length ?? 0,
      lastEvent: _events?.length ? _events[_events.length - 1] : null,
    }));
    return NextResponse.json({ sessions: list });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const billing = consumeSessionCredit(user.id);
    if (!billing.ok) {
      return NextResponse.json(
        {
          error: billing.reason,
          billing: {
            freeSessionsUsedThisMonth: billing.account.freeSessionsUsedThisMonth,
            freeSessionsPerMonth: 3,
            credits: billing.account.credits,
          },
        },
        { status: 402 }
      );
    }

    ensureDir();
    const body = await req.json();
    const { topic, mode, agents, reviewStyle, model, personaOverlays, personaOverlaysList, aiPersonas, rounds, pacing, responseLength, extendedThinking, specialist, specialistAgent, forkedFrom, forkedAtEvent, referenceContext, reviewLoop, agentModelOverrides, agentPersonalityTraits, agentCommunicationStyles, agentIntensityLevels, agentResponseLengths, moderator } = body;

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
      ? `🚀 **Review Loop started.**\n\n**Topic:** ${topic}\n\n**Tasks:** ${reviewLoop.tasks?.length || 0} items\n**Worker:** ${reviewLoop.workerAgent} | **Reviewer:** ${reviewLoop.reviewerAgent} | **Supervisor:** ${reviewLoop.supervisorAgent}\n**Model:** ${model || "claude-sonnet"}\n\nLoop will execute tasks sequentially. Worker submits, Reviewer approves or rejects.`
      : isCompetitive
      ? `⚔️ **Competitive Ideation started.**\n\n**Topic:** ${topic}\n\n**Mode:** Competitive Ideation | **Model:** ${model || "claude-sonnet"}\n\n**Competitors:** ${(agents || []).join(", ") || "TBD"}\n\n**Round 1 — PITCH:** Each agent pitches their boldest idea.\n**Round 2 — CRITIQUE:** Agents tear apart each other's pitches by name.\n**Round 3 — VOTE:** Each agent votes for the best idea (not their own) with reasoning.\n\nLet the competition begin...`
      : `🚀 **Session started.**\n\n**Topic:** ${topic}\n\n**Mode:** ${mode} | **Review style:** ${reviewStyle || "open"} | **Model:** ${model || "claude-sonnet"}\n\n**Participants:** ${(agents || []).join(", ") || "TBD"}\n\nStanding by for agent inputs...`;

    const session = {
      id,
      userId: user.id,
      topic,
      mode: mode || "roundtable",
      agents: agents || [],
      status: "active",
      createdAt: now,
      reviewStyle: reviewStyle || "open",
      model: model || "claude-sonnet",
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
      ...(agentModelOverrides && Object.keys(agentModelOverrides).length > 0 ? { agentModelOverrides } : {}),
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

    return NextResponse.json({ session });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
