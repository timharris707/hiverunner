import { AGENT_CONFIGS, getAgentByAnyId } from "@/config/agents";
import type {
  ApprovalStatus,
  ApprovalType,
  OrchestrationActivityEvent,
  OrchestrationAgentExecutionRun,
  OrchestrationAgentProfile,
  OrchestrationAgentProfileActivity,
  OrchestrationAgentProfileTask,
  OrchestrationApproval,
  OrchestrationCompanyGoal,
  OrchestrationCompanyInboxEvent,
  OrchestrationCompanyInboxTask,
  OrchestrationEvalCase,
  OrchestrationExperimentReportEvidence,
  OrchestrationEvalLibraryFacet,
  OrchestrationEvalLibraryFacets,
  OrchestrationEvalLibraryFilters,
  OrchestrationEvalLibraryResult,
  OrchestrationEvalReviewOutcome,
  OrchestrationImprovementCompanyControl,
  OrchestrationImprovementDashboard,
  OrchestrationImprovementDismissalReason,
  OrchestrationImprovementEvidenceSummary,
  OrchestrationImprovementRecommendation,
  OrchestrationImprovementRecommendationFilters,
  OrchestrationImprovementRecommendationGroup,
  OrchestrationImprovementRecommendationListResult,
  OrchestrationImprovementRecommendationStatus,
  OrchestrationImprovementScope,
  OrchestrationImprovementScopeType,
  OrchestrationImprovementSeverity,
  OrchestrationImprovementSourceLink,
  OrchestrationImprovementSuppression,
  OrchestrationImprovementSuppressionReason,
  OrchestrationImprovementConfidence,
  OrchestrationImprovementTriggerControl,
  OrchestrationImprovementTriggerFiring,
  OrchestrationImprovementTriggerKey,
  OrchestrationRuntime,
  OrchestrationRuntimeCliUpdateResult,
  OrchestrationRuntimeDependencyReadiness,
  OrchestrationRuntimeDependencyStatus,
  OrchestrationRuntimeHealth,
  OrchestrationRuntimeHealthStatus,
  OrchestrationRuntimeAttachResult,
  OrchestrationRuntimeExecutionRun,
  OrchestrationRuntimeKind,
  OrchestrationRuntimeScope,
  OrchestrationRuntimeStatus,
  OrchestrationRoutine,
  OrchestrationRoutineListItem,
  AvatarThemePreset,
  BoardState,
  CompanyTheme,
  OrchestrationAgent,
  OrchestrationCompany,
  OrchestrationProject,
  OrchestrationGoalContractEvidence,
  OrchestrationGoalContractItem,
  OrchestrationPendingSprintPlanDraftSummary,
  OrchestrationSprintPlanDraft,
  OrchestrationSprintPlanDraftSprint,
  OrchestrationSprintPlanDraftTask,
  OrchestrationTemplateDraftPlan,
  OrchestrationSprint,
  OrchestrationStaleAlert,
  OrchestrationTask,
  DetectedOrchestrationRuntime,
  TaskExecutionEngine,
  TaskStatus,
  AgentRosterState,
} from "@/lib/orchestration/types";
import type {
  ExecutionHive,
  ExecutionHiveMatrixConfig,
  ExecutionHiveProbeKind,
  ExecutionHiveProbeRunPayload,
  HiveRoutingLaneId,
  ModelSourceInventoryItem,
  ModelSourceProbeResult,
  RouteTarget,
  RoutingLane,
} from "@/lib/orchestration/execution-hives";
import type { AvailableModel, AvailableModelCapability, AvailableModelProvider, AvailableModelRefreshStatus } from "@/lib/orchestration/available-models";
import { AVATAR_ICON_PREFIX } from "@/lib/orchestration/avatar-icons";
import { distinctProjectColor, suggestProjectColor } from "@/lib/ui/project-colors";

type JsonRecord = Record<string, unknown>;
const FALLBACK_AGENT_ICON = "icon:bot";

function jsonRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function normalizeAgentEmoji(value: unknown): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.startsWith(AVATAR_ICON_PREFIX) ? trimmed : FALLBACK_AGENT_ICON;
}

function slugifyAgentName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function normalizeAgentSlug(raw: JsonRecord, name: string, fallbackId: string): string {
  const explicit = raw.slug ? String(raw.slug).trim() : "";
  return explicit || slugifyAgentName(name) || fallbackId;
}

function normalizeTaskExecutionEngine(value: unknown): TaskExecutionEngine | undefined {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "hiverunner" || normalized === "symphony" || normalized === "manual"
    ? normalized
    : undefined;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

const READ_DEDUPE_TTL_MS = 250;
const readRequestCache = new Map<string, { expiresAt: number; promise: Promise<unknown | null> }>();

function fetchJsonDedupe<T>(url: string, ttlMs = READ_DEDUPE_TTL_MS): Promise<T | null> {
  const now = Date.now();
  const cached = readRequestCache.get(url);
  if (cached && cached.expiresAt > now) {
    return cached.promise as Promise<T | null>;
  }

  const promise = fetchJson<T>(url);
  readRequestCache.set(url, { expiresAt: now + ttlMs, promise });
  void promise.finally(() => {
    const latest = readRequestCache.get(url);
    if (latest?.promise === promise) {
      readRequestCache.delete(url);
    }
  });
  return promise;
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
    sourceWorkspaceRoot: raw.sourceWorkspaceRoot ? String(raw.sourceWorkspaceRoot) : raw.source_workspace_root ? String(raw.source_workspace_root) : null,
    taskCount: Number(raw.taskCount ?? 0),
    inProgress: Number(raw.inProgress ?? 0),
    backlog: Number(raw.backlog ?? 0),
    review: Number(raw.review ?? 0),
    completed: Number(raw.completed ?? 0),
    velocity: raw.velocity ? Number(raw.velocity) : undefined,
    activeAgents: raw.activeAgents ? Number(raw.activeAgents) : undefined,
    defaultExecutionEngine: normalizeTaskExecutionEngine(raw.defaultExecutionEngine ?? raw.default_execution_engine),
  };
}

function normalizeProjectList(rows: JsonRecord[]): OrchestrationProject[] {
  const usedColors = new Set<string>();
  return rows.map((raw) => {
    const project = normalizeProject(raw);
    return {
      ...project,
      color: distinctProjectColor(project, usedColors),
    };
  });
}

