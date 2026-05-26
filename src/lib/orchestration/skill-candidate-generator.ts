import { OrchestrationApiError } from "@/lib/orchestration/api";
import {
  createCompanySkill,
  type CompanySkill,
  type CompanySkillScope,
} from "@/lib/orchestration/company-skills";
import { resolveCompanyIdBySlug } from "@/lib/orchestration/company-service";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import type { CompanyMemoryKind } from "@/lib/orchestration/company-memory";

const CANDIDATE_VERSION = "skill-candidate-generator.v1";
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 250;
const DEFAULT_MIN_EVIDENCE = 2;

type MemoryEvidenceRow = {
  id: string;
  slug: string;
  title: string;
  body: string;
  kind: CompanyMemoryKind;
  scope: "company" | "project" | "agent";
  status: "draft" | "active" | "rejected" | "archived";
  source: "manual" | "task" | "run" | "extractor" | "imported";
  confidence: number;
  review_state: "not_requested" | "requested" | "approved" | "rejected";
  project_id: string | null;
  project_name: string | null;
  agent_id: string | null;
  agent_name: string | null;
  task_id: string | null;
  task_key: string | null;
  metadata_json: string;
  updated_at: string;
};

export type SkillCandidateInput = {
  limit?: number;
  minEvidence?: number;
  dryRun?: boolean;
  includeDraftEvidence?: boolean;
};

export type SkillCandidateDraft = {
  slug: string;
  name: string;
  description: string;
  scope: CompanySkillScope;
  confidence: number;
  topic: string;
  supportingMemoryIds: string[];
  supportingMemorySlugs: string[];
  supportingTaskKeys: string[];
  metadata: Record<string, unknown>;
};

export type SkillCandidateSkipped = {
  topic: string;
  reason: "insufficient_evidence" | "duplicate";
  evidenceCount: number;
  slug?: string;
};

export type SkillCandidateResult = {
  company: {
    id: string;
    slug: string;
    name: string;
    code: string | null;
  };
  dryRun: boolean;
  scannedMemoryCount: number;
  createdCount: number;
  skippedCount: number;
  candidates: SkillCandidateDraft[];
  skills: CompanySkill[];
  skipped: SkillCandidateSkipped[];
};

type TopicDefinition = {
  key: string;
  name: string;
  slug: string;
  scope: CompanySkillScope;
  keywords: RegExp[];
  trigger: string;
  steps: string[];
  validation: string[];
};

