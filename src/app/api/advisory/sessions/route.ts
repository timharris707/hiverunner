import { NextRequest, NextResponse } from "next/server";
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

export async function GET() {
  try {
    const sessions = loadSessions();
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
    ensureDir();
    const body = await req.json();
    const { topic, mode, agents, reviewStyle, model, personaOverlays, personaOverlaysList, aiPersonas, rounds, pacing, responseLength, extendedThinking, specialist, specialistAgent, forkedFrom, forkedAtEvent, referenceContext, reviewLoop } = body;

    if (!topic || !mode) {
      return NextResponse.json({ error: "topic and mode are required" }, { status: 400 });
    }

    const id = `session-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();

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
      ...(reviewLoop ? { reviewLoop } : {}),
      events: [
        {
          id: "evt_001",
          timestamp: now,
          type: "start",
          speaker: reviewLoop?.supervisorAgent || "Henry",
          emoji: "⚡",
          role: "supervisor",
          text: mode === "review" && reviewLoop
            ? `🚀 **Review Loop started.**\n\n**Topic:** ${topic}\n\n**Tasks:** ${reviewLoop.tasks?.length || 0} items\n**Worker:** ${reviewLoop.workerAgent} | **Reviewer:** ${reviewLoop.reviewerAgent} | **Supervisor:** ${reviewLoop.supervisorAgent}\n**Model:** ${model || "claude-opus-4-6"}\n\nLoop will execute tasks sequentially. Worker submits, Reviewer approves or rejects.`
            : `🚀 **Session started.**\n\n**Topic:** ${topic}\n\n**Mode:** ${mode} | **Review style:** ${reviewStyle || "open"} | **Model:** ${model || "claude-opus-4-6"}\n\n**Participants:** ${(agents || []).join(", ") || "TBD"}\n\nStanding by for agent inputs...`,
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
