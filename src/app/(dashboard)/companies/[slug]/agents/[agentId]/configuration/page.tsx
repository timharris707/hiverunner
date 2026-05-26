"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Settings,
  ChevronDown,
  ChevronRight,
  Key,
  Shield,
  CheckCircle,
  XCircle,
  FileText,
  Check,
  Loader2,
  X,
  Radio,
  Layers,
} from "lucide-react";
import { useAgentProfile, A } from "../agent-context";
import { listCompanyAgents, listCompanyRuntimes } from "@/lib/orchestration/client";
import {
  capabilitiesFromTier,
  resolveAgentProviderPresentation,
  PROVIDER_PRODUCT_DESCRIPTORS,
} from "@/lib/orchestration/adapters/types";
import type {
  DetectedOrchestrationRuntime,
  OrchestrationRuntime,
} from "@/lib/orchestration/types";
import type {
  ProviderAvailability,
  ProviderProductDescriptor,
} from "@/lib/orchestration/adapters/types";
import {
  TierBadge,
  AvailabilityBadge,
  CAPABILITY_LABELS,
} from "@/components/orchestration/ProviderPresentation";
import { ProviderLogo } from "@/components/orchestration/ProviderLogo";
import { font, type as typography } from "@/lib/ui/tokens";

/* ── Types ── */
interface OpenClawConfig {
  agentId: string;
  model: string;
  workspace: string;
  agentDir: string;
  identity: { name: string; emoji: string; creature: string };
  soulExists: boolean;
  soulPreview: string | null;
  identityExists: boolean;
  identityPreview: string | null;
  sessionCount: number;
  permissions: Record<string, boolean>;
  runtimeConfig: Record<string, unknown>;
}

interface PeerAgent {
  id: string;
  name: string;
  role?: string;
}

interface AgentConfigPageAgentLike {
  id: string;
  name: string;
}

interface ProviderActivationCheckWire {
  check: string;
  passed: boolean;
  detail: string;
  blocking: boolean;
}

interface ProviderActivationWire {
  canActivate: boolean;
  providerId: string;
  agentId: string;
  currentProvider: string;
  checks: ProviderActivationCheckWire[];
  summary: string;
}

interface ProviderStatusWire {
  agentId: string;
  adapterType: string;
  currentProvider: {
    providerId: string;
    displayName: string;
    tier: number;
    tierLabel: string;
  };
  model: string | null;
  externalIds: {
    openclaw: string | null;
  };
  providerActivations: Record<string, ProviderActivationWire>;
}

interface RuntimeInventoryWire {
  runtimes: OrchestrationRuntime[];
  detectedLocalRuntimes: DetectedOrchestrationRuntime[];
}

interface ProviderBillingProfileWire {
  provider: string;
  displayName: string;
  connectionType: string;
  billingModel: string;
  biller: string;
  authSurface: string;
  confidence: string;
}

interface RuntimeSupportSummary {
  agentRuntime: OrchestrationRuntime | null;
  companyRuntime: OrchestrationRuntime | null;
  detectedRuntime: DetectedOrchestrationRuntime | null;
}

interface ExecutionSettingsAgentWire {
  agentId: string;
  name: string;
  adapterType?: string;
  modelId: string;
  timeoutSeconds: number | null;
  graceSeconds: number | null;
  safeRuntimeConfig: {
    heartbeatEnabled?: boolean;
    heartbeatIntervalSeconds?: number;
    executionProvider?: string;
    openclawAgentId?: string;
  };
  canUpdate: boolean;
  updateBlocker?: string;
}

interface ExecutionSettingsWire {
  writeSupport: {
    supported: boolean;
    reason?: string;
  };
  agents: ExecutionSettingsAgentWire[];
}

interface HeartbeatSettingsAgentWire {
  agentId: string;
  name: string;
  heartbeatEnabled: boolean;
  intervalSeconds: number;
  schedulerActive: boolean;
  lastHeartbeatAt?: string;
  canUpdate: boolean;
  updateBlocker?: string;
  pauseStatus: {
    isPaused: boolean;
    status: string;
    reason?: string;
    pausedAt?: string;
  };
}

interface HeartbeatSettingsWire {
  writeSupport: {
    supported: boolean;
    reason?: string;
  };
  agents: HeartbeatSettingsAgentWire[];
}

interface SwitchPlanWire {
  allowed: boolean;
  mode: "noop" | "blocked" | "switchable";
  summary: string;
  blockers: Array<{ code: string; message: string }>;
  warnings: Array<{ code: string; message: string }>;
  activation: ProviderActivationWire | null;
  inFlight: {
    activeHeartbeatRuns: number;
    pendingWakeupRequests: number;
    activeExecutionRuns: number;
    runs: Array<{
      kind: "heartbeat" | "wakeup" | "execution";
      id: string;
      status: string;
      provider: string | null;
      taskId: string | null;
      taskKey: string | null;
      taskTitle: string | null;
      taskStatus: string | null;
      createdAt: string | null;
      startedAt: string | null;
      updatedAt: string | null;
    }>;
  } | null;
  stateChanges: {
    preserved: string[];
    reset: string[];
    previousModel?: string | null;
    newModel?: string | null;
    modelUpdated?: boolean;
  } | null;
  targetBillingProfile?: ProviderBillingProfileWire | null;
  requiresBillingConfirmation?: boolean;
  billingConfirmationReason?: string | null;
  billingBudgetImpact?: {
    budgetUsd: number;
    monthSpendUsd: number;
    projectedMonthSpendUsd: number;
    meteredSpendUsd: number;
    utilizationPercent: number;
    requiresBudgetApproval: boolean;
    reason: string | null;
  } | null;
}

interface RuntimeModelWire {
  id: string;
  label: string;
  provider?: string;
  default?: boolean;
}

interface AgentFileWire {
  relativePath: string;
  name: string;
  group: "core" | "memory";
  exists: boolean;
  editable: boolean;
  size: number;
  updatedAt: string | null;
  content: string;
}

