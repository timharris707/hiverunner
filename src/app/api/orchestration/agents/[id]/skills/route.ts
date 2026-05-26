import fs from "fs";
import os from "os";
import path from "path";

import { NextRequest, NextResponse } from "next/server";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { syncAgentCoreFiles } from "@/lib/orchestration/agent-core-files";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { resolveAgentProviderFromRecord } from "@/lib/orchestration/service/provider-activation";
import { scanAllSkills } from "@/lib/skill-parser";

export const dynamic = "force-dynamic";

type AgentRow = {
  id: string;
  company_id: string;
  name: string;
  role: string;
  model: string | null;
  adapter_type: string;
  openclaw_agent_id: string | null;
  skills_json: string;
  updated_at: string;
};

type RegistrySkill = {
  id: string;
  name: string;
  description: string;
  source: "workspace" | "system" | "company";
  location: string;
  fileCount: number;
  workspaceOwners: string[];
};

type RuntimeEvidence = {
  status: "workspace_evidenced" | "not_proven" | "unavailable" | "provider_hidden";
  detail: string;
};

type DeclaredSkill = {
  rawValue: string;
  normalized: string;
  managed: boolean;
  matchKind: "id" | "name" | null;
  registryId: string | null;
  registryName: string | null;
  description: string | null;
  source: "workspace" | "system" | "company" | null;
  fileCount: number | null;
  location: string | null;
  workspaceOwners: string[];
  runtimeEvidence: RuntimeEvidence;
};

function resolveAgent(agentIdOrSlug: string): AgentRow | null {
  const db = getOrchestrationDb();
  const row = db
    .prepare(
      `SELECT id, name, role, model, adapter_type, openclaw_agent_id,
              company_id, skills_json, updated_at
       FROM agents
       WHERE archived_at IS NULL
         AND (id = ? OR slug = ? OR lower(name) = lower(?))
       LIMIT 1`,
    )
    .get(agentIdOrSlug, agentIdOrSlug, agentIdOrSlug) as AgentRow | undefined;

  return row ?? null;
}

function loadAssignedCompanySkillValues(agent: AgentRow): string[] {
  const db = getOrchestrationDb();
  const rows = db
    .prepare(
      `SELECT cs.slug
       FROM agent_skill_assignments asa
       JOIN company_skills cs ON cs.id = asa.skill_id
       WHERE asa.company_id = ?
         AND asa.agent_id = ?
         AND asa.status = 'active'
         AND asa.archived_at IS NULL
         AND cs.status = 'active'
         AND cs.archived_at IS NULL
         AND (cs.review_required = 0 OR cs.review_state = 'approved')
       ORDER BY cs.name ASC`,
    )
    .all(agent.company_id, agent.id) as Array<{ slug: string }>;
  return rows.map((row) => row.slug);
}

function loadCompanySkillLibrary(agent: AgentRow): RegistrySkill[] {
  const db = getOrchestrationDb();
  const rows = db
    .prepare(
      `SELECT slug, name, description, owner_agent_id
       FROM company_skills
       WHERE company_id = ?
         AND status = 'active'
         AND archived_at IS NULL
         AND (review_required = 0 OR review_state = 'approved')
       ORDER BY name ASC`,
    )
    .all(agent.company_id) as Array<{
    slug: string;
    name: string;
    description: string;
    owner_agent_id: string | null;
  }>;

  return rows.map((row) => ({
    id: row.slug,
    name: row.name,
    description: row.description,
    source: "company",
    location: `company-skill:${row.slug}`,
    fileCount: 1,
    workspaceOwners: row.owner_agent_id ? [row.owner_agent_id] : [],
  }));
}

function parseSkillsJson(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((value) => String(value ?? "").trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function dedupeSkillValues(values: string[]): string[] {
  const next: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(trimmed);
  }
  return next;
}

function dedupeRegistrySkills(skills: RegistrySkill[]): RegistrySkill[] {
  const next: RegistrySkill[] = [];
  const seen = new Set<string>();
  for (const skill of skills) {
    const key = skill.id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(skill);
  }
  return next;
}

function resolveOpenClawDir(): string {
  const configured = process.env.OPENCLAW_DIR?.trim();
  return configured ? path.resolve(configured) : path.join(os.homedir(), ".openclaw");
}

function getOpenClawListedAgentIds(): Set<string> {
  const listed = new Set<string>();
  const configPath = path.join(resolveOpenClawDir(), "openclaw.json");
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
      agents?: { list?: Array<{ id?: string | null }> };
    };
    for (const row of parsed.agents?.list ?? []) {
      const id = typeof row.id === "string" ? row.id.trim() : "";
      if (id) listed.add(id);
    }
  } catch {
    return listed;
  }
  return listed;
}

