import path from "path";

import { OrchestrationApiError } from "@/lib/orchestration/api";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { resolveExecutionRoute } from "@/lib/orchestration/execution-route-resolver";
import { formatLaneFingerprint } from "@/lib/orchestration/execution-hives";
import { listExecutionTranscriptEvents } from "@/lib/orchestration/service/execution-transcript";
import { resolveTaskModelRouting } from "@/lib/orchestration/task-model-routing";
import type {
  OrchestrationTask,
  OrchestrationTaskDetail,
  OrchestrationTaskDetailSummary,
  OrchestrationResolvedExecutionContext,
  OrchestrationTaskRunSummary,
  OrchestrationTaskTimelineItem,
  TaskExecutionEngine,
  TaskModelLane,
} from "@/lib/orchestration/types";
import { readProjectSourceWorkspaceRoot, resolveTaskExecutionRouting, taskById } from "./shared";

function asJson(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function parseJsonArray(value: string | null | undefined): unknown[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function stringFrom(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberFrom(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function addMetric(
  totals: NonNullable<OrchestrationTaskRunSummary["usageTotals"]>,
  key: keyof NonNullable<OrchestrationTaskRunSummary["usageTotals"]>,
  value: unknown,
): void {
  const parsed = numberFrom(value);
  if (parsed === null) return;
  totals[key] = (totals[key] ?? 0) + parsed;
}

function runUsageTotals(
  runs: Array<{ token_usage_json?: string | null; usage_json?: string | null }>,
): OrchestrationTaskRunSummary["usageTotals"] {
  const totals: NonNullable<OrchestrationTaskRunSummary["usageTotals"]> = {
    inputTokens: null,
    outputTokens: null,
    cacheReadInputTokens: null,
    cacheCreationInputTokens: null,
    totalCostUsd: null,
  };
  for (const run of runs) {
    const usage = asJson("token_usage_json" in run ? run.token_usage_json : run.usage_json);
    addMetric(totals, "inputTokens", usage.inputTokens);
    addMetric(totals, "outputTokens", usage.outputTokens);
    addMetric(totals, "cacheReadInputTokens", usage.cacheReadInputTokens);
    addMetric(totals, "cacheCreationInputTokens", usage.cacheCreationInputTokens);
    addMetric(totals, "totalCostUsd", usage.totalCostUsd);
  }
  return totals;
}

function asSummary(task: OrchestrationTask): OrchestrationTaskDetailSummary {
  return {
    id: task.id,
    key: task.key,
    title: task.title,
    status: task.status,
    priority: task.priority,
    type: task.type,
    assignee: task.assignee,
    modelDisplay: task.modelDisplay ?? null,
    updated: task.updated,
    created: task.created,
  };
}

function taskEventSummary(eventType: string, fromStatus?: string | null, toStatus?: string | null): string {
  switch (eventType) {
    case "task.created":
      return "Task created";
    case "task.status_changed":
      return fromStatus && toStatus ? `Status changed from ${fromStatus} to ${toStatus}` : "Status changed";
    case "task.assigned":
      return "Task assigned";
    case "task.unassigned":
      return "Task unassigned";
    case "task.updated":
      return "Task updated";
    case "task.archived":
      return "Task archived";
    case "task.comment_added":
      return "Comment added";
    default:
      return eventType.replace(/^task\./, "").replace(/_/g, " ");
  }
}

function runStatusSummary(status: string): string {
  switch (status) {
    case "queued":
    case "pending":
      return "Run queued";
    case "running":
      return "Run started";
    case "succeeded":
    case "completed":
      return "Run finished successfully";
    case "failed":
      return "Run failed";
    case "cancelled":
      return "Run cancelled";
    case "timed_out":
      return "Run timed out";
    default:
      return `Run ${status}`;
  }
}

function isSuppressedNeverStartedCancellation(
  taskStatus: string,
  run: { status: string; started_at: string | null; error_message: string | null },
): boolean {
  if (run.status !== "cancelled" || run.started_at) return false;
  if (taskStatus !== "done" && taskStatus !== "blocked" && taskStatus !== "cancelled") return false;

  const message = run.error_message?.trim() ?? "";
  return (
    message.includes("execution run was not started") ||
    message.startsWith("Cancelled: task reached a terminal status before this execution run started")
  );
}

function cloneWithoutHeavyTelemetry(value: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...value };
  delete copy.transcriptEvents;
  delete copy.stdoutTail;
  delete copy.stderrTail;
  delete copy.resultText;
  delete copy.assistantSummary;
  delete copy.thinkingSummary;
  delete copy.toolResultSummary;
  return copy;
}

function workspaceRunSummary(value: Record<string, unknown>): {
  changedDuringRunCount: number;
  warningCount: number;
} {
  const visibility = value.workspaceRunVisibility;
  if (!visibility || typeof visibility !== "object" || Array.isArray(visibility)) {
    return { changedDuringRunCount: 0, warningCount: 0 };
  }
  const record = visibility as Record<string, unknown>;
  const totals = record.totals && typeof record.totals === "object" && !Array.isArray(record.totals)
    ? record.totals as Record<string, unknown>
    : {};
  const warnings = Array.isArray(record.warnings) ? record.warnings : [];
  const changed = Number(totals.changedDuringRunCount ?? 0);
  return {
    changedDuringRunCount: Number.isFinite(changed) ? changed : 0,
    warningCount: warnings.length,
  };
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeTaskExecutionEngine(value: unknown): TaskExecutionEngine | null {
  return value === "hiverunner" || value === "symphony" || value === "manual" ? value : null;
}

function normalizeTaskModelLaneValue(value: unknown): TaskModelLane {
  return value === "fast" || value === "mini" || value === "deep" ? value : "default";
}

function providerForResolvedExecution(engine: TaskExecutionEngine | null | undefined, adapterType?: string | null): string | null {
  if (engine === "manual") return "manual";
  if (engine === "symphony") return "symphony";
  return adapterType?.trim() || null;
}

function runtimePolicyValue(metadata: Record<string, unknown>, key: "sandbox" | "approvalPolicy"): string | null {
  const runner = asRecord(metadata.hiverunnerSymphony) ?? asRecord(metadata.runnerConfig);
  const trusted = asRecord(metadata.trustedLocalExecution);
  return asString(runner?.[key]) ?? asString(trusted?.[key]) ?? null;
}

function metadataModel(metadata: Record<string, unknown>, provider: string | null): string | null {
  const runner = asRecord(metadata.hiverunnerSymphony) ?? asRecord(metadata.runnerConfig);
  if (provider === "symphony") {
    return asString(runner?.model) ?? null;
  }
  return asString(metadata.model) ?? asString(metadata.modelId) ?? asString(runner?.model) ?? null;
}

function metadataRunnerProvider(metadata: Record<string, unknown>): string | null {
  const runner = asRecord(metadata.hiverunnerSymphony) ?? asRecord(metadata.runnerConfig);
  return (
    asString(runner?.provider) ??
    asString(runner?.defaultProvider) ??
    asString(metadata.runnerProvider) ??
    asString(metadata.defaultProvider) ??
    null
  );
}

function metadataRunnerModel(metadata: Record<string, unknown>): string | null {
  const runner = asRecord(metadata.hiverunnerSymphony) ?? asRecord(metadata.runnerConfig);
  return (
    asString(runner?.model) ??
    asString(runner?.modelId) ??
    asString(metadata.runnerModel) ??
    asString(metadata.model) ??
    null
  );
}

function usageRuntimePolicyValue(usage: Record<string, unknown>, key: "sandbox" | "approvalPolicy"): string | null {
  const capabilities = asRecord(usage.runtimeCapabilities);
  const runnerEnv = asRecord(usage.runnerEnv);
  if (key === "sandbox") {
    return asString(capabilities?.sandbox) ?? asString(runnerEnv?.HIVERUNNER_SYMPHONY_SANDBOX) ?? null;
  }
  return asString(capabilities?.approvalPolicy) ?? asString(runnerEnv?.HIVERUNNER_SYMPHONY_APPROVAL_POLICY) ?? null;
}

function usageModelValue(usage: Record<string, unknown>): string | null {
  const runnerEnv = asRecord(usage.runnerEnv);
  return (
    asString(usage.model) ??
    asString(usage.modelId) ??
    asString(usage.cliModel) ??
    asString(runnerEnv?.HIVERUNNER_SYMPHONY_MODEL) ??
    null
  );
}

function resolvedExecutionFromUsage(
  run: { provider: string; token_usage_json?: string | null; usage_json?: string | null },
  fallbackEngine?: TaskExecutionEngine | null,
): OrchestrationResolvedExecutionContext {
  const usage = asJson("token_usage_json" in run ? run.token_usage_json : run.usage_json);
  const modelLane = normalizeTaskModelLaneValue(usage.taskModelLane);
  return {
    executionEngine: normalizeTaskExecutionEngine(usage.executionEngine) ?? fallbackEngine ?? null,
    provider: asString(usage.provider) ?? run.provider,
    runnerProvider: asString(usage.runnerProvider),
    runnerModel: asString(usage.runnerModel),
    model: usageModelValue(usage),
    modelLane,
    modelRouting: asString(usage.modelRouting),
    modelRoutingLabel: asString(usage.modelRoutingLabel),
    activeHiveId: asString(usage.activeHiveId),
    activeHiveName: asString(usage.activeHiveName),
    workspaceRoot: asString(usage.workspaceRoot) ?? asString(usage.cwd) ?? null,
    companyWorkspaceRoot: asString(usage.companyWorkspaceRoot),
    sourceWorkspaceRoot: asString(usage.sourceWorkspaceRoot),
    sandbox: usageRuntimePolicyValue(usage, "sandbox"),
    approvalPolicy: usageRuntimePolicyValue(usage, "approvalPolicy"),
    runtimeSlug: asString(usage.runtimeSlug),
    runtimeDisplayName: asString(usage.runtimeDisplayName),
    command: asString(usage.command) ?? asString(usage.cli),
    configSource: asString(usage.configSource) ?? (asString(usage.runtimeSlug) ? "runtime" : "run telemetry"),
    phase: "run",
  };
}

function plannedExecutionContext(input: {
  db: ReturnType<typeof getOrchestrationDb>;
  task: OrchestrationTask;
  taskId: string;
}): OrchestrationResolvedExecutionContext | undefined {
  const row = input.db
    .prepare(
      `SELECT
         COALESCE(t.company_id, p.company_id) AS company_id,
         t.model_lane,
         t.execution_runtime_provider,
         t.execution_runtime_label,
         t.execution_model_routing,
         t.execution_model_routing_label,
         p.settings_json AS project_settings_json,
         c.settings_json AS company_settings_json,
         c.workspace_root AS company_workspace_root,
         a.adapter_type,
         a.model AS agent_model,
         ar.provider AS runtime_provider,
         ar.runtime_slug,
         ar.display_name AS runtime_display_name,
         ar.workspace_root AS runtime_workspace_root,
         ar.command AS runtime_command,
         ar.metadata_json AS runtime_metadata_json
       FROM tasks t
       LEFT JOIN projects p ON p.id = t.project_id
       LEFT JOIN companies c ON c.id = COALESCE(t.company_id, p.company_id)
       LEFT JOIN agents a ON a.id = t.assignee_agent_id
       LEFT JOIN agent_runtimes ar
         ON ar.company_id = COALESCE(t.company_id, p.company_id)
        AND ar.status <> 'disabled'
        AND ar.provider = CASE
          WHEN ? = 'symphony' THEN 'symphony'
          WHEN ? = 'manual' THEN 'manual'
          ELSE COALESCE(a.adapter_type, '')
        END
        AND (ar.agent_id = a.id OR ar.agent_id IS NULL)
       WHERE t.id = ?
       ORDER BY
         CASE WHEN ar.agent_id = a.id THEN 0 ELSE 1 END,
         CASE ar.scope WHEN 'agent' THEN 0 WHEN 'company' THEN 1 ELSE 2 END,
         ar.updated_at DESC
       LIMIT 1`,
    )
    .get(input.task.executionEngine ?? "hiverunner", input.task.executionEngine ?? "hiverunner", input.taskId) as {
      company_id: string | null;
      model_lane: TaskModelLane | null;
      execution_runtime_provider: string | null;
      execution_runtime_label: string | null;
      execution_model_routing: string | null;
      execution_model_routing_label: string | null;
      project_settings_json: string | null;
      company_settings_json: string | null;
      company_workspace_root: string | null;
      adapter_type: string | null;
      agent_model: string | null;
      runtime_provider: string | null;
      runtime_slug: string | null;
      runtime_display_name: string | null;
      runtime_workspace_root: string | null;
      runtime_command: string | null;
      runtime_metadata_json: string | null;
    } | undefined;

  if (!row) return undefined;

  const engine = input.task.executionEngine ?? "hiverunner";
  const provider = providerForResolvedExecution(engine, row.adapter_type);
  const metadata = asJson(row.runtime_metadata_json);
  const matrixRouting = resolveTaskExecutionRouting({
    taskRuntimeProvider: row.execution_runtime_provider,
    taskRuntimeLabel: row.execution_runtime_label,
    taskModelRouting: row.execution_model_routing,
    taskModelRoutingLabel: row.execution_model_routing_label,
    projectSettingsJson: row.project_settings_json,
    companySettingsJson: row.company_settings_json,
  });
  const modelLane = normalizeTaskModelLaneValue(row.model_lane ?? input.task.modelLane);
  const activeHiveRoute = engine !== "manual" && row.company_id
    ? (() => {
        try {
          return resolveExecutionRoute({ companyId: row.company_id!, modelLane }, input.db);
        } catch {
          return null;
        }
      })()
    : null;
  const activeHiveFingerprint = activeHiveRoute
    ? formatLaneFingerprint({
        id: activeHiveRoute.laneId,
        label: activeHiveRoute.laneLabel,
        description: "",
        useFor: [],
        primary: activeHiveRoute.primary.source,
        fallbacks: activeHiveRoute.fallbacks.map((fallback) => fallback.source),
        approvalPolicy: { mode: "none", label: "" },
        verificationStatus: "untested",
        verificationNote: "",
      })
    : null;
  const runnerProvider = activeHiveRoute?.primary.runtimeProvider
    ?? (provider === "symphony" ? matrixRouting.runtimeProvider ?? metadataRunnerProvider(metadata) ?? "codex" : null);
  const runnerModel = activeHiveRoute?.primary.model
    ?? (provider === "symphony" ? metadataRunnerModel(metadata) : null);
  const routing = resolveTaskModelRouting(modelLane);
  const sourceWorkspaceRoot = readProjectSourceWorkspaceRoot(row.project_settings_json);
  const resolvedSourceWorkspaceRoot = sourceWorkspaceRoot ? path.resolve(sourceWorkspaceRoot) : null;
  const workspaceRoot = row.runtime_workspace_root?.trim()
    || resolvedSourceWorkspaceRoot
    || row.company_workspace_root?.trim()
    || null;
  const model = provider === "codex"
    ? routing.model ?? metadataModel(metadata, provider) ?? asString(row.agent_model) ?? null
    : runnerModel ?? metadataModel(metadata, provider) ?? asString(row.agent_model) ?? null;

  return {
    executionEngine: engine,
    provider,
    runnerProvider,
    runnerModel,
    model,
    modelLane,
    laneLabel: activeHiveRoute?.laneLabel ?? null,
    routeFingerprint: activeHiveFingerprint?.full ?? null,
    routeFallbacks: activeHiveFingerprint?.fallbacks ?? [],
    modelRouting: matrixRouting.modelRouting ?? null,
    modelRoutingLabel: matrixRouting.modelRoutingLabel ?? null,
    activeHiveId: activeHiveRoute?.activeHiveId ?? matrixRouting.activeHiveId ?? null,
    activeHiveName: activeHiveRoute?.activeHiveName ?? matrixRouting.activeHiveName ?? null,
    workspaceRoot,
    companyWorkspaceRoot: row.company_workspace_root?.trim() || null,
    sourceWorkspaceRoot: resolvedSourceWorkspaceRoot,
    sandbox: runtimePolicyValue(metadata, "sandbox"),
    approvalPolicy: runtimePolicyValue(metadata, "approvalPolicy"),
    runtimeSlug: row.runtime_slug,
    runtimeDisplayName: row.runtime_display_name,
    command: row.runtime_command,
    configSource: `${input.task.executionEngineSource ?? "global"} engine${matrixRouting.source !== "global" ? ` + ${matrixRouting.source} matrix` : ""}${row.runtime_slug ? " + runtime" : ""}`,
    phase: "planned",
  };
}

function transcriptEventSummary(kind: string, title?: string, body?: string): string {
  const cleanTitle = title?.trim();
  const cleanBody = body?.trim();
  if (cleanTitle && cleanBody && cleanBody.length < 120 && cleanBody !== cleanTitle) {
    return `${cleanTitle}: ${cleanBody}`;
  }
  if (cleanTitle) return cleanTitle;
  if (cleanBody) return cleanBody.length > 180 ? `${cleanBody.slice(0, 177)}...` : cleanBody;
  return kind.replace(/_/g, " ");
}

function transcriptActorLabel(role: string | null | undefined, provider: string, assignee?: string): string {
  if (role === "assistant") return assignee ?? "Agent";
  if (role === "tool") return "Tool";
  if (role === "system") return "System";
  return provider;
}

function normalizeTelemetryTranscriptEvents(
  runId: string,
  provider: string,
  events: unknown,
  fallbackAt: string,
): Array<{
  id: string;
  kind: string;
  role: string | null;
  title?: string;
  body: string;
  metadata: Record<string, unknown>;
  occurredAt: string;
  provider: string;
}> {
  if (!Array.isArray(events)) return [];
  return events.flatMap((event, index) => {
    if (!event || typeof event !== "object" || Array.isArray(event)) return [];
    const record = event as Record<string, unknown>;
    const kind = asString(record.kind) ?? asString(record.eventKind);
    if (!kind) return [];
    return [{
      id: asString(record.id) ?? `${runId}:${index}`,
      kind,
      role: asString(record.role) ?? null,
      title: asString(record.title),
      body: asString(record.body) ?? "",
      metadata: record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
        ? record.metadata as Record<string, unknown>
        : {},
      occurredAt: asString(record.occurredAt) ?? fallbackAt,
      provider,
    }];
  });
}

function synthesizeTelemetryTranscriptEvents(
  runId: string,
  provider: string,
  usage: Record<string, unknown>,
  startedAt: string,
  finishedAt: string,
): Array<{
  id: string;
  kind: string;
  role: string | null;
  title?: string;
  body: string;
  metadata: Record<string, unknown>;
  occurredAt: string;
  provider: string;
}> {
  if (Object.keys(usage).length === 0) return [];
  const events: ReturnType<typeof normalizeTelemetryTranscriptEvents> = [];
  const push = (kind: string, role: string | null, title: string, body: string, occurredAt = finishedAt) => {
    if (!body.trim()) return;
    events.push({
      id: `synthetic:${events.length}`,
      kind,
      role,
      title,
      body,
      metadata: { synthesized: true },
      occurredAt,
      provider,
    });
  };

  push("run_start", "system", `${provider} command`, asString(usage.cli) ?? asString(usage.command) ?? `${provider} execution started`, startedAt);

  const thinking = asString(usage.thinkingSummary);
  if (thinking) push("thinking_summary", "assistant", "thinking", thinking);

  const toolNames = Array.isArray(usage.toolCallNames)
    ? usage.toolCallNames.filter((name): name is string => typeof name === "string" && name.trim().length > 0)
    : [];
  for (const name of toolNames) {
    push("tool_call_start", "tool", name, `${provider} reported tool use: ${name}`);
  }

  const toolResults = asString(usage.toolResultSummary);
  if (toolResults) push("tool_result", "tool", "tool results", toolResults);

  const assistantSummary = asString(usage.assistantSummary) ?? asString(usage.resultText) ?? asString(usage.stdoutTail);
  if (assistantSummary) push("assistant_text_final", "assistant", "assistant", assistantSummary);

  const stderr = asString(usage.stderrTail);
  if (stderr && usage.resultIsError === true) {
    push("error", "tool", "stderr", stderr);
  }

  const duration = typeof usage.durationMs === "number" ? `${(usage.durationMs / 1000).toFixed(1)}s` : "";
  push("run_end", "system", `${provider} completed`, duration ? `${provider} completed in ${duration}.` : `${provider} completed.`, finishedAt);

  return events;
}

function stableSortTimeline(items: OrchestrationTaskTimelineItem[]): OrchestrationTaskTimelineItem[] {
  const rank: Record<string, number> = {
    status_change: 0,
    approval_event: 1,
    run_event: 2,
    engine_event: 3,
    comment: 4,
    imported_report: 5,
    subtask_event: 6,
  };
  return [...items].sort((a, b) => {
    const ts = new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    if (ts !== 0) return ts;
    const byRank = (rank[a.provenance] ?? 99) - (rank[b.provenance] ?? 99);
    if (byRank !== 0) return byRank;
    return a.id.localeCompare(b.id);
  });
}

function childTaskStatusRank(status: string): number {
  switch (status) {
    case "in-progress":
      return 0;
    case "review":
      return 1;
    case "blocked":
      return 2;
    case "to-do":
      return 3;
    case "backlog":
      return 4;
    case "done":
      return 5;
    default:
      return 99;
  }
}

function sortChildTasks(items: OrchestrationTaskDetailSummary[]): OrchestrationTaskDetailSummary[] {
  return [...items].sort((a, b) => {
    const byStatus = childTaskStatusRank(a.status) - childTaskStatusRank(b.status);
    if (byStatus !== 0) return byStatus;
    const byUpdated = new Date(b.updated).getTime() - new Date(a.updated).getTime();
    if (byUpdated !== 0) return byUpdated;
    return a.id.localeCompare(b.id);
  });
}

export function getTaskDetail(taskId: string): { task: OrchestrationTask; detail: OrchestrationTaskDetail } {
  const db = getOrchestrationDb();
  const task = taskById(db, taskId);
  const taskRow = db
    .prepare(`SELECT id, project_id, sprint_id, parent_task_id, assignee_agent_id FROM tasks WHERE id = ? LIMIT 1`)
    .get(task.id) as { id: string; project_id: string; sprint_id: string | null; parent_task_id: string | null; assignee_agent_id: string | null } | undefined;

  if (!taskRow) {
    throw new OrchestrationApiError(404, "task_not_found", "Task not found");
  }

  const timeline: OrchestrationTaskTimelineItem[] = [];

  const comments = db
    .prepare(
      `SELECT c.id, c.body, c.type, c.source, c.external_ref, c.created_at,
              a.name AS author_name, c.author_user_id
        FROM comments c
         LEFT JOIN agents a ON a.id = c.author_agent_id
        WHERE c.task_id = ?
        ORDER BY c.created_at DESC, c.id DESC`
    )
    .all(task.id) as Array<{
    id: string;
    body: string;
    type: string | null;
    source: string | null;
    external_ref: string | null;
    created_at: string;
    author_name: string | null;
    author_user_id: string | null;
  }>;

  for (const comment of comments) {
    if (
      comment.source === "engine" &&
      comment.external_ref?.startsWith("engine:circuit_breaker:") &&
      task.status !== "blocked"
    ) {
      continue;
    }
    const imported = comment.source === "openclaw";
    const voice = comment.source === "voice";
    timeline.push({
      id: `comment:${comment.id}`,
      taskId: task.id,
      timestamp: comment.created_at,
      kind: imported ? "imported_report" : "comment",
      source: comment.source ?? "mission_control",
      actorLabel:
        comment.author_name ??
        comment.author_user_id ??
        (voice ? "Voice Chat" : imported ? "Imported" : "System"),
      summary: imported ? "Imported report" : voice ? "Voice note logged" : "Comment added",
      body: comment.body,
      metadata: {
        commentType: comment.type,
        externalRef: comment.external_ref,
      },
      provenance: imported ? "imported_report" : "comment",
    });
  }

  const taskEvents = db
    .prepare(
      `SELECT te.id, te.event_type, te.from_status, te.to_status, te.metadata_json, te.created_at,
              a.name AS agent_name, te.user_id
         FROM task_events te
         LEFT JOIN agents a ON a.id = te.agent_id
        WHERE te.task_id = ?
          AND te.event_type NOT IN ('task.read_marked', 'task.comment_added', 'task.reordered')
        ORDER BY te.created_at DESC, te.id DESC`
    )
    .all(task.id) as Array<{
    id: string;
    event_type: string;
    from_status: string | null;
    to_status: string | null;
    metadata_json: string | null;
    created_at: string;
    agent_name: string | null;
    user_id: string | null;
  }>;

  for (const event of taskEvents) {
    const provenance = event.event_type === "task.status_changed" ? "status_change" : "engine_event";
    timeline.push({
      id: `task_event:${event.id}`,
      taskId: task.id,
      timestamp: event.created_at,
      kind: provenance,
      source: "task_events",
      actorLabel: event.agent_name ?? event.user_id ?? "System",
      summary: taskEventSummary(event.event_type, event.from_status, event.to_status),
      metadata: {
        eventType: event.event_type,
        fromStatus: event.from_status,
        toStatus: event.to_status,
        ...asJson(event.metadata_json),
      },
      provenance,
    });
  }

  const heartbeatRuns = db
    .prepare(
      `SELECT hb.id, hb.status, hb.invocation_source, hb.trigger_detail, hb.started_at, hb.finished_at, hb.created_at, hb.error,
              hb.wakeup_request_id, hb.result_json, hb.usage_json,
              wr.payload_json, wr.reason,
              COALESCE(hb_agent.adapter_type, 'unknown') AS provider
         FROM heartbeat_runs hb
         LEFT JOIN agent_wakeup_requests wr ON wr.id = hb.wakeup_request_id
         LEFT JOIN agents hb_agent ON hb_agent.id = hb.agent_id
        WHERE hb.company_id = (SELECT p.company_id FROM projects p WHERE p.id = ?)
          AND (
            json_extract(wr.payload_json, '$.taskId') = ?
            OR json_extract(hb.context_snapshot_json, '$.taskId') = ?
          )
        ORDER BY COALESCE(hb.started_at, hb.created_at) DESC, hb.created_at DESC`
    )
    .all(taskRow.project_id, task.id, task.id) as Array<{
    id: string;
    status: string;
    invocation_source: string | null;
    trigger_detail: string | null;
    started_at: string | null;
    finished_at: string | null;
    created_at: string;
    error: string | null;
    wakeup_request_id: string | null;
    result_json: string | null;
    usage_json: string | null;
    payload_json: string | null;
    reason: string | null;
    provider: string;
  }>;

  const executionRunRows = db
    .prepare(
      `SELECT er.id, er.provider, er.execution_engine, er.runner_provider, er.runner_model,
              er.model_lane, er.fallback_used, er.fallback_index, er.fallback_from_provider,
              er.route_attempts_json,
              er.status, er.session_id, er.started_at, er.completed_at, er.error_message,
              er.created_at, er.token_usage_json
         FROM execution_runs er
        WHERE er.task_id = ?
        ORDER BY COALESCE(er.started_at, er.created_at) DESC, er.created_at DESC`
    )
    .all(task.id) as Array<{
    id: string;
    provider: string;
    execution_engine: string | null;
    runner_provider: string | null;
    runner_model: string | null;
    model_lane: string | null;
    fallback_used: number | null;
    fallback_index: number | null;
    fallback_from_provider: string | null;
    route_attempts_json: string | null;
    status: string;
    session_id: string | null;
    started_at: string | null;
    completed_at: string | null;
    error_message: string | null;
    created_at: string;
    token_usage_json: string | null;
  }>;
  const executionRuns = executionRunRows.filter((run) => !isSuppressedNeverStartedCancellation(task.status, run));

  const heartbeatRunIds = new Set(heartbeatRuns.map((run) => run.id));
  for (const run of heartbeatRuns) {
    timeline.push({
      id: `heartbeat_run:${run.id}`,
      taskId: task.id,
      timestamp: run.started_at ?? run.created_at,
      kind: "run_event",
      source: "heartbeat_runs",
      actorLabel: task.assignee ?? "Assigned agent",
      summary: runStatusSummary(run.status),
      metadata: {
        runTable: "heartbeat_runs",
        status: run.status,
        invocationSource: run.invocation_source,
        triggerDetail: run.trigger_detail,
        wakeReason: run.reason,
        provider: run.provider,
        finishedAt: run.finished_at,
        error: run.error,
        result: asJson(run.result_json),
        usage: asJson(run.usage_json),
      },
      linkedRunId: run.id,
      provenance: "run_event",
    });
  }

  for (const run of executionRuns) {
    const usage = asJson(run.token_usage_json);
    timeline.push({
      id: `execution_run:${run.id}`,
      taskId: task.id,
      timestamp: run.started_at ?? run.created_at,
      kind: "run_event",
      source: "execution_runs",
      actorLabel: task.assignee ?? "Assigned agent",
      summary: runStatusSummary(run.status),
      metadata: {
        runTable: "execution_runs",
        provider: run.provider,
        executionEngine: run.execution_engine ?? stringFrom(usage.executionEngine),
        runnerProvider: run.runner_provider ?? stringFrom(usage.runnerProvider),
        runnerModel: run.runner_model ?? stringFrom(usage.runnerModel),
        status: run.status,
        sessionId: run.session_id,
        finishedAt: run.completed_at,
        error: run.error_message,
        usage: cloneWithoutHeavyTelemetry(usage),
      },
      linkedRunId: run.id,
      provenance: "run_event",
    });

    const persistedTranscript = listExecutionTranscriptEvents(db, run.id).map((event) => ({
      id: event.id,
      kind: event.kind,
      role: event.role,
      title: event.title ?? undefined,
      body: event.body,
      metadata: event.metadata,
      occurredAt: event.occurredAt,
      provider: event.provider,
    }));
    const telemetryTranscript =
      persistedTranscript.length > 0
        ? []
        : normalizeTelemetryTranscriptEvents(
            run.id,
            run.provider,
            usage.transcriptEvents,
            run.completed_at ?? run.started_at ?? run.created_at,
          );
    const synthesizedTranscript =
      persistedTranscript.length > 0 || telemetryTranscript.length > 0
        ? []
        : synthesizeTelemetryTranscriptEvents(
            run.id,
            run.provider,
            usage,
            run.started_at ?? run.created_at,
            run.completed_at ?? run.started_at ?? run.created_at,
          );
    const transcriptEvents = persistedTranscript.length > 0
      ? persistedTranscript
      : telemetryTranscript.length > 0
        ? telemetryTranscript
        : synthesizedTranscript;

    for (const [index, event] of transcriptEvents.entries()) {
      const body = event.body.trim();
      timeline.push({
        id: `execution_transcript:${run.id}:${event.id || index}`,
        taskId: task.id,
        timestamp: event.occurredAt,
        kind: "run_event",
        source: persistedTranscript.length > 0 ? "execution_run_transcript_events" : "execution_run_structured_telemetry",
        actorLabel: transcriptActorLabel(event.role, event.provider, task.assignee),
        summary: transcriptEventSummary(event.kind, event.title, body),
        body,
        metadata: {
          eventType: event.kind,
          role: event.role,
          provider: event.provider,
          title: event.title,
          ...event.metadata,
        },
        linkedRunId: run.id,
        provenance: "run_event",
      });
    }
  }

  if (heartbeatRunIds.size > 0) {
    const placeholders = Array.from(heartbeatRunIds).map(() => "?").join(",");
    const runEvents = db
      .prepare(
        `SELECT hre.id, hre.run_id, hre.event_type, hre.detail, hre.created_at
           FROM heartbeat_run_events hre
          WHERE hre.run_id IN (${placeholders})
          ORDER BY hre.created_at DESC, hre.id DESC`
      )
      .all(...Array.from(heartbeatRunIds)) as Array<{
      id: string;
      run_id: string;
      event_type: string;
      detail: string;
      created_at: string;
    }>;

    for (const event of runEvents) {
      timeline.push({
        id: `heartbeat_run_event:${event.id}`,
        taskId: task.id,
        timestamp: event.created_at,
        kind: "run_event",
        source: "heartbeat_run_events",
        actorLabel: task.assignee ?? "Assigned agent",
        summary: event.event_type.replace(/_/g, " "),
        body: event.detail,
        metadata: {
          eventType: event.event_type,
        },
        linkedRunId: event.run_id,
        provenance: "run_event",
      });
    }
  }

  const approvals = db
    .prepare(
      `SELECT a.id, a.type, a.status, a.created_at, a.updated_at, a.decision_note,
              ag.name AS requested_by_name
         FROM approvals a
         LEFT JOIN agents ag ON ag.id = a.requested_by_agent_id
        WHERE a.linked_task_id = ?
        ORDER BY a.created_at DESC, a.id DESC`
    )
    .all(task.id) as Array<{
    id: string;
    type: string;
    status: string;
    created_at: string;
    updated_at: string;
    decision_note: string | null;
    requested_by_name: string | null;
  }>;

  for (const approval of approvals) {
    timeline.push({
      id: `approval:${approval.id}`,
      taskId: task.id,
      timestamp: approval.updated_at ?? approval.created_at,
      kind: "approval_event",
      source: "approvals",
      actorLabel: approval.requested_by_name ?? "Approval system",
      summary: `Approval ${approval.status}`,
      body: approval.decision_note ?? undefined,
      metadata: {
        approvalType: approval.type,
        status: approval.status,
      },
      linkedApprovalId: approval.id,
      provenance: "approval_event",
    });
  }

  const childRows = db
    .prepare(
      `SELECT id, task_key FROM tasks WHERE parent_task_id = ? AND archived_at IS NULL ORDER BY updated_at DESC, created_at DESC`
    )
    .all(task.id) as Array<{ id: string; task_key: string | null }>;
  const childTasks = sortChildTasks(childRows.map((row) => asSummary(taskById(db, row.id))));

  for (const child of childTasks) {
    timeline.push({
      id: `subtask:${child.id}`,
      taskId: task.id,
      timestamp: child.updated,
      kind: "subtask_event",
      source: "tasks",
      summary: `Subtask ${child.key ?? child.id} is ${child.status}`,
      metadata: {
        title: child.title,
        priority: child.priority,
        type: child.type,
      },
      linkedTaskId: child.id,
      provenance: "subtask_event",
    });
  }

  const parentTask = taskRow.parent_task_id ? asSummary(taskById(db, taskRow.parent_task_id)) : undefined;
  const planningContext = taskRow.sprint_id
    ? db
        .prepare(
          `SELECT
             s.id AS sprint_id,
             s.name AS sprint_name,
             s.status AS sprint_status,
             parent_s.id AS company_goal_id,
             parent_s.name AS company_goal_name,
             parent_s.status AS company_goal_status
           FROM sprints s
           LEFT JOIN sprints parent_s ON parent_s.id = s.parent_id
           WHERE s.id = ?
           LIMIT 1`
        )
        .get(taskRow.sprint_id) as {
          sprint_id: string;
          sprint_name: string;
          sprint_status: "planning" | "active" | "completed";
          company_goal_id: string | null;
          company_goal_name: string | null;
          company_goal_status: "planning" | "active" | "completed" | null;
        } | undefined
    : undefined;
  const plannedExecution = plannedExecutionContext({ db, task, taskId: task.id });

  const userFacingRuns = executionRuns.length > 0 ? executionRuns : heartbeatRuns;
  const activeRun = userFacingRuns.find((run) => run.status === "running" || run.status === "queued" || run.status === "pending");
  const latestRun = userFacingRuns[0];
  const heartbeatRunEventCount = heartbeatRunIds.size
    ? Number(
        (db
          .prepare(`SELECT COUNT(*) as count FROM heartbeat_run_events WHERE run_id IN (${Array.from(heartbeatRunIds).map(() => "?").join(",")})`)
          .get(...Array.from(heartbeatRunIds)) as { count: number } | undefined)?.count ?? 0
      )
    : 0;
  const executionTranscriptCount = executionRuns.reduce((total, run) => {
    const persistedCount = listExecutionTranscriptEvents(db, run.id).length;
    if (persistedCount > 0) return total + persistedCount;
    const usage = asJson(run.token_usage_json);
    const telemetryCount = normalizeTelemetryTranscriptEvents(
      run.id,
      run.provider,
      usage.transcriptEvents,
      run.completed_at ?? run.started_at ?? run.created_at,
    ).length;
    if (telemetryCount > 0) return total + telemetryCount;
    return total + synthesizeTelemetryTranscriptEvents(
      run.id,
      run.provider,
      usage,
      run.started_at ?? run.created_at,
      run.completed_at ?? run.started_at ?? run.created_at,
    ).length;
  }, 0);
  const importedReportCount = comments.filter((comment) => comment.source === "openclaw").length;

  const runSummary: OrchestrationTaskRunSummary = {
    totalRuns: userFacingRuns.length,
    structuredActionCount: heartbeatRunEventCount + executionTranscriptCount,
    importedReportCount,
    usageTotals: runUsageTotals(userFacingRuns),
    latestRun: latestRun
      ? {
          ...(() => {
            const usage = asJson("token_usage_json" in latestRun ? latestRun.token_usage_json : latestRun.usage_json);
            const workspace = workspaceRunSummary(usage);
            return {
              workspaceChangedDuringRunCount: workspace.changedDuringRunCount,
              workspaceWarningCount: workspace.warningCount,
            };
          })(),
          id: latestRun.id,
          provider: latestRun.provider,
          executionEngine: "execution_engine" in latestRun
            ? latestRun.execution_engine ?? stringFrom(asJson(latestRun.token_usage_json).executionEngine)
            : null,
          runnerProvider: "runner_provider" in latestRun
            ? latestRun.runner_provider ?? stringFrom(asJson(latestRun.token_usage_json).runnerProvider)
            : null,
          runnerModel: "runner_model" in latestRun
            ? latestRun.runner_model ?? stringFrom(asJson(latestRun.token_usage_json).runnerModel)
            : null,
          fallbackUsed: "fallback_used" in latestRun ? latestRun.fallback_used === 1 : false,
          fallbackIndex: "fallback_index" in latestRun ? latestRun.fallback_index : null,
          fallbackFromProvider: "fallback_from_provider" in latestRun ? latestRun.fallback_from_provider : null,
          routeAttempts: "route_attempts_json" in latestRun ? parseJsonArray(latestRun.route_attempts_json) : [],
          status: latestRun.status,
          startedAt: latestRun.started_at ?? latestRun.created_at,
          finishedAt: "completed_at" in latestRun ? latestRun.completed_at : latestRun.finished_at,
          error: "error_message" in latestRun ? latestRun.error_message : latestRun.error,
          resolvedExecution: resolvedExecutionFromUsage(latestRun, task.executionEngine ?? null),
        }
      : undefined,
    activeRun: activeRun
      ? {
          ...(() => {
            const usage = asJson("token_usage_json" in activeRun ? activeRun.token_usage_json : activeRun.usage_json);
            const workspace = workspaceRunSummary(usage);
            return {
              workspaceChangedDuringRunCount: workspace.changedDuringRunCount,
              workspaceWarningCount: workspace.warningCount,
            };
          })(),
          id: activeRun.id,
          provider: activeRun.provider,
          executionEngine: "execution_engine" in activeRun
            ? activeRun.execution_engine ?? stringFrom(asJson(activeRun.token_usage_json).executionEngine)
            : null,
          runnerProvider: "runner_provider" in activeRun
            ? activeRun.runner_provider ?? stringFrom(asJson(activeRun.token_usage_json).runnerProvider)
            : null,
          runnerModel: "runner_model" in activeRun
            ? activeRun.runner_model ?? stringFrom(asJson(activeRun.token_usage_json).runnerModel)
            : null,
          fallbackUsed: "fallback_used" in activeRun ? activeRun.fallback_used === 1 : false,
          fallbackIndex: "fallback_index" in activeRun ? activeRun.fallback_index : null,
          fallbackFromProvider: "fallback_from_provider" in activeRun ? activeRun.fallback_from_provider : null,
          routeAttempts: "route_attempts_json" in activeRun ? parseJsonArray(activeRun.route_attempts_json) : [],
          status: activeRun.status,
          startedAt: activeRun.started_at ?? activeRun.created_at,
          finishedAt: "completed_at" in activeRun ? activeRun.completed_at : activeRun.finished_at,
          error: "error_message" in activeRun ? activeRun.error_message : activeRun.error,
          resolvedExecution: resolvedExecutionFromUsage(activeRun, task.executionEngine ?? null),
        }
      : undefined,
  };

  return {
    task,
    detail: {
      task: asSummary(task),
      parentTask,
      childTasks,
      timeline: stableSortTimeline(timeline),
      runSummary,
      plannedExecution,
      sprintId: planningContext?.sprint_id,
      sprintName: planningContext?.sprint_name,
      sprintStatus: planningContext?.sprint_status === "completed" ? "done" : planningContext?.sprint_status === "active" ? "active" : planningContext ? "planned" : undefined,
      companyGoalId: planningContext?.company_goal_id ?? undefined,
      companyGoalName: planningContext?.company_goal_name ?? undefined,
      companyGoalStatus: planningContext?.company_goal_status === "completed" ? "done" : planningContext?.company_goal_status === "active" ? "active" : planningContext?.company_goal_status ? "planned" : undefined,
    },
  };
}
