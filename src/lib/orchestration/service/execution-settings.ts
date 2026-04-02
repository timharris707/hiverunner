import { OrchestrationApiError } from "@/lib/orchestration/api";
import { listCompanyAgents } from "@/lib/orchestration/service/agent";
import { getOrchestrationDb } from "@/lib/orchestration/service/shared";

type LocalAgent = {
  id: string;
  name: string;
  role: string;
  model?: string;
  paperclipAgentId?: string;
  lastHeartbeat?: string;
};

type PaperclipCompanyAgent = {
  id: string;
  companyId: string;
  name: string;
  role?: string;
  title?: string;
  status: string;
  adapterType?: string;
  adapterConfig?: Record<string, unknown>;
  runtimeConfig?: Record<string, unknown>;
  pauseReason?: string | null;
  pausedAt?: string | null;
  lastHeartbeatAt?: string | null;
};

type PaperclipClientConfig = {
  apiUrl: string;
  apiKey: string;
};

type ExecutionRuntimeSummary = {
  timeoutSeconds: number | null;
  graceSeconds: number | null;
};

type SafeRuntimeSummary = {
  heartbeatEnabled?: boolean;
  heartbeatIntervalSeconds?: number;
  executionProvider?: string;
  openclawAgentId?: string;
};

type ExecutionSettingsRow = {
  agentId: string;
  paperclipAgentId?: string;
  name: string;
  role?: string;
  adapterType?: string;
  modelId: string;
  lastHeartbeatAt?: string;
  timeoutSeconds: number | null;
  graceSeconds: number | null;
  pauseStatus: {
    isPaused: boolean;
    status: string;
    reason?: string;
    pausedAt?: string;
  };
  safeRuntimeConfig: SafeRuntimeSummary;
  canUpdate: boolean;
  updateBlocker?: string;
};

type ExecutionSettingsRowWithRemote = ExecutionSettingsRow & {
  remote: PaperclipCompanyAgent | null;
};

export type CompanyExecutionSettingsView = {
  company: {
    id: string;
    slug: string;
    name: string;
  };
  writeSupport: {
    supported: boolean;
    reason?: string;
  };
  agents: ExecutionSettingsRow[];
};

export type CompanyExecutionSettingsUpdateResult = {
  company: {
    id: string;
    slug: string;
    name: string;
  };
  agent: ExecutionSettingsRow;
  updatedAt: string;
};

function parseBooleanLike(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
    return null;
  }
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return null;
}

