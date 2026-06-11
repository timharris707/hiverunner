export type ProjectStatus = "active" | "inactive" | "completed" | "archived" | "on-hold" | "paused";
export type CompanyStatus = "active" | "paused" | "archived";

export type TaskStatus = "backlog" | "to-do" | "in-progress" | "review" | "done" | "blocked" | "cancelled";
export type TaskPriority = "P0" | "P1" | "P2" | "P3";
export type TaskType =
  | "feature"
  | "bug"
  | "maintenance"
  | "research"
  | "infrastructure"
  | "directive"
  | "epic"
  | "spike"
  | "docs"
  | "infra"
  | "refactor"
  | "review"
  | "qa"
  | "release";
export type TaskExecutionEngine = "hiverunner" | "symphony" | "manual";
export type TaskExecutionMode = "openclaw" | "manual";
export type TaskModelLane = "default" | "fast" | "mini" | "deep";
export type SprintStatus = "planned" | "active" | "blocked" | "paused" | "done";

export interface OrchestrationAgentModelDisplay {
  provider: "anthropic" | "codex" | "gemini" | "openai" | "manual" | "runtime";
  providerLabel: string;
  model: string;
  displayModel?: string;
  label: string;
  color: string;
  background: string;
  border: string;
  sourceAgentId?: string;
  sourceAgentName?: string;
  source?: "assignee" | "runner" | "review_source";
}

export interface CompanyTheme {
  name: string;
  promptTemplate: string;
  keywords: string[];
  sampleUrl?: string;
}

export interface AvatarThemePreset {
  id: string;
  name: string;
  description: string;
  promptTemplate: string;
  keywords: string[];
}

export interface OrchestrationProject {
  id: string;
  companyId?: string;
  slug: string;
  name: string;
  description: string;
  emoji: string;
  color: string;
  owner?: string;
  status: ProjectStatus;
  created: string;
  repo?: string;
  sourceWorkspaceRoot?: string | null;
  taskCount: number;
  inProgress: number;
  backlog: number;
  review: number;
  completed: number;
  velocity?: number;
  activeAgents?: number;
  defaultExecutionEngine?: TaskExecutionEngine;
}

export interface OrchestrationCompany {
  id: string;
  slug: string;
  workspaceSlug: string;
  runtimeSlug: string;
  code: string;
  name: string;
  description: string;
  status: CompanyStatus;
  created: string;
  owner?: {
    id: string;
    displayName: string;
    email: string;
    role: "owner" | "admin" | "member" | "viewer";
    status: "active" | "invited" | "suspended" | "removed";
  };
  workspace: {
    root: string;
    source: "openclaw" | "provisioned" | "imported" | "manual";
  };
  theme: CompanyTheme;
  defaultExecutionEngine?: TaskExecutionEngine;
  stats: {
    projects: number;
    agents: number;
    activeTasks: number;
  };
}

export interface OrchestrationTask {
  id: string;
  key?: string;
  title: string;
  description?: string;
  parentTaskId?: string;
  status: TaskStatus;
  columnOrder?: number;
  priority: TaskPriority;
  type: TaskType;
  project: string;
  assignee?: string;
  displayAgentId?: string;
  displayAgentName?: string;
  displayAgentSource?: "assignee" | "runner" | "review_source";
  eligibleAssignees?: string[];
  tags: string[];
  sprint?: string;
  sprintId?: string;
  sprintKey?: string;
  sprintName?: string;
  sprintStatus?: SprintStatus;
  companyGoalId?: string;
  companyGoalKey?: string;
  companyGoalName?: string;
  companyGoalStatus?: SprintStatus;
  blockedReason?: string;
  dependencies?: OrchestrationTaskDependency[];
  waitingOn?: OrchestrationTaskDependency[];
  executionEngine?: TaskExecutionEngine;
  executionEngineOverride?: TaskExecutionEngine | null;
  executionEngineSource?: "task" | "project" | "company" | "global";
  executionRuntimeProvider?: string | null;
  executionRuntimeLabel?: string | null;
  executionModelRouting?: string | null;
  executionModelRoutingLabel?: string | null;
  executionRoutingSource?: "task" | "project" | "company" | "global";
  modelLane?: TaskModelLane;
  modelDisplay?: OrchestrationAgentModelDisplay | null;
  /** @deprecated Legacy bridge/runtime marker. Use executionEngine plus runtime provider data instead. */
  executionMode?: TaskExecutionMode;
  createdBy?: string;
  dueDate?: string;
  sourceReviewId?: string;
  sourceTakeawayId?: string;
  sourceTemplateVersionId?: string | null;
  templateIntakeAnswerId?: string | null;
  templateGenerationProvenance?: Record<string, unknown>;
  created: string;
  updated: string;
  completedAt?: string;
  comments?: Array<{
    id: string;
    author: string;
    authorEmoji?: string;
    text: string;
    timestamp: string;
    type?: string;
    /** Comment origin: "mission_control" | "voice" | "openclaw" | provider/runtime sources.
     *  Voice-originated comments surface a small "Voice Chat" pill on the
     *  task page next to the author name. */
    source?: string;
  }>;
}

export interface OrchestrationTaskDependency {
  id: string;
  key?: string;
  title: string;
  status: TaskStatus;
  assignee?: string;
}

export interface OrchestrationTaskDetailSummary {
  id: string;
  key?: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  type: TaskType;
  assignee?: string;
  modelDisplay?: OrchestrationAgentModelDisplay | null;
  dependencies?: OrchestrationTaskDependency[];
  waitingOn?: OrchestrationTaskDependency[];
  created: string;
  updated: string;
}