interface AgentFilesWire {
  agentId: string;
  workspaceRoot: string | null;
  files: AgentFileWire[];
  error?: string;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

const MODEL_OPTIONS = [
  "openai-codex/gpt-5.5",
  "anthropic/claude-opus-4-6",
  "anthropic/claude-sonnet-4-6",
  "openai-codex/gpt-5.4",
  "openai-codex/gpt-5.4-mini",
  "google/gemini-3-pro-preview",
  "google/gemini-3.1-pro-preview",
  "google/gemini-3-flash-preview",
  "google/gemini-2.5-pro",
];

const UI = {
  sectionBg: "var(--surface)",
  sectionBorder: "var(--border)",
  surface: "var(--surface-elevated)",
  surfaceBorder: "var(--border)",
  surfaceStrong: "var(--surface)",
  accentSurface: "var(--surface)",
  accentBorder: A.cardBorder,
  divider: "var(--border)",
  label: "var(--text-muted)",
  shadow: "var(--shadow-glass)",
};

const SWITCHABLE_PROVIDER_IDS = ["openclaw", "codex", "anthropic", "hermes", "gemini"] as const;

function normalizeSwitchProviderId(providerId: string): string {
  return providerId === "openclaw-heartbeat" ? "openclaw" : providerId;
}

function isHiddenProviderSurface(providerId: string): boolean {
  void providerId;
  return false;
}

function formatRuntimeStatus(status?: string | null): string {
  if (!status) return "Unknown";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function titleize(value: string): string {
  return value.replace(/[_-]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function profileForProvider(profiles: ProviderBillingProfileWire[], providerId: string): ProviderBillingProfileWire | null {
  const normalized = normalizeSwitchProviderId(providerId).toLowerCase();
  return profiles.find((profile) => normalizeSwitchProviderId(profile.provider).toLowerCase() === normalized) ?? null;
}

function billingLabel(profile?: ProviderBillingProfileWire | null): string {
  if (!profile) return "Unknown billing";
  if (profile.billingModel === "metered_tokens") return "Metered API";
  if (profile.billingModel === "subscription_included") return "Subscription included";
  if (profile.billingModel === "subscription_overage") return "Subscription overage";
  if (profile.billingModel === "local_free") return "Local/free";
  return titleize(profile.billingModel || "unknown");
}

function billingTone(profile?: ProviderBillingProfileWire | null): "neutral" | "warning" | "error" {
  if (!profile) return "warning";
  if (profile.billingModel === "metered_tokens" || profile.billingModel === "subscription_overage" || profile.billingModel === "unknown") return "warning";
  return "neutral";
}

function billingDecisionCopy(providerId: string, profile?: ProviderBillingProfileWire | null): string {
  const providerLabel = providerLabelForSwitchId(providerId);
  if (!profile) {
    return `${providerLabel} does not have a confirmed billing profile yet. Treat this as unknown until runtime detection or manual confirmation classifies it.`;
  }
  if (profile.billingModel === "metered_tokens") {
    return `${providerLabel} is classified as metered API usage billed by ${profile.biller}. Token usage is expected to create billable spend.`;
  }
  if (profile.billingModel === "subscription_included") {
    return `${providerLabel} is classified as subscription-included usage billed by ${profile.biller}. HiveRunner tracks tokens but treats request cost as included unless overage is reported.`;
  }
  if (profile.billingModel === "local_free") {
    return `${providerLabel} is classified as local/free. Tokens are usage telemetry, not vendor spend.`;
  }
  if (profile.billingModel === "hybrid") {
    return `${providerLabel} is classified as hybrid billing through ${profile.biller}. The downstream billing path may vary by run.`;
  }
  return `${providerLabel} billing is classified as ${titleize(profile.billingModel)} through ${profile.biller}.`;
}

function resolveRuntimeSupport(
  inventory: RuntimeInventoryWire,
  providerId: string,
  agentId: string,
): RuntimeSupportSummary {
  const normalizedProviderId = normalizeSwitchProviderId(providerId);
  const matchesProvider = (provider: string) => normalizeSwitchProviderId(provider) === normalizedProviderId;
  return {
    agentRuntime:
      inventory.runtimes.find((runtime) => runtime.agentId === agentId && matchesProvider(runtime.provider)) ?? null,
    companyRuntime:
      inventory.runtimes.find((runtime) => !runtime.agentId && matchesProvider(runtime.provider)) ?? null,
    detectedRuntime:
      inventory.detectedLocalRuntimes.find((runtime) => matchesProvider(runtime.provider)) ?? null,
  };
}

function runtimeSupportCopy(providerId: string, support: RuntimeSupportSummary, agentName: string): { tone: "neutral" | "error"; text: string } {
  const providerLabel = providerLabelForSwitchId(providerId);
  if (support.agentRuntime) {
    return {
      tone: support.agentRuntime.status === "error" || support.agentRuntime.status === "offline" ? "error" : "neutral",
      text: `${agentName} has a ${providerLabel} runtime binding (${support.agentRuntime.runtimeSlug}) with ${formatRuntimeStatus(support.agentRuntime.status).toLowerCase()} status.`,
    };
  }
  if (support.companyRuntime) {
    return {
      tone: support.companyRuntime.status === "error" || support.companyRuntime.status === "offline" ? "error" : "neutral",
      text: `${providerLabel} has a company runtime available, but ${agentName} is not explicitly bound to it.`,
    };
  }
  if (support.detectedRuntime) {
    return {
      tone: support.detectedRuntime.status === "error" || support.detectedRuntime.status === "offline" ? "error" : "neutral",
      text: `${providerLabel} is detected on this host. Attach it from Runtimes to make ${agentName}'s binding explicit.`,
    };
  }
  return {
    tone: "error",
    text: `${providerLabel} has no registered runtime row and no detected local CLI on this host.`,
  };
}

function providerLabelForSwitchId(providerId: string): string {
  const normalized = normalizeSwitchProviderId(providerId);
  const descriptor = PROVIDER_PRODUCT_DESCRIPTORS.find((entry) => normalizeSwitchProviderId(entry.providerId) === normalized);
  return descriptor?.displayName ?? normalized;
}

function providerDescriptorForSwitchId(providerId: string): ProviderProductDescriptor | null {
  const normalized = normalizeSwitchProviderId(providerId);
  return PROVIDER_PRODUCT_DESCRIPTORS.find((entry) => normalizeSwitchProviderId(entry.providerId) === normalized) ?? null;
}

function defaultModelForSwitchProvider(providerId: string, currentModel: string): string {
  const normalized = normalizeSwitchProviderId(providerId);
  if (normalized === "codex") return "openai-codex/gpt-5.5";
  if (normalized === "anthropic") return "anthropic/claude-sonnet-4-6";
  if (normalized === "gemini") return "google/gemini-3-pro-preview";
  if (currentModel) return currentModel;
  if (normalized === "hermes") return "anthropic/claude-sonnet-4-6";
  return "openai-codex/gpt-5.5";
}

function humanProviderSummary(providerId: string): string {
  const normalized = normalizeSwitchProviderId(providerId);
  if (normalized === "codex") return "Runs OpenAI Codex models as a first-class HiveRunner runtime for coding and orchestration work. HiveRunner captures assistant updates, lifecycle, tool activity, structured actions, and final output from Codex JSON events.";
  if (normalized === "anthropic") return "Runs Claude Code with structured activity telemetry, including live text, tool calls, and token/cost details.";
  if (normalized === "gemini") return "Runs Gemini models through the local CLI with lifecycle and final-output capture.";
  if (normalized === "hermes") return "Runs through Hermes ACP with structured assistant, thinking, and tool-result events.";
  if (normalized === "openclaw") return "Runs through the OpenClaw heartbeat gateway with live session events.";
  return "Choose the runtime provider and model this agent should use.";
}

function providerReadinessLabel(profile: ProviderBillingProfileWire | null): string {
  const billing = billingLabel(profile);
  return billing === "Unknown billing" ? "Model runtime" : billing;
}

function formatSeconds(value: number | null | undefined): string {
  if (value == null) return "Unavailable";
  if (value === 0) return "0s";
  if (value % 60 === 0) return `${value / 60}m`;
  return `${value}s`;
}

function formatObservedAt(value?: string | null): string {
  if (!value) return "Not observed";
  return new Date(value).toLocaleString();
}

function lookupActivation(
  activations: Record<string, ProviderActivationWire> | undefined,
  providerId: string,
): ProviderActivationWire | null {
  if (!activations) return null;
  return (
    activations[providerId] ??
    (providerId === "openclaw" ? activations["openclaw-heartbeat"] ?? null : null)
  );
}

function findAgentScopedRow<T extends { agentId: string; name?: string }>(
  rows: T[],
  agent: AgentConfigPageAgentLike,
): T | null {
  return (
    rows.find((row) => row.agentId === agent.id) ??
    rows.find((row) => row.name?.trim().toLowerCase() === agent.name.trim().toLowerCase()) ??
    null
  );
}

/* ── Provider resolution helpers ── */

function resolveAvailability(
  descriptor: ProviderProductDescriptor,
  activeProviderId: string,
): ProviderAvailability {
  if (descriptor.providerId === activeProviderId) return "active";
  return descriptor.defaultAvailability;
}

/* ── Main Page ── */
export default function AgentConfigurationPage() {
  const { profile, slug, reload } = useAgentProfile();
  const { agent } = profile;
  const runtimeCompanySlug = profile.company.slug || slug;

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [providerDetailsOpen, setProviderDetailsOpen] = useState(false);
  const [comparisonOpen, setComparisonOpen] = useState(true);
  const [oc, setOc] = useState<OpenClawConfig | null>(null);
  const [ocError, setOcError] = useState<string | null>(null);
  const [ocLoading, setOcLoading] = useState(true);
  const [peers, setPeers] = useState<PeerAgent[]>([]);
  const [providerStatus, setProviderStatus] = useState<ProviderStatusWire | null>(null);
  const [providerStatusError, setProviderStatusError] = useState<string | null>(null);
  const [runtimeInventory, setRuntimeInventory] = useState<RuntimeInventoryWire>({
    runtimes: [],
    detectedLocalRuntimes: [],
  });
  const [providerBillingProfiles, setProviderBillingProfiles] = useState<ProviderBillingProfileWire[]>([]);
  const [runtimeInventoryLoading, setRuntimeInventoryLoading] = useState(true);
  const [runtimeInventoryError, setRuntimeInventoryError] = useState<string | null>(null);
  const [runtimePoliciesLoading, setRuntimePoliciesLoading] = useState(true);
  const [runtimePoliciesError, setRuntimePoliciesError] = useState<string | null>(null);
  const [agentFiles, setAgentFiles] = useState<AgentFilesWire | null>(null);
  const [agentFilesLoading, setAgentFilesLoading] = useState(true);
  const [agentFilesError, setAgentFilesError] = useState<string | null>(null);
  const [executionSettingsRow, setExecutionSettingsRow] = useState<ExecutionSettingsAgentWire | null>(null);
  const [heartbeatSettingsRow, setHeartbeatSettingsRow] = useState<HeartbeatSettingsAgentWire | null>(null);
  const [companyExecutionSettings, setCompanyExecutionSettings] = useState<ExecutionSettingsWire | null>(null);
  const [companyHeartbeatSettings, setCompanyHeartbeatSettings] = useState<HeartbeatSettingsWire | null>(null);

  const openclawId = agent.openclawAgentId || "";
  const resolved = resolveAgentProviderPresentation({
    ...agent,
    adapterType: providerStatus?.adapterType || agent.adapterType,
  });
  const currentSwitchProvider = normalizeSwitchProviderId(resolved.providerId);
  const isOpenClawProvider = currentSwitchProvider === "openclaw";
  const shouldUseOpenClawConfig = isOpenClawProvider && Boolean(openclawId);
  const defaultSwitchTarget = SWITCHABLE_PROVIDER_IDS.includes(currentSwitchProvider as typeof SWITCHABLE_PROVIDER_IDS[number])
    ? currentSwitchProvider
    : "codex";
  const [switchTarget, setSwitchTarget] = useState<string>(defaultSwitchTarget);
  const [switchPlan, setSwitchPlan] = useState<SwitchPlanWire | null>(null);
  const [switchLoading, setSwitchLoading] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [switchNotice, setSwitchNotice] = useState<string | null>(null);
  const [billingConfirmed, setBillingConfirmed] = useState(false);
  const [switchModel, setSwitchModel] = useState(agent.model || "");
  const [switchModels, setSwitchModels] = useState<RuntimeModelWire[]>([]);
  const [switchModelsLoading, setSwitchModelsLoading] = useState(false);
  const [switchModelsError, setSwitchModelsError] = useState<string | null>(null);
  const resolvedReportsToName =
    agent.reportingToName
    || peers.find((p) => p.id === (agent.reportingTo ?? ""))?.name
    || null;
  const reportingToOptions = [
    { value: "", label: "\u2014 None \u2014" },
    ...(
      agent.reportingTo && !resolvedReportsToName
        ? [{ value: agent.reportingTo, label: "Unresolved current manager" }]
        : []
    ),
    ...peers.map((p) => ({
      value: p.id,
      label: p.role ? `${p.name} — ${p.role}` : p.name,
    })),
  ];

  const loadOpenClawConfig = useCallback(async () => {
    if (!shouldUseOpenClawConfig) {
      setOc(null);
      setOcError(null);
      setOcLoading(false);
      return;
    }
    setOcLoading(true);
    try {
      const response = await fetch(`/api/orchestration/agents/${encodeURIComponent(openclawId)}/openclaw-config`);
      if (!response.ok) throw new Error(`${response.status}`);
      const data = (await response.json()) as OpenClawConfig;
      setOc(data);
      setOcError(null);
    } catch (error) {
      setOc(null);
      setOcError(error instanceof Error ? error.message : "unknown_error");
    } finally {
      setOcLoading(false);
    }
  }, [openclawId, shouldUseOpenClawConfig]);

  const loadProviderStatus = useCallback(async () => {
    try {
      const response = await fetch(`/api/orchestration/agents/${encodeURIComponent(agent.id)}/provider-status`);
      if (!response.ok) throw new Error(`${response.status}`);
      const data = (await response.json()) as ProviderStatusWire;
      setProviderStatus(data);
      setProviderStatusError(null);
    } catch (error) {
      setProviderStatus(null);
      setProviderStatusError(error instanceof Error ? error.message : "unknown_error");
    }
  }, [agent.id]);

  const loadRuntimeInventory = useCallback(async () => {
    setRuntimeInventoryLoading(true);
    try {
      const [data, costs] = await Promise.all([
        listCompanyRuntimes(runtimeCompanySlug, { fast: true }),
        fetch(`/api/orchestration/companies/${encodeURIComponent(runtimeCompanySlug)}/costs?timeframe=mtd`, { cache: "no-store" })
          .then(async (response) => (response.ok ? await response.json() as { providerProfiles?: ProviderBillingProfileWire[] } : null))
          .catch(() => null),
      ]);
      setRuntimeInventory(data);
      setProviderBillingProfiles(costs?.providerProfiles ?? []);
      setRuntimeInventoryError(null);
    } catch (error) {
      setRuntimeInventory({ runtimes: [], detectedLocalRuntimes: [] });
      setProviderBillingProfiles([]);
      setRuntimeInventoryError(error instanceof Error ? error.message : "unknown_error");
    } finally {
      setRuntimeInventoryLoading(false);
    }
  }, [runtimeCompanySlug]);

  const loadRuntimePolicies = useCallback(async () => {
    setRuntimePoliciesLoading(true);
    try {
      const [executionResponse, heartbeatResponse] = await Promise.all([
        fetch(`/api/orchestration/companies/${encodeURIComponent(slug)}/settings/execution?includeNonProduction=true`),
        fetch(`/api/orchestration/companies/${encodeURIComponent(slug)}/settings/heartbeats?includeNonProduction=true`),
      ]);
      if (!executionResponse.ok || !heartbeatResponse.ok) {
        throw new Error(
          `${executionResponse.ok ? "" : `execution:${executionResponse.status}`} ${heartbeatResponse.ok ? "" : `heartbeat:${heartbeatResponse.status}`}`.trim(),
        );
      }

      const executionData = (await executionResponse.json()) as ExecutionSettingsWire;
      const heartbeatData = (await heartbeatResponse.json()) as HeartbeatSettingsWire;
      setCompanyExecutionSettings(executionData);
      setCompanyHeartbeatSettings(heartbeatData);
      setExecutionSettingsRow(findAgentScopedRow(executionData.agents, agent));
      setHeartbeatSettingsRow(findAgentScopedRow(heartbeatData.agents, agent));
      setRuntimePoliciesError(null);
    } catch (error) {
      setCompanyExecutionSettings(null);
      setCompanyHeartbeatSettings(null);
      setExecutionSettingsRow(null);
      setHeartbeatSettingsRow(null);
      setRuntimePoliciesError(error instanceof Error ? error.message : "unknown_error");
    } finally {
      setRuntimePoliciesLoading(false);
    }
  }, [agent, slug]);

  const loadAgentFiles = useCallback(async () => {
    setAgentFilesLoading(true);
    try {
      const response = await fetch(`/api/orchestration/agents/${encodeURIComponent(agent.id)}/files`, { cache: "no-store" });
      if (!response.ok) throw new Error(`${response.status}`);
      const data = (await response.json()) as AgentFilesWire;
      setAgentFiles(data);
      setAgentFilesError(null);
    } catch (error) {
      setAgentFiles(null);
      setAgentFilesError(error instanceof Error ? error.message : "unknown_error");
    } finally {
      setAgentFilesLoading(false);
    }
  }, [agent.id]);

  const refreshConfigurationData = useCallback(() => {
    void loadOpenClawConfig();
    void loadProviderStatus();
    void loadRuntimeInventory();
    void loadRuntimePolicies();
    void loadAgentFiles();
    reload();
  }, [loadAgentFiles, loadOpenClawConfig, loadProviderStatus, loadRuntimeInventory, loadRuntimePolicies, reload]);

  useEffect(() => {
    void loadOpenClawConfig();
  }, [loadOpenClawConfig]);

  useEffect(() => {
    void loadProviderStatus();
  }, [loadProviderStatus]);

  useEffect(() => {
    void loadRuntimeInventory();
  }, [loadRuntimeInventory]);

  useEffect(() => {
    void loadRuntimePolicies();
  }, [loadRuntimePolicies]);

  useEffect(() => {
    void loadAgentFiles();
  }, [loadAgentFiles]);

  useEffect(() => {
    listCompanyAgents(slug).then((agents) => {
      setPeers(
        agents
          .filter((a) => a.id !== agent.id)
          .map((a) => ({ id: a.id, name: a.name, role: a.role }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    }).catch(() => {});
  }, [slug, agent.id]);

  useEffect(() => {
    setSwitchTarget(defaultSwitchTarget);
    setSwitchPlan(null);
    setSwitchError(null);
    setBillingConfirmed(false);
  }, [defaultSwitchTarget, agent.id]);

  const patchConfig = useCallback(
    async (body: Record<string, unknown>) => {
      const endpoint = shouldUseOpenClawConfig
        ? `/api/orchestration/agents/${encodeURIComponent(openclawId)}/openclaw-config`
        : `/api/orchestration/agents/${encodeURIComponent(agent.id)}/profile`;
      const res = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      refreshConfigurationData();
      return data;
    },
    [agent.id, openclawId, refreshConfigurationData, shouldUseOpenClawConfig],
  );

  const patchExecutionSettings = useCallback(
    async (body: Partial<Pick<ExecutionSettingsAgentWire, "modelId" | "timeoutSeconds" | "graceSeconds">>) => {
      const res = await fetch(`/api/orchestration/companies/${encodeURIComponent(slug)}/settings/execution`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: agent.id, ...body }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      refreshConfigurationData();
      return data;
    },
    [agent.id, refreshConfigurationData, slug],
  );

  const patchHeartbeatSettings = useCallback(
    async (body: { heartbeatEnabled?: boolean; intervalSeconds?: number }) => {
      const res = await fetch(`/api/orchestration/companies/${encodeURIComponent(slug)}/settings/heartbeats`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: agent.id, ...body }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      refreshConfigurationData();
      return data;
    },
    [agent.id, refreshConfigurationData, slug],
  );

  const patchAgentFile = useCallback(
    async (relativePath: string, content: string) => {
      const res = await fetch(`/api/orchestration/agents/${encodeURIComponent(agent.id)}/files`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ relativePath, content }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      await loadAgentFiles();
      return data;
    },
    [agent.id, loadAgentFiles],
  );

  const loadSwitchPlan = useCallback(
    async (targetProvider: string) => {
      setSwitchLoading(true);
      setSwitchError(null);
      try {
        const response = await fetch(`/api/orchestration/agents/${encodeURIComponent(agent.id)}/provider/preflight`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetProvider, targetModel: switchModel || undefined, ignoreInFlight: true }),
        });
        if (!response.ok) throw new Error(`${response.status}`);
        const data = (await response.json()) as SwitchPlanWire;
        setSwitchPlan(data);
      } catch (error) {
        setSwitchPlan(null);
        setSwitchError(error instanceof Error ? error.message : "unknown_error");
      } finally {
        setSwitchLoading(false);
      }
    },
    [agent.id, switchModel],
  );

  const switchProvider = useCallback(async () => {
    setSwitchLoading(true);
    setSwitchError(null);
    setSwitchNotice(null);
    try {
      const response = await fetch(`/api/orchestration/agents/${encodeURIComponent(agent.id)}/provider`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetProvider: switchTarget, targetModel: switchModel || undefined, billingConfirmed }),
      });
      if (!response.ok) throw new Error(`${response.status}`);
      const result = (await response.json()) as { switched?: boolean; message?: string };
      refreshConfigurationData();
      await loadSwitchPlan(switchTarget);
      setSwitchNotice(result.message ?? "Provider state updated.");
    } catch (error) {
      setSwitchError(error instanceof Error ? error.message : "unknown_error");
    } finally {
      setSwitchLoading(false);
    }
  }, [agent.id, billingConfirmed, loadSwitchPlan, refreshConfigurationData, switchModel, switchTarget]);

  const currentProviderActivation =
    lookupActivation(providerStatus?.providerActivations, resolved.providerId) ??
    lookupActivation(providerStatus?.providerActivations, currentSwitchProvider);
  const currentRuntimeSupport = useMemo(
    () => resolveRuntimeSupport(runtimeInventory, currentSwitchProvider, agent.id),
    [agent.id, currentSwitchProvider, runtimeInventory],
  );
  const selectedRuntimeSupport = useMemo(
    () => resolveRuntimeSupport(runtimeInventory, switchTarget, agent.id),
    [agent.id, runtimeInventory, switchTarget],
  );
  const currentRegisteredRuntime = currentRuntimeSupport.agentRuntime ?? currentRuntimeSupport.companyRuntime;
  const currentDetectedRuntime = currentRuntimeSupport.detectedRuntime;
  const selectedAgentRuntimeCommand = selectedRuntimeSupport.agentRuntime?.command ?? null;
  const selectedCompanyRuntimeCommand = selectedRuntimeSupport.companyRuntime?.command ?? null;
  const selectedDetectedRuntimeCommand = selectedRuntimeSupport.detectedRuntime?.command ?? null;
  const selectedDetectedRuntimeCommandPath = selectedRuntimeSupport.detectedRuntime?.commandPath ?? null;
  const runtimeWorkspaceValue = currentRegisteredRuntime?.workspaceRoot ?? (shouldUseOpenClawConfig ? oc?.workspace : "") ?? "";
  const currentRuntimeSupportMessage = runtimeSupportCopy(currentSwitchProvider, currentRuntimeSupport, agent.name);
  const selectedRuntimeSupportMessage = runtimeSupportCopy(switchTarget, selectedRuntimeSupport, agent.name);
  const currentBillingProfile = profileForProvider(providerBillingProfiles, currentSwitchProvider);
  const selectedBillingProfile = profileForProvider(providerBillingProfiles, switchTarget) ?? switchPlan?.targetBillingProfile ?? null;
  const requiresBillingConfirmation = switchPlan?.requiresBillingConfirmation === true;
  const unhandledDetectedRuntimes = runtimeInventory.detectedLocalRuntimes.filter(
    (runtime) =>
      !isHiddenProviderSurface(runtime.provider) &&
      !SWITCHABLE_PROVIDER_IDS.includes(normalizeSwitchProviderId(runtime.provider) as typeof SWITCHABLE_PROVIDER_IDS[number]),
  );
  const runtimeWorkspaceEditable = shouldUseOpenClawConfig && Boolean(oc && !ocError);
  const modelEditable = shouldUseOpenClawConfig
    ? Boolean(oc && !ocError)
    : true;
  const modelValue = executionSettingsRow?.modelId || oc?.model || agent.model || "";
  const switchModelOptions = useMemo(() => {
    const rows: RuntimeModelWire[] = switchModels.length
      ? switchModels
      : MODEL_OPTIONS.map((id) => ({ id, label: id }));
    if (!switchModel || rows.some((model) => model.id === switchModel)) return rows;
    return [{ id: switchModel, label: switchModel }, ...rows];
  }, [switchModel, switchModels]);

  useEffect(() => {
    setSwitchModel(modelValue);
  }, [agent.id, modelValue]);

  useEffect(() => {
    let cancelled = false;
    setSwitchModelsLoading(true);
    setSwitchModelsError(null);
    fetch("/api/orchestration/runtime-models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: switchTarget,
        command: selectedAgentRuntimeCommand ?? selectedCompanyRuntimeCommand ?? selectedDetectedRuntimeCommand ?? undefined,
        commandPath: selectedDetectedRuntimeCommandPath ?? undefined,
      }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`${response.status}`);
        return await response.json() as { models?: RuntimeModelWire[] };
      })
      .then((payload) => {
        if (cancelled) return;
        const models = Array.isArray(payload.models) ? payload.models : [];
        setSwitchModels(models);
        if (models.length > 0) {
          setSwitchModel((current) => {
            if (current && models.some((model) => model.id === current)) return current;
            return models.find((model) => model.default)?.id ?? models[0]?.id ?? current;
          });
        }
      })
      .catch((error) => {
        if (cancelled) return;
        setSwitchModels([]);
        setSwitchModelsError(error instanceof Error ? error.message : "unknown_error");
      })
      .finally(() => {
        if (!cancelled) setSwitchModelsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    agent.id,
    selectedAgentRuntimeCommand,
    selectedCompanyRuntimeCommand,
    selectedDetectedRuntimeCommand,
    selectedDetectedRuntimeCommandPath,
    switchTarget,
  ]);