function parseNumberLike(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readNumberFrom(record: Record<string, unknown> | undefined, keys: string[]): number | null {
  if (!record) return null;
  for (const key of keys) {
    const parsed = parseNumberLike(record[key]);
    if (parsed !== null) {
      return Math.max(0, Math.trunc(parsed));
    }
  }
  return null;
}

function readStringFrom(record: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function parseExecutionRuntime(
  runtimeConfig?: Record<string, unknown>,
  adapterConfig?: Record<string, unknown>
): ExecutionRuntimeSummary {
  const runtimeExecution = asRecord(runtimeConfig?.execution) ?? {};
  const runtimeLimits = asRecord(runtimeConfig?.limits) ?? {};
  const adapterExecution = asRecord(adapterConfig?.execution) ?? {};

  const timeoutSeconds =
    readNumberFrom(runtimeExecution, ["timeoutSec", "timeoutSeconds", "runTimeoutSec"]) ??
    readNumberFrom(runtimeLimits, ["timeoutSec", "timeoutSeconds", "runTimeoutSec"]) ??
    readNumberFrom(adapterExecution, ["timeoutSec", "timeoutSeconds"]) ??
    readNumberFrom(adapterConfig, ["timeoutSec", "timeoutSeconds"]) ??
    null;

  const graceSeconds =
    readNumberFrom(runtimeExecution, ["graceSec", "graceSeconds", "cancelGraceSec"]) ??
    readNumberFrom(runtimeLimits, ["graceSec", "graceSeconds", "cancelGraceSec"]) ??
    readNumberFrom(adapterExecution, ["graceSec", "graceSeconds"]) ??
    readNumberFrom(adapterConfig, ["graceSec", "graceSeconds"]) ??
    null;

  return {
    timeoutSeconds,
    graceSeconds,
  };
}

function parseSafeRuntimeSummary(runtimeConfig?: Record<string, unknown>): SafeRuntimeSummary {
  if (!runtimeConfig) return {};

  const heartbeat = asRecord(runtimeConfig.heartbeat) ?? {};
  const execution = asRecord(runtimeConfig.execution) ?? {};

  const heartbeatEnabled = parseBooleanLike(heartbeat.enabled);
  const heartbeatIntervalSeconds = readNumberFrom(heartbeat, ["intervalSec", "intervalSeconds"]);
  const executionProvider =
    readStringFrom(runtimeConfig, ["executionProvider", "provider"]) ??
    readStringFrom(execution, ["provider"]);
  const openclawAgentId =
    readStringFrom(runtimeConfig, ["openclawAgentId"]) ??
    readStringFrom(asRecord(runtimeConfig.openclaw) ?? undefined, ["agentId"]);

  const summary: SafeRuntimeSummary = {};
  if (heartbeatEnabled !== null) summary.heartbeatEnabled = heartbeatEnabled;
  if (heartbeatIntervalSeconds !== null) summary.heartbeatIntervalSeconds = heartbeatIntervalSeconds;
  if (executionProvider) summary.executionProvider = executionProvider;
  if (openclawAgentId) summary.openclawAgentId = openclawAgentId;
  return summary;
}

function resolveModelId(input: {
  adapterConfig?: Record<string, unknown>;
  localModel?: string;
}): string {
  const configModel = input.adapterConfig?.model;
  if (typeof configModel === "string" && configModel.trim()) {
    return configModel.trim();
  }
  if (input.localModel?.trim()) {
    return input.localModel.trim();
  }
  return "unknown";
}

function getPaperclipClientConfig(env: NodeJS.ProcessEnv = process.env): PaperclipClientConfig | null {
  const apiUrl = env.PAPERCLIP_API_URL?.trim();
  const apiKey = env.PAPERCLIP_API_KEY?.trim();
  if (!apiUrl || !apiKey) {
    return null;
  }
  return {
    apiUrl: apiUrl.replace(/\/+$/, ""),
    apiKey,
  };
}

async function paperclipRequest<T>(
  config: PaperclipClientConfig,
  path: string,
  input?: {
    method?: "GET" | "PATCH";
    body?: unknown;
  }
): Promise<T> {
  const response = await fetch(`${config.apiUrl}${path}`, {
    method: input?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: input?.body === undefined ? undefined : JSON.stringify(input.body),
    cache: "no-store",
  });

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as { error?: { message?: string; code?: string } }) : {};

  if (!response.ok) {
    const message = payload.error?.message ?? payload.error?.code ?? `Paperclip request failed (${response.status})`;
    throw new OrchestrationApiError(
      response.status,
      "paperclip_bridge_error",
      `Paperclip API request failed: ${message}`
    );
  }

  return (text ? JSON.parse(text) : null) as T;
}

function resolveCompany(companyIdOrSlug: string): { id: string; slug: string; name: string } {
  const db = getOrchestrationDb();
  const row = db
    .prepare(
      `SELECT id, slug, name
       FROM companies
       WHERE archived_at IS NULL
         AND (id = ? OR slug = ?)
       LIMIT 1`
    )
    .get(companyIdOrSlug, companyIdOrSlug) as
    | {
        id: string;
        slug: string;
        name: string;
      }
    | undefined;

  if (!row) {
    throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  }

  return row;
}

function normalizePaperclipAgents(payload: unknown, companyId: string): PaperclipCompanyAgent[] {
  if (!Array.isArray(payload)) return [];

  const mapped: Array<PaperclipCompanyAgent | null> = payload.map((candidate) => {
    const row = asRecord(candidate);
    if (!row) return null;

    const id = String(row.id ?? "").trim();
    const name = String(row.name ?? "").trim();
    if (!id || !name) return null;

    const normalized: PaperclipCompanyAgent = {
      id,
      companyId: String(row.companyId ?? companyId),
      name,
      role: typeof row.role === "string" ? row.role : undefined,
      title: typeof row.title === "string" ? row.title : undefined,
      status: typeof row.status === "string" ? row.status : "unknown",
      adapterType: typeof row.adapterType === "string" ? row.adapterType : undefined,
      adapterConfig: asRecord(row.adapterConfig) ?? undefined,
      runtimeConfig: asRecord(row.runtimeConfig) ?? undefined,
      pauseReason: typeof row.pauseReason === "string" ? row.pauseReason : null,
      pausedAt: typeof row.pausedAt === "string" ? row.pausedAt : null,
      lastHeartbeatAt: typeof row.lastHeartbeatAt === "string" ? row.lastHeartbeatAt : null,
    };
    return normalized;
  });

  return mapped.filter((row): row is PaperclipCompanyAgent => row !== null);
}

function buildReadModel(input: {
  localAgents: LocalAgent[];
  paperclipAgents: PaperclipCompanyAgent[];
  writeSupportReason?: string;
}): ExecutionSettingsRowWithRemote[] {
  const byPaperclipId = new Map<string, LocalAgent>();
  const byName = new Map<string, LocalAgent>();

  for (const agent of input.localAgents) {
    if (agent.paperclipAgentId) {
      byPaperclipId.set(agent.paperclipAgentId, agent);
    }
    byName.set(agent.name.trim().toLowerCase(), agent);
  }

  const rows: ExecutionSettingsRowWithRemote[] = [];
  const seen = new Set<string>();

  for (const remote of input.paperclipAgents) {
    const local = byPaperclipId.get(remote.id) ?? byName.get(remote.name.trim().toLowerCase());
    const status = remote.status.trim().toLowerCase();
    const isPaused = status === "paused" || Boolean(remote.pausedAt);
    const canUpdate = !input.writeSupportReason;
    const execution = parseExecutionRuntime(remote.runtimeConfig, remote.adapterConfig);

    rows.push({
      agentId: local?.id ?? remote.id,
      paperclipAgentId: remote.id,
      name: remote.name,
      role: remote.title ?? remote.role ?? local?.role,
      adapterType: remote.adapterType,
      modelId: resolveModelId({
        adapterConfig: remote.adapterConfig,
        localModel: local?.model,
      }),
      lastHeartbeatAt: remote.lastHeartbeatAt ?? local?.lastHeartbeat,
      timeoutSeconds: execution.timeoutSeconds,
      graceSeconds: execution.graceSeconds,
      pauseStatus: {
        isPaused,
        status,
        reason: remote.pauseReason ?? undefined,
        pausedAt: remote.pausedAt ?? undefined,
      },
      safeRuntimeConfig: parseSafeRuntimeSummary(remote.runtimeConfig),
      canUpdate,
      updateBlocker: canUpdate ? undefined : input.writeSupportReason,
      remote,
    });

    seen.add(local?.id ?? remote.id);
  }

  for (const local of input.localAgents) {
    if (seen.has(local.id)) continue;

    rows.push({
      agentId: local.id,
      paperclipAgentId: local.paperclipAgentId,
      name: local.name,
      role: local.role,
      adapterType: undefined,
      modelId: resolveModelId({ localModel: local.model }),
      lastHeartbeatAt: local.lastHeartbeat,
      timeoutSeconds: null,
      graceSeconds: null,
      pauseStatus: {
        isPaused: false,
        status: "unknown",
      },
      safeRuntimeConfig: {},
      canUpdate: false,
      updateBlocker: "Agent is not linked to Paperclip control plane",
      remote: null,
    });
  }

  return rows.sort((left, right) => left.name.localeCompare(right.name));
}

function toPublicRow(row: ExecutionSettingsRowWithRemote): ExecutionSettingsRow {
  const { remote: _remote, ...publicRow } = row;
  return publicRow;
}

async function fetchPaperclipCompanyAgents(
  companyId: string,
  config: PaperclipClientConfig
): Promise<PaperclipCompanyAgent[]> {
  const payload = await paperclipRequest<unknown>(
    config,
    `/api/companies/${encodeURIComponent(companyId)}/agents`
  );
  return normalizePaperclipAgents(payload, companyId);
}

function deepCloneRecord<T extends Record<string, unknown> | undefined>(value: T): Record<string, unknown> {
  if (!value) return {};
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

export async function listCompanyExecutionSettings(input: {
  companyIdOrSlug: string;
  includeNonProduction?: boolean;
}): Promise<CompanyExecutionSettingsView> {
  const company = resolveCompany(input.companyIdOrSlug);
  const localAgents = listCompanyAgents(company.id, {
    includeNonProduction: input.includeNonProduction,
  }).agents as LocalAgent[];

  const config = getPaperclipClientConfig();
  const writeSupportReason = config
    ? undefined
    : "Paperclip bridge credentials are not configured in this runtime";

  let paperclipAgents: PaperclipCompanyAgent[] = [];

  if (config) {
    try {
      paperclipAgents = await fetchPaperclipCompanyAgents(company.id, config);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new OrchestrationApiError(
        502,
        "paperclip_agents_unavailable",
        "Unable to load execution settings from Paperclip",
        { cause: message }
      );
    }
  }

  const rows = buildReadModel({
    localAgents,
    paperclipAgents,
    writeSupportReason,
  });

  return {
    company,
    writeSupport: {
      supported: !writeSupportReason,
      reason: writeSupportReason,
    },
    agents: rows.map(toPublicRow),
  };
}

export async function updateCompanyExecutionSettings(input: {
  companyIdOrSlug: string;
  agentId: string;
  modelId?: string;
  timeoutSeconds?: number;
  graceSeconds?: number;
}): Promise<CompanyExecutionSettingsUpdateResult> {
  const config = getPaperclipClientConfig();
  if (!config) {
    throw new OrchestrationApiError(
      409,
      "execution_settings_read_only",
      "Execution settings are read-only because Paperclip bridge credentials are missing"
    );
  }

  const company = resolveCompany(input.companyIdOrSlug);
  const localAgents = listCompanyAgents(company.id, {
    includeNonProduction: true,
  }).agents as LocalAgent[];

  const paperclipAgents = await fetchPaperclipCompanyAgents(company.id, config);
  const rows = buildReadModel({
    localAgents,
    paperclipAgents,
  });

  const target = rows.find(
    (agent) =>
      agent.agentId === input.agentId ||
      agent.paperclipAgentId === input.agentId
  );

  if (!target) {
    throw new OrchestrationApiError(404, "agent_not_found", "Agent not found in company scope");
  }

  if (!target.paperclipAgentId || !target.remote) {
    throw new OrchestrationApiError(
      409,
      "execution_settings_read_only",
      "Agent is not linked to Paperclip and cannot receive execution setting updates"
    );
  }

  const shouldPatchModel = input.modelId !== undefined;
  const shouldPatchRuntime = input.timeoutSeconds !== undefined || input.graceSeconds !== undefined;

  const patchBody: Record<string, unknown> = {};

  if (shouldPatchModel) {
    const nextAdapterConfig = deepCloneRecord(target.remote.adapterConfig);
    nextAdapterConfig.model = input.modelId;
    patchBody.adapterConfig = nextAdapterConfig;
  }

  if (shouldPatchRuntime) {
    const nextRuntimeConfig = deepCloneRecord(target.remote.runtimeConfig);
    const execution = asRecord(nextRuntimeConfig.execution) ?? {};
    if (input.timeoutSeconds !== undefined) {
      execution.timeoutSec = input.timeoutSeconds;
    }
    if (input.graceSeconds !== undefined) {
      execution.graceSec = input.graceSeconds;
    }
    nextRuntimeConfig.execution = execution;
    patchBody.runtimeConfig = nextRuntimeConfig;
  }

  try {
    await paperclipRequest(
      config,
      `/api/agents/${encodeURIComponent(target.paperclipAgentId)}`,
      {
        method: "PATCH",
        body: patchBody,
      }
    );
  } catch (error) {
    if (error instanceof OrchestrationApiError && (error.status === 401 || error.status === 403)) {
      throw new OrchestrationApiError(
        403,
        "execution_settings_update_forbidden",
        "Current control plane permissions do not allow updating execution settings"
      );
    }

    throw error;
  }

  const updated: ExecutionSettingsRow = {
    ...toPublicRow(target),
    modelId: input.modelId ?? target.modelId,
    timeoutSeconds: input.timeoutSeconds ?? target.timeoutSeconds,
    graceSeconds: input.graceSeconds ?? target.graceSeconds,
  };

  return {
    company,
    agent: updated,
    updatedAt: new Date().toISOString(),
  };
}
