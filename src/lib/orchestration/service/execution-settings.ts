import { OrchestrationApiError } from "@/lib/orchestration/api";
import { resolveCompanyIdBySlug } from "@/lib/orchestration/company-service";
import { listCompanyAgents } from "@/lib/orchestration/service/agent";
import { getOrchestrationDb } from "@/lib/orchestration/service/shared";

type LocalAgent = {
  id: string;
  name: string;
  role: string;
  model?: string;
  lastHeartbeat?: string;
};

type ExecutionSettingsRow = {
  agentId: string;
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
  safeRuntimeConfig: {
    heartbeatEnabled?: boolean;
    heartbeatIntervalSeconds?: number;
    executionProvider?: string;
    openclawAgentId?: string;
  };
  canUpdate: boolean;
  updateBlocker?: string;
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

function resolveCompany(companyIdOrSlug: string): { id: string; slug: string; name: string } {
  const db = getOrchestrationDb();
  const row = resolveCompanyIdBySlug(companyIdOrSlug, db);

  if (!row) {
    throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  }

  return row;
}

function resolveModelId(agent: LocalAgent): string {
  return agent.model?.trim() || "runtime-managed";
}

function buildReadModel(localAgents: LocalAgent[]): ExecutionSettingsRow[] {
  return localAgents
    .map((agent) => ({
      agentId: agent.id,
      name: agent.name,
      role: agent.role,
      adapterType: undefined,
      modelId: resolveModelId(agent),
      lastHeartbeatAt: agent.lastHeartbeat,
      timeoutSeconds: null,
      graceSeconds: null,
      pauseStatus: {
        isPaused: false,
        status: "local",
      },
      safeRuntimeConfig: {},
      canUpdate: false,
      updateBlocker: "Execution settings are managed by HiveRunner local runtime configuration.",
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function listCompanyExecutionSettings(input: {
  companyIdOrSlug: string;
  includeNonProduction?: boolean;
}): Promise<CompanyExecutionSettingsView> {
  const company = resolveCompany(input.companyIdOrSlug);
  const localAgents = listCompanyAgents(company.id, {
    includeNonProduction: input.includeNonProduction,
  }).agents as LocalAgent[];

  return {
    company,
    writeSupport: {
      supported: false,
      reason: "Execution settings are managed by HiveRunner local runtime configuration.",
    },
    agents: buildReadModel(localAgents),
  };
}

export async function updateCompanyExecutionSettings(
  input: {
    companyIdOrSlug: string;
    agentId: string;
    modelId?: string;
    timeoutSeconds?: number;
    graceSeconds?: number;
  }
): Promise<CompanyExecutionSettingsUpdateResult> {
  void input;
  throw new OrchestrationApiError(
    410,
    "execution_settings_external_update_removed",
    "External execution setting updates are no longer supported. Configure local runtime settings in HiveRunner."
  );
}
