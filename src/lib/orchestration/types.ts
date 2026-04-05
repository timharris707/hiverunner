export type ProjectStatus = "active" | "inactive" | "completed" | "archived" | "on-hold" | "paused";
export type CompanyStatus = "active" | "paused" | "archived";

export type TaskStatus = "backlog" | "on-deck" | "in-progress" | "review" | "done" | "blocked" | "cancelled";
export type TaskPriority = "P0" | "P1" | "P2" | "P3";
export type TaskType = "feature" | "bug" | "maintenance" | "research" | "infrastructure" | "directive";
export type TaskExecutionMode = "openclaw" | "paperclip" | "manual";
export type SprintStatus = "planned" | "active" | "done";

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
  taskCount: number;
  inProgress: number;
  backlog: number;
  review: number;
  completed: number;
  velocity?: number;
  activeAgents?: number;
}

export interface OrchestrationCompany {
  id: string;
  slug: string;
  code: string;
  name: string;
  description: string;
  status: CompanyStatus;
  created: string;
  workspace: {
    root: string;
    source: "openclaw" | "provisioned" | "imported" | "manual";
  };
  theme: CompanyTheme;
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
  tags: string[];
  sprint?: string;
  blockedReason?: string;
  executionMode?: TaskExecutionMode;
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
  }>;
}

export interface OrchestrationSprint {
  id: string;
  projectId: string;
  name: string;
  goal: string;
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
    | "execution.pending"
    | "execution.running"
    | "execution.completed"
    | "execution.failed"
    | "execution.cancelled"
    | "approval.pending"
    | "approval.approved"
    | "approval.rejected"
    | "approval.revision_requested";
  kind: "task" | "execution" | "approval";
  companyId: string;
  companySlug: string;
  companyName: string;
  projectId: string;
  projectSlug: string;
  projectName: string;
  taskId?: string;
  taskTitle?: string;
  taskKey?: string;
  status?: TaskStatus;
  agentId?: string;
  agentName?: string;
  provider?: "openclaw" | "paperclip";
  message: string;
  timestamp: string;
  isRead?: boolean;
  approvalId?: string;
  approvalType?: ApprovalType;
  approvalStatus?: ApprovalStatus;
  approvalLabel?: string;
  requestedByName?: string;
}

export interface OrchestrationCompanyGoal {
  sprint: OrchestrationSprint;
  projectId: string;
  projectSlug: string;
  projectName: string;
  projectColor: string;
  completionPercent: number;
  remainingTasks: number;
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
  paperclipAgentId?: string;
  openclawAgentId?: string;
  reportingTo?: string;
  reportingToName?: string;
  skills?: string[];
  tasksCompleted?: number;
  totalRuntimeMinutes?: number;
  lastHeartbeat?: string;
  created?: string;
  updated?: string;
}

export interface OrchestrationAgentProfileTask {
  id: string;
  title: string;
  projectId: string;
  projectSlug: string;
  projectName: string;
  status: TaskStatus;
  priority: TaskPriority;
  type: TaskType;
  updatedAt: string;
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
  provider: "openclaw" | "paperclip";
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  sessionId?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  durationMs?: number;
  errorMessage?: string;
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

export type ApprovalType = "hire_agent" | "approve_ceo_strategy" | "budget_override_required";
export type ApprovalStatus = "pending" | "revision_requested" | "approved" | "rejected" | "cancelled";

export interface OrchestrationApproval {
  id: string;
  companyId: string;
  type: ApprovalType;
  status: ApprovalStatus;
  requestedByAgentId: string | null;
  requestedByAgentName: string | null;
  payload: Record<string, unknown>;
  decisionNote: string | null;
  decidedByUserId: string | null;
  decidedAt: string | null;
  linkedTaskId: string | null;
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
  { id: "on-deck", label: "On Deck" },
  { id: "in-progress", label: "In Progress" },
  { id: "review", label: "Review" },
  { id: "done", label: "Done" },
];
