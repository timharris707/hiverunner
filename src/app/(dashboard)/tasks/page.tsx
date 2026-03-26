"use client";

import { useEffect, useState, useRef } from "react";
import {
  Kanban,
  Plus,
  Circle,
  Clock,
  RefreshCw,
  CheckCircle2,
  Inbox,
  Play,
  Eye,
  X,
  GripVertical,
  ListOrdered,
} from "lucide-react";

interface Task {
  id: string;
  title: string;
  description?: string;
  status: "backlog" | "on-deck" | "in-progress" | "review" | "done";
  priority: "P0" | "P1" | "P2" | "P3";
  assignee?: string;
  project?: string;
  type?: "feature" | "bug" | "maintenance";
  tags?: string[];
  created: string;
  updated: string;
  completedAt?: string;
}

interface ProjectInfo {
  id: string;
  name: string;
  emoji: string;
  color: string;
}

const COLUMNS: { id: Task["status"]; label: string; icon: React.ComponentType<any>; color: string }[] = [
  { id: "backlog", label: "Backlog", icon: Inbox, color: "#6b7280" },
  { id: "on-deck", label: "On Deck", icon: ListOrdered, color: "#c084fc" },
  { id: "in-progress", label: "In Progress", icon: Play, color: "#f59e0b" },
  { id: "done", label: "Done", icon: CheckCircle2, color: "#4ade80" },
];

const PRIORITY_COLORS: Record<string, string> = {
  P0: "#ef4444",
  P1: "#f97316",
  P2: "#f59e0b",
  P3: "#6b7280",
};

// PROJECT_COLORS is now loaded dynamically from projects.json

const ASSIGNEE_EMOJIS: Record<string, string> = {
  Henry: "⚡",
  "Atlas 📈": "📈",
  "Nimbus 🌤️": "🌤️",
  "Cipher ₿": "₿",
  "Quant 📊": "📊",
  "Forge 🔧": "🔧",
  "Pixel 💻": "💻",
  Scout: "🔭",
  Quill: "✍️",
  Counsel: "⚖️",
};

const ALL_ASSIGNEES = Object.keys(ASSIGNEE_EMOJIS);
const ALL_PRIORITIES = ["P0", "P1", "P2", "P3"] as const;

