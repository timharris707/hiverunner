import { AGENT_CONFIGS, getAgentByAnyId } from "@/config/agents";
import type {
  OrchestrationActivityEvent,
  OrchestrationAgentExecutionRun,
  OrchestrationAgentProfile,
  OrchestrationAgentProfileActivity,
  OrchestrationAgentProfileTask,
  OrchestrationCompanyGoal,
  OrchestrationCompanyInboxEvent,
  OrchestrationCompanyInboxTask,
  OrchestrationRoutine,
  OrchestrationRoutineListItem,
  AvatarThemePreset,
  BoardState,
  CompanyTheme,
  OrchestrationAgent,
  OrchestrationCompany,
  OrchestrationProject,
  OrchestrationSprint,
  OrchestrationStaleAlert,
  OrchestrationTask,
  TaskStatus,
} from "@/lib/orchestration/types";

type JsonRecord = Record<string, unknown>;

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function normalizeProject(raw: JsonRecord): OrchestrationProject {
  return {
    id: String(raw.id ?? ""),
    companyId: raw.companyId ? String(raw.companyId) : raw.company_id ? String(raw.company_id) : undefined,
    slug: String(raw.slug ?? raw.id ?? ""),
    name: String(raw.name ?? "Untitled Project"),
    description: String(raw.description ?? "No description yet."),
    emoji: String(raw.emoji ?? "🛰️"),
    color: String(raw.color ?? "#22d3ee"),
    owner: raw.owner ? String(raw.owner) : undefined,
    status: (raw.status as OrchestrationProject["status"]) ?? "active",
    created: String(raw.created ?? raw.created_at ?? new Date().toISOString()),
    repo: raw.repo ? String(raw.repo) : undefined,
    taskCount: Number(raw.taskCount ?? 0),
    inProgress: Number(raw.inProgress ?? 0),
    backlog: Number(raw.backlog ?? 0),
    review: Number(raw.review ?? 0),
    completed: Number(raw.completed ?? 0),
    velocity: raw.velocity ? Number(raw.velocity) : undefined,
    activeAgents: raw.activeAgents ? Number(raw.activeAgents) : undefined,
  };
}

function normalizeCompany(raw: JsonRecord): OrchestrationCompany {
  const theme = normalizeCompanyTheme((raw.theme ?? {}) as JsonRecord);
  const stats = (raw.stats ?? {}) as JsonRecord;
  const workspace = (raw.workspace ?? {}) as JsonRecord;

  const slug = String(raw.slug ?? raw.id ?? "");
  return {
    id: String(raw.id ?? ""),
    slug,
    code: String(raw.code ?? slug.slice(0, 3).toUpperCase()),
    name: String(raw.name ?? "Untitled Company"),
    description: String(raw.description ?? ""),
    status: (String(raw.status ?? "active") as OrchestrationCompany["status"]) ?? "active",
    created: String(raw.created ?? raw.created_at ?? new Date().toISOString()),
    workspace: {
      root: String(workspace.root ?? raw.workspace_root ?? ""),
      source: String(
        workspace.source ?? raw.workspace_source ?? "manual"
      ) as OrchestrationCompany["workspace"]["source"],
    },
    theme,
    stats: {
      projects: Number(stats.projects ?? 0),
      agents: Number(stats.agents ?? 0),
      activeTasks: Number(stats.activeTasks ?? 0),
    },
  };
}

function normalizeCompanyTheme(raw: JsonRecord): CompanyTheme {
  return {
    name: String(raw.name ?? "Corporate Noir"),
    promptTemplate: String(raw.promptTemplate ?? ""),
    keywords: Array.isArray(raw.keywords) ? raw.keywords.map((keyword) => String(keyword)) : [],
    sampleUrl: raw.sampleUrl ? String(raw.sampleUrl) : undefined,
  };
}

function normalizeThemePreset(raw: JsonRecord): AvatarThemePreset {
  return {
    id: String(raw.id ?? ""),
    name: String(raw.name ?? "Untitled Theme"),
    description: String(raw.description ?? ""),
    promptTemplate: String(raw.promptTemplate ?? ""),
    keywords: Array.isArray(raw.keywords) ? raw.keywords.map((keyword) => String(keyword)) : [],
  };
}

export async function listCompanies(): Promise<OrchestrationCompany[]> {
  const data = await fetchJson<{ companies: JsonRecord[] }>("/api/orchestration/companies?includeNonProduction=true");
  return (data?.companies ?? []).map(normalizeCompany);
}

export async function createCompany(input: {
  name: string;
  description: string;
  theme: { name: string; promptTemplate: string; keywords: string[] };
}): Promise<OrchestrationCompany | null> {
  const response = await fetch("/api/orchestration/companies", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).catch(() => null);

  if (!response?.ok) return null;
  const json = (await response.json()) as { company?: JsonRecord };
  if (!json.company) return null;
  return normalizeCompany(json.company);
}

export async function listAvatarThemePresets(): Promise<AvatarThemePreset[]> {
  const data = await fetchJson<{ presets: JsonRecord[] }>("/api/orchestration/themes/presets");
  return (data?.presets ?? []).map(normalizeThemePreset);
}

export async function getCompanyTheme(companySlug: string): Promise<CompanyTheme | null> {
  const data = await fetchJson<{ theme?: JsonRecord }>(`/api/orchestration/companies/${companySlug}/theme`);
  if (!data?.theme) return null;
  return normalizeCompanyTheme(data.theme);
}

export async function updateCompanyTheme(
  companySlug: string,
  input: {
    presetId?: string;
    name?: string;
    promptTemplate?: string;
    keywords?: string[];
    sampleUrl?: string | null;
  }
): Promise<CompanyTheme | null> {
  const response = await fetch(`/api/orchestration/companies/${companySlug}/theme`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).catch(() => null);

  if (!response?.ok) return null;
  const json = (await response.json()) as { theme?: JsonRecord };
  if (!json.theme) return null;
  return normalizeCompanyTheme(json.theme);
}

export async function resetCompanyTheme(companySlug: string): Promise<CompanyTheme | null> {
  const response = await fetch(`/api/orchestration/companies/${companySlug}/theme`, {
    method: "DELETE",
  }).catch(() => null);

  if (!response?.ok) return null;
  const json = (await response.json()) as { theme?: JsonRecord };
  if (!json.theme) return null;
  return normalizeCompanyTheme(json.theme);
}

function normalizeTask(raw: JsonRecord): OrchestrationTask {
  const baseStatus = String(raw.status ?? "backlog");
  const normalizedStatus = (baseStatus === "on_deck" ? "on-deck" : baseStatus) as TaskStatus;
  const type = String(raw.type ?? "feature") as OrchestrationTask["type"];
  const resolvedColumnOrder = Number(raw.columnOrder ?? raw.column_order);
  const columnOrder = Number.isFinite(resolvedColumnOrder) ? resolvedColumnOrder : undefined;

  return {
    id: String(raw.id ?? ""),
    key: raw.key ? String(raw.key) : raw.task_key ? String(raw.task_key) : undefined,
    title: String(raw.title ?? "Untitled Task"),
    description: raw.description ? String(raw.description) : undefined,
    parentTaskId: raw.parentTaskId
      ? String(raw.parentTaskId)
      : raw.parent_task_id
      ? String(raw.parent_task_id)
      : undefined,
    status: normalizedStatus,
    columnOrder,
    priority: (String(raw.priority ?? "P2") as OrchestrationTask["priority"]) ?? "P2",
    type,
    project: String(raw.project ?? raw.projectId ?? raw.project_id ?? ""),
    assignee: raw.assignee ? String(raw.assignee) : undefined,
    tags: Array.isArray(raw.tags) ? raw.tags.map((tag) => String(tag)) : [],
    sprint: raw.sprint ? String(raw.sprint) : undefined,
    blockedReason: raw.blockedReason ? String(raw.blockedReason) : undefined,
    executionMode:
      raw.executionMode === "openclaw" || raw.executionMode === "paperclip" || raw.executionMode === "manual"
        ? raw.executionMode
        : raw.execution_mode === "openclaw" || raw.execution_mode === "paperclip" || raw.execution_mode === "manual"
        ? raw.execution_mode
        : undefined,
    sourceReviewId: raw.sourceReviewId ? String(raw.sourceReviewId) : raw.source_review_id ? String(raw.source_review_id) : undefined,
    sourceTakeawayId: raw.sourceTakeawayId
      ? String(raw.sourceTakeawayId)
      : raw.source_takeaway_id
      ? String(raw.source_takeaway_id)
      : undefined,
    created: String(raw.created ?? raw.created_at ?? new Date().toISOString()),
    updated: String(raw.updated ?? raw.updated_at ?? new Date().toISOString()),
    completedAt: raw.completedAt
      ? String(raw.completedAt)
      : raw.completed_at
      ? String(raw.completed_at)
      : undefined,
    comments: Array.isArray(raw.comments)
      ? raw.comments.map((comment) => {
          const c = comment as JsonRecord;
          return {
            id: String(c.id ?? crypto.randomUUID()),
            author: String(c.author ?? "Unknown"),
            authorEmoji: c.authorEmoji ? String(c.authorEmoji) : undefined,
            text: String(c.text ?? ""),
            timestamp: String(c.timestamp ?? new Date().toISOString()),
            type: c.type ? String(c.type) : undefined,
          };
        })
      : [],
  };
}

