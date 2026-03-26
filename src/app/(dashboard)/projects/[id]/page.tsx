"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ExternalLink,
  Calendar,
  CheckCircle2,
  Clock,
  Inbox,
  Eye,
  Play,
  Bug,
  Wrench,
  Sparkles,
  Plus,
  ChevronDown,
} from "lucide-react";
import { AgentAvatar } from "@/components/AgentAvatar";

interface Task {
  id: string;
  title: string;
  description?: string;
  status: "backlog" | "in-progress" | "review" | "done";
  priority: "P0" | "P1" | "P2" | "P3";
  assignee?: string;
  project?: string;
  type?: "feature" | "bug" | "maintenance";
  tags?: string[];
  created: string;
  updated: string;
  completedAt?: string;
}

interface Project {
  id: string;
  name: string;
  emoji: string;
  color: string;
  description: string;
  status: "active" | "completed" | "on-hold";
  owner: string;
  repo: string;
  created: string;
  taskCount: number;
  inProgress: number;
  completed: number;
  backlog: number;
  review: number;
}

interface Takeaway {
  id: string;
  title: string;
  description: string;
  priority: string;
  status: string;
  assigned_to: string;
}

const PRIORITY_COLORS: Record<string, string> = {
  P0: "#ef4444",
  P1: "#f97316",
  P2: "#f59e0b",
  P3: "#6b7280",
};

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ComponentType<any> }> = {
  backlog: { label: "Backlog", color: "#6b7280", icon: Inbox },
  "in-progress": { label: "In Progress", color: "#f59e0b", icon: Play },
  review: { label: "Review", color: "#60a5fa", icon: Eye },
  done: { label: "Done", color: "#4ade80", icon: CheckCircle2 },
};

const TYPE_CONFIG: Record<string, { label: string; color: string; icon: React.ComponentType<any> }> = {
  feature: { label: "Feature", color: "#8B5CF6", icon: Sparkles },
  bug: { label: "Bug", color: "#ef4444", icon: Bug },
  maintenance: { label: "Maintenance", color: "#6b7280", icon: Wrench },
};

const STATUS_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  active: { bg: "#10B98120", text: "#10B981", label: "Active" },
  completed: { bg: "#3B82F620", text: "#3B82F6", label: "Completed" },
  "on-hold": { bg: "#F59E0B20", text: "#F59E0B", label: "On Hold" },
};

function formatDate(dateStr: string) {
  try {
    return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div
      className="rounded-xl p-4"
      style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
    >
      <div className="text-2xl font-bold" style={{ color, fontFamily: "var(--font-heading)" }}>
        {value}
      </div>
      <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{label}</div>
    </div>
  );
}

