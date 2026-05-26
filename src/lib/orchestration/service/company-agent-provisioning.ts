import { execSync } from "child_process";
import { randomUUID } from "crypto";
import fs from "fs";

import type Database from "better-sqlite3";

import {
  evaluateAgentReadiness,
  generateAgentDossier,
  writeAgentDossierFiles,
} from "@/lib/orchestration/agent-dossier";
import { normalizeAgentSymbol } from "@/lib/orchestration/avatar-icons";
import { assignDefaultSkillsForAgent } from "@/lib/orchestration/default-skills";
import { ensureOpenClawAgentScaffold } from "@/lib/orchestration/openclaw-agent-scaffold";
import { upsertCompanyRuntime } from "@/lib/orchestration/runtime-registry";
import {
  buildOpenClawRuntimeId,
  ensureUniqueAgentRuntimeSlug,
  resolveProvisionedOpenClawAgentId,
} from "@/lib/orchestration/runtime-identifiers";
import {
  ensureAgentSourceWorkspaceLink,
  ensureCompanySourceWorkspaceLink,
  ensureCompanyWorkspaceScaffold,
  resolveCanonicalCompanyWorkspaceRoot,
  resolveCompanyAgentWorkspacePath,
} from "@/lib/workspaces/company-paths";

type CompanyRow = {
  id: string;
  name: string;
  workspace_root: string;
  runtime_slug: string | null;
};

type RequestingAgentRow = {
  id: string;
  name: string;
  project_id: string | null;
};

type ProjectRow = {
  id: string;
  slug: string;
  name: string;
};

type ExistingAgentRow = {
  id: string;
  project_id: string | null;
  runtime_slug: string | null;
  adapter_type: string | null;
  openclaw_agent_id: string | null;
};