function normalizeSprint(raw: JsonRecord): OrchestrationSprint {
  return {
    id: String(raw.id ?? ""),
    projectId: String(raw.projectId ?? raw.project_id ?? ""),
    name: String(raw.name ?? "Untitled Sprint"),
    goal: String(raw.goal ?? ""),
    status: (String(raw.status ?? "planned") as OrchestrationSprint["status"]) ?? "planned",
    startDate: String(raw.startDate ?? raw.start_date ?? new Date().toISOString()),
    endDate: raw.endDate || raw.end_date ? String(raw.endDate ?? raw.end_date) : undefined,
    created: String(raw.created ?? raw.created_at ?? new Date().toISOString()),
    updated: String(raw.updated ?? raw.updated_at ?? new Date().toISOString()),
    taskCount: Number(raw.taskCount ?? 0),
    inProgressCount: Number(raw.inProgressCount ?? 0),
    reviewCount: Number(raw.reviewCount ?? 0),
    doneCount: Number(raw.doneCount ?? 0),
    parentId: raw.parentId ? String(raw.parentId) : undefined,
    owner: raw.owner ? String(raw.owner) : undefined,
  };
}

function normalizeCompanyInboxTask(raw: JsonRecord): OrchestrationCompanyInboxTask {
  const task = normalizeTask(raw);
  return {
    ...task,
    projectId: String(raw.projectId ?? raw.project_id ?? task.project),
    projectSlug: String(raw.projectSlug ?? raw.project_slug ?? task.project),
    projectName: String(raw.projectName ?? raw.project_name ?? "Unknown Project"),
    projectColor: String(raw.projectColor ?? raw.project_color ?? "#22d3ee"),
  };
}

function normalizeCompanyInboxEvent(raw: JsonRecord): OrchestrationCompanyInboxEvent {
  const event: OrchestrationCompanyInboxEvent = {
    id: String(raw.id ?? crypto.randomUUID()),
    eventType:
      (String(raw.eventType ?? raw.event_type ?? "task.updated") as OrchestrationCompanyInboxEvent["eventType"]) ??
      "task.updated",
    kind: (String(raw.kind ?? "task") as OrchestrationCompanyInboxEvent["kind"]) ?? "task",
    companyId: String(raw.companyId ?? raw.company_id ?? ""),
    companySlug: String(raw.companySlug ?? raw.company_slug ?? ""),
    companyName: String(raw.companyName ?? raw.company_name ?? "Unknown Company"),
    projectId: String(raw.projectId ?? raw.project_id ?? ""),
    projectSlug: String(raw.projectSlug ?? raw.project_slug ?? ""),
    projectName: String(raw.projectName ?? raw.project_name ?? "Unknown Project"),
    taskId: raw.taskId ? String(raw.taskId) : raw.task_id ? String(raw.task_id) : undefined,
    taskTitle: raw.taskTitle ? String(raw.taskTitle) : raw.task_title ? String(raw.task_title) : undefined,
    taskKey: raw.taskKey ? String(raw.taskKey) : raw.task_key ? String(raw.task_key) : undefined,
    status: raw.status ? (String(raw.status) as TaskStatus) : undefined,
    agentId: raw.agentId ? String(raw.agentId) : raw.agent_id ? String(raw.agent_id) : undefined,
    agentName: raw.agentName ? String(raw.agentName) : raw.agent_name ? String(raw.agent_name) : undefined,
    provider:
      raw.provider === "openclaw" || raw.provider === "paperclip"
        ? raw.provider
        : undefined,
    message: String(raw.message ?? ""),
    timestamp: String(raw.timestamp ?? raw.created_at ?? new Date().toISOString()),
    isRead: typeof raw.isRead === "boolean" ? raw.isRead : undefined,
    approvalId: raw.approvalId ? String(raw.approvalId) : undefined,
    approvalType: raw.approvalType ? String(raw.approvalType) as OrchestrationCompanyInboxEvent["approvalType"] : undefined,
    approvalStatus: raw.approvalStatus ? String(raw.approvalStatus) as OrchestrationCompanyInboxEvent["approvalStatus"] : undefined,
    approvalLabel: raw.approvalLabel ? String(raw.approvalLabel) : undefined,
    requestedByName: raw.requestedByName ? String(raw.requestedByName) : undefined,
  };
  return event;
}

function normalizeCompanyGoal(raw: JsonRecord): OrchestrationCompanyGoal {
  return {
    sprint: normalizeSprint((raw.sprint ?? {}) as JsonRecord),
    projectId: String(raw.projectId ?? raw.project_id ?? ""),
    projectSlug: String(raw.projectSlug ?? raw.project_slug ?? ""),
    projectName: String(raw.projectName ?? raw.project_name ?? "Unknown Project"),
    projectColor: String(raw.projectColor ?? raw.project_color ?? "#22d3ee"),
    completionPercent: Number(raw.completionPercent ?? 0),
    remainingTasks: Number(raw.remainingTasks ?? 0),
  };
}

export async function listProjects(input?: {
  company?: string;
  includeArchived?: boolean;
  includeNonProduction?: boolean;
}): Promise<OrchestrationProject[]> {
  const params = new URLSearchParams();
  if (typeof input?.includeArchived === "boolean") {
    params.set("includeArchived", input.includeArchived ? "true" : "false");
  }
  if (typeof input?.includeNonProduction === "boolean") {
    params.set("includeNonProduction", input.includeNonProduction ? "true" : "false");
  }
  const query = params.toString();
  const url = input?.company
    ? `/api/orchestration/companies/${encodeURIComponent(input.company)}/projects${query ? `?${query}` : ""}`
    : `/api/orchestration/projects${query ? `?${query}` : ""}`;
  const data = await fetchJson<{ projects: JsonRecord[] }>(url);
  return (data?.projects ?? []).map(normalizeProject);
}

export async function getCompanyInbox(input: {
  companySlug: string;
  projectId?: string;
  status?: TaskStatus;
  search?: string;
  includeDone?: boolean;
  limit?: number;
  cursor?: string;
  unreadSince?: string;
  includeTaskSnapshot?: boolean;
}): Promise<{
  events: OrchestrationCompanyInboxEvent[];
  page: { limit: number; nextCursor?: string; hasMore: boolean };
  unreadCount: number;
  unreadSince?: string;
  tasks: OrchestrationCompanyInboxTask[];
  totals: Record<"backlog" | "on-deck" | "in-progress" | "review" | "done" | "blocked", number>;
} | null> {
  const params = new URLSearchParams();
  if (input.projectId) params.set("projectId", input.projectId);
  if (input.status) params.set("status", input.status);
  if (input.search?.trim()) params.set("search", input.search.trim());
  if (typeof input.includeDone === "boolean") params.set("includeDone", input.includeDone ? "true" : "false");
  if (typeof input.limit === "number") params.set("limit", String(input.limit));
  if (input.cursor) params.set("cursor", input.cursor);
  if (input.unreadSince) params.set("unreadSince", input.unreadSince);
  if (typeof input.includeTaskSnapshot === "boolean") {
    params.set("includeTaskSnapshot", input.includeTaskSnapshot ? "true" : "false");
  }

  const query = params.toString();
  const data = await fetchJson<{
    events?: JsonRecord[];
    page?: { limit?: number; nextCursor?: string; hasMore?: boolean };
    unreadCount?: number;
    unreadSince?: string;
    tasks?: JsonRecord[];
    totals?: Record<"backlog" | "on-deck" | "in-progress" | "review" | "done" | "blocked", number>;
  }>(`/api/orchestration/companies/${encodeURIComponent(input.companySlug)}/inbox${query ? `?${query}` : ""}`);

  if (!data) return null;
  return {
    events: (data.events ?? []).map(normalizeCompanyInboxEvent),
    page: {
      limit: Number(data.page?.limit ?? input.limit ?? 50),
      nextCursor: data.page?.nextCursor,
      hasMore: Boolean(data.page?.hasMore),
    },
    unreadCount: Number(data.unreadCount ?? 0),
    unreadSince: data.unreadSince,
    tasks: (data.tasks ?? []).map(normalizeCompanyInboxTask),
    totals: data.totals ?? {
      backlog: 0,
      "on-deck": 0,
      "in-progress": 0,
      review: 0,
      done: 0,
      blocked: 0,
    },
  };
}

