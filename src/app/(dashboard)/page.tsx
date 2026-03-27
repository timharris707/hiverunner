"use client";

import { useEffect, useState } from "react";
import { StatsCard } from "@/components/StatsCard";
import { ActivityFeed } from "@/components/ActivityFeed";
import { WeatherWidget } from "@/components/WeatherWidget";
import { TaskDetailDrawer, Task, ProjectInfo, PRIORITY_COLORS, formatDate } from "@/components/TaskDetailDrawer";
import {
  CheckCircle,
  XCircle,
  Circle,
  Users,
  Zap,
  TrendingUp,
  Code2,
  DollarSign,
  Kanban,
  Brain,
  Server,
  Rocket,
  Clock,
  Star,
  Bot,
  Target,
  Terminal,
  Search,
  Plus,
  Play,
  MessageSquarePlus,
  ArrowRight,
  History,
} from "lucide-react";
import Link from "next/link";
import { AgentAvatar } from "@/components/AgentAvatar";

interface Stats {
  total: number;
  today: number;
  success: number;
  error: number;
  byType: Record<string, number>;
}

interface Agent {
  id: string;
  name: string;
  emoji: string;
  color: string;
  model: string;
  status: "online" | "offline";
  lastActivity?: string;
  botToken?: string;
}

// Our org roster with hardcoded data for now
const ORG_AGENTS = [
  {
    id: "henry",
    name: "Henry ⚡",
    role: "Chief of Staff",
    division: "Leadership",
    emoji: "⚡",
    color: "#f59e0b",
    divisionColor: "#f59e0b",
    description: "Orchestrates everything",
    status: "online" as const,
  },
  {
    id: "t1",
    name: "Atlas 📈",
    role: "Stocks & Options",
    division: "Trading",
    emoji: "📈",
    color: "#4ade80",
    divisionColor: "#4ade80",
    description: "Stock screening, options strategy",
    status: "pending" as const,
  },
  {
    id: "t2",
    name: "Nimbus 🌤️",
    role: "Weather Trading",
    division: "Trading",
    emoji: "🌤️",
    color: "#4ade80",
    divisionColor: "#4ade80",
    description: "Weather prediction markets",
    status: "pending" as const,
  },
  {
    id: "t3",
    name: "Cipher ₿",
    role: "Crypto Trading",
    division: "Trading",
    emoji: "₿",
    color: "#4ade80",
    divisionColor: "#4ade80",
    description: "Crypto strategies, CCXT pipeline",
    status: "building" as const,
  },
  {
    id: "quant",
    name: "Quant 📊",
    role: "Strategy Architect",
    division: "Trading",
    emoji: "📊",
    color: "#4ade80",
    divisionColor: "#4ade80",
    description: "Designs strategies, backtests, optimizes",
    status: "pending" as const,
  },
  {
    id: "backend",
    name: "Forge 🔧",
    role: "Infrastructure",
    division: "Engineering",
    emoji: "🔧",
    color: "#60a5fa",
    divisionColor: "#60a5fa",
    description: "APIs, DBs, reliability layer",
    status: "pending" as const,
  },
  {
    id: "fullstack",
    name: "Pixel 💻",
    role: "Web Apps",
    division: "Engineering",
    emoji: "💻",
    color: "#60a5fa",
    divisionColor: "#60a5fa",
    description: "Dashboards, UIs, shipping",
    status: "active" as const,
  },
  {
    id: "scout",
    name: "Scout",
    role: "Research & Intel",
    division: "Research",
    emoji: "🔭",
    color: "#a78bfa",
    divisionColor: "#a78bfa",
    description: "Market research, opportunities",
    status: "pending" as const,
  },
  {
    id: "quill",
    name: "Quill",
    role: "Creative Writer",
    division: "Creative",
    emoji: "✍️",
    color: "#f472b6",
    divisionColor: "#f472b6",
    description: "Marketing, content, copy",
    status: "pending" as const,
  },
  {
    id: "counsel",
    name: "Counsel",
    role: "Legal Expert",
    division: "Legal",
    emoji: "⚖️",
    color: "#94a3b8",
    divisionColor: "#94a3b8",
    description: "Contracts, compliance, IP",
    status: "pending" as const,
  },
];

const ACTIVE_PROJECTS = [
  {
    name: "Crypto Trading Bot",
    description: "Cipher's CCXT pipeline — foundation in progress",
    status: "in-progress",
    agent: "Cipher ₿",
    color: "#4ade80",
    icon: "₿",
    href: "/files?path=/Users/timharris/.openclaw/workspace/projects/crypto-trading",
  },
  {
    name: "Mission Control",
    description: "This dashboard — Harris Autonomous command center",
    status: "in-progress",
    agent: "Pixel 💻",
    color: "#60a5fa",
    icon: "🎛️",
    href: "/files?path=/Users/timharris/.openclaw/workspace/projects/mission-control-app",
  },
  {
    name: "Karpathy Loop",
    description: "Autoresearch loop for trading + strategy improvement",
    status: "design",
    agent: "Henry",
    color: "#f59e0b",
    icon: "🔬",
    href: "/files?path=/Users/timharris/.openclaw/workspace/projects/karpathy-loop",
  },
];

