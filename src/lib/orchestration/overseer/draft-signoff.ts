import { createHash } from "crypto";
import type Database from "better-sqlite3";

import { OrchestrationApiError } from "@/lib/orchestration/api";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import {
  approveSprintPlanDraft,
  listPendingSprintPlanDraftsForGoal,
} from "@/lib/orchestration/company-service";
import {
  appendOverseerMessage,
  assertOverseerSessionCompany,
  listOverseerEvents,
  recordOverseerEvent,
} from "@/lib/orchestration/overseer/service";
import type { OrchestrationSprintPlanDraft } from "@/lib/orchestration/types";

/**
 * Overseer draft review + Delegated Signoff guards (INS-239).
 *
 * The Overseer is a read-only oversight surface: it can analyse drafts but
 * every state-changing HiveRunner action normally goes through an explicit
 * operator approval. Delegated Signoff is the one narrow exception — an
 * operator may pre-authorise the Overseer to approve a *specific* sprint-plan
 * draft on their behalf, but only while that draft is byte-for-byte identical
 * to the version the operator reviewed.
 *
 * The binding is a content hash. Reviewing a draft records a snapshot of its
 * hash. Delegating signoff pins the delegation to that reviewed hash. The
 * moment the draft is mutated (its hash changes), every delegation pinned to
 * the old hash is stale, signoff is blocked, and a fresh review + delegation
 * is required. This is the guard the validation contract calls
 * "snapshot hash binding" + "changed-draft rejection".
 *
 * All audit evidence lives as durable, sequence-ordered Overseer session
 * events. Signoff only ever flips a draft into board tasks in the database; it
 * never touches the HiveRunner application source tree or the operator's
 * workspace files.
 */

export const OVERSEER_DRAFT_REVIEW_EVENT = "overseer.draft.reviewed";
export const OVERSEER_DRAFT_SIGNOFF_DELEGATED_EVENT = "overseer.draft.signoff_delegated";
export const OVERSEER_DRAFT_SIGNOFF_APPLIED_EVENT = "overseer.draft.signoff_applied";
export const OVERSEER_DRAFT_SIGNOFF_BLOCKED_EVENT = "overseer.draft.signoff_blocked";
export const OVERSEER_DRAFT_REVIEW_CONTEXT_EVENT = "overseer.draft.review_context_loaded";

/** Content-hash schema marker so a stored hash can be re-validated later. */
export const DRAFT_CONTENT_HASH_SCHEMA = "hiverunner.overseer.draft_content.v1";

export type DraftSignoffRisk = "low" | "elevated" | "high";

const RISK_RANK: Record<DraftSignoffRisk, number> = { low: 0, elevated: 1, high: 2 };

/**
 * A draft with more than this many board tasks is treated as elevated risk: too
 * much surface area to hand to an unattended delegated signoff. Operators can
 * still approve it directly through the normal review surface.
 */
const LOW_RISK_MAX_TASKS = 6;

/** Execution engines that are safe to land via an unattended delegated signoff. */
const LOW_RISK_EXECUTION_ENGINES = new Set(["symphony", "hiverunner", "manual"]);