export async function markInboxEventsRead(companySlug: string, eventIds: string[]): Promise<boolean> {
  try {
    const response = await fetch(`/api/orchestration/companies/${encodeURIComponent(companySlug)}/inbox/read`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventIds }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function markAllInboxRead(companySlug: string): Promise<boolean> {
  try {
    const response = await fetch(`/api/orchestration/companies/${encodeURIComponent(companySlug)}/inbox/read`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function listCompanyGoals(input: {
  companySlug: string;
  projectId?: string;
  status?: OrchestrationSprint["status"];
  includeCompleted?: boolean;
}): Promise<{
  goals: OrchestrationCompanyGoal[];
  summary: {
    total: number;
    planned: number;
    active: number;
    done: number;
    completionPercent: number;
  };
} | null> {
  const params = new URLSearchParams();
  if (input.projectId) params.set("projectId", input.projectId);
  if (input.status) params.set("status", input.status);
  if (typeof input.includeCompleted === "boolean") {
    params.set("includeCompleted", input.includeCompleted ? "true" : "false");
  }

  const query = params.toString();
  const data = await fetchJson<{
    goals?: JsonRecord[];
    summary?: {
      total?: number;
      planned?: number;
      active?: number;
      done?: number;
      completionPercent?: number;
    };
  }>(`/api/orchestration/companies/${encodeURIComponent(input.companySlug)}/goals${query ? `?${query}` : ""}`);

  if (!data) return null;
  return {
    goals: (data.goals ?? []).map(normalizeCompanyGoal),
    summary: {
      total: Number(data.summary?.total ?? 0),
      planned: Number(data.summary?.planned ?? 0),
      active: Number(data.summary?.active ?? 0),
      done: Number(data.summary?.done ?? 0),
      completionPercent: Number(data.summary?.completionPercent ?? 0),
    },
  };
}

export async function createCompanyGoal(input: {
  companySlug: string;
  projectId: string;
  name: string;
  goal?: string;
  status?: OrchestrationSprint["status"];
  startDate?: string;
  endDate?: string | null;
  parentId?: string;
  owner?: string | null;
}): Promise<OrchestrationCompanyGoal | null> {
  const response = await fetch(`/api/orchestration/companies/${encodeURIComponent(input.companySlug)}/goals`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: input.projectId,
      name: input.name,
      goal: input.goal ?? "",
      status: input.status ?? "planned",
      ...(input.startDate ? { startDate: input.startDate } : {}),
      ...(input.endDate !== undefined ? { endDate: input.endDate } : {}),
      ...(input.parentId ? { parentId: input.parentId } : {}),
      ...(input.owner !== undefined ? { owner: input.owner } : {}),
    }),
  }).catch(() => null);

  if (!response?.ok) return null;
  const data = (await response.json()) as { goal?: JsonRecord };
  if (!data.goal) return null;
  return normalizeCompanyGoal(data.goal);
}

export async function updateCompanyGoal(input: {
  companySlug: string;
  sprintId: string;
  name?: string;
  goal?: string;
  status?: OrchestrationSprint["status"];
  startDate?: string;
  endDate?: string | null;
  parentId?: string | null;
  owner?: string | null;
}): Promise<OrchestrationCompanyGoal | null> {
  const response = await fetch(`/api/orchestration/companies/${encodeURIComponent(input.companySlug)}/goals`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sprintId: input.sprintId,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.goal !== undefined ? { goal: input.goal } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.startDate !== undefined ? { startDate: input.startDate } : {}),
      ...(input.endDate !== undefined ? { endDate: input.endDate } : {}),
      ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
      ...(input.owner !== undefined ? { owner: input.owner } : {}),
    }),
  }).catch(() => null);

  if (!response?.ok) return null;
  const data = (await response.json()) as { goal?: JsonRecord };
  if (!data.goal) return null;
  return normalizeCompanyGoal(data.goal);
}

export async function deleteCompanyGoal(input: {
  companySlug: string;
  sprintId: string;
}): Promise<{ sprintId: string; projectId: string; deletedAt: string } | null> {
  const response = await fetch(`/api/orchestration/companies/${encodeURIComponent(input.companySlug)}/goals`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sprintId: input.sprintId }),
  }).catch(() => null);

  if (!response?.ok) return null;
  const data = (await response.json()) as {
    sprintId?: string;
    projectId?: string;
    deletedAt?: string;
  };

  if (!data.sprintId || !data.projectId || !data.deletedAt) return null;
  return {
    sprintId: String(data.sprintId),
    projectId: String(data.projectId),
    deletedAt: String(data.deletedAt),
  };
}

export async function listActivityFeed(input?: {
  limit?: number;
  cursor?: string;
  projectId?: string;
  agentId?: string;
}): Promise<{
  activity: OrchestrationActivityEvent[];
  page: { limit: number; nextCursor?: string; hasMore: boolean };
} | null> {
  const params = new URLSearchParams();
  if (typeof input?.limit === "number") params.set("limit", String(input.limit));
  if (input?.cursor) params.set("cursor", input.cursor);
  if (input?.projectId) params.set("projectId", input.projectId);
  if (input?.agentId) params.set("agentId", input.agentId);

  const query = params.toString();
  const url = `/api/orchestration/activity${query ? `?${query}` : ""}`;
  const data = await fetchJson<{
    activity: JsonRecord[];
    page?: { limit?: number; nextCursor?: string; hasMore?: boolean };
  }>(url);

  if (!data) return null;

  return {
    activity: (data.activity ?? []).map((raw) => ({
      id: String(raw.id ?? ""),
      eventType: String(raw.eventType ?? "task.status_changed") as OrchestrationActivityEvent["eventType"],
      projectId: String(raw.projectId ?? ""),
      projectSlug: String(raw.projectSlug ?? ""),
      projectName: String(raw.projectName ?? ""),
      companyId: raw.companyId ? String(raw.companyId) : undefined,
      companySlug: raw.companySlug ? String(raw.companySlug) : undefined,
      companyName: raw.companyName ? String(raw.companyName) : undefined,
      taskId: raw.taskId ? String(raw.taskId) : undefined,
      taskTitle: raw.taskTitle ? String(raw.taskTitle) : undefined,
      taskKey: raw.taskKey ? String(raw.taskKey) : undefined,
      sprintId: raw.sprintId ? String(raw.sprintId) : undefined,
      sprintName: raw.sprintName ? String(raw.sprintName) : undefined,
      oldStatus: raw.oldStatus
        ? (String(raw.oldStatus) as OrchestrationActivityEvent["oldStatus"])
        : undefined,
      newStatus: raw.newStatus
        ? (String(raw.newStatus) as OrchestrationActivityEvent["newStatus"])
        : undefined,
      message: String(raw.message ?? "Activity updated"),
      agentId: raw.agentId ? String(raw.agentId) : undefined,
      agentName: raw.agentName ? String(raw.agentName) : undefined,
      timestamp: String(raw.timestamp ?? new Date().toISOString()),
    })),
    page: {
      limit: Number(data.page?.limit ?? input?.limit ?? 50),
      nextCursor: data.page?.nextCursor,
      hasMore: Boolean(data.page?.hasMore),
    },
  };
}

export async function listStaleTaskAlerts(projectId?: string): Promise<{
  generatedAt: string;
  defaults: { review: number; inProgress: number; blocked: number };
  alerts: OrchestrationStaleAlert[];
} | null> {
  const params = new URLSearchParams();
  if (projectId) params.set("projectId", projectId);
  const query = params.toString();
  const url = `/api/orchestration/alerts${query ? `?${query}` : ""}`;

  const data = await fetchJson<{
    generatedAt?: string;
    defaults?: { review?: number; inProgress?: number; blocked?: number };
    alerts?: JsonRecord[];
  }>(url);
  if (!data) return null;

  return {
    generatedAt: String(data.generatedAt ?? new Date().toISOString()),
    defaults: {
      review: Number(data.defaults?.review ?? 1),
      inProgress: Number(data.defaults?.inProgress ?? 4),
      blocked: Number(data.defaults?.blocked ?? 2),
    },
    alerts: (data.alerts ?? []).map((raw) => ({
      taskId: String(raw.taskId ?? ""),
      taskTitle: String(raw.taskTitle ?? "Untitled Task"),
      taskStatus: (String(raw.taskStatus ?? "backlog") as OrchestrationStaleAlert["taskStatus"]),
      projectId: String(raw.projectId ?? ""),
      projectSlug: String(raw.projectSlug ?? ""),
      projectName: String(raw.projectName ?? ""),
      companyId: raw.companyId ? String(raw.companyId) : undefined,
      companySlug: raw.companySlug ? String(raw.companySlug) : undefined,
      companyName: raw.companyName ? String(raw.companyName) : undefined,
      assignee: raw.assignee ? String(raw.assignee) : undefined,
      lastUpdatedAt: String(raw.lastUpdatedAt ?? new Date().toISOString()),
      staleMinutes: Number(raw.staleMinutes ?? 0),
      thresholdMinutes: Number(raw.thresholdMinutes ?? 0),
      exceededMinutes: Number(raw.exceededMinutes ?? 0),
    })),
  };
}

export async function createProject(input: {
  companyId: string;
  name: string;
  slug?: string;
  description?: string;
  color?: string;
  emoji?: string;
  owner?: string;
  status?: "active" | "paused" | "archived";
  avatarThemeName?: string;
}): Promise<OrchestrationProject | null> {
  const response = await fetch("/api/orchestration/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      companyId: input.companyId,
      name: input.name,
      ...(input.slug ? { slug: input.slug } : {}),
      description: input.description ?? "",
      color: input.color ?? "#0ea5e9",
      emoji: input.emoji ?? "🛰️",
      ...(input.owner ? { owner: input.owner } : {}),
      status: input.status ?? "active",
      ...(input.avatarThemeName ? { avatarThemeName: input.avatarThemeName } : {}),
    }),
  }).catch(() => null);

  if (!response?.ok) return null;
  const json = (await response.json()) as { project?: JsonRecord };
  if (!json.project) return null;
  return normalizeProject(json.project);
}

