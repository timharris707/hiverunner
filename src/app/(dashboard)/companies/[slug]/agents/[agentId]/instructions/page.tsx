"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  FileText,
  Layers,
  Pencil,
  Save,
  Shield,
  Wrench,
} from "lucide-react";

import { useAgentProfile, A } from "../agent-context";
import { listCompanyRuntimes } from "@/lib/orchestration/client";
import type {
  DetectedOrchestrationRuntime,
  OrchestrationRuntime,
} from "@/lib/orchestration/types";

type InstructionSource = {
  id: string;
  label: string;
  kind: "profile_field" | "runtime_file" | "role_default";
  editable: boolean;
  exists: boolean;
  status: "active" | "fallback" | "available" | "missing";
  usedBy: string[];
  content: string | null;
  note: string;
  path?: string;
  byteSize: number;
  lineCount: number;
  updatedAt?: string;
};

type InstructionsPayload = {
  agent: {
    id: string;
    name: string;
    role: string;
    model: string | null;
    adapterType: string;
    openclawAgentId?: string | null;
    instructionsMode: "managed" | "external";
  };
  runtimeModel: {
    providerId: string;
    providerName: string;
    summary: string;
    heartbeatPath: { label: string; detail: string };
    taskDispatchPath: { label: string; detail: string };
  };
  sources: InstructionSource[];
};

type RuntimeInventory = {
  runtimes: OrchestrationRuntime[];
  detectedLocalRuntimes: DetectedOrchestrationRuntime[];
};

const UI = {
  sectionBg: "var(--surface)",
  sectionBorder: "var(--border)",
  surface: "var(--surface-elevated)",
  surfaceStrong: "var(--surface-elevated)",
  surfaceHover: "var(--surface-hover)",
  surfaceBorder: "var(--border)",
  divider: "var(--border)",
  label: "var(--text-muted)",
  shadow: "var(--shadow-glass)",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  return `${(bytes / 1024).toFixed(1)}KB`;
}

function statusTone(status: InstructionSource["status"]) {
  switch (status) {
    case "active":
      return { background: "var(--positive-soft)", border: "rgba(23, 122, 50, 0.22)", color: "var(--positive)" };
    case "fallback":
      return { background: "var(--warning-soft)", border: "rgba(138, 90, 0, 0.24)", color: "var(--warning)" };
    case "available":
      return { background: "var(--surface-hover)", border: "var(--border)", color: A.textSec };
    case "missing":
      return { background: "var(--surface-hover)", border: "var(--border)", color: A.muted };
  }
}

function kindLabel(kind: InstructionSource["kind"]): string {
  if (kind === "profile_field") return "MC field";
  if (kind === "runtime_file") return "Runtime file";
  return "Role default";
}

function normalizeProviderId(providerId: string): string {
  return providerId === "openclaw-heartbeat" ? "openclaw" : providerId;
}

