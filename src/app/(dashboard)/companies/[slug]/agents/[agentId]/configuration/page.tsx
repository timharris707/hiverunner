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
}

interface PeerAgent {
  id: string;
  name: string;
  role?: string;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

const MODEL_OPTIONS = [
  "anthropic/claude-opus-4-6",
  "anthropic/claude-sonnet-4-6",
  "openai-codex/gpt-5.4",
  "google/gemini-3.1-pro-preview",
];

const UI = {
  sectionBg: "rgba(2,6,23,0.52)",
  sectionBorder: "rgba(255,255,255,0.1)",
  surface: "rgba(15,23,42,0.52)",
  surfaceBorder: "rgba(255,255,255,0.1)",
  surfaceStrong: "rgba(15,23,42,0.74)",
  accentSurface: "rgba(245,158,11,0.08)",
  accentBorder: "rgba(245,158,11,0.22)",
  divider: "rgba(255,255,255,0.08)",
  label: "#94a3b8",
  shadow: "0 12px 32px rgba(2,6,23,0.22)",
};

const FIELD_LABEL_WIDTH = 176;

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

  const openclawId = agent.openclawAgentId || agent.id;
  const resolved = resolveAgentProviderPresentation(agent);
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

  useEffect(() => {
    fetch(`/api/orchestration/agents/${encodeURIComponent(openclawId)}/openclaw-config`)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then((data) => { setOc(data); setOcError(null); })
      .catch((e) => { setOcError(e.message); setOc(null); })
      .finally(() => setOcLoading(false));
  }, [openclawId]);

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

  const patchConfig = useCallback(
    async (body: Record<string, unknown>) => {
      const res = await fetch(
        `/api/orchestration/agents/${encodeURIComponent(openclawId)}/openclaw-config`,
        { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      );
      if (!res.ok) throw new Error(`${res.status}`);
      reload();
      return res.json();
    },
    [openclawId, reload],
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
            <SummaryListRow label="Model" value={oc?.model || agent.model || "\u2014"} mono />
            <SummaryListRow label="Workspace" value={oc?.workspace || "\u2014"} mono />
            <SummaryListRow label="Agent dir" value={oc?.agentDir || "\u2014"} mono />
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
        subtitle="Execution defaults, heartbeat behavior, and operator-facing runtime stats."
      >
        <EditableSelect
          label="Model"
          value={oc?.model || agent.model || ""}
          options={MODEL_OPTIONS.map((m) => ({ value: m, label: m }))}
          onSave={(v) => patchConfig({ model: v })}
          mono
        />
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
            value={agent.lastHeartbeat ? "Enabled" : "Disabled"}
            detail={agent.lastHeartbeat ? `Last: ${new Date(agent.lastHeartbeat).toLocaleString()}` : "No recent heartbeat recorded."}
            badge={<TogglePill enabled={!!agent.lastHeartbeat} label={agent.lastHeartbeat ? "Enabled" : "Disabled"} />}
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
        subtitle="Company-granted capabilities surfaced in the configuration view."
      >
        <PermissionRow
          label="Can create new agents"
          enabled={false}
          description="Lets this agent create or hire agents and implicitly assign tasks."
        />
        <PermissionRow
          label="Can assign tasks"
          enabled={true}
          description="Enabled via explicit company permission grant."
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
        color: "#fbbf24",
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
        boxShadow: accent ? "none" : "inset 0 1px 0 rgba(255,255,255,0.03)",
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
}: {
  label: string;
  enabled: boolean;
  description: string;
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
      <TogglePill enabled={enabled} label={enabled ? "On" : "Off"} />
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
            color: "#fbbf24",
            background: "rgba(245,158,11,0.08)",
            border: `1px solid ${UI.accentBorder}`,
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
