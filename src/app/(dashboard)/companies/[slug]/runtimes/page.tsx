"use client";

import { useParams, usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  ArrowRight,
  CheckCircle2,
  KeyRound,
  Plus,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import {
  activateCompanyExecutionHive,
  configureCompanyExecutionHive,
  listCompanies,
  listCompanyExecutionHives,
  listCompanyModelSources,
  listCompanyRuntimes,
  runCompanyModelSourceProbe,
  runCompanyExecutionHiveProbe,
  saveCompanyModelSourceCredential,
} from "@/lib/orchestration/client";
import {
  SEEDED_EXECUTION_HIVES,
  SEEDED_MODEL_SOURCES,
  SEEDED_RUNTIME_INVENTORY,
  formatLaneFingerprint,
  formatOrchestrationModeLabel,
  type ExecutionHive,
  type ExecutionHiveMatrixConfig,
  type ExecutionHiveProbeKind,
  type ExecutionHiveRuntimeProvider,
  type ModelSourceInventoryItem,
  type ModelSourceProbeResult,
  type RoutingLane,
  type RuntimeInventoryItem,
  type VerificationProbeResult,
  type VerificationStatus,
} from "@/lib/orchestration/execution-hives";
import type {
  DetectedOrchestrationRuntime,
  OrchestrationCompany,
  OrchestrationRuntime,
  OrchestrationRuntimeExecutionRun,
  OrchestrationRuntimeHealthStatus,
  TaskExecutionEngine,
} from "@/lib/orchestration/types";
import { buildCanonicalCompanyPath } from "@/lib/orchestration/route-paths";
import { color, font, pageStyle, radius, space, type as T } from "@/lib/ui/tokens";
import { ActionButton, Badge, Card, PageHeader, Section } from "@/lib/ui/primitives";
import { RuntimeInventoryPanel } from "../runtime-inventory/runtime-inventory-panel";

type WizardStep = "scan" | "preferences" | "generate" | "verify" | "activate";
type WizardPreferenceId = "balanced" | "quality" | "cost" | "speed" | "privacy" | "supervised" | "approval" | "broker";
type ModelSourceProbeMap = Partial<Record<ModelSourceInventoryItem["id"], ModelSourceProbeResult>>;
type ProbeStatus = VerificationProbeResult["status"];

const wizardSteps: Array<{ id: WizardStep; label: string; description: string }> = [
  { id: "scan", label: "Scan", description: "Detect runtimes and model sources." },
  { id: "preferences", label: "Preferences", description: "Choose cost, quality, speed, privacy, and autonomy tradeoffs." },
  { id: "generate", label: "Generate", description: "Create recommended Execution Hives." },
  { id: "verify", label: "Verify", description: "Run lane checks before activation." },
  { id: "activate", label: "Activate", description: "Save the selected Hive for this company." },
];

const wizardPreferenceOptions: Array<{ id: WizardPreferenceId; label: string; hiveId?: string }> = [
  { id: "balanced", label: "Balanced", hiveId: "balanced-builder" },
  { id: "quality", label: "Max quality", hiveId: "max-quality" },
  { id: "cost", label: "Cost saver", hiveId: "cost-saver" },
  { id: "speed", label: "Speed first", hiveId: "balanced-builder" },
  { id: "privacy", label: "Local/private", hiveId: "local-private" },
  { id: "supervised", label: "Supervised autonomy" },
  { id: "approval", label: "Approval above high cost", hiveId: "max-quality" },
  { id: "broker", label: "Allow OpenRouter broker routes" },
];

const runtimeProviderOptions: Array<{ provider: ExecutionHiveRuntimeProvider; label: string; runtimeId: string }> = [
  { provider: "codex", label: "Codex", runtimeId: "codex" },
  { provider: "anthropic", label: "Claude Code", runtimeId: "claude-code" },
  { provider: "gemini", label: "Gemini CLI", runtimeId: "gemini-cli" },
  { provider: "hermes", label: "Hermes", runtimeId: "hermes" },
  { provider: "openclaw", label: "OpenClaw", runtimeId: "openclaw" },
];

function runtimeProviderOption(provider: ExecutionHiveRuntimeProvider) {
  return runtimeProviderOptions.find((option) => option.provider === provider) ?? runtimeProviderOptions[0];
}

function providerFromRouteTarget(target: RoutingLane["primary"]): ExecutionHiveRuntimeProvider {
  const normalized = `${target.runtimeId ?? ""} ${target.runtimeLabel ?? ""}`.toLowerCase();
  if (normalized.includes("claude") || normalized.includes("anthropic")) return "anthropic";
  if (normalized.includes("gemini") || normalized.includes("google")) return "gemini";
  if (normalized.includes("hermes")) return "hermes";
  if (normalized.includes("openclaw")) return "openclaw";
  return "codex";
}

function modelRoutingFromRouteTarget(target: RoutingLane["primary"]): { value: ExecutionHiveMatrixConfig["modelRouting"]; label: string } {
  if (target.mode === "runtime_managed") return { value: "runtime-managed", label: "Runtime managed" };
  if (target.mode === "hive_managed") return { value: "hive-managed", label: "Hive managed" };
  if (target.mode === "broker" || target.modelSourceId === "openrouter") return { value: "openrouter", label: "OpenRouter" };
  if (target.mode === "direct_source") {
    if (target.modelSourceId === "anthropic") return { value: "anthropic", label: "Anthropic Direct" };
    if (target.modelSourceId === "google") return { value: "google", label: "Google Direct" };
    return { value: "openai", label: "OpenAI Direct" };
  }
  return { value: "runtime-managed", label: "Runtime managed" };
}

function statusLabel(status: VerificationStatus): string {
  if (status === "verified") return "verified";
  if (status === "warning") return "warning";
  if (status === "failed") return "failed";
  return "untested";
}

function chipStyle(active = false): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    minHeight: 28,
    borderRadius: radius.full,
    border: `0.5px solid ${active ? color.borderStrong : color.border}`,
    background: active ? color.accentSoft : color.surface,
    color: active ? color.accent : color.textSecondary,
    padding: `0 ${space.md}px`,
    fontSize: T.caption.size,
    fontWeight: 650,
    cursor: "pointer",
  };
}

function Dot({ tone }: { tone: "positive" | "warning" | "negative" | "muted" | "accent" }) {
  const dotColor = tone === "positive"
    ? color.positive
    : tone === "warning"
      ? color.warning
      : tone === "negative"
        ? color.negative
        : tone === "accent"
          ? color.accent
          : color.textMuted;
  return <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 99, background: dotColor, boxShadow: tone === "muted" ? undefined : `0 0 12px ${dotColor}` }} />;
}

function probeStatusFromModelSource(source?: ModelSourceInventoryItem, probe?: ModelSourceProbeResult): ProbeStatus {
  if (probe?.status === "pass") return "pass";
  if (probe?.status === "fail") return "fail";
  if (probe?.status === "warn") return "warn";
  if (!source) return "idle";
  if (source.status === "connected" || source.status === "available") return "pass";
  if (source.status === "needs_key" || source.status === "warning") return "warn";
  return "idle";
}

function newerProbe(
  current: ModelSourceProbeResult | undefined,
  next: ModelSourceProbeResult,
): ModelSourceProbeResult {
  if (!current) return next;
  return Date.parse(next.checkedAt) >= Date.parse(current.checkedAt) ? next : current;
}

function modelSourceProbesFromHives(hives: ExecutionHive[]): ModelSourceProbeMap {
  const probes: ModelSourceProbeMap = {};
  for (const hive of hives) {
    const hiveProbes = hive.verification.modelSourceProbes ?? {};
    for (const probe of Object.values(hiveProbes)) {
      probes[probe.sourceId] = newerProbe(probes[probe.sourceId], probe);
    }
  }
  return probes;
}

function mergeModelSourceProbeMaps(current: ModelSourceProbeMap, next: ModelSourceProbeMap): ModelSourceProbeMap {
  const merged = { ...current };
  for (const probe of Object.values(next)) {
    if (!probe) continue;
    merged[probe.sourceId] = newerProbe(merged[probe.sourceId], probe);
  }
  return merged;
}

type RuntimeInventoryGroup = RuntimeInventoryItem & {
  attachedCount: number;
  detectedCount: number;
  versions: Set<string>;
  details: Set<string>;
};

const runtimeStatusRank: Record<RuntimeInventoryItem["status"], number> = {
  disabled: 0,
  missing_cli: 1,
  needs_login: 2,
  warning: 3,
  ready: 4,
};