export async function updateProjectSettings(input: {
  projectIdOrSlug: string;
  emoji?: string;
  status?: "active" | "paused" | "archived";
  staleAlertThresholdsHours?: {
    review?: number;
    inProgress?: number;
    blocked?: number;
  };
}): Promise<OrchestrationProject | null> {
  const response = await fetch(`/api/orchestration/projects/${encodeURIComponent(input.projectIdOrSlug)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...(input.emoji !== undefined ? { emoji: input.emoji } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.staleAlertThresholdsHours !== undefined
        ? { staleAlertThresholdsHours: input.staleAlertThresholdsHours }
        : {}),
    }),
  }).catch(() => null);

  if (!response?.ok) return null;
  const json = (await response.json()) as { project?: JsonRecord };
  if (!json.project) return null;
  return normalizeProject(json.project);
}

export async function getProjectBoard(projectId: string): Promise<BoardState | null> {
  const orchestrationBoard = await fetchJson<{
    project: JsonRecord;
    tasks: JsonRecord[];
  }>(`/api/orchestration/projects/${projectId}/board`);

  if (orchestrationBoard?.project) {
    return {
      project: normalizeProject(orchestrationBoard.project),
      tasks: (orchestrationBoard.tasks ?? []).map(normalizeTask),
    };
  }

  const legacyProject = await fetchJson<{ project: JsonRecord; tasks: JsonRecord[] }>(`/api/projects/${projectId}`);
  if (!legacyProject?.project) return null;

  return {
    project: normalizeProject(legacyProject.project),
    tasks: (legacyProject.tasks ?? []).map(normalizeTask),
  };
}

export async function getProjectBoardUpdatedAt(projectId: string): Promise<string | null> {
  const payload = await fetchJson<{ updatedAt?: unknown }>(
    `/api/orchestration/projects/${projectId}/board/updated-at`
  );
  if (!payload?.updatedAt) return null;
  return String(payload.updatedAt);
}

export async function updateTaskStatus(
  taskId: string,
  status: TaskStatus,
  columnOrder?: number
): Promise<boolean> {
  const orchestrationRes = await fetch("/api/orchestration/tasks/reorder", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ taskId, status, columnOrder }),
  }).catch(() => null);

  if (orchestrationRes?.ok) return true;

  const legacyRes = await fetch("/api/tasks", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: taskId, status }),
  }).catch(() => null);

  return Boolean(legacyRes?.ok);
}

export async function updateTaskAssignee(taskId: string, assignee: string): Promise<boolean> {
  const orchestrationRes = await fetch(`/api/orchestration/tasks/${taskId}/assign`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assignee }),
  }).catch(() => null);

  if (orchestrationRes?.ok) return true;

  const legacyRes = await fetch("/api/tasks", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: taskId, assignee }),
  }).catch(() => null);

  return Boolean(legacyRes?.ok);
}

export async function listProjectAgents(projectId: string, tasks: OrchestrationTask[]): Promise<OrchestrationAgent[]> {
  const orchestrationData = await fetchJson<{ agents: JsonRecord[] }>(`/api/orchestration/projects/${projectId}/agents`);
  if (orchestrationData?.agents?.length) {
    return orchestrationData.agents.map((agent) => {
      const a = agent as JsonRecord;
      return {
        id: String(a.id ?? "unknown"),
        companyId: a.companyId ? String(a.companyId) : undefined,
        projectId: a.projectId ? String(a.projectId) : a.project_id ? String(a.project_id) : projectId,
        name: String(a.name ?? "Unknown"),
        emoji: String(a.emoji ?? "🤖"),
        role: String(a.role ?? "Agent"),
        avatar: a.avatar ? String(a.avatar) : undefined,
        status: (String(a.status ?? "idle") as OrchestrationAgent["status"]) ?? "idle",
        currentTask: a.currentTask ? String(a.currentTask) : undefined,
        personality: a.personality ? String(a.personality) : undefined,
        model: a.model ? String(a.model) : undefined,
        paperclipAgentId: a.paperclipAgentId ? String(a.paperclipAgentId) : undefined,
        openclawAgentId: a.openclawAgentId ? String(a.openclawAgentId) : undefined,
        reportingTo: a.reportingTo ? String(a.reportingTo) : undefined,
        skills: Array.isArray(a.skills) ? a.skills.map((skill) => String(skill)) : undefined,
        tasksCompleted: a.tasksCompleted ? Number(a.tasksCompleted) : undefined,
        totalRuntimeMinutes: a.totalRuntimeMinutes ? Number(a.totalRuntimeMinutes) : undefined,
        lastHeartbeat: a.lastHeartbeat ? String(a.lastHeartbeat) : undefined,
        created: a.created ? String(a.created) : undefined,
        updated: a.updated ? String(a.updated) : undefined,
      };
    });
  }

  const assignees = new Set(tasks.map((task) => task.assignee).filter(Boolean) as string[]);
  const candidates = AGENT_CONFIGS.filter((agent) => assignees.has(agent.name) || assignees.has(agent.id));

  return candidates.map((agent) => {
    const workingTask = tasks.find((task) => {
      const resolved = getAgentByAnyId(task.assignee ?? "");
      return resolved?.id === agent.id && task.status === "in-progress";
    });

    return {
      id: agent.id,
      projectId,
      name: agent.name,
      emoji: agent.emoji,
      role: agent.role,
      avatar: agent.avatar,
      status: workingTask ? "working" : "idle",
      currentTask: workingTask?.title,
    };
  });
}

export async function listCompanyAgents(companySlug: string): Promise<OrchestrationAgent[]> {
  const data = await fetchJson<{ agents: JsonRecord[] }>(`/api/orchestration/companies/${companySlug}/agents`);
  if (!data?.agents?.length) return [];

  return data.agents.map((raw) => {
    const a = raw as JsonRecord;
    const name = String(a.name ?? "Unknown");
    return {
      id: String(a.id ?? "unknown"),
      slug: String(a.slug ?? name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")),
      companyId: a.companyId ? String(a.companyId) : undefined,
      projectId: a.projectId ? String(a.projectId) : a.project_id ? String(a.project_id) : undefined,
      name,
      emoji: String(a.emoji ?? "🤖"),
      role: String(a.role ?? "Agent"),
      avatar: a.avatar ? String(a.avatar) : undefined,
      status: (String(a.status ?? "idle") as OrchestrationAgent["status"]) ?? "idle",
      currentTask: a.currentTask ? String(a.currentTask) : undefined,
      personality: a.personality ? String(a.personality) : undefined,
      model: a.model ? String(a.model) : undefined,
      paperclipAgentId: a.paperclipAgentId ? String(a.paperclipAgentId) : undefined,
      openclawAgentId: a.openclawAgentId ? String(a.openclawAgentId) : undefined,
      reportingTo: a.reportingTo ? String(a.reportingTo) : undefined,
      reportingToName: a.reportingToName ? String(a.reportingToName) : undefined,
      skills: Array.isArray(a.skills) ? a.skills.map((skill) => String(skill)) : undefined,
      tasksCompleted: a.tasksCompleted ? Number(a.tasksCompleted) : undefined,
      totalRuntimeMinutes: a.totalRuntimeMinutes ? Number(a.totalRuntimeMinutes) : undefined,
      lastHeartbeat: a.lastHeartbeat ? String(a.lastHeartbeat) : undefined,
      created: a.created ? String(a.created) : undefined,
      updated: a.updated ? String(a.updated) : undefined,
    };
  });
}

export async function getCompanyAgentProfile(
  companySlug: string,
  agentId: string,
  input?: { executionLimit?: number; activityLimit?: number }
): Promise<OrchestrationAgentProfile | null> {
  const params = new URLSearchParams();
  if (typeof input?.executionLimit === "number") params.set("executionLimit", String(input.executionLimit));
  if (typeof input?.activityLimit === "number") params.set("activityLimit", String(input.activityLimit));
  const query = params.toString();
  const url = `/api/orchestration/companies/${encodeURIComponent(companySlug)}/agents/${encodeURIComponent(agentId)}${query ? `?${query}` : ""}`;

  const data = await fetchJson<{
    company?: JsonRecord;
    agent?: JsonRecord;
    currentTasks?: JsonRecord[];
    recentActivity?: JsonRecord[];
    executionHistory?: JsonRecord[];
    liveSession?: JsonRecord;
  }>(url);
  if (!data?.company || !data?.agent) return null;

  const companyRaw = data.company as JsonRecord;
  const agentRaw = data.agent as JsonRecord;
  const normalizeProfileTask = (raw: JsonRecord): OrchestrationAgentProfileTask => ({
    id: String(raw.id ?? ""),
    title: String(raw.title ?? "Untitled Task"),
    projectId: String(raw.projectId ?? ""),
    projectSlug: String(raw.projectSlug ?? ""),
    projectName: String(raw.projectName ?? ""),
    status: String(raw.status ?? "backlog") as OrchestrationAgentProfileTask["status"],
    priority: String(raw.priority ?? "P2") as OrchestrationAgentProfileTask["priority"],
    type: String(raw.type ?? "feature") as OrchestrationAgentProfileTask["type"],
    updatedAt: String(raw.updatedAt ?? new Date().toISOString()),
  });

  const normalizeProfileActivity = (raw: JsonRecord): OrchestrationAgentProfileActivity => ({
    id: String(raw.id ?? ""),
    kind: raw.kind === "event" ? "event" : "comment",
    taskId: String(raw.taskId ?? ""),
    taskTitle: String(raw.taskTitle ?? "Untitled Task"),
    projectId: String(raw.projectId ?? ""),
    projectSlug: String(raw.projectSlug ?? ""),
    projectName: String(raw.projectName ?? ""),
    message: String(raw.message ?? ""),
    timestamp: String(raw.timestamp ?? new Date().toISOString()),
  });

  const normalizeExecutionRun = (raw: JsonRecord): OrchestrationAgentExecutionRun => ({
    id: String(raw.id ?? ""),
    taskId: String(raw.taskId ?? ""),
    taskTitle: String(raw.taskTitle ?? "Untitled Task"),
    projectId: String(raw.projectId ?? ""),
    projectSlug: String(raw.projectSlug ?? ""),
    projectName: String(raw.projectName ?? ""),
    provider: String(raw.provider ?? "paperclip") as OrchestrationAgentExecutionRun["provider"],
    status: String(raw.status ?? "pending") as OrchestrationAgentExecutionRun["status"],
    sessionId: raw.sessionId ? String(raw.sessionId) : undefined,
    startedAt: raw.startedAt ? String(raw.startedAt) : undefined,
    completedAt: raw.completedAt ? String(raw.completedAt) : undefined,
    createdAt: String(raw.createdAt ?? new Date().toISOString()),
    durationMs: raw.durationMs ? Number(raw.durationMs) : undefined,
    errorMessage: raw.errorMessage ? String(raw.errorMessage) : undefined,
  });

  return {
    company: {
      id: String(companyRaw.id ?? ""),
      slug: String(companyRaw.slug ?? companySlug),
      name: String(companyRaw.name ?? "Company"),
    },
    agent: {
      id: String(agentRaw.id ?? ""),
      companyId: agentRaw.companyId ? String(agentRaw.companyId) : undefined,
      projectId: agentRaw.projectId ? String(agentRaw.projectId) : undefined,
      name: String(agentRaw.name ?? "Unknown Agent"),
      emoji: String(agentRaw.emoji ?? "🤖"),
      role: String(agentRaw.role ?? "Agent"),
      avatar: agentRaw.avatar ? String(agentRaw.avatar) : undefined,
      status: String(agentRaw.status ?? "idle") as OrchestrationAgent["status"],
      currentTask: agentRaw.currentTask ? String(agentRaw.currentTask) : undefined,
      personality: agentRaw.personality ? String(agentRaw.personality) : undefined,
      model: agentRaw.model ? String(agentRaw.model) : undefined,
      paperclipAgentId: agentRaw.paperclipAgentId ? String(agentRaw.paperclipAgentId) : undefined,
      openclawAgentId: agentRaw.openclawAgentId ? String(agentRaw.openclawAgentId) : undefined,
      reportingTo: agentRaw.reportingTo ? String(agentRaw.reportingTo) : undefined,
      skills: Array.isArray(agentRaw.skills) ? agentRaw.skills.map((value) => String(value)) : [],
      tasksCompleted: Number(agentRaw.tasksCompleted ?? 0),
      totalRuntimeMinutes: Number(agentRaw.totalRuntimeMinutes ?? 0),
      lastHeartbeat: agentRaw.lastHeartbeat ? String(agentRaw.lastHeartbeat) : undefined,
      created: agentRaw.created ? String(agentRaw.created) : undefined,
      updated: agentRaw.updated ? String(agentRaw.updated) : undefined,
    },
    currentTasks: (data.currentTasks ?? []).map((raw) => normalizeProfileTask(raw as JsonRecord)),
    recentActivity: (data.recentActivity ?? []).map((raw) => normalizeProfileActivity(raw as JsonRecord)),
    executionHistory: (data.executionHistory ?? []).map((raw) => normalizeExecutionRun(raw as JsonRecord)),
    liveSession: data.liveSession ? normalizeExecutionRun(data.liveSession as JsonRecord) : undefined,
  };
}

export async function getAgentProfileById(
  agentId: string,
  input?: { company?: string; executionLimit?: number; activityLimit?: number }
): Promise<OrchestrationAgentProfile | null> {
  const params = new URLSearchParams();
  if (input?.company) params.set("company", input.company);
  if (typeof input?.executionLimit === "number") params.set("executionLimit", String(input.executionLimit));
  if (typeof input?.activityLimit === "number") params.set("activityLimit", String(input.activityLimit));
  const query = params.toString();
  const url = `/api/orchestration/agents/${encodeURIComponent(agentId)}/profile${query ? `?${query}` : ""}`;

  const data = await fetchJson<{
    company?: JsonRecord;
    agent?: JsonRecord;
    currentTasks?: JsonRecord[];
    recentActivity?: JsonRecord[];
    executionHistory?: JsonRecord[];
    liveSession?: JsonRecord;
  }>(url);
  if (!data?.company || !data?.agent) return null;

  const companyRaw = data.company as JsonRecord;
  const agentRaw = data.agent as JsonRecord;
  const normalizeProfileTask = (raw: JsonRecord): OrchestrationAgentProfileTask => ({
    id: String(raw.id ?? ""),
    title: String(raw.title ?? "Untitled Task"),
    projectId: String(raw.projectId ?? ""),
    projectSlug: String(raw.projectSlug ?? ""),
    projectName: String(raw.projectName ?? ""),
    status: String(raw.status ?? "backlog") as OrchestrationAgentProfileTask["status"],
    priority: String(raw.priority ?? "P2") as OrchestrationAgentProfileTask["priority"],
    type: String(raw.type ?? "feature") as OrchestrationAgentProfileTask["type"],
    updatedAt: String(raw.updatedAt ?? new Date().toISOString()),
  });

  const normalizeProfileActivity = (raw: JsonRecord): OrchestrationAgentProfileActivity => ({
    id: String(raw.id ?? ""),
    kind: raw.kind === "event" ? "event" : "comment",
    taskId: String(raw.taskId ?? ""),
    taskTitle: String(raw.taskTitle ?? "Untitled Task"),
    projectId: String(raw.projectId ?? ""),
    projectSlug: String(raw.projectSlug ?? ""),
    projectName: String(raw.projectName ?? ""),
    message: String(raw.message ?? ""),
    timestamp: String(raw.timestamp ?? new Date().toISOString()),
  });

  const normalizeExecutionRun = (raw: JsonRecord): OrchestrationAgentExecutionRun => ({
    id: String(raw.id ?? ""),
    taskId: String(raw.taskId ?? ""),
    taskTitle: String(raw.taskTitle ?? "Untitled Task"),
    projectId: String(raw.projectId ?? ""),
    projectSlug: String(raw.projectSlug ?? ""),
    projectName: String(raw.projectName ?? ""),
    provider: String(raw.provider ?? "paperclip") as OrchestrationAgentExecutionRun["provider"],
    status: String(raw.status ?? "pending") as OrchestrationAgentExecutionRun["status"],
    sessionId: raw.sessionId ? String(raw.sessionId) : undefined,
    startedAt: raw.startedAt ? String(raw.startedAt) : undefined,
    completedAt: raw.completedAt ? String(raw.completedAt) : undefined,
    createdAt: String(raw.createdAt ?? new Date().toISOString()),
    durationMs: raw.durationMs ? Number(raw.durationMs) : undefined,
    errorMessage: raw.errorMessage ? String(raw.errorMessage) : undefined,
  });

  return {
    company: {
      id: String(companyRaw.id ?? ""),
      slug: String(companyRaw.slug ?? ""),
      name: String(companyRaw.name ?? "Company"),
    },
    agent: {
      id: String(agentRaw.id ?? ""),
      companyId: agentRaw.companyId ? String(agentRaw.companyId) : undefined,
      projectId: agentRaw.projectId ? String(agentRaw.projectId) : undefined,
      name: String(agentRaw.name ?? "Unknown Agent"),
      emoji: String(agentRaw.emoji ?? "🤖"),
      role: String(agentRaw.role ?? "Agent"),
      avatar: agentRaw.avatar ? String(agentRaw.avatar) : undefined,
      status: String(agentRaw.status ?? "idle") as OrchestrationAgent["status"],
      currentTask: agentRaw.currentTask ? String(agentRaw.currentTask) : undefined,
      personality: agentRaw.personality ? String(agentRaw.personality) : undefined,
      model: agentRaw.model ? String(agentRaw.model) : undefined,
      paperclipAgentId: agentRaw.paperclipAgentId ? String(agentRaw.paperclipAgentId) : undefined,
      openclawAgentId: agentRaw.openclawAgentId ? String(agentRaw.openclawAgentId) : undefined,
      reportingTo: agentRaw.reportingTo ? String(agentRaw.reportingTo) : undefined,
      skills: Array.isArray(agentRaw.skills) ? agentRaw.skills.map((value) => String(value)) : [],
      tasksCompleted: Number(agentRaw.tasksCompleted ?? 0),
      totalRuntimeMinutes: Number(agentRaw.totalRuntimeMinutes ?? 0),
      lastHeartbeat: agentRaw.lastHeartbeat ? String(agentRaw.lastHeartbeat) : undefined,
      created: agentRaw.created ? String(agentRaw.created) : undefined,
      updated: agentRaw.updated ? String(agentRaw.updated) : undefined,
    },
    currentTasks: (data.currentTasks ?? []).map((raw) => normalizeProfileTask(raw as JsonRecord)),
    recentActivity: (data.recentActivity ?? []).map((raw) => normalizeProfileActivity(raw as JsonRecord)),
    executionHistory: (data.executionHistory ?? []).map((raw) => normalizeExecutionRun(raw as JsonRecord)),
    liveSession: data.liveSession ? normalizeExecutionRun(data.liveSession as JsonRecord) : undefined,
  };
}

export async function createProjectAgent(input: {
  projectId: string;
  name: string;
  role: string;
  emoji?: string;
  personality?: string;
}): Promise<OrchestrationAgent | null> {
  const response = await fetch(`/api/orchestration/projects/${input.projectId}/agents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: input.name.trim(),
      role: input.role.trim(),
      emoji: input.emoji?.trim() || "🤖",
      personality: input.personality?.trim() ?? "",
    }),
  }).catch(() => null);

  if (!response?.ok) return null;
  const body = (await response.json()) as { agent?: JsonRecord };
  if (!body.agent) return null;

  const a = body.agent as JsonRecord;
  return {
    id: String(a.id ?? "unknown"),
    projectId: String(a.projectId ?? input.projectId),
    name: String(a.name ?? "Unknown"),
    emoji: String(a.emoji ?? "🤖"),
    role: String(a.role ?? "Agent"),
    avatar: a.avatar ? String(a.avatar) : undefined,
    status: (String(a.status ?? "idle") as OrchestrationAgent["status"]) ?? "idle",
    currentTask: a.currentTask ? String(a.currentTask) : undefined,
    personality: a.personality ? String(a.personality) : undefined,
    model: a.model ? String(a.model) : undefined,
    paperclipAgentId: a.paperclipAgentId ? String(a.paperclipAgentId) : undefined,
    openclawAgentId: a.openclawAgentId ? String(a.openclawAgentId) : undefined,
    reportingTo: a.reportingTo ? String(a.reportingTo) : undefined,
    skills: Array.isArray(a.skills) ? a.skills.map((skill) => String(skill)) : undefined,
    tasksCompleted: a.tasksCompleted ? Number(a.tasksCompleted) : undefined,
    totalRuntimeMinutes: a.totalRuntimeMinutes ? Number(a.totalRuntimeMinutes) : undefined,
    lastHeartbeat: a.lastHeartbeat ? String(a.lastHeartbeat) : undefined,
    created: a.created ? String(a.created) : undefined,
    updated: a.updated ? String(a.updated) : undefined,
  };
}