export interface OrchestrationTaskTimelineItem {
  id: string;
  taskId: string;
  timestamp: string;
  kind: "comment" | "imported_report" | "engine_event" | "run_event" | "approval_event" | "status_change" | "subtask_event";
  source: string;
  actorLabel?: string;
  summary: string;
  body?: string;
  metadata: Record<string, unknown>;
  linkedRunId?: string;
  linkedApprovalId?: string;
  linkedTaskId?: string;
  provenance: "comment" | "imported_report" | "engine_event" | "run_event" | "approval_event" | "status_change" | "subtask_event";
}

export interface OrchestrationResolvedExecutionContext {
  executionEngine?: TaskExecutionEngine | null;
  provider?: string | null;
  runnerProvider?: string | null;
  runnerModel?: string | null;
  model?: string | null;
  modelLane?: TaskModelLane | null;
  laneLabel?: string | null;
  routeFingerprint?: string | null;
  routeFallbacks?: string[];
  modelRouting?: string | null;
  modelRoutingLabel?: string | null;
  activeHiveId?: string | null;
  activeHiveName?: string | null;
  workspaceRoot?: string | null;
  companyWorkspaceRoot?: string | null;
  sourceWorkspaceRoot?: string | null;
  sandbox?: string | null;
  approvalPolicy?: string | null;
  runtimeSlug?: string | null;
  runtimeDisplayName?: string | null;
  command?: string | null;
  configSource?: string | null;
  phase?: "planned" | "run";
}

export interface OrchestrationTaskRunSummary {
  totalRuns: number;
  structuredActionCount: number;
  importedReportCount: number;
  usageTotals?: {
    inputTokens?: number | null;
    outputTokens?: number | null;
    cacheReadInputTokens?: number | null;
    cacheCreationInputTokens?: number | null;
    totalCostUsd?: number | null;
  };
  latestRun?: {
    id: string;
    provider: string;
    executionEngine?: TaskExecutionEngine | string | null;
    runnerProvider?: string | null;
    runnerModel?: string | null;
    fallbackUsed?: boolean;
    fallbackIndex?: number | null;
    fallbackFromProvider?: string | null;
    routeAttempts?: unknown[];
    status: string;
    startedAt?: string;
    finishedAt?: string | null;
    error?: string | null;
    resolvedExecution?: OrchestrationResolvedExecutionContext;
    workspaceChangedDuringRunCount?: number;
    workspaceWarningCount?: number;
  };
  activeRun?: {
    id: string;
    provider: string;
    executionEngine?: TaskExecutionEngine | string | null;
    runnerProvider?: string | null;
    runnerModel?: string | null;
    fallbackUsed?: boolean;
    fallbackIndex?: number | null;
    fallbackFromProvider?: string | null;
    routeAttempts?: unknown[];
    status: string;
    startedAt?: string;
    finishedAt?: string | null;
    error?: string | null;
    resolvedExecution?: OrchestrationResolvedExecutionContext;
    workspaceChangedDuringRunCount?: number;
    workspaceWarningCount?: number;
  };
}

export type OrchestrationEvalReviewOutcome = "accepted" | "returned" | "rejected" | "blocked";

export type OrchestrationExperimentReportStatus =
  | "draft"
  | "generated"
  | "accepted"
  | "returned"
  | "superseded"
  | "archived";

export interface OrchestrationExperimentReportLink {
  type: "run_trace" | "eval_case" | "task" | "goal" | "sprint" | "improve";
  id: string;
  label: string;
  href: string;
}

export interface OrchestrationExperimentReportEvidence {
  id: string;
  experimentId: string;
  companyId: string;
  status: OrchestrationExperimentReportStatus;
  title: string;
  summary: string;
  objective: string;
  sourceKind: "run_trace" | "eval_case" | "mixed";
  sourceRunId: string | null;
  sourceEvalCaseId: string | null;
  sourceTaskId: string | null;
  sourceTaskKey: string | null;
  sourceTaskTitle: string | null;
  sprintId: string | null;
  sprintKey: string | null;
  goalKey: string | null;
  winningVariantId: string | null;
  winningVariantKey: string | null;
  winningVariantName: string | null;
  recommendationId: string | null;
  reportSha256: string | null;
  createdAt: string;
  updatedAt: string;
  href: string;
  links: OrchestrationExperimentReportLink[];
  redactionPolicy: string;
  redactionSummary?: Record<string, unknown>;
  redactedPayload?: Record<string, unknown>;
}

export interface OrchestrationRunIntelligenceRollup {
  evalCaseCount: number;
  experimentReportCount: number;
  acceptedExperimentReportCount: number;
  acceptedImproveHandoffCount: number;
}

export interface OrchestrationEvalCase {
  id: string;
  companyId: string;
  projectId: string | null;
  sourceProject: {
    id: string | null;
    slug: string | null;
    name: string | null;
    color: string | null;
  };
  sourceTask: {
    id: string | null;
    key: string;
    title: string;
    type: string | null;
    tags: string[];
  };
  sourceRun: {
    id: string;
    traceRoute: string;
    executionEngine: TaskExecutionEngine | null;
    runnerProvider: string | null;
    providerId: string | null;
    runnerModel: string | null;
    agentId: string | null;
    agentName: string | null;
  };
  sourceSprint: {
    id: string | null;
    key: string | null;
  };
  sourceGoal: {
    id: string | null;
    key: string | null;
  };
  templateContext: Record<string, unknown>;
  sourceTemplateVersionId?: string | null;
  templateIntakeAnswerId?: string | null;
  review: {
    outcome: OrchestrationEvalReviewOutcome;
    rationale: string;
    notes: string | null;
    reviewerAgentId: string | null;
    reviewerName: string | null;
    reviewedAt: string | null;
  };
  captureQuality: "complete" | "partial" | "minimal" | "failed";
  evidenceGaps: unknown[];
  snapshotSha256: string;
  version: number;
  parentEvalCaseId: string | null;
  idempotencyKey: string | null;
  createdByAgentId: string | null;
  createdByUserId: string | null;
  createdAt: string;
  experimentReports?: OrchestrationExperimentReportEvidence[];
}

