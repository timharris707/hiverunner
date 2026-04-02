import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getOrchestrationDb } from "@/lib/orchestration/db";

const OPENCLAW_HOME = path.join(process.env.HOME || "/Users/timharris", ".openclaw");
const OPENCLAW_JSON = path.join(OPENCLAW_HOME, "openclaw.json");

interface OpenClawAgent {
  id: string;
  name?: string;
  workspace?: string;
  agentDir?: string;
  model?: string;
}

interface OpenClawConfig {
  agents: {
    defaults: {
      workspace?: string;
      model?: { primary?: string };
      [k: string]: unknown;
    };
    list: OpenClawAgent[];
  };
}

function parseIdentityMd(content: string): { name?: string; emoji?: string; creature?: string } {
  const result: { name?: string; emoji?: string; creature?: string } = {};
  for (const line of content.split("\n")) {
    const m = line.match(/^\s*-\s*\*\*(\w+):\*\*\s*(.+)/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === "name") result.name = val;
    if (key === "emoji") result.emoji = val;
    if (key === "creature") result.creature = val;
  }
  return result;
}

function countSessions(agentId: string): number {
  const sessionsDir = path.join(OPENCLAW_HOME, "agents", agentId, "sessions");
  try {
    return fs.readdirSync(sessionsDir).filter((f) => !f.startsWith(".")).length;
  } catch {
    return 0;
  }
}

function readFileSafe(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: agentId } = await params;

  let config: OpenClawConfig;
  try {
    config = JSON.parse(fs.readFileSync(OPENCLAW_JSON, "utf-8"));
  } catch {
    return NextResponse.json({ error: "Could not read openclaw.json" }, { status: 500 });
  }

  const defaults = config.agents.defaults;
  const entry = config.agents.list.find((a) => a.id === agentId);

  if (!entry) {
    return NextResponse.json({ error: `Agent "${agentId}" not found in openclaw.json` }, { status: 404 });
  }

  // For "main", inherit from defaults
  const isMain = agentId === "main";
  const workspace = entry.workspace || defaults.workspace || "";
  const agentDir = entry.agentDir || (isMain ? "" : path.join(OPENCLAW_HOME, "agents", agentId, "agent"));
  const model = entry.model || defaults.model?.primary || "";

  // Read IDENTITY.md — agent dir first; for main agent also check workspace (main owns the workspace)
  const identityPaths = [
    agentDir ? path.join(agentDir, "IDENTITY.md") : null,
    isMain && workspace ? path.join(workspace, "IDENTITY.md") : null,
  ].filter(Boolean) as string[];

  let identityContent: string | null = null;
  let identityExists = false;
  for (const p of identityPaths) {
    const content = readFileSafe(p);
    if (content) {
      identityContent = content;
      identityExists = true;
      break;
    }
  }

  // Read SOUL.md — agent dir first; for main agent also check workspace
  const soulPaths = [
    agentDir ? path.join(agentDir, "SOUL.md") : null,
    isMain && workspace ? path.join(workspace, "SOUL.md") : null,
  ].filter(Boolean) as string[];

  let soulContent: string | null = null;
  let soulExists = false;
  for (const p of soulPaths) {
    const content = readFileSafe(p);
    if (content) {
      soulContent = content;
      soulExists = true;
      break;
    }
  }

  const identity = identityContent ? parseIdentityMd(identityContent) : {};
  const sessionCount = countSessions(agentId);

  return NextResponse.json({
    agentId,
    model,
    workspace,
    agentDir,
    identity: {
      name: identity.name || entry.name || agentId,
      emoji: identity.emoji || "",
      creature: identity.creature || "",
    },
    soulExists,
    soulPreview: soulContent ? soulContent.slice(0, 200) : null,
    identityExists,
    identityPreview: identityContent ? identityContent.slice(0, 200) : null,
    sessionCount,
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: agentId } = await params;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // --- Update openclaw.json for model/workspace/name ---
  const openclawFields = ["model", "workspace", "name"] as const;
  const hasOpenclawUpdate = openclawFields.some((f) => f in body);

  if (hasOpenclawUpdate) {
    let config: OpenClawConfig;
    try {
      config = JSON.parse(fs.readFileSync(OPENCLAW_JSON, "utf-8"));
    } catch {
      return NextResponse.json({ error: "Could not read openclaw.json" }, { status: 500 });
    }

    const entry = config.agents.list.find((a) => a.id === agentId);
    if (!entry) {
      return NextResponse.json({ error: `Agent "${agentId}" not found in openclaw.json` }, { status: 404 });
    }

    for (const field of openclawFields) {
      if (field in body && typeof body[field] === "string") {
        (entry as unknown as Record<string, unknown>)[field] = body[field];
      }
    }

    try {
      fs.writeFileSync(OPENCLAW_JSON, JSON.stringify(config, null, 2) + "\n", "utf-8");
    } catch (err) {
      return NextResponse.json({ error: `Failed to write openclaw.json: ${err}` }, { status: 500 });
    }
  }

  // --- Update orchestration DB for MC-only fields ---
  const dbFields: Record<string, string> = {
    name: "name",
    title: "role",
    reportsTo: "reporting_to",
    personality: "personality",
    model: "model",
  };

  const dbUpdates: string[] = [];
  const dbValues: Record<string, unknown> = {};

  for (const [bodyKey, colName] of Object.entries(dbFields)) {
    if (bodyKey in body) {
      dbUpdates.push(`${colName} = @${colName}`);
      dbValues[`@${colName}`] = typeof body[bodyKey] === "string" ? body[bodyKey] : null;
    }
  }

  if ("skills" in body && Array.isArray(body.skills)) {
    dbUpdates.push("skills_json = @skills_json");
    dbValues["@skills_json"] = JSON.stringify(body.skills);
  }

  let updatedAgent: Record<string, unknown> | undefined;

  if (dbUpdates.length > 0) {
    try {
      const db = getOrchestrationDb();
      dbUpdates.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
      const sql = `UPDATE agents SET ${dbUpdates.join(", ")} WHERE openclaw_agent_id = @agentId`;
      dbValues["@agentId"] = agentId;
      db.prepare(sql).run(dbValues);

      updatedAgent = db
        .prepare(
          `SELECT id, name, role, personality, model, skills_json, reporting_to, openclaw_agent_id
           FROM agents WHERE openclaw_agent_id = @agentId`,
        )
        .get({ "@agentId": agentId }) as Record<string, unknown> | undefined;
    } catch (err) {
      return NextResponse.json({ error: `DB update failed: ${err}` }, { status: 500 });
    }
  }

  return NextResponse.json({
    ok: true,
    agentId,
    updated: Object.keys(body),
    agent: updatedAgent
      ? {
          id: updatedAgent.id,
          name: updatedAgent.name,
          role: updatedAgent.role,
          personality: updatedAgent.personality,
          model: updatedAgent.model,
          skills: JSON.parse((updatedAgent.skills_json as string) || "[]"),
          reportingTo: updatedAgent.reporting_to,
        }
      : undefined,
  });
}