export async function regenerateProjectAgentAvatar(
  projectId: string,
  agentId: string
): Promise<OrchestrationAgent | null> {
  const response = await fetch(
    `/api/orchestration/projects/${projectId}/agents/${agentId}/avatar/regenerate`,
    { method: "POST" }
  ).catch(() => null);

  if (!response?.ok) return null;
  const body = (await response.json()) as { agent?: JsonRecord };
  if (!body.agent) return null;

  const a = body.agent as JsonRecord;
  return {
    id: String(a.id ?? "unknown"),
    projectId: String(a.projectId ?? projectId),
    name: String(a.name ?? "Unknown"),
    emoji: String(a.emoji ?? "🤖"),
    role: String(a.role ?? "Agent"),
    avatar: a.avatar ? String(a.avatar) : undefined,
    status: (String(a.status ?? "idle") as OrchestrationAgent["status"]) ?? "idle",
    currentTask: a.currentTask ? String(a.currentTask) : undefined,
    personality: a.personality ? String(a.personality) : undefined,
    model: a.model ? String(a.model) : undefined,
    paperclipAgentId: a.paperclipAgentId ? String(a.paperclipAgentId) : undefined,
    openclawAgentId: a.openclawAgentId ? String(a.openclawAgentId) : undefined,
    reportingTo: a.reportingTo ? String(a.reportingTo) : undefined,
    skills: Array.isArray(a.skills) ? a.skills.map((skill) => String(skill)) : undefined,
    tasksCompleted: a.tasksCompleted ? Number(a.tasksCompleted) : undefined,
    totalRuntimeMinutes: a.totalRuntimeMinutes ? Number(a.totalRuntimeMinutes) : undefined,
    lastHeartbeat: a.lastHeartbeat ? String(a.lastHeartbeat) : undefined,
    created: a.created ? String(a.created) : undefined,
    updated: a.updated ? String(a.updated) : undefined,
  };
}

