"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ChevronRight,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import {
  createCompanyGoal,
  deleteCompanyGoal,
  listCompanies,
  listCompanyAgents,
  listCompanyGoals,
  listProjects,
  updateCompanyGoal,
} from "@/lib/orchestration/client";
import type {
  OrchestrationAgent,
  OrchestrationCompanyGoal,
  OrchestrationProject,
  OrchestrationSprint,
} from "@/lib/orchestration/types";

/* ─── Palette ─── */
const P = {
  bg: "#0f0f0f",
  surface: "#1a1a1a",
  card: "#1e1e1e",
  cardBorder: "rgba(255,255,255,0.08)",
  text: "#e5e5e5",
  textSec: "#a3a3a3",
  muted: "#737373",
  accent: "#d97706",
  accentLight: "#f59e0b",
};

const STATUS_COLORS: Record<string, { color: string; bg: string }> = {
  active: { color: "#22c55e", bg: "rgba(34,197,94,0.16)" },
  planned: { color: "#a3a3a3", bg: "rgba(163,163,163,0.12)" },
  done: { color: "#22c55e", bg: "rgba(34,197,94,0.16)" },
};

export default function GoalDetailPage({
  params,
}: {
  params: Promise<{ slug: string; goalId: string }>;
}) {
  const { slug, goalId } = use(params);
  const router = useRouter();

  const [goal, setGoal] = useState<OrchestrationCompanyGoal | null>(null);
  const [allGoals, setAllGoals] = useState<OrchestrationCompanyGoal[]>([]);
  const [agents, setAgents] = useState<OrchestrationAgent[]>([]);
  const [projects, setProjects] = useState<OrchestrationProject[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [goalPayload, agentList, projectList] = await Promise.all([
      listCompanyGoals({ companySlug: slug }),
      listCompanyAgents(slug),
      listProjects({ company: slug }),
    ]);
    const goals = goalPayload?.goals ?? [];
    setAllGoals(goals);
    setGoal(goals.find((g) => g.sprint.id === goalId) ?? null);
    setAgents(agentList);
    setProjects(projectList);
    setLoading(false);
  }, [slug, goalId]);

  useEffect(() => { void load(); }, [load]);

  const subGoals = useMemo(
    () => allGoals.filter((g) => g.sprint.parentId === goalId),
    [allGoals, goalId],
  );

  const handleUpdate = async (updates: { name?: string; goal?: string; status?: OrchestrationSprint["status"]; owner?: string | null }) => {
    const updated = await updateCompanyGoal({ companySlug: slug, sprintId: goalId, ...updates });
    if (updated) {
      setGoal(updated);
      setAllGoals((prev) => prev.map((g) => g.sprint.id === goalId ? updated : g));
    }
  };

  const handleDelete = async () => {
    await deleteCompanyGoal({ companySlug: slug, sprintId: goalId });
    router.push(`/companies/${slug}/goals`);
  };

  const handleCreateSubGoal = async (name: string) => {
    if (!goal || name.trim().length < 2) return;
    const created = await createCompanyGoal({
      companySlug: slug,
      projectId: goal.projectId,
      name: name.trim(),
      parentId: goalId,
      status: "planned",
    });
    if (created) {
      setAllGoals((prev) => [...prev, created]);
    }
  };

  const handleDeleteSubGoal = async (sprintId: string) => {
    await deleteCompanyGoal({ companySlug: slug, sprintId });
    setAllGoals((prev) => prev.filter((g) => g.sprint.id !== sprintId));
  };

  if (loading) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ height: 200, borderRadius: 8, background: P.card, border: `1px solid ${P.cardBorder}`, animation: "pulse 1.5s infinite" }} />
      </div>
    );
  }

  if (!goal) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ padding: 16, borderRadius: 8, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#fca5a5", fontSize: 13 }}>
          Goal not found.
        </div>
      </div>
    );
  }

  return (
    <GoalDetailView
      goal={goal}
      subGoals={subGoals}
      agents={agents}
      slug={slug}
      onUpdate={handleUpdate}
      onDelete={handleDelete}
      onCreateSubGoal={handleCreateSubGoal}
      onDeleteSubGoal={handleDeleteSubGoal}
    />
  );
}

