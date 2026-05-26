import type Database from "better-sqlite3";

import { OrchestrationApiError } from "@/lib/orchestration/api";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import type {
  ExecutionHiveRuntimeProvider,
  HiveRoutingLaneId,
  RouteTarget,
  RoutingLane,
} from "@/lib/orchestration/execution-hives";
import { normalizeRouteModelForRunner } from "@/lib/orchestration/route-target-builder";
import { normalizeTaskModelLane } from "@/lib/orchestration/task-model-routing";
import type { TaskExecutionEngine, TaskModelLane } from "@/lib/orchestration/types";

type ActiveHiveRow = {
  id: string;
  slug: string;
  name: string;
  orchestration_mode: TaskExecutionEngine;
  lanes_json: string | null;
};

export type ResolvedExecutionRouteTarget = {
  runtimeProvider: ExecutionHiveRuntimeProvider;
  runtimeLabel: string;
  model: string | null;
  source: RouteTarget;
};

export type ResolvedExecutionRoute = {
  companyId: string;
  activeHiveId: string;
  activeHiveName: string;
  executionEngine: TaskExecutionEngine;
  requestedLaneId: TaskModelLane;
  laneId: HiveRoutingLaneId;
  laneLabel: string;
  primary: ResolvedExecutionRouteTarget;
  fallbacks: ResolvedExecutionRouteTarget[];
};

export type ResolvedExecutionRouteAttempt = {
  target: ResolvedExecutionRouteTarget;
  fallbackUsed: boolean;
  fallbackIndex: number | null;
  fallbackFromProvider: string | null;
};

const RUNTIME_PROVIDER_LABELS: Record<ExecutionHiveRuntimeProvider, string> = {
  codex: "Codex",
  anthropic: "Claude Code",
  gemini: "Gemini CLI",
  hermes: "Hermes",
  openclaw: "OpenClaw",
};

function parseLanes(value: string | null | undefined): RoutingLane[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as RoutingLane[] : [];
  } catch {
    return [];
  }
}

function normalizeExecutionEngine(value: unknown): TaskExecutionEngine {
  if (value === "symphony" || value === "manual" || value === "hiverunner") {
    return value;
  }
  return "hiverunner";
}

export function runtimeProviderLabel(provider: ExecutionHiveRuntimeProvider): string {
  return RUNTIME_PROVIDER_LABELS[provider];
}

export function normalizeExecutionRouteRuntimeProvider(value: unknown): ExecutionHiveRuntimeProvider | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.includes("claude") || normalized.includes("anthropic")) return "anthropic";
  if (normalized.includes("gemini") || normalized.includes("google")) return "gemini";
  if (normalized.includes("hermes")) return "hermes";
  if (normalized.includes("openclaw")) return "openclaw";
  if (normalized.includes("codex")) return "codex";
  return null;
}

export function executionRouteRuntimeProviderFromTarget(target: RouteTarget): ExecutionHiveRuntimeProvider | null {
  return (
    normalizeExecutionRouteRuntimeProvider(target.runtimeId) ??
    normalizeExecutionRouteRuntimeProvider(target.runtimeLabel) ??
    normalizeExecutionRouteRuntimeProvider(target.modelSourceId) ??
    normalizeExecutionRouteRuntimeProvider(target.modelSourceLabel)
  );
}

function routeTarget(target: RouteTarget, lane: RoutingLane): ResolvedExecutionRouteTarget {
  const runtimeProvider = executionRouteRuntimeProviderFromTarget(target);
  if (!runtimeProvider) {
    throw new OrchestrationApiError(
      422,
      "execution_hive_route_unresolvable",
      `Execution hive lane "${lane.id}" has a route target that cannot be mapped to an executable runtime provider.`
    );
  }
  const rawModel = target.modelId?.trim() || target.modelLabel?.trim() || null;
  const model = normalizeRouteModelForRunner(rawModel);
  if (rawModel && !model) {
    console.warn(JSON.stringify({
      event: "execution_hive_generic_model_label",
      laneId: lane.id,
      rawModel,
      message: `Generic model label received from lane ${lane.id}, deferring to runtime default.`,
    }));
  }

  return {
    runtimeProvider,
    runtimeLabel: target.runtimeLabel?.trim() || runtimeProviderLabel(runtimeProvider),
    model,
    source: target,
  };
}

