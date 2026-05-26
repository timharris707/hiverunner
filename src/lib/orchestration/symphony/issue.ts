import type { TaskExecutionEngine } from "@/lib/orchestration/types";

export type HiveRunnerSymphonyIssueRow = {
  id: string;
  task_key: string | null;
  title: string;
  description: string;
  priority: string;
  type: string;
  status: string;
  labels_json: string;
  depends_on_json: string;
  due_date: string | null;
  assignee_agent_id: string | null;
  blocked_reason: string | null;
  created_at: string | null;
  updated_at: string | null;
  project_id: string | null;
  project_slug: string | null;
  project_name: string | null;
  company_id: string;
  company_slug: string;
  company_code: string | null;
  company_name: string;
};

export type HiveRunnerSymphonyIssue = {
  id: string;
  identifier: string;
  title: string;
  description: string;
  priority: number | null;
  state: string;
  branch_name: string;
  url: string | null;
  assignee_id: string | null;
  blocked_by: Array<{ identifier: string }>;
  labels: string[];
  assigned_to_worker: boolean;
  created_at: string | null;
  updated_at: string | null;
  metadata: {
    source: "hiverunner";
    priority: string;
    type: string;
    status: string;
    dueDate: string | null;
    blockedReason: string | null;
    executionEngine?: TaskExecutionEngine;
    project: {
      id: string | null;
      slug: string | null;
      name: string | null;
    };
    company: {
      id: string;
      slug: string;
      code: string | null;
      name: string;
    };
  };
};

export function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

export function parseDependencyKeys(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        if (typeof item === "string") return item.trim();
        if (item && typeof item === "object") {
          const record = item as Record<string, unknown>;
          return stringFrom(record.taskKey) || stringFrom(record.key) || stringFrom(record.taskId) || stringFrom(record.id);
        }
        return "";
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function stringFrom(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function priorityRank(priority: string): number | null {
  switch (priority) {
    case "critical":
      return 1;
    case "high":
      return 2;
    case "medium":
      return 3;
    case "low":
      return 4;
    default:
      return null;
  }
}

export function branchNameForTask(row: Pick<HiveRunnerSymphonyIssueRow, "id" | "task_key" | "title">): string {
  const identifier = row.task_key ?? row.id;
  const source = `${identifier}-${row.title}`;
  const slug = source
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return slug || identifier;
}

export function taskUrlFor(
  row: Pick<HiveRunnerSymphonyIssueRow, "company_code" | "company_slug" | "task_key">,
  appBaseUrl?: string | null,
): string | null {
  const companyCode = row.company_code?.trim() || row.company_slug;
  const taskKey = row.task_key?.trim();
  if (!companyCode || !taskKey) return null;
  const baseUrl = stringFrom(appBaseUrl) || stringFrom(process.env.HIVERUNNER_APP_URL) || stringFrom(process.env.NEXT_PUBLIC_APP_URL);
  const pathPart = `/${encodeURIComponent(companyCode.toUpperCase())}/tasks/${encodeURIComponent(taskKey)}`;
  return baseUrl ? `${baseUrl.replace(/\/+$/g, "")}${pathPart}` : pathPart;
}

export function mapTaskRowToSymphonyIssue(
  row: HiveRunnerSymphonyIssueRow,
  options: {
    appBaseUrl?: string | null;
    executionEngine?: TaskExecutionEngine;
    assignedToWorker?: boolean;
  } = {},
): HiveRunnerSymphonyIssue {
  const dependencyKeys = parseDependencyKeys(row.depends_on_json);
  return {
    id: row.id,
    identifier: row.task_key ?? row.id,
    title: row.title,
    description: row.description,
    priority: priorityRank(row.priority),
    state: row.status,
    branch_name: branchNameForTask(row),
    url: taskUrlFor(row, options.appBaseUrl),
    assignee_id: row.assignee_agent_id,
    blocked_by: dependencyKeys.map((identifier) => ({ identifier })),
    labels: parseJsonArray(row.labels_json),
    assigned_to_worker: options.assignedToWorker ?? true,
    created_at: row.created_at,
    updated_at: row.updated_at,
    metadata: {
      source: "hiverunner",
      priority: row.priority,
      type: row.type,
      status: row.status,
      dueDate: row.due_date,
      blockedReason: row.blocked_reason,
      ...(options.executionEngine ? { executionEngine: options.executionEngine } : {}),
      project: {
        id: row.project_id,
        slug: row.project_slug,
        name: row.project_name,
      },
      company: {
        id: row.company_id,
        slug: row.company_slug,
        code: row.company_code,
        name: row.company_name,
      },
    },
  };
}