function statusWithBestAvailability(
  current: RuntimeInventoryItem["status"],
  next: RuntimeInventoryItem["status"],
): RuntimeInventoryItem["status"] {
  return runtimeStatusRank[next] > runtimeStatusRank[current] ? next : current;
}

function runtimeStatusFromHealth(
  status: OrchestrationRuntime["status"] | DetectedOrchestrationRuntime["status"],
  healthStatus?: OrchestrationRuntimeHealthStatus,
): RuntimeInventoryItem["status"] {
  if (healthStatus === "ready") return "ready";
  if (healthStatus === "needs_login") return "needs_login";
  if (healthStatus === "missing_cli") return "missing_cli";
  if (healthStatus === "failed_probe" || healthStatus === "unknown") return "warning";
  if (healthStatus === "disabled") return "disabled";
  if (status === "online") return "ready";
  if (status === "disabled") return "disabled";
  if (status === "error") return "warning";
  return "warning";
}

function runtimeInventoryId(provider: string, label?: string | null): string {
  const normalized = `${provider} ${label ?? ""}`.toLowerCase();
  if (normalized.includes("claude") || normalized.includes("anthropic")) return "claude-code";
  if (normalized.includes("gemini") || normalized.includes("google")) return "gemini-cli";
  if (normalized.includes("hermes")) return "hermes";
  if (normalized.includes("openclaw")) return "openclaw";
  if (normalized.includes("symphony")) return "symphony";
  if (normalized.includes("manual")) return "manual";
  if (normalized.includes("codex") || normalized.includes("openai")) return "codex";
  return normalized.trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "custom-runtime";
}

function runtimeInventoryLabel(id: string, fallback?: string | null): string {
  const seeded = SEEDED_RUNTIME_INVENTORY.find((item) => item.id === id);
  if (seeded) return seeded.label;
  if (id === "symphony") return "Symphony runner";
  return fallback?.trim() || id;
}

function createRuntimeGroup(item: RuntimeInventoryItem): RuntimeInventoryGroup {
  return {
    ...item,
    capabilities: [...item.capabilities],
    attachedCount: 0,
    detectedCount: 0,
    versions: new Set(),
    details: new Set(),
  };
}

function runtimeGroupSummary(group: RuntimeInventoryGroup): RuntimeInventoryItem {
  const parts: string[] = [];
  if (group.attachedCount > 0) parts.push(`${group.attachedCount} attached runtime${group.attachedCount === 1 ? "" : "s"}`);
  if (group.detectedCount > 0) parts.push(`${group.detectedCount} local detection${group.detectedCount === 1 ? "" : "s"}`);
  if (group.versions.size > 0) parts.push(`CLI ${Array.from(group.versions).slice(0, 2).join(", ")}`);
  const detail = Array.from(group.details).slice(0, 1)[0];
  const note = parts.length > 0
    ? `${parts.join(" · ")}${detail ? ` · ${detail}` : ""}`
    : group.note;
  return {
    id: group.id,
    label: group.label,
    kind: group.kind,
    status: group.status,
    capabilities: group.capabilities,
    note,
  };
}

function buildLiveRuntimeItems(
  runtimes: OrchestrationRuntime[],
  detected: DetectedOrchestrationRuntime[],
): RuntimeInventoryItem[] {
  const groups = new Map<string, RuntimeInventoryGroup>();
  for (const seed of SEEDED_RUNTIME_INVENTORY) groups.set(seed.id, createRuntimeGroup(seed));

  const ensure = (id: string, label?: string | null): RuntimeInventoryGroup => {
    const existing = groups.get(id);
    if (existing) return existing;
    const group = createRuntimeGroup({
      id,
      label: runtimeInventoryLabel(id, label),
      kind: id === "manual" ? "manual" : id === "symphony" ? "control-plane" : "runtime",
      status: "warning",
      capabilities: ["live inventory"],
      note: "Seen from live runtime inventory.",
    });
    groups.set(id, group);
    return group;
  };

  for (const runtime of runtimes) {
    const id = runtimeInventoryId(runtime.provider, runtime.displayName);
    const group = ensure(id, runtime.displayName);
    group.attachedCount += 1;
    group.status = statusWithBestAvailability(group.status, runtimeStatusFromHealth(runtime.status, runtime.health?.status));
    if (runtime.version) group.versions.add(runtime.version);
    if (runtime.health?.version) group.versions.add(runtime.health.version);
    if (runtime.scope) group.details.add(`${runtime.scope} scoped`);
  }

  for (const runtime of detected) {
    const id = runtimeInventoryId(runtime.provider, runtime.displayName);
    const group = ensure(id, runtime.displayName);
    group.detectedCount += 1;
    group.status = statusWithBestAvailability(group.status, runtimeStatusFromHealth(runtime.status));
    if (runtime.version) group.versions.add(runtime.version);
    if (runtime.commandPath) group.details.add(`detected at ${runtime.commandPath}`);
  }

  const preferredOrder = ["claude-code", "codex", "gemini-cli", "hermes", "openclaw", "symphony", "manual"];
  return Array.from(groups.values())
    .sort((left, right) => {
      const leftIndex = preferredOrder.indexOf(left.id);
      const rightIndex = preferredOrder.indexOf(right.id);
      if (leftIndex === -1 && rightIndex === -1) return left.label.localeCompare(right.label);
      if (leftIndex === -1) return 1;
      if (rightIndex === -1) return -1;
      return leftIndex - rightIndex;
    })
    .map(runtimeGroupSummary);
}

function modelSourceIdFromText(...parts: Array<string | null | undefined>): ModelSourceInventoryItem["id"] | null {
  const text = parts.filter(Boolean).join(" ").toLowerCase();
  if (text.includes("openrouter")) return "openrouter";
  if (text.includes("anthropic") || text.includes("claude")) return "anthropic";
  if (text.includes("google") || text.includes("gemini")) return "google";
  if (text.includes("ollama") || text.includes("lm studio")) return "ollama";
  if (text.includes("vllm")) return "vllm";
  if (text.includes("openai") || text.includes("codex") || text.includes("gpt-")) return "openai";
  return null;
}

function buildLiveModelSources(
  runtimes: OrchestrationRuntime[],
  detected: DetectedOrchestrationRuntime[],
  recentRuns: OrchestrationRuntimeExecutionRun[],
  credentialSources: ModelSourceInventoryItem[] = SEEDED_MODEL_SOURCES,
): ModelSourceInventoryItem[] {
  const seen = new Map<string, Set<string>>();
  const mark = (id: string | null, label: string) => {
    if (!id) return;
    const labels = seen.get(id) ?? new Set<string>();
    labels.add(label);
    seen.set(id, labels);
  };

  for (const runtime of runtimes) {
    mark(modelSourceIdFromText(runtime.provider, runtime.displayName, runtime.command), runtime.displayName);
  }
  for (const runtime of detected) {
    mark(modelSourceIdFromText(runtime.provider, runtime.displayName, runtime.command, runtime.commandPath), runtime.displayName);
  }
  for (const run of recentRuns) {
    mark(
      modelSourceIdFromText(run.runnerProvider, run.provider, run.runnerModel, run.model),
      run.runnerProvider ?? run.provider ?? run.runnerModel ?? run.model ?? "recent run",
    );
  }

  return credentialSources.map((source) => {
    const labels = seen.get(source.id);
    if (!labels || labels.size === 0) return source;
    const examples = Array.from(labels).slice(0, 2).join(", ");
    return {
      ...source,
      note: `${source.note} Seen in runtime inventory${examples ? `: ${examples}` : ""}.`,
    };
  });
}