function normalizeAgentModelForRunner(
  runtimeProvider: ExecutionHiveRuntimeProvider,
  model: unknown,
): string | null {
  const normalized = normalizeRouteModelForRunner(typeof model === "string" ? model : null);
  if (!normalized) return null;
  if (runtimeProvider === "codex") {
    const codexModel = normalized
      .replace(/^openai-codex\//i, "")
      .replace(/^codex\//i, "")
      .replace(/^openai\//i, "")
      .trim();
    return codexModel || null;
  }
  if (runtimeProvider === "anthropic") {
    return normalized.replace(/^anthropic\//i, "").trim() || null;
  }
  if (runtimeProvider === "gemini") {
    const geminiModel = normalized
      .replace(/^google\/gemini[-/\s]?/i, "gemini-")
      .replace(/^google\//i, "")
      .replace(/^gemini\//i, "")
      .replace(/^models\//i, "")
      .trim();
    return geminiModel || null;
  }
  return normalized;
}

function agentRuntimeProvider(input: {
  adapterType?: unknown;
  model?: unknown;
} | null | undefined): ExecutionHiveRuntimeProvider | null {
  const adapterType = typeof input?.adapterType === "string" ? input.adapterType : null;
  const model = typeof input?.model === "string" ? input.model : null;
  const adapterProvider = normalizeExecutionRouteRuntimeProvider(adapterType);
  if (adapterProvider) return adapterProvider;
  const modelProvider = normalizeExecutionRouteRuntimeProvider(model);
  if (modelProvider) return modelProvider;
  const normalizedModel = String(model ?? "").trim().toLowerCase();
  if (normalizedModel.startsWith("gpt-") || normalizedModel.includes("/gpt-")) return "codex";
  return null;
}

function agentRouteTarget(input: {
  adapterType?: unknown;
  model?: unknown;
} | null | undefined): ResolvedExecutionRouteTarget | null {
  const runtimeProvider = agentRuntimeProvider(input);
  if (!runtimeProvider) return null;
  const model = normalizeAgentModelForRunner(runtimeProvider, input?.model);
  return {
    runtimeProvider,
    runtimeLabel: runtimeProviderLabel(runtimeProvider),
    model,
    source: {
      mode: "runtime_managed",
      runtimeId: runtimeProvider,
      runtimeLabel: runtimeProviderLabel(runtimeProvider),
      modelSourceId: "agent_profile",
      modelSourceLabel: "Agent profile",
      modelId: model ?? undefined,
      modelLabel: model ?? "Agent runtime default",
    },
  };
}

export function resolveExecutionRoute(
  input: {
    companyId: string;
    task?: {
      modelLane?: unknown;
      executionEngine?: unknown;
      executionEngineOverride?: unknown;
      assigneeAdapterType?: unknown;
      assigneeModel?: unknown;
    } | null;
    agent?: {
      adapterType?: unknown;
      model?: unknown;
    } | null;
    modelLane?: unknown;
  },
  db: Database.Database = getOrchestrationDb(),
): ResolvedExecutionRoute {
  const row = db
    .prepare(
      `SELECT id, slug, name, orchestration_mode, lanes_json
       FROM company_execution_hives
       WHERE company_id = ?
         AND archived_at IS NULL
         AND is_active = 1
       LIMIT 1`,
    )
    .get(input.companyId) as ActiveHiveRow | undefined;

  if (!row) {
    throw new OrchestrationApiError(
      409,
      "active_execution_hive_missing",
      "No active execution hive is configured for this company. Task dispatch is blocked until an active hive is selected."
    );
  }

  const lanes = parseLanes(row.lanes_json);
  const requestedLaneId = normalizeTaskModelLane(input.modelLane ?? input.task?.modelLane ?? "default");
  const lane =
    lanes.find((candidate) => candidate.id === requestedLaneId) ??
    lanes.find((candidate) => candidate.id === "default");

  if (!lane) {
    throw new OrchestrationApiError(
      409,
      "execution_hive_default_lane_missing",
      `Active execution hive "${row.name}" does not have a default lane.`
    );
  }

  const taskExecutionEngineOverride = normalizeExecutionEngine(input.task?.executionEngineOverride);
  const taskExecutionEngine = normalizeExecutionEngine(input.task?.executionEngine);
  const executionEngine =
    taskExecutionEngineOverride === "symphony"
      ? taskExecutionEngineOverride
      : taskExecutionEngine === "symphony"
        ? taskExecutionEngine
        : normalizeExecutionEngine(row.orchestration_mode);
  const agentTarget = agentRouteTarget(
    input.agent ?? {
      adapterType: input.task?.assigneeAdapterType,
      model: input.task?.assigneeModel,
    },
  );

  return {
    companyId: input.companyId,
    activeHiveId: row.slug,
    activeHiveName: row.name,
    executionEngine,
    requestedLaneId,
    laneId: lane.id,
    laneLabel: lane.label,
    primary: agentTarget ?? routeTarget(lane.primary, lane),
    fallbacks: lane.fallbacks.map((fallback) => routeTarget(fallback, lane)),
  };
}

export function executionRouteAttempts(route: ResolvedExecutionRoute): ResolvedExecutionRouteAttempt[] {
  const fallbacks = route.fallbacks.slice(0, 3);
  return [
    {
      target: route.primary,
      fallbackUsed: false,
      fallbackIndex: null,
      fallbackFromProvider: null,
    },
    ...fallbacks.map((target, index) => ({
      target,
      fallbackUsed: true,
      fallbackIndex: index,
      fallbackFromProvider: route.primary.runtimeProvider,
    })),
  ];
}