const TOPICS: TopicDefinition[] = [
  {
    key: "qa-verification",
    name: "QA Verification Workflow",
    slug: "qa-verification-workflow",
    scope: "project",
    keywords: [/\bqa\b/i, /\bverify|verification|validated?|accepted|review\b/i],
    trigger: "Use when a task needs independent verification before it is accepted or moved to Done.",
    steps: [
      "Read the task requirement, latest comments, and linked artifacts before judging the outcome.",
      "Run or inspect the smallest validation that proves the requirement is met.",
      "Post a concise review note with pass/fail status and evidence.",
      "If the work passes, move it to Done; if not, explain the blocker and route it back.",
    ],
    validation: ["The review note names the evidence used.", "Failed work remains actionable rather than silently accepted."],
  },
  {
    key: "failure-recovery",
    name: "Failure Recovery Workflow",
    slug: "failure-recovery-workflow",
    scope: "project",
    keywords: [
      /\b(failure|failed|blocked|rejected|regression|bug|retry|rework|correction)\b/i,
      /\b(fixed|resolved|corrected|prevent|guard|test added|follow-up|recovered)\b/i,
    ],
    trigger: "Use when a repeated failure or rework pattern needs a reusable prevention and recovery procedure.",
    steps: [
      "Identify the failed behavior, trigger, and visible symptom before changing the solution.",
      "Name the correction that resolved the issue and the validation that proved recovery.",
      "Add or update a guardrail, test, checklist item, or review note that would catch the issue next time.",
      "Record the prevention pattern in durable memory when it applies beyond one task.",
    ],
    validation: [
      "The failure symptom and correction are both named.",
      "The prevention step is concrete enough for a future agent to reuse.",
    ],
  },
  {
    key: "release-steward",
    name: "Release Steward Workflow",
    slug: "release-steward-workflow",
    scope: "project",
    keywords: [/\brelease|push|commit|git|diff|lint|tests?\b/i, /\brepo steward|steward\b/i],
    trigger: "Use before committing, pushing, or promoting code that should be clean and traceable.",
    steps: [
      "Inspect the working tree and separate unrelated changes from the release scope.",
      "Run focused tests and formatting checks for the touched files.",
      "Commit with a concise message and push only the intended branch or tag.",
      "Report verification commands, known residual risks, and the exact pushed checkpoint.",
    ],
    validation: ["`git diff --check` passes.", "The release notes name the commit or tag."],
  },
  {
    key: "repo-orientation",
    name: "Repo Orientation Workflow",
    slug: "repo-orientation-workflow",
    scope: "project",
    keywords: [/\brepo|repository|workspace|source workspace|codebase|architecture\b/i],
    trigger: "Use before making code changes in a repo that the agent has not recently inspected.",
    steps: [
      "Confirm the correct source workspace before editing.",
      "Inspect package scripts, app structure, and existing patterns.",
      "Find focused tests or verification commands before making changes.",
      "Summarize the relevant architecture before implementation.",
    ],
    validation: ["The task references the inspected workspace.", "The implementation follows existing local patterns."],
  },
  {
    key: "backend-implementation",
    name: "Backend Implementation Workflow",
    slug: "backend-implementation-workflow",
    scope: "project",
    keywords: [/\bbackend|api|route|database|schema|migration|server|sqlite|postgres\b/i],
    trigger: "Use for server-side, API, database, or orchestration behavior changes.",
    steps: [
      "Identify the data contract and persistence boundary before editing.",
      "Prefer existing service modules and structured DB/API helpers.",
      "Add focused tests around behavior and idempotency.",
      "Run focused server/API validation before handing off to QA.",
    ],
    validation: ["API behavior is covered by a focused test.", "Persistence changes are idempotent or migration-safe."],
  },
  {
    key: "frontend-implementation",
    name: "Frontend Implementation Workflow",
    slug: "frontend-implementation-workflow",
    scope: "project",
    keywords: [/\bfrontend|ui|ux|kanban|modal|button|layout|light mode|dark mode|browser\b/i],
    trigger: "Use for visible interface, layout, interaction, or browser-tested changes.",
    steps: [
      "Match the existing design system before adding new visual treatment.",
      "Verify the target interaction in the browser, including light and dark modes when relevant.",
      "Check that dynamic text and menus do not overflow or overlap.",
      "Run focused lint/tests for the touched UI files.",
    ],
    validation: ["Browser verification covers the changed interaction.", "The UI works in the active theme."],
  },
  {
    key: "task-breakdown-routing",
    name: "Task Breakdown And Routing Workflow",
    slug: "task-breakdown-and-routing-workflow",
    scope: "company",
    keywords: [/\btask breakdown|child tasks?|routing|handoff|assign|delegat|orchestrat\b/i],
    trigger: "Use when a larger directive needs scoped child tasks assigned to the right persistent agents.",
    steps: [
      "Split work into independently verifiable tasks with clear owners.",
      "Set dependencies so downstream validation waits on upstream work.",
      "Preserve the parent task execution engine and model lane unless there is a deliberate override.",
      "Keep the parent open until child tasks are complete or explicitly blocked.",
    ],
    validation: ["Every child task has an owner and expected outcome.", "Dependent tasks wait for prerequisites."],
  },
  {
    key: "legal-domain-review",
    name: "Legal Domain Review Workflow",
    slug: "legal-domain-review-workflow",
    scope: "project",
    keywords: [/\blegal|compliance|regulation|lending|borrower|loan agreement|disclosure\b/i],
    trigger: "Use for lending, compliance, legal language, or borrower-facing obligations.",
    steps: [
      "Separate legal-domain facts from implementation assumptions.",
      "Cite source material when legal or lending constraints are introduced.",
      "Flag uncertainty for human or specialist review instead of encoding it as policy.",
      "Keep approved legal constraints reusable as reviewed memory.",
    ],
    validation: ["Sensitive claims have source notes.", "Unverified legal assumptions are not promoted to active policy."],
  },
  {
    key: "financial-audit",
    name: "Financial Calculation Audit Workflow",
    slug: "financial-calculation-audit-workflow",
    scope: "project",
    keywords: [/\bfinancial|finance|calculation|interest|payment|amortization|fee|audit\b/i],
    trigger: "Use for loan math, financial outputs, agreement values, or cost/fee calculations.",
    steps: [
      "Identify every input, formula, rounding rule, and output field.",
      "Check edge cases and representative loan scenarios.",
      "Compare displayed values against the persisted source of truth.",
      "Record calculation assumptions for future audits.",
    ],
    validation: ["At least one representative calculation is checked end to end.", "Rounding and units are explicit."],
  },
];

