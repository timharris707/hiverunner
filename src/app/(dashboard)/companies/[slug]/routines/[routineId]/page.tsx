"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Bot,
  Calendar,
  CheckCircle2,
  Clock,
  FolderOpen,
  Play,
  Repeat,
  Save,
  XCircle,
} from "lucide-react";
import {
  getRoutineDetail,
  listCompanyAgents,
  listProjects,
  updateRoutine as updateRoutineApi,
  runRoutineNow,
} from "@/lib/orchestration/client";
import type {
  OrchestrationAgent,
  OrchestrationProject,
  OrchestrationRoutineListItem,
} from "@/lib/orchestration/types";
import { buildCompanyPath } from "@/lib/orchestration/route-paths";

import { P as tokens, color } from "@/lib/ui/tokens";

const C = {
  bg: tokens.bg,
  card: tokens.surface,
  cardBorder: tokens.cardBorder,
  text: tokens.text,
  textSec: tokens.textSec,
  muted: tokens.muted,
  divider: tokens.cardBorder,
  accent: tokens.accent,
  green: color.positive,
  red: color.negative,
  blue: "#3b82f6",
};

type RunEntry = {
  id: string;
  source: string;
  status: string;
  triggeredAt: string;
  completedAt: string | null;
  failureReason: string | null;
};

type DetailData = {
  routine: OrchestrationRoutineListItem;
  runs: RunEntry[];
};

const CONCURRENCY_LABELS: Record<string, string> = {
  coalesce_if_active: "Coalesce if active",
  always_enqueue: "Always enqueue",
  skip_if_active: "Skip if active",
};

const CATCH_UP_LABELS: Record<string, string> = {
  skip_missed: "Skip missed",
  enqueue_missed_with_cap: "Enqueue missed (capped)",
};

const PRIORITY_STYLES: Record<string, { color: string; bg: string }> = {
  critical: { color: "#ef4444", bg: "rgba(239,68,68,0.12)" },
  high: { color: "#f97316", bg: "rgba(249,115,22,0.12)" },
  medium: { color: C.accent, bg: "rgba(217,119,6,0.12)" },
  low: { color: C.textSec, bg: "rgba(168,162,158,0.12)" },
};

const STATUS_STYLES: Record<string, { color: string; bg: string }> = {
  active: { color: C.green, bg: "rgba(34,197,94,0.12)" },
  paused: { color: C.accent, bg: "rgba(217,119,6,0.12)" },
  archived: { color: C.muted, bg: "rgba(87,83,78,0.12)" },
};

const RUN_STATUS_STYLES: Record<string, { color: string; bg: string }> = {
  completed: { color: C.green, bg: "rgba(34,197,94,0.12)" },
  running: { color: C.blue, bg: "rgba(59,130,246,0.12)" },
  failed: { color: C.red, bg: "rgba(239,68,68,0.12)" },
  cancelled: { color: C.muted, bg: "rgba(87,83,78,0.12)" },
  pending: { color: C.accent, bg: "rgba(217,119,6,0.12)" },
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  borderRadius: 8,
  border: `0.5px solid ${C.cardBorder}`,
  background: "transparent",
  padding: "10px 14px",
  fontSize: 13,
  color: C.text,
  outline: "none",
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  appearance: "none" as const,
  cursor: "pointer",
  paddingRight: 32,
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%2378716c' viewBox='0 0 24 24'%3E%3Cpath d='M7 10l5 5 5-5z'/%3E%3C/svg%3E")`,
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 10px center",
};