  // OpenClaw-backed agents keep local runtime config; other providers use provider settings APIs.
  const localRuntimeConfig = oc?.runtimeConfig as Record<string, number | boolean | undefined> | undefined;
  const hasLocalRuntimeConfig = shouldUseOpenClawConfig && Boolean(oc && !ocError);
  const timeoutEditable = hasLocalRuntimeConfig;
  const heartbeatEditable = hasLocalRuntimeConfig;
  const hasPersistedHeartbeatPolicy = hasLocalRuntimeConfig;
  const heartbeatPolicyNote =
    hasLocalRuntimeConfig
          ? "Persisted locally in runtime_config_json. Read by the execution engine at run start."
          : "Runtime configuration unavailable.";
  const executionPolicyNote =
    hasLocalRuntimeConfig
          ? "Persisted locally in runtime_config_json. Read by the execution engine at run start."
          : "Runtime configuration unavailable.";

  // Helpers for local runtime config persistence
  const patchLocalRuntime = useCallback(
    (patch: Record<string, number | boolean | null>) => {
      const current = (oc?.runtimeConfig ?? {}) as Record<string, unknown>;
      return patchConfig({ runtimeConfig: { ...current, ...patch } });
    },
    [oc, patchConfig],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, paddingBottom: 20, maxWidth: 1180 }}>
      {/* ── Identity ── */}
      <Section
        icon={<Settings size={14} />}
        title="Identity"
        subtitle="Profile details and the runtime path this agent uses when it goes to work."
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))",
            gap: 18,
            alignItems: "start",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
              <EditableText
                label="Name"
                value={agent.name}
                onSave={(v) => patchConfig({ name: v })}
              />
              <EditableText
                label="Title / Role"
                value={agent.role}
                onSave={(v) => patchConfig({ title: v })}
              />
            </div>
            <EditableSelect
              label="Reports to"
              value={agent.reportingTo ?? ""}
              options={reportingToOptions}
              onSave={(v) => patchConfig({ reportsTo: v || null })}
              displayValue={
                resolvedReportsToName
                || (!agent.reportingTo ? "\u2014 None \u2014" : "Unresolved manager link")
              }
              helpText={
                resolvedReportsToName
                  ? `Reports to ${resolvedReportsToName}`
                  : agent.reportingTo
                    ? "Stored manager link no longer resolves to an active agent."
                    : "No manager linked"
              }
            />
            <EditableTextarea
              label="Capabilities"
              value={agent.personality ?? ""}
              onSave={(v) => patchConfig({ personality: v })}
            />
          </div>

          <IdentityProviderModelControl
            currentProvider={currentSwitchProvider}
            currentModel={modelValue}
            switchTarget={switchTarget}
            switchModel={switchModel}
            switchModelOptions={switchModelOptions}
            switchModelsLoading={switchModelsLoading}
            switchModelsError={switchModelsError}
            switchLoading={switchLoading}
            switchPlan={switchPlan}
            switchNotice={switchNotice}
            switchError={switchError}
            selectedRuntimeSupportMessage={selectedRuntimeSupportMessage}
            selectedBillingProfile={selectedBillingProfile}
            requiresBillingConfirmation={requiresBillingConfirmation}
            billingConfirmed={billingConfirmed}
            onBillingConfirmedChange={setBillingConfirmed}
            onProviderChange={(providerId) => {
              setSwitchTarget(providerId);
              setSwitchModel(defaultModelForSwitchProvider(providerId, modelValue));
              setSwitchPlan(null);
              setSwitchError(null);
              setSwitchNotice(null);
              setBillingConfirmed(false);
            }}
            onModelChange={(modelId) => {
              setSwitchModel(modelId);
              setSwitchPlan(null);
              setSwitchError(null);
              setSwitchNotice(null);
            }}
            onTest={() => void loadSwitchPlan(switchTarget)}
            onApply={() => void switchProvider()}
          />
        </div>
      </Section>

      <Section
        icon={<FileText size={14} />}
        title="Agent Core Files"
        subtitle="View and edit the identity, soul, operating loop, tooling notes, and memory files used by this agent at runtime."
      >
        <AgentFilesEditor
          data={agentFiles}
          loading={agentFilesLoading}
          error={agentFilesError}
          onSave={patchAgentFile}
        />
      </Section>

      {/* ══════════════════════════════════════════
          RUNTIME & PROVIDER
          ══════════════════════════════════════════ */}
      <Section
        icon={<Radio size={14} />}
        title="Runtime & Provider"
        subtitle="Inspect the active provider, selected model, runtime binding, and dashboard telemetry level."
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
            gap: 14,
            marginBottom: 14,
          }}
        >
          <SummaryCard
            eyebrow="Current runtime"
            title="Execution runtime"
            subtitle="Local workspace and bridge details for the active agent runtime."
          >
            <SummaryListRow label="Adapter" value={providerStatus?.adapterType || agent.adapterType || "\u2014"} mono />
            <SummaryListRow label="Model" value={modelValue || "\u2014"} mono />
            <SummaryListRow label="Billing" value={billingLabel(currentBillingProfile)} />
            <SummaryListRow label="Biller" value={currentBillingProfile?.biller ?? "\u2014"} mono />
            <SummaryListRow label="Workspace" value={runtimeWorkspaceValue || "\u2014"} mono />
            {shouldUseOpenClawConfig ? <SummaryListRow label="Agent dir" value={oc?.agentDir || "\u2014"} mono /> : null}
            {shouldUseOpenClawConfig ? <SummaryListRow label="Sessions" value={String(oc?.sessionCount ?? "\u2014")} /> : null}
            {shouldUseOpenClawConfig && ocLoading ? (
              <InlineStatusText>Loading runtime bridge details…</InlineStatusText>
            ) : null}
            {shouldUseOpenClawConfig && ocError ? (
              <InlineStatusText tone="error">
                Could not load runtime bridge details ({ocError}). Provider identity remains available.
              </InlineStatusText>
            ) : null}
          </SummaryCard>

          <SummaryCard
            eyebrow="Current provider"
            title={resolved.displayName}
            subtitle={resolved.integrationPath}
            badge={(
              <>
                <TierBadge tier={resolved.tier} />
              </>
            )}
            accent
          >
            <div style={{ marginTop: 2 }}>
              <SupportNote title="Billing profile" tone={billingTone(currentBillingProfile)}>
                <SwitchStateList items={[billingDecisionCopy(currentSwitchProvider, currentBillingProfile)]} />
              </SupportNote>
              <div style={{ height: 12 }} />
              <div style={microHeadingStyle}>Observability capabilities</div>
              <ReadableCapabilityGrid capabilities={resolved.capabilities} />
            </div>
          </SummaryCard>

          <SummaryCard
            eyebrow="Runtime registry"
            title={currentRegisteredRuntime?.displayName ?? currentDetectedRuntime?.displayName ?? "No registered binding"}
            subtitle="Inventory-backed runtime availability for the active provider."
            badge={(
              <RuntimeStatusPill
                status={currentRegisteredRuntime?.status ?? currentDetectedRuntime?.status ?? "unknown"}
              />
            )}
          >
            <SummaryListRow
              label="Provider"
              value={normalizeSwitchProviderId(currentRegisteredRuntime?.provider ?? currentDetectedRuntime?.provider ?? currentSwitchProvider)}
              mono
            />
            <SummaryListRow
              label="Binding"
              value={currentRuntimeSupport.agentRuntime ? "Agent scoped" : currentRuntimeSupport.companyRuntime ? "Company scoped" : currentRuntimeSupport.detectedRuntime ? "Detected only" : "Missing"}
            />
            <SummaryListRow
              label="Runtime"
              value={currentRegisteredRuntime?.runtimeSlug ?? currentDetectedRuntime?.command ?? "\u2014"}
              mono
            />
            <SummaryListRow
              label="Command"
              value={currentRegisteredRuntime?.command ?? currentDetectedRuntime?.commandPath ?? "\u2014"}
              mono
            />
            <SummaryListRow
              label="Version"
              value={currentRegisteredRuntime?.version ?? currentDetectedRuntime?.version ?? "\u2014"}
              mono
            />
            {runtimeInventoryLoading ? (
              <InlineStatusText>Loading runtime inventory…</InlineStatusText>
            ) : (
              <InlineStatusText tone={currentRuntimeSupportMessage.tone}>
                {currentRuntimeSupportMessage.text}
              </InlineStatusText>
            )}
            {runtimeInventoryError ? (
              <InlineStatusText tone="error">
                Could not load runtime inventory ({runtimeInventoryError}).
              </InlineStatusText>
            ) : null}
          </SummaryCard>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
            gap: 14,
            marginBottom: 6,
          }}
        >
          <SummaryCard
            eyebrow="Current provider state"
            title="Activation & linkage"
            subtitle="What HiveRunner can verify before routing work through this provider."
          >
            <SummaryListRow label="Adapter type" value={providerStatus?.adapterType || agent.adapterType || "\u2014"} mono />
            {shouldUseOpenClawConfig ? (
              <SummaryListRow label="OpenClaw ID" value={providerStatus?.externalIds.openclaw || agent.openclawAgentId || "\u2014"} mono />
            ) : null}
            <SummaryListRow
              label="Activation"
              value={currentProviderActivation?.canActivate ? "Ready to route" : "Blocked or partially verified"}
            />
            {currentProviderActivation ? (
              <>
                <InlineStatusText>{currentProviderActivation.summary}</InlineStatusText>
                <ActivationCheckList checks={currentProviderActivation.checks} />
              </>
            ) : providerStatusError ? (
              <InlineStatusText tone="error">
                Could not inspect provider activation ({providerStatusError}).
              </InlineStatusText>
            ) : (
              <InlineStatusText>Provider activation checks have not loaded yet.</InlineStatusText>
            )}
          </SummaryCard>

        </div>

        {/* ── Provider Comparison ── */}
        <DisclosureButton
          open={comparisonOpen}
          onToggle={() => setComparisonOpen(!comparisonOpen)}
          icon={<Layers size={13} />}
          label="Provider comparison (read-only)"
        />

        {comparisonOpen && (
          <div style={detailPanelStyle}>
            {/* Header note */}
            <div style={{ ...infoNoteStyle, marginBottom: 12 }}>
              This compares provider integrations and dashboard telemetry, not model quality. The provider/model selector above is the source of truth for what this agent will run.
            </div>
            {unhandledDetectedRuntimes.length > 0 ? (
              <div style={{ ...infoNoteStyle, marginBottom: 12 }}>
                Detected but not switchable here: {unhandledDetectedRuntimes.map((runtime) => runtime.displayName).join(", ")}. These runtimes are inventoried, but HiveRunner does not yet expose them as executable agent providers.
              </div>
            ) : null}
            {/* Provider rows */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {PROVIDER_PRODUCT_DESCRIPTORS.filter((desc) => !isHiddenProviderSurface(desc.providerId)).map((desc) => {
                const avail = resolveAvailability(desc, resolved.providerId);
                const caps = capabilitiesFromTier(desc.maxTier, desc.capabilityOverrides);
                return (
                  <ProviderComparisonRow
                    key={desc.providerId}
                    descriptor={desc}
                    availability={avail}
                    capabilities={caps}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* ── Provider-Specific Details (collapsible) ── */}
        <DisclosureButton
          open={providerDetailsOpen}
          onToggle={() => setProviderDetailsOpen(!providerDetailsOpen)}
          label="Provider details"
        />

        {providerDetailsOpen && (
          <div style={detailPanelStyle}>
            <ReadOnlyRow label="Provider ID" value={resolved.providerId} mono />
            <ReadOnlyRow label="Adapter type" value={providerStatus?.adapterType || agent.adapterType || "\u2014"} mono />
            <ReadOnlyRow label="Workspace" value={runtimeWorkspaceValue || "\u2014"} mono />
            {shouldUseOpenClawConfig && oc?.agentDir ? <ReadOnlyRow label="Agent Dir" value={oc.agentDir} mono /> : null}
            {shouldUseOpenClawConfig && agent.openclawAgentId ? <ReadOnlyRow label="OpenClaw agent ID" value={agent.openclawAgentId} mono /> : null}
            {ocLoading && (
              <InlineStatusText>Loading provider config…</InlineStatusText>
            )}
            {ocError && (
              <InlineStatusText tone="error">Failed to load provider config ({ocError})</InlineStatusText>
            )}
          </div>
        )}
      </Section>

      {/* ── Run Policy ── */}
      <Section
        icon={<Settings size={14} />}
        title="Run Policy"
        subtitle="Real runtime controls where HiveRunner has backing support, plus explicit read-only limits where it does not."
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 14,
            marginBottom: 14,
          }}
        >
          <SummaryCard
            eyebrow="Local runtime"
            title="Runtime configuration"
            subtitle="Controls backed by the local runtime scaffold and HiveRunner agent record."
          >
            {modelEditable ? (
              <EditableSelect
                label="Model"
                value={modelValue}
                options={MODEL_OPTIONS.map((m) => ({ value: m, label: m }))}
                onSave={(value) =>
                  shouldUseOpenClawConfig
                      ? patchConfig({ model: value })
                      : patchConfig({ model: value })
                }
                mono
                helpText={
                  shouldUseOpenClawConfig
                      ? "Writes to the local runtime config and HiveRunner agent record."
                      : "Writes to HiveRunner's provider execution settings."
                }
              />
            ) : (
              <ReadOnlyRow label="Model" value={modelValue || "\u2014"} mono />
            )}
            {runtimeWorkspaceEditable ? (
              <EditableText
                label="Workspace"
                value={runtimeWorkspaceValue}
                onSave={(value) => patchConfig({ workspace: value })}
                mono
              />
            ) : (
              <ReadOnlyRow label="Workspace" value={runtimeWorkspaceValue || "\u2014"} mono />
            )}
            {shouldUseOpenClawConfig && oc?.agentDir ? <ReadOnlyRow label="Agent dir" value={oc.agentDir} mono /> : null}
            {shouldUseOpenClawConfig && agent.openclawAgentId ? <ReadOnlyRow label="OpenClaw ID" value={agent.openclawAgentId} mono /> : null}
            {shouldUseOpenClawConfig && oc ? <ReadOnlyRow label="Sessions" value={String(oc.sessionCount ?? "\u2014")} /> : null}
            {!runtimeWorkspaceEditable || !modelEditable ? (
              <InlineStatusText>
                Local runtime edits are only available when HiveRunner can resolve a writable runtime configuration for this provider.
              </InlineStatusText>
            ) : null}
          </SummaryCard>

          <SummaryCard
            eyebrow="Execution policy"
            title="Timeouts & runtime limits"
            subtitle="Persisted locally in runtime_config_json. Read by the engine at run start."
          >
            {timeoutEditable ? (
              <>
                <EditableNumber
                  label="Timeout"
                  value={typeof localRuntimeConfig?.timeoutSeconds === "number" ? localRuntimeConfig.timeoutSeconds : null}
                  onSave={(value) => patchLocalRuntime({ timeoutSeconds: value })}
                  suffix="seconds"
                />
                <EditableNumber
                  label="Grace"
                  value={typeof localRuntimeConfig?.graceSeconds === "number" ? localRuntimeConfig.graceSeconds : null}
                  onSave={(value) => patchLocalRuntime({ graceSeconds: value })}
                  suffix="seconds"
                />
              </>
            ) : (
              <>
                <ReadOnlyRow label="Timeout" value={formatSeconds(executionSettingsRow?.timeoutSeconds)} />
                <ReadOnlyRow label="Grace" value={formatSeconds(executionSettingsRow?.graceSeconds)} />
              </>
            )}
            <ReadOnlyRow
              label="Policy source"
              value="Local runtime_config_json"
              mono
            />
            <ReadOnlyRow
              label="Execution provider"
              value={executionSettingsRow?.safeRuntimeConfig.executionProvider || resolved.providerId}
              mono
            />
            {executionPolicyNote ? <InlineStatusText>{executionPolicyNote}</InlineStatusText> : null}
          </SummaryCard>

          <SummaryCard
            eyebrow="Heartbeat policy"
            title="Scheduler & cadence"
            subtitle="Persisted locally in runtime_config_json. Read by the engine at run start."
          >
            {heartbeatEditable ? (
              <>
                <EditableSelect
                  label="Heartbeat"
                  value={localRuntimeConfig?.heartbeatEnabled ? "enabled" : "disabled"}
                  options={[
                    { value: "enabled", label: "Enabled" },
                    { value: "disabled", label: "Disabled" },
                  ]}
                  onSave={(value) => patchLocalRuntime({ heartbeatEnabled: value === "enabled" })}
                />
                <EditableNumber
                  label="Interval"
                  value={typeof localRuntimeConfig?.heartbeatIntervalSeconds === "number" ? localRuntimeConfig.heartbeatIntervalSeconds : 0}
                  onSave={(value) => patchLocalRuntime({ heartbeatIntervalSeconds: value })}
                  suffix="seconds"
                />
              </>
            ) : (
              <>
                <ReadOnlyRow
                  label="Heartbeat"
                  value={hasPersistedHeartbeatPolicy ? (heartbeatSettingsRow?.heartbeatEnabled ? "Enabled" : "Disabled") : "Not exposed"}
                />
                <ReadOnlyRow
                  label="Interval"
                  value={hasPersistedHeartbeatPolicy ? formatSeconds(heartbeatSettingsRow?.intervalSeconds) : "Not exposed"}
                />
              </>
            )}
            <ReadOnlyRow
              label="Scheduler"
              value="Local engine"
            />
            <ReadOnlyRow label="Last heartbeat" value={formatObservedAt(heartbeatSettingsRow?.lastHeartbeatAt || agent.lastHeartbeat)} />
            {heartbeatPolicyNote ? <InlineStatusText>{heartbeatPolicyNote}</InlineStatusText> : null}
          </SummaryCard>
        </div>

        {runtimePoliciesError ? (
          <InlineStatusText tone="error">
            Could not load runtime policy detail ({runtimePoliciesError}).
          </InlineStatusText>
        ) : null}
        {runtimePoliciesLoading ? (
          <InlineStatusText>Loading runtime policy detail…</InlineStatusText>
        ) : null}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 12,
            marginTop: 2,
          }}
        >
          <MetricCard
            label="Heartbeat interval"
            value={
              hasPersistedHeartbeatPolicy
                ? formatSeconds(heartbeatSettingsRow?.intervalSeconds)
                : "Not exposed"
            }
            detail={
              hasPersistedHeartbeatPolicy
                ? `Scheduler ${heartbeatSettingsRow?.schedulerActive ? "active" : "inactive"}`
                : "This runtime does not persist a per-agent heartbeat interval here."
            }
            badge={<TogglePill enabled={Boolean(heartbeatSettingsRow?.schedulerActive)} label={heartbeatSettingsRow?.schedulerActive ? "Active" : "Limited"} />}
          />
          <MetricCard
            label="Sessions"
            value={String(oc?.sessionCount ?? "\u2014")}
            detail="Observed agent runtime sessions."
          />
          <MetricCard
            label="Total runtime"
            value={`${agent.totalRuntimeMinutes ?? 0} minutes`}
            detail="Accumulated tracked execution time."
          />
          <MetricCard
            label="Tasks completed"
            value={String(agent.tasksCompleted ?? 0)}
            detail="HiveRunner task completions."
          />
        </div>

        {/* Advanced collapsible */}
        <DisclosureButton
          open={advancedOpen}
          onToggle={() => setAdvancedOpen(!advancedOpen)}
          label="Advanced Run Policy"
        />
        {advancedOpen && (
          <div style={detailPanelStyle}>
            <ReadOnlyRow label="Status" value={agent.status} />
            <ReadOnlyRow label="Current task" value={agent.currentTask ?? "\u2014"} mono />
            <ReadOnlyRow label="Created" value={agent.created ? new Date(agent.created).toLocaleString() : "\u2014"} />
            <ReadOnlyRow label="Updated" value={agent.updated ? new Date(agent.updated).toLocaleString() : "\u2014"} />
          </div>
        )}
      </Section>

      {/* ── Permissions ── */}
      <Section
        icon={<Shield size={14} />}
        title="Permissions"
        subtitle="Company-granted capabilities stored in the orchestration database."
      >
        <PermissionRow
          label="Can create new agents"
          enabled={Boolean(oc?.permissions?.canCreateAgents)}
          description="Lets this agent create or hire agents and implicitly assign tasks."
          onToggle={oc ? (val) => {
            const next = { ...oc.permissions, canCreateAgents: val };
            patchConfig({ permissions: next });
          } : undefined}
        />
        <PermissionRow
          label="Can assign tasks"
          enabled={Boolean(oc?.permissions?.canAssignTasks)}
          description="Enables task assignment via the orchestration engine."
          onToggle={oc ? (val) => {
            const next = { ...oc.permissions, canAssignTasks: val };
            patchConfig({ permissions: next });
          } : undefined}
        />
      </Section>

      {/* ── API Keys ── */}
      <Section
        icon={<Key size={14} />}
        title="API Keys"
        subtitle="Agent-specific credentials for HiveRunner integrations."
      >
        <EmptyStateCard
          title="No active API keys"
          body="This agent does not currently have any HiveRunner API keys configured."
        />
      </Section>
    </div>
  );
}

