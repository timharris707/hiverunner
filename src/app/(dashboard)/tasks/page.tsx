"use client";

import { useEffect, useState } from "react";
import {
  Kanban,
  Plus,
  Circle,
  Clock,
  User,
  Tag,
  RefreshCw,
  CheckCircle2,
  Inbox,
  Play,
  Eye,
  Archive,
} from "lucide-react";

interface Task {
  id: string;
  title: string;
  description?: string;
  status: "backlog" | "in-progress" | "review" | "done";
  priority: "P0" | "P1" | "P2" | "P3";
  assignee?: string;
  project?: string;
  tags?: string[];
  created: string;
  updated: string;
  completedAt?: string;
}

const COLUMNS: { id: Task["status"]; label: string; icon: React.ComponentType<any>; color: string }[] = [
  { id: "backlog", label: "Backlog", icon: Inbox, color: "#6b7280" },
  { id: "in-progress", label: "In Progress", icon: Play, color: "#f59e0b" },
  { id: "review", label: "Review", icon: Eye, color: "#60a5fa" },
  { id: "done", label: "Done", icon: CheckCircle2, color: "#4ade80" },
];

const PRIORITY_COLORS: Record<string, string> = {
  P0: "#ef4444",
  P1: "#f97316",
  P2: "#f59e0b",
  P3: "#6b7280",
};

const PROJECT_COLORS: Record<string, string> = {
  "Crypto Trading Bot": "#4ade80",
  "Mission Control": "#60a5fa",
  "Karpathy Loop": "#f59e0b",
  Trading: "#4ade80",
  Engineering: "#60a5fa",
  Research: "#a78bfa",
  Org: "#94a3b8",
  Insight: "#f472b6",
  "New Product": "#c084fc",
};

const ASSIGNEE_EMOJIS: Record<string, string> = {
  Henry: "⚡",
  T1: "📈",
  T2: "🌩️",
  T3: "₿",
  "Backend Eng": "🔧",
  "Full-Stack Eng": "💻",
  Scout: "🔭",
  Quill: "✍️",
  Counsel: "⚖️",
};

