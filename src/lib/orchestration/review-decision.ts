import { OrchestrationApiError } from "@/lib/orchestration/api";
import {
  listCompanyMemoryRecords,
  updateCompanyMemoryRecord,
  type CompanyMemoryRecord,
} from "@/lib/orchestration/company-memory";
import {
  listCompanySkills,
  updateCompanySkill,
  type CompanySkill,
} from "@/lib/orchestration/company-skills";
import { resolveCompanyIdBySlug } from "@/lib/orchestration/company-service";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { syncAgentCoreFiles } from "@/lib/orchestration/agent-core-files";

export type ReviewDecisionTargetType = "memory" | "skill";
export type ReviewDecision = "approve" | "reject";

type ReviewerAgent = {
  id: string;
  name: string;
  role: string;
};

type ReviewRoutingMetadata = {
  reviewerAgentId?: unknown;
  reviewerAgentName?: unknown;
  rule?: unknown;
  reason?: unknown;
};

export type SubmitReviewDecisionInput = {
  targetType: ReviewDecisionTargetType;
  targetId: string;
  decision: ReviewDecision;
  reviewerAgentId: string;
  note?: string;
  confidence?: number;
  source?: "agent" | "operator" | "system";
};

export type SubmitReviewDecisionResult = {
  company: {
    id: string;
    slug: string;
    name: string;
    code: string | null;
  };
  reviewer: ReviewerAgent;
  targetType: ReviewDecisionTargetType;
  targetId: string;
  decision: ReviewDecision;
  memory?: CompanyMemoryRecord;
  skill?: CompanySkill;
};

function assertTargetType(value: unknown): ReviewDecisionTargetType {
  if (value === "memory" || value === "skill") return value;
  throw new OrchestrationApiError(400, "invalid_target_type", "targetType must be memory or skill");
}

function assertDecision(value: unknown): ReviewDecision {
  if (value === "approve" || value === "reject") return value;
  throw new OrchestrationApiError(400, "invalid_decision", "decision must be approve or reject");
}

function assertConfidence(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new OrchestrationApiError(400, "invalid_confidence", "confidence must be a number from 0 to 1");
  }
  return parsed;
}

function resolveReviewer(companyId: string, reviewerAgentId: string): ReviewerAgent {
  const reviewer = getOrchestrationDb()
    .prepare(
      `SELECT id, name, role
       FROM agents
       WHERE company_id = ?
         AND archived_at IS NULL
         AND (id = ? OR slug = ? OR lower(name) = lower(?))
       LIMIT 1`,
    )
    .get(companyId, reviewerAgentId, reviewerAgentId, reviewerAgentId) as ReviewerAgent | undefined;
  if (!reviewer) {
    throw new OrchestrationApiError(404, "reviewer_not_found", "Reviewer agent not found in this company");
  }
  return reviewer;
}

function routeMetadata(metadata: Record<string, unknown>): ReviewRoutingMetadata | null {
  const routing = metadata.reviewRouting;
  return routing && typeof routing === "object" && !Array.isArray(routing)
    ? routing as ReviewRoutingMetadata
    : null;
}

function isEscalationReviewer(reviewer: ReviewerAgent): boolean {
  const text = `${reviewer.name} ${reviewer.role}`.toLowerCase();
  return /\b(ceo|lead|qa|verification)\b/.test(text);
}

function assertReviewerCanDecide(reviewer: ReviewerAgent, metadata: Record<string, unknown>): void {
  const routing = routeMetadata(metadata);
  const routedReviewerId = typeof routing?.reviewerAgentId === "string" ? routing.reviewerAgentId : null;
  if (!routedReviewerId || routedReviewerId === reviewer.id || isEscalationReviewer(reviewer)) {
    return;
  }
  throw new OrchestrationApiError(
    403,
    "reviewer_not_authorized",
    "Reviewer must be the routed specialist or an escalation reviewer",
  );
}

function decisionMetadata(
  metadata: Record<string, unknown>,
  input: SubmitReviewDecisionInput,
  reviewer: ReviewerAgent,
  reviewedAt: string,
): Record<string, unknown> {
  return {
    ...metadata,
    reviewDecision: {
      decision: input.decision,
      reviewedAt,
      reviewerAgentId: reviewer.id,
      reviewerAgentName: reviewer.name,
      reviewerRole: reviewer.role,
      source: input.source ?? "agent",
      note: input.note?.trim() || null,
      confidence: assertConfidence(input.confidence) ?? null,
    },
  };
}

function getMemory(companyId: string, targetId: string): CompanyMemoryRecord {
  const memory = listCompanyMemoryRecords(companyId, { status: "all", includeArchived: true })
    .memories
    .find((item) => item.id === targetId || item.slug === targetId);
  if (!memory) {
    throw new OrchestrationApiError(404, "memory_not_found", "Memory candidate not found");
  }
  return memory;
}