export interface OrchestrationEvalLibraryFacet {
  value: string;
  label: string;
  count: number;
}

export interface OrchestrationEvalLibraryFacets {
  projects: OrchestrationEvalLibraryFacet[];
  taskTypes: OrchestrationEvalLibraryFacet[];
  templates: OrchestrationEvalLibraryFacet[];
  agents: OrchestrationEvalLibraryFacet[];
  runners: OrchestrationEvalLibraryFacet[];
  models: OrchestrationEvalLibraryFacet[];
  reviewOutcomes: OrchestrationEvalLibraryFacet[];
  tags: OrchestrationEvalLibraryFacet[];
}

export interface OrchestrationEvalLibraryFilters {
  projectId?: string;
  taskType?: string;
  template?: string;
  sourceTemplateVersionId?: string;
  templateIntakeAnswerId?: string;
  agent?: string;
  runner?: string;
  model?: string;
  reviewOutcome?: OrchestrationEvalReviewOutcome;
  tag?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}

export interface OrchestrationEvalLibraryResult {
  cases: OrchestrationEvalCase[];
  total: number;
  filters: OrchestrationEvalLibraryFilters;
  facets: OrchestrationEvalLibraryFacets;
}

export type OrchestrationImprovementTriggerKey =
  | "severe_single_failure"
  | "repeated_review_return"
  | "missing_capability"
  | "missing_tool_runtime"
  | "template_drift"
  | "runner_mismatch"
  | "reviewer_request"
  | "slow_expensive_run";

export type OrchestrationImprovementScopeType = "company" | "project" | "template" | "task_type" | "agent" | "runner" | "recommendation";
export type OrchestrationImprovementSeverity = "low" | "medium" | "high" | "critical";
export type OrchestrationImprovementConfidence = "low" | "medium" | "high";
export type OrchestrationImprovementRecommendationStatus =
  | "suggested"
  | "needs-more-evidence"
  | "accepted-for-approval"
  | "dismissed"
  | "superseded"
  | "applied";
export type OrchestrationImprovementDismissalReason = "not_now" | "wrong_diagnosis" | "too_risky" | "already_fixed" | "not_worth_it";
export type OrchestrationImprovementSuppressionReason =
  | OrchestrationImprovementDismissalReason
  | "duplicate"
  | "operator_suppressed";
export type OrchestrationImprovementTriggerFiringStatus = "created_recommendation" | "suppressed" | "skipped" | "needs_more_evidence";

export type ImprovementRecommendationStatus = OrchestrationImprovementRecommendationStatus;
export type ImprovementRecommendationSeverity = OrchestrationImprovementSeverity;
export type ImprovementRecommendationConfidence = OrchestrationImprovementConfidence;
export type ImprovementRecommendationScopeType = OrchestrationImprovementScopeType;
export type ImprovementRecommendationSourceType =
  | "trace"
  | "eval"
  | "experiment_report"
  | "template"
  | "team"
  | "task"
  | "sprint"
  | "goal"
  | "review"
  | "manual";

export interface OrchestrationImprovementSourceLink {
  type: Exclude<ImprovementRecommendationSourceType, "review" | "manual"> | "approval";
  id: string;
  label: string;
  href: string;
}

export interface OrchestrationImprovementEvidenceSummary {
  id: string;
  sourceType: ImprovementRecommendationSourceType;
  sourceId: string | null;
  title: string;
  summary: string;
  occurredAt: string | null;
  missingReason: string | null;
  redactionPolicy: string;
  links: OrchestrationImprovementSourceLink[];
  metadata: Record<string, unknown>;
}

export interface OrchestrationImprovementEvidenceSet {
  state: "present" | "missing";
  summaries: OrchestrationImprovementEvidenceSummary[];
}

export interface OrchestrationImprovementRecommendationGroup {
  key: string;
  label: string;
  count: number;
  recommendationIds: string[];
}

export interface OrchestrationImprovementRecommendationFilters {
  status?: ImprovementRecommendationStatus[];
  severity?: ImprovementRecommendationSeverity[];
  confidence?: ImprovementRecommendationConfidence[];
  sourceType?: ImprovementRecommendationSourceType[];
  triggerKey?: string;
  category?: string;
  scopeType?: ImprovementRecommendationScopeType;
  scopeKey?: string;
  projectId?: string;
  agentId?: string;
  search?: string;
  evidenceState?: "present" | "missing";
  includeSuppressed?: boolean;
  groupBy?: "status" | "severity" | "confidence" | "category" | "trigger" | "scope" | "source";
  limit?: number;
}

export interface OrchestrationImprovementScope {
  type: OrchestrationImprovementScopeType;
  key: string;
}

export interface OrchestrationImprovementCompanyControl {
  companyId: string;
  automationPaused: boolean;
  pausedReason: string | null;
  pausedAt: string | null;
  updatedAt: string;
}

