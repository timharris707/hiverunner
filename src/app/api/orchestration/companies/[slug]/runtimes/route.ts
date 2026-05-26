import { NextRequest, NextResponse } from "next/server";

import { OrchestrationApiError } from "@/lib/orchestration/api";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import {
  detectLocalRuntimeCandidatesFast,
  detectLocalRuntimeCandidates,
  listRuntimeDependencyReadiness,
  listCompanyRuntimes,
  probeCompanyRuntimes,
  upsertCompanyRuntime,
} from "@/lib/orchestration/runtime-registry";
import { resolveCompanyId } from "@/lib/orchestration/service/shared";
import { switchAgentProvider } from "@/lib/orchestration/service/provider-switch";

export const dynamic = "force-dynamic";

const AGENT_SWITCHABLE_RUNTIME_PROVIDERS = new Set([
  "openclaw",
  "codex",
  "anthropic",
  "hermes",
  "symphony",
]);

type RecentExecutionRunRow = {
  id: string;
  task_id: string | null;
  task_key: string | null;
  task_title: string | null;
  project_id: string | null;
  project_slug: string | null;
  project_name: string | null;
  agent_id: string | null;
  agent_name: string | null;
  provider: string;
  execution_engine: string | null;
  runner_provider: string | null;
  runner_model: string | null;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  session_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  duration_ms: number | null;
  error_message: string | null;
  token_usage_json: string | null;
  transcript_event_count: number;
};

type RuntimeDurationRow = {
  provider: string | null;
  runner_provider: string | null;
  duration_ms: number | null;
};

