import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { syncAgentCoreFiles } from "@/lib/orchestration/agent-core-files";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { resolveOpenClawDir } from "@/lib/workspaces/root";

const OPENCLAW_HOME = resolveOpenClawDir();
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

  // If the agent isn't in openclaw.json, still return DB-backed config fields
  if (!entry) {
    let permissions: Record<string, unknown> = {};
    let runtimeConfig: Record<string, unknown> = {};
    try {
      const db = getOrchestrationDb();
      const row = db
        .prepare(
          `SELECT permissions_json, runtime_config_json, model
           FROM agents
           WHERE archived_at IS NULL
             AND (openclaw_agent_id = ? OR lower(name) = lower(?) OR id = ? OR slug = ?)
           LIMIT 1`
        )
        .get(agentId, agentId, agentId, agentId) as { permissions_json: string; runtime_config_json: string; model: string | null } | undefined;
      if (row) {
        try { permissions = JSON.parse(row.permissions_json || "{}"); } catch { /* use default */ }
        try { runtimeConfig = JSON.parse(row.runtime_config_json || "{}"); } catch { /* use default */ }
        return NextResponse.json({
          agentId,
          model: row.model || "",
          workspace: "",
          agentDir: "",
          identity: { name: agentId, emoji: "", creature: "" },
          soulExists: false,
          soulPreview: null,
          identityExists: false,
          identityPreview: null,
          sessionCount: 0,
          permissions,
          runtimeConfig,
          scaffoldMissing: true,
        });
      }
    } catch { /* fall through */ }
    return NextResponse.json({ error: `Agent "${agentId}" not found` }, { status: 404 });
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

  // Read persisted config from DB
  let permissions: Record<string, unknown> = {};
  let runtimeConfig: Record<string, unknown> = {};
  try {
    const db = getOrchestrationDb();
    const row = db
      .prepare(
        `SELECT permissions_json, runtime_config_json
         FROM agents
         WHERE archived_at IS NULL
           AND (openclaw_agent_id = ? OR lower(name) = lower(?) OR id = ?)
         LIMIT 1`
      )
      .get(agentId, agentId, agentId) as { permissions_json: string; runtime_config_json: string } | undefined;
    if (row) {
      try { permissions = JSON.parse(row.permissions_json || "{}"); } catch { /* use default */ }
      try { runtimeConfig = JSON.parse(row.runtime_config_json || "{}"); } catch { /* use default */ }
    }
  } catch { /* best-effort */ }

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
    permissions,
    runtimeConfig,
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
    emoji: "emoji",
    title: "role",
    personality: "personality",
    model: "model",
  };

  const dbUpdates: string[] = [];
  const dbValues: Record<string, unknown> = {};

  for (const [bodyKey, colName] of Object.entries(dbFields)) {
    if (bodyKey in body) {
      dbUpdates.push(`${colName} = @${colName}`);
      dbValues[colName] = typeof body[bodyKey] === "string" ? body[bodyKey] : null;
    }
  }

  if ("skills" in body && Array.isArray(body.skills)) {
    dbUpdates.push("skills_json = @skills_json");
    dbValues.skills_json = JSON.stringify(body.skills);
  }

  // Persist permissions to permissions_json
  if ("permissions" in body && typeof body.permissions === "object" && body.permissions !== null) {
    dbUpdates.push("permissions_json = @permissions_json");
    dbValues.permissions_json = JSON.stringify(body.permissions);
  }

  // Persist runtime config (timeout, grace, heartbeat) to runtime_config_json
  if ("runtimeConfig" in body && typeof body.runtimeConfig === "object" && body.runtimeConfig !== null) {
    dbUpdates.push("runtime_config_json = @runtime_config_json");
    dbValues.runtime_config_json = JSON.stringify(body.runtimeConfig);
  }

  let updatedAgent: Record<string, unknown> | undefined;
  let coreFiles: { synced: boolean; root: string | null } | undefined;

  if (dbUpdates.length > 0 || "reportsTo" in body) {
    try {
      const db = getOrchestrationDb();
      const existingAgent = db
        .prepare(
          `SELECT id, company_id, name, openclaw_agent_id
           FROM agents
           WHERE archived_at IS NULL
             AND (openclaw_agent_id = @agentId OR lower(name) = lower(@agentId) OR id = @agentId OR slug = @agentId)
           LIMIT 1`,
        )
        .get({ agentId }) as { id: string; company_id: string; name: string; openclaw_agent_id: string | null } | undefined;

      if (!existingAgent) {
        return NextResponse.json({ error: `Agent "${agentId}" not found in orchestration DB` }, { status: 404 });
      }

      if ("reportsTo" in body) {
        const requestedReportsTo = typeof body.reportsTo === "string" ? body.reportsTo.trim() : "";
        if (requestedReportsTo) {
          const reportingAgent = db
            .prepare(
              `SELECT id, name
               FROM agents
               WHERE company_id = @companyId
                 AND archived_at IS NULL
                 AND (id = @reportsTo OR lower(name) = lower(@reportsTo) OR openclaw_agent_id = @reportsTo)
               LIMIT 1`,
            )
            .get({
              companyId: existingAgent.company_id,
              reportsTo: requestedReportsTo,
            }) as { id: string; name: string } | undefined;

          if (!reportingAgent) {
            return NextResponse.json(
              { error: `Could not resolve reportsTo target "${requestedReportsTo}" within this company` },
              { status: 400 },
            );
          }

          if (reportingAgent.id === existingAgent.id) {
            return NextResponse.json(
              { error: "Agent cannot report to itself" },
              { status: 400 },
            );
          }

          dbUpdates.push("reporting_to = @reporting_to");
          dbValues.reporting_to = reportingAgent.id;
        } else {
          dbUpdates.push("reporting_to = NULL");
        }
      }

      if (dbUpdates.length > 0) {
        dbUpdates.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
        const sql = `UPDATE agents SET ${dbUpdates.join(", ")} WHERE id = @rowId`;
        dbValues.rowId = existingAgent.id;
        db.prepare(sql).run(dbValues);
      }

      coreFiles = syncAgentCoreFiles(db, existingAgent.id);

      updatedAgent = db
        .prepare(
          `SELECT
             a.id,
             a.name,
             a.emoji,
             a.role,
             a.personality,
             a.model,
             a.skills_json,
             a.reporting_to,
             mgr.name AS reporting_to_name,
             a.openclaw_agent_id
           FROM agents a
           LEFT JOIN agents mgr ON mgr.id = a.reporting_to
           WHERE a.id = @rowId`,
        )
        .get({ rowId: existingAgent.id }) as Record<string, unknown> | undefined;
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
          emoji: updatedAgent.emoji,
          role: updatedAgent.role,
          personality: updatedAgent.personality,
          model: updatedAgent.model,
          skills: JSON.parse((updatedAgent.skills_json as string) || "[]"),
          reportingTo: updatedAgent.reporting_to,
          reportingToName: updatedAgent.reporting_to_name,
        }
      : undefined,
    coreFiles,
  });
}
