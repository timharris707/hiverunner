import fs from "fs";
import os from "os";
import path from "path";

import { NextRequest, NextResponse } from "next/server";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { resolveAgentProviderFromRecord } from "@/lib/orchestration/service/provider-activation";

export const dynamic = "force-dynamic";

type AgentRow = {
  id: string;
  name: string;
  role: string;
  personality: string;
  adapter_type: string;
  model: string | null;
  openclaw_agent_id: string | null;
  runtime_workspace_root: string | null;
  instructions_mode: "managed" | "external";
  updated_at: string;
};

type InstructionSource = {
  id: string;
  label: string;
  kind: "profile_field" | "runtime_file" | "role_default";
  editable: boolean;
  exists: boolean;
  status: "active" | "fallback" | "available" | "missing";
  usedBy: string[];
  content: string | null;
  note: string;
  path?: string;
  byteSize: number;
  lineCount: number;
  updatedAt?: string;
};

const ONBOARDING_ASSET_ROOT = path.join(process.cwd(), "src/lib/orchestration/engine/onboarding-assets");

function resolveOpenClawDir(): string {
  const configured = process.env.OPENCLAW_DIR?.trim();
  return configured ? path.resolve(configured) : path.join(os.homedir(), ".openclaw");
}

function resolveRoleAssetDir(role: string): string {
  return path.join(
    ONBOARDING_ASSET_ROOT,
    role.trim().toLowerCase() === "ceo" ? "ceo" : "default",
  );
}

function readTextFile(filePath: string): { content: string; updatedAt?: string } | null {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const stats = fs.statSync(filePath);
    return {
      content,
      updatedAt: stats.mtime.toISOString(),
    };
  } catch {
    return null;
  }
}

function toMetrics(content: string | null): { byteSize: number; lineCount: number } {
  if (!content) {
    return { byteSize: 0, lineCount: 0 };
  }
  return {
    byteSize: new TextEncoder().encode(content).length,
    lineCount: content.split(/\r?\n/).length,
  };
}

function buildRuntimeModel(agent: AgentRow, hasSoul: boolean, roleAssets: Record<string, string>) {
  const currentProvider = resolveAgentProviderFromRecord({
    adapterType: agent.adapter_type,
    openclawAgentId: agent.openclaw_agent_id ?? undefined,
  });

  if (currentProvider.providerId === "openclaw-heartbeat" || currentProvider.providerId === "openclaw") {
    const heartbeatFiles = ["AGENTS.md", "HEARTBEAT.md", "SOUL.md"].filter((file) => roleAssets[file]);
    return {
      providerId: currentProvider.providerId,
      providerName: currentProvider.displayName,
      summary:
        "HiveRunner currently has two honest instruction layers for this agent: role-default heartbeat assets and the task-dispatch identity layer.",
      heartbeatPath: {
        label: "Heartbeat runtime",
        detail:
          heartbeatFiles.length > 0
            ? `OpenClaw heartbeat runs load role-default assets from HiveRunner source control: ${heartbeatFiles.join(", ")}. Per-agent AGENTS.md / HEARTBEAT.md files are not currently wired into this runtime path.`
            : "OpenClaw heartbeat runs do not currently have role-default markdown assets for this role.",
      },
      taskDispatchPath: {
        label: "Task dispatch",
        detail: hasSoul
          ? "HiveRunner task dispatch uses the agent's runtime SOUL.md file when present."
          : "HiveRunner task dispatch falls back to the stored HiveRunner prompt because no runtime SOUL.md file is present.",
      },
    };
  }

  return {
    providerId: currentProvider.providerId,
    providerName: currentProvider.displayName,
    summary:
      "This CLI-backed provider uses HiveRunner's managed company-workspace instruction files.",
    heartbeatPath: {
      label: "HiveRunner runtime",
      detail:
        "HiveRunner loads shared heartbeat rules plus the agent's company-workspace SOUL.md when present.",
    },
    taskDispatchPath: {
      label: "Task dispatch",
      detail: hasSoul
        ? "A local SOUL.md file exists in the HiveRunner company workspace and is used as the agent identity layer."
        : "The stored HiveRunner prompt is still available as fallback context until a company-workspace SOUL.md exists.",
    },
  };
}