export default function RoutineDetailPage({
  params,
}: {
  params: Promise<{ slug: string; routineId: string }>;
}) {
  const { slug, routineId } = use(params);
  const [data, setData] = useState<DetailData | null>(null);
  const [agents, setAgents] = useState<OrchestrationAgent[]>([]);
  const [projects, setProjects] = useState<OrchestrationProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeAgentId, setAssigneeAgentId] = useState<string>("");
  const [projectId, setProjectId] = useState<string>("");
  const [concurrencyPolicy, setConcurrencyPolicy] = useState("");
  const [catchUpPolicy, setCatchUpPolicy] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    try {
      const [detail, agentList, projectList] = await Promise.all([
        getRoutineDetail(routineId),
        listCompanyAgents(slug),
        listProjects({ company: slug }),
      ]);
      if (!detail) { setError("Routine not found"); setLoading(false); return; }
      setData(detail);
      setTitle(detail.routine.title);
      setDescription(detail.routine.description);
      setAssigneeAgentId(detail.routine.assigneeAgentId ?? "");
      setProjectId(detail.routine.projectId ?? "");
      setConcurrencyPolicy(detail.routine.concurrencyPolicy);
      setCatchUpPolicy(detail.routine.catchUpPolicy);
      setAgents(agentList);
      setProjects(projectList);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
    setLoading(false);
  }, [slug, routineId]);

  useEffect(() => { void load(); }, [load]);

  const handleSave = async () => {
    if (!data || saving) return;
    setSaving(true);
    const updated = await updateRoutineApi(routineId, {
      title: title.trim(),
      description,
      assigneeAgentId: assigneeAgentId || null,
      projectId: projectId || null,
      concurrencyPolicy,
      catchUpPolicy,
    });
    if (updated) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      void load();
    }
    setSaving(false);
  };

  const handleToggleStatus = async () => {
    if (!data) return;
    const nextStatus = data.routine.status === "active" ? "paused" : "active";
    await updateRoutineApi(routineId, { status: nextStatus });
    void load();
  };

  const handleRunNow = async () => {
    if (running) return;
    setRunning(true);
    await runRoutineNow(routineId);
    setRunning(false);
    void load();
  };

  if (loading) return <div style={{ padding: 32, color: C.muted, fontSize: 13 }}>Loading...</div>;
  if (error) return <div style={{ padding: 32, color: "#fca5a5", fontSize: 13 }}>Error: {error}</div>;
  if (!data) return <div style={{ padding: 32, color: C.muted, fontSize: 13 }}>No routine data.</div>;

  const routine = data.routine;
  const st = STATUS_STYLES[routine.status] ?? STATUS_STYLES.paused;
  const isArchived = routine.status === "archived";

  return (
    <div style={{ padding: "24px 32px", maxWidth: 860 }}>
      {/* Back link */}
      <Link
        href={buildCompanyPath(slug, "/routines")}
        className="no-underline"
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          fontSize: 13, color: C.textSec, marginBottom: 16,
        }}
      >
        <ArrowLeft size={14} />
        All routines
      </Link>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Repeat size={20} style={{ color: C.accent }} />
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: C.text }}>{routine.title}</h1>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
              <span style={{
                fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 4,
                color: st.color, background: st.bg,
              }}>
                {routine.status}
              </span>
              {routine.agentName && (
                <span style={{ fontSize: 12, color: C.textSec, display: "flex", alignItems: "center", gap: 4 }}>
                  <Bot size={12} /> {routine.agentName}
                </span>
              )}
              {routine.projectName && (
                <span style={{ fontSize: 12, color: C.textSec, display: "flex", alignItems: "center", gap: 4 }}>
                  <FolderOpen size={12} /> {routine.projectName}
                </span>
              )}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          {/* Status toggle */}
          {!isArchived && (
            <button
              type="button"
              onClick={() => void handleToggleStatus()}
              style={{
                padding: "8px 16px", borderRadius: 8,
                border: `0.5px solid ${C.cardBorder}`,
                background: "rgba(120,113,108,0.1)",
                fontSize: 12, fontWeight: 500, color: C.textSec,
                cursor: "pointer",
              }}
            >
              {routine.status === "active" ? "Pause" : "Resume"}
            </button>
          )}
          {/* Run Now */}
          {!isArchived && (
            <button
              type="button"
              onClick={() => void handleRunNow()}
              disabled={running}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "8px 16px", borderRadius: 8,
                border: `0.5px solid ${C.cardBorder}`,
                background: "rgba(34,197,94,0.08)",
                fontSize: 12, fontWeight: 600, color: C.green,
                cursor: running ? "wait" : "pointer",
                opacity: running ? 0.6 : 1,
              }}
            >
              <Play size={12} />
              {running ? "Running..." : "Run Now"}
            </button>
          )}
        </div>
      </div>

      {/* Edit section */}
      <Section title="Configuration" icon={<Calendar size={14} />}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={{ display: "block", fontSize: 12, color: C.muted, marginBottom: 4 }}>Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              style={inputStyle}
              disabled={isArchived}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: 12, color: C.muted, marginBottom: 4 }}>Instructions</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add instructions for this routine..."
              rows={4}
              style={{ ...inputStyle, resize: "vertical", minHeight: 60 }}
              disabled={isArchived}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={{ display: "block", fontSize: 12, color: C.muted, marginBottom: 4 }}>Assignee</label>
              <select
                value={assigneeAgentId}
                onChange={(e) => setAssigneeAgentId(e.target.value)}
                style={selectStyle}
                disabled={isArchived}
              >
                <option value="">No assignee</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: "block", fontSize: 12, color: C.muted, marginBottom: 4 }}>Project</label>
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                style={selectStyle}
                disabled={isArchived}
              >
                <option value="">No project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={{ display: "block", fontSize: 12, color: C.muted, marginBottom: 4 }}>Concurrency Policy</label>
              <select
                value={concurrencyPolicy}
                onChange={(e) => setConcurrencyPolicy(e.target.value)}
                style={selectStyle}
                disabled={isArchived}
              >
                {Object.entries(CONCURRENCY_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: "block", fontSize: 12, color: C.muted, marginBottom: 4 }}>Catch-up Policy</label>
              <select
                value={catchUpPolicy}
                onChange={(e) => setCatchUpPolicy(e.target.value)}
                style={selectStyle}
                disabled={isArchived}
              >
                {Object.entries(CATCH_UP_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
          </div>

          {!isArchived && (
            <div>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving || !title.trim()}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "8px 20px", borderRadius: 8,
                  border: `0.5px solid ${C.cardBorder}`,
                  background: "rgba(120,113,108,0.15)",
                  fontSize: 13, fontWeight: 600, color: C.text,
                  cursor: saving ? "wait" : "pointer",
                  opacity: saving || !title.trim() ? 0.5 : 1,
                }}
              >
                <Save size={13} />
                {saving ? "Saving..." : saved ? "Saved" : "Save Changes"}
              </button>
            </div>
          )}
        </div>
      </Section>

      {/* Properties */}
      <Section title="Properties" icon={<Clock size={14} />}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <PropRow label="Priority">
            {(() => {
              const ps = PRIORITY_STYLES[routine.priority] ?? PRIORITY_STYLES.medium;
              return (
                <span style={{
                  fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 4,
                  color: ps.color, background: ps.bg,
                }}>
                  {routine.priority}
                </span>
              );
            })()}
          </PropRow>
          <PropRow label="Last run">
            {routine.lastRun ? (
              <span style={{ fontSize: 13, color: C.textSec }}>
                {new Date(routine.lastRun.triggeredAt).toLocaleString()} — {routine.lastRun.status}
              </span>
            ) : (
              <span style={{ fontSize: 13, color: C.muted, fontStyle: "italic" }}>Never</span>
            )}
          </PropRow>
          <PropRow label="Created">
            <span style={{ fontSize: 13, color: C.textSec }}>
              {new Date(routine.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </span>
          </PropRow>
          <PropRow label="Updated">
            <span style={{ fontSize: 13, color: C.textSec }}>
              {new Date(routine.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </span>
          </PropRow>
        </div>
      </Section>

      {/* Triggers — honest limitation */}
      <Section title="Triggers" icon={<Calendar size={14} />}>
        <p style={{ margin: 0, fontSize: 13, color: C.muted, fontStyle: "italic" }}>
          Trigger configuration (schedule, webhook) is not yet available in HiveRunner.
          Routines can be run manually with &ldquo;Run Now&rdquo; above.
        </p>
      </Section>

      {/* Recent Runs */}
      <Section title="Recent Runs" icon={<Repeat size={14} />}>
        {data.runs.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <div style={{
              display: "grid", gridTemplateColumns: "80px 90px 90px 1fr 100px",
              gap: 8, padding: "6px 0",
              borderBottom: `0.5px solid ${C.divider}`,
            }}>
              {["Source", "Status", "Triggered", "Failure", "Completed"].map((h) => (
                <span key={h} style={{
                  fontSize: 11, fontWeight: 600, color: C.muted,
                  textTransform: "uppercase", letterSpacing: "0.04em",
                }}>
                  {h}
                </span>
              ))}
            </div>
            {data.runs.map((run, i) => {
              const rs = RUN_STATUS_STYLES[run.status] ?? RUN_STATUS_STYLES.pending;
              return (
                <div
                  key={run.id}
                  style={{
                    display: "grid", gridTemplateColumns: "80px 90px 90px 1fr 100px",
                    gap: 8, padding: "8px 0",
                    borderBottom: i < data.runs.length - 1 ? `0.5px solid ${C.divider}` : undefined,
                  }}
                >
                  <span style={{ fontSize: 12, color: C.textSec }}>{run.source}</span>
                  <span style={{
                    fontSize: 11, fontWeight: 500, padding: "1px 6px", borderRadius: 4,
                    color: rs.color, background: rs.bg, width: "fit-content",
                  }}>
                    {run.status}
                  </span>
                  <span style={{ fontSize: 12, color: C.muted }}>
                    {formatRelative(run.triggeredAt)}
                  </span>
                  <span style={{ fontSize: 12, color: run.failureReason ? C.red : C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {run.failureReason || "—"}
                  </span>
                  <span style={{ fontSize: 12, color: C.muted }}>
                    {run.completedAt ? formatRelative(run.completedAt) : "—"}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <p style={{ margin: 0, fontSize: 13, color: C.muted, fontStyle: "italic" }}>
            No runs recorded for this routine.
          </p>
        )}
      </Section>
    </div>
  );
}

/* ─── Helpers ─── */

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{
      marginBottom: 20, padding: "16px 20px", borderRadius: 10,
      border: `0.5px solid ${C.cardBorder}`, background: C.card,
    }}>
      <h3 style={{
        margin: "0 0 14px", fontSize: 14, fontWeight: 600, color: C.text,
        display: "flex", alignItems: "center", gap: 8,
      }}>
        {icon}
        {title}
      </h3>
      {children}
    </div>
  );
}

function PropRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <span style={{ width: 100, fontSize: 12, color: C.muted, flexShrink: 0 }}>{label}</span>
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