function HiveCard({ hive, selected, onSelect }: { hive: ExecutionHive; selected: boolean; onSelect: () => void }) {
  const verificationTone = hive.verification.fail > 0 ? "negative" : hive.verification.warn > 0 ? "warning" : "positive";
  return (
    <Card
      hoverable
      onClick={onSelect}
      style={{
        minHeight: 192,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        border: `0.5px solid ${selected ? color.accent : color.border}`,
        background: selected ? `linear-gradient(180deg, ${color.accentSoft}, ${color.surface})` : color.surface,
      }}
    >
      <div>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: space.md }}>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: 0, color: color.text, fontSize: 16, fontWeight: 750, letterSpacing: 0 }}>{hive.name}</h3>
            <div style={{ marginTop: 5, color: color.textMuted, fontSize: T.caption.size, fontFamily: font.mono }}>
              {formatOrchestrationModeLabel(hive.orchestrationMode)} · {hive.optimizeFor}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: space.xs, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {hive.isActive ? <Badge label="Active" tone="positive" /> : null}
            {hive.recommended ? <Badge label="Recommended" tone="accent" /> : null}
          </div>
        </div>
        <p style={{ margin: `${space.md}px 0 0`, color: color.textSecondary, fontSize: T.bodySmall.size, lineHeight: 1.45 }}>
          {hive.description}
        </p>
      </div>
      <div style={{ marginTop: space.lg, display: "grid", gridTemplateColumns: "1fr", gap: space.sm }}>
        <Metric label="Verification" value={`${hive.verification.pass}/${hive.verification.total}`} caption="checks passed" tone={verificationTone} />
      </div>
    </Card>
  );
}

function Metric({ label, value, caption, tone }: { label: string; value: string; caption: string; tone: "positive" | "warning" | "negative" | "muted" }) {
  const valueColor = tone === "positive" ? color.positive : tone === "warning" ? color.warning : tone === "negative" ? color.negative : color.text;
  return (
    <div style={{ border: `0.5px solid ${color.border}`, borderRadius: radius.md, background: "rgba(255,255,255,0.025)", padding: space.md }}>
      <div style={{ color: color.textMuted, fontSize: T.caption.size, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div style={{ marginTop: 5, color: valueColor, fontSize: 20, fontWeight: 750, letterSpacing: 0 }}>{value}</div>
      <div style={{ color: color.textMuted, fontSize: T.caption.size }}>{caption}</div>
    </div>
  );
}

function SelectedHiveSummary({
  hive,
  activating,
  changingMode,
  onActivate,
  onOrchestrationModeChange,
}: {
  hive: ExecutionHive;
  activating: boolean;
  changingMode: boolean;
  onActivate: () => void;
  onOrchestrationModeChange: (mode: TaskExecutionEngine) => void;
}) {
  const policy = hive.autonomy === "autonomous" ? "Auto" : hive.autonomy === "supervised" ? "Supervised" : "Review";
  return (
    <div
      style={{
        margin: `${space.lg}px 0`,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: space.md,
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: space.sm, flexWrap: "wrap", minWidth: 0 }}>
        <span style={{ color: color.textMuted, fontSize: T.caption.size, fontFamily: font.mono, textTransform: "uppercase", letterSpacing: T.sectionLabel.letterSpacing }}>
          Previewing
        </span>
        <strong style={{ color: color.text, fontSize: T.bodySmall.size, fontWeight: 750 }}>{hive.name}</strong>
        {hive.isActive ? <ActiveStatusChip /> : null}
        <Badge label={`${hive.verification.warn} warnings`} tone={hive.verification.warn > 0 ? "warning" : "default"} />
        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, color: color.textMuted, fontSize: T.caption.size }}>
          <span style={{ fontFamily: font.mono, textTransform: "uppercase", letterSpacing: T.sectionLabel.letterSpacing }}>Mode</span>
          <select
            value={hive.orchestrationMode}
            onChange={(event) => onOrchestrationModeChange(event.target.value as TaskExecutionEngine)}
            disabled={changingMode}
            style={{
              minHeight: 28,
              borderRadius: radius.full,
              border: `0.5px solid ${color.border}`,
              background: color.surface,
              color: color.textSecondary,
              padding: `0 ${space.sm}px`,
              fontSize: T.caption.size,
              fontWeight: 650,
              outline: "none",
            }}
          >
            <option value="hiverunner">HiveRunner Native</option>
            <option value="symphony">Symphony</option>
            <option value="manual">Manual</option>
          </select>
        </label>
        <Badge label={`Autonomy: ${policy}`} tone="default" />
        <Badge label={`Optimize: ${hive.optimizeFor}`} tone="default" />
        <Badge label={hive.verification.lastVerifiedLabel ?? "Not checked"} tone="default" />
      </div>
      {!hive.isActive ? (
        <ActionButton
          label={activating ? "Activating..." : "Activate Hive"}
          icon={<ShieldCheck size={14} />}
          onClick={onActivate}
          disabled={activating}
          size="sm"
        />
      ) : null}
    </div>
  );
}

function ActiveStatusChip() {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        borderRadius: radius.full,
        background: color.positiveSoft,
        color: color.positive,
        padding: `3px ${space.sm}px`,
        fontSize: T.caption.size,
        fontWeight: 650,
        lineHeight: 1.2,
        whiteSpace: "nowrap",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 6,
          height: 6,
          borderRadius: radius.full,
          background: color.positive,
        }}
      />
      Active
    </span>
  );
}

function ActiveHiveLanes({
  companySlug,
  hive,
  onHiveUpdated,
}: {
  companySlug: string;
  hive: ExecutionHive;
  onHiveUpdated: (hive: ExecutionHive, notice: string) => void;
}) {
  return (
    <Section title="Lanes" trailing={<span>{hive.lanes.length} lanes in this hive</span>}>
      <p style={{ margin: `0 0 ${space.md}px`, color: color.textMuted, fontSize: T.bodySmall.size, lineHeight: 1.45 }}>
        Switch profiles above to change lane defaults. Per-lane customization is coming to an advanced settings page.
      </p>
      <div style={{ display: "grid", gap: space.sm }}>
        {hive.lanes.map((lane) => (
          <InlineLaneRow
            key={lane.id}
            companySlug={companySlug}
            hive={hive}
            lane={lane}
            onHiveUpdated={onHiveUpdated}
          />
        ))}
      </div>
    </Section>
  );
}

function InlineLaneRow({
  companySlug,
  hive,
  lane,
  onHiveUpdated,
}: {
  companySlug: string;
  hive: ExecutionHive;
  lane: RoutingLane;
  onHiveUpdated: (hive: ExecutionHive, notice: string) => void;
}) {
  const tone = lane.verificationStatus === "verified" ? "positive" : lane.verificationStatus === "warning" ? "warning" : lane.verificationStatus === "failed" ? "negative" : "muted";
  const [runningProbeKind, setRunningProbeKind] = useState<ExecutionHiveProbeKind | null>(null);
  const [probeResult, setProbeResult] = useState<VerificationProbeResult | null>(null);
  const visibleProbeResult = probeResult?.laneId === lane.id ? probeResult : null;
  const currentStatus = visibleProbeResult?.status
    ?? (lane.verificationStatus === "verified" ? "pass" : lane.verificationStatus === "failed" ? "fail" : lane.verificationStatus === "warning" ? "warn" : "idle");
  const fingerprint = formatLaneFingerprint(lane);

  async function runProbe(kind: ExecutionHiveProbeKind) {
    if (runningProbeKind) return;
    setRunningProbeKind(kind);
    try {
      const result = await runCompanyExecutionHiveProbe(companySlug, hive.id, {
        laneId: lane.id,
        kind,
      });
      if (!result) {
        setProbeResult({
          id: `${lane.id}-${kind}-failed`,
          label: kind === "conformance" ? "Conformance check" : "Lane check",
          laneId: lane.id,
          status: "fail",
          verifies: ["probe API"],
          note: "The live probe could not complete.",
        });
        return;
      }
      setProbeResult(result.probe);
      onHiveUpdated(result.hive, result.probe.note ?? `${result.probe.label} finished.`);
    } finally {
      setRunningProbeKind(null);
    }
  }

  return (
    <div style={{ border: `0.5px solid ${color.border}`, borderRadius: radius.lg, background: "rgba(255,255,255,0.025)", overflow: "hidden" }}>
      <div
        style={{
          width: "100%",
          display: "grid",
          gridTemplateColumns: "minmax(160px, 0.28fr) minmax(0, 1fr) minmax(330px, auto)",
          alignItems: "center",
          gap: space.md,
          padding: space.lg,
          background: "transparent",
          color: color.text,
          textAlign: "left",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: space.sm }}>
            <Dot tone={tone} />
            <strong style={{ fontSize: T.cardTitle.size }}>{lane.label}</strong>
          </div>
          <div style={{ marginTop: 4, color: color.textMuted, fontSize: T.caption.size, fontFamily: font.mono }}>{statusLabel(lane.verificationStatus)}</div>
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: color.textSecondary, fontSize: T.bodySmall.size, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {lane.label} · {fingerprint.primary}
          </div>
          <div style={{ marginTop: 5, display: "flex", alignItems: "center", gap: space.xs, minWidth: 0 }}>
            <span style={{ minWidth: 0, color: color.textMuted, fontSize: T.caption.size, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              Falls back to: {fingerprint.fallbacks.join(" -> ") || "primary only"}
            </span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: space.xs }}>
          <ActionButton
            label={runningProbeKind === "lane" ? "Checking..." : "Run check"}
            size="sm"
            variant="ghost"
            onClick={() => runProbe("lane")}
            disabled={Boolean(runningProbeKind)}
          />
          <ActionButton
            label={runningProbeKind === "conformance" ? "Running..." : "Conformance"}
            size="sm"
            variant="ghost"
            onClick={() => runProbe("conformance")}
            disabled={Boolean(runningProbeKind)}
          />
        </div>
      </div>
      {visibleProbeResult ? (
        <div style={{ padding: `0 ${space.lg}px ${space.lg}px`, display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: space.sm, alignItems: "center" }}>
          <ProbeRow status={currentStatus} label={visibleProbeResult.label} detail={visibleProbeResult.note ?? lane.verificationNote} />
        </div>
      ) : null}
    </div>
  );
}

