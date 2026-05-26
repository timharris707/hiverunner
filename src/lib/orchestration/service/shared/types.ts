import type {
  AgentStatusInput,
  CommentTypeInput,
  ProjectStatusInput,
  SprintStatusInput,
  TaskPriorityInput,
  TaskStatusInput,
  TaskTypeInput,
} from "@/lib/orchestration/contracts";
import type {
  OrchestrationActivityEvent,
  OrchestrationAgent,
  OrchestrationProject,
  OrchestrationSprint,
  OrchestrationStaleAlert,
  OrchestrationTask,
  SprintStatus,
  TaskPriority,
  TaskStatus,
  TaskExecutionEngine,
  TaskType,
} from "@/lib/orchestration/types";

export type DbTaskStatus =
  | "backlog"
  | "to-do"
  | "in_progress"
  | "review"
  | "done"
  | "blocked";
export type DbTaskPriority = "critical" | "high" | "medium" | "low";
export type DbTaskType =
  | "feature"
  | "bug"
  | "maintenance"
  | "research"
  | "infrastructure"
  | "directive";
export type DbTaskExecutionEngine = TaskExecutionEngine;
export type DbSprintStatus = "planning" | "active" | "blocked" | "paused" | "completed";
export type CommentSource =
  | "mission_control"
  | "openclaw"
  | "anthropic"
  | "codex"
  | "gemini"
  | "hermes"
  | "symphony"
  | "engine"
  | "voice";

export type ProjectAggregateRow = {
  id: string;
  company_id: string | null;
  slug: string;
  name: string;
  description: string;
  color: string;
  status: ProjectStatusInput;
  owner_user_id: string | null;
  settings_json: string;
  created_at: string;
  archived_at: string | null;
  total_tasks: number;
  in_progress_tasks: number;
  backlog_tasks: number;
  review_tasks: number;
  done_tasks: number;
};

export type TaskRow = {
  id: string;
  company_id: string | null;
  project_id: string | null;
  sprint_id: string | null;
  sprint_key?: string | null;
  sprint_name: string | null;
  sprint_status?: DbSprintStatus | null;
  company_goal_id?: string | null;
  company_goal_key?: string | null;
  company_goal_name?: string | null;
  company_goal_status?: DbSprintStatus | null;
  parent_task_id: string | null;
  title: string;
  description: string;
  priority: DbTaskPriority;
  type: DbTaskType;
  status: DbTaskStatus;
  column_order: number;
  assignee_agent_id: string | null;
  assignee_name: string | null;
  blocked_reason: string | null;
  execution_engine: DbTaskExecutionEngine | null;
  execution_runtime_provider: string | null;
  execution_runtime_label: string | null;
  execution_model_routing: string | null;
  execution_model_routing_label: string | null;
  model_lane: "default" | "fast" | "mini" | "deep";
  run_provider?: string | null;
  run_runner_provider?: string | null;
  run_runner_model?: string | null;
  run_agent_id?: string | null;
  run_agent_name?: string | null;
  run_agent_model?: string | null;
  assignee_model?: string | null;
  source_agent_id?: string | null;
  source_agent_name?: string | null;
  source_agent_model?: string | null;
  source_run_provider?: string | null;
  source_run_runner_provider?: string | null;
  source_run_runner_model?: string | null;
  execution_mode: "openclaw" | "manual";
  created_by: string | null;
  created_by_display_name?: string | null;
  labels_json: string;
  depends_on_json: string;
  eligible_assignee_ids?: string | null;
  source_review_id: string | null;
  source_takeaway_id: string | null;
  task_key: string | null;
  due_date: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  project_settings_json?: string | null;
  company_settings_json?: string | null;
};

export type SprintRow = {
  id: string;
  project_id: string;
  sprint_key?: string | null;
  name: string;
  goal: string;
  status: DbSprintStatus;
  start_date: string;
  end_date: string | null;
  created_at: string;
  updated_at: string;
  task_count: number;
  in_progress_count: number;
  review_count: number;
  done_count: number;
};

export type CommentRow = {
  id: string;
  task_id: string;
  body: string;
  type: string;
  source: string | null;
  external_ref: string | null;
  created_at: string;
  author_name: string | null;
  author_emoji: string | null;
  author_user_id: string | null;
};

