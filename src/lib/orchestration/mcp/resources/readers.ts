import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";

import {
  assertRedactedSnapshot,
  listEvalCases,
} from "@/lib/orchestration/eval-cases";
import {
  getExperimentComparisonReport,
  listExperimentComparisonReports,
  listExperimentReportEvidenceForEvalCase,
  listExperimentReportEvidenceForRun,
} from "@/lib/orchestration/experiment-reports";
import {
  getImproveRecommendation,
  listImproveRecommendations,
} from "@/lib/orchestration/improvement-recommendations";
import type { McpRequestContext } from "@/lib/orchestration/mcp/context";
import {
  type HiveRunnerMcpPublicResourceName,
  normalizeMcpCompanyCode,
} from "@/lib/orchestration/mcp/registry";
import {
  buildCanonicalEvalCasePath,
  buildCanonicalEvalsPath,
  buildCanonicalGoalPath,
  buildCanonicalGoalsPath,
  buildCanonicalImprovePath,
  buildCanonicalRunTracePath,
  buildCanonicalTaskRunTracePath,
  buildCanonicalTasksPath,
  buildCanonicalTeamPath,
} from "@/lib/orchestration/route-paths";
import {
  assertNoRunTraceCredentialLeak,
  buildRedactedRunTraceExport,
  buildRunTraceViewModel,
  redactRunTracePayload,
  type RunTraceEvidenceInput,
  type RunTraceRedactedExport,
} from "@/lib/orchestration/run-trace";
import { listExecutionTranscriptEvents } from "@/lib/orchestration/service/execution-transcript";
import {
  getBuiltInStarterSprintTemplate,
  listBuiltInStarterSprintTemplates,
} from "@/lib/orchestration/starter-sprint-templates";

type ReadInput = {
  uri: string;
  definitionName: HiveRunnerMcpPublicResourceName;
  context: McpRequestContext;
};

type SprintRow = {
  id: string;
  sprint_key: string | null;
  goal_key: string | null;
  name: string;
  goal: string;
  status: string;
  parent_id: string | null;
  owner: string | null;
  lead_agent_id: string | null;
  lead_agent_name: string | null;
  project_id: string;
  project_slug: string;
  project_name: string;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  updated_at: string;
  task_count: number;
  done_count: number;
};

