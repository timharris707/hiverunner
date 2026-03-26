"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FolderOpen, LayoutGrid, List, ExternalLink, Calendar } from "lucide-react";
import { AgentAvatar } from "@/components/AgentAvatar";

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

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  active: { bg: "#10B98120", text: "#10B981", label: "Active" },
  inactive: { bg: "#6B728020", text: "#9CA3AF", label: "Inactive" },
  completed: { bg: "#3B82F620", text: "#3B82F6", label: "Completed" },
  archived: { bg: "#52525B20", text: "#71717A", label: "Archived" },
  "on-hold": { bg: "#F59E0B20", text: "#F59E0B", label: "On Hold" },
};

function formatDate(dateStr: string) {
  try {
    return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "";
  }
}

function ProjectCard({ project }: { project: Project }) {
  const statusStyle = STATUS_STYLES[project.status] || STATUS_STYLES.active;
  const progressPct = project.taskCount > 0 ? Math.round((project.completed / project.taskCount) * 100) : 0;

  return (
    <Link
      href={`/projects/${project.id}`}
      className="block transition-all hover:scale-[1.01]"
      style={{
        backgroundColor: "var(--card)",
        border: "1px solid var(--border)",
        borderLeft: `4px solid ${project.color}`,
        borderRadius: "12px",
        padding: "1.5rem",
        textDecoration: "none",
        cursor: "pointer",
      }}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <span style={{ fontSize: "2rem", lineHeight: 1 }}>{project.emoji}</span>
          <div>
            <h3
              className="text-lg font-bold"
              style={{ fontFamily: "var(--font-heading)", color: "var(--text-primary)", letterSpacing: "-0.5px" }}
            >
              {project.name}
            </h3>
            <span
              className="text-xs font-semibold px-2 py-0.5 rounded-full inline-block mt-1"
              style={{ backgroundColor: statusStyle.bg, color: statusStyle.text }}
            >
              {statusStyle.label}
            </span>
          </div>
        </div>
      </div>

      {/* Description */}
      <p className="text-sm mb-4 line-clamp-2" style={{ color: "var(--text-secondary)", lineHeight: 1.5 }}>
        {project.description}
      </p>

      {/* Owner */}
      <div className="flex items-center gap-2 mb-4">
        <AgentAvatar agentId={project.owner} size={24} borderWidth={1} />
        <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
          {project.owner.charAt(0).toUpperCase() + project.owner.slice(1)}
        </span>
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-4 text-xs mb-3" style={{ color: "var(--text-muted)" }}>
        <span>
          <strong style={{ color: "var(--text-secondary)" }}>{project.taskCount}</strong> tasks
        </span>
        <span>
          <strong style={{ color: "#F59E0B" }}>{project.inProgress}</strong> active
        </span>
        <span>
          <strong style={{ color: "#4ade80" }}>{project.completed}</strong> done
        </span>
      </div>

      {/* Progress bar */}
      <div className="mb-3">
        <div
          style={{
            height: "6px",
            borderRadius: "3px",
            backgroundColor: "var(--surface-elevated)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${progressPct}%`,
              borderRadius: "3px",
              backgroundColor: project.color,
              transition: "width 0.5s ease",
            }}
          />
        </div>
        <div className="flex items-center justify-between mt-1">
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>{progressPct}% complete</span>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
          <Calendar size={12} />
          {formatDate(project.created)}
        </div>
        {project.repo && (
          <span className="flex items-center gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
            <ExternalLink size={12} />
            Repo
          </span>
        )}
      </div>
    </Link>
  );
}