function DetailBlock({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: `${space.sm}px 0`, borderTop: `0.5px solid ${color.border}` }}>
      <div style={{ color: color.textMuted, fontSize: T.caption.size, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div style={{ marginTop: 4, color: color.textSecondary, fontSize: T.bodySmall.size, lineHeight: 1.4 }}>{value}</div>
    </div>
  );
}

function ProbeRow({ status, label, detail, action }: { status: "pass" | "warn" | "fail" | "idle"; label: string; detail: string; action?: ReactNode }) {
  const tone = status === "pass" ? "positive" : status === "warn" ? "warning" : status === "fail" ? "negative" : "muted";
  return (
    <div style={{ display: "grid", gridTemplateColumns: action ? "18px minmax(0, 1fr) auto" : "18px minmax(0, 1fr)", gap: space.sm, alignItems: "start", padding: space.md, border: `0.5px solid ${color.border}`, borderRadius: radius.md, background: "rgba(255,255,255,0.025)" }}>
      <div style={{ marginTop: 4 }}><Dot tone={tone} /></div>
      <div>
        <div style={{ color: color.text, fontSize: T.bodySmall.size, fontWeight: 650 }}>{label}</div>
        <div style={{ color: color.textMuted, fontSize: T.caption.size, marginTop: 3 }}>{detail}</div>
      </div>
      {action ? <div>{action}</div> : null}
    </div>
  );
}

function Wizard({
  step,
  setStep,
  onFinish,
  hives,
  selectedHiveId,
  setSelectedHiveId,
  runtimeItems,
  modelSources,
  loadingInventory,
  modelSourceProbes,
  onSelectModelSource,
}: {
  step: WizardStep;
  setStep: (step: WizardStep) => void;
  onFinish: () => void;
  hives: ExecutionHive[];
  selectedHiveId: string;
  setSelectedHiveId: (id: string) => void;
  runtimeItems: RuntimeInventoryItem[];
  modelSources: ModelSourceInventoryItem[];
  loadingInventory: boolean;
  modelSourceProbes: ModelSourceProbeMap;
  onSelectModelSource: (item: ModelSourceInventoryItem) => void;
}) {
  const [preferences, setPreferences] = useState<WizardPreferenceId[]>(["balanced", "supervised"]);
  const stepIndex = wizardSteps.findIndex((item) => item.id === step);
  const next = wizardSteps[Math.min(stepIndex + 1, wizardSteps.length - 1)].id;
  const previous = wizardSteps[Math.max(stepIndex - 1, 0)].id;
  const selectedHive = hives.find((hive) => hive.id === selectedHiveId) ?? hives[0] ?? SEEDED_EXECUTION_HIVES[0];
  const togglePreference = (id: WizardPreferenceId) => {
    setPreferences((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
    const option = wizardPreferenceOptions.find((item) => item.id === id);
    if (option?.hiveId && hives.some((hive) => hive.id === option.hiveId)) {
      setSelectedHiveId(option.hiveId);
    }
  };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "260px minmax(0, 1fr)", gap: space.xl }}>
      <Section title="Setup flow">
        <div style={{ display: "grid", gap: space.sm }}>
          {wizardSteps.map((item, index) => (
            <button key={item.id} type="button" onClick={() => setStep(item.id)} style={{ ...chipStyle(item.id === step), justifyContent: "flex-start", borderRadius: radius.md, minHeight: 46 }}>
              <span style={{ width: 20, height: 20, borderRadius: 99, display: "inline-flex", alignItems: "center", justifyContent: "center", background: item.id === step ? color.accent : color.surfaceElevated, color: item.id === step ? "#111" : color.textMuted, fontSize: T.caption.size }}>{index + 1}</span>
              {item.label}
            </button>
          ))}
        </div>
      </Section>
      <Section title={wizardSteps[stepIndex].label} trailing={wizardSteps[stepIndex].description}>
        {step === "scan" ? <WizardScan runtimeItems={runtimeItems} modelSources={modelSources} loadingInventory={loadingInventory} modelSourceProbes={modelSourceProbes} onSelectModelSource={onSelectModelSource} /> : null}
        {step === "preferences" ? <WizardPreferences selected={preferences} onToggle={togglePreference} /> : null}
        {step === "generate" ? <WizardGenerate hives={hives} selectedHiveId={selectedHive.id} onSelectHive={setSelectedHiveId} /> : null}
        {step === "verify" ? <WizardVerify hive={selectedHive} /> : null}
        {step === "activate" ? <WizardActivate hive={selectedHive} /> : null}
        <div style={{ marginTop: space.xl, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <ActionButton label="Back" onClick={() => setStep(previous)} disabled={stepIndex === 0} size="sm" />
          {step === "activate" ? (
            <ActionButton label={`Activate ${selectedHive.name}`} icon={<CheckCircle2 size={14} />} onClick={onFinish} size="sm" />
          ) : (
            <ActionButton label="Continue" icon={<ArrowRight size={14} />} onClick={() => setStep(next)} size="sm" />
          )}
        </div>
      </Section>
    </div>
  );
}

function WizardScan({
  runtimeItems,
  modelSources,
  loadingInventory,
  modelSourceProbes,
  onSelectModelSource,
}: {
  runtimeItems: RuntimeInventoryItem[];
  modelSources: ModelSourceInventoryItem[];
  loadingInventory: boolean;
  modelSourceProbes: ModelSourceProbeMap;
  onSelectModelSource: (item: ModelSourceInventoryItem) => void;
}) {
  return (
    <div style={{ display: "grid", gap: space.md }}>
      {loadingInventory ? (
        <div style={{ padding: space.md, borderRadius: radius.md, border: `0.5px solid ${color.border}`, background: color.surfaceElevated, color: color.textMuted, fontSize: T.bodySmall.size }}>
          Refreshing live runtime inventory...
        </div>
      ) : null}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: space.md }}>
        <InventoryList title="Runtimes detected" items={runtimeItems.slice(0, 6)} />
        <ModelSourceList title="Model sources seen" items={modelSources.slice(0, 6)} modelSourceProbes={modelSourceProbes} onSelect={onSelectModelSource} />
      </div>
    </div>
  );
}