function parseUsageJson(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function numberFromUsage(usage: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = usage[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function costUsdFromUsage(usage: Record<string, unknown>): number | undefined {
  const usd = numberFromUsage(usage, ["totalCostUsd", "costUsd", "total_cost_usd"]);
  if (typeof usd === "number") return usd;
  const cents = numberFromUsage(usage, ["totalCostCents", "costCents", "total_cost_cents"]);
  return typeof cents === "number" ? cents / 100 : undefined;
}

function usageString(usage: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = usage[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function modelFromUsage(usage: Record<string, unknown>, provider: string): string | null {
  const explicitModel = usageString(usage, ["cliModel", "modelId", "model_id", "fullModel", "full_model"]);
  if (explicitModel) return explicitModel;

  const model = usageString(usage, ["model"]);
  if (!model) return null;

  const normalizedProvider = provider.toLowerCase();
  const normalizedModel = model.toLowerCase();
  if ((normalizedProvider === "anthropic" || normalizedProvider === "claude") && normalizedModel === "sonnet") {
    return "claude-sonnet-4-6";
  }

  return model;
}

function listRecentExecutionRuns(companyIdOrSlug: string) {
  const db = getOrchestrationDb();
  const companyId = resolveCompanyId(db, companyIdOrSlug);
  if (!companyId) {
    throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  }

  const rows = db
    .prepare(
      `SELECT
         er.id,
         er.task_id,
         t.task_key,
         t.title AS task_title,
         p.id AS project_id,
         p.slug AS project_slug,
         p.name AS project_name,
         er.agent_id,
         a.name AS agent_name,
         er.provider,
         er.execution_engine,
         er.runner_provider,
         er.runner_model,
         er.status,
         er.session_id,
         er.started_at,
         er.completed_at,
         er.created_at,
         er.duration_ms,
         er.error_message,
         er.token_usage_json,
         (
           SELECT COUNT(*)
           FROM execution_run_transcript_events events
           WHERE events.execution_run_id = er.id
         ) AS transcript_event_count
       FROM execution_runs er
       LEFT JOIN tasks t ON t.id = er.task_id
       LEFT JOIN projects p ON p.id = t.project_id
       LEFT JOIN agents a ON a.id = er.agent_id
       WHERE p.company_id = ? OR a.company_id = ?
       ORDER BY COALESCE(er.started_at, er.created_at) DESC
       LIMIT 30`,
    )
    .all(companyId, companyId) as RecentExecutionRunRow[];

  return rows.map((row) => {
    const usage = parseUsageJson(row.token_usage_json);
    return {
      id: row.id,
      taskId: row.task_id,
      taskKey: row.task_key,
      taskTitle: row.task_title,
      projectId: row.project_id,
      projectSlug: row.project_slug,
      projectName: row.project_name,
      agentId: row.agent_id,
      agentName: row.agent_name,
      provider: row.provider,
      executionEngine: row.execution_engine,
      runnerProvider: row.runner_provider ?? row.provider,
      runnerModel: row.runner_model ?? modelFromUsage(usage, row.runner_provider ?? row.provider),
      status: row.status,
      sessionId: row.session_id,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      createdAt: row.created_at,
      durationMs: row.duration_ms,
      errorMessage: row.error_message,
      inputTokens: numberFromUsage(usage, ["inputTokens", "input_tokens", "totalInputTokens"]),
      outputTokens: numberFromUsage(usage, ["totalOutputTokens", "outputTokens", "output_tokens"]),
      cacheReadTokens: numberFromUsage(usage, [
        "cacheReadTokens",
        "cachedReadTokens",
        "cacheReadInputTokens",
        "cache_read_tokens",
      ]),
      cacheWriteTokens: numberFromUsage(usage, [
        "cacheWriteTokens",
        "cacheCreationInputTokens",
        "cachedWriteTokens",
        "cache_write_tokens",
      ]),
      totalTokens: numberFromUsage(usage, ["totalTokens", "total_tokens"]),
      totalCostUsd: costUsdFromUsage(usage),
      model: row.runner_model ?? modelFromUsage(usage, row.runner_provider ?? row.provider),
      transcriptEventCount: row.transcript_event_count,
    };
  });
}

function providerAliases(provider: string): string[] {
  const normalized = provider.trim().toLowerCase();
  if (!normalized) return [];
  if (normalized === "anthropic" || normalized.includes("claude")) return ["anthropic", "claude-code"];
  if (normalized === "gemini" || normalized.includes("google")) return ["gemini", "gemini-cli"];
  if (normalized === "openclaw") return ["openclaw"];
  if (normalized === "hermes") return ["hermes"];
  if (normalized === "codex" || normalized === "openai") return ["codex"];
  return [normalized];
}

function listRuntimeTaskDurationP50(companyIdOrSlug: string) {
  const db = getOrchestrationDb();
  const companyId = resolveCompanyId(db, companyIdOrSlug);
  if (!companyId) {
    throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  }

  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const rows = db
    .prepare(
      `SELECT
         er.provider,
         er.runner_provider,
         er.duration_ms
       FROM execution_runs er
       LEFT JOIN tasks t ON t.id = er.task_id
       LEFT JOIN projects p ON p.id = t.project_id
       LEFT JOIN agents a ON a.id = er.agent_id
       WHERE (p.company_id = ? OR a.company_id = ?)
         AND er.duration_ms IS NOT NULL
         AND er.duration_ms > 0
         AND er.status IN ('completed', 'failed', 'cancelled')
         AND COALESCE(er.completed_at, er.started_at, er.created_at) >= ?`,
    )
    .all(companyId, companyId, cutoff) as RuntimeDurationRow[];

  const durationsByProvider = new Map<string, number[]>();
  for (const row of rows) {
    const provider = row.runner_provider ?? row.provider;
    if (!provider || typeof row.duration_ms !== "number") continue;
    for (const alias of providerAliases(provider)) {
      const durations = durationsByProvider.get(alias) ?? [];
      durations.push(row.duration_ms);
      durationsByProvider.set(alias, durations);
    }
  }

  return Object.fromEntries(
    Array.from(durationsByProvider.entries()).map(([provider, durations]) => {
      const sorted = durations.slice().sort((a, b) => a - b);
      const middle = Math.floor((sorted.length - 1) / 2);
      const median = sorted.length % 2 === 1
        ? sorted[middle]
        : Math.round((sorted[middle] + sorted[middle + 1]) / 2);
      return [provider, { durationMs: median, sampleSize: sorted.length }];
    }),
  );
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const fast = req.nextUrl.searchParams.get("fast") === "1";
    const runtimeInventory = fast ? listCompanyRuntimes(slug) : probeCompanyRuntimes(slug);
    return NextResponse.json({
      ...runtimeInventory,
      detectedLocalRuntimes: fast
        ? detectLocalRuntimeCandidatesFast()
        : detectLocalRuntimeCandidates(),
      runtimeDependencies: listRuntimeDependencyReadiness(process.env, { fast }),
      recentExecutionRuns: listRecentExecutionRuns(slug),
      runtimeTaskDurationP50: listRuntimeTaskDurationP50(slug),
    });
  } catch (error) {
    if (error instanceof OrchestrationApiError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    console.error("[company-runtimes:get] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const body = await req.json();
    const result = upsertCompanyRuntime({
      companyIdOrSlug: slug,
      agentId: typeof body.agentId === "string" ? body.agentId : null,
      provider: typeof body.provider === "string" ? body.provider : "",
      runtimeSlug: typeof body.runtimeSlug === "string" ? body.runtimeSlug : null,
      displayName: typeof body.displayName === "string" ? body.displayName : null,
      runtimeKind: typeof body.runtimeKind === "string" ? body.runtimeKind : null,
      scope: typeof body.scope === "string" ? body.scope : null,
      command: typeof body.command === "string" ? body.command : null,
      version: typeof body.version === "string" ? body.version : null,
      status: typeof body.status === "string" ? body.status : null,
      workspaceRoot: typeof body.workspaceRoot === "string" ? body.workspaceRoot : null,
      metadata:
        typeof body.metadata === "object" && body.metadata !== null && !Array.isArray(body.metadata)
          ? body.metadata
          : {},
      lastSeenAt: typeof body.lastSeenAt === "string" ? body.lastSeenAt : null,
    });

    const agentProviderSwitch =
      result.runtime.agentId && AGENT_SWITCHABLE_RUNTIME_PROVIDERS.has(result.runtime.provider)
        ? switchAgentProvider(result.runtime.agentId, result.runtime.provider)
        : null;

    return NextResponse.json(
      {
        ...result,
        agentProviderSwitch: agentProviderSwitch
          ? {
              switched: agentProviderSwitch.switched,
              blockReason: agentProviderSwitch.blockReason,
              message: agentProviderSwitch.message,
              approval: agentProviderSwitch.approval,
            }
          : null,
      },
      { status: result.created ? 201 : 200 },
    );
  } catch (error) {
    if (error instanceof OrchestrationApiError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    console.error("[company-runtimes:post] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