export async function listProjectSprints(projectId: string): Promise<OrchestrationSprint[]> {
  const data = await fetchJson<{ sprints: JsonRecord[] }>(
    `/api/orchestration/projects/${projectId}/sprints`
  );
  return (data?.sprints ?? []).map(normalizeSprint);
}

export async function createProjectSprint(input: {
  projectId: string;
  name: string;
  goal?: string;
  status?: OrchestrationSprint["status"];
  startDate?: string;
  endDate?: string | null;
}): Promise<OrchestrationSprint | null> {
  const response = await fetch(`/api/orchestration/projects/${input.projectId}/sprints`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: input.name,
      goal: input.goal ?? "",
      status: input.status ?? "planned",
      ...(input.startDate ? { startDate: input.startDate } : {}),
      ...(input.endDate !== undefined ? { endDate: input.endDate } : {}),
    }),
  }).catch(() => null);

  if (!response?.ok) return null;
  const json = (await response.json()) as { sprint?: JsonRecord };
  if (!json.sprint) return null;
  return normalizeSprint(json.sprint);
}

export async function createTask(input: {
  projectId: string;
  title: string;
  description?: string;
  priority?: OrchestrationTask["priority"];
  type?: OrchestrationTask["type"];
  status?: TaskStatus;
  assignee?: string;
  sprintId?: string;
  labels?: string[];
}): Promise<OrchestrationTask | null> {
  const response = await fetch("/api/orchestration/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: input.projectId,
      title: input.title,
      description: input.description ?? "",
      priority: input.priority ?? "P2",
      type: input.type ?? "feature",
      status: input.status ?? "backlog",
      ...(input.assignee ? { assignee: input.assignee } : {}),
      ...(input.sprintId ? { sprintId: input.sprintId } : {}),
      labels: input.labels ?? [],
      createdBy: "pixel-ui",
    }),
  }).catch(() => null);

  if (!response?.ok) return null;
  const json = (await response.json()) as { task?: JsonRecord };
  if (!json.task) return null;
  return normalizeTask(json.task);
}

export async function listTasks(input?: {
  company?: string;
  projectId?: string;
  assignee?: string;
  status?: TaskStatus;
  priority?: OrchestrationTask["priority"];
  type?: OrchestrationTask["type"];
  search?: string;
  sort?: "updated-desc" | "created-desc" | "priority-asc" | "priority-desc";
  includeArchived?: boolean;
  includeNonProduction?: boolean;
}): Promise<OrchestrationTask[]> {
  const params = new URLSearchParams();
  if (input?.company) params.set("company", input.company);
  if (input?.projectId) params.set("projectId", input.projectId);
  if (input?.assignee) params.set("assignee", input.assignee);
  if (input?.status) params.set("status", input.status);
  if (input?.priority) params.set("priority", input.priority);
  if (input?.type) params.set("type", input.type);
  if (input?.search) params.set("search", input.search);
  if (input?.sort) params.set("sort", input.sort);
  if (typeof input?.includeArchived === "boolean") params.set("includeArchived", input.includeArchived ? "true" : "false");
  if (typeof input?.includeNonProduction === "boolean") {
    params.set("includeNonProduction", input.includeNonProduction ? "true" : "false");
  }

  const query = params.toString();
  const url = `/api/orchestration/tasks${query ? `?${query}` : ""}`;
  const data = await fetchJson<{ tasks: JsonRecord[] }>(url);
  return (data?.tasks ?? []).map(normalizeTask);
}

export async function getTask(taskId: string): Promise<OrchestrationTask | null> {
  const data = await fetchJson<{ task?: JsonRecord }>(`/api/orchestration/tasks/${taskId}`);
  if (!data?.task) return null;
  return normalizeTask(data.task);
}

