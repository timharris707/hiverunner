"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  BarChart3,
  Bug,
  ChevronDown,
  ChevronRight,
  FileSearch,
  GitPullRequest,
  MoreHorizontal,
  Newspaper,
  Plus,
  ShieldCheck,
  Zap,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { buildCompanyPath } from "@/lib/orchestration/route-paths";

import { CompanyErrorState } from "@/components/company/company-ui";
import { AvatarGlyph } from "@/components/orchestration/AvatarGlyph";
import { agentDisplayLabel } from "@/lib/orchestration/avatar-icons";
import {
  listCompanies,
  listCompanyAgents,
  listCompanyRoutines,
  listProjects,
  createCompanyRoutine,
  updateRoutine as updateRoutineApi,
  runRoutineNow,
} from "@/lib/orchestration/client";
import type {
  OrchestrationAgent,
  OrchestrationCompany,
  OrchestrationProject,
  OrchestrationRoutineListItem,
  RoutineStatus,
} from "@/lib/orchestration/types";

/* ── Policy constants ── */

const concurrencyPolicies = ["coalesce_if_active", "always_enqueue", "skip_if_active"] as const;
const catchUpPolicies = ["skip_missed", "enqueue_missed_with_cap"] as const;
const concurrencyPolicyDescriptions: Record<string, string> = {
  coalesce_if_active: "If a run is already active, keep just one follow-up run queued.",
  always_enqueue: "Queue every trigger occurrence, even if the routine is already running.",
  skip_if_active: "Drop new trigger occurrences while a run is still active.",
};
const catchUpPolicyDescriptions: Record<string, string> = {
  skip_missed: "Ignore windows that were missed while the scheduler or routine was paused.",
  enqueue_missed_with_cap: "Catch up missed schedule windows in capped batches after recovery.",
};

type RoutineTemplate = {
  title: string;
  description: string;
  priority: "critical" | "high" | "medium" | "low";
  icon: LucideIcon;
};

const ROUTINE_TEMPLATES: RoutineTemplate[] = [
  {
    title: "Daily news digest",
    description: "Search and summarize the latest relevant news for the team.",
    priority: "medium",
    icon: Newspaper,
  },
  {
    title: "PR review reminder",
    description: "Flag stale pull requests that need review or a next action.",
    priority: "medium",
    icon: GitPullRequest,
  },
  {
    title: "Bug triage",
    description: "Assess new bug reports, assign ownership, and recommend priority.",
    priority: "high",
    icon: Bug,
  },
  {
    title: "Weekly progress report",
    description: "Compile a weekly summary of completed work, blockers, and next priorities.",
    priority: "medium",
    icon: BarChart3,
  },
  {
    title: "Dependency audit",
    description: "Scan for outdated packages, security advisories, and upgrade risks.",
    priority: "high",
    icon: ShieldCheck,
  },
  {
    title: "Documentation check",
    description: "Review recent changes for missing docs, stale references, and onboarding gaps.",
    priority: "low",
    icon: FileSearch,
  },
];

function formatAgentOption(agent: OrchestrationAgent): string {
  return agentDisplayLabel(agent.emoji, agent.name);
}

/* ── Helpers ── */

function formatLastRunTimestamp(value: string | null | undefined) {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}

function nextRoutineStatus(currentStatus: RoutineStatus, enabled: boolean): RoutineStatus {
  if (currentStatus === "archived" && enabled) return "active";
  return enabled ? "active" : "paused";
}

/* ── Shared styles ── */

const inputStyle: React.CSSProperties = {
  borderRadius: "10px",
  border: "0.5px solid var(--border-strong)",
  background: "transparent",
  padding: "8px 12px",
  fontSize: "13px",
  color: "var(--text-primary)",
  outline: "none",
  width: "100%",
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  color: "var(--text-secondary)",
  appearance: "none",
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2378716c' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 10px center",
  paddingRight: "28px",
};

/* ── Component ── */