function normalizeCompany(raw: JsonRecord): OrchestrationCompany {
  const theme = normalizeCompanyTheme((raw.theme ?? {}) as JsonRecord);
  const stats = (raw.stats ?? {}) as JsonRecord;
  const workspace = (raw.workspace ?? {}) as JsonRecord;
  const owner = (raw.owner ?? {}) as JsonRecord;

  const slug = String(raw.slug ?? raw.id ?? "");
  return {
    id: String(raw.id ?? ""),
    slug,
    workspaceSlug: String(raw.workspaceSlug ?? raw.workspace_slug ?? slug),
    runtimeSlug: String(raw.runtimeSlug ?? raw.runtime_slug ?? raw.workspaceSlug ?? raw.workspace_slug ?? slug),
    code: String(raw.code ?? slug.slice(0, 3).toUpperCase()),
    name: String(raw.name ?? "Untitled Company"),
    description: String(raw.description ?? ""),
    status: (String(raw.status ?? "active") as OrchestrationCompany["status"]) ?? "active",
    created: String(raw.created ?? raw.created_at ?? new Date().toISOString()),
    owner: owner.id
      ? {
          id: String(owner.id),
          displayName: String(owner.displayName ?? owner.display_name ?? "Owner"),
          email: String(owner.email ?? ""),
          role: (String(owner.role ?? "owner") as NonNullable<OrchestrationCompany["owner"]>["role"]) ?? "owner",
          status: (String(owner.status ?? "active") as NonNullable<OrchestrationCompany["owner"]>["status"]) ?? "active",
        }
      : undefined,
    workspace: {
      root: String(workspace.root ?? raw.workspace_root ?? ""),
      source: String(
        workspace.source ?? raw.workspace_source ?? "manual"
      ) as OrchestrationCompany["workspace"]["source"],
    },
    theme,
    defaultExecutionEngine: normalizeTaskExecutionEngine(raw.defaultExecutionEngine ?? raw.default_execution_engine),
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

function normalizeMetadata(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeTaskModelDisplay(value: unknown): OrchestrationTask["modelDisplay"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as JsonRecord;
  const provider = String(raw.provider ?? "runtime");
  if (!["anthropic", "codex", "gemini", "openai", "manual", "runtime"].includes(provider)) return null;
  return {
    provider: provider as NonNullable<OrchestrationTask["modelDisplay"]>["provider"],
    providerLabel: String(raw.providerLabel ?? raw.provider_label ?? "Runtime"),
    model: String(raw.model ?? ""),
    displayModel: String(raw.displayModel ?? raw.display_model ?? raw.model ?? ""),
    label: String(raw.label ?? raw.model ?? "Runtime managed"),
    color: String(raw.color ?? "var(--text-secondary)"),
    background: String(raw.background ?? "var(--surface-hover)"),
    border: String(raw.border ?? "var(--border)"),
    sourceAgentId: raw.sourceAgentId ? String(raw.sourceAgentId) : raw.source_agent_id ? String(raw.source_agent_id) : undefined,
    sourceAgentName: raw.sourceAgentName ? String(raw.sourceAgentName) : raw.source_agent_name ? String(raw.source_agent_name) : undefined,
    source:
      raw.source === "assignee" || raw.source === "runner" || raw.source === "review_source"
        ? raw.source
        : undefined,
  };
}

function normalizeAvailableModel(raw: JsonRecord): AvailableModel {
  const capabilities = Array.isArray(raw.capabilities)
    ? raw.capabilities.map((item) => String(item)).filter((item): item is AvailableModelCapability =>
        item === "text" || item === "vision" || item === "tools" || item === "structured-output"
      )
    : [];
  return {
    id: String(raw.id ?? ""),
    displayName: String(raw.displayName ?? raw.display_name ?? raw.id ?? "Untitled model"),
    runtimeProvider: String(raw.runtimeProvider ?? raw.runtime_provider ?? "openai") as AvailableModelProvider,
    defaultRuntimeLabel: String(raw.defaultRuntimeLabel ?? raw.default_runtime_label ?? ""),
    modelSourceId: String(raw.modelSourceId ?? raw.model_source_id ?? ""),
    capabilities,
    contextWindow: raw.contextWindow === null || raw.context_window === null
      ? null
      : raw.contextWindow !== undefined
        ? Number(raw.contextWindow)
        : raw.context_window !== undefined
          ? Number(raw.context_window)
          : null,
    description: raw.description ? String(raw.description) : null,
    isSeed: Boolean(raw.isSeed ?? raw.is_seed),
    isActive: raw.isActive === undefined && raw.is_active === undefined ? true : Boolean(raw.isActive ?? raw.is_active),
    createdAt: String(raw.createdAt ?? raw.created_at ?? new Date().toISOString()),
    updatedAt: String(raw.updatedAt ?? raw.updated_at ?? new Date().toISOString()),
  };
}

function normalizeAvailableModelRefreshStatus(raw: JsonRecord): AvailableModelRefreshStatus {
  return {
    provider: String(raw.provider ?? "openai") as AvailableModelProvider,
    status: String(raw.status ?? "skipped") as AvailableModelRefreshStatus["status"],
    refreshedAt: String(raw.refreshedAt ?? raw.refreshed_at ?? new Date().toISOString()),
    modelCount: Number(raw.modelCount ?? raw.model_count ?? 0),
    message: raw.message === null || raw.message === undefined ? null : String(raw.message),
  };
}

function normalizeRuntimeKind(value: unknown): OrchestrationRuntimeKind {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "daemon" ||
    normalized === "api" ||
    normalized === "manual" ||
    normalized === "external" ||
    normalized === "cli"
    ? normalized
    : "cli";
}

function normalizeRuntimeScope(value: unknown): OrchestrationRuntimeScope {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "company" ||
    normalized === "agent" ||
    normalized === "workspace" ||
    normalized === "external"
    ? normalized
    : "agent";
}

function normalizeRuntimeStatus(value: unknown): OrchestrationRuntimeStatus {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "online" ||
    normalized === "offline" ||
    normalized === "error" ||
    normalized === "disabled" ||
    normalized === "unknown"
    ? normalized
    : "unknown";
}

function normalizeRuntimeHealthStatus(value: unknown): OrchestrationRuntimeHealthStatus {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "ready" ||
    normalized === "needs_login" ||
    normalized === "missing_cli" ||
    normalized === "failed_probe" ||
    normalized === "disabled" ||
    normalized === "unknown"
    ? normalized
    : "unknown";
}

function normalizeRuntimeHealth(raw: unknown): OrchestrationRuntimeHealth | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const record = raw as JsonRecord;
  const status = normalizeRuntimeHealthStatus(record.status);
  return {
    status,
    label: String(record.label ?? status),
    checkedAt: record.checkedAt ? String(record.checkedAt) : null,
    command: record.command ? String(record.command) : null,
    commandPath: record.commandPath ? String(record.commandPath) : null,
    version: record.version ? String(record.version) : null,
    versionLatest:
      typeof record.versionLatest === "boolean" ? record.versionLatest : null,
    latestVersion: record.latestVersion ? String(record.latestVersion) : null,
    versionCheckSource: record.versionCheckSource ? String(record.versionCheckSource) : null,
    versionCheckDetail: record.versionCheckDetail ? String(record.versionCheckDetail) : null,
    workspaceRoot: record.workspaceRoot ? String(record.workspaceRoot) : null,
    workspaceWritable:
      typeof record.workspaceWritable === "boolean" ? record.workspaceWritable : null,
    authReady: typeof record.authReady === "boolean" ? record.authReady : null,
    details: Array.isArray(record.details) ? record.details.map((detail) => String(detail)) : [],
    error: record.error ? String(record.error) : null,
  };
}

function normalizeTaskStatus(value: unknown): TaskStatus {
  const baseStatus = String(value ?? "backlog");
  return (baseStatus === "to-do" ? "to-do" : baseStatus) as TaskStatus;
}

function normalizeTaskDependencies(raw: unknown): OrchestrationTask["dependencies"] {
  if (!Array.isArray(raw)) return undefined;
  return raw.map((item) => {
    const row = (typeof item === "object" && item !== null ? item : {}) as JsonRecord;
    return {
      id: String(row.id ?? ""),
      key: row.key ? String(row.key) : undefined,
      title: String(row.title ?? "Untitled Task"),
      status: normalizeTaskStatus(row.status),
      assignee: row.assignee ? String(row.assignee) : undefined,
    };
  }).filter((item) => item.id);
}

function normalizeRuntime(raw: JsonRecord): OrchestrationRuntime {
  const metadata = normalizeMetadata(raw.metadata);
  return {
    id: String(raw.id ?? ""),
    companyId: String(raw.companyId ?? raw.company_id ?? ""),
    agentId: raw.agentId ? String(raw.agentId) : raw.agent_id ? String(raw.agent_id) : null,
    provider: String(raw.provider ?? "manual"),
    runtimeKind: normalizeRuntimeKind(raw.runtimeKind ?? raw.runtime_kind),
    scope: normalizeRuntimeScope(raw.scope),
    runtimeSlug: String(raw.runtimeSlug ?? raw.runtime_slug ?? raw.id ?? ""),
    displayName: String(raw.displayName ?? raw.display_name ?? "Runtime"),
    command: raw.command ? String(raw.command) : null,
    version: raw.version ? String(raw.version) : null,
    status: normalizeRuntimeStatus(raw.status),
    workspaceRoot: raw.workspaceRoot ? String(raw.workspaceRoot) : raw.workspace_root ? String(raw.workspace_root) : null,
    metadata,
    health: normalizeRuntimeHealth(raw.health ?? metadata.health),
    lastSeenAt: raw.lastSeenAt ? String(raw.lastSeenAt) : raw.last_seen_at ? String(raw.last_seen_at) : null,
    createdAt: String(raw.createdAt ?? raw.created_at ?? new Date().toISOString()),
    updatedAt: String(raw.updatedAt ?? raw.updated_at ?? new Date().toISOString()),
  };
}

function normalizeDetectedRuntime(raw: JsonRecord): DetectedOrchestrationRuntime {
  return {
    provider: String(raw.provider ?? ""),
    displayName: String(raw.displayName ?? raw.display_name ?? raw.provider ?? "Runtime"),
    command: String(raw.command ?? ""),
    commandPath: String(raw.commandPath ?? raw.command_path ?? ""),
    version: raw.version ? String(raw.version) : undefined,
    status: normalizeRuntimeStatus(raw.status),
    metadata: normalizeMetadata(raw.metadata),
  };
}

function normalizeRuntimeDependencyStatus(value: unknown): OrchestrationRuntimeDependencyStatus {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (
    normalized === "ready" ||
    normalized === "missing_optional" ||
    normalized === "needs_login" ||
    normalized === "not_configured" ||
    normalized === "unknown"
  ) {
    return normalized;
  }
  return "unknown";
}

function normalizeRuntimeDependency(raw: JsonRecord): OrchestrationRuntimeDependencyReadiness {
  return {
    id: String(raw.id ?? ""),
    label: String(raw.label ?? raw.id ?? "Runtime dependency"),
    provider: String(raw.provider ?? ""),
    kind:
      raw.kind === "cli" ||
      raw.kind === "external-runner" ||
      raw.kind === "provider-key" ||
      raw.kind === "local-service"
        ? raw.kind
        : "cli",
    optionality:
      raw.optionality === "core_local_boot" ||
      raw.optionality === "optional_runtime" ||
      raw.optionality === "optional_provider_key" ||
      raw.optionality === "legacy_optional"
        ? raw.optionality
        : "optional_runtime",
    status: normalizeRuntimeDependencyStatus(raw.status),
    command: raw.command ? String(raw.command) : null,
    commandPath: raw.commandPath ? String(raw.commandPath) : raw.command_path ? String(raw.command_path) : null,
    version: raw.version ? String(raw.version) : null,
    versionLatest: typeof raw.versionLatest === "boolean" ? raw.versionLatest : null,
    latestVersion: raw.latestVersion ? String(raw.latestVersion) : null,
    versionCheckSource: raw.versionCheckSource ? String(raw.versionCheckSource) : null,
    versionCheckDetail: raw.versionCheckDetail ? String(raw.versionCheckDetail) : null,
    authReady: typeof raw.authReady === "boolean" ? raw.authReady : null,
    envVars: Array.isArray(raw.envVars) ? raw.envVars.map((item) => String(item)).filter(Boolean) : [],
    note: String(raw.note ?? ""),
    setupHint: String(raw.setupHint ?? ""),
  };
}

function normalizeRuntimeExecutionStatus(value: unknown): OrchestrationRuntimeExecutionRun["status"] {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "running" ||
    normalized === "completed" ||
    normalized === "failed" ||
    normalized === "cancelled" ||
    normalized === "pending"
    ? normalized
    : "pending";
}

function normalizeOptionalNumber(value: unknown): number | undefined {
  if (value === null || typeof value === "undefined") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function normalizeRuntimeExecutionRun(raw: JsonRecord): OrchestrationRuntimeExecutionRun {
  return {
    id: String(raw.id ?? ""),
    taskId: raw.taskId ? String(raw.taskId) : raw.task_id ? String(raw.task_id) : null,
    taskKey: raw.taskKey ? String(raw.taskKey) : raw.task_key ? String(raw.task_key) : null,
    taskTitle: raw.taskTitle ? String(raw.taskTitle) : raw.task_title ? String(raw.task_title) : null,
    projectId: raw.projectId ? String(raw.projectId) : raw.project_id ? String(raw.project_id) : null,
    projectSlug: raw.projectSlug ? String(raw.projectSlug) : raw.project_slug ? String(raw.project_slug) : null,
    projectName: raw.projectName ? String(raw.projectName) : raw.project_name ? String(raw.project_name) : null,
    agentId: raw.agentId ? String(raw.agentId) : raw.agent_id ? String(raw.agent_id) : null,
    agentName: raw.agentName ? String(raw.agentName) : raw.agent_name ? String(raw.agent_name) : null,
    provider: String(raw.provider ?? "manual"),
    status: normalizeRuntimeExecutionStatus(raw.status),
    sessionId: raw.sessionId ? String(raw.sessionId) : raw.session_id ? String(raw.session_id) : null,
    startedAt: raw.startedAt ? String(raw.startedAt) : raw.started_at ? String(raw.started_at) : null,
    completedAt: raw.completedAt ? String(raw.completedAt) : raw.completed_at ? String(raw.completed_at) : null,
    createdAt: String(raw.createdAt ?? raw.created_at ?? new Date().toISOString()),
    durationMs: normalizeOptionalNumber(raw.durationMs ?? raw.duration_ms) ?? null,
    errorMessage: raw.errorMessage ? String(raw.errorMessage) : raw.error_message ? String(raw.error_message) : null,
    inputTokens: normalizeOptionalNumber(raw.inputTokens ?? raw.input_tokens),
    outputTokens: normalizeOptionalNumber(raw.outputTokens ?? raw.output_tokens),
    cacheReadTokens: normalizeOptionalNumber(raw.cacheReadTokens ?? raw.cache_read_tokens),
    cacheWriteTokens: normalizeOptionalNumber(raw.cacheWriteTokens ?? raw.cache_write_tokens),
    totalTokens: normalizeOptionalNumber(raw.totalTokens ?? raw.total_tokens),
    totalCostUsd: normalizeOptionalNumber(raw.totalCostUsd ?? raw.total_cost_usd),
    model: raw.model ? String(raw.model) : null,
    transcriptEventCount: normalizeOptionalNumber(raw.transcriptEventCount ?? raw.transcript_event_count),
  };
}

export async function listCompanies(input?: {
  includeArchived?: boolean;
  includeNonProduction?: boolean;
}): Promise<OrchestrationCompany[]> {
  const params = new URLSearchParams();
  params.set("includeNonProduction", input?.includeNonProduction === false ? "false" : "true");
  if (typeof input?.includeArchived === "boolean") {
    params.set("includeArchived", input.includeArchived ? "true" : "false");
  }
  const data = await fetchJsonDedupe<{ companies: JsonRecord[] }>(`/api/orchestration/companies?${params.toString()}`);
  return (data?.companies ?? []).map(normalizeCompany);
}

export async function archiveCompanyBySlug(companySlug: string): Promise<boolean> {
  const response = await fetch(`/api/orchestration/companies/${encodeURIComponent(companySlug)}`, {
    method: "DELETE",
  }).catch(() => null);
  return Boolean(response?.ok);
}

export async function restoreCompanyBySlug(companySlug: string): Promise<boolean> {
  const response = await fetch(`/api/orchestration/companies/${encodeURIComponent(companySlug)}/restore`, {
    method: "POST",
  }).catch(() => null);
  return Boolean(response?.ok);
}

export async function hardDeleteCompanyBySlug(companySlug: string): Promise<boolean> {
  const response = await fetch(`/api/orchestration/companies/${encodeURIComponent(companySlug)}?hard=true`, {
    method: "DELETE",
  }).catch(() => null);
  return Boolean(response?.ok);
}

export async function archiveCompanyAgent(agentId: string, input?: {
  replacementAgentId?: string;
  replacementFallback?: string;
}): Promise<boolean> {
  const response = await fetch(`/api/orchestration/agents/${encodeURIComponent(agentId)}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input ?? {}),
  }).catch(() => null);

  return Boolean(response?.ok);
}

export async function deleteCompanyAgent(agentId: string, input?: {
  replacementAgentId?: string;
  replacementFallback?: string;
}): Promise<boolean> {
  const response = await fetch(`/api/orchestration/agents/${encodeURIComponent(agentId)}?hard=true`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input ?? {}),
  }).catch(() => null);

  return Boolean(response?.ok);
}

export async function restoreCompanyAgent(agentId: string): Promise<boolean> {
  const response = await fetch(`/api/orchestration/agents/${encodeURIComponent(agentId)}/restore`, {
    method: "POST",
  }).catch(() => null);

  return Boolean(response?.ok);
}

export async function createCompany(input: {
  name: string;
  description: string;
  owner?: { displayName: string; email: string };
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

export async function listCompanyRuntimes(
  companySlug: string,
  input?: { fast?: boolean },
): Promise<{
  runtimes: OrchestrationRuntime[];
  detectedLocalRuntimes: DetectedOrchestrationRuntime[];
  runtimeDependencies: OrchestrationRuntimeDependencyReadiness[];
  recentExecutionRuns: OrchestrationRuntimeExecutionRun[];
  runtimeTaskDurationP50: Record<string, { durationMs: number | null; sampleSize: number }>;
}> {
  const query = input?.fast ? "?fast=1" : "";
  const data = await fetchJson<{
    runtimes?: JsonRecord[];
    detectedLocalRuntimes?: JsonRecord[];
    runtimeDependencies?: JsonRecord[];
    recentExecutionRuns?: JsonRecord[];
    runtimeTaskDurationP50?: JsonRecord;
  }>(`/api/orchestration/companies/${encodeURIComponent(companySlug)}/runtimes${query}`);

  return {
    runtimes: (data?.runtimes ?? []).map(normalizeRuntime),
    detectedLocalRuntimes: (data?.detectedLocalRuntimes ?? []).map(normalizeDetectedRuntime),
    runtimeDependencies: (data?.runtimeDependencies ?? []).map(normalizeRuntimeDependency),
    recentExecutionRuns: (data?.recentExecutionRuns ?? []).map(normalizeRuntimeExecutionRun),
    runtimeTaskDurationP50: normalizeRuntimeTaskDurationP50(data?.runtimeTaskDurationP50),
  };
}

function normalizeRuntimeTaskDurationP50(raw: JsonRecord | undefined): Record<string, { durationMs: number | null; sampleSize: number }> {
  if (!raw) return {};
  return Object.fromEntries(
    Object.entries(raw).map(([key, value]) => {
      const record = value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
      return [key, {
        durationMs: normalizeOptionalNumber(record.durationMs ?? record.duration_ms) ?? null,
        sampleSize: normalizeOptionalNumber(record.sampleSize ?? record.sample_size) ?? 0,
      }];
    }),
  );
}

function normalizeModelSourceInventoryItem(raw: JsonRecord): ModelSourceInventoryItem {
  const status = String(raw.status ?? "not_configured") as ModelSourceInventoryItem["status"];
  const kind = String(raw.kind ?? "first-party") as ModelSourceInventoryItem["kind"];
  const authSurface = raw.authSurface ? String(raw.authSurface) as NonNullable<ModelSourceInventoryItem["authSurface"]> : undefined;
  return {
    id: String(raw.id ?? ""),
    label: String(raw.label ?? "Model source"),
    kind,
    status,
    capabilities: Array.isArray(raw.capabilities) ? raw.capabilities.map((value) => String(value)) : [],
    note: String(raw.note ?? ""),
    authSurface,
    credentialStorage: raw.credentialStorage && typeof raw.credentialStorage === "object" && !Array.isArray(raw.credentialStorage)
      ? {
          adapterId: String((raw.credentialStorage as JsonRecord).adapterId ?? ""),
          label: String((raw.credentialStorage as JsonRecord).label ?? ""),
          productionReady: Boolean((raw.credentialStorage as JsonRecord).productionReady),
          note: String((raw.credentialStorage as JsonRecord).note ?? ""),
        }
      : undefined,
    credentialSecretNames: Array.isArray(raw.credentialSecretNames) ? raw.credentialSecretNames.map((value) => String(value)) : undefined,
    configuredSecretNames: Array.isArray(raw.configuredSecretNames) ? raw.configuredSecretNames.map((value) => String(value)) : undefined,
    setupHint: raw.setupHint ? String(raw.setupHint) : undefined,
    lastCheckedAt: raw.lastCheckedAt ? String(raw.lastCheckedAt) : undefined,
  };
}

function normalizeModelSourceProbeResult(raw: JsonRecord): ModelSourceProbeResult {
  const status = String(raw.status ?? "warn") as ModelSourceProbeResult["status"];
  const authSurface = raw.authSurface ? String(raw.authSurface) as NonNullable<ModelSourceProbeResult["authSurface"]> : undefined;
  return {
    sourceId: String(raw.sourceId ?? ""),
    status,
    label: String(raw.label ?? "Model source"),
    checkedAt: String(raw.checkedAt ?? new Date().toISOString()),
    authSurface,
    configuredSecretNames: Array.isArray(raw.configuredSecretNames) ? raw.configuredSecretNames.map((value) => String(value)) : undefined,
    endpointLabel: raw.endpointLabel ? String(raw.endpointLabel) : undefined,
    latencyMs: typeof raw.latencyMs === "number" ? raw.latencyMs : undefined,
    note: String(raw.note ?? ""),
  };
}

export async function listCompanyModelSources(companySlug: string): Promise<ModelSourceInventoryItem[]> {
  const data = await fetchJson<{ modelSources?: JsonRecord[] }>(
    `/api/orchestration/companies/${encodeURIComponent(companySlug)}/model-sources`,
  );
  return (data?.modelSources ?? []).map(normalizeModelSourceInventoryItem);
}

export async function runCompanyModelSourceProbe(
  companySlug: string,
  sourceId: string,
): Promise<({ probe: ModelSourceProbeResult } & Partial<CompanyExecutionHivesPayload>) | null> {
  const response = await fetch(
    `/api/orchestration/companies/${encodeURIComponent(companySlug)}/model-sources/${encodeURIComponent(sourceId)}/probe`,
    { method: "POST" },
  ).catch(() => null);

  if (!response?.ok) return null;
  const json = (await response.json()) as { probe?: JsonRecord; hives?: ExecutionHive[]; activeHive?: ExecutionHive | null; executionDefaults?: Record<string, unknown> };
  if (!json.probe) return null;
  return {
    probe: normalizeModelSourceProbeResult(json.probe),
    hives: Array.isArray(json.hives) ? json.hives : undefined,
    activeHive: json.activeHive ?? undefined,
    executionDefaults: json.executionDefaults,
  };
}

export async function saveCompanyModelSourceCredential(
  companySlug: string,
  input: { sourceId: string; credentialValue: string },
): Promise<{ modelSource: ModelSourceInventoryItem; modelSources: ModelSourceInventoryItem[] } | null> {
  const response = await fetch(`/api/orchestration/companies/${encodeURIComponent(companySlug)}/model-sources`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).catch(() => null);

  if (!response?.ok) return null;
  const json = (await response.json()) as { modelSource?: JsonRecord; modelSources?: JsonRecord[] };
  if (!json.modelSource) return null;
  return {
    modelSource: normalizeModelSourceInventoryItem(json.modelSource),
    modelSources: (json.modelSources ?? []).map(normalizeModelSourceInventoryItem),
  };
}

export async function upsertCompanyRuntime(
  companySlug: string,
  input: {
    agentId?: string | null;
    provider: string;
    runtimeSlug?: string | null;
    displayName?: string | null;
    runtimeKind?: OrchestrationRuntimeKind | string | null;
    scope?: OrchestrationRuntimeScope | string | null;
    command?: string | null;
    version?: string | null;
    status?: OrchestrationRuntimeStatus | string | null;
    workspaceRoot?: string | null;
    metadata?: Record<string, unknown>;
    lastSeenAt?: string | null;
  },
): Promise<OrchestrationRuntimeAttachResult | null> {
  const response = await fetch(`/api/orchestration/companies/${encodeURIComponent(companySlug)}/runtimes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).catch(() => null);

  if (!response?.ok) return null;
  const json = (await response.json()) as {
    runtime?: JsonRecord;
    created?: unknown;
    agentProviderSwitch?: {
      switched?: unknown;
      blockReason?: unknown;
      message?: unknown;
    } | null;
  };
  if (!json.runtime) return null;
  return {
    runtime: normalizeRuntime(json.runtime),
    created: Boolean(json.created),
    agentProviderSwitch: json.agentProviderSwitch
      ? {
          switched: Boolean(json.agentProviderSwitch.switched),
          blockReason:
            typeof json.agentProviderSwitch.blockReason === "string"
              ? json.agentProviderSwitch.blockReason
              : null,
          message: String(json.agentProviderSwitch.message ?? ""),
        }
      : null,
  };
}

function normalizeRuntimeCliUpdate(raw: JsonRecord): OrchestrationRuntimeCliUpdateResult {
  return {
    provider: String(raw.provider ?? ""),
    packageName: raw.packageName ? String(raw.packageName) : null,
    command: String(raw.command ?? ""),
    args: Array.isArray(raw.args) ? raw.args.map((value) => String(value)) : [],
    ok: Boolean(raw.ok),
    status: typeof raw.status === "number" ? raw.status : null,
    currentVersion: raw.currentVersion ? String(raw.currentVersion) : null,
    latestVersion: raw.latestVersion ? String(raw.latestVersion) : null,
    beforeVersion: raw.beforeVersion ? String(raw.beforeVersion) : null,
    afterVersion: raw.afterVersion ? String(raw.afterVersion) : null,
    output: String(raw.output ?? ""),
    error: raw.error ? String(raw.error) : null,
    jobId: raw.jobId ? String(raw.jobId) : null,
    phase: typeof raw.phase === "string"
      && ["queued", "running", "succeeded", "failed"].includes(raw.phase)
      ? raw.phase as OrchestrationRuntimeCliUpdateResult["phase"]
      : null,
    startedAt: raw.startedAt ? String(raw.startedAt) : null,
    completedAt: raw.completedAt ? String(raw.completedAt) : null,
    finished: typeof raw.finished === "boolean" ? raw.finished : undefined,
  };
}

function normalizeRuntimeCliUpdatePayload(json: {
  update?: JsonRecord;
  updateJob?: JsonRecord;
  runtimes?: JsonRecord[];
  detectedLocalRuntimes?: JsonRecord[];
}) {
  const update = json.updateJob
    ? normalizeRuntimeCliUpdate(json.updateJob)
    : json.update
      ? normalizeRuntimeCliUpdate(json.update)
      : null;
  if (!update) return null;
  return {
    update,
    runtimes: (json.runtimes ?? []).map(normalizeRuntime),
    detectedLocalRuntimes: (json.detectedLocalRuntimes ?? []).map(normalizeDetectedRuntime),
  };
}

function runtimeCliUpdateIsFinished(update: OrchestrationRuntimeCliUpdateResult): boolean {
  if (update.finished === true) return true;
  if (update.phase === "succeeded" || update.phase === "failed") return true;
  return !update.jobId && update.phase !== "running" && update.phase !== "queued";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function updateCompanyRuntimeCli(
  companySlug: string,
  provider: string,
): Promise<{
  update: OrchestrationRuntimeCliUpdateResult;
  runtimes: OrchestrationRuntime[];
  detectedLocalRuntimes: DetectedOrchestrationRuntime[];
} | null> {
  const response = await fetch(`/api/orchestration/companies/${encodeURIComponent(companySlug)}/runtimes/update`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider }),
  }).catch(() => null);

  if (!response?.ok) return null;
  const json = (await response.json()) as {
    update?: JsonRecord;
    updateJob?: JsonRecord;
    runtimes?: JsonRecord[];
    detectedLocalRuntimes?: JsonRecord[];
  };
  let payload = normalizeRuntimeCliUpdatePayload(json);
  if (!payload) return null;

  const startedAt = Date.now();
  while (!runtimeCliUpdateIsFinished(payload.update) && payload.update.jobId && Date.now() - startedAt < 305_000) {
    await sleep(1500);
    const poll = await fetch(
      `/api/orchestration/companies/${encodeURIComponent(companySlug)}/runtimes/update?jobId=${encodeURIComponent(payload.update.jobId)}`,
    ).catch(() => null);
    if (!poll?.ok) break;
    const pollJson = (await poll.json()) as {
      update?: JsonRecord;
      updateJob?: JsonRecord;
      runtimes?: JsonRecord[];
      detectedLocalRuntimes?: JsonRecord[];
    };
    const nextPayload = normalizeRuntimeCliUpdatePayload(pollJson);
    if (nextPayload) payload = nextPayload;
  }

  if (!runtimeCliUpdateIsFinished(payload.update)) {
    payload = {
      ...payload,
      update: {
        ...payload.update,
        ok: false,
        error: "CLI update is still running. Refresh the runtime inventory in a moment.",
      },
    };
  }

  return payload;
}

export type CompanyExecutionHivesPayload = {
  hives: ExecutionHive[];
  activeHive: ExecutionHive | null;
  executionDefaults: Record<string, unknown>;
};

export type AvailableModelInput = {
  id: string;
  displayName: string;
  runtimeProvider: AvailableModelProvider;
  defaultRuntimeLabel: string;
  modelSourceId: string;
  capabilities?: AvailableModelCapability[];
  contextWindow?: number | null;
  description?: string | null;
};

export type AvailableModelUpdate = Partial<Omit<AvailableModelInput, "id" | "runtimeProvider">> & {
  isActive?: boolean;
};

export async function listAvailableModels(input: { provider?: string; capability?: string; includeInactive?: boolean } = {}): Promise<AvailableModel[]> {
  const params = new URLSearchParams();
  if (input.provider) params.set("provider", input.provider);
  if (input.capability) params.set("capability", input.capability);
  if (input.includeInactive) params.set("includeInactive", "1");
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const data = await fetchJson<{ models?: JsonRecord[] }>(`/api/orchestration/available-models${suffix}`);
  return Array.isArray(data?.models) ? data.models.map(normalizeAvailableModel) : [];
}

export interface AgentProviderSwitchResult {
  switched: boolean;
  agentId: string;
  blockReason: string | null;
  message: string;
}

export async function switchAgentModel(
  agentId: string,
  input: { targetProvider: string; targetModel: string },
): Promise<AgentProviderSwitchResult> {
  const response = await fetch(`/api/orchestration/agents/${encodeURIComponent(agentId)}/provider`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      targetProvider: input.targetProvider,
      targetModel: input.targetModel,
      billingConfirmed: true,
    }),
  });
  const data = await response.json().catch(() => ({})) as Partial<AgentProviderSwitchResult> & { error?: string; message?: string };
  if (!response.ok) {
    throw new Error(data.message ?? data.error ?? "Could not update the agent model.");
  }
  return {
    switched: Boolean(data.switched),
    agentId: String(data.agentId ?? agentId),
    blockReason: typeof data.blockReason === "string" ? data.blockReason : null,
    message: String(data.message ?? ""),
  };
}

export async function createAvailableModel(input: AvailableModelInput): Promise<AvailableModel | null> {
  const response = await fetch("/api/orchestration/available-models", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).catch(() => null);
  if (!response?.ok) return null;
  const data = await response.json() as { model?: JsonRecord };
  return data.model ? normalizeAvailableModel(data.model) : null;
}

export async function updateAvailableModel(id: string, input: AvailableModelUpdate): Promise<AvailableModel | null> {
  const response = await fetch(`/api/orchestration/available-models/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).catch(() => null);
  if (!response?.ok) return null;
  const data = await response.json() as { model?: JsonRecord };
  return data.model ? normalizeAvailableModel(data.model) : null;
}

export async function deleteAvailableModel(id: string): Promise<AvailableModel | null> {
  const response = await fetch(`/api/orchestration/available-models/${encodeURIComponent(id)}`, {
    method: "DELETE",
  }).catch(() => null);
  if (!response?.ok) return null;
  const data = await response.json() as { model?: JsonRecord };
  return data.model ? normalizeAvailableModel(data.model) : null;
}

export async function listAvailableModelRefreshStatuses(): Promise<AvailableModelRefreshStatus[]> {
  const data = await fetchJson<{ statuses?: JsonRecord[] }>("/api/orchestration/available-models/refresh");
  return Array.isArray(data?.statuses) ? data.statuses.map(normalizeAvailableModelRefreshStatus) : [];
}

export async function refreshAvailableModelsFromRuntimes(): Promise<AvailableModelRefreshStatus[]> {
  const response = await fetch("/api/orchestration/available-models/refresh", {
    method: "POST",
  }).catch(() => null);
  if (!response?.ok) return [];
  const data = await response.json() as { statuses?: JsonRecord[] };
  return Array.isArray(data.statuses) ? data.statuses.map(normalizeAvailableModelRefreshStatus) : [];
}

export async function getCompanyExecutionHives(companySlug: string): Promise<CompanyExecutionHivesPayload | null> {
  return await fetchJson<CompanyExecutionHivesPayload>(
    `/api/orchestration/companies/${encodeURIComponent(companySlug)}/hives`,
  );
}

export async function listCompanyExecutionHives(companySlug: string): Promise<ExecutionHive[]> {
  const data = await getCompanyExecutionHives(companySlug);
  return Array.isArray(data?.hives) ? data.hives : [];
}

export async function activateCompanyExecutionHive(
  companySlug: string,
  hiveId: string,
): Promise<CompanyExecutionHivesPayload & { hive: ExecutionHive } | null> {
  const response = await fetch(
    `/api/orchestration/companies/${encodeURIComponent(companySlug)}/hives/${encodeURIComponent(hiveId)}/activate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    },
  ).catch(() => null);

  if (!response?.ok) return null;
  return await response.json() as CompanyExecutionHivesPayload & { hive: ExecutionHive };
}

export async function configureCompanyExecutionHive(
  companySlug: string,
  hiveId: string,
  config: ExecutionHiveMatrixConfig,
): Promise<CompanyExecutionHivesPayload & { hive: ExecutionHive } | null> {
  const response = await fetch(
    `/api/orchestration/companies/${encodeURIComponent(companySlug)}/hives/${encodeURIComponent(hiveId)}/configure`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    },
  ).catch(() => null);

  if (!response?.ok) return null;
  return await response.json() as CompanyExecutionHivesPayload & { hive: ExecutionHive };
}

