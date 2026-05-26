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
import { createTask } from "@/lib/orchestration/service/task";

const REVIEW_ROUTING_VERSION = "review-routing.v1";

export type ReviewRoutingTarget = "all" | "memory" | "skills";

type ReviewerRule =
  | "legal"
  | "financial"
  | "writer"
  | "research"
  | "qa"
  | "release"
  | "product"
  | "implementation"
  | "lead";

type ReviewerProfile = {
  rule: ReviewerRule;
  preferredNames: string[];
  fallbackNames: string[];
  reason: string;
};

type AgentRef = {
  id: string;
  name: string;
  role: string;
  slug: string | null;
};

export type ReviewRouteAssignment = {
  targetType: "memory" | "skill";
  targetId: string;
  targetSlug: string;
  targetTitle: string;
  reviewerAgentId: string | null;
  reviewerAgentName: string | null;
  reviewerRule: ReviewerRule;
  reason: string;
  reviewTaskId: string | null;
  reviewTaskKey: string | null;
  reviewTaskCreated: boolean;
  dryRun: boolean;
};

export type ReviewRoutingResult = {
  company: {
    id: string;
    slug: string;
    name: string;
    code: string | null;
  };
  target: ReviewRoutingTarget;
  dryRun: boolean;
  createTasks: boolean;
  scannedCount: number;
  routedCount: number;
  reviewTaskCreatedCount: number;
  skippedCount: number;
  assignments: ReviewRouteAssignment[];
  skipped: Array<{
    targetType: "memory" | "skill";
    targetId: string;
    targetSlug: string;
    reason: "already_routed" | "no_reviewer";
  }>;
};

export type ReviewRoutingInput = {
  target?: ReviewRoutingTarget;
  dryRun?: boolean;
  reroute?: boolean;
  createTasks?: boolean;
};

type ExistingReviewRouting = {
  reviewerAgentId?: string;
  reviewerAgentName?: string;
  reviewerRole?: string;
  rule?: ReviewerRule;
  reason?: string;
};

type ExistingReviewTask = {
  taskId?: string;
  taskKey?: string | null;
};

type ReviewTaskResult = {
  taskId: string | null;
  taskKey: string | null;
  created: boolean;
  metadata: Record<string, unknown>;
};

const REVIEWERS: Record<ReviewerRule, ReviewerProfile> = {
  legal: {
    rule: "legal",
    preferredNames: ["Castor"],
    fallbackNames: ["Bruce", "Toby"],
    reason: "Legal, lending, compliance, or borrower-facing content requires specialist review.",
  },
  financial: {
    rule: "financial",
    preferredNames: ["Frank"],
    fallbackNames: ["Bruce", "Gator"],
    reason: "Financial calculations, audit logic, or loan math requires financial review.",
  },
  writer: {
    rule: "writer",
    preferredNames: ["Prism"],
    fallbackNames: ["Bruce", "Toby"],
    reason: "Writing and content workflows require content review.",
  },
  research: {
    rule: "research",
    preferredNames: ["Scout"],
    fallbackNames: ["Bruce", "Toby"],
    reason: "Research workflows require source and evidence review.",
  },
  qa: {
    rule: "qa",
    preferredNames: ["Gator"],
    fallbackNames: ["Ralph", "Bruce"],
    reason: "QA and verification workflows require independent verification review.",
  },
  release: {
    rule: "release",
    preferredNames: ["Ralph"],
    fallbackNames: ["Gator", "Bruce"],
    reason: "Release, repository, commit, and push workflows require repo steward review.",
  },
  product: {
    rule: "product",
    preferredNames: ["Toby", "Bruce"],
    fallbackNames: ["Gator"],
    reason: "Product, UX, routing, and operator workflow changes require product review.",
  },
  implementation: {
    rule: "implementation",
    preferredNames: ["Gator", "Ralph"],
    fallbackNames: ["Bruce"],
    reason: "Implementation skills should be reviewed for correctness and safe execution.",
  },
  lead: {
    rule: "lead",
    preferredNames: ["Bruce"],
    fallbackNames: ["Gator", "Ralph"],
    reason: "General company memory or cross-functional skill needs lead review.",
  },
};

function normalizeTarget(value: unknown): ReviewRoutingTarget {
  if (value === "memory" || value === "skills" || value === "all" || value === undefined || value === null || value === "") {
    return (value || "all") as ReviewRoutingTarget;
  }
  throw new OrchestrationApiError(400, "invalid_target", "target must be all, memory, or skills");
}