export default function CompanyRoutinesPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? "";

  const [company, setCompany] = useState<OrchestrationCompany | null>(null);
  const [projects, setProjects] = useState<OrchestrationProject[]>([]);
  const [agents, setAgents] = useState<OrchestrationAgent[]>([]);
  const [routines, setRoutines] = useState<OrchestrationRoutineListItem[]>([]);
  const [loading, setLoading] = useState(true);

  /* ── Create dialog state ── */
  const [composerOpen, setComposerOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({
    title: "",
    description: "",
    projectId: "",
    assigneeAgentId: "",
    priority: "medium",
    concurrencyPolicy: "coalesce_if_active",
    catchUpPolicy: "skip_missed",
  });

  /* ── Action state ── */
  const [runningRoutineId, setRunningRoutineId] = useState<string | null>(null);
  const [statusMutatingId, setStatusMutatingId] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  /* ── Data loading ── */
  const loadAll = useCallback(async () => {
    let cancelled = false;
    try {
      const [companyRows, projectRows, agentRows, routineRows] = await Promise.all([
        listCompanies(),
        listProjects({ company: slug }),
        listCompanyAgents(slug),
        listCompanyRoutines(slug),
      ]);
      if (cancelled) return;
      setCompany(companyRows.find((r) => r.slug === slug) ?? null);
      setProjects(projectRows);
      setAgents(agentRows);
      setRoutines(routineRows);
    } finally {
      if (!cancelled) setLoading(false);
    }
    return () => { cancelled = true; };
  }, [slug]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const cleanup = await loadAll();
      if (cancelled && cleanup) cleanup();
    };
    void run();
    return () => { cancelled = true; };
  }, [loadAll]);

  const projectById = useMemo(
    () => new Map(projects.map((p) => [p.id, p])),
    [projects]
  );

  /* ── Create handler ── */
  const handleCreate = async () => {
    if (!draft.title.trim() || !draft.projectId || !draft.assigneeAgentId) return;
    setCreating(true);
    const result = await createCompanyRoutine(slug, {
      title: draft.title.trim(),
      description: draft.description.trim() || undefined,
      projectId: draft.projectId,
      assigneeAgentId: draft.assigneeAgentId,
      priority: draft.priority,
      concurrencyPolicy: draft.concurrencyPolicy,
      catchUpPolicy: draft.catchUpPolicy,
    });
    if (result) {
      setDraft({ title: "", description: "", projectId: "", assigneeAgentId: "", priority: "medium", concurrencyPolicy: "coalesce_if_active", catchUpPolicy: "skip_missed" });
      setComposerOpen(false);
      setAdvancedOpen(false);
      const updatedRoutines = await listCompanyRoutines(slug);
      setRoutines(updatedRoutines);
    }
    setCreating(false);
  };

  const openRoutineComposer = (template?: RoutineTemplate) => {
    setDraft((current) => ({
      ...current,
      title: template?.title ?? "",
      description: template?.description ?? "",
      priority: template?.priority ?? "medium",
    }));
    setAdvancedOpen(false);
    setComposerOpen(true);
  };

  /* ── Status toggle ── */
  const handleToggleStatus = async (routine: OrchestrationRoutineListItem) => {
    const enabled = routine.status === "active";
    const newStatus = nextRoutineStatus(routine.status, !enabled);
    setStatusMutatingId(routine.id);
    await updateRoutineApi(routine.id, { status: newStatus });
    const updated = await listCompanyRoutines(slug);
    setRoutines(updated);
    setStatusMutatingId(null);
  };

  /* ── Run now ── */
  const handleRunNow = async (routine: OrchestrationRoutineListItem) => {
    setRunningRoutineId(routine.id);
    setOpenMenuId(null);
    await runRoutineNow(routine.id);
    const updated = await listCompanyRoutines(slug);
    setRoutines(updated);
    setRunningRoutineId(null);
  };

  if (!loading && !company) {
    return <CompanyErrorState title="Company not found" detail="This company could not be resolved from orchestration data." href="/" />;
  }

  return (
    <div style={{ padding: "24px 32px" }}>
      {/* ── Page header ── */}
      <div style={{ marginBottom: "24px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px" }}>
          <div>
            <h1 style={{ fontSize: "24px", fontWeight: 600, letterSpacing: "-0.01em", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "10px" }}>
              Routines
              <span style={{
                display: "inline-flex",
                alignItems: "center",
                borderRadius: "999px",
                background: "var(--warning-soft)",
                padding: "2px 10px",
                fontSize: "11px",
                fontWeight: 500,
                color: "var(--warning)",
                letterSpacing: "0.02em",
              }}>
                Beta
              </span>
            </h1>
            <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginTop: "4px" }}>
              Recurring work definitions that materialize into auditable execution tasks.
            </p>
          </div>
          <button
            type="button"
            onClick={() => openRoutineComposer()}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              padding: "8px 16px",
              borderRadius: "8px",
              border: "0.5px solid var(--border-strong)",
              background: "transparent",
              color: "var(--text-secondary)",
              fontSize: "13px",
              fontWeight: 500,
              cursor: "pointer",
              whiteSpace: "nowrap",
              flexShrink: 0,
              transition: "all 120ms ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "rgba(168,162,158,0.5)";
              e.currentTarget.style.background = "var(--surface-hover)";
              e.currentTarget.style.color = "var(--text-primary)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "var(--border-strong)";
              e.currentTarget.style.background = "var(--surface)";
              e.currentTarget.style.color = "var(--text-secondary)";
            }}
          >
            <Plus size={14} strokeWidth={2.2} />
            Create routine
          </button>
        </div>
      </div>

      {/* ── Create dialog (modal overlay) ── */}
      {composerOpen ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 50,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--modal-backdrop)",
            backdropFilter: "blur(4px)",
          }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !creating) {
              setComposerOpen(false);
              setAdvancedOpen(false);
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Create routine"
            style={{
              width: "100%",
              maxWidth: "720px",
              maxHeight: "calc(100dvh - 2rem)",
              display: "flex",
              flexDirection: "column",
              borderRadius: "16px",
              border: "1px solid var(--border)",
              background: "var(--modal-glass)",
              boxShadow: "var(--shadow-glass)",
              overflow: "hidden",
            }}
          >
            {/* Dialog header */}
            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "14px 20px",
              borderBottom: "0.5px solid var(--border)",
              flexShrink: 0,
            }}>
              <div>
                <p style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.2em", color: "var(--text-muted)" }}>New routine</p>
                <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "2px" }}>
                  Define the recurring work first. Trigger setup comes next on the detail page.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close create routine"
                title="Close create routine"
                onClick={() => { setComposerOpen(false); setAdvancedOpen(false); }}
                disabled={creating}
                style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: "4px" }}
              >
                <X size={16} />
              </button>
            </div>

            {/* Dialog body */}
            <div style={{ flex: 1, overflow: "auto" }}>
              <div style={{ padding: "20px 20px 12px" }}>
                <textarea
                  value={draft.title}
                  onChange={(e) => {
                    setDraft((d) => ({ ...d, title: e.target.value }));
                    e.target.style.height = "auto";
                    e.target.style.height = `${e.target.scrollHeight}px`;
                  }}
                  placeholder="Routine title"
                  rows={1}
                  autoFocus
                  style={{
                    width: "100%",
                    background: "transparent",
                    border: "none",
                    outline: "none",
                    resize: "none",
                    overflow: "hidden",
                    fontSize: "20px",
                    fontWeight: 600,
                    color: "var(--text-primary)",
                  }}
                />
              </div>

              <div style={{ padding: "0 20px 12px", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "var(--text-secondary)", flexWrap: "wrap" }}>
                <span>For</span>
                <select
                  value={draft.assigneeAgentId}
                  onChange={(e) => setDraft((d) => ({ ...d, assigneeAgentId: e.target.value }))}
                  style={{ ...selectStyle, width: "auto", minWidth: "140px", maxWidth: "200px", padding: "6px 28px 6px 10px", fontSize: "12px" }}
                >
                  <option value="">Assignee</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>{formatAgentOption(a)}</option>
                  ))}
                </select>
                <span>in</span>
                <select
                  value={draft.projectId}
                  onChange={(e) => setDraft((d) => ({ ...d, projectId: e.target.value }))}
                  style={{ ...selectStyle, width: "auto", minWidth: "140px", maxWidth: "200px", padding: "6px 28px 6px 10px", fontSize: "12px" }}
                >
                  <option value="">Project</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              <div style={{ padding: "0 20px 16px", borderTop: "0.5px solid var(--border)" }}>
                <textarea
                  value={draft.description}
                  onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                  placeholder="Add instructions..."
                  rows={6}
                  style={{ ...inputStyle, border: "none", background: "transparent", padding: "16px 0", minHeight: "160px", resize: "vertical", lineHeight: "1.6" }}
                />
              </div>

              <div style={{ borderTop: "0.5px solid var(--border)", padding: "12px 20px" }}>
                <button
                  type="button"
                  onClick={() => setAdvancedOpen((v) => !v)}
                  style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", background: "none", border: "none", cursor: "pointer", textAlign: "left", padding: 0 }}
                >
                  <div>
                    <p style={{ fontSize: "13px", fontWeight: 500, color: "var(--text-primary)" }}>Advanced delivery settings</p>
                    <p style={{ fontSize: "12px", color: "var(--text-secondary)" }}>Keep policy controls secondary to the work definition.</p>
                  </div>
                  {advancedOpen ? <ChevronDown size={14} color="var(--text-muted)" /> : <ChevronRight size={14} color="var(--text-muted)" />}
                </button>
                {advancedOpen ? (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", paddingTop: "12px" }}>
                    <div>
                      <p style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.18em", color: "var(--text-muted)", marginBottom: "6px" }}>Concurrency</p>
                      <select value={draft.concurrencyPolicy} onChange={(e) => setDraft((d) => ({ ...d, concurrencyPolicy: e.target.value }))} style={selectStyle}>
                        {concurrencyPolicies.map((v) => (<option key={v} value={v}>{v.replaceAll("_", " ")}</option>))}
                      </select>
                      <p style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "4px" }}>{concurrencyPolicyDescriptions[draft.concurrencyPolicy]}</p>
                    </div>
                    <div>
                      <p style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.18em", color: "var(--text-muted)", marginBottom: "6px" }}>Catch-up</p>
                      <select value={draft.catchUpPolicy} onChange={(e) => setDraft((d) => ({ ...d, catchUpPolicy: e.target.value }))} style={selectStyle}>
                        {catchUpPolicies.map((v) => (<option key={v} value={v}>{v.replaceAll("_", " ")}</option>))}
                      </select>
                      <p style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "4px" }}>{catchUpPolicyDescriptions[draft.catchUpPolicy]}</p>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            {/* Dialog footer */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", padding: "16px 20px", borderTop: "0.5px solid var(--border)", flexShrink: 0 }}>
              <p style={{ fontSize: "12px", color: "var(--text-muted)", maxWidth: "360px" }}>
                After creation, you can configure triggers for schedules, webhooks, or internal runs.
              </p>
              <button
                type="button"
                onClick={handleCreate}
                disabled={creating || !draft.title.trim() || !draft.projectId || !draft.assigneeAgentId}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "8px 16px",
                  borderRadius: "8px",
                  border: "0.5px solid var(--border-strong)",
                  background: creating ? "transparent" : "transparent",
                  color: (!draft.title.trim() || !draft.projectId || !draft.assigneeAgentId) ? "color-mix(in srgb, var(--text-muted) 72%, transparent)" : "var(--text-primary)",
                  fontSize: "13px",
                  fontWeight: 500,
                  cursor: creating ? "wait" : (!draft.title.trim() || !draft.projectId || !draft.assigneeAgentId) ? "not-allowed" : "pointer",
                  opacity: (!draft.title.trim() || !draft.projectId || !draft.assigneeAgentId) ? 0.5 : 1,
                }}
              >
                <Plus size={14} />
                {creating ? "Creating..." : "Create routine"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Routines table — flat, no card wrapper ── */}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
        <thead style={{ display: !loading && routines.length === 0 ? "none" : undefined }}>
          <tr style={{ borderBottom: "0.5px solid var(--border)" }}>
            {["Name", "Project", "Agent", "Last run", "Enabled", ""].map((h) => (
              <th
                key={h || "actions"}
                style={{
                  padding: "8px 12px",
                  textAlign: "left",
                  fontSize: "12px",
                  fontWeight: 500,
                  color: "var(--text-muted)",
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={6} style={{ padding: "48px 12px", textAlign: "center" }}>
                <p style={{ fontSize: "13px", color: "var(--text-muted)" }}>Loading...</p>
              </td>
            </tr>
          ) : routines.length === 0 ? (
            <tr>
              <td colSpan={6} style={{ padding: "56px 12px 64px" }}>
                <RoutinesEmptyState
                  onStart={() => openRoutineComposer()}
                  onTemplateSelect={openRoutineComposer}
                />
              </td>
            </tr>
          ) : (
            routines.map((routine) => {
              const enabled = routine.status === "active";
              const isArchived = routine.status === "archived";
              const isPaused = routine.status === "paused";
              const isStatusPending = statusMutatingId === routine.id;
              const project = routine.projectId ? projectById.get(routine.projectId) : undefined;

              return (
                <tr
                  key={routine.id}
                  style={{
                    borderBottom: "0.5px solid var(--border)",
                    transition: "background 120ms ease",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface-hover)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  {/* Name */}
                  <td style={{ padding: "10px 12px", minWidth: "180px" }}>
                    <Link
                      href={buildCompanyPath(slug, `/routines/${encodeURIComponent(routine.id)}`)}
                      className="no-underline"
                      style={{ fontWeight: 500, color: "var(--text-primary)" }}
                    >
                      {routine.title}
                    </Link>
                    {(isArchived || isPaused) && (
                      <div style={{ marginTop: "3px", fontSize: "11px", color: "var(--text-muted)" }}>
                        {isArchived ? "archived" : "paused"}
                      </div>
                    )}
                  </td>

                  {/* Project */}
                  <td style={{ padding: "10px 12px" }}>
                    {routine.projectId ? (
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--text-secondary)", fontSize: "13px" }}>
                        <span style={{ display: "inline-block", width: "10px", height: "10px", borderRadius: "2px", flexShrink: 0, background: project?.color ?? routine.projectColor ?? "#6366f1" }} />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{routine.projectName ?? "Unknown"}</span>
                      </div>
                    ) : (
                      <span style={{ fontSize: "12px", color: "color-mix(in srgb, var(--text-muted) 72%, transparent)" }}>—</span>
                    )}
                  </td>

                  {/* Agent */}
                  <td style={{ padding: "10px 12px" }}>
                    {routine.assigneeAgentId ? (
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--text-secondary)", fontSize: "13px" }}>
                        {routine.agentEmoji ? (
                          <AvatarGlyph value={routine.agentEmoji} size={14} color="#fbbf24" style={{ flexShrink: 0 }} />
                        ) : null}
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{routine.agentName ?? "Unknown"}</span>
                      </div>
                    ) : (
                      <span style={{ fontSize: "12px", color: "color-mix(in srgb, var(--text-muted) 72%, transparent)" }}>—</span>
                    )}
                  </td>

                  {/* Last run */}
                  <td style={{ padding: "10px 12px", color: "var(--text-secondary)" }}>
                    <div>{formatLastRunTimestamp(routine.lastRun?.triggeredAt)}</div>
                    {routine.lastRun ? (
                      <div style={{ marginTop: "2px", fontSize: "11px", color: "var(--text-muted)" }}>{routine.lastRun.status.replaceAll("_", " ")}</div>
                    ) : null}
                  </td>

                  {/* Enabled toggle */}
                  <td style={{ padding: "10px 12px" }} onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={enabled}
                        aria-label={enabled ? `Disable ${routine.title}` : `Enable ${routine.title}`}
                        disabled={isStatusPending || isArchived}
                        onClick={() => handleToggleStatus(routine)}
                        style={{
                          position: "relative",
                          display: "inline-flex",
                          alignItems: "center",
                          width: "44px",
                          height: "24px",
                          borderRadius: "12px",
                          border: "none",
                          background: enabled ? "var(--text-primary)" : "var(--border-strong)",
                          cursor: isStatusPending || isArchived ? "not-allowed" : "pointer",
                          opacity: isStatusPending || isArchived ? 0.5 : 1,
                          transition: "background 150ms ease",
                          flexShrink: 0,
                        }}
                      >
                        <span style={{
                          position: "absolute",
                          top: "2px",
                          left: "2px",
                          width: "20px",
                          height: "20px",
                          borderRadius: "10px",
                          background: enabled ? "#1c1917" : "var(--text-muted)",
                          boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                          transition: "transform 150ms ease",
                          transform: enabled ? "translateX(20px)" : "translateX(0)",
                        }} />
                      </button>
                      <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                        {isArchived ? "Archived" : enabled ? "On" : "Off"}
                      </span>
                    </div>
                  </td>

                  {/* Actions */}
                  <td style={{ padding: "10px 12px", textAlign: "right", width: "48px" }}>
                    <button
                      type="button"
                      aria-label={`More actions for ${routine.title}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (openMenuId === routine.id) {
                          setOpenMenuId(null);
                        } else {
                          const rect = e.currentTarget.getBoundingClientRect();
                          const left = Math.min(rect.right - 160, window.innerWidth - 172);
                          setMenuPos({ top: rect.bottom + 4, left });
                          setOpenMenuId(routine.id);
                        }
                      }}
                      style={{
                        width: "28px",
                        height: "28px",
                        borderRadius: "6px",
                        border: "none",
                        background: "transparent",
                        color: "var(--text-muted)",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                        transition: "all 80ms ease",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-secondary)"; e.currentTarget.style.background = "var(--border)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.background = "transparent"; }}
                    >
                      <MoreHorizontal size={16} />
                    </button>

                    {openMenuId === routine.id ? (
                      <>
                        <div style={{ position: "fixed", inset: 0, zIndex: 40 }} onClick={() => setOpenMenuId(null)} />
                        <div style={{
                          position: "fixed",
                          top: `${menuPos.top}px`,
                          left: `${menuPos.left}px`,
                          zIndex: 50,
                          minWidth: "160px",
                          borderRadius: "10px",
                          border: "0.5px solid var(--border-strong)",
                          background: "var(--surface-elevated)",
                          boxShadow: "0 12px 32px rgba(0,0,0,0.5)",
                          padding: "4px",
                          backdropFilter: "blur(12px)",
                        }}>
                          <DropdownItem label={runningRoutineId === routine.id ? "Running..." : "Run now"} disabled={runningRoutineId === routine.id || isArchived} onClick={() => handleRunNow(routine)} />
                          <div style={{ height: "1px", background: "var(--border)", margin: "4px 0" }} />
                          <DropdownItem label={enabled ? "Pause" : "Enable"} disabled={isStatusPending || isArchived} onClick={async () => { setOpenMenuId(null); await handleToggleStatus(routine); }} />
                          <DropdownItem
                            label={isArchived ? "Restore" : "Archive"}
                            disabled={isStatusPending}
                            onClick={async () => {
                              setOpenMenuId(null);
                              setStatusMutatingId(routine.id);
                              await updateRoutineApi(routine.id, { status: isArchived ? "active" : "archived" });
                              const updated = await listCompanyRoutines(slug);
                              setRoutines(updated);
                              setStatusMutatingId(null);
                            }}
                          />
                        </div>
                      </>
                    ) : null}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

/* ── Dropdown menu item ── */

function RoutinesEmptyState({
  onStart,
  onTemplateSelect,
}: {
  onStart: () => void;
  onTemplateSelect: (template: RoutineTemplate) => void;
}) {
  return (
    <div style={{ maxWidth: "1120px", margin: "0 auto", textAlign: "center" }}>
      <Zap size={34} strokeWidth={1.8} color="color-mix(in srgb, var(--text-muted) 42%, transparent)" />
      <h2 style={{ margin: "14px 0 6px", fontSize: "20px", fontWeight: 600, color: "var(--text-primary)" }}>
        No routines yet
      </h2>
      <p style={{ margin: "0 0 30px", fontSize: "15px", color: "var(--text-secondary)" }}>
        Schedule recurring work for your agents. Pick a template or start from scratch.
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: "16px",
          marginBottom: "28px",
          textAlign: "left",
        }}
      >
        {ROUTINE_TEMPLATES.map((template) => {
          const Icon = template.icon;
          return (
            <button
              key={template.title}
              type="button"
              onClick={() => onTemplateSelect(template)}
              style={{
                display: "grid",
                gridTemplateColumns: "34px minmax(0, 1fr)",
                gap: "14px",
                minHeight: "108px",
                padding: "22px 24px",
                borderRadius: "8px",
                border: "0.5px solid var(--border)",
                background: "var(--surface)",
                color: "var(--text-primary)",
                textAlign: "left",
                cursor: "pointer",
                transition: "border-color 120ms ease, background 120ms ease",
              }}
              onMouseEnter={(event) => {
                event.currentTarget.style.borderColor = "var(--border-strong)";
                event.currentTarget.style.background = "var(--surface-hover)";
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.borderColor = "var(--border)";
                event.currentTarget.style.background = "var(--surface)";
              }}
            >
              <Icon size={24} strokeWidth={1.9} color="var(--text-muted)" style={{ marginTop: 2 }} />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontSize: "17px", fontWeight: 600, color: "var(--text-primary)" }}>
                  {template.title}
                </span>
                <span style={{ display: "block", marginTop: "8px", fontSize: "14px", lineHeight: 1.35, color: "var(--text-secondary)" }}>
                  {template.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={onStart}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "10px",
          padding: "10px 18px",
          borderRadius: "8px",
          border: "0.5px solid var(--border-strong)",
          background: "var(--surface)",
          color: "var(--text-primary)",
          fontSize: "15px",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        <Plus size={17} />
        Start from scratch
      </button>
    </div>
  );
}

function DropdownItem({ label, disabled, onClick }: { label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        display: "block",
        width: "100%",
        padding: "8px 12px",
        borderRadius: "6px",
        border: "none",
        background: "transparent",
        color: disabled ? "color-mix(in srgb, var(--text-muted) 72%, transparent)" : "var(--text-secondary)",
        fontSize: "13px",
        textAlign: "left",
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "background 80ms ease",
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = "var(--border)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
    >
      {label}
    </button>
  );
}
