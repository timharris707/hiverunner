import Database from "better-sqlite3";
import { recordCostEventForExecution } from "@/lib/orchestration/cost-ledger";

export type ExecutionRunProvider =
  | "openclaw"
  | "codex"
  | "anthropic"
  | "hermes"
  | "gemini"
  | "symphony";

export function executionRunProviderForAdapter(adapterType: string | null | undefined): ExecutionRunProvider | null {
  const provider = adapterType?.trim().toLowerCase();
  if (
    provider === "openclaw" ||
    provider === "codex" ||
    provider === "anthropic" ||
    provider === "hermes" ||
    provider === "gemini" ||
    provider === "symphony"
  ) {
    return provider as ExecutionRunProvider;
  }
  return null;
}

export function numberFromUsage(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function usageTokenDeltas(usage: Record<string, unknown> | undefined): {
  inputTokensDelta: number;
  outputTokensDelta: number;
  costCentsDelta: number;
} {
  if (!usage) {
    return { inputTokensDelta: 0, outputTokensDelta: 0, costCentsDelta: 0 };
  }

  const totalCostUsd = numberFromUsage(usage.totalCostUsd);
  return {
    inputTokensDelta:
      numberFromUsage(usage.totalInputTokens) ||
      numberFromUsage(usage.inputTokens),
    outputTokensDelta:
      numberFromUsage(usage.totalOutputTokens) ||
      numberFromUsage(usage.outputTokens),
    costCentsDelta:
      numberFromUsage(usage.totalCostCents) ||
      numberFromUsage(usage.costCents) ||
      (totalCostUsd > 0 ? Math.round(totalCostUsd * 100) : 0),
  };
}

export function applyUsageDeltasToTelemetry(
  telemetry: Record<string, unknown>,
  deltas: ReturnType<typeof usageTokenDeltas>,
): void {
  if (deltas.inputTokensDelta > 0 || deltas.outputTokensDelta > 0) {
    telemetry.inputTokens = deltas.inputTokensDelta;
    telemetry.outputTokens = deltas.outputTokensDelta;
  }
  if (deltas.costCentsDelta > 0) {
    telemetry.costCents = deltas.costCentsDelta;
  }
}

export function recordCostEvent(
  db: Database.Database,
  agent: { id: string; company_id: string; },
  taskKey: string,
  executionRunId: string,
  runId: string,
  provider: string,
  usageForStorage: Record<string, unknown> | undefined
) {
  if (!usageForStorage) {
    return;
  }

  const taskProject = db
    .prepare(`SELECT project_id FROM tasks WHERE id = ? OR task_key = ? LIMIT 1`)
    .get(taskKey, taskKey) as { project_id: string | null } | undefined;
  recordCostEventForExecution({
    db,
    companyId: agent.company_id,
    agentId: agent.id,
    taskId: taskKey,
    projectId: taskProject?.project_id ?? null,
    executionRunId,
    heartbeatRunId: runId,
    provider,
    usage: usageForStorage,
  });
}