function resolveRuntimeInstructionRoot(agent: AgentRow): string | null {
  if (agent.runtime_workspace_root?.trim()) {
    return path.resolve(agent.runtime_workspace_root);
  }

  const isOpenClawAgent = agent.adapter_type?.trim().toLowerCase() === "openclaw";
  if (isOpenClawAgent && agent.openclaw_agent_id?.trim()) {
    return path.join(resolveOpenClawDir(), "agents", agent.openclaw_agent_id);
  }

  return null;
}

function buildInstructionSources(agent: AgentRow): {
  runtimeModel: ReturnType<typeof buildRuntimeModel>;
  sources: InstructionSource[];
} {
  const runtimeRoot = resolveRuntimeInstructionRoot(agent);
  const soulPath = runtimeRoot ? path.join(runtimeRoot, "SOUL.md") : null;
  const soulFile = soulPath ? readTextFile(soulPath) : null;

  const roleAssetDir = resolveRoleAssetDir(agent.role);
  const roleAssets: Record<string, string> = {};
  for (const file of ["AGENTS.md", "HEARTBEAT.md", "SOUL.md"]) {
    const assetPath = path.join(roleAssetDir, file);
    const asset = readTextFile(assetPath);
    if (asset?.content) {
      roleAssets[file] = asset.content;
    }
  }

  const runtimeModel = buildRuntimeModel(agent, Boolean(soulFile?.content), roleAssets);

  const personalityMetrics = toMetrics(agent.personality);
  const sources: InstructionSource[] = [
    {
      id: "personality",
      label: "HiveRunner Prompt",
      kind: "profile_field",
      editable: true,
      exists: true,
      status: soulFile?.content ? "available" : "fallback",
      usedBy: soulFile?.content ? ["profile context"] : ["task dispatch fallback"],
      content: agent.personality,
      note: soulFile?.content
        ? "Stored in agents.personality. This remains editable here, but task dispatch currently prefers SOUL.md when that file exists."
        : "Stored in agents.personality. This is the current fallback instruction source when no SOUL.md file exists for task dispatch.",
      byteSize: personalityMetrics.byteSize,
      lineCount: personalityMetrics.lineCount,
      updatedAt: agent.updated_at,
    },
    {
      id: "soul",
      label: "SOUL.md",
      kind: "runtime_file",
      editable: Boolean(runtimeRoot) && agent.instructions_mode === "managed",
      exists: Boolean(soulFile?.content),
      status: soulFile?.content ? "active" : "missing",
      usedBy: ["task dispatch"],
      content: soulFile?.content ?? null,
      note: runtimeRoot
        ? soulFile?.content
          ? "This per-agent runtime file is the task-dispatch identity layer HiveRunner reads today."
          : "No SOUL.md file is present yet. Saving here will create one in the agent's HiveRunner workspace."
        : "This agent has no managed runtime workspace, so HiveRunner cannot manage a local SOUL.md file here.",
      path: soulPath ?? undefined,
      byteSize: toMetrics(soulFile?.content ?? null).byteSize,
      lineCount: toMetrics(soulFile?.content ?? null).lineCount,
      updatedAt: soulFile?.updatedAt,
    },
  ];

  for (const file of ["AGENTS.md", "HEARTBEAT.md", "SOUL.md"]) {
    const content = roleAssets[file] ?? null;
    const metrics = toMetrics(content);
    const exists = Boolean(content);
    const usedBy = runtimeModel.providerId === "openclaw-heartbeat" || runtimeModel.providerId === "openclaw"
      ? ["heartbeat runtime"]
      : [];

    sources.push({
      id: `role:${file}`,
      label: `Role Default: ${file}`,
      kind: "role_default",
      editable: false,
      exists,
      status: exists ? "available" : "missing",
      usedBy,
      content,
      note: exists
        ? `Read from HiveRunner's role-default onboarding assets for ${agent.role}.`
        : `No role-default ${file} asset exists for ${agent.role}.`,
      path: path.join(roleAssetDir, file),
      byteSize: metrics.byteSize,
      lineCount: metrics.lineCount,
      updatedAt: exists ? readTextFile(path.join(roleAssetDir, file))?.updatedAt : undefined,
    });
  }

  return { runtimeModel, sources };
}

