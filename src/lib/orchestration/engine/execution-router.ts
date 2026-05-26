/**
 * Execution Router
 *
 * Decides which execution engine, runtime provider, and model lane a task is
 * sent to when a heartbeat is dispatched. Extracted from engine.ts /
 * heartbeat-manager.ts so the routing rules live in a single, dependency-light
 * module that other engine pieces (heartbeat-manager, action-dispatcher,
 * engine coordinator) can import without dragging in the rest of the engine.
 *
 * The routing rules are intentionally unchanged from the prior extraction.
 * Behavior changes belong in a follow-up, never in a module-move refactor.
 */

import type Database from "better-sqlite3";

import { resolveExecutionRoute } from "@/lib/orchestration/execution-route-resolver";
import { normalizeTaskModelLane } from "@/lib/orchestration/task-model-routing";
import type { TaskExecutionEngine, TaskModelLane } from "@/lib/orchestration/types";
import { stringFromRecord } from "@/lib/orchestration/engine/persistence";
import {
  type ExecutionRunProvider,
  executionRunProviderForAdapter,
} from "@/lib/orchestration/engine/cost-recorder";

export { executionRunProviderForAdapter };
export type { ExecutionRunProvider };

/**
 * Coerces an unknown wake-payload value into a TaskExecutionEngine if it is
 * one of the three valid engine literals. Exported so engine-adjacent code
 * can normalize untrusted inputs without re-declaring the literal set.
 */
export function normalizeCreateTaskExecutionEngine(value: unknown): TaskExecutionEngine | null {
  return value === "hiverunner" || value === "symphony" || value === "manual" ? value : null;
}

/**
 * Decides the model lane to record on this run when no task row is available
 * (e.g. the synthetic `__heartbeat__` task key). Falls back to "default" if
 * neither the wake payload nor the matched task row carries a lane.
 */
function taskModelLaneForRunSnapshot(
  contextSnapshot: Record<string, unknown>,
  db: Database.Database,
): TaskModelLane {
  if (contextSnapshot.modelLane !== undefined) {
    return normalizeTaskModelLane(contextSnapshot.modelLane);
  }
  const taskRef = stringFromRecord(contextSnapshot.taskId) ?? stringFromRecord(contextSnapshot.taskKey);
  if (!taskRef) return "default";
  const row = db
    .prepare(
      `SELECT COALESCE(model_lane, 'default') AS model_lane
       FROM tasks
       WHERE (id = ? OR task_key = ?) AND archived_at IS NULL
       LIMIT 1`,
    )
    .get(taskRef, taskRef) as { model_lane: string | null } | undefined;
  return normalizeTaskModelLane(row?.model_lane);
}

/**
 * Builds the (modelLane, executionEngine) tuple consumed by
 * resolveExecutionRoute. For real task wake-ups it reads the task row; for
 * the synthetic `__heartbeat__` key it falls back to whatever the wake payload
 * carried.
 */
export function taskRouteInputForRun(input: {
  db: Database.Database;
  taskKey: string;
  contextSnapshot: Record<string, unknown>;
}): { modelLane: TaskModelLane; executionEngine: TaskExecutionEngine | null } {
  if (!input.taskKey || input.taskKey === "__heartbeat__") {
    return {
      modelLane: taskModelLaneForRunSnapshot(input.contextSnapshot, input.db),
      executionEngine: normalizeCreateTaskExecutionEngine(input.contextSnapshot.executionEngine),
    };
  }

  const row = input.db
    .prepare(
      `SELECT execution_engine, model_lane
       FROM tasks
       WHERE (id = ? OR task_key = ?) AND archived_at IS NULL
       LIMIT 1`,
    )
    .get(input.taskKey, input.taskKey) as
      | { execution_engine: TaskExecutionEngine | null; model_lane: TaskModelLane | null }
      | undefined;

  return {
    modelLane: normalizeTaskModelLane(row?.model_lane ?? input.contextSnapshot.modelLane),
    executionEngine:
      normalizeCreateTaskExecutionEngine(row?.execution_engine) ??
      normalizeCreateTaskExecutionEngine(input.contextSnapshot.executionEngine),
  };
}

/**
 * Public alias kept on the export surface so callers express intent: the
 * resulting route describes how the task should be sent to an adapter.
 */
export const routeTaskToAdapter = taskRouteInputForRun;