function isLegacyOpenClawProvider(providerId: string): boolean {
  return providerId === "openclaw" || providerId === "openclaw-heartbeat";
}

function providerDisplayName(providerId: string, displayName: string): string {
  if (isLegacyOpenClawProvider(providerId)) return "OpenClaw";
  return displayName;
}

function buildRuntimeEvidence(
  agent: AgentRow,
  registry: RegistrySkill | null,
  openclawListed: boolean,
): RuntimeEvidence {
  const currentProvider = resolveAgentProviderFromRecord({
    adapterType: agent.adapter_type,
    openclawAgentId: agent.openclaw_agent_id ?? undefined,
  });

  if (!registry) {
    return {
      status: "not_proven",
      detail:
        "This declaration does not match a configured company skill library entry, so HiveRunner treats it as unmanaged profile metadata.",
    };
  }

  if (isLegacyOpenClawProvider(currentProvider.providerId)) {
    if (!agent.openclaw_agent_id) {
      return {
        status: "unavailable",
        detail:
          "This agent has no OpenClaw runtime mapping, so HiveRunner cannot check workspace-level skill evidence for it.",
      };
    }

    if (!openclawListed) {
      return {
        status: "unavailable",
        detail:
          "This agent is not listed in the OpenClaw runtime registry, so workspace-based skill evidence is unavailable from HiveRunner.",
      };
    }

    if (registry.workspaceOwners.includes(agent.openclaw_agent_id)) {
      return {
        status: "workspace_evidenced",
        detail:
          "The configured skill library is detected in a scanned workspace owned by this OpenClaw agent. That is evidence of local availability, not proof of live per-run mounting.",
      };
    }

    return {
      status: "not_proven",
      detail:
        "The skill exists in the configured library, but HiveRunner has no agent-specific workspace evidence for this agent today.",
    };
  }

  return {
    status: "provider_hidden",
    detail:
      "This provider path does not expose runtime-mounted skill evidence in HiveRunner today. Edits here remain stored declarations only.",
  };
}

function buildProviderModel(agent: AgentRow, openclawListed: boolean) {
  const currentProvider = resolveAgentProviderFromRecord({
    adapterType: agent.adapter_type,
    openclawAgentId: agent.openclaw_agent_id ?? undefined,
  });

  if (isLegacyOpenClawProvider(currentProvider.providerId)) {
    return {
      providerId: currentProvider.providerId,
      providerName: providerDisplayName(currentProvider.providerId, currentProvider.displayName),
      summary:
        "HiveRunner stores declared skills for this OpenClaw-backed agent and maps them against the configured skill library. It does not claim live runtime skill mounting from this page.",
      declarationNote:
        "Edits here update agents.skills_json in HiveRunner. That is the current source of truth for declared skills on the agent profile.",
      runtimeNote:
        "OpenClaw scaffold generation can write an initial skills section into SOUL.md for newly created agents, but this page does not rewrite or verify live runtime mounts.",
      evidenceNote: openclawListed
        ? "Workspace evidence is shown only when a configured library skill is detected in a scanned workspace for this specific OpenClaw agent."
        : "This agent is not currently listed in the OpenClaw runtime registry, so workspace-based skill evidence is unavailable here.",
    };
  }

  return {
    providerId: currentProvider.providerId,
    providerName: providerDisplayName(currentProvider.providerId, currentProvider.displayName),
    summary:
      "HiveRunner can classify and edit declared skills for this agent, but this provider does not expose a managed runtime skill mount surface here.",
    declarationNote:
      "Edits here update the stored agent declaration only. HiveRunner does not present that as a live provider-native mount state.",
    runtimeNote:
      "Runtime-mounted skill evidence is not exposed for this provider path in HiveRunner today.",
    evidenceNote:
      "Configured library matches remain valuable operator metadata, but they should not be mistaken for proven runtime attachment.",
  };
}

