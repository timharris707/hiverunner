import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";

import { OrchestrationApiError } from "@/lib/orchestration/api";
import { syncAgentCoreFiles } from "@/lib/orchestration/agent-core-files";
import { resolveCompanyIdBySlug } from "@/lib/orchestration/company-service";
import { getOrchestrationDb } from "@/lib/orchestration/db";

export type CompanySkillStatus = "draft" | "active" | "archived";
export type CompanySkillSource = "manual" | "seed" | "learned" | "imported";
export type CompanySkillScope = "company" | "project" | "agent";
export type CompanySkillReviewState = "not_requested" | "requested" | "approved" | "rejected";
export type AgentSkillAssignmentStatus = "draft" | "active" | "archived";

export type CompanySkill = {
  id: string;
  companyId: string;
  slug: string;
  name: string;
  description: string;
  status: CompanySkillStatus;
  version: number;
  source: CompanySkillSource;
  scope: CompanySkillScope;
  ownerAgentId: string | null;
  ownerAgentName: string | null;
  reviewRequired: boolean;
  reviewState: CompanySkillReviewState;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  assignedAgentCount: number;
  assignedAgentNames: string[];
};

type CompanySkillRow = {
  id: string;
  company_id: string;
  slug: string;
  name: string;
  description: string;
  status: CompanySkillStatus;
  version: number;
  source: CompanySkillSource;
  scope: CompanySkillScope;
  owner_agent_id: string | null;
  owner_agent_name: string | null;
  review_required: number;
  review_state: CompanySkillReviewState;
  metadata_json: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  assigned_agent_count: number | null;
  assigned_agent_names: string | null;
};