function formatRuntimeStatus(status?: string | null): string {
  if (!status) return "Unknown";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function findRuntimeBinding(
  inventory: RuntimeInventory,
  providerId: string,
  agentId: string,
): {
  registered: OrchestrationRuntime | null;
  detected: DetectedOrchestrationRuntime | null;
  bindingLabel: string;
} {
  const normalized = normalizeProviderId(providerId);
  const matches = (provider: string) => normalizeProviderId(provider) === normalized;
  const agentRuntime = inventory.runtimes.find((runtime) => runtime.agentId === agentId && matches(runtime.provider)) ?? null;
  const companyRuntime = inventory.runtimes.find((runtime) => !runtime.agentId && matches(runtime.provider)) ?? null;
  const detected = inventory.detectedLocalRuntimes.find((runtime) => matches(runtime.provider)) ?? null;
  if (agentRuntime) return { registered: agentRuntime, detected, bindingLabel: "Agent scoped" };
  if (companyRuntime) return { registered: companyRuntime, detected, bindingLabel: "Company scoped" };
  if (detected) return { registered: null, detected, bindingLabel: "Detected only" };
  return { registered: null, detected: null, bindingLabel: "Missing" };
}

export default function AgentInstructionsPage() {
  const { profile, reload, slug } = useAgentProfile();
  const { agent } = profile;
  const runtimeCompanySlug = profile.company.slug || slug;

  const [data, setData] = useState<InstructionsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [runtimeInventory, setRuntimeInventory] = useState<RuntimeInventory>({
    runtimes: [],
    detectedLocalRuntimes: [],
  });
  const [runtimeInventoryError, setRuntimeInventoryError] = useState<string | null>(null);
  const [selectedSourceId, setSelectedSourceId] = useState<string>("");
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const loadInstructions = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/orchestration/agents/${encodeURIComponent(agent.id)}/instructions`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`${response.status}`);
      const payload = (await response.json()) as InstructionsPayload;
      setData(payload);
      setError(null);
    } catch (loadError) {
      setData(null);
      setError(loadError instanceof Error ? loadError.message : "unknown_error");
    } finally {
      setLoading(false);
    }
  }, [agent.id]);

  useEffect(() => {
    void loadInstructions();
  }, [loadInstructions]);

  useEffect(() => {
    listCompanyRuntimes(runtimeCompanySlug)
      .then((inventory) => {
        setRuntimeInventory(inventory);
        setRuntimeInventoryError(null);
      })
      .catch((runtimeError) => {
        setRuntimeInventory({ runtimes: [], detectedLocalRuntimes: [] });
        setRuntimeInventoryError(runtimeError instanceof Error ? runtimeError.message : "unknown_error");
      });
  }, [runtimeCompanySlug]);

  const sources = useMemo(() => data?.sources ?? [], [data?.sources]);
  const runtimeBinding = useMemo(
    () => findRuntimeBinding(runtimeInventory, data?.runtimeModel.providerId ?? agent.adapterType ?? "manual", agent.id),
    [agent.adapterType, agent.id, data?.runtimeModel.providerId, runtimeInventory],
  );
  const runtimeBindingStatus = runtimeBinding.registered?.status ?? runtimeBinding.detected?.status ?? "unknown";
  const runtimeBindingTitle = runtimeBinding.registered?.displayName ?? runtimeBinding.detected?.displayName ?? "No runtime binding";
  const selectedSource = useMemo(
    () =>
      sources.find((source) => source.id === selectedSourceId) ??
      sources.find((source) => source.id === "soul") ??
      sources.find((source) => source.id === "personality") ??
      sources[0] ??
      null,
    [selectedSourceId, sources],
  );

  useEffect(() => {
    if (!selectedSource && sources.length === 0) {
      setSelectedSourceId("");
      return;
    }
    if (selectedSource && selectedSource.id !== selectedSourceId) {
      setSelectedSourceId(selectedSource.id);
    }
  }, [selectedSource, selectedSourceId, sources.length]);

  useEffect(() => {
    setDraft(selectedSource?.content ?? "");
  }, [selectedSource?.id, selectedSource?.content]);

  useEffect(() => {
    setSaved(false);
    setSaveError(null);
  }, [selectedSource?.id]);

  const editableSources = sources.filter((source) => source.editable);
  const readOnlySources = sources.filter((source) => !source.editable);

  const handleSave = useCallback(async () => {
    if (!selectedSource?.editable) return;
    setSaving(true);
    setSaveError(null);
    try {
      const response = await fetch(`/api/orchestration/agents/${encodeURIComponent(agent.id)}/instructions`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceId: selectedSource.id,
          content: draft,
        }),
      });
      if (!response.ok) {
        throw new Error(`${response.status}`);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
      await loadInstructions();
      reload();
    } catch (saveErr) {
      setSaveError(saveErr instanceof Error ? saveErr.message : "unknown_error");
    } finally {
      setSaving(false);
    }
  }, [agent.id, draft, loadInstructions, reload, selectedSource]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 1080, paddingBottom: 24 }}>
      <Section
        icon={<Layers size={14} />}
        title="Instruction Model"
        subtitle="Provider-aware view of the sources HiveRunner can actually prove and manage for this agent."
      >
        {loading ? (
          <InlineStatus>Loading instruction sources…</InlineStatus>
        ) : error ? (
          <InlineStatus tone="error">Could not load instruction sources ({error}).</InlineStatus>
        ) : data ? (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                gap: 14,
              }}
            >
              <SummaryCard
                eyebrow="Current provider"
                title={data.runtimeModel.providerName}
                subtitle={data.runtimeModel.summary}
                accent
              >
                <SummaryRow label="Provider ID" value={data.runtimeModel.providerId} mono />
                <SummaryRow label="Adapter" value={data.agent.adapterType} mono />
                <SummaryRow label="Instructions mode" value={data.agent.instructionsMode} />
                <SummaryRow label="Model" value={data.agent.model || "\u2014"} mono />
              </SummaryCard>

              <SummaryCard
                eyebrow="Runtime registry"
                title={runtimeBindingTitle}
                subtitle="Execution availability is tracked separately from instruction source ownership."
              >
                <SummaryRow label="Provider" value={normalizeProviderId(data.runtimeModel.providerId)} mono />
                <SummaryRow label="Binding" value={runtimeBinding.bindingLabel} />
                <SummaryRow
                  label="Status"
                  value={formatRuntimeStatus(runtimeBindingStatus)}
                />
                <SummaryRow
                  label="Runtime"
                  value={runtimeBinding.registered?.runtimeSlug ?? runtimeBinding.detected?.command ?? "\u2014"}
                  mono
                />
                <SummaryRow
                  label="Command"
                  value={runtimeBinding.registered?.command ?? runtimeBinding.detected?.commandPath ?? "\u2014"}
                  mono
                />
                {runtimeInventoryError ? (
                  <InlineStatus tone="error">Could not load runtime registry ({runtimeInventoryError}).</InlineStatus>
                ) : null}
              </SummaryCard>

              <SummaryCard
                eyebrow="Observed paths"
                title="What this runtime reads"
                subtitle="HiveRunner only labels a source as runtime-used when the code path is proven."
              >
                <PathNote title={data.runtimeModel.heartbeatPath.label}>
                  {data.runtimeModel.heartbeatPath.detail}
                </PathNote>
                <PathNote title={data.runtimeModel.taskDispatchPath.label}>
                  {data.runtimeModel.taskDispatchPath.detail}
                </PathNote>
              </SummaryCard>

              <SummaryCard
                eyebrow="Editable today"
                title={`${editableSources.length} editable source${editableSources.length === 1 ? "" : "s"}`}
                subtitle="HiveRunner can edit only the sources that have a real backing write path."
              >
                {editableSources.length > 0 ? (
                  editableSources.map((source) => (
                    <SourceSummary key={source.id} source={source} />
                  ))
                ) : (
                  <InlineStatus>No instruction sources are writable for this agent in HiveRunner.</InlineStatus>
                )}
              </SummaryCard>
            </div>

            <div style={{ ...noteStyle, marginTop: 14 }}>
              Provider switching changes which runtime model this page describes. Runtime registry status is shown separately so an online CLI is not confused with a provider-native instruction bundle.
            </div>
          </>
        ) : null}
      </Section>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "280px minmax(0, 1fr)",
          gap: 16,
          alignItems: "start",
        }}
      >
        <Section
          icon={<FileText size={14} />}
          title="Sources"
          subtitle="Editable and read-only instruction sources, grouped by provenance."
        >
          <SourceGroup title="Editable">
            {editableSources.length > 0 ? (
              editableSources.map((source) => (
                <SourceButton
                  key={source.id}
                  source={source}
                  active={selectedSource?.id === source.id}
                  onClick={() => setSelectedSourceId(source.id)}
                />
              ))
            ) : (
              <EmptyMiniState>No editable sources</EmptyMiniState>
            )}
          </SourceGroup>

          <SourceGroup title="Read-only">
            {readOnlySources.map((source) => (
              <SourceButton
                key={source.id}
                source={source}
                active={selectedSource?.id === source.id}
                onClick={() => setSelectedSourceId(source.id)}
              />
            ))}
          </SourceGroup>
        </Section>

        <Section
          icon={selectedSource?.editable ? <Pencil size={14} /> : <Shield size={14} />}
          title={selectedSource?.label || "Instruction source"}
          subtitle={
            selectedSource
              ? selectedSource.editable
                ? "Editable source with a real backing write path."
                : "Read-only source shown for operator context and provenance."
              : "Select a source to inspect."
          }
        >
          {selectedSource ? (
            <>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 14,
                }}
              >
                <Pill>{kindLabel(selectedSource.kind)}</Pill>
                <StatusPill status={selectedSource.status} />
                {selectedSource.usedBy.map((usedBy) => (
                  <Pill key={usedBy}>{usedBy}</Pill>
                ))}
              </div>

              <MetaGrid>
                <MetaRow label="Bytes" value={formatBytes(selectedSource.byteSize)} />
                <MetaRow label="Lines" value={String(selectedSource.lineCount)} />
                <MetaRow label="Path" value={selectedSource.path || "\u2014"} mono />
                <MetaRow
                  label="Updated"
                  value={selectedSource.updatedAt ? new Date(selectedSource.updatedAt).toLocaleString() : "\u2014"}
                />
              </MetaGrid>

              <div style={{ ...noteStyle, marginTop: 12, marginBottom: 14 }}>
                {selectedSource.note}
              </div>

              {selectedSource.editable ? (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <div style={{ fontSize: 12, color: A.textSec }}>
                      {selectedSource.kind === "runtime_file"
                        ? "Saving here updates the real runtime file HiveRunner can manage for this agent."
                        : "Saving here updates the HiveRunner profile prompt stored in the orchestration DB."}
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        type="button"
                        onClick={() => setDraft(selectedSource.content ?? "")}
                        style={secondaryButtonStyle}
                      >
                        Reset
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleSave()}
                        disabled={saving}
                        style={{
                          ...primaryButtonStyle,
                          opacity: saving ? 0.65 : 1,
                          cursor: saving ? "wait" : "pointer",
                        }}
                      >
                        <Save size={12} />
                        {saved ? "Saved" : saving ? "Saving…" : "Save"}
                      </button>
                    </div>
                  </div>

                  <textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    spellCheck={false}
                    style={editorStyle}
                  />
                  {saveError ? (
                    <InlineStatus tone="error">Could not save this source ({saveError}).</InlineStatus>
                  ) : null}
                </>
              ) : selectedSource.exists ? (
                <pre style={previewStyle}>{selectedSource.content}</pre>
              ) : (
                <EmptySourceState>
                  This source is not present for the current role/runtime, and HiveRunner does not pretend otherwise.
                </EmptySourceState>
              )}
            </>
          ) : (
            <EmptySourceState>Select an instruction source to inspect.</EmptySourceState>
          )}
        </Section>
      </div>
    </div>
  );
}

function Section({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        padding: "20px 22px",
        borderRadius: 18,
        background: UI.sectionBg,
        border: `0.5px solid ${UI.sectionBorder}`,
        boxShadow: UI.shadow,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 18 }}>
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 999,
            display: "grid",
            placeItems: "center",
            color: A.textSec,
            background: UI.surfaceHover,
            border: `0.5px solid ${UI.surfaceBorder}`,
            flexShrink: 0,
          }}
        >
          {icon}
        </div>
        <div>
          <div style={{ fontSize: 17, fontWeight: 600, color: A.text }}>{title}</div>
          <div style={{ marginTop: 4, fontSize: 12, color: A.muted, lineHeight: 1.6 }}>{subtitle}</div>
        </div>
      </div>
      {children}
    </div>
  );
}

function SummaryCard({
  eyebrow,
  title,
  subtitle,
  accent,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  accent?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        padding: "18px 18px 16px",
        borderRadius: 16,
        background: accent ? UI.surfaceHover : UI.surface,
        border: `0.5px solid ${accent ? A.cardBorder : UI.surfaceBorder}`,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: UI.label }}>
        {eyebrow}
      </div>
      <div style={{ marginTop: 6, fontSize: 18, fontWeight: 600, color: A.text }}>{title}</div>
      <div style={{ marginTop: 6, fontSize: 12, color: A.textSec, lineHeight: 1.6 }}>{subtitle}</div>
      <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>{children}</div>
    </div>
  );
}

function SummaryRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "112px minmax(0, 1fr)",
        gap: 10,
        alignItems: "start",
      }}
    >
      <span style={{ fontSize: 11, color: UI.label, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
        {label}
      </span>
      <span
        style={{
          fontSize: 13,
          color: A.text,
          lineHeight: 1.55,
          fontFamily: mono ? "monospace" : "inherit",
          wordBreak: "break-word",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function PathNote({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div
      style={{
        padding: "12px 13px",
        borderRadius: 12,
        border: `0.5px solid ${UI.divider}`,
        background: UI.surface,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, color: A.text, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 12, color: A.textSec, lineHeight: 1.6 }}>{children}</div>
    </div>
  );
}

function SourceSummary({ source }: { source: InstructionSource }) {
  return (
    <div
      style={{
        padding: "10px 12px",
        borderRadius: 12,
        border: `0.5px solid ${UI.divider}`,
        background: UI.surface,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: A.text }}>{source.label}</span>
        <StatusPill status={source.status} />
      </div>
      <div style={{ fontSize: 12, color: A.textSec, lineHeight: 1.55 }}>{source.note}</div>
    </div>
  );
}

function SourceGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 11, color: UI.label, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function SourceButton({
  source,
  active,
  onClick,
}: {
  source: InstructionSource;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: "100%",
        textAlign: "left",
        padding: "12px 13px",
        borderRadius: 14,
        border: `0.5px solid ${active ? A.cardBorder : UI.surfaceBorder}`,
        background: active ? UI.surfaceHover : UI.surface,
        cursor: "pointer",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        {source.kind === "runtime_file" ? <Wrench size={13} color={A.textSec} /> : <FileText size={13} color={A.textSec} />}
        <span style={{ fontSize: 13, fontWeight: 600, color: A.text }}>{source.label}</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
        <Pill>{kindLabel(source.kind)}</Pill>
        <StatusPill status={source.status} />
      </div>
      <div style={{ fontSize: 11, color: A.muted, lineHeight: 1.5 }}>
        {source.usedBy.length > 0 ? `Used by: ${source.usedBy.join(", ")}` : source.note}
      </div>
    </button>
  );
}

function Pill({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "4px 8px",
        borderRadius: 999,
        background: UI.surfaceHover,
        border: `0.5px solid ${UI.surfaceBorder}`,
        color: A.textSec,
        fontSize: 11,
        fontWeight: 600,
      }}
    >
      {children}
    </span>
  );
}

function StatusPill({ status }: { status: InstructionSource["status"] }) {
  const tone = statusTone(status);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "4px 8px",
        borderRadius: 999,
        background: tone.background,
        border: `0.5px solid ${tone.border}`,
        color: tone.color,
        fontSize: 11,
        fontWeight: 700,
      }}
    >
      {status}
    </span>
  );
}

function MetaGrid({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
        gap: 10,
      }}
    >
      {children}
    </div>
  );
}

function MetaRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div
      style={{
        padding: "12px 13px",
        borderRadius: 12,
        border: `0.5px solid ${UI.divider}`,
        background: UI.surface,
      }}
    >
      <div style={{ fontSize: 11, color: UI.label, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
        {label}
      </div>
      <div
        style={{
          fontSize: 12,
          color: A.text,
          lineHeight: 1.55,
          fontFamily: mono ? "monospace" : "inherit",
          wordBreak: "break-word",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function EmptyMiniState({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        padding: "12px 13px",
        borderRadius: 12,
        border: `1px dashed ${UI.surfaceBorder}`,
        background: UI.surface,
        fontSize: 12,
        color: A.muted,
      }}
    >
      {children}
    </div>
  );
}

function EmptySourceState({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        padding: "24px 18px",
        borderRadius: 14,
        border: `1px dashed ${UI.surfaceBorder}`,
        background: UI.surface,
        fontSize: 13,
        color: A.muted,
        lineHeight: 1.6,
      }}
    >
      {children}
    </div>
  );
}

function InlineStatus({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "error";
}) {
  return (
    <div
      style={{
        fontSize: 12,
        color: tone === "error" ? "var(--negative)" : A.muted,
        lineHeight: 1.6,
      }}
    >
      {children}
    </div>
  );
}

const noteStyle: CSSProperties = {
  fontSize: 12,
  color: A.muted,
  lineHeight: 1.65,
};

const primaryButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  minHeight: 38,
  padding: "0 13px",
  borderRadius: 10,
  border: `0.5px solid ${A.cardBorder}`,
  background: "transparent",
  color: A.text,
  fontSize: 12,
  fontWeight: 600,
};

const secondaryButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  minHeight: 38,
  padding: "0 13px",
  borderRadius: 10,
  border: `0.5px solid ${UI.surfaceBorder}`,
  background: UI.surface,
  color: A.textSec,
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};

const editorStyle: CSSProperties = {
  width: "100%",
  minHeight: 460,
  padding: 14,
  borderRadius: 14,
  background: UI.surfaceStrong,
  border: `0.5px solid ${UI.surfaceBorder}`,
  color: A.text,
  fontSize: 13,
  fontFamily: "monospace",
  lineHeight: 1.65,
  resize: "vertical",
  outline: "none",
  boxSizing: "border-box",
};

const previewStyle: CSSProperties = {
  margin: 0,
  padding: "16px 18px",
  borderRadius: 14,
  background: UI.surfaceStrong,
  border: `0.5px solid ${UI.surfaceBorder}`,
  color: A.text,
  fontSize: 13,
  fontFamily: "monospace",
  lineHeight: 1.65,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};