function TaskRow({
  task,
  projectColor,
  onStatusChange,
}: {
  task: Task;
  projectColor: string;
  onStatusChange: (id: string, status: Task["status"]) => void;
}) {
  const [open, setOpen] = useState(false);
  const statusConf = STATUS_CONFIG[task.status];
  const typeConf = TYPE_CONFIG[task.type || "feature"];
  const StatusIcon = statusConf.icon;
  const TypeIcon = typeConf.icon;

  return (
    <div
      className="flex items-center gap-3 p-3 rounded-lg transition-all"
      style={{
        backgroundColor: "var(--card)",
        border: "1px solid var(--border)",
        borderLeft: `3px solid ${projectColor}`,
      }}
    >
      <StatusIcon size={16} style={{ color: statusConf.color, flexShrink: 0 }} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>
            {task.title}
          </span>
        </div>
        {task.description && (
          <p className="text-xs truncate mt-0.5" style={{ color: "var(--text-muted)" }}>
            {task.description}
          </p>
        )}
      </div>

      {/* Type badge */}
      <span
        className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full flex-shrink-0"
        style={{ backgroundColor: `${typeConf.color}15`, color: typeConf.color }}
      >
        <TypeIcon size={10} />
        {typeConf.label}
      </span>

      {/* Priority */}
      <span
        className="text-xs font-bold px-1.5 py-0.5 rounded flex-shrink-0"
        style={{ backgroundColor: `${PRIORITY_COLORS[task.priority]}20`, color: PRIORITY_COLORS[task.priority] }}
      >
        {task.priority}
      </span>

      {/* Assignee */}
      {task.assignee && (
        <AgentAvatar agentId={task.assignee.replace(/\s*[\u{1F000}-\u{1FFFF}\u{2600}-\u{27FF}]+$/u, "")} size={24} borderWidth={1} />
      )}

      {/* Status dropdown */}
      <div className="relative flex-shrink-0">
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1 text-xs px-2 py-1 rounded-md"
          style={{
            backgroundColor: `${statusConf.color}15`,
            color: statusConf.color,
            border: `1px solid ${statusConf.color}30`,
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          {statusConf.label}
          <ChevronDown size={12} />
        </button>
        {open && (
          <div
            className="absolute right-0 top-full mt-1 z-50 rounded-lg overflow-hidden"
            style={{ backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)", minWidth: "140px" }}
          >
            {Object.entries(STATUS_CONFIG).map(([key, conf]) => (
              <button
                key={key}
                onClick={() => {
                  onStatusChange(task.id, key as Task["status"]);
                  setOpen(false);
                }}
                className="flex items-center gap-2 w-full text-left px-3 py-2 text-xs transition-colors"
                style={{
                  color: task.status === key ? conf.color : "var(--text-secondary)",
                  backgroundColor: task.status === key ? `${conf.color}10` : "transparent",
                  border: "none",
                  cursor: "pointer",
                  fontWeight: task.status === key ? 600 : 400,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--surface-hover)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = task.status === key ? `${conf.color}10` : "transparent"; }}
              >
                {conf.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <span className="text-xs flex-shrink-0" style={{ color: "var(--text-muted)" }}>
        {formatDate(task.updated || task.created)}
      </span>
    </div>
  );
}

export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [ideas, setIdeas] = useState<Takeaway[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"overview" | "tasks" | "ideas">("overview");

  // Task filters
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");

  useEffect(() => {
    Promise.all([
      fetch(`/api/projects/${id}`).then((r) => r.json()),
      fetch("/api/ideas").then((r) => r.json()).catch(() => ({ reviews: [] })),
    ])
      .then(([projData, ideasData]) => {
        setProject(projData.project || null);
        setTasks(projData.tasks || []);
        // Extract takeaways from reviews that match this project
        const allTakeaways: Takeaway[] = [];
        for (const review of ideasData.reviews || []) {
          for (const t of review.takeaways || []) {
            // Match by project tag or assigned_to
            if (
              t.assigned_to?.toLowerCase().includes(id) ||
              review.tags?.some((tag: string) => tag.toLowerCase() === id)
            ) {
              allTakeaways.push(t);
            }
          }
        }
        setIdeas(allTakeaways);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  const handleStatusChange = async (taskId: string, newStatus: Task["status"]) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status: newStatus, updated: new Date().toISOString() } : t))
    );
    try {
      await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: taskId, status: newStatus }),
      });
    } catch (error) {
      console.error("Error updating task:", error);
    }
  };

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[400px]">
        <div className="animate-pulse text-lg" style={{ color: "var(--text-muted)" }}>Loading project...</div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="p-8 text-center" style={{ color: "var(--text-muted)" }}>
        <p className="text-lg mb-4">Project not found</p>
        <Link href="/projects" style={{ color: "var(--accent)" }}>Back to Projects</Link>
      </div>
    );
  }

  const statusBadge = STATUS_BADGE[project.status] || STATUS_BADGE.active;
  const progressPct = project.taskCount > 0 ? Math.round((project.completed / project.taskCount) * 100) : 0;

  // Filtered tasks
  const filteredTasks = tasks.filter((t) => {
    if (statusFilter !== "all" && t.status !== statusFilter) return false;
    if (typeFilter !== "all" && t.type !== typeFilter) return false;
    if (priorityFilter !== "all" && t.priority !== priorityFilter) return false;
    return true;
  });

  // Overview stats
  const byType = {
    feature: tasks.filter((t) => t.type === "feature").length,
    bug: tasks.filter((t) => t.type === "bug").length,
    maintenance: tasks.filter((t) => t.type === "maintenance").length,
  };
  const byPriority = {
    P0: tasks.filter((t) => t.priority === "P0").length,
    P1: tasks.filter((t) => t.priority === "P1").length,
    P2: tasks.filter((t) => t.priority === "P2").length,
    P3: tasks.filter((t) => t.priority === "P3").length,
  };
  const recentTasks = [...tasks].sort((a, b) => new Date(b.updated || b.created).getTime() - new Date(a.updated || a.created).getTime()).slice(0, 5);

  return (
    <div className="p-4 md:p-8">
      {/* Back link */}
      <Link
        href="/projects"
        className="inline-flex items-center gap-1.5 text-sm mb-6 transition-colors"
        style={{ color: "var(--text-muted)", textDecoration: "none" }}
      >
        <ArrowLeft size={16} /> Back to Projects
      </Link>

      {/* Header */}
      <div className="mb-8">
        <div className="flex items-start gap-4 flex-wrap">
          <span style={{ fontSize: "3rem", lineHeight: 1 }}>{project.emoji}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1
                className="text-3xl font-bold"
                style={{ fontFamily: "var(--font-heading)", color: "var(--text-primary)", letterSpacing: "-1.5px" }}
              >
                {project.name}
              </h1>
              <span
                className="text-xs font-semibold px-2.5 py-1 rounded-full"
                style={{ backgroundColor: statusBadge.bg, color: statusBadge.text }}
              >
                {statusBadge.label}
              </span>
            </div>
            <p className="text-sm mt-2" style={{ color: "var(--text-secondary)", lineHeight: 1.6 }}>
              {project.description}
            </p>
            <div className="flex items-center gap-4 mt-3 flex-wrap">
              <div className="flex items-center gap-2">
                <AgentAvatar agentId={project.owner} size={24} borderWidth={1} />
                <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                  {project.owner.charAt(0).toUpperCase() + project.owner.slice(1)}
                </span>
              </div>
              {project.repo && (
                <a
                  href={`https://github.com/${project.repo}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs"
                  style={{ color: "var(--text-muted)", textDecoration: "none" }}
                >
                  <ExternalLink size={12} /> {project.repo}
                </a>
              )}
              <div className="flex items-center gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
                <Calendar size={12} /> Created {formatDate(project.created)}
              </div>
            </div>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-6" style={{ maxWidth: "400px" }}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Progress</span>
            <span className="text-xs font-bold" style={{ color: project.color }}>{progressPct}%</span>
          </div>
          <div style={{ height: "8px", borderRadius: "4px", backgroundColor: "var(--surface-elevated)", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${progressPct}%`, borderRadius: "4px", backgroundColor: project.color, transition: "width 0.5s ease" }} />
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6" style={{ borderBottom: "1px solid var(--border)", paddingBottom: "0" }}>
        {(["overview", "tasks", "ideas"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="px-4 py-2.5 text-sm font-medium transition-all"
            style={{
              color: tab === t ? "var(--accent)" : "var(--text-muted)",
              borderBottom: tab === t ? "2px solid var(--accent)" : "2px solid transparent",
              backgroundColor: "transparent",
              border: "none",
              borderBottomWidth: "2px",
              borderBottomStyle: "solid",
              borderBottomColor: tab === t ? "var(--accent)" : "transparent",
              cursor: "pointer",
              marginBottom: "-1px",
            }}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
            {t === "tasks" && <span className="ml-1.5 opacity-60">{tasks.length}</span>}
            {t === "ideas" && <span className="ml-1.5 opacity-60">{ideas.length}</span>}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "overview" && (
        <div>
          {/* Status stats */}
          <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-heading)" }}>
            Task Status
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
            <StatCard label="Backlog" value={project.backlog} color="#6b7280" />
            <StatCard label="In Progress" value={project.inProgress} color="#f59e0b" />
            <StatCard label="Review" value={project.review} color="#60a5fa" />
            <StatCard label="Done" value={project.completed} color="#4ade80" />
          </div>

          {/* Type breakdown */}
          <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-heading)" }}>
            By Type
          </h3>
          <div className="grid grid-cols-3 gap-3 mb-8">
            <StatCard label="Features" value={byType.feature} color="#8B5CF6" />
            <StatCard label="Bugs" value={byType.bug} color="#ef4444" />
            <StatCard label="Maintenance" value={byType.maintenance} color="#6b7280" />
          </div>

          {/* Priority breakdown */}
          <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-heading)" }}>
            By Priority
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
            <StatCard label="P0 Critical" value={byPriority.P0} color="#ef4444" />
            <StatCard label="P1 High" value={byPriority.P1} color="#f97316" />
            <StatCard label="P2 Medium" value={byPriority.P2} color="#f59e0b" />
            <StatCard label="P3 Low" value={byPriority.P3} color="#6b7280" />
          </div>

          {/* Recent activity */}
          <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-heading)" }}>
            Recent Activity
          </h3>
          <div className="flex flex-col gap-2">
            {recentTasks.map((task) => (
              <TaskRow key={task.id} task={task} projectColor={project.color} onStatusChange={handleStatusChange} />
            ))}
            {recentTasks.length === 0 && (
              <div className="text-center py-8 text-sm" style={{ color: "var(--text-muted)" }}>No tasks yet</div>
            )}
          </div>
        </div>
      )}

      {tab === "tasks" && (
        <div>
          {/* Filters */}
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <div className="flex gap-1.5 flex-wrap">
              {[{ key: "all", label: "All" }, ...Object.entries(STATUS_CONFIG).map(([k, v]) => ({ key: k, label: v.label }))].map((f) => (
                <button
                  key={f.key}
                  onClick={() => setStatusFilter(f.key)}
                  className="text-xs px-2.5 py-1 rounded-full font-medium transition-all"
                  style={{
                    backgroundColor: statusFilter === f.key ? "var(--accent)" : "var(--card)",
                    color: statusFilter === f.key ? "#000" : "var(--text-secondary)",
                    border: `1px solid ${statusFilter === f.key ? "var(--accent)" : "var(--border)"}`,
                    cursor: "pointer",
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <div style={{ width: "1px", height: "20px", backgroundColor: "var(--border)" }} />

            <div className="flex gap-1.5 flex-wrap">
              {[{ key: "all", label: "All Types" }, ...Object.entries(TYPE_CONFIG).map(([k, v]) => ({ key: k, label: v.label }))].map((f) => (
                <button
                  key={f.key}
                  onClick={() => setTypeFilter(f.key)}
                  className="text-xs px-2.5 py-1 rounded-full font-medium transition-all"
                  style={{
                    backgroundColor: typeFilter === f.key ? "var(--accent)" : "var(--card)",
                    color: typeFilter === f.key ? "#000" : "var(--text-secondary)",
                    border: `1px solid ${typeFilter === f.key ? "var(--accent)" : "var(--border)"}`,
                    cursor: "pointer",
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <div style={{ width: "1px", height: "20px", backgroundColor: "var(--border)" }} />

            <div className="flex gap-1.5 flex-wrap">
              {["all", "P0", "P1", "P2", "P3"].map((p) => (
                <button
                  key={p}
                  onClick={() => setPriorityFilter(p)}
                  className="text-xs px-2.5 py-1 rounded-full font-medium transition-all"
                  style={{
                    backgroundColor: priorityFilter === p ? "var(--accent)" : "var(--card)",
                    color: priorityFilter === p ? "#000" : p === "all" ? "var(--text-secondary)" : PRIORITY_COLORS[p],
                    border: `1px solid ${priorityFilter === p ? "var(--accent)" : "var(--border)"}`,
                    cursor: "pointer",
                  }}
                >
                  {p === "all" ? "All Priorities" : p}
                </button>
              ))}
            </div>
          </div>

          {/* Task list */}
          <div className="flex flex-col gap-2">
            {filteredTasks.map((task) => (
              <TaskRow key={task.id} task={task} projectColor={project.color} onStatusChange={handleStatusChange} />
            ))}
            {filteredTasks.length === 0 && (
              <div className="text-center py-12 text-sm" style={{ color: "var(--text-muted)" }}>
                No tasks match your filters
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "ideas" && (
        <div>
          {ideas.length > 0 ? (
            <div className="flex flex-col gap-2">
              {ideas.map((idea) => (
                <div
                  key={idea.id}
                  className="p-4 rounded-lg"
                  style={{
                    backgroundColor: "var(--card)",
                    border: "1px solid var(--border)",
                    borderLeft: `3px solid ${project.color}`,
                  }}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                      {idea.title}
                    </span>
                    {idea.priority && (
                      <span
                        className="text-xs px-1.5 py-0.5 rounded"
                        style={{ backgroundColor: "#F59E0B20", color: "#F59E0B" }}
                      >
                        {idea.priority}
                      </span>
                    )}
                    {idea.status && (
                      <span
                        className="text-xs px-1.5 py-0.5 rounded"
                        style={{ backgroundColor: "#3B82F620", color: "#3B82F6" }}
                      >
                        {idea.status}
                      </span>
                    )}
                  </div>
                  <p className="text-xs" style={{ color: "var(--text-muted)", lineHeight: 1.5 }}>
                    {idea.description}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-16" style={{ color: "var(--text-muted)" }}>
              <p className="text-sm">No ideas linked to this project yet.</p>
              <p className="text-xs mt-2">Ideas from the Idea Intake pipeline will appear here when tagged with this project.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
