import { randomUUID } from "crypto";
import type Database from "better-sqlite3";

import { OrchestrationApiError } from "@/lib/orchestration/api";
import { resolveCompanyIdBySlug } from "@/lib/orchestration/company-service";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import {
  SEEDED_EXECUTION_HIVES,
  type ExecutionHive,
  type ExecutionHiveMatrixConfig,
  type ExecutionHiveProbeKind,
  type ExecutionHiveProbeRuntimeSummary,
  type ExecutionHiveVerification,
  type ExecutionHiveModelRouting,
  type ExecutionHivePreset,
  type ExecutionHiveRuntimeProvider,
  type HiveAutonomy,
  type HiveOptimizeFor,
  type HiveRoutingLaneId,
  type ModelSourceProbeResult,
  type RouteTarget,
  type RoutingLane,
  type VerificationProbeResult,
  type VerificationStatus,
} from "@/lib/orchestration/execution-hives";
import {
  executionRouteRuntimeProviderFromTarget,
} from "@/lib/orchestration/execution-route-resolver";
import {
  detectLocalRuntimeCandidatesFast,
  listCompanyRuntimes,
  probeRuntimeHealth,
  type AgentRuntimeHealth,
  type AgentRuntimeRecord,
  type DetectedLocalRuntime,
} from "@/lib/orchestration/runtime-registry";
import { probeModelSourceCredential } from "@/lib/orchestration/model-source-credentials";
import type { TaskExecutionEngine, TaskModelLane } from "@/lib/orchestration/types";

export type ExecutionHiveDefaults = {
  defaultEngine: TaskExecutionEngine;
  defaultModelLane: TaskModelLane;
  defaultRuntimeProvider: ExecutionHiveRuntimeProvider;
  defaultRuntimeLabel: string;
  defaultModelRouting: ExecutionHiveModelRouting;
  defaultModelRoutingLabel: string;
  activeHiveId: string;
  activeHiveSlug: string;
  activeHiveName: string;
};

export type CompanyExecutionHivesResult = {
  hives: ExecutionHive[];
  activeHive: ExecutionHive | null;
  executionDefaults: Partial<ExecutionHiveDefaults>;
};

export type ActivateCompanyExecutionHiveResult = CompanyExecutionHivesResult & {
  hive: ExecutionHive;
  executionDefaults: ExecutionHiveDefaults;
};

export type ConfigureCompanyExecutionHiveResult = CompanyExecutionHivesResult & {
  hive: ExecutionHive;
  executionDefaults: Partial<ExecutionHiveDefaults>;
};

export type UpdateCompanyExecutionHiveLaneResult = CompanyExecutionHivesResult & {
  hive: ExecutionHive;
  lane: RoutingLane;
  executionDefaults: Partial<ExecutionHiveDefaults>;
};

export type RunCompanyExecutionHiveProbeResult = CompanyExecutionHivesResult & {
  probe: VerificationProbeResult;
  hive: ExecutionHive;
  lane: RoutingLane;
  checkedAt: string;
  runtimeSummary: ExecutionHiveProbeRuntimeSummary;
};

export type RecordCompanyModelSourceProbeResult = CompanyExecutionHivesResult & {
  probe: ModelSourceProbeResult;
};