/* ══════════════════════════════════════════
   Provider display components
   ──────────────────────────────────────────
   TierBadge, CapabilityRow, CapabilityGrid,
   and AvailabilityBadge are imported from
   @/components/orchestration/ProviderPresentation
   ══════════════════════════════════════════ */

/** Provider comparison row — shows one provider with tier, availability, and capability summary */
function ProviderComparisonRow({
  descriptor,
  availability,
  capabilities,
}: {
  descriptor: ProviderProductDescriptor;
  availability: ProviderAvailability;
  capabilities: import("@/lib/orchestration/adapters/types").ProviderCapabilities;
}) {
  const [expanded, setExpanded] = useState(false);
  const capCount = CAPABILITY_LABELS
    .filter(({ key }) => capabilities[key])
    .length;
  const isActive = availability === "active";
  const isPlanned = availability === "planned";

  return (
    <div style={{
      padding: "12px 14px", borderRadius: 14,
      background: isActive ? "var(--positive-soft)" : UI.surface,
      border: `0.5px solid ${isActive ? "rgba(23, 122, 50, 0.22)" : UI.surfaceBorder}`,
      opacity: isPlanned ? 0.6 : 1,
    }}>
      {/* Header row */}
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "flex", alignItems: "center", width: "100%",
          gap: 10, padding: 0, background: "none", border: "none",
          cursor: "pointer", color: A.text,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: isActive ? "var(--positive)" : A.text }}>
          {descriptor.displayName}
        </span>
        <TierBadge tier={descriptor.maxTier} />
        <AvailabilityBadge availability={availability} />
        <span style={{
          fontSize: 11, color: A.textSec, marginLeft: "auto",
          display: "flex", alignItems: "center", gap: 4,
        }}>
          dashboard detail {capCount}/6
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: `0.5px solid ${UI.divider}` }}>
          <div style={{ fontSize: 12, color: A.textSec, marginBottom: 10, lineHeight: 1.6 }}>
            {descriptor.integrationPath}. This is the integration surface HiveRunner can observe; choose the actual model in the Identity section above.
          </div>
          <div style={{ marginBottom: 8 }}>
            <ReadableCapabilityGrid capabilities={capabilities} />
          </div>
          <div style={{ fontSize: 12, color: A.muted, lineHeight: 1.6 }}>
            {descriptor.statusNote}
          </div>
        </div>
      )}
    </div>
  );
}