/**
 * Resolves the execution_engine value to persist on this run. Honours an
 * explicit Symphony selection on the task row even when the active route
 * resolves to a concrete provider runner (anthropic/codex/...).
 */
export function taskExecutionEngineForRun(input: {
  db: Database.Database;
  taskKey: string;
  routeExecutionEngine?: TaskExecutionEngine | null;
  contextExecutionEngine?: unknown;
}): TaskExecutionEngine | null {
  const row = input.db
    .prepare(
      `SELECT execution_engine
       FROM tasks
       WHERE (id = ? OR task_key = ?) AND archived_at IS NULL
       LIMIT 1`,
    )
    .get(input.taskKey, input.taskKey) as { execution_engine: string | null } | undefined;
  const taskEngine = normalizeCreateTaskExecutionEngine(row?.execution_engine);
  const routeEngine = normalizeCreateTaskExecutionEngine(input.routeExecutionEngine);
  const contextEngine = normalizeCreateTaskExecutionEngine(input.contextExecutionEngine);

  // Most tasks carry the legacy/global default of "hiverunner", while route
  // resolution owns the active hive mode. An explicit task Symphony selection,
  // however, must be reflected in execution_runs even when the concrete runner
  // is a provider such as anthropic/codex.
  if (taskEngine === "symphony") return "symphony";
  return routeEngine ?? contextEngine ?? taskEngine ?? null;
}

/**
 * Decides the execution policy used when enqueueing a wakeup for a continuing
 * task: which engine, which lane, which runtime provider. Used both by the
 * heartbeat manager after a run finishes and by the action dispatcher when
 * scheduling a continuation from an mc-action.
 */
export function taskExecutionPolicyForWakeup(input: {
  db: Database.Database;
  taskId: string;
  assigneeAdapterType?: string | null;
  assigneeModel?: string | null;
}): {
  executionEngine: TaskExecutionEngine;
  modelLane: TaskModelLane;
  executionProvider: ExecutionRunProvider | null;
  runnerProvider: string | null;
  modelRouting: string | null;
  modelRoutingLabel: string | null;
  activeHiveId: string | null;
  activeHiveName: string | null;
} {
  const row = input.db
    .prepare(
      `SELECT
         COALESCE(t.company_id, p.company_id) AS company_id,
         t.execution_engine,
         t.model_lane,
         t.execution_runtime_provider,
         t.execution_runtime_label,
         t.execution_model_routing,
         t.execution_model_routing_label,
         p.settings_json AS project_settings_json,
         c.settings_json AS company_settings_json
       FROM tasks t
       LEFT JOIN projects p ON p.id = t.project_id
       LEFT JOIN companies c ON c.id = COALESCE(t.company_id, p.company_id)
       WHERE t.id = ? AND t.archived_at IS NULL
       LIMIT 1`,
    )
    .get(input.taskId) as
      | {
          execution_engine: TaskExecutionEngine | null;
          company_id: string | null;
          model_lane: TaskModelLane | null;
          execution_runtime_provider: string | null;
          execution_runtime_label: string | null;
          execution_model_routing: string | null;
          execution_model_routing_label: string | null;
          project_settings_json: string | null;
          company_settings_json: string | null;
        }
      | undefined;

  if (!row?.company_id) {
    return {
      executionEngine: "manual",
      modelLane: "default",
      executionProvider: null,
      runnerProvider: null,
      modelRouting: null,
      modelRoutingLabel: null,
      activeHiveId: null,
      activeHiveName: null,
    };
  }

  const route = resolveExecutionRoute({
    companyId: row.company_id,
    task: {
      modelLane: row.model_lane,
      executionEngine: row.execution_engine,
      assigneeAdapterType: input.assigneeAdapterType,
      assigneeModel: input.assigneeModel,
    },
  }, input.db);
  const executionProvider =
    route.executionEngine === "manual"
      ? null
      : route.executionEngine === "symphony"
        ? "symphony"
        : route.primary.runtimeProvider;

  return {
    executionEngine: route.executionEngine,
    modelLane: normalizeTaskModelLane(route.laneId),
    executionProvider,
    runnerProvider: route.primary.runtimeProvider,
    modelRouting: null,
    modelRoutingLabel: null,
    activeHiveId: route.activeHiveId,
    activeHiveName: route.activeHiveName,
  };
}