type ProvisionCompanyHireAgentInput = {
  approvalCompanyId: string;
  requestedByAgentId?: string | null;
  payload: Record<string, unknown>;
  db: Database.Database;
  initialStatus: "paused" | "idle";
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function resolveHirePayloadName(payload: Record<string, unknown>): string {
  if (typeof payload.name === "string" && payload.name.trim()) {
    return payload.name.trim();
  }

  if (typeof payload.agentName === "string" && payload.agentName.trim()) {
    return payload.agentName.trim();
  }

  return "Unnamed Agent";
}

function readPayloadString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readPayloadNumber(payload: Record<string, unknown>, key: string): number | null {
  const value = payload[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

const SUPPORTED_RUNTIME_PROVIDERS = new Set([
  "anthropic",
  "codex",
  "gemini",
  "hermes",
  "manual",
  "multica",
  "openclaw",
  "symphony",
]);

export function normalizeRuntimeProvider(payload: Record<string, unknown>): string {
  const raw =
    readPayloadString(payload, "runtimeProvider") ??
    readPayloadString(payload, "provider") ??
    readPayloadString(payload, "adapterType") ??
    "manual";
  const normalized = raw.toLowerCase().replace(/^claude$/, "anthropic").replace(/^openai$/, "codex");
  return SUPPORTED_RUNTIME_PROVIDERS.has(normalized) ? normalized : "manual";
}

function hasRuntimeProviderPayload(payload: Record<string, unknown>): boolean {
  return (
    readPayloadString(payload, "runtimeProvider") !== null ||
    readPayloadString(payload, "provider") !== null ||
    readPayloadString(payload, "adapterType") !== null
  );
}

export function defaultCommandForRuntimeProvider(provider: string): string {
  switch (provider) {
    case "anthropic":
      return "claude";
    case "codex":
      return "codex";
    case "gemini":
      return "gemini";
    case "hermes":
      return "hermes";
    case "multica":
      return "multica";
    case "symphony":
      return "symphony";
    case "manual":
      return "";
    case "openclaw":
    default:
      return "openclaw";
  }
}

export function defaultModelForRuntimeProvider(provider: string): string {
  switch (normalizeRuntimeProvider({ runtimeProvider: provider })) {
    case "anthropic":
      return "anthropic/claude-sonnet-4-6";
    case "codex":
      return "openai-codex/gpt-5.5";
    case "gemini":
      return "google/gemini-2.5-pro";
    case "hermes":
    case "symphony":
      return "";
    case "manual":
      return "";
    case "multica":
    case "openclaw":
    default:
      return "openai-codex/gpt-5.5";
  }
}

export function normalizeModelForRuntimeProvider(provider: string, model: string | null | undefined): string {
  const normalizedProvider = normalizeRuntimeProvider({ runtimeProvider: provider });
  const fallback = defaultModelForRuntimeProvider(normalizedProvider);
  const raw = typeof model === "string" && model.trim() ? model.trim() : fallback;

  if (normalizedProvider === "hermes") {
    const normalizedHermesModel = raw.toLowerCase();
    if (
      !normalizedHermesModel ||
      normalizedHermesModel === "auto" ||
      normalizedHermesModel === "default" ||
      normalizedHermesModel === "hermes-default" ||
      normalizedHermesModel === "hermes/default" ||
      normalizedHermesModel === "hermes/auto"
    ) {
      return "";
    }
    return raw;
  }

  if (normalizedProvider === "anthropic") {
    const anthropicModel = raw.replace(/^anthropic\//i, "").trim().toLowerCase();
    if (
      !anthropicModel ||
      anthropicModel === "auto" ||
      anthropicModel === "default" ||
      anthropicModel === "claude" ||
      anthropicModel === "claude-default" ||
      anthropicModel === "sonnet" ||
      anthropicModel === "claude-sonnet" ||
      anthropicModel === "sonnet-3.7" ||
      anthropicModel === "sonnet-3-7" ||
      anthropicModel === "claude-3.7-sonnet" ||
      anthropicModel === "claude-3-7-sonnet" ||
      anthropicModel === "claude-sonnet-3.7" ||
      anthropicModel === "claude-sonnet-3-7" ||
      anthropicModel === "sonnet-4.5" ||
      anthropicModel === "sonnet-4-5" ||
      anthropicModel === "claude-sonnet-4.5" ||
      anthropicModel === "claude-sonnet-4-5"
    ) {
      return "anthropic/claude-sonnet-4-6";
    }
    if (anthropicModel === "opus" || anthropicModel === "claude-opus") {
      return "anthropic/claude-opus-4-7";
    }
    return raw.startsWith("anthropic/") ? raw : `anthropic/${raw}`;
  }

  if (normalizedProvider === "codex") {
    const codexModel = raw.replace(/^openai-codex\//i, "").replace(/^openai\//i, "").trim().toLowerCase();
    if (
      !codexModel ||
      codexModel === "auto" ||
      codexModel === "default" ||
      codexModel === "gpt-5"
    ) {
      return "openai-codex/gpt-5.5";
    }
    return raw.startsWith("openai-codex/") ? raw : `openai-codex/${codexModel}`;
  }

  if (normalizedProvider !== "gemini") {
    return raw;
  }

  const geminiModel = raw.replace(/^google\//i, "").trim().toLowerCase();
  if (
    !geminiModel ||
    geminiModel === "auto" ||
    geminiModel === "default" ||
    geminiModel === "google-default" ||
    geminiModel === "gemini-default" ||
    geminiModel === "gemini-pro" ||
    geminiModel === "auto-gemini-3" ||
    geminiModel === "pro"
  ) {
    return "google/gemini-2.5-pro";
  }

  if (geminiModel === "flash") {
    return "google/gemini-3-flash-preview";
  }

  if (geminiModel === "flash-lite") {
    return "google/gemini-2.5-flash-lite";
  }

  if (geminiModel === "auto-gemini-2.5") {
    return "google/gemini-2.5-pro";
  }

  if (geminiModel.startsWith("gemini-")) {
    return `google/${geminiModel}`;
  }

  return raw.startsWith("google/") ? raw : `google/${raw}`;
}

function readPayloadCapabilities(payload: Record<string, unknown>): string | string[] | null {
  const value = payload.capabilities;
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  }
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function provisionOpenClawAgent(openclawRuntimeId: string, workspacePath: string, model: string): string | null {
  if (process.env.MC_ENABLE_OPENCLAW_AGENT_PROVISIONING !== "1") {
    console.warn(
      `[company-agent-provisioning] skipped openclaw agents add for "${openclawRuntimeId}"; ` +
      "set MC_ENABLE_OPENCLAW_AGENT_PROVISIONING=1 only in an isolated OpenClaw config environment.",
    );
    return null;
  }
  try {
    const cmd = `openclaw agents add ${openclawRuntimeId} --workspace "${workspacePath}" --model "${model}" --non-interactive --json`;
    const output = execSync(cmd, { encoding: "utf-8", timeout: 60000 });
    return resolveProvisionedOpenClawAgentId(output, openclawRuntimeId);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[company-agent-provisioning] openclaw agents add failed for "${openclawRuntimeId}": ${message}`);
    return null;
  }
}

function provisionCompanyHireAgent(input: ProvisionCompanyHireAgentInput) {
  const db = input.db;
  const company = db.prepare(
    `SELECT id, name, workspace_root, runtime_slug
     FROM companies
     WHERE id = ? AND archived_at IS NULL
     LIMIT 1`
  ).get(input.approvalCompanyId) as CompanyRow | undefined;

  if (!company?.workspace_root?.trim()) {
    throw new Error("Company workspace root is missing; cannot materialize approved hire.");
  }

  const requestingAgent = input.requestedByAgentId
    ? db.prepare(
        `SELECT id, name, project_id
         FROM agents
         WHERE id = ? AND company_id = ? AND archived_at IS NULL
         LIMIT 1`
      ).get(input.requestedByAgentId, company.id) as RequestingAgentRow | undefined
    : undefined;

  const requestedProjectId = typeof input.payload.projectId === "string" && input.payload.projectId.trim()
    ? input.payload.projectId.trim()
    : null;

  const name = resolveHirePayloadName(input.payload);
  const role = typeof input.payload.role === "string" && input.payload.role.trim()
    ? input.payload.role.trim()
    : "General";
  const agentSlug = slugify(name);

  const requestedProject = requestedProjectId
    ? db.prepare(
        `SELECT id, slug, name
         FROM projects
         WHERE company_id = ?
           AND archived_at IS NULL
           AND (id = ? OR slug = ?)
         LIMIT 1`
      ).get(company.id, requestedProjectId, requestedProjectId) as ProjectRow | undefined
    : undefined;
  if (requestedProjectId && !requestedProject) {
    throw new Error("Requested project was not found for this company.");
  }

  const requestedAgentId = typeof input.payload.agentId === "string" && input.payload.agentId.trim()
    ? input.payload.agentId.trim()
    : typeof input.payload.agent_id === "string" && input.payload.agent_id.trim()
      ? input.payload.agent_id.trim()
      : null;

  const existingAgent = (
    requestedAgentId
      ? db.prepare(
          `SELECT id, project_id, runtime_slug, adapter_type, openclaw_agent_id
           FROM agents
           WHERE id = ?
             AND company_id = ?
             AND archived_at IS NULL
           LIMIT 1`
        ).get(requestedAgentId, company.id)
      : undefined
  ) as ExistingAgentRow | undefined
    ?? db.prepare(
      `SELECT id, project_id, runtime_slug, adapter_type, openclaw_agent_id
       FROM agents
       WHERE company_id = ?
         AND archived_at IS NULL
         AND lower(name) = lower(?)
      ORDER BY created_at ASC
      LIMIT 1`
    ).get(company.id, name) as ExistingAgentRow | undefined;

  const existingProvider = existingAgent?.adapter_type?.trim()
    ? normalizeRuntimeProvider({ runtimeProvider: existingAgent.adapter_type })
    : existingAgent?.openclaw_agent_id?.trim()
      ? "openclaw"
      : null;
  const requestedRuntimeProvider = hasRuntimeProviderPayload(input.payload)
    ? normalizeRuntimeProvider(input.payload)
    : existingProvider ?? "manual";
  const explicitOpenClawAgentId =
    readPayloadString(input.payload, "openclawAgentId") ??
    readPayloadString(input.payload, "openclaw_agent_id");
  const existingOpenClawAgentId = existingAgent?.openclaw_agent_id?.trim() || null;
  const runtimeProvider =
    requestedRuntimeProvider === "openclaw" &&
    !explicitOpenClawAgentId &&
    !existingOpenClawAgentId &&
    process.env.MC_ENABLE_OPENCLAW_AGENT_PROVISIONING !== "1"
      ? "manual"
      : requestedRuntimeProvider;
  const requestedModel = typeof input.payload.model === "string" && input.payload.model.trim()
    ? input.payload.model.trim()
    : defaultModelForRuntimeProvider(runtimeProvider);
  const model = normalizeModelForRuntimeProvider(runtimeProvider, requestedModel);
  const runtimeCommand =
    readPayloadString(input.payload, "runtimeCommand") ??
    defaultCommandForRuntimeProvider(runtimeProvider);
  const runtimeCommandPath = readPayloadString(input.payload, "runtimeCommandPath");
  const runtimeDisplayName =
    readPayloadString(input.payload, "runtimeDisplayName") ??
    `${runtimeProvider} runtime`;
  const runtimeSource = readPayloadString(input.payload, "runtimeSource");

  const now = new Date().toISOString();
  const agentId = existingAgent?.id ?? randomUUID();
  const agentRuntimeSlug =
    existingAgent?.runtime_slug?.trim() ||
    ensureUniqueAgentRuntimeSlug(db, company.id, name, {
      excludeAgentId: existingAgent?.id,
    });
  const existingProject = existingAgent?.project_id
    ? db.prepare(
        `SELECT id, slug, name
         FROM projects
         WHERE company_id = ?
           AND id = ?
         LIMIT 1`
      ).get(company.id, existingAgent.project_id) as ProjectRow | undefined
    : undefined;
  const agentProject = requestedProject ?? existingProject ?? null;
  const resolvedProjectId = requestedProject?.id ?? existingAgent?.project_id ?? null;
  const dossierProjectName = agentProject?.name ?? "All company projects";
  const dossierProjectSlug = agentProject?.slug ?? "all-company-projects";
  const reportingToId = requestingAgent?.id ?? null;
  const reportsToName = requestingAgent?.name ?? "Unassigned";
  const workspaceRootForAgent = runtimeProvider === "openclaw"
    ? company.workspace_root
    : resolveCanonicalCompanyWorkspaceRoot(
        company.id,
        company.runtime_slug?.trim() || slugify(company.name),
      );
  ensureCompanyWorkspaceScaffold(workspaceRootForAgent);
  ensureCompanySourceWorkspaceLink(workspaceRootForAgent);
  const agentWorkspacePath = resolveCompanyAgentWorkspacePath(workspaceRootForAgent, agentSlug);
  if (!agentWorkspacePath) {
    throw new Error("Company workspace root is missing; cannot create agent workspace.");
  }
  fs.mkdirSync(agentWorkspacePath, { recursive: true });
  ensureAgentSourceWorkspaceLink(agentWorkspacePath, workspaceRootForAgent);

  const agentSymbol = normalizeAgentSymbol(readPayloadString(input.payload, "emoji"), role);
  const requestedAvatarUrl = readPayloadString(input.payload, "avatarUrl");
  const avatarUrl = requestedAvatarUrl ?? null;

  const dossier = generateAgentDossier({
    name,
    role,
    companyName: company.name,
    projectName: dossierProjectName,
    projectSlug: dossierProjectSlug,
    reportsTo: reportsToName,
    emoji: agentSymbol,
    personality: readPayloadString(input.payload, "personality"),
    mission: readPayloadString(input.payload, "mission"),
    capabilities: readPayloadCapabilities(input.payload),
    reason: readPayloadString(input.payload, "reason"),
    avatarStyleId: readPayloadString(input.payload, "avatarStyleId"),
    avatarGender: readPayloadString(input.payload, "avatarGender"),
    avatarAge: readPayloadNumber(input.payload, "avatarAge"),
    avatarHairColor: readPayloadString(input.payload, "avatarHairColor"),
    avatarHairLength: readPayloadString(input.payload, "avatarHairLength"),
    avatarEyeColor: readPayloadString(input.payload, "avatarEyeColor"),
    avatarVibe: readPayloadString(input.payload, "avatarVibe"),
    voiceId: readPayloadString(input.payload, "voiceId"),
  });

  const shouldProvisionOpenClaw =
    runtimeProvider === "openclaw" &&
    !explicitOpenClawAgentId &&
    process.env.MC_ENABLE_OPENCLAW_AGENT_PROVISIONING === "1";
  const openclawRuntimeId = shouldProvisionOpenClaw
    ? existingOpenClawAgentId ??
      buildOpenClawRuntimeId({
        db,
        companyId: company.id,
        companyRuntimeSlug: company.runtime_slug?.trim() || slugify(company.name),
        agentId,
        agentRuntimeSlug,
        excludeAgentId: existingAgent?.id,
      })
    : null;
  const openclawAgentId = runtimeProvider === "openclaw"
    ? existingOpenClawAgentId ??
      explicitOpenClawAgentId ??
      (shouldProvisionOpenClaw && openclawRuntimeId ? provisionOpenClawAgent(openclawRuntimeId, agentWorkspacePath, model) : null) ??
      (shouldProvisionOpenClaw ? openclawRuntimeId : null)
    : null;

  if (existingAgent) {
    db.prepare(
      `UPDATE agents
       SET project_id = ?,
           slug = ?,
           runtime_slug = COALESCE(runtime_slug, ?),
           emoji = ?,
           role = ?,
           personality = ?,
           avatar_url = ?,
           avatar_style_id = ?,
           avatar_gender = ?,
           avatar_age = ?,
           avatar_hair_color = ?,
           avatar_hair_length = ?,
           avatar_eye_color = ?,
           avatar_vibe = ?,
           voice_id = ?,
           model = ?,
           adapter_type = ?,
           status = ?,
           openclaw_agent_id = ?,
           reporting_to = ?,
           updated_at = ?
       WHERE id = ?`
    ).run(
        resolvedProjectId,
        agentSlug,
        agentRuntimeSlug,
        dossier.emoji,
        role,
        dossier.personality,
        avatarUrl,
        dossier.avatar.styleId,
        dossier.avatar.gender,
        dossier.avatar.age,
        dossier.avatar.hairColor,
        dossier.avatar.hairLength,
        dossier.avatar.eyeColor,
        dossier.avatar.vibe,
        dossier.voice.voiceId,
        model,
        runtimeProvider,
        input.initialStatus,
        openclawAgentId,
        reportingToId,
        now,
        agentId,
    );
  } else {
    db.prepare(
      `INSERT INTO agents
        (id, company_id, project_id, name, slug, runtime_slug, emoji, role, personality, avatar_url,
         avatar_style_id, avatar_gender, avatar_age, avatar_hair_color, avatar_hair_length,
         avatar_eye_color, avatar_vibe, voice_id, model, adapter_type, status, openclaw_agent_id, reporting_to,
         skills_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?)`
    ).run(
      agentId,
      company.id,
      resolvedProjectId,
      name,
      agentSlug,
      agentRuntimeSlug,
      dossier.emoji,
      role,
      dossier.personality,
      avatarUrl,
      dossier.avatar.styleId,
      dossier.avatar.gender,
      dossier.avatar.age,
      dossier.avatar.hairColor,
      dossier.avatar.hairLength,
      dossier.avatar.eyeColor,
      dossier.avatar.vibe,
      dossier.voice.voiceId,
      model,
      runtimeProvider,
      input.initialStatus,
      openclawAgentId,
      reportingToId,
      now,
      now,
    );
  }

  db.prepare(
    `INSERT INTO agent_runtime_state
      (agent_id, company_id, adapter_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(agent_id) DO UPDATE SET
       adapter_type = excluded.adapter_type,
       updated_at = excluded.updated_at`
  ).run(agentId, company.id, runtimeProvider, now, now);

  writeAgentDossierFiles({
    agentWorkspacePath,
    dossier,
  });

  const readiness = evaluateAgentReadiness({
    agentWorkspacePath,
    openclawAgentId,
    requiresOpenClawAgentId: shouldProvisionOpenClaw,
    voiceId: dossier.voice.voiceId,
    avatar: dossier.avatar,
  });
  if (!readiness.ready) {
    console.warn(
      `[company-agent-provisioning] provisioned agent "${name}" is missing required setup: files=${readiness.missingFiles.join(",") || "none"} fields=${readiness.missingFields.join(",") || "none"}`,
    );
  }

  // Idempotent scaffold of ~/.openclaw/agents/{openclawAgentId}/ only for
  // actual OpenClaw-backed agents. Anthropic/Codex/etc. agents are standalone
  // HiveRunner agents and must not create or read OpenClaw identity files.
  if (openclawAgentId) {
    try {
      ensureOpenClawAgentScaffold({
        openclawAgentId,
        name,
        role,
        personality: dossier.personality,
        projectName: dossierProjectName,
        projectSlug: dossierProjectSlug,
        model,
        skills: dossier.capabilities,
        soulMarkdown: dossier.files.soulMd,
        voiceId: dossier.voice.voiceId,
        avatar: dossier.avatar,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[company-agent-provisioning] openclaw scaffold failed for "${openclawAgentId}": ${message}`,
      );
    }
  }

  if (existingAgent) {
    db.prepare(
      `DELETE FROM agent_runtimes
       WHERE company_id = ?
         AND agent_id = ?
         AND provider <> ?`,
    ).run(company.id, agentId, runtimeProvider);
  }

  upsertCompanyRuntime({
    companyIdOrSlug: company.id,
    agentId,
    provider: runtimeProvider,
    runtimeSlug: agentRuntimeSlug,
    displayName: `${name} ${runtimeDisplayName}`,
    runtimeKind: runtimeProvider === "manual" ? "manual" : "cli",
    scope: "agent",
    command: runtimeCommand || null,
    status: "unknown",
    workspaceRoot: agentWorkspacePath,
    metadata: {
      source: "company-agent-provisioning",
      requestedRuntimeProvider,
      selectedRuntimeSource: runtimeSource,
      selectedRuntimeSlug: readPayloadString(input.payload, "runtimeSlug"),
      selectedRuntimeDisplayName: runtimeDisplayName,
      commandPath: runtimeCommandPath,
      ...(openclawAgentId ? { openclawAgentId } : {}),
      model,
    },
  });
  assignDefaultSkillsForAgent(company.id, agentId);

  return {
    agentId,
    agentSlug,
    runtimeSlug: agentRuntimeSlug,
    openclawAgentId,
    projectId: resolvedProjectId,
    workspacePath: agentWorkspacePath,
  };
}

export function stagePendingHireAgent(input: {
  approvalCompanyId: string;
  requestedByAgentId?: string | null;
  payload: Record<string, unknown>;
  db: Database.Database;
}) {
  return provisionCompanyHireAgent({
    ...input,
    initialStatus: "paused",
  });
}

export function materializeApprovedHireAgent(input: {
  approvalCompanyId: string;
  requestedByAgentId?: string | null;
  payload: Record<string, unknown>;
  db: Database.Database;
}) {
  return provisionCompanyHireAgent({
    ...input,
    initialStatus: "idle",
  });
}