function buildPayload(agent: AgentRow) {
  const currentProvider = resolveAgentProviderFromRecord({
    adapterType: agent.adapter_type,
    openclawAgentId: agent.openclaw_agent_id ?? undefined,
  });
  const listedOpenClawAgentIds = isLegacyOpenClawProvider(currentProvider.providerId)
    ? getOpenClawListedAgentIds()
    : new Set<string>();
  const openclawListed = isLegacyOpenClawProvider(currentProvider.providerId) && agent.openclaw_agent_id
    ? listedOpenClawAgentIds.has(agent.openclaw_agent_id)
    : false;

  const providerModel = buildProviderModel(agent, openclawListed);
  const parsedSkills = dedupeSkillValues([
    ...parseSkillsJson(agent.skills_json),
    ...loadAssignedCompanySkillValues(agent),
  ]);

  const scannedLibrary = scanAllSkills().map((skill) => ({
    id: skill.id,
    name: skill.name,
    description: skill.description,
    source: skill.source,
    location: skill.location,
    fileCount: skill.fileCount,
    workspaceOwners: Array.isArray(skill.agents) ? skill.agents.map((value) => String(value)) : [],
  })) satisfies RegistrySkill[];

  const library = dedupeRegistrySkills([...scannedLibrary, ...loadCompanySkillLibrary(agent)]);

  const byId = new Map<string, RegistrySkill>();
  const byName = new Map<string, RegistrySkill>();
  for (const skill of library) {
    byId.set(skill.id.toLowerCase(), skill);
    byName.set(skill.name.toLowerCase(), skill);
  }

  const declared = parsedSkills.map((rawValue) => {
    const normalized = rawValue.toLowerCase();
    const matchedById = byId.get(normalized) ?? null;
    const matchedByName = matchedById ? null : byName.get(normalized) ?? null;
    const registry = matchedById ?? matchedByName;
    const runtimeEvidence = buildRuntimeEvidence(agent, registry, openclawListed);

    return {
      rawValue,
      normalized,
      managed: Boolean(registry),
      matchKind: matchedById ? "id" : matchedByName ? "name" : null,
      registryId: registry?.id ?? null,
      registryName: registry?.name ?? null,
      description: registry?.description ?? null,
      source: registry?.source ?? null,
      fileCount: registry?.fileCount ?? null,
      location: registry?.location ?? null,
      workspaceOwners: registry?.workspaceOwners ?? [],
      runtimeEvidence,
    } satisfies DeclaredSkill;
  });

  const declaredRegistryIds = new Set(
    declared
      .map((entry) => entry.registryId?.toLowerCase() ?? null)
      .filter((value): value is string => Boolean(value)),
  );

  const libraryWithRuntime = library.map((skill) => ({
    ...skill,
    declared: declaredRegistryIds.has(skill.id.toLowerCase()),
    runtimeEvidence: buildRuntimeEvidence(agent, skill, openclawListed),
  }));

  return {
    agent: {
      id: agent.id,
      name: agent.name,
      role: agent.role,
      model: agent.model,
      adapterType: agent.adapter_type,
      openclawAgentId: agent.openclaw_agent_id,
      skills: parsedSkills,
      updatedAt: agent.updated_at,
    },
    providerModel,
    stats: {
      declaredCount: declared.length,
      libraryBackedCount: declared.filter((entry) => entry.managed).length,
      unmanagedCount: declared.filter((entry) => !entry.managed).length,
      libraryAvailableCount: libraryWithRuntime.filter((entry) => !entry.declared).length,
    },
    declared,
    library: libraryWithRuntime,
  };
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

    return NextResponse.json(buildPayload(agent));
  } catch (error) {
    return handleRouteError(error, "agents.skills:get");
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

    let body: { skills?: unknown };
    try {
      body = await request.json();
    } catch {
      return errorResponse(400, "invalid_body", "Request body must be valid JSON");
    }

    if (!Array.isArray(body.skills)) {
      return errorResponse(400, "missing_skills", 'Request body must include "skills"');
    }

    const nextSkills = dedupeSkillValues(
      body.skills.map((value) => String(value ?? "").trim()),
    );

    if (nextSkills.length > 50) {
      return errorResponse(400, "too_many_skills", "Skills list cannot exceed 50 entries.");
    }

    for (const skill of nextSkills) {
      if (skill.length > 80) {
        return errorResponse(
          400,
          "skill_too_long",
          `Skill "${skill.slice(0, 20)}..." exceeds the 80 character limit.`,
        );
      }
    }

    const db = getOrchestrationDb();
    db.prepare(
      "UPDATE agents SET skills_json = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?",
    ).run(JSON.stringify(nextSkills), agent.id);

    const coreFiles = syncAgentCoreFiles(db, agent.id);

    return NextResponse.json({ ok: true, skills: nextSkills, coreFiles });
  } catch (error) {
    return handleRouteError(error, "agents.skills:patch");
  }
}