function getSkill(companyId: string, targetId: string): CompanySkill {
  const skill = listCompanySkills(companyId, { status: "all", includeArchived: true })
    .skills
    .find((item) => item.id === targetId || item.slug === targetId);
  if (!skill) {
    throw new OrchestrationApiError(404, "skill_not_found", "Skill candidate not found");
  }
  return skill;
}

function activateDraftSkillAssignments(
  companyId: string,
  skillId: string,
  reviewer: ReviewerAgent,
  reviewedAt: string,
): { activatedAssignmentCount: number; activatedAgentIds: string[] } {
  const rows = getOrchestrationDb()
    .prepare(
      `SELECT agent_id
       FROM agent_skill_assignments
       WHERE company_id = ?
         AND skill_id = ?
         AND status = 'draft'`,
    )
    .all(companyId, skillId) as Array<{ agent_id: string }>;
  const info = getOrchestrationDb()
    .prepare(
      `UPDATE agent_skill_assignments
       SET status = 'active',
           assigned_by_agent_id = COALESCE(assigned_by_agent_id, ?),
           archived_at = NULL,
           updated_at = ?
       WHERE company_id = ?
         AND skill_id = ?
         AND status = 'draft'`,
    )
    .run(reviewer.id, reviewedAt, companyId, skillId);
  const activatedAgentIds = [...new Set(rows.map((row) => row.agent_id).filter(Boolean))];
  return {
    activatedAssignmentCount: Number(info.changes ?? 0),
    activatedAgentIds,
  };
}

export function submitCompanyReviewDecision(
  companyIdOrSlug: string,
  rawInput: SubmitReviewDecisionInput,
): SubmitReviewDecisionResult {
  const db = getOrchestrationDb();
  const company = resolveCompanyIdBySlug(companyIdOrSlug, db);
  if (!company) {
    throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  }

  const input: SubmitReviewDecisionInput = {
    ...rawInput,
    targetType: assertTargetType(rawInput.targetType),
    decision: assertDecision(rawInput.decision),
    targetId: rawInput.targetId?.trim() ?? "",
    reviewerAgentId: rawInput.reviewerAgentId?.trim() ?? "",
    confidence: assertConfidence(rawInput.confidence),
  };
  if (!input.targetId) {
    throw new OrchestrationApiError(400, "missing_target_id", "targetId is required");
  }
  if (!input.reviewerAgentId) {
    throw new OrchestrationApiError(400, "missing_reviewer", "reviewerAgentId is required");
  }

  const reviewer = resolveReviewer(company.id, input.reviewerAgentId);
  const reviewedAt = new Date().toISOString();

  if (input.targetType === "memory") {
    const memory = getMemory(company.id, input.targetId);
    assertReviewerCanDecide(reviewer, memory.metadata);
    const result = updateCompanyMemoryRecord(company.id, memory.id, {
      status: input.decision === "approve" ? "active" : "rejected",
      reviewState: input.decision === "approve" ? "approved" : "rejected",
      reviewedByAgentId: reviewer.id,
      metadata: decisionMetadata(memory.metadata, input, reviewer, reviewedAt),
    });
    return {
      company: {
        id: company.id,
        slug: company.slug,
        name: company.name,
        code: company.company_code,
      },
      reviewer,
      targetType: input.targetType,
      targetId: result.memory.id,
      decision: input.decision,
      memory: result.memory,
    };
  }

  const skill = getSkill(company.id, input.targetId);
  assertReviewerCanDecide(reviewer, skill.metadata);
  const activation = input.decision === "approve"
    ? activateDraftSkillAssignments(company.id, skill.id, reviewer, reviewedAt)
    : { activatedAssignmentCount: 0, activatedAgentIds: [] };
  const result = updateCompanySkill(company.id, skill.id, {
    status: input.decision === "approve" ? "active" : "archived",
    reviewState: input.decision === "approve" ? "approved" : "rejected",
    ownerAgentId: reviewer.id,
    metadata: {
      ...decisionMetadata(skill.metadata, input, reviewer, reviewedAt),
      reviewActivation: {
        activatedAssignmentCount: activation.activatedAssignmentCount,
        activatedAgentIds: activation.activatedAgentIds,
        activatedAt: reviewedAt,
        activatedByAgentId: reviewer.id,
        activatedByAgentName: reviewer.name,
      },
    },
    bumpVersion: false,
  });
  for (const agentId of activation.activatedAgentIds) {
    syncAgentCoreFiles(db, agentId);
  }
  return {
    company: {
      id: company.id,
      slug: company.slug,
      name: company.name,
      code: company.company_code,
    },
    reviewer,
    targetType: input.targetType,
    targetId: result.skill.id,
    decision: input.decision,
    skill: result.skill,
  };
}