const DELEGATED_SIGNOFF_ACTOR = "overseer:delegated-signoff";

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
    .join(",")}}`;
}

/**
 * Deterministic content hash over the reviewable substance of a draft. Two
 * drafts hash equal iff their goal binding, sequence, sprint shape, and task
 * list are identical regardless of key ordering. Mutating any task, the
 * sprint, or reordering tasks changes the hash.
 */
export function computeDraftContentHash(draft: OrchestrationSprintPlanDraft): string {
  const canonical = stableSerialize({
    companyGoalId: draft.companyGoalId,
    sequenceNumber: draft.sequenceNumber,
    sprint: draft.sprint,
    tasks: draft.tasks,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Classify how risky it is to land a draft without a human in the loop.
 * Completion proposals (which close a company goal) are never delegable.
 */
export function classifyDraftSignoffRisk(draft: OrchestrationSprintPlanDraft): DraftSignoffRisk {
  if (draft.sprint.completionProposal) return "high";
  const tasks = draft.tasks ?? [];
  if (tasks.length > LOW_RISK_MAX_TASKS) return "elevated";
  const hasUnsafeEngine = tasks.some((task) => {
    const engine = (task.executionEngine ?? draft.sprint.defaultExecutionEngine ?? "symphony") || "symphony";
    return !LOW_RISK_EXECUTION_ENGINES.has(String(engine));
  });
  if (hasUnsafeEngine) return "elevated";
  return "low";
}

function riskAtOrBelow(risk: DraftSignoffRisk, ceiling: DraftSignoffRisk): boolean {
  return RISK_RANK[risk] <= RISK_RANK[ceiling];
}

function normalizeRisk(value: unknown, fallback: DraftSignoffRisk): DraftSignoffRisk {
  return value === "low" || value === "elevated" || value === "high" ? value : fallback;
}

function loadPendingDraft(input: {
  companyIdOrSlug: string;
  companyGoalId: string;
  draftId: string;
}): OrchestrationSprintPlanDraft | null {
  const { drafts } = listPendingSprintPlanDraftsForGoal({
    companyIdOrSlug: input.companyIdOrSlug,
    companyGoalId: input.companyGoalId,
  });
  return drafts.find((draft) => draft.id === input.draftId) ?? null;
}

export type DraftReviewSnapshot = {
  draftId: string;
  companyGoalId: string;
  contentHash: string;
  hashSchema: string;
  risk: DraftSignoffRisk;
  sprintName: string;
  taskCount: number;
  reviewedBy: string;
  reviewedAt: string;
  eventId: string;
};

export type DraftSignoffDelegation = {
  draftId: string;
  companyGoalId: string;
  reviewedContentHash: string;
  allowRiskAtOrBelow: DraftSignoffRisk;
  delegatedBy: string;
  reason: string | null;
  delegatedAt: string;
  eventId: string;
};

/**
 * Load the pending draft-plan context for a goal into an Overseer session so
 * the Overseer can reason over it. Records a durable context-load event and
 * returns each pending draft with its current content hash and risk.
 */
export function loadDraftReviewContext(input: {
  sessionId: string;
  companyIdOrSlug: string;
  companyGoalId: string;
  db?: Database.Database;
}): {
  companyGoalId: string;
  drafts: Array<{
    draftId: string;
    sequenceNumber: number;
    sprintName: string;
    taskCount: number;
    contentHash: string;
    hashSchema: string;
    risk: DraftSignoffRisk;
    completionProposal: boolean;
  }>;
} {
  const db = input.db ?? getOrchestrationDb();
  const session = assertOverseerSessionCompany({
    sessionId: input.sessionId,
    companyIdOrSlug: input.companyIdOrSlug,
    db,
  });
  const { drafts } = listPendingSprintPlanDraftsForGoal({
    companyIdOrSlug: session.companyId,
    companyGoalId: input.companyGoalId,
  });
  const context = drafts.map((draft) => ({
    draftId: draft.id,
    sequenceNumber: draft.sequenceNumber,
    sprintName: draft.sprint.name,
    taskCount: draft.tasks.length,
    contentHash: computeDraftContentHash(draft),
    hashSchema: DRAFT_CONTENT_HASH_SCHEMA,
    risk: classifyDraftSignoffRisk(draft),
    completionProposal: Boolean(draft.sprint.completionProposal),
  }));
  recordOverseerEvent({
    sessionId: session.id,
    eventType: OVERSEER_DRAFT_REVIEW_CONTEXT_EVENT,
    event: { companyGoalId: input.companyGoalId, drafts: context },
    db,
  });
  return { companyGoalId: input.companyGoalId, drafts: context };
}

/**
 * Record a reviewed-draft snapshot: pins the current content hash of a draft as
 * "reviewed". This is the snapshot a later delegation/signoff is bound against.
 */
export function recordReviewedDraftSnapshot(input: {
  sessionId: string;
  companyIdOrSlug: string;
  companyGoalId: string;
  draftId: string;
  reviewedBy?: string;
  db?: Database.Database;
}): { snapshot: DraftReviewSnapshot } {
  const db = input.db ?? getOrchestrationDb();
  const session = assertOverseerSessionCompany({
    sessionId: input.sessionId,
    companyIdOrSlug: input.companyIdOrSlug,
    db,
  });
  const draft = loadPendingDraft({
    companyIdOrSlug: session.companyId,
    companyGoalId: input.companyGoalId,
    draftId: input.draftId,
  });
  if (!draft) {
    throw new OrchestrationApiError(404, "sprint_plan_draft_not_found", "Pending draft not found for review");
  }
  const contentHash = computeDraftContentHash(draft);
  const risk = classifyDraftSignoffRisk(draft);
  const reviewedBy = input.reviewedBy?.trim() || "operator";
  const event = recordOverseerEvent({
    sessionId: session.id,
    eventType: OVERSEER_DRAFT_REVIEW_EVENT,
    event: {
      draftId: draft.id,
      companyGoalId: input.companyGoalId,
      contentHash,
      hashSchema: DRAFT_CONTENT_HASH_SCHEMA,
      risk,
      sprintName: draft.sprint.name,
      taskCount: draft.tasks.length,
      reviewedBy,
    },
    db,
  });
  return {
    snapshot: {
      draftId: draft.id,
      companyGoalId: input.companyGoalId,
      contentHash,
      hashSchema: DRAFT_CONTENT_HASH_SCHEMA,
      risk,
      sprintName: draft.sprint.name,
      taskCount: draft.tasks.length,
      reviewedBy,
      reviewedAt: event.occurredAt,
      eventId: event.id,
    },
  };
}

function latestEventForDraft(
  sessionId: string,
  draftId: string,
  eventType: string,
  db: Database.Database,
): { id: string; event: Record<string, unknown>; occurredAt: string } | null {
  const events = listOverseerEvents(sessionId, db).events;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const candidate = events[i];
    if (candidate.eventType === eventType && candidate.event.draftId === draftId) {
      return { id: candidate.id, event: candidate.event, occurredAt: candidate.occurredAt };
    }
  }
  return null;
}

/**
 * Operator action: delegate signoff authority for a draft to the Overseer. The
 * delegation is pinned to the reviewed content hash — the caller must pass the
 * hash they reviewed, and it must match both a recorded review snapshot and the
 * draft's current content. Any later mutation invalidates this delegation.
 */
export function delegateDraftSignoff(input: {
  sessionId: string;
  companyIdOrSlug: string;
  companyGoalId: string;
  draftId: string;
  reviewedContentHash: string;
  allowRiskAtOrBelow?: DraftSignoffRisk;
  delegatedBy?: string;
  reason?: string;
  db?: Database.Database;
}): { delegation: DraftSignoffDelegation } {
  const db = input.db ?? getOrchestrationDb();
  const session = assertOverseerSessionCompany({
    sessionId: input.sessionId,
    companyIdOrSlug: input.companyIdOrSlug,
    db,
  });
  const draft = loadPendingDraft({
    companyIdOrSlug: session.companyId,
    companyGoalId: input.companyGoalId,
    draftId: input.draftId,
  });
  if (!draft) {
    throw new OrchestrationApiError(404, "sprint_plan_draft_not_found", "Pending draft not found for delegation");
  }
  const currentHash = computeDraftContentHash(draft);
  if (currentHash !== input.reviewedContentHash) {
    throw new OrchestrationApiError(
      409,
      "draft_changed_since_review",
      "Draft changed since the reviewed snapshot; re-review before delegating signoff",
    );
  }
  const reviewSnapshot = latestEventForDraft(session.id, draft.id, OVERSEER_DRAFT_REVIEW_EVENT, db);
  if (!reviewSnapshot || reviewSnapshot.event.contentHash !== currentHash) {
    throw new OrchestrationApiError(
      409,
      "draft_not_reviewed",
      "No reviewed snapshot matches the current draft; record a review before delegating signoff",
    );
  }
  const allowRiskAtOrBelow = normalizeRisk(input.allowRiskAtOrBelow, "low");
  const delegatedBy = input.delegatedBy?.trim() || "operator";
  const reason = input.reason?.trim() || null;
  const event = recordOverseerEvent({
    sessionId: session.id,
    eventType: OVERSEER_DRAFT_SIGNOFF_DELEGATED_EVENT,
    event: {
      draftId: draft.id,
      companyGoalId: input.companyGoalId,
      reviewedContentHash: currentHash,
      allowRiskAtOrBelow,
      delegatedBy,
      reason,
    },
    db,
  });
  return {
    delegation: {
      draftId: draft.id,
      companyGoalId: input.companyGoalId,
      reviewedContentHash: currentHash,
      allowRiskAtOrBelow,
      delegatedBy,
      reason,
      delegatedAt: event.occurredAt,
      eventId: event.id,
    },
  };
}

export type DelegatedSignoffEvaluation = {
  allowed: boolean;
  reason: string;
  code:
    | "ok"
    | "draft_not_pending_or_missing"
    | "no_delegated_signoff"
    | "draft_not_reviewed"
    | "draft_changed_since_review"
    | "risk_exceeds_delegation";
  draftId: string;
  companyGoalId: string;
  currentContentHash: string | null;
  risk: DraftSignoffRisk | null;
  delegation: DraftSignoffDelegation | null;
  evidence: {
    reviewedContentHash: string | null;
    currentContentHash: string | null;
    hashMatched: boolean;
    allowRiskAtOrBelow: DraftSignoffRisk | null;
  };
};

/**
 * Evaluate whether a delegated signoff may be applied to a draft right now.
 * Pure read: never mutates the draft. The guard order matters — a missing
 * delegation, a stale (mutated) draft, or excessive risk each block signoff
 * with a distinct, auditable reason.
 */
export function evaluateDelegatedSignoff(input: {
  sessionId: string;
  companyIdOrSlug: string;
  companyGoalId: string;
  draftId: string;
  db?: Database.Database;
}): DelegatedSignoffEvaluation {
  const db = input.db ?? getOrchestrationDb();
  const session = assertOverseerSessionCompany({
    sessionId: input.sessionId,
    companyIdOrSlug: input.companyIdOrSlug,
    db,
  });
  const base = {
    draftId: input.draftId,
    companyGoalId: input.companyGoalId,
  };
  const draft = loadPendingDraft({
    companyIdOrSlug: session.companyId,
    companyGoalId: input.companyGoalId,
    draftId: input.draftId,
  });

  const delegationEvent = latestEventForDraft(session.id, input.draftId, OVERSEER_DRAFT_SIGNOFF_DELEGATED_EVENT, db);
  const delegation: DraftSignoffDelegation | null = delegationEvent
    ? {
        draftId: input.draftId,
        companyGoalId: input.companyGoalId,
        reviewedContentHash: String(delegationEvent.event.reviewedContentHash ?? ""),
        allowRiskAtOrBelow: normalizeRisk(delegationEvent.event.allowRiskAtOrBelow, "low"),
        delegatedBy: String(delegationEvent.event.delegatedBy ?? "operator"),
        reason: typeof delegationEvent.event.reason === "string" ? delegationEvent.event.reason : null,
        delegatedAt: delegationEvent.occurredAt,
        eventId: delegationEvent.id,
      }
    : null;

  if (!draft) {
    return {
      ...base,
      allowed: false,
      code: "draft_not_pending_or_missing",
      reason: "Draft is no longer pending or could not be found; nothing to sign off.",
      currentContentHash: null,
      risk: null,
      delegation,
      evidence: {
        reviewedContentHash: delegation?.reviewedContentHash ?? null,
        currentContentHash: null,
        hashMatched: false,
        allowRiskAtOrBelow: delegation?.allowRiskAtOrBelow ?? null,
      },
    };
  }

  const currentContentHash = computeDraftContentHash(draft);
  const risk = classifyDraftSignoffRisk(draft);
  const evidenceBase = {
    reviewedContentHash: delegation?.reviewedContentHash ?? null,
    currentContentHash,
    hashMatched: Boolean(delegation && delegation.reviewedContentHash === currentContentHash),
    allowRiskAtOrBelow: delegation?.allowRiskAtOrBelow ?? null,
  };

  if (!delegation) {
    return {
      ...base,
      allowed: false,
      code: "no_delegated_signoff",
      reason: "No operator-delegated signoff is on record for this draft.",
      currentContentHash,
      risk,
      delegation: null,
      evidence: evidenceBase,
    };
  }

  if (delegation.reviewedContentHash !== currentContentHash) {
    return {
      ...base,
      allowed: false,
      code: "draft_changed_since_review",
      reason: "Draft changed since the delegated signoff was granted; re-review and re-delegate.",
      currentContentHash,
      risk,
      delegation,
      evidence: evidenceBase,
    };
  }

  // A delegation can only exist if a matching review snapshot existed at grant
  // time, but re-verify the binding so a tampered/replayed delegation without a
  // real review snapshot cannot land.
  const reviewSnapshot = latestEventForDraft(session.id, draft.id, OVERSEER_DRAFT_REVIEW_EVENT, db);
  if (!reviewSnapshot || reviewSnapshot.event.contentHash !== currentContentHash) {
    return {
      ...base,
      allowed: false,
      code: "draft_not_reviewed",
      reason: "No reviewed snapshot matches the current draft content.",
      currentContentHash,
      risk,
      delegation,
      evidence: evidenceBase,
    };
  }

  if (!riskAtOrBelow(risk, delegation.allowRiskAtOrBelow)) {
    return {
      ...base,
      allowed: false,
      code: "risk_exceeds_delegation",
      reason: `Draft risk "${risk}" exceeds the delegated ceiling "${delegation.allowRiskAtOrBelow}".`,
      currentContentHash,
      risk,
      delegation,
      evidence: evidenceBase,
    };
  }

  return {
    ...base,
    allowed: true,
    code: "ok",
    reason: "Draft is unchanged since review and within the delegated risk ceiling.",
    currentContentHash,
    risk,
    delegation,
    evidence: evidenceBase,
  };
}

/**
 * Apply a delegated signoff. Evaluates the guard first; only approves the draft
 * (turning it into board tasks via the normal approval path) when the guard
 * passes. Records durable audit evidence either way. Throws 409 when blocked so
 * a blocked signoff can never silently no-op into an approval.
 *
 * This path only ever writes to the orchestration database — it never mutates
 * the HiveRunner application source tree or workspace files.
 */
export function applyDelegatedDraftSignoff(input: {
  sessionId: string;
  companyIdOrSlug: string;
  companyGoalId: string;
  draftId: string;
  db?: Database.Database;
}): {
  approval: ReturnType<typeof approveSprintPlanDraft>;
  evaluation: DelegatedSignoffEvaluation;
} {
  const db = input.db ?? getOrchestrationDb();
  const session = assertOverseerSessionCompany({
    sessionId: input.sessionId,
    companyIdOrSlug: input.companyIdOrSlug,
    db,
  });
  const evaluation = evaluateDelegatedSignoff({
    sessionId: session.id,
    companyIdOrSlug: session.companyId,
    companyGoalId: input.companyGoalId,
    draftId: input.draftId,
    db,
  });

  if (!evaluation.allowed) {
    recordOverseerEvent({
      sessionId: session.id,
      eventType: OVERSEER_DRAFT_SIGNOFF_BLOCKED_EVENT,
      event: {
        draftId: input.draftId,
        companyGoalId: input.companyGoalId,
        code: evaluation.code,
        reason: evaluation.reason,
        evidence: evaluation.evidence,
      },
      db,
    });
    throw new OrchestrationApiError(409, "delegated_signoff_blocked", evaluation.reason, {
      code: evaluation.code,
      evidence: evaluation.evidence,
    });
  }

  const approval = approveSprintPlanDraft({
    companyIdOrSlug: session.companyId,
    companyGoalId: input.companyGoalId,
    draftId: input.draftId,
    actorUserId: DELEGATED_SIGNOFF_ACTOR,
  });

  recordOverseerEvent({
    sessionId: session.id,
    eventType: OVERSEER_DRAFT_SIGNOFF_APPLIED_EVENT,
    event: {
      draftId: input.draftId,
      companyGoalId: input.companyGoalId,
      actor: DELEGATED_SIGNOFF_ACTOR,
      contentHash: evaluation.currentContentHash,
      risk: evaluation.risk,
      delegatedBy: evaluation.delegation?.delegatedBy ?? null,
      sprintId: approval.sprint.sprint.id,
      taskIds: approval.taskIds,
    },
    db,
  });

  appendOverseerMessage({
    sessionId: session.id,
    role: "system",
    content:
      `Delegated signoff applied to draft ${input.draftId}. ` +
      `Approved sprint "${approval.draft.sprint.name}" into ${approval.taskIds.length} board task(s) ` +
      `as ${DELEGATED_SIGNOFF_ACTOR}.`,
    metadata: {
      kind: "overseer_delegated_signoff_applied",
      draftId: input.draftId,
      contentHash: evaluation.currentContentHash,
      sprintId: approval.sprint.sprint.id,
      taskIds: approval.taskIds,
    },
    db,
  });

  return { approval, evaluation };
}
