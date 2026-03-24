"use client";

import { useEffect, useState } from "react";
import { StatsCard } from "@/components/StatsCard";
import { ActivityFeed } from "@/components/ActivityFeed";
import { WeatherWidget } from "@/components/WeatherWidget";
import {
  Activity,
  CheckCircle,
  XCircle,
  Circle,
  Bot,
  Users,
  Zap,
  TrendingUp,
  Code2,
  Search,
  Pen,
  Scale,
  DollarSign,
  Kanban,
  Brain,
  Server,
  Rocket,
} from "lucide-react";
import Link from "next/link";

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
    name: "T1",
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
    name: "T2",
    role: "Weather Trading",
    division: "Trading",
    emoji: "🌩️",
    color: "#4ade80",
    divisionColor: "#4ade80",
    description: "Weather prediction markets",
    status: "pending" as const,
  },
  {
    id: "t3",
    name: "T3",
    role: "Crypto Trading",
    division: "Trading",
    emoji: "₿",
    color: "#4ade80",
    divisionColor: "#4ade80",
    description: "Crypto strategies, CCXT pipeline",
    status: "building" as const,
  },
  {
    id: "backend",
    name: "Backend Eng",
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
    name: "Full-Stack Eng",
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
    description: "T3's CCXT pipeline — foundation in progress",
    status: "in-progress",
    agent: "T3",
    color: "#4ade80",
    icon: "₿",
    href: "/tasks",
  },
  {
    name: "Mission Control",
    description: "This dashboard — Harris Autonomous command center",
    status: "in-progress",
    agent: "Full-Stack Eng",
    color: "#60a5fa",
    icon: "🎛️",
    href: "/tasks",
  },
  {
    name: "Karpathy Loop",
    description: "Autoresearch loop for trading + strategy improvement",
    status: "design",
    agent: "Henry",
    color: "#f59e0b",
    icon: "🔬",
    href: "/tasks",
  },
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

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats>({ total: 0, today: 0, success: 0, error: 0, byType: {} });
  const [liveAgents, setLiveAgents] = useState<Agent[]>([]);

  useEffect(() => {
    Promise.all([
      fetch("/api/activities/stats").then(r => r.json()),
      fetch("/api/agents").then(r => r.json()),
    ]).then(([actStats, agentsData]) => {
      setStats({
        total: actStats.total || 0,
        today: actStats.today || 0,
        success: actStats.byStatus?.success || 0,
        error: actStats.byStatus?.error || 0,
        byType: actStats.byType || {},
      });
      setLiveAgents(agentsData.agents || []);
    }).catch(console.error);
  }, []);

  const activeAgentCount = ORG_AGENTS.filter(a => a.status === "online" || a.status === "active" || a.status === "building").length;

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
          Harris Autonomous — 9 agents · 5 divisions · always building
        </p>
      </div>

      {/* Stats Grid + Weather */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mb-6">
        <div className="lg:col-span-3 grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatsCard
            title="Active Agents"
            value={activeAgentCount.toString()}
            icon={<Users className="w-5 h-5" />}
            iconColor="var(--accent)"
          />
          <StatsCard
            title="Tasks Today"
            value={stats.today.toLocaleString()}
            icon={<Zap className="w-5 h-5" />}
            iconColor="#f59e0b"
          />
          <StatsCard
            title="Successful"
            value={stats.success.toLocaleString()}
            icon={<CheckCircle className="w-5 h-5" />}
            iconColor="var(--success)"
          />
          <StatsCard
            title="Errors"
            value={stats.error.toLocaleString()}
            icon={<XCircle className="w-5 h-5" />}
            iconColor="var(--error)"
          />
        </div>
        <div className="lg:col-span-1">
          <WeatherWidget />
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
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0"
              style={{ backgroundColor: "#f59e0b20", border: "2px solid #f59e0b" }}
            >
              ⚡
            </div>
            <div>
              <div
                className="font-bold text-base"
                style={{ fontFamily: "var(--font-heading)", color: "var(--text-primary)" }}
              >
                Henry ⚡ — Chief of Staff
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <Circle className="w-2 h-2" style={{ fill: "#4ade80", color: "#4ade80" }} />
                <span className="text-xs" style={{ color: "#4ade80" }}>Online · Orchestrating</span>
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
            { name: "Trading Desk", color: "#4ade80", agents: ORG_AGENTS.filter(a => a.division === "Trading") },
            { name: "Engineering", color: "#60a5fa", agents: ORG_AGENTS.filter(a => a.division === "Engineering") },
            { name: "Research", color: "#a78bfa", agents: ORG_AGENTS.filter(a => a.division === "Research") },
            { name: "Creative", color: "#f472b6", agents: ORG_AGENTS.filter(a => a.division === "Creative") },
            { name: "Legal", color: "#94a3b8", agents: ORG_AGENTS.filter(a => a.division === "Legal") },
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
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-lg">{agent.emoji}</span>
                      <Circle
                        className="w-2 h-2"
                        style={{
                          fill: STATUS_COLORS[agent.status],
                          color: STATUS_COLORS[agent.status],
                        }}
                      />
                    </div>
                    <div
                      className="text-sm font-bold"
                      style={{ fontFamily: "var(--font-heading)", color: "var(--text-primary)" }}
                    >
                      {agent.name}
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                      {agent.role}
                    </div>
                    <div
                      className="text-xs mt-1 font-medium"
                      style={{ color: STATUS_COLORS[agent.status] }}
                    >
                      {STATUS_LABELS[agent.status]}
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
              { name: "T1 — Stocks & Options", emoji: "📈", status: "Not deployed", color: "#6b7280", active: false },
              { name: "T2 — Weather Trading", emoji: "🌩️", status: "Not deployed", color: "#6b7280", active: false },
              { name: "T3 — Crypto Bot", emoji: "₿", status: "Building", color: "#f59e0b", active: true },
            ].map((trader) => (
              <div
                key={trader.name}
                className="flex items-center gap-3 p-3 rounded-lg"
                style={{
                  backgroundColor: "var(--card-elevated)",
                  border: `1px solid ${trader.active ? trader.color + "40" : "var(--border)"}`,
                }}
              >
                <span className="text-xl">{trader.emoji}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                    {trader.name}
                  </div>
                  <div className="text-xs mt-0.5 font-medium" style={{ color: trader.color }}>
                    {trader.status}
                  </div>
                </div>
                <Circle
                  className="w-2 h-2 flex-shrink-0"
                  style={{ fill: trader.color, color: trader.color }}
                />
              </div>
            ))}
            <div
              className="text-xs text-center mt-2 p-2 rounded"
              style={{ color: "var(--text-muted)", backgroundColor: "var(--card-elevated)" }}
            >
              P&amp;L tracking coming soon
            </div>
          </div>
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
    </div>
  );
}