/* ─── Goal Detail View (shared between routed page and list inline) ─── */
function GoalDetailView({
  goal, subGoals, agents, slug,
  onUpdate, onDelete, onCreateSubGoal, onDeleteSubGoal,
}: {
  goal: OrchestrationCompanyGoal;
  subGoals: OrchestrationCompanyGoal[];
  agents: OrchestrationAgent[];
  slug: string;
  onUpdate: (updates: { name?: string; goal?: string; status?: OrchestrationSprint["status"]; owner?: string | null }) => Promise<void>;
  onDelete: () => Promise<void>;
  onCreateSubGoal: (name: string) => Promise<void>;
  onDeleteSubGoal: (sprintId: string) => Promise<void>;
}) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(goal.sprint.name);
  const [descDraft, setDescDraft] = useState(goal.sprint.goal || "");
  const [descFocused, setDescFocused] = useState(false);
  const [activeTab, setActiveTab] = useState<"sub-goals" | "projects">("sub-goals");
  const [deleting, setDeleting] = useState(false);
  const [creatingSubGoal, setCreatingSubGoal] = useState(false);
  const [subGoalName, setSubGoalName] = useState("");
  const [submittingSub, setSubmittingSub] = useState(false);

  useEffect(() => {
    setTitleDraft(goal.sprint.name);
    setDescDraft(goal.sprint.goal || "");
    setEditingTitle(false);
    setDescFocused(false);
  }, [goal.sprint.id]);

  const level = goal.sprint.parentId ? "Task" : "Company";
  const sc = STATUS_COLORS[goal.sprint.status] ?? STATUS_COLORS.planned;

  const saveTitle = () => {
    if (titleDraft.trim().length >= 2 && titleDraft.trim() !== goal.sprint.name) {
      void onUpdate({ name: titleDraft.trim() });
    }
    setEditingTitle(false);
  };

  const saveDesc = () => {
    if (descDraft.trim() !== (goal.sprint.goal || "")) {
      void onUpdate({ goal: descDraft.trim() });
    }
    setDescFocused(false);
  };

  const handleCreateSub = async () => {
    if (subGoalName.trim().length < 2) return;
    setSubmittingSub(true);
    await onCreateSubGoal(subGoalName);
    setSubGoalName("");
    setCreatingSubGoal(false);
    setSubmittingSub(false);
  };

  const formatDate = (ts: string) => {
    try { return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
    catch { return ts; }
  };

  return (
    <div style={{ display: "flex", flex: 1, overflow: "hidden", color: P.text, fontSize: 13 }}>
      {/* Content area */}
      <div style={{ flex: 1, padding: "16px 24px", overflowY: "auto", minWidth: 0 }}>
        {/* Breadcrumb */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 16, fontSize: 12, color: P.muted }}>
          <Link href={`/companies/${slug}/goals`} style={{ color: P.muted, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
            Goals
          </Link>
          <ChevronRight size={12} />
          <span style={{ color: P.textSec, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {goal.sprint.name}
          </span>
        </div>

        {/* Level + Status */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: P.muted }}>{level}</span>
          <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 4, color: sc.color, background: sc.bg }}>{goal.sprint.status}</span>
        </div>

        {/* Title */}
        {editingTitle ? (
          <input
            autoFocus
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => { if (e.key === "Enter") saveTitle(); if (e.key === "Escape") { setTitleDraft(goal.sprint.name); setEditingTitle(false); } }}
            style={{ display: "block", width: "100%", fontSize: 22, fontWeight: 700, color: P.text, background: "transparent", border: "none", borderBottom: `1px solid ${P.accentLight}`, outline: "none", padding: "4px 0", marginBottom: 12, fontFamily: "var(--font-heading)" }}
          />
        ) : (
          <h2 onClick={() => setEditingTitle(true)} style={{ margin: "0 0 12px", fontSize: 22, fontWeight: 700, color: P.text, cursor: "text", fontFamily: "var(--font-heading)", lineHeight: 1.3 }}>
            {goal.sprint.name}
          </h2>
        )}

        {/* Description */}
        {descFocused ? (
          <textarea
            autoFocus value={descDraft} onChange={(e) => setDescDraft(e.target.value)}
            onBlur={saveDesc} rows={3}
            style={{ width: "100%", fontSize: 13, color: P.textSec, background: "transparent", border: "none", borderBottom: `1px solid ${P.cardBorder}`, outline: "none", padding: "4px 0", resize: "vertical", marginBottom: 20, fontFamily: "var(--font-body)", lineHeight: 1.5 }}
          />
        ) : (
          <p onClick={() => setDescFocused(true)} style={{ margin: "0 0 20px", fontSize: 13, color: descDraft ? P.textSec : P.muted, cursor: "text", lineHeight: 1.5, fontStyle: descDraft ? "normal" : "italic" }}>
            {descDraft || "Add a description..."}
          </p>
        )}

        {/* Tabs */}
        <div style={{ display: "flex", gap: 0, borderBottom: `1px solid ${P.cardBorder}`, marginBottom: 12 }}>
          <TabBtn label={`Sub-Goals (${subGoals.length})`} active={activeTab === "sub-goals"} onClick={() => setActiveTab("sub-goals")} />
          <TabBtn label="Projects (1)" active={activeTab === "projects"} onClick={() => setActiveTab("projects")} />
        </div>

        {activeTab === "sub-goals" && (
          <>
            <button
              type="button"
              onClick={() => setCreatingSubGoal(true)}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 6, marginBottom: 12, background: "transparent", border: `1px solid ${P.cardBorder}`, color: P.text, fontSize: 11, fontWeight: 500, cursor: "pointer" }}
            >
              <Plus size={12} /> Sub Goal
            </button>

            {creatingSubGoal && (
              <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
                <input
                  autoFocus value={subGoalName}
                  onChange={(e) => setSubGoalName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void handleCreateSub(); if (e.key === "Escape") { setCreatingSubGoal(false); setSubGoalName(""); } }}
                  placeholder="Sub-goal name..."
                  style={{ flex: 1, padding: "6px 10px", borderRadius: 6, border: `1px solid ${P.cardBorder}`, background: "transparent", color: P.text, fontSize: 12, outline: "none" }}
                />
                <button type="button" onClick={() => void handleCreateSub()} disabled={submittingSub || subGoalName.trim().length < 2}
                  style={{ padding: "6px 12px", borderRadius: 6, fontSize: 11, fontWeight: 600, background: "rgba(34,197,94,0.14)", border: "1px solid rgba(34,197,94,0.3)", color: "#4ade80", cursor: "pointer", opacity: submittingSub || subGoalName.trim().length < 2 ? 0.5 : 1 }}>
                  Create
                </button>
                <button type="button" onClick={() => { setCreatingSubGoal(false); setSubGoalName(""); }}
                  style={{ padding: "6px 10px", borderRadius: 6, fontSize: 11, background: "transparent", border: `1px solid ${P.cardBorder}`, color: P.muted, cursor: "pointer" }}>
                  Cancel
                </button>
              </div>
            )}

            {subGoals.length === 0 && !creatingSubGoal ? (
              <p style={{ color: P.muted, fontSize: 12 }}>No sub-goals.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {subGoals.map((sg) => {
                  const sgSc = STATUS_COLORS[sg.sprint.status] ?? STATUS_COLORS.planned;
                  return (
                    <div key={sg.sprint.id} style={{
                      display: "flex", alignItems: "center", gap: 8, padding: "8px 10px",
                      borderRadius: 6, background: "rgba(255,255,255,0.02)", border: `1px solid ${P.cardBorder}`,
                    }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: sgSc.color, flexShrink: 0 }} />
                      <Link
                        href={`/companies/${slug}/goals/${sg.sprint.id}`}
                        style={{ flex: 1, fontSize: 12, color: P.text, textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                      >
                        {sg.sprint.name}
                      </Link>
                      <span style={{ fontSize: 10, color: sgSc.color, fontWeight: 600, flexShrink: 0 }}>{sg.sprint.status}</span>
                      <button
                        type="button"
                        onClick={() => void onDeleteSubGoal(sg.sprint.id)}
                        title="Remove sub-goal"
                        style={{ display: "grid", placeItems: "center", width: 20, height: 20, borderRadius: 4, background: "transparent", border: "none", color: P.muted, cursor: "pointer" }}
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {activeTab === "projects" && (
          <div style={{ padding: "10px 12px", borderRadius: 6, background: "rgba(255,255,255,0.02)", border: `1px solid ${P.cardBorder}`, fontSize: 12, color: P.textSec }}>
            <span style={{ fontWeight: 600, color: P.text }}>{goal.projectName}</span>
            <span style={{ color: P.muted, marginLeft: 8 }}>{goal.projectSlug}</span>
          </div>
        )}
      </div>

      {/* Properties sidebar */}
      <div style={{ width: 220, borderLeft: `1px solid ${P.cardBorder}`, padding: 16, flexShrink: 0, overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: P.text }}>Properties</span>
          <Link href={`/companies/${slug}/goals`} style={{ color: P.muted, display: "grid", placeItems: "center" }}>
            <X size={14} />
          </Link>
        </div>

        <PropRow label="Status">
          <select
            value={goal.sprint.status}
            onChange={(e) => void onUpdate({ status: e.target.value as OrchestrationSprint["status"] })}
            style={{ padding: "3px 6px", borderRadius: 4, fontSize: 11, background: sc.bg, color: sc.color, border: "none", outline: "none", cursor: "pointer", fontWeight: 600 }}
          >
            <option value="planned">planned</option>
            <option value="active">active</option>
            <option value="done">done</option>
          </select>
        </PropRow>

        <PropRow label="Level">
          <span style={{ fontSize: 12, color: P.text }}>{level}</span>
        </PropRow>

        <PropRow label="Owner">
          <select
            value={goal.sprint.owner || ""}
            onChange={(e) => void onUpdate({ owner: e.target.value || null })}
            style={{ padding: "3px 6px", borderRadius: 4, fontSize: 11, background: P.card, color: goal.sprint.owner ? P.text : P.muted, border: `1px solid ${P.cardBorder}`, outline: "none", cursor: "pointer", maxWidth: 110 }}
          >
            <option value="">None</option>
            {agents.map((a) => (
              <option key={a.id} value={a.name}>{a.name}</option>
            ))}
          </select>
        </PropRow>

        <div style={{ height: 1, background: P.cardBorder, margin: "12px 0" }} />

        <PropRow label="Created">
          <span style={{ fontSize: 12, color: P.text, fontWeight: 500 }}>{formatDate(goal.sprint.created)}</span>
        </PropRow>
        <PropRow label="Updated">
          <span style={{ fontSize: 12, color: P.text, fontWeight: 500 }}>{formatDate(goal.sprint.updated)}</span>
        </PropRow>

        <div style={{ height: 1, background: P.cardBorder, margin: "12px 0" }} />

        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: P.muted, marginBottom: 4 }}>
            <span>{goal.sprint.doneCount}/{goal.sprint.taskCount} tasks</span>
            <span>{goal.completionPercent}%</span>
          </div>
          <div style={{ height: 4, borderRadius: 2, background: "rgba(255,255,255,0.06)" }}>
            <div style={{ height: 4, borderRadius: 2, width: `${Math.min(100, Math.max(0, goal.completionPercent))}%`, background: P.accentLight, transition: "width 0.3s ease" }} />
          </div>
        </div>

        <button type="button" onClick={() => { setDeleting(true); void onDelete(); }} disabled={deleting}
          style={{ width: "100%", padding: "6px 12px", borderRadius: 6, fontSize: 11, fontWeight: 500, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#f87171", cursor: "pointer", marginTop: 8, opacity: deleting ? 0.5 : 1 }}>
          {deleting ? "Deleting..." : "Delete goal"}
        </button>
      </div>
    </div>
  );
}

function TabBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      style={{ padding: "8px 16px", fontSize: 12, fontWeight: active ? 600 : 400, color: active ? P.text : P.muted, background: "transparent", border: "none", borderBottom: active ? `2px solid ${P.text}` : "2px solid transparent", cursor: "pointer" }}>
      {label}
    </button>
  );
}

function PropRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
      <span style={{ fontSize: 12, color: P.muted }}>{label}</span>
      {children}
    </div>
  );
}

function formatDate(ts: string) {
  try { return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
  catch { return ts; }
}
