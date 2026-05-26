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

type HeartbeatSettingsRow = {
  agentId: string;
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

function resolveCompany(companyIdOrSlug: string): { id: string; slug: string; name: string } {
  const db = getOrchestrationDb();
  const row = resolveCompanyIdBySlug(companyIdOrSlug, db);

  if (!row) {
    throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  }

  return row;
}

function modelSummary(agent: LocalAgent): string {
  return agent.model?.trim() || "runtime-managed";
}

function buildReadModel(localAgents: LocalAgent[]): HeartbeatSettingsRow[] {
  return localAgents
    .map((agent) => ({
      agentId: agent.id,
      name: agent.name,
      role: agent.role,
      heartbeatEnabled: false,
      intervalSeconds: 0,
      schedulerActive: false,
      lastHeartbeatAt: agent.lastHeartbeat,
      modelSummary: modelSummary(agent),
      pauseStatus: {
        isPaused: false,
        status: "local",
      },
      canUpdate: false,
      updateBlocker: "Heartbeat settings are managed by HiveRunner local runtime configuration.",
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function listCompanyHeartbeatSettings(input: {
  companyIdOrSlug: string;
  includeNonProduction?: boolean;
}): Promise<CompanyHeartbeatSettingsView> {
  const company = resolveCompany(input.companyIdOrSlug);
  const localAgents = listCompanyAgents(company.id, {
    includeNonProduction: input.includeNonProduction,
  }).agents as LocalAgent[];

  return {
    company,
    writeSupport: {
      supported: false,
      reason: "Heartbeat settings are managed by HiveRunner local runtime configuration.",
    },
    agents: buildReadModel(localAgents),
  };
}

export async function updateCompanyHeartbeatSettings(
  input: {
    companyIdOrSlug: string;
    agentId: string;
    heartbeatEnabled?: boolean;
    intervalSeconds?: number;
  }
): Promise<CompanyHeartbeatSettingsUpdateResult> {
  void input;
  throw new OrchestrationApiError(
    410,
    "heartbeat_settings_external_update_removed",
    "External heartbeat setting updates are no longer supported. Configure local runtime settings in HiveRunner."
  );
}
