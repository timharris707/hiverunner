import type Database from "better-sqlite3";

import { OrchestrationApiError } from "@/lib/orchestration/api";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { syncAgentCoreFiles } from "@/lib/orchestration/agent-core-files";
import { recordCompanyAuditEvent } from "@/lib/orchestration/service/audit";

const REASONING_EFFORTS = new Set(["minimal", "low", "medium", "high", "xhigh"]);
const ANTHROPIC_REASONING_EFFORTS = new Set([...REASONING_EFFORTS, "max"]);
const MODEL_LANES = new Set(["default", "fast", "mini", "deep"]);
const SPEED_PREFERENCES = new Set([
  "fast",
  "faster",
  "fast_1_5x",
  "fast-1.5x",
  "1.5x",
  "low_latency",
  "low-latency",
  "normal",
  "standard",
  "balanced",
]);
const SERVICE_TIERS = new Set(["default", "fast"]);

const SAFE_RUNTIME_CONFIG_KEYS = new Set([
  "modelLane",
  "reasoningEffort",
  "modelReasoningEffort",
  "thinkingLevel",
  "speedPreference",
  "speed",
  "thinkingSpeed",
  "fastMode",
  "serviceTier",
]);

const SAFE_RUNTIME_METADATA_KEYS = new Set([
  "model",
  "modelId",
  "modelLane",
  "reasoningEffort",
  "modelReasoningEffort",
  "thinkingLevel",
  "speedPreference",
  "speed",
  "thinkingSpeed",
  "fastMode",
  "serviceTier",
]);

export type AgentRuntimeUpdateAction = {
  action: "update_agent";
  companySlug?: string;
  companyId?: string;
  agentId?: string;
  agentName?: string;
  changes?: {
    model?: string | null;
    runtimeConfig?: Record<string, unknown>;
    runtimeMetadataPatch?: Record<string, unknown>;
  };
  reason?: string;
};

export type ApprovedAgentRuntimeUpdateResult = {
  applied: true;
  agentId: string;
  agentName: string;
  changedFields: string[];
  coreFiles: { synced: boolean; root: string | null };
};