export async function updateCompanyExecutionHiveLane(
  companySlug: string,
  hiveId: string,
  laneId: HiveRoutingLaneId,
  input: { primary: RouteTarget; fallbacks: RouteTarget[] },
): Promise<CompanyExecutionHivesPayload & { hive: ExecutionHive; lane: RoutingLane } | null> {
  const response = await fetch(
    `/api/orchestration/companies/${encodeURIComponent(companySlug)}/hives/${encodeURIComponent(hiveId)}/lanes/${encodeURIComponent(laneId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  ).catch(() => null);

  if (!response?.ok) return null;
  return await response.json() as CompanyExecutionHivesPayload & { hive: ExecutionHive; lane: RoutingLane };
}

export async function runCompanyExecutionHiveProbe(
  companySlug: string,
  hiveId: string,
  input: { laneId: HiveRoutingLaneId; kind: ExecutionHiveProbeKind },
): Promise<ExecutionHiveProbeRunPayload | null> {
  const response = await fetch(
    `/api/orchestration/companies/${encodeURIComponent(companySlug)}/hives/${encodeURIComponent(hiveId)}/probe`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  ).catch(() => null);

  if (!response?.ok) return null;
  return await response.json() as ExecutionHiveProbeRunPayload;
}

function normalizeTask(raw: JsonRecord): OrchestrationTask {
  const normalizedStatus = normalizeTaskStatus(raw.status);
  const type = String(raw.type ?? "feature") as OrchestrationTask["type"];
  const resolvedColumnOrder = Number(raw.columnOrder ?? raw.column_order);
  const columnOrder = Number.isFinite(resolvedColumnOrder) ? resolvedColumnOrder : undefined;
  const dependencies = normalizeTaskDependencies(raw.dependencies);
  const waitingOn = normalizeTaskDependencies(raw.waitingOn);

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
    displayAgentId: raw.displayAgentId ? String(raw.displayAgentId) : raw.display_agent_id ? String(raw.display_agent_id) : undefined,
    displayAgentName: raw.displayAgentName ? String(raw.displayAgentName) : raw.display_agent_name ? String(raw.display_agent_name) : undefined,
    displayAgentSource:
      raw.displayAgentSource === "assignee" ||
      raw.displayAgentSource === "runner" ||
      raw.displayAgentSource === "review_source"
        ? raw.displayAgentSource
        : raw.display_agent_source === "assignee" ||
          raw.display_agent_source === "runner" ||
          raw.display_agent_source === "review_source"
        ? raw.display_agent_source
        : undefined,
    eligibleAssignees: Array.isArray(raw.eligibleAssignees)
      ? raw.eligibleAssignees.map((item) => String(item)).filter(Boolean)
      : Array.isArray(raw.eligible_assignee_ids)
      ? raw.eligible_assignee_ids.map((item) => String(item)).filter(Boolean)
      : undefined,
    tags: Array.isArray(raw.tags) ? raw.tags.map((tag) => String(tag)) : [],
    sprint: raw.sprint ? String(raw.sprint) : undefined,
    sprintId: raw.sprintId ? String(raw.sprintId) : raw.sprint_id ? String(raw.sprint_id) : undefined,
    sprintKey: raw.sprintKey ? String(raw.sprintKey) : raw.sprint_key ? String(raw.sprint_key) : undefined,
    sprintName: raw.sprintName ? String(raw.sprintName) : raw.sprint_name ? String(raw.sprint_name) : raw.sprint ? String(raw.sprint) : undefined,
    sprintStatus: raw.sprintStatus ? (String(raw.sprintStatus) as import("@/lib/orchestration/types").SprintStatus) : raw.sprint_status ? (String(raw.sprint_status) as import("@/lib/orchestration/types").SprintStatus) : undefined,
    companyGoalId: raw.companyGoalId ? String(raw.companyGoalId) : raw.company_goal_id ? String(raw.company_goal_id) : undefined,
    companyGoalKey: raw.companyGoalKey ? String(raw.companyGoalKey) : raw.company_goal_key ? String(raw.company_goal_key) : undefined,
    companyGoalName: raw.companyGoalName ? String(raw.companyGoalName) : raw.company_goal_name ? String(raw.company_goal_name) : undefined,
    companyGoalStatus: raw.companyGoalStatus ? (String(raw.companyGoalStatus) as import("@/lib/orchestration/types").SprintStatus) : raw.company_goal_status ? (String(raw.company_goal_status) as import("@/lib/orchestration/types").SprintStatus) : undefined,
    blockedReason: raw.blockedReason ? String(raw.blockedReason) : undefined,
    dependencies,
    waitingOn,
    createdBy: raw.createdBy ? String(raw.createdBy) : raw.created_by ? String(raw.created_by) : undefined,
    executionEngine:
      raw.executionEngine === "hiverunner" || raw.executionEngine === "symphony" || raw.executionEngine === "manual"
        ? raw.executionEngine
        : raw.execution_engine === "hiverunner" || raw.execution_engine === "symphony" || raw.execution_engine === "manual"
        ? raw.execution_engine
        : undefined,
    executionEngineOverride:
      raw.executionEngineOverride === "hiverunner" || raw.executionEngineOverride === "symphony" || raw.executionEngineOverride === "manual"
        ? raw.executionEngineOverride
        : raw.execution_engine === "hiverunner" || raw.execution_engine === "symphony" || raw.execution_engine === "manual"
        ? raw.execution_engine
        : raw.executionEngineOverride === null || raw.execution_engine === null
        ? null
        : undefined,
    executionEngineSource:
      raw.executionEngineSource === "task" ||
      raw.executionEngineSource === "project" ||
      raw.executionEngineSource === "company" ||
      raw.executionEngineSource === "global"
        ? raw.executionEngineSource
        : undefined,
    executionRuntimeProvider:
      typeof raw.executionRuntimeProvider === "string"
        ? raw.executionRuntimeProvider
        : typeof raw.execution_runtime_provider === "string"
        ? raw.execution_runtime_provider
        : raw.executionRuntimeProvider === null || raw.execution_runtime_provider === null
        ? null
        : undefined,
    executionRuntimeLabel:
      typeof raw.executionRuntimeLabel === "string"
        ? raw.executionRuntimeLabel
        : typeof raw.execution_runtime_label === "string"
        ? raw.execution_runtime_label
        : raw.executionRuntimeLabel === null || raw.execution_runtime_label === null
        ? null
        : undefined,
    executionModelRouting:
      typeof raw.executionModelRouting === "string"
        ? raw.executionModelRouting
        : typeof raw.execution_model_routing === "string"
        ? raw.execution_model_routing
        : raw.executionModelRouting === null || raw.execution_model_routing === null
        ? null
        : undefined,
    executionModelRoutingLabel:
      typeof raw.executionModelRoutingLabel === "string"
        ? raw.executionModelRoutingLabel
        : typeof raw.execution_model_routing_label === "string"
        ? raw.execution_model_routing_label
        : raw.executionModelRoutingLabel === null || raw.execution_model_routing_label === null
        ? null
        : undefined,
    executionRoutingSource:
      raw.executionRoutingSource === "task" ||
      raw.executionRoutingSource === "project" ||
      raw.executionRoutingSource === "company" ||
      raw.executionRoutingSource === "global"
        ? raw.executionRoutingSource
        : undefined,
    modelLane:
      raw.modelLane === "fast" || raw.modelLane === "mini" || raw.modelLane === "deep" || raw.modelLane === "default"
        ? raw.modelLane
        : raw.model_lane === "fast" || raw.model_lane === "mini" || raw.model_lane === "deep" || raw.model_lane === "default"
        ? raw.model_lane
        : "default",
    modelDisplay: normalizeTaskModelDisplay(raw.modelDisplay ?? raw.model_display),
    executionMode:
      raw.executionMode === "openclaw" || raw.executionMode === "manual"
        ? raw.executionMode
        : raw.execution_mode === "openclaw" || raw.execution_mode === "manual"
        ? raw.execution_mode
        : undefined,
    sourceReviewId: raw.sourceReviewId ? String(raw.sourceReviewId) : raw.source_review_id ? String(raw.source_review_id) : undefined,
    sourceTakeawayId: raw.sourceTakeawayId
      ? String(raw.sourceTakeawayId)
      : raw.source_takeaway_id
      ? String(raw.source_takeaway_id)
      : undefined,
    sourceTemplateVersionId: raw.sourceTemplateVersionId === null || raw.source_template_version_id === null
      ? null
      : raw.sourceTemplateVersionId
      ? String(raw.sourceTemplateVersionId)
      : raw.source_template_version_id
      ? String(raw.source_template_version_id)
      : undefined,
    templateIntakeAnswerId: raw.templateIntakeAnswerId === null || raw.template_intake_answer_id === null
      ? null
      : raw.templateIntakeAnswerId
      ? String(raw.templateIntakeAnswerId)
      : raw.template_intake_answer_id
      ? String(raw.template_intake_answer_id)
      : undefined,
    templateGenerationProvenance: jsonRecord(raw.templateGenerationProvenance ?? raw.template_generation_provenance),
    dueDate: raw.dueDate ? String(raw.dueDate) : raw.due_date ? String(raw.due_date) : undefined,
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

function normalizeEvalStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : [];
}

const EXPERIMENT_REPORT_STATUSES = new Set<OrchestrationExperimentReportEvidence["status"]>([
  "draft",
  "generated",
  "accepted",
  "returned",
  "superseded",
  "archived",
]);

const EXPERIMENT_REPORT_SOURCE_KINDS = new Set<OrchestrationExperimentReportEvidence["sourceKind"]>([
  "run_trace",
  "eval_case",
  "mixed",
]);

function normalizeExperimentReportStatus(value: unknown): OrchestrationExperimentReportEvidence["status"] {
  return typeof value === "string" && EXPERIMENT_REPORT_STATUSES.has(value as OrchestrationExperimentReportEvidence["status"])
    ? value as OrchestrationExperimentReportEvidence["status"]
    : "generated";
}

function normalizeExperimentReportSourceKind(value: unknown): OrchestrationExperimentReportEvidence["sourceKind"] {
  return typeof value === "string" && EXPERIMENT_REPORT_SOURCE_KINDS.has(value as OrchestrationExperimentReportEvidence["sourceKind"])
    ? value as OrchestrationExperimentReportEvidence["sourceKind"]
    : "mixed";
}

function optionalJsonRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function normalizeExperimentReportLink(raw: unknown): OrchestrationExperimentReportEvidence["links"][number] {
  const link = jsonRecord(raw);
  const type = link.type === "run_trace" ||
    link.type === "eval_case" ||
    link.type === "task" ||
    link.type === "goal" ||
    link.type === "sprint" ||
    link.type === "improve"
    ? link.type
    : "run_trace";
  return {
    type,
    id: String(link.id ?? ""),
    label: String(link.label ?? link.id ?? "Evidence"),
    href: String(link.href ?? ""),
  };
}

function normalizeExperimentReportEvidence(raw: unknown): OrchestrationExperimentReportEvidence {
  const report = jsonRecord(raw);
  return {
    id: String(report.id ?? ""),
    experimentId: String(report.experimentId ?? ""),
    companyId: String(report.companyId ?? ""),
    status: normalizeExperimentReportStatus(report.status),
    title: String(report.title ?? "Comparison report"),
    summary: String(report.summary ?? ""),
    objective: String(report.objective ?? ""),
    sourceKind: normalizeExperimentReportSourceKind(report.sourceKind),
    sourceRunId: stringOrNull(report.sourceRunId),
    sourceEvalCaseId: stringOrNull(report.sourceEvalCaseId),
    sourceTaskId: stringOrNull(report.sourceTaskId),
    sourceTaskKey: stringOrNull(report.sourceTaskKey),
    sourceTaskTitle: stringOrNull(report.sourceTaskTitle),
    sprintId: stringOrNull(report.sprintId),
    sprintKey: stringOrNull(report.sprintKey),
    goalKey: stringOrNull(report.goalKey),
    winningVariantId: stringOrNull(report.winningVariantId),
    winningVariantKey: stringOrNull(report.winningVariantKey),
    winningVariantName: stringOrNull(report.winningVariantName),
    recommendationId: stringOrNull(report.recommendationId),
    reportSha256: stringOrNull(report.reportSha256),
    createdAt: String(report.createdAt ?? new Date().toISOString()),
    updatedAt: String(report.updatedAt ?? report.createdAt ?? new Date().toISOString()),
    href: String(report.href ?? ""),
    links: Array.isArray(report.links) ? report.links.map(normalizeExperimentReportLink) : [],
    redactionPolicy: String(report.redactionPolicy ?? "hiverunner.experiment_report_read.redaction.v1"),
    redactionSummary: jsonRecord(report.redactionSummary),
    redactedPayload: optionalJsonRecord(report.redactedPayload),
  };
}

function normalizeEvalCase(raw: JsonRecord): OrchestrationEvalCase {
  const sourceProject = jsonRecord(raw.sourceProject);
  const sourceTask = jsonRecord(raw.sourceTask);
  const sourceRun = jsonRecord(raw.sourceRun);
  const sourceSprint = jsonRecord(raw.sourceSprint);
  const sourceGoal = jsonRecord(raw.sourceGoal);
  const review = jsonRecord(raw.review);
  return {
    id: String(raw.id ?? ""),
    companyId: String(raw.companyId ?? raw.company_id ?? ""),
    projectId: raw.projectId === null || raw.project_id === null
      ? null
      : raw.projectId ? String(raw.projectId) : raw.project_id ? String(raw.project_id) : null,
    sourceProject: {
      id: sourceProject.id === null ? null : sourceProject.id ? String(sourceProject.id) : null,
      slug: sourceProject.slug === null ? null : sourceProject.slug ? String(sourceProject.slug) : null,
      name: sourceProject.name === null ? null : sourceProject.name ? String(sourceProject.name) : null,
      color: sourceProject.color === null ? null : sourceProject.color ? String(sourceProject.color) : null,
    },
    sourceTask: {
      id: sourceTask.id === null ? null : sourceTask.id ? String(sourceTask.id) : null,
      key: String(sourceTask.key ?? ""),
      title: String(sourceTask.title ?? "Untitled task"),
      type: sourceTask.type === null ? null : sourceTask.type ? String(sourceTask.type) : null,
      tags: normalizeEvalStringArray(sourceTask.tags),
    },
    sourceRun: {
      id: String(sourceRun.id ?? ""),
      traceRoute: String(sourceRun.traceRoute ?? sourceRun.trace_route ?? ""),
      executionEngine:
        sourceRun.executionEngine === "hiverunner" ||
        sourceRun.executionEngine === "symphony" ||
        sourceRun.executionEngine === "manual"
          ? sourceRun.executionEngine
          : null,
      runnerProvider: sourceRun.runnerProvider === null ? null : sourceRun.runnerProvider ? String(sourceRun.runnerProvider) : null,
      providerId: sourceRun.providerId === null ? null : sourceRun.providerId ? String(sourceRun.providerId) : null,
      runnerModel: sourceRun.runnerModel === null ? null : sourceRun.runnerModel ? String(sourceRun.runnerModel) : null,
      agentId: sourceRun.agentId === null ? null : sourceRun.agentId ? String(sourceRun.agentId) : null,
      agentName: sourceRun.agentName === null ? null : sourceRun.agentName ? String(sourceRun.agentName) : null,
    },
    sourceSprint: {
      id: sourceSprint.id === null ? null : sourceSprint.id ? String(sourceSprint.id) : null,
      key: sourceSprint.key === null ? null : sourceSprint.key ? String(sourceSprint.key) : null,
    },
    sourceGoal: {
      id: sourceGoal.id === null ? null : sourceGoal.id ? String(sourceGoal.id) : null,
      key: sourceGoal.key === null ? null : sourceGoal.key ? String(sourceGoal.key) : null,
    },
    templateContext: jsonRecord(raw.templateContext),
    sourceTemplateVersionId: raw.sourceTemplateVersionId === null || raw.source_template_version_id === null
      ? null
      : raw.sourceTemplateVersionId
      ? String(raw.sourceTemplateVersionId)
      : raw.source_template_version_id
      ? String(raw.source_template_version_id)
      : undefined,
    templateIntakeAnswerId: raw.templateIntakeAnswerId === null || raw.template_intake_answer_id === null
      ? null
      : raw.templateIntakeAnswerId
      ? String(raw.templateIntakeAnswerId)
      : raw.template_intake_answer_id
      ? String(raw.template_intake_answer_id)
      : undefined,
    review: {
      outcome: String(review.outcome ?? "accepted") as OrchestrationEvalReviewOutcome,
      rationale: String(review.rationale ?? ""),
      notes: review.notes === null ? null : review.notes ? String(review.notes) : null,
      reviewerAgentId: review.reviewerAgentId === null ? null : review.reviewerAgentId ? String(review.reviewerAgentId) : null,
      reviewerName: review.reviewerName === null ? null : review.reviewerName ? String(review.reviewerName) : null,
      reviewedAt: review.reviewedAt === null ? null : review.reviewedAt ? String(review.reviewedAt) : null,
    },
    captureQuality: String(raw.captureQuality ?? "minimal") as OrchestrationEvalCase["captureQuality"],
    evidenceGaps: Array.isArray(raw.evidenceGaps) ? raw.evidenceGaps : [],
    snapshotSha256: String(raw.snapshotSha256 ?? ""),
    version: Number(raw.version ?? 1),
    parentEvalCaseId: raw.parentEvalCaseId === null ? null : raw.parentEvalCaseId ? String(raw.parentEvalCaseId) : null,
    idempotencyKey: raw.idempotencyKey === null ? null : raw.idempotencyKey ? String(raw.idempotencyKey) : null,
    createdByAgentId: raw.createdByAgentId === null ? null : raw.createdByAgentId ? String(raw.createdByAgentId) : null,
    createdByUserId: raw.createdByUserId === null ? null : raw.createdByUserId ? String(raw.createdByUserId) : null,
    createdAt: String(raw.createdAt ?? raw.created_at ?? new Date().toISOString()),
    experimentReports: Array.isArray(raw.experimentReports)
      ? raw.experimentReports.map(normalizeExperimentReportEvidence)
      : [],
  };
}

function normalizeEvalFacet(raw: JsonRecord): OrchestrationEvalLibraryFacet {
  return {
    value: String(raw.value ?? ""),
    label: String(raw.label ?? raw.value ?? ""),
    count: Number(raw.count ?? 0),
  };
}

function normalizeEvalFacets(raw: unknown): OrchestrationEvalLibraryFacets {
  const facets = jsonRecord(raw);
  const list = (key: keyof OrchestrationEvalLibraryFacets) =>
    Array.isArray(facets[key]) ? (facets[key] as unknown[]).map((item) => normalizeEvalFacet(jsonRecord(item))) : [];
  return {
    projects: list("projects"),
    taskTypes: list("taskTypes"),
    templates: list("templates"),
    agents: list("agents"),
    runners: list("runners"),
    models: list("models"),
    reviewOutcomes: list("reviewOutcomes"),
    tags: list("tags"),
  };
}

const IMPROVEMENT_TRIGGER_KEYS = new Set<string>([
  "severe_single_failure",
  "repeated_review_return",
  "missing_capability",
  "missing_tool_runtime",
  "template_drift",
  "runner_mismatch",
  "reviewer_request",
]);

const IMPROVEMENT_RECOMMENDATION_STATUSES = new Set<OrchestrationImprovementRecommendationStatus>([
  "suggested",
  "needs-more-evidence",
  "accepted-for-approval",
  "dismissed",
  "superseded",
  "applied",
]);
const IMPROVEMENT_SEVERITIES = new Set<OrchestrationImprovementSeverity>(["low", "medium", "high", "critical"]);
const IMPROVEMENT_CONFIDENCES = new Set<OrchestrationImprovementConfidence>(["low", "medium", "high"]);

function normalizeEnumValue<T extends string>(value: unknown, allowed: Set<T>, fallback: T): T {
  return typeof value === "string" && allowed.has(value as T) ? value as T : fallback;
}

function stringOrNull(value: unknown): string | null {
  return value === null ? null : value ? String(value) : null;
}

function stringOrUndefined(value: unknown): string | undefined {
  return value ? String(value) : undefined;
}

function stringOrNullOrUndefined(value: unknown): string | null | undefined {
  return value === null ? null : value ? String(value) : undefined;
}

function normalizeImprovementTriggerKey(value: unknown): OrchestrationImprovementTriggerKey {
  const key = String(value ?? "");
  return IMPROVEMENT_TRIGGER_KEYS.has(key) ? key as OrchestrationImprovementTriggerKey : "reviewer_request";
}

function normalizeImprovementScopeType(value: unknown): OrchestrationImprovementScopeType {
  return value === "company" ||
    value === "project" ||
    value === "template" ||
    value === "task_type" ||
    value === "agent" ||
    value === "runner" ||
    value === "recommendation"
    ? value
    : "company";
}

function normalizeImprovementScope(raw: unknown): OrchestrationImprovementScope {
  const scope = jsonRecord(raw);
  return {
    type: normalizeImprovementScopeType(scope.type),
    key: String(scope.key ?? ""),
  };
}

function normalizeImprovementCompanyControl(raw: unknown): OrchestrationImprovementCompanyControl {
  const control = jsonRecord(raw);
  return {
    companyId: String(control.companyId ?? ""),
    automationPaused: Boolean(control.automationPaused),
    pausedReason: control.pausedReason === null ? null : control.pausedReason ? String(control.pausedReason) : null,
    pausedAt: control.pausedAt === null ? null : control.pausedAt ? String(control.pausedAt) : null,
    updatedAt: String(control.updatedAt ?? new Date().toISOString()),
  };
}

function normalizeImprovementSuppressionReason(value: unknown): OrchestrationImprovementSuppressionReason {
  return value === "not_now" ||
    value === "wrong_diagnosis" ||
    value === "too_risky" ||
    value === "already_fixed" ||
    value === "not_worth_it" ||
    value === "duplicate" ||
    value === "operator_suppressed"
    ? value
    : "operator_suppressed";
}

function normalizeImprovementDismissalReason(value: unknown): OrchestrationImprovementDismissalReason | null {
  return value === "not_now" ||
    value === "wrong_diagnosis" ||
    value === "too_risky" ||
    value === "already_fixed" ||
    value === "not_worth_it"
    ? value
    : null;
}

function normalizeImprovementTriggerFiring(raw: unknown): OrchestrationImprovementTriggerFiring {
  const firing = jsonRecord(raw);
  const status = firing.status === "created_recommendation" ||
    firing.status === "suppressed" ||
    firing.status === "skipped" ||
    firing.status === "needs_more_evidence"
    ? firing.status
    : "skipped";
  return {
    id: String(firing.id ?? ""),
    companyId: String(firing.companyId ?? ""),
    triggerKey: normalizeImprovementTriggerKey(firing.triggerKey),
    scope: normalizeImprovementScope(firing.scope),
    status,
    decisionReason: String(firing.decisionReason ?? ""),
    evidence: Array.isArray(firing.evidence) ? firing.evidence : [],
    recommendationId: firing.recommendationId === null ? null : firing.recommendationId ? String(firing.recommendationId) : null,
    recommendationTitle: firing.recommendationTitle === null ? null : firing.recommendationTitle ? String(firing.recommendationTitle) : null,
    suppressionId: firing.suppressionId === null ? null : firing.suppressionId ? String(firing.suppressionId) : null,
    suppressionReason: firing.suppressionReason === null ? null : normalizeImprovementSuppressionReason(firing.suppressionReason),
    firedAt: String(firing.firedAt ?? new Date().toISOString()),
  };
}

function normalizeImprovementTriggerControl(raw: unknown): OrchestrationImprovementTriggerControl {
  const trigger = jsonRecord(raw);
  return {
    companyId: String(trigger.companyId ?? ""),
    triggerKey: normalizeImprovementTriggerKey(trigger.triggerKey),
    label: String(trigger.label ?? trigger.triggerKey ?? "Trigger"),
    description: String(trigger.description ?? ""),
    enabled: trigger.enabled !== false,
    threshold: jsonRecord(trigger.threshold),
    updatedAt: trigger.updatedAt === null ? null : trigger.updatedAt ? String(trigger.updatedAt) : null,
    latestFiring: trigger.latestFiring ? normalizeImprovementTriggerFiring(trigger.latestFiring) : null,
  };
}

function normalizeImprovementSuppression(raw: unknown): OrchestrationImprovementSuppression {
  const suppression = jsonRecord(raw);
  return {
    id: String(suppression.id ?? ""),
    companyId: String(suppression.companyId ?? ""),
    triggerKey: suppression.triggerKey === null ? null : suppression.triggerKey ? normalizeImprovementTriggerKey(suppression.triggerKey) : null,
    scope: normalizeImprovementScope(suppression.scope),
    reason: normalizeImprovementSuppressionReason(suppression.reason),
    notes: suppression.notes === null ? null : suppression.notes ? String(suppression.notes) : null,
    active: suppression.active !== false,
    sourceRecommendationId: suppression.sourceRecommendationId === null ? null : suppression.sourceRecommendationId ? String(suppression.sourceRecommendationId) : null,
    expiresAt: suppression.expiresAt === null ? null : suppression.expiresAt ? String(suppression.expiresAt) : null,
    createdAt: String(suppression.createdAt ?? new Date().toISOString()),
    updatedAt: String(suppression.updatedAt ?? new Date().toISOString()),
  };
}

function normalizeImprovementSourceType(value: unknown): OrchestrationImprovementEvidenceSummary["sourceType"] {
  return value === "trace" ||
    value === "eval" ||
    value === "experiment_report" ||
    value === "template" ||
    value === "team" ||
    value === "task" ||
    value === "sprint" ||
    value === "goal" ||
    value === "review" ||
    value === "manual"
    ? value
    : "manual";
}

function normalizeImprovementSourceLink(raw: unknown): OrchestrationImprovementSourceLink {
  const link = jsonRecord(raw);
  const type = link.type === "trace" ||
    link.type === "eval" ||
    link.type === "experiment_report" ||
    link.type === "template" ||
    link.type === "team" ||
    link.type === "task" ||
    link.type === "sprint" ||
    link.type === "goal" ||
    link.type === "approval"
    ? link.type
    : "task";
  return {
    type,
    id: String(link.id ?? ""),
    label: String(link.label ?? link.id ?? ""),
    href: String(link.href ?? ""),
  };
}

function normalizeImprovementEvidenceSummary(raw: unknown): OrchestrationImprovementEvidenceSummary {
  const evidence = jsonRecord(raw);
  return {
    id: String(evidence.id ?? crypto.randomUUID()),
    sourceType: normalizeImprovementSourceType(evidence.sourceType),
    sourceId: evidence.sourceId === null ? null : evidence.sourceId ? String(evidence.sourceId) : null,
    title: String(evidence.title ?? "Evidence"),
    summary: String(evidence.summary ?? ""),
    occurredAt: evidence.occurredAt === null ? null : evidence.occurredAt ? String(evidence.occurredAt) : null,
    missingReason: evidence.missingReason === null ? null : evidence.missingReason ? String(evidence.missingReason) : null,
    redactionPolicy: String(evidence.redactionPolicy ?? "hiverunner.improve.redacted_evidence.v1"),
    links: Array.isArray(evidence.links) ? evidence.links.map(normalizeImprovementSourceLink) : [],
    metadata: jsonRecord(evidence.metadata),
  };
}

function normalizeImprovementEvidenceSet(raw: unknown) {
  if (Array.isArray(raw)) {
    const summaries = raw.map(normalizeImprovementEvidenceSummary);
    return {
      state: summaries.some((item) => !item.missingReason) ? "present" as const : "missing" as const,
      summaries,
    };
  }

  const evidence = jsonRecord(raw);
  const summaries = Array.isArray(evidence.summaries)
    ? evidence.summaries.map(normalizeImprovementEvidenceSummary)
    : [];
  return {
    state: evidence.state === "present" ? "present" as const : "missing" as const,
    summaries,
  };
}

function normalizeImprovementRecommendation(raw: unknown): OrchestrationImprovementRecommendation {
  const recommendation = jsonRecord(raw);
  const status = normalizeEnumValue(recommendation.status, IMPROVEMENT_RECOMMENDATION_STATUSES, "suggested");
  const severity = normalizeEnumValue(recommendation.severity, IMPROVEMENT_SEVERITIES, "medium");
  const confidence = normalizeEnumValue(recommendation.confidence, IMPROVEMENT_CONFIDENCES, "medium");
  const scope = recommendation.scope ? normalizeImprovementScope(recommendation.scope) : {
    type: normalizeImprovementScopeType(recommendation.scopeType),
    key: String(recommendation.scopeKey ?? ""),
  };
  return {
    id: String(recommendation.id ?? ""),
    companyId: String(recommendation.companyId ?? ""),
    triggerKey: recommendation.triggerKey ? String(recommendation.triggerKey) : normalizeImprovementTriggerKey(recommendation.triggerKey),
    scope,
    scopeType: normalizeImprovementScopeType(recommendation.scopeType ?? scope.type),
    scopeKey: String(recommendation.scopeKey ?? scope.key),
    scopeLabel: stringOrNull(recommendation.scopeLabel),
    category: stringOrNull(recommendation.category),
    title: String(recommendation.title ?? "Untitled recommendation"),
    summary: stringOrUndefined(recommendation.summary),
    rationale: String(recommendation.rationale ?? ""),
    proposedChange: String(recommendation.proposedChange ?? ""),
    severity,
    confidence,
    status,
    evidence: normalizeImprovementEvidenceSet(recommendation.evidence),
    originalRecommendation: jsonRecord(recommendation.originalRecommendation),
    currentRecommendation: jsonRecord(recommendation.currentRecommendation),
    affectedSurfaces: Array.isArray(recommendation.affectedSurfaces)
      ? recommendation.affectedSurfaces.map((item) => jsonRecord(item))
      : undefined,
    preview: recommendation.preview === null ? null : recommendation.preview ? jsonRecord(recommendation.preview) : undefined,
    riskNotes: stringOrNullOrUndefined(recommendation.riskNotes),
    rollbackNotes: stringOrNullOrUndefined(recommendation.rollbackNotes),
    latestApprovalId: stringOrNullOrUndefined(recommendation.latestApprovalId),
    latestApprovalStatus: recommendation.latestApprovalStatus === null
      ? null
      : recommendation.latestApprovalStatus
        ? String(recommendation.latestApprovalStatus) as ApprovalStatus
        : undefined,
    approvalDecisionNote: stringOrNullOrUndefined(recommendation.approvalDecisionNote),
    approvalSyncedAt: stringOrNullOrUndefined(recommendation.approvalSyncedAt),
    dismissalReason: normalizeImprovementDismissalReason(recommendation.dismissalReason),
    dismissalNotes: stringOrNull(recommendation.dismissalNotes),
    dismissedAt: stringOrNull(recommendation.dismissedAt),
    suppressionId: stringOrNull(recommendation.suppressionId),
    suppressionReason: stringOrNullOrUndefined(recommendation.suppressionReason),
    suppressionScope: stringOrNullOrUndefined(recommendation.suppressionScope),
    suppressionExpiresAt: stringOrNullOrUndefined(recommendation.suppressionExpiresAt),
    supersededByRecommendationId: stringOrNull(recommendation.supersededByRecommendationId),
    approvalId: stringOrNull(recommendation.approvalId),
    idempotencyKey: stringOrNull(recommendation.idempotencyKey),
    createdByAgentId: stringOrNull(recommendation.createdByAgentId),
    createdByUserId: stringOrNull(recommendation.createdByUserId),
    acceptedByUserId: stringOrNullOrUndefined(recommendation.acceptedByUserId),
    acceptedAt: stringOrNullOrUndefined(recommendation.acceptedAt),
    links: Array.isArray(recommendation.links) ? recommendation.links.map(normalizeImprovementSourceLink) : undefined,
    tags: Array.isArray(recommendation.tags) ? recommendation.tags.map((tag) => String(tag)) : undefined,
    createdAt: String(recommendation.createdAt ?? new Date().toISOString()),
    updatedAt: String(recommendation.updatedAt ?? new Date().toISOString()),
  };
}

function normalizeImprovementDashboard(raw: unknown): OrchestrationImprovementDashboard {
  const dashboard = jsonRecord(raw);
  return {
    companyControl: normalizeImprovementCompanyControl(dashboard.companyControl),
    triggers: Array.isArray(dashboard.triggers) ? dashboard.triggers.map(normalizeImprovementTriggerControl) : [],
    recommendations: Array.isArray(dashboard.recommendations) ? dashboard.recommendations.map(normalizeImprovementRecommendation) : [],
    firings: Array.isArray(dashboard.firings) ? dashboard.firings.map(normalizeImprovementTriggerFiring) : [],
    suppressions: Array.isArray(dashboard.suppressions) ? dashboard.suppressions.map(normalizeImprovementSuppression) : [],
  };
}

function normalizeTaskDetailSummary(raw: JsonRecord) {
  const dependencies = normalizeTaskDependencies(raw.dependencies);
  const waitingOn = normalizeTaskDependencies(raw.waitingOn);

  return {
    id: String(raw.id ?? ""),
    key: raw.key ? String(raw.key) : undefined,
    title: String(raw.title ?? "Untitled Task"),
    status: normalizeTaskStatus(raw.status),
    priority: (String(raw.priority ?? "P2") as OrchestrationTask["priority"]),
    type: (String(raw.type ?? "feature") as OrchestrationTask["type"]),
    assignee: raw.assignee ? String(raw.assignee) : undefined,
    modelDisplay: normalizeTaskModelDisplay(raw.modelDisplay ?? raw.model_display),
    dependencies,
    waitingOn,
    created: String(raw.created ?? raw.created_at ?? new Date().toISOString()),
    updated: String(raw.updated ?? raw.updated_at ?? new Date().toISOString()),
  };
}

function normalizeResolvedExecution(raw: unknown): import("@/lib/orchestration/types").OrchestrationResolvedExecutionContext | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const row = raw as JsonRecord;
  return {
    executionEngine:
      row.executionEngine === "hiverunner" || row.executionEngine === "symphony" || row.executionEngine === "manual"
        ? row.executionEngine
        : undefined,
    provider: typeof row.provider === "string" ? row.provider : null,
    runnerProvider: typeof row.runnerProvider === "string" ? row.runnerProvider : null,
    runnerModel: typeof row.runnerModel === "string" ? row.runnerModel : null,
    model: typeof row.model === "string" ? row.model : null,
    modelLane:
      row.modelLane === "fast" || row.modelLane === "mini" || row.modelLane === "deep" || row.modelLane === "default"
        ? row.modelLane
        : null,
    laneLabel: typeof row.laneLabel === "string" ? row.laneLabel : null,
    routeFingerprint: typeof row.routeFingerprint === "string" ? row.routeFingerprint : null,
    routeFallbacks: Array.isArray(row.routeFallbacks)
      ? row.routeFallbacks.filter((item): item is string => typeof item === "string")
      : [],
    modelRouting: typeof row.modelRouting === "string" ? row.modelRouting : null,
    modelRoutingLabel: typeof row.modelRoutingLabel === "string" ? row.modelRoutingLabel : null,
    activeHiveId: typeof row.activeHiveId === "string" ? row.activeHiveId : null,
    activeHiveName: typeof row.activeHiveName === "string" ? row.activeHiveName : null,
    workspaceRoot: typeof row.workspaceRoot === "string" ? row.workspaceRoot : null,
    companyWorkspaceRoot: typeof row.companyWorkspaceRoot === "string" ? row.companyWorkspaceRoot : null,
    sourceWorkspaceRoot: typeof row.sourceWorkspaceRoot === "string" ? row.sourceWorkspaceRoot : null,
    sandbox: typeof row.sandbox === "string" ? row.sandbox : null,
    approvalPolicy: typeof row.approvalPolicy === "string" ? row.approvalPolicy : null,
    runtimeSlug: typeof row.runtimeSlug === "string" ? row.runtimeSlug : null,
    runtimeDisplayName: typeof row.runtimeDisplayName === "string" ? row.runtimeDisplayName : null,
    command: typeof row.command === "string" ? row.command : null,
    configSource: typeof row.configSource === "string" ? row.configSource : null,
    phase: row.phase === "planned" || row.phase === "run" ? row.phase : undefined,
  };
}

function normalizeTaskRunSummary(raw: unknown): import("@/lib/orchestration/types").OrchestrationTaskRunSummary {
  const summary = (raw ?? {}) as JsonRecord;
  const metricNumber = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
  const usageTotals = summary.usageTotals && typeof summary.usageTotals === "object" && !Array.isArray(summary.usageTotals)
    ? summary.usageTotals as JsonRecord
    : null;
  type RunSummaryItem = NonNullable<import("@/lib/orchestration/types").OrchestrationTaskRunSummary["latestRun"]>;
  const normalizeRun = (run: unknown): RunSummaryItem | undefined => {
    if (!run || typeof run !== "object" || Array.isArray(run)) return undefined;
    const row = run as JsonRecord;
    return {
      id: String(row.id ?? ""),
      provider: String(row.provider ?? "unknown"),
      executionEngine: typeof row.executionEngine === "string" ? row.executionEngine : null,
      runnerProvider: typeof row.runnerProvider === "string" ? row.runnerProvider : null,
      runnerModel: typeof row.runnerModel === "string" ? row.runnerModel : null,
      fallbackUsed: row.fallbackUsed === true,
      fallbackIndex: typeof row.fallbackIndex === "number" ? row.fallbackIndex : null,
      fallbackFromProvider: typeof row.fallbackFromProvider === "string" ? row.fallbackFromProvider : null,
      routeAttempts: Array.isArray(row.routeAttempts) ? row.routeAttempts : [],
      status: String(row.status ?? "unknown"),
      startedAt: typeof row.startedAt === "string" ? row.startedAt : undefined,
      finishedAt: typeof row.finishedAt === "string" ? row.finishedAt : null,
      error: typeof row.error === "string" ? row.error : null,
      workspaceChangedDuringRunCount: typeof row.workspaceChangedDuringRunCount === "number" ? row.workspaceChangedDuringRunCount : undefined,
      workspaceWarningCount: typeof row.workspaceWarningCount === "number" ? row.workspaceWarningCount : undefined,
      resolvedExecution: normalizeResolvedExecution(row.resolvedExecution),
    };
  };
  return {
    totalRuns: Number(summary.totalRuns ?? 0),
    structuredActionCount: Number(summary.structuredActionCount ?? 0),
    importedReportCount: Number(summary.importedReportCount ?? 0),
    usageTotals: usageTotals
      ? {
          inputTokens: metricNumber(usageTotals.inputTokens),
          outputTokens: metricNumber(usageTotals.outputTokens),
          cacheReadInputTokens: metricNumber(usageTotals.cacheReadInputTokens),
          cacheCreationInputTokens: metricNumber(usageTotals.cacheCreationInputTokens),
          totalCostUsd: metricNumber(usageTotals.totalCostUsd),
        }
      : undefined,
    latestRun: normalizeRun(summary.latestRun),
    activeRun: normalizeRun(summary.activeRun),
  };
}

function normalizeTaskDetail(raw: JsonRecord) {
  return {
    task: normalizeTaskDetailSummary((raw.task ?? {}) as JsonRecord),
    parentTask: raw.parentTask ? normalizeTaskDetailSummary(raw.parentTask as JsonRecord) : undefined,
    childTasks: Array.isArray(raw.childTasks)
      ? raw.childTasks.map((item) => normalizeTaskDetailSummary(item as JsonRecord))
      : [],
    timeline: Array.isArray(raw.timeline)
      ? raw.timeline.map((item) => {
          const row = item as JsonRecord;
          return {
            id: String(row.id ?? crypto.randomUUID()),
            taskId: String(row.taskId ?? row.task_id ?? ""),
            timestamp: String(row.timestamp ?? new Date().toISOString()),
            kind: String(row.kind ?? "comment") as import("@/lib/orchestration/types").OrchestrationTaskTimelineItem["kind"],
            source: String(row.source ?? "unknown"),
            actorLabel: row.actorLabel ? String(row.actorLabel) : undefined,
            summary: String(row.summary ?? ""),
            body: row.body ? String(row.body) : undefined,
            metadata: (row.metadata && typeof row.metadata === "object" ? row.metadata : {}) as Record<string, unknown>,
            linkedRunId: row.linkedRunId ? String(row.linkedRunId) : undefined,
            linkedApprovalId: row.linkedApprovalId ? String(row.linkedApprovalId) : undefined,
            linkedTaskId: row.linkedTaskId ? String(row.linkedTaskId) : undefined,
            provenance: String(row.provenance ?? "comment") as import("@/lib/orchestration/types").OrchestrationTaskTimelineItem["provenance"],
          };
        })
      : [],
    runSummary: normalizeTaskRunSummary(raw.runSummary),
    plannedExecution: normalizeResolvedExecution(raw.plannedExecution),
    sprintId: raw.sprintId ? String(raw.sprintId) : raw.sprint_id ? String(raw.sprint_id) : undefined,
    sprintName: raw.sprintName ? String(raw.sprintName) : raw.sprint_name ? String(raw.sprint_name) : undefined,
    sprintStatus: raw.sprintStatus ? (String(raw.sprintStatus) as import("@/lib/orchestration/types").SprintStatus) : raw.sprint_status ? (String(raw.sprint_status) as import("@/lib/orchestration/types").SprintStatus) : undefined,
    companyGoalId: raw.companyGoalId ? String(raw.companyGoalId) : raw.company_goal_id ? String(raw.company_goal_id) : undefined,
    companyGoalName: raw.companyGoalName ? String(raw.companyGoalName) : raw.company_goal_name ? String(raw.company_goal_name) : undefined,
    companyGoalStatus: raw.companyGoalStatus ? (String(raw.companyGoalStatus) as import("@/lib/orchestration/types").SprintStatus) : raw.company_goal_status ? (String(raw.company_goal_status) as import("@/lib/orchestration/types").SprintStatus) : undefined,
  };
}

function normalizeGoalContractEvidence(raw: JsonRecord, itemId: string, sprintId: string): OrchestrationGoalContractEvidence {
  const commandExitCode = raw.commandExitCode ?? raw.command_exit_code;
  return {
    id: String(raw.id ?? ""),
    itemId: String(raw.itemId ?? raw.item_id ?? itemId),
    sprintId: String(raw.sprintId ?? raw.sprint_id ?? sprintId),
    itemKind: String(raw.itemKind ?? raw.item_kind ?? "validation_check") as OrchestrationGoalContractEvidence["itemKind"],
    status: String(raw.status ?? "proposed") as OrchestrationGoalContractEvidence["status"],
    source: String(raw.source ?? "agent") as OrchestrationGoalContractEvidence["source"],
    resultText: String(raw.resultText ?? raw.result_text ?? ""),
    commandExitCode: commandExitCode === undefined || commandExitCode === null ? null : Number(commandExitCode),
    artifactUri: raw.artifactUri || raw.artifact_uri ? String(raw.artifactUri ?? raw.artifact_uri) : null,
    recordedByAgentId: raw.recordedByAgentId || raw.recorded_by_agent_id ? String(raw.recordedByAgentId ?? raw.recorded_by_agent_id) : null,
    recordedByUserId: raw.recordedByUserId || raw.recorded_by_user_id ? String(raw.recordedByUserId ?? raw.recorded_by_user_id) : null,
    createdAt: String(raw.createdAt ?? raw.created_at ?? new Date().toISOString()),
  };
}

function normalizeGoalContractItem(raw: JsonRecord, sprintId: string): OrchestrationGoalContractItem {
  const id = String(raw.id ?? "");
  const itemSprintId = String(raw.sprintId ?? raw.sprint_id ?? sprintId);
  const latestRaw = raw.latestEvidence && typeof raw.latestEvidence === "object"
    ? raw.latestEvidence as JsonRecord
    : raw.latest_evidence && typeof raw.latest_evidence === "object"
      ? raw.latest_evidence as JsonRecord
      : null;
  return {
    id,
    sprintId: itemSprintId,
    kind: String(raw.kind ?? "validation_check") as OrchestrationGoalContractItem["kind"],
    text: String(raw.text ?? ""),
    position: Number(raw.position ?? 0),
    createdAt: String(raw.createdAt ?? raw.created_at ?? new Date().toISOString()),
    updatedAt: String(raw.updatedAt ?? raw.updated_at ?? new Date().toISOString()),
    latestEvidence: latestRaw ? normalizeGoalContractEvidence(latestRaw, id, itemSprintId) : null,
  };
}

function normalizeSprintPlanDraft(raw: JsonRecord): OrchestrationSprintPlanDraft {
  const sprintRaw = raw.sprint && typeof raw.sprint === "object" ? raw.sprint as JsonRecord : {};
  const tasksRaw = Array.isArray(raw.tasks) ? raw.tasks : [];
  return {
    id: String(raw.id ?? ""),
    companyGoalId: String(raw.companyGoalId ?? raw.company_goal_id ?? ""),
    planningTaskId: raw.planningTaskId || raw.planning_task_id ? String(raw.planningTaskId ?? raw.planning_task_id) : null,
    proposedByAgentId: raw.proposedByAgentId || raw.proposed_by_agent_id ? String(raw.proposedByAgentId ?? raw.proposed_by_agent_id) : null,
    sequenceNumber: Number(raw.sequenceNumber ?? raw.sequence_number ?? 1),
    proposalGroupId: raw.proposalGroupId || raw.proposal_group_id ? String(raw.proposalGroupId ?? raw.proposal_group_id) : null,
    status: String(raw.status ?? "pending") as OrchestrationSprintPlanDraft["status"],
    sprint: {
      name: String(sprintRaw.name ?? ""),
      objective: String(sprintRaw.objective ?? ""),
      completionProposal: Boolean(sprintRaw.completionProposal),
      completionReason: sprintRaw.completionReason ? String(sprintRaw.completionReason) : undefined,
      owner: sprintRaw.owner === undefined ? null : sprintRaw.owner === null ? null : String(sprintRaw.owner),
      startDate: sprintRaw.startDate ? String(sprintRaw.startDate) : undefined,
      endDate: sprintRaw.endDate === undefined ? null : sprintRaw.endDate === null ? null : String(sprintRaw.endDate),
      defaultExecutionEngine: sprintRaw.defaultExecutionEngine ? String(sprintRaw.defaultExecutionEngine) as OrchestrationSprintPlanDraftSprint["defaultExecutionEngine"] : null,
      defaultModelLane: sprintRaw.defaultModelLane ? String(sprintRaw.defaultModelLane) as OrchestrationSprintPlanDraftSprint["defaultModelLane"] : null,
      successCriteria: Array.isArray(sprintRaw.successCriteria) ? sprintRaw.successCriteria.map(String) : [],
      validationChecks: Array.isArray(sprintRaw.validationChecks) ? sprintRaw.validationChecks.map(String) : [],
      outOfScope: Array.isArray(sprintRaw.outOfScope) ? sprintRaw.outOfScope.map(String) : [],
      sourceTemplateVersionId: sprintRaw.sourceTemplateVersionId === null
        ? null
        : sprintRaw.sourceTemplateVersionId
        ? String(sprintRaw.sourceTemplateVersionId)
        : undefined,
      templateIntakeAnswerId: sprintRaw.templateIntakeAnswerId === null
        ? null
        : sprintRaw.templateIntakeAnswerId
        ? String(sprintRaw.templateIntakeAnswerId)
        : undefined,
      templateGenerationProvenance: jsonRecord(sprintRaw.templateGenerationProvenance),
    },
    tasks: tasksRaw.map((task, index) => {
      const taskRaw = task && typeof task === "object" ? task as JsonRecord : {};
      return {
        id: String(taskRaw.id ?? `task-${index + 1}`),
        title: String(taskRaw.title ?? ""),
        description: taskRaw.description ? String(taskRaw.description) : "",
        assignee: taskRaw.assignee === undefined ? null : taskRaw.assignee === null ? null : String(taskRaw.assignee),
        priority: taskRaw.priority ? String(taskRaw.priority) as OrchestrationSprintPlanDraftTask["priority"] : "P2",
        type: taskRaw.type ? String(taskRaw.type) as OrchestrationSprintPlanDraftTask["type"] : "feature",
        executionEngine: taskRaw.executionEngine ? String(taskRaw.executionEngine) as OrchestrationSprintPlanDraftTask["executionEngine"] : null,
        modelLane: taskRaw.modelLane ? String(taskRaw.modelLane) as OrchestrationSprintPlanDraftTask["modelLane"] : null,
        dependsOn: Array.isArray(taskRaw.dependsOn) ? taskRaw.dependsOn.map(String) : [],
        validation: taskRaw.validation ? String(taskRaw.validation) : "",
        sourceTemplateVersionId: taskRaw.sourceTemplateVersionId === null
          ? null
          : taskRaw.sourceTemplateVersionId
          ? String(taskRaw.sourceTemplateVersionId)
          : undefined,
        templateIntakeAnswerId: taskRaw.templateIntakeAnswerId === null
          ? null
          : taskRaw.templateIntakeAnswerId
          ? String(taskRaw.templateIntakeAnswerId)
          : undefined,
        templateGenerationProvenance: jsonRecord(taskRaw.templateGenerationProvenance),
      };
    }),
    sourceTemplateVersionId: raw.sourceTemplateVersionId === null || raw.source_template_version_id === null
      ? null
      : raw.sourceTemplateVersionId
      ? String(raw.sourceTemplateVersionId)
      : raw.source_template_version_id
      ? String(raw.source_template_version_id)
      : undefined,
    intakeAnswerId: raw.intakeAnswerId === null || raw.intake_answer_id === null
      ? null
      : raw.intakeAnswerId
      ? String(raw.intakeAnswerId)
      : raw.intake_answer_id
      ? String(raw.intake_answer_id)
      : undefined,
    generationProvenance: jsonRecord(raw.generationProvenance ?? raw.generation_provenance),
    rejectReason: raw.rejectReason || raw.reject_reason ? String(raw.rejectReason ?? raw.reject_reason) : null,
    createdAt: String(raw.createdAt ?? raw.created_at ?? new Date().toISOString()),
    updatedAt: String(raw.updatedAt ?? raw.updated_at ?? new Date().toISOString()),
    approvedAt: raw.approvedAt || raw.approved_at ? String(raw.approvedAt ?? raw.approved_at) : null,
    rejectedAt: raw.rejectedAt || raw.rejected_at ? String(raw.rejectedAt ?? raw.rejected_at) : null,
  };
}

function normalizeSprint(raw: JsonRecord): OrchestrationSprint {
  const contractItems = Array.isArray(raw.contractItems)
    ? raw.contractItems.map((item) => normalizeGoalContractItem(item as JsonRecord, String(raw.id ?? "")))
    : Array.isArray(raw.contract_items)
      ? raw.contract_items.map((item) => normalizeGoalContractItem(item as JsonRecord, String(raw.id ?? "")))
      : [];
  const validationSummaryRaw = raw.validationSummary && typeof raw.validationSummary === "object"
    ? raw.validationSummary as JsonRecord
    : raw.validation_summary && typeof raw.validation_summary === "object"
      ? raw.validation_summary as JsonRecord
      : null;
  return {
    id: String(raw.id ?? ""),
    sprintKey: raw.sprintKey ? String(raw.sprintKey) : raw.sprint_key ? String(raw.sprint_key) : null,
    goalKey: raw.goalKey ? String(raw.goalKey) : raw.goal_key ? String(raw.goal_key) : null,
    projectId: String(raw.projectId ?? raw.project_id ?? ""),
    name: String(raw.name ?? "Untitled Sprint"),
    goal: String(raw.goal ?? ""),
    goalKind:
      raw.goalKind === "company" || raw.goalKind === "sprint"
        ? raw.goalKind
        : raw.goal_kind === "company" || raw.goal_kind === "sprint"
          ? raw.goal_kind
          : undefined,
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
    leadAgentId: raw.leadAgentId || raw.lead_agent_id ? String(raw.leadAgentId ?? raw.lead_agent_id) : null,
    stopCondition: String(raw.stopCondition ?? raw.stop_condition ?? ""),
    progressSummary: String(raw.progressSummary ?? raw.progress_summary ?? ""),
    defaultExecutionEngine: raw.defaultExecutionEngine || raw.default_execution_engine ? String(raw.defaultExecutionEngine ?? raw.default_execution_engine) as OrchestrationSprint["defaultExecutionEngine"] : null,
    defaultModelLane: raw.defaultModelLane || raw.default_model_lane ? String(raw.defaultModelLane ?? raw.default_model_lane) as OrchestrationSprint["defaultModelLane"] : null,
    sourceTemplateVersionId: raw.sourceTemplateVersionId === null || raw.source_template_version_id === null
      ? null
      : raw.sourceTemplateVersionId
      ? String(raw.sourceTemplateVersionId)
      : raw.source_template_version_id
      ? String(raw.source_template_version_id)
      : undefined,
    templateIntakeAnswerId: raw.templateIntakeAnswerId === null || raw.template_intake_answer_id === null
      ? null
      : raw.templateIntakeAnswerId
      ? String(raw.templateIntakeAnswerId)
      : raw.template_intake_answer_id
      ? String(raw.template_intake_answer_id)
      : undefined,
    templateGenerationProvenance: jsonRecord(raw.templateGenerationProvenance ?? raw.template_generation_provenance),
    contractItems,
    validationSummary: validationSummaryRaw
      ? {
          successCriteria: {
            total: Number((validationSummaryRaw.successCriteria as JsonRecord | undefined)?.total ?? 0),
            passed: Number((validationSummaryRaw.successCriteria as JsonRecord | undefined)?.passed ?? 0),
          },
          validationChecks: {
            total: Number((validationSummaryRaw.validationChecks as JsonRecord | undefined)?.total ?? 0),
            passed: Number((validationSummaryRaw.validationChecks as JsonRecord | undefined)?.passed ?? 0),
          },
          blockingReason: validationSummaryRaw.blockingReason ? String(validationSummaryRaw.blockingReason) : undefined,
        }
      : undefined,
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
    projectColor: String(raw.projectColor ?? raw.project_color ?? "#22d3ee"),
    taskId: raw.taskId ? String(raw.taskId) : raw.task_id ? String(raw.task_id) : undefined,
    taskTitle: raw.taskTitle ? String(raw.taskTitle) : raw.task_title ? String(raw.task_title) : undefined,
    taskKey: raw.taskKey ? String(raw.taskKey) : raw.task_key ? String(raw.task_key) : undefined,
    sprintId: raw.sprintId ? String(raw.sprintId) : raw.sprint_id ? String(raw.sprint_id) : undefined,
    sprintName: raw.sprintName ? String(raw.sprintName) : raw.sprint_name ? String(raw.sprint_name) : undefined,
    sprintStatus: raw.sprintStatus ? (String(raw.sprintStatus) as import("@/lib/orchestration/types").SprintStatus) : raw.sprint_status ? (String(raw.sprint_status) as import("@/lib/orchestration/types").SprintStatus) : undefined,
    companyGoalId: raw.companyGoalId ? String(raw.companyGoalId) : raw.company_goal_id ? String(raw.company_goal_id) : undefined,
    companyGoalName: raw.companyGoalName ? String(raw.companyGoalName) : raw.company_goal_name ? String(raw.company_goal_name) : undefined,
    companyGoalStatus: raw.companyGoalStatus ? (String(raw.companyGoalStatus) as import("@/lib/orchestration/types").SprintStatus) : raw.company_goal_status ? (String(raw.company_goal_status) as import("@/lib/orchestration/types").SprintStatus) : undefined,
    status: raw.status ? (String(raw.status) as TaskStatus) : undefined,
    agentId: raw.agentId ? String(raw.agentId) : raw.agent_id ? String(raw.agent_id) : undefined,
    agentName: raw.agentName ? String(raw.agentName) : raw.agent_name ? String(raw.agent_name) : undefined,
    avatarUrl: raw.avatarUrl ? String(raw.avatarUrl) : raw.avatar_url ? String(raw.avatar_url) : undefined,
    provider:
      raw.provider === "openclaw"
        ? raw.provider
        : undefined,
    message: String(raw.message ?? ""),
    activitySummary: raw.activitySummary ? String(raw.activitySummary) : undefined,
    timestamp: String(raw.timestamp ?? raw.created_at ?? new Date().toISOString()),
    isRead: typeof raw.isRead === "boolean" ? raw.isRead : undefined,
    approvalId: raw.approvalId ? String(raw.approvalId) : undefined,
    approvalType: raw.approvalType ? String(raw.approvalType) as OrchestrationCompanyInboxEvent["approvalType"] : undefined,
    approvalStatus: raw.approvalStatus ? String(raw.approvalStatus) as OrchestrationCompanyInboxEvent["approvalStatus"] : undefined,
    approvalLabel: raw.approvalLabel ? String(raw.approvalLabel) : undefined,
    requestedByName: raw.requestedByName ? String(raw.requestedByName) : undefined,
    draftId: raw.draftId ? String(raw.draftId) : raw.draft_id ? String(raw.draft_id) : undefined,
    draftSprintName: raw.draftSprintName ? String(raw.draftSprintName) : raw.draft_sprint_name ? String(raw.draft_sprint_name) : undefined,
    draftTaskCount: raw.draftTaskCount !== undefined ? Number(raw.draftTaskCount) : raw.draft_task_count !== undefined ? Number(raw.draft_task_count) : undefined,
    draftSprintCount: raw.draftSprintCount !== undefined ? Number(raw.draftSprintCount) : raw.draft_sprint_count !== undefined ? Number(raw.draft_sprint_count) : undefined,
    draftNextSequenceNumber: raw.draftNextSequenceNumber !== undefined ? Number(raw.draftNextSequenceNumber) : raw.draft_next_sequence_number !== undefined ? Number(raw.draft_next_sequence_number) : undefined,
    draftProposalGroupId: raw.draftProposalGroupId ? String(raw.draftProposalGroupId) : raw.draft_proposal_group_id ? String(raw.draft_proposal_group_id) : undefined,
    draftMaterialized: typeof raw.draftMaterialized === "boolean" ? raw.draftMaterialized : raw.draft_materialized === true || raw.draft_materialized === 1,
    errorMessage: raw.errorMessage ? String(raw.errorMessage) : undefined,
    failureReason: raw.failureReason ? String(raw.failureReason) : undefined,
  };
  return event;
}

function normalizeCompanyGoal(raw: JsonRecord): OrchestrationCompanyGoal {
  const runIntelligence = jsonRecord(raw.runIntelligence);
  return {
    sprint: normalizeSprint((raw.sprint ?? {}) as JsonRecord),
    projectId: String(raw.projectId ?? raw.project_id ?? ""),
    projectSlug: String(raw.projectSlug ?? raw.project_slug ?? ""),
    projectName: String(raw.projectName ?? raw.project_name ?? "Unknown Project"),
    projectColor: String(raw.projectColor ?? raw.project_color ?? "#22d3ee"),
    completionPercent: Number(raw.completionPercent ?? 0),
    remainingTasks: Number(raw.remainingTasks ?? 0),
    planHasTasks: raw.planHasTasks !== undefined ? Boolean(raw.planHasTasks) : raw.plan_has_tasks !== undefined ? Boolean(raw.plan_has_tasks) : undefined,
    planTaskCount: raw.planTaskCount !== undefined ? Number(raw.planTaskCount) : raw.plan_task_count !== undefined ? Number(raw.plan_task_count) : undefined,
    planDoneTaskCount: raw.planDoneTaskCount !== undefined ? Number(raw.planDoneTaskCount) : raw.plan_done_task_count !== undefined ? Number(raw.plan_done_task_count) : undefined,
    planPendingTaskCount: raw.planPendingTaskCount !== undefined ? Number(raw.planPendingTaskCount) : raw.plan_pending_task_count !== undefined ? Number(raw.plan_pending_task_count) : undefined,
    planSprintCount: raw.planSprintCount !== undefined ? Number(raw.planSprintCount) : raw.plan_sprint_count !== undefined ? Number(raw.plan_sprint_count) : undefined,
    planApprovedSprintCount: raw.planApprovedSprintCount !== undefined ? Number(raw.planApprovedSprintCount) : raw.plan_approved_sprint_count !== undefined ? Number(raw.plan_approved_sprint_count) : undefined,
    planDoneSprintCount: raw.planDoneSprintCount !== undefined ? Number(raw.planDoneSprintCount) : raw.plan_done_sprint_count !== undefined ? Number(raw.plan_done_sprint_count) : undefined,
    planPendingSprintCount: raw.planPendingSprintCount !== undefined ? Number(raw.planPendingSprintCount) : raw.plan_pending_sprint_count !== undefined ? Number(raw.plan_pending_sprint_count) : undefined,
    runIntelligence: raw.runIntelligence
      ? {
          evalCaseCount: Number(runIntelligence.evalCaseCount ?? 0),
          experimentReportCount: Number(runIntelligence.experimentReportCount ?? 0),
          acceptedExperimentReportCount: Number(runIntelligence.acceptedExperimentReportCount ?? 0),
          acceptedImproveHandoffCount: Number(runIntelligence.acceptedImproveHandoffCount ?? 0),
        }
      : undefined,
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
  const data = await fetchJsonDedupe<{ projects: JsonRecord[] }>(url);
  return normalizeProjectList(data?.projects ?? []);
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
  includeArchived?: boolean;
  /** Comma-separated event kinds to include: "task", "execution", "approval". Omit for all. */
  kinds?: string;
}): Promise<{
  events: OrchestrationCompanyInboxEvent[];
  page: { limit: number; nextCursor?: string; hasMore: boolean };
  unreadCount: number;
  unreadSince?: string;
  tasks: OrchestrationCompanyInboxTask[];
  totals: Record<"backlog" | "to-do" | "in-progress" | "review" | "done" | "blocked", number>;
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
  if (typeof input.includeArchived === "boolean") {
    params.set("includeArchived", input.includeArchived ? "true" : "false");
  }
  if (input.kinds) params.set("kinds", input.kinds);

  const query = params.toString();
  const data = await fetchJsonDedupe<{
    events?: JsonRecord[];
    page?: { limit?: number; nextCursor?: string; hasMore?: boolean };
    unreadCount?: number;
    unreadSince?: string;
    tasks?: JsonRecord[];
    totals?: Record<"backlog" | "to-do" | "in-progress" | "review" | "done" | "blocked", number>;
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
      "to-do": 0,
      "in-progress": 0,
      review: 0,
      done: 0,
      blocked: 0,
    },
  };
}

export async function getCompanyInboxUnreadCount(input: {
  companySlug: string;
  projectId?: string;
  status?: TaskStatus;
  search?: string;
  includeDone?: boolean;
  unreadSince?: string;
  includeArchived?: boolean;
  kinds?: string;
}): Promise<number | null> {
  const params = new URLSearchParams();
  params.set("summary", "true");
  params.set("limit", "1");
  if (input.projectId) params.set("projectId", input.projectId);
  if (input.status) params.set("status", input.status);
  if (input.search?.trim()) params.set("search", input.search.trim());
  if (typeof input.includeDone === "boolean") params.set("includeDone", input.includeDone ? "true" : "false");
  if (input.unreadSince) params.set("unreadSince", input.unreadSince);
  if (typeof input.includeArchived === "boolean") {
    params.set("includeArchived", input.includeArchived ? "true" : "false");
  }
  if (input.kinds) params.set("kinds", input.kinds);

  const data = await fetchJson<{ unreadCount?: number }>(
    `/api/orchestration/companies/${encodeURIComponent(input.companySlug)}/inbox?${params.toString()}`
  );
  return data ? Number(data.unreadCount ?? 0) : null;
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

export async function markInboxThreadRead(
  companySlug: string,
  threadKey: string,
  threadKind: "task" | "approval"
): Promise<boolean> {
  try {
    const response = await fetch(`/api/orchestration/companies/${encodeURIComponent(companySlug)}/inbox/read`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadKey, threadKind }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function archiveInboxEvents(companySlug: string, eventIds: string[]): Promise<boolean> {
  try {
    const response = await fetch(`/api/orchestration/companies/${encodeURIComponent(companySlug)}/inbox/archive`, {
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
  projectId?: string;
  name: string;
  goal?: string;
  goalKind?: OrchestrationSprint["goalKind"];
  status?: OrchestrationSprint["status"];
  startDate?: string;
  endDate?: string | null;
  parentId?: string;
  owner?: string | null;
  leadAgentId?: string | null;
  stopCondition?: string;
  progressSummary?: string;
  defaultExecutionEngine?: OrchestrationSprint["defaultExecutionEngine"];
  defaultModelLane?: OrchestrationSprint["defaultModelLane"];
}): Promise<OrchestrationCompanyGoal | null> {
  const response = await fetch(`/api/orchestration/companies/${encodeURIComponent(input.companySlug)}/goals`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...(input.projectId ? { projectId: input.projectId } : {}),
      name: input.name,
      goal: input.goal ?? "",
      ...(input.goalKind ? { goalKind: input.goalKind } : {}),
      status: input.status ?? "planned",
      ...(input.startDate ? { startDate: input.startDate } : {}),
      ...(input.endDate !== undefined ? { endDate: input.endDate } : {}),
      ...(input.parentId ? { parentId: input.parentId } : {}),
      ...(input.owner !== undefined ? { owner: input.owner } : {}),
      ...(input.leadAgentId !== undefined ? { leadAgentId: input.leadAgentId } : {}),
      ...(input.stopCondition !== undefined ? { stopCondition: input.stopCondition } : {}),
      ...(input.progressSummary !== undefined ? { progressSummary: input.progressSummary } : {}),
      ...(input.defaultExecutionEngine !== undefined ? { defaultExecutionEngine: input.defaultExecutionEngine } : {}),
      ...(input.defaultModelLane !== undefined ? { defaultModelLane: input.defaultModelLane } : {}),
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
  goalKind?: OrchestrationSprint["goalKind"] | null;
  status?: OrchestrationSprint["status"];
  startDate?: string;
  endDate?: string | null;
  parentId?: string | null;
  owner?: string | null;
  leadAgentId?: string | null;
  stopCondition?: string;
  progressSummary?: string;
  defaultExecutionEngine?: OrchestrationSprint["defaultExecutionEngine"];
  defaultModelLane?: OrchestrationSprint["defaultModelLane"];
}): Promise<OrchestrationCompanyGoal | null> {
  const response = await fetch(`/api/orchestration/companies/${encodeURIComponent(input.companySlug)}/goals`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sprintId: input.sprintId,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.goal !== undefined ? { goal: input.goal } : {}),
      ...(input.goalKind !== undefined ? { goalKind: input.goalKind } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.startDate !== undefined ? { startDate: input.startDate } : {}),
      ...(input.endDate !== undefined ? { endDate: input.endDate } : {}),
      ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
      ...(input.owner !== undefined ? { owner: input.owner } : {}),
      ...(input.leadAgentId !== undefined ? { leadAgentId: input.leadAgentId } : {}),
      ...(input.stopCondition !== undefined ? { stopCondition: input.stopCondition } : {}),
      ...(input.progressSummary !== undefined ? { progressSummary: input.progressSummary } : {}),
      ...(input.defaultExecutionEngine !== undefined ? { defaultExecutionEngine: input.defaultExecutionEngine } : {}),
      ...(input.defaultModelLane !== undefined ? { defaultModelLane: input.defaultModelLane } : {}),
    }),
  }).catch(() => null);

  if (!response?.ok) return null;
  const data = (await response.json()) as { goal?: JsonRecord };
  if (!data.goal) return null;
  return normalizeCompanyGoal(data.goal);
}

export async function createGoalContractItem(input: {
  companySlug: string;
  sprintId: string;
  kind: OrchestrationGoalContractItem["kind"];
  text: string;
  position?: number;
  actorUserId?: string;
  actorAgentId?: string;
}): Promise<{ item: OrchestrationGoalContractItem; goal: OrchestrationCompanyGoal } | null> {
  const response = await fetch(`/api/orchestration/companies/${encodeURIComponent(input.companySlug)}/goals/contract`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sprintId: input.sprintId,
      kind: input.kind,
      text: input.text,
      ...(input.position !== undefined ? { position: input.position } : {}),
      ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
      ...(input.actorAgentId ? { actorAgentId: input.actorAgentId } : {}),
    }),
  }).catch(() => null);

  if (!response?.ok) return null;
  const data = await response.json() as { item?: JsonRecord; goal?: JsonRecord };
  if (!data.item || !data.goal) return null;
  return {
    item: normalizeGoalContractItem(data.item, input.sprintId),
    goal: normalizeCompanyGoal(data.goal),
  };
}

export async function updateGoalContractItem(input: {
  companySlug: string;
  itemId: string;
  sprintId?: string;
  text?: string;
  position?: number;
  archived?: boolean;
  actorUserId?: string;
  actorAgentId?: string;
}): Promise<{ item: OrchestrationGoalContractItem; goal: OrchestrationCompanyGoal } | null> {
  const response = await fetch(`/api/orchestration/companies/${encodeURIComponent(input.companySlug)}/goals/contract`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      itemId: input.itemId,
      ...(input.text !== undefined ? { text: input.text } : {}),
      ...(input.position !== undefined ? { position: input.position } : {}),
      ...(input.archived !== undefined ? { archived: input.archived } : {}),
      ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
      ...(input.actorAgentId ? { actorAgentId: input.actorAgentId } : {}),
    }),
  }).catch(() => null);

  if (!response?.ok) return null;
  const data = await response.json() as { item?: JsonRecord; goal?: JsonRecord };
  if (!data.item || !data.goal) return null;
  return {
    item: normalizeGoalContractItem(data.item, input.sprintId ?? ""),
    goal: normalizeCompanyGoal(data.goal),
  };
}

export async function recordGoalContractEvidence(input: {
  companySlug: string;
  itemId: string;
  sprintId?: string;
  status: OrchestrationGoalContractEvidence["status"];
  resultText?: string;
  commandExitCode?: number | null;
  artifactUri?: string | null;
  actorUserId?: string;
  actorAgentId?: string;
}): Promise<{ evidence: OrchestrationGoalContractEvidence; goal: OrchestrationCompanyGoal } | null> {
  const response = await fetch(`/api/orchestration/companies/${encodeURIComponent(input.companySlug)}/goals/evidence`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      itemId: input.itemId,
      status: input.status,
      ...(input.resultText !== undefined ? { resultText: input.resultText } : {}),
      ...(input.commandExitCode !== undefined ? { commandExitCode: input.commandExitCode } : {}),
      ...(input.artifactUri !== undefined ? { artifactUri: input.artifactUri } : {}),
      ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
      ...(input.actorAgentId ? { actorAgentId: input.actorAgentId } : {}),
    }),
  }).catch(() => null);

  if (!response?.ok) return null;
  const data = await response.json() as { evidence?: JsonRecord; goal?: JsonRecord };
  if (!data.evidence || !data.goal) return null;
  return {
    evidence: normalizeGoalContractEvidence(data.evidence, input.itemId, input.sprintId ?? ""),
    goal: normalizeCompanyGoal(data.goal),
  };
}

export async function getPendingSprintPlanDraft(input: {
  companySlug: string;
  companyGoalId: string;
}): Promise<OrchestrationSprintPlanDraft | null> {
  const response = await fetch(
    `/api/orchestration/companies/${encodeURIComponent(input.companySlug)}/goals/${encodeURIComponent(input.companyGoalId)}/drafts`,
  ).catch(() => null);
  if (!response?.ok) return null;
  const data = await response.json() as { draft?: JsonRecord | null };
  return data.draft ? normalizeSprintPlanDraft(data.draft) : null;
}

export async function getPendingSprintPlanDrafts(input: {
  companySlug: string;
  companyGoalId: string;
}): Promise<OrchestrationSprintPlanDraft[]> {
  const response = await fetch(
    `/api/orchestration/companies/${encodeURIComponent(input.companySlug)}/goals/${encodeURIComponent(input.companyGoalId)}/drafts`,
  ).catch(() => null);
  if (!response?.ok) return [];
  const data = await response.json() as { drafts?: JsonRecord[]; draft?: JsonRecord | null };
  if (Array.isArray(data.drafts)) return data.drafts.map(normalizeSprintPlanDraft);
  return data.draft ? [normalizeSprintPlanDraft(data.draft)] : [];
}

export async function createTemplateDraftPlan(input: {
  companySlug: string;
  companyGoalId: string;
  templateId?: string;
  templateVersionId?: string;
  answers?: Record<string, unknown>;
  idempotencyKey?: string;
  submittedByAgentId?: string;
  submittedByUserId?: string;
  defaultExecutionEngine?: OrchestrationSprint["defaultExecutionEngine"];
  defaultModelLane?: OrchestrationSprint["defaultModelLane"];
  materializeCrewRecommendations?: boolean;
  materializeCrewRecommendationLanes?: Array<"required" | "useful" | "later">;
}): Promise<OrchestrationTemplateDraftPlan | null> {
  const response = await fetch(
    `/api/orchestration/companies/${encodeURIComponent(input.companySlug)}/goals/${encodeURIComponent(input.companyGoalId)}/drafts`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(input.templateId ? { templateId: input.templateId } : {}),
        ...(input.templateVersionId ? { templateVersionId: input.templateVersionId } : {}),
        answers: input.answers ?? {},
        ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
        ...(input.submittedByAgentId ? { submittedByAgentId: input.submittedByAgentId } : {}),
        ...(input.submittedByUserId ? { submittedByUserId: input.submittedByUserId } : {}),
        ...(input.defaultExecutionEngine ? { defaultExecutionEngine: input.defaultExecutionEngine } : {}),
        ...(input.defaultModelLane ? { defaultModelLane: input.defaultModelLane } : {}),
        ...(input.materializeCrewRecommendations !== undefined ? { materializeCrewRecommendations: input.materializeCrewRecommendations } : {}),
        ...(input.materializeCrewRecommendationLanes ? { materializeCrewRecommendationLanes: input.materializeCrewRecommendationLanes } : {}),
      }),
    },
  ).catch(() => null);
  if (!response?.ok) return null;
  const data = await response.json() as JsonRecord;
  if (!data.draft || typeof data.draft !== "object") return null;
  return {
    ...(data as unknown as OrchestrationTemplateDraftPlan),
    draft: normalizeSprintPlanDraft(data.draft as JsonRecord),
  };
}

export async function listPendingSprintPlanDrafts(input?: {
  companySlug?: string;
}): Promise<OrchestrationPendingSprintPlanDraftSummary[]> {
  const path = input?.companySlug
    ? `/api/orchestration/companies/${encodeURIComponent(input.companySlug)}/goals/drafts/pending`
    : "/api/orchestration/goals/drafts/pending";
  const response = await fetch(path).catch(() => null);
  if (!response?.ok) return [];
  const data = await response.json() as { drafts?: JsonRecord[] };
  return (data.drafts ?? []).map((raw) => ({
    id: String(raw.id ?? ""),
    companyId: String(raw.companyId ?? raw.company_id ?? ""),
    companySlug: String(raw.companySlug ?? raw.company_slug ?? ""),
    companyCode: String(raw.companyCode ?? raw.company_code ?? ""),
    companyGoalId: String(raw.companyGoalId ?? raw.company_goal_id ?? ""),
    companyGoalName: String(raw.companyGoalName ?? raw.company_goal_name ?? ""),
    proposedByAgentId: raw.proposedByAgentId ? String(raw.proposedByAgentId) : raw.proposed_by_agent_id ? String(raw.proposed_by_agent_id) : undefined,
    proposedByAgentName: raw.proposedByAgentName ? String(raw.proposedByAgentName) : raw.proposed_by_agent_name ? String(raw.proposed_by_agent_name) : undefined,
    proposedByAgentAvatarUrl: raw.proposedByAgentAvatarUrl ? String(raw.proposedByAgentAvatarUrl) : raw.proposed_by_agent_avatar_url ? String(raw.proposed_by_agent_avatar_url) : undefined,
    sprintName: String(raw.sprintName ?? raw.sprint_name ?? "Sprint plan"),
    taskCount: Number(raw.taskCount ?? raw.task_count ?? 0),
    nextSprintTaskCount: raw.nextSprintTaskCount !== undefined || raw.next_sprint_task_count !== undefined
      ? Number(raw.nextSprintTaskCount ?? raw.next_sprint_task_count ?? 0)
      : undefined,
    sprintCount: Number(raw.sprintCount ?? raw.sprint_count ?? 1),
    nextSequenceNumber: Number(raw.nextSequenceNumber ?? raw.next_sequence_number ?? 1),
    sprints: Array.isArray(raw.sprints)
      ? raw.sprints.map((sprint) => {
          const row = sprint as JsonRecord;
          return {
            id: String(row.id ?? ""),
            sequenceNumber: Number(row.sequenceNumber ?? row.sequence_number ?? 1),
            sprintName: String(row.sprintName ?? row.sprint_name ?? "Sprint plan"),
            taskCount: Number(row.taskCount ?? row.task_count ?? 0),
          };
        })
      : undefined,
    proposalGroupId: raw.proposalGroupId ? String(raw.proposalGroupId) : raw.proposal_group_id ? String(raw.proposal_group_id) : undefined,
    completionProposal: Boolean(raw.completionProposal ?? raw.completion_proposal),
    completionReason: raw.completionReason ? String(raw.completionReason) : raw.completion_reason ? String(raw.completion_reason) : undefined,
    createdAt: String(raw.createdAt ?? raw.created_at ?? new Date().toISOString()),
  }));
}

export async function getPendingSprintPlanDraftCount(input?: {
  companySlug?: string;
}): Promise<number | null> {
  const path = input?.companySlug
    ? `/api/orchestration/companies/${encodeURIComponent(input.companySlug)}/goals/drafts/pending`
    : "/api/orchestration/goals/drafts/pending";
  const response = await fetch(path).catch(() => null);
  if (!response?.ok) return null;
  const data = await response.json() as { pendingDrafts?: number; drafts?: unknown[] };
  return Number(data.pendingDrafts ?? data.drafts?.length ?? 0);
}

export async function createSprintPlanningTask(input: {
  companySlug: string;
  companyGoalId: string;
  leadAgentId?: string | null;
}): Promise<{ taskId: string; taskKey: string } | null> {
  const response = await fetch(
    `/api/orchestration/companies/${encodeURIComponent(input.companySlug)}/goals/${encodeURIComponent(input.companyGoalId)}/plan`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(input.leadAgentId !== undefined ? { leadAgentId: input.leadAgentId } : {}),
      }),
    },
  ).catch(() => null);
  if (!response?.ok) return null;
  const data = await response.json() as { taskId?: string; taskKey?: string };
  return data.taskId && data.taskKey ? { taskId: data.taskId, taskKey: data.taskKey } : null;
}

export async function reviewSprintPlanDraft(input: {
  companySlug: string;
  companyGoalId: string;
  draftId: string;
  action: "approve" | "approve_all" | "reject" | "update";
  reason?: string;
  sprint?: OrchestrationSprintPlanDraftSprint;
  tasks?: OrchestrationSprintPlanDraftTask[];
}): Promise<{
  draft: OrchestrationSprintPlanDraft;
  drafts?: OrchestrationSprintPlanDraft[];
  sprint?: OrchestrationCompanyGoal;
  sprints?: OrchestrationCompanyGoal[];
  taskIds?: string[];
  assigneeResolutionFailures?: Array<{ taskId: string; title: string; assignee: string }>;
} | null> {
  const response = await fetch(
    `/api/orchestration/companies/${encodeURIComponent(input.companySlug)}/goals/${encodeURIComponent(input.companyGoalId)}/drafts/${encodeURIComponent(input.draftId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: input.action,
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
        ...(input.sprint ? { sprint: input.sprint } : {}),
        ...(input.tasks ? { tasks: input.tasks } : {}),
      }),
    },
  ).catch(() => null);
  if (!response?.ok) return null;
  const data = await response.json() as {
    draft?: JsonRecord;
    drafts?: JsonRecord[];
    sprint?: JsonRecord;
    sprints?: JsonRecord[];
    taskIds?: string[];
    assigneeResolutionFailures?: Array<{ taskId: string; title: string; assignee: string }>;
  };
  if (!data.draft) return null;
  return {
    draft: normalizeSprintPlanDraft(data.draft),
    drafts: Array.isArray(data.drafts) ? data.drafts.map(normalizeSprintPlanDraft) : undefined,
    sprint: data.sprint ? normalizeCompanyGoal(data.sprint) : undefined,
    sprints: Array.isArray(data.sprints) ? data.sprints.map(normalizeCompanyGoal) : undefined,
    taskIds: data.taskIds,
    assigneeResolutionFailures: data.assigneeResolutionFailures,
  };
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