type TaskResourceRow = {
  id: string;
  task_key: string | null;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  type: string;
  project_id: string | null;
  project_slug: string | null;
  project_name: string | null;
  sprint_id: string | null;
  sprint_key: string | null;
  sprint_name: string | null;
  assignee_agent_id: string | null;
  assignee_name: string | null;
  labels_json: string | null;
  depends_on_json: string | null;
  blocked_reason: string | null;
  execution_engine: string | null;
  model_lane: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

type AgentResourceRow = {
  id: string;
  slug: string | null;
  name: string;
  role: string;
  status: string;
  model: string | null;
  adapter_type: string | null;
  runtime_slug: string | null;
  current_task_id: string | null;
  current_task_title: string | null;
  tasks_completed: number | null;
  total_runtime_minutes: number | null;
  last_heartbeat: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

type ExecutionRunResourceRow = {
  id: string;
  task_id: string | null;
  agent_id: string | null;
  provider: string;
  execution_engine: string | null;
  runner_provider: string | null;
  runner_model: string | null;
  model_lane: string | null;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  token_usage_json: string | null;
  duration_ms: number | null;
  created_at: string;
  company_id: string | null;
  task_key: string | null;
  task_title: string | null;
  task_status: string | null;
  task_priority: string | null;
  agent_name: string | null;
};

function jsonResource(uri: string, payload: unknown): ReadResourceResult {
  return {
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw?.trim()) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function companyPayload(context: McpRequestContext) {
  return {
    id: context.companyId,
    slug: context.companySlug,
    code: context.companyCode,
    name: context.companyName,
  };
}

function mcpRoot(context: McpRequestContext): string {
  return `hiverunner://${encodeURIComponent(normalizeMcpCompanyCode(context.companyCode))}`;
}

function uriTail(uri: string, context: McpRequestContext, prefix: string): string {
  const fullPrefix = `${mcpRoot(context)}${prefix}`;
  if (!uri.startsWith(fullPrefix)) {
    throw new Error(`resource_not_found: ${uri}`);
  }
  const value = uri.slice(fullPrefix.length);
  if (!value.trim()) {
    throw new Error(`resource_parameter_missing: ${uri}`);
  }
  return decodeURIComponent(value);
}

function taskLink(context: McpRequestContext, taskKey: string | null): string | null {
  return taskKey ? `${buildCanonicalTasksPath(context.companyCode)}/${encodeURIComponent(taskKey)}` : null;
}

function mapTaskRow(context: McpRequestContext, row: TaskResourceRow) {
  const key = row.task_key ?? row.id;
  return {
    id: row.id,
    key,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    type: row.type,
    project: row.project_id
      ? {
          id: row.project_id,
          slug: row.project_slug,
          name: row.project_name,
        }
      : null,
    sprint: row.sprint_id
      ? {
          id: row.sprint_id,
          key: row.sprint_key,
          name: row.sprint_name,
        }
      : null,
    assignee: row.assignee_agent_id
      ? {
          id: row.assignee_agent_id,
          name: row.assignee_name,
        }
      : null,
    tags: parseJson<string[]>(row.labels_json, []),
    dependencies: parseJson<string[]>(row.depends_on_json, []),
    blockedReason: row.blocked_reason,
    execution: {
      engine: row.execution_engine,
      modelLane: row.model_lane ?? "default",
    },
    timestamps: {
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
    },
    links: {
      task: taskLink(context, key),
    },
  };
}

function listGoals(uri: string, context: McpRequestContext): ReadResourceResult {
  const rows = context.db
    .prepare(
      `SELECT
        s.id,
        s.sprint_key,
        s.goal_key,
        s.name,
        s.goal,
        s.status,
        s.parent_id,
        s.owner,
        s.lead_agent_id,
        lead.name AS lead_agent_name,
        s.project_id,
        p.slug AS project_slug,
        p.name AS project_name,
        s.start_date,
        s.end_date,
        s.created_at,
        s.updated_at,
        COUNT(t.id) AS task_count,
        SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS done_count
       FROM sprints s
       INNER JOIN projects p ON p.id = s.project_id
       LEFT JOIN agents lead ON lead.id = s.lead_agent_id
       LEFT JOIN tasks t ON t.sprint_id = s.id AND t.archived_at IS NULL
       WHERE p.company_id = ?
         AND p.archived_at IS NULL
         AND s.archived_at IS NULL
       GROUP BY s.id
       ORDER BY
        CASE s.status WHEN 'active' THEN 0 WHEN 'planning' THEN 1 ELSE 2 END,
        s.updated_at DESC
       LIMIT 200`,
    )
    .all(context.companyId) as SprintRow[];

  return jsonResource(uri, {
    schema: "mcp.goals.v1",
    company: companyPayload(context),
    count: rows.length,
    goals: rows.map((row) => {
      const key = row.goal_key ?? row.sprint_key ?? row.id;
      return {
        id: row.id,
        key,
        sprintKey: row.sprint_key,
        name: row.name,
        objective: row.goal,
        status: row.status,
        parentId: row.parent_id,
        owner: row.owner,
        leadAgent: row.lead_agent_id
          ? { id: row.lead_agent_id, name: row.lead_agent_name }
          : null,
        project: {
          id: row.project_id,
          slug: row.project_slug,
          name: row.project_name,
        },
        dates: {
          start: row.start_date,
          end: row.end_date,
        },
        progress: {
          totalTasks: Number(row.task_count ?? 0),
          doneTasks: Number(row.done_count ?? 0),
        },
        timestamps: {
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        },
        links: {
          goal: buildCanonicalGoalPath(context.companyCode, key),
        },
      };
    }),
    links: {
      goals: buildCanonicalGoalsPath(context.companyCode),
    },
  });
}

function queryTasks(context: McpRequestContext, whereSql: string, args: unknown[], limit = 50): TaskResourceRow[] {
  return context.db
    .prepare(
      `SELECT
        t.id,
        t.task_key,
        t.title,
        t.description,
        t.status,
        t.priority,
        t.type,
        t.project_id,
        p.slug AS project_slug,
        p.name AS project_name,
        t.sprint_id,
        s.sprint_key,
        s.name AS sprint_name,
        t.assignee_agent_id,
        a.name AS assignee_name,
        t.labels_json,
        t.depends_on_json,
        t.blocked_reason,
        t.execution_engine,
        COALESCE(t.model_lane, 'default') AS model_lane,
        t.created_at,
        t.updated_at,
        t.completed_at
       FROM tasks t
       LEFT JOIN projects p ON p.id = t.project_id
       LEFT JOIN sprints s ON s.id = t.sprint_id
       LEFT JOIN agents a ON a.id = t.assignee_agent_id
       WHERE ${whereSql}
       ORDER BY t.updated_at DESC, t.created_at DESC, t.id ASC
       LIMIT ?`,
    )
    .all(...args, limit) as TaskResourceRow[];
}

function listTasks(uri: string, context: McpRequestContext): ReadResourceResult {
  const tasks = queryTasks(
    context,
    `COALESCE(t.company_id, p.company_id) = ?
       AND t.archived_at IS NULL
       AND (p.id IS NULL OR p.archived_at IS NULL)`,
    [context.companyId],
  );

  return jsonResource(uri, {
    schema: "mcp.tasks.v1",
    company: companyPayload(context),
    count: tasks.length,
    tasks: tasks.map((row) => mapTaskRow(context, row)),
    links: {
      tasks: buildCanonicalTasksPath(context.companyCode),
    },
  });
}

function readTask(uri: string, context: McpRequestContext): ReadResourceResult {
  const taskKey = uriTail(uri, context, "/tasks/");
  const rows = queryTasks(
    context,
    `COALESCE(t.company_id, p.company_id) = ?
       AND (t.id = ? OR t.task_key = ?)
       AND t.archived_at IS NULL
       AND (p.id IS NULL OR p.archived_at IS NULL)`,
    [context.companyId, taskKey, taskKey],
    1,
  );
  const task = rows[0];
  if (!task) throw new Error(`task_not_found: ${taskKey}`);

  const comments = context.db
    .prepare(
      `SELECT c.id, c.body, c.type, c.source, c.created_at, COALESCE(a.name, c.author_user_id) AS author
       FROM comments c
       LEFT JOIN agents a ON a.id = c.author_agent_id
       WHERE c.task_id = ?
       ORDER BY c.created_at ASC
       LIMIT 50`,
    )
    .all(task.id) as Array<{
      id: string;
      body: string;
      type: string | null;
      source: string | null;
      created_at: string;
      author: string | null;
    }>;

  return jsonResource(uri, {
    schema: "mcp.task.v1",
    company: companyPayload(context),
    task: {
      ...mapTaskRow(context, task),
      comments: comments.map((comment) => ({
        id: comment.id,
        body: comment.body,
        type: comment.type,
        source: comment.source,
        author: comment.author ?? "System",
        createdAt: comment.created_at,
      })),
    },
  });
}

function buildRunEvidence(context: McpRequestContext, runId: string): RunTraceEvidenceInput {
  const row = context.db
    .prepare(
      `SELECT
        r.id,
        r.task_id,
        r.agent_id,
        r.provider,
        r.execution_engine,
        r.runner_provider,
        r.runner_model,
        r.model_lane,
        r.status,
        r.started_at,
        r.completed_at,
        r.error_message,
        r.token_usage_json,
        r.duration_ms,
        r.created_at,
        COALESCE(t.company_id, p.company_id, a.company_id) AS company_id,
        t.task_key,
        t.title AS task_title,
        t.status AS task_status,
        t.priority AS task_priority,
        a.name AS agent_name
       FROM execution_runs r
       LEFT JOIN tasks t ON t.id = r.task_id
       LEFT JOIN projects p ON p.id = t.project_id
       LEFT JOIN agents a ON a.id = r.agent_id
       WHERE r.id = ?
       LIMIT 1`,
    )
    .get(runId) as ExecutionRunResourceRow | undefined;
  if (!row || row.company_id !== context.companyId) {
    throw new Error(`run_not_found: ${runId}`);
  }

  const usage = parseJson<Record<string, unknown>>(row.token_usage_json, {});
  const transcriptEvents = listExecutionTranscriptEvents(context.db, row.id);
  const timeline = transcriptEvents.map((event) => ({
    id: event.id,
    kind: event.kind,
    summary: event.title
      ? `${event.title}${event.body ? `: ${event.body.slice(0, 260)}` : ""}`
      : event.body.slice(0, 300),
    ts: new Date(event.occurredAt).getTime(),
    source: "execution_transcript",
    providerEventType: event.kind,
    commentSource: event.provider,
    commentType: event.role ?? event.kind,
    authorName: event.role === "assistant" ? row.agent_name : event.provider,
    metadata: event.metadata,
  }));

  return {
    run: {
      id: row.id,
      status: row.status === "completed" ? "succeeded" : row.status,
      providerId: row.provider,
      invocationSource: row.provider,
      startedAt: row.started_at,
      finishedAt: row.completed_at,
      durationMs: row.duration_ms,
      usage,
      error: row.error_message,
    },
    task: row.task_id
      ? {
          id: row.task_id,
          key: row.task_key,
          title: row.task_title,
          status: row.task_status,
          priority: row.task_priority,
        }
      : null,
    provider: {
      id: row.runner_provider ?? row.provider,
      displayName: row.runner_provider ?? row.provider,
    },
    metrics: {
      durationMs: row.duration_ms,
      inputTokens: numberValue(usage.inputTokens),
      outputTokens: numberValue(usage.outputTokens),
      cacheReadInputTokens: numberValue(usage.cacheReadInputTokens),
      cacheCreationInputTokens: numberValue(usage.cacheCreationInputTokens),
      totalCostUsd: numberValue(usage.totalCostUsd),
    },
    transcript: {
      entries: transcriptEvents.map((event) => ({
        id: event.id,
        body: event.body,
        type: event.kind,
        source: event.provider,
        authorName: event.role === "assistant" ? row.agent_name : event.provider,
        ts: new Date(event.occurredAt).getTime(),
        eventKind: event.kind,
        role: event.role,
        title: event.title,
        metadata: event.metadata,
      })),
      provenance: {
        label: "Provider transcript events",
        note: "MCP exposes the same normalized transcript events used by Run Trace; raw provider payloads are not emitted.",
        totalEntries: transcriptEvents.length,
        source: "execution_run_transcript_events",
        fullTranscriptAvailable: transcriptEvents.length > 0,
      },
    },
    timeline,
    providerExecution: {
      source: stringValue(usage.source),
      structuredTelemetry: usage.structuredTelemetry === true,
      observedLiveText: usage.observedLiveText === true,
      observedThinking: usage.observedThinking === true,
      observedStructuredTools: usage.observedStructuredTools === true,
      assistantSummary: stringValue(usage.assistantSummary),
      thinkingSummary: stringValue(usage.thinkingSummary),
      note: "Read through the HiveRunner MCP redacted trace resource.",
    },
    template: null,
    provenance: {
      timeline: {
        label: "Provider transcript events",
        note: "Timeline is reconstructed from normalized execution transcript events.",
        sources: ["execution_runs", "execution_run_transcript_events"],
      },
      runTable: "execution_runs",
    },
  };
}

function readTrace(uri: string, context: McpRequestContext, exportSnapshot: boolean): ReadResourceResult {
  const runId = uriTail(uri, context, "/runs/").replace(/\/trace(?:\/export)?$/, "");
  if (!runId || runId.includes("/")) throw new Error(`run_not_found: ${runId}`);
  const evidence = buildRunEvidence(context, runId);
  const experimentReports = listExperimentReportEvidenceForRun(context.companyId, runId, context.db);
  const links = {
    runTrace: buildCanonicalRunTracePath(context.companyCode, runId),
    taskRunTrace: evidence.task?.key
      ? buildCanonicalTaskRunTracePath(context.companyCode, evidence.task.key, runId)
      : null,
  };
  if (exportSnapshot) {
    const snapshot = buildRedactedRunTraceExport(evidence);
    assertRedactedSnapshot(snapshot, JSON.stringify(snapshot));
    return jsonResource(uri, { ...snapshot, links });
  }

  // The view-model resource is an MCP export too: run it through the same Run
  // Trace redaction policy so secret-pattern fixtures never leak through the
  // non-snapshot read path. The redaction summary carries category counts that
  // match the export, and structure-preserving redaction keeps evidence gaps
  // identical to the underlying view model.
  const { value: redactedView, redaction } = redactRunTracePayload(buildRunTraceViewModel(evidence));
  assertNoRunTraceCredentialLeak(redactedView, "MCP trace view");
  return jsonResource(uri, { ...redactedView, redaction, links, experimentReports });
}

function listEvals(uri: string, context: McpRequestContext): ReadResourceResult {
  const result = listEvalCases(context.companyId, { limit: 50 }, context.db);
  return jsonResource(uri, {
    schema: "mcp.eval_cases.v1",
    company: companyPayload(context),
    total: result.total,
    cases: result.cases,
    facets: result.facets,
    links: {
      evals: buildCanonicalEvalsPath(context.companyCode),
    },
  });
}

function readEval(uri: string, context: McpRequestContext): ReadResourceResult {
  const evalCaseId = uriTail(uri, context, "/eval-cases/");
  const row = context.db
    .prepare(
      `SELECT *
       FROM eval_cases
       WHERE id = ?
         AND company_id = ?
       LIMIT 1`,
    )
    .get(evalCaseId, context.companyId) as Record<string, unknown> | undefined;
  if (!row) throw new Error(`eval_case_not_found: ${evalCaseId}`);

  const rawSnapshot = String(row.redacted_snapshot_json ?? "{}");
  const redactedSnapshot = parseJson<RunTraceRedactedExport>(rawSnapshot, {} as RunTraceRedactedExport);
  assertRedactedSnapshot(redactedSnapshot, rawSnapshot);

  return jsonResource(uri, {
    schema: "mcp.eval_case.v1",
    company: companyPayload(context),
    evalCase: {
      id: row.id,
      sourceTask: {
        id: row.source_task_id,
        key: row.source_task_key,
        title: row.source_task_title,
        type: row.source_task_type,
      },
      sourceRun: {
        id: row.source_run_id,
        traceRoute: row.trace_route,
      },
      review: {
        outcome: row.review_outcome,
        rationale: row.reviewer_rationale,
        notes: row.reviewer_notes,
        reviewerAgentId: row.reviewer_agent_id,
        reviewerName: row.reviewer_name,
        reviewedAt: row.reviewed_at,
      },
      captureQuality: row.capture_quality,
      evidenceGaps: parseJson(String(row.evidence_gaps_json ?? "[]"), []),
      redactedSnapshot,
      snapshotSha256: row.snapshot_sha256,
      version: row.version,
      createdAt: row.created_at,
      experimentReports: listExperimentReportEvidenceForEvalCase(context.companyId, evalCaseId, context.db),
    },
    links: {
      evalCase: buildCanonicalEvalCasePath(context.companyCode, evalCaseId),
      evals: buildCanonicalEvalsPath(context.companyCode),
    },
  });
}

function listExperimentReports(uri: string, context: McpRequestContext): ReadResourceResult {
  const reports = listExperimentComparisonReports(context.companyId, { limit: 50 }, context.db);
  return jsonResource(uri, {
    schema: "mcp.experiment_reports.v1",
    company: companyPayload(context),
    total: reports.length,
    reports,
    links: {
      improve: buildCanonicalImprovePath(context.companyCode, { surface: "experiments" }),
    },
  });
}

function readExperimentReport(uri: string, context: McpRequestContext): ReadResourceResult {
  const reportId = uriTail(uri, context, "/experiment-reports/");
  const report = getExperimentComparisonReport(context.companyId, reportId, context.db);
  if (!report) throw new Error(`experiment_report_not_found: ${reportId}`);
  return jsonResource(uri, {
    schema: "mcp.experiment_report.v1",
    company: companyPayload(context),
    report,
    links: {
      report: report.href,
    },
  });
}

function listImprove(uri: string, context: McpRequestContext): ReadResourceResult {
  const result = listImproveRecommendations(context.companyId, { limit: 50 }, context.db);
  return jsonResource(uri, {
    schema: "mcp.improve.v1",
    company: companyPayload(context),
    total: result.total,
    recommendations: result.recommendations,
    groups: result.groups,
    links: {
      improve: buildCanonicalImprovePath(context.companyCode),
    },
  });
}

function readImprove(uri: string, context: McpRequestContext): ReadResourceResult {
  const recommendationId = uriTail(uri, context, "/improve/");
  const { recommendation } = getImproveRecommendation(context.companyId, recommendationId, context.db);
  return jsonResource(uri, {
    schema: "mcp.improvement.v1",
    company: companyPayload(context),
    recommendation,
    links: {
      improve: buildCanonicalImprovePath(context.companyCode, { recommendation: recommendationId }),
    },
  });
}

function mapAgent(row: AgentResourceRow) {
  const rosterState = row.archived_at
    ? "archived"
    : row.status === "paused"
      ? "paused"
      : row.status === "offline" || row.status === "error"
        ? "bench"
        : "active";
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    role: row.role,
    status: row.status,
    rosterState,
    model: row.model,
    adapterType: row.adapter_type,
    runtimeSlug: row.runtime_slug,
    currentTask: row.current_task_id
      ? { id: row.current_task_id, title: row.current_task_title }
      : null,
    stats: {
      tasksCompleted: Number(row.tasks_completed ?? 0),
      totalRuntimeMinutes: Number(row.total_runtime_minutes ?? 0),
    },
    lastHeartbeat: row.last_heartbeat,
    timestamps: {
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      archivedAt: row.archived_at,
    },
  };
}

function readTeam(uri: string, context: McpRequestContext, benchOnly: boolean): ReadResourceResult {
  const rows = context.db
    .prepare(
      `SELECT
        a.id,
        a.slug,
        a.name,
        a.role,
        a.status,
        a.model,
        a.adapter_type,
        a.runtime_slug,
        a.current_task_id,
        t.title AS current_task_title,
        a.tasks_completed,
        a.total_runtime_minutes,
        a.last_heartbeat,
        a.archived_at,
        a.created_at,
        a.updated_at
       FROM agents a
       LEFT JOIN tasks t ON t.id = a.current_task_id
       WHERE a.company_id = ?
         AND a.archived_at IS NULL
       ORDER BY a.name ASC
       LIMIT 200`,
    )
    .all(context.companyId) as AgentResourceRow[];
  const agents = rows.map(mapAgent).filter((agent) => !benchOnly || agent.rosterState === "bench");

  return jsonResource(uri, {
    schema: "mcp.team.v1",
    company: companyPayload(context),
    rosterState: benchOnly ? "bench" : "all",
    count: agents.length,
    agents,
    links: {
      team: buildCanonicalTeamPath(context.companyCode),
    },
  });
}

function listTemplates(uri: string, context: McpRequestContext): ReadResourceResult {
  const templates = listBuiltInStarterSprintTemplates();
  return jsonResource(uri, {
    schema: "mcp.templates.v1",
    company: companyPayload(context),
    count: templates.length,
    templates: templates.map((template) => ({
      id: template.id,
      templateVersionId: template.templateVersionId,
      name: template.name,
      shortName: template.shortName,
      summary: template.summary,
      lifecycle: template.lifecycle,
      requiredCapabilitySlots: template.draftOutputs.activeCrewRecommendation.requiredCapabilitySlotIds,
    })),
  });
}

function readTemplate(uri: string, context: McpRequestContext): ReadResourceResult {
  const templateVersionId = uriTail(uri, context, "/templates/");
  const id = templateVersionId.replace(/@1\.0\.0$/, "");
  const template = getBuiltInStarterSprintTemplate(id as Parameters<typeof getBuiltInStarterSprintTemplate>[0]);
  return jsonResource(uri, {
    schema: "mcp.template.v1",
    company: companyPayload(context),
    template,
  });
}

export function readHiveRunnerMcpResource(input: ReadInput): ReadResourceResult {
  switch (input.definitionName) {
    case "hiverunner.goals.list":
      return listGoals(input.uri, input.context);
    case "hiverunner.tasks.list":
      return listTasks(input.uri, input.context);
    case "hiverunner.task.read":
      return readTask(input.uri, input.context);
    case "hiverunner.trace.read":
      return readTrace(input.uri, input.context, false);
    case "hiverunner.trace.export":
      return readTrace(input.uri, input.context, true);
    case "hiverunner.evals.list":
      return listEvals(input.uri, input.context);
    case "hiverunner.eval.read":
      return readEval(input.uri, input.context);
    case "hiverunner.experiment_reports.list":
      return listExperimentReports(input.uri, input.context);
    case "hiverunner.experiment_report.read":
      return readExperimentReport(input.uri, input.context);
    case "hiverunner.improve.list":
      return listImprove(input.uri, input.context);
    case "hiverunner.improve.read":
      return readImprove(input.uri, input.context);
    case "hiverunner.team.list":
      return readTeam(input.uri, input.context, false);
    case "hiverunner.team.bench":
      return readTeam(input.uri, input.context, true);
    case "hiverunner.templates.list":
      return listTemplates(input.uri, input.context);
    case "hiverunner.template.read":
      return readTemplate(input.uri, input.context);
  }
}