function parseRecordJson(raw: string | null): Record<string, unknown> {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeOptionalText(value: unknown, maxLength: number): string | null | undefined {
  if (value === null) return null;
  if (value === undefined) return undefined;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function normalizeOptionalEnumText(value: unknown, maxLength: number): string | null | undefined {
  const normalized = normalizeOptionalText(value, maxLength);
  return typeof normalized === "string" ? normalized.toLowerCase() : normalized;
}

function isAnthropicProvider(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "anthropic" || normalized === "claude" || normalized === "claude-code";
}

function sanitizePatch(input: {
  patch: Record<string, unknown>;
  allowedKeys: Set<string>;
  label: string;
  allowAnthropicMaxReasoning: boolean;
}): { patch: Record<string, unknown>; fields: string[] } {
  const patch: Record<string, unknown> = {};
  const fields: string[] = [];

  for (const [key, rawValue] of Object.entries(input.patch)) {
    if (!input.allowedKeys.has(key)) {
      throw new OrchestrationApiError(400, "unsafe_agent_update_field", `${input.label}.${key} is not an approved Overseer update field`);
    }

    if (key === "reasoningEffort" || key === "modelReasoningEffort" || key === "thinkingLevel") {
      const value = normalizeOptionalEnumText(rawValue, 40);
      const allowedReasoning = input.allowAnthropicMaxReasoning ? ANTHROPIC_REASONING_EFFORTS : REASONING_EFFORTS;
      if (value === undefined || (value !== null && !allowedReasoning.has(value))) {
        const allowedText = input.allowAnthropicMaxReasoning
          ? "minimal, low, medium, high, xhigh, or max"
          : "minimal, low, medium, high, or xhigh";
        throw new OrchestrationApiError(400, "invalid_reasoning_effort", `${input.label}.${key} must be ${allowedText}`);
      }
      patch[key] = value;
      fields.push(`${input.label}.${key}`);
      continue;
    }

    if (key === "modelLane") {
      const value = normalizeOptionalEnumText(rawValue, 40);
      if (value === undefined || (value !== null && !MODEL_LANES.has(value))) {
        throw new OrchestrationApiError(400, "invalid_model_lane", `${input.label}.${key} must be default, fast, mini, or deep`);
      }
      patch[key] = value;
      fields.push(`${input.label}.${key}`);
      continue;
    }

    if (key === "speedPreference" || key === "speed" || key === "thinkingSpeed") {
      const value = normalizeOptionalEnumText(rawValue, 40);
      if (value === undefined || (value !== null && !SPEED_PREFERENCES.has(value))) {
        throw new OrchestrationApiError(400, "invalid_speed_preference", `${input.label}.${key} must be standard, normal, balanced, fast, faster, fast_1_5x, or low_latency`);
      }
      patch[key] = value;
      fields.push(`${input.label}.${key}`);
      continue;
    }

    if (key === "fastMode") {
      if (rawValue !== null && typeof rawValue !== "boolean") {
        throw new OrchestrationApiError(400, "invalid_fast_mode", `${input.label}.${key} must be a boolean or null`);
      }
      patch[key] = rawValue;
      fields.push(`${input.label}.${key}`);
      continue;
    }

    if (key === "serviceTier") {
      const value = normalizeOptionalEnumText(rawValue, 40);
      if (value === undefined || (value !== null && !SERVICE_TIERS.has(value))) {
        throw new OrchestrationApiError(400, "invalid_service_tier", `${input.label}.${key} must be default, fast, or null`);
      }
      patch[key] = value;
      fields.push(`${input.label}.${key}`);
      continue;
    }

    const value = normalizeOptionalText(rawValue, 240);
    if (value === undefined) {
      throw new OrchestrationApiError(400, "invalid_agent_update_value", `${input.label}.${key} must be a string or null`);
    }
    patch[key] = value;
    fields.push(`${input.label}.${key}`);
  }

  return { patch, fields };
}

export function applyApprovedAgentRuntimeUpdate(input: {
  companyId: string;
  action: unknown;
  approvalId?: string | null;
  actorUserId?: string | null;
  db?: Database.Database;
}): ApprovedAgentRuntimeUpdateResult {
  const db = input.db ?? getOrchestrationDb();
  const action = asRecord(input.action);
  if (!action || action.action !== "update_agent") {
    throw new OrchestrationApiError(400, "invalid_agent_update_action", "Approval payload is not an update_agent action");
  }

  const company = db
    .prepare(
      `SELECT id, slug, company_code
       FROM companies
       WHERE archived_at IS NULL
         AND id = ?
       LIMIT 1`,
    )
    .get(input.companyId) as { id: string; slug: string | null; company_code: string | null } | undefined;
  if (!company) throw new OrchestrationApiError(404, "company_not_found", "Company not found");

  const requestedCompany = normalizeOptionalText(action.companySlug ?? action.companyId, 160);
  if (
    requestedCompany &&
    requestedCompany !== company.id &&
    requestedCompany !== company.slug &&
    requestedCompany !== company.company_code
  ) {
    throw new OrchestrationApiError(400, "agent_update_company_mismatch", "update_agent company does not match the approval company");
  }

  const agentId = normalizeOptionalText(action.agentId, 160);
  const agentName = normalizeOptionalText(action.agentName, 160);
  if (!agentId && !agentName) {
    throw new OrchestrationApiError(400, "agent_update_target_required", "update_agent requires agentId or agentName");
  }

  const agent = db
    .prepare(
      `SELECT id, name, model, adapter_type, runtime_config_json
       FROM agents
       WHERE archived_at IS NULL
         AND company_id = ?
         AND (
           id = ?
           OR lower(name) = lower(?)
           OR lower(slug) = lower(?)
           OR openclaw_agent_id = ?
         )
       LIMIT 1`,
    )
    .get(company.id, agentId ?? "", agentName ?? "", agentName ?? "", agentId ?? "") as
      | { id: string; name: string; model: string | null; adapter_type: string | null; runtime_config_json: string | null }
      | undefined;
  if (!agent) throw new OrchestrationApiError(404, "agent_not_found", "Agent not found for update_agent");

  const runtimeProviders = db
    .prepare(
      `SELECT provider
       FROM agent_runtimes
       WHERE company_id = ?
         AND agent_id = ?
         AND scope = 'agent'
         AND status <> 'disabled'`,
    )
    .all(company.id, agent.id) as Array<{ provider: string | null }>;
  const allowAnthropicMaxReasoning =
    isAnthropicProvider(agent.adapter_type) ||
    runtimeProviders.some((runtime) => isAnthropicProvider(runtime.provider));

  const changes = asRecord(action.changes);
  if (!changes) {
    throw new OrchestrationApiError(400, "agent_update_changes_required", "update_agent requires a changes object");
  }

  const runtimeConfigInput = asRecord(changes.runtimeConfig) ?? {};
  const runtimeMetadataInput = asRecord(changes.runtimeMetadataPatch) ?? {};
  const runtimeConfig = sanitizePatch({
    patch: runtimeConfigInput,
    allowedKeys: SAFE_RUNTIME_CONFIG_KEYS,
    label: "runtimeConfig",
    allowAnthropicMaxReasoning,
  });
  const runtimeMetadata = sanitizePatch({
    patch: runtimeMetadataInput,
    allowedKeys: SAFE_RUNTIME_METADATA_KEYS,
    label: "runtimeMetadataPatch",
    allowAnthropicMaxReasoning,
  });

  const model = normalizeOptionalText(changes.model, 240);
  if (changes.model !== undefined && model === undefined) {
    throw new OrchestrationApiError(400, "invalid_agent_model", "changes.model must be a string or null");
  }

  const changedFields = [...runtimeConfig.fields, ...runtimeMetadata.fields];
  if (changes.model !== undefined) changedFields.push("model");
  if (changedFields.length === 0) {
    throw new OrchestrationApiError(400, "agent_update_noop", "update_agent did not include any approved changes");
  }

  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    if (changes.model !== undefined) {
      db.prepare("UPDATE agents SET model = ?, updated_at = ? WHERE id = ?").run(model, now, agent.id);
    }
    if (runtimeConfig.fields.length > 0) {
      db.prepare("UPDATE agents SET runtime_config_json = ?, updated_at = ? WHERE id = ?").run(
        JSON.stringify({
          ...parseRecordJson(agent.runtime_config_json),
          ...runtimeConfig.patch,
        }),
        now,
        agent.id,
      );
    }
    if (runtimeMetadata.fields.length > 0 || changes.model !== undefined) {
      const runtimeRows = db
        .prepare(
          `SELECT id, metadata_json
           FROM agent_runtimes
           WHERE company_id = ?
             AND agent_id = ?
             AND scope = 'agent'`,
        )
        .all(company.id, agent.id) as Array<{ id: string; metadata_json: string | null }>;
      for (const row of runtimeRows) {
        const patch = { ...runtimeMetadata.patch };
        if (changes.model !== undefined) patch.model = model;
        db.prepare("UPDATE agent_runtimes SET metadata_json = ?, updated_at = ? WHERE id = ?").run(
          JSON.stringify({
            ...parseRecordJson(row.metadata_json),
            ...patch,
          }),
          now,
          row.id,
        );
      }
    }
  });
  tx();

  const coreFiles = syncAgentCoreFiles(db, agent.id);
  recordCompanyAuditEvent({
    companyId: company.id,
    agentId: agent.id,
    approvalId: input.approvalId ?? null,
    eventType: "agent.runtime_settings_updated",
    actorUserId: input.actorUserId ?? "operator",
    metadata: {
      source: "approved_update_agent_action",
      reason: typeof action.reason === "string" ? action.reason.slice(0, 1000) : null,
      changedFields,
    },
  }, db);

  return {
    applied: true,
    agentId: agent.id,
    agentName: agent.name,
    changedFields,
    coreFiles,
  };
}