function resolveAgent(agentIdOrSlug: string): AgentRow | null {
  const db = getOrchestrationDb();
  const row = db
    .prepare(
      `SELECT id, name, role, personality, adapter_type, model,
              openclaw_agent_id, instructions_mode, updated_at,
              (
                SELECT ar.workspace_root
                FROM agent_runtimes ar
                WHERE ar.agent_id = agents.id
                  AND ar.company_id = agents.company_id
                ORDER BY ar.updated_at DESC
                LIMIT 1
              ) AS runtime_workspace_root
       FROM agents
       WHERE archived_at IS NULL
         AND (id = ? OR slug = ? OR lower(name) = lower(?))
       LIMIT 1`,
    )
    .get(agentIdOrSlug, agentIdOrSlug, agentIdOrSlug) as AgentRow | undefined;

  return row ?? null;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const agent = resolveAgent(id);
    if (!agent) {
      return errorResponse(404, "agent_not_found", "Agent not found");
    }

    const { runtimeModel, sources } = buildInstructionSources(agent);

    return NextResponse.json({
      agent: {
        id: agent.id,
        name: agent.name,
        role: agent.role,
        model: agent.model,
        adapterType: agent.adapter_type,
        openclawAgentId: agent.openclaw_agent_id,
        instructionsMode: agent.instructions_mode,
      },
      runtimeModel,
      sources,
    });
  } catch (error) {
    return handleRouteError(error, "agents.instructions:get");
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const agent = resolveAgent(id);
    if (!agent) {
      return errorResponse(404, "agent_not_found", "Agent not found");
    }

    let body: { sourceId?: string; content?: string };
    try {
      body = await request.json();
    } catch {
      return errorResponse(400, "invalid_body", "Request body must be valid JSON");
    }

    if (!body.sourceId || typeof body.sourceId !== "string") {
      return errorResponse(400, "missing_source_id", 'Request body must include "sourceId"');
    }

    if (typeof body.content !== "string") {
      return errorResponse(400, "missing_content", 'Request body must include "content"');
    }

    if (body.sourceId === "personality") {
      const db = getOrchestrationDb();
      db.prepare(
        "UPDATE agents SET personality = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?",
      ).run(body.content, agent.id);
      return NextResponse.json({ ok: true, sourceId: body.sourceId });
    }

    if (body.sourceId === "soul") {
      const runtimeRoot = resolveRuntimeInstructionRoot(agent);
      if (!runtimeRoot) {
        return errorResponse(
          409,
          "instructions_unavailable",
          "This agent has no managed runtime workspace, so SOUL.md cannot be managed here.",
        );
      }

      if (agent.instructions_mode !== "managed") {
        return errorResponse(
          409,
          "instructions_external",
          "This agent is marked as external instructions mode. Runtime SOUL.md editing is disabled here.",
        );
      }

      fs.mkdirSync(runtimeRoot, { recursive: true });
      fs.writeFileSync(path.join(runtimeRoot, "SOUL.md"), body.content, "utf8");
      return NextResponse.json({ ok: true, sourceId: body.sourceId });
    }

    return errorResponse(
      400,
      "unsupported_source",
      `Instruction source "${body.sourceId}" is not editable in HiveRunner.`,
    );
  } catch (error) {
    return handleRouteError(error, "agents.instructions:patch");
  }
}