function ReadableCapabilityGrid({
  capabilities,
}: {
  capabilities: import("@/lib/orchestration/adapters/types").ProviderCapabilities;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8 }}>
      {CAPABILITY_LABELS.map(({ key, label }) => {
        const available = capabilities[key];
        return (
          <div
            key={key}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              minHeight: 36,
              padding: "8px 10px",
              borderRadius: 10,
              background: "var(--surface-elevated)",
              border: `0.5px solid ${UI.divider}`,
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: available ? "var(--positive)" : "var(--text-muted)",
                flexShrink: 0,
              }}
            />
            <span style={{ fontSize: 12, color: available ? A.textSec : A.muted, lineHeight: 1.45 }}>
              {label}
            </span>
            {!available ? (
              <span style={{ fontSize: 10, color: "var(--text-muted)", marginLeft: "auto" }}>
                unavailable
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function AgentFilesEditor({
  data,
  loading,
  error,
  onSave,
}: {
  data: AgentFilesWire | null;
  loading: boolean;
  error: string | null;
  onSave: (relativePath: string, content: string) => Promise<unknown>;
}) {
  const files = useMemo(() => data?.files ?? [], [data?.files]);
  const [selectedPath, setSelectedPath] = useState<string>("");
  const selectedFile = files.find((file) => file.relativePath === selectedPath) ?? files[0] ?? null;
  const coreFiles = files.filter((file) => file.group === "core");
  const memoryFiles = files.filter((file) => file.group === "memory");

  if (loading) {
    return <InlineStatusText>Loading agent files…</InlineStatusText>;
  }

  if (error) {
    return <InlineStatusText tone="error">Could not load agent files ({error}).</InlineStatusText>;
  }

  if (!data?.workspaceRoot) {
    return <InlineStatusText tone="error">No runtime workspace is available for this agent yet.</InlineStatusText>;
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 280px) minmax(0, 1fr)", gap: 14 }}>
      <div
        style={{
          borderRadius: 14,
          border: `0.5px solid ${UI.surfaceBorder}`,
          background: UI.surface,
          padding: 10,
          minWidth: 0,
        }}
      >
        <div style={{ ...microHeadingStyle, marginBottom: 8 }}>Runtime workspace</div>
        <div
          style={{
            fontFamily: font.mono,
            fontSize: 11,
            color: A.textSec,
            lineHeight: 1.45,
            wordBreak: "break-all",
            marginBottom: 12,
          }}
        >
          {data.workspaceRoot}
        </div>
        <AgentFileListGroup title="Core" files={coreFiles} selectedPath={selectedFile?.relativePath ?? ""} onSelect={setSelectedPath} />
        <AgentFileListGroup title="Memory" files={memoryFiles} selectedPath={selectedFile?.relativePath ?? ""} onSelect={setSelectedPath} />
      </div>

      <div
        style={{
          borderRadius: 14,
          border: `0.5px solid ${UI.surfaceBorder}`,
          background: UI.surface,
          minWidth: 0,
          overflow: "hidden",
        }}
      >
        {selectedFile ? (
          <AgentFileEditorPane
            key={selectedFile.relativePath}
            file={selectedFile}
            onSave={onSave}
          />
        ) : (
          <div style={{ padding: 14 }}>
            <InlineStatusText>No editable files were found for this agent.</InlineStatusText>
          </div>
        )}
      </div>
    </div>
  );
}

function AgentFileEditorPane({
  file,
  onSave,
}: {
  file: AgentFileWire;
  onSave: (relativePath: string, content: string) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState(file.content);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const hasChanges = draft !== file.content;

  const commit = async () => {
    if (!hasChanges || !file.editable) return;
    setSaveStatus("saving");
    try {
      await onSave(file.relativePath, draft);
      setSaveStatus("saved");
      window.setTimeout(() => setSaveStatus("idle"), 1500);
    } catch {
      setSaveStatus("error");
    }
  };

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "12px 14px",
          borderBottom: `0.5px solid ${UI.divider}`,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 650, color: A.text }}>{file.name}</div>
          <div style={{ marginTop: 3, fontSize: 11, color: A.textSec, fontFamily: font.mono }}>
            {file.relativePath} · {file.exists ? `${formatBytes(file.size)}${file.updatedAt ? ` · ${new Date(file.updatedAt).toLocaleString()}` : ""}` : "not created yet"}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <SaveIndicator status={saveStatus} />
          <ActionButton
            label="Save file"
            onClick={() => void commit()}
            disabled={!hasChanges || !file.editable || saveStatus === "saving"}
            emphasis="primary"
          />
        </div>
      </div>
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        spellCheck={false}
        disabled={!file.editable}
        style={{
          width: "100%",
          minHeight: 360,
          resize: "vertical",
          border: 0,
          outline: "none",
          padding: 14,
          background: "var(--surface)",
          color: A.text,
          fontFamily: font.mono,
          fontSize: 12,
          lineHeight: 1.6,
        }}
      />
    </>
  );
}

function AgentFileListGroup({
  title,
  files,
  selectedPath,
  onSelect,
}: {
  title: string;
  files: AgentFileWire[];
  selectedPath: string;
  onSelect: (relativePath: string) => void;
}) {
  if (files.length === 0) {
    return (
      <div style={{ marginTop: 12 }}>
        <div style={{ ...microHeadingStyle, marginBottom: 7 }}>{title}</div>
        <div style={{ fontSize: 12, color: A.muted }}>No files yet.</div>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ ...microHeadingStyle, marginBottom: 7 }}>{title}</div>
      <div style={{ display: "grid", gap: 5 }}>
        {files.map((file) => {
          const selected = file.relativePath === selectedPath;
          return (
            <button
              key={file.relativePath}
              type="button"
              onClick={() => onSelect(file.relativePath)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                width: "100%",
                padding: "8px 9px",
                borderRadius: 10,
                border: `0.5px solid ${selected ? A.cardBorder : "transparent"}`,
                background: selected ? "var(--surface-elevated)" : "transparent",
                color: selected ? A.text : A.textSec,
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              <FileText size={13} />
              <span style={{ minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12 }}>
                {file.name}
              </span>
              <span style={{ width: 7, height: 7, borderRadius: 999, background: file.exists ? "var(--positive)" : "var(--text-muted)", flexShrink: 0 }} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function DisclosureButton({
  open,
  onToggle,
  label,
  icon,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
  icon?: React.ReactNode;
}) {
  return (
    <button
      onClick={onToggle}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginTop: 16,
        padding: 0,
        background: "none",
        border: "none",
        color: A.textSec,
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: "0.02em",
        cursor: "pointer",
      }}
    >
      {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      {icon}
      {label}
    </button>
  );
}

function IdentityProviderModelControl({
  currentProvider,
  currentModel,
  switchTarget,
  switchModel,
  switchModelOptions,
  switchModelsLoading,
  switchModelsError,
  switchLoading,
  switchPlan,
  switchNotice,
  switchError,
  selectedRuntimeSupportMessage,
  selectedBillingProfile,
  requiresBillingConfirmation,
  billingConfirmed,
  onBillingConfirmedChange,
  onProviderChange,
  onModelChange,
  onTest,
  onApply,
}: {
  currentProvider: string;
  currentModel: string;
  switchTarget: string;
  switchModel: string;
  switchModelOptions: RuntimeModelWire[];
  switchModelsLoading: boolean;
  switchModelsError: string | null;
  switchLoading: boolean;
  switchPlan: SwitchPlanWire | null;
  switchNotice: string | null;
  switchError: string | null;
  selectedRuntimeSupportMessage: { tone: "neutral" | "error"; text: string };
  selectedBillingProfile: ProviderBillingProfileWire | null;
  requiresBillingConfirmation: boolean;
  billingConfirmed: boolean;
  onBillingConfirmedChange: (checked: boolean) => void;
  onProviderChange: (providerId: string) => void;
  onModelChange: (modelId: string) => void;
  onTest: () => void;
  onApply: () => void;
}) {
  const currentDescriptor = providerDescriptorForSwitchId(currentProvider);
  const selectedDescriptor = providerDescriptorForSwitchId(switchTarget);
  const selectedModel = switchModelOptions.find((model) => model.id === switchModel);
  const providerChanged = normalizeSwitchProviderId(currentProvider) !== normalizeSwitchProviderId(switchTarget);
  const modelChanged = Boolean(switchModel && switchModel !== currentModel);
  const hasPendingChange = providerChanged || modelChanged;
  const inFlightApplyBlocked = switchPlan?.warnings.some((warning) => warning.code === "in_flight_execution") === true;
  const statusLabel = switchPlan?.mode === "switchable"
    ? inFlightApplyBlocked
      ? "Ready after run"
      : "Ready to apply"
    : switchPlan?.mode === "blocked"
      ? "Blocked"
      : hasPendingChange
        ? "Needs test"
        : "Current";
  const testDisabled = switchLoading || switchModelsLoading;
  const applyDisabled = switchLoading || switchModelsLoading || switchPlan?.mode !== "switchable" || inFlightApplyBlocked || (requiresBillingConfirmation && !billingConfirmed);
  const summaryText = switchPlan?.summary ?? selectedRuntimeSupportMessage.text;
  const modelDisplay = selectedModel?.label ?? switchModel ?? "Provider default";
  const activeRunDetails = switchPlan?.inFlight?.runs ?? [];

  return (
    <div
      style={{
        minWidth: 0,
        borderRadius: 18,
        border: `0.5px solid ${A.cardBorder}`,
        background: "linear-gradient(180deg, color-mix(in srgb, var(--surface-elevated) 88%, var(--surface)) 0%, var(--surface) 100%)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)",
        padding: 16,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 13,
            display: "grid",
            placeItems: "center",
            background: "var(--surface-elevated)",
            border: `0.5px solid ${UI.surfaceBorder}`,
            flex: "0 0 44px",
          }}
        >
          <ProviderLogo provider={switchTarget} size={25} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={microHeadingStyle}>Provider & model</div>
          <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 18, fontWeight: 650, color: A.text, lineHeight: 1.2 }}>
              {selectedDescriptor?.displayName ?? providerLabelForSwitchId(switchTarget)}
            </span>
            <TogglePill enabled={switchPlan?.mode === "switchable" || !hasPendingChange} label={statusLabel} />
          </div>
          <div style={{ marginTop: 5, fontSize: 12, color: A.textSec, lineHeight: 1.5 }}>
            Currently using {currentDescriptor?.displayName ?? providerLabelForSwitchId(currentProvider)} · {currentModel || "provider default model"}
          </div>
        </div>
      </div>

      <div style={{ ...microHeadingStyle, marginBottom: 8 }}>Runtime provider</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(94px, 1fr))", gap: 8 }}>
        {SWITCHABLE_PROVIDER_IDS.map((providerId) => {
          const descriptor = providerDescriptorForSwitchId(providerId);
          const selected = normalizeSwitchProviderId(providerId) === normalizeSwitchProviderId(switchTarget);
          return (
            <button
              key={providerId}
              type="button"
              onClick={() => onProviderChange(providerId)}
              aria-pressed={selected}
              style={{
                minHeight: 72,
                borderRadius: 13,
                border: `0.5px solid ${selected ? A.cardBorder : UI.surfaceBorder}`,
                background: selected ? "var(--surface-elevated)" : "transparent",
                color: A.text,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 7,
                padding: "9px 8px",
                cursor: "pointer",
                boxShadow: selected ? "inset 0 1px 0 rgba(255,255,255,0.05)" : "none",
              }}
            >
              <ProviderLogo provider={providerId} size={23} />
              <span style={{ fontSize: 12, fontWeight: selected ? 700 : 600, color: selected ? A.text : A.textSec }}>
                {descriptor?.displayName ?? providerId}
              </span>
            </button>
          );
        })}
      </div>

      <div style={{ marginTop: 14 }}>
        <div style={{ ...microHeadingStyle, marginBottom: 7 }}>Model</div>
        <div style={{ display: "grid", gridTemplateColumns: "36px minmax(0, 1fr)", gap: 8, alignItems: "center" }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              display: "grid",
              placeItems: "center",
              background: "var(--surface-elevated)",
              border: `0.5px solid ${UI.surfaceBorder}`,
            }}
          >
            <ProviderLogo provider={selectedModel?.provider ?? switchTarget} size={20} />
          </div>
          <select
            value={switchModel}
            onChange={(event) => onModelChange(event.target.value)}
            style={{ ...inputStyle(), cursor: "pointer", fontFamily: font.mono, minHeight: 42 }}
          >
            {switchModelOptions.map((model) => (
              <option key={model.id} value={model.id}>
                {model.default ? `${model.label} (default)` : model.label}
              </option>
            ))}
          </select>
        </div>
        <div style={{ marginTop: 6, fontSize: 11, color: switchModelsError ? "var(--negative)" : A.textSec, lineHeight: 1.45 }}>
          {switchModelsLoading
            ? "Loading models for this provider..."
            : switchModelsError
              ? `Could not load provider model list (${switchModelsError}).`
              : `Selected model: ${modelDisplay}`}
        </div>
      </div>

      <div
        style={{
          marginTop: 14,
          padding: "11px 12px",
          borderRadius: 13,
          border: `0.5px solid ${selectedRuntimeSupportMessage.tone === "error" ? "rgba(138, 90, 0, 0.24)" : UI.surfaceBorder}`,
          background: selectedRuntimeSupportMessage.tone === "error" ? "var(--warning-soft)" : "var(--surface-elevated)",
          display: "grid",
          gap: 6,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <span style={{ fontSize: 12, fontWeight: 650, color: A.text }}>Runtime readiness</span>
          <span style={{ fontSize: 11, color: A.textSec }}>{providerReadinessLabel(selectedBillingProfile)}</span>
        </div>
        <div style={{ fontSize: 12, color: A.text, lineHeight: 1.5 }}>
          {humanProviderSummary(switchTarget)}
        </div>
        <div style={{ fontSize: 12, color: A.textSec, lineHeight: 1.55 }}>
          {summaryText}
        </div>
      </div>

      {requiresBillingConfirmation ? (
        <label
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            marginTop: 10,
            padding: "10px 12px",
            borderRadius: 12,
            border: "0.5px solid rgba(138, 90, 0, 0.24)",
            background: "var(--warning-soft)",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={billingConfirmed}
            onChange={(event) => onBillingConfirmedChange(event.target.checked)}
            style={{ marginTop: 2 }}
          />
          <span style={{ fontSize: 12, lineHeight: 1.5, color: A.textSec }}>
            I understand this provider switch may affect billing or spend controls.
            {switchPlan?.billingConfirmationReason ? ` ${switchPlan.billingConfirmationReason}` : ""}
          </span>
        </label>
      ) : null}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 14 }}>
        <ActionButton
          label={switchLoading ? "Testing..." : "Test change"}
          onClick={onTest}
          disabled={testDisabled}
        />
        <ActionButton
          label={switchLoading ? "Applying..." : inFlightApplyBlocked ? "Apply after run" : "Apply change"}
          onClick={onApply}
          disabled={applyDisabled}
          emphasis="primary"
        />
        {hasPendingChange && !switchPlan ? (
          <span style={{ fontSize: 11, color: A.textSec }}>Test before applying.</span>
        ) : null}
        {inFlightApplyBlocked ? (
          <span style={{ fontSize: 11, color: A.textSec }}>
            Test passed; apply unlocks when the listed run closes.
          </span>
        ) : null}
      </div>

      {switchNotice ? <InlineStatusText>{switchNotice}</InlineStatusText> : null}
      {switchError ? <InlineStatusText tone="error">Provider/model check failed ({switchError}).</InlineStatusText> : null}
      {switchPlan?.blockers.length ? (
        <div style={{ marginTop: 10 }}>
          <SupportNote tone="error" title="Blocking conditions">
            <SwitchStateList items={switchPlan.blockers.map((item) => item.message)} />
          </SupportNote>
        </div>
      ) : null}
      {activeRunDetails.length ? (
        <div style={{ marginTop: 10 }}>
          <InFlightRunDetailList runs={activeRunDetails} />
        </div>
      ) : null}
      {switchPlan?.warnings.length ? (
        <div style={{ marginTop: 10 }}>
          <SupportNote tone="warning" title="Warnings">
            <SwitchStateList items={switchPlan.warnings.map((item) => item.message)} />
          </SupportNote>
        </div>
      ) : null}
    </div>
  );
}

function SummaryCard({
  eyebrow,
  title,
  subtitle,
  badge,
  accent,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  accent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        padding: "18px 18px 16px",
        borderRadius: 16,
        background: accent ? UI.accentSurface : UI.surfaceStrong,
        border: `0.5px solid ${accent ? UI.accentBorder : UI.surfaceBorder}`,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.02)",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 12 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={microHeadingStyle}>{eyebrow}</div>
          <div style={{ fontSize: 18, fontWeight: 600, color: A.text, lineHeight: 1.2, marginTop: 4 }}>
            {title}
          </div>
          {subtitle ? (
            <div style={{ marginTop: 6, fontSize: 12, color: A.textSec, lineHeight: 1.6 }}>
              {subtitle}
            </div>
          ) : null}
        </div>
        {badge ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {badge}
          </div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function SummaryListRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "88px minmax(0, 1fr)",
        gap: 10,
        alignItems: "start",
        padding: "8px 0",
        borderTop: `0.5px solid ${UI.divider}`,
      }}
    >
      <span style={{
        fontSize: typography.sectionLabel.size,
        color: UI.label,
        fontWeight: typography.sectionLabel.weight,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        lineHeight: 1.35,
      }}>
        {label}
      </span>
      <span
        style={{
          fontSize: mono ? typography.bodySmall.size : typography.body.size,
          color: A.text,
          lineHeight: typography.body.lineHeight,
          fontFamily: font.body,
          fontWeight: typography.body.weight,
          wordBreak: "break-word",
          overflowWrap: "anywhere",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function InlineStatusText({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "error";
}) {
  return (
    <div
      style={{
        marginTop: 10,
        fontSize: 12,
        color: tone === "error" ? "var(--negative)" : A.muted,
        lineHeight: 1.5,
      }}
    >
      {children}
    </div>
  );
}

function MetricCard({
  label,
  value,
  detail,
  badge,
}: {
  label: string;
  value: string;
  detail?: string;
  badge?: React.ReactNode;
}) {
  return (
    <div
      style={{
        padding: "16px 16px 14px",
        borderRadius: 16,
        background: UI.surface,
        border: `0.5px solid ${UI.surfaceBorder}`,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.02)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <div style={microHeadingStyle}>{label}</div>
        <div style={{ marginLeft: "auto" }}>{badge}</div>
      </div>
      <div style={{ fontSize: 20, fontWeight: 600, color: A.text, lineHeight: 1.2 }}>
        {value}
      </div>
      {detail ? (
        <div style={{ marginTop: 6, fontSize: 12, color: A.muted, lineHeight: 1.5 }}>
          {detail}
        </div>
      ) : null}
    </div>
  );
}

function PermissionRow({
  label,
  enabled,
  description,
  onToggle,
}: {
  label: string;
  enabled: boolean;
  description: string;
  onToggle?: (value: boolean) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 14,
        padding: "14px 0",
        borderTop: `0.5px solid ${UI.divider}`,
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: A.text, marginBottom: 6 }}>
          {label}
        </div>
        <div style={{ fontSize: 12, color: A.muted, lineHeight: 1.6 }}>
          {description}
        </div>
      </div>
      {onToggle ? (
        <button
          type="button"
          onClick={() => onToggle(!enabled)}
          style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}
        >
          <TogglePill enabled={enabled} label={enabled ? "On" : "Off"} />
        </button>
      ) : (
        <TogglePill enabled={enabled} label={enabled ? "On" : "Off"} />
      )}
    </div>
  );
}

function EmptyStateCard({ title, body }: { title: string; body: string }) {
  return (
    <div
      style={{
        padding: "18px 20px",
        borderRadius: 12,
        border: `1px dashed ${UI.surfaceBorder}`,
        background: UI.surface,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.02)",
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 600, color: A.text, marginBottom: 6 }}>
        {title}
      </div>
      <div style={{ fontSize: 12, color: A.muted, lineHeight: 1.6 }}>
        {body}
      </div>
    </div>
  );
}

function ActivationCheckList({ checks }: { checks: ProviderActivationCheckWire[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
      {checks.map((check) => (
        <div
          key={check.check}
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            padding: "9px 10px",
            borderRadius: 10,
            background: "var(--surface-elevated)",
            border: `0.5px solid ${UI.divider}`,
          }}
        >
          {check.passed ? (
            <CheckCircle size={14} style={{ color: "var(--positive)", marginTop: 2, flexShrink: 0 }} />
          ) : (
            <XCircle size={14} style={{ color: check.blocking ? "var(--warning)" : "var(--text-muted)", marginTop: 2, flexShrink: 0 }} />
          )}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, color: A.text, fontWeight: 600 }}>
              {check.check.replaceAll("_", " ")}
            </div>
            <div style={{ fontSize: 12, color: A.muted, lineHeight: 1.55 }}>
              {check.detail}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function SwitchStateList({ items }: { items: string[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {items.map((item) => (
        <div key={item} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          <span style={{ color: A.muted, marginTop: 1 }}>•</span>
          <span style={{ fontSize: 12, color: A.textSec, lineHeight: 1.55 }}>{item}</span>
        </div>
      ))}
    </div>
  );
}

function InFlightRunDetailList({
  runs,
}: {
  runs: NonNullable<SwitchPlanWire["inFlight"]>["runs"];
}) {
  return (
    <SupportNote tone="neutral" title="Current run holding apply">
      <div style={{ display: "grid", gap: 8 }}>
        {runs.slice(0, 4).map((run) => {
          const taskLabel = run.taskKey ?? run.taskTitle ?? "No linked task";
          const detailBits = [
            titleCaseRunKind(run.kind),
            run.provider ? providerLabelForSwitchId(run.provider) : null,
            run.taskStatus ? `task ${run.taskStatus.replaceAll("_", " ")}` : null,
            formatRunTimestamp(run.startedAt ?? run.createdAt),
          ].filter(Boolean);
          return (
            <div
              key={`${run.kind}-${run.id}`}
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) auto",
                gap: 10,
                alignItems: "start",
                padding: "9px 10px",
                borderRadius: 10,
                border: `0.5px solid ${UI.surfaceBorder}`,
                background: "var(--surface)",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, color: A.text, fontWeight: 650, lineHeight: 1.35 }}>
                  {taskLabel}
                </div>
                <div style={{ marginTop: 3, fontSize: 11, color: A.textSec, lineHeight: 1.45 }}>
                  {detailBits.join(" · ")}
                </div>
              </div>
              <span
                style={{
                  fontSize: 11,
                  color: A.textSec,
                  border: `0.5px solid ${UI.surfaceBorder}`,
                  borderRadius: 999,
                  padding: "3px 8px",
                  whiteSpace: "nowrap",
                  textTransform: "capitalize",
                }}
              >
                {run.status.replaceAll("_", " ")}
              </span>
            </div>
          );
        })}
      </div>
    </SupportNote>
  );
}

function titleCaseRunKind(kind: string): string {
  if (kind === "wakeup") return "Wakeup";
  if (kind === "heartbeat") return "Heartbeat";
  return "Execution";
}

function formatRunTimestamp(value: string | null): string | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return value;
  const deltaMs = Date.now() - time;
  if (deltaMs < 0) return "just now";
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function SupportNote({
  title,
  tone = "neutral",
  children,
}: {
  title: string;
  tone?: "neutral" | "warning" | "error";
  children: React.ReactNode;
}) {
  const tones =
    tone === "error"
      ? {
          border: "rgba(200, 40, 30, 0.22)",
          background: "var(--negative-soft)",
          titleColor: "var(--negative)",
        }
      : tone === "warning"
        ? {
            border: "rgba(138, 90, 0, 0.24)",
            background: "var(--warning-soft)",
            titleColor: "var(--warning)",
          }
        : {
            border: UI.divider,
            background: "var(--surface-elevated)",
            titleColor: A.text,
          };

  return (
    <div
      style={{
        padding: "12px 13px",
        borderRadius: 12,
        border: `0.5px solid ${tones.border}`,
        background: tones.background,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, color: tones.titleColor, marginBottom: 8 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  disabled,
  emphasis = "secondary",
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  emphasis?: "primary" | "secondary";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: 40,
        padding: "0 14px",
        borderRadius: 10,
        border: `0.5px solid ${emphasis === "primary" ? A.cardBorder : UI.surfaceBorder}`,
        background: emphasis === "primary" ? "transparent" : UI.surface,
        color: emphasis === "primary" ? A.text : A.text,
        fontSize: 12,
        fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
      }}
    >
      {label}
    </button>
  );
}

/* ══════════════════════════════════════════
   Shared save-status hook
   ══════════════════════════════════════════ */

function useSaveStatus() {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const trigger = useCallback(async (fn: () => Promise<unknown>) => {
    setStatus("saving");
    clearTimeout(timer.current);
    try {
      await fn();
      setStatus("saved");
      timer.current = setTimeout(() => setStatus("idle"), 1500);
    } catch {
      setStatus("error");
      timer.current = setTimeout(() => setStatus("idle"), 2500);
    }
  }, []);

  return { status, trigger };
}

function SaveIndicator({ status }: { status: SaveStatus }) {
  if (status === "idle") return null;
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", gap: 3,
        fontSize: 11, fontWeight: 600, marginLeft: 6,
        color: status === "saving" ? A.textSec : status === "saved" ? "var(--positive)" : "var(--negative)",
        transition: "opacity 0.3s",
        justifyContent: "flex-end",
      }}
    >
      {status === "saving" && <><Loader2 size={10} style={{ animation: "spin 1s linear infinite" }} /> Saving…</>}
      {status === "saved" && <><Check size={10} /> Saved</>}
      {status === "error" && <>Failed</>}
    </span>
  );
}

