import type Database from "better-sqlite3";

import { OrchestrationApiError } from "@/lib/orchestration/api";
import {
  AVAILABLE_MODEL_CAPABILITIES,
  AVAILABLE_MODEL_PROVIDERS,
  type AvailableModel,
  type AvailableModelCapability,
  type AvailableModelRefreshStatus,
  type AvailableModelProvider,
} from "@/lib/orchestration/available-models";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import type { RoutingLane } from "@/lib/orchestration/execution-hives";

type AvailableModelRow = {
  id: string;
  display_name: string;
  runtime_provider: string;
  default_runtime_label: string;
  model_source_id: string;
  capabilities_json: string;
  context_window: number | null;
  description: string | null;
  is_seed: number;
  is_active: number;
  created_at: string;
  updated_at: string;
};

type ActiveHiveLanesRow = {
  lanes_json: string | null;
};

type AvailableModelRefreshStatusRow = {
  provider: string;
  status: string;
  refreshed_at: string;
  model_count: number;
  message: string | null;
};

export type ListAvailableModelsInput = {
  provider?: string | null;
  capability?: string | null;
  includeInactive?: boolean;
};

export type CreateAvailableModelInput = {
  id: string;
  displayName: string;
  runtimeProvider: AvailableModelProvider;
  defaultRuntimeLabel: string;
  modelSourceId: string;
  capabilities?: AvailableModelCapability[];
  contextWindow?: number | null;
  description?: string | null;
};

export type UpdateAvailableModelInput = {
  displayName?: string;
  defaultRuntimeLabel?: string;
  modelSourceId?: string;
  capabilities?: AvailableModelCapability[];
  contextWindow?: number | null;
  description?: string | null;
  isActive?: boolean;
};

export type RuntimeCatalogModelInput = {
  id: string;
  displayName: string;
  runtimeProvider: AvailableModelProvider;
  defaultRuntimeLabel: string;
  modelSourceId: string;
  capabilities?: AvailableModelCapability[];
  contextWindow?: number | null;
  description?: string | null;
};

export type RecordAvailableModelRefreshStatusInput = {
  provider: AvailableModelProvider;
  status: AvailableModelRefreshStatus["status"];
  modelCount: number;
  message?: string | null;
  refreshedAt?: string;
};

function parseCapabilities(value: string): AvailableModelCapability[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is AvailableModelCapability =>
          AVAILABLE_MODEL_CAPABILITIES.includes(item as AvailableModelCapability)
        )
      : [];
  } catch {
    return [];
  }
}

function normalizeCapabilities(value: unknown): AvailableModelCapability[] {
  const input = Array.isArray(value) ? value : [];
  return Array.from(new Set(input.filter((item): item is AvailableModelCapability =>
    AVAILABLE_MODEL_CAPABILITIES.includes(item as AvailableModelCapability)
  )));
}

function normalizeProvider(value: unknown): AvailableModelProvider {
  if (AVAILABLE_MODEL_PROVIDERS.includes(value as AvailableModelProvider)) {
    return value as AvailableModelProvider;
  }
  throw new OrchestrationApiError(
    422,
    "available_model_provider_invalid",
    `Unsupported model provider: ${String(value ?? "")}`,
  );
}

function normalizeText(value: unknown, field: string, max = 240): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new OrchestrationApiError(422, "available_model_field_required", `${field} is required.`);
  }
  if (normalized.length > max) {
    throw new OrchestrationApiError(422, "available_model_field_too_long", `${field} must be ${max} characters or less.`);
  }
  return normalized;
}

