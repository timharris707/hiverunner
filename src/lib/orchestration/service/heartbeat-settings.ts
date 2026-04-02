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

type PaperclipHeartbeatPolicy = {
  enabled: boolean;
  intervalSeconds: number;
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

type HeartbeatSettingsRow = {
  agentId: string;
  paperclipAgentId?: string;
  name: string;
  role?: string;
  heartbeatEnabled: boolean;
  intervalSeconds: number;
  schedulerActive: boolean;
  lastHeartbeatAt?: string;
  modelSummary: string;
  pauseStatus: {
    isPaused: boolean;
    status: string;
    reason?: string;
    pausedAt?: string;
  };
  canUpdate: boolean;
  updateBlocker?: string;
};

export type CompanyHeartbeatSettingsView = {
  company: {
    id: string;
    slug: string;
    name: string;
  };
  writeSupport: {
    supported: boolean;
    reason?: string;
  };
  agents: HeartbeatSettingsRow[];
};

export type CompanyHeartbeatSettingsUpdateResult = {
  company: {
    id: string;
    slug: string;
    name: string;
  };
  agent: HeartbeatSettingsRow;
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

function parseHeartbeatPolicy(runtimeConfig: unknown): PaperclipHeartbeatPolicy {
  const heartbeat = asRecord(asRecord(runtimeConfig)?.heartbeat) ?? {};
  return {
    enabled: parseBooleanLike(heartbeat.enabled) ?? true,
    intervalSeconds: Math.max(0, Math.trunc(parseNumberLike(heartbeat.intervalSec) ?? 0)),
  };
}

function modelSummary(input: {
  adapterType?: string;
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
  if (input.adapterType?.trim()) {
    return `${input.adapterType.trim()} (model not exposed)`;
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
}): HeartbeatSettingsRow[] {
  const byPaperclipId = new Map<string, LocalAgent>();
  const byName = new Map<string, LocalAgent>();

  for (const agent of input.localAgents) {
    if (agent.paperclipAgentId) {
      byPaperclipId.set(agent.paperclipAgentId, agent);
    }
    byName.set(agent.name.trim().toLowerCase(), agent);
  }

  const rows: HeartbeatSettingsRow[] = [];
  const seen = new Set<string>();

  for (const remote of input.paperclipAgents) {
    const local = byPaperclipId.get(remote.id) ?? byName.get(remote.name.trim().toLowerCase());
    const policy = parseHeartbeatPolicy(remote.runtimeConfig);
    const status = remote.status.trim().toLowerCase();
    const isPaused = status === "paused" || Boolean(remote.pausedAt);
    const canUpdate = !input.writeSupportReason;

    rows.push({
      agentId: local?.id ?? remote.id,
      paperclipAgentId: remote.id,
      name: remote.name,
      role: remote.title ?? remote.role ?? local?.role,
      heartbeatEnabled: policy.enabled,
      intervalSeconds: policy.intervalSeconds,
      schedulerActive:
        policy.enabled &&
        policy.intervalSeconds > 0 &&
        status !== "paused" &&
        status !== "terminated" &&
        status !== "pending_approval",
      lastHeartbeatAt: remote.lastHeartbeatAt ?? local?.lastHeartbeat,
      modelSummary: modelSummary({
        adapterType: remote.adapterType,
        adapterConfig: remote.adapterConfig,
        localModel: local?.model,
      }),
      pauseStatus: {
        isPaused,
        status,
        reason: remote.pauseReason ?? undefined,
        pausedAt: remote.pausedAt ?? undefined,
      },
      canUpdate,
      updateBlocker: canUpdate ? undefined : input.writeSupportReason,
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
      heartbeatEnabled: true,
      intervalSeconds: 0,
      schedulerActive: false,
      lastHeartbeatAt: local.lastHeartbeat,
      modelSummary: modelSummary({ localModel: local.model }),
      pauseStatus: {
        isPaused: false,
        status: "unknown",
      },
      canUpdate: false,
      updateBlocker: "Agent is not linked to Paperclip control plane",
    });
  }

  return rows.sort((left, right) => left.name.localeCompare(right.name));
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

export async function listCompanyHeartbeatSettings(input: {
  companyIdOrSlug: string;
  includeNonProduction?: boolean;
}): Promise<CompanyHeartbeatSettingsView> {
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
        "Unable to load heartbeat settings from Paperclip",
        { cause: message }
      );
    }
  }

  return {
    company,
    writeSupport: {
      supported: !writeSupportReason,
      reason: writeSupportReason,
    },
    agents: buildReadModel({
      localAgents,
      paperclipAgents,
      writeSupportReason,
    }),
  };
}

export async function updateCompanyHeartbeatSettings(input: {
  companyIdOrSlug: string;
  agentId: string;
  heartbeatEnabled?: boolean;
  intervalSeconds?: number;
}): Promise<CompanyHeartbeatSettingsUpdateResult> {
  const config = getPaperclipClientConfig();
  if (!config) {
    throw new OrchestrationApiError(
      409,
      "heartbeat_settings_read_only",
      "Heartbeat settings are read-only because Paperclip bridge credentials are missing"
    );
  }

  const view = await listCompanyHeartbeatSettings({
    companyIdOrSlug: input.companyIdOrSlug,
    includeNonProduction: true,
  });

  const target = view.agents.find(
    (agent) =>
      agent.agentId === input.agentId ||
      agent.paperclipAgentId === input.agentId
  );

  if (!target) {
    throw new OrchestrationApiError(404, "agent_not_found", "Agent not found in company scope");
  }

  if (!target.paperclipAgentId) {
    throw new OrchestrationApiError(
      409,
      "heartbeat_settings_read_only",
      "Agent is not linked to Paperclip and cannot receive heartbeat setting updates"
    );
  }

  const nextEnabled = input.heartbeatEnabled ?? target.heartbeatEnabled;
  const nextInterval = input.intervalSeconds ?? target.intervalSeconds;

  const nextRuntimeConfig: Record<string, unknown> = {
    heartbeat: {
      enabled: nextEnabled,
      intervalSec: nextInterval,
    },
  };

  try {
    await paperclipRequest(
      config,
      `/api/agents/${encodeURIComponent(target.paperclipAgentId)}`,
      {
        method: "PATCH",
        body: {
          runtimeConfig: nextRuntimeConfig,
        },
      }
    );
  } catch (error) {
    if (error instanceof OrchestrationApiError && (error.status === 401 || error.status === 403)) {
      throw new OrchestrationApiError(
        403,
        "heartbeat_settings_update_forbidden",
        "Current control plane permissions do not allow updating heartbeat settings"
      );
    }

    throw error;
  }

  return {
    company: view.company,
    agent: {
      ...target,
      heartbeatEnabled: nextEnabled,
      intervalSeconds: nextInterval,
      schedulerActive:
        nextEnabled &&
        nextInterval > 0 &&
        target.pauseStatus.status !== "paused" &&
        target.pauseStatus.status !== "terminated" &&
        target.pauseStatus.status !== "pending_approval",
    },
    updatedAt: new Date().toISOString(),
  };
}