type HiveRow = {
  id: string;
  company_id: string;
  slug: string;
  name: string;
  description: string;
  preset: string;
  orchestration_mode: string;
  optimize_for: string;
  autonomy: string;
  runtime_priority_json: string | null;
  routing_policy: string;
  lanes_json: string | null;
  verification_json: string | null;
  usage_json: string | null;
  is_recommended: number;
  is_active: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

const VALID_ENGINES = new Set<TaskExecutionEngine>(["hiverunner", "symphony", "manual"]);
const VALID_MODEL_LANES = new Set<TaskModelLane>(["default", "fast", "mini", "deep"]);
const VALID_RUNTIME_PROVIDERS = new Set<ExecutionHiveRuntimeProvider>(["codex", "anthropic", "gemini", "hermes", "openclaw"]);
const VALID_MODEL_ROUTINGS = new Set<ExecutionHiveModelRouting>(["runtime-managed", "hive-managed", "openrouter", "anthropic", "openai", "google"]);

const RUNTIME_LABELS: Record<ExecutionHiveRuntimeProvider, string> = {
  codex: "Codex",
  anthropic: "Claude Code",
  gemini: "Gemini CLI",
  hermes: "Hermes",
  openclaw: "OpenClaw",
};

const RUNTIME_IDS: Record<ExecutionHiveRuntimeProvider, string> = {
  codex: "codex",
  anthropic: "claude-code",
  gemini: "gemini-cli",
  hermes: "hermes",
  openclaw: "openclaw",
};

const MODEL_ROUTING_LABELS: Record<ExecutionHiveModelRouting, string> = {
  "runtime-managed": "Runtime managed",
  "hive-managed": "Hive managed",
  openrouter: "OpenRouter",
  anthropic: "Anthropic Direct",
  openai: "OpenAI Direct",
  google: "Google Direct",
};

const MODEL_SOURCE_LABELS: Partial<Record<ExecutionHiveModelRouting, string>> = {
  openrouter: "OpenRouter",
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google AI",
};

const MODELS_BY_RUNTIME_PROVIDER: Record<ExecutionHiveRuntimeProvider, string[]> = {
  codex: ["gpt-5", "gpt-5-mini", "gpt-4o", "gpt-4o-mini"],
  anthropic: ["claude-sonnet-4-6", "claude-opus-4-7", "claude-haiku-4-5"],
  gemini: ["gemini-2.5-pro", "gemini-2.5-flash"],
  hermes: ["hermes-runtime-managed", "profile managed", "runtime managed"],
  openclaw: ["openclaw-runtime-managed", "platform managed", "runtime managed"],
};

const GENERIC_ROUTE_MODEL_LABELS = new Set([
  "runtime managed",
  "hive managed",
  "direct managed",
  "broker managed",
]);

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function parseRecord(value: string | null | undefined): Record<string, unknown> {
  const parsed = parseJson<Record<string, unknown>>(value, {});
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

function normalizeEngine(value: string): TaskExecutionEngine {
  return VALID_ENGINES.has(value as TaskExecutionEngine) ? value as TaskExecutionEngine : "hiverunner";
}

function normalizeRuntimeLabel(label: string | undefined | null): string {
  const normalized = String(label ?? "").trim().toLowerCase();
  if (normalized.includes("claude") || normalized.includes("anthropic")) return "Claude Code";
  if (normalized.includes("codex")) return "Codex";
  if (normalized.includes("gemini") || normalized.includes("google")) return "Gemini CLI";
  if (normalized.includes("hermes")) return "Hermes";
  if (normalized.includes("openclaw")) return "OpenClaw";
  return String(label ?? "").trim();
}

function runtimeProviderForLabel(label: string | undefined | null): ExecutionHiveRuntimeProvider {
  const normalized = normalizeRuntimeLabel(label).toLowerCase();
  if (normalized.includes("claude")) return "anthropic";
  if (normalized.includes("gemini")) return "gemini";
  if (normalized.includes("hermes")) return "hermes";
  if (normalized.includes("openclaw")) return "openclaw";
  return "codex";
}

function normalizeRuntimeProvider(value: unknown): ExecutionHiveRuntimeProvider {
  return VALID_RUNTIME_PROVIDERS.has(value as ExecutionHiveRuntimeProvider)
    ? value as ExecutionHiveRuntimeProvider
    : "codex";
}

function runtimeLabelForProvider(provider: ExecutionHiveRuntimeProvider, label?: string | null): string {
  const normalized = normalizeRuntimeLabel(label);
  return normalized || RUNTIME_LABELS[provider];
}

function normalizeModelRouting(value: unknown): ExecutionHiveModelRouting {
  return VALID_MODEL_ROUTINGS.has(value as ExecutionHiveModelRouting)
    ? value as ExecutionHiveModelRouting
    : "hive-managed";
}

function modelRoutingForPolicy(policy: string | undefined | null): ExecutionHiveModelRouting {
  const normalized = String(policy ?? "").toLowerCase();
  if (normalized.includes("runtime-managed") || normalized.includes("runtime managed")) return "runtime-managed";
  if (normalized.includes("openrouter")) return "openrouter";
  if (normalized.includes("anthropic")) return "anthropic";
  if (normalized.includes("openai")) return "openai";
  if (normalized.includes("google")) return "google";
  return "hive-managed";
}

function routingPolicyForSelection(modelRouting: ExecutionHiveModelRouting): string {
  switch (modelRouting) {
    case "runtime-managed":
      return "Runtime managed: defer model selection to the selected runtime while HiveRunner keeps task state and review flow.";
    case "openrouter":
      return "OpenRouter: route model selection through the OpenRouter broker while HiveRunner keeps orchestration state.";
    case "anthropic":
      return "Anthropic Direct: pin the default lane to first-party Anthropic model access instead of using a broker or runtime-selected source.";
    case "openai":
      return "OpenAI Direct: pin the default lane to first-party OpenAI model access instead of using a broker or runtime-selected source.";
    case "google":
      return "Google Direct: pin the default lane to first-party Google model access instead of using a broker or runtime-selected source.";
    case "hive-managed":
    default:
      return "Hive managed: HiveRunner chooses model source per task using lane policy and fallbacks.";
  }
}

function targetForSelection(
  runtimeProvider: ExecutionHiveRuntimeProvider,
  runtimeLabel: string,
  modelRouting: ExecutionHiveModelRouting,
): RouteTarget {
  if (modelRouting === "runtime-managed") {
    return {
      mode: "runtime_managed",
      runtimeId: RUNTIME_IDS[runtimeProvider],
      runtimeLabel,
      modelLabel: "runtime managed",
    };
  }
  if (modelRouting === "hive-managed") {
    return {
      mode: "hive_managed",
      runtimeId: RUNTIME_IDS[runtimeProvider],
      runtimeLabel,
      modelLabel: "Hive managed",
    };
  }
  if (modelRouting === "openrouter") {
    return {
      mode: "broker",
      runtimeId: RUNTIME_IDS[runtimeProvider],
      runtimeLabel,
      modelSourceId: "openrouter",
      modelSourceLabel: "OpenRouter",
      modelLabel: "broker managed",
    };
  }
  return {
    mode: "direct_source",
    runtimeId: RUNTIME_IDS[runtimeProvider],
    runtimeLabel,
    modelSourceId: modelRouting,
    modelSourceLabel: MODEL_SOURCE_LABELS[modelRouting] ?? MODEL_ROUTING_LABELS[modelRouting],
    modelLabel: "direct managed",
  };
}

function updateDefaultLaneForSelection(
  lanes: RoutingLane[],
  runtimeProvider: ExecutionHiveRuntimeProvider,
  runtimeLabel: string,
  modelRouting: ExecutionHiveModelRouting,
): RoutingLane[] {
  return lanes.map((lane) => {
    if (lane.id !== "default") return lane;
    return {
      ...lane,
      primary: targetForSelection(runtimeProvider, runtimeLabel, modelRouting),
      verificationStatus: "untested",
      verificationNote: `Lane route changed via Execution Matrix to ${runtimeLabel} / ${MODEL_ROUTING_LABELS[modelRouting]}; run lane check to verify.`,
    };
  });
}

function reorderRuntimePriority(current: string[], selectedLabel: string): string[] {
  const selected = runtimeLabelForProvider(runtimeProviderForLabel(selectedLabel), selectedLabel);
  const rest = current
    .map(normalizeRuntimeLabel)
    .filter((label) => label && label !== selected);
  return [selected, ...Array.from(new Set(rest))];
}

function defaultModelLaneForHive(hive: ExecutionHive): TaskModelLane {
  const defaultLane = hive.lanes.find((lane) => lane.id === "default")?.id;
  if (defaultLane && VALID_MODEL_LANES.has(defaultLane as TaskModelLane)) return defaultLane as TaskModelLane;
  const firstCoreLane = hive.lanes.find((lane) => VALID_MODEL_LANES.has(lane.id as TaskModelLane))?.id;
  return firstCoreLane && VALID_MODEL_LANES.has(firstCoreLane as TaskModelLane)
    ? firstCoreLane as TaskModelLane
    : "default";
}

function executionDefaultsForHive(hive: ExecutionHive, slug: string): ExecutionHiveDefaults {
  const runtimeLabel = runtimeLabelForProvider(runtimeProviderForLabel(hive.runtimePriority[0]), hive.runtimePriority[0]);
  const modelRouting = modelRoutingForPolicy(hive.routingPolicy);
  return {
    defaultEngine: hive.orchestrationMode,
    defaultModelLane: defaultModelLaneForHive(hive),
    defaultRuntimeProvider: runtimeProviderForLabel(runtimeLabel),
    defaultRuntimeLabel: runtimeLabel,
    defaultModelRouting: modelRouting,
    defaultModelRoutingLabel: MODEL_ROUTING_LABELS[modelRouting],
    activeHiveId: hive.id,
    activeHiveSlug: slug,
    activeHiveName: hive.name,
  };
}

function companyIdOrThrow(companyIdOrSlug: string, db: Database.Database): string {
  const resolved = resolveCompanyIdBySlug(companyIdOrSlug, db);
  if (!resolved) {
    throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  }
  return resolved.id;
}

function isLegacyRouteEditWarning(lane: RoutingLane): boolean {
  return lane.verificationStatus === "warning"
    && /updated from the Execution Matrix/i.test(lane.verificationNote);
}

function repairRouteEditVerificationStatus(lanes: RoutingLane[]): RoutingLane[] {
  return lanes.map((lane) => isLegacyRouteEditWarning(lane)
    ? {
        ...lane,
        verificationStatus: "untested",
        verificationNote: "Lane route changed via Execution Matrix; run lane check to verify.",
      }
    : lane);
}

function rowToHive(row: HiveRow): ExecutionHive {
  const rawLanes = parseJson<RoutingLane[]>(row.lanes_json, []);
  const lanes = repairRouteEditVerificationStatus(rawLanes);
  const verification = parseJson<ExecutionHiveVerification>(row.verification_json, {
    pass: 0,
    warn: 0,
    fail: 0,
    total: 0,
  });
  const repairedLegacyWarning = rawLanes.some(isLegacyRouteEditWarning);
  const repairedVerification = repairedLegacyWarning
    ? {
        ...verification,
        pass: lanes.filter((lane) => lane.verificationStatus === "verified").length,
        warn: lanes.filter((lane) => lane.verificationStatus === "warning").length,
        fail: lanes.filter((lane) => lane.verificationStatus === "failed").length,
        total: lanes.length,
      }
    : verification;
  return {
    // Expose the company-stable slug as the UI/API id. The table UUID remains
    // an internal row id so seeded hives keep durable public ids such as
    // "balanced-builder" even after persistence is introduced.
    id: row.slug,
    name: row.name,
    description: row.description,
    preset: row.preset as ExecutionHivePreset,
    recommended: row.is_recommended === 1,
    isActive: row.is_active === 1,
    orchestrationMode: normalizeEngine(row.orchestration_mode),
    optimizeFor: row.optimize_for as HiveOptimizeFor,
    autonomy: row.autonomy as HiveAutonomy,
    runtimePriority: parseJson<string[]>(row.runtime_priority_json, []),
    routingPolicy: row.routing_policy,
    lanes,
    verification: repairedVerification,
    usage: parseJson<ExecutionHive["usage"]>(row.usage_json, undefined),
  };
}

function routeTargetDetails(target: RouteTarget): string {
  const details = [
    target.runtimeId ? `runtimeId=${target.runtimeId}` : null,
    target.runtimeLabel ? `runtimeLabel=${target.runtimeLabel}` : null,
    target.modelSourceId ? `modelSourceId=${target.modelSourceId}` : null,
    target.modelSourceLabel ? `modelSourceLabel=${target.modelSourceLabel}` : null,
    target.modelId ? `modelId=${target.modelId}` : null,
    target.modelLabel ? `modelLabel=${target.modelLabel}` : null,
    `mode=${target.mode}`,
  ].filter(Boolean);
  return details.join(", ");
}

function repairLegacyRouteTarget(target: RouteTarget): RouteTarget {
  if (executionRouteRuntimeProviderFromTarget(target)) return target;
  const source = `${target.modelSourceId ?? ""} ${target.modelSourceLabel ?? ""}`.toLowerCase();
  if (source.includes("openrouter") || source.includes("openai")) {
    return { ...target, runtimeId: RUNTIME_IDS.codex, runtimeLabel: RUNTIME_LABELS.codex };
  }
  if (source.includes("google") || source.includes("gemini")) {
    return { ...target, runtimeId: RUNTIME_IDS.gemini, runtimeLabel: RUNTIME_LABELS.gemini };
  }
  if (source.includes("ollama") || source.includes("lm studio") || source.includes("local")) {
    return { ...target, runtimeId: RUNTIME_IDS.openclaw, runtimeLabel: RUNTIME_LABELS.openclaw };
  }
  return target;
}

function repairLegacyLaneRouteTargets(lanes: RoutingLane[]): RoutingLane[] {
  return lanes.map((lane) => ({
    ...lane,
    primary: repairLegacyRouteTarget(lane.primary),
    fallbacks: lane.fallbacks.map(repairLegacyRouteTarget),
  }));
}

function validateExecutionHiveLaneRoutes(lanes: RoutingLane[]): void {
  for (const lane of lanes) {
    for (const target of [lane.primary, ...lane.fallbacks]) {
      if (executionRouteRuntimeProviderFromTarget(target)) continue;
      throw new OrchestrationApiError(
        422,
        "execution_hive_route_unresolvable",
        `Lane ${lane.label} has a target that can't be mapped to a runtime: ${routeTargetDetails(target)}. Fix or remove it before saving.`,
      );
    }
  }
}

function runtimeProviderForAvailableModelProvider(value: string): ExecutionHiveRuntimeProvider | null {
  switch (value) {
    case "openai":
      return "codex";
    case "google":
      return "gemini";
    case "anthropic":
      return "anthropic";
    case "hermes":
      return "hermes";
    case "openclaw":
      return "openclaw";
    default:
      return null;
  }
}

function availableModelMatchesRuntimeProvider(
  db: Database.Database,
  provider: ExecutionHiveRuntimeProvider,
  model: string,
): boolean {
  const row = db
    .prepare("SELECT runtime_provider FROM available_models WHERE id = ? AND is_active = 1 LIMIT 1")
    .get(model) as { runtime_provider: string } | undefined;
  if (!row) return false;
  return runtimeProviderForAvailableModelProvider(row.runtime_provider) === provider;
}

function validateRuntimeModelCompatibility(
  db: Database.Database,
  lane: RoutingLane,
  target: RouteTarget,
  targetLabel: string,
): void {
  const provider = executionRouteRuntimeProviderFromTarget(target);
  if (!provider) return;
  const model = (target.modelId ?? target.modelLabel ?? "").trim();
  if (!model || GENERIC_ROUTE_MODEL_LABELS.has(model.toLowerCase())) return;
  if (availableModelMatchesRuntimeProvider(db, provider, model)) return;
  if (MODELS_BY_RUNTIME_PROVIDER[provider].includes(model)) return;

  throw new OrchestrationApiError(
    422,
    "execution_hive_runtime_model_mismatch",
    `Lane ${lane.label} ${targetLabel} target ${target.runtimeId ?? target.runtimeLabel ?? provider} cannot serve model ${model}. Pick a model from this runtime's provider.`,
  );
}

function validateLaneRuntimeModelCompatibility(db: Database.Database, lane: RoutingLane): void {
  validateRuntimeModelCompatibility(db, lane, lane.primary, "primary");
  lane.fallbacks.forEach((fallback, index) => {
    validateRuntimeModelCompatibility(db, lane, fallback, `fallback ${index + 1}`);
  });
}

function executionDefaultsFromSettings(settingsJson: string | null | undefined): Partial<ExecutionHiveDefaults> {
  const settings = parseRecord(settingsJson);
  const execution = settings.execution && typeof settings.execution === "object" && !Array.isArray(settings.execution)
    ? settings.execution as Record<string, unknown>
    : {};
  return {
    ...(VALID_ENGINES.has(execution.defaultEngine as TaskExecutionEngine)
      ? { defaultEngine: execution.defaultEngine as TaskExecutionEngine }
      : {}),
    ...(VALID_MODEL_LANES.has(execution.defaultModelLane as TaskModelLane)
      ? { defaultModelLane: execution.defaultModelLane as TaskModelLane }
      : {}),
    ...(VALID_RUNTIME_PROVIDERS.has(execution.defaultRuntimeProvider as ExecutionHiveRuntimeProvider)
      ? { defaultRuntimeProvider: execution.defaultRuntimeProvider as ExecutionHiveRuntimeProvider }
      : {}),
    ...(typeof execution.defaultRuntimeLabel === "string" ? { defaultRuntimeLabel: execution.defaultRuntimeLabel } : {}),
    ...(VALID_MODEL_ROUTINGS.has(execution.defaultModelRouting as ExecutionHiveModelRouting)
      ? { defaultModelRouting: execution.defaultModelRouting as ExecutionHiveModelRouting }
      : {}),
    ...(typeof execution.defaultModelRoutingLabel === "string" ? { defaultModelRoutingLabel: execution.defaultModelRoutingLabel } : {}),
    ...(typeof execution.activeHiveId === "string" ? { activeHiveId: execution.activeHiveId } : {}),
    ...(typeof execution.activeHiveSlug === "string" ? { activeHiveSlug: execution.activeHiveSlug } : {}),
    ...(typeof execution.activeHiveName === "string" ? { activeHiveName: execution.activeHiveName } : {}),
  };
}

function readCompanyExecutionDefaults(db: Database.Database, companyId: string): Partial<ExecutionHiveDefaults> {
  const row = db
    .prepare("SELECT settings_json FROM companies WHERE id = ? LIMIT 1")
    .get(companyId) as { settings_json: string | null } | undefined;
  return executionDefaultsFromSettings(row?.settings_json);
}

function listRows(db: Database.Database, companyId: string): HiveRow[] {
  return db
    .prepare(
      `SELECT *
       FROM company_execution_hives
       WHERE company_id = ? AND archived_at IS NULL
       ORDER BY is_active DESC, is_recommended DESC, name ASC`,
    )
    .all(companyId) as HiveRow[];
}

function toListResult(db: Database.Database, companyId: string): CompanyExecutionHivesResult {
  const hives = listRows(db, companyId).map(rowToHive);
  return {
    hives,
    activeHive: hives.find((hive) => hive.isActive) ?? null,
    executionDefaults: readCompanyExecutionDefaults(db, companyId),
  };
}

function findHiveRowOrThrow(db: Database.Database, companyId: string, hiveId: string): HiveRow {
  const row = db
    .prepare(
      `SELECT *
       FROM company_execution_hives
       WHERE company_id = ? AND archived_at IS NULL AND (id = ? OR slug = ?)
       LIMIT 1`,
    )
    .get(companyId, hiveId, hiveId) as HiveRow | undefined;
  if (!row) {
    throw new OrchestrationApiError(404, "execution_hive_not_found", "Execution Hive not found");
  }
  return row;
}

function normalizeRuntimeKey(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function runtimeAliasKeys(value: unknown): string[] {
  const normalized = normalizeRuntimeKey(value);
  if (!normalized) return [];
  if (normalized.includes("claude") || normalized.includes("anthropic")) return [normalized, "anthropic", "claudecode", "claude"];
  if (normalized.includes("gemini") || normalized.includes("google")) return [normalized, "gemini", "google"];
  if (normalized.includes("codex")) return [normalized, "codex"];
  if (normalized.includes("hermes")) return [normalized, "hermes"];
  if (normalized.includes("openclaw")) return [normalized, "openclaw"];
  return [normalized];
}

function runtimeKeys(runtime: AgentRuntimeRecord): Set<string> {
  const keys = [
    runtime.id,
    runtime.provider,
    runtime.runtimeSlug,
    runtime.displayName,
    runtime.metadata.provider,
    runtime.metadata.runtimeProvider,
  ].flatMap(runtimeAliasKeys);
  return new Set(keys);
}

function routeTargetRuntimeKeys(target: RouteTarget): Set<string> {
  const keys = [
    target.runtimeId,
    target.runtimeLabel,
    target.modelSourceId,
    target.modelSourceLabel,
  ].flatMap(runtimeAliasKeys);
  if (target.runtimeLabel) {
    keys.push(...runtimeAliasKeys(runtimeProviderForLabel(target.runtimeLabel)));
  }
  return new Set(keys);
}

function routeTargetLabel(target: RouteTarget): string {
  return target.runtimeLabel ?? target.modelSourceLabel ?? target.modelLabel ?? target.runtimeId ?? target.modelSourceId ?? "Route";
}

function isRuntimeBackedTarget(target: RouteTarget): boolean {
  return target.mode === "runtime_managed" || target.mode === "hive_managed" || Boolean(target.runtimeId || target.runtimeLabel);
}

function isModelSourceBackedTarget(target: RouteTarget): boolean {
  return target.mode === "direct_source" || target.mode === "broker" || target.mode === "local" || Boolean(target.modelSourceId);
}

function findRuntimeForTarget(runtimes: AgentRuntimeRecord[], target: RouteTarget): AgentRuntimeRecord | null {
  if (!isRuntimeBackedTarget(target)) return null;
  const targetKeys = routeTargetRuntimeKeys(target);
  if (targetKeys.size === 0) return null;
  const matches = runtimes.filter((runtime) => {
    const keys = runtimeKeys(runtime);
    return Array.from(targetKeys).some((key) => keys.has(key));
  });
  return matches.sort((left, right) => runtimeReadinessRank(right) - runtimeReadinessRank(left))[0] ?? null;
}

function runtimeHealthStatus(runtime: AgentRuntimeRecord | null): string | null {
  return runtime?.health?.status ?? runtime?.status ?? null;
}

function runtimeReadinessRank(runtime: AgentRuntimeRecord | null): number {
  const status = runtimeHealthStatus(runtime);
  if (status === "ready" || status === "online") return 5;
  if (status === "unknown") return 3;
  if (status === "needs_login" || status === "failed_probe" || status === "error") return 2;
  if (status === "missing_cli" || status === "offline") return 1;
  if (status === "disabled") return 0;
  return runtime ? 2 : -1;
}

function probeStatusForRuntime(runtime: AgentRuntimeRecord | null): VerificationProbeResult["status"] {
  const status = runtimeHealthStatus(runtime);
  if (!runtime) return "fail";
  if (status === "ready" || status === "online") return "pass";
  if (status === "unknown") return "warn";
  return "fail";
}

function verificationStatusForProbe(status: VerificationProbeResult["status"]): VerificationStatus {
  if (status === "pass") return "verified";
  if (status === "fail") return "failed";
  if (status === "warn") return "warning";
  return "untested";
}

function verificationSummaryForLanes(lanes: RoutingLane[], checkedAt: string): ExecutionHiveVerification {
  return {
    pass: lanes.filter((lane) => lane.verificationStatus === "verified").length,
    warn: lanes.filter((lane) => lane.verificationStatus === "warning").length,
    fail: lanes.filter((lane) => lane.verificationStatus === "failed").length,
    total: lanes.length,
    lastVerifiedLabel: `live probe · ${checkedAt.slice(0, 16).replace("T", " ")}`,
  };
}

function modelSourceSummaryForProbes(
  probes: Record<string, ModelSourceProbeResult>,
): NonNullable<ExecutionHiveVerification["modelSourceSummary"]> {
  const values = Object.values(probes);
  const lastChecked = values
    .map((probe) => probe.checkedAt)
    .filter(Boolean)
    .sort()
    .at(-1);
  return {
    pass: values.filter((probe) => probe.status === "pass").length,
    warn: values.filter((probe) => probe.status === "warn").length,
    fail: values.filter((probe) => probe.status === "fail").length,
    total: values.length,
    ...(lastChecked ? { lastCheckedLabel: `model-source probe · ${lastChecked.slice(0, 16).replace("T", " ")}` } : {}),
  };
}

function mergeModelSourceProbeIntoVerification(
  verification: ExecutionHiveVerification,
  probe: ModelSourceProbeResult,
): ExecutionHiveVerification {
  const modelSourceProbes = {
    ...(verification.modelSourceProbes ?? {}),
    [probe.sourceId]: probe,
  };
  return {
    ...verification,
    modelSourceProbes,
    modelSourceSummary: modelSourceSummaryForProbes(modelSourceProbes),
  };
}

function laneUsesModelSource(lane: RoutingLane, sourceId: string): boolean {
  return [lane.primary, ...lane.fallbacks].some((target) => target.modelSourceId === sourceId);
}

function detectedRuntimeToRecord(
  companyId: string,
  runtime: DetectedLocalRuntime,
  checkedAt: string,
): AgentRuntimeRecord {
  return {
    id: `detected:${runtime.provider}:${runtime.commandPath}`,
    companyId,
    agentId: null,
    provider: runtime.provider,
    runtimeKind: "cli",
    scope: "company",
    runtimeSlug: normalizeRuntimeKey(runtime.displayName || runtime.provider) || runtime.provider,
    displayName: runtime.displayName,
    command: runtime.commandPath || runtime.command,
    version: runtime.version ?? null,
    status: runtime.status,
    workspaceRoot: null,
    metadata: {
      ...runtime.metadata,
      commandPath: runtime.commandPath,
      detectedRuntime: true,
    },
    lastSeenAt: checkedAt,
    createdAt: checkedAt,
    updatedAt: checkedAt,
  };
}

function listRuntimeInventoryForProbe(companyId: string, checkedAt: string): AgentRuntimeRecord[] {
  const attached = listCompanyRuntimes(companyId).runtimes;
  const byRuntimeKey = new Map<string, AgentRuntimeRecord>();
  for (const runtime of attached) {
    for (const key of runtimeKeys(runtime)) {
      if (!byRuntimeKey.has(key)) byRuntimeKey.set(key, runtime);
    }
  }

  const detected = detectLocalRuntimeCandidatesFast()
    .map((runtime) => detectedRuntimeToRecord(companyId, runtime, checkedAt));
  const merged = [...attached];
  for (const runtime of detected) {
    const alreadyAttached = Array.from(runtimeKeys(runtime)).some((key) => byRuntimeKey.has(key));
    if (!alreadyAttached || runtimeReadinessRank(runtime) > 0) merged.push(runtime);
  }
  return merged;
}

function summarizeRuntimes(
  runtimes: AgentRuntimeRecord[],
  selectedRuntime: AgentRuntimeRecord | null,
): ExecutionHiveProbeRuntimeSummary {
  const readyRuntimes = runtimes.filter((runtime) => runtime.health?.status === "ready" || runtime.status === "online").length;
  const missingRuntimes = runtimes.filter((runtime) => runtime.health?.status === "missing_cli" || runtime.status === "offline").length;
  const warningRuntimes = runtimes.filter((runtime) => {
    const status = runtime.health?.status ?? runtime.status;
    return status && status !== "ready" && status !== "online" && status !== "missing_cli" && status !== "offline";
  }).length;
  const details = selectedRuntime
    ? [
        `${selectedRuntime.displayName}: ${selectedRuntime.health?.label ?? selectedRuntime.status}`,
        ...(selectedRuntime.health?.details ?? []).slice(0, 4),
      ]
    : ["Selected runtime was not found in this company's runtime inventory."];
  return {
    selectedRuntimeLabel: selectedRuntime?.displayName ?? null,
    selectedRuntimeStatus: runtimeHealthStatus(selectedRuntime),
    checkedRuntimes: runtimes.length,
    readyRuntimes,
    warningRuntimes,
    missingRuntimes,
    details,
  };
}

function modelSourceStatusForTarget(target: RouteTarget): VerificationProbeResult["status"] {
  const sourceId = target.modelSourceId;
  if (!sourceId) return "warn";
  try {
    const source = probeModelSourceCredential(sourceId);
    if (source.status === "connected" || source.status === "available") return "pass";
    if (source.status === "needs_key" || source.status === "warning") return "warn";
    return "fail";
  } catch {
    return "warn";
  }
}

function modelSourceNoteForTarget(target: RouteTarget): string {
  const sourceId = target.modelSourceId;
  const label = routeTargetLabel(target);
  if (!sourceId) return `${label} did not include a model-source id.`;
  try {
    const source = probeModelSourceCredential(sourceId);
    const configured = source.configuredSecretNames?.length
      ? ` Configured secret: ${source.configuredSecretNames.join(", ")}.`
      : "";
    return `${label} credential probe: ${source.note}${configured}`;
  } catch {
    return `${label} credential probe could not identify this model source.`;
  }
}

function statusFromProbeHealth(health: AgentRuntimeHealth): AgentRuntimeRecord["status"] {
  if (health.status === "ready") return "online";
  if (health.status === "disabled") return "disabled";
  if (health.status === "missing_cli") return "offline";
  if (health.status === "needs_login" || health.status === "failed_probe") return "error";
  return "unknown";
}

function companyWorkspaceRootForProbe(db: Database.Database, companyId: string): string | null {
  const row = db
    .prepare("SELECT workspace_root FROM companies WHERE id = ? LIMIT 1")
    .get(companyId) as { workspace_root: string | null } | undefined;
  return row?.workspace_root ?? null;
}

function persistRuntimeHealth(db: Database.Database, runtime: AgentRuntimeRecord, health: AgentRuntimeHealth): AgentRuntimeRecord {
  if (runtime.metadata.detectedRuntime === true || runtime.id.startsWith("detected:")) {
    const status = statusFromProbeHealth(health);
    return {
      ...runtime,
      status,
      version: health.version ?? runtime.version,
      workspaceRoot: health.workspaceRoot ?? runtime.workspaceRoot,
      metadata: { ...runtime.metadata, health },
      health,
      lastSeenAt: status === "online" ? new Date().toISOString() : runtime.lastSeenAt,
      updatedAt: new Date().toISOString(),
    };
  }

  const status = statusFromProbeHealth(health);
  const now = new Date().toISOString();
  const metadata = { ...runtime.metadata, health };
  db.prepare(
    `UPDATE agent_runtimes
     SET status = ?,
         version = COALESCE(?, version),
         workspace_root = COALESCE(?, workspace_root),
         metadata_json = ?,
         last_seen_at = CASE WHEN ? = 'online' THEN ? ELSE last_seen_at END,
         updated_at = ?
     WHERE id = ?`,
  ).run(
    status,
    health.version ?? null,
    health.workspaceRoot ?? null,
    JSON.stringify(metadata),
    status,
    now,
    now,
    runtime.id,
  );
  return {
    ...runtime,
    status,
    version: health.version ?? runtime.version,
    workspaceRoot: health.workspaceRoot ?? runtime.workspaceRoot,
    metadata,
    health,
    lastSeenAt: status === "online" ? now : runtime.lastSeenAt,
    updatedAt: now,
  };
}

function probeLaneRuntimes(
  input: {
    db: Database.Database;
    companyId: string;
    lane: RoutingLane;
    checkedAt: string;
  },
): AgentRuntimeRecord[] {
  const currentRuntimes = listRuntimeInventoryForProbe(input.companyId, input.checkedAt);
  const targets = [input.lane.primary, ...input.lane.fallbacks].filter(isRuntimeBackedTarget);
  const runtimeById = new Map<string, AgentRuntimeRecord>();
  for (const target of targets) {
    const runtime = findRuntimeForTarget(currentRuntimes, target);
    if (!runtime || runtimeById.has(runtime.id)) continue;
    const health = probeRuntimeHealth(runtime, {
      companyWorkspaceRoot: companyWorkspaceRootForProbe(input.db, input.companyId),
      checkedAt: input.checkedAt,
    });
    runtimeById.set(runtime.id, persistRuntimeHealth(input.db, runtime, health));
  }
  return Array.from(runtimeById.values());
}

function buildProbeResult(
  input: {
    kind: ExecutionHiveProbeKind;
    lane: RoutingLane;
    runtimes: AgentRuntimeRecord[];
    checkedAt: string;
  },
): { probe: VerificationProbeResult; runtimeSummary: ExecutionHiveProbeRuntimeSummary } {
  const { kind, lane, runtimes } = input;
  const selectedRuntime = findRuntimeForTarget(runtimes, lane.primary);
  const fallbackRuntimeTargets = lane.fallbacks.filter(isRuntimeBackedTarget);
  const fallbackResults = fallbackRuntimeTargets.map((target) => ({
    target,
    runtime: findRuntimeForTarget(runtimes, target),
  }));
  const runtimeSummary = summarizeRuntimes(runtimes, selectedRuntime);

  if (!isRuntimeBackedTarget(lane.primary)) {
    const modelSourceStatus = modelSourceStatusForTarget(lane.primary);
    const modelSourceNote = modelSourceNoteForTarget(lane.primary);
    const fallbackSourceProblems = kind === "conformance"
      ? lane.fallbacks
          .filter((target) => !isRuntimeBackedTarget(target) && isModelSourceBackedTarget(target))
          .filter((target) => modelSourceStatusForTarget(target) !== "pass")
      : [];
    const fallbackDetail = fallbackSourceProblems.length > 0
      ? ` Model-source fallbacks needing credentials: ${fallbackSourceProblems.map(routeTargetLabel).join(", ")}.`
      : "";
    const modelSourceSummary: ExecutionHiveProbeRuntimeSummary = {
      selectedRuntimeLabel: null,
      selectedRuntimeStatus: null,
      checkedRuntimes: runtimes.length,
      readyRuntimes: runtimeSummary.readyRuntimes,
      warningRuntimes: runtimeSummary.warningRuntimes,
      missingRuntimes: runtimeSummary.missingRuntimes,
      details: [modelSourceNote],
    };
    return {
      runtimeSummary: modelSourceSummary,
      probe: {
        id: `${lane.id}-${kind}-${input.checkedAt}`,
        label: kind === "conformance" ? "Conformance check" : "Lane check",
        laneId: lane.id,
        status: modelSourceStatus,
        verifies: ["route shape", "credential presence", "fallback visibility"],
        note: `${modelSourceNote}${fallbackDetail}`,
      },
    };
  }

  const primaryStatus = probeStatusForRuntime(selectedRuntime);
  const fallbackProblems = fallbackResults.filter(({ runtime }) => probeStatusForRuntime(runtime) !== "pass");
  const status: VerificationProbeResult["status"] =
    primaryStatus !== "pass"
      ? primaryStatus
      : kind === "conformance" && fallbackProblems.length > 0
        ? "warn"
        : "pass";
  const selectedLabel = routeTargetLabel(lane.primary);
  const fallbackDetail = kind === "conformance" && fallbackProblems.length > 0
    ? ` Fallbacks not visible or not ready in the Runtime Registry: ${fallbackProblems.map(({ target }) => routeTargetLabel(target)).join(", ")}.`
    : "";
  const note = selectedRuntime
    ? `${selectedLabel} resolved to ${selectedRuntime.displayName}: ${selectedRuntime.health?.label ?? selectedRuntime.status}.${fallbackDetail}`
    : `${selectedLabel} was not found in the live runtime inventory.`;

  return {
    runtimeSummary,
    probe: {
      id: `${lane.id}-${kind}-${input.checkedAt}`,
      label: kind === "conformance" ? "Conformance check" : "Lane check",
      laneId: lane.id,
      status,
      verifies: kind === "conformance"
        ? ["selected runtime health", "auth readiness", "workspace writability", "fallback visibility"]
        : ["selected runtime health", "auth readiness", "workspace writability"],
      note,
    },
  };
}

function persistProbeResult(
  db: Database.Database,
  row: HiveRow,
  laneId: HiveRoutingLaneId,
  probe: VerificationProbeResult,
  checkedAt: string,
): ExecutionHive {
  const lanes = parseJson<RoutingLane[]>(row.lanes_json, []).map((lane) => {
    if (lane.id !== laneId) return lane;
    return {
      ...lane,
      verificationStatus: verificationStatusForProbe(probe.status),
      verificationNote: probe.note ?? lane.verificationNote,
    };
  });
  const existingVerification = parseJson<ExecutionHiveVerification>(row.verification_json, {
    pass: 0,
    warn: 0,
    fail: 0,
    total: lanes.length,
  });
  const verification = {
    ...existingVerification,
    ...verificationSummaryForLanes(lanes, checkedAt),
  };
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE company_execution_hives
     SET lanes_json = ?,
         verification_json = ?,
         updated_at = ?
     WHERE id = ?`,
  ).run(
    JSON.stringify(lanes),
    JSON.stringify(verification),
    now,
    row.id,
  );
  const updatedRow = db
    .prepare("SELECT * FROM company_execution_hives WHERE id = ? LIMIT 1")
    .get(row.id) as HiveRow;
  return rowToHive(updatedRow);
}

function insertSeedHive(db: Database.Database, companyId: string, hive: ExecutionHive): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO company_execution_hives (
       id, company_id, slug, name, description, preset, orchestration_mode,
       optimize_for, autonomy, runtime_priority_json, routing_policy, lanes_json,
       verification_json, usage_json, is_recommended, is_active, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(company_id, slug) DO NOTHING`,
  ).run(
    randomUUID(),
    companyId,
    hive.id,
    hive.name,
    hive.description,
    hive.preset,
    hive.orchestrationMode,
    hive.optimizeFor,
    hive.autonomy,
    JSON.stringify(hive.runtimePriority),
    hive.routingPolicy,
    JSON.stringify(hive.lanes),
    JSON.stringify(hive.verification),
    JSON.stringify(hive.usage ?? {}),
    hive.recommended ? 1 : 0,
    hive.isActive ? 1 : 0,
    now,
    now,
  );
}

export function ensureCompanyExecutionHives(
  input: { companyIdOrSlug: string },
  db = getOrchestrationDb(),
): CompanyExecutionHivesResult {
  const companyId = companyIdOrThrow(input.companyIdOrSlug, db);
  return db.transaction(() => {
    const existingCount = Number(
      (db
        .prepare("SELECT COUNT(*) AS count FROM company_execution_hives WHERE company_id = ? AND archived_at IS NULL")
        .get(companyId) as { count: number } | undefined)?.count ?? 0,
    );
    if (existingCount === 0) {
      for (const hive of SEEDED_EXECUTION_HIVES) insertSeedHive(db, companyId, hive);
    }

    const activeCount = Number(
      (db
        .prepare("SELECT COUNT(*) AS count FROM company_execution_hives WHERE company_id = ? AND archived_at IS NULL AND is_active = 1")
        .get(companyId) as { count: number } | undefined)?.count ?? 0,
    );
    if (activeCount === 0) {
      const recommended = db
        .prepare(
          `SELECT id FROM company_execution_hives
           WHERE company_id = ? AND archived_at IS NULL
           ORDER BY is_recommended DESC, created_at ASC
           LIMIT 1`,
        )
        .get(companyId) as { id: string } | undefined;
      if (recommended) {
        db.prepare("UPDATE company_execution_hives SET is_active = 1, updated_at = ? WHERE id = ?").run(
          new Date().toISOString(),
          recommended.id,
        );
      }
    }
    return toListResult(db, companyId);
  })();
}

export function listCompanyExecutionHives(
  input: { companyIdOrSlug: string },
  db = getOrchestrationDb(),
): CompanyExecutionHivesResult {
  return ensureCompanyExecutionHives(input, db);
}

export function activateCompanyExecutionHive(
  input: { companyIdOrSlug: string; hiveId: string },
  db = getOrchestrationDb(),
): ActivateCompanyExecutionHiveResult {
  const companyId = companyIdOrThrow(input.companyIdOrSlug, db);
  ensureCompanyExecutionHives({ companyIdOrSlug: companyId }, db);
  return db.transaction(() => {
    const row = db
      .prepare(
        `SELECT *
         FROM company_execution_hives
         WHERE company_id = ? AND archived_at IS NULL AND (id = ? OR slug = ?)
         LIMIT 1`,
      )
      .get(companyId, input.hiveId, input.hiveId) as HiveRow | undefined;
    if (!row) {
      throw new OrchestrationApiError(404, "execution_hive_not_found", "Execution Hive not found");
    }

    const hive = rowToHive(row);
    const lanes = repairLegacyLaneRouteTargets(hive.lanes);
    validateExecutionHiveLaneRoutes(lanes);
    const activationHive = { ...hive, lanes };
    const now = new Date().toISOString();
    db.prepare("UPDATE company_execution_hives SET is_active = 0, updated_at = ? WHERE company_id = ? AND archived_at IS NULL")
      .run(now, companyId);
    db.prepare("UPDATE company_execution_hives SET is_active = 1, lanes_json = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(lanes), now, row.id);

    const company = db
      .prepare("SELECT settings_json FROM companies WHERE id = ? LIMIT 1")
      .get(companyId) as { settings_json: string | null } | undefined;
    const settings = parseRecord(company?.settings_json);
    const currentExecution =
      settings.execution && typeof settings.execution === "object" && !Array.isArray(settings.execution)
        ? settings.execution as Record<string, unknown>
        : {};
    const executionDefaults = executionDefaultsForHive(activationHive, row.slug);
    const execution = {
      ...currentExecution,
      ...executionDefaults,
    };
    db.prepare("UPDATE companies SET settings_json = ?, updated_at = ? WHERE id = ?").run(
      JSON.stringify({ ...settings, execution }),
      now,
      companyId,
    );

    const hives = listRows(db, companyId).map(rowToHive);
    const activeHive = hives.find((candidate) => candidate.isActive) ?? null;
    return {
      hive: { ...activationHive, isActive: true },
      hives,
      activeHive,
      executionDefaults,
    };
  })();
}

export function configureCompanyExecutionHive(
  input: { companyIdOrSlug: string; hiveId: string } & ExecutionHiveMatrixConfig,
  db = getOrchestrationDb(),
): ConfigureCompanyExecutionHiveResult {
  const companyId = companyIdOrThrow(input.companyIdOrSlug, db);
  ensureCompanyExecutionHives({ companyIdOrSlug: companyId }, db);
  return db.transaction(() => {
    const row = db
      .prepare(
        `SELECT *
         FROM company_execution_hives
         WHERE company_id = ? AND archived_at IS NULL AND (id = ? OR slug = ?)
         LIMIT 1`,
      )
      .get(companyId, input.hiveId, input.hiveId) as HiveRow | undefined;
    if (!row) {
      throw new OrchestrationApiError(404, "execution_hive_not_found", "Execution Hive not found");
    }

    const currentHive = rowToHive(row);
    const runtimeProvider = normalizeRuntimeProvider(input.runtimeProvider);
    const runtimeLabel = runtimeLabelForProvider(runtimeProvider, input.runtimeLabel);
    const modelRouting = normalizeModelRouting(input.modelRouting);
    const runtimePriority = reorderRuntimePriority(currentHive.runtimePriority, runtimeLabel);
    const lanes = repairLegacyLaneRouteTargets(updateDefaultLaneForSelection(currentHive.lanes, runtimeProvider, runtimeLabel, modelRouting));
    validateExecutionHiveLaneRoutes(lanes);
    const routingPolicy = routingPolicyForSelection(modelRouting);
    const now = new Date().toISOString();

    db.prepare(
      `UPDATE company_execution_hives
       SET orchestration_mode = ?,
           runtime_priority_json = ?,
           routing_policy = ?,
           lanes_json = ?,
           updated_at = ?
       WHERE id = ?`,
    ).run(
      normalizeEngine(input.orchestrationMode),
      JSON.stringify(runtimePriority),
      routingPolicy,
      JSON.stringify(lanes),
      now,
      row.id,
    );

    const updatedRow = db
      .prepare("SELECT * FROM company_execution_hives WHERE id = ? LIMIT 1")
      .get(row.id) as HiveRow;
    const hive = rowToHive(updatedRow);
    let executionDefaults: Partial<ExecutionHiveDefaults> = readCompanyExecutionDefaults(db, companyId);

    if (hive.isActive) {
      const company = db
        .prepare("SELECT settings_json FROM companies WHERE id = ? LIMIT 1")
        .get(companyId) as { settings_json: string | null } | undefined;
      const settings = parseRecord(company?.settings_json);
      const currentExecution =
        settings.execution && typeof settings.execution === "object" && !Array.isArray(settings.execution)
          ? settings.execution as Record<string, unknown>
          : {};
      executionDefaults = executionDefaultsForHive(hive, updatedRow.slug);
      db.prepare("UPDATE companies SET settings_json = ?, updated_at = ? WHERE id = ?").run(
        JSON.stringify({ ...settings, execution: { ...currentExecution, ...executionDefaults } }),
        now,
        companyId,
      );
    }

    const hives = listRows(db, companyId).map(rowToHive);
    const activeHive = hives.find((candidate) => candidate.isActive) ?? null;
    return {
      hive,
      hives,
      activeHive,
      executionDefaults,
    };
  })();
}

export function updateCompanyExecutionHiveLane(
  input: {
    companyIdOrSlug: string;
    hiveId: string;
    laneId: HiveRoutingLaneId;
    primary: RouteTarget;
    fallbacks: RouteTarget[];
  },
  db = getOrchestrationDb(),
): UpdateCompanyExecutionHiveLaneResult {
  const companyId = companyIdOrThrow(input.companyIdOrSlug, db);
  ensureCompanyExecutionHives({ companyIdOrSlug: companyId }, db);

  return db.transaction(() => {
    const row = findHiveRowOrThrow(db, companyId, input.hiveId);
    const hive = rowToHive(row);
    const existingLane = hive.lanes.find((lane) => lane.id === input.laneId);
    if (!existingLane) {
      throw new OrchestrationApiError(404, "execution_hive_lane_not_found", "Execution Hive lane not found");
    }
    if (input.fallbacks.length > 3) {
      throw new OrchestrationApiError(
        422,
        "execution_hive_fallback_limit_exceeded",
        "A lane can have at most 3 configured fallbacks.",
      );
    }
    validateLaneRuntimeModelCompatibility(db, {
      ...existingLane,
      primary: input.primary,
      fallbacks: input.fallbacks,
    });

    const lanes = repairLegacyLaneRouteTargets(hive.lanes.map((lane) => {
      if (lane.id !== input.laneId) return lane;
      return {
        ...lane,
        primary: input.primary,
        fallbacks: input.fallbacks,
        verificationStatus: "untested" as VerificationStatus,
        verificationNote: "Lane route changed. Run the lane check before broad rollout.",
      };
    }));
    validateExecutionHiveLaneRoutes(lanes);

    const now = new Date().toISOString();
    const verification = verificationSummaryForLanes(lanes, now);
    db.prepare(
      `UPDATE company_execution_hives
       SET lanes_json = ?,
           verification_json = ?,
           updated_at = ?
       WHERE id = ?`,
    ).run(
      JSON.stringify(lanes),
      JSON.stringify({ ...hive.verification, ...verification }),
      now,
      row.id,
    );

    const updatedRow = db
      .prepare("SELECT * FROM company_execution_hives WHERE id = ? LIMIT 1")
      .get(row.id) as HiveRow;
    const updatedHive = rowToHive(updatedRow);
    const updatedLane = updatedHive.lanes.find((lane) => lane.id === input.laneId);
    if (!updatedLane) {
      throw new OrchestrationApiError(500, "execution_hive_lane_update_failed", "Execution Hive lane update failed");
    }

    const listResult = toListResult(db, companyId);
    return {
      ...listResult,
      hive: updatedHive,
      lane: updatedLane,
      executionDefaults: readCompanyExecutionDefaults(db, companyId),
    };
  })();
}

export function runCompanyExecutionHiveProbe(
  input: {
    companyIdOrSlug: string;
    hiveId: string;
    laneId: HiveRoutingLaneId;
    kind: ExecutionHiveProbeKind;
  },
  db = getOrchestrationDb(),
): RunCompanyExecutionHiveProbeResult {
  const companyId = companyIdOrThrow(input.companyIdOrSlug, db);
  ensureCompanyExecutionHives({ companyIdOrSlug: companyId }, db);

  const row = findHiveRowOrThrow(db, companyId, input.hiveId);
  const hive = rowToHive(row);
  const lane = hive.lanes.find((candidate) => candidate.id === input.laneId);
  if (!lane) {
    throw new OrchestrationApiError(404, "execution_hive_lane_not_found", "Execution Hive lane not found");
  }

  const checkedAt = new Date().toISOString();
  const runtimes = probeLaneRuntimes({ db, companyId, lane, checkedAt });
  const { probe, runtimeSummary } = buildProbeResult({
    kind: input.kind,
    lane,
    runtimes,
    checkedAt,
  });

  const updatedHive = persistProbeResult(db, row, lane.id, probe, checkedAt);
  const listResult = toListResult(db, companyId);
  const updatedLane = updatedHive.lanes.find((candidate) => candidate.id === lane.id) ?? lane;

  return {
    ...listResult,
    hive: updatedHive,
    lane: updatedLane,
    probe,
    checkedAt,
    runtimeSummary,
  };
}

export function recordCompanyModelSourceProbe(
  input: {
    companyIdOrSlug: string;
    probe: ModelSourceProbeResult;
  },
  db = getOrchestrationDb(),
): RecordCompanyModelSourceProbeResult {
  const companyId = companyIdOrThrow(input.companyIdOrSlug, db);
  ensureCompanyExecutionHives({ companyIdOrSlug: companyId }, db);

  return db.transaction(() => {
    const rows = listRows(db, companyId);
    const now = new Date().toISOString();
    for (const row of rows) {
      const lanes = parseJson<RoutingLane[]>(row.lanes_json, []);
      const hiveUsesSource = lanes.some((lane) => laneUsesModelSource(lane, input.probe.sourceId));
      const shouldRecord = hiveUsesSource || row.is_active === 1;
      if (!shouldRecord) continue;

      const currentVerification = parseJson<ExecutionHiveVerification>(row.verification_json, {
        pass: 0,
        warn: 0,
        fail: 0,
        total: lanes.length,
      });
      const nextVerification = mergeModelSourceProbeIntoVerification(currentVerification, input.probe);
      db.prepare(
        `UPDATE company_execution_hives
         SET verification_json = ?,
             updated_at = ?
         WHERE id = ?`,
      ).run(
        JSON.stringify(nextVerification),
        now,
        row.id,
      );
    }

    const listResult = toListResult(db, companyId);
    return {
      ...listResult,
      probe: input.probe,
    };
  })();
}
