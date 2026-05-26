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
}

export interface OrchestrationAgent {
  id: string;
  companyId?: string;
  slug: string;
  name: string;
  emoji: string;
  role: string;
  avatar?: string;
  status: "idle" | "working" | "paused" | "offline" | "error";
  projectId?: string;
  currentTask?: string;
  personality?: string;
  model?: string;
  /** Execution provider. Source of truth for provider identity (Phase 1). */
  adapterType?: string;
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
  rejectReason?: string | null;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string | null;
  rejectedAt?: string | null;
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
    | "task.comment_added"
    | "task.read_marked"
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
