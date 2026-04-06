"use client";

import { useState, useEffect, useRef, useCallback } from "react";
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
import { useAgentProfile, A } from "../layout";
import { listCompanyAgents } from "@/lib/orchestration/client";
import {
  capabilitiesFromTier,
  resolveAgentProviderPresentation,
  PROVIDER_PRODUCT_DESCRIPTORS,
} from "@/lib/orchestration/adapters/types";
import type {
  ProviderPresentationInfo,
  ProviderAvailability,
  ProviderProductDescriptor,
} from "@/lib/orchestration/adapters/types";
import {
  TierBadge,
  AvailabilityBadge,
  CAPABILITY_LABELS,
} from "@/components/orchestration/ProviderPresentation";

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
  paperclipAgentId?: string;
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
    paperclip: string | null;
  };
  providerActivations: Record<string, ProviderActivationWire>;
}

interface ExecutionSettingsAgentWire {
  agentId: string;
  paperclipAgentId?: string;
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
  paperclipAgentId?: string;
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
  stateChanges: {
    preserved: string[];
    reset: string[];
  } | null;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

const MODEL_OPTIONS = [
  "anthropic/claude-opus-4-6",
  "anthropic/claude-sonnet-4-6",
  "openai-codex/gpt-5.4",
  "google/gemini-3.1-pro-preview",
];

const UI = {
  sectionBg: "rgba(28,25,23,0.8)",
  sectionBorder: "rgba(255,255,255,0.08)",
  surface: "rgba(41,37,36,0.38)",
  surfaceBorder: "rgba(255,255,255,0.08)",
  surfaceStrong: "rgba(28,25,23,0.94)",
  accentSurface: "rgba(28,25,23,0.94)",
  accentBorder: "rgba(245,158,11,0.18)",
  divider: "rgba(255,255,255,0.07)",
  label: "#a8a29e",
  shadow: "0 18px 40px rgba(0,0,0,0.24)",
};

const FIELD_LABEL_WIDTH = 176;
const SWITCHABLE_PROVIDER_IDS = ["openclaw", "paperclip", "codex", "anthropic"] as const;

function normalizeSwitchProviderId(providerId: string): string {
  return providerId === "openclaw-heartbeat" ? "openclaw" : providerId;
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

function findAgentScopedRow<T extends { agentId: string; paperclipAgentId?: string; name?: string }>(
  rows: T[],
  agent: AgentConfigPageAgentLike,
): T | null {
  return (
    rows.find((row) => row.agentId === agent.id) ??
    rows.find((row) => agent.paperclipAgentId && row.paperclipAgentId === agent.paperclipAgentId) ??
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

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [providerDetailsOpen, setProviderDetailsOpen] = useState(false);
  const [comparisonOpen, setComparisonOpen] = useState(true);
  const [oc, setOc] = useState<OpenClawConfig | null>(null);
  const [ocError, setOcError] = useState<string | null>(null);
  const [ocLoading, setOcLoading] = useState(true);
  const [peers, setPeers] = useState<PeerAgent[]>([]);
  const [providerStatus, setProviderStatus] = useState<ProviderStatusWire | null>(null);
  const [providerStatusError, setProviderStatusError] = useState<string | null>(null);
  const [runtimePoliciesLoading, setRuntimePoliciesLoading] = useState(true);
  const [runtimePoliciesError, setRuntimePoliciesError] = useState<string | null>(null);
  const [executionSettingsRow, setExecutionSettingsRow] = useState<ExecutionSettingsAgentWire | null>(null);
  const [heartbeatSettingsRow, setHeartbeatSettingsRow] = useState<HeartbeatSettingsAgentWire | null>(null);
  const [companyExecutionSettings, setCompanyExecutionSettings] = useState<ExecutionSettingsWire | null>(null);
  const [companyHeartbeatSettings, setCompanyHeartbeatSettings] = useState<HeartbeatSettingsWire | null>(null);

  const openclawId = agent.openclawAgentId || agent.id;
  const resolved = resolveAgentProviderPresentation(agent);
  const currentSwitchProvider = normalizeSwitchProviderId(resolved.providerId);
  const [switchTarget, setSwitchTarget] = useState<string>(currentSwitchProvider);
  const [switchPlan, setSwitchPlan] = useState<SwitchPlanWire | null>(null);
  const [switchLoading, setSwitchLoading] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [switchNotice, setSwitchNotice] = useState<string | null>(null);
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
  }, [openclawId]);

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

  const refreshConfigurationData = useCallback(() => {
    void loadOpenClawConfig();
    void loadProviderStatus();
    void loadRuntimePolicies();
    reload();
  }, [loadOpenClawConfig, loadProviderStatus, loadRuntimePolicies, reload]);

  useEffect(() => {
    void loadOpenClawConfig();
  }, [loadOpenClawConfig]);

  useEffect(() => {
    void loadProviderStatus();
  }, [loadProviderStatus]);

  useEffect(() => {
    void loadRuntimePolicies();
  }, [loadRuntimePolicies]);

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
    setSwitchTarget(currentSwitchProvider);
    setSwitchPlan(null);
    setSwitchError(null);
  }, [currentSwitchProvider, agent.id]);

  const patchConfig = useCallback(
    async (body: Record<string, unknown>) => {
      const res = await fetch(
        `/api/orchestration/agents/${encodeURIComponent(openclawId)}/openclaw-config`,
        { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      );
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      refreshConfigurationData();
      return data;
    },
    [openclawId, refreshConfigurationData],
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

  const loadSwitchPlan = useCallback(
    async (targetProvider: string) => {
      setSwitchLoading(true);
      setSwitchError(null);
      try {
        const response = await fetch(`/api/orchestration/agents/${encodeURIComponent(agent.id)}/provider/preflight`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetProvider }),
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
    [agent.id],
  );

  const switchProvider = useCallback(async () => {
    setSwitchLoading(true);
    setSwitchError(null);
    setSwitchNotice(null);
    try {
      const response = await fetch(`/api/orchestration/agents/${encodeURIComponent(agent.id)}/provider`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetProvider: switchTarget }),
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
  }, [agent.id, loadSwitchPlan, refreshConfigurationData, switchTarget]);

  const currentProviderActivation =
    lookupActivation(providerStatus?.providerActivations, resolved.providerId) ??
    lookupActivation(providerStatus?.providerActivations, currentSwitchProvider);
  const selectedProviderActivation = lookupActivation(providerStatus?.providerActivations, switchTarget);
  const isPaperclipManaged = Boolean(executionSettingsRow?.paperclipAgentId);
  const runtimeWorkspaceEditable = Boolean(oc && !ocError);
  const modelEditable = isPaperclipManaged ? Boolean(executionSettingsRow?.canUpdate) : Boolean(oc && !ocError);
  const modelValue = executionSettingsRow?.modelId || oc?.model || agent.model || "";

  // Runtime config: Paperclip agents use the Paperclip settings API;
  // local agents use the local runtime_config_json column via patchConfig.
  const localRuntimeConfig = oc?.runtimeConfig as Record<string, number | boolean | undefined> | undefined;
  const hasLocalRuntimeConfig = Boolean(oc && !ocError);
  const timeoutEditable = isPaperclipManaged
    ? Boolean(executionSettingsRow?.canUpdate)
    : hasLocalRuntimeConfig;
  const heartbeatEditable = isPaperclipManaged
    ? Boolean(heartbeatSettingsRow?.canUpdate)
    : hasLocalRuntimeConfig;
  const hasPersistedHeartbeatPolicy = isPaperclipManaged
    ? Boolean(heartbeatSettingsRow?.paperclipAgentId)
    : hasLocalRuntimeConfig;
  const heartbeatPolicyNote =
    isPaperclipManaged
      ? (heartbeatSettingsRow?.updateBlocker ??
         companyHeartbeatSettings?.writeSupport.reason ??
         (!heartbeatSettingsRow?.paperclipAgentId
           ? "This runtime does not expose a writable per-agent heartbeat policy here yet."
           : undefined))
      : (hasLocalRuntimeConfig
          ? "Persisted locally in runtime_config_json. Read by the execution engine at run start."
          : "Runtime configuration unavailable.");
  const executionPolicyNote =
    isPaperclipManaged
      ? (executionSettingsRow?.updateBlocker ??
         companyExecutionSettings?.writeSupport.reason ??
         undefined)
      : (hasLocalRuntimeConfig
          ? "Persisted locally in runtime_config_json. Read by the execution engine at run start."
          : "Runtime configuration unavailable.");

  // Helpers for local runtime config persistence
  const patchLocalRuntime = useCallback(
    (patch: Record<string, number | boolean | null>) => {
      const current = (oc?.runtimeConfig ?? {}) as Record<string, unknown>;
      patchConfig({ runtimeConfig: { ...current, ...patch } });
    },
    [oc, patchConfig],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, paddingBottom: 20, maxWidth: 980 }}>
      {/* ── Identity ── */}
      <Section
        icon={<Settings size={14} />}
        title="Identity"
        subtitle="Editable profile details used across Mission Control."
      >
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
      </Section>

      {/* ══════════════════════════════════════════
          RUNTIME & PROVIDER
          ══════════════════════════════════════════ */}
      <Section
        icon={<Radio size={14} />}
        title="Runtime & Provider"
        subtitle="Separate the execution runtime from the provider identity and its observability guarantees."
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
            <SummaryListRow label="Workspace" value={oc?.workspace || "\u2014"} mono />
            <SummaryListRow label="Agent dir" value={oc?.agentDir || "\u2014"} mono />
            <SummaryListRow label="Sessions" value={String(oc?.sessionCount ?? "\u2014")} />
            {ocLoading ? (
              <InlineStatusText>Loading runtime bridge details…</InlineStatusText>
            ) : null}
            {ocError ? (
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
              <div style={microHeadingStyle}>Observability capabilities</div>
              <ReadableCapabilityGrid capabilities={resolved.capabilities} />
            </div>
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
            subtitle="What Mission Control can currently verify about this runtime path."
          >
            <SummaryListRow label="Adapter type" value={providerStatus?.adapterType || agent.adapterType || "\u2014"} mono />
            <SummaryListRow label="OpenClaw ID" value={providerStatus?.externalIds.openclaw || agent.openclawAgentId || "\u2014"} mono />
            <SummaryListRow label="Paperclip ID" value={providerStatus?.externalIds.paperclip || agent.paperclipAgentId || "\u2014"} mono />
            <SummaryListRow
              label="Activation"
              value={currentProviderActivation?.canActivate ? "Ready enough to route" : "Blocked or partially verified"}
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

          <SummaryCard
            eyebrow="Provider control"
            title="Switch provider"
            subtitle="Preflight a real provider change before mutating adapter state."
            badge={<TogglePill enabled={switchPlan?.mode === "switchable"} label={switchPlan?.mode === "switchable" ? "Switchable" : "Preview"} />}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <div style={{ ...microHeadingStyle, marginBottom: 6 }}>Target provider</div>
                <select
                  value={switchTarget}
                  onChange={(event) => {
                    setSwitchTarget(event.target.value);
                    setSwitchPlan(null);
                    setSwitchError(null);
                    setSwitchNotice(null);
                  }}
                  style={{ ...inputStyle(), cursor: "pointer" }}
                >
                  {SWITCHABLE_PROVIDER_IDS.map((providerId) => {
                    const descriptor = PROVIDER_PRODUCT_DESCRIPTORS.find((entry) => normalizeSwitchProviderId(entry.providerId) === providerId);
                    return (
                      <option key={providerId} value={providerId}>
                        {descriptor?.displayName ?? providerId}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <ActionButton
                  label={switchLoading ? "Checking…" : "Preview switch"}
                  onClick={() => void loadSwitchPlan(switchTarget)}
                  disabled={switchLoading}
                />
                <ActionButton
                  label={switchLoading ? "Switching…" : "Apply switch"}
                  onClick={() => void switchProvider()}
                  disabled={switchLoading || switchPlan?.mode !== "switchable"}
                  emphasis="primary"
                />
              </div>

              {switchNotice ? <InlineStatusText>{switchNotice}</InlineStatusText> : null}
              {switchError ? <InlineStatusText tone="error">Provider switch check failed ({switchError}).</InlineStatusText> : null}

              {switchPlan ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={infoNoteStyle}>{switchPlan.summary}</div>
                  {switchPlan.activation ? <ActivationCheckList checks={switchPlan.activation.checks} /> : null}
                  {switchPlan.blockers.length > 0 ? (
                    <SupportNote tone="error" title="Blocking conditions">
                      <SwitchStateList items={switchPlan.blockers.map((item) => item.message)} />
                    </SupportNote>
                  ) : null}
                  {switchPlan.warnings.length > 0 ? (
                    <SupportNote tone="warning" title="Warnings">
                      <SwitchStateList items={switchPlan.warnings.map((item) => item.message)} />
                    </SupportNote>
                  ) : null}
                  {switchPlan.stateChanges ? (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
                      <SupportNote title="Preserved state">
                        <SwitchStateList items={switchPlan.stateChanges.preserved} />
                      </SupportNote>
                      <SupportNote title="Reset state">
                        <SwitchStateList items={switchPlan.stateChanges.reset} />
                      </SupportNote>
                    </div>
                  ) : null}
                </div>
              ) : selectedProviderActivation ? (
                <InlineStatusText>{selectedProviderActivation.summary}</InlineStatusText>
              ) : null}
            </div>
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
              Providers Mission Control can integrate with. Availability shown here is static product truth, not a per-agent readiness check. For CLI-backed providers like Anthropic and Codex, this surface does not verify local CLI install or login state.
            </div>
            {/* Provider rows */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {PROVIDER_PRODUCT_DESCRIPTORS.map((desc) => {
                const avail = resolveAvailability(desc, resolved.providerId);
                const caps = capabilitiesFromTier(desc.maxTier);
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
            <ReadOnlyRow label="Workspace" value={oc?.workspace || "\u2014"} mono />
            <ReadOnlyRow label="Agent Dir" value={oc?.agentDir || "\u2014"} mono />
            {agent.openclawAgentId && <ReadOnlyRow label="OpenClaw Agent ID" value={agent.openclawAgentId} mono />}
            {agent.paperclipAgentId && <ReadOnlyRow label="Paperclip Agent ID" value={agent.paperclipAgentId} mono />}
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
        subtitle="Real runtime controls where Mission Control has backing support, plus explicit read-only limits where it does not."
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
            subtitle="Controls backed by the local runtime scaffold and Mission Control agent record."
          >
            {modelEditable ? (
              <EditableSelect
                label="Model"
                value={modelValue}
                options={MODEL_OPTIONS.map((m) => ({ value: m, label: m }))}
                onSave={(value) =>
                  isPaperclipManaged && executionSettingsRow?.canUpdate
                    ? patchExecutionSettings({ modelId: value })
                    : patchConfig({ model: value })
                }
                mono
                helpText={
                  isPaperclipManaged
                    ? "Writes to the linked Paperclip adapter config."
                    : "Writes to the local runtime config and Mission Control agent record."
                }
              />
            ) : (
              <ReadOnlyRow label="Model" value={modelValue || "\u2014"} mono />
            )}
            {runtimeWorkspaceEditable ? (
              <EditableText
                label="Workspace"
                value={oc?.workspace || ""}
                onSave={(value) => patchConfig({ workspace: value })}
                mono
              />
            ) : (
              <ReadOnlyRow label="Workspace" value={oc?.workspace || "\u2014"} mono />
            )}
            <ReadOnlyRow label="Agent dir" value={oc?.agentDir || "\u2014"} mono />
            <ReadOnlyRow label="OpenClaw ID" value={agent.openclawAgentId || "\u2014"} mono />
            <ReadOnlyRow label="Sessions" value={String(oc?.sessionCount ?? "\u2014")} />
            {!runtimeWorkspaceEditable || !modelEditable ? (
              <InlineStatusText>
                Local runtime edits are only available when Mission Control can resolve the agent’s OpenClaw scaffold.
              </InlineStatusText>
            ) : null}
          </SummaryCard>

          <SummaryCard
            eyebrow="Execution policy"
            title="Timeouts & runtime limits"
            subtitle={isPaperclipManaged
              ? "Backed by the Paperclip control plane."
              : "Persisted locally in runtime_config_json. Read by the engine at run start."
            }
          >
            {timeoutEditable ? (
              <>
                <EditableNumber
                  label="Timeout"
                  value={isPaperclipManaged
                    ? (executionSettingsRow?.timeoutSeconds ?? null)
                    : (typeof localRuntimeConfig?.timeoutSeconds === "number" ? localRuntimeConfig.timeoutSeconds : null)
                  }
                  onSave={(value) => isPaperclipManaged
                    ? patchExecutionSettings({ timeoutSeconds: value })
                    : patchLocalRuntime({ timeoutSeconds: value })
                  }
                  suffix="seconds"
                />
                <EditableNumber
                  label="Grace"
                  value={isPaperclipManaged
                    ? (executionSettingsRow?.graceSeconds ?? null)
                    : (typeof localRuntimeConfig?.graceSeconds === "number" ? localRuntimeConfig.graceSeconds : null)
                  }
                  onSave={(value) => isPaperclipManaged
                    ? patchExecutionSettings({ graceSeconds: value })
                    : patchLocalRuntime({ graceSeconds: value })
                  }
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
              value={isPaperclipManaged ? "Paperclip control plane" : "Local runtime_config_json"}
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
            subtitle={isPaperclipManaged
              ? "Backed by the Paperclip control plane."
              : "Persisted locally in runtime_config_json. Read by the engine at run start."
            }
          >
            {heartbeatEditable ? (
              <>
                <EditableSelect
                  label="Heartbeat"
                  value={isPaperclipManaged
                    ? (heartbeatSettingsRow?.heartbeatEnabled ? "enabled" : "disabled")
                    : (localRuntimeConfig?.heartbeatEnabled ? "enabled" : "disabled")
                  }
                  options={[
                    { value: "enabled", label: "Enabled" },
                    { value: "disabled", label: "Disabled" },
                  ]}
                  onSave={(value) => isPaperclipManaged
                    ? patchHeartbeatSettings({ heartbeatEnabled: value === "enabled" })
                    : patchLocalRuntime({ heartbeatEnabled: value === "enabled" })
                  }
                />
                <EditableNumber
                  label="Interval"
                  value={isPaperclipManaged
                    ? (heartbeatSettingsRow?.intervalSeconds ?? 0)
                    : (typeof localRuntimeConfig?.heartbeatIntervalSeconds === "number" ? localRuntimeConfig.heartbeatIntervalSeconds : 0)
                  }
                  onSave={(value) => isPaperclipManaged
                    ? patchHeartbeatSettings({ intervalSeconds: value })
                    : patchLocalRuntime({ heartbeatIntervalSeconds: value })
                  }
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
              value={isPaperclipManaged
                ? (heartbeatSettingsRow?.schedulerActive ? "Active" : "Not active")
                : "Local engine"
              }
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
            detail="Mission Control task completions."
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

      {/* ── Identity Files ── */}
      {oc && (
        <Section
          icon={<FileText size={14} />}
          title="Identity Files"
          subtitle="Long-form identity documents available to the active runtime."
        >
          <FileStatus label="IDENTITY.md" exists={oc.identityExists} preview={oc.identityPreview} />
          <FileStatus label="SOUL.md" exists={oc.soulExists} preview={oc.soulPreview} />
        </Section>
      )}

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
        subtitle="Agent-specific credentials for Mission Control integrations."
      >
        <EmptyStateCard
          title="No active API keys"
          body="This agent does not currently have any Mission Control API keys configured."
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
      background: isActive ? "rgba(34,197,94,0.05)" : UI.surface,
      border: `1px solid ${isActive ? "rgba(34,197,94,0.16)" : UI.surfaceBorder}`,
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
        <span style={{ fontSize: 13, fontWeight: 600, color: isActive ? "#22c55e" : A.text }}>
          {descriptor.displayName}
        </span>
        <TierBadge tier={descriptor.maxTier} />
        <AvailabilityBadge availability={availability} />
        <span style={{
          fontSize: 11, color: A.muted, marginLeft: "auto",
          display: "flex", alignItems: "center", gap: 4,
        }}>
          {capCount}/6 capabilities
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${UI.divider}` }}>
          <div style={{ fontSize: 12, color: A.textSec, marginBottom: 10, lineHeight: 1.6 }}>
            {descriptor.integrationPath}
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
              background: "rgba(255,255,255,0.02)",
              border: `1px solid ${UI.divider}`,
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: available ? "#22c55e" : "rgba(120,113,108,0.4)",
                flexShrink: 0,
              }}
            />
            <span style={{ fontSize: 12, color: available ? A.textSec : A.muted, lineHeight: 1.45 }}>
              {label}
            </span>
            {!available ? (
              <span style={{ fontSize: 10, color: "rgba(120,113,108,0.55)", marginLeft: "auto" }}>
                unavailable
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
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
        border: `1px solid ${accent ? UI.accentBorder : UI.surfaceBorder}`,
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
        borderTop: `1px solid ${UI.divider}`,
      }}
    >
      <span style={{ fontSize: 11, color: UI.label, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" }}>
        {label}
      </span>
      <span
        style={{
          fontSize: 13,
          color: A.text,
          lineHeight: 1.6,
          fontFamily: mono ? "monospace" : "inherit",
          wordBreak: "break-word",
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
        color: tone === "error" ? "#fca5a5" : A.muted,
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
        border: `1px solid ${UI.surfaceBorder}`,
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
        borderTop: `1px solid ${UI.divider}`,
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
            background: "rgba(255,255,255,0.02)",
            border: `1px solid ${UI.divider}`,
          }}
        >
          {check.passed ? (
            <CheckCircle size={14} style={{ color: "#22c55e", marginTop: 2, flexShrink: 0 }} />
          ) : (
            <XCircle size={14} style={{ color: check.blocking ? "#f97316" : "#a8a29e", marginTop: 2, flexShrink: 0 }} />
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
          border: "rgba(248,113,113,0.28)",
          background: "rgba(127,29,29,0.16)",
          titleColor: "#fca5a5",
        }
      : tone === "warning"
        ? {
            border: "rgba(245,158,11,0.22)",
            background: "rgba(120,53,15,0.14)",
            titleColor: "#fdba74",
          }
        : {
            border: UI.divider,
            background: "rgba(255,255,255,0.02)",
            titleColor: A.text,
          };

  return (
    <div
      style={{
        padding: "12px 13px",
        borderRadius: 12,
        border: `1px solid ${tones.border}`,
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
        border: `1px solid ${emphasis === "primary" ? UI.accentBorder : UI.surfaceBorder}`,
        background: emphasis === "primary" ? "rgba(245,158,11,0.12)" : UI.surface,
        color: emphasis === "primary" ? A.accentLight : A.text,
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
        color: status === "saving" ? A.accentLight : status === "saved" ? "#6ee7b7" : "#ef4444",
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
    setDraft(value == null ? "" : String(value));
  }, [value]);

  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);

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
        <span onClick={() => setEditing(true)} style={displayStyle()} title="Click to edit">
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
        fontSize: 13, color: A.text,
        fontFamily: mono ? "monospace" : "inherit",
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
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
      border: `1px solid ${UI.sectionBorder}`,
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
            color: A.accentLight,
            background: "rgba(255,255,255,0.04)",
            border: `1px solid ${UI.surfaceBorder}`,
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
function TogglePill({ enabled, label }: { enabled: boolean; label: string }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "5px 11px", borderRadius: 999,
      background: enabled ? "rgba(217,119,6,0.12)" : "rgba(120,113,108,0.12)",
      border: `1px solid ${enabled ? UI.accentBorder : "rgba(120,113,108,0.2)"}`,
      fontSize: 11, fontWeight: 600, color: enabled ? A.accentLight : A.muted,
    }}>
      <span style={{
        width: 8, height: 8, borderRadius: "50%",
        background: enabled ? A.accentLight : A.muted,
      }} />
      {label}
    </span>
  );
}

/* ── File status row ── */
function FileStatus({ label, exists, preview }: { label: string; exists: boolean; preview: string | null }) {
  return (
    <div
      style={{
        marginBottom: 12,
        padding: "14px 16px",
        borderRadius: 12,
        background: UI.surface,
        border: `1px solid ${UI.surfaceBorder}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        {exists ? (
          <CheckCircle size={14} style={{ color: "#22c55e" }} />
        ) : (
          <XCircle size={14} style={{ color: A.muted }} />
        )}
        <span style={{ fontSize: 13, color: A.text, fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: 11, color: exists ? "#6ee7b7" : A.muted }}>
          {exists ? "Found" : "Not found"}
        </span>
      </div>
      {exists && preview && (
        <div style={{
          padding: "10px 12px", borderRadius: 10,
          background: "rgba(255,255,255,0.02)",
          border: `1px solid ${UI.divider}`,
          fontSize: 12, color: A.textSec, fontFamily: "monospace",
          whiteSpace: "pre-wrap", lineHeight: 1.6,
          maxHeight: 120, overflow: "hidden",
        }}>
          {preview}
        </div>
      )}
    </div>
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
  display: "grid",
  gridTemplateColumns: `minmax(140px, ${FIELD_LABEL_WIDTH}px) minmax(0, 1fr) minmax(0, auto)`,
  gap: 14,
  alignItems: "start",
  padding: "10px 0",
  borderTop: `1px solid ${UI.divider}`,
};

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 11,
  color: UI.label,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  paddingTop: 12,
};

const saveCellStyle: React.CSSProperties = {
  minWidth: 72,
  paddingTop: 11,
};

const detailPanelStyle: React.CSSProperties = {
  marginTop: 10,
  padding: "14px 16px",
  borderRadius: 14,
  background: UI.surface,
  border: `1px solid ${UI.surfaceBorder}`,
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
  minHeight: 48,
  fontSize: 13,
  color: A.text,
  fontFamily: mono ? "monospace" : "inherit",
  background: UI.surfaceStrong,
  border: `1px solid ${UI.surfaceBorder}`,
  borderRadius: 12,
  padding: "11px 14px",
  outline: "none",
  lineHeight: "1.5",
  boxSizing: "border-box",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.02)",
});

const displayStyle = (mono?: boolean): React.CSSProperties => ({
  width: "100%",
  minHeight: 48,
  fontSize: 13,
  color: A.text,
  fontFamily: mono ? "monospace" : "inherit",
  cursor: "pointer",
  borderRadius: 12,
  padding: "11px 14px",
  border: `1px solid ${UI.surfaceBorder}`,
  background: UI.surfaceStrong,
  transition: "border-color 0.15s, background 0.15s",
  boxSizing: "border-box",
  display: "flex",
  alignItems: "center",
  overflow: "hidden",
  textOverflow: "ellipsis",
  lineHeight: "1.5",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.02)",
});

const tagStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "4px 9px",
  borderRadius: 999,
  background: "rgba(217,119,6,0.12)",
  border: `1px solid ${UI.accentBorder}`,
  fontSize: 11,
  fontWeight: 600,
  color: A.accentLight,
};