export interface OrchestrationImprovementTriggerFiring {
  id: string;
  companyId: string;
  triggerKey: OrchestrationImprovementTriggerKey;
  scope: OrchestrationImprovementScope;
  status: OrchestrationImprovementTriggerFiringStatus;
  decisionReason: string;
  evidence: unknown[];
  recommendationId: string | null;
  recommendationTitle: string | null;
  suppressionId: string | null;
  suppressionReason: OrchestrationImprovementSuppressionReason | null;
  firedAt: string;
}

export interface OrchestrationImprovementTriggerControl {
  companyId: string;
  triggerKey: OrchestrationImprovementTriggerKey;
  label: string;
  description: string;
  enabled: boolean;
  threshold: Record<string, unknown>;
  updatedAt: string | null;
  latestFiring: OrchestrationImprovementTriggerFiring | null;
}

export interface OrchestrationImprovementSuppression {
  id: string;
  companyId: string;
  triggerKey: OrchestrationImprovementTriggerKey | null;
  scope: OrchestrationImprovementScope;
  reason: OrchestrationImprovementSuppressionReason;
  notes: string | null;
  active: boolean;
  sourceRecommendationId: string | null;
  evidenceFingerprint?: string | null;
  metadata?: Record<string, unknown>;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrchestrationImprovementEvidenceSetRecord {
  id: string;
  companyId: string;
  triggerFiringId: string | null;
  summary: string;
  evidenceStrength: "single" | "pattern" | "manual" | "unknown";
  evidenceItems: Record<string, unknown>[];
  redactionPolicy: string;
  redactionSummary: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdByAgentId: string | null;
  createdByUserId: string | null;
  createdAt: string;
}

export interface OrchestrationImprovementRecommendation {
  id: string;
  companyId: string;
  triggerKey: string;
  triggerClass?: string | null;
  scope: OrchestrationImprovementScope;
  scopeType?: OrchestrationImprovementScopeType;
  scopeKey?: string;
  scopeLabel?: string | null;
  category?: string | null;
  title: string;
  summary?: string;
  rationale: string;
  proposedChange: string;
  severity: OrchestrationImprovementSeverity;
  confidence: OrchestrationImprovementConfidence;
  status: OrchestrationImprovementRecommendationStatus;
  evidence: OrchestrationImprovementEvidenceSet;
  originalRecommendation: Record<string, unknown>;
  currentRecommendation: Record<string, unknown>;
  affectedSurfaces?: Record<string, unknown>[];
  evidenceSetId?: string | null;
  evidenceSet?: OrchestrationImprovementEvidenceSetRecord | null;
  sourceTriggerFiringId?: string | null;
  triggerFiring?: (OrchestrationImprovementTriggerFiring & {
    triggerClass?: string | null;
    sourceTaskId?: string | null;
    sourceRunId?: string | null;
    sourceEvalCaseId?: string | null;
    thresholds?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }) | null;
  originalGeneratedText?: string;
  operatorText?: string;
  proposedChangeSummary?: string;
  proposedChangeJson?: Record<string, unknown>;
  preview?: Record<string, unknown> | null;
  riskNotes?: string | null;
  rollbackNotes?: string | null;
  latestApprovalId?: string | null;
  latestApprovalStatus?: ApprovalStatus | null;
  approvalDecisionNote?: string | null;
  approvalSyncedAt?: string | null;
  dismissalReason: OrchestrationImprovementDismissalReason | null;
  dismissalNotes: string | null;
  dismissedAt: string | null;
  suppressionId: string | null;
  suppression?: OrchestrationImprovementSuppression | null;
  suppressionReason?: string | null;
  suppressionScope?: string | null;
  suppressionExpiresAt?: string | null;
  supersededByRecommendationId: string | null;
  supersededAt?: string | null;
  approvalId: string | null;
  approval?: {
    id: string;
    status: ApprovalStatus | null;
    decisionNote: string | null;
    decidedAt: string | null;
  } | null;
  approvalLinks?: OrchestrationImprovementApprovalLink[];
  idempotencyKey: string | null;
  createdByAgentId: string | null;
  createdByUserId: string | null;
  acceptedByUserId?: string | null;
  acceptedAt?: string | null;
  appliedAt?: string | null;
  archivedAt?: string | null;
  links?: OrchestrationImprovementSourceLink[];
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface OrchestrationImprovementRecommendationListResult {
  recommendations: OrchestrationImprovementRecommendation[];
  total: number;
  filters: OrchestrationImprovementRecommendationFilters;
  groups: OrchestrationImprovementRecommendationGroup[];
}

export interface OrchestrationImprovementDashboard {
  companyControl: OrchestrationImprovementCompanyControl;
  triggers: OrchestrationImprovementTriggerControl[];
  recommendations: OrchestrationImprovementRecommendation[];
  firings: OrchestrationImprovementTriggerFiring[];
  suppressions: OrchestrationImprovementSuppression[];
}

export interface OrchestrationTaskDetail {
  task: OrchestrationTaskDetailSummary;
  parentTask?: OrchestrationTaskDetailSummary;
  childTasks: OrchestrationTaskDetailSummary[];
  timeline: OrchestrationTaskTimelineItem[];
  runSummary: OrchestrationTaskRunSummary;
  plannedExecution?: OrchestrationResolvedExecutionContext;
  sprintId?: string;
  sprintKey?: string;
  sprintName?: string;
  sprintStatus?: SprintStatus;
  companyGoalId?: string;
  companyGoalKey?: string;
  companyGoalName?: string;
  companyGoalStatus?: SprintStatus;
}

export interface OrchestrationSprint {
  id: string;
  sprintKey?: string | null;
  goalKey?: string | null;
  projectId: string;
  name: string;
  goal: string;
  goalKind?: "company" | "sprint";
  status: SprintStatus;
  startDate: string;
  endDate?: string;
  created: string;
  updated: string;
  taskCount: number;
  inProgressCount: number;
  reviewCount: number;
  doneCount: number;
  parentId?: string;
  owner?: string;
  leadAgentId?: string | null;
  stopCondition?: string;
  progressSummary?: string;
  defaultExecutionEngine?: TaskExecutionEngine | null;
  defaultModelLane?: TaskModelLane | null;
  sourceTemplateVersionId?: string | null;
  templateIntakeAnswerId?: string | null;
  templateGenerationProvenance?: Record<string, unknown>;
  contractItems?: OrchestrationGoalContractItem[];
  validationSummary?: OrchestrationGoalValidationSummary;
}

export type GoalContractItemKind = "success_criterion" | "validation_check" | "out_of_scope";
export type GoalContractEvidenceStatus = "proposed" | "passed" | "failed" | "retracted";
export type GoalContractEvidenceSource = "agent" | "operator" | "system";

export interface OrchestrationGoalContractEvidence {
  id: string;
  itemId: string;
  sprintId: string;
  itemKind: GoalContractItemKind;
  status: GoalContractEvidenceStatus;
  source: GoalContractEvidenceSource;
  resultText: string;
  commandExitCode?: number | null;
  artifactUri?: string | null;
  recordedByAgentId?: string | null;
  recordedByUserId?: string | null;
  createdAt: string;
}

export interface OrchestrationGoalContractItem {
  id: string;
  sprintId: string;
  kind: GoalContractItemKind;
  text: string;
  position: number;
  createdAt: string;
  updatedAt: string;
  latestEvidence?: OrchestrationGoalContractEvidence | null;
}

export interface OrchestrationGoalValidationSummary {
  successCriteria: {
    total: number;
    passed: number;
  };
  validationChecks: {
    total: number;
    passed: number;
  };
  blockingReason?: string;
}

export interface OrchestrationCompanyInboxTask extends OrchestrationTask {
  projectId: string;
  projectSlug: string;
  projectName: string;
  projectColor: string;
}

export interface OrchestrationCompanyInboxEvent {
  id: string;
  eventType:
    | "task.created"
    | "task.updated"
    | "task.archived"
    | "task.reordered"
    | "task.status_changed"
    | "task.assigned"
    | "task.unassigned"
    | "task.eval_case_saved"
    | "task.comment_added"
    | "goal.sprint_plan_proposed"
    | "goal.sprint_plan_approved"
    | "goal.sprint_plan_rejected"
    | "goal.completion_proposed"
    | "goal.completion_approved"
    | "goal.completion_rejected"
    | "lead_supervisor_update"
    | "execution.pending"
    | "execution.running"
    | "execution.completed"
    | "execution.failed"
    | "execution.cancelled"
    | "approval.pending"
    | "approval.approved"
    | "approval.rejected"
    | "approval.revision_requested";
  kind: "task" | "execution" | "approval" | "sprint_plan_draft" | "lead_supervisor_update";
  companyId: string;
  companySlug: string;
  companyName: string;
  projectId: string;
  projectSlug: string;
  projectName: string;
  projectColor: string;
  taskId?: string;
  taskTitle?: string;
  taskKey?: string;
  sprintId?: string;
  sprintName?: string;
  sprintStatus?: SprintStatus;
  companyGoalId?: string;
  companyGoalName?: string;
  companyGoalStatus?: SprintStatus;
  status?: TaskStatus;
  agentId?: string;
  agentName?: string;
  avatarUrl?: string;
  provider?: string;
  message: string;
  /** Short, user-facing description of the latest useful activity in this inbox thread. */
  activitySummary?: string;
  timestamp: string;
  isRead?: boolean;
  approvalId?: string;
  approvalType?: ApprovalType;
  approvalStatus?: ApprovalStatus;
  approvalLabel?: string;
  requestedByName?: string;
  draftId?: string;
  draftSprintName?: string;
  draftTaskCount?: number;
  draftSprintCount?: number;
  draftNextSequenceNumber?: number;
  draftProposalGroupId?: string;
  draftMaterialized?: boolean;
  /** Error message for failed executions */
  errorMessage?: string;
  /** Failure reason for failed/cancelled executions */
  failureReason?: string;
}

export interface OrchestrationCompanyGoal {
  sprint: OrchestrationSprint;
  projectId: string;
  projectSlug: string;
  projectName: string;
  projectColor: string;
  completionPercent: number;
  remainingTasks: number;
  planHasTasks?: boolean;
  planTaskCount?: number;
  planDoneTaskCount?: number;
  planPendingTaskCount?: number;
  planSprintCount?: number;
  planApprovedSprintCount?: number;
  planDoneSprintCount?: number;
  planPendingSprintCount?: number;
  runIntelligence?: OrchestrationRunIntelligenceRollup;
}

export type AgentRosterState = "active" | "bench" | "paused" | "archived" | "all";

export interface OrchestrationAgent {
  id: string;
  companyId?: string;
  slug: string;
  name: string;
  emoji: string;
  role: string;
  avatar?: string;
  status: "idle" | "working" | "paused" | "offline" | "error";
  rosterState?: Exclude<AgentRosterState, "all">;
  projectId?: string;
  currentTask?: string;
  personality?: string;
  model?: string;
  /** Execution provider. Source of truth for provider identity (Phase 1). */
  adapterType?: string;
  runtimeConfig?: Record<string, unknown>;
  runtimeSlug?: string;
  openclawAgentId?: string;
  reportingTo?: string;
  reportingToName?: string;
  hireApprovalId?: string;
  hireApprovalStatus?: ApprovalStatus;
  skills?: string[];
  tasksCompleted?: number;
  totalRuntimeMinutes?: number;
  lastHeartbeat?: string;
  created?: string;
  updated?: string;
  archivedAt?: string;
  avatarStyleId?: string;
  avatarGender?: string;
  avatarAge?: number;
  avatarHairColor?: string;
  avatarHairLength?: string;
  avatarEyeColor?: string;
  avatarVibe?: string;
  voiceId?: string;
}

export type OrchestrationRuntimeKind = "cli" | "daemon" | "api" | "manual" | "external";
export type OrchestrationRuntimeScope = "company" | "agent" | "workspace" | "external";
export type OrchestrationRuntimeStatus = "online" | "offline" | "unknown" | "error" | "disabled";
export type OrchestrationRuntimeHealthStatus =
  | "ready"
  | "needs_login"
  | "missing_cli"
  | "failed_probe"
  | "disabled"
  | "unknown";

export interface OrchestrationRuntimeHealth {
  status: OrchestrationRuntimeHealthStatus;
  label: string;
  checkedAt?: string | null;
  command?: string | null;
  commandPath?: string | null;
  version?: string | null;
  versionLatest?: boolean | null;
  latestVersion?: string | null;
  versionCheckSource?: string | null;
  versionCheckDetail?: string | null;
  workspaceRoot?: string | null;
  workspaceWritable?: boolean | null;
  authReady?: boolean | null;
  details: string[];
  error?: string | null;
}

export interface OrchestrationRuntime {
  id: string;
  companyId: string;
  agentId?: string | null;
  provider: string;
  runtimeKind: OrchestrationRuntimeKind;
  scope: OrchestrationRuntimeScope;
  runtimeSlug: string;
  displayName: string;
  command?: string | null;
  version?: string | null;
  status: OrchestrationRuntimeStatus;
  workspaceRoot?: string | null;
  metadata: Record<string, unknown>;
  health?: OrchestrationRuntimeHealth | null;
  lastSeenAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DetectedOrchestrationRuntime {
  provider: string;
  displayName: string;
  command: string;
  commandPath: string;
  version?: string;
  status: OrchestrationRuntimeStatus;
  metadata: Record<string, unknown>;
}

export type OrchestrationRuntimeDependencyOptionality =
  | "core_local_boot"
  | "optional_runtime"
  | "optional_provider_key"
  | "legacy_optional";

export type OrchestrationRuntimeDependencyStatus =
  | "ready"
  | "missing_optional"
  | "needs_login"
  | "not_configured"
  | "unknown";

export interface OrchestrationRuntimeDependencyReadiness {
  id: string;
  label: string;
  provider: string;
  kind: "cli" | "external-runner" | "provider-key" | "local-service";
  optionality: OrchestrationRuntimeDependencyOptionality;
  status: OrchestrationRuntimeDependencyStatus;
  command?: string | null;
  commandPath?: string | null;
  version?: string | null;
  versionLatest?: boolean | null;
  latestVersion?: string | null;
  versionCheckSource?: string | null;
  versionCheckDetail?: string | null;
  authReady?: boolean | null;
  envVars: string[];
  note: string;
  setupHint: string;
}

export interface OrchestrationRuntimeAttachResult {
  runtime: OrchestrationRuntime;
  created: boolean;
  agentProviderSwitch?: {
    switched: boolean;
    blockReason?: string | null;
    message: string;
  } | null;
}

export interface OrchestrationRuntimeCliUpdateResult {
  provider: string;
  packageName: string | null;
  command: string;
  args: string[];
  ok: boolean;
  status: number | null;
  currentVersion: string | null;
  latestVersion: string | null;
  beforeVersion: string | null;
  afterVersion: string | null;
  output: string;
  error: string | null;
  jobId?: string | null;
  phase?: "queued" | "running" | "succeeded" | "failed" | null;
  startedAt?: string | null;
  completedAt?: string | null;
  finished?: boolean;
}

export interface OrchestrationRuntimeExecutionRun {
  id: string;
  taskId?: string | null;
  taskKey?: string | null;
  taskTitle?: string | null;
  projectId?: string | null;
  projectSlug?: string | null;
  projectName?: string | null;
  agentId?: string | null;
  agentName?: string | null;
  provider: string;
  executionEngine?: TaskExecutionEngine | string | null;
  runnerProvider?: string | null;
  runnerModel?: string | null;
  status: "pending" | "running" | "completed" | "succeeded" | "failed" | "timed_out" | "cancelled";
  sessionId?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  durationMs?: number | null;
  errorMessage?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens?: number;
  totalCostUsd?: number;
  model?: string | null;
  transcriptEventCount?: number;
}

export interface OrchestrationRuntimeTaskDurationMetric {
  durationMs: number | null;
  sampleSize: number;
}

export interface OrchestrationAgentProfileTask {
  id: string;
  key?: string | null;
  title: string;
  projectId: string;
  projectSlug: string;
  projectName: string;
  projectColor?: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  type: TaskType;
  updatedAt: string;
  sprintId?: string | null;
  sprintKey?: string | null;
  sprintName?: string | null;
  sprintStatus?: SprintStatus | null;
  sprintStartDate?: string | null;
  sprintEndDate?: string | null;
  sprintOwner?: string | null;
  sprintTaskCount?: number;
  sprintDoneCount?: number;
  companyGoalId?: string | null;
  companyGoalKey?: string | null;
  companyGoalName?: string | null;
  companyGoalStatus?: SprintStatus | null;
  companyGoalProjectName?: string | null;
  companyGoalProjectColor?: string | null;
}

export interface OrchestrationAgentProfileActivity {
  id: string;
  kind: "comment" | "event";
  taskId: string;
  taskTitle: string;
  projectId: string;
  projectSlug: string;
  projectName: string;
  message: string;
  timestamp: string;
}

export interface OrchestrationAgentExecutionRun {
  id: string;
  taskId: string;
  taskTitle: string;
  projectId: string;
  projectSlug: string;
  projectName: string;
  provider: "openclaw" | "codex" | "anthropic" | "hermes" | "gemini" | "symphony" | "manual";
  executionEngine?: TaskExecutionEngine | null;
  runnerProvider?: string | null;
  runnerModel?: string | null;
  status: "pending" | "running" | "completed" | "succeeded" | "failed" | "timed_out" | "cancelled";
  sessionId?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  durationMs?: number;
  errorMessage?: string;
  /** Token usage stats — populated when available */
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  totalCostUsd?: number;
  /** Task key (e.g. NEV-34) */
  taskKey?: string;
  /** Trigger type: Timer, Assignment, Automation, Kickoff, API */
  triggerType?: string;
  /** Human-readable trigger reason */
  triggerReason?: string;
}

export interface OrchestrationAgentProfile {
  company: {
    id: string;
    slug: string;
    name: string;
  };
  agent: OrchestrationAgent;
  currentTasks: OrchestrationAgentProfileTask[];
  recentActivity: OrchestrationAgentProfileActivity[];
  executionHistory: OrchestrationAgentExecutionRun[];
  liveSession?: OrchestrationAgentExecutionRun;
  usageSummary?: {
    totalRuns: number;
    completedRuns: number;
    failedRuns: number;
    totalDurationMs: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    totalCostUsd: number;
  };
}

export type SprintPlanDraftStatus = "pending" | "approved" | "rejected" | "superseded";

export interface OrchestrationSprintPlanDraftTask {
  id: string;
  title: string;
  description?: string;
  assignee?: string | null;
  eligibleAssignees?: string[];
  priority?: TaskPriority;
  type?: TaskType;
  executionEngine?: TaskExecutionEngine | null;
  modelLane?: TaskModelLane | null;
  dependsOn?: string[];
  validation?: string;
  sourceTemplateVersionId?: string | null;
  templateIntakeAnswerId?: string | null;
  templateGenerationProvenance?: Record<string, unknown>;
}

export interface OrchestrationSprintPlanDraftSprint {
  name: string;
  objective: string;
  completionProposal?: boolean;
  completionReason?: string;
  owner?: string | null;
  startDate?: string;
  endDate?: string | null;
  defaultExecutionEngine?: TaskExecutionEngine | null;
  defaultModelLane?: TaskModelLane | null;
  successCriteria?: string[];
  validationChecks?: string[];
  outOfScope?: string[];
  sourceTemplateVersionId?: string | null;
  templateIntakeAnswerId?: string | null;
  templateGenerationProvenance?: Record<string, unknown>;
}

export interface OrchestrationSprintPlanDraft {
  id: string;
  companyGoalId: string;
  planningTaskId?: string | null;
  proposedByAgentId?: string | null;
  sequenceNumber: number;
  proposalGroupId?: string | null;
  status: SprintPlanDraftStatus;
  sprint: OrchestrationSprintPlanDraftSprint;
  tasks: OrchestrationSprintPlanDraftTask[];
  sourceTemplateVersionId?: string | null;
  intakeAnswerId?: string | null;
  generationProvenance?: Record<string, unknown>;
  rejectReason?: string | null;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string | null;
  rejectedAt?: string | null;
}

export interface OrchestrationTemplateDraftPlanCapabilitySlot {
  id: string;
  lane: "required" | "useful" | "later";
  label: string;
  description: string;
  suggestedRole: string;
  coverageStatus:
    | "covered_by_active"
    | "covered_by_bench"
    | "pending_approval"
    | "proposed_new_agent"
    | "auto_approved_new_agent";
  matchedAgent?: {
    id: string;
    name: string;
    role: string;
    status: OrchestrationAgent["status"];
    rosterState: Exclude<AgentRosterState, "all">;
    hireApprovalId?: string;
    hireApprovalStatus?: ApprovalStatus;
  };
  proposedAgent?: {
    name: string;
    role: string;
    capabilities: string;
    reason: string;
    materialized: boolean;
    agentId?: string;
    approvalId?: string;
    status?: OrchestrationAgent["status"];
    approvalRequired?: boolean;
  };
}

export interface OrchestrationTemplateDraftPlan {
  created: boolean;
  createsBoardTasksImmediately: false;
  template: {
    id: string;
    templateVersionId: string;
    version: string;
    name: string;
    summary: string;
  };
  intakeAnswer: {
    id: string;
    answers: Record<string, unknown>;
    normalizedAnswers: Record<string, unknown>;
  };
  draftGoal: {
    title: string;
    objective: string;
  };
  draft: OrchestrationSprintPlanDraft;
  validationChecklist: string[];
  reviewCriteria: {
    title: string;
    description: string;
    evidence: string[];
    blockedIf: string[];
  };
  crewRecommendation: {
    summary: string;
    autoApproveNewHires: boolean;
    materializedNewAgentCount: number;
    approvalRequiredNewAgentCount: number;
    required: OrchestrationTemplateDraftPlanCapabilitySlot[];
    useful: OrchestrationTemplateDraftPlanCapabilitySlot[];
    later: OrchestrationTemplateDraftPlanCapabilitySlot[];
  };
}

export interface OrchestrationPendingSprintPlanDraftSummary {
  id: string;
  companyId: string;
  companySlug: string;
  companyCode: string;
  companyGoalId: string;
  companyGoalName: string;
  proposedByAgentId?: string;
  proposedByAgentName?: string;
  proposedByAgentAvatarUrl?: string;
  sprintName: string;
  taskCount: number;
  nextSprintTaskCount?: number;
  sprintCount: number;
  nextSequenceNumber: number;
  sprints?: Array<{
    id: string;
    sequenceNumber: number;
    sprintName: string;
    taskCount: number;
  }>;
  proposalGroupId?: string;
  completionProposal?: boolean;
  completionReason?: string;
  createdAt: string;
}

export interface OrchestrationActivityEvent {
  id: string;
  eventType:
    | "task.status_changed"
    | "task.assigned"
    | "task.unassigned"
    | "task.eval_case_saved"
    | "task.comment_added"
    | "task.read_marked"
    | "template.draft_created"
    | "template.crew_recommended"
    | "template.board_created"
    | "overseer.draft.signoff_delegated"
    | "overseer.draft.signoff_applied"
    | "overseer.draft.signoff_blocked"
    | "improve.recommendation_created"
    | "improve.recommendation_dismissed"
    | "improve.recommendation_suppressed"
    | "improve.approval_package_created"
    | "improve.approval_decision_synced"
    | "improve.recommendation_applied"
    | "sprint.created"
    | "sprint.updated"
    | "sprint.completed";
  projectId: string;
  projectSlug: string;
  projectName: string;
  companyId?: string;
  companySlug?: string;
  companyName?: string;
  taskId?: string;
  taskTitle?: string;
  taskKey?: string;
  sprintId?: string;
  sprintName?: string;
  oldStatus?: TaskStatus;
  newStatus?: TaskStatus;
  message: string;
  agentId?: string;
  agentName?: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

export interface OrchestrationStaleAlert {
  taskId: string;
  taskTitle: string;
  taskStatus: TaskStatus;
  projectId: string;
  projectSlug: string;
  projectName: string;
  companyId?: string;
  companySlug?: string;
  companyName?: string;
  assignee?: string;
  lastUpdatedAt: string;
  staleMinutes: number;
  thresholdMinutes: number;
  exceededMinutes: number;
}

export interface BoardState {
  project: OrchestrationProject;
  tasks: OrchestrationTask[];
}

/* ── Approvals ── */

export type ApprovalType =
  | "hire_agent"
  | "approve_ceo_strategy"
  | "budget_override_required"
  | "provider_switch"
  | "protected_runtime_command";
export type ApprovalStatus = "pending" | "revision_requested" | "approved" | "rejected" | "cancelled";

export interface OrchestrationApproval {
  id: string;
  companyId: string;
  type: ApprovalType;
  status: ApprovalStatus;
  requestedByAgentId: string | null;
  requestedByAgentName: string | null;
  approverAgentId: string | null;
  approverAgentName: string | null;
  approverAgentRole: string | null;
  approvalRouteReason: string | null;
  payload: Record<string, unknown>;
  decisionNote: string | null;
  decidedByUserId: string | null;
  decidedAt: string | null;
  linkedTaskId: string | null;
  linkedTaskKey?: string | null;
  linkedTaskTitle?: string | null;
  createdAt: string;
  updatedAt: string;
  comments?: OrchestrationApprovalComment[];
}

export interface OrchestrationApprovalComment {
  id: string;
  approvalId: string;
  authorAgentId: string | null;
  authorAgentName: string | null;
  authorUserId: string | null;
  body: string;
  createdAt: string;
}

export type ImprovementApprovalPackageStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "rejected"
  | "cancelled"
  | "applied";

export interface OrchestrationImprovementApprovalLink {
  id: string;
  companyId: string;
  recommendationId: string;
  approvalId: string | null;
  status: ImprovementApprovalPackageStatus;
  approvalPackage: Record<string, unknown>;
  riskNotes: string | null;
  rollbackNotes: string;
  createdByAgentId: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ── Routines ── */

export type RoutineStatus = "active" | "paused" | "archived";
export type RoutinePriority = "critical" | "high" | "medium" | "low";
export type RoutineConcurrencyPolicy = "coalesce_if_active" | "always_enqueue" | "skip_if_active";
export type RoutineCatchUpPolicy = "skip_missed" | "enqueue_missed_with_cap";
export type RoutineRunStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface OrchestrationRoutine {
  id: string;
  companyId: string;
  projectId: string | null;
  assigneeAgentId: string | null;
  title: string;
  description: string;
  priority: RoutinePriority;
  status: RoutineStatus;
  concurrencyPolicy: RoutineConcurrencyPolicy;
  catchUpPolicy: RoutineCatchUpPolicy;
  createdAt: string;
  updatedAt: string;
}

export interface OrchestrationRoutineListItem extends OrchestrationRoutine {
  projectName: string | null;
  projectColor: string | null;
  agentName: string | null;
  agentEmoji: string | null;
  lastRun: {
    triggeredAt: string;
    status: RoutineRunStatus;
  } | null;
}

export const ORCHESTRATION_COLUMNS: Array<{ id: TaskStatus; label: string }> = [
  { id: "backlog", label: "Backlog" },
  { id: "to-do", label: "To-Do" },
  { id: "in-progress", label: "In Progress" },
  { id: "review", label: "Review" },
  { id: "blocked", label: "Blocked" },
  { id: "done", label: "Done" },
];