function parseMetadata(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function clampLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit ?? NaN)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit as number)));
}

function clampMinEvidence(value: number | undefined): number {
  if (!Number.isFinite(value ?? NaN)) return DEFAULT_MIN_EVIDENCE;
  return Math.max(2, Math.floor(value as number));
}

function normalizeText(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function evidenceText(evidence: MemoryEvidenceRow): string {
  return normalizeText(`${evidence.title} ${evidence.body}`);
}

function topicForEvidence(evidence: MemoryEvidenceRow): TopicDefinition | null {
  const metadata = parseMetadata(evidence.metadata_json);
  const explicitTopic = typeof metadata.skillCandidateTopic === "string"
    ? metadata.skillCandidateTopic.trim().toLowerCase()
    : "";
  const explicit = explicitTopic
    ? TOPICS.find((topic) => topic.key === explicitTopic || topic.slug === explicitTopic)
    : undefined;
  if (explicit) return explicit;

  const text = evidenceText(evidence);
  if (!text) return null;
  if (
    /\b(failure|failed|blocked|rejected|regression|bug|retry|rework|correction)\b/i.test(text) &&
    /\b(fixed|resolved|corrected|prevent|guard|test added|follow-up|recovered)\b/i.test(text)
  ) {
    return TOPICS.find((topic) => topic.key === "failure-recovery") ?? null;
  }
  if (/\brelease|push|commit|git|diff|repo steward|steward\b/i.test(text)) {
    return TOPICS.find((topic) => topic.key === "release-steward") ?? null;
  }
  return TOPICS.find((topic) => topic.keywords.some((keyword) => keyword.test(text))) ?? null;
}

function listSkillEvidence(companyId: string, input: SkillCandidateInput): MemoryEvidenceRow[] {
  const db = getOrchestrationDb();
  const where = [
    "cmr.company_id = ?",
    "cmr.archived_at IS NULL",
    "cmr.status != 'archived'",
    "cmr.kind IN ('workflow_note', 'skill_evidence', 'decision', 'preference', 'architecture', 'domain_constraint')",
  ];
  const params: unknown[] = [companyId];

  if (!input.includeDraftEvidence) {
    where.push("cmr.status = 'active'");
    where.push("(cmr.review_required = 0 OR cmr.review_state = 'approved')");
  }

  return db
    .prepare(
      `SELECT
         cmr.id,
         cmr.slug,
         cmr.title,
         cmr.body,
         cmr.kind,
         cmr.scope,
         cmr.status,
         cmr.source,
         cmr.confidence,
         cmr.review_state,
         cmr.project_id,
         p.name AS project_name,
         cmr.agent_id,
         a.name AS agent_name,
         cmr.task_id,
         t.task_key,
         cmr.metadata_json,
         cmr.updated_at
       FROM company_memory_records cmr
       LEFT JOIN projects p ON p.id = cmr.project_id
       LEFT JOIN agents a ON a.id = cmr.agent_id
       LEFT JOIN tasks t ON t.id = cmr.task_id
       WHERE ${where.join(" AND ")}
       ORDER BY cmr.updated_at DESC
       LIMIT ?`,
    )
    .all(...params, clampLimit(input.limit)) as MemoryEvidenceRow[];
}

function hasExistingSkill(companyId: string, slug: string): boolean {
  const row = getOrchestrationDb()
    .prepare("SELECT 1 AS found FROM company_skills WHERE company_id = ? AND slug = ? LIMIT 1")
    .get(companyId, slug) as { found: number } | undefined;
  return Boolean(row);
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())).map((value) => value.trim()))];
}