export async function archiveCompanyGoal(input: {
  companySlug: string;
  sprintId: string;
}): Promise<{ sprintId: string; sprintIds: string[]; taskIds: string[]; projectId: string; archivedAt: string } | null> {
  const response = await fetch(`/api/orchestration/companies/${encodeURIComponent(input.companySlug)}/goals/archive`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sprintId: input.sprintId }),
  }).catch(() => null);

  if (!response?.ok) return null;
  const data = (await response.json()) as {
    sprintId?: string;
    sprintIds?: string[];
    taskIds?: string[];
    projectId?: string;
    archivedAt?: string;
  };
  return {
    sprintId: String(data.sprintId ?? input.sprintId),
    sprintIds: Array.isArray(data.sprintIds) ? data.sprintIds.map(String) : [],
    taskIds: Array.isArray(data.taskIds) ? data.taskIds.map(String) : [],
    projectId: String(data.projectId ?? ""),
    archivedAt: String(data.archivedAt ?? new Date().toISOString()),
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
      metadata: raw.metadata ? jsonRecord(raw.metadata) : undefined,
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
  sourceWorkspaceRoot?: string | null;
}): Promise<OrchestrationProject | null> {
  const response = await fetch("/api/orchestration/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      companyId: input.companyId,
      name: input.name,
      ...(input.slug ? { slug: input.slug } : {}),
      description: input.description ?? "",
      color: input.color ?? suggestProjectColor(input.slug ?? input.name),
      emoji: input.emoji ?? "🛰️",
      ...(input.owner ? { owner: input.owner } : {}),
      status: input.status ?? "active",
      ...(input.avatarThemeName ? { avatarThemeName: input.avatarThemeName } : {}),
      ...(input.sourceWorkspaceRoot !== undefined ? { sourceWorkspaceRoot: input.sourceWorkspaceRoot } : {}),
    }),
  }).catch(() => null);

  if (!response?.ok) return null;
  const json = (await response.json()) as { project?: JsonRecord };
  if (!json.project) return null;
  return normalizeProject(json.project);
}