const TIM_GOALS = [
  { icon: "💰", text: "Profitable stock, options & crypto trading systems" },
  { icon: "🌩️", text: "Weather prediction trading (Polymarket + Kalshi)" },
  { icon: "📱", text: "Phone/web apps that generate income" },
  { icon: "🔬", text: "Karpathy Loop: apply autoresearch to everything" },
  { icon: "🤖", text: "Full agent team deployable 24/7/365" },
];

const STATUS_COLORS: Record<string, string> = {
  online: "#4ade80",
  active: "#4ade80",
  building: "#f59e0b",
  pending: "#6b7280",
  offline: "#6b7280",
};

const STATUS_LABELS: Record<string, string> = {
  online: "Online",
  active: "Active",
  building: "In Progress",
  pending: "Not Deployed",
  offline: "Offline",
};

interface AdvisorySession {
  id: string;
  topic: string;
  mode: string;
  agents: string[];
  status: string;
  createdAt: string;
  completedAt?: string;
  model?: string;
}

interface HighlightData {
  todayTasks: string[];
  nextCron: { name: string; nextAt: string; in: string } | null;
  providers: { name: string; icon: string; primary: boolean; active?: boolean }[];
}

interface DashboardStats {
  activeSessions: number;
  totalSessions: number;
  tasksToday: number;
  costToday: number;
  activeAgents: number;
}

function StatSkeleton() {
  return (
    <div
      className="rounded-xl p-4 md:p-6"
      style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
    >
      <div className="skeleton skeleton-text w-24 mb-3" style={{ height: "12px" }} />
      <div className="skeleton skeleton-text w-16" style={{ height: "28px" }} />
    </div>
  );
}

interface LiveAgentStatus {
  id: string;
  status: "online" | "active" | "building" | "pending" | "offline";
  label?: string;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats>({ total: 0, today: 0, success: 0, error: 0, byType: {} });
  const [liveAgents, setLiveAgents] = useState<Agent[]>([]);
  const [highlights, setHighlights] = useState<HighlightData>({ todayTasks: [], nextCron: null, providers: [] });
  const [dashStats, setDashStats] = useState<DashboardStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [doneTasks, setDoneTasks] = useState<Task[]>([]);
  const [tasksProjectsMap, setTasksProjectsMap] = useState<Record<string, ProjectInfo>>({});
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [recentSessions, setRecentSessions] = useState<AdvisorySession[]>([]);
  const [agentStatuses, setAgentStatuses] = useState<Record<string, LiveAgentStatus>>({});

  const fetchDashboardData = () => {
    Promise.all([
      fetch("/api/activities/stats").then(r => r.json()),
      fetch("/api/agents").then(r => r.json()),
      fetch("/api/dashboard/highlights").then(r => r.json()),
      fetch("/api/dashboard/stats").then(r => r.json()).catch(() => null),
      fetch("/api/advisory/sessions").then(r => r.json()).catch(() => ({ sessions: [] })),
      fetch("/api/agents/status").then(r => r.json()).catch(() => ({ agents: [] })),
    ]).then(([actStats, agentsData, highlightData, ds, advisoryData, statusData]) => {
      setStats({
        total: actStats.total || 0,
        today: actStats.today || 0,
        success: actStats.byStatus?.success || 0,
        error: actStats.byStatus?.error || 0,
        byType: actStats.byType || {},
      });
      setLiveAgents(agentsData.agents || []);
      setHighlights(highlightData || { todayTasks: [], nextCron: null, providers: [] });
      if (ds) setDashStats(ds);
      setRecentSessions((advisoryData.sessions || []).slice(0, 3));
      // Build status map from live data
      const statusMap: Record<string, LiveAgentStatus> = {};
      for (const agent of (statusData.agents || [])) {
        statusMap[agent.id] = agent;
      }
      setAgentStatuses(statusMap);
      setStatsLoading(false);
    }).catch(() => setStatsLoading(false));
  };