function getCompanyAgents(companyId: string): AgentRef[] {
  return getOrchestrationDb()
    .prepare(
      `SELECT id, name, role, slug
       FROM agents
       WHERE company_id = ?
         AND archived_at IS NULL
       ORDER BY name ASC`,
    )
    .all(companyId) as AgentRef[];
}

function agentMatches(agent: AgentRef, name: string): boolean {
  const needle = name.trim().toLowerCase();
  const values = [
    agent.name,
    agent.slug ?? "",
    agent.role,
  ].map((value) => value.toLowerCase());
  return values.some((value) => value === needle || value.startsWith(`${needle} `) || value.startsWith(`${needle} (`));
}

function findReviewer(agents: AgentRef[], profile: ReviewerProfile): AgentRef | null {
  for (const name of profile.preferredNames) {
    const agent = agents.find((candidate) => agentMatches(candidate, name));
    if (agent) return agent;
  }
  for (const name of profile.fallbackNames) {
    const agent = agents.find((candidate) => agentMatches(candidate, name));
    if (agent) return agent;
  }
  return null;
}

function targetText(target: CompanyMemoryRecord | CompanySkill): string {
  const metadata = target.metadata ? JSON.stringify(target.metadata) : "";
  const title = "title" in target ? target.title : target.name;
  const body = "body" in target ? target.body : target.description;
  return `${title} ${body} ${metadata}`.toLowerCase();
}

function chooseReviewerRule(target: CompanyMemoryRecord | CompanySkill): ReviewerRule {
  const text = targetText(target);
  if (/\b(legal|compliance|regulation|lending|borrower|loan agreement|disclosure)\b/.test(text)) return "legal";
  if (/\b(financial|finance|calculation|interest|payment|amortization|fee|audit)\b/.test(text)) return "financial";
  if (/\b(writer|writing|content|copy|markdown|documentation|docs)\b/.test(text)) return "writer";
  if (/\b(research|citation|investigate|deep research|source material|source notes)\b/.test(text)) return "research";
  if (/\b(release|repo steward|commit|push|git|diff|tag|promotion)\b/.test(text)) return "release";
  if (/\b(qa|verification|verify|validated|accepted|review)\b/.test(text)) return "qa";
  if (/\b(product|ux|operator|workflow|routing|task breakdown|handoff|kanban)\b/.test(text)) return "product";
  if (/\b(implementation|backend|frontend|api|database|schema|integration|runtime|code)\b/.test(text)) return "implementation";
  return "lead";
}

function hasExistingRoute(metadata: Record<string, unknown>): boolean {
  const route = metadata.reviewRouting;
  return Boolean(route && typeof route === "object" && !Array.isArray(route));
}

function getExistingRoute(metadata: Record<string, unknown>): ExistingReviewRouting | null {
  const route = metadata.reviewRouting;
  return route && typeof route === "object" && !Array.isArray(route)
    ? route as ExistingReviewRouting
    : null;
}

function getExistingReviewTask(metadata: Record<string, unknown>): ExistingReviewTask | null {
  const task = metadata.reviewTask;
  return task && typeof task === "object" && !Array.isArray(task)
    ? task as ExistingReviewTask
    : null;
}

function findAgentById(agents: AgentRef[], agentId: string | null | undefined): AgentRef | null {
  if (!agentId) return null;
  return agents.find((agent) => agent.id === agentId) ?? null;
}

function isActiveTask(taskId: string | null | undefined): boolean {
  if (!taskId) return false;
  const row = getOrchestrationDb()
    .prepare("SELECT id FROM tasks WHERE id = ? AND archived_at IS NULL LIMIT 1")
    .get(taskId) as { id: string } | undefined;
  return Boolean(row);
}

function routedMetadata(
  target: CompanyMemoryRecord | CompanySkill,
  reviewer: AgentRef,
  rule: ReviewerRule,
  reason: string,
): Record<string, unknown> {
  return {
    ...target.metadata,
    reviewRouting: {
      version: REVIEW_ROUTING_VERSION,
      routedAt: new Date().toISOString(),
      reviewerAgentId: reviewer.id,
      reviewerAgentName: reviewer.name,
      reviewerRole: reviewer.role,
      rule,
      reason,
    },
  };
}

