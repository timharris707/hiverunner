"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { ChevronDown, List, LayoutGrid, Plus, Search, SlidersHorizontal } from "lucide-react";

import { CompanyErrorState } from "@/components/company/company-ui";
import { CreateTaskModal } from "@/components/orchestration/CreateTaskModal";
import { formatAge } from "@/components/orchestration/ui";
import { listCompanies, listCompanyAgents, listProjects, listTasks } from "@/lib/orchestration/client";
import { useActiveProjectState } from "@/lib/active-project-state";
import { resolveActiveProject } from "@/lib/active-project-utils";
import type { OrchestrationAgent, OrchestrationCompany, OrchestrationProject, OrchestrationTask, TaskPriority, TaskStatus } from "@/lib/orchestration/types";

type GroupMode = "none" | "status" | "priority" | "assignee" | "project";
type SortMode = "updated" | "created" | "priority";

type TaskRow = OrchestrationTask & {
  projectId: string;
  projectSlug: string;
  projectName: string;
};

const STATUS_ORDER: TaskStatus[] = ["in-progress", "on-deck", "review", "blocked", "backlog", "done"];
const STATUS_LABEL: Record<TaskStatus, string> = { backlog: "Backlog", "on-deck": "On Deck", "in-progress": "In Progress", review: "Review", done: "Done", blocked: "Blocked" };
const STATUS_DOT: Record<TaskStatus, string> = { backlog: "#78716c", "on-deck": "#a8a29e", "in-progress": "#f5f5f4", review: "#d6d3d1", done: "#57534e", blocked: "#78716c" };
const PRI_WEIGHT: Record<TaskPriority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