function EditableText({
  label,
  value,
  onSave,
  mono,
}: {
  label: string;
  value: string;
  onSave: (v: string) => Promise<unknown>;
  mono?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const { status, trigger } = useSaveStatus();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setDraft(value); }, [value]);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  const commit = () => {
    setEditing(false);
    if (draft.trim() !== value) {
      trigger(() => onSave(draft.trim()));
    }
  };

  return (
    <div style={fieldRowStyle}>
      <span style={fieldLabelStyle}>{label}</span>
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setDraft(value); setEditing(false); } }}
          style={inputStyle(mono)}
        />
      ) : (
        <span
          onClick={() => setEditing(true)}
          style={displayStyle(mono)}
          title="Click to edit"
        >
          {value || "\u2014"}
        </span>
      )}
      <div style={saveCellStyle}>
        <SaveIndicator status={status} />
      </div>
    </div>
  );
}

/* ── Editable textarea ── */
function EditableTextarea({
  label,
  value,
  onSave,
}: {
  label: string;
  value: string;
  onSave: (v: string) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const { status, trigger } = useSaveStatus();
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { setDraft(value); }, [value]);
  useEffect(() => { if (editing) ref.current?.focus(); }, [editing]);

  const commit = () => {
    setEditing(false);
    if (draft.trim() !== value) {
      trigger(() => onSave(draft.trim()));
    }
  };

  return (
    <div style={fieldRowStyle}>
      <span style={{ ...fieldLabelStyle, paddingTop: 12 }}>{label}</span>
      {editing ? (
        <textarea
          ref={ref}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Escape") { setDraft(value); setEditing(false); } }}
          rows={3}
          style={{
            ...inputStyle(),
            resize: "vertical" as const,
            minHeight: 60,
            lineHeight: "1.5",
          }}
        />
      ) : (
        <span
          onClick={() => setEditing(true)}
          style={{
            ...displayStyle(),
            whiteSpace: "pre-wrap",
            minHeight: 92,
            display: "block",
          }}
          title="Click to edit"
        >
          {value || "\u2014"}
        </span>
      )}
      <div style={saveCellStyle}>
        <SaveIndicator status={status} />
      </div>
    </div>
  );
}