function targetReviewContext(
  companySlugOrId: string,
  targetType: "memory" | "skill",
  target: CompanyMemoryRecord | CompanySkill,
  reviewer: AgentRef,
  rule: ReviewerRule,
  reason: string,
): Record<string, unknown> {
  const base = {
    version: "review-context.v1",
    company: companySlugOrId,
    targetType,
    targetId: target.id,
    targetSlug: target.slug,
    title: "title" in target ? target.title : target.name,
    reviewerAgentId: reviewer.id,
    reviewerAgentName: reviewer.name,
    reviewerRole: reviewer.role,
    rule,
    reason,
    decisionEndpoint: `/api/orchestration/companies/${companySlugOrId}/reviews/decision`,
    decisionAction: {
      action: "review_candidate",
      targetType,
      targetId: target.id,
      decision: "approve|reject",
      note: "short rationale",
      confidence: 0.0,
    },
    decisionPayload: {
      targetType,
      targetId: target.id,
      reviewerAgentId: reviewer.id,
      source: "agent",
      decision: "approve|reject",
      note: "short rationale",
      confidence: 0.0,
    },
  };

  if (targetType === "memory" && "body" in target) {
    return {
      ...base,
      body: target.body,
      kind: target.kind,
      scope: target.scope,
      source: target.source,
      confidence: target.confidence,
      projectId: target.projectId,
      projectName: target.projectName,
      sourceAgentId: target.agentId,
      sourceAgentName: target.agentName,
      taskId: target.taskId,
      taskKey: target.taskKey,
      executionRunId: target.executionRunId,
      evidence: {
        evidenceCount: target.metadata.evidenceCount ?? null,
        supportingTaskKeys: target.metadata.supportingTaskKeys ?? null,
        supportingMemoryIds: target.metadata.supportingMemoryIds ?? null,
      },
    };
  }

  return {
    ...base,
    description: "description" in target ? target.description : "",
    status: "status" in target ? target.status : null,
    skillVersion: "version" in target ? target.version : null,
    source: "source" in target ? target.source : null,
    scope: "scope" in target ? target.scope : null,
    ownerAgentId: "ownerAgentId" in target ? target.ownerAgentId : null,
    ownerAgentName: "ownerAgentName" in target ? target.ownerAgentName : null,
    assignedAgentNames: "assignedAgentNames" in target ? target.assignedAgentNames : [],
    evidence: {
      evidenceCount: target.metadata.evidenceCount ?? null,
      supportingTaskKeys: target.metadata.supportingTaskKeys ?? null,
      supportingMemoryIds: target.metadata.supportingMemoryIds ?? null,
    },
  };
}

function reviewTaskDescription(input: {
  companySlugOrId: string;
  targetType: "memory" | "skill";
  target: CompanyMemoryRecord | CompanySkill;
  reviewer: AgentRef;
  rule: ReviewerRule;
  reason: string;
  context: Record<string, unknown>;
}): string {
  const targetTitle = "title" in input.target ? input.target.title : input.target.name;
  const targetBody = "body" in input.target ? input.target.body : input.target.description;
  const endpoint = `/api/orchestration/companies/${input.companySlugOrId}/reviews/decision`;
  const payload = {
    targetType: input.targetType,
    targetId: input.target.id,
    decision: "approve",
    reviewerAgentId: input.reviewer.id,
    note: "Replace with concise rationale.",
    confidence: 0.9,
    source: "agent",
  };
  return [
    `Review this ${input.targetType} candidate and decide whether it should become active durable HiveRunner context.`,
    "",
    "## Reviewer",
    `- Assigned reviewer: ${input.reviewer.name}`,
    `- Review rule: ${input.rule}`,
    `- Routing reason: ${input.reason}`,
    "",
    "## Candidate",
    `- Target type: ${input.targetType}`,
    `- Target id: ${input.target.id}`,
    `- Target slug: ${input.target.slug}`,
    `- Title: ${targetTitle}`,
    "",
    "```markdown",
    targetBody || "(No body provided.)",
    "```",
    "",
    "## Required decision",
    "- Approve only if the candidate is useful, accurate, non-duplicative, safe to inject into future agent context, and scoped correctly.",
    "- Reject if it is stale, too vague, unsupported, unsafe, duplicate, or should remain task-local.",
    "- Post a short task comment with your rationale.",
    "- Then emit a `review_candidate` mc-action with either approve or reject.",
    "",
    "## Decision action",
    "Use this action block instead of making an HTTP request:",
    "",
    "```mc-action",
    JSON.stringify({
      action: "review_candidate",
      targetType: input.targetType,
      targetId: input.target.id,
      decision: "approve",
      note: "Replace with concise rationale.",
      confidence: 0.9,
    }, null, 2),
    "```",
    "",
    "## Decision endpoint",
    `POST ${endpoint}`,
    "The endpoint is listed for system context; normal agents should use the mc-action above.",
    "",
    "```json",
    JSON.stringify(payload, null, 2),
    "```",
    "",
    "## Full structured context",
    "```json",
    JSON.stringify(input.context, null, 2),
    "```",
  ].join("\n");
}

