import { randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import type Database from "better-sqlite3";

import { OrchestrationApiError } from "@/lib/orchestration/api";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { detectLocalRuntimeCandidatesFast } from "@/lib/orchestration/runtime-registry";
import { resolveCompanyId } from "@/lib/orchestration/service/shared";

const DEFAULT_MONTHLY_BUDGET_USD = 100;

export type CostTimeframe = "mtd" | "7d" | "30d" | "90d" | "ytd" | "all";

type ProviderConnectionType =
  | "local_cli"
  | "api_key"
  | "env_api_key"
  | "oauth"
  | "subscription"
  | "router"
  | "local_model"
  | "daemon"
  | "manual"
  | "unknown";

type ProviderBillingModel =
  | "metered_tokens"
  | "subscription_included"
  | "subscription_overage"
  | "credits"
  | "fixed"
  | "local_free"
  | "hybrid"
  | "unknown";

type AuthSurface = "api_key" | "env" | "oauth" | "device_login" | "setup_token" | "local_config" | "none" | "unknown";
type Confidence = "reported" | "detected" | "inferred" | "confirmed" | "unknown";
type BillingType = "metered_api" | "subscription_included" | "subscription_overage" | "credits" | "fixed" | "local_free" | "estimated" | "unknown";
type CostSource = "reported" | "estimated" | "subscription_included" | "manual" | "unknown";
type FinanceEventType = "invoice" | "usage" | "subscription" | "credit" | "adjustment" | "manual";
type FinanceEventSource = "manual" | "estimated" | "unknown";

export type ProviderProfile = {
  id: string;
  runtimeId: string | null;
  provider: string;
  displayName: string;
  connectionType: ProviderConnectionType;
  billingModel: ProviderBillingModel;
  biller: string;
  authSurface: AuthSurface;
  confidence: Confidence;
  source: string;
  isActive: boolean;
  metadata: Record<string, unknown>;
  updatedAt: string;
};

type RawRuntimeRow = {
  id: string;
  provider: string;
  runtime_kind: string;
  display_name: string;
  command: string | null;
  status: string;
  metadata_json: string | null;
  updated_at: string;
};

type RawExecutionRunRow = {
  id: string;
  task_id: string | null;
  task_title: string | null;
  project_id: string | null;
  project_name: string | null;
  agent_id: string | null;
  agent_name: string | null;
  provider: string;
  token_usage_json: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
};

type RawCostEventRow = {
  id: string;
  company_id: string;
  agent_id: string | null;
  agent_name: string | null;
  task_id: string | null;
  task_title: string | null;
  project_id: string | null;
  project_name: string | null;
  execution_run_id: string | null;
  heartbeat_run_id: string | null;
  provider: string;
  biller: string;
  billing_type: BillingType;
  model: string;
  input_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  output_tokens: number;
  cost_cents: number;
  cost_source: CostSource;
  confidence: Confidence;
  metadata_json: string | null;
  occurred_at: string;
};

type RawFinanceEventRow = {
  id: string;
  provider: string;
  biller: string;
  event_type: FinanceEventType;
  amount_cents: number;
  currency: string;
  source: FinanceEventSource;
  confidence: Confidence;
  period_start: string | null;
  period_end: string | null;
  external_id: string | null;
  description: string;
  metadata_json: string | null;
  occurred_at: string;
};

type CostEvent = {
  id: string;
  agentId: string | null;
  agent: string;
  taskId: string | null;
  taskTitle: string | null;
  projectId: string | null;
  project: string | null;
  executionRunId: string | null;
  heartbeatRunId: string | null;
  provider: string;
  biller: string;
  billingType: BillingType;
  model: string;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  tokens: number;
  cost: number;
  costSource: CostSource;
  confidence: Confidence;
  occurredAt: string;
};

export type FinanceEvent = {
  id: string;
  provider: string;
  biller: string;
  eventType: FinanceEventType;
  amount: number;
  currency: string;
  source: FinanceEventSource;
  confidence: Confidence;
  periodStart: string | null;
  periodEnd: string | null;
  externalId: string | null;
  description: string;
  metadata: Record<string, unknown>;
  occurredAt: string;
};

type AggregateRow = {
  cost: number;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  eventCount: number;
  meteredEvents: number;
  subscriptionEvents: number;
};

export type CompanyCostLedger = {
  today: number;
  yesterday: number;
  thisMonth: number;
  lastMonth: number;
  projected: number;
  budget: number;
  avgDaily: number;
  daysElapsed: number;
  daysInMonth: number;
  selectedRangeSpend: number;
  selectedRangeTokens: number;
  meteredSpend: number;
  subscriptionTokens: number;
  meteredEvents: number;
  subscriptionEvents: number;
  byAgent: Array<AggregateRow & { agent: string }>;
  byModel: Array<AggregateRow & { model: string }>;
  byProvider: Array<AggregateRow & { provider: string; biller: string; billingType: BillingType }>;
  byBiller: Array<AggregateRow & { biller: string; billingType: BillingType }>;
  billingMix: Array<AggregateRow & { billingType: BillingType }>;
  providerProfiles: ProviderProfile[];
  recentEvents: CostEvent[];
  financeEvents: FinanceEvent[];
  financeDebits: number;
  financeCredits: number;
  subscriptionFees: number;
  financeAdjustments: number;
  financeNet: number;
};

export type RecordCostEventInput = {
  db?: Database.Database;
  eventId?: string;
  companyId: string;
  agentId?: string | null;
  taskId?: string | null;
  projectId?: string | null;
  executionRunId?: string | null;
  heartbeatRunId?: string | null;
  provider: string;
  usage: Record<string, unknown>;
  occurredAt?: string;
};

export type UpdateProviderProfileInput = {
  billingModel?: ProviderBillingModel;
  biller?: string;
  connectionType?: ProviderConnectionType;
  authSurface?: AuthSurface;
  isActive?: boolean;
};

export type CreateFinanceEventInput = {
  provider?: string;
  biller: string;
  eventType: FinanceEventType;
  amount: number;
  currency?: string;
  source?: FinanceEventSource;
  confidence?: Confidence;
  periodStart?: string | null;
  periodEnd?: string | null;
  externalId?: string | null;
  description?: string;
  metadata?: Record<string, unknown>;
  occurredAt?: string;
};

function parseJson(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function numberFromRecord(record: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
}

function stringFromRecord(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function centsFromUsage(usage: Record<string, unknown>): number {
  const cents = numberFromRecord(usage, ["totalCostCents", "costCents", "total_cost_cents", "cost_cents"]);
  if (cents > 0) return cents;
  const usd = numberFromRecord(usage, ["totalCostUsd", "costUsd", "total_cost_usd", "cost_usd"]);
  return usd > 0 ? usd * 100 : 0;
}

function modelFromUsage(usage: Record<string, unknown>, provider: string): string {
  const explicit = stringFromRecord(usage, ["cliModel", "modelId", "model_id", "fullModel", "full_model"]);
  if (explicit) return explicit;
  const model = stringFromRecord(usage, ["model"]);
  if (!model) return "unknown";
  if ((provider === "anthropic" || provider === "claude") && model.toLowerCase() === "sonnet") {
    return "claude-sonnet-4-6";
  }
  return model;
}

function normalizeProvider(provider: string | null | undefined): string {
  const value = provider?.trim().toLowerCase() || "unknown";
  if (value === "claude" || value === "claude-code") return "anthropic";
  if (value === "openai-codex") return "codex";
  return value;
}

function providerDisplayName(provider: string): string {
  if (provider === "codex") return "OpenAI Codex";
  if (provider === "openai") return "OpenAI API";
  if (provider === "anthropic") return "Anthropic / Claude Code";
  if (provider === "gemini") return "Google Gemini";
  if (provider === "symphony") return "External runner";
  if (provider === "openclaw") return "OpenClaw";
  if (provider === "hermes") return "HERMES";
  if (provider === "multica") return "Multica";
  if (provider === "openrouter") return "OpenRouter";
  if (provider === "lmstudio") return "LM Studio";
  return provider
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function envFlag(names: string[]): boolean {
  return names.some((name) => Boolean(process.env[name]?.trim()));
}

function safeExists(filePath: string): boolean {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function homeConfigExists(relativePaths: string[]): boolean {
  const home = os.homedir();
  return relativePaths.some((relativePath) => safeExists(path.join(home, relativePath)));
}

function localAuthSignal(provider: string): boolean {
  if (provider === "codex") {
    return homeConfigExists([".codex/auth.json", ".codex/config.toml", ".codex/config.json"]);
  }
  if (provider === "anthropic") {
    return homeConfigExists([".claude.json", ".claude/config.json", ".claude/settings.json"]);
  }
  if (provider === "gemini" || provider === "google") {
    return homeConfigExists([".gemini/oauth_creds.json", ".gemini/settings.json", ".config/gemini/oauth_creds.json"]);
  }
  return false;
}

function isLocalCliInput(input: { runtimeKind?: string | null; command?: string | null; metadata?: Record<string, unknown> }): boolean {
  const runtimeKind = input.runtimeKind?.trim().toLowerCase();
  if (runtimeKind === "cli" || runtimeKind === "local_cli") return true;
  if (typeof input.command === "string" && input.command.trim()) return true;
  const detectedBy = typeof input.metadata?.detectedBy === "string" ? input.metadata.detectedBy : "";
  return detectedBy.includes("local-path");
}

function detectionSignals(provider: string, input: { runtimeKind?: string | null; command?: string | null; metadata?: Record<string, unknown> }) {
  const openRouterBaseUrl = process.env.OPENAI_BASE_URL?.toLowerCase().includes("openrouter") === true;
  return {
    localCli: isLocalCliInput(input),
    localAuth: localAuthSignal(provider),
    openAiApiKey: envFlag(["OPENAI_API_KEY"]),
    openRouterApiKey: envFlag(["OPENROUTER_API_KEY"]),
    openRouterBaseUrl,
    anthropicApiKey: envFlag(["ANTHROPIC_API_KEY", "CLAUDE_API_KEY"]),
    geminiApiKey: envFlag(["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_AI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"]),
  };
}

function inferProfile(input: {
  provider: string;
  runtimeKind?: string | null;
  displayName?: string | null;
  runtimeId?: string | null;
  command?: string | null;
  metadata?: Record<string, unknown>;
}): Omit<ProviderProfile, "id" | "updatedAt"> {
  const provider = normalizeProvider(input.provider);
  const runtimeKind = input.runtimeKind?.trim().toLowerCase();
  const displayName = input.displayName?.trim() || provider;
  const metadata = input.metadata ?? {};
  const signals = detectionSignals(provider, input);
  const metadataWithSignals = {
    ...metadata,
    billingDetection: signals,
  };

  if (provider === "codex") {
    const usesOpenRouter = signals.openRouterApiKey || signals.openRouterBaseUrl;
    const usesApiKey = signals.openAiApiKey || signals.openRouterApiKey;
    const ambiguousLocalCli = signals.localCli && signals.localAuth && usesApiKey;
    return {
      runtimeId: input.runtimeId ?? null,
      provider,
      displayName,
      connectionType: ambiguousLocalCli ? "local_cli" : usesApiKey ? (usesOpenRouter ? "router" : "env_api_key") : "oauth",
      billingModel: ambiguousLocalCli ? "hybrid" : usesApiKey ? "metered_tokens" : "subscription_included",
      biller: ambiguousLocalCli ? "multiple" : usesApiKey ? (usesOpenRouter ? "openrouter" : "openai") : "chatgpt",
      authSurface: ambiguousLocalCli ? "unknown" : usesApiKey ? "env" : "oauth",
      confidence: usesApiKey || signals.localAuth ? "detected" : "inferred",
      source: "runtime_detection",
      isActive: true,
      metadata: metadataWithSignals,
    };
  }

  if (provider === "anthropic") {
    const usesApiKey = signals.anthropicApiKey;
    const ambiguousLocalCli = signals.localCli && signals.localAuth && usesApiKey;
    return {
      runtimeId: input.runtimeId ?? null,
      provider,
      displayName,
      connectionType: ambiguousLocalCli ? "local_cli" : usesApiKey ? "env_api_key" : "subscription",
      billingModel: ambiguousLocalCli ? "hybrid" : usesApiKey ? "metered_tokens" : "subscription_included",
      biller: "anthropic",
      authSurface: ambiguousLocalCli ? "unknown" : usesApiKey ? "env" : "oauth",
      confidence: usesApiKey || signals.localAuth ? "detected" : "inferred",
      source: "runtime_detection",
      isActive: true,
      metadata: metadataWithSignals,
    };
  }

  if (provider === "gemini" || provider === "google") {
    const usesApiKey = signals.geminiApiKey;
    const ambiguousLocalCli = signals.localCli && signals.localAuth && usesApiKey;
    return {
      runtimeId: input.runtimeId ?? null,
      provider: "gemini",
      displayName,
      connectionType: ambiguousLocalCli ? "local_cli" : usesApiKey ? "env_api_key" : "subscription",
      billingModel: ambiguousLocalCli ? "hybrid" : usesApiKey ? "metered_tokens" : "subscription_included",
      biller: "google",
      authSurface: ambiguousLocalCli ? "unknown" : usesApiKey ? "env" : "oauth",
      confidence: usesApiKey || signals.localAuth ? "detected" : "inferred",
      source: "runtime_detection",
      isActive: true,
      metadata: metadataWithSignals,
    };
  }

  if (provider === "openrouter") {
    return {
      runtimeId: input.runtimeId ?? null,
      provider,
      displayName,
      connectionType: envFlag(["OPENROUTER_API_KEY"]) ? "env_api_key" : "api_key",
      billingModel: "metered_tokens",
      biller: "openrouter",
      authSurface: envFlag(["OPENROUTER_API_KEY"]) ? "env" : "api_key",
      confidence: envFlag(["OPENROUTER_API_KEY"]) ? "detected" : "inferred",
      source: "runtime_detection",
      isActive: true,
      metadata: metadataWithSignals,
    };
  }

  if (provider === "lmstudio" || provider === "ollama" || provider === "local") {
    return {
      runtimeId: input.runtimeId ?? null,
      provider,
      displayName,
      connectionType: "local_model",
      billingModel: "local_free",
      biller: "local",
      authSurface: "none",
      confidence: "inferred",
      source: "runtime_detection",
      isActive: true,
      metadata: metadataWithSignals,
    };
  }

  if (provider === "openclaw" || provider === "hermes" || provider === "symphony" || provider === "multica") {
    return {
      runtimeId: input.runtimeId ?? null,
      provider,
      displayName,
      connectionType: runtimeKind === "daemon" ? "daemon" : "local_cli",
      billingModel: "hybrid",
      biller: provider,
      authSurface: "local_config",
      confidence: "inferred",
      source: "runtime_detection",
      isActive: true,
      metadata: metadataWithSignals,
    };
  }

  return {
    runtimeId: input.runtimeId ?? null,
    provider,
    displayName,
    connectionType: runtimeKind === "manual" ? "manual" : "unknown",
    billingModel: "unknown",
    biller: provider,
    authSurface: "unknown",
    confidence: "unknown",
    source: "runtime_detection",
    isActive: true,
    metadata: metadataWithSignals,
  };
}

function envDetectedProfiles(companyId: string): ProviderProfile[] {
  const now = new Date().toISOString();
  const profiles: ProviderProfile[] = [];
  const push = (profile: Omit<ProviderProfile, "id" | "updatedAt">) => {
    const key = [profile.provider, profile.biller, profile.connectionType, profile.billingModel, profile.authSurface].join(":");
    profiles.push({
      id: `profile:${companyId}:${key}`,
      updatedAt: now,
      ...profile,
      metadata: {
        ...profile.metadata,
        seededFrom: "environment",
      },
    });
  };

  if (envFlag(["OPENAI_API_KEY"])) {
    push({
      runtimeId: null,
      provider: "openai",
      displayName: providerDisplayName("openai"),
      connectionType: "env_api_key",
      billingModel: "metered_tokens",
      biller: "openai",
      authSurface: "env",
      confidence: "detected",
      source: "env_detection",
      isActive: true,
      metadata: { detectedEnv: ["OPENAI_API_KEY"] },
    });
  }

  if (envFlag(["OPENROUTER_API_KEY"]) || process.env.OPENAI_BASE_URL?.toLowerCase().includes("openrouter") === true) {
    push({
      runtimeId: null,
      provider: "openrouter",
      displayName: providerDisplayName("openrouter"),
      connectionType: "router",
      billingModel: "metered_tokens",
      biller: "openrouter",
      authSurface: envFlag(["OPENROUTER_API_KEY"]) ? "env" : "api_key",
      confidence: "detected",
      source: "env_detection",
      isActive: true,
      metadata: { detectedEnv: envFlag(["OPENROUTER_API_KEY"]) ? ["OPENROUTER_API_KEY"] : ["OPENAI_BASE_URL"] },
    });
  }

  if (envFlag(["ANTHROPIC_API_KEY", "CLAUDE_API_KEY"])) {
    push({
      runtimeId: null,
      provider: "anthropic",
      displayName: "Anthropic API",
      connectionType: "env_api_key",
      billingModel: "metered_tokens",
      biller: "anthropic",
      authSurface: "env",
      confidence: "detected",
      source: "env_detection",
      isActive: true,
      metadata: { detectedEnv: ["ANTHROPIC_API_KEY", "CLAUDE_API_KEY"] },
    });
  }

  if (envFlag(["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_AI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"])) {
    push({
      runtimeId: null,
      provider: "gemini",
      displayName: "Google Gemini API",
      connectionType: "env_api_key",
      billingModel: "metered_tokens",
      biller: "google",
      authSurface: "env",
      confidence: "detected",
      source: "env_detection",
      isActive: true,
      metadata: { detectedEnv: ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_AI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"] },
    });
  }

  return profiles;
}

function billingTypeForProfile(profile: Pick<ProviderProfile, "billingModel">): BillingType {
  if (profile.billingModel === "metered_tokens") return "metered_api";
  if (profile.billingModel === "subscription_included") return "subscription_included";
  if (profile.billingModel === "subscription_overage") return "subscription_overage";
  if (profile.billingModel === "credits") return "credits";
  if (profile.billingModel === "fixed") return "fixed";
  if (profile.billingModel === "local_free") return "local_free";
  return "unknown";
}

function normalizeBillingType(value: string | undefined, profile: Pick<ProviderProfile, "billingModel">): BillingType {
  const normalized = value?.trim().toLowerCase().replace(/[-\s]/g, "_");
  if (normalized === "api" || normalized === "metered" || normalized === "metered_tokens" || normalized === "metered_api") return "metered_api";
  if (normalized === "subscription" || normalized === "subscription_included") return "subscription_included";
  if (normalized === "subscription_overage") return "subscription_overage";
  if (normalized === "credits" || normalized === "fixed" || normalized === "local_free" || normalized === "estimated" || normalized === "unknown") return normalized;
  return billingTypeForProfile(profile);
}

function costSourceForBillingType(billingType: BillingType, rawCostCents: number): CostSource {
  if (billingType === "subscription_included" || billingType === "local_free") return "subscription_included";
  if (rawCostCents > 0) return "reported";
  if (billingType === "metered_api" || billingType === "estimated") return "estimated";
  return "unknown";
}

function billableCostCents(billingType: BillingType, rawCostCents: number): number {
  if (billingType === "subscription_included" || billingType === "local_free") return 0;
  return rawCostCents;
}

function upsertDetectedProviderProfiles(db: Database.Database, companyId: string): ProviderProfile[] {
  const runtimes = db
    .prepare(
      `SELECT id, provider, runtime_kind, display_name, command, status, metadata_json, updated_at
       FROM agent_runtimes
       WHERE company_id = ? AND status <> 'disabled'
       ORDER BY provider, display_name`,
    )
    .all(companyId) as RawRuntimeRow[];

  const candidates = runtimes.map((runtime) => {
    const profile = inferProfile({
      provider: runtime.provider,
      runtimeKind: runtime.runtime_kind,
      displayName: runtime.display_name,
      runtimeId: runtime.id,
      command: runtime.command,
      metadata: {
        ...parseJson(runtime.metadata_json),
        runtimeStatus: runtime.status,
        command: runtime.command,
      },
    });
    return {
      id: `profile:${companyId}:${runtime.id}`,
      updatedAt: runtime.updated_at,
      ...profile,
    };
  });

  const agentProviders = db
    .prepare(
      `SELECT DISTINCT LOWER(TRIM(adapter_type)) AS provider
       FROM agents
       WHERE company_id = ? AND archived_at IS NULL AND NULLIF(TRIM(adapter_type), '') IS NOT NULL`,
    )
    .all(companyId) as Array<{ provider: string }>;

  for (const row of agentProviders) {
    const provider = normalizeProvider(row.provider);
    const alreadyCovered = candidates.some((profile) => profile.provider === provider);
    if (!alreadyCovered) {
      const inferred = inferProfile({ provider, displayName: provider, metadata: { seededFrom: "agents.adapter_type" } });
      candidates.push({
        id: `profile:${companyId}:agent-provider:${provider}`,
        updatedAt: new Date().toISOString(),
        ...inferred,
      });
    }
  }

  for (const detected of detectLocalRuntimeCandidatesFast()) {
    const provider = normalizeProvider(detected.provider);
    const inferred = inferProfile({
      provider,
      runtimeKind: "cli",
      displayName: detected.displayName,
      metadata: {
        ...detected.metadata,
        detectedCommand: detected.command,
        detectedCommandPath: detected.commandPath,
        detectedRuntimeStatus: detected.status,
        seededFrom: "detected_local_runtime",
      },
    });
    candidates.push({
      id: `profile:${companyId}:detected-provider:${provider}`,
      updatedAt: new Date().toISOString(),
      ...inferred,
    });
  }

  candidates.push(...envDetectedProfiles(companyId));

  const profileMap = new Map<string, ProviderProfile>();
  for (const profile of candidates) {
    const key = [profile.provider, profile.biller, profile.connectionType, profile.billingModel, profile.authSurface].join(":");
    const existing = profileMap.get(key);
    if (!existing) {
      profileMap.set(key, {
        ...profile,
        id: `profile:${companyId}:${key}`,
        runtimeId: profile.runtimeId,
        displayName: providerDisplayName(profile.provider),
        metadata: {
          ...profile.metadata,
          runtimeIds: profile.runtimeId ? [profile.runtimeId] : [],
        },
      });
      continue;
    }
    const runtimeIds = Array.isArray(existing.metadata.runtimeIds) ? existing.metadata.runtimeIds : [];
    profileMap.set(key, {
      ...existing,
      runtimeId: null,
      metadata: {
        ...existing.metadata,
        runtimeIds: profile.runtimeId ? [...runtimeIds, profile.runtimeId] : runtimeIds,
      },
    });
  }
  const profiles = [...profileMap.values()];

  const now = new Date().toISOString();
  const transaction = db.transaction(() => {
    db.prepare(
      `UPDATE provider_connection_profiles
       SET is_active = 0, updated_at = ?
      WHERE company_id = ? AND source IN ('runtime_detection', 'env_detection') AND confidence IN ('detected','inferred','unknown')`,
    ).run(now, companyId);

    const confirmedRows = db
      .prepare(
        `SELECT id
         FROM provider_connection_profiles
         WHERE company_id = ? AND confidence = 'confirmed'`,
      )
      .all(companyId) as Array<{ id: string }>;
    const confirmedIds = new Set(confirmedRows.map((row) => row.id));

    const stmt = db.prepare(
      `INSERT OR REPLACE INTO provider_connection_profiles (
         id, company_id, runtime_id, provider, display_name, connection_type, billing_model,
         biller, auth_surface, confidence, source, is_active, metadata_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM provider_connection_profiles WHERE id = ?), ?), ?)`,
    );

    for (const profile of profiles) {
      if (confirmedIds.has(profile.id)) continue;
      stmt.run(
        profile.id,
        companyId,
        profile.runtimeId,
        profile.provider,
        profile.displayName,
        profile.connectionType,
        profile.billingModel,
        profile.biller,
        profile.authSurface,
        profile.confidence,
        profile.source,
        profile.isActive ? 1 : 0,
        JSON.stringify(profile.metadata),
        profile.id,
        now,
        now,
      );
    }
  });
  transaction();

  return listProviderProfiles(db, companyId);
}

function listProviderProfiles(db: Database.Database, companyId: string): ProviderProfile[] {
  const rows = db
    .prepare(
      `SELECT id, runtime_id, provider, display_name, connection_type, billing_model, biller,
              auth_surface, confidence, source, is_active, metadata_json, updated_at
       FROM provider_connection_profiles
       WHERE company_id = ? AND is_active = 1
       ORDER BY
         provider,
         CASE confidence WHEN 'confirmed' THEN 0 WHEN 'reported' THEN 1 WHEN 'detected' THEN 2 WHEN 'inferred' THEN 3 ELSE 4 END,
         CASE billing_model
           WHEN 'hybrid' THEN 0
           WHEN 'unknown' THEN 1
           WHEN 'metered_tokens' THEN 2
           WHEN 'subscription_overage' THEN 3
           WHEN 'subscription_included' THEN 4
           WHEN 'local_free' THEN 5
           ELSE 6
         END,
         display_name`,
    )
    .all(companyId) as Array<{
      id: string;
      runtime_id: string | null;
      provider: string;
      display_name: string;
      connection_type: ProviderConnectionType;
      billing_model: ProviderBillingModel;
      biller: string;
      auth_surface: AuthSurface;
      confidence: Confidence;
      source: string;
      is_active: number;
      metadata_json: string | null;
      updated_at: string;
    }>;

  return rows.map((row) => ({
    id: row.id,
    runtimeId: row.runtime_id,
    provider: normalizeProvider(row.provider),
    displayName: row.display_name,
    connectionType: row.connection_type,
    billingModel: row.billing_model,
    biller: row.biller,
    authSurface: row.auth_surface,
    confidence: row.confidence,
    source: row.source,
    isActive: row.is_active === 1,
    metadata: parseJson(row.metadata_json),
    updatedAt: row.updated_at,
  }));
}

function companyIdOrThrow(db: Database.Database, companyIdOrSlug: string): string {
  const companyId = resolveCompanyId(db, companyIdOrSlug) ?? (
    db
      .prepare("SELECT id FROM companies WHERE UPPER(company_code) = UPPER(?) AND archived_at IS NULL LIMIT 1")
      .get(companyIdOrSlug) as { id: string } | undefined
  )?.id;
  if (!companyId) {
    throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  }
  return companyId;
}

export function updateCompanyProviderProfile(
  companyIdOrSlug: string,
  profileId: string,
  input: UpdateProviderProfileInput,
): ProviderProfile {
  const db = getOrchestrationDb();
  const companyId = companyIdOrThrow(db, companyIdOrSlug);
  upsertDetectedProviderProfiles(db, companyId);

  const row = db
    .prepare(
      `SELECT id, billing_model, connection_type, auth_surface, biller, is_active
       FROM provider_connection_profiles
       WHERE company_id = ? AND id = ?
       LIMIT 1`,
    )
    .get(companyId, profileId) as {
      id: string;
      billing_model: ProviderBillingModel;
      connection_type: ProviderConnectionType;
      auth_surface: AuthSurface;
      biller: string;
      is_active: number;
    } | undefined;

  if (!row) {
    throw new OrchestrationApiError(404, "provider_profile_not_found", "Provider profile not found");
  }

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE provider_connection_profiles
     SET billing_model = ?,
         connection_type = ?,
         auth_surface = ?,
         biller = ?,
         confidence = 'confirmed',
         source = 'user_confirmation',
         is_active = ?,
         updated_at = ?
     WHERE company_id = ? AND id = ?`,
  ).run(
    input.billingModel ?? row.billing_model,
    input.connectionType ?? row.connection_type,
    input.authSurface ?? row.auth_surface,
    input.biller?.trim() || row.biller,
    typeof input.isActive === "boolean" ? (input.isActive ? 1 : 0) : row.is_active,
    now,
    companyId,
    profileId,
  );

  const updated = listProviderProfiles(db, companyId).find((profile) => profile.id === profileId);
  if (!updated) {
    throw new OrchestrationApiError(404, "provider_profile_not_found", "Provider profile not found");
  }
  return updated;
}

function profileForProvider(profiles: ProviderProfile[], provider: string): ProviderProfile {
  return profiles.find((profile) => profile.provider === normalizeProvider(provider)) ?? {
    id: `inferred:${normalizeProvider(provider)}`,
    updatedAt: new Date().toISOString(),
    ...inferProfile({ provider }),
  };
}

function timeframeStart(timeframe: CostTimeframe, now = new Date()): Date | null {
  if (timeframe === "all") return null;
  if (timeframe === "mtd") return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  if (timeframe === "ytd") return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const days = timeframe === "7d" ? 7 : timeframe === "30d" ? 30 : 90;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

function eventFromUsage(input: {
  id: string;
  companyId: string;
  agentId: string | null;
  agentName: string | null;
  taskId: string | null;
  taskTitle: string | null;
  projectId: string | null;
  projectName: string | null;
  executionRunId: string | null;
  heartbeatRunId: string | null;
  provider: string;
  usage: Record<string, unknown>;
  profiles: ProviderProfile[];
  occurredAt: string;
}): CostEvent {
  const provider = normalizeProvider(stringFromRecord(input.usage, ["provider", "runtimeProvider"]) || input.provider);
  const profile = profileForProvider(input.profiles, provider);
  const rawCostCents = centsFromUsage(input.usage);
  const billingType = normalizeBillingType(stringFromRecord(input.usage, ["billingType", "billing_type", "billing"]), profile);
  const biller = stringFromRecord(input.usage, ["biller", "billingProvider", "billing_provider"]) || profile.biller;
  const inputTokens = numberFromRecord(input.usage, ["totalInputTokens", "inputTokens", "input_tokens"]);
  const outputTokens = numberFromRecord(input.usage, ["totalOutputTokens", "outputTokens", "output_tokens"]);
  const cacheReadTokens = numberFromRecord(input.usage, ["cacheReadTokens", "cachedReadTokens", "cacheReadInputTokens", "cache_read_tokens"]);
  const cacheWriteTokens = numberFromRecord(input.usage, ["cacheWriteTokens", "cacheCreationInputTokens", "cachedWriteTokens", "cache_write_tokens"]);

  return {
    id: input.id,
    agentId: input.agentId,
    agent: input.agentName ?? "Unassigned",
    taskId: input.taskId,
    taskTitle: input.taskTitle,
    projectId: input.projectId,
    project: input.projectName,
    executionRunId: input.executionRunId,
    heartbeatRunId: input.heartbeatRunId,
    provider,
    biller,
    billingType,
    model: modelFromUsage(input.usage, provider),
    inputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    outputTokens,
    tokens: inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens,
    cost: billableCostCents(billingType, rawCostCents) / 100,
    costSource: costSourceForBillingType(billingType, rawCostCents),
    confidence: rawCostCents > 0 || stringFromRecord(input.usage, ["billingType", "billing_type"]) ? "reported" : "inferred",
    occurredAt: input.occurredAt,
  };
}

function explicitCostEvents(db: Database.Database, companyId: string): CostEvent[] {
  const rows = db
    .prepare(
      `SELECT ce.*,
              a.name AS agent_name,
              t.title AS task_title,
              p.name AS project_name
       FROM cost_events ce
       LEFT JOIN agents a ON a.id = ce.agent_id
       LEFT JOIN tasks t ON t.id = ce.task_id OR t.task_key = ce.task_id
       LEFT JOIN projects p ON p.id = ce.project_id
       WHERE ce.company_id = ?
       ORDER BY ce.occurred_at DESC
       LIMIT 1000`,
    )
    .all(companyId) as RawCostEventRow[];

  return rows.map((row) => {
    const inputTokens = Number(row.input_tokens ?? 0);
    const outputTokens = Number(row.output_tokens ?? 0);
    const cacheReadTokens = Number(row.cache_read_tokens ?? 0);
    const cacheWriteTokens = Number(row.cache_write_tokens ?? 0);
    return {
      id: row.id,
      agentId: row.agent_id,
      agent: row.agent_name ?? "Unassigned",
      taskId: row.task_id,
      taskTitle: row.task_title,
      projectId: row.project_id,
      project: row.project_name,
      executionRunId: row.execution_run_id,
      heartbeatRunId: row.heartbeat_run_id,
      provider: normalizeProvider(row.provider),
      biller: row.biller,
      billingType: row.billing_type,
      model: row.model,
      inputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      outputTokens,
      tokens: inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens,
      cost: Number(row.cost_cents ?? 0) / 100,
      costSource: row.cost_source,
      confidence: row.confidence,
      occurredAt: row.occurred_at,
    };
  });
}

function virtualExecutionCostEvents(db: Database.Database, companyId: string, profiles: ProviderProfile[]): CostEvent[] {
  const rows = db
    .prepare(
      `SELECT er.id,
              er.task_id,
              t.title AS task_title,
              p.id AS project_id,
              p.name AS project_name,
              er.agent_id,
              a.name AS agent_name,
              er.provider,
              er.token_usage_json,
              er.started_at,
              er.completed_at,
              er.created_at
       FROM execution_runs er
       LEFT JOIN tasks t ON t.id = er.task_id OR t.task_key = er.task_id
       LEFT JOIN projects p ON p.id = t.project_id
       LEFT JOIN agents a ON a.id = er.agent_id
       WHERE (p.company_id = ? OR a.company_id = ?)
         AND er.token_usage_json IS NOT NULL
         AND er.token_usage_json <> '{}'
         AND NOT EXISTS (
           SELECT 1 FROM cost_events ce WHERE ce.execution_run_id = er.id
         )
       ORDER BY COALESCE(er.completed_at, er.started_at, er.created_at) DESC
       LIMIT 1000`,
    )
    .all(companyId, companyId) as RawExecutionRunRow[];

  return rows.map((row) => eventFromUsage({
    id: `virtual:${row.id}`,
    companyId,
    agentId: row.agent_id,
    agentName: row.agent_name,
    taskId: row.task_id,
    taskTitle: row.task_title,
    projectId: row.project_id,
    projectName: row.project_name,
    executionRunId: row.id,
    heartbeatRunId: null,
    provider: row.provider,
    usage: parseJson(row.token_usage_json),
    profiles,
    occurredAt: row.completed_at ?? row.started_at ?? row.created_at,
  }));
}

function emptyAggregate(): AggregateRow {
  return {
    cost: 0,
    tokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    eventCount: 0,
    meteredEvents: 0,
    subscriptionEvents: 0,
  };
}

function addAggregate(row: AggregateRow, event: CostEvent): void {
  row.cost += event.cost;
  row.tokens += event.tokens;
  row.inputTokens += event.inputTokens;
  row.outputTokens += event.outputTokens;
  row.cacheReadTokens += event.cacheReadTokens;
  row.cacheWriteTokens += event.cacheWriteTokens;
  row.eventCount += 1;
  if (event.billingType === "metered_api" || event.billingType === "subscription_overage") row.meteredEvents += 1;
  if (event.billingType === "subscription_included" || event.billingType === "local_free") row.subscriptionEvents += 1;
}

function sortAggregates<T extends AggregateRow>(rows: T[]): T[] {
  return rows.sort((a, b) => b.cost - a.cost || b.tokens - a.tokens || b.eventCount - a.eventCount);
}

function aggregateRows<R extends AggregateRow>(
  events: CostEvent[],
  keyForEvent: (event: CostEvent) => string,
  createRow: (event: CostEvent) => R,
): R[] {
  const map = new Map<string, R>();
  for (const event of events) {
    const value = keyForEvent(event) || "unknown";
    let row = map.get(value);
    if (!row) {
      row = createRow(event);
      map.set(value, row);
    }
    addAggregate(row, event);
  }
  return sortAggregates([...map.values()]);
}

function filterByTimeframe(events: CostEvent[], timeframe: CostTimeframe): CostEvent[] {
  const start = timeframeStart(timeframe);
  if (!start) return events;
  return events.filter((event) => {
    const occurred = new Date(event.occurredAt);
    return Number.isFinite(occurred.getTime()) && occurred >= start;
  });
}

function filterFinanceByTimeframe(events: FinanceEvent[], timeframe: CostTimeframe): FinanceEvent[] {
  const start = timeframeStart(timeframe);
  if (!start) return events;
  return events.filter((event) => {
    const occurred = new Date(event.occurredAt);
    return Number.isFinite(occurred.getTime()) && occurred >= start;
  });
}

function listFinanceEvents(db: Database.Database, companyId: string): FinanceEvent[] {
  const rows = db
    .prepare(
      `SELECT id, provider, biller, event_type, amount_cents, currency, source, confidence,
              period_start, period_end, external_id, description, metadata_json, occurred_at
       FROM provider_finance_events
       WHERE company_id = ?
       ORDER BY occurred_at DESC
       LIMIT 1000`,
    )
    .all(companyId) as RawFinanceEventRow[];

  return rows.map((row) => ({
    id: row.id,
    provider: normalizeProvider(row.provider),
    biller: row.biller,
    eventType: row.event_type,
    amount: Number(row.amount_cents ?? 0) / 100,
    currency: row.currency,
    source: row.source,
    confidence: row.confidence,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    externalId: row.external_id,
    description: row.description,
    metadata: parseJson(row.metadata_json),
    occurredAt: row.occurred_at,
  }));
}

function financeSignedAmount(eventType: FinanceEventType, amount: number): number {
  const absolute = Math.abs(amount);
  if (eventType === "credit") return -absolute;
  return amount < 0 ? amount : absolute;
}

export function listCompanyCostLedger(companyIdOrSlug: string, timeframe: CostTimeframe = "mtd"): CompanyCostLedger {
  const db = getOrchestrationDb();
  const companyId = companyIdOrThrow(db, companyIdOrSlug);

  const providerProfiles = upsertDetectedProviderProfiles(db, companyId);
  const allEvents = [
    ...explicitCostEvents(db, companyId),
    ...virtualExecutionCostEvents(db, companyId, providerProfiles),
  ].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  const allFinanceEvents = listFinanceEvents(db, companyId);
  const selectedEvents = filterByTimeframe(allEvents, timeframe);
  const selectedFinanceEvents = filterFinanceByTimeframe(allFinanceEvents, timeframe);

  const now = new Date();
  const today = dayKey(now);
  const yesterdayDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const yesterday = dayKey(yesterdayDate);
  const thisMonth = monthKey(now);
  const lastMonthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const lastMonth = monthKey(lastMonthDate);
  const daysElapsed = now.getUTCDate();
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();

  const dailySpend = (key: string) => allEvents.reduce((sum, event) => dayKey(new Date(event.occurredAt)) === key ? sum + event.cost : sum, 0);
  const monthlySpend = (key: string) => allEvents.reduce((sum, event) => monthKey(new Date(event.occurredAt)) === key ? sum + event.cost : sum, 0);
  const thisMonthSpend = monthlySpend(thisMonth);
  const selectedRangeSpend = selectedEvents.reduce((sum, event) => sum + event.cost, 0);
  const selectedRangeTokens = selectedEvents.reduce((sum, event) => sum + event.tokens, 0);
  const subscriptionEvents = selectedEvents.filter((event) => event.billingType === "subscription_included" || event.billingType === "local_free");
  const meteredEvents = selectedEvents.filter((event) => event.billingType === "metered_api" || event.billingType === "subscription_overage");
  const financeDebits = selectedFinanceEvents
    .filter((event) => event.amount > 0 && event.eventType !== "subscription")
    .reduce((sum, event) => sum + event.amount, 0);
  const financeCredits = Math.abs(selectedFinanceEvents
    .filter((event) => event.amount < 0 || event.eventType === "credit")
    .reduce((sum, event) => sum + event.amount, 0));
  const subscriptionFees = selectedFinanceEvents
    .filter((event) => event.eventType === "subscription")
    .reduce((sum, event) => sum + Math.max(0, event.amount), 0);
  const financeAdjustments = selectedFinanceEvents
    .filter((event) => event.eventType === "adjustment")
    .reduce((sum, event) => sum + event.amount, 0);
  const financeNet = selectedFinanceEvents.reduce((sum, event) => sum + event.amount, 0);

  return {
    today: dailySpend(today),
    yesterday: dailySpend(yesterday),
    thisMonth: thisMonthSpend,
    lastMonth: monthlySpend(lastMonth),
    projected: daysElapsed > 0 ? (thisMonthSpend / daysElapsed) * daysInMonth : 0,
    budget: DEFAULT_MONTHLY_BUDGET_USD,
    avgDaily: daysElapsed > 0 ? thisMonthSpend / daysElapsed : 0,
    daysElapsed,
    daysInMonth,
    selectedRangeSpend,
    selectedRangeTokens,
    meteredSpend: meteredEvents.reduce((sum, event) => sum + event.cost, 0),
    subscriptionTokens: subscriptionEvents.reduce((sum, event) => sum + event.tokens, 0),
    meteredEvents: meteredEvents.length,
    subscriptionEvents: subscriptionEvents.length,
    byAgent: aggregateRows(
      selectedEvents,
      (event) => event.agent,
      (event) => ({ ...emptyAggregate(), agent: event.agent }),
    ),
    byModel: aggregateRows(
      selectedEvents,
      (event) => event.model,
      (event) => ({ ...emptyAggregate(), model: event.model }),
    ),
    byProvider: aggregateRows(
      selectedEvents,
      (event) => event.provider,
      (event) => ({ ...emptyAggregate(), provider: event.provider, biller: event.biller, billingType: event.billingType }),
    ),
    byBiller: aggregateRows(
      selectedEvents,
      (event) => event.biller,
      (event) => ({ ...emptyAggregate(), biller: event.biller, billingType: event.billingType }),
    ),
    billingMix: aggregateRows(
      selectedEvents,
      (event) => event.billingType,
      (event) => ({ ...emptyAggregate(), billingType: event.billingType }),
    ),
    providerProfiles,
    recentEvents: selectedEvents.slice(0, 30),
    financeEvents: selectedFinanceEvents.slice(0, 50),
    financeDebits,
    financeCredits,
    subscriptionFees,
    financeAdjustments,
    financeNet,
  };
}

export function createCompanyFinanceEvent(
  companyIdOrSlug: string,
  input: CreateFinanceEventInput,
): FinanceEvent {
  const db = getOrchestrationDb();
  const companyId = companyIdOrThrow(db, companyIdOrSlug);
  const now = new Date().toISOString();
  const id = randomUUID();
  const provider = normalizeProvider(input.provider || input.biller || "unknown");
  const biller = input.biller.trim().toLowerCase() || provider;
  const currency = (input.currency?.trim().toUpperCase() || "USD").slice(0, 8);
  const amount = financeSignedAmount(input.eventType, input.amount);
  if (!Number.isFinite(amount) || amount === 0) {
    throw new OrchestrationApiError(400, "invalid_finance_amount", "Finance event amount must be non-zero");
  }

  db.prepare(
    `INSERT INTO provider_finance_events (
       id, company_id, provider, biller, event_type, amount_cents, currency, source,
       confidence, period_start, period_end, external_id, description, metadata_json,
       occurred_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    companyId,
    provider,
    biller,
    input.eventType,
    amount * 100,
    currency,
    input.source ?? "manual",
    input.confidence ?? "confirmed",
    input.periodStart ?? null,
    input.periodEnd ?? null,
    input.externalId?.trim() || null,
    input.description?.trim() || "",
    JSON.stringify(input.metadata ?? {}),
    input.occurredAt ?? now,
    now,
    now,
  );

  const event = listFinanceEvents(db, companyId).find((row) => row.id === id);
  if (!event) {
    throw new OrchestrationApiError(500, "finance_event_create_failed", "Finance event could not be created");
  }
  return event;
}

export function recordCostEventForExecution(input: RecordCostEventInput): string | null {
  const db = input.db ?? getOrchestrationDb();
  const profiles = listProviderProfiles(db, input.companyId);
  const event = eventFromUsage({
    id: input.eventId ?? randomUUID(),
    companyId: input.companyId,
    agentId: input.agentId ?? null,
    agentName: null,
    taskId: input.taskId ?? null,
    taskTitle: null,
    projectId: input.projectId ?? null,
    projectName: null,
    executionRunId: input.executionRunId ?? null,
    heartbeatRunId: input.heartbeatRunId ?? null,
    provider: input.provider,
    usage: input.usage,
    profiles,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
  });

  if (event.tokens <= 0 && event.cost <= 0) return null;

  db.prepare(
    `INSERT OR IGNORE INTO cost_events (
       id, company_id, agent_id, task_id, project_id, execution_run_id, heartbeat_run_id,
       provider, biller, billing_type, model, input_tokens, cache_read_tokens,
       cache_write_tokens, output_tokens, cost_cents, cost_source, confidence,
       metadata_json, occurred_at, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    event.id,
    input.companyId,
    event.agentId,
    event.taskId,
    event.projectId,
    event.executionRunId,
    event.heartbeatRunId,
    event.provider,
    event.biller,
    event.billingType,
    event.model,
    Math.round(event.inputTokens),
    Math.round(event.cacheReadTokens),
    Math.round(event.cacheWriteTokens),
    Math.round(event.outputTokens),
    event.cost * 100,
    event.costSource,
    event.confidence,
    JSON.stringify({ rawUsage: input.usage }),
    event.occurredAt,
    new Date().toISOString(),
  );

  return event.id;
}