/* ── Editable select dropdown ── */
function EditableSelect({
  label,
  value,
  options,
  onSave,
  mono,
  helpText,
  displayValue,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onSave: (v: string) => Promise<unknown>;
  mono?: boolean;
  helpText?: string;
  displayValue?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const { status, trigger } = useSaveStatus();
  const ref = useRef<HTMLSelectElement>(null);

  useEffect(() => { setDraft(value); }, [value]);
  useEffect(() => { if (editing) ref.current?.focus(); }, [editing]);

  const commit = (v: string) => {
    setEditing(false);
    if (v !== value) {
      trigger(() => onSave(v));
    }
  };

  const displayLabel = displayValue || options.find((o) => o.value === value)?.label || value || "\u2014";

  return (
    <div style={fieldRowStyle}>
      <span style={{ ...fieldLabelStyle, paddingTop: 12 }}>{label}</span>
      <div style={{ flex: 1 }}>
        {editing ? (
          <select
            ref={ref}
            value={draft}
            onChange={(e) => { setDraft(e.target.value); commit(e.target.value); }}
            onBlur={() => setEditing(false)}
            style={{
              ...inputStyle(mono),
              cursor: "pointer",
              appearance: "auto" as const,
            }}
          >
            {options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        ) : (
          <span
            onClick={() => setEditing(true)}
            style={displayStyle(mono)}
            title="Click to edit"
          >
            {displayLabel}
          </span>
        )}
        {helpText ? (
          <div style={{ marginTop: 6, fontSize: 12, color: A.muted, lineHeight: 1.5 }}>
            {helpText}
          </div>
        ) : null}
      </div>
      <div style={saveCellStyle}>
        <SaveIndicator status={status} />
      </div>
    </div>
  );
}

function EditableNumber({
  label,
  value,
  onSave,
  suffix,
}: {
  label: string;
  value: number | null;
  onSave: (value: number) => Promise<unknown>;
  suffix?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  const { status, trigger } = useSaveStatus();
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);

  const openEditor = () => {
    setDraft(value == null ? "" : String(value));
    setEditing(true);
  };

  const commit = () => {
    setEditing(false);
    const normalized = draft.trim() === "" ? "0" : draft.trim();
    if (normalized !== (value == null ? "" : String(value))) {
      const parsed = Number(normalized);
      if (Number.isFinite(parsed)) {
        trigger(() => onSave(Math.max(0, Math.trunc(parsed))));
      } else {
        setDraft(value == null ? "" : String(value));
      }
    }
  };

  return (
    <div style={fieldRowStyle}>
      <span style={fieldLabelStyle}>{label}</span>
      {editing ? (
        <input
          ref={ref}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
            if (event.key === "Escape") {
              setDraft(value == null ? "" : String(value));
              setEditing(false);
            }
          }}
          inputMode="numeric"
          style={inputStyle()}
        />
      ) : (
        <span onClick={openEditor} style={displayStyle()} title="Click to edit">
          {value == null ? "\u2014" : `${value}${suffix ? ` ${suffix}` : ""}`}
        </span>
      )}
      <div style={saveCellStyle}>
        <SaveIndicator status={status} />
      </div>
    </div>
  );
}