export async function updateProjectSettings(input: {
  projectIdOrSlug: string;
  name?: string;
  slug?: string;
  emoji?: string;
  color?: string;
  status?: "active" | "paused" | "archived";
  defaultExecutionEngine?: TaskExecutionEngine | null;
  sourceWorkspaceRoot?: string | null;
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
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.slug !== undefined ? { slug: input.slug } : {}),
      ...(input.emoji !== undefined ? { emoji: input.emoji } : {}),
      ...(input.color !== undefined ? { color: input.color } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.defaultExecutionEngine !== undefined ? { defaultExecutionEngine: input.defaultExecutionEngine } : {}),
      ...(input.sourceWorkspaceRoot !== undefined ? { sourceWorkspaceRoot: input.sourceWorkspaceRoot } : {}),
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

export interface TaskStatusUpdateResult {
  ok: boolean;
  errorCode?: string;
  message?: string;
}

async function parseTaskStatusError(response: Response): Promise<Pick<TaskStatusUpdateResult, "errorCode" | "message">> {
  try {
    const payload = await response.json() as {
      error?: {
        code?: unknown;
        message?: unknown;
      };
    };
    return {
      errorCode: typeof payload.error?.code === "string" ? payload.error.code : undefined,
      message: typeof payload.error?.message === "string" ? payload.error.message : undefined,
    };
  } catch {
    return {};
  }
}

export async function updateTaskStatusDetailed(
  taskId: string,
  status: TaskStatus,
  columnOrder?: number,
  options?: {
    reviewNotes?: string | null;
    actorUserId?: string;
  }
): Promise<TaskStatusUpdateResult> {
  const orchestrationRes = await fetch("/api/orchestration/tasks/reorder", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      taskId,
      status,
      columnOrder,
      ...(options?.reviewNotes !== undefined ? { reviewNotes: options.reviewNotes } : {}),
      ...(options?.actorUserId !== undefined ? { actorUserId: options.actorUserId } : {}),
    }),
  }).catch(() => null);

  if (orchestrationRes?.ok) return { ok: true };
  if (orchestrationRes && orchestrationRes.status !== 404) {
    const error = await parseTaskStatusError(orchestrationRes);
    return { ok: false, ...error };
  }

  const legacyRes = await fetch("/api/tasks", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: taskId, status }),
  }).catch(() => null);

  return { ok: Boolean(legacyRes?.ok) };
}