function rowToModel(row: AvailableModelRow): AvailableModel {
  return {
    id: row.id,
    displayName: row.display_name,
    runtimeProvider: row.runtime_provider as AvailableModelProvider,
    defaultRuntimeLabel: row.default_runtime_label,
    modelSourceId: row.model_source_id,
    capabilities: parseCapabilities(row.capabilities_json),
    contextWindow: row.context_window,
    description: row.description,
    isSeed: row.is_seed === 1,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToRefreshStatus(row: AvailableModelRefreshStatusRow): AvailableModelRefreshStatus {
  return {
    provider: row.provider as AvailableModelProvider,
    status: row.status as AvailableModelRefreshStatus["status"],
    refreshedAt: row.refreshed_at,
    modelCount: row.model_count,
    message: row.message,
  };
}

function modelReferencesLane(modelId: string, lane: RoutingLane): boolean {
  return [lane.primary, ...lane.fallbacks].some((target) => target.modelId === modelId || target.modelLabel === modelId);
}

function countActiveLaneReferences(db: Database.Database, modelId: string): number {
  const rows = db
    .prepare(
      `SELECT lanes_json
       FROM company_execution_hives
       WHERE archived_at IS NULL
         AND is_active = 1`,
    )
    .all() as ActiveHiveLanesRow[];
  let count = 0;
  for (const row of rows) {
    try {
      const lanes = JSON.parse(row.lanes_json ?? "[]") as RoutingLane[];
      for (const lane of lanes) {
        if (modelReferencesLane(modelId, lane)) count += 1;
      }
    } catch {
      // Corrupt lane JSON is handled by hive validation elsewhere. Do not block catalog reads here.
    }
  }
  return count;
}

export function listAvailableModels(
  input: ListAvailableModelsInput = {},
  db = getOrchestrationDb(),
): AvailableModel[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (!input.includeInactive) {
    clauses.push("is_active = 1");
  }
  if (input.provider) {
    clauses.push("runtime_provider = ?");
    params.push(normalizeProvider(input.provider));
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db
    .prepare(
      `SELECT *
       FROM available_models
       ${where}
       ORDER BY runtime_provider ASC, display_name ASC`,
    )
    .all(...params) as AvailableModelRow[];
  const models = rows.map(rowToModel);
  if (!input.capability) return models;
  const capability = input.capability as AvailableModelCapability;
  if (!AVAILABLE_MODEL_CAPABILITIES.includes(capability)) return [];
  return models.filter((model) => model.capabilities.includes(capability));
}

export function createAvailableModel(
  input: CreateAvailableModelInput,
  db = getOrchestrationDb(),
): AvailableModel {
  const id = normalizeText(input.id, "Model ID", 160);
  const provider = normalizeProvider(input.runtimeProvider);
  const capabilities = normalizeCapabilities(input.capabilities);
  const now = new Date().toISOString();
  try {
    db.prepare(
      `INSERT INTO available_models (
         id, display_name, runtime_provider, default_runtime_label, model_source_id,
         capabilities_json, context_window, description, is_seed, is_active, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)`,
    ).run(
      id,
      normalizeText(input.displayName, "Display name"),
      provider,
      normalizeText(input.defaultRuntimeLabel, "Runtime label", 120),
      normalizeText(input.modelSourceId, "Model source", 120),
      JSON.stringify(capabilities),
      input.contextWindow ?? null,
      input.description?.trim() || null,
      now,
      now,
    );
  } catch (error) {
    if (String(error).includes("UNIQUE") || String(error).includes("PRIMARY")) {
      throw new OrchestrationApiError(409, "available_model_exists", `Model ${id} already exists.`);
    }
    throw error;
  }
  return getAvailableModelOrThrow(id, db);
}

export function updateAvailableModel(
  id: string,
  input: UpdateAvailableModelInput,
  db = getOrchestrationDb(),
): AvailableModel {
  const model = getAvailableModelOrThrow(id, db);
  const next = {
    displayName: input.displayName !== undefined ? normalizeText(input.displayName, "Display name") : model.displayName,
    defaultRuntimeLabel: input.defaultRuntimeLabel !== undefined ? normalizeText(input.defaultRuntimeLabel, "Runtime label", 120) : model.defaultRuntimeLabel,
    modelSourceId: input.modelSourceId !== undefined ? normalizeText(input.modelSourceId, "Model source", 120) : model.modelSourceId,
    capabilities: input.capabilities !== undefined ? normalizeCapabilities(input.capabilities) : model.capabilities,
    contextWindow: input.contextWindow !== undefined ? input.contextWindow : model.contextWindow,
    description: input.description !== undefined ? input.description?.trim() || null : model.description,
    isActive: input.isActive !== undefined ? input.isActive : model.isActive,
  };
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE available_models
     SET display_name = ?,
         default_runtime_label = ?,
         model_source_id = ?,
         capabilities_json = ?,
         context_window = ?,
         description = ?,
         is_active = ?,
         updated_at = ?
     WHERE id = ?`,
  ).run(
    next.displayName,
    next.defaultRuntimeLabel,
    next.modelSourceId,
    JSON.stringify(next.capabilities),
    next.contextWindow ?? null,
    next.description,
    next.isActive ? 1 : 0,
    now,
    id,
  );
  return getAvailableModelOrThrow(id, db);
}

export function deleteAvailableModel(
  id: string,
  db = getOrchestrationDb(),
): AvailableModel {
  const model = getAvailableModelOrThrow(id, db);
  const referenceCount = countActiveLaneReferences(db, id);
  if (referenceCount > 0) {
    throw new OrchestrationApiError(
      409,
      "available_model_in_use",
      `Model is in use by ${referenceCount} lane(s). Remove it from active hives before deleting.`,
    );
  }
  db.prepare("UPDATE available_models SET is_active = 0, updated_at = ? WHERE id = ?").run(
    new Date().toISOString(),
    id,
  );
  return { ...model, isActive: false };
}

export function getAvailableModelOrThrow(
  id: string,
  db = getOrchestrationDb(),
): AvailableModel {
  const row = db
    .prepare("SELECT * FROM available_models WHERE id = ? LIMIT 1")
    .get(id) as AvailableModelRow | undefined;
  if (!row) {
    throw new OrchestrationApiError(404, "available_model_not_found", `Model ${id} was not found.`);
  }
  return rowToModel(row);
}

export function upsertRuntimeCatalogModels(
  provider: AvailableModelProvider,
  models: RuntimeCatalogModelInput[],
  db = getOrchestrationDb(),
): AvailableModel[] {
  const normalizedProvider = normalizeProvider(provider);
  const now = new Date().toISOString();
  const saved: AvailableModel[] = [];
  const upsert = db.prepare(
    `INSERT INTO available_models (
       id, display_name, runtime_provider, default_runtime_label, model_source_id,
       capabilities_json, context_window, description, is_seed, is_active, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       display_name = CASE WHEN available_models.is_seed = 1 THEN excluded.display_name ELSE available_models.display_name END,
       runtime_provider = CASE WHEN available_models.is_seed = 1 THEN excluded.runtime_provider ELSE available_models.runtime_provider END,
       default_runtime_label = CASE WHEN available_models.is_seed = 1 THEN excluded.default_runtime_label ELSE available_models.default_runtime_label END,
       model_source_id = CASE WHEN available_models.is_seed = 1 THEN excluded.model_source_id ELSE available_models.model_source_id END,
       capabilities_json = CASE WHEN available_models.is_seed = 1 THEN excluded.capabilities_json ELSE available_models.capabilities_json END,
       context_window = CASE WHEN available_models.is_seed = 1 THEN excluded.context_window ELSE available_models.context_window END,
       description = CASE WHEN available_models.is_seed = 1 THEN excluded.description ELSE available_models.description END,
       updated_at = CASE WHEN available_models.is_seed = 1 THEN excluded.updated_at ELSE available_models.updated_at END`,
  );

  const tx = db.transaction(() => {
    for (const model of models) {
      if (normalizeProvider(model.runtimeProvider) !== normalizedProvider) continue;
      const id = normalizeText(model.id, "Model ID", 160);
      upsert.run(
        id,
        normalizeText(model.displayName, "Display name"),
        normalizedProvider,
        normalizeText(model.defaultRuntimeLabel, "Runtime label", 120),
        normalizeText(model.modelSourceId, "Model source", 120),
        JSON.stringify(normalizeCapabilities(model.capabilities)),
        model.contextWindow ?? null,
        model.description?.trim() || null,
        now,
        now,
      );
      saved.push(getAvailableModelOrThrow(id, db));
    }
  });
  tx();
  return saved;
}

export function recordAvailableModelRefreshStatus(
  input: RecordAvailableModelRefreshStatusInput,
  db = getOrchestrationDb(),
): AvailableModelRefreshStatus {
  const provider = normalizeProvider(input.provider);
  const refreshedAt = input.refreshedAt ?? new Date().toISOString();
  db.prepare(
    `INSERT INTO available_model_refresh_status (provider, status, refreshed_at, model_count, message)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(provider) DO UPDATE SET
       status = excluded.status,
       refreshed_at = excluded.refreshed_at,
       model_count = excluded.model_count,
       message = excluded.message`,
  ).run(provider, input.status, refreshedAt, input.modelCount, input.message ?? null);
  return {
    provider,
    status: input.status,
    refreshedAt,
    modelCount: input.modelCount,
    message: input.message ?? null,
  };
}

export function listAvailableModelRefreshStatuses(
  db = getOrchestrationDb(),
): AvailableModelRefreshStatus[] {
  const rows = db
    .prepare("SELECT * FROM available_model_refresh_status ORDER BY provider ASC")
    .all() as AvailableModelRefreshStatusRow[];
  return rows.map(rowToRefreshStatus);
}
