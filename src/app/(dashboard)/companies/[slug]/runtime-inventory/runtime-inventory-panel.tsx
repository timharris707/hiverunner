"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useParams } from "next/navigation";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Cpu,
  Download,
  RefreshCw,
  Server,
  Terminal,
} from "lucide-react";

import { CompanyErrorState } from "@/components/company/company-ui";
import { AvatarGlyph } from "@/components/orchestration/AvatarGlyph";
import { ProviderLogo } from "@/components/orchestration/ProviderLogo";
import {
  listCompanies,
  listCompanyAgents,
  listCompanyRuntimes,
  updateCompanyRuntimeCli,
} from "@/lib/orchestration/client";
import type {
  DetectedOrchestrationRuntime,
  OrchestrationAgent,
  OrchestrationCompany,
  OrchestrationRuntime,
  OrchestrationRuntimeDependencyReadiness,
  OrchestrationRuntimeExecutionRun,
  OrchestrationRuntimeHealthStatus,
  OrchestrationRuntimeStatus,
} from "@/lib/orchestration/types";
import { ActionButton, Badge, EmptyState } from "@/lib/ui/primitives";
import { buildCanonicalAgentPath, buildCanonicalCompanyPath } from "@/lib/orchestration/route-paths";
import { color, font, radius, space, type as T } from "@/lib/ui/tokens";

const PROVIDER_OPTIONS = [
  { value: "codex", label: "Codex", command: "codex" },
  { value: "symphony", label: "External runner", command: "" },
  { value: "anthropic", label: "Anthropic / Claude Code", command: "claude" },
  { value: "hermes", label: "HERMES", command: "hermes" },
  { value: "openclaw", label: "OpenClaw", command: "openclaw" },
  { value: "gemini", label: "Gemini", command: "gemini" },
  { value: "multica", label: "Multica", command: "multica" },
  { value: "custom", label: "Custom", command: "" },
] as const;

type RuntimeTab = "attached" | "detected";

type ProviderBillingProfile = {
  provider: string;
  displayName: string;
  connectionType: string;
  billingModel: string;
  biller: string;
  authSurface: string;
  confidence: string;
};

type RuntimeListItem = {
  key: string;
  kind: RuntimeTab;
  provider: string;
  displayName: string;
  subtitle: string;
  target: string;
  status: OrchestrationRuntimeStatus;
  healthStatus?: OrchestrationRuntimeHealthStatus | null;
  version?: string | null;
  versionLatest?: boolean | null;
  latestVersion?: string | null;
  versionCheckDetail?: string | null;
  command?: string | null;
  commandPath?: string | null;
  workspaceRoot?: string | null;
  metadata: Record<string, unknown>;
  runtime?: OrchestrationRuntime;
  detected?: DetectedOrchestrationRuntime;
  dependency?: OrchestrationRuntimeDependencyReadiness;
};

const pageStyle: CSSProperties = {
  padding: `${space.lg}px ${space.xl}px 80px`,
  color: color.text,
  fontSize: T.body.size,
  maxWidth: "none",
};

const topBarStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: space.lg,
  marginBottom: space.lg,
};

const titleRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: space.md,
  minWidth: 0,
};

const shellStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(300px, 380px) minmax(0, 1fr)",
  minHeight: "calc(100vh - 150px)",
  borderRadius: radius.lg,
  border: `0.5px solid ${color.border}`,
  background: color.surface,
  overflow: "hidden",
};

const listPaneStyle: CSSProperties = {
  minWidth: 0,
  borderRight: `0.5px solid ${color.border}`,
  background: color.surface,
  display: "flex",
  flexDirection: "column",
};

const detailPaneStyle: CSSProperties = {
  minWidth: 0,
  overflow: "auto",
  background: color.surface,
};

const listHeaderStyle: CSSProperties = {
  padding: `${space.lg}px ${space.lg}px ${space.md}px`,
  borderBottom: `0.5px solid ${color.border}`,
};

const tabGroupStyle: CSSProperties = {
  marginTop: space.md,
  display: "inline-flex",
  padding: 2,
  borderRadius: radius.md,
  background: color.surfaceElevated,
  border: `0.5px solid ${color.border}`,
};

const listScrollStyle: CSSProperties = {
  minHeight: 0,
  overflow: "auto",
  flex: "1 1 auto",
};

const listFooterStyle: CSSProperties = {
  padding: space.lg,
  borderTop: `0.5px solid ${color.border}`,
  display: "grid",
  gap: space.sm,
};

const noticeStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: space.sm,
  marginBottom: space.md,
  padding: `${space.sm}px ${space.md}px`,
  borderRadius: radius.md,
  border: `0.5px solid ${color.border}`,
  background: color.surface,
  color: color.textSecondary,
  fontSize: T.bodySmall.size,
};

const detailHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: space.lg,
  padding: `${space.lg}px ${space.xl}px`,
  borderBottom: `0.5px solid ${color.border}`,
};

const detailBodyStyle: CSSProperties = {
  padding: `${space.xl}px ${space.xl}px ${space.xxl}px`,
  display: "grid",
  gap: space.xl,
};

const detailGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
  gap: `${space.xl}px ${space.xxl}px`,
};

const sectionTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: T.cardTitle.size,
  fontWeight: 650,
  color: color.textMuted,
};

const labelStyle: CSSProperties = {
  display: "block",
  marginBottom: space.xs,
  fontSize: T.caption.size,
  fontWeight: 600,
  letterSpacing: 0,
  color: color.textMuted,
};

const monoStyle: CSSProperties = {
  fontFamily: font.mono,
  fontSize: T.mono.size,
  color: color.textSecondary,
  overflowWrap: "anywhere",
};

function providerLabel(provider: string): string {
  const normalized = provider.trim().toLowerCase();
  if (normalized === "openclaw") return "OpenClaw";
  if (normalized === "openai") return "OpenAI";
  if (normalized === "openrouter") return "OpenRouter";
  if (normalized === "ollama") return "Ollama / LM Studio";
  if (normalized === "vllm") return "vLLM";
  if (normalized === "manual") return "HiveRunner manual";
  const known = PROVIDER_OPTIONS.find((option) => option.value === normalized);
  return known?.label ?? provider;
}

function isHiddenProvider(provider: string): boolean {
  void provider;
  return false;
}

function isHiddenDetectedProvider(provider: string): boolean {
  void provider;
  return false;
}

function isLegacyRuntimeProvider(provider: string): boolean {
  return provider.trim().toLowerCase() === "openclaw";
}

function metadataRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function metadataString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function runnerMetadata(item: RuntimeListItem): { provider: string | null; model: string | null; profile: string | null } {
  const runner = metadataRecord(item.metadata.hiverunnerSymphony) ?? metadataRecord(item.metadata.runnerConfig) ?? {};
  return {
    provider: metadataString(runner.provider) ?? metadataString(item.metadata.runnerProvider) ?? metadataString(item.metadata.defaultProvider),
    model: metadataString(runner.model) ?? metadataString(item.metadata.runnerModel) ?? metadataString(item.metadata.model),
    profile: metadataString(runner.profile),
  };
}

