"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AgentAvatar } from "@/components/AgentAvatar";
import { getAgentByAnyId } from "@/config/agents";

type Priority = "high" | "medium" | "low";
type PipelineStatus = "backlog" | "building" | "deployed" | "shipped";

type TaskStatus = "backlog" | "on-deck" | "in-progress" | "review" | "done";
type BuildState = "queued" | "spawning" | "running" | "completed" | "failed";

interface BuildEntry {
  id: string;
  taskId: string;
  taskTitle: string;
  project?: string;
  status: "queued" | "spawning" | "running" | "completed" | "failed";
  agentType?: string;
  routing?: {
    tier?: string;
    modelId?: string;
    modelName?: string;
    reason?: string;
    savingsPercent?: number;
  };
  queuedAt?: string | null;
  startedAt?: string | null;
  runningAt?: string | null;
  completedAt?: string | null;
  output?: string;
}

interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  priority?: "P0" | "P1" | "P2" | "P3";
  project?: string;
  assignee?: string;
  updated?: string;
  created?: string;
  buildState?: BuildState;
  buildTriggeredAt?: string;
  buildCompletedAt?: string;
  routedModel?: string;
}

interface ProjectApiItem {
  id: string;
  emoji: string;
  name: string;
  description?: string;
  color?: string;
  owner?: string;
  repo?: string;
  status?: string;
  type?: string;
  created?: string;
  taskCount?: number;
  inProgress?: number;
  completed?: number;
  backlog?: number;
  review?: number;
  lastActivity?: string | null;
}

interface Product {
  id: string;
  emoji: string;
  name: string;
  description: string;
  status: PipelineStatus;
  priority: Priority;
  tags: string[];
  agentId: string;
  color: string;
  github?: string;
  isLive?: boolean;
  blocked?: string;
  timeInStage: string;
  activeTaskCount: number;
  completedTaskCount: number;
  reviewTaskCount: number;
  backlogTaskCount: number;
  currentModel?: string;
}

interface AgentSprite {
  id: string;
  agentId: string;
  agentName: string;
  productName: string;
  taskTitle: string;
  status: "running" | "queued" | "spawning";
  model: string;
  animDelay: number;
  isStale: boolean;
  staleMins: number;
}

// A "Cliff" is an agent that spawns sub-agents and then goes idle — treating
// "agents spawned" as "work done." We flag any build that has been running for
// more than 20 minutes without completing as stale so Tim can see it immediately.
const CLIFF_THRESHOLD_MS = 20 * 60 * 1000; // 20 minutes

const PRIORITY_BADGES: Record<Priority, { icon: string; color: string }> = {
  high: { icon: "\u{1F534}", color: "#ef4444" },
  medium: { icon: "\u{1F7E1}", color: "#f59e0b" },
  low: { icon: "\u{1F7E2}", color: "#22c55e" },
};

const OWNER_MODEL_MAP: Record<string, string> = {
  pixel: "GPT 5.4",
  forge: "Opus 4.6",
  henry: "Opus 4.6",
  scout: "Gemini Pro",
  quill: "Sonnet 4.6",
  atlas: "Sonnet 4.6",
  cipher: "GPT 5.4",
  nimbus: "Sonnet 4.6",
  quant: "Opus 4.6",
};

const PROJECT_TAGS: Record<string, string[]> = {
  "mission-control": ["Next.js", "Tasks", "Factory"],
  "advisory-board": ["BoardRunner", "Review Loop", "Agents"],
  "crypto-trading": ["Python", "CCXT", "Autoresearch"],
  "weather-trading": ["Kalshi", "Polymarket", "Forecasts"],
  "stock-trading": ["Polygon", "Options", "Risk"],
  snapaudit: ["SaaS", "Website Audit", "AI"],
  "idea-intake": ["Pipeline", "Research", "Inbox"],
  infrastructure: ["Infra", "Reliability", "Deploy"],
  insight: ["Marketing", "Strategy", "Positioning"],
};