export type AgentRow = {
  id: string;
  company_id: string;
  project_id: string | null;
  name: string;
  slug: string | null;
  emoji: string | null;
  role: string;
  personality: string;
  avatar_url: string | null;
  status: "idle" | "working" | "paused" | "offline" | "error";
  current_task_id: string | null;
  current_task_title: string | null;
  model: string | null;
  adapter_type: string;
  runtime_slug: string | null;
  openclaw_agent_id: string | null;
  reporting_to: string | null;
  reporting_to_name?: string | null;
  hire_approval_id?: string | null;
  hire_approval_status?: "pending" | "revision_requested" | "approved" | "rejected" | "cancelled" | null;
  skills_json: string;
  tasks_completed: number;
  total_runtime_minutes: number;
  last_heartbeat: string | null;
  created_at: string;
  updated_at: string;
  archived_at?: string | null;
  avatar_style_id?: string | null;
  avatar_gender?: string | null;
  avatar_age?: number | null;
  avatar_hair_color?: string | null;
  avatar_hair_length?: string | null;
  avatar_eye_color?: string | null;
  avatar_vibe?: string | null;
  voice_id?: string | null;
};

export type TaskWithProjectRow = {
  id: string;
  company_id: string | null;
  project_id: string | null;
  sprint_id: string | null;
  parent_task_id: string | null;
  title: string;
  description: string;
  priority: DbTaskPriority;
  type: DbTaskType;
  assignee_agent_id: string | null;
  assigned_at: string | null;
  status: DbTaskStatus;
  column_order: number;
  blocked_reason: string | null;
  execution_engine: DbTaskExecutionEngine | null;
  execution_runtime_provider: string | null;
  execution_runtime_label: string | null;
  execution_model_routing: string | null;
  execution_model_routing_label: string | null;
  model_lane: "default" | "fast" | "mini" | "deep";
  labels_json: string;
  eligible_assignee_ids?: string | null;
  source_review_id: string | null;
  source_takeaway_id: string | null;
  review_notes: string | null;
  started_at: string | null;
  completed_at: string | null;
  due_date: string | null;
  project_settings_json?: string | null;
  company_settings_json?: string | null;
};

export type ProjectThemeRow = {
  company_theme_name: string | null;
  company_prompt_template: string | null;
  company_keywords_json: string | null;
  catalog_theme_name: string | null;
  catalog_prompt_template: string | null;
  catalog_keywords_json: string | null;
};

export type ActivityEventRow = {
  event_id: string;
  task_event_uuid: string | null;
  event_type:
    | "task.status_changed"
    | "task.assigned"
    | "task.unassigned"
    | "sprint.created"
    | "sprint.updated"
    | "sprint.completed";
  task_id: string | null;
  task_title: string | null;
  task_key: string | null;
  sprint_id: string | null;
  sprint_name: string | null;
  project_id: string;
  project_slug: string;
  project_name: string;
  company_id: string | null;
  company_slug: string | null;
  company_name: string | null;
  from_status: DbTaskStatus | null;
  to_status: DbTaskStatus | null;
  metadata_json: string | null;
  agent_id: string | null;
  agent_name: string | null;
  created_at: string;
};

export type StaleAlertCandidateRow = {
  task_id: string;
  task_title: string;
  task_status: DbTaskStatus;
  task_updated_at: string;
  assignee_name: string | null;
  project_id: string;
  project_slug: string;
  project_name: string;
  project_settings_json: string;
  company_id: string | null;
  company_slug: string | null;
  company_name: string | null;
};

export type StaleAlertThresholds = {
  review: number;
  inProgress: number;
  blocked: number;
};

export type ProjectSettings = {
  emoji: string;
  sourceWorkspaceRoot: string | null;
  staleAlertThresholdsHours: StaleAlertThresholds;
  extra: Record<string, unknown>;
};

export type {
  AgentStatusInput,
  CommentTypeInput,
  OrchestrationActivityEvent,
  OrchestrationAgent,
  OrchestrationProject,
  OrchestrationSprint,
  OrchestrationStaleAlert,
  OrchestrationTask,
  ProjectStatusInput,
  SprintStatus,
  SprintStatusInput,
  TaskPriority,
  TaskPriorityInput,
  TaskStatus,
  TaskStatusInput,
  TaskType,
  TaskTypeInput,
};
