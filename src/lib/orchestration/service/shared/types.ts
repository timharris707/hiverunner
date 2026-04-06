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
  TaskType,
} from "@/lib/orchestration/types";

export type DbTaskStatus =
  | "backlog"
  | "on_deck"
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
export type DbSprintStatus = "planning" | "active" | "completed";
export type CommentSource = "mission_control" | "paperclip" | "openclaw";

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
  total_tasks: number;
  in_progress_tasks: number;
  backlog_tasks: number;
  review_tasks: number;
  done_tasks: number;
};

export type TaskRow = {
  id: string;
  project_id: string;
  sprint_id: string | null;
  sprint_name: string | null;
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
  execution_mode: "paperclip" | "openclaw" | "manual";
  created_by: string | null;
  labels_json: string;
  source_review_id: string | null;
  source_takeaway_id: string | null;
  task_key: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export type SprintRow = {
  id: string;
  project_id: string;
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
  paperclip_agent_id: string | null;
  openclaw_agent_id: string | null;
  reporting_to: string | null;
  reporting_to_name?: string | null;
  skills_json: string;
  tasks_completed: number;
  total_runtime_minutes: number;
  last_heartbeat: string | null;
  created_at: string;
  updated_at: string;
};

export type TaskWithProjectRow = {
  id: string;
  project_id: string;
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
  labels_json: string;
  source_review_id: string | null;
  source_takeaway_id: string | null;
  review_notes: string | null;
  started_at: string | null;
  completed_at: string | null;
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
