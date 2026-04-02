"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Settings,
  ChevronDown,
  ChevronRight,
  Key,
  Shield,
  Cpu,
  CheckCircle,
  XCircle,
  FileText,
  Check,
  Loader2,
  X,
} from "lucide-react";
import { useAgentProfile, A } from "../layout";
import { listCompanyAgents } from "@/lib/orchestration/client";

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
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

const MODEL_OPTIONS = [
  "anthropic/claude-opus-4-6",
  "anthropic/claude-sonnet-4-6",
  "openai-codex/gpt-5.4",
  "google/gemini-3.1-pro-preview",
];

/* ── Main Page ── */
export default function AgentConfigurationPage() {
  const { profile, slug, reload } = useAgentProfile();
  const { agent } = profile;

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [oc, setOc] = useState<OpenClawConfig | null>(null);
  const [ocError, setOcError] = useState<string | null>(null);
  const [ocLoading, setOcLoading] = useState(true);
  const [peers, setPeers] = useState<PeerAgent[]>([]);

  const openclawId = agent.openclawAgentId || agent.id;

  useEffect(() => {
    setOcLoading(true);
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
          .map((a) => ({ id: a.id, name: a.name })),
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
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* ── Identity ── */}
      <Section icon={<Settings size={13} />} title="Identity">
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
          options={[{ value: "", label: "\u2014 None \u2014" }, ...peers.map((p) => ({ value: p.id, label: p.name }))]}
          onSave={(v) => patchConfig({ reportsTo: v || null })}
        />
        <EditableTextarea
          label="Capabilities"
          value={agent.personality ?? ""}
          onSave={(v) => patchConfig({ personality: v })}
        />
      </Section>

      {/* ── Adapter ── */}
      <Section icon={<Cpu size={13} />} title="Adapter">
        <ReadOnlyRow label="Adapter type" value={agent.openclawAgentId ? "OpenClaw" : agent.paperclipAgentId ? "Paperclip" : "Manual"} />
        <ReadOnlyRow label="Workspace" value={oc?.workspace || "\u2014"} mono />
        <ReadOnlyRow label="Agent Dir" value={oc?.agentDir || "\u2014"} mono />
        <EditableSelect
          label="Model"
          value={oc?.model || agent.model || ""}
          options={MODEL_OPTIONS.map((m) => ({ value: m, label: m }))}
          onSave={(v) => patchConfig({ model: v })}
          mono
        />
        {agent.openclawAgentId && <ReadOnlyRow label="OpenClaw Agent ID" value={agent.openclawAgentId} mono />}
        {agent.paperclipAgentId && <ReadOnlyRow label="Paperclip Agent ID" value={agent.paperclipAgentId} mono />}
        {ocLoading && (
          <div style={{ fontSize: 11, color: A.muted, marginTop: 4 }}>Loading OpenClaw config…</div>
        )}
        {ocError && (
          <div style={{ fontSize: 11, color: "#ef4444", marginTop: 4 }}>Failed to load OpenClaw config ({ocError})</div>
        )}
      </Section>

      {/* ── Run Policy ── */}
      <Section icon={<Settings size={13} />} title="Run Policy">
        <EditableSelect
          label="Model"
          value={oc?.model || agent.model || ""}
          options={MODEL_OPTIONS.map((m) => ({ value: m, label: m }))}
          onSave={(v) => patchConfig({ model: v })}
          mono
        />
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
          <span style={{ fontSize: 12, color: A.textSec, width: 160 }}>Heartbeat interval</span>
          <TogglePill enabled={!!agent.lastHeartbeat} label={agent.lastHeartbeat ? "Enabled" : "Disabled"} />
          {agent.lastHeartbeat && (
            <span style={{ fontSize: 11, color: A.muted }}>Last: {new Date(agent.lastHeartbeat).toLocaleString()}</span>
          )}
        </div>
        <ReadOnlyRow label="Sessions" value={String(oc?.sessionCount ?? "\u2014")} />
        <ReadOnlyRow label="Total runtime" value={`${agent.totalRuntimeMinutes ?? 0} minutes`} />
        <ReadOnlyRow label="Tasks completed" value={String(agent.tasksCompleted ?? 0)} />

        {/* Advanced collapsible */}
        <button
          onClick={() => setAdvancedOpen(!advancedOpen)}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            marginTop: 10, padding: 0, background: "none", border: "none",
            color: A.accent, fontSize: 11, fontWeight: 600, cursor: "pointer",
          }}
        >
          {advancedOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          Advanced Run Policy
        </button>
        {advancedOpen && (
          <div style={{ marginTop: 8, padding: "10px 12px", borderRadius: 6, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
            <ReadOnlyRow label="Status" value={agent.status} />
            <ReadOnlyRow label="Current task" value={agent.currentTask ?? "\u2014"} mono />
            <ReadOnlyRow label="Created" value={agent.created ? new Date(agent.created).toLocaleString() : "\u2014"} />
            <ReadOnlyRow label="Updated" value={agent.updated ? new Date(agent.updated).toLocaleString() : "\u2014"} />
          </div>
        )}
      </Section>

      {/* ── Identity Files ── */}
      {oc && (
        <Section icon={<FileText size={13} />} title="Identity Files">
          <FileStatus label="IDENTITY.md" exists={oc.identityExists} preview={oc.identityPreview} />
          <FileStatus label="SOUL.md" exists={oc.soulExists} preview={oc.soulPreview} />
        </Section>
      )}

      {/* ── Permissions ── */}
      <Section icon={<Shield size={13} />} title="Permissions">
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
          <span style={{ fontSize: 12, color: A.textSec, width: 200 }}>Can create new agents</span>
          <TogglePill enabled={false} label="Off" />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 12, color: A.textSec, width: 200 }}>Can assign tasks</span>
          <TogglePill enabled={true} label="On" />
        </div>
      </Section>

      {/* ── API Keys ── */}
      <Section icon={<Key size={13} />} title="API Keys">
        <div style={{ padding: 20, textAlign: "center", color: A.muted, fontSize: 12, borderRadius: 6, border: "1px dashed rgba(120,113,108,0.35)" }}>
          No API keys configured for this agent
        </div>
      </Section>
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
        fontSize: 10, fontWeight: 500, marginLeft: 6,
        color: status === "saving" ? A.accentLight : status === "saved" ? "#6ee7b7" : "#ef4444",
        transition: "opacity 0.3s",
      }}
    >
      {status === "saving" && <><Loader2 size={10} style={{ animation: "spin 1s linear infinite" }} /> Saving…</>}
      {status === "saved" && <><Check size={10} /> Saved</>}
      {status === "error" && <>Failed</>}
    </span>
  );
}