export type AgentSkillAssignment = {
  id: string;
  companyId: string;
  agentId: string;
  agentName: string;
  skillId: string;
  skillSlug: string;
  skillName: string;
  status: AgentSkillAssignmentStatus;
  source: CompanySkillSource;
  assignedByAgentId: string | null;
  assignedByAgentName: string | null;
  notes: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type RuntimeAgentSkill = {
  id: string;
  slug: string;
  name: string;
  description: string;
  version: number;
  scope: CompanySkillScope;
  source: CompanySkillSource;
  assignmentId: string;
  assignmentSource: CompanySkillSource;
  assignmentNotes: string;
};

type AgentSkillAssignmentRow = {
  id: string;
  company_id: string;
  agent_id: string;
  agent_name: string;
  skill_id: string;
  skill_slug: string;
  skill_name: string;
  status: AgentSkillAssignmentStatus;
  source: CompanySkillSource;
  assigned_by_agent_id: string | null;
  assigned_by_agent_name: string | null;
  notes: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

type RuntimeAgentSkillRow = {
  id: string;
  slug: string;
  name: string;
  description: string;
  version: number;
  scope: CompanySkillScope;
  source: CompanySkillSource;
  assignment_id: string;
  assignment_source: CompanySkillSource;
  assignment_notes: string;
};

const SKILL_EXPORT_WORKFLOWS: Record<string, string[]> = {
  "loanmeld-repo-orientation": [
    "Inspect the current task, target project, and source workspace before editing.",
    "Check git status before changing files.",
    "Prefer existing project architecture, package scripts, and test conventions.",
    "Record exact verification and any workspace cleanliness caveats in the final handoff.",
  ],
  "backend-implementation-workflow": [
    "Find existing API, service, and database patterns before adding new ones.",
    "Keep contract changes explicit and update tests for changed behavior.",
    "Check permissions, validation, error states, and downstream callers.",
    "Hand off to QA with files changed, tests run, and residual risk.",
  ],
  "frontend-implementation-workflow": [
    "Match the existing design system and interaction patterns.",
    "Verify responsive layout, light and dark mode, text fit, and accessible controls.",
    "Avoid UI overlap and layout shift in dense task or dashboard surfaces.",
    "Run browser checks when the changed behavior is visible.",
  ],
  "integration-api-workflow": [
    "Identify provider assumptions, credentials, webhook semantics, retry behavior, and idempotency needs.",
    "Make external failure modes visible to operators.",
    "Prefer small contract tests around API mapping and edge cases.",
    "Escalate missing credentials or unverifiable provider behavior.",
  ],
  "qa-verification-checklist": [
    "Restate acceptance criteria before testing.",
    "Run focused checks first, then broader checks when risk justifies it.",
    "Classify the result as pass, fail, blocked, or partial with evidence.",
    "Send failures back to the original owner with reproduction and expected fix.",
  ],
  "playwright-video-verification": [
    "Use Playwright when browser behavior, visual state, navigation, forms, or end-to-end flows need direct evidence.",
    "Prefer the project's existing Playwright scripts and config before adding new commands.",
    "When video evidence is useful, run Playwright with video enabled or an explicit browser/session recording command and store the artifact path in the task.",
    "Keep recordings focused on the acceptance path; avoid recording unrelated personal or credentialed pages.",
    "Report route coverage, browser/device used, pass/fail result, console errors, and the video/artifact location.",
  ],
  "repo-steward-release-checklist": [
    "Inspect git status and staged scope before release work.",
    "Run appropriate checks and keep unrelated changes out of commits.",
    "Commit only after QA evidence or explicit operator/lead override.",
    "Record commit, tests, known gaps, and push/promotion status.",
  ],
  "lending-legal-research-memo": [
    "Flag jurisdiction, licensing, disclosure, consumer protection, and compliance uncertainty.",
    "Separate product recommendation from legal-risk caveat.",
    "Use source-backed notes when facts may have changed.",
    "Require attorney review for high-stakes legal conclusions.",
  ],
  "financial-calculation-audit": [
    "Identify formulas, source values, rounding rules, and edge cases.",
    "Check payment, payoff, fee, rate, and reporting calculations against expected outcomes.",
    "Require tests for calculation contracts before completion.",
    "Escalate unclear assumptions before marking financial work Done.",
  ],
  "ux-product-acceptance-review": [
    "Evaluate the full workflow, not only one screen.",
    "Name the user role, friction, expected behavior, and acceptance gap.",
    "Prefer concrete changes over taste commentary.",
    "Route implementation follow-ups to the correct owner.",
  ],
  "task-breakdown-and-routing-workflow": [
    "Convert goals into small HiveRunner tasks with clear acceptance criteria.",
    "Assign to the narrowest qualified specialist.",
    "Define QA, release, legal, financial, research, or UX review needs up front.",
    "Use child tasks when work splits across specialties.",
  ],
  "research-workflow": [
    "Use current sources when facts may have changed.",
    "Keep citations with the finding they support.",
    "Separate verified facts, inference, and recommendation.",
    "Create follow-up tasks for unresolved research risks.",
  ],
  "writing-content-workflow": [
    "Write concise user/operator-facing copy matched to the product surface.",
    "Avoid unsupported claims and route legal/financial claims for review.",
    "Keep docs actionable and scannable.",
    "Preserve final approved language in the relevant project or company memory.",
  ],
};

function normalizeSlug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "skill";
}

function parseMetadata(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function assertChoice<T extends string>(
  value: unknown,
  choices: readonly T[],
  fallback: T,
  field: string,
): T {
  const normalized = String(value ?? fallback).trim().toLowerCase();
  if (choices.includes(normalized as T)) return normalized as T;
  throw new OrchestrationApiError(400, "invalid_field", `Invalid ${field}`);
}

function serializeMetadata(value: unknown): string {
  if (value === undefined) return "{}";
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new OrchestrationApiError(400, "invalid_metadata", "metadata must be an object");
  }
  return JSON.stringify(value);
}

function normalizeMetadata(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new OrchestrationApiError(400, "invalid_metadata", "metadata must be an object");
  }
  return value as Record<string, unknown>;
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function skillExportDescription(skill: CompanySkill): string {
  const description = skill.description.trim();
  if (description && !description.startsWith("Seed skill for project-specific work:")) return description;
  return `Use when a HiveRunner, external runner, or Codex agent is assigned ${skill.name} work for a project workspace.`;
}

function skillRuntimeBody(skill: CompanySkill): string | null {
  const raw = skill.metadata.runtimeSkillBody;
  if (typeof raw !== "string" || !raw.trim()) return null;
  return raw.trim().replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
}

function renderSkillExport(skill: CompanySkill): string {
  const workflow = SKILL_EXPORT_WORKFLOWS[skill.slug] ?? [
    "Read the assigned HiveRunner task and relevant project context.",
    "Apply this skill only when it directly helps complete the task.",
    "Keep task instructions and company policy higher priority than this skill.",
    "Record useful evidence and hand off cleanly.",
  ];

  return [
    "---",
    `name: ${skill.slug}`,
    `description: ${yamlString(skillExportDescription(skill))}`,
    "metadata:",
    `  display_name: ${yamlString(skill.name)}`,
    "  source: hiverunner-company-skill",
    `  company: ${yamlString(skill.companyId)}`,
    `  version: ${skill.version}`,
    "---",
    "",
    skillRuntimeBody(skill) ?? [
      `# ${skill.name}`,
      "",
      `Use this skill when the assigned HiveRunner task calls for ${skill.name.toLowerCase()} within a project workspace. HiveRunner task instructions, project policy, and current operator direction stay higher priority than this skill.`,
      "",
      "## Workflow",
      ...workflow.map((step) => `- ${step}`),
      "",
      "## Output Standard",
      "- Post concise operator-facing evidence in the task.",
      "- Name verification performed or blocked.",
      "- Create follow-up tasks when the work reveals separate implementation, QA, legal, financial, release, research, or UX work.",
    ].join("\n"),
    "",
    `## HiveRunner Tracking`,
    `- If this skill materially affected the run, emit the HiveRunner \`use_skill\` action with slug \`${skill.slug}\`.`,
    "",
  ].join("\n");
}

function removeSkillExportFolder(companyWorkspaceRoot: string | null, slug: string): string | null {
  if (!companyWorkspaceRoot?.trim()) return null;
  const exportDir = path.join(path.resolve(companyWorkspaceRoot), "skills", slug);
  fs.rmSync(exportDir, { recursive: true, force: true });
  return path.join(exportDir, "SKILL.md");
}

function syncCompanySkillExport(db: ReturnType<typeof getOrchestrationDb>, skill: CompanySkill): void {
  const row = db
    .prepare("SELECT workspace_root FROM companies WHERE id = ? LIMIT 1")
    .get(skill.companyId) as { workspace_root: string | null } | undefined;
  const companyWorkspaceRoot = row?.workspace_root?.trim() || null;
  const shouldExport = skill.status === "active" && (!skill.reviewRequired || skill.reviewState === "approved");
  const metadata = { ...skill.metadata };
  const existingExport = typeof metadata.runtimeExport === "object" && metadata.runtimeExport !== null && !Array.isArray(metadata.runtimeExport)
    ? metadata.runtimeExport as Record<string, unknown>
    : {};

  if (!shouldExport) {
    const removedPath = removeSkillExportFolder(companyWorkspaceRoot, skill.slug);
    metadata.runtimeExport = {
      ...existingExport,
      exported: false,
      status: skill.status === "archived" ? "archived" : "not_runtime_eligible",
      path: removedPath ?? existingExport.path ?? null,
      syncedAt: new Date().toISOString(),
      version: skill.version,
    };
  } else if (!companyWorkspaceRoot) {
    metadata.runtimeExport = {
      ...existingExport,
      exported: false,
      status: "workspace_unavailable",
      path: null,
      syncedAt: new Date().toISOString(),
      version: skill.version,
    };
  } else {
    const exportDir = path.join(path.resolve(companyWorkspaceRoot), "skills", skill.slug);
    const exportPath = path.join(exportDir, "SKILL.md");
    fs.mkdirSync(exportDir, { recursive: true });
    fs.writeFileSync(exportPath, renderSkillExport(skill));
    metadata.runtimeExport = {
      ...existingExport,
      exported: true,
      status: "exported",
      path: exportPath,
      syncedAt: new Date().toISOString(),
      version: skill.version,
    };
  }

  db.prepare(
    `UPDATE company_skills
     SET metadata_json = ?,
         updated_at = updated_at
     WHERE company_id = ?
       AND id = ?`,
  ).run(JSON.stringify(metadata), skill.companyId, skill.id);
}

export function syncCompanySkillExports(companyIdOrSlug: string): {
  company: { id: string; slug: string; name: string };
  skills: Array<{
    id: string;
    slug: string;
    status: CompanySkillStatus;
    reviewState: CompanySkillReviewState;
    runtimeExport: unknown;
  }>;
} {
  const company = resolveCompany(companyIdOrSlug);
  const db = getOrchestrationDb();
  const { skills } = listCompanySkills(company.id, { includeArchived: true });

  for (const skill of skills) {
    syncCompanySkillExport(db, skill);
  }

  return {
    company,
    skills: skills.map((skill) => {
      const updated = getCompanySkillById(company.id, skill.id);
      return {
        id: updated.id,
        slug: updated.slug,
        status: updated.status,
        reviewState: updated.reviewState,
        runtimeExport: updated.metadata.runtimeExport,
      };
    }),
  };
}

function resolveCompany(companyIdOrSlug: string) {
  const db = getOrchestrationDb();
  const resolved = resolveCompanyIdBySlug(companyIdOrSlug, db);
  if (!resolved) {
    throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  }
  return resolved;
}

function mapCompanySkill(row: CompanySkillRow): CompanySkill {
  return {
    id: row.id,
    companyId: row.company_id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    status: row.status,
    version: Number(row.version),
    source: row.source,
    scope: row.scope,
    ownerAgentId: row.owner_agent_id,
    ownerAgentName: row.owner_agent_name,
    reviewRequired: row.review_required === 1,
    reviewState: row.review_state,
    metadata: parseMetadata(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
    assignedAgentCount: Number(row.assigned_agent_count ?? 0),
    assignedAgentNames: row.assigned_agent_names
      ? row.assigned_agent_names.split("|||").map((name) => name.trim()).filter(Boolean)
      : [],
  };
}

function skillSelectSql(): string {
  return `
    SELECT
      cs.id,
      cs.company_id,
      cs.slug,
      cs.name,
      cs.description,
      cs.status,
      cs.version,
      cs.source,
      cs.scope,
      cs.owner_agent_id,
      a.name AS owner_agent_name,
      cs.review_required,
      cs.review_state,
      cs.metadata_json,
      cs.created_at,
      cs.updated_at,
      cs.archived_at,
      (
        SELECT COUNT(*)
        FROM agent_skill_assignments asa
        WHERE asa.skill_id = cs.id
          AND asa.archived_at IS NULL
          AND asa.status != 'archived'
      ) AS assigned_agent_count,
      (
        SELECT GROUP_CONCAT(a2.name, '|||')
        FROM agent_skill_assignments asa2
        JOIN agents a2 ON a2.id = asa2.agent_id
        WHERE asa2.skill_id = cs.id
          AND asa2.archived_at IS NULL
          AND asa2.status != 'archived'
      ) AS assigned_agent_names
    FROM company_skills cs
    LEFT JOIN agents a ON a.id = cs.owner_agent_id
  `;
}

function assignmentSelectSql(): string {
  return `
    SELECT
      asa.id,
      asa.company_id,
      asa.agent_id,
      ag.name AS agent_name,
      asa.skill_id,
      cs.slug AS skill_slug,
      cs.name AS skill_name,
      asa.status,
      asa.source,
      asa.assigned_by_agent_id,
      assigned_by.name AS assigned_by_agent_name,
      asa.notes,
      asa.metadata_json,
      asa.created_at,
      asa.updated_at,
      asa.archived_at
    FROM agent_skill_assignments asa
    JOIN agents ag ON ag.id = asa.agent_id
    JOIN company_skills cs ON cs.id = asa.skill_id
    LEFT JOIN agents assigned_by ON assigned_by.id = asa.assigned_by_agent_id
  `;
}

function mapAssignment(row: AgentSkillAssignmentRow): AgentSkillAssignment {
  return {
    id: row.id,
    companyId: row.company_id,
    agentId: row.agent_id,
    agentName: row.agent_name,
    skillId: row.skill_id,
    skillSlug: row.skill_slug,
    skillName: row.skill_name,
    status: row.status,
    source: row.source,
    assignedByAgentId: row.assigned_by_agent_id,
    assignedByAgentName: row.assigned_by_agent_name,
    notes: row.notes,
    metadata: parseMetadata(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}

function resolveCompanyAgent(companyId: string, agentIdOrSlugOrName: string): { id: string; name: string } {
  const db = getOrchestrationDb();
  const row = db
    .prepare(
      `SELECT id, name
       FROM agents
       WHERE company_id = ?
         AND archived_at IS NULL
         AND (id = ? OR slug = ? OR lower(name) = lower(?) OR openclaw_agent_id = ?)
       LIMIT 1`
    )
    .get(companyId, agentIdOrSlugOrName, agentIdOrSlugOrName, agentIdOrSlugOrName, agentIdOrSlugOrName) as { id: string; name: string } | undefined;

  if (!row) {
    throw new OrchestrationApiError(404, "agent_not_found", "Agent not found in this company");
  }
  return row;
}

function assertRuntimeEligibleSkill(skill: CompanySkill, targetStatus: AgentSkillAssignmentStatus): void {
  if (targetStatus !== "active") return;
  if (skill.status !== "active") {
    throw new OrchestrationApiError(400, "skill_not_active", "Only active company skills can be activated for an agent");
  }
  if (skill.reviewRequired && skill.reviewState !== "approved") {
    throw new OrchestrationApiError(400, "skill_review_required", "Skill must be approved before it can be activated for runtime use");
  }
}

function uniqueSkillSlug(companyId: string, baseSlug: string): string {
  const db = getOrchestrationDb();
  const existing = db
    .prepare("SELECT slug FROM company_skills WHERE company_id = ? AND slug LIKE ?")
    .all(companyId, `${baseSlug}%`) as Array<{ slug: string }>;
  const used = new Set(existing.map((row) => row.slug));
  if (!used.has(baseSlug)) return baseSlug;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${baseSlug}-${index}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${baseSlug}-${Date.now()}`;
}

export function listCompanySkills(companyIdOrSlug: string, input?: {
  includeArchived?: boolean;
  status?: CompanySkillStatus | "all";
}): { company: { id: string; slug: string; name: string }; skills: CompanySkill[] } {
  const company = resolveCompany(companyIdOrSlug);
  const db = getOrchestrationDb();
  const where = ["cs.company_id = ?"];
  const params: unknown[] = [company.id];

  if (!input?.includeArchived) {
    where.push("cs.archived_at IS NULL");
  }
  if (input?.status && input.status !== "all") {
    where.push("cs.status = ?");
    params.push(input.status);
  }

  const rows = db
    .prepare(
      `${skillSelectSql()}
       WHERE ${where.join(" AND ")}
       ORDER BY
         CASE cs.status WHEN 'draft' THEN 0 WHEN 'active' THEN 1 ELSE 2 END,
         cs.updated_at DESC,
         cs.name ASC`
    )
    .all(...params) as CompanySkillRow[];

  return {
    company,
    skills: rows.map(mapCompanySkill),
  };
}

export function createCompanySkill(companyIdOrSlug: string, input: {
  name: string;
  description?: string;
  slug?: string;
  status?: CompanySkillStatus;
  source?: CompanySkillSource;
  scope?: CompanySkillScope;
  ownerAgentId?: string | null;
  reviewRequired?: boolean;
  reviewState?: CompanySkillReviewState;
  metadata?: Record<string, unknown>;
}): { company: { id: string; slug: string; name: string }; skill: CompanySkill } {
  const company = resolveCompany(companyIdOrSlug);
  const db = getOrchestrationDb();
  const name = input.name.trim();
  if (!name) {
    throw new OrchestrationApiError(400, "missing_name", "Skill name is required");
  }

  const status = assertChoice(input.status, ["draft", "active", "archived"], "draft", "status");
  const source = assertChoice(input.source, ["manual", "seed", "learned", "imported"], "manual", "source");
  const scope = assertChoice(input.scope, ["company", "project", "agent"], "company", "scope");
  const reviewState = assertChoice(
    input.reviewState,
    ["not_requested", "requested", "approved", "rejected"],
    "not_requested",
    "reviewState",
  );
  const id = randomUUID();
  const slug = uniqueSkillSlug(company.id, normalizeSlug(input.slug || name));
  const now = new Date().toISOString();
  const archivedAt = status === "archived" ? now : null;

  db.prepare(
    `INSERT INTO company_skills (
       id, company_id, slug, name, description, status, version, source, scope,
       owner_agent_id, review_required, review_state, metadata_json, created_at, updated_at, archived_at
     )
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    company.id,
    slug,
    name,
    input.description?.trim() ?? "",
    status,
    source,
    scope,
    input.ownerAgentId || null,
    input.reviewRequired === false ? 0 : 1,
    reviewState,
    serializeMetadata(input.metadata),
    now,
    now,
    archivedAt,
  );

  const skill = getCompanySkillById(company.id, id);
  syncCompanySkillExport(db, skill);
  return { company, skill: getCompanySkillById(company.id, id) };
}

export function updateCompanySkill(companyIdOrSlug: string, skillIdOrSlug: string, input: {
  name?: string;
  description?: string;
  status?: CompanySkillStatus;
  source?: CompanySkillSource;
  scope?: CompanySkillScope;
  ownerAgentId?: string | null;
  reviewRequired?: boolean;
  reviewState?: CompanySkillReviewState;
  metadata?: Record<string, unknown>;
  bumpVersion?: boolean;
  replacementSkillId?: string | null;
  deprecationReason?: string;
}): { company: { id: string; slug: string; name: string }; skill: CompanySkill } {
  const company = resolveCompany(companyIdOrSlug);
  const db = getOrchestrationDb();
  const current = getCompanySkillById(company.id, skillIdOrSlug);
  const nextStatus = input.status
    ? assertChoice(input.status, ["draft", "active", "archived"], current.status, "status")
    : current.status;
  const nextReviewRequired = input.reviewRequired === undefined
    ? current.reviewRequired
    : input.reviewRequired;
  const nextReviewState = input.reviewState
    ? assertChoice(
        input.reviewState,
        ["not_requested", "requested", "approved", "rejected"],
        current.reviewState,
        "reviewState",
      )
    : current.reviewState;
  if (nextStatus === "active" && nextReviewRequired && nextReviewState !== "approved") {
    throw new OrchestrationApiError(400, "skill_review_required", "Skill must be approved before it can become active");
  }
  const archivedAt = nextStatus === "archived"
    ? current.archivedAt ?? new Date().toISOString()
    : null;
  const nextMetadata = input.metadata === undefined
    ? { ...current.metadata }
    : { ...normalizeMetadata(input.metadata) };
  let replacementSkill: CompanySkill | null = null;
  if (input.replacementSkillId) {
    replacementSkill = getCompanySkillById(company.id, input.replacementSkillId);
    if (replacementSkill.id === current.id) {
      throw new OrchestrationApiError(400, "replacement_invalid", "Replacement skill must differ from the archived skill");
    }
  }
  if (nextStatus === "archived") {
    const existingDeprecation = typeof nextMetadata.deprecation === "object" && nextMetadata.deprecation !== null && !Array.isArray(nextMetadata.deprecation)
      ? nextMetadata.deprecation as Record<string, unknown>
      : {};
    nextMetadata.deprecation = {
      ...existingDeprecation,
      archivedAt,
      replacementSkillId: input.replacementSkillId === null
        ? null
        : replacementSkill?.id ?? existingDeprecation.replacementSkillId ?? null,
      replacementSkillSlug: input.replacementSkillId === null
        ? null
        : replacementSkill?.slug ?? existingDeprecation.replacementSkillSlug ?? null,
      replacementSkillName: input.replacementSkillId === null
        ? null
        : replacementSkill?.name ?? existingDeprecation.replacementSkillName ?? null,
      reason: input.deprecationReason?.trim() || existingDeprecation.reason || "Archived by operator or reviewer.",
    };
  }

  db.prepare(
    `UPDATE company_skills
     SET name = ?,
         description = ?,
         status = ?,
         version = version + ?,
         source = ?,
         scope = ?,
         owner_agent_id = ?,
         review_required = ?,
         review_state = ?,
         metadata_json = ?,
         archived_at = ?,
         updated_at = ?
     WHERE company_id = ?
       AND id = ?`
  ).run(
    input.name?.trim() || current.name,
    input.description !== undefined ? input.description.trim() : current.description,
    nextStatus,
    input.bumpVersion === false ? 0 : 1,
    input.source
      ? assertChoice(input.source, ["manual", "seed", "learned", "imported"], current.source, "source")
      : current.source,
    input.scope
      ? assertChoice(input.scope, ["company", "project", "agent"], current.scope, "scope")
      : current.scope,
    input.ownerAgentId === undefined ? current.ownerAgentId : input.ownerAgentId || null,
    nextReviewRequired ? 1 : 0,
    nextReviewState,
    JSON.stringify(nextMetadata),
    archivedAt,
    new Date().toISOString(),
    company.id,
    current.id,
  );

  if (nextStatus === "archived") {
    const affectedAgents = db
      .prepare(
        `SELECT agent_id
         FROM agent_skill_assignments
         WHERE company_id = ?
           AND skill_id = ?
           AND archived_at IS NULL`,
      )
      .all(company.id, current.id) as Array<{ agent_id: string }>;
    db.prepare(
      `UPDATE agent_skill_assignments
       SET status = 'archived',
           archived_at = COALESCE(archived_at, ?),
           updated_at = ?
       WHERE company_id = ?
         AND skill_id = ?
         AND archived_at IS NULL`,
    ).run(archivedAt, new Date().toISOString(), company.id, current.id);
    for (const row of affectedAgents) {
      syncAgentCoreFiles(db, row.agent_id);
    }
  }

  const updatedSkill = getCompanySkillById(company.id, current.id);
  syncCompanySkillExport(db, updatedSkill);

  return { company, skill: getCompanySkillById(company.id, current.id) };
}

export function listAgentSkillAssignments(companyIdOrSlug: string, input?: {
  agentId?: string;
  skillId?: string;
  status?: AgentSkillAssignmentStatus | "all";
  includeArchived?: boolean;
}): { company: { id: string; slug: string; name: string }; assignments: AgentSkillAssignment[] } {
  const company = resolveCompany(companyIdOrSlug);
  const db = getOrchestrationDb();
  const where = ["asa.company_id = ?"];
  const params: unknown[] = [company.id];

  if (!input?.includeArchived) {
    where.push("asa.archived_at IS NULL");
  }
  if (input?.status && input.status !== "all") {
    where.push("asa.status = ?");
    params.push(input.status);
  }
  if (input?.agentId) {
    const agent = resolveCompanyAgent(company.id, input.agentId);
    where.push("asa.agent_id = ?");
    params.push(agent.id);
  }
  if (input?.skillId) {
    const skill = getCompanySkillById(company.id, input.skillId);
    where.push("asa.skill_id = ?");
    params.push(skill.id);
  }

  const rows = db
    .prepare(
      `${assignmentSelectSql()}
       WHERE ${where.join(" AND ")}
       ORDER BY
         CASE asa.status WHEN 'draft' THEN 0 WHEN 'active' THEN 1 ELSE 2 END,
         asa.updated_at DESC,
         ag.name ASC,
         cs.name ASC`
    )
    .all(...params) as AgentSkillAssignmentRow[];

  return { company, assignments: rows.map(mapAssignment) };
}

export function assignCompanySkillToAgent(companyIdOrSlug: string, input: {
  agentId: string;
  skillId: string;
  status?: AgentSkillAssignmentStatus;
  source?: CompanySkillSource;
  assignedByAgentId?: string | null;
  notes?: string;
  metadata?: Record<string, unknown>;
}): { company: { id: string; slug: string; name: string }; assignment: AgentSkillAssignment } {
  const company = resolveCompany(companyIdOrSlug);
  const db = getOrchestrationDb();
  const agent = resolveCompanyAgent(company.id, input.agentId);
  const skill = getCompanySkillById(company.id, input.skillId);
  const assignedBy = input.assignedByAgentId
    ? resolveCompanyAgent(company.id, input.assignedByAgentId)
    : null;
  const status = assertChoice(input.status, ["draft", "active", "archived"], "draft", "status");
  const source = assertChoice(input.source, ["manual", "seed", "learned", "imported"], "manual", "source");
  assertRuntimeEligibleSkill(skill, status);
  const now = new Date().toISOString();
  const archivedAt = status === "archived" ? now : null;

  const existing = db
    .prepare("SELECT id FROM agent_skill_assignments WHERE agent_id = ? AND skill_id = ? LIMIT 1")
    .get(agent.id, skill.id) as { id: string } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE agent_skill_assignments
       SET status = ?,
           source = ?,
           assigned_by_agent_id = ?,
           notes = ?,
           metadata_json = ?,
           archived_at = ?,
           updated_at = ?
       WHERE id = ?`
    ).run(
      status,
      source,
      assignedBy?.id ?? null,
      input.notes?.trim() ?? "",
      serializeMetadata(input.metadata),
      archivedAt,
      now,
      existing.id,
    );
    syncAgentCoreFiles(db, agent.id);
    return { company, assignment: getAgentSkillAssignment(company.id, existing.id) };
  }

  const id = randomUUID();
  db.prepare(
    `INSERT INTO agent_skill_assignments (
       id, company_id, agent_id, skill_id, status, source, assigned_by_agent_id,
       notes, metadata_json, created_at, updated_at, archived_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    company.id,
    agent.id,
    skill.id,
    status,
    source,
    assignedBy?.id ?? null,
    input.notes?.trim() ?? "",
    serializeMetadata(input.metadata),
    now,
    now,
    archivedAt,
  );

  syncAgentCoreFiles(db, agent.id);
  return { company, assignment: getAgentSkillAssignment(company.id, id) };
}

export function updateAgentSkillAssignment(companyIdOrSlug: string, assignmentId: string, input: {
  status?: AgentSkillAssignmentStatus;
  source?: CompanySkillSource;
  assignedByAgentId?: string | null;
  notes?: string;
  metadata?: Record<string, unknown>;
}): { company: { id: string; slug: string; name: string }; assignment: AgentSkillAssignment } {
  const company = resolveCompany(companyIdOrSlug);
  const current = getAgentSkillAssignment(company.id, assignmentId);
  const db = getOrchestrationDb();
  const nextStatus = input.status
    ? assertChoice(input.status, ["draft", "active", "archived"], current.status, "status")
    : current.status;
  const skill = getCompanySkillById(company.id, current.skillId);
  assertRuntimeEligibleSkill(skill, nextStatus);
  const assignedBy = input.assignedByAgentId === undefined
    ? { id: current.assignedByAgentId }
    : input.assignedByAgentId
      ? resolveCompanyAgent(company.id, input.assignedByAgentId)
      : { id: null };
  const archivedAt = nextStatus === "archived"
    ? current.archivedAt ?? new Date().toISOString()
    : null;

  db.prepare(
    `UPDATE agent_skill_assignments
     SET status = ?,
         source = ?,
         assigned_by_agent_id = ?,
         notes = ?,
         metadata_json = ?,
         archived_at = ?,
         updated_at = ?
     WHERE company_id = ?
       AND id = ?`
  ).run(
    nextStatus,
    input.source
      ? assertChoice(input.source, ["manual", "seed", "learned", "imported"], current.source, "source")
      : current.source,
    assignedBy.id,
    input.notes !== undefined ? input.notes.trim() : current.notes,
    input.metadata === undefined ? JSON.stringify(current.metadata) : serializeMetadata(input.metadata),
    archivedAt,
    new Date().toISOString(),
    company.id,
    current.id,
  );

  syncAgentCoreFiles(db, current.agentId);
  return { company, assignment: getAgentSkillAssignment(company.id, current.id) };
}

export function listRuntimeAgentSkills(companyIdOrSlug: string, agentIdOrSlugOrName: string): {
  company: { id: string; slug: string; name: string };
  agent: { id: string; name: string };
  skills: RuntimeAgentSkill[];
} {
  const company = resolveCompany(companyIdOrSlug);
  const agent = resolveCompanyAgent(company.id, agentIdOrSlugOrName);
  const db = getOrchestrationDb();
  const rows = db
    .prepare(
      `SELECT
         cs.id,
         cs.slug,
         cs.name,
         cs.description,
         cs.version,
         cs.scope,
         cs.source,
         asa.id AS assignment_id,
         asa.source AS assignment_source,
         asa.notes AS assignment_notes
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
    .all(company.id, agent.id) as RuntimeAgentSkillRow[];

  return {
    company,
    agent,
    skills: rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      version: Number(row.version),
      scope: row.scope,
      source: row.source,
      assignmentId: row.assignment_id,
      assignmentSource: row.assignment_source,
      assignmentNotes: row.assignment_notes,
    })),
  };
}

function getCompanySkillById(companyId: string, skillIdOrSlug: string): CompanySkill {
  const db = getOrchestrationDb();
  const row = db
    .prepare(
      `${skillSelectSql()}
       WHERE cs.company_id = ?
         AND (cs.id = ? OR cs.slug = ?)
       LIMIT 1`
    )
    .get(companyId, skillIdOrSlug, skillIdOrSlug) as CompanySkillRow | undefined;

  if (!row) {
    throw new OrchestrationApiError(404, "skill_not_found", "Company skill not found");
  }

  return mapCompanySkill(row);
}

function getAgentSkillAssignment(companyId: string, assignmentId: string): AgentSkillAssignment {
  const db = getOrchestrationDb();
  const row = db
    .prepare(
      `${assignmentSelectSql()}
       WHERE asa.company_id = ?
         AND asa.id = ?
       LIMIT 1`
    )
    .get(companyId, assignmentId) as AgentSkillAssignmentRow | undefined;

  if (!row) {
    throw new OrchestrationApiError(404, "assignment_not_found", "Agent skill assignment not found");
  }

  return mapAssignment(row);
}
