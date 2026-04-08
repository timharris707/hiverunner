"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Plus,
  Repeat,
  X,
} from "lucide-react";
import { buildCompanyPath } from "@/lib/orchestration/route-paths";

import { CompanyErrorState } from "@/components/company/company-ui";
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
  border: "0.5px solid rgba(120,113,108,0.3)",
  background: "transparent",
  padding: "8px 12px",
  fontSize: "13px",
  color: "#f5f5f4",
  outline: "none",
  width: "100%",
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  color: "#d6d3d1",
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
            <h1 style={{ fontSize: "24px", fontWeight: 600, letterSpacing: "-0.01em", color: "#f5f5f4", display: "flex", alignItems: "center", gap: "10px" }}>
              Routines
              <span style={{
                display: "inline-flex",
                alignItems: "center",
                borderRadius: "999px",
                background: "rgba(245,158,11,0.12)",
                padding: "2px 10px",
                fontSize: "11px",
                fontWeight: 500,
                color: "#f59e0b",
                letterSpacing: "0.02em",
              }}>
                Beta
              </span>
            </h1>
            <p style={{ fontSize: "13px", color: "#a8a29e", marginTop: "4px" }}>
              Recurring work definitions that materialize into auditable execution issues.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setComposerOpen(true)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              padding: "8px 16px",
              borderRadius: "8px",
              border: "0.5px solid rgba(120,113,108,0.4)",
              background: "transparent",
              color: "#d6d3d1",
              fontSize: "13px",
              fontWeight: 500,
              cursor: "pointer",
              whiteSpace: "nowrap",
              flexShrink: 0,
              transition: "all 120ms ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "rgba(168,162,158,0.5)";
              e.currentTarget.style.background = "rgba(68,64,60,0.6)";
              e.currentTarget.style.color = "#f5f5f4";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "rgba(120,113,108,0.4)";
              e.currentTarget.style.background = "rgba(41,37,36,0.55)";
              e.currentTarget.style.color = "#d6d3d1";
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
            background: "rgba(0,0,0,0.6)",
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
              border: "0.5px solid rgba(120,113,108,0.3)",
              background: "var(--surface-elevated)",
              boxShadow: "0 24px 60px rgba(0,0,0,0.6)",
              overflow: "hidden",
            }}
          >
            {/* Dialog header */}
            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "14px 20px",
              borderBottom: "0.5px solid rgba(120,113,108,0.2)",
              flexShrink: 0,
            }}>
              <div>
                <p style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.2em", color: "#78716c" }}>New routine</p>
                <p style={{ fontSize: "12px", color: "#a8a29e", marginTop: "2px" }}>
                  Define the recurring work first. Trigger setup comes next on the detail page.
                </p>
              </div>
              <button
                type="button"
                onClick={() => { setComposerOpen(false); setAdvancedOpen(false); }}
                disabled={creating}
                style={{ background: "none", border: "none", color: "#78716c", cursor: "pointer", padding: "4px" }}
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
                    color: "#f5f5f4",
                  }}
                />
              </div>

              <div style={{ padding: "0 20px 12px", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "#a8a29e", flexWrap: "wrap" }}>
                <span>For</span>
                <select
                  value={draft.assigneeAgentId}
                  onChange={(e) => setDraft((d) => ({ ...d, assigneeAgentId: e.target.value }))}
                  style={{ ...selectStyle, width: "auto", minWidth: "140px", maxWidth: "200px", padding: "6px 28px 6px 10px", fontSize: "12px" }}
                >
                  <option value="">Assignee</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>{a.emoji} {a.name}</option>
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

              <div style={{ padding: "0 20px 16px", borderTop: "0.5px solid rgba(120,113,108,0.15)" }}>
                <textarea
                  value={draft.description}
                  onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                  placeholder="Add instructions..."
                  rows={6}
                  style={{ ...inputStyle, border: "none", background: "transparent", padding: "16px 0", minHeight: "160px", resize: "vertical", lineHeight: "1.6" }}
                />
              </div>

              <div style={{ borderTop: "0.5px solid rgba(120,113,108,0.15)", padding: "12px 20px" }}>
                <button
                  type="button"
                  onClick={() => setAdvancedOpen((v) => !v)}
                  style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", background: "none", border: "none", cursor: "pointer", textAlign: "left", padding: 0 }}
                >
                  <div>
                    <p style={{ fontSize: "13px", fontWeight: 500, color: "#f5f5f4" }}>Advanced delivery settings</p>
                    <p style={{ fontSize: "12px", color: "#a8a29e" }}>Keep policy controls secondary to the work definition.</p>
                  </div>
                  {advancedOpen ? <ChevronDown size={14} color="#78716c" /> : <ChevronRight size={14} color="#78716c" />}
                </button>
                {advancedOpen ? (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", paddingTop: "12px" }}>
                    <div>
                      <p style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.18em", color: "#78716c", marginBottom: "6px" }}>Concurrency</p>
                      <select value={draft.concurrencyPolicy} onChange={(e) => setDraft((d) => ({ ...d, concurrencyPolicy: e.target.value }))} style={selectStyle}>
                        {concurrencyPolicies.map((v) => (<option key={v} value={v}>{v.replaceAll("_", " ")}</option>))}
                      </select>
                      <p style={{ fontSize: "11px", color: "#78716c", marginTop: "4px" }}>{concurrencyPolicyDescriptions[draft.concurrencyPolicy]}</p>
                    </div>
                    <div>
                      <p style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.18em", color: "#78716c", marginBottom: "6px" }}>Catch-up</p>
                      <select value={draft.catchUpPolicy} onChange={(e) => setDraft((d) => ({ ...d, catchUpPolicy: e.target.value }))} style={selectStyle}>
                        {catchUpPolicies.map((v) => (<option key={v} value={v}>{v.replaceAll("_", " ")}</option>))}
                      </select>
                      <p style={{ fontSize: "11px", color: "#78716c", marginTop: "4px" }}>{catchUpPolicyDescriptions[draft.catchUpPolicy]}</p>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            {/* Dialog footer */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", padding: "16px 20px", borderTop: "0.5px solid rgba(120,113,108,0.2)", flexShrink: 0 }}>
              <p style={{ fontSize: "12px", color: "#78716c", maxWidth: "360px" }}>
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
                  border: "0.5px solid rgba(120,113,108,0.4)",
                  background: creating ? "transparent" : "transparent",
                  color: (!draft.title.trim() || !draft.projectId || !draft.assigneeAgentId) ? "#57534e" : "#f5f5f4",
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

      {/* ── Routines table — flat, no card wrapper, matches Paperclip ── */}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
        <thead>
          <tr style={{ borderBottom: "0.5px solid rgba(120,113,108,0.2)" }}>
            {["Name", "Project", "Agent", "Last run", "Enabled", ""].map((h) => (
              <th
                key={h || "actions"}
                style={{
                  padding: "8px 12px",
                  textAlign: "left",
                  fontSize: "12px",
                  fontWeight: 500,
                  color: "#78716c",
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
                <p style={{ fontSize: "13px", color: "#78716c" }}>Loading...</p>
              </td>
            </tr>
          ) : routines.length === 0 ? (
            <tr>
              <td colSpan={6} style={{ padding: "48px 12px", textAlign: "center" }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
                  <Repeat size={24} color="#57534e" />
                  <p style={{ fontSize: "13px", color: "#78716c" }}>
                    No routines yet. Use Create routine to define the first recurring workflow.
                  </p>
                </div>
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
                    borderBottom: "0.5px solid rgba(120,113,108,0.12)",
                    transition: "background 120ms ease",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.025)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  {/* Name */}
                  <td style={{ padding: "10px 12px", minWidth: "180px" }}>
                    <Link
                      href={buildCompanyPath(slug, `/routines/${encodeURIComponent(routine.id)}`)}
                      className="no-underline"
                      style={{ fontWeight: 500, color: "#f5f5f4" }}
                    >
                      {routine.title}
                    </Link>
                    {(isArchived || isPaused) && (
                      <div style={{ marginTop: "3px", fontSize: "11px", color: "#78716c" }}>
                        {isArchived ? "archived" : "paused"}
                      </div>
                    )}
                  </td>

                  {/* Project */}
                  <td style={{ padding: "10px 12px" }}>
                    {routine.projectId ? (
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#a8a29e", fontSize: "13px" }}>
                        <span style={{ display: "inline-block", width: "10px", height: "10px", borderRadius: "2px", flexShrink: 0, background: project?.color ?? routine.projectColor ?? "#6366f1" }} />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{routine.projectName ?? "Unknown"}</span>
                      </div>
                    ) : (
                      <span style={{ fontSize: "12px", color: "#57534e" }}>—</span>
                    )}
                  </td>

                  {/* Agent */}
                  <td style={{ padding: "10px 12px" }}>
                    {routine.assigneeAgentId ? (
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#a8a29e", fontSize: "13px" }}>
                        {routine.agentEmoji ? <span style={{ fontSize: "14px", flexShrink: 0 }}>{routine.agentEmoji}</span> : null}
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{routine.agentName ?? "Unknown"}</span>
                      </div>
                    ) : (
                      <span style={{ fontSize: "12px", color: "#57534e" }}>—</span>
                    )}
                  </td>

                  {/* Last run */}
                  <td style={{ padding: "10px 12px", color: "#a8a29e" }}>
                    <div>{formatLastRunTimestamp(routine.lastRun?.triggeredAt)}</div>
                    {routine.lastRun ? (
                      <div style={{ marginTop: "2px", fontSize: "11px", color: "#78716c" }}>{routine.lastRun.status.replaceAll("_", " ")}</div>
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
                          background: enabled ? "#f5f5f4" : "rgba(120,113,108,0.3)",
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
                          background: enabled ? "#1c1917" : "#78716c",
                          boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                          transition: "transform 150ms ease",
                          transform: enabled ? "translateX(20px)" : "translateX(0)",
                        }} />
                      </button>
                      <span style={{ fontSize: "11px", color: "#78716c" }}>
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
                        color: "#78716c",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                        transition: "all 80ms ease",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = "#d6d3d1"; e.currentTarget.style.background = "rgba(120,113,108,0.15)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = "#78716c"; e.currentTarget.style.background = "transparent"; }}
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
                          border: "0.5px solid rgba(120,113,108,0.3)",
                          background: "var(--surface-elevated)",
                          boxShadow: "0 12px 32px rgba(0,0,0,0.5)",
                          padding: "4px",
                          backdropFilter: "blur(12px)",
                        }}>
                          <DropdownItem label={runningRoutineId === routine.id ? "Running..." : "Run now"} disabled={runningRoutineId === routine.id || isArchived} onClick={() => handleRunNow(routine)} />
                          <div style={{ height: "1px", background: "rgba(120,113,108,0.2)", margin: "4px 0" }} />
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
        color: disabled ? "#57534e" : "#d6d3d1",
        fontSize: "13px",
        textAlign: "left",
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "background 80ms ease",
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = "rgba(120,113,108,0.15)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
    >
      {label}
    </button>
  );
}