function formatDate(dateStr: string) {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

interface NewTaskModalProps {
  onClose: () => void;
  onSave: (task: Partial<Task>) => void;
  defaultStatus?: Task["status"];
  projectsMap: Record<string, ProjectInfo>;
}

function NewTaskModal({ onClose, onSave, defaultStatus = "backlog", projectsMap }: NewTaskModalProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<Task["status"]>(defaultStatus);
  const [priority, setPriority] = useState<Task["priority"]>("P2");
  const [assignee, setAssignee] = useState("");
  const [project, setProject] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    await onSave({ title: title.trim(), description: description.trim() || undefined, status, priority, assignee: assignee || undefined, project: project || undefined });
    setSaving(false);
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "1rem" }}
      onClick={onClose}
    >
      <div
        style={{ backgroundColor: "var(--card)", borderRadius: "1rem", width: "100%", maxWidth: "520px", border: "1px solid var(--border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1.25rem 1.5rem", borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ fontFamily: "var(--font-heading)", fontWeight: 700, color: "var(--text-primary)", fontSize: "1.1rem" }}>
            <Plus className="inline-block w-5 h-5 mr-2 mb-0.5" />
            New Task
          </h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: "0.25rem" }}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: "0.375rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Title *
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs to be done?"
              autoFocus
              style={{ width: "100%", padding: "0.625rem 0.875rem", borderRadius: "0.5rem", backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)", fontSize: "0.875rem", outline: "none", boxSizing: "border-box" }}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: "0.375rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional details..."
              rows={3}
              style={{ width: "100%", padding: "0.625rem 0.875rem", borderRadius: "0.5rem", backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)", fontSize: "0.875rem", outline: "none", resize: "vertical", boxSizing: "border-box", fontFamily: "inherit" }}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: "0.375rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Priority
              </label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as Task["priority"])}
                style={{ width: "100%", padding: "0.625rem 0.875rem", borderRadius: "0.5rem", backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)", color: PRIORITY_COLORS[priority], fontSize: "0.875rem", outline: "none", fontWeight: 700 }}
              >
                {ALL_PRIORITIES.map((p) => (
                  <option key={p} value={p} style={{ color: PRIORITY_COLORS[p] }}>{p} — {p === "P0" ? "Critical" : p === "P1" ? "High" : p === "P2" ? "Medium" : "Low"}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: "0.375rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Status
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as Task["status"])}
                style={{ width: "100%", padding: "0.625rem 0.875rem", borderRadius: "0.5rem", backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)", fontSize: "0.875rem", outline: "none" }}
              >
                {COLUMNS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: "0.375rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Assignee
              </label>
              <select
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                style={{ width: "100%", padding: "0.625rem 0.875rem", borderRadius: "0.5rem", backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)", fontSize: "0.875rem", outline: "none" }}
              >
                <option value="">Unassigned</option>
                {ALL_ASSIGNEES.map((a) => <option key={a} value={a}>{ASSIGNEE_EMOJIS[a]} {a}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: "0.375rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Project
              </label>
              <select
                value={project}
                onChange={(e) => setProject(e.target.value)}
                style={{ width: "100%", padding: "0.625rem 0.875rem", borderRadius: "0.5rem", backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)", fontSize: "0.875rem", outline: "none" }}
              >
                <option value="">No Project</option>
                {Object.values(projectsMap).map((p) => <option key={p.id} value={p.id}>{p.emoji} {p.name}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: "flex", gap: "0.75rem", paddingTop: "0.5rem" }}>
            <button
              type="button"
              onClick={onClose}
              style={{ flex: 1, padding: "0.625rem", borderRadius: "0.5rem", backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)", cursor: "pointer", fontSize: "0.875rem", fontWeight: 600 }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim() || saving}
              style={{
                flex: 2, padding: "0.625rem", borderRadius: "0.5rem",
                backgroundColor: title.trim() ? "var(--accent)" : "var(--card-elevated)",
                border: "none", color: title.trim() ? "#000" : "var(--text-muted)",
                cursor: title.trim() ? "pointer" : "not-allowed", fontSize: "0.875rem", fontWeight: 700,
                opacity: saving ? 0.7 : 1,
              }}
            >
              {saving ? "Creating..." : "Create Task"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function TaskCard({ task, onDragStart, onStatusChange, projectsMap }: { task: Task; onDragStart: (e: React.DragEvent, task: Task) => void; onStatusChange: (id: string, status: Task["status"]) => void; projectsMap: Record<string, ProjectInfo> }) {
  const proj = projectsMap[task.project || ""];
  const projectColor = proj?.color || "#6b7280";
  const projectLabel = proj ? `${proj.emoji} ${proj.name}` : task.project || "";
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, task)}
      className="p-3 rounded-lg mb-2 last:mb-0 transition-all hover:scale-[1.01] cursor-grab active:cursor-grabbing"
      style={{
        backgroundColor: "var(--card)",
        border: "1px solid var(--border)",
        borderLeft: `3px solid ${projectColor}`,
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
            className="text-xs px-1.5 py-0.5 rounded truncate max-w-[140px]"
            style={{
              backgroundColor: `${projectColor}15`,
              color: projectColor,
              border: `1px solid ${projectColor}30`,
            }}
          >
            {projectLabel}
          </span>
        )}
      </div>

      {/* Title */}
      <div
        className="text-sm font-medium mb-1 leading-snug"
        style={{ color: "var(--text-primary)" }}
      >
        {task.title}
      </div>

      {task.description && (
        <div className="text-xs mb-2 line-clamp-2" style={{ color: "var(--text-muted)" }}>
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
  const [projectsMap, setProjectsMap] = useState<Record<string, ProjectInfo>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const [showNewTask, setShowNewTask] = useState(false);
  const [newTaskStatus, setNewTaskStatus] = useState<Task["status"]>("backlog");
  const [draggedTask, setDraggedTask] = useState<Task | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<Task["status"] | null>(null);

  // Listen for Cmd+T global shortcut to open new task modal
  useEffect(() => {
    const openNewTask = () => setShowNewTask(true);
    window.addEventListener("mission-control:open-new-task", openNewTask);
    return () => window.removeEventListener("mission-control:open-new-task", openNewTask);
  }, []);

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
    // Fetch projects for colors/names
    fetch("/api/projects")
      .then((r) => r.json())
      .then((data) => {
        const map: Record<string, ProjectInfo> = {};
        for (const p of data.projects || []) {
          map[p.id] = { id: p.id, name: p.name, emoji: p.emoji, color: p.color };
        }
        setProjectsMap(map);
      })
      .catch(console.error);
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchTasks, 30_000);
    return () => clearInterval(interval);
  }, []);

  const handleCreateTask = async (taskData: Partial<Task>) => {
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(taskData),
      });
      const data = await res.json();
      if (data.task) {
        setTasks((prev) => [data.task, ...prev]);
        setShowNewTask(false);
      }
    } catch (error) {
      console.error("Error creating task:", error);
    }
  };

  const handleStatusChange = async (id: string, newStatus: Task["status"]) => {
    // Optimistic update
    setTasks((prev) => prev.map((t) => t.id === id ? { ...t, status: newStatus, updated: new Date().toISOString() } : t));
    try {
      await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status: newStatus }),
      });
    } catch (error) {
      console.error("Error updating task:", error);
      fetchTasks(); // revert on error
    }
  };

  // Drag & drop handlers
  const handleDragStart = (e: React.DragEvent, task: Task) => {
    setDraggedTask(task);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, columnId: Task["status"]) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverColumn(columnId);
  };

  const handleDrop = (e: React.DragEvent, columnId: Task["status"]) => {
    e.preventDefault();
    if (draggedTask && draggedTask.status !== columnId) {
      handleStatusChange(draggedTask.id, columnId);
    }
    setDraggedTask(null);
    setDragOverColumn(null);
  };

  const handleDragEnd = () => {
    setDraggedTask(null);
    setDragOverColumn(null);
  };

  const projectIds = ["all", ...Array.from(new Set(tasks.map((t) => t.project || "").filter(Boolean)))];
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
          <div className="flex items-center gap-2">
            <button
              onClick={fetchTasks}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all hover:scale-105"
              style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
            <button
              onClick={() => { setNewTaskStatus("backlog"); setShowNewTask(true); }}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all hover:scale-105"
              style={{ backgroundColor: "var(--accent)", border: "none", color: "#000", fontWeight: 700 }}
            >
              <Plus className="w-4 h-4" />
              New Task
            </button>
          </div>
        </div>

        {/* Project Filter */}
        <div className="flex gap-2 mt-4 flex-wrap">
          {projectIds.map((p) => {
            const proj = projectsMap[p];
            const label = p === "all" ? "All Projects" : proj ? `${proj.emoji} ${proj.name}` : p;
            return (
              <button
                key={p}
                onClick={() => setFilter(p)}
                className="text-sm px-3 py-1 rounded-full font-medium transition-all"
                style={{
                  backgroundColor: filter === p ? "var(--accent)" : "var(--card)",
                  color: filter === p ? "var(--background)" : "var(--text-secondary)",
                  border: `1px solid ${filter === p ? "var(--accent)" : "var(--border)"}`,
                  cursor: "pointer",
                }}
              >
                {label}
                {p !== "all" && (
                  <span className="ml-1.5 opacity-70">
                    {tasks.filter((t) => t.project === p).length}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Kanban Board */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {COLUMNS.map((col) => {
          const colTasks = tasksByStatus[col.id] || [];
          const Icon = col.icon;
          const isOver = dragOverColumn === col.id;
          return (
            <div
              key={col.id}
              className="flex flex-col"
              onDragOver={(e) => handleDragOver(e, col.id)}
              onDrop={(e) => handleDrop(e, col.id)}
              onDragLeave={() => setDragOverColumn(null)}
            >
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
                <div className="flex items-center gap-2">
                  <span
                    className="text-xs font-bold px-2 py-0.5 rounded-full"
                    style={{
                      backgroundColor: `${col.color}20`,
                      color: col.color,
                    }}
                  >
                    {colTasks.length}
                  </span>
                  <button
                    onClick={() => { setNewTaskStatus(col.id); setShowNewTask(true); }}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: "0.125rem", borderRadius: "0.25rem" }}
                    title={`Add to ${col.label}`}
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Column Body */}
              <div
                className="flex-1 p-3 rounded-b-xl min-h-[200px] transition-colors"
                style={{
                  backgroundColor: isOver ? `${col.color}10` : "var(--card-elevated)",
                  border: isOver ? `1px dashed ${col.color}80` : "1px solid var(--border)",
                  borderTop: "none",
                }}
              >
                {colTasks.length === 0 ? (
                  <div
                    className="text-center py-8 text-xs"
                    style={{ color: isOver ? col.color : "var(--text-muted)", opacity: isOver ? 1 : 0.6 }}
                  >
                    {isOver ? "Drop here" : "No tasks"}
                  </div>
                ) : (
                  colTasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      onDragStart={handleDragStart}
                      onStatusChange={handleStatusChange}
                      projectsMap={projectsMap}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* New Task Modal */}
      {showNewTask && (
        <NewTaskModal
          onClose={() => setShowNewTask(false)}
          onSave={handleCreateTask}
          defaultStatus={newTaskStatus}
          projectsMap={projectsMap}
        />
      )}
    </div>
  );
}