/* ── Editable text input ── */
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
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
      <span style={{ fontSize: 12, color: A.textSec, width: 160, flexShrink: 0 }}>{label}</span>
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
      <SaveIndicator status={status} />
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
    <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 8 }}>
      <span style={{ fontSize: 12, color: A.textSec, width: 160, flexShrink: 0, paddingTop: 4 }}>{label}</span>
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
            cursor: "pointer",
            minHeight: 20,
          }}
          title="Click to edit"
        >
          {value || "\u2014"}
        </span>
      )}
      <SaveIndicator status={status} />
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
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onSave: (v: string) => Promise<unknown>;
  mono?: boolean;
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

  const displayLabel = options.find((o) => o.value === value)?.label || value || "\u2014";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
      <span style={{ fontSize: 12, color: A.textSec, width: 160, flexShrink: 0 }}>{label}</span>
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
      <SaveIndicator status={status} />
    </div>
  );
}

/* ── Editable tag input ── */
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
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
      <span style={{ fontSize: 12, color: A.textSec, width: 160, flexShrink: 0 }}>{label}</span>
      <span style={{
        fontSize: 12, color: A.text,
        fontFamily: mono ? "monospace" : "inherit",
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
      }}>
        {value}
      </span>
    </div>
  );
}

/* ── Section wrapper ── */
function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div style={{
      padding: "14px 16px", borderRadius: 10,
      background: A.card, border: `1px solid ${A.cardBorder}`,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12, color: A.accent, fontSize: 12, fontWeight: 600 }}>
        {icon}
        {title}
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
      padding: "3px 10px", borderRadius: 10,
      background: enabled ? "rgba(217,119,6,0.12)" : "rgba(120,113,108,0.12)",
      border: `1px solid ${enabled ? A.cardBorder : "rgba(120,113,108,0.2)"}`,
      fontSize: 11, color: enabled ? A.accentLight : A.muted,
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
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        {exists ? (
          <CheckCircle size={13} style={{ color: "#22c55e" }} />
        ) : (
          <XCircle size={13} style={{ color: A.muted }} />
        )}
        <span style={{ fontSize: 12, color: A.text, fontWeight: 500 }}>{label}</span>
        <span style={{ fontSize: 11, color: exists ? "#6ee7b7" : A.muted }}>
          {exists ? "Found" : "Not found"}
        </span>
      </div>
      {exists && preview && (
        <div style={{
          marginLeft: 21, padding: "8px 10px", borderRadius: 6,
          background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)",
          fontSize: 11, color: A.textSec, fontFamily: "monospace",
          whiteSpace: "pre-wrap", lineHeight: 1.5,
          maxHeight: 100, overflow: "hidden",
        }}>
          {preview}
        </div>
      )}
    </div>
  );
}

/* ── Shared styles ── */
const inputStyle = (mono?: boolean): React.CSSProperties => ({
  flex: 1,
  fontSize: 12,
  color: A.text,
  fontFamily: mono ? "monospace" : "inherit",
  background: "#1a1814",
  border: `1px solid ${A.accentLight}`,
  borderRadius: 4,
  padding: "4px 8px",
  outline: "none",
  lineHeight: "1.4",
});

const displayStyle = (mono?: boolean): React.CSSProperties => ({
  fontSize: 12,
  color: A.text,
  fontFamily: mono ? "monospace" : "inherit",
  cursor: "pointer",
  borderRadius: 4,
  padding: "2px 6px",
  border: "1px solid transparent",
  transition: "border-color 0.15s",
  flex: 1,
  overflow: "hidden",
  textOverflow: "ellipsis",
});

const tagStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "2px 8px",
  borderRadius: 4,
  background: "rgba(217,119,6,0.12)",
  border: `1px solid ${A.cardBorder}`,
  fontSize: 11,
  color: A.accentLight,
};