function ensureReviewTask(input: {
  companySlugOrId: string;
  targetType: "memory" | "skill";
  target: CompanyMemoryRecord | CompanySkill;
  reviewer: AgentRef;
  rule: ReviewerRule;
  reason: string;
  metadata: Record<string, unknown>;
  dryRun: boolean;
  createTasks: boolean;
}): ReviewTaskResult {
  const existingTask = getExistingReviewTask(input.metadata);
  if (isActiveTask(existingTask?.taskId)) {
    return {
      taskId: existingTask?.taskId ?? null,
      taskKey: existingTask?.taskKey ?? null,
      created: false,
      metadata: input.metadata,
    };
  }

  const context = targetReviewContext(
    input.companySlugOrId,
    input.targetType,
    input.target,
    input.reviewer,
    input.rule,
    input.reason,
  );
  if (input.dryRun || !input.createTasks) {
    return {
      taskId: null,
      taskKey: null,
      created: false,
      metadata: {
        ...input.metadata,
        reviewContext: context,
      },
    };
  }

  const projectId = input.targetType === "memory" && "projectId" in input.target
    ? input.target.projectId ?? undefined
    : undefined;
  const targetTitle = "title" in input.target ? input.target.title : input.target.name;
  const task = createTask({
    companyIdOrSlug: projectId ? undefined : input.companySlugOrId,
    projectId,
    title: `Review ${input.targetType} candidate: ${targetTitle}`.slice(0, 180),
    description: reviewTaskDescription({
      companySlugOrId: input.companySlugOrId,
      targetType: input.targetType,
      target: input.target,
      reviewer: input.reviewer,
      rule: input.rule,
      reason: input.reason,
      context,
    }),
    priority: "P2",
    type: "maintenance",
    status: "to-do",
    assignee: input.reviewer.id,
    labels: ["learning-review", `${input.targetType}-review`, input.rule],
    executionEngine: "symphony",
    modelLane: "default",
    createdBy: "review-routing",
  }).task;

  return {
    taskId: task.id,
    taskKey: task.key ?? null,
    created: true,
    metadata: {
      ...input.metadata,
      reviewContext: context,
      reviewTask: {
        version: "review-task.v1",
        taskId: task.id,
        taskKey: task.key ?? null,
        createdAt: new Date().toISOString(),
        reviewerAgentId: input.reviewer.id,
        reviewerAgentName: input.reviewer.name,
        executionEngine: "symphony",
      },
    },
  };
}

function routeMemory(
  companySlugOrId: string,
  memory: CompanyMemoryRecord,
  agents: AgentRef[],
  input: Required<Pick<ReviewRoutingInput, "dryRun" | "reroute" | "createTasks">>,
): { assignment?: ReviewRouteAssignment; skipped?: ReviewRoutingResult["skipped"][number] } {
  const existingRoute = getExistingRoute(memory.metadata);
  if (!input.reroute && existingRoute && isActiveTask(getExistingReviewTask(memory.metadata)?.taskId)) {
    return { skipped: { targetType: "memory", targetId: memory.id, targetSlug: memory.slug, reason: "already_routed" } };
  }
  const rule = !input.reroute && existingRoute?.rule ? existingRoute.rule : chooseReviewerRule(memory);
  const profile = REVIEWERS[rule];
  const reviewer = !input.reroute && existingRoute?.reviewerAgentId
    ? findAgentById(agents, existingRoute.reviewerAgentId)
    : findReviewer(agents, profile);
  if (!reviewer) {
    return { skipped: { targetType: "memory", targetId: memory.id, targetSlug: memory.slug, reason: "no_reviewer" } };
  }
  const baseMetadata = !input.reroute && hasExistingRoute(memory.metadata)
    ? memory.metadata
    : routedMetadata(memory, reviewer, rule, profile.reason);
  const reviewTask = ensureReviewTask({
    companySlugOrId,
    targetType: "memory",
    target: memory,
    reviewer,
    rule,
    reason: profile.reason,
    metadata: baseMetadata,
    dryRun: input.dryRun,
    createTasks: input.createTasks,
  });
  if (!input.dryRun) {
    updateCompanyMemoryRecord(companySlugOrId, memory.id, {
      metadata: reviewTask.metadata,
    });
  }
  return {
    assignment: {
      targetType: "memory",
      targetId: memory.id,
      targetSlug: memory.slug,
      targetTitle: memory.title,
      reviewerAgentId: reviewer.id,
      reviewerAgentName: reviewer.name,
      reviewerRule: rule,
      reason: profile.reason,
      reviewTaskId: reviewTask.taskId,
      reviewTaskKey: reviewTask.taskKey,
      reviewTaskCreated: reviewTask.created,
      dryRun: input.dryRun,
    },
  };
}

