"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Plus } from "lucide-react";
import {
  createCompanyGoal,
  listCompanies,
  listCompanyGoals,
  listProjects,
} from "@/lib/orchestration/client";
import type {
  OrchestrationCompany,
  OrchestrationCompanyGoal,
  OrchestrationProject,
  OrchestrationSprint,
} from "@/lib/orchestration/types";
import { P as tokens } from "@/lib/ui/tokens";

/* ─── Palette (from shared tokens) ─── */
const P = {
  bg: tokens.bg,
  surface: tokens.surface,
  card: tokens.surface,
  cardBorder: tokens.cardBorder,
  cardBorderHover: tokens.cardBorderHover,
  text: tokens.text,
  textSec: tokens.textSec,
  muted: tokens.muted,
};

const STATUS_COLORS: Record<string, { color: string; bg: string }> = {
  active: { color: "#22c55e", bg: "rgba(34,197,94,0.16)" },
  planned: { color: "#a3a3a3", bg: "rgba(163,163,163,0.12)" },
  done: { color: "#22c55e", bg: "rgba(34,197,94,0.16)" },
};

export default function CompanyGoalsPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? "";

  const [company, setCompany] = useState<OrchestrationCompany | null>(null);
  const [projects, setProjects] = useState<OrchestrationProject[]>([]);
  const [goals, setGoals] = useState<OrchestrationCompanyGoal[]>([]);
  const [loading, setLoading] = useState(true);

  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createProjectId, setCreateProjectId] = useState("");
  const [createStatus, setCreateStatus] = useState<OrchestrationSprint["status"]>("planned");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    const [companyRows, projectRows, goalPayload] = await Promise.all([
      listCompanies(),
      listProjects({ company: slug }),
      listCompanyGoals({ companySlug: slug }),
    ]);
    setCompany(companyRows.find((r) => r.slug === slug) ?? null);
    setProjects(projectRows);
    setGoals(goalPayload?.goals ?? []);
    setCreateProjectId((cur) => cur || projectRows[0]?.id || "");
    setLoading(false);
  }, [slug]);

  useEffect(() => { void load(); }, [load]);

  // Build hierarchical list: top-level goals first, then sub-goals indented
  const orderedGoals = useMemo(() => {
    const topLevel = goals.filter((g) => !g.sprint.parentId);
    const result: { goal: OrchestrationCompanyGoal; indent: boolean }[] = [];
    for (const tl of topLevel) {
      result.push({ goal: tl, indent: false });
      const children = goals.filter((g) => g.sprint.parentId === tl.sprint.id);
      for (const child of children) {
        result.push({ goal: child, indent: true });
      }
    }
    // Also include orphaned sub-goals (parent not in list)
    const placed = new Set(result.map((r) => r.goal.sprint.id));
    for (const g of goals) {
      if (!placed.has(g.sprint.id)) {
        result.push({ goal: g, indent: Boolean(g.sprint.parentId) });
      }
    }
    return result;
  }, [goals]);

  const handleCreateGoal = async () => {
    if (createName.trim().length < 2 || !createProjectId) return;
    setSubmitting(true);
    const created = await createCompanyGoal({
      companySlug: slug,
      projectId: createProjectId,
      name: createName.trim(),
      status: createStatus,
    });
    if (created) {
      setGoals((prev) => [created, ...prev]);
      setCreateName("");
      setCreateStatus("planned");
      setCreating(false);
    }
    setSubmitting(false);
  };

  if (loading) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ height: 200, borderRadius: 8, background: P.card, border: `0.5px solid ${P.cardBorder}`, animation: "pulse 1.5s infinite" }} />
      </div>
    );
  }

  if (!company) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ padding: 16, borderRadius: 8, background: "rgba(239,68,68,0.1)", border: "0.5px solid rgba(239,68,68,0.3)", color: "#fca5a5", fontSize: 13 }}>
          Company not found.
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "16px 20px", color: P.text, fontSize: 13 }}>
      <div style={{ height: 4 }} />

      {/* New Goal button */}
      <button
        type="button"
        onClick={() => setCreating(true)}
        disabled={projects.length === 0}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "8px 16px", borderRadius: 6, marginBottom: 12,
          background: "transparent", border: `0.5px solid ${P.cardBorder}`,
          color: P.text, fontSize: 12, fontWeight: 500, cursor: "pointer",
          transition: "border-color 0.15s",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = P.cardBorderHover; }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = P.cardBorder; }}
      >
        <Plus size={14} /> New Goal
      </button>

      {/* Create form */}
      {creating && (
        <div style={{
          marginBottom: 12, padding: "12px 14px", borderRadius: 8,
          background: P.card, border: `0.5px solid ${P.cardBorder}`,
          display: "flex", flexDirection: "column", gap: 8,
        }}>
          <input
            autoFocus value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            placeholder="Goal name..."
            onKeyDown={(e) => { if (e.key === "Enter") void handleCreateGoal(); if (e.key === "Escape") setCreating(false); }}
            style={{ padding: "8px 10px", borderRadius: 6, border: `0.5px solid ${P.cardBorder}`, background: "transparent", color: P.text, fontSize: 13, outline: "none" }}
          />
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select value={createProjectId} onChange={(e) => setCreateProjectId(e.target.value)}
              style={{ padding: "6px 8px", borderRadius: 6, border: `0.5px solid ${P.cardBorder}`, background: P.card, color: P.text, fontSize: 11, outline: "none" }}>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select value={createStatus} onChange={(e) => setCreateStatus(e.target.value as OrchestrationSprint["status"])}
              style={{ padding: "6px 8px", borderRadius: 6, border: `0.5px solid ${P.cardBorder}`, background: P.card, color: P.text, fontSize: 11, outline: "none" }}>
              <option value="planned">Planned</option>
              <option value="active">Active</option>
            </select>
            <div style={{ flex: 1 }} />
            <button type="button" onClick={() => void handleCreateGoal()} disabled={submitting || createName.trim().length < 2}
              style={{ padding: "6px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600, background: "rgba(34,197,94,0.14)", border: "0.5px solid rgba(34,197,94,0.3)", color: "#4ade80", cursor: "pointer", opacity: submitting || createName.trim().length < 2 ? 0.5 : 1 }}>
              {submitting ? "Creating..." : "Create"}
            </button>
            <button type="button" onClick={() => { setCreating(false); setCreateName(""); }}
              style={{ padding: "6px 10px", borderRadius: 6, fontSize: 11, background: "transparent", border: `0.5px solid ${P.cardBorder}`, color: P.muted, cursor: "pointer" }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Goal list */}
      <div style={{ borderRadius: 8, border: `0.5px solid ${P.cardBorder}` }}>
        {orderedGoals.length === 0 ? (
          <div style={{ padding: 32, textAlign: "center", color: P.muted, fontSize: 12 }}>
            No goals yet. Create your first goal to get started.
          </div>
        ) : (
          orderedGoals.map(({ goal, indent }) => {
            const sc = STATUS_COLORS[goal.sprint.status] ?? STATUS_COLORS.planned;
            const level = goal.sprint.parentId ? "Task" : "Company";

            return (
              <Link
                key={goal.sprint.id}
                href={`/companies/${slug}/goals/${goal.sprint.id}`}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: indent ? "10px 14px 10px 34px" : "10px 14px",
                  borderBottom: `0.5px solid ${P.cardBorder}`,
                  cursor: "pointer", textDecoration: "none",
                  transition: "background 0.12s",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.02)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <span style={{
                  fontSize: 10, fontWeight: 500, color: P.muted,
                  padding: "2px 6px", borderRadius: 4,
                  background: "rgba(255,255,255,0.04)",
                  border: `0.5px solid ${P.cardBorder}`,
                  minWidth: 55, textAlign: "center", flexShrink: 0,
                }}>
                  {level}
                </span>
                <span style={{
                  flex: 1, fontSize: 13, color: P.text, fontWeight: 500,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {goal.sprint.name}
                </span>
                {goal.sprint.owner && (
                  <span style={{ fontSize: 10, color: P.muted, flexShrink: 0 }}>{goal.sprint.owner}</span>
                )}
                <span style={{
                  fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 4,
                  color: sc.color, background: sc.bg, flexShrink: 0,
                }}>
                  {goal.sprint.status}
                </span>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