/* ── Editable tag input ── */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function EditableTags({
  label,
  value,
  onSave,
}: {
  label: string;
  value: string[];
  onSave: (v: string[]) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [tags, setTags] = useState(value);
  const [input, setInput] = useState("");
  const { status, trigger } = useSaveStatus();
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => { setTags(value); }, [value]);
  useEffect(() => { if (editing) ref.current?.focus(); }, [editing]);

  const addTag = (raw: string) => {
    const tag = raw.trim();
    if (tag && !tags.includes(tag)) {
      const next = [...tags, tag];
      setTags(next);
      trigger(() => onSave(next));
    }
    setInput("");
  };

  const removeTag = (tag: string) => {
    const next = tags.filter((t) => t !== tag);
    setTags(next);
    trigger(() => onSave(next));
  };

  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 8 }}>
      <span style={{ fontSize: 12, color: A.textSec, width: 160, flexShrink: 0, paddingTop: 4 }}>{label}</span>
      {editing ? (
        <div style={{ flex: 1, display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
          {tags.map((tag) => (
            <span key={tag} style={tagStyle}>
              {tag}
              <button
                onClick={() => removeTag(tag)}
                style={{ background: "none", border: "none", color: A.muted, cursor: "pointer", padding: 0, marginLeft: 4, display: "inline-flex" }}
              >
                <X size={10} />
              </button>
            </span>
          ))}
          <input
            ref={ref}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(input); }
              if (e.key === "Backspace" && !input && tags.length) { removeTag(tags[tags.length - 1]); }
              if (e.key === "Escape") { setEditing(false); }
            }}
            onBlur={() => { if (input.trim()) addTag(input); setEditing(false); }}
            placeholder="Add skill…"
            style={{ ...inputStyle(), width: 100, minWidth: 80, flex: "0 1 auto" }}
          />
          <SaveIndicator status={status} />
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
          <span
            onClick={() => setEditing(true)}
            style={{ ...displayStyle(), display: "inline-flex", gap: 4, flexWrap: "wrap", cursor: "pointer" }}
            title="Click to edit"
          >
            {tags.length > 0
              ? tags.map((t) => <span key={t} style={tagStyle}>{t}</span>)
              : "\u2014"}
          </span>
          <SaveIndicator status={status} />
        </div>
      )}
    </div>
  );
}

/* ── Read-only row ── */
function ReadOnlyRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={fieldRowStyle}>
      <span style={fieldLabelStyle}>{label}</span>
      <span style={{
        ...displayStyle(mono),
        color: A.text,
        whiteSpace: "normal",
        overflow: "visible",
        textOverflow: "clip",
        overflowWrap: "anywhere",
        cursor: "default",
      }}>
        {value}
      </span>
      <div />
    </div>
  );
}

/* ── Section wrapper ── */
function Section({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{
      padding: "20px 22px",
      borderRadius: 18,
      background: UI.sectionBg,
      border: `0.5px solid ${UI.sectionBorder}`,
      boxShadow: UI.shadow,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 18 }}>
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 999,
            display: "grid",
            placeItems: "center",
            color: A.textSec,
            background: "rgba(255,255,255,0.04)",
            border: `0.5px solid ${UI.surfaceBorder}`,
            flexShrink: 0,
          }}
        >
          {icon}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 600, color: A.text, lineHeight: 1.25 }}>
            {title}
          </div>
          {subtitle ? (
            <div style={{ marginTop: 5, fontSize: 12, color: A.muted, lineHeight: 1.6 }}>
              {subtitle}
            </div>
          ) : null}
        </div>
      </div>
      {children}
    </div>
  );
}

/* ── Toggle pill ── */
function RuntimeStatusPill({ status }: { status: OrchestrationRuntime["status"] }) {
  const problematic = status === "error" || status === "offline" || status === "disabled";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 11px",
        borderRadius: 999,
        background: problematic ? "var(--negative-soft)" : "var(--positive-soft)",
        border: `0.5px solid ${problematic ? "rgba(200, 40, 30, 0.22)" : "rgba(23, 122, 50, 0.22)"}`,
        fontSize: 11,
        fontWeight: 600,
        color: problematic ? "var(--negative)" : "var(--positive)",
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: problematic ? "var(--negative)" : "var(--positive)",
        }}
      />
      {formatRuntimeStatus(status)}
    </span>
  );
}

function TogglePill({ enabled, label }: { enabled: boolean; label: string }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "5px 11px", borderRadius: 999,
      background: enabled ? "var(--surface-hover)" : "var(--surface-elevated)",
      border: `0.5px solid ${enabled ? A.cardBorder : "var(--border)"}`,
      fontSize: 11, fontWeight: 600, color: enabled ? A.text : A.muted,
    }}>
      <span style={{
        width: 8, height: 8, borderRadius: "50%",
        background: enabled ? A.text : A.muted,
      }} />
      {label}
    </span>
  );
}

/* ── Shared styles ── */
const microHeadingStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: UI.label,
};

const fieldRowStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  alignItems: "stretch",
  padding: "12px 0",
  borderTop: `0.5px solid ${UI.divider}`,
};

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 11,
  color: UI.label,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

const saveCellStyle: React.CSSProperties = {
  minHeight: 14,
};

const detailPanelStyle: React.CSSProperties = {
  marginTop: 10,
  padding: "14px 16px",
  borderRadius: 14,
  background: UI.surface,
  border: `0.5px solid ${UI.surfaceBorder}`,
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.02)",
};

const infoNoteStyle: React.CSSProperties = {
  fontSize: 12,
  color: A.muted,
  lineHeight: 1.65,
};

const inputStyle = (mono?: boolean): React.CSSProperties => ({
  flex: 1,
  width: "100%",
  minHeight: 38,
  fontSize: mono ? typography.bodySmall.size : typography.body.size,
  color: A.text,
  fontFamily: font.body,
  fontWeight: typography.body.weight,
  background: UI.surfaceStrong,
  border: `0.5px solid ${UI.surfaceBorder}`,
  borderRadius: 8,
  padding: "8px 10px",
  outline: "none",
  lineHeight: String(typography.body.lineHeight),
  boxSizing: "border-box",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.02)",
});

const displayStyle = (mono?: boolean): React.CSSProperties => ({
  width: "100%",
  minHeight: 34,
  fontSize: mono ? typography.bodySmall.size : typography.body.size,
  color: A.text,
  fontFamily: font.body,
  fontWeight: typography.body.weight,
  cursor: "pointer",
  borderRadius: 8,
  padding: "7px 10px",
  border: `0.5px solid ${UI.surfaceBorder}`,
  background: UI.surfaceStrong,
  transition: "border-color 0.15s, background 0.15s",
  boxSizing: "border-box",
  display: "block",
  overflow: "visible",
  textOverflow: "clip",
  whiteSpace: "normal",
  wordBreak: "break-word",
  overflowWrap: "anywhere",
  lineHeight: String(typography.body.lineHeight),
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.02)",
});

const tagStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "4px 9px",
  borderRadius: 999,
  background: "var(--surface-hover)",
  border: `0.5px solid ${A.cardBorder}`,
  fontSize: 11,
  fontWeight: 600,
  color: A.text,
};