function evidenceExcerpt(row: MemoryEvidenceRow): string {
  const taskPrefix = row.task_key ? `${row.task_key}: ` : "";
  const text = normalizeText(row.body || row.title);
  return `${taskPrefix}${text.slice(0, 220)}`;
}

function buildCandidate(topic: TopicDefinition, evidence: MemoryEvidenceRow[]): SkillCandidateDraft {
  const supportingMemoryIds = evidence.map((row) => row.id);
  const supportingMemorySlugs = evidence.map((row) => row.slug);
  const supportingTaskKeys = uniqueStrings(evidence.map((row) => row.task_key));
  const kinds = uniqueStrings(evidence.map((row) => row.kind));
  const projects = uniqueStrings(evidence.map((row) => row.project_name));
  const agents = uniqueStrings(evidence.map((row) => row.agent_name));
  const averageConfidence =
    evidence.reduce((sum, row) => sum + Number(row.confidence ?? 0), 0) / Math.max(1, evidence.length);
  const confidence = Math.min(0.9, Math.max(0.55, Number(averageConfidence.toFixed(2))));

  const description = [
    topic.trigger,
    "",
    "## Steps",
    ...topic.steps.map((step, index) => `${index + 1}. ${step}`),
    "",
    "## Validation",
    ...topic.validation.map((rule) => `- ${rule}`),
    "",
    "## Supporting Evidence",
    ...evidence.slice(0, 5).map((row) => `- ${evidenceExcerpt(row)}`),
  ].join("\n");

  return {
    slug: topic.slug,
    name: topic.name,
    description,
    scope: topic.scope,
    confidence,
    topic: topic.key,
    supportingMemoryIds,
    supportingMemorySlugs,
    supportingTaskKeys,
    metadata: {
      candidateVersion: CANDIDATE_VERSION,
      candidateTopic: topic.key,
      supportingMemoryIds,
      supportingMemorySlugs,
      supportingTaskKeys,
      evidenceKinds: kinds,
      projectNames: projects,
      agentNames: agents,
      evidenceCount: evidence.length,
      confidence,
      generatedAt: new Date().toISOString(),
    },
  };
}

export function generateCompanySkillCandidates(companyIdOrSlug: string, input: SkillCandidateInput = {}): SkillCandidateResult {
  const db = getOrchestrationDb();
  const company = resolveCompanyIdBySlug(companyIdOrSlug, db);
  if (!company) {
    throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  }

  const minEvidence = clampMinEvidence(input.minEvidence);
  const evidence = listSkillEvidence(company.id, input);
  const byTopic = new Map<string, { topic: TopicDefinition; evidence: MemoryEvidenceRow[] }>();
  const skipped: SkillCandidateSkipped[] = [];

  for (const row of evidence) {
    const topic = topicForEvidence(row);
    if (!topic) continue;
    const current = byTopic.get(topic.key) ?? { topic, evidence: [] };
    current.evidence.push(row);
    byTopic.set(topic.key, current);
  }

  const candidates: SkillCandidateDraft[] = [];
  const skills: CompanySkill[] = [];

  for (const group of byTopic.values()) {
    if (group.evidence.length < minEvidence) {
      skipped.push({
        topic: group.topic.key,
        reason: "insufficient_evidence",
        evidenceCount: group.evidence.length,
      });
      continue;
    }

    const candidate = buildCandidate(group.topic, group.evidence);
    if (hasExistingSkill(company.id, candidate.slug)) {
      skipped.push({
        topic: candidate.topic,
        reason: "duplicate",
        evidenceCount: group.evidence.length,
        slug: candidate.slug,
      });
      continue;
    }

    candidates.push(candidate);
    if (!input.dryRun) {
      const created = createCompanySkill(company.id, {
        name: candidate.name,
        slug: candidate.slug,
        description: candidate.description,
        source: "learned",
        scope: candidate.scope,
        status: "draft",
        reviewRequired: true,
        reviewState: "requested",
        metadata: candidate.metadata,
      });
      skills.push(created.skill);
    }
  }

  return {
    company: {
      id: company.id,
      slug: company.slug,
      name: company.name,
      code: company.company_code,
    },
    dryRun: input.dryRun === true,
    scannedMemoryCount: evidence.length,
    createdCount: skills.length,
    skippedCount: skipped.length,
    candidates,
    skills,
    skipped,
  };
}