  const fetchTasksData = () => {
    Promise.all([
      fetch("/api/tasks").then(r => r.json()).catch(() => ({ tasks: [] })),
      fetch("/api/projects").then(r => r.json()).catch(() => ({ projects: [] })),
    ]).then(([tasksData, projectsData]) => {
      const allTasks: Task[] = tasksData.tasks || [];
      setDoneTasks(allTasks.filter(t => t.status === "done").sort((a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime()));
      const map: Record<string, ProjectInfo> = {};
      for (const p of (projectsData.projects || [])) {
        map[p.id] = { id: p.id, name: p.name, emoji: p.emoji, color: p.color };
      }
      setTasksProjectsMap(map);
    });
  };

  useEffect(() => {
    fetchDashboardData();
    fetchTasksData();
    // Auto-refresh every 30 seconds
    const interval = setInterval(() => { fetchDashboardData(); fetchTasksData(); }, 30_000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Merge live statuses into org agents
  const mergedAgents = ORG_AGENTS.map(agent => ({
    ...agent,
    status: (agentStatuses[agent.id]?.status ?? agent.status) as typeof agent.status,
  }));

  const activeAgentCount = mergedAgents.filter(a => a.status === "online" || a.status === "active" || a.status === "building").length;

  return (
    <div className="p-4 md:p-8">
      {/* Header */}
      <div className="mb-6">
        <h1
          className="text-2xl md:text-3xl font-bold mb-1"
          style={{
            fontFamily: "var(--font-heading)",
            color: "var(--text-primary)",
            letterSpacing: "-1.5px",
          }}
        >
          ⚡ Harris Mission Control
        </h1>
        <p style={{ color: "var(--text-secondary)", fontSize: "14px" }}>
          Harris Autonomous — 10 agents · 5 divisions · always building
        </p>
      </div>

      {/* Stats Grid + Weather */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mb-6">
        <div className="lg:col-span-3 grid grid-cols-2 md:grid-cols-4 gap-3">
          {statsLoading ? (
            <>
              <StatSkeleton />
              <StatSkeleton />
              <StatSkeleton />
              <StatSkeleton />
            </>
          ) : (
            <>
              <StatsCard
                title="Active Agents"
                value={activeAgentCount.toString()}
                subtitle="Deployed & running"
                icon={<Users className="w-5 h-5" />}
                iconColor="var(--accent)"
              />
              <StatsCard
                title="Tasks Today"
                value={(dashStats?.tasksToday ?? stats.today).toLocaleString()}
                subtitle="From tasks-log.md"
                icon={<Zap className="w-5 h-5" />}
                iconColor="#f59e0b"
              />
              <StatsCard
                title="Active Sessions"
                value={(dashStats?.activeSessions ?? stats.success).toLocaleString()}
                subtitle="Last 2 hours"
                icon={<CheckCircle className="w-5 h-5" />}
                iconColor="var(--success)"
              />
              <StatsCard
                title="Cost Today"
                value={dashStats ? `$${dashStats.costToday.toFixed(2)}` : "—"}
                subtitle="Token usage"
                icon={<DollarSign className="w-5 h-5" />}
                iconColor="var(--error)"
              />
            </>
          )}
        </div>
        <div className="lg:col-span-1">
          <WeatherWidget />
        </div>
      </div>

      {/* Quick Launch Advisory Board + Recent Sessions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6 mb-6">
        {/* Quick Launch Advisory Board */}
        <div
          className="rounded-xl overflow-hidden"
          style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
        >
          <div
            className="flex items-center justify-between px-5 py-4"
            style={{ borderBottom: "1px solid var(--border)" }}
          >
            <div className="flex items-center gap-3">
              <div className="accent-line" />
              <h2
                className="text-base font-semibold"
                style={{ fontFamily: "var(--font-heading)", color: "var(--text-primary)" }}
              >
                <Users className="inline-block w-4 h-4 mr-2 mb-0.5" />
                Advisory Board
              </h2>
            </div>
            <Link href="/advisory" className="text-sm font-medium" style={{ color: "var(--accent)" }}>
              Open →
            </Link>
          </div>
          <div className="p-4">
            <div className="space-y-2 mb-4">
              {[
                { id: "trading-strategy", label: "Trading Strategy Review", icon: "📈", desc: "Quant rigor deep-dive", agents: ["Henry", "Atlas", "Quant", "Cipher"] },
                { id: "risk-legal", label: "Risk & Legal Assessment", icon: "⚖️", desc: "Compliance & regulatory risk", agents: ["Henry", "Counsel", "Forge", "Scout"] },
                { id: "product-launch", label: "Product Launch Planning", icon: "🚀", desc: "Cross-functional launch plan", agents: ["Henry", "Pixel", "Scout", "Quill"] },
              ].map((tmpl) => (
                <Link
                  key={tmpl.id}
                  href={`/advisory?template=${tmpl.id}`}
                  className="flex items-center gap-3 p-3 rounded-lg transition-all hover:scale-[1.01]"
                  style={{ backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)" }}
                >
                  <span className="text-xl flex-shrink-0">{tmpl.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                      {tmpl.label}
                    </div>
                    <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {tmpl.desc} · {tmpl.agents.length} agents
                    </div>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "var(--text-muted)" }} />
                </Link>
              ))}
            </div>
            <Link
              href="/advisory"
              className="flex items-center justify-center gap-2 w-full p-3 rounded-lg font-semibold text-sm transition-all hover:opacity-90"
              style={{ backgroundColor: "var(--accent)", color: "#fff" }}
            >
              <MessageSquarePlus className="w-4 h-4" />
              New Advisory Session
            </Link>
          </div>
        </div>

        {/* Recent Advisory Sessions */}
        <div
          className="rounded-xl overflow-hidden"
          style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
        >
          <div
            className="flex items-center justify-between px-5 py-4"
            style={{ borderBottom: "1px solid var(--border)" }}
          >
            <div className="flex items-center gap-3">
              <div className="accent-line" />
              <h2
                className="text-base font-semibold"
                style={{ fontFamily: "var(--font-heading)", color: "var(--text-primary)" }}
              >
                <History className="inline-block w-4 h-4 mr-2 mb-0.5" />
                Recent Advisory Sessions
              </h2>
            </div>
            <Link href="/advisory" className="text-sm font-medium" style={{ color: "var(--accent)" }}>
              View all →
            </Link>
          </div>
          <div className="p-4">
            {recentSessions.length > 0 ? (
              <div className="space-y-2">
                {recentSessions.map((session) => {
                  const topic = session.topic || "Untitled Session";
                  const topicPreview = topic.length > 80
                    ? topic.slice(0, 80) + "..."
                    : topic;
                  const isActive = session.status === "active";
                  const statusColor = isActive ? "#4ade80" : session.status === "completed" ? "#60a5fa" : "#6b7280";
                  const statusLabel = isActive ? "Active" : session.status === "completed" ? "Completed" : session.status;
                  const timeAgo = (() => {
                    const diff = Date.now() - new Date(session.createdAt).getTime();
                    const mins = Math.floor(diff / 60000);
                    if (mins < 60) return `${mins}m ago`;
                    const hrs = Math.floor(mins / 60);
                    if (hrs < 24) return `${hrs}h ago`;
                    const days = Math.floor(hrs / 24);
                    return `${days}d ago`;
                  })();

                  return (
                    <Link
                      key={session.id}
                      href={`/advisory?session=${session.id}`}
                      className="flex items-center gap-3 p-3 rounded-lg transition-all hover:scale-[1.01]"
                      style={{ backgroundColor: "var(--card-elevated)", border: `1px solid ${isActive ? statusColor + "40" : "var(--border)"}` }}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>
                          {topicPreview}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <span
                            className="text-xs font-medium px-1.5 py-0.5 rounded flex items-center gap-1"
                            style={{ backgroundColor: `${statusColor}20`, color: statusColor }}
                          >
                            <Circle className="w-1.5 h-1.5" style={{ fill: statusColor, color: statusColor }} />
                            {statusLabel}
                          </span>
                          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                            {session.mode || "session"} · {(session.agents || []).length} agents · {timeAgo}
                          </span>
                        </div>
                      </div>
                      {isActive && (
                        <span className="text-xs font-semibold px-2 py-1 rounded" style={{ backgroundColor: "#4ade8015", color: "#4ade80" }}>
                          Resume
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-6">
                <Users className="w-8 h-8 mx-auto mb-2" style={{ color: "var(--text-muted)", opacity: 0.5 }} />
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>No advisory sessions yet</p>
                <Link
                  href="/advisory"
                  className="text-xs mt-2 inline-block font-medium"
                  style={{ color: "var(--accent)" }}
                >
                  Start your first session →
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Org Chart */}
      <div
        className="mb-6 rounded-xl overflow-hidden"
        style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
      >
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <div className="flex items-center gap-3">
            <div className="accent-line" />
            <h2
              className="text-base font-semibold"
              style={{ fontFamily: "var(--font-heading)", color: "var(--text-primary)" }}
            >
              <Users className="inline-block w-5 h-5 mr-2 mb-1" />
              Agent Roster — Harris Autonomous
            </h2>
          </div>
          <Link
            href="/agents"
            className="text-sm font-medium"
            style={{ color: "var(--accent)" }}
          >
            View details →
          </Link>
        </div>

        {/* Henry at top */}
        <div className="px-5 pt-4 pb-2">
          <div className="flex items-center gap-4 mb-4">
            <AgentAvatar agentId="henry" size={52} borderColor="#f59e0b" borderWidth={2} />
            <div>
              <div
                className="font-bold text-base"
                style={{ fontFamily: "var(--font-heading)", color: "var(--text-primary)" }}
              >
                Henry ⚡ — Chief of Staff
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <Circle
                  className="w-2 h-2"
                  style={{
                    fill: STATUS_COLORS[agentStatuses["henry"]?.status ?? "online"],
                    color: STATUS_COLORS[agentStatuses["henry"]?.status ?? "online"],
                  }}
                />
                <span className="text-xs" style={{ color: STATUS_COLORS[agentStatuses["henry"]?.status ?? "online"] }}>
                  {STATUS_LABELS[agentStatuses["henry"]?.status ?? "online"]} · Orchestrating
                </span>
                <span className="text-xs ml-2 px-2 py-0.5 rounded" style={{ backgroundColor: "#f59e0b20", color: "#f59e0b" }}>
                  Claude Opus
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Divisions */}
        <div className="px-5 pb-5">
          {[
            { name: "Trading Desk", color: "#4ade80", agents: mergedAgents.filter(a => a.division === "Trading") },
            { name: "Engineering", color: "#60a5fa", agents: mergedAgents.filter(a => a.division === "Engineering") },
            { name: "Research", color: "#a78bfa", agents: mergedAgents.filter(a => a.division === "Research") },
            { name: "Creative", color: "#f472b6", agents: mergedAgents.filter(a => a.division === "Creative") },
            { name: "Legal", color: "#94a3b8", agents: mergedAgents.filter(a => a.division === "Legal") },
          ].map((division) => (
            <div key={division.name} className="mb-4 last:mb-0">
              <div
                className="text-xs font-bold mb-2 uppercase tracking-wider"
                style={{ color: division.color }}
              >
                {division.name}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
                {division.agents.map((agent) => (
                  <div
                    key={agent.id}
                    className="p-3 rounded-lg"
                    style={{
                      backgroundColor: "var(--card-elevated)",
                      border: `1px solid ${agent.color}40`,
                    }}
                  >
                    <div className="flex items-start gap-3">
                      <AgentAvatar agentId={agent.id} size={36} borderColor={agent.color} borderWidth={2} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <div
                            className="text-sm font-bold truncate"
                            style={{ fontFamily: "var(--font-heading)", color: "var(--text-primary)" }}
                          >
                            {agent.name}
                          </div>
                          <Circle
                            className="w-2 h-2 flex-shrink-0"
                            style={{
                              fill: STATUS_COLORS[agent.status],
                              color: STATUS_COLORS[agent.status],
                            }}
                          />
                        </div>
                        <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                          {agent.role}
                        </div>
                        <div
                          className="text-xs mt-0.5 font-medium"
                          style={{ color: STATUS_COLORS[agent.status] }}
                        >
                          {STATUS_LABELS[agent.status]}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Active Projects + Trading Desk row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6 mb-6">
        {/* Active Projects */}
        <div
          className="lg:col-span-2 rounded-xl overflow-hidden"
          style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
        >
          <div
            className="flex items-center justify-between px-5 py-4"
            style={{ borderBottom: "1px solid var(--border)" }}
          >
            <div className="flex items-center gap-3">
              <div className="accent-line" />
              <h2
                className="text-base font-semibold"
                style={{ fontFamily: "var(--font-heading)", color: "var(--text-primary)" }}
              >
                <Rocket className="inline-block w-4 h-4 mr-2 mb-0.5" />
                Active Projects
              </h2>
            </div>
            <Link href="/tasks" className="text-sm font-medium" style={{ color: "var(--accent)" }}>
              Task Board →
            </Link>
          </div>
          <div className="p-4 space-y-3">
            {ACTIVE_PROJECTS.map((project) => (
              <Link
                key={project.name}
                href={project.href}
                className="flex items-center gap-4 p-4 rounded-lg transition-all hover:scale-[1.01]"
                style={{ backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)" }}
              >
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center text-xl flex-shrink-0"
                  style={{ backgroundColor: `${project.color}20`, border: `1px solid ${project.color}40` }}
                >
                  {project.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div
                    className="font-semibold text-sm"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {project.name}
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                    {project.description}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  <span
                    className="text-xs font-medium px-2 py-0.5 rounded"
                    style={{
                      backgroundColor: project.status === "in-progress" ? "#4ade8020" : "#f59e0b20",
                      color: project.status === "in-progress" ? "#4ade80" : "#f59e0b",
                    }}
                  >
                    {project.status === "in-progress" ? "In Progress" : "Design"}
                  </span>
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {project.agent}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* Trading Desk */}
        <div
          className="rounded-xl overflow-hidden"
          style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
        >
          <div
            className="flex items-center justify-between px-5 py-4"
            style={{ borderBottom: "1px solid var(--border)" }}
          >
            <div className="flex items-center gap-3">
              <div className="accent-line" />
              <h2
                className="text-base font-semibold"
                style={{ fontFamily: "var(--font-heading)", color: "var(--text-primary)" }}
              >
                <TrendingUp className="inline-block w-4 h-4 mr-2 mb-0.5" />
                Trading Desk
              </h2>
            </div>
            <Link href="/trading" className="text-sm font-medium" style={{ color: "var(--accent)" }}>
              Open →
            </Link>
          </div>
          <div className="p-4 space-y-3">
            {[
              { id: "quant", name: "Quant — Strategy Architect", divisionColor: "#4ade80" },
              { id: "t1", name: "Atlas — Stocks & Options", divisionColor: "#4ade80" },
              { id: "t2", name: "Nimbus — Weather Trading", divisionColor: "#4ade80" },
              { id: "t3", name: "Cipher — Crypto Bot", divisionColor: "#4ade80" },
            ].map((trader) => {
              const liveStatus = agentStatuses[trader.id]?.status ?? "pending";
              const statusColor = STATUS_COLORS[liveStatus];
              const isActive = liveStatus !== "pending" && liveStatus !== "offline";
              return (
                <div
                  key={trader.id}
                  className="flex items-center gap-3 p-3 rounded-lg"
                  style={{
                    backgroundColor: "var(--card-elevated)",
                    border: `1px solid ${isActive ? statusColor + "40" : "var(--border)"}`,
                  }}
                >
                  <AgentAvatar agentId={trader.id} size={30} borderColor={isActive ? statusColor : trader.divisionColor} borderWidth={2} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                      {trader.name}
                    </div>
                    <div className="text-xs mt-0.5 font-medium" style={{ color: statusColor }}>
                      {STATUS_LABELS[liveStatus]}
                    </div>
                  </div>
                  <Circle
                    className="w-2 h-2 flex-shrink-0"
                    style={{ fill: statusColor, color: statusColor }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Provider Stack + Today's Highlights row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6 mb-6">
        {/* Provider Stack */}
        <div
          className="rounded-xl overflow-hidden"
          style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
        >
          <div
            className="flex items-center justify-between px-5 py-4"
            style={{ borderBottom: "1px solid var(--border)" }}
          >
            <div className="flex items-center gap-3">
              <div className="accent-line" />
              <h2
                className="text-base font-semibold"
                style={{ fontFamily: "var(--font-heading)", color: "var(--text-primary)" }}
              >
                <Server className="inline-block w-4 h-4 mr-2 mb-0.5" />
                Provider Stack
              </h2>
            </div>
            <Link href="/settings" className="text-sm font-medium" style={{ color: "var(--accent)" }}>
              Configure →
            </Link>
          </div>
          <div className="p-4">
            <div className="grid grid-cols-2 gap-2">
              {(highlights.providers.length > 0 ? highlights.providers : [
                { name: "Anthropic", icon: "🤖", primary: true, active: true },
                { name: "OpenAI Codex", icon: "🔮", primary: false, active: true },
                { name: "Google Gemini", icon: "✨", primary: false, active: true },
                { name: "OpenRouter", icon: "🔄", primary: false, active: true },
              ]).map((p) => (
                <div
                  key={p.name}
                  className="flex items-center gap-3 p-3 rounded-lg"
                  style={{
                    backgroundColor: "var(--card-elevated)",
                    border: `1px solid ${p.active ? "rgba(74,222,128,0.2)" : "var(--border)"}`,
                  }}
                >
                  <span className="text-xl">{p.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                        {p.name}
                      </span>
                      {p.primary && (
                        <span className="text-xs px-1 py-0.5 rounded" style={{ backgroundColor: "var(--accent)20", color: "var(--accent)", fontSize: "9px" }}>
                          1°
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 mt-0.5">
                      <Circle className="w-1.5 h-1.5" style={{ fill: "#4ade80", color: "#4ade80" }} />
                      <span className="text-xs" style={{ color: "#4ade80" }}>Active</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Today's Highlights + Next Cron */}
        <div
          className="rounded-xl overflow-hidden"
          style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
        >
          <div
            className="flex items-center justify-between px-5 py-4"
            style={{ borderBottom: "1px solid var(--border)" }}
          >
            <div className="flex items-center gap-3">
              <div className="accent-line" />
              <h2
                className="text-base font-semibold"
                style={{ fontFamily: "var(--font-heading)", color: "var(--text-primary)" }}
              >
                <Star className="inline-block w-4 h-4 mr-2 mb-0.5" />
                Today&apos;s Highlights
              </h2>
            </div>
            <Link href="/tasks" className="text-sm font-medium" style={{ color: "var(--accent)" }}>
              All tasks →
            </Link>
          </div>
          <div className="p-4">
            {highlights.todayTasks.length > 0 ? (
              <div className="space-y-2 mb-4">
                {highlights.todayTasks.map((task, i) => {
                  const isCompleted = task.startsWith("- ✅");
                  const text = task.replace(/^- [✅🔄❌]\s*/, "").replace(/^TASK-\d+:\s*/, "").split("→")[0].trim();
                  return (
                    <div key={i} className="flex items-start gap-2.5 text-sm">
                      <span className="flex-shrink-0 mt-0.5">
                        {isCompleted ? (
                          <CheckCircle className="w-4 h-4" style={{ color: "#4ade80" }} />
                        ) : task.includes("🔄") ? (
                          <Circle className="w-4 h-4" style={{ color: "#f59e0b" }} />
                        ) : (
                          <XCircle className="w-4 h-4" style={{ color: "#f87171" }} />
                        )}
                      </span>
                      <span className={isCompleted ? "" : "opacity-60"} style={{ color: "var(--text-primary)" }}>
                        {text}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>
                No tasks recorded yet today
              </p>
            )}

            {/* Next cron */}
            {highlights.nextCron && (
              <div
                className="flex items-center gap-3 p-3 rounded-lg"
                style={{ backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)" }}
              >
                <Clock className="w-4 h-4 flex-shrink-0" style={{ color: "#f59e0b" }} />
                <div>
                  <div className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                    Next: {highlights.nextCron.name}
                  </div>
                  <div className="text-xs" style={{ color: "#f59e0b" }}>
                    {highlights.nextCron.in} · {new Date(highlights.nextCron.nextAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Quick Actions + Goals */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6 mb-6">
        {/* Quick Actions */}
        <div
          className="rounded-xl overflow-hidden"
          style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
        >
          <div
            className="flex items-center px-5 py-4"
            style={{ borderBottom: "1px solid var(--border)" }}
          >
            <div className="flex items-center gap-3">
              <div className="accent-line" />
              <h2
                className="text-base font-semibold"
                style={{ fontFamily: "var(--font-heading)", color: "var(--text-primary)" }}
              >
                <Play className="inline-block w-4 h-4 mr-2 mb-0.5" />
                Quick Actions
              </h2>
            </div>
          </div>
          <div className="p-4 grid grid-cols-3 gap-3">
            {[
              { href: "/tasks", icon: Plus, label: "New Task", color: "var(--accent)", desc: "⌘T" },
              { href: "/cron", icon: Play, label: "Run Cron Job", color: "#f59e0b", desc: "Trigger a job" },
              { href: "/search", icon: Search, label: "Search Files", color: "#60a5fa", desc: "⌘K" },
              { href: "/terminal", icon: Terminal, label: "Terminal", color: "#4ade80", desc: "Run commands" },
              { href: "/agents", icon: Bot, label: "Agents", color: "#a78bfa", desc: "View team" },
              { href: "/costs", icon: DollarSign, label: "Cost Report", color: "#f472b6", desc: "Spend today" },
            ].map(({ href, icon: Icon, label, color, desc }) => (
              <Link
                key={href}
                href={href}
                className="flex flex-col items-center p-3 rounded-xl transition-all hover:scale-[1.03] text-center"
                style={{ backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)" }}
              >
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center mb-2"
                  style={{ backgroundColor: `${color}20` }}
                >
                  <Icon className="w-5 h-5" style={{ color }} />
                </div>
                <span className="text-xs font-bold" style={{ color: "var(--text-primary)" }}>{label}</span>
                <span className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>{desc}</span>
              </Link>
            ))}
          </div>
        </div>

        {/* Tim's Goals */}
        <div
          className="rounded-xl overflow-hidden"
          style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
        >
          <div
            className="flex items-center justify-between px-5 py-4"
            style={{ borderBottom: "1px solid var(--border)" }}
          >
            <div className="flex items-center gap-3">
              <div className="accent-line" />
              <h2
                className="text-base font-semibold"
                style={{ fontFamily: "var(--font-heading)", color: "var(--text-primary)" }}
              >
                <Target className="inline-block w-4 h-4 mr-2 mb-0.5" />
                Mission Goals
              </h2>
            </div>
            <Link href="/about" className="text-sm font-medium" style={{ color: "var(--accent)" }}>
              About →
            </Link>
          </div>
          <div className="p-4 space-y-2">
            {TIM_GOALS.map((goal, i) => (
              <div
                key={i}
                className="flex items-center gap-3 p-3 rounded-lg"
                style={{ backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)" }}
              >
                <span className="text-xl flex-shrink-0">{goal.icon}</span>
                <span className="text-sm" style={{ color: "var(--text-secondary)" }}>{goal.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Completed Tasks */}
      <div
        className="rounded-xl overflow-hidden mb-6"
        style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
      >
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <div className="flex items-center gap-3">
            <div className="accent-line" />
            <h2
              className="text-base font-semibold"
              style={{ fontFamily: "var(--font-heading)", color: "var(--text-primary)" }}
            >
              <CheckCircle className="inline-block w-4 h-4 mr-2 mb-0.5" style={{ color: "#4ade80" }} />
              Completed Tasks
              {doneTasks.length > 0 && (
                <span className="ml-2 text-xs font-normal px-2 py-0.5 rounded-full" style={{ backgroundColor: "rgba(74,222,128,0.12)", color: "#4ade80" }}>
                  {doneTasks.length}
                </span>
              )}
            </h2>
          </div>
          <Link href="/tasks" className="text-sm font-medium" style={{ color: "var(--accent)" }}>
            Task Board →
          </Link>
        </div>
        <div style={{ maxHeight: "320px", overflowY: "auto" }}>
          {doneTasks.length === 0 ? (
            <p className="p-4 text-sm" style={{ color: "var(--text-muted)" }}>No completed tasks yet</p>
          ) : (
            <div>
              {doneTasks.map((task) => {
                const proj = tasksProjectsMap[task.project || ""];
                return (
                  <button
                    key={task.id}
                    onClick={() => setSelectedTask(task)}
                    className="w-full text-left flex items-center gap-3 px-4 py-3 transition-colors hover:bg-white/5"
                    style={{ background: "none", border: "none", borderBottom: "1px solid var(--border)", cursor: "pointer" }}
                  >
                    <CheckCircle className="w-4 h-4 flex-shrink-0" style={{ color: "#4ade80" }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>
                        {task.title}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        {proj && (
                          <span className="text-xs" style={{ color: proj.color }}>{proj.emoji} {proj.name}</span>
                        )}
                        <span className="text-xs font-bold" style={{ color: PRIORITY_COLORS[task.priority] }}>{task.priority}</span>
                        {task.assignee && (
                          <span className="text-xs" style={{ color: "var(--text-muted)" }}>{task.assignee}</span>
                        )}
                      </div>
                    </div>
                    <div className="text-xs flex-shrink-0" style={{ color: "var(--text-muted)" }}>
                      {formatDate(task.completedAt || task.updated)}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Bottom: Activity Feed + Quick Nav */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
        {/* Activity Feed */}
        <div
          className="lg:col-span-2 rounded-xl overflow-hidden"
          style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
        >
          <div
            className="flex items-center justify-between px-5 py-4"
            style={{ borderBottom: "1px solid var(--border)" }}
          >
            <div className="flex items-center gap-3">
              <div className="accent-line" />
              <h2
                className="text-base font-semibold"
                style={{ fontFamily: "var(--font-heading)", color: "var(--text-primary)" }}
              >
                Recent Activity
              </h2>
            </div>
            <Link href="/activity" className="text-sm font-medium" style={{ color: "var(--accent)" }}>
              View all →
            </Link>
          </div>
          <div className="p-0">
            <ActivityFeed limit={5} />
          </div>
        </div>

        {/* Quick Nav */}
        <div
          className="rounded-xl overflow-hidden"
          style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
        >
          <div
            className="flex items-center px-5 py-4"
            style={{ borderBottom: "1px solid var(--border)" }}
          >
            <div className="flex items-center gap-3">
              <div className="accent-line" />
              <h2
                className="text-base font-semibold"
                style={{ fontFamily: "var(--font-heading)", color: "var(--text-primary)" }}
              >
                Quick Nav
              </h2>
            </div>
          </div>
          <div className="p-4 grid grid-cols-2 gap-2">
            {[
              { href: "/tasks", icon: Kanban, label: "Task Board", color: "#a78bfa" },
              { href: "/trading", icon: TrendingUp, label: "Trading", color: "#4ade80" },
              { href: "/agents", icon: Bot, label: "Agents", color: "var(--accent)" },
              { href: "/cron", icon: Zap, label: "Cron Jobs", color: "#f59e0b" },
              { href: "/memory", icon: Brain, label: "Memory", color: "#60a5fa" },
              { href: "/costs", icon: DollarSign, label: "Costs", color: "#4ade80" },
              { href: "/system", icon: Server, label: "System", color: "#94a3b8" },
              { href: "/skills", icon: Code2, label: "Skills", color: "#f472b6" },
            ].map(({ href, icon: Icon, label, color }) => (
              <Link
                key={href}
                href={href}
                className="p-3 rounded-lg transition-all hover:scale-[1.02]"
                style={{ backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)" }}
              >
                <div className="flex items-center gap-2">
                  <Icon className="w-4 h-4" style={{ color }} />
                  <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{label}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Task Detail Drawer */}
      {selectedTask && (
        <TaskDetailDrawer
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
          onTaskUpdated={(updated) => {
            setDoneTasks((prev) => prev.map((t) => t.id === updated.id ? updated : t).filter((t) => t.status === "done"));
            setSelectedTask(updated.status === "done" ? updated : null);
          }}
          projectsMap={tasksProjectsMap}
        />
      )}
    </div>
  );
}