function formatRelative(iso?: string | null) {
  if (!iso) return "fresh";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.max(0, Math.floor(diffMs / 60000));
  if (mins < 60) return `${mins || 1}m active`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h active`;
  const days = Math.floor(hours / 24);
  return `${days}d active`;
}

function formatDuration(startIso?: string | null, endIso?: string | null): string {
  if (!startIso || !endIso) return "\u2014";
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  return `${mins}m ${remSecs}s`;
}

function formatTime(iso?: string | null): string {
  if (!iso) return "\u2014";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function isToday(iso?: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

function mapPriority(tasks: Task[]): Priority {
  if (tasks.some((task) => task.priority === "P0" || task.priority === "P1")) return "high";
  if (tasks.some((task) => task.priority === "P2")) return "medium";
  return "low";
}

function computePipelineStatus(project: ProjectApiItem, projectTasks: Task[]): PipelineStatus {
  const activeBuild = projectTasks.some((task) => ["queued", "spawning", "running"].includes(task.buildState || ""));
  const activeFlow = projectTasks.some((task) => ["in-progress", "review", "on-deck"].includes(task.status));
  const hasCompleted = projectTasks.some((task) => task.status === "done");
  const onlyBacklog = projectTasks.length === 0 || projectTasks.every((task) => task.status === "backlog");

  if (activeBuild || activeFlow) return "building";
  if ((project.status === "inactive" || project.status === "archived") && hasCompleted) return "shipped";
  if (hasCompleted) return "deployed";
  if (onlyBacklog) return "backlog";
  return "deployed";
}

function mapProducts(projects: ProjectApiItem[], tasks: Task[]): Product[] {
  return projects.map((project) => {
    const projectTasks = tasks.filter((task) => task.project === project.id);
    const activeTasks = projectTasks.filter((task) => ["on-deck", "in-progress", "review"].includes(task.status));
    const lastTouched = [...projectTasks]
      .sort((a, b) => new Date(b.updated || b.created || 0).getTime() - new Date(a.updated || a.created || 0).getTime())[0];
    const latestModelTask = [...projectTasks]
      .filter((task) => task.routedModel)
      .sort((a, b) => new Date(b.buildTriggeredAt || b.updated || 0).getTime() - new Date(a.buildTriggeredAt || a.updated || 0).getTime())[0];

    return {
      id: project.id,
      emoji: project.emoji || "\u{1F4E6}",
      name: project.name,
      description: project.description || "Project in motion",
      status: computePipelineStatus(project, projectTasks),
      priority: mapPriority(activeTasks.length ? activeTasks : projectTasks),
      tags: PROJECT_TAGS[project.id] || [project.type || "project"],
      agentId: project.owner || "henry",
      color: project.color || "#6366f1",
      github: project.repo ? `https://github.com/${project.repo}` : undefined,
      isLive: Boolean(project.repo && ["mission-control", "snapaudit"].includes(project.id)),
      blocked: projectTasks.some((task) => task.buildState === "failed") ? "Recent failed build needs attention" : undefined,
      timeInStage: formatRelative(lastTouched?.updated || lastTouched?.created || project.lastActivity || project.created),
      activeTaskCount: activeTasks.length,
      completedTaskCount: projectTasks.filter((task) => task.status === "done").length,
      reviewTaskCount: projectTasks.filter((task) => task.status === "review").length,
      backlogTaskCount: projectTasks.filter((task) => task.status === "backlog").length,
      currentModel: latestModelTask?.routedModel || OWNER_MODEL_MAP[project.owner || ""] || "Sonnet 4.6",
    };
  });
}

function getActiveAgentSprites(builds: BuildEntry[]): AgentSprite[] {
  const active = builds
    .filter((b) => b.status === "running" || b.status === "spawning" || b.status === "queued")
    .slice(0, 8);

  const now = Date.now();
  return active.map((build, index) => {
    const runningMs = build.runningAt ? now - new Date(build.runningAt).getTime() : 0;
    const isStale = build.status === "running" && runningMs > CLIFF_THRESHOLD_MS;
    const staleMins = Math.floor(runningMs / 60000);
    return {
      id: build.id,
      agentId: build.agentType === "reviewer" ? "quill" : "forge",
      agentName: build.routing?.modelName || "Agent",
      productName: build.project || "Unscoped",
      taskTitle: build.taskTitle,
      status: build.status as "running" | "queued" | "spawning",
      model: build.routing?.modelName || "Unknown",
      animDelay: index * 0.35,
      isStale,
      staleMins,
    };
  });
}