export async function updateTask(input: {
  taskId: string;
  title?: string;
  description?: string;
  priority?: OrchestrationTask["priority"];
  type?: OrchestrationTask["type"];
  sprintId?: string | null;
  parentTaskId?: string | null;
  labels?: string[];
  blockedReason?: string | null;
  reviewNotes?: string | null;
  actorUserId?: string;
}): Promise<OrchestrationTask | null> {
  const response = await fetch(`/api/orchestration/tasks/${input.taskId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.sprintId !== undefined ? { sprintId: input.sprintId } : {}),
      ...(input.parentTaskId !== undefined ? { parentTaskId: input.parentTaskId } : {}),
      ...(input.labels !== undefined ? { labels: input.labels } : {}),
      ...(input.blockedReason !== undefined ? { blockedReason: input.blockedReason } : {}),
      ...(input.reviewNotes !== undefined ? { reviewNotes: input.reviewNotes } : {}),
      ...(input.actorUserId !== undefined ? { actorUserId: input.actorUserId } : {}),
    }),
  }).catch(() => null);

  if (!response?.ok) return null;
  const json = (await response.json()) as { task?: JsonRecord };
  if (!json.task) return null;
  return normalizeTask(json.task);
}

export async function archiveTask(taskId: string, actorUserId?: string): Promise<boolean> {
  const params = new URLSearchParams();
  if (actorUserId) params.set("actorUserId", actorUserId);
  const query = params.toString();
  const url = `/api/orchestration/tasks/${taskId}${query ? `?${query}` : ""}`;

  const response = await fetch(url, {
    method: "DELETE",
  }).catch(() => null);

  return Boolean(response?.ok);
}

export async function addTaskComment(taskId: string, body: string, authorUserId = "me"): Promise<boolean> {
  try {
    const response = await fetch(`/api/orchestration/tasks/${encodeURIComponent(taskId)}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body, authorUserId }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function listTaskComments(taskId: string): Promise<NonNullable<OrchestrationTask["comments"]>> {
  const data = await fetchJson<{ comments: JsonRecord[] }>(`/api/orchestration/tasks/${taskId}/comments`);
  if (!data?.comments) return [];
  return data.comments.map((comment) => {
    const c = comment as JsonRecord;
    return {
      id: String(c.id ?? crypto.randomUUID()),
      author: String(c.author ?? "Unknown"),
      authorEmoji: c.authorEmoji ? String(c.authorEmoji) : undefined,
      text: String(c.text ?? ""),
      timestamp: String(c.timestamp ?? new Date().toISOString()),
      type: c.type ? String(c.type) : undefined,
    };
  });
}

export async function createTaskComment(input: {
  taskId: string;
  body: string;
  authorUserId?: string;
}): Promise<NonNullable<OrchestrationTask["comments"]>[number] | null> {
  const response = await fetch(`/api/orchestration/tasks/${input.taskId}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      body: input.body,
      type: "comment",
      authorUserId: input.authorUserId ?? "pixel-ui",
    }),
  }).catch(() => null);

  if (!response?.ok) return null;
  const json = (await response.json()) as { comment?: JsonRecord };
  if (!json.comment) return null;
  const c = json.comment;
  return {
    id: String(c.id ?? crypto.randomUUID()),
    author: String(c.author ?? "Unknown"),
    authorEmoji: c.authorEmoji ? String(c.authorEmoji) : undefined,
    text: String(c.text ?? ""),
    timestamp: String(c.timestamp ?? new Date().toISOString()),
    type: c.type ? String(c.type) : undefined,
  };
}

export async function pullTaskBridgeStatus(taskId: string): Promise<{
  taskId: string;
  paperclipIssueId: string;
  paperclipIssueIdentifier: string;
  syncedAt: string;
  pollIntervalMs: number;
  status: {
    from: TaskStatus;
    to: TaskStatus;
    changed: boolean;
    skipped: boolean;
    skipReason?: string;
  };
  comments: {
    imported: number;
    skippedDuplicates: number;
    lastImportedCommentId?: string;
  };
  task: OrchestrationTask;
} | null> {
  const response = await fetch(
    `/api/orchestration/tasks/${encodeURIComponent(taskId)}/bridge/pull-status`,
    { method: "GET" }
  ).catch(() => null);

  if (!response?.ok) {
    return null;
  }

  const data = (await response.json()) as JsonRecord;
  const task = data.task as JsonRecord | undefined;
  if (!task) {
    return null;
  }

  const status = data.status as JsonRecord | undefined;
  const comments = data.comments as JsonRecord | undefined;

  return {
    taskId: String(data.taskId ?? taskId),
    paperclipIssueId: String(data.paperclipIssueId ?? ""),
    paperclipIssueIdentifier: String(data.paperclipIssueIdentifier ?? ""),
    syncedAt: String(data.syncedAt ?? new Date().toISOString()),
    pollIntervalMs: Number(data.pollIntervalMs ?? 30_000),
    status: {
      from: String(status?.from ?? "backlog") as TaskStatus,
      to: String(status?.to ?? "backlog") as TaskStatus,
      changed: Boolean(status?.changed),
      skipped: Boolean(status?.skipped),
      skipReason: status?.skipReason ? String(status.skipReason) : undefined,
    },
    comments: {
      imported: Number(comments?.imported ?? 0),
      skippedDuplicates: Number(comments?.skippedDuplicates ?? 0),
      lastImportedCommentId: comments?.lastImportedCommentId
        ? String(comments.lastImportedCommentId)
        : undefined,
    },
    task: normalizeTask(task),
  };
}

export async function pollTaskExecutionStatus(taskId: string): Promise<{
  taskId: string;
  mode: "openclaw" | "paperclip" | "manual";
  sessionId?: string;
  polledAt: string;
  status: {
    state: "running" | "completed" | "unknown" | "skipped";
    terminal: boolean;
    reason?: string;
    raw?: string;
  };
  comments: {
    imported: number;
    skippedDuplicates: number;
    lastImportedEventId?: string;
  };
  transition: {
    attempted: boolean;
    from?: TaskStatus;
    to?: TaskStatus;
    changed: boolean;
    skipped: boolean;
    skipReason?: string;
  };
  task: OrchestrationTask;
} | null> {
  const response = await fetch(
    `/api/orchestration/tasks/${encodeURIComponent(taskId)}/execution`,
    { method: "GET" }
  ).catch(() => null);

  if (!response?.ok) {
    return null;
  }

  const data = (await response.json()) as JsonRecord;
  const task = data.task as JsonRecord | undefined;
  if (!task) return null;

  const status = (data.status ?? {}) as JsonRecord;
  const comments = (data.comments ?? {}) as JsonRecord;
  const transition = (data.transition ?? {}) as JsonRecord;

  return {
    taskId: String(data.taskId ?? taskId),
    mode: String(data.mode ?? "manual") as "openclaw" | "paperclip" | "manual",
    sessionId: data.sessionId ? String(data.sessionId) : undefined,
    polledAt: String(data.polledAt ?? new Date().toISOString()),
    status: {
      state: String(status.state ?? "unknown") as "running" | "completed" | "unknown" | "skipped",
      terminal: Boolean(status.terminal),
      reason: status.reason ? String(status.reason) : undefined,
      raw: status.raw ? String(status.raw) : undefined,
    },
    comments: {
      imported: Number(comments.imported ?? 0),
      skippedDuplicates: Number(comments.skippedDuplicates ?? 0),
      lastImportedEventId: comments.lastImportedEventId
        ? String(comments.lastImportedEventId)
        : undefined,
    },
    transition: {
      attempted: Boolean(transition.attempted),
      from: transition.from ? (String(transition.from) as TaskStatus) : undefined,
      to: transition.to ? (String(transition.to) as TaskStatus) : undefined,
      changed: Boolean(transition.changed),
      skipped: Boolean(transition.skipped),
      skipReason: transition.skipReason ? String(transition.skipReason) : undefined,
    },
    task: normalizeTask(task),
  };
}

export async function cancelTaskExecution(input: {
  taskId: string;
  actorUserId?: string;
  note?: string;
  targetStatus?: "on-deck" | "in-progress";
}): Promise<{
  taskId: string;
  mode: "openclaw" | "paperclip" | "manual";
  sessionId?: string;
  cancelled: {
    attempted: boolean;
    acknowledged: boolean;
    status: "cancelled" | "skipped";
    reason?: string;
    raw?: string;
  };
  transition: {
    attempted: boolean;
    from?: TaskStatus;
    to?: TaskStatus;
    changed: boolean;
    skipped: boolean;
    skipReason?: string;
  };
  task: OrchestrationTask;
} | null> {
  const response = await fetch(
    `/api/orchestration/tasks/${encodeURIComponent(input.taskId)}/execution`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actorUserId: input.actorUserId,
        note: input.note,
        targetStatus: input.targetStatus,
      }),
    }
  ).catch(() => null);

  if (!response?.ok) {
    return null;
  }

  const data = (await response.json()) as JsonRecord;
  const task = data.task as JsonRecord | undefined;
  if (!task) return null;

  const cancelled = (data.cancelled ?? {}) as JsonRecord;
  const transition = (data.transition ?? {}) as JsonRecord;

  return {
    taskId: String(data.taskId ?? input.taskId),
    mode: String(data.mode ?? "manual") as "openclaw" | "paperclip" | "manual",
    sessionId: data.sessionId ? String(data.sessionId) : undefined,
    cancelled: {
      attempted: Boolean(cancelled.attempted),
      acknowledged: Boolean(cancelled.acknowledged),
      status: String(cancelled.status ?? "skipped") as "cancelled" | "skipped",
      reason: cancelled.reason ? String(cancelled.reason) : undefined,
      raw: cancelled.raw ? String(cancelled.raw) : undefined,
    },
    transition: {
      attempted: Boolean(transition.attempted),
      from: transition.from ? (String(transition.from) as TaskStatus) : undefined,
      to: transition.to ? (String(transition.to) as TaskStatus) : undefined,
      changed: Boolean(transition.changed),
      skipped: Boolean(transition.skipped),
      skipReason: transition.skipReason ? String(transition.skipReason) : undefined,
    },
    task: normalizeTask(task),
  };
}

export async function getBridgeStatus(): Promise<{
  checkedAt: string;
  connection: {
    ok: boolean;
    agentId?: string;
    error?: {
      code: string;
      message: string;
      retriable?: boolean;
    };
  };
  sync: {
    lastSyncedAt: string | null;
    paperclipTaskCount: number;
    mappedTaskCount: number;
  };
  mapping: {
    errorCount: number;
    errors: Array<{
      code:
        | "missing_project_company"
        | "missing_paperclip_issue_mapping"
        | "missing_assignee"
        | "missing_paperclip_agent_mapping";
      taskId: string;
      taskTitle: string;
      projectId: string;
      projectName: string;
    }>;
  };
} | null> {
  const response = await fetch("/api/orchestration/bridge/status", { method: "GET" }).catch(() => null);
  if (!response?.ok) {
    return null;
  }

  const data = (await response.json()) as JsonRecord;
  const connection = (data.connection ?? {}) as JsonRecord;
  const sync = (data.sync ?? {}) as JsonRecord;
  const mapping = (data.mapping ?? {}) as JsonRecord;
  const mappingErrors = Array.isArray(mapping.errors) ? mapping.errors : [];

  return {
    checkedAt: String(data.checkedAt ?? new Date().toISOString()),
    connection: {
      ok: Boolean(connection.ok),
      agentId: connection.agentId ? String(connection.agentId) : undefined,
      error:
        typeof connection.error === "object" && connection.error
          ? {
              code: String((connection.error as JsonRecord).code ?? "bridge_error"),
              message: String((connection.error as JsonRecord).message ?? "Bridge check failed"),
              retriable:
                typeof (connection.error as JsonRecord).retriable === "boolean"
                  ? Boolean((connection.error as JsonRecord).retriable)
                  : undefined,
            }
          : undefined,
    },
    sync: {
      lastSyncedAt: sync.lastSyncedAt ? String(sync.lastSyncedAt) : null,
      paperclipTaskCount: Number(sync.paperclipTaskCount ?? 0),
      mappedTaskCount: Number(sync.mappedTaskCount ?? 0),
    },
    mapping: {
      errorCount: Number(mapping.errorCount ?? mappingErrors.length ?? 0),
      errors: mappingErrors.map((entry) => {
        const raw = entry as JsonRecord;
        return {
          code: String(raw.code ?? "missing_paperclip_issue_mapping") as
            | "missing_project_company"
            | "missing_paperclip_issue_mapping"
            | "missing_assignee"
            | "missing_paperclip_agent_mapping",
          taskId: String(raw.taskId ?? ""),
          taskTitle: String(raw.taskTitle ?? "Untitled Task"),
          projectId: String(raw.projectId ?? ""),
          projectName: String(raw.projectName ?? "Unknown Project"),
        };
      }),
    },
  };
}

export async function triggerAgentHeartbeat(
  agentId: string,
  input?: {
    status?: "idle" | "working" | "paused" | "offline" | "error";
    currentTaskId?: string | null;
    runtimeMinutesDelta?: number;
    observedAt?: string;
    source?: "cron" | "openclaw" | "manual";
  }
): Promise<{
  agent: OrchestrationAgent;
  heartbeat: {
    source: "cron" | "openclaw" | "manual";
    receivedAt: string;
    observedAt: string;
    runtimeMinutesDelta: number;
  };
} | null> {
  const response = await fetch(`/api/orchestration/agents/${encodeURIComponent(agentId)}/heartbeat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input ?? {}),
  }).catch(() => null);

  if (!response?.ok) {
    return null;
  }

  const data = (await response.json()) as JsonRecord;
  const agentRaw = data.agent as JsonRecord | undefined;
  const heartbeatRaw = data.heartbeat as JsonRecord | undefined;
  if (!agentRaw || !heartbeatRaw) {
    return null;
  }

  return {
    agent: {
      id: String(agentRaw.id ?? ""),
      name: String(agentRaw.name ?? "Unknown Agent"),
      emoji: String(agentRaw.emoji ?? "🤖"),
      role: String(agentRaw.role ?? ""),
      avatar: agentRaw.avatar ? String(agentRaw.avatar) : undefined,
      status: String(agentRaw.status ?? "idle") as OrchestrationAgent["status"],
      projectId: String(agentRaw.projectId ?? ""),
      currentTask: agentRaw.currentTask ? String(agentRaw.currentTask) : undefined,
      personality: agentRaw.personality ? String(agentRaw.personality) : undefined,
      model: agentRaw.model ? String(agentRaw.model) : undefined,
      paperclipAgentId: agentRaw.paperclipAgentId ? String(agentRaw.paperclipAgentId) : undefined,
      openclawAgentId: agentRaw.openclawAgentId ? String(agentRaw.openclawAgentId) : undefined,
      reportingTo: agentRaw.reportingTo ? String(agentRaw.reportingTo) : undefined,
      skills: Array.isArray(agentRaw.skills) ? agentRaw.skills.map((v) => String(v)) : [],
      tasksCompleted: Number(agentRaw.tasksCompleted ?? 0),
      totalRuntimeMinutes: Number(agentRaw.totalRuntimeMinutes ?? 0),
      lastHeartbeat: agentRaw.lastHeartbeat ? String(agentRaw.lastHeartbeat) : undefined,
      created: agentRaw.created ? String(agentRaw.created) : undefined,
      updated: agentRaw.updated ? String(agentRaw.updated) : undefined,
    },
    heartbeat: {
      source: String(heartbeatRaw.source ?? "cron") as "cron" | "openclaw" | "manual",
      receivedAt: String(heartbeatRaw.receivedAt ?? new Date().toISOString()),
      observedAt: String(heartbeatRaw.observedAt ?? new Date().toISOString()),
      runtimeMinutesDelta: Number(heartbeatRaw.runtimeMinutesDelta ?? 0),
    },
  };
}

