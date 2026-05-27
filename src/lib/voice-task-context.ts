import { OrchestrationApiError } from "@/lib/orchestration/api";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import {
  getProject,
  getTaskDetail,
  listTasks,
} from "@/lib/orchestration/service";
import type { OrchestrationTaskTimelineItem } from "@/lib/orchestration/types";
import {
  formatOperatorTaskStatusLabel,
  replaceTaskStatusTokensInText,
} from "@/lib/orchestration/status-copy";

import type {
  NormalizedVoiceBindingRequest,
  ResolvedVoiceBinding,
  VoiceBindingRequest,
} from "./voice-binding";
import { normalizeVoiceBindingRequest } from "./voice-binding";

export interface BoundAgentInfo {
  id: string;
  name: string;
  role: string;
  personality?: string;
}

export interface VoiceTaskContextResolution {
  binding: ResolvedVoiceBinding;
  promptContext: string;
  agent?: BoundAgentInfo;
}

interface CompanyRecord {
  id: string;
  slug: string;
  companyCode?: string | null;
  name: string;
}

interface AgentRecord {
  id: string;
  name: string;
  role: string;
  personality?: string;
  avatarUrl?: string;
  voiceId?: string;
}

function clip(text: string | undefined, maxChars = 1200): string {
  const normalized = (text ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "No description provided.";
  }
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, maxChars - 1).trimEnd()}…`;
}

function normalizeStatusCopy(text: string): string {
  return replaceTaskStatusTokensInText(text).replace(/\btimed_out\b/g, "timed-out");
}

function normalizeVoiceBindingAvatarUrl(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) {
    return undefined;
  }

  // Generated avatars may be stored as large inline data URLs. The voice
  // session bootstrap does not need that payload, and sending it can add a
  // visible delay before live audio even starts.
  if (normalized.startsWith("data:") || normalized.length > 2048) {
    return undefined;
  }

  return normalized;
}

function toLines(items: string[]): string {
  return items.join("\n");
}

function formatRecentComments(timeline: OrchestrationTaskTimelineItem[]): string {
  const comments = timeline
    .filter((item) => item.provenance === "comment" || item.provenance === "imported_report")
    .slice(0, 4)
    .map((item) => {
      const actor = item.actorLabel?.trim() || "System";
      const body = clip(item.body, 240);
      return `- ${item.timestamp} — ${actor}: ${body}`;
    });

  return comments.length > 0 ? toLines(comments) : "No recent comments.";
}

function formatRecentActivity(timeline: OrchestrationTaskTimelineItem[]): string {
  const activity = timeline
    .filter((item) => item.provenance !== "comment" && item.provenance !== "imported_report")
    .slice(0, 6)
    .map((item) => {
      const actor = item.actorLabel?.trim() ? `${item.actorLabel.trim()}: ` : "";
      return `- ${item.timestamp} — ${actor}${normalizeStatusCopy(item.summary)}`;
    });

  return activity.length > 0 ? toLines(activity) : "No recent task activity.";
}

function lookupCompany(companyId?: string): CompanyRecord | undefined {
  if (!companyId) {
    return undefined;
  }

  const db = getOrchestrationDb();
  return db
    .prepare(
      `SELECT id, slug, name
            , company_code AS companyCode
         FROM companies
        WHERE id = ?
          AND archived_at IS NULL
        LIMIT 1`
    )
    .get(companyId) as CompanyRecord | undefined;
}

function lookupCompanyBySlug(companySlug?: string): CompanyRecord | undefined {
  if (!companySlug) {
    return undefined;
  }

  const db = getOrchestrationDb();
  return db
    .prepare(
      `SELECT id, slug, name
            , company_code AS companyCode
         FROM companies
        WHERE (slug = ? OR UPPER(company_code) = UPPER(?))
          AND archived_at IS NULL
        LIMIT 1`
    )
    .get(companySlug, companySlug) as CompanyRecord | undefined;
}

function matchesCompanyAlias(company: CompanyRecord | undefined, requestedCompanySlug?: string): boolean {
  if (!requestedCompanySlug || !company) {
    return true;
  }

  const requested = requestedCompanySlug.trim().toLowerCase();
  return (
    company.slug.toLowerCase() === requested ||
    (company.companyCode?.trim().toLowerCase() === requested)
  );
}

interface AgentLookupRow {
  id: string;
  name: string;
  role: string;
  personality: string | null;
  avatar_url: string | null;
  voice_id: string | null;
}

function toAgentRecord(row: AgentLookupRow | undefined): AgentRecord | undefined {
  if (!row) {
    return undefined;
  }

  return {
    id: row.id,
    name: row.name,
    role: row.role,
    personality: row.personality?.trim() ? row.personality : undefined,
    avatarUrl: normalizeVoiceBindingAvatarUrl(row.avatar_url),
    voiceId: row.voice_id ?? undefined,
  };
}

function lookupAgentById(companyId: string | undefined, agentId: string | undefined): AgentRecord | undefined {
  if (!companyId || !agentId) {
    return undefined;
  }

  const db = getOrchestrationDb();
  const row = db
    .prepare(
      `SELECT id, name, role, personality, avatar_url, voice_id
         FROM agents
        WHERE id = ?
          AND company_id = ?
          AND archived_at IS NULL
        LIMIT 1`
    )
    .get(agentId, companyId) as AgentLookupRow | undefined;

  return toAgentRecord(row);
}

function lookupTaskAssignee(taskId: string, companyId?: string): AgentRecord | undefined {
  const db = getOrchestrationDb();
  const row = db
    .prepare(
      `SELECT a.id, a.name, a.role, a.personality, a.avatar_url, a.voice_id
         FROM tasks t
         INNER JOIN agents a
                 ON a.id = t.assignee_agent_id
                AND a.archived_at IS NULL
        WHERE t.id = ?
          AND t.archived_at IS NULL
          AND (? IS NULL OR a.company_id = ?)
        LIMIT 1`
    )
    .get(taskId, companyId ?? null, companyId ?? null) as AgentLookupRow | undefined;

  return toAgentRecord(row);
}

function resolveRequestedBindingAgent(input: {
  companyId?: string;
  requestedAgentId?: string;
}): AgentRecord | undefined {
  if (!input.requestedAgentId) {
    return undefined;
  }

  const agent = lookupAgentById(input.companyId, input.requestedAgentId);
  if (!agent) {
    throw new OrchestrationApiError(
      400,
      "invalid_voice_binding",
      "Requested agent is not available for this voice binding"
    );
  }

  return agent;
}

function resolveBindingAgent(input: {
  companyId?: string;
  requestedAgentId?: string;
  taskId?: string;
  fallbackTaskAssignee?: AgentRecord;
}): AgentRecord | undefined {
  return (
    resolveRequestedBindingAgent(input) ??
    input.fallbackTaskAssignee ??
    (input.taskId ? lookupTaskAssignee(input.taskId, input.companyId) : undefined)
  );
}

function buildScopeSection(input: {
  scope: "task" | "project";
  companyName?: string;
  companySlug?: string;
  projectName: string;
  projectSlug: string;
  taskLabel: string;
  status: string;
  assignee: string;
  agent: string;
  mode: string;
  source: string;
}): string {
  return [
    "### Bound scope",
    `- Scope: ${input.scope}`,
    `- Company: ${input.companyName ? `${input.companyName} (${input.companySlug ?? "unknown"})` : (input.companySlug ?? "Unknown company")}`,
    `- Project: ${input.projectName} (${input.projectSlug})`,
    `- Task: ${input.taskLabel}`,
    `- Status: ${formatOperatorTaskStatusLabel(input.status) ?? input.status}`,
    `- Assignee: ${input.assignee}`,
    `- Agent: ${input.agent}`,
    `- Session mode: ${input.mode}`,
    `- Session source: ${input.source}`,
  ].join("\n");
}

function buildTaskContext(binding: NormalizedVoiceBindingRequest): VoiceTaskContextResolution {
  const taskIdentifier = binding.taskId ?? binding.taskKey;
  if (!taskIdentifier) {
    throw new OrchestrationApiError(400, "invalid_voice_binding", "Task binding requires taskId or taskKey");
  }

  const { task, detail } = getTaskDetail(taskIdentifier);
  const { project } = getProject(task.project);
  const company = lookupCompany(project.companyId);
  if (!matchesCompanyAlias(company, binding.companySlug)) {
    throw new OrchestrationApiError(404, "task_not_found", "Task not found");
  }
  const taskAssignee = lookupTaskAssignee(task.id, project.companyId);
  const agent = resolveBindingAgent({
    companyId: project.companyId,
    requestedAgentId: binding.agentId,
    taskId: task.id,
    fallbackTaskAssignee: taskAssignee,
  });

  const resolvedBinding: ResolvedVoiceBinding = {
    scope: "task",
    ...(company?.slug ? { companySlug: company.slug } : {}),
    projectId: project.id,
    projectSlug: project.slug,
    projectName: project.name,
    taskId: task.id,
    ...(task.key ? { taskKey: task.key } : binding.taskKey ? { taskKey: binding.taskKey } : {}),
    taskTitle: task.title,
    taskStatus: task.status,
    ...(agent?.id ? { agentId: agent.id } : {}),
    ...(agent?.name ? { agentName: agent.name } : {}),
    ...(agent?.avatarUrl ? { agentAvatarUrl: agent.avatarUrl } : {}),
    ...(agent?.voiceId ? { agentVoiceId: agent.voiceId } : {}),
    mode: binding.mode,
    source: binding.source,
  };

  const siblingSnapshot = formatSiblingTaskSnapshot(project.id, task.id);

  const promptContext = [
    buildScopeSection({
      scope: "task",
      companyName: company?.name,
      companySlug: company?.slug,
      projectName: project.name,
      projectSlug: project.slug,
      taskLabel: task.key ? `[${task.key}] ${task.title}` : task.title,
      status: task.status,
      assignee: taskAssignee?.name ?? "Unassigned",
      agent: agent?.name ?? "No agent bound",
      mode: binding.mode,
      source: binding.source,
    }),
    "",
    "### Task description",
    clip(task.description, 1200),
    "",
    "### Recent comments",
    formatRecentComments(detail.timeline),
    "",
    "### Recent task activity",
    formatRecentActivity(detail.timeline),
    "",
    "### Other tasks in this project (peripheral awareness)",
    siblingSnapshot,
    "Use search_tasks if the operator references a task outside this list.",
  ].join("\n");

  return {
    binding: resolvedBinding,
    promptContext,
    ...(agent
      ? {
          agent: {
            id: agent.id,
            name: agent.name,
            role: agent.role,
            ...(agent.personality ? { personality: agent.personality } : {}),
          },
        }
      : {}),
  };
}

function formatProjectTaskSnapshot(projectId: string): string {
  const tasks = listTasks({ projectId, includeNonProduction: true }).tasks.slice(0, 6);
  if (tasks.length === 0) {
    return "No recent project tasks.";
  }

  return tasks
    .map((task) => {
      const key = task.key ? `[${task.key}] ` : "";
      const assignee = task.assignee ?? "unassigned";
      return `- ${key}${task.title} (${formatOperatorTaskStatusLabel(task.status) ?? task.status}, assigned: ${assignee})`;
    })
    .join("\n");
}

function formatSiblingTaskSnapshot(projectId: string, excludeTaskId: string): string {
  const siblings = listTasks({ projectId, includeNonProduction: true })
    .tasks
    .filter((task) => task.id !== excludeTaskId)
    .slice(0, 6);

  if (siblings.length === 0) {
    return "No other tasks in this project.";
  }

  return siblings
    .map((task) => {
      const key = task.key ? `[${task.key}] ` : "";
      const assignee = task.assignee ?? "unassigned";
      return `- ${key}${task.title} (${formatOperatorTaskStatusLabel(task.status) ?? task.status}, assigned: ${assignee})`;
    })
    .join("\n");
}

function buildProjectContext(binding: NormalizedVoiceBindingRequest): VoiceTaskContextResolution {
  const projectIdentifier = binding.projectId ?? binding.projectSlug;
  if (!projectIdentifier) {
    throw new OrchestrationApiError(400, "invalid_voice_binding", "Project binding requires projectId or projectSlug");
  }

  const { project } = getProject(projectIdentifier);
  const company = lookupCompany(project.companyId);
  if (!matchesCompanyAlias(company, binding.companySlug)) {
    throw new OrchestrationApiError(404, "project_not_found", "Project not found");
  }
  const agent = resolveBindingAgent({
    companyId: project.companyId,
    requestedAgentId: binding.agentId,
  });
  const projectTaskSnapshot = formatProjectTaskSnapshot(project.id);
  const recentProjectActivity = projectTaskSnapshot === "No recent project tasks."
    ? projectTaskSnapshot
    : "See the project task snapshot above for the current task list and status snapshot.";

  const resolvedBinding: ResolvedVoiceBinding = {
    scope: "project",
    ...(company?.slug ? { companySlug: company.slug } : {}),
    projectId: project.id,
    projectSlug: project.slug,
    projectName: project.name,
    ...(agent?.id ? { agentId: agent.id } : {}),
    ...(agent?.name ? { agentName: agent.name } : {}),
    ...(agent?.avatarUrl ? { agentAvatarUrl: agent.avatarUrl } : {}),
    ...(agent?.voiceId ? { agentVoiceId: agent.voiceId } : {}),
    mode: binding.mode,
    source: binding.source,
  };

  const promptContext = [
    buildScopeSection({
      scope: "project",
      companyName: company?.name,
      companySlug: company?.slug,
      projectName: project.name,
      projectSlug: project.slug,
      taskLabel: "No specific task bound",
      status: project.status,
      assignee: "n/a",
      agent: agent?.name ?? "No agent bound",
      mode: binding.mode,
      source: binding.source,
    }),
    "",
    "### Project summary",
    clip(project.description, 900),
    `- Project status: ${project.status}`,
    `- Task counts: ${project.taskCount} total · ${project.inProgress} in progress · ${project.review} review · ${project.completed} done`,
    `- Active agents: ${project.activeAgents ?? 0}`,
    "",
    "### Project task snapshot",
    projectTaskSnapshot,
    "",
    "### Task description",
    "No specific task bound. Use the project snapshot to choose the next thread.",
    "",
    "### Recent comments",
    "No specific task bound.",
    "",
    "### Recent task activity",
    recentProjectActivity,
  ].join("\n");

  return {
    binding: resolvedBinding,
    promptContext,
    ...(agent
      ? {
          agent: {
            id: agent.id,
            name: agent.name,
            role: agent.role,
            ...(agent.personality ? { personality: agent.personality } : {}),
          },
        }
      : {}),
  };
}

export function resolveVoiceAgentContext(
  input: VoiceBindingRequest | NormalizedVoiceBindingRequest
): VoiceTaskContextResolution | null {
  const binding = normalizeVoiceBindingRequest(input);
  if (!binding.agentId) {
    return null;
  }

  const company = lookupCompanyBySlug(binding.companySlug);
  if (!company) {
    if (binding.companySlug) {
      throw new OrchestrationApiError(404, "company_not_found", "Company not found");
    }
    return null;
  }

  const agent = resolveRequestedBindingAgent({
    companyId: company.id,
    requestedAgentId: binding.agentId,
  });
  if (!agent) {
    return null;
  }

  const resolvedBinding: ResolvedVoiceBinding = {
    scope: "global",
    companySlug: company.slug,
    agentId: agent.id,
    agentName: agent.name,
    ...(agent.avatarUrl ? { agentAvatarUrl: agent.avatarUrl } : {}),
    ...(agent.voiceId ? { agentVoiceId: agent.voiceId } : {}),
    mode: binding.mode,
    source: binding.source,
  };

  const promptContext = [
    "### Bound voice agent",
    `- Company: ${company.name} (${company.slug})`,
    `- Agent: ${agent.name}`,
    `- Role: ${agent.role}`,
    `- Session mode: ${binding.mode}`,
    `- Session source: ${binding.source}`,
    "",
    "### Operating frame",
    "No specific task or project is bound to this call. Speak as the named agent, keep the conversation concise, and use voice tools for fresh workspace context before making claims about current tasks or runs.",
  ].join("\n");

  return {
    binding: resolvedBinding,
    promptContext,
    agent: {
      id: agent.id,
      name: agent.name,
      role: agent.role,
      ...(agent.personality ? { personality: agent.personality } : {}),
    },
  };
}

export function resolveVoiceTaskContext(
  input: VoiceBindingRequest | NormalizedVoiceBindingRequest
): VoiceTaskContextResolution {
  const binding = normalizeVoiceBindingRequest(input);

  if (binding.scope === "task") {
    return buildTaskContext(binding);
  }

  if (binding.scope === "project") {
    return buildProjectContext(binding);
  }

  throw new OrchestrationApiError(
    400,
    "invalid_voice_binding",
    "Task or project binding is required for scoped voice context"
  );
}