function routeSkill(
  companySlugOrId: string,
  skill: CompanySkill,
  agents: AgentRef[],
  input: Required<Pick<ReviewRoutingInput, "dryRun" | "reroute" | "createTasks">>,
): { assignment?: ReviewRouteAssignment; skipped?: ReviewRoutingResult["skipped"][number] } {
  const existingRoute = getExistingRoute(skill.metadata);
  if (!input.reroute && existingRoute && isActiveTask(getExistingReviewTask(skill.metadata)?.taskId)) {
    return { skipped: { targetType: "skill", targetId: skill.id, targetSlug: skill.slug, reason: "already_routed" } };
  }
  const rule = !input.reroute && existingRoute?.rule ? existingRoute.rule : chooseReviewerRule(skill);
  const profile = REVIEWERS[rule];
  const reviewer = !input.reroute && existingRoute?.reviewerAgentId
    ? findAgentById(agents, existingRoute.reviewerAgentId)
    : findReviewer(agents, profile);
  if (!reviewer) {
    return { skipped: { targetType: "skill", targetId: skill.id, targetSlug: skill.slug, reason: "no_reviewer" } };
  }
  const baseMetadata = !input.reroute && hasExistingRoute(skill.metadata)
    ? skill.metadata
    : routedMetadata(skill, reviewer, rule, profile.reason);
  const reviewTask = ensureReviewTask({
    companySlugOrId,
    targetType: "skill",
    target: skill,
    reviewer,
    rule,
    reason: profile.reason,
    metadata: baseMetadata,
    dryRun: input.dryRun,
    createTasks: input.createTasks,
  });
  if (!input.dryRun) {
    updateCompanySkill(companySlugOrId, skill.id, {
      ownerAgentId: reviewer.id,
      metadata: reviewTask.metadata,
      bumpVersion: false,
    });
  }
  return {
    assignment: {
      targetType: "skill",
      targetId: skill.id,
      targetSlug: skill.slug,
      targetTitle: skill.name,
      reviewerAgentId: reviewer.id,
      reviewerAgentName: reviewer.name,
      reviewerRule: rule,
      reason: profile.reason,
      reviewTaskId: reviewTask.taskId,
      reviewTaskKey: reviewTask.taskKey,
      reviewTaskCreated: reviewTask.created,
      dryRun: input.dryRun,
    },
  };
}

export function routeCompanyReviewCandidates(companyIdOrSlug: string, input: ReviewRoutingInput = {}): ReviewRoutingResult {
  const target = normalizeTarget(input.target);
  const dryRun = input.dryRun === true;
  const reroute = input.reroute === true;
  const createTasks = input.createTasks !== false;
  const db = getOrchestrationDb();
  const company = resolveCompanyIdBySlug(companyIdOrSlug, db);
  if (!company) {
    throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  }

  const agents = getCompanyAgents(company.id);
  const assignments: ReviewRouteAssignment[] = [];
  const skipped: ReviewRoutingResult["skipped"] = [];
  let scannedCount = 0;

  if (target === "all" || target === "memory") {
    const memories = listCompanyMemoryRecords(company.id, { status: "draft" }).memories
      .filter((memory) => memory.reviewState === "requested");
    scannedCount += memories.length;
    for (const memory of memories) {
      const result = routeMemory(company.id, memory, agents, { dryRun, reroute, createTasks });
      if (result.assignment) assignments.push(result.assignment);
      if (result.skipped) skipped.push(result.skipped);
    }
  }

  if (target === "all" || target === "skills") {
    const skills = listCompanySkills(company.id, { status: "draft" }).skills
      .filter((skill) => skill.reviewState === "requested");
    scannedCount += skills.length;
    for (const skill of skills) {
      const result = routeSkill(company.id, skill, agents, { dryRun, reroute, createTasks });
      if (result.assignment) assignments.push(result.assignment);
      if (result.skipped) skipped.push(result.skipped);
    }
  }

  return {
    company: {
      id: company.id,
      slug: company.slug,
      name: company.name,
      code: company.company_code,
    },
    target,
    dryRun,
    createTasks,
    scannedCount,
    routedCount: assignments.length,
    reviewTaskCreatedCount: assignments.filter((assignment) => assignment.reviewTaskCreated).length,
    skippedCount: skipped.length,
    assignments,
    skipped,
  };
}