function formatDate(value?: string | null): string {
  if (!value) return "Not seen";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatCompactNumber(value?: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "0";
  return new Intl.NumberFormat(undefined, { notation: value >= 10000 ? "compact" : "standard" }).format(value);
}

function statusTone(status: OrchestrationRuntimeStatus): "default" | "positive" | "negative" | "warning" | "info" {
  if (status === "online") return "positive";
  if (status === "error") return "negative";
  if (status === "offline") return "warning";
  if (status === "disabled") return "default";
  return "info";
}

function healthTone(status?: OrchestrationRuntimeHealthStatus | null): "default" | "positive" | "negative" | "warning" | "info" {
  if (status === "ready") return "positive";
  if (status === "missing_cli" || status === "failed_probe") return "negative";
  if (status === "needs_login") return "warning";
  if (status === "disabled") return "default";
  return "info";
}

function readinessLabel(value?: boolean | null): string {
  if (value === true) return "Ready";
  if (value === false) return "Needs attention";
  return "Not verified";
}

function titleize(value: string): string {
  return value.replace(/[_-]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function billingProfileLabel(profile?: ProviderBillingProfile | null): string {
  if (!profile) return "Billing unknown";
  if (profile.billingModel === "metered_tokens") return "Metered API";
  if (profile.billingModel === "subscription_included") return "Subscription";
  if (profile.billingModel === "subscription_overage") return "Overage";
  if (profile.billingModel === "local_free") return "Local/free";
  return titleize(profile.billingModel || "unknown");
}

function billingTone(profile?: ProviderBillingProfile | null): "default" | "positive" | "negative" | "warning" | "info" {
  if (!profile) return "warning";
  if (profile.billingModel === "metered_tokens" || profile.billingModel === "subscription_overage") return "warning";
  if (profile.billingModel === "subscription_included" || profile.billingModel === "local_free") return "positive";
  if (profile.billingModel === "hybrid" || profile.billingModel === "unknown") return "info";
  return "default";
}

function providerBillingCopy(profile?: ProviderBillingProfile | null): string {
  if (!profile) return "HiveRunner has not classified how this provider bills yet.";
  if (profile.billingModel === "metered_tokens") {
    return `Billed by ${profile.biller} through ${titleize(profile.connectionType)}. Token usage is expected to create billable API spend.`;
  }
  if (profile.billingModel === "subscription_included") {
    return `Billed by ${profile.biller} through a subscription-style path. Token usage is tracked, but request cost is treated as included unless overage evidence is reported.`;
  }
  if (profile.billingModel === "local_free") {
    return "Local execution path. Tokens are usage telemetry, not vendor spend.";
  }
  if (profile.billingModel === "hybrid") {
    return `Hybrid billing path through ${profile.biller}. HiveRunner can observe this runtime, but the downstream provider may vary by run.`;
  }
  return `Billing model is ${titleize(profile.billingModel)} with ${profile.biller}.`;
}

function targetLabel(runtime: OrchestrationRuntime, agentById: Map<string, OrchestrationAgent>): string {
  if (runtime.agentId) {
    return agentById.get(runtime.agentId)?.name ?? "Agent runtime";
  }
  if (runtime.scope === "company") return "Company";
  return runtime.scope;
}

function statusDotColor(status: OrchestrationRuntimeStatus): string {
  if (status === "online") return color.positive;
  if (status === "error") return color.negative;
  if (status === "offline") return color.warning;
  if (status === "disabled") return color.textMuted;
  return color.info;
}

function tokenMix(token: string, percent: number): string {
  return `color-mix(in srgb, ${token} ${percent.toFixed(0)}%, transparent)`;
}

function findCompany(slug: string, companies: OrchestrationCompany[]): OrchestrationCompany | null {
  return companies.find((row) => row.slug === slug || row.code === slug) ?? null;
}

function runMatchesRuntime(item: RuntimeListItem, run: OrchestrationRuntimeExecutionRun): boolean {
  if (run.provider !== item.provider) return false;
  if (item.runtime?.agentId) return run.agentId === item.runtime.agentId;
  return true;
}

function profileForProvider(profiles: ProviderBillingProfile[], provider: string): ProviderBillingProfile | null {
  const normalized = provider.toLowerCase();
  return profiles.find((profile) => profile.provider.toLowerCase() === normalized) ?? null;
}

function agentsForRuntime(item: RuntimeListItem, agents: OrchestrationAgent[]): OrchestrationAgent[] {
  if (item.runtime?.agentId) {
    return agents.filter((agent) => agent.id === item.runtime?.agentId);
  }
  return agents.filter((agent) => (agent.adapterType ?? "").toLowerCase() === item.provider.toLowerCase());
}

function runtimeToItem(
  runtime: OrchestrationRuntime,
  agentById: Map<string, OrchestrationAgent>,
  fallbackWorkspace: string,
): RuntimeListItem {
  const health = runtime.health;
  const commandPath = health?.commandPath ?? runtime.command ?? null;
  const version = health?.version ?? runtime.version ?? null;
  return {
    key: `attached:${runtime.id}`,
    kind: "attached",
    provider: runtime.provider,
    displayName: runtime.displayName,
    subtitle: version || commandPath || runtime.runtimeSlug,
    target: targetLabel(runtime, agentById),
    status: runtime.status,
    healthStatus: health?.status ?? null,
    version,
    versionLatest: health?.versionLatest ?? null,
    latestVersion: health?.latestVersion ?? null,
    versionCheckDetail: health?.versionCheckDetail ?? null,
    command: runtime.command,
    commandPath,
    workspaceRoot: health?.workspaceRoot ?? runtime.workspaceRoot ?? fallbackWorkspace,
    metadata: runtime.metadata,
    runtime,
  };
}

function detectedToItem(candidate: DetectedOrchestrationRuntime): RuntimeListItem {
  const versionLatest =
    typeof candidate.metadata.versionLatest === "boolean"
      ? candidate.metadata.versionLatest
      : null;
  return {
    key: `detected:${candidate.provider}:${candidate.commandPath}`,
    kind: "detected",
    provider: candidate.provider,
    displayName: candidate.displayName,
    subtitle: candidate.version || candidate.commandPath,
    target: "Local CLI",
    status: candidate.status,
    healthStatus: null,
    version: candidate.version ?? null,
    versionLatest,
    latestVersion:
      typeof candidate.metadata.latestVersion === "string"
        ? candidate.metadata.latestVersion
        : null,
    versionCheckDetail:
      typeof candidate.metadata.versionCheckDetail === "string"
        ? candidate.metadata.versionCheckDetail
        : null,
    command: candidate.command,
    commandPath: candidate.commandPath,
    workspaceRoot: null,
    metadata: candidate.metadata,
    detected: candidate,
  };
}

function dependencyStatusToRuntimeStatus(status: OrchestrationRuntimeDependencyReadiness["status"]): OrchestrationRuntimeStatus {
  if (status === "ready") return "online";
  if (status === "needs_login") return "error";
  if (status === "missing_optional" || status === "not_configured") return "offline";
  return "unknown";
}

function dependencyToItem(dependency: OrchestrationRuntimeDependencyReadiness): RuntimeListItem {
  return {
    key: `dependency:${dependency.id}`,
    kind: "detected",
    provider: dependency.provider,
    displayName: dependency.label,
    subtitle: dependency.commandPath ?? dependency.command ?? dependency.setupHint,
    target: dependency.optionality === "core_local_boot" ? "Required for boot" : "Optional integration",
    status: dependencyStatusToRuntimeStatus(dependency.status),
    healthStatus:
      dependency.status === "ready"
        ? "ready"
        : dependency.status === "needs_login"
          ? "needs_login"
          : dependency.status === "missing_optional"
            ? "missing_cli"
            : "unknown",
    version: dependency.version,
    command: dependency.command,
    commandPath: dependency.commandPath,
    workspaceRoot: null,
    metadata: {
      readiness: dependency.status,
      optionality: dependency.optionality,
      envVars: dependency.envVars,
      note: dependency.note,
      setupHint: dependency.setupHint,
    },
    dependency,
  };
}

function isRuntimeInventoryPlaceholder(runtime: OrchestrationRuntime): boolean {
  return (
    runtime.provider.trim().toLowerCase() === "manual" &&
    runtime.status === "disabled" &&
    !runtime.command?.trim() &&
    runtime.displayName.trim().toLowerCase().endsWith(" runtime")
  );
}

function RuntimeInventoryLoadingState() {
  const skeleton = (width: string, height = 12): CSSProperties => ({
    width,
    height,
    borderRadius: radius.full,
    background: "color-mix(in srgb, var(--text-primary) 9%, transparent)",
  });

  return (
    <div style={pageStyle}>
      <div style={topBarStyle}>
        <div style={titleRowStyle}>
          <span
            aria-hidden="true"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 32,
              height: 32,
              borderRadius: radius.md,
              border: `0.5px solid ${color.border}`,
              color: color.accent,
              background: color.accentSoft,
              flex: "0 0 auto",
            }}
          >
            <Cpu size={17} />
          </span>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ margin: 0, fontSize: T.pageTitle.size, fontWeight: T.pageTitle.weight, color: color.text }}>
              Runtimes
            </h1>
            <div style={{ marginTop: 2, color: color.textMuted, fontSize: T.bodySmall.size }}>
              Loading live runtime inventory...
            </div>
          </div>
        </div>
        <ActionButton label="Scanning..." icon={<RefreshCw size={14} />} disabled />
      </div>

      <div style={shellStyle} aria-busy="true" aria-label="Loading runtime inventory">
        <div style={listPaneStyle}>
          <div style={listHeaderStyle}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: space.md }}>
              <h2 style={{ margin: 0, color: color.text, fontSize: 18 }}>Runtime Inventory</h2>
              <span style={{ color: color.textMuted, fontSize: T.bodySmall.size }}>Scanning</span>
            </div>
            <div style={tabGroupStyle}>
              <span style={{ height: 30, borderRadius: radius.sm, background: color.surfaceElevated, color: color.text, padding: `7px ${space.md}px 0`, fontSize: T.bodySmall.size, fontWeight: 650 }}>Dependencies</span>
              <span style={{ height: 30, borderRadius: radius.sm, color: color.textMuted, padding: `7px ${space.md}px 0`, fontSize: T.bodySmall.size, fontWeight: 650 }}>Agent bindings</span>
            </div>
            <p style={{ margin: `${space.sm}px 0 0`, color: color.textMuted, fontSize: T.caption.size, lineHeight: 1.45 }}>
              Checking local CLIs, attached agent bindings, provider metadata, and recent usage.
            </p>
          </div>
          <div style={listScrollStyle}>
            {["Codex", "Claude Code", "Gemini", "Hermes", "OpenClaw", "Multica"].map((label) => (
              <div key={label} style={{ display: "grid", gridTemplateColumns: "44px minmax(0, 1fr) auto", gap: space.md, alignItems: "center", minHeight: 76, padding: `${space.md}px ${space.lg}px`, borderBottom: `0.5px solid ${color.border}` }}>
                <div style={{ width: 28, height: 28, borderRadius: radius.md, background: "color-mix(in srgb, var(--text-primary) 8%, transparent)" }} />
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={skeleton(label === "Claude Code" ? "48%" : "34%", 14)} />
                  <div style={skeleton("62%", 10)} />
                </div>
                <div style={{ width: 9, height: 9, borderRadius: radius.full, background: color.textMuted, opacity: 0.35 }} />
              </div>
            ))}
          </div>
        </div>
        <div style={detailPaneStyle}>
          <div style={detailHeaderStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: space.md, minWidth: 0 }}>
              <div style={{ width: 32, height: 32, borderRadius: radius.md, background: "color-mix(in srgb, var(--text-primary) 8%, transparent)" }} />
              <div style={{ display: "grid", gap: 9, minWidth: 220 }}>
                <div style={skeleton("60%", 18)} />
                <div style={skeleton("85%", 11)} />
              </div>
            </div>
            <div style={{ display: "flex", gap: space.sm }}>
              <div style={skeleton("72px", 24)} />
              <div style={skeleton("64px", 24)} />
            </div>
          </div>
          <div style={detailBodyStyle}>
            <div style={detailGridStyle}>
              {Array.from({ length: 8 }, (_, index) => (
                <div key={index} style={{ display: "grid", gap: 8 }}>
                  <div style={skeleton("34%", 10)} />
                  <div style={skeleton(index % 2 === 0 ? "76%" : "52%", 15)} />
                </div>
              ))}
            </div>
            <div style={{ borderRadius: radius.md, border: `0.5px solid ${color.border}`, background: color.surface, minHeight: 88, padding: space.lg, display: "grid", gap: 10 }}>
              <div style={skeleton("28%", 13)} />
              <div style={skeleton("82%", 11)} />
              <div style={skeleton("58%", 11)} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function RuntimeInventoryPanel({
  slug: suppliedSlug,
  embedded = false,
}: {
  slug?: string;
  embedded?: boolean;
}) {
  const params = useParams<{ slug: string }>();
  const slug = suppliedSlug ?? params?.slug ?? "";

  const [company, setCompany] = useState<OrchestrationCompany | null>(null);
  const [agents, setAgents] = useState<OrchestrationAgent[]>([]);
  const [runtimes, setRuntimes] = useState<OrchestrationRuntime[]>([]);
  const [detected, setDetected] = useState<DetectedOrchestrationRuntime[]>([]);
  const [runtimeDependencies, setRuntimeDependencies] = useState<OrchestrationRuntimeDependencyReadiness[]>([]);
  const [recentRuns, setRecentRuns] = useState<OrchestrationRuntimeExecutionRun[]>([]);
  const [providerProfiles, setProviderProfiles] = useState<ProviderBillingProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<RuntimeTab>("detected");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const load = useCallback(async (input?: { fast?: boolean }) => {
    if (!slug) return;
    setError(null);
    const [companyRows, companyAgents, runtimePayload, costPayload] = await Promise.all([
      listCompanies(),
      listCompanyAgents(slug),
      listCompanyRuntimes(slug, { fast: input?.fast ?? false }),
      fetch(`/api/orchestration/companies/${encodeURIComponent(slug)}/costs?timeframe=mtd`, { cache: "no-store" })
        .then(async (response) => (response.ok ? await response.json() as { providerProfiles?: ProviderBillingProfile[] } : null))
        .catch(() => null),
    ]);
    setCompany(findCompany(slug, companyRows));
    setAgents(companyAgents);
    setRuntimes(runtimePayload.runtimes);
    setDetected(runtimePayload.detectedLocalRuntimes);
    setRuntimeDependencies(runtimePayload.runtimeDependencies);
    setRecentRuns(runtimePayload.recentExecutionRuns);
    setProviderProfiles(costPayload?.providerProfiles ?? []);
    setLoading(false);
  }, [slug]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void load({ fast: true })
        .then(() => {
          if (cancelled) return;
          void load({ fast: false }).catch((err) => {
            if (!cancelled) setError(err instanceof Error ? err.message : String(err));
          });
        })
        .catch((err) => {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : String(err));
            setLoading(false);
          }
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [load]);

  const agentById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents]);
  const fallbackWorkspace = company?.workspace.root ?? "";
  const attachedItems = useMemo(
    () => runtimes
      .filter((runtime) => !isRuntimeInventoryPlaceholder(runtime))
      .filter((runtime) => !isHiddenProvider(runtime.provider))
      .map((runtime) => runtimeToItem(runtime, agentById, fallbackWorkspace)),
    [agentById, fallbackWorkspace, runtimes],
  );
  const detectedItems = useMemo(
    () => {
      if (runtimeDependencies.length > 0) {
        return runtimeDependencies
          .filter((dependency) => dependency.optionality !== "core_local_boot")
          .filter((dependency) => !isHiddenDetectedProvider(dependency.provider ?? ""))
          .map(dependencyToItem);
      }
      return detected.filter((runtime) => !isHiddenDetectedProvider(runtime.provider ?? "")).map(detectedToItem);
    },
    [detected, runtimeDependencies],
  );
  const allItems = useMemo(() => [...attachedItems, ...detectedItems], [attachedItems, detectedItems]);
  const visibleItems = activeTab === "attached" ? attachedItems : detectedItems;
  const selectedItem = allItems.find((item) => item.key === selectedKey) ?? visibleItems[0] ?? allItems[0] ?? null;
  const selectedRuns = useMemo(
    () => (selectedItem ? recentRuns.filter((run) => runMatchesRuntime(selectedItem, run)) : []),
    [recentRuns, selectedItem],
  );
  const selectedAgents = useMemo(
    () => (selectedItem ? agentsForRuntime(selectedItem, agents) : []),
    [agents, selectedItem],
  );
  const onlineCount = allItems.filter((item) => item.status === "online").length;
  const readyCount = attachedItems.filter((item) => item.healthStatus === "ready").length;
  const independentCount = attachedItems.filter((item) => !isLegacyRuntimeProvider(item.provider)).length;
  const missingOptionalCount = runtimeDependencies.filter((item) => item.status === "missing_optional" || item.status === "not_configured").length;

  useEffect(() => {
    if (activeTab === "attached" && attachedItems.length === 0 && detectedItems.length > 0) {
      setActiveTab("detected");
      return;
    }
    if (
      !selectedKey ||
      !allItems.some((item) => item.key === selectedKey) ||
      !visibleItems.some((item) => item.key === selectedKey)
    ) {
      setSelectedKey(visibleItems[0]?.key ?? allItems[0]?.key ?? null);
    }
  }, [activeTab, allItems, attachedItems.length, detectedItems.length, selectedKey, visibleItems]);

  const refresh = async () => {
    setRefreshing(true);
    await load({ fast: false }).catch((err) => setError(err instanceof Error ? err.message : String(err)));
    setRefreshing(false);
  };

  const updateRuntimeCli = async (item: RuntimeListItem) => {
    const key = `update:${item.provider}:${item.commandPath || item.command || item.key}`;
    setBusyKey(key);
    setError(null);
    setNotice(null);

    try {
      const result = await updateCompanyRuntimeCli(slug, item.provider);
      if (!result) {
        setError(`Could not update ${providerLabel(item.provider)}.`);
        return;
      }

      setRuntimes(result.runtimes);
      setDetected(result.detectedLocalRuntimes);
      setNotice(
        result.update.ok
          ? `${providerLabel(item.provider)} updated${result.update.afterVersion ? ` to ${result.update.afterVersion}` : ""}.`
          : result.update.error || `Could not update ${providerLabel(item.provider)}.`,
      );
      if (!result.update.ok) {
        setError(result.update.output || result.update.error || `Could not update ${providerLabel(item.provider)}.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  };

  if (loading) {
    return <RuntimeInventoryLoadingState />;
  }

  if (!company) {
    return (
      <CompanyErrorState
        title="Company not found"
        detail="HiveRunner could not resolve this company before loading runtimes."
        href="/companies"
        linkLabel="Back to companies"
      />
    );
  }

  return (
    <div style={embedded ? { color: color.text } : pageStyle}>
      <div style={topBarStyle}>
        <div style={titleRowStyle}>
          <span
            aria-hidden="true"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 32,
              height: 32,
              borderRadius: radius.md,
              border: `0.5px solid ${color.border}`,
              color: color.accent,
              background: color.accentSoft,
              flex: "0 0 auto",
            }}
          >
            <Cpu size={17} />
          </span>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ margin: 0, fontSize: T.pageTitle.size, fontWeight: T.pageTitle.weight, color: color.text }}>
              Runtime Inventory
            </h1>
            <div style={{ marginTop: 2, color: color.textMuted, fontSize: T.bodySmall.size, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {company.name} · {independentCount} independent · {readyCount} ready · {missingOptionalCount} optional missing
            </div>
          </div>
        </div>
        <ActionButton
          label={refreshing ? "Refreshing" : "Refresh"}
          icon={<RefreshCw size={14} />}
          onClick={() => void refresh()}
          disabled={refreshing}
          size="sm"
        />
        {embedded ? (
          <a
            href={`/${company.code}/runtime-inventory`}
            style={{ color: color.accent, fontSize: T.bodySmall.size, fontWeight: 700, textDecoration: "none" }}
          >
            Open in full view →
          </a>
        ) : null}
      </div>

      {notice ? (
        <div style={{ ...noticeStyle, borderColor: tokenMix(color.positive, 22) }}>
          <CheckCircle2 size={14} color={color.positive} />
          <span>{notice}</span>
        </div>
      ) : null}

      {error ? (
        <div style={{ ...noticeStyle, borderColor: tokenMix(color.negative, 25) }}>
          <AlertTriangle size={14} color={color.negative} />
          <span>{error}</span>
        </div>
      ) : null}

      <div style={shellStyle}>
        <aside style={listPaneStyle}>
          <div style={listHeaderStyle}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: space.md }}>
              <div style={{ minWidth: 0 }}>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 650, color: color.text }}>Runtime Inventory</h2>
              </div>
              <span style={{ color: color.textMuted, fontSize: T.bodySmall.size, whiteSpace: "nowrap" }}>
                {onlineCount}/{allItems.length} online
              </span>
            </div>
            <div style={tabGroupStyle} role="tablist" aria-label="Runtime inventory filter">
              <RuntimeTabButton
                active={activeTab === "detected"}
                label="Dependencies"
                count={detectedItems.length}
                onClick={() => setActiveTab("detected")}
              />
              <RuntimeTabButton
                active={activeTab === "attached"}
                label="Agent bindings"
                count={attachedItems.length}
                onClick={() => setActiveTab("attached")}
              />
            </div>
            <p style={{ margin: `${space.sm}px 0 0`, color: color.textMuted, fontSize: T.caption.size, lineHeight: 1.4 }}>
              Dependencies show optional runtimes and provider keys on this machine. Missing optional items do not block local boot, first-run setup, or manual work.
            </p>
          </div>

          <div style={listScrollStyle}>
            {visibleItems.length === 0 ? (
              <div style={{ padding: space.xl }}>
                <EmptyState
                  icon={activeTab === "attached" ? <Server size={22} /> : <Terminal size={22} />}
                  title={activeTab === "attached" ? "No agent runtime bindings" : "No runtime dependencies found"}
                  description={activeTab === "attached" ? "Agent runtime bindings are managed from agent configuration and execution hives." : "Core local boot still works. Configure optional runtimes or provider keys only when you need them."}
                />
              </div>
            ) : (
              visibleItems.map((item) => (
                <RuntimeListButton
                  key={item.key}
                  item={item}
                  attachedAgents={agentsForRuntime(item, agents)}
                  selected={selectedItem?.key === item.key}
                  onSelect={() => setSelectedKey(item.key)}
                />
              ))
            )}
          </div>

          <div style={listFooterStyle}>
            <RuntimeStat label="Dependencies" value={detectedItems.length} />
            <RuntimeStat label="Agent bindings" value={attachedItems.length} />
          </div>
        </aside>

        <main style={detailPaneStyle}>
          {selectedItem ? (
            <div>
              <RuntimeDetailHeader item={selectedItem} billingProfile={profileForProvider(providerProfiles, selectedItem.provider)} />
              <div style={detailBodyStyle}>
                <RuntimeDetail
                  item={selectedItem}
                  billingProfile={profileForProvider(providerProfiles, selectedItem.provider)}
                  companyCode={company.code}
                  attachedAgents={selectedAgents}
                  recentRuns={selectedRuns}
                  busyKey={busyKey}
                  updateRuntimeCli={updateRuntimeCli}
                />
              </div>
            </div>
          ) : (
            <div style={{ padding: space.xxl }}>
              <EmptyState icon={<Server size={24} />} title="No runtime selected" description="Attach or detect a runtime to inspect it here." />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function RuntimeTabButton({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        height: 30,
        border: 0,
        borderRadius: radius.sm,
        background: active ? color.surfaceElevated : "transparent",
        color: active ? color.text : color.textMuted,
        padding: `0 ${space.md}px`,
        fontSize: T.bodySmall.size,
        fontWeight: 650,
        cursor: "pointer",
      }}
    >
      {label} <span style={{ color: active ? color.textSecondary : color.textMuted }}>{count}</span>
    </button>
  );
}

function RuntimeListButton({
  item,
  attachedAgents,
  selected,
  onSelect,
}: {
  item: RuntimeListItem;
  attachedAgents: OrchestrationAgent[];
  selected: boolean;
  onSelect: () => void;
}) {
  const primaryAgent = item.kind === "attached" ? attachedAgents[0] : undefined;
  const title = primaryAgent ? primaryAgent.name : item.displayName;
  const subtitleTarget = primaryAgent ? providerLabel(item.provider) : item.target;

  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        width: "100%",
        minHeight: 76,
        display: "grid",
        gridTemplateColumns: "34px minmax(0, 1fr) auto",
        alignItems: "center",
        gap: space.md,
        padding: `${space.md}px ${space.lg}px`,
        border: 0,
        borderBottom: `0.5px solid ${color.border}`,
        background: selected ? color.surfaceElevated : "transparent",
        color: color.text,
        textAlign: "left",
        cursor: "pointer",
      }}
    >
      {primaryAgent ? <RuntimeAgentAvatar agent={primaryAgent} /> : <ProviderMark provider={item.provider} />}
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", color: color.text, fontSize: 14, fontWeight: 650, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {title}
        </span>
        <span style={{ marginTop: 4, display: "flex", alignItems: "center", gap: space.xs, color: color.textMuted, fontSize: T.caption.size, minWidth: 0 }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{subtitleTarget}</span>
          <span aria-hidden="true">·</span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.kind === "attached" ? item.runtime?.runtimeKind ?? "runtime" : providerLabel(item.provider)}</span>
        </span>
      </span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: space.sm, justifyContent: "flex-end" }}>
        {item.kind === "attached" ? <ProviderMark provider={item.provider} /> : null}
        <span
          aria-label={item.status}
          style={{
            width: 8,
            height: 8,
            borderRadius: radius.full,
            background: statusDotColor(item.status),
            boxShadow: `0 0 0 3px ${tokenMix(statusDotColor(item.status), 20)}`,
          }}
        />
      </span>
    </button>
  );
}

function RuntimeAgentAvatar({ agent, size = 30 }: { agent: OrchestrationAgent; size?: number }) {
  if (agent.avatar) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={agent.avatar} alt="" style={{ width: size, height: size, borderRadius: radius.full, objectFit: "cover", flex: "0 0 auto" }} />
    );
  }
  if (agent.emoji) return <AvatarGlyph value={agent.emoji} size={size - 2} />;
  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: radius.full,
        border: `0.5px solid ${color.border}`,
        background: color.surfaceElevated,
        color: color.textSecondary,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: T.caption.size,
        fontWeight: 700,
        flex: "0 0 auto",
      }}
    >
      {agent.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function RuntimeStat({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: space.md, color: color.textMuted, fontSize: T.bodySmall.size }}>
      <span>{label}</span>
      <span style={{ color: color.textSecondary, fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </div>
  );
}

function RuntimeDetailHeader({ item, billingProfile }: { item: RuntimeListItem; billingProfile: ProviderBillingProfile | null }) {
  const dependency = item.dependency;
  return (
    <div style={detailHeaderStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: space.md, minWidth: 0 }}>
        <ProviderMark provider={item.provider} large />
        <div style={{ minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 650, color: color.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {item.displayName}
          </h2>
          <div style={{ marginTop: 3, color: color.textMuted, fontSize: T.bodySmall.size, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {item.subtitle}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: space.sm, flexWrap: "wrap", justifyContent: "flex-end" }}>
        <Badge label={item.kind === "attached" ? "Agent binding" : dependency ? "Runtime dependency" : "Local CLI"} tone={item.kind === "attached" ? "accent" : "info"} />
        {!dependency ? <Badge label={billingProfileLabel(billingProfile)} tone={billingTone(billingProfile)} /> : null}
        <Badge label={dependency?.status.replace(/_/g, " ") ?? item.status} tone={statusTone(item.status)} />
        {item.healthStatus ? <Badge label={item.runtime?.health?.label || item.healthStatus} tone={healthTone(item.healthStatus)} /> : null}
      </div>
    </div>
  );
}

function RuntimeDetail({
  item,
  billingProfile,
  companyCode,
  attachedAgents,
  recentRuns,
  busyKey,
  updateRuntimeCli,
}: {
  item: RuntimeListItem;
  billingProfile: ProviderBillingProfile | null;
  companyCode: string;
  attachedAgents: OrchestrationAgent[];
  recentRuns: OrchestrationRuntimeExecutionRun[];
  busyKey: string | null;
  updateRuntimeCli: (item: RuntimeListItem) => Promise<void>;
}) {
  const runtime = item.runtime;
  const health = runtime?.health ?? null;
  const metadata = JSON.stringify(item.metadata ?? {}, null, 2);

  return (
    <>
      <RuntimeSummaryPanel
        item={item}
        health={health}
        attachedAgents={attachedAgents}
        billingProfile={billingProfile}
        companyCode={companyCode}
        busyKey={busyKey}
        updateRuntimeCli={updateRuntimeCli}
      />
      <RuntimeUsagePanel runs={recentRuns} />

      <section>
        <h3 style={sectionTitleStyle}>Metadata</h3>
        <pre
          style={{
            margin: `${space.md}px 0 0`,
            maxHeight: 220,
            overflow: "auto",
            borderRadius: radius.md,
            border: `0.5px solid ${color.border}`,
            background: color.surface,
            padding: space.lg,
            fontFamily: font.mono,
            fontSize: T.mono.size,
            lineHeight: 1.55,
            color: color.textSecondary,
            whiteSpace: "pre-wrap",
          }}
        >
          {metadata === "{}" ? "{\n  \"metadata\": \"none\"\n}" : metadata}
        </pre>
      </section>

      {runtime ? (
        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: space.xl, borderTop: `0.5px solid ${color.border}`, paddingTop: space.xl }}>
          <DetailField label="Created" value={formatDate(runtime.createdAt)} />
          <DetailField label="Updated" value={formatDate(runtime.updatedAt)} />
        </section>
      ) : null}
    </>
  );
}

type UsageRange = 7 | 30 | 90;
const ACTIVITY_CALENDAR_START = new Date(Date.UTC(2026, 3, 1));

function runTimestamp(run: OrchestrationRuntimeExecutionRun): Date | null {
  const value = run.startedAt ?? run.createdAt;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function runTokenTotal(run: OrchestrationRuntimeExecutionRun): number {
  return run.totalTokens ?? (run.inputTokens ?? 0) + (run.outputTokens ?? 0) + (run.cacheReadTokens ?? 0) + (run.cacheWriteTokens ?? 0);
}

function filterRunsByRange(runs: OrchestrationRuntimeExecutionRun[], days: number): OrchestrationRuntimeExecutionRun[] {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return runs.filter((run) => {
    const timestamp = runTimestamp(run);
    return timestamp ? timestamp.getTime() >= cutoff : false;
  });
}

function filterRunsSince(runs: OrchestrationRuntimeExecutionRun[], start: Date): OrchestrationRuntimeExecutionRun[] {
  const cutoff = start.getTime();
  return runs.filter((run) => {
    const timestamp = runTimestamp(run);
    return timestamp ? timestamp.getTime() >= cutoff : false;
  });
}

function daysSince(start: Date): number {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const startDate = new Date(start);
  startDate.setUTCHours(0, 0, 0, 0);
  const days = Math.floor((today.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  return Math.max(1, days);
}

function formatCurrency(value?: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "$0.00";
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: value < 1 ? 2 : 0 }).format(value);
}

function RuntimeSummaryPanel({
  item,
  health,
  attachedAgents,
  billingProfile,
  companyCode,
  busyKey,
  updateRuntimeCli,
}: {
  item: RuntimeListItem;
  health: OrchestrationRuntime["health"];
  attachedAgents: OrchestrationAgent[];
  billingProfile: ProviderBillingProfile | null;
  companyCode: string;
  busyKey: string | null;
  updateRuntimeCli: (item: RuntimeListItem) => Promise<void>;
}) {
  const runtime = item.runtime;
  const runner = item.provider === "symphony" ? runnerMetadata(item) : null;
  const dependency = item.dependency;
  const agentLabel = attachedAgents.length
    ? attachedAgents.map((agent) => agent.name).join(", ")
    : item.kind === "detected"
      ? "Attach to use"
      : "None";

  return (
    <section>
      <div style={detailGridStyle}>
        <DetailField label="Runtime Mode" value={dependency ? "dependency check" : runtime?.runtimeKind ?? "local CLI"} />
        <DetailField label="Provider" value={providerLabel(item.provider)} />
        {dependency ? <DetailField label="Optionality" value={titleize(dependency.optionality)} /> : null}
        {dependency?.command ? <DetailField label="Command" value={dependency.command} mono /> : null}
        {dependency?.commandPath ? <DetailField label="Detected Path" value={dependency.commandPath} mono /> : null}
        {dependency?.envVars.length ? <DetailField label="Related Env Vars" value={dependency.envVars.join(", ")} mono /> : null}
        {runner ? <DetailField label="Runner" value={runner.provider ? providerLabel(runner.provider) : "Runner metadata pending"} /> : null}
        {runner?.model ? <DetailField label="Runner Model" value={runner.model} /> : null}
        {runner?.profile ? <DetailField label="Runner Profile" value={runner.profile} /> : null}
        <DetailField label="Status" value={dependency?.status.replace(/_/g, " ") ?? item.status} />
        <DetailField label="Last Seen" value={runtime ? formatDate(runtime.lastSeenAt) : dependency ? "Readiness checked now" : "Detected now"} />
        <DetailField label="Target" value={item.target} />
        <DetailField label="Agents" value={agentLabel} />
        {!dependency ? <DetailField label="Biller" value={billingProfile?.biller ?? "Unknown"} /> : null}
        {!dependency ? <DetailField label="Billing" value={billingProfileLabel(billingProfile)} /> : null}
        {!dependency ? <DetailField label="Connection" value={billingProfile ? titleize(billingProfile.connectionType) : "Unknown"} /> : null}
        {!dependency ? <DetailField label="Auth Surface" value={billingProfile ? titleize(billingProfile.authSurface) : "Unknown"} /> : null}
        <CliVersionField item={item} busyKey={busyKey} updateRuntimeCli={updateRuntimeCli} />
        <DetailField label="Auth" value={dependency ? readinessLabel(dependency.authReady) : readinessLabel(health?.authReady)} />
      </div>
      <div
        style={{
          marginTop: space.md,
          borderRadius: radius.md,
          border: `0.5px solid ${color.border}`,
          background: color.surfaceElevated,
          padding: `${space.sm}px ${space.md}px`,
          color: color.textSecondary,
          fontSize: T.bodySmall.size,
          lineHeight: 1.5,
        }}
      >
        <div>{dependency ? dependency.note : providerBillingCopy(billingProfile)}</div>
        {dependency ? (
          <div style={{ marginTop: space.sm, color: color.textMuted }}>{dependency.setupHint}</div>
        ) : null}
        {!dependency ? (
          <a
            href={`${buildCanonicalCompanyPath(companyCode, "/costs")}?tab=providers`}
            style={{
              display: "inline-flex",
              marginTop: space.sm,
              color: color.accent,
              fontWeight: 650,
              textDecoration: "none",
            }}
          >
            Review provider billing profile
          </a>
        ) : null}
        {attachedAgents.length > 0 ? (
          <div style={{ marginTop: space.sm, display: "flex", gap: space.sm, flexWrap: "wrap" }}>
            {attachedAgents.map((agent) => (
              <a
                key={agent.id}
                href={`${buildCanonicalAgentPath(companyCode, agent.slug || agent.id)}/configuration`}
                style={{
                  color: color.accent,
                  fontWeight: 650,
                  textDecoration: "none",
                }}
              >
                Configure {agent.name} provider/model
              </a>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function CliVersionField({
  item,
  busyKey,
  updateRuntimeCli,
}: {
  item: RuntimeListItem;
  busyKey: string | null;
  updateRuntimeCli: (item: RuntimeListItem) => Promise<void>;
}) {
  const version = item.version ?? "Unknown";
  const isLatest = item.versionLatest === true;
  const isOutdated = item.versionLatest === false;
  const updateKey = `update:${item.provider}:${item.commandPath || item.command || item.key}`;
  const isUpdating = busyKey === updateKey;

  return (
    <div style={{ minWidth: 0 }}>
      <span style={labelStyle}>CLI Version</span>
      <div style={{ display: "flex", alignItems: "center", gap: space.sm, minWidth: 0, flexWrap: "wrap" }}>
        <span style={monoStyle}>{version}</span>
        {isLatest ? (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              minHeight: 20,
              padding: "0 7px",
              borderRadius: radius.sm,
              background: color.positiveSoft,
              color: color.positive,
              fontSize: T.caption.size,
              fontWeight: 650,
            }}
          >
            <CheckCircle2 size={12} />
            Latest
          </span>
        ) : null}
        {isOutdated ? (
          <span
            style={{
              color: color.warning,
              fontSize: T.caption.size,
              fontWeight: 650,
            }}
          >
            Update available
          </span>
        ) : null}
        {isOutdated ? (
          <ActionButton
            label={isUpdating ? "Updating" : "Update CLI"}
            icon={<Download size={12} />}
            onClick={() => void updateRuntimeCli(item)}
            disabled={Boolean(busyKey)}
            size="sm"
          />
        ) : null}
      </div>
      {isOutdated && item.latestVersion ? (
        <div style={{ marginTop: 4, color: color.textMuted, fontSize: T.caption.size }}>
          Latest: {item.latestVersion}
        </div>
      ) : null}
    </div>
  );
}

function RuntimeUsagePanel({ runs }: { runs: OrchestrationRuntimeExecutionRun[] }) {
  const [range, setRange] = useState<UsageRange>(30);
  const scopedRuns = filterRunsByRange(runs, range);
  const inputTokens = scopedRuns.reduce((total, run) => total + (run.inputTokens ?? 0), 0);
  const outputTokens = scopedRuns.reduce((total, run) => total + (run.outputTokens ?? 0), 0);
  const cacheReadTokens = scopedRuns.reduce((total, run) => total + (run.cacheReadTokens ?? 0), 0);
  const cacheWriteTokens = scopedRuns.reduce((total, run) => total + (run.cacheWriteTokens ?? 0), 0);
  const estimatedCost = scopedRuns.reduce((total, run) => total + (run.totalCostUsd ?? 0), 0);
  const activityUsage = buildDailyUsage(filterRunsSince(runs, ACTIVITY_CALENDAR_START), daysSince(ACTIVITY_CALENDAR_START));
  const dailyUsage = buildDailyUsage(scopedRuns, range);
  const hourlyUsage = buildHourlyUsage(scopedRuns);
  const modelUsage = buildModelUsage(scopedRuns);
  const usageRows = buildUsageBreakdown(scopedRuns);
  const hasUsage = scopedRuns.length > 0;

  return (
    <section>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: space.md, marginBottom: space.md }}>
        <h3 style={sectionTitleStyle}>Token Usage</h3>
        <div style={tabGroupStyle} role="tablist" aria-label="Usage range">
          {[7, 30, 90].map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={range === value}
              onClick={() => setRange(value as UsageRange)}
              style={{
                height: 26,
                minWidth: 38,
                border: 0,
                borderRadius: radius.sm,
                background: range === value ? color.surfaceElevated : "transparent",
                color: range === value ? color.text : color.textMuted,
                padding: `0 ${space.sm}px`,
                fontSize: T.caption.size,
                fontWeight: 650,
                cursor: "pointer",
              }}
            >
              {value}d
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(120px, 1fr))", gap: space.sm }}>
        <UsageMetric label="Input" value={formatCompactNumber(inputTokens)} />
        <UsageMetric label="Output" value={formatCompactNumber(outputTokens)} />
        <UsageMetric label="Cache Read" value={formatCompactNumber(cacheReadTokens)} />
        <UsageMetric label="Cache Write" value={formatCompactNumber(cacheWriteTokens)} />
      </div>

      <div
        style={{
          marginTop: space.sm,
          borderRadius: radius.md,
          border: `0.5px solid ${color.border}`,
          background: color.surface,
          padding: `${space.sm}px ${space.md}px`,
          color: color.textSecondary,
          fontSize: T.bodySmall.size,
        }}
      >
        Estimated cost ({range}d): <strong style={{ color: color.text }}>{formatCurrency(estimatedCost)}</strong>
      </div>

      {hasUsage ? (
        <div style={{ display: "grid", gap: space.md, marginTop: space.md }}>
          <ActivityCalendar dailyUsage={activityUsage} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: space.md }}>
            <HourlyDistribution hourlyUsage={hourlyUsage} />
            <DailyUsageBars dailyUsage={dailyUsage} title="Daily Token Usage" />
          </div>
          <ModelUsageDonut rows={modelUsage} />
          <UsageBreakdownTable rows={usageRows} />
        </div>
      ) : (
        <div
          style={{
            marginTop: space.md,
            minHeight: 112,
            display: "grid",
            placeItems: "center",
            borderRadius: radius.md,
            border: `0.5px solid ${color.border}`,
            color: color.textMuted,
          }}
        >
          <div style={{ textAlign: "center" }}>
            <BarChart3 size={20} style={{ marginBottom: space.sm, opacity: 0.8 }} />
            <div style={{ fontSize: T.bodySmall.size }}>No usage data yet</div>
          </div>
        </div>
      )}
    </section>
  );
}

function UsageMetric({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        minHeight: 54,
        borderRadius: radius.md,
        border: `0.5px solid ${color.border}`,
        background: color.surface,
        padding: `${space.sm}px ${space.md}px`,
        minWidth: 0,
      }}
    >
      <div style={{ fontSize: T.caption.size, color: color.textMuted, marginBottom: 5 }}>{label}</div>
      <div style={{ fontSize: 15, color: color.text, fontWeight: 650, fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}

type DailyUsage = Array<{ date: Date; key: string; tokens: number; runs: number }>;
type ModelUsage = Array<{ model: string; tokens: number; input: number; output: number; cacheRead: number; cacheWrite: number; cost: number }>;
type UsageBreakdownRow = {
  key: string;
  date: string;
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  tokens: number;
  cost: number;
};

const MODEL_CHART_COLORS = [
  color.accent,
  color.positive,
  color.warning,
  color.negative,
  color.info,
  color.textSecondary,
];

function buildDailyUsage(runs: OrchestrationRuntimeExecutionRun[], days: number): DailyUsage {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - days + 1);
  const byDay = new Map<string, { tokens: number; runs: number }>();
  for (const run of runs) {
    const timestamp = runTimestamp(run);
    if (!timestamp) continue;
    const key = dateKey(timestamp);
    const current = byDay.get(key) ?? { tokens: 0, runs: 0 };
    current.tokens += runTokenTotal(run);
    current.runs += 1;
    byDay.set(key, current);
  }
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    const key = dateKey(date);
    const current = byDay.get(key) ?? { tokens: 0, runs: 0 };
    return { date, key, tokens: current.tokens, runs: current.runs };
  });
}

function buildHourlyUsage(runs: OrchestrationRuntimeExecutionRun[]): number[] {
  const hours = Array.from({ length: 24 }, () => 0);
  for (const run of runs) {
    const timestamp = runTimestamp(run);
    if (!timestamp) continue;
    hours[timestamp.getHours()] += runTokenTotal(run);
  }
  return hours;
}

function buildModelUsage(runs: OrchestrationRuntimeExecutionRun[]): ModelUsage {
  const byModel = new Map<string, ModelUsage[number]>();
  for (const run of runs) {
    const model = run.model || "Unknown model";
    const current = byModel.get(model) ?? { model, tokens: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
    current.tokens += runTokenTotal(run);
    current.input += run.inputTokens ?? 0;
    current.output += run.outputTokens ?? 0;
    current.cacheRead += run.cacheReadTokens ?? 0;
    current.cacheWrite += run.cacheWriteTokens ?? 0;
    current.cost += run.totalCostUsd ?? 0;
    byModel.set(model, current);
  }
  return Array.from(byModel.values()).sort((a, b) => b.tokens - a.tokens);
}

function buildUsageBreakdown(runs: OrchestrationRuntimeExecutionRun[]): UsageBreakdownRow[] {
  const byKey = new Map<string, UsageBreakdownRow>();
  for (const run of runs) {
    const timestamp = runTimestamp(run);
    if (!timestamp) continue;
    const date = dateKey(timestamp);
    const model = run.model || "Unknown model";
    const key = `${date}:${model}`;
    const current = byKey.get(key) ?? {
      key,
      date,
      model,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      tokens: 0,
      cost: 0,
    };
    current.input += run.inputTokens ?? 0;
    current.output += run.outputTokens ?? 0;
    current.cacheRead += run.cacheReadTokens ?? 0;
    current.cacheWrite += run.cacheWriteTokens ?? 0;
    current.tokens += runTokenTotal(run);
    current.cost += run.totalCostUsd ?? 0;
    byKey.set(key, current);
  }
  return Array.from(byKey.values()).sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    return b.tokens - a.tokens;
  });
}

function chartPanelStyle(): CSSProperties {
  return {
    minHeight: 150,
    borderRadius: radius.md,
    border: `0.5px solid ${color.border}`,
    background: color.surface,
    padding: space.lg,
    minWidth: 0,
  };
}

type ActivityCalendarCell = { key: string; date: Date; tokens: number; inRange: boolean };

function buildCalendarCells(dailyUsage: DailyUsage): ActivityCalendarCell[] {
  if (dailyUsage.length === 0) return [];
  const byDay = new Map(dailyUsage.map((day) => [day.key, day]));
  const start = new Date(dailyUsage[0].date);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  const end = new Date(dailyUsage[dailyUsage.length - 1].date);
  end.setUTCHours(0, 0, 0, 0);
  end.setUTCDate(end.getUTCDate() + (6 - end.getUTCDay()));

  const cells: ActivityCalendarCell[] = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = new Date(cursor);
    const key = dateKey(date);
    const day = byDay.get(key);
    cells.push({
      key,
      date,
      tokens: day?.tokens ?? 0,
      inRange: Boolean(day),
    });
  }
  return cells;
}

function buildCalendarMonthLabels(cells: ActivityCalendarCell[]): Array<{ key: string; label: string; week: number }> {
  const labels: Array<{ key: string; label: string; week: number }> = [];
  const seen = new Set<string>();
  cells.forEach((cell, index) => {
    if (!cell.inRange || cell.date.getUTCDate() > 7) return;
    const key = `${cell.date.getUTCFullYear()}-${cell.date.getUTCMonth()}`;
    if (seen.has(key)) return;
    seen.add(key);
    labels.push({
      key,
      label: cell.date.toLocaleString(undefined, { month: "short", timeZone: "UTC" }),
      week: Math.floor(index / 7),
    });
  });
  return labels;
}

function ActivityCalendar({ dailyUsage }: { dailyUsage: DailyUsage }) {
  const cells = buildCalendarCells(dailyUsage);
  const monthLabels = buildCalendarMonthLabels(cells);
  const maxTokens = Math.max(1, ...cells.map((day) => day.tokens));
  const weeks = Math.max(1, Math.ceil(cells.length / 7));
  return (
    <div style={{ ...chartPanelStyle(), minHeight: 188 }}>
      <h4 style={{ margin: 0, color: color.textMuted, fontSize: T.bodySmall.size, fontWeight: 650 }}>Activity</h4>
      <div style={{ marginTop: space.md, overflowX: "auto", paddingBottom: 2 }}>
        <div
          style={{
            display: "inline-grid",
            gridTemplateColumns: `32px repeat(${weeks}, 10px)`,
            gridTemplateRows: "16px repeat(7, 10px)",
            gap: 4,
            alignItems: "center",
            minWidth: 32 + weeks * 14,
          }}
        >
          {monthLabels.map((month) => (
            <span
              key={month.key}
              style={{
                gridColumn: month.week + 2,
                gridRow: 1,
                color: color.textMuted,
                fontSize: T.caption.size,
                lineHeight: "10px",
                whiteSpace: "nowrap",
              }}
            >
              {month.label}
            </span>
          ))}
          {["", "Mon", "", "Wed", "", "Fri", ""].map((label, index) => (
            <span
              key={`label-${index}`}
              style={{
                gridColumn: 1,
                gridRow: index + 2,
                color: color.textMuted,
                fontSize: 9,
                lineHeight: "10px",
                textAlign: "right",
                paddingRight: 4,
              }}
            >
              {label}
            </span>
          ))}
          <div
            style={{
              gridColumn: "2 / -1",
              gridRow: "2 / span 7",
              display: "grid",
              gridTemplateColumns: `repeat(${weeks}, 10px)`,
              gridTemplateRows: "repeat(7, 10px)",
              gridAutoFlow: "column",
              gap: 4,
            }}
          >
            {cells.map((day) => {
              const intensity = day.tokens <= 0 ? 0 : Math.max(0.18, day.tokens / maxTokens);
              return (
                <span
                  key={day.key}
                  title={`${day.key}: ${formatCompactNumber(day.tokens)} tokens`}
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 2,
                    background: intensity
                      ? tokenMix(color.accent, 24 + intensity * 68)
                      : day.inRange
                        ? tokenMix(color.textSecondary, 18)
                        : color.surfaceElevated,
                  }}
                />
              );
            })}
          </div>
        </div>
      </div>
      <div style={{ marginTop: space.md, display: "flex", justifyContent: "flex-end", gap: 5, color: color.textMuted, fontSize: T.caption.size }}>
        <span>Less</span>
        {[0.18, 0.36, 0.54, 0.72, 0.9].map((alpha) => (
          <span key={alpha} aria-hidden="true" style={{ width: 9, height: 9, borderRadius: 2, background: tokenMix(color.accent, alpha * 100) }} />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}

function HourlyDistribution({ hourlyUsage }: { hourlyUsage: number[] }) {
  const maxTokens = Math.max(1, ...hourlyUsage);
  return (
    <div style={chartPanelStyle()}>
      <h4 style={{ margin: 0, color: color.textMuted, fontSize: T.bodySmall.size, fontWeight: 650 }}>Hourly Distribution</h4>
      <div style={{ height: 86, display: "flex", alignItems: "flex-end", gap: 4, marginTop: space.lg, borderBottom: `0.5px solid ${color.border}` }}>
        {hourlyUsage.map((tokens, hour) => (
          <span
            key={hour}
            title={`${hour}:00 ${formatCompactNumber(tokens)} tokens`}
            style={{
              flex: "1 1 0",
              minWidth: 3,
              height: `${Math.max(tokens > 0 ? 5 : 0, (tokens / maxTokens) * 78)}px`,
              borderRadius: "3px 3px 0 0",
              background: tokens > 0 ? color.accent : "transparent",
            }}
          />
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, color: color.textMuted, fontSize: T.caption.size }}>
        <span>00:00</span>
        <span>06:00</span>
        <span>12:00</span>
        <span>18:00</span>
      </div>
    </div>
  );
}

function DailyUsageBars({ dailyUsage, title }: { dailyUsage: DailyUsage; title: string }) {
  const visible = dailyUsage.slice(-7);
  const maxTokens = Math.max(1, ...visible.map((day) => day.tokens));
  return (
    <div style={chartPanelStyle()}>
      <h4 style={{ margin: 0, color: color.textMuted, fontSize: T.bodySmall.size, fontWeight: 650 }}>{title}</h4>
      <div style={{ height: 86, display: "flex", alignItems: "flex-end", gap: space.sm, marginTop: space.lg, borderBottom: `0.5px solid ${color.border}` }}>
        {visible.map((day) => (
          <span
            key={day.key}
            title={`${day.key}: ${formatCompactNumber(day.tokens)} tokens`}
            style={{
              flex: "1 1 0",
              height: `${Math.max(day.tokens > 0 ? 5 : 0, (day.tokens / maxTokens) * 78)}px`,
              borderRadius: "4px 4px 0 0",
              background: day.tokens > 0 ? color.accent : color.surfaceElevated,
            }}
          />
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, color: color.textMuted, fontSize: T.caption.size }}>
        {visible.map((day) => (
          <span key={day.key}>{day.date.getUTCMonth() + 1}/{day.date.getUTCDate()}</span>
        ))}
      </div>
    </div>
  );
}

function modelColor(index: number): string {
  return MODEL_CHART_COLORS[index % MODEL_CHART_COLORS.length];
}

function modelUsageGradient(rows: ModelUsage): string {
  const totalTokens = rows.reduce((total, row) => total + row.tokens, 0);
  if (totalTokens <= 0) return `conic-gradient(${color.surfaceElevated} 0deg 360deg)`;
  let cursor = 0;
  const segments = rows.map((row, index) => {
    const start = cursor;
    cursor += (row.tokens / totalTokens) * 360;
    return `${modelColor(index)} ${start.toFixed(2)}deg ${cursor.toFixed(2)}deg`;
  });
  return `conic-gradient(${segments.join(", ")})`;
}

function ModelUsageDonut({ rows }: { rows: ModelUsage }) {
  const totalTokens = rows.reduce((total, row) => total + row.tokens, 0);
  return (
    <div style={{ ...chartPanelStyle(), minHeight: 330 }}>
      <h4 style={{ margin: 0, color: color.textMuted, fontSize: T.bodySmall.size, fontWeight: 650 }}>Token Usage by Model</h4>
      <div style={{ display: "grid", placeItems: "center", minHeight: 210 }}>
        <div
          aria-label={`${formatCompactNumber(totalTokens)} tokens by model`}
          style={{
            width: 170,
            aspectRatio: "1 / 1",
            borderRadius: "50%",
            background: modelUsageGradient(rows),
            display: "grid",
            placeItems: "center",
          }}
        >
          <div
            style={{
              width: 88,
              aspectRatio: "1 / 1",
              borderRadius: "50%",
              background: color.surface,
              display: "grid",
              placeItems: "center",
              textAlign: "center",
              boxShadow: `0 0 0 1px ${color.border}`,
            }}
          >
            <span>
              <span style={{ display: "block", color: color.text, fontSize: 22, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                {formatCompactNumber(totalTokens)}
              </span>
              <span style={{ display: "block", color: color.textMuted, fontSize: T.bodySmall.size }}>tokens</span>
            </span>
          </div>
        </div>
      </div>
      <div style={{ display: "grid", gap: space.sm, marginTop: space.sm }}>
        {rows.slice(0, 6).map((row, index) => (
          <div
            key={row.model}
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) auto auto",
              gap: space.lg,
              alignItems: "center",
              color: color.textSecondary,
              fontSize: T.body.size,
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: space.sm, minWidth: 0 }}>
              <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: "50%", background: modelColor(index), flex: "0 0 auto" }} />
              <span style={{ color: color.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.model}</span>
            </span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatCompactNumber(row.tokens)}</span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatCurrency(row.cost)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function UsageBreakdownTable({ rows }: { rows: UsageBreakdownRow[] }) {
  return (
    <div style={{ borderRadius: radius.md, border: `0.5px solid ${color.border}`, overflow: "hidden", background: color.surface }}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", minWidth: 680, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: `0.5px solid ${color.border}` }}>
              {["Date", "Model", "Input", "Output", "Cache R", "Cache W"].map((header, index) => (
                <th
                  key={header}
                  style={{
                    padding: `${space.md}px ${space.lg}px`,
                    textAlign: index < 2 ? "left" : "right",
                    color: color.textMuted,
                    fontSize: T.bodySmall.size,
                    fontWeight: 650,
                  }}
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 12).map((row) => (
              <tr key={row.key} style={{ borderBottom: `0.5px solid ${color.border}` }}>
                <td style={usageCellStyle(false)}>{row.date}</td>
                <td style={{ ...usageCellStyle(false), color: color.text, fontFamily: font.mono }}>{row.model}</td>
                <td style={usageCellStyle(true)}>{formatCompactNumber(row.input)}</td>
                <td style={usageCellStyle(true)}>{formatCompactNumber(row.output)}</td>
                <td style={usageCellStyle(true)}>{formatCompactNumber(row.cacheRead)}</td>
                <td style={usageCellStyle(true)}>{formatCompactNumber(row.cacheWrite)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function usageCellStyle(numeric: boolean): CSSProperties {
  return {
    padding: `${space.md}px ${space.lg}px`,
    textAlign: numeric ? "right" : "left",
    color: color.textSecondary,
    fontSize: T.body.size,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  };
}

function DetailField({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: T.caption.size, color: color.textMuted, marginBottom: 4 }}>{label}</div>
      <div style={mono ? monoStyle : { fontSize: T.body.size, color: color.text, overflowWrap: "anywhere", lineHeight: 1.45 }}>
        {value}
      </div>
    </div>
  );
}

function ProviderMark({ provider, large = false }: { provider: string; large?: boolean }) {
  const frameSize = large ? 36 : 30;
  const logoSize = large ? 22 : 19;
  return (
    <span
      aria-hidden="true"
      style={{
        width: frameSize,
        height: frameSize,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        color: provider === "codex" ? color.text : color.textSecondary,
        flex: "0 0 auto",
      }}
    >
      <ProviderLogo provider={provider} size={logoSize} />
    </span>
  );
}