function WizardPreferences({
  selected,
  onToggle,
}: {
  selected: WizardPreferenceId[];
  onToggle: (id: WizardPreferenceId) => void;
}) {
  return (
    <div>
      <p style={{ margin: 0, color: color.textSecondary, fontSize: T.bodySmall.size, lineHeight: 1.5 }}>
        The setup wizard asks human questions, not provider questions. These choices guide the company profile that live lane checks verify before activation.
      </p>
      <div style={{ marginTop: space.lg, display: "flex", flexWrap: "wrap", gap: space.sm }}>
        {wizardPreferenceOptions.map((pref) => {
          const active = selected.includes(pref.id);
          return (
            <button
              key={pref.id}
              type="button"
              aria-pressed={active}
              onClick={() => onToggle(pref.id)}
              style={chipStyle(active)}
            >
              {pref.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function WizardGenerate({
  hives,
  selectedHiveId,
  onSelectHive,
}: {
  hives: ExecutionHive[];
  selectedHiveId: string;
  onSelectHive: (id: string) => void;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: space.md }}>
      {hives.slice(0, 4).map((hive) => {
        const selected = hive.id === selectedHiveId;
        return (
        <button
          key={hive.id}
          type="button"
          onClick={() => onSelectHive(hive.id)}
          style={{
            minHeight: 190,
            textAlign: "left",
            border: `0.5px solid ${selected ? color.accent : color.border}`,
            borderRadius: radius.lg,
            background: selected ? color.accentSoft : color.surface,
            padding: space.lg,
            cursor: "pointer",
            color: color.text,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: space.sm }}>
            <strong style={{ color: color.text }}>{hive.name}</strong>
            {selected ? <Badge label="Selected" tone="accent" /> : hive.recommended ? <Badge label="Recommended" tone="accent" /> : null}
          </div>
          <p style={{ color: color.textSecondary, fontSize: T.bodySmall.size, lineHeight: 1.45 }}>{hive.description}</p>
        </button>
      );
      })}
    </div>
  );
}

function WizardVerify({ hive }: { hive: ExecutionHive }) {
  return (
    <div style={{ display: "grid", gap: space.md }}>
      <div style={{ color: color.textSecondary, fontSize: T.bodySmall.size, lineHeight: 1.5 }}>
        Review the current lane verification state for {hive.name}. Run live lane and conformance checks from the expanded lane row after activation.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: space.sm }}>
        {hive.lanes.map((lane) => (
          <ProbeRow
            key={lane.id}
            status={lane.verificationStatus === "verified" ? "pass" : lane.verificationStatus === "failed" ? "fail" : lane.verificationStatus === "warning" ? "warn" : "idle"}
            label={lane.label}
            detail={lane.verificationNote}
          />
        ))}
      </div>
    </div>
  );
}

function WizardActivate({ hive }: { hive: ExecutionHive }) {
  return (
    <div style={{ display: "grid", gap: space.md }}>
      <div style={{ padding: space.lg, borderRadius: radius.lg, border: `0.5px solid ${color.accent}`, background: color.accentSoft }}>
        <div style={{ display: "flex", alignItems: "center", gap: space.sm, color: color.accent, fontWeight: 750 }}>
          <ShieldCheck size={17} /> {hive.name} is ready to activate
        </div>
        <p style={{ margin: `${space.sm}px 0 0`, color: color.textSecondary, fontSize: T.bodySmall.size }}>
          This activates the persisted {hive.name} hive for the company. Use the expanded lane row to run live lane and conformance checks before broad rollout.
        </p>
      </div>
    </div>
  );
}

function InventoryList({ title, items }: { title: string; items: RuntimeInventoryItem[] }) {
  return (
    <div>
      <h3 style={{ margin: `0 0 ${space.md}px`, color: color.text, fontSize: T.cardTitle.size }}>{title}</h3>
      <div style={{ display: "grid", gap: space.sm }}>
        {items.map((item) => <RuntimeRow key={item.id} item={item} />)}
      </div>
    </div>
  );
}

function ModelSourceList({
  title,
  items,
  modelSourceProbes,
  onSelect,
}: {
  title: string;
  items: ModelSourceInventoryItem[];
  modelSourceProbes: ModelSourceProbeMap;
  onSelect?: (item: ModelSourceInventoryItem) => void;
}) {
  return (
    <div>
      <h3 style={{ margin: `0 0 ${space.md}px`, color: color.text, fontSize: T.cardTitle.size }}>{title}</h3>
      <div style={{ display: "grid", gap: space.sm }}>
        {items.map((item) => <ModelSourceRow key={item.id} item={item} probe={modelSourceProbes[item.id]} onSelect={onSelect} />)}
      </div>
    </div>
  );
}

function RuntimeRow({ item }: { item: RuntimeInventoryItem }) {
  const tone = item.status === "ready" ? "positive" : item.status === "warning" ? "warning" : item.status === "disabled" ? "muted" : "negative";
  return (
    <div style={{ padding: space.md, borderRadius: radius.md, border: `0.5px solid ${color.border}`, background: "rgba(255,255,255,0.025)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: space.sm }}>
        <span style={{ display: "flex", alignItems: "center", gap: space.sm, color: color.text, fontWeight: 650 }}><Dot tone={tone} />{item.label}</span>
        <span style={{ color: color.textMuted, fontSize: T.caption.size, fontFamily: font.mono }}>{item.kind}</span>
      </div>
      <div style={{ marginTop: 6, color: color.textMuted, fontSize: T.caption.size }}>{item.note}</div>
    </div>
  );
}

function modelSourceStatusColor(status: ProbeStatus): string {
  if (status === "pass") return color.positive;
  if (status === "warn") return color.warning;
  if (status === "fail") return color.negative;
  return color.textMuted;
}

function modelSourceStatusBackground(status: ProbeStatus): string {
  if (status === "pass") return color.positiveSoft;
  if (status === "warn") return color.warningSoft;
  if (status === "fail") return color.negativeSoft;
  return color.surfaceElevated;
}

function modelSourceStatusChipStyle(status: ProbeStatus): CSSProperties {
  const statusColor = modelSourceStatusColor(status);
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    minHeight: 22,
    maxWidth: "100%",
    padding: "3px 8px",
    borderRadius: radius.full,
    border: `0.5px solid ${statusColor}`,
    background: modelSourceStatusBackground(status),
    color: statusColor,
    fontSize: T.caption.size,
    fontFamily: font.mono,
    lineHeight: 1.2,
    whiteSpace: "nowrap",
  };
}

function ModelSourceRow({ item, probe, onSelect }: { item: ModelSourceInventoryItem; probe?: ModelSourceProbeResult; onSelect?: (item: ModelSourceInventoryItem) => void }) {
  const status = probeStatusFromModelSource(item, probe);
  const statusLabel = modelSourceStatusLabel(item, probe);
  const tone = status === "pass"
    ? "positive"
    : status === "warn"
      ? "warning"
      : status === "fail"
        ? "negative"
        : "muted";
  const content = (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: space.sm }}>
        <span style={{ display: "flex", alignItems: "center", gap: space.sm, color: color.text, fontWeight: 650, minWidth: 0 }}><Dot tone={tone} />{item.label}</span>
        <span style={modelSourceStatusChipStyle(status)}>
          {statusLabel}
        </span>
      </div>
      <div style={{ marginTop: 6, color: color.textMuted, fontSize: T.caption.size }}>{item.note}</div>
      {probe ? (
        <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
          <span style={{ ...modelSourceStatusChipStyle(status), color: color.textSecondary, borderColor: color.border, background: color.surfaceElevated }}>
            {probe.endpointLabel ?? "Provider probe"}
          </span>
          {probe.latencyMs ? (
            <span style={{ ...modelSourceStatusChipStyle("idle"), color: color.textSecondary, borderColor: color.border }}>
              {probe.latencyMs}ms
            </span>
          ) : null}
          <span style={{ ...modelSourceStatusChipStyle(status), color: color.textSecondary, borderColor: color.border, background: color.surfaceElevated }}>
            {probe.configuredSecretNames?.join(", ") || "no configured credential"}
          </span>
        </div>
      ) : item.status === "connected" ? (
        <div style={{ marginTop: 8 }}>
          <span style={modelSourceStatusChipStyle("warn")}>
            Open to test connection
          </span>
        </div>
      ) : null}
    </>
  );
  if (!onSelect) {
    return (
      <div style={{ padding: space.md, borderRadius: radius.md, border: `0.5px solid ${color.border}`, background: "rgba(255,255,255,0.025)" }}>
        {content}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      style={{
        width: "100%",
        textAlign: "left",
        padding: space.md,
        borderRadius: radius.md,
        border: `0.5px solid ${color.border}`,
        background: "rgba(255,255,255,0.025)",
        cursor: "pointer",
      }}
    >
      {content}
    </button>
  );
}

function modelSourceStatusLabel(item: ModelSourceInventoryItem, probe?: ModelSourceProbeResult): string {
  if (probe?.status === "pass") return "probe passed";
  if (probe?.status === "fail") return "probe failed";
  if (probe?.status === "warn") return "probe review";
  if (item.status === "connected") return "credential configured";
  if (item.status === "needs_key") return "needs credential";
  if (item.status === "warning") return "needs review";
  if (item.status === "available") return "available";
  return "not configured";
}

function modelSourceKindLabel(item: ModelSourceInventoryItem): string {
  if (item.kind === "first-party") return "First-party source";
  if (item.kind === "broker") return "Broker source";
  if (item.kind === "local") return "Local source";
  return "Self-hosted source";
}

function modelSourceCredentialStorageLabel(item: ModelSourceInventoryItem): string {
  if (item.credentialStorage?.label) return item.credentialStorage.label;
  if (item.authSurface === "environment") return "Environment variable";
  if (item.authSurface === "keychain") return "Local keychain";
  if (item.authSurface === "managed-secret-store") return "Managed secret store";
  return "Server-side secret adapter";
}

function modelSourceCredentialStorageNote(item: ModelSourceInventoryItem): string {
  if (item.credentialStorage?.note) return item.credentialStorage.note;
  return "HiveRunner stores credentials on the server side and only returns configured/missing metadata to the browser.";
}

function modalButtonStyle(kind: "secondary" | "primary", disabled = false): CSSProperties {
  const isPrimary = kind === "primary";
  return {
    minHeight: 36,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: isPrimary
      ? disabled
        ? "var(--surface-hover)"
        : "color-mix(in srgb, var(--text-primary) 72%, var(--surface))"
      : "transparent",
    color: isPrimary
      ? disabled
        ? "var(--text-muted)"
        : "var(--surface)"
      : "var(--text-secondary)",
    padding: `0 ${isPrimary ? 18 : 16}px`,
    fontSize: T.bodySmall.size,
    fontWeight: 650,
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.62 : 1,
    transition: "background 120ms ease, border-color 120ms ease, color 120ms ease, opacity 120ms ease",
  };
}

function modelSourcePurposeCopy(item: ModelSourceInventoryItem): string {
  switch (item.id) {
    case "openrouter":
      return "OpenRouter routes work through your OpenRouter account and lets that account broker access to downstream models.";
    case "openai":
      return "OpenAI Direct pins model-routed work to your OpenAI account. This is separate from Codex runtime login.";
    case "anthropic":
      return "Anthropic Direct pins model-routed work to your Anthropic account. This is separate from Claude Code CLI login.";
    case "google":
      return "Google Direct pins model-routed work to your Gemini or Google AI account. This is separate from Gemini CLI login.";
    case "ollama":
      return "Ollama points HiveRunner at a local model host for private lanes that stay on this machine or network.";
    case "vllm":
      return "vLLM points HiveRunner at a self-hosted OpenAI-compatible endpoint that you operate.";
    default:
      return "This model source controls where HiveRunner sends model-routed work for direct, broker, local, or self-hosted lanes.";
  }
}

function ModalShell({
  title,
  subtitle,
  icon,
  onClose,
  children,
  width = "min(920px, 100%)",
}: {
  title: string;
  subtitle?: string;
  icon: ReactNode;
  onClose: () => void;
  children: ReactNode;
  width?: string;
}) {
  return (
    <div
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 80,
        background: "var(--modal-backdrop)",
        backdropFilter: "blur(12px) saturate(1.25)",
        WebkitBackdropFilter: "blur(12px) saturate(1.25)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: space.xl,
        overflowY: "auto",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          width,
          maxHeight: `calc(100vh - ${space.xl * 2}px)`,
          borderRadius: 16,
          border: "1px solid var(--border)",
          background: "var(--modal-glass)",
          color: color.text,
          boxShadow: "var(--shadow-glass)",
          backdropFilter: "blur(28px) saturate(1.35)",
          WebkitBackdropFilter: "blur(28px) saturate(1.35)",
          overflow: "hidden",
          display: "grid",
          gridTemplateRows: "auto minmax(0, 1fr)",
        }}
      >
        <div style={{ padding: "16px 20px 10px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: space.lg }}>
          <div style={{ display: "flex", alignItems: "center", gap: space.md }}>
            <span style={{ width: 38, height: 38, borderRadius: radius.md, border: "1px solid var(--border)", background: "var(--surface)", color: color.accent, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
              {icon}
            </span>
            <div>
              <h2 style={{ margin: 0, color: color.text, fontSize: 19 }}>{title}</h2>
              {subtitle ? <div style={{ marginTop: 4, color: color.textMuted, fontSize: T.caption.size }}>{subtitle}</div> : null}
            </div>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            style={{ width: 28, height: 28, borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: color.textMuted, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, cursor: "pointer", lineHeight: 1 }}
          >
            ×
          </button>
        </div>
        <div className="execution-matrix-scroll" style={{ padding: "14px 20px 16px", minHeight: 0, overflowY: "auto" }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function SetupWizardModal({
  step,
  setStep,
  onFinish,
  onClose,
  hives,
  selectedHiveId,
  setSelectedHiveId,
  runtimeItems,
  modelSources,
  loadingInventory,
  modelSourceProbes,
  onSelectModelSource,
}: {
  step: WizardStep;
  setStep: (step: WizardStep) => void;
  onFinish: () => void;
  onClose: () => void;
  hives: ExecutionHive[];
  selectedHiveId: string;
  setSelectedHiveId: (id: string) => void;
  runtimeItems: RuntimeInventoryItem[];
  modelSources: ModelSourceInventoryItem[];
  loadingInventory: boolean;
  modelSourceProbes: ModelSourceProbeMap;
  onSelectModelSource: (item: ModelSourceInventoryItem) => void;
}) {
  return (
    <ModalShell
      title="New hive"
      subtitle="Use the existing setup flow to choose and activate a preset."
      icon={<Plus size={18} />}
      onClose={onClose}
      width="min(1080px, 100%)"
    >
      <Wizard
        step={step}
        setStep={setStep}
        onFinish={onFinish}
        hives={hives}
        selectedHiveId={selectedHiveId}
        setSelectedHiveId={setSelectedHiveId}
        runtimeItems={runtimeItems}
        modelSources={modelSources}
        loadingInventory={loadingInventory}
        modelSourceProbes={modelSourceProbes}
        onSelectModelSource={onSelectModelSource}
      />
    </ModalShell>
  );
}

function ModelSourceCredentialModal({
  slug,
  item,
  lastProbe,
  onClose,
  onSaved,
  onProbe,
}: {
  slug: string;
  item: ModelSourceInventoryItem | null;
  lastProbe?: ModelSourceProbeResult;
  onClose: () => void;
  onSaved: (item: ModelSourceInventoryItem, items: ModelSourceInventoryItem[]) => void;
  onProbe: (result: ModelSourceProbeResult, hives?: ExecutionHive[]) => void;
}) {
  const [credentialValue, setCredentialValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [probe, setProbe] = useState<ModelSourceProbeResult | null>(null);

  useEffect(() => {
    setCredentialValue("");
    setMessage(null);
    setSaving(false);
    setTesting(false);
    setProbe(lastProbe ?? null);
  }, [item?.id, lastProbe]);

  if (!item) return null;

  const configured = item.status === "connected";
  const secretNames = item.credentialSecretNames ?? [];
  const primarySecret = secretNames[0] ?? `${item.id.toUpperCase()}_API_KEY`;
  const storageLabel = modelSourceCredentialStorageLabel(item);
  const storageNote = modelSourceCredentialStorageNote(item);
  const credentialStatus = configured
    ? `Credential configured${item.authSurface ? ` through ${item.authSurface}` : ""}. Run a connection test before treating this source as verified.`
    : item.setupHint ?? "No credential is configured for this model source.";
  const statusCopy = modelSourceStatusLabel(item, probe ?? undefined);

  const save = async () => {
    if (!slug || !credentialValue.trim()) return;
    setSaving(true);
    setMessage(null);
    try {
      const result = await saveCompanyModelSourceCredential(slug, { sourceId: item.id, credentialValue });
      if (!result) {
        setMessage("Credential could not be saved.");
        return;
      }
      onSaved(result.modelSource, result.modelSources);
      setMessage(`${item.label} credential saved for this environment as ${primarySecret}.`);
      setCredentialValue("");
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    if (!slug || testing) return;
    setTesting(true);
    setMessage(null);
    try {
      const result = await runCompanyModelSourceProbe(slug, item.id);
      if (!result) {
        setMessage("Connection probe could not run.");
        return;
      }
      setProbe(result.probe);
      onProbe(result.probe, result.hives);
      setMessage(`${result.probe.label} probe ${result.probe.status === "pass" ? "passed" : result.probe.status === "fail" ? "failed" : "needs review"}.`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 80,
        background: "var(--modal-backdrop)",
        backdropFilter: "blur(12px) saturate(1.25)",
        WebkitBackdropFilter: "blur(12px) saturate(1.25)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: space.xl,
        overflowY: "auto",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${item.label} credentials`}
        style={{
          width: "min(560px, 100%)",
          borderRadius: 16,
          border: "1px solid var(--border)",
          background: "var(--modal-glass)",
          color: color.text,
          boxShadow: "var(--shadow-glass)",
          backdropFilter: "blur(28px) saturate(1.35)",
          WebkitBackdropFilter: "blur(28px) saturate(1.35)",
          overflow: "hidden",
          maxHeight: `calc(100vh - ${space.xl * 2}px)`,
          display: "grid",
          gridTemplateRows: "auto minmax(0, 1fr)",
        }}
      >
        <div style={{ padding: "16px 20px 10px", borderBottom: "none", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: space.lg }}>
          <div style={{ display: "flex", alignItems: "center", gap: space.md }}>
            <span style={{ width: 38, height: 38, borderRadius: radius.md, border: "1px solid var(--border)", background: "var(--surface)", color: color.accent, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
              <KeyRound size={18} />
            </span>
            <div>
              <h2 style={{ margin: 0, color: color.text, fontSize: 19 }}>{item.label}</h2>
              <div style={{ marginTop: 4, color: color.textMuted, fontSize: T.caption.size }}>{modelSourceKindLabel(item)} · {statusCopy}</div>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            style={{ width: 28, height: 28, borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: color.textMuted, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, cursor: "pointer", lineHeight: 1 }}
          >
            ×
          </button>
        </div>
        <div className="execution-matrix-scroll" style={{ padding: "14px 20px 16px", display: "grid", gap: space.md, minHeight: 0, overflowY: "auto" }}>
          <div style={{ padding: space.md, borderRadius: radius.md, border: `0.5px solid ${color.border}`, background: color.surface, color: color.textSecondary, fontSize: T.bodySmall.size, lineHeight: 1.45 }}>
            {modelSourcePurposeCopy(item)}
          </div>
          <div style={{ padding: space.md, borderRadius: radius.md, border: `0.5px solid ${color.border}`, background: color.surface, color: color.textSecondary, fontSize: T.bodySmall.size, lineHeight: 1.45 }}>
            <strong style={{ display: "block", marginBottom: 4, color: color.text }}>What this does not control</strong>
            {item.note}
          </div>
          <div style={{ padding: space.md, borderRadius: radius.md, border: `0.5px solid ${configured ? color.positive : color.warning}`, background: color.surface, color: configured ? color.positive : color.warning, fontSize: T.bodySmall.size, lineHeight: 1.45 }}>
            {credentialStatus}
          </div>
          <div style={{ padding: space.md, borderRadius: radius.md, border: `0.5px solid ${color.border}`, background: color.surface, color: color.textSecondary, fontSize: T.bodySmall.size, lineHeight: 1.45 }}>
            <strong style={{ display: "block", marginBottom: 4, color: color.text }}>Credential storage</strong>
            {storageNote}
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ color: color.textMuted, fontSize: T.caption.size, textTransform: "uppercase", letterSpacing: "0.06em" }}>Accepted credential names</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: space.xs }}>
              {secretNames.map((name) => (
                <span key={name} style={{ border: `0.5px solid ${color.border}`, borderRadius: radius.full, padding: `4px ${space.sm}px`, color: color.textSecondary, fontSize: T.caption.size, fontFamily: font.mono }}>
                  {name}
                </span>
              ))}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: space.md }}>
            <DetailBlock label="Auth surface" value={item.authSurface ?? "none"} />
            <DetailBlock label="Configured" value={configured ? (item.configuredSecretNames?.join(", ") || "yes") : "not yet"} />
            <DetailBlock label="Storage" value={storageLabel} />
            <DetailBlock label="Production ready" value={item.credentialStorage?.productionReady ? "yes" : "not yet"} />
          </div>
          {probe ? (
            <div style={{ padding: space.md, borderRadius: radius.md, border: `0.5px solid ${probe.status === "pass" ? color.positive : probe.status === "fail" ? color.negative : color.warning}`, background: color.surface, color: color.textSecondary, fontSize: T.bodySmall.size, lineHeight: 1.45 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: space.md, color: color.text, fontWeight: 700 }}>
                <span>{probe.endpointLabel ?? "Provider metadata probe"}</span>
                <span style={{ color: probe.status === "pass" ? color.positive : probe.status === "fail" ? color.negative : color.warning, fontSize: T.caption.size, fontFamily: font.mono }}>{probe.status}</span>
              </div>
              <div style={{ marginTop: 6 }}>{probe.note}</div>
              <div style={{ marginTop: 6, color: color.textMuted, fontSize: T.caption.size, fontFamily: font.mono }}>
                {probe.latencyMs ? `${probe.latencyMs}ms · ` : ""}{probe.configuredSecretNames?.join(", ") || "no configured credential"}
              </div>
            </div>
          ) : null}
          <label style={{ display: "grid", gap: 7 }}>
            <span style={{ color: color.textMuted, fontSize: T.caption.size, textTransform: "uppercase", letterSpacing: "0.06em" }}>Save or replace credential</span>
            <input
              type="password"
              autoComplete="off"
              value={credentialValue}
              onChange={(event) => setCredentialValue(event.target.value)}
              placeholder={`Credential value for ${primarySecret}`}
              style={{
                minHeight: 42,
                borderRadius: radius.md,
                border: `0.5px solid ${color.border}`,
                background: color.surface,
                color: color.text,
                padding: `0 ${space.md}px`,
                fontSize: T.bodySmall.size,
                outline: "none",
              }}
            />
          </label>
          {message ? <div style={{ color: color.textSecondary, fontSize: T.bodySmall.size }}>{message}</div> : null}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10, paddingTop: 4 }}>
            <button type="button" onClick={onClose} style={modalButtonStyle("secondary")}>
              Close
            </button>
            <button type="button" onClick={testConnection} disabled={testing} style={modalButtonStyle("secondary", testing)}>
              {testing ? "Testing..." : "Test connection"}
            </button>
            <button type="button" onClick={save} disabled={saving || !credentialValue.trim()} style={modalButtonStyle("primary", saving || !credentialValue.trim())}>
              {saving ? "Saving..." : "Save credential"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CompanyRuntimesPage() {
  const params = useParams<{ slug: string }>();
  const pathname = usePathname();
  const slug = params?.slug ?? "";
  const [company, setCompany] = useState<OrchestrationCompany | null>(null);
  const [hives, setHives] = useState<ExecutionHive[]>(SEEDED_EXECUTION_HIVES);
  const [selectedHiveId, setSelectedHiveId] = useState("balanced-builder");
  const [wizardHiveId, setWizardHiveId] = useState("balanced-builder");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState<WizardStep>("scan");
  const [loadingHives, setLoadingHives] = useState(false);
  const [activatingHiveId, setActivatingHiveId] = useState<string | null>(null);
  const [changingHiveModeId, setChangingHiveModeId] = useState<string | null>(null);
  const [hiveNotice, setHiveNotice] = useState<string | null>(null);
  const [runtimeItems, setRuntimeItems] = useState<RuntimeInventoryItem[]>(SEEDED_RUNTIME_INVENTORY);
  const [modelSources, setModelSources] = useState<ModelSourceInventoryItem[]>(SEEDED_MODEL_SOURCES);
  const [modelSourceProbes, setModelSourceProbes] = useState<ModelSourceProbeMap>({});
  const [selectedModelSource, setSelectedModelSource] = useState<ModelSourceInventoryItem | null>(null);
  const [loadingInventory, setLoadingInventory] = useState(false);

  const refreshRuntimeInventory = useCallback(async (fast = true) => {
    if (!slug) return;
    setLoadingInventory(true);
    try {
      const [result, credentialSources] = await Promise.all([
        listCompanyRuntimes(slug, { fast }),
        listCompanyModelSources(slug),
      ]);
      setRuntimeItems(buildLiveRuntimeItems(result.runtimes, result.detectedLocalRuntimes));
      setModelSources(buildLiveModelSources(result.runtimes, result.detectedLocalRuntimes, result.recentExecutionRuns, credentialSources));
    } catch {
      setRuntimeItems(SEEDED_RUNTIME_INVENTORY);
      setModelSources(SEEDED_MODEL_SOURCES);
    } finally {
      setLoadingInventory(false);
    }
  }, [slug]);

  useEffect(() => {
    let cancelled = false;
    setLoadingHives(true);
    void listCompanies()
      .then((companies) => {
        if (cancelled) return;
        const normalized = slug.toLowerCase();
        setCompany(companies.find((candidate) => candidate.slug.toLowerCase() === normalized || candidate.code.toLowerCase() === normalized) ?? null);
      })
      .catch(() => {
        if (!cancelled) setCompany(null);
      });
    return () => { cancelled = true; };
  }, [slug]);

  useEffect(() => {
    void refreshRuntimeInventory(true);
  }, [refreshRuntimeInventory]);

  useEffect(() => {
    let cancelled = false;
    if (!slug) return;
    setLoadingHives(true);
    void listCompanyExecutionHives(slug)
      .then((items) => {
        if (cancelled) return;
        const next = items.length > 0 ? items : SEEDED_EXECUTION_HIVES;
        setHives(next);
        setModelSourceProbes((current) => mergeModelSourceProbeMaps(current, modelSourceProbesFromHives(next)));
        const active = next.find((hive) => hive.isActive);
        setSelectedHiveId(active?.id ?? next[0]?.id ?? "balanced-builder");
      })
      .catch(() => {
        if (!cancelled) {
          setHives(SEEDED_EXECUTION_HIVES);
          setHiveNotice("Execution Hives could not be loaded from the company database.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingHives(false);
      });
    return () => { cancelled = true; };
  }, [slug]);

  const selectedHive = useMemo(() => hives.find((hive) => hive.id === selectedHiveId) ?? hives[0] ?? SEEDED_EXECUTION_HIVES[0], [hives, selectedHiveId]);
  const companyLabel = company?.name ?? (slug || "Company");
  const companyCode = company?.code ?? slug;
  const hivesPath = buildCanonicalCompanyPath(companyCode, "/hives");
  const showLegacyBanner = Boolean(pathname?.includes("/runtimes"));

  const openWizard = () => {
    setWizardStep("scan");
    setWizardHiveId(selectedHive.id);
    setWizardOpen(true);
  };

  const finishWizard = () => {
    void activateHive(wizardHiveId);
    setWizardOpen(false);
  };

  const activateHive = async (hiveId: string) => {
    if (!slug || activatingHiveId) return;
    setActivatingHiveId(hiveId);
    setHiveNotice(null);
    try {
      const result = await activateCompanyExecutionHive(slug, hiveId);
      if (!result) {
        setHiveNotice("Hive activation failed. The company defaults were not changed.");
        return;
      }
      if (result.hives.length > 0) {
        setHives(result.hives);
      } else {
        setHives((current) => current.map((hive) => ({ ...hive, isActive: hive.id === result.hive.id })));
      }
      setSelectedHiveId(result.hive.id);
      setHiveNotice(`${result.hive.name} is now the active company Execution Hive.`);
    } finally {
      setActivatingHiveId(null);
    }
  };

  const configureHive = async (hiveId: string, config: ExecutionHiveMatrixConfig) => {
    if (!slug) return false;
    setHiveNotice(null);
    const result = await configureCompanyExecutionHive(slug, hiveId, config);
    if (!result) {
      setHiveNotice("Hive settings could not be saved.");
      return false;
    }
    if (result.hives.length > 0) setHives(result.hives);
    setSelectedHiveId(result.hive.id);
    setHiveNotice(`${result.hive.name} settings saved.`);
    void refreshRuntimeInventory(true);
    return true;
  };

  const changeHiveOrchestrationMode = async (hive: ExecutionHive, mode: TaskExecutionEngine) => {
    if (changingHiveModeId || hive.orchestrationMode === mode) return;
    const defaultLane = hive.lanes.find((lane) => lane.id === "default") ?? hive.lanes[0];
    if (!defaultLane) {
      setHiveNotice("This hive has no lanes to preserve while changing orchestration mode.");
      return;
    }
    const provider = providerFromRouteTarget(defaultLane.primary);
    const routing = modelRoutingFromRouteTarget(defaultLane.primary);
    setChangingHiveModeId(hive.id);
    try {
      await configureHive(hive.id, {
        orchestrationMode: mode,
        runtimeProvider: provider,
        runtimeLabel: defaultLane.primary.runtimeLabel ?? runtimeProviderOption(provider).label,
        modelRouting: routing.value,
        modelRoutingLabel: routing.label,
      });
    } finally {
      setChangingHiveModeId(null);
    }
  };

  const applyHiveUpdate = (nextHive: ExecutionHive, notice: string) => {
    setHives((current) => {
      const replaced = current.map((hive) => hive.id === nextHive.id ? nextHive : hive);
      return replaced.some((hive) => hive.id === nextHive.id) ? replaced : [nextHive, ...current];
    });
    setSelectedHiveId(nextHive.id);
    setHiveNotice(notice);
    void refreshRuntimeInventory(true);
  };

  return (
    <div style={{ ...pageStyle, maxWidth: 1280 }}>
      <PageHeader
        icon={<Sparkles size={18} />}
        title="Execution Hives"
        description={`${companyLabel} · active routing lanes for orchestration modes, runtimes, model sources, fallbacks, and verification checks.`}
        actions={(
          <div style={{ display: "flex", alignItems: "center", gap: space.sm }}>
            <a href={buildCanonicalCompanyPath(companyCode, "/settings/models")} style={{ color: color.accent, fontSize: T.bodySmall.size, fontWeight: 700, textDecoration: "none" }}>
              Manage models →
            </a>
            <ActionButton label="+ New Hive" icon={<Plus size={14} />} onClick={openWizard} size="sm" />
          </div>
        )}
      />

      {showLegacyBanner ? (
        <div style={{ marginBottom: space.lg, padding: space.md, borderRadius: radius.md, border: `0.5px solid ${color.border}`, background: color.surface, color: color.textSecondary, fontSize: T.bodySmall.size }}>
          This is a legacy URL. Operator workflows have moved to <a href={hivesPath} style={{ color: color.accent, fontWeight: 700, textDecoration: "none" }}>Hives</a>.
        </div>
      ) : null}

      {hiveNotice ? (
        <div style={{ marginBottom: space.lg, padding: space.md, borderRadius: radius.md, border: `0.5px solid ${color.border}`, background: color.surface, color: color.textSecondary, fontSize: T.bodySmall.size }}>
          {hiveNotice}
        </div>
      ) : null}

      <Section
        title="Hive Profiles"
        trailing={<span>{loadingHives ? "Loading profiles" : `${hives.length} company profiles`}</span>}
        card={false}
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: space.md }}>
          {hives.map((hive) => (
            <HiveCard
              key={hive.id}
              hive={hive}
              selected={hive.id === selectedHive.id}
              onSelect={() => setSelectedHiveId(hive.id)}
            />
          ))}
        </div>
      </Section>

      <SelectedHiveSummary
        hive={selectedHive}
        activating={activatingHiveId === selectedHive.id}
        changingMode={changingHiveModeId === selectedHive.id}
        onActivate={() => activateHive(selectedHive.id)}
        onOrchestrationModeChange={(mode) => void changeHiveOrchestrationMode(selectedHive, mode)}
      />

      <ActiveHiveLanes
        companySlug={slug}
        hive={selectedHive}
        onHiveUpdated={applyHiveUpdate}
      />

      <div style={{ marginTop: space.xl }}>
        <RuntimeInventoryPanel slug={slug} embedded />
      </div>

      {wizardOpen ? (
        <SetupWizardModal
          step={wizardStep}
          setStep={setWizardStep}
          onFinish={finishWizard}
          onClose={() => setWizardOpen(false)}
          hives={hives}
          selectedHiveId={wizardHiveId}
          setSelectedHiveId={setWizardHiveId}
          runtimeItems={runtimeItems}
          modelSources={modelSources}
          loadingInventory={loadingInventory}
          modelSourceProbes={modelSourceProbes}
          onSelectModelSource={setSelectedModelSource}
        />
      ) : null}

      <ModelSourceCredentialModal
        slug={slug}
        item={selectedModelSource}
        lastProbe={selectedModelSource ? modelSourceProbes[selectedModelSource.id] : undefined}
        onClose={() => setSelectedModelSource(null)}
        onSaved={(savedItem, items) => {
          setModelSources(items);
          setSelectedModelSource(savedItem);
          void refreshRuntimeInventory(true);
        }}
        onProbe={(result, nextHives) => {
          setModelSourceProbes((current) => mergeModelSourceProbeMaps(current, { [result.sourceId]: result }));
          if (nextHives?.length) {
            setHives(nextHives);
            setModelSourceProbes((current) => mergeModelSourceProbeMaps(current, modelSourceProbesFromHives(nextHives)));
          }
        }}
      />
    </div>
  );
}
