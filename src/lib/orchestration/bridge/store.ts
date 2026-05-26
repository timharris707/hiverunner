import type Database from "better-sqlite3";

import { OrchestrationApiError } from "@/lib/orchestration/api";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { resolveTaskExecutionEngine, resolveTaskExecutionRouting } from "@/lib/orchestration/service/shared";
import type {
  BridgeExecutionEngine,
  BridgeExecutionMode,
  BridgeRuntimeProvider,
  BridgeTaskRecord,
} from "@/lib/orchestration/bridge/types";

type BridgeTaskRow = {
  id: string;
  title: string;
  description: string;
  priority: BridgeTaskRecord["priority"];
  status: BridgeTaskRecord["status"];
  project_id: string;
  project_name: string;
  company_id: string | null;
  assignee_agent_id: string | null;
  assignee_agent_name: string | null;
  assignee_agent_status: BridgeTaskRecord["assigneeAgentStatus"] | null;
  assignee_adapter_type: string | null;
  assignee_model: string | null;
  assignee_openclaw_agent_id: string | null;
  execution_engine: BridgeExecutionEngine | null;
  execution_runtime_provider: string | null;
  execution_runtime_label: string | null;
  execution_model_routing: string | null;
  execution_model_routing_label: string | null;
  model_lane: "default" | "fast" | "mini" | "deep";
  execution_mode: BridgeExecutionMode;
  execution_session_id: string | null;
  project_settings_json: string | null;
  company_settings_json: string | null;
};

function normalizeBridgeRuntimeProvider(value: string | null): BridgeRuntimeProvider {
  const normalized = value?.trim().toLowerCase();
  if (
    normalized === "openclaw" ||
    normalized === "codex" ||
    normalized === "anthropic" ||
    normalized === "hermes" ||
    normalized === "gemini" ||
    normalized === "symphony"
  ) {
    return normalized;
  }
  return "manual";
}

function getTaskBridgeRow(db: Database.Database, taskId: string): BridgeTaskRow | undefined {
  return db
    .prepare(
      `SELECT
         t.id,
         t.title,
         t.description,
         t.priority,
         t.status,
         t.project_id,
         p.name AS project_name,
         p.company_id,
         t.assignee_agent_id,
         a.name AS assignee_agent_name,
         a.status AS assignee_agent_status,
         a.adapter_type AS assignee_adapter_type,
         a.model AS assignee_model,
         a.openclaw_agent_id AS assignee_openclaw_agent_id,
         t.execution_engine,
         t.execution_runtime_provider,
         t.execution_runtime_label,
         t.execution_model_routing,
         t.execution_model_routing_label,
         COALESCE(t.model_lane, 'default') AS model_lane,
         t.execution_mode,
         t.execution_session_id,
         p.settings_json AS project_settings_json,
         c.settings_json AS company_settings_json
       FROM tasks t
       INNER JOIN projects p ON p.id = t.project_id
       LEFT JOIN companies c ON c.id = COALESCE(t.company_id, p.company_id)
       LEFT JOIN agents a ON a.id = t.assignee_agent_id
       WHERE t.id = ? AND t.archived_at IS NULL
       LIMIT 1`
    )
    .get(taskId) as BridgeTaskRow | undefined;
}

function mapBridgeTaskRow(row: BridgeTaskRow): BridgeTaskRecord {
  if (!row.company_id) {
    throw new OrchestrationApiError(
      400,
      "bridge_company_missing",
      "Task project must belong to a company before bridge execution"
    );
  }

  const executionEngine = resolveTaskExecutionEngine({
    taskExecutionEngine: row.execution_engine,
    projectSettingsJson: row.project_settings_json,
    companySettingsJson: row.company_settings_json,
  });
  const executionRouting = resolveTaskExecutionRouting({
    taskRuntimeProvider: row.execution_runtime_provider,
    taskRuntimeLabel: row.execution_runtime_label,
    taskModelRouting: row.execution_model_routing,
    taskModelRoutingLabel: row.execution_model_routing_label,
    projectSettingsJson: row.project_settings_json,
    companySettingsJson: row.company_settings_json,
  });

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    priority: row.priority,
    status: row.status,
    projectId: row.project_id,
    projectName: row.project_name,
    companyId: row.company_id,
    assigneeAgentId: row.assignee_agent_id ?? undefined,
    assigneeAgentName: row.assignee_agent_name ?? undefined,
    assigneeAgentStatus: row.assignee_agent_status ?? undefined,
    assigneeAdapterType: normalizeBridgeRuntimeProvider(row.assignee_adapter_type),
    assigneeModel: row.assignee_model ?? undefined,
    assigneeOpenclawAgentId: row.assignee_openclaw_agent_id ?? undefined,
    executionEngine: executionEngine.engine,
    executionEngineOverride: executionEngine.override,
    executionEngineSource: executionEngine.source,
    modelLane: row.model_lane ?? "default",
    runnerProvider: executionRouting.runtimeProvider,
    modelRouting: executionRouting.modelRouting,
    modelRoutingLabel: executionRouting.modelRoutingLabel,
    activeHiveId: executionRouting.activeHiveId,
    activeHiveName: executionRouting.activeHiveName,
    executionMode: row.execution_mode,
    executionSessionId: row.execution_session_id ?? undefined,
  };
}

export function getTaskBridgeRecord(taskId: string, db = getOrchestrationDb()): BridgeTaskRecord {
  const row = getTaskBridgeRow(db, taskId);
  if (!row) {
    throw new OrchestrationApiError(404, "task_not_found", "Task not found");
  }
  return mapBridgeTaskRow(row);
}

export function setTaskExecutionMode(
  input: { taskId: string; mode: BridgeExecutionMode; executionSessionId?: string | null },
  db = getOrchestrationDb()
): void {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `UPDATE tasks
       SET execution_mode = ?, execution_session_id = ?, updated_at = ?
       WHERE id = ? AND archived_at IS NULL`
    )
    .run(input.mode, input.executionSessionId ?? null, now, input.taskId);

  if (result.changes === 0) {
    throw new OrchestrationApiError(404, "task_not_found", "Task not found");
  }
}

export function setTaskExecutionEngine(
  input: { taskId: string; engine: BridgeExecutionEngine | null },
  db = getOrchestrationDb()
): void {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `UPDATE tasks
       SET execution_engine = ?, updated_at = ?
       WHERE id = ? AND archived_at IS NULL`
    )
    .run(input.engine, now, input.taskId);

  if (result.changes === 0) {
    throw new OrchestrationApiError(404, "task_not_found", "Task not found");
  }
}

export function listTaskExternalCommentRefs(
  input: { taskId: string; source: "mission_control" | "openclaw" },
  db = getOrchestrationDb()
): Set<string> {
  const rows = db
    .prepare(
      `SELECT external_ref
       FROM comments
       WHERE task_id = ? AND source = ? AND external_ref IS NOT NULL`
    )
    .all(input.taskId, input.source) as Array<{ external_ref: string }>;

  return new Set(rows.map((row) => row.external_ref).filter(Boolean));
}

export function getLatestTaskExternalCommentRef(
  input: { taskId: string; source: "mission_control" | "openclaw" },
  db = getOrchestrationDb()
): string | undefined {
  const row = db
    .prepare(
      `SELECT external_ref
       FROM comments
       WHERE task_id = ? AND source = ? AND external_ref IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .get(input.taskId, input.source) as { external_ref: string } | undefined;

  return row?.external_ref || undefined;
}
