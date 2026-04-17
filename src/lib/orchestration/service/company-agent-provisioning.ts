import { execSync } from "child_process";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";

import type Database from "better-sqlite3";

import { generateAgentAvatarDataUrl } from "@/lib/orchestration/avatar";
import { ensureOpenClawAgentScaffold } from "@/lib/orchestration/openclaw-agent-scaffold";
import {
  buildOpenClawRuntimeId,
  ensureUniqueAgentRuntimeSlug,
  resolveProvisionedOpenClawAgentId,
} from "@/lib/orchestration/runtime-identifiers";
import {
  ensureCompanyWorkspaceScaffold,
  resolveCompanyAgentWorkspacePath,
} from "@/lib/workspaces/company-paths";

type CompanyRow = {
  id: string;
  name: string;
  workspace_root: string;
  runtime_slug: string | null;
  theme_name: string | null;
  theme_prompt_template: string | null;
  theme_keywords_json: string | null;
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

function parseThemeKeywords(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
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

function writeAgentInstructionFiles(input: {
  agentWorkspacePath: string;
  companyName: string;
  name: string;
  role: string;
  reportsTo: string;
  emoji: string;
  personality: string;
  mission: string;
}) {
  const { agentWorkspacePath, companyName, name, role, reportsTo, emoji, personality, mission } = input;

  fs.writeFileSync(
    path.join(agentWorkspacePath, "IDENTITY.md"),
    `# IDENTITY.md - Who Am I?\n\n- **Name:** ${name}\n- **Role:** ${role}\n- **Company:** ${companyName}\n- **Reports To:** ${reportsTo}\n- **Emoji:** ${emoji}\n`
  );

  fs.writeFileSync(
    path.join(agentWorkspacePath, "SOUL.md"),
    `# SOUL.md - Who I Am\n\n_I am ${name}, ${role} at ${companyName}._\n\n## Core Truths\n- I own ${role} work for ${companyName}.\n- I report to ${reportsTo}.\n- I move work forward without waiting around.\n\n## Personality / Focus\n${personality}\n\n## Mission\n${mission}\n`
  );

  fs.writeFileSync(
    path.join(agentWorkspacePath, "AGENTS.md"),
    `# AGENTS.md - Working Agreement\n\n## Company\n- **Company:** ${companyName}\n- **Workspace:** ${agentWorkspacePath}\n\n## Role\n- **Agent:** ${name}\n- **Function:** ${role}\n- **Reports To:** ${reportsTo}\n\n## Operating Rule\n- Stay focused on your role, ship clean work, and escalate blockers clearly.\n`
  );

  fs.writeFileSync(
    path.join(agentWorkspacePath, "HEARTBEAT.md"),
    `# HEARTBEAT.md — Operating Loop\n\n## On Every Wake\n1. Review assigned work\n2. Check for blockers\n3. Advance the highest-value task\n4. Report blockers clearly\n`
  );

  fs.writeFileSync(
    path.join(agentWorkspacePath, "TOOLS.md"),
    `# TOOLS.md\n\nLocal notes for ${name} at ${companyName}.\n\n- Add role-specific commands, references, and environment notes here.\n`
  );
}

function provisionOpenClawAgent(openclawRuntimeId: string, workspacePath: string, model: string): string | null {
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
    `SELECT id, name, workspace_root, runtime_slug, theme_name, theme_prompt_template, theme_keywords_json
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

  const project = db.prepare(
    `SELECT id, slug, name
     FROM projects
     WHERE company_id = ?
       AND archived_at IS NULL
       AND (
         id = COALESCE(?, '')
         OR id = COALESCE(?, '')
       )
     LIMIT 1`
  ).get(company.id, requestedProjectId, requestingAgent?.project_id ?? null) as ProjectRow | undefined
    ?? db.prepare(
      `SELECT id, slug, name
       FROM projects
       WHERE company_id = ?
         AND archived_at IS NULL
       ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, created_at ASC
       LIMIT 1`
    ).get(company.id) as ProjectRow | undefined;

  if (!project) {
    throw new Error("Company has no active project; cannot materialize approved hire.");
  }

  const name = resolveHirePayloadName(input.payload);
  const role = typeof input.payload.role === "string" && input.payload.role.trim()
    ? input.payload.role.trim()
    : "General";
  const agentSlug = slugify(name);
  const model = typeof input.payload.model === "string" && input.payload.model.trim()
    ? input.payload.model.trim()
    : "anthropic/claude-sonnet-4-6";
  const emoji = typeof input.payload.emoji === "string" && input.payload.emoji.trim()
    ? input.payload.emoji.trim()
    : "pixel";
  const personality = typeof input.payload.personality === "string" && input.payload.personality.trim()
    ? input.payload.personality.trim()
    : typeof input.payload.capabilities === "string" && input.payload.capabilities.trim()
      ? `Role: ${role}. ${input.payload.capabilities.trim()}`
      : `Role: ${role} at ${company.name}`;
  const mission = typeof input.payload.mission === "string" && input.payload.mission.trim()
    ? input.payload.mission.trim()
    : typeof input.payload.reason === "string" && input.payload.reason.trim()
      ? input.payload.reason.trim()
      : `${name} owns ${role} responsibilities for ${company.name}.`;

  const requestedAgentId = typeof input.payload.agentId === "string" && input.payload.agentId.trim()
    ? input.payload.agentId.trim()
    : typeof input.payload.agent_id === "string" && input.payload.agent_id.trim()
      ? input.payload.agent_id.trim()
      : null;

  const existingAgent = (
    requestedAgentId
      ? db.prepare(
          `SELECT id, project_id, runtime_slug, openclaw_agent_id
           FROM agents
           WHERE id = ?
             AND company_id = ?
             AND archived_at IS NULL
           LIMIT 1`
        ).get(requestedAgentId, company.id)
      : undefined
  ) as ExistingAgentRow | undefined
    ?? db.prepare(
      `SELECT id, project_id, runtime_slug, openclaw_agent_id
       FROM agents
       WHERE company_id = ?
         AND archived_at IS NULL
         AND lower(name) = lower(?)
       ORDER BY created_at ASC
       LIMIT 1`
    ).get(company.id, name) as ExistingAgentRow | undefined;

  const now = new Date().toISOString();
  const agentId = existingAgent?.id ?? randomUUID();
  const agentRuntimeSlug =
    existingAgent?.runtime_slug?.trim() ||
    ensureUniqueAgentRuntimeSlug(db, company.id, name, {
      excludeAgentId: existingAgent?.id,
    });
  const resolvedProjectId = existingAgent?.project_id ?? project.id;
  const reportingToId = requestingAgent?.id ?? null;
  const reportsToName = requestingAgent?.name ?? "Unassigned";
  ensureCompanyWorkspaceScaffold(company.workspace_root);
  const agentWorkspacePath = resolveCompanyAgentWorkspacePath(company.workspace_root, agentSlug);
  if (!agentWorkspacePath) {
    throw new Error("Company workspace root is missing; cannot create agent workspace.");
  }
  fs.mkdirSync(agentWorkspacePath, { recursive: true });

  const openclawRuntimeId =
    existingAgent?.openclaw_agent_id ??
    buildOpenClawRuntimeId({
      db,
      companyId: company.id,
      companyRuntimeSlug: company.runtime_slug?.trim() || slugify(company.name),
      agentId,
      agentRuntimeSlug,
      excludeAgentId: existingAgent?.id,
    });
  const openclawAgentId =
    existingAgent?.openclaw_agent_id ?? provisionOpenClawAgent(openclawRuntimeId, agentWorkspacePath, model);
  const avatarUrl = generateAgentAvatarDataUrl({
    name,
    role,
    personality,
    emoji,
    theme: {
      name: company.theme_name ?? "Corporate Noir",
      promptTemplate: company.theme_prompt_template ?? "dark premium portrait, cohesive team style",
      keywords: parseThemeKeywords(company.theme_keywords_json),
    },
  });

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
           model = ?,
           status = ?,
           openclaw_agent_id = ?,
           reporting_to = ?,
           updated_at = ?
       WHERE id = ?`
    ).run(
        resolvedProjectId,
        agentSlug,
        agentRuntimeSlug,
        emoji,
        role,
      personality,
      avatarUrl,
      model,
      input.initialStatus,
      openclawAgentId,
      reportingToId,
      now,
      agentId,
    );
  } else {
    db.prepare(
      `INSERT INTO agents
        (id, company_id, project_id, name, slug, runtime_slug, emoji, role, personality, avatar_url, model, status, openclaw_agent_id, reporting_to, skills_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?)`
    ).run(
      agentId,
      company.id,
      resolvedProjectId,
      name,
      agentSlug,
      agentRuntimeSlug,
      emoji,
      role,
      personality,
      avatarUrl,
      model,
      input.initialStatus,
      openclawAgentId,
      reportingToId,
      now,
      now,
    );
  }

  writeAgentInstructionFiles({
    agentWorkspacePath,
    companyName: company.name,
    name,
    role,
    reportsTo: reportsToName,
    emoji,
    personality,
    mission,
  });

  // Idempotent scaffold of ~/.openclaw/agents/{openclawAgentId}/ so agent.json
  // and SOUL.md exist whenever the row has an openclaw_agent_id — including
  // the re-provision case where the CLI was skipped because the ID already
  // existed in the row. Failure here is non-fatal: row + workspace are fine.
  if (openclawAgentId) {
    try {
      ensureOpenClawAgentScaffold({
        openclawAgentId,
        name,
        role,
        personality,
        projectName: project.name,
        projectSlug: project.slug,
        model,
        skills: [],
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[company-agent-provisioning] openclaw scaffold failed for "${openclawAgentId}": ${message}`,
      );
    }
  }

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