/* ── Routines ── */

export async function listCompanyRoutines(
  companySlug: string,
  input?: { projectId?: string }
): Promise<OrchestrationRoutineListItem[]> {
  const params = new URLSearchParams();
  if (input?.projectId) params.set("projectId", input.projectId);
  const qs = params.toString();
  const url = `/api/orchestration/companies/${encodeURIComponent(companySlug)}/routines${qs ? `?${qs}` : ""}`;
  const data = await fetchJson<{ routines: OrchestrationRoutineListItem[] }>(url);
  return data?.routines ?? [];
}

export async function createCompanyRoutine(
  companySlug: string,
  input: {
    title: string;
    description?: string;
    projectId: string;
    assigneeAgentId: string;
    priority?: string;
    concurrencyPolicy?: string;
    catchUpPolicy?: string;
  }
): Promise<OrchestrationRoutine | null> {
  try {
    const response = await fetch(
      `/api/orchestration/companies/${encodeURIComponent(companySlug)}/routines`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }
    );
    if (!response.ok) return null;
    const data = (await response.json()) as { routine: OrchestrationRoutine };
    return data.routine;
  } catch {
    return null;
  }
}

export async function updateRoutine(
  routineId: string,
  input: Record<string, unknown>
): Promise<OrchestrationRoutine | null> {
  try {
    const response = await fetch(
      `/api/orchestration/routines/${encodeURIComponent(routineId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }
    );
    if (!response.ok) return null;
    const data = (await response.json()) as { routine: OrchestrationRoutine };
    return data.routine;
  } catch {
    return null;
  }
}

export async function runRoutineNow(routineId: string): Promise<boolean> {
  try {
    const response = await fetch(
      `/api/orchestration/routines/${encodeURIComponent(routineId)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run" }),
      }
    );
    return response.ok;
  } catch {
    return false;
  }
}

/* ── Approvals ── */

export async function approveApproval(approvalId: string): Promise<boolean> {
  try {
    const response = await fetch(
      `/api/orchestration/approvals/${encodeURIComponent(approvalId)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      }
    );
    return response.ok;
  } catch {
    return false;
  }
}

export async function rejectApproval(approvalId: string): Promise<boolean> {
  try {
    const response = await fetch(
      `/api/orchestration/approvals/${encodeURIComponent(approvalId)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject" }),
      }
    );
    return response.ok;
  } catch {
    return false;
  }
}

export async function requestApprovalRevision(approvalId: string, decisionNote?: string): Promise<boolean> {
  try {
    const response = await fetch(
      `/api/orchestration/approvals/${encodeURIComponent(approvalId)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "request_revision", decisionNote }),
      }
    );
    return response.ok;
  } catch {
    return false;
  }
}

export async function resubmitApproval(approvalId: string): Promise<boolean> {
  try {
    const response = await fetch(
      `/api/orchestration/approvals/${encodeURIComponent(approvalId)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resubmit" }),
      }
    );
    return response.ok;
  } catch {
    return false;
  }
}

export async function getApprovalDetail(approvalId: string): Promise<OrchestrationApproval | null> {
  const data = await fetchJson<{ approval: OrchestrationApproval }>(
    `/api/orchestration/approvals/${encodeURIComponent(approvalId)}`
  );
  return data?.approval ?? null;
}

export async function addApprovalComment(approvalId: string, body: string): Promise<boolean> {
  try {
    const response = await fetch(
      `/api/orchestration/approvals/${encodeURIComponent(approvalId)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "comment", body }),
      }
    );
    return response.ok;
  } catch {
    return false;
  }
}

/* ── Engine API ── */

export type EngineStatus = {
  companyId: string;
  companyName: string;
  ceo: { id: string; name: string; role: string; runtimeState: Record<string, unknown> | null } | null;
  recentHeartbeatRuns: Array<Record<string, unknown>>;
  pendingWakeups: Array<Record<string, unknown>>;
  engineStatus: "ready" | "no_ceo";
};

export type KickoffResult = {
  companyId: string;
  ceoAgentId: string;
  directionTaskId: string | null;
  wakeupRequestId: string;
  heartbeatRunId: string;
  status: "queued" | "no_ceo" | "already_active";
  message: string;
};

export async function getCompanyEngineStatus(companySlug: string): Promise<EngineStatus | null> {
  return fetchJson<EngineStatus>(
    `/api/orchestration/companies/${encodeURIComponent(companySlug)}/engine`
  );
}

export async function kickoffCompany(
  companySlug: string,
  direction?: string
): Promise<KickoffResult | null> {
  try {
    const response = await fetch(
      `/api/orchestration/companies/${encodeURIComponent(companySlug)}/kickoff`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction: direction || undefined }),
      }
    );
    if (!response.ok) return null;
    return (await response.json()) as KickoffResult;
  } catch {
    return null;
  }
}

export async function wakeupAgent(
  agentId: string,
  input?: { source?: string; reason?: string; payload?: Record<string, unknown> }
): Promise<{ wakeupRequestId: string; heartbeatRunId: string; status: string } | null> {
  try {
    const response = await fetch(
      `/api/orchestration/agents/${encodeURIComponent(agentId)}/wakeup`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input ?? {}),
      }
    );
    if (!response.ok) return null;
    return (await response.json()) as { wakeupRequestId: string; heartbeatRunId: string; status: string };
  } catch {
    return null;
  }
}

export async function executeHeartbeatRun(
  runId: string
): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(
      `/api/orchestration/engine/heartbeat-runs/${encodeURIComponent(runId)}`,
      { method: "POST" }
    );
    if (!response.ok) return null;
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function getHeartbeatRun(
  runId: string
): Promise<Record<string, unknown> | null> {
  return fetchJson<Record<string, unknown>>(
    `/api/orchestration/engine/heartbeat-runs/${encodeURIComponent(runId)}`
  );
}