/* ── Conveyor Belt: real completed builds ── */

function ConveyorBelt({ builds }: { builds: BuildEntry[] }) {
  const finished = builds
    .filter((b) => b.status === "completed" || b.status === "failed")
    .slice(0, 10);

  if (finished.length === 0) {
    return (
      <div className="relative w-full my-4 overflow-hidden" style={{ height: 36 }}>
        <div className="absolute inset-x-0 rounded-full" style={{ top: 14, height: 8, background: "linear-gradient(90deg, #1e1b4b 0%, #312e81 25%, #4338ca 50%, #312e81 75%, #1e1b4b 100%)", boxShadow: "0 0 12px rgba(99,102,241,0.15)" }} />
        <div className="absolute inset-x-0 rounded-full" style={{ top: 14, height: 8, backgroundImage: "repeating-linear-gradient(90deg, transparent 0px, transparent 12px, rgba(99,102,241,0.25) 12px, rgba(99,102,241,0.25) 24px)", backgroundSize: "24px 8px", animation: "conveyor-dash 0.8s linear infinite" }} />
        <div style={{ position: "absolute", top: 8, left: "50%", transform: "translateX(-50%)", fontSize: 11, color: "rgba(199,210,254,0.4)", fontFamily: "var(--font-mono)", whiteSpace: "nowrap" }}>No completed builds yet</div>
      </div>
    );
  }

  return (
    <div className="mx-6 my-4 rounded-xl overflow-hidden" style={{ background: "linear-gradient(180deg, rgba(30,27,75,0.4) 0%, rgba(15,23,42,0.5) 100%)", border: "1px solid rgba(99,102,241,0.12)", padding: "10px 16px 12px" }}>
      <div className="flex items-center gap-2 mb-2" style={{ fontSize: 10, color: "rgba(199,210,254,0.45)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
        <span style={{ fontSize: 12 }}>{"\u{1F4E6}"}</span>
        Conveyor Belt — Recent Builds
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {finished.map((build) => {
          const ok = build.status === "completed";
          return (
            <div key={build.id} className="flex-shrink-0 rounded-lg" style={{ padding: "8px 12px", minWidth: 180, backgroundColor: ok ? "rgba(34,197,94,0.06)" : "rgba(239,68,68,0.06)", border: `1px solid ${ok ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}` }}>
              <div className="flex items-center gap-1.5 mb-1">
                <span style={{ fontSize: 13 }}>{ok ? "\u2705" : "\u274C"}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#e2e8f0", fontFamily: "var(--font-heading, var(--font-body))", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140 }}>{build.taskTitle}</span>
              </div>
              <div style={{ fontSize: 9, color: "rgba(148,163,184,0.7)", fontFamily: "var(--font-mono)", display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span>{formatTime(build.completedAt)}</span>
                <span>{build.routing?.modelName || "\u2014"}</span>
                <span>{formatDuration(build.startedAt, build.completedAt)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Agent Sprite: real build status ── */

function AgentSpriteComponent({ sprite }: { sprite: AgentSprite }) {
  const statusConfig = {
    running: { color: "#22c55e", label: "building...", pulse: true },
    queued: { color: "#f59e0b", label: "queued...", pulse: false },
    spawning: { color: "#3b82f6", label: "spawning...", pulse: true },
  };
  const cfg = sprite.isStale
    ? { color: "#f97316", label: `stale ${sprite.staleMins}m`, pulse: true }
    : statusConfig[sprite.status];

  return (
    <div className="group relative flex flex-col items-center" style={{ minWidth: 84 }}>
      <div className="mb-1.5" style={{ fontSize: 10, color: cfg.color, fontFamily: "var(--font-mono)", letterSpacing: "0.03em", whiteSpace: "nowrap" }}>
        {cfg.label}
      </div>
      <div className="relative" style={{ animation: "agent-bob 3s ease-in-out infinite", animationDelay: `${sprite.animDelay}s` }}>
        <div className="absolute rounded-full" style={{ inset: -4, border: `2px solid ${cfg.color}66`, boxShadow: `0 0 10px ${cfg.color}44, inset 0 0 6px ${cfg.color}22`, animation: cfg.pulse ? "glow-pulse 2.5s ease-in-out infinite" : "none", animationDelay: `${sprite.animDelay * 0.7}s`, borderRadius: "50%" }} />
        <AgentAvatar agentId={sprite.agentId} size={38} borderWidth={2} />
      </div>
      <div className="mt-1.5" style={{ fontSize: 11, fontWeight: 700, color: "#e2e8f0", fontFamily: "var(--font-heading, var(--font-body))", textAlign: "center", whiteSpace: "nowrap" }}>{sprite.agentName}</div>
      <div style={{ fontSize: 9, color: "rgba(148,163,184,0.7)", fontFamily: "var(--font-mono)", textAlign: "center", marginTop: 1, maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sprite.productName}</div>
      <div style={{ fontSize: 8, fontWeight: 600, color: "rgba(167,139,250,0.9)", fontFamily: "var(--font-mono)", textAlign: "center", whiteSpace: "nowrap", marginTop: 3, padding: "1px 6px", borderRadius: 4, backgroundColor: "rgba(139,92,246,0.12)", border: "1px solid rgba(139,92,246,0.2)", letterSpacing: "0.5px", maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis" }}>{sprite.model}</div>
      {sprite.isStale && (
        <div style={{ marginTop: 4, fontSize: 8, fontWeight: 700, color: "#f97316", fontFamily: "var(--font-mono)", padding: "1px 6px", borderRadius: 4, backgroundColor: "rgba(249,115,22,0.12)", border: "1px solid rgba(249,115,22,0.35)", letterSpacing: "0.5px", whiteSpace: "nowrap" }}>
          ⚠ CLIFF
        </div>
      )}
      <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-50" style={{ padding: "6px 10px", backgroundColor: "rgba(15,23,42,0.95)", border: "1px solid rgba(99,102,241,0.3)", borderRadius: 8, fontSize: 11, color: "#e2e8f0", fontFamily: "var(--font-mono)", whiteSpace: "nowrap", boxShadow: "0 4px 12px rgba(0,0,0,0.4)" }}>
        {sprite.isStale ? `⚠ Stale ${sprite.staleMins}m — ${sprite.agentName} may have gone idle` : `${sprite.agentName} — ${sprite.taskTitle}`}
      </div>
    </div>
  );
}

function WorkshopFloor({ sprites }: { sprites: AgentSprite[] }) {
  const staleSprites = sprites.filter((s) => s.isStale);

  return (
    <div className="mx-6 mb-4 rounded-xl overflow-hidden" style={{ background: "linear-gradient(180deg, rgba(30,27,75,0.5) 0%, rgba(15,23,42,0.6) 100%)", border: "1px solid rgba(99,102,241,0.15)", padding: "14px 20px 16px" }}>
      <div className="flex items-center gap-2 mb-3" style={{ fontSize: 11, color: "rgba(199,210,254,0.5)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
        <span style={{ fontSize: 13 }}>{"\u{1F916}"}</span>
        Workshop Floor — Active Agents
      </div>
      {staleSprites.length > 0 && (
        <div className="mb-3 rounded-lg flex items-start gap-2" style={{ padding: "8px 12px", backgroundColor: "rgba(249,115,22,0.1)", border: "1px solid rgba(249,115,22,0.35)", color: "#fed7aa", fontSize: 11, fontFamily: "var(--font-mono)", lineHeight: 1.5 }}>
          <span style={{ fontSize: 14, flexShrink: 0 }}>⚠</span>
          <span>
            <strong style={{ color: "#f97316" }}>Cliff Alert:</strong>{" "}
            {staleSprites.length === 1
              ? `1 build has been running for ${staleSprites[0].staleMins}m without completing.`
              : `${staleSprites.length} builds have been running for 20+ minutes without completing.`}{" "}
            Agent may have spawned sub-agents and gone idle. Check on it.
          </span>
        </div>
      )}
      <div className="flex items-start gap-6 overflow-x-auto pb-1">
        {sprites.length > 0 ? sprites.map((sprite) => <AgentSpriteComponent key={sprite.id} sprite={sprite} />) : (
          <div style={{ fontSize: 12, color: "rgba(199,210,254,0.65)", fontFamily: "var(--font-mono)" }}>No active builds right now — queue something up and the floor will light back up.</div>
        )}
      </div>
    </div>
  );
}

function ProductCard({ product }: { product: Product }) {
  const badge = PRIORITY_BADGES[product.priority];

  return (
    <div className="group rounded-xl transition-all duration-200 hover:-translate-y-0.5" style={{ backgroundColor: "var(--surface-elevated, #1a1a2e)", border: "1px solid var(--border, #2a2a2a)", borderLeft: `4px solid ${product.color}`, boxShadow: "0 2px 8px rgba(0,0,0,0.2)", padding: "16px 16px 14px", overflow: "hidden" }}>
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xl flex-shrink-0">{product.emoji}</span>
          <span className="font-bold truncate" style={{ fontSize: 15, color: "var(--text-primary)", fontFamily: "var(--font-heading, var(--font-body))" }}>{product.name}</span>
        </div>
        <span className="flex-shrink-0 text-xs rounded-full px-1.5 py-0.5" style={{ backgroundColor: `${badge.color}18`, border: `1px solid ${badge.color}44` }} title={`${product.priority} priority`}>
          {badge.icon}
        </span>
      </div>

      <p className="mb-2.5" style={{ fontSize: 12, color: "var(--text-secondary)", margin: "0 0 10px", lineHeight: 1.4 }}>{product.description}</p>

      <div className="flex flex-wrap gap-1 mb-3">
        {product.tags.map((tag) => (
          <span key={tag} className="rounded-full" style={{ fontSize: 10, padding: "2px 8px", backgroundColor: "var(--surface, #1a1a1a)", border: "1px solid var(--border, #2a2a2a)", color: "var(--text-muted)", fontFamily: "var(--font-mono)", lineHeight: 1.5 }}>{tag}</span>
        ))}
      </div>

      {product.blocked && (
        <div className="flex items-center gap-1.5 rounded-md mb-4 text-xs" style={{ padding: "4px 8px", backgroundColor: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", color: "#ef4444", fontSize: 11, fontFamily: "var(--font-mono)" }}>
          {"\u{1F6AB}"} {product.blocked}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, marginBottom: 12 }}>
        <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>active tasks: <span style={{ color: "var(--text-primary)" }}>{product.activeTaskCount}</span></div>
        <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>review: <span style={{ color: "#93c5fd" }}>{product.reviewTaskCount}</span></div>
        <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>done: <span style={{ color: "#4ade80" }}>{product.completedTaskCount}</span></div>
        <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>backlog: <span style={{ color: "#c4b5fd" }}>{product.backlogTaskCount}</span></div>
      </div>

      <div className="flex items-center gap-2 mt-auto">
        <div className="flex items-center gap-1.5">
          {product.github && <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>repo</span>}
          {product.isLive && <span className="rounded-full inline-block" style={{ width: 8, height: 8, backgroundColor: "#10b981", boxShadow: "0 0 6px #10b98188", animation: "pulse-glow 2s ease-in-out infinite" }} title="Live" />}
        </div>
        <span style={{ fontSize: 10, color: "rgba(167,139,250,0.9)", fontFamily: "var(--font-mono)", padding: "2px 6px", borderRadius: 4, backgroundColor: "rgba(139,92,246,0.12)", border: "1px solid rgba(139,92,246,0.2)" }}>{product.currentModel}</span>
        <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginLeft: "auto" }}>{product.timeInStage}</span>
        <AgentAvatar agentId={product.agentId} size={24} borderWidth={1.5} />
      </div>
    </div>
  );
}

function KanbanColumn({ column, products }: { column: { id: PipelineStatus; label: string; emoji: string; accent: string }; products: Product[] }) {
  return (
    <div className="flex flex-col min-w-[240px] flex-1">
      <div className="flex items-center gap-2 mb-3 px-1" style={{ borderBottom: `2px solid ${column.accent}44`, paddingBottom: 8 }}>
        <span className="text-base">{column.emoji}</span>
        <span className="font-bold uppercase tracking-wide" style={{ fontSize: 12, color: column.accent, fontFamily: "var(--font-mono)" }}>{column.label}</span>
        <span className="rounded-full text-xs font-bold" style={{ padding: "1px 8px", backgroundColor: `${column.accent}18`, color: column.accent, fontFamily: "var(--font-mono)", fontSize: 11, marginLeft: "auto" }}>{products.length}</span>
      </div>
      <div className="flex flex-col gap-2.5">
        {products.length === 0 ? (
          <div className="text-center py-8 rounded-lg" style={{ fontSize: 12, color: "var(--text-muted)", fontFamily: "var(--font-mono)", border: "1px dashed var(--border)", opacity: 0.5 }}>No projects</div>
        ) : products.map((product) => <ProductCard key={product.id} product={product} />)}
      </div>
    </div>
  );
}

const COLUMNS: { id: PipelineStatus; label: string; emoji: string; accent: string }[] = [
  { id: "backlog", label: "Backlog", emoji: "\u{1F4CB}", accent: "#6366f1" },
  { id: "building", label: "Building", emoji: "\u{1F528}", accent: "#f59e0b" },
  { id: "deployed", label: "Deployed", emoji: "\u{1F680}", accent: "#06b6d4" },
  { id: "shipped", label: "Shipped", emoji: "\u{1F7E2}", accent: "#10b981" },
];

export default function SoftwareFactoryPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<ProjectApiItem[]>([]);
  const [builds, setBuilds] = useState<BuildEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch tasks + projects (slower refresh)
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [tasksRes, projectsRes] = await Promise.all([fetch("/api/tasks"), fetch("/api/projects")]);
        const tasksData = await tasksRes.json();
        const projectsData = await projectsRes.json();
        if (!cancelled) {
          setTasks(Array.isArray(tasksData.tasks) ? tasksData.tasks : []);
          setProjects(Array.isArray(projectsData.projects) ? projectsData.projects : []);
        }
      } catch (error) {
        console.error("Failed to load factory data", error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    const interval = window.setInterval(load, 30000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, []);

  // Poll build log every 5 seconds
  const loadBuilds = useCallback(async () => {
    try {
      const res = await fetch("/api/tasks/build");
      const data = await res.json();
      setBuilds(Array.isArray(data.builds) ? data.builds : []);
    } catch (error) {
      console.error("Failed to load build log", error);
    }
  }, []);

  useEffect(() => {
    loadBuilds();
    const interval = window.setInterval(loadBuilds, 5000);
    return () => window.clearInterval(interval);
  }, [loadBuilds]);

  const products = useMemo(() => mapProducts(projects, tasks), [projects, tasks]);
  const sprites = useMemo(() => getActiveAgentSprites(builds), [builds]);
  const statsByStatus = useMemo(() => {
    const buckets: Record<PipelineStatus, Product[]> = { backlog: [], building: [], deployed: [], shipped: [] };
    for (const product of products) buckets[product.status].push(product);
    return buckets;
  }, [products]);

  // Live stats from build log
  const buildStats = useMemo(() => {
    const now = Date.now();
    const active = builds.filter((b) => b.status === "running").length;
    const queued = builds.filter((b) => b.status === "queued" || b.status === "spawning").length;
    const completedToday = builds.filter((b) => b.status === "completed" && isToday(b.completedAt)).length;
    const failedToday = builds.filter((b) => b.status === "failed" && isToday(b.completedAt || b.startedAt)).length;
    const stale = builds.filter((b) => b.status === "running" && b.runningAt && now - new Date(b.runningAt).getTime() > CLIFF_THRESHOLD_MS).length;
    return { active, queued, completedToday, failedToday, stale };
  }, [builds]);

  const STATS = [
    { label: "Active Builds", value: buildStats.active, icon: "\u2699\uFE0F", color: "#22c55e" },
    { label: "Queued", value: buildStats.queued, icon: "\u{1F7E1}", color: "#f59e0b" },
    { label: "Completed Today", value: buildStats.completedToday, icon: "\u2705", color: "#06b6d4" },
    { label: "Failed Today", value: buildStats.failedToday, icon: "\u274C", color: "#ef4444" },
    { label: "Stale / Cliff", value: buildStats.stale, icon: "\u26A0\uFE0F", color: buildStats.stale > 0 ? "#f97316" : "#64748b" },
  ];

  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--background)" }}>
      <style>{`
        @keyframes conveyor-dash { 0% { background-position: 0 0; } 100% { background-position: 24px 0; } }
        @keyframes pulse-glow { 0%, 100% { opacity: 1; box-shadow: 0 0 6px #10b98188; } 50% { opacity: 0.6; box-shadow: 0 0 12px #10b981aa; } }
        @keyframes agent-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-2.5px); } }
        @keyframes glow-pulse { 0%, 100% { opacity: 0.6; } 50% { opacity: 1; } }
      `}</style>

      <div className="px-6 pt-6 pb-4" style={{ background: "linear-gradient(135deg, #1e1b4b 0%, #312e81 30%, #3730a3 60%, #1e1b4b 100%)", borderBottom: "1px solid rgba(99,102,241,0.2)" }}>
        <div className="mb-5">
          <h1 className="m-0 flex items-center gap-2" style={{ fontSize: 26, fontWeight: 800, color: "#fff", fontFamily: "var(--font-heading, var(--font-body))", letterSpacing: "-0.02em" }}>{"\u{1F3ED}"} Software Factory</h1>
          <p className="m-0 mt-1" style={{ fontSize: 13, color: "rgba(199,210,254,0.7)", fontFamily: "var(--font-mono)" }}>Live build status from the factory floor — polling every 5s</p>
          <Link
            href="/factory/pipeline"
            className="inline-flex items-center gap-1.5 mt-2 rounded-lg transition-colors hover:opacity-90"
            style={{
              padding: "6px 12px",
              fontSize: 11,
              fontWeight: 600,
              fontFamily: "var(--font-mono)",
              backgroundColor: "rgba(139,92,246,0.15)",
              border: "1px solid rgba(139,92,246,0.35)",
              color: "#a78bfa",
              textDecoration: "none",
            }}
          >
            {"\u{1F680}"} Software Factory Pipeline
          </Link>
          <div style={{ marginTop: 10, display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 9999, backgroundColor: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.22)", color: "#bbf7d0", fontSize: 11, fontFamily: "var(--font-mono)" }}>
            <span>{"\u{1F7E2}"}</span>
            {loading ? "Syncing factory state..." : `Factory synced \u2022 ${builds.length} builds \u2022 ${tasks.length} tasks \u2022 ${projects.length} projects`}
          </div>
        </div>

        <div className="flex gap-3 flex-wrap">
          {STATS.map((stat) => (
            <div key={stat.label} className="flex items-center gap-3 rounded-xl flex-1 min-w-[150px]" style={{ padding: "12px 16px", backgroundColor: "rgba(0,0,0,0.25)", border: "1px solid rgba(99,102,241,0.2)", backdropFilter: "blur(8px)" }}>
              <span className="text-xl">{stat.icon}</span>
              <div>
                <div className="font-extrabold" style={{ fontSize: 22, color: stat.color, fontFamily: "var(--font-mono)", lineHeight: 1 }}>{stat.value}</div>
                <div style={{ fontSize: 10, color: "rgba(199,210,254,0.5)", fontFamily: "var(--font-mono)", marginTop: 2, textTransform: "uppercase", letterSpacing: "0.05em" }}>{stat.label}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <ConveyorBelt builds={builds} />
      <WorkshopFloor sprites={sprites} />

      <div className="px-6 pb-8">
        <div className="grid gap-x-4 gap-y-0" style={{ gridTemplateColumns: "repeat(4, 1fr)", minWidth: 0 }}>
          {COLUMNS.map((col) => (
            <KanbanColumn key={col.id} column={col} products={statsByStatus[col.id]} />
          ))}
        </div>
      </div>
    </div>
  );
}