export async function updateTaskStatus(
  taskId: string,
  status: TaskStatus,
  columnOrder?: number,
  options?: {
    reviewNotes?: string | null;
    actorUserId?: string;
  }
): Promise<boolean> {
  const result = await updateTaskStatusDetailed(taskId, status, columnOrder, options);
  return result.ok;
}

export async function updateTaskAssignee(taskId: string, assignee: string | null): Promise<boolean> {
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
        slug: normalizeAgentSlug(a, String(a.name ?? "Unknown"), String(a.id ?? "unknown")),
        companyId: a.companyId ? String(a.companyId) : undefined,
        projectId: a.projectId ? String(a.projectId) : a.project_id ? String(a.project_id) : projectId,
        name: String(a.name ?? "Unknown"),
        emoji: normalizeAgentEmoji(a.emoji),
        role: String(a.role ?? "Agent"),
        avatar: a.avatar ? String(a.avatar) : undefined,
        status: (String(a.status ?? "idle") as OrchestrationAgent["status"]) ?? "idle",
        currentTask: a.currentTask ? String(a.currentTask) : undefined,
        personality: a.personality ? String(a.personality) : undefined,
        model: a.model ? String(a.model) : undefined,
        runtimeSlug: a.runtimeSlug ? String(a.runtimeSlug) : undefined,
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
      slug: agent.id,
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

export async function listCompanyAgents(
  companySlug: string,
  input?: { includeNonProduction?: boolean; includeArchived?: boolean; rosterState?: AgentRosterState }
): Promise<OrchestrationAgent[]> {
  const params = new URLSearchParams();
  params.set("includeNonProduction", input?.includeNonProduction === false ? "false" : "true");
  params.set("rosterState", input?.rosterState ?? "active");
  if (typeof input?.includeArchived === "boolean") {
    params.set("includeArchived", input.includeArchived ? "true" : "false");
  }
  const data = await fetchJsonDedupe<{ agents: JsonRecord[] }>(
    `/api/orchestration/companies/${encodeURIComponent(companySlug)}/agents?${params.toString()}`
  );
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
      emoji: normalizeAgentEmoji(a.emoji),
      role: String(a.role ?? "Agent"),
      avatar: a.avatar ? String(a.avatar) : undefined,
      status: (String(a.status ?? "idle") as OrchestrationAgent["status"]) ?? "idle",
      rosterState: a.rosterState ? String(a.rosterState) as OrchestrationAgent["rosterState"] : undefined,
      currentTask: a.currentTask ? String(a.currentTask) : undefined,
      personality: a.personality ? String(a.personality) : undefined,
      model: a.model ? String(a.model) : undefined,
      adapterType: a.adapterType ? String(a.adapterType) : a.adapter_type ? String(a.adapter_type) : undefined,
      runtimeConfig: jsonRecord(a.runtimeConfig),
      runtimeSlug: a.runtimeSlug ? String(a.runtimeSlug) : undefined,
      openclawAgentId: a.openclawAgentId ? String(a.openclawAgentId) : undefined,
      reportingTo: a.reportingTo ? String(a.reportingTo) : undefined,
      reportingToName: a.reportingToName ? String(a.reportingToName) : undefined,
      hireApprovalId: a.hireApprovalId ? String(a.hireApprovalId) : undefined,
      hireApprovalStatus: a.hireApprovalStatus ? String(a.hireApprovalStatus) as OrchestrationAgent["hireApprovalStatus"] : undefined,
      skills: Array.isArray(a.skills) ? a.skills.map((skill) => String(skill)) : undefined,
      tasksCompleted: a.tasksCompleted ? Number(a.tasksCompleted) : undefined,
      totalRuntimeMinutes: a.totalRuntimeMinutes ? Number(a.totalRuntimeMinutes) : undefined,
      lastHeartbeat: a.lastHeartbeat ? String(a.lastHeartbeat) : undefined,
      created: a.created ? String(a.created) : undefined,
      updated: a.updated ? String(a.updated) : undefined,
      archivedAt: a.archivedAt ? String(a.archivedAt) : undefined,
      avatarStyleId: a.avatarStyleId ? String(a.avatarStyleId) : undefined,
      avatarGender: a.avatarGender ? String(a.avatarGender) : undefined,
      avatarAge: typeof a.avatarAge === "number" ? a.avatarAge : undefined,
      avatarHairColor: a.avatarHairColor ? String(a.avatarHairColor) : undefined,
      avatarHairLength: a.avatarHairLength ? String(a.avatarHairLength) : undefined,
      avatarEyeColor: a.avatarEyeColor ? String(a.avatarEyeColor) : undefined,
      avatarVibe: a.avatarVibe ? String(a.avatarVibe) : undefined,
      voiceId: a.voiceId ? String(a.voiceId) : undefined,
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
    usageSummary?: JsonRecord;
  }>(url);
  if (!data?.company || !data?.agent) return null;

  const companyRaw = data.company as JsonRecord;
  const agentRaw = data.agent as JsonRecord;
  const normalizeProfileTask = (raw: JsonRecord): OrchestrationAgentProfileTask => ({
    id: String(raw.id ?? ""),
    key: raw.key ? String(raw.key) : null,
    title: String(raw.title ?? "Untitled Task"),
    projectId: String(raw.projectId ?? ""),
    projectSlug: String(raw.projectSlug ?? ""),
    projectName: String(raw.projectName ?? ""),
    projectColor: raw.projectColor ? String(raw.projectColor) : null,
    status: String(raw.status ?? "backlog") as OrchestrationAgentProfileTask["status"],
    priority: String(raw.priority ?? "P2") as OrchestrationAgentProfileTask["priority"],
    type: String(raw.type ?? "feature") as OrchestrationAgentProfileTask["type"],
    updatedAt: String(raw.updatedAt ?? new Date().toISOString()),
    sprintId: raw.sprintId ? String(raw.sprintId) : null,
    sprintName: raw.sprintName ? String(raw.sprintName) : null,
    sprintStatus: raw.sprintStatus ? String(raw.sprintStatus) as OrchestrationAgentProfileTask["sprintStatus"] : null,
    sprintStartDate: raw.sprintStartDate ? String(raw.sprintStartDate) : null,
    sprintEndDate: raw.sprintEndDate ? String(raw.sprintEndDate) : null,
    sprintOwner: raw.sprintOwner ? String(raw.sprintOwner) : null,
    sprintTaskCount: Number(raw.sprintTaskCount ?? 0),
    sprintDoneCount: Number(raw.sprintDoneCount ?? 0),
    companyGoalId: raw.companyGoalId ? String(raw.companyGoalId) : null,
    companyGoalName: raw.companyGoalName ? String(raw.companyGoalName) : null,
    companyGoalStatus: raw.companyGoalStatus ? String(raw.companyGoalStatus) as OrchestrationAgentProfileTask["companyGoalStatus"] : null,
    companyGoalProjectName: raw.companyGoalProjectName ? String(raw.companyGoalProjectName) : null,
    companyGoalProjectColor: raw.companyGoalProjectColor ? String(raw.companyGoalProjectColor) : null,
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
    provider: String(raw.provider ?? "manual") as OrchestrationAgentExecutionRun["provider"],
    runnerProvider: typeof raw.runnerProvider === "string" ? raw.runnerProvider : null,
    runnerModel: typeof raw.runnerModel === "string" ? raw.runnerModel : null,
    status: String(raw.status ?? "pending") as OrchestrationAgentExecutionRun["status"],
    sessionId: raw.sessionId ? String(raw.sessionId) : undefined,
    startedAt: raw.startedAt ? String(raw.startedAt) : undefined,
    completedAt: raw.completedAt ? String(raw.completedAt) : undefined,
    createdAt: String(raw.createdAt ?? new Date().toISOString()),
    durationMs: raw.durationMs ? Number(raw.durationMs) : undefined,
    errorMessage: raw.errorMessage ? String(raw.errorMessage) : undefined,
    inputTokens: typeof raw.inputTokens === "number" ? raw.inputTokens : undefined,
    outputTokens: typeof raw.outputTokens === "number" ? raw.outputTokens : undefined,
    cacheReadTokens: typeof raw.cacheReadTokens === "number" ? raw.cacheReadTokens : undefined,
    totalCostUsd: typeof raw.totalCostUsd === "number" ? raw.totalCostUsd : undefined,
    taskKey: raw.taskKey ? String(raw.taskKey) : undefined,
    triggerType: raw.triggerType ? String(raw.triggerType) : undefined,
    triggerReason: raw.triggerReason ? String(raw.triggerReason) : undefined,
  });
  const usageRaw = data.usageSummary && typeof data.usageSummary === "object" && !Array.isArray(data.usageSummary)
    ? data.usageSummary as JsonRecord
    : undefined;

  return {
    company: {
      id: String(companyRaw.id ?? ""),
      slug: String(companyRaw.slug ?? companySlug),
      name: String(companyRaw.name ?? "Company"),
    },
    agent: {
      id: String(agentRaw.id ?? ""),
      slug: normalizeAgentSlug(agentRaw, String(agentRaw.name ?? "Unknown Agent"), String(agentRaw.id ?? "")),
      companyId: agentRaw.companyId ? String(agentRaw.companyId) : undefined,
      projectId: agentRaw.projectId ? String(agentRaw.projectId) : undefined,
      name: String(agentRaw.name ?? "Unknown Agent"),
      emoji: normalizeAgentEmoji(agentRaw.emoji),
      role: String(agentRaw.role ?? "Agent"),
      avatar: agentRaw.avatar ? String(agentRaw.avatar) : undefined,
      status: String(agentRaw.status ?? "idle") as OrchestrationAgent["status"],
      currentTask: agentRaw.currentTask ? String(agentRaw.currentTask) : undefined,
      personality: agentRaw.personality ? String(agentRaw.personality) : undefined,
      model: agentRaw.model ? String(agentRaw.model) : undefined,
      adapterType: agentRaw.adapterType ? String(agentRaw.adapterType) : agentRaw.adapter_type ? String(agentRaw.adapter_type) : undefined,
      runtimeConfig: jsonRecord(agentRaw.runtimeConfig),
      runtimeSlug: agentRaw.runtimeSlug ? String(agentRaw.runtimeSlug) : undefined,
      openclawAgentId: agentRaw.openclawAgentId ? String(agentRaw.openclawAgentId) : undefined,
      reportingTo: agentRaw.reportingTo ? String(agentRaw.reportingTo) : undefined,
      hireApprovalId: agentRaw.hireApprovalId ? String(agentRaw.hireApprovalId) : undefined,
      hireApprovalStatus: agentRaw.hireApprovalStatus ? String(agentRaw.hireApprovalStatus) as OrchestrationAgent["hireApprovalStatus"] : undefined,
      skills: Array.isArray(agentRaw.skills) ? agentRaw.skills.map((value) => String(value)) : [],
      tasksCompleted: Number(agentRaw.tasksCompleted ?? 0),
      totalRuntimeMinutes: Number(agentRaw.totalRuntimeMinutes ?? 0),
      lastHeartbeat: agentRaw.lastHeartbeat ? String(agentRaw.lastHeartbeat) : undefined,
      created: agentRaw.created ? String(agentRaw.created) : undefined,
      updated: agentRaw.updated ? String(agentRaw.updated) : undefined,
      avatarStyleId: agentRaw.avatarStyleId ? String(agentRaw.avatarStyleId) : undefined,
      avatarGender: agentRaw.avatarGender ? String(agentRaw.avatarGender) : undefined,
      avatarAge: typeof agentRaw.avatarAge === "number" ? agentRaw.avatarAge : undefined,
      avatarHairColor: agentRaw.avatarHairColor ? String(agentRaw.avatarHairColor) : undefined,
      avatarHairLength: agentRaw.avatarHairLength ? String(agentRaw.avatarHairLength) : undefined,
      avatarEyeColor: agentRaw.avatarEyeColor ? String(agentRaw.avatarEyeColor) : undefined,
      avatarVibe: agentRaw.avatarVibe ? String(agentRaw.avatarVibe) : undefined,
      voiceId: agentRaw.voiceId ? String(agentRaw.voiceId) : undefined,
    },
    currentTasks: (data.currentTasks ?? []).map((raw) => normalizeProfileTask(raw as JsonRecord)),
    recentActivity: (data.recentActivity ?? []).map((raw) => normalizeProfileActivity(raw as JsonRecord)),
    executionHistory: (data.executionHistory ?? []).map((raw) => normalizeExecutionRun(raw as JsonRecord)),
    liveSession: data.liveSession ? normalizeExecutionRun(data.liveSession as JsonRecord) : undefined,
    usageSummary: usageRaw
      ? {
          totalRuns: Number(usageRaw.totalRuns ?? 0),
          completedRuns: Number(usageRaw.completedRuns ?? 0),
          failedRuns: Number(usageRaw.failedRuns ?? 0),
          totalDurationMs: Number(usageRaw.totalDurationMs ?? 0),
          inputTokens: Number(usageRaw.inputTokens ?? 0),
          outputTokens: Number(usageRaw.outputTokens ?? 0),
          cacheReadTokens: Number(usageRaw.cacheReadTokens ?? 0),
          totalCostUsd: Number(usageRaw.totalCostUsd ?? 0),
        }
      : undefined,
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
    key: raw.key ? String(raw.key) : null,
    title: String(raw.title ?? "Untitled Task"),
    projectId: String(raw.projectId ?? ""),
    projectSlug: String(raw.projectSlug ?? ""),
    projectName: String(raw.projectName ?? ""),
    projectColor: raw.projectColor ? String(raw.projectColor) : null,
    status: String(raw.status ?? "backlog") as OrchestrationAgentProfileTask["status"],
    priority: String(raw.priority ?? "P2") as OrchestrationAgentProfileTask["priority"],
    type: String(raw.type ?? "feature") as OrchestrationAgentProfileTask["type"],
    updatedAt: String(raw.updatedAt ?? new Date().toISOString()),
    sprintId: raw.sprintId ? String(raw.sprintId) : null,
    sprintName: raw.sprintName ? String(raw.sprintName) : null,
    sprintStatus: raw.sprintStatus ? String(raw.sprintStatus) as OrchestrationAgentProfileTask["sprintStatus"] : null,
    sprintStartDate: raw.sprintStartDate ? String(raw.sprintStartDate) : null,
    sprintEndDate: raw.sprintEndDate ? String(raw.sprintEndDate) : null,
    sprintOwner: raw.sprintOwner ? String(raw.sprintOwner) : null,
    sprintTaskCount: Number(raw.sprintTaskCount ?? 0),
    sprintDoneCount: Number(raw.sprintDoneCount ?? 0),
    companyGoalId: raw.companyGoalId ? String(raw.companyGoalId) : null,
    companyGoalName: raw.companyGoalName ? String(raw.companyGoalName) : null,
    companyGoalStatus: raw.companyGoalStatus ? String(raw.companyGoalStatus) as OrchestrationAgentProfileTask["companyGoalStatus"] : null,
    companyGoalProjectName: raw.companyGoalProjectName ? String(raw.companyGoalProjectName) : null,
    companyGoalProjectColor: raw.companyGoalProjectColor ? String(raw.companyGoalProjectColor) : null,
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
    provider: String(raw.provider ?? "manual") as OrchestrationAgentExecutionRun["provider"],
    runnerProvider: typeof raw.runnerProvider === "string" ? raw.runnerProvider : null,
    runnerModel: typeof raw.runnerModel === "string" ? raw.runnerModel : null,
    status: String(raw.status ?? "pending") as OrchestrationAgentExecutionRun["status"],
    sessionId: raw.sessionId ? String(raw.sessionId) : undefined,
    startedAt: raw.startedAt ? String(raw.startedAt) : undefined,
    completedAt: raw.completedAt ? String(raw.completedAt) : undefined,
    createdAt: String(raw.createdAt ?? new Date().toISOString()),
    durationMs: raw.durationMs ? Number(raw.durationMs) : undefined,
    errorMessage: raw.errorMessage ? String(raw.errorMessage) : undefined,
    inputTokens: typeof raw.inputTokens === "number" ? raw.inputTokens : undefined,
    outputTokens: typeof raw.outputTokens === "number" ? raw.outputTokens : undefined,
    cacheReadTokens: typeof raw.cacheReadTokens === "number" ? raw.cacheReadTokens : undefined,
    totalCostUsd: typeof raw.totalCostUsd === "number" ? raw.totalCostUsd : undefined,
    taskKey: raw.taskKey ? String(raw.taskKey) : undefined,
    triggerType: raw.triggerType ? String(raw.triggerType) : undefined,
    triggerReason: raw.triggerReason ? String(raw.triggerReason) : undefined,
  });

  return {
    company: {
      id: String(companyRaw.id ?? ""),
      slug: String(companyRaw.slug ?? ""),
      name: String(companyRaw.name ?? "Company"),
    },
    agent: {
      id: String(agentRaw.id ?? ""),
      slug: normalizeAgentSlug(agentRaw, String(agentRaw.name ?? "Unknown Agent"), String(agentRaw.id ?? "")),
      companyId: agentRaw.companyId ? String(agentRaw.companyId) : undefined,
      projectId: agentRaw.projectId ? String(agentRaw.projectId) : undefined,
      name: String(agentRaw.name ?? "Unknown Agent"),
      emoji: normalizeAgentEmoji(agentRaw.emoji),
      role: String(agentRaw.role ?? "Agent"),
      avatar: agentRaw.avatar ? String(agentRaw.avatar) : undefined,
      status: String(agentRaw.status ?? "idle") as OrchestrationAgent["status"],
      currentTask: agentRaw.currentTask ? String(agentRaw.currentTask) : undefined,
      personality: agentRaw.personality ? String(agentRaw.personality) : undefined,
      model: agentRaw.model ? String(agentRaw.model) : undefined,
      adapterType: agentRaw.adapterType ? String(agentRaw.adapterType) : agentRaw.adapter_type ? String(agentRaw.adapter_type) : undefined,
      runtimeConfig: jsonRecord(agentRaw.runtimeConfig),
      runtimeSlug: agentRaw.runtimeSlug ? String(agentRaw.runtimeSlug) : undefined,
      openclawAgentId: agentRaw.openclawAgentId ? String(agentRaw.openclawAgentId) : undefined,
      reportingTo: agentRaw.reportingTo ? String(agentRaw.reportingTo) : undefined,
      hireApprovalId: agentRaw.hireApprovalId ? String(agentRaw.hireApprovalId) : undefined,
      hireApprovalStatus: agentRaw.hireApprovalStatus ? String(agentRaw.hireApprovalStatus) as OrchestrationAgent["hireApprovalStatus"] : undefined,
      skills: Array.isArray(agentRaw.skills) ? agentRaw.skills.map((value) => String(value)) : [],
      tasksCompleted: Number(agentRaw.tasksCompleted ?? 0),
      totalRuntimeMinutes: Number(agentRaw.totalRuntimeMinutes ?? 0),
      lastHeartbeat: agentRaw.lastHeartbeat ? String(agentRaw.lastHeartbeat) : undefined,
      created: agentRaw.created ? String(agentRaw.created) : undefined,
      updated: agentRaw.updated ? String(agentRaw.updated) : undefined,
      avatarStyleId: agentRaw.avatarStyleId ? String(agentRaw.avatarStyleId) : undefined,
      avatarGender: agentRaw.avatarGender ? String(agentRaw.avatarGender) : undefined,
      avatarAge: typeof agentRaw.avatarAge === "number" ? agentRaw.avatarAge : undefined,
      avatarHairColor: agentRaw.avatarHairColor ? String(agentRaw.avatarHairColor) : undefined,
      avatarHairLength: agentRaw.avatarHairLength ? String(agentRaw.avatarHairLength) : undefined,
      avatarEyeColor: agentRaw.avatarEyeColor ? String(agentRaw.avatarEyeColor) : undefined,
      avatarVibe: agentRaw.avatarVibe ? String(agentRaw.avatarVibe) : undefined,
      voiceId: agentRaw.voiceId ? String(agentRaw.voiceId) : undefined,
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
      emoji: input.emoji?.trim() || undefined,
      personality: input.personality?.trim() ?? "",
    }),
  }).catch(() => null);

  if (!response?.ok) return null;
  const body = (await response.json()) as { agent?: JsonRecord };
  if (!body.agent) return null;

  const a = body.agent as JsonRecord;
  return {
    id: String(a.id ?? "unknown"),
    slug: normalizeAgentSlug(a, String(a.name ?? "Unknown"), String(a.id ?? "unknown")),
    projectId: String(a.projectId ?? input.projectId),
    name: String(a.name ?? "Unknown"),
    emoji: normalizeAgentEmoji(a.emoji),
    role: String(a.role ?? "Agent"),
    avatar: a.avatar ? String(a.avatar) : undefined,
    status: (String(a.status ?? "idle") as OrchestrationAgent["status"]) ?? "idle",
    currentTask: a.currentTask ? String(a.currentTask) : undefined,
    personality: a.personality ? String(a.personality) : undefined,
    model: a.model ? String(a.model) : undefined,
    runtimeSlug: a.runtimeSlug ? String(a.runtimeSlug) : undefined,
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
    slug: normalizeAgentSlug(a, String(a.name ?? "Unknown"), String(a.id ?? "unknown")),
    projectId: String(a.projectId ?? projectId),
    name: String(a.name ?? "Unknown"),
    emoji: normalizeAgentEmoji(a.emoji),
    role: String(a.role ?? "Agent"),
    avatar: a.avatar ? String(a.avatar) : undefined,
    status: (String(a.status ?? "idle") as OrchestrationAgent["status"]) ?? "idle",
    currentTask: a.currentTask ? String(a.currentTask) : undefined,
    personality: a.personality ? String(a.personality) : undefined,
    model: a.model ? String(a.model) : undefined,
    runtimeSlug: a.runtimeSlug ? String(a.runtimeSlug) : undefined,
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
  company?: string;
  title: string;
  description?: string;
  priority?: OrchestrationTask["priority"];
  projectId?: string | null;
  type?: OrchestrationTask["type"];
  status?: TaskStatus;
  assignee?: string;
  eligibleAssignees?: string[];
  dueDate?: string;
  sprintId?: string;
  parentTaskId?: string;
  labels?: string[];
  executionEngine?: OrchestrationTask["executionEngine"] | null;
  executionRuntimeProvider?: string | null;
  executionRuntimeLabel?: string | null;
  executionModelRouting?: string | null;
  executionModelRoutingLabel?: string | null;
  modelLane?: OrchestrationTask["modelLane"] | null;
}): Promise<OrchestrationTask | null> {
  const response = await fetch("/api/orchestration/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...(input.company ? { company: input.company } : {}),
      ...(input.projectId ? { projectId: input.projectId } : {}),
      title: input.title,
      description: input.description ?? "",
      priority: input.priority ?? "P2",
      type: input.type ?? "feature",
      status: input.status ?? "backlog",
      ...(input.assignee ? { assignee: input.assignee } : {}),
      ...(input.eligibleAssignees !== undefined ? { eligibleAssignees: input.eligibleAssignees } : {}),
      ...(input.dueDate ? { dueDate: input.dueDate } : {}),
      ...(input.sprintId ? { sprintId: input.sprintId } : {}),
      ...(input.parentTaskId ? { parentTaskId: input.parentTaskId } : {}),
      ...(input.executionEngine !== undefined ? { executionEngine: input.executionEngine } : {}),
      ...(input.executionRuntimeProvider !== undefined ? { executionRuntimeProvider: input.executionRuntimeProvider } : {}),
      ...(input.executionRuntimeLabel !== undefined ? { executionRuntimeLabel: input.executionRuntimeLabel } : {}),
      ...(input.executionModelRouting !== undefined ? { executionModelRouting: input.executionModelRouting } : {}),
      ...(input.executionModelRoutingLabel !== undefined ? { executionModelRoutingLabel: input.executionModelRoutingLabel } : {}),
      ...(input.modelLane !== undefined ? { modelLane: input.modelLane } : {}),
      labels: input.labels ?? [],
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
  limit?: number;
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
  if (typeof input?.limit === "number") params.set("limit", String(input.limit));

  const query = params.toString();
  const url = `/api/orchestration/tasks${query ? `?${query}` : ""}`;
  const data = await fetchJsonDedupe<{ tasks: JsonRecord[] }>(url);
  return (data?.tasks ?? []).map(normalizeTask);
}

export async function listCompanyEvalCases(
  companySlug: string,
  input?: OrchestrationEvalLibraryFilters,
): Promise<OrchestrationEvalLibraryResult> {
  const params = new URLSearchParams();
  if (input?.projectId) params.set("projectId", input.projectId);
  if (input?.taskType) params.set("taskType", input.taskType);
  if (input?.template) params.set("template", input.template);
  if (input?.sourceTemplateVersionId) params.set("sourceTemplateVersionId", input.sourceTemplateVersionId);
  if (input?.templateIntakeAnswerId) params.set("templateIntakeAnswerId", input.templateIntakeAnswerId);
  if (input?.agent) params.set("agent", input.agent);
  if (input?.runner) params.set("runner", input.runner);
  if (input?.model) params.set("model", input.model);
  if (input?.reviewOutcome) params.set("reviewOutcome", input.reviewOutcome);
  if (input?.tag) params.set("tag", input.tag);
  if (input?.dateFrom) params.set("dateFrom", input.dateFrom);
  if (input?.dateTo) params.set("dateTo", input.dateTo);
  if (typeof input?.limit === "number") params.set("limit", String(input.limit));

  const query = params.toString();
  const data = await fetchJson<{
    cases?: JsonRecord[];
    total?: number;
    filters?: JsonRecord;
    facets?: unknown;
  }>(`/api/orchestration/companies/${encodeURIComponent(companySlug)}/evals${query ? `?${query}` : ""}`);

  return {
    cases: (data?.cases ?? []).map(normalizeEvalCase),
    total: Number(data?.total ?? 0),
    filters: jsonRecord(data?.filters) as OrchestrationEvalLibraryFilters,
    facets: normalizeEvalFacets(data?.facets),
  };
}

function appendRepeatedParams(params: URLSearchParams, key: string, values?: string[]): void {
  for (const value of values ?? []) {
    if (value) params.append(key, value);
  }
}

function improveRecommendationQuery(input?: OrchestrationImprovementRecommendationFilters): string {
  const params = new URLSearchParams();
  appendRepeatedParams(params, "status", input?.status);
  appendRepeatedParams(params, "severity", input?.severity);
  appendRepeatedParams(params, "confidence", input?.confidence);
  appendRepeatedParams(params, "sourceType", input?.sourceType);
  if (input?.triggerKey) params.set("triggerKey", input.triggerKey);
  if (input?.category) params.set("category", input.category);
  if (input?.scopeType) params.set("scopeType", input.scopeType);
  if (input?.scopeKey) params.set("scopeKey", input.scopeKey);
  if (input?.projectId) params.set("projectId", input.projectId);
  if (input?.agentId) params.set("agentId", input.agentId);
  if (input?.search) params.set("search", input.search);
  if (input?.evidenceState) params.set("evidenceState", input.evidenceState);
  if (typeof input?.includeSuppressed === "boolean") params.set("includeSuppressed", input.includeSuppressed ? "true" : "false");
  if (input?.groupBy) params.set("groupBy", input.groupBy);
  if (typeof input?.limit === "number") params.set("limit", String(input.limit));
  const query = params.toString();
  return query ? `?${query}` : "";
}

function normalizeImproveGroups(raw: unknown): OrchestrationImprovementRecommendationGroup[] {
  return Array.isArray(raw)
    ? raw.map((item) => {
        const group = jsonRecord(item);
        return {
          key: String(group.key ?? ""),
          label: String(group.label ?? group.key ?? ""),
          count: Number(group.count ?? 0),
          recommendationIds: Array.isArray(group.recommendationIds)
            ? group.recommendationIds.map((id) => String(id))
            : [],
        };
      })
    : [];
}

export async function listCompanyImproveRecommendations(
  companySlug: string,
  input?: OrchestrationImprovementRecommendationFilters,
): Promise<OrchestrationImprovementRecommendationListResult> {
  const data = await fetchJson<{
    recommendations?: unknown[];
    total?: number;
    filters?: JsonRecord;
    groups?: unknown;
  }>(
    `/api/orchestration/companies/${encodeURIComponent(companySlug)}/improve/recommendations${improveRecommendationQuery(input)}`,
  );

  return {
    recommendations: (data?.recommendations ?? []).map(normalizeImprovementRecommendation),
    total: Number(data?.total ?? 0),
    filters: jsonRecord(data?.filters) as OrchestrationImprovementRecommendationFilters,
    groups: normalizeImproveGroups(data?.groups),
  };
}

export async function getCompanyImproveRecommendation(
  companySlug: string,
  recommendationId: string,
): Promise<OrchestrationImprovementRecommendation | null> {
  const data = await fetchJson<{ recommendation?: unknown }>(
    `/api/orchestration/companies/${encodeURIComponent(companySlug)}/improve/recommendations/${encodeURIComponent(recommendationId)}`,
  );
  return data?.recommendation ? normalizeImprovementRecommendation(data.recommendation) : null;
}

export async function updateCompanyImproveRecommendation(
  companySlug: string,
  recommendationId: string,
  body: Record<string, unknown>,
): Promise<OrchestrationImprovementRecommendation | null> {
  try {
    const response = await fetch(
      `/api/orchestration/companies/${encodeURIComponent(companySlug)}/improve/recommendations/${encodeURIComponent(recommendationId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (!response.ok) return null;
    const data = await response.json() as { recommendation?: unknown };
    return data.recommendation ? normalizeImprovementRecommendation(data.recommendation) : null;
  } catch {
    return null;
  }
}

export async function editCompanyImproveRecommendation(
  companySlug: string,
  recommendationId: string,
  input: {
    title?: string;
    rationale?: string;
    proposedChange?: string;
    severity?: OrchestrationImprovementSeverity;
    confidence?: OrchestrationImprovementConfidence;
    category?: string | null;
    summary?: string | null;
    riskNotes?: string | null;
    rollbackNotes?: string | null;
    groupKey?: string | null;
    groupLabel?: string | null;
    tags?: string[];
  },
): Promise<OrchestrationImprovementRecommendation | null> {
  return updateCompanyImproveRecommendation(companySlug, recommendationId, {
    action: "edit",
    ...input,
  });
}

export async function dismissCompanyImproveRecommendation(
  companySlug: string,
  recommendationId: string,
  input: {
    reason: OrchestrationImprovementDismissalReason | string;
    notes?: string | null;
    actorAgentId?: string | null;
    actorUserId?: string | null;
  },
): Promise<OrchestrationImprovementRecommendation | null> {
  return updateCompanyImproveRecommendation(companySlug, recommendationId, {
    action: "dismiss",
    reason: input.reason,
    notes: input.notes ?? null,
    actorAgentId: input.actorAgentId ?? null,
    actorUserId: input.actorUserId ?? null,
  });
}

export async function suppressCompanyImproveRecommendation(
  companySlug: string,
  recommendationId: string,
  input: {
    reason: OrchestrationImprovementSuppressionReason | string;
    notes?: string | null;
    scopeType?: OrchestrationImprovementScopeType;
    scopeKey?: string;
    expiresAt?: string | null;
    actorAgentId?: string | null;
    actorUserId?: string | null;
  },
): Promise<OrchestrationImprovementRecommendation | null> {
  return updateCompanyImproveRecommendation(companySlug, recommendationId, {
    action: "suppress",
    reason: input.reason,
    notes: input.notes ?? null,
    scopeType: input.scopeType,
    scopeKey: input.scopeKey,
    expiresAt: input.expiresAt ?? null,
    actorAgentId: input.actorAgentId ?? null,
    actorUserId: input.actorUserId ?? null,
  });
}

export async function acceptCompanyImproveRecommendationForApproval(
  companySlug: string,
  recommendationId: string,
  input: {
    approvalId?: string | null;
    note?: string | null;
    title?: string;
    proposedChangeSummary?: string;
    rationale?: string;
    preview?: Record<string, unknown>;
    riskNotes?: string | null;
    rollbackNotes?: string | null;
    actorAgentId?: string | null;
    actorUserId?: string | null;
  } = {},
): Promise<OrchestrationImprovementRecommendation | null> {
  return updateCompanyImproveRecommendation(companySlug, recommendationId, {
    action: "accept_for_approval",
    approvalId: input.approvalId ?? null,
    note: input.note ?? null,
    title: input.title,
    proposedChangeSummary: input.proposedChangeSummary,
    rationale: input.rationale,
    preview: input.preview,
    riskNotes: input.riskNotes ?? null,
    rollbackNotes: input.rollbackNotes ?? null,
    actorAgentId: input.actorAgentId ?? null,
    actorUserId: input.actorUserId ?? null,
  });
}

export async function transitionCompanyImproveRecommendationStatus(
  companySlug: string,
  recommendationId: string,
  input: {
    status: OrchestrationImprovementRecommendationStatus;
    reason?: string | null;
    approvalId?: string | null;
    supersededByRecommendationId?: string | null;
    actorAgentId?: string | null;
    actorUserId?: string | null;
  },
): Promise<OrchestrationImprovementRecommendation | null> {
  return updateCompanyImproveRecommendation(companySlug, recommendationId, {
    action: "transition",
    status: input.status,
    reason: input.reason ?? null,
    approvalId: input.approvalId ?? null,
    supersededByRecommendationId: input.supersededByRecommendationId ?? null,
    actorAgentId: input.actorAgentId ?? null,
    actorUserId: input.actorUserId ?? null,
  });
}

async function patchCompanyImproveDashboard(
  companySlug: string,
  body: Record<string, unknown>,
): Promise<OrchestrationImprovementDashboard | null> {
  try {
    const response = await fetch(
      `/api/orchestration/companies/${encodeURIComponent(companySlug)}/improve`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (!response.ok) return null;
    return normalizeImprovementDashboard(await response.json());
  } catch {
    return null;
  }
}

export async function getCompanyImprovementDashboard(
  companySlug: string,
): Promise<OrchestrationImprovementDashboard | null> {
  const data = await fetchJson<unknown>(`/api/orchestration/companies/${encodeURIComponent(companySlug)}/improve`);
  return data ? normalizeImprovementDashboard(data) : null;
}

export async function setCompanyImprovementPaused(
  companySlug: string,
  input: {
    paused: boolean;
    reason?: string | null;
  },
): Promise<OrchestrationImprovementDashboard | null> {
  return patchCompanyImproveDashboard(companySlug, {
    action: "set_company_pause",
    paused: input.paused,
    reason: input.reason ?? null,
  });
}

export async function setCompanyImprovementTriggerEnabled(
  companySlug: string,
  input: {
    triggerKey: OrchestrationImprovementTriggerKey;
    enabled: boolean;
  },
): Promise<OrchestrationImprovementDashboard | null> {
  return patchCompanyImproveDashboard(companySlug, {
    action: "set_trigger_enabled",
    triggerKey: input.triggerKey,
    enabled: input.enabled,
  });
}

export async function dismissCompanyImprovementRecommendation(
  companySlug: string,
  input: {
    recommendationId: string;
    reason: OrchestrationImprovementDismissalReason;
    notes?: string | null;
  },
): Promise<OrchestrationImprovementDashboard | null> {
  return patchCompanyImproveDashboard(companySlug, {
    action: "dismiss_recommendation",
    recommendationId: input.recommendationId,
    reason: input.reason,
    notes: input.notes ?? null,
  });
}

export async function createCompanyImprovementSuppression(
  companySlug: string,
  input: {
    triggerKey?: OrchestrationImprovementTriggerKey | null;
    scopeType: OrchestrationImprovementScopeType;
    scopeKey: string;
    reason: OrchestrationImprovementSuppressionReason;
    notes?: string | null;
    expiresAt?: string | null;
  },
): Promise<OrchestrationImprovementDashboard | null> {
  return patchCompanyImproveDashboard(companySlug, {
    action: "create_suppression",
    triggerKey: input.triggerKey ?? null,
    scopeType: input.scopeType,
    scopeKey: input.scopeKey,
    reason: input.reason,
    notes: input.notes ?? null,
    expiresAt: input.expiresAt ?? null,
  });
}

export async function deactivateCompanyImprovementSuppression(
  companySlug: string,
  suppressionId: string,
): Promise<OrchestrationImprovementDashboard | null> {
  return patchCompanyImproveDashboard(companySlug, {
    action: "deactivate_suppression",
    suppressionId,
  });
}

export async function getTask(taskId: string): Promise<OrchestrationTask | null> {
  const data = await fetchJson<{ task?: JsonRecord }>(`/api/orchestration/tasks/${taskId}`);
  if (!data?.task) return null;
  return normalizeTask(data.task);
}

export async function getTaskDetail(taskId: string): Promise<{ task: OrchestrationTask; detail: import("@/lib/orchestration/types").OrchestrationTaskDetail } | null> {
  const data = await fetchJson<{ task?: JsonRecord; detail?: JsonRecord }>(`/api/orchestration/tasks/${taskId}`);
  if (!data?.task || !data?.detail) return null;
  return {
    task: normalizeTask(data.task),
    detail: normalizeTaskDetail(data.detail),
  };
}

export async function updateTask(input: {
  taskId: string;
  title?: string;
  description?: string;
  priority?: OrchestrationTask["priority"];
  projectId?: string | null;
  type?: OrchestrationTask["type"];
  sprintId?: string | null;
  parentTaskId?: string | null;
  labels?: string[];
  eligibleAssignees?: string[] | null;
  blockedReason?: string | null;
  executionEngine?: OrchestrationTask["executionEngine"] | null;
  executionRuntimeProvider?: string | null;
  executionRuntimeLabel?: string | null;
  executionModelRouting?: string | null;
  executionModelRoutingLabel?: string | null;
  modelLane?: OrchestrationTask["modelLane"] | null;
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
      ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.sprintId !== undefined ? { sprintId: input.sprintId } : {}),
      ...(input.parentTaskId !== undefined ? { parentTaskId: input.parentTaskId } : {}),
      ...(input.labels !== undefined ? { labels: input.labels } : {}),
      ...(input.eligibleAssignees !== undefined ? { eligibleAssignees: input.eligibleAssignees } : {}),
      ...(input.blockedReason !== undefined ? { blockedReason: input.blockedReason } : {}),
      ...(input.executionEngine !== undefined ? { executionEngine: input.executionEngine } : {}),
      ...(input.executionRuntimeProvider !== undefined ? { executionRuntimeProvider: input.executionRuntimeProvider } : {}),
      ...(input.executionRuntimeLabel !== undefined ? { executionRuntimeLabel: input.executionRuntimeLabel } : {}),
      ...(input.executionModelRouting !== undefined ? { executionModelRouting: input.executionModelRouting } : {}),
      ...(input.executionModelRoutingLabel !== undefined ? { executionModelRoutingLabel: input.executionModelRoutingLabel } : {}),
      ...(input.modelLane !== undefined ? { modelLane: input.modelLane } : {}),
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

export type AddTaskCommentResult = {
  ok: boolean;
  comment?: NonNullable<OrchestrationTask["comments"]>[number];
  heartbeat?: {
    attempted?: boolean;
    queued?: boolean;
    status?: string;
    mode?: string;
    runId?: string;
    wakeupRequestId?: string;
    reason?: string;
  };
};

function mapCommentRecord(comment: JsonRecord): NonNullable<OrchestrationTask["comments"]>[number] {
  return {
    id: String(comment.id ?? crypto.randomUUID()),
    author: String(comment.author ?? "Unknown"),
    authorEmoji: comment.authorEmoji ? String(comment.authorEmoji) : undefined,
    text: String(comment.text ?? ""),
    timestamp: String(comment.timestamp ?? new Date().toISOString()),
    type: comment.type ? String(comment.type) : undefined,
    source: comment.source ? String(comment.source) : undefined,
  };
}

export async function addTaskCommentWithResult(taskId: string, body: string, authorUserId = "me"): Promise<AddTaskCommentResult> {
  try {
    const response = await fetch(`/api/orchestration/tasks/${encodeURIComponent(taskId)}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body, authorUserId }),
    });
    if (!response.ok) return { ok: false };
    const json = (await response.json().catch(() => ({}))) as JsonRecord;
    const heartbeat = json.heartbeat && typeof json.heartbeat === "object"
      ? json.heartbeat as AddTaskCommentResult["heartbeat"]
      : undefined;
    const comment = json.comment && typeof json.comment === "object"
      ? mapCommentRecord(json.comment as JsonRecord)
      : undefined;
    return { ok: true, comment, heartbeat };
  } catch {
    return { ok: false };
  }
}