export default function CompanyTasksPage() {
  const params = useParams<{ slug: string }>();
  const searchParams = useSearchParams();
  const slug = params?.slug ?? "";

  const [company, setCompany] = useState<OrchestrationCompany | null>(null);
  const { activeProject } = useActiveProjectState();
  const [projects, setProjects] = useState<OrchestrationProject[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [agents, setAgents] = useState<OrchestrationAgent[]>([]);
  const [loading, setLoading] = useState(true);

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | TaskStatus>("all");
  const [groupMode, setGroupMode] = useState<GroupMode>("status");
  const [sortMode, setSortMode] = useState<SortMode>("updated");
  const [createOpen, setCreateOpen] = useState(false);

  const activeProjectRecord = useMemo(() => {
    const qp = searchParams.get("projectId") ?? searchParams.get("project");
    if (qp) {
      return projects.find((p) => p.id === qp || p.slug === qp) ?? resolveActiveProject(projects, activeProject, slug);
    }
    return resolveActiveProject(projects, activeProject, slug);
  }, [activeProject, projects, searchParams, slug]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [companyRows, projectRows, taskRows] = await Promise.all([
          listCompanies(),
          listProjects({ company: slug }),
          listTasks({ company: slug, includeNonProduction: true, sort: "updated-desc" }),
        ]);
        const current = companyRows.find((r) => r.slug === slug) ?? null;
        if (cancelled) return;
        setCompany(current);
        if (!current) { setProjects([]); setTasks([]); setAgents([]); return; }

        const pMap = new Map(projectRows.map((p) => [p.id, p] as const));
        const rows = taskRows.filter((t) => pMap.has(t.project)).map((t) => {
          const p = pMap.get(t.project)!;
          return { ...t, projectId: p.id, projectSlug: p.slug, projectName: p.name };
        });

        const agentRows = await listCompanyAgents(current.slug);
        if (cancelled) return;
        setProjects(projectRows);
        setTasks(rows);
        setAgents(agentRows);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [slug]);

  const agentMap = useMemo(() => {
    const m = new Map<string, OrchestrationAgent>();
    for (const a of agents) { m.set(a.id.toLowerCase(), a); m.set(a.name.toLowerCase(), a); }
    return m;
  }, [agents]);

  const filtered = useMemo(() => {
    const lq = query.trim().toLowerCase();
    return tasks.filter((t) => {
      if (statusFilter !== "all" && t.status !== statusFilter) return false;
      if (activeProjectRecord && t.projectId !== activeProjectRecord.id) return false;
      if (!lq) return true;
      return `${t.title} ${t.description ?? ""} ${t.assignee ?? ""} ${t.projectName}`.toLowerCase().includes(lq);
    }).sort((a, b) => {
      if (sortMode === "priority") return PRI_WEIGHT[a.priority] - PRI_WEIGHT[b.priority];
      if (sortMode === "created") return new Date(b.created).getTime() - new Date(a.created).getTime();
      return new Date(b.updated).getTime() - new Date(a.updated).getTime();
    });
  }, [tasks, query, statusFilter, activeProjectRecord, sortMode]);

  const grouped = useMemo(() => {
    if (groupMode === "none") return [{ key: "all", label: null, items: filtered }];
    const groups = new Map<string, TaskRow[]>();
    for (const t of filtered) {
      let key: string;
      if (groupMode === "status") key = t.status;
      else if (groupMode === "priority") key = t.priority;
      else if (groupMode === "assignee") key = t.assignee || "Unassigned";
      else key = t.projectName;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(t);
    }
    if (groupMode === "status") {
      return STATUS_ORDER.filter((s) => groups.has(s)).map((s) => ({ key: s, label: STATUS_LABEL[s], items: groups.get(s)! }));
    }
    return Array.from(groups.entries()).map(([k, items]) => ({ key: k, label: k, items }));
  }, [filtered, groupMode]);

  if (!loading && !company) {
    return <CompanyErrorState title="Company not found" detail="This company could not be resolved." href="/" />;
  }

  const selectStyle: React.CSSProperties = {
    height: "28px", appearance: "none" as const, borderRadius: "6px",
    border: "1px solid rgba(120,113,108,0.25)", background: "rgba(41,37,36,0.4)",
    padding: "0 24px 0 8px", fontSize: "12px", color: "#d6d3d1", outline: "none",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#0c0a09" }}>
      {/* toolbar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 16px", borderBottom: "1px solid rgba(120,113,108,0.15)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "5px 12px", borderRadius: "6px", border: "1px solid rgba(120,113,108,0.35)", background: "rgba(41,37,36,0.5)", fontSize: "12px", fontWeight: 600, color: "#f5f5f4", cursor: "pointer" }}
          >
            <Plus size={12} /> New Task
          </button>

          <div style={{ position: "relative" }}>
            <Search size={12} style={{ position: "absolute", left: "8px", top: "50%", transform: "translateY(-50%)", color: "#57534e", pointerEvents: "none" }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search tasks…"
              style={{ height: "28px", width: "200px", borderRadius: "6px", border: "1px solid rgba(120,113,108,0.25)", background: "rgba(41,37,36,0.4)", padding: "0 8px 0 28px", fontSize: "12px", color: "#f5f5f4", outline: "none" }}
            />
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <div style={{ position: "relative" }}>
            <SlidersHorizontal size={11} style={{ position: "absolute", left: "8px", top: "50%", transform: "translateY(-50%)", color: "#78716c", pointerEvents: "none" }} />
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "all" | TaskStatus)} style={{ ...selectStyle, paddingLeft: "24px" }}>
              <option value="all">All statuses</option>
              {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
            <ChevronDown size={10} style={{ position: "absolute", right: "6px", top: "50%", transform: "translateY(-50%)", color: "#57534e", pointerEvents: "none" }} />
          </div>

          <div style={{ position: "relative" }}>
            <select value={sortMode} onChange={(e) => setSortMode(e.target.value as SortMode)} style={selectStyle}>
              <option value="updated">Sort: Updated</option>
              <option value="created">Sort: Created</option>
              <option value="priority">Sort: Priority</option>
            </select>
            <ChevronDown size={10} style={{ position: "absolute", right: "6px", top: "50%", transform: "translateY(-50%)", color: "#57534e", pointerEvents: "none" }} />
          </div>

          <div style={{ position: "relative" }}>
            <select value={groupMode} onChange={(e) => setGroupMode(e.target.value as GroupMode)} style={selectStyle}>
              <option value="none">Group: None</option>
              <option value="status">Group: Status</option>
              <option value="priority">Group: Priority</option>
              <option value="assignee">Group: Assignee</option>
              <option value="project">Group: Project</option>
            </select>
            <ChevronDown size={10} style={{ position: "absolute", right: "6px", top: "50%", transform: "translateY(-50%)", color: "#57534e", pointerEvents: "none" }} />
          </div>
        </div>
      </div>

      {/* task list */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {loading ? (
          <div style={{ padding: "48px 16px", textAlign: "center", fontSize: "13px", color: "#57534e" }}>Loading tasks…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: "48px 16px", textAlign: "center", fontSize: "13px", color: "#57534e" }}>No tasks match filters.</div>
        ) : (
          grouped.map((group) => (
            <div key={group.key}>
              {group.label !== null && (
                <div style={{ padding: "8px 16px 4px", display: "flex", alignItems: "center", gap: "8px", borderBottom: "1px solid rgba(120,113,108,0.08)" }}>
                  {groupMode === "status" && <span style={{ width: "8px", height: "8px", borderRadius: "999px", background: STATUS_DOT[group.key as TaskStatus] ?? "#78716c" }} />}
                  <span style={{ fontSize: "12px", fontWeight: 600, color: "#a8a29e" }}>{group.label}</span>
                  <span style={{ fontSize: "11px", color: "#57534e" }}>{group.items.length}</span>
                </div>
              )}
              {group.items.map((task) => {
                const taskHref = `/companies/${encodeURIComponent(slug)}/projects/${encodeURIComponent(task.projectSlug)}/board?task=${encodeURIComponent(task.id)}`;
                const agent = agentMap.get((task.assignee ?? "").toLowerCase());
                return (
                  <Link
                    key={task.id}
                    href={taskHref}
                    style={{
                      display: "flex", alignItems: "center", gap: "12px",
                      padding: "8px 16px",
                      borderBottom: "1px solid rgba(120,113,108,0.06)",
                      textDecoration: "none",
                      transition: "background 80ms ease",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.02)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                  >
                    {/* status dot */}
                    <span style={{ width: "8px", height: "8px", borderRadius: "999px", background: STATUS_DOT[task.status], flexShrink: 0 }} />

                    {/* title */}
                    <span style={{ flex: 1, fontSize: "13px", color: "#f5f5f4", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.title}</span>

                    {/* assignee */}
                    <span style={{ fontSize: "12px", color: "#78716c", flexShrink: 0, width: "80px", textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {agent?.name ?? task.assignee ?? ""}
                    </span>

                    {/* date */}
                    <span style={{ fontSize: "11px", color: "#57534e", flexShrink: 0, width: "70px", textAlign: "right" }}>
                      {formatAge(task.updated)}
                    </span>
                  </Link>
                );
              })}
            </div>
          ))
        )}
      </div>
      <CreateTaskModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => { window.location.reload(); }}
        companySlug={slug}
        companyCode={company?.code ?? slug.slice(0, 3).toUpperCase()}
      />
    </div>
  );
}