function ProjectRow({ project }: { project: Project }) {
  const statusStyle = STATUS_STYLES[project.status] || STATUS_STYLES.active;
  const progressPct = project.taskCount > 0 ? Math.round((project.completed / project.taskCount) * 100) : 0;

  return (
    <Link
      href={`/projects/${project.id}`}
      className="flex items-center gap-4 transition-all hover:scale-[1.005]"
      style={{
        backgroundColor: "var(--card)",
        border: "1px solid var(--border)",
        borderLeft: `4px solid ${project.color}`,
        borderRadius: "10px",
        padding: "1rem 1.25rem",
        textDecoration: "none",
        cursor: "pointer",
      }}
    >
      <span style={{ fontSize: "1.5rem", lineHeight: 1, flexShrink: 0 }}>{project.emoji}</span>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3
            className="text-sm font-bold truncate"
            style={{ fontFamily: "var(--font-heading)", color: "var(--text-primary)" }}
          >
            {project.name}
          </h3>
          <span
            className="text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0"
            style={{ backgroundColor: statusStyle.bg, color: statusStyle.text }}
          >
            {statusStyle.label}
          </span>
        </div>
        <p className="text-xs truncate mt-0.5" style={{ color: "var(--text-muted)" }}>
          {project.description}
        </p>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <AgentAvatar agentId={project.owner} size={24} borderWidth={1} />
      </div>

      <div className="flex items-center gap-4 text-xs flex-shrink-0" style={{ color: "var(--text-muted)", minWidth: "180px" }}>
        <span><strong style={{ color: "var(--text-secondary)" }}>{project.taskCount}</strong> tasks</span>
        <span><strong style={{ color: "#F59E0B" }}>{project.inProgress}</strong> active</span>
        <span><strong style={{ color: "#4ade80" }}>{project.completed}</strong> done</span>
      </div>

      <div className="flex-shrink-0" style={{ width: "100px" }}>
        <div
          style={{
            height: "6px",
            borderRadius: "3px",
            backgroundColor: "var(--surface-elevated)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${progressPct}%`,
              borderRadius: "3px",
              backgroundColor: project.color,
            }}
          />
        </div>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>{progressPct}%</span>
      </div>
    </Link>
  );
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [view, setView] = useState<"grid" | "list">("grid");

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((data) => setProjects(data.projects || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const filtered = statusFilter === "all" ? projects : projects.filter((p) => p.status === statusFilter);

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[400px]">
        <div className="animate-pulse text-lg" style={{ color: "var(--text-muted)" }}>Loading projects...</div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1
              className="text-3xl font-bold mb-2"
              style={{ fontFamily: "var(--font-heading)", color: "var(--text-primary)", letterSpacing: "-1.5px" }}
            >
              <FolderOpen className="inline-block w-8 h-8 mr-2 mb-1" />
              Projects
            </h1>
            <p style={{ color: "var(--text-secondary)", fontSize: "14px" }}>
              {projects.length} projects · {projects.reduce((s, p) => s + p.taskCount, 0)} total tasks
            </p>
          </div>

          {/* View toggle */}
          <div
            className="flex items-center rounded-lg overflow-hidden"
            style={{ border: "1px solid var(--border)", backgroundColor: "var(--card)" }}
          >
            <button
              onClick={() => setView("grid")}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-all"
              style={{
                backgroundColor: view === "grid" ? "var(--accent)" : "transparent",
                color: view === "grid" ? "#000" : "var(--text-secondary)",
                border: "none",
                cursor: "pointer",
              }}
            >
              <LayoutGrid size={14} /> Grid
            </button>
            <button
              onClick={() => setView("list")}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-all"
              style={{
                backgroundColor: view === "list" ? "var(--accent)" : "transparent",
                color: view === "list" ? "#000" : "var(--text-secondary)",
                border: "none",
                cursor: "pointer",
              }}
            >
              <List size={14} /> List
            </button>
          </div>
        </div>

        {/* Status filter */}
        <div className="flex gap-2 mt-4 flex-wrap">
          {[
            { key: "all", label: "All" },
            { key: "active", label: "Active" },
            { key: "inactive", label: "Inactive" },
            { key: "archived", label: "Archived" },
          ].map((f) => (
            <button
              key={f.key}
              onClick={() => setStatusFilter(f.key)}
              className="text-sm px-3 py-1 rounded-full font-medium transition-all"
              style={{
                backgroundColor: statusFilter === f.key ? "var(--accent)" : "var(--card)",
                color: statusFilter === f.key ? "var(--background)" : "var(--text-secondary)",
                border: `1px solid ${statusFilter === f.key ? "var(--accent)" : "var(--border)"}`,
                cursor: "pointer",
              }}
            >
              {f.label}
              {f.key !== "all" && (
                <span className="ml-1.5 opacity-70">
                  {projects.filter((p) => f.key === "all" || p.status === f.key).length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Project grid / list */}
      {view === "grid" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((p) => (
            <ProjectRow key={p.id} project={p} />
          ))}
        </div>
      )}

      {filtered.length === 0 && (
        <div className="text-center py-16" style={{ color: "var(--text-muted)" }}>
          No projects found for this filter.
        </div>
      )}
    </div>
  );
}
