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
  paperclip_agent_id: string | null;
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
    paperclipAgentId: agent.paperclip_agent_id ?? undefined,
  });

  if (currentProvider.providerId === "openclaw-heartbeat" || currentProvider.providerId === "openclaw") {
    const heartbeatFiles = ["AGENTS.md", "HEARTBEAT.md", "SOUL.md"].filter((file) => roleAssets[file]);
    return {
      providerId: currentProvider.providerId,
      providerName: currentProvider.displayName,
      summary:
        "Mission Control currently has two honest instruction layers for this agent: role-default heartbeat assets and the task-dispatch identity layer.",
      heartbeatPath: {
        label: "Heartbeat runtime",
        detail:
          heartbeatFiles.length > 0
            ? `OpenClaw heartbeat runs load role-default assets from Mission Control source control: ${heartbeatFiles.join(", ")}. Per-agent AGENTS.md / HEARTBEAT.md files are not currently wired into this runtime path.`
            : "OpenClaw heartbeat runs do not currently have role-default markdown assets for this role.",
      },
      taskDispatchPath: {
        label: "Task dispatch",
        detail: hasSoul
          ? "Mission Control task dispatch uses the agent's runtime SOUL.md file when present."
          : "Mission Control task dispatch falls back to the stored Mission Control prompt because no runtime SOUL.md file is present.",
      },
    };
  }

  if (currentProvider.providerId === "paperclip") {
    return {
      providerId: currentProvider.providerId,
      providerName: currentProvider.displayName,
      summary:
        "Paperclip owns the provider-native instruction bundle. Mission Control can show the local profile prompt here, but not the full Paperclip-side bundle yet.",
      heartbeatPath: {
        label: "Provider bundle",
        detail:
          "The Paperclip runtime has its own richer instruction model. Mission Control does not yet expose provider-side file editing for it.",
      },
      taskDispatchPath: {
        label: "Mission Control fallback",
        detail:
          "The stored Mission Control prompt remains visible here for operator context, but it is not presented as a full Paperclip instruction bundle.",
      },
    };
  }

  return {
    providerId: currentProvider.providerId,
    providerName: currentProvider.displayName,
    summary:
      "This CLI-backed provider does not yet have a provider-native multi-file instruction bundle surfaced in Mission Control.",
    heartbeatPath: {
      label: "Provider runtime",
      detail:
        "Mission Control can show local instruction sources and fallback context, but it does not yet expose a provider-native bundle editor for this path.",
    },
    taskDispatchPath: {
      label: "Mission Control fallback",
      detail: hasSoul
        ? "A local SOUL.md file exists for OpenClaw-compatible task dispatch paths, but that should not be mistaken for a provider-native CLI bundle."
        : "The stored Mission Control prompt is still available as profile context, but it is not a provider-native CLI bundle.",
    },
  };
}

function buildInstructionSources(agent: AgentRow): {
  runtimeModel: ReturnType<typeof buildRuntimeModel>;
  sources: InstructionSource[];
} {
  const openclawRoot = agent.openclaw_agent_id
    ? path.join(resolveOpenClawDir(), "agents", agent.openclaw_agent_id)
    : null;
  const soulPath = openclawRoot ? path.join(openclawRoot, "SOUL.md") : null;
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
      label: "Mission Control Prompt",
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
      editable: Boolean(agent.openclaw_agent_id) && agent.instructions_mode === "managed",
      exists: Boolean(soulFile?.content),
      status: soulFile?.content ? "active" : "missing",
      usedBy: ["task dispatch"],
      content: soulFile?.content ?? null,
      note: agent.openclaw_agent_id
        ? soulFile?.content
          ? "This per-agent runtime file is the task-dispatch identity layer Mission Control can prove is read today."
          : "No SOUL.md file is present yet. Saving here will create one for OpenClaw-compatible task dispatch."
        : "This agent has no OpenClaw runtime mapping, so Mission Control cannot manage a local SOUL.md file here.",
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
        ? `Read from Mission Control's role-default onboarding assets for ${agent.role}.`
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
              openclaw_agent_id, paperclip_agent_id, instructions_mode, updated_at
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
        paperclipAgentId: agent.paperclip_agent_id,
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
      if (!agent.openclaw_agent_id) {
        return errorResponse(
          409,
          "instructions_unavailable",
          "This agent has no OpenClaw runtime mapping, so SOUL.md cannot be managed here.",
        );
      }

      if (agent.instructions_mode !== "managed") {
        return errorResponse(
          409,
          "instructions_external",
          "This agent is marked as external instructions mode. Runtime SOUL.md editing is disabled here.",
        );
      }

      const agentDir = path.join(resolveOpenClawDir(), "agents", agent.openclaw_agent_id);
      fs.mkdirSync(agentDir, { recursive: true });
      fs.writeFileSync(path.join(agentDir, "SOUL.md"), body.content, "utf8");
      return NextResponse.json({ ok: true, sourceId: body.sourceId });
    }

    return errorResponse(
      400,
      "unsupported_source",
      `Instruction source "${body.sourceId}" is not editable in Mission Control.`,
    );
  } catch (error) {
    return handleRouteError(error, "agents.instructions:patch");
  }
}