export async function addTaskComment(taskId: string, body: string, authorUserId = "me"): Promise<boolean> {
  return (await addTaskCommentWithResult(taskId, body, authorUserId)).ok;
}

export async function listTaskComments(taskId: string): Promise<NonNullable<OrchestrationTask["comments"]>> {
  const data = await fetchJson<{ comments: JsonRecord[] }>(`/api/orchestration/tasks/${taskId}/comments`);
  if (!data?.comments) return [];
  return data.comments.map((comment) => mapCommentRecord(comment as JsonRecord));
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

export async function pollTaskExecutionStatus(taskId: string): Promise<{
  taskId: string;
  mode: "openclaw" | "codex" | "anthropic" | "hermes" | "gemini" | "symphony" | "manual";
  sessionId?: string;
  runId?: string;
  agentId?: string;
  polledAt: string;
  status: {
    state: "running" | "completed" | "failed" | "cancelled" | "unknown" | "skipped";
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
    mode: String(data.mode ?? "manual") as "openclaw" | "codex" | "anthropic" | "hermes" | "gemini" | "symphony" | "manual",
    runId: data.runId ? String(data.runId) : undefined,
    agentId: data.agentId ? String(data.agentId) : undefined,
    sessionId: data.sessionId ? String(data.sessionId) : undefined,
    polledAt: String(data.polledAt ?? new Date().toISOString()),
    status: {
      state: String(status.state ?? "unknown") as "running" | "completed" | "failed" | "cancelled" | "unknown" | "skipped",
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

export async function runTaskExecution(input: {
  taskId: string;
  actorUserId?: string;
  reason?: string;
  forceFreshSession?: boolean;
  resumeOfExecutionRunId?: string;
}): Promise<{
  task: OrchestrationTask;
  transition: {
    from?: TaskStatus;
    to?: TaskStatus;
    statusChanged?: boolean;
  };
  execution: {
    taskId: string;
    mode: "openclaw" | "codex" | "anthropic" | "hermes" | "gemini" | "symphony" | "manual";
    queued: boolean;
    status: "queued" | "running" | "skipped";
    runId?: string;
    sessionId?: string;
    reason?: string;
  };
} | null> {
  const response = await fetch(
    `/api/orchestration/tasks/${encodeURIComponent(input.taskId)}/execution`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actorUserId: input.actorUserId,
        reason: input.reason,
        forceFreshSession: input.forceFreshSession ?? true,
        resumeOfExecutionRunId: input.resumeOfExecutionRunId,
      }),
    }
  ).catch(() => null);

  if (!response?.ok) return null;
  const data = (await response.json()) as JsonRecord;
  const task = data.task as JsonRecord | undefined;
  if (!task) return null;
  const execution = (data.execution ?? {}) as JsonRecord;
  const transition = (data.transition ?? {}) as JsonRecord;
  return {
    task: normalizeTask(task),
    transition: {
      from: transition.from ? (String(transition.from) as TaskStatus) : undefined,
      to: transition.to ? (String(transition.to) as TaskStatus) : undefined,
      statusChanged: typeof transition.statusChanged === "boolean" ? transition.statusChanged : undefined,
    },
    execution: {
      taskId: String(execution.taskId ?? input.taskId),
      mode: String(execution.mode ?? "manual") as "openclaw" | "codex" | "anthropic" | "hermes" | "gemini" | "symphony" | "manual",
      queued: Boolean(execution.queued),
      status: String(execution.status ?? "skipped") as "queued" | "running" | "skipped",
      runId: execution.runId ? String(execution.runId) : undefined,
      sessionId: execution.sessionId ? String(execution.sessionId) : undefined,
      reason: execution.reason ? String(execution.reason) : undefined,
    },
  };
}

export async function cancelTaskExecution(input: {
  taskId: string;
  actorUserId?: string;
  note?: string;
  targetStatus?: "to-do" | "in-progress";
}): Promise<{
  taskId: string;
  mode: "openclaw" | "codex" | "anthropic" | "hermes" | "gemini" | "symphony" | "manual";
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
    mode: String(data.mode ?? "manual") as "openclaw" | "codex" | "anthropic" | "hermes" | "gemini" | "symphony" | "manual",
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
      slug: normalizeAgentSlug(agentRaw, String(agentRaw.name ?? "Unknown Agent"), String(agentRaw.id ?? "")),
      name: String(agentRaw.name ?? "Unknown Agent"),
      emoji: normalizeAgentEmoji(agentRaw.emoji),
      role: String(agentRaw.role ?? ""),
      avatar: agentRaw.avatar ? String(agentRaw.avatar) : undefined,
      status: String(agentRaw.status ?? "idle") as OrchestrationAgent["status"],
      projectId: String(agentRaw.projectId ?? ""),
      currentTask: agentRaw.currentTask ? String(agentRaw.currentTask) : undefined,
      personality: agentRaw.personality ? String(agentRaw.personality) : undefined,
      model: agentRaw.model ? String(agentRaw.model) : undefined,
      runtimeSlug: agentRaw.runtimeSlug ? String(agentRaw.runtimeSlug) : undefined,
      openclawAgentId: agentRaw.openclawAgentId ? String(agentRaw.openclawAgentId) : undefined,
      reportingTo: agentRaw.reportingTo ? String(agentRaw.reportingTo) : undefined,
      hireApprovalId: agentRaw.hireApprovalId ? String(agentRaw.hireApprovalId) : undefined,
      hireApprovalStatus: agentRaw.hireApprovalStatus ? String(agentRaw.hireApprovalStatus) as OrchestrationAgent["hireApprovalStatus"] : undefined,
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

export async function getRoutineDetail(routineId: string): Promise<{
  routine: OrchestrationRoutineListItem;
  runs: Array<{
    id: string;
    source: string;
    status: string;
    triggeredAt: string;
    completedAt: string | null;
    failureReason: string | null;
  }>;
} | null> {
  const data = await fetchJson<{
    routine: OrchestrationRoutineListItem;
    runs: Array<{
      id: string;
      source: string;
      status: string;
      triggeredAt: string;
      completedAt: string | null;
      failureReason: string | null;
    }>;
  }>(`/api/orchestration/routines/${encodeURIComponent(routineId)}?detail=true`);
  return data ?? null;
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

export async function listCompanyApprovals(input: {
  companySlug: string;
  status?: ApprovalStatus;
  type?: ApprovalType;
  linkedTaskId?: string;
}): Promise<OrchestrationApproval[]> {
  const params = new URLSearchParams();
  if (input.status) params.set("status", input.status);
  if (input.type) params.set("type", input.type);
  if (input.linkedTaskId) params.set("linkedTaskId", input.linkedTaskId);
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  const data = await fetchJson<{ approvals: OrchestrationApproval[] }>(
    `/api/orchestration/companies/${encodeURIComponent(input.companySlug)}/approvals${suffix}`
  );
  return data?.approvals ?? [];
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