function formatDate(dateStr: string) {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

function TaskCard({ task }: { task: Task }) {
  const projectColor = PROJECT_COLORS[task.project || ""] || "#6b7280";
  return (
    <div
      className="p-3 rounded-lg mb-2 last:mb-0 transition-all hover:scale-[1.01] cursor-pointer"
      style={{
        backgroundColor: "var(--card)",
        border: "1px solid var(--border)",
      }}
    >
      {/* Priority + Project */}
      <div className="flex items-center justify-between mb-2">
        <span
          className="text-xs font-bold px-1.5 py-0.5 rounded"
          style={{
            backgroundColor: `${PRIORITY_COLORS[task.priority]}20`,
            color: PRIORITY_COLORS[task.priority],
          }}
        >
          {task.priority}
        </span>
        {task.project && (
          <span
            className="text-xs px-2 py-0.5 rounded-full"
            style={{
              backgroundColor: `${projectColor}15`,
              color: projectColor,
              border: `1px solid ${projectColor}30`,
            }}
          >
            {task.project}
          </span>
        )}
      </div>

      {/* Title */}
      <div
        className="text-sm font-medium mb-1.5 leading-snug"
        style={{ color: "var(--text-primary)" }}
      >
        {task.title}
      </div>

      {/* Description */}
      {task.description && (
        <div
          className="text-xs mb-2 line-clamp-2 leading-relaxed"
          style={{ color: "var(--text-muted)" }}
        >
          {task.description}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between mt-2">
        <div className="flex items-center gap-1.5">
          {task.assignee && (
            <span
              className="text-xs flex items-center gap-1 px-1.5 py-0.5 rounded"
              style={{ backgroundColor: "var(--card-elevated)", color: "var(--text-secondary)" }}
            >
              <span>{ASSIGNEE_EMOJIS[task.assignee] || "🤖"}</span>
              {task.assignee}
            </span>
          )}
        </div>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          {formatDate(task.updated)}
        </span>
      </div>

      {/* Tags */}
      {task.tags && task.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {task.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="text-xs px-1.5 py-0.5 rounded"
              style={{ backgroundColor: "var(--surface-elevated)", color: "var(--text-muted)" }}
            >
              #{tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");

  const fetchTasks = async () => {
    try {
      const res = await fetch("/api/tasks");
      const data = await res.json();
      setTasks(data.tasks || []);
    } catch (error) {
      console.error("Error fetching tasks:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
  }, []);

  const projects = ["all", ...Array.from(new Set(tasks.map((t) => t.project || "").filter(Boolean)))];

  const filteredTasks = filter === "all" ? tasks : tasks.filter((t) => t.project === filter);

  const tasksByStatus = COLUMNS.reduce((acc, col) => {
    acc[col.id] = filteredTasks.filter((t) => t.status === col.id);
    return acc;
  }, {} as Record<string, Task[]>);

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[400px]">
        <div className="animate-pulse text-lg" style={{ color: "var(--text-muted)" }}>
          Loading tasks...
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1
              className="text-3xl font-bold mb-2"
              style={{
                fontFamily: "var(--font-heading)",
                color: "var(--text-primary)",
                letterSpacing: "-1.5px",
              }}
            >
              <Kanban className="inline-block w-8 h-8 mr-2 mb-1" />
              Task Board
            </h1>
            <p style={{ color: "var(--text-secondary)", fontSize: "14px" }}>
              {tasks.length} total tasks · {tasksByStatus["in-progress"]?.length || 0} in progress
            </p>
          </div>
          <button
            onClick={fetchTasks}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all hover:scale-105"
            style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>

        {/* Project Filter */}
        <div className="flex gap-2 mt-4 flex-wrap">
          {projects.map((p) => (
            <button
              key={p}
              onClick={() => setFilter(p)}
              className="text-sm px-3 py-1 rounded-full font-medium transition-all"
              style={{
                backgroundColor: filter === p ? "var(--accent)" : "var(--card)",
                color: filter === p ? "var(--background)" : "var(--text-secondary)",
                border: `1px solid ${filter === p ? "var(--accent)" : "var(--border)"}`,
              }}
            >
              {p === "all" ? "All Projects" : p}
              {p !== "all" && (
                <span className="ml-1.5 opacity-70">
                  {tasks.filter((t) => t.project === p).length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Kanban Board */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {COLUMNS.map((col) => {
          const colTasks = tasksByStatus[col.id] || [];
          const Icon = col.icon;
          return (
            <div key={col.id} className="flex flex-col">
              {/* Column Header */}
              <div
                className="flex items-center justify-between px-3 py-2.5 rounded-t-xl"
                style={{
                  backgroundColor: "var(--card)",
                  borderTop: `3px solid ${col.color}`,
                  borderLeft: "1px solid var(--border)",
                  borderRight: "1px solid var(--border)",
                }}
              >
                <div className="flex items-center gap-2">
                  <Icon className="w-4 h-4" style={{ color: col.color }} />
                  <span
                    className="text-sm font-semibold"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {col.label}
                  </span>
                </div>
                <span
                  className="text-xs font-bold px-2 py-0.5 rounded-full"
                  style={{
                    backgroundColor: `${col.color}20`,
                    color: col.color,
                  }}
                >
                  {colTasks.length}
                </span>
              </div>

              {/* Column Body */}
              <div
                className="flex-1 p-3 rounded-b-xl min-h-[200px]"
                style={{
                  backgroundColor: "var(--card-elevated)",
                  border: "1px solid var(--border)",
                  borderTop: "none",
                }}
              >
                {colTasks.length === 0 ? (
                  <div
                    className="text-center py-8 text-xs"
                    style={{ color: "var(--text-muted)" }}
                  >
                    No tasks
                  </div>
                ) : (
                  colTasks.map((task) => <TaskCard key={task.id} task={task} />)
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
