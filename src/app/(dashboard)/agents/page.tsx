"use client";

import { useEffect, useState } from "react";
import {
  Bot,
  Circle,
  Users,
  Activity,
  GitBranch,
  LayoutGrid,
  TrendingUp,
  Code2,
  Search,
  Pen,
  Scale,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { AgentOrgChart } from "@/components/AgentOrgChart";
import { AgentAvatar } from "@/components/AgentAvatar";

// The full org roster — static data for all 9 agents
const ORG_AGENTS = [
  {
    id: "henry",
    name: "Henry",
    emoji: "⚡",
    role: "Chief of Staff / Orchestrator",
    division: "Leadership",
    divisionColor: "#f59e0b",
    status: "ONLINE" as const,
    deployedStatus: "live" as const,
    description:
      "Orchestrates all agents, assigns work, tracks progress. Delivers morning briefs, status reports, and proactive alerts. The nerve center of Harris Autonomous.",
    model: "claude-opus-4-6",
    reportsTo: "Tim Harris (CEO)",
    comms: "Telegram (primary)",
    isReal: true,
  },
  {
    id: "t1",
    name: "Atlas 📈",
    emoji: "📈",
    role: "Stocks & Options Trader",
    division: "Trading",
    divisionColor: "#10b981",
    status: "NOT DEPLOYED" as const,
    deployedStatus: "pending" as const,
    description:
      "Stock screening and analysis, options strategy development, trade signal generation, and portfolio monitoring. Will manage equities and derivatives positions.",
    model: "TBD",
    reportsTo: "Henry ⚡",
    comms: "Internal",
    isReal: false,
  },
  {
    id: "t2",
    name: "Nimbus 🌤️",
    emoji: "🌤️",
    role: "Weather Prediction Trader",
    division: "Trading",
    divisionColor: "#10b981",
    status: "NOT DEPLOYED" as const,
    deployedStatus: "pending" as const,
    description:
      "Weather data ingestion and analysis, correlation of weather patterns to market movements. Polymarket + Kalshi event contracts. Seasonal and event-driven strategy development.",
    model: "TBD",
    reportsTo: "Henry ⚡",
    comms: "Internal",
    isReal: false,
  },
  {
    id: "t3",
    name: "Cipher ₿",
    emoji: "₿",
    role: "Crypto Trader",
    division: "Trading",
    divisionColor: "#10b981",
    status: "IN PROGRESS" as const,
    deployedStatus: "building" as const,
    description:
      "Crypto market data pipeline (CCXT), momentum and mean-reversion strategies, paper trading → live execution. Risk management and position sizing via Binance/Coinbase APIs.",
    model: "TBD",
    reportsTo: "Henry ⚡",
    comms: "Internal",
    isReal: false,
  },
  {
    id: "quant",
    name: "Quant 📊",
    emoji: "📊",
    role: "Trading Strategy Architect",
    division: "Trading",
    divisionColor: "#10b981",
    status: "NOT DEPLOYED" as const,
    deployedStatus: "pending" as const,
    description:
      "Designs trading strategies, backtests, optimizes. The quant research brain behind the Trading Desk. Atlas/Nimbus/Cipher execute what Quant designs.",
    model: "TBD",
    reportsTo: "Henry ⚡",
    comms: "Internal",
    isReal: false,
  },
  {
    id: "backend-eng",
    name: "Forge 🔧",
    emoji: "🔧",
    role: "Backend Engineer",
    division: "Engineering",
    divisionColor: "#3b82f6",
    status: "NOT DEPLOYED" as const,
    deployedStatus: "pending" as const,
    description:
      "Infrastructure, databases, APIs. System reliability and monitoring. CI/CD pipelines, cost management and optimization. Circuit breakers and error recovery systems.",
    model: "TBD",
    reportsTo: "Henry ⚡",
    comms: "Internal",
    isReal: false,
  },
  {
    id: "fullstack-eng",
    name: "Pixel 💻",
    emoji: "💻",
    role: "Senior Full-Stack Engineer",
    division: "Engineering",
    divisionColor: "#3b82f6",
    status: "NOT DEPLOYED" as const,
    deployedStatus: "pending" as const,
    description:
      "Web application development (frontend + backend). Dashboard and UI builds like Mission Control. API integrations. Rapid prototyping and shipping. Stack: Next.js, React, TypeScript, Tailwind.",
    model: "TBD",
    reportsTo: "Henry ⚡",
    comms: "Internal",
    isReal: false,
  },
  {
    id: "scout",
    name: "Scout",
    emoji: "🔭",
    role: "Research & Intelligence Agent",
    division: "Research",
    divisionColor: "#8b5cf6",
    status: "NOT DEPLOYED" as const,
    deployedStatus: "pending" as const,
    description:
      "Market research and opportunity identification. Tech trend monitoring, competitive intelligence. Data gathering for trading strategies. New project ideation and feasibility analysis.",
    model: "TBD",
    reportsTo: "Henry ⚡",
    comms: "Internal",
    isReal: false,
  },
  {
    id: "quill",
    name: "Quill",
    emoji: "✍️",
    role: "Creative Writer & Marketing Strategist",
    division: "Creative",
    divisionColor: "#ec4899",
    status: "NOT DEPLOYED" as const,
    deployedStatus: "pending" as const,
    description:
      "Marketing copy, campaigns, and strategy for Insight (Tim's company). Content writing: blogs, newsletters, social media. Brand voice development. Ad copy, landing pages, email sequences.",
    model: "TBD",
    reportsTo: "Henry ⚡",
    comms: "Internal",
    isReal: false,
  },
  {
    id: "counsel",
    name: "Counsel",
    emoji: "⚖️",
    role: "Legal Expert Agent",
    division: "Legal",
    divisionColor: "#64748b",
    status: "NOT DEPLOYED" as const,
    deployedStatus: "pending" as const,
    description:
      "Federal and state law research and analysis. Contract review and drafting assistance. Regulatory compliance guidance (trading, apps, data privacy). Terms of service, privacy policies. IP guidance.",
    model: "TBD",
    reportsTo: "Henry ⚡",
    comms: "Internal",
    isReal: false,
  },
];

const DIVISION_ICONS: Record<string, LucideIcon> = {
  Leadership: Zap,
  Trading: TrendingUp,
  Engineering: Code2,
  Research: Search,
  Creative: Pen,
  Legal: Scale,
};

const STATUS_CONFIG = {
  ONLINE: { color: "#4ade80", bg: "#4ade8020", label: "ONLINE" },
  "NOT DEPLOYED": { color: "#6b7280", bg: "#6b728020", label: "NOT DEPLOYED" },
  "IN PROGRESS": { color: "#f59e0b", bg: "#f59e0b20", label: "IN PROGRESS" },
};

interface LiveAgent {
  id: string;
  name: string;
  emoji: string;
  color: string;
  model: string;
  workspace: string;
  dmPolicy?: string;
  allowAgents: string[];
  allowAgentsDetails?: Array<{
    id: string;
    name: string;
    emoji: string;
    color: string;
  }>;
  botToken?: string;
  status: "online" | "offline";
  lastActivity?: string;
  activeSessions: number;
}

export default function AgentsPage() {
  const [liveAgents, setLiveAgents] = useState<LiveAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"cards" | "orgchart">("cards");
  const [filterDivision, setFilterDivision] = useState<string | null>(null);

  useEffect(() => {
    fetchAgents();
    const interval = setInterval(fetchAgents, 60_000);
    return () => clearInterval(interval);
  }, []);

  const fetchAgents = async () => {
    try {
      const res = await fetch("/api/agents");
      const data = await res.json();
      setLiveAgents(data.agents || []);
    } catch (error) {
      console.error("Error fetching agents:", error);
    } finally {
      setLoading(false);
    }
  };

  // Merge live data into org roster
  const mergedAgents = ORG_AGENTS.map((agent) => {
    if (agent.id === "henry") {
      const liveHenry = liveAgents[0]; // Henry is always first in live
      return {
        ...agent,
        status: liveHenry?.status === "online" ? ("ONLINE" as const) : ("ONLINE" as const), // Henry is always online
        model: liveHenry?.model || agent.model,
        workspace: liveHenry?.workspace,
        lastActivity: liveHenry?.lastActivity,
        activeSessions: liveHenry?.activeSessions || 0,
      };
    }
    return agent;
  });

  const divisions = [...new Set(ORG_AGENTS.map((a) => a.division))];
  const filteredAgents = filterDivision
    ? mergedAgents.filter((a) => a.division === filterDivision)
    : mergedAgents;

  const onlineCount = mergedAgents.filter((a) => a.status === "ONLINE").length;
  const inProgressCount = mergedAgents.filter(
    (a) => a.status === "IN PROGRESS"
  ).length;

  if (loading) {
    return (
      <div className="p-8">
        <div className="flex items-center justify-center min-h-[400px]">
          <div
            className="animate-pulse text-lg"
            style={{ color: "var(--text-muted)" }}
          >
            Loading agents...
          </div>
        </div>
      </div>
    );
  }

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
          <Users className="inline-block w-8 h-8 mr-2 mb-1" />
          Agent Roster — Harris Autonomous
        </h1>
        <div className="flex items-center gap-4 flex-wrap">
          <span style={{ color: "var(--text-secondary)", fontSize: "14px" }}>
            10 agents · 5 divisions · Henry ⚡ orchestrating
          </span>
          <div className="flex items-center gap-3">
            <span
              className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium"
              style={{ backgroundColor: "#4ade8020", color: "#4ade80" }}
            >
              <Circle className="w-2 h-2" style={{ fill: "#4ade80" }} />
              {onlineCount} Online
            </span>
            <span
              className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium"
              style={{ backgroundColor: "#f59e0b20", color: "#f59e0b" }}
            >
              {inProgressCount} In Progress
            </span>
            <span
              className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium"
              style={{ backgroundColor: "#6b728020", color: "#9ca3af" }}
            >
              {10 - onlineCount - inProgressCount} Pending
            </span>
          </div>
        </div>
      </div>

      {/* Tab switcher */}
      <div
        className="flex gap-2 mb-6 border-b"
        style={{ borderColor: "var(--border)" }}
      >
        {[
          { id: "cards" as const, label: "Agent Cards", icon: LayoutGrid },
          { id: "orgchart" as const, label: "Org Chart", icon: GitBranch },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className="flex items-center gap-2 px-4 py-2 font-medium transition-all"
            style={{
              color:
                activeTab === id ? "var(--accent)" : "var(--text-secondary)",
              background: "none",
              border: "none",
              cursor: "pointer",
              borderBottomStyle: "solid",
              borderBottomWidth: "2px",
              borderBottomColor:
                activeTab === id ? "var(--accent)" : "transparent",
              paddingBottom: "0.5rem",
            }}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Org Chart View */}
      {activeTab === "orgchart" && (
        <OrgChartView agents={mergedAgents as Array<Record<string, any>>} />
      )}

      {/* Agent Cards View */}
      {activeTab === "cards" && (
        <>
          {/* Division filter pills */}
          <div className="flex gap-2 flex-wrap mb-5">
            <button
              onClick={() => setFilterDivision(null)}
              className="px-3 py-1 rounded-full text-xs font-medium transition-all"
              style={{
                backgroundColor:
                  filterDivision === null ? "var(--accent)" : "var(--card)",
                color:
                  filterDivision === null
                    ? "white"
                    : "var(--text-secondary)",
                border: "1px solid var(--border)",
              }}
            >
              All
            </button>
            {divisions.map((div) => {
              const divAgent = ORG_AGENTS.find((a) => a.division === div);
              return (
                <button
                  key={div}
                  onClick={() =>
                    setFilterDivision(filterDivision === div ? null : div)
                  }
                  className="px-3 py-1 rounded-full text-xs font-medium transition-all"
                  style={{
                    backgroundColor:
                      filterDivision === div
                        ? `${divAgent?.divisionColor}30`
                        : "var(--card)",
                    color:
                      filterDivision === div
                        ? divAgent?.divisionColor
                        : "var(--text-secondary)",
                    border: `1px solid ${filterDivision === div ? divAgent?.divisionColor + "60" : "var(--border)"}`,
                  }}
                >
                  {div}
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredAgents.map((agent) => {
              const statusCfg =
                STATUS_CONFIG[agent.status as keyof typeof STATUS_CONFIG] ||
                STATUS_CONFIG["NOT DEPLOYED"];
              const DivIcon: LucideIcon =
                DIVISION_ICONS[agent.division] || Bot;

              return (
                <div
                  key={agent.id}
                  className="rounded-xl overflow-hidden transition-all hover:scale-[1.02]"
                  style={{
                    backgroundColor: "var(--card)",
                    border: `1px solid var(--border)`,
                    boxShadow:
                      agent.status === "ONLINE"
                        ? `0 0 0 1px ${agent.divisionColor}40, 0 4px 20px ${agent.divisionColor}10`
                        : undefined,
                  }}
                >
                  {/* Header */}
                  <div
                    className="px-5 py-4 flex items-center justify-between"
                    style={{
                      borderBottom: "1px solid var(--border)",
                      background: `linear-gradient(135deg, ${agent.divisionColor}12, transparent)`,
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <AgentAvatar
                        agentId={agent.id}
                        size={64}
                        borderColor={agent.divisionColor}
                        borderWidth={2}
                        className="rounded-full"
                      />
                      <div>
                        <h3
                          className="text-lg font-bold"
                          style={{
                            fontFamily: "var(--font-heading)",
                            color: "var(--text-primary)",
                          }}
                        >
                          {agent.name}
                        </h3>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span
                            className="text-xs px-2 py-0.5 rounded-full font-medium"
                            style={{
                              backgroundColor: statusCfg.bg,
                              color: statusCfg.color,
                            }}
                          >
                            {statusCfg.label}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div
                        className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs"
                        style={{
                          backgroundColor: `${agent.divisionColor}15`,
                          color: agent.divisionColor,
                        }}
                      >
                        <DivIcon className="w-3 h-3" />
                        {agent.division}
                      </div>
                    </div>
                  </div>

                  {/* Body */}
                  <div className="p-5 space-y-3">
                    {/* Role */}
                    <div>
                      <div
                        className="text-xs font-medium mb-0.5"
                        style={{ color: "var(--text-muted)" }}
                      >
                        Role
                      </div>
                      <div
                        className="text-sm font-semibold"
                        style={{ color: "var(--text-primary)" }}
                      >
                        {agent.role}
                      </div>
                    </div>

                    {/* Description */}
                    <div>
                      <div
                        className="text-xs font-medium mb-0.5"
                        style={{ color: "var(--text-muted)" }}
                      >
                        Mission
                      </div>
                      <p
                        className="text-xs leading-relaxed"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        {agent.description}
                      </p>
                    </div>

                    {/* Footer row */}
                    <div
                      className="flex items-center justify-between pt-2 border-t"
                      style={{ borderColor: "var(--border)" }}
                    >
                      <div className="flex items-center gap-2">
                        <Bot
                          className="w-3.5 h-3.5"
                          style={{ color: "var(--text-muted)" }}
                        />
                        <span
                          className="text-xs font-mono"
                          style={{ color: "var(--text-muted)" }}
                        >
                          {agent.model === "TBD" ? "Model TBD" : agent.model}
                        </span>
                      </div>
                      {agent.status === "ONLINE" && (
                        <div className="flex items-center gap-1">
                          <Activity
                            className="w-3 h-3"
                            style={{ color: "#4ade80" }}
                          />
                          <span
                            className="text-xs"
                            style={{ color: "#4ade80" }}
                          >
                            Active
                          </span>
                        </div>
                      )}
                      {agent.status === "IN PROGRESS" && (
                        <div className="flex items-center gap-1">
                          <div
                            className="w-2 h-2 rounded-full animate-pulse"
                            style={{ backgroundColor: "#f59e0b" }}
                          />
                          <span
                            className="text-xs"
                            style={{ color: "#f59e0b" }}
                          >
                            Building
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// Visual org chart component using static org data
function OrgChartView({ agents }: { agents: Array<Record<string, any>> }) {
  const divisionGroups: Record<string, typeof ORG_AGENTS> = {};
  for (const agent of agents) {
    if (agent.id === "henry") continue;
    if (!divisionGroups[agent.division]) divisionGroups[agent.division] = [];
    divisionGroups[agent.division].push(agent as any);
  }

  const henry = agents.find((a) => a.id === "henry")!;

  return (
    <div
      className="rounded-xl p-6"
      style={{
        backgroundColor: "var(--card)",
        border: "1px solid var(--border)",
      }}
    >
      <h2
        className="font-semibold mb-1"
        style={{ color: "var(--text-primary)" }}
      >
        Agent Hierarchy — Harris Autonomous
      </h2>
      <p
        className="text-sm mb-8"
        style={{ color: "var(--text-muted)" }}
      >
        Reporting structure and division breakdown
      </p>

      {/* Tim at top */}
      <div className="flex flex-col items-center">
        <div
          className="px-6 py-3 rounded-xl font-bold text-center mb-2"
          style={{
            backgroundColor: "rgba(245,158,11,0.1)",
            border: "2px solid #f59e0b",
            color: "var(--text-primary)",
            minWidth: "180px",
          }}
        >
          <div className="text-lg">👤</div>
          <div style={{ fontFamily: "var(--font-heading)" }}>Tim Harris</div>
          <div className="text-xs" style={{ color: "#f59e0b" }}>
            CEO
          </div>
        </div>

        {/* Connector */}
        <div
          className="w-px h-8"
          style={{ backgroundColor: "var(--border)" }}
        />

        {/* Henry */}
        <div
          className="px-6 py-3 rounded-xl font-bold text-center mb-2 flex flex-col items-center"
          style={{
            backgroundColor: `${henry.divisionColor}20`,
            border: `2px solid ${henry.divisionColor}`,
            color: "var(--text-primary)",
            minWidth: "180px",
            boxShadow: `0 0 20px ${henry.divisionColor}30`,
          }}
        >
          <AgentAvatar agentId="henry" size={56} borderColor={henry.divisionColor} borderWidth={2} className="mb-2" />
          <div style={{ fontFamily: "var(--font-heading)" }}>{henry.name}</div>
          <div className="text-xs" style={{ color: henry.divisionColor }}>
            {henry.role}
          </div>
          <div
            className="text-xs mt-0.5 flex items-center justify-center gap-1"
          >
            <Circle
              className="w-1.5 h-1.5"
              style={{ fill: "#4ade80", color: "#4ade80" }}
            />
            <span style={{ color: "#4ade80" }}>ONLINE</span>
          </div>
        </div>

        {/* Connectors to divisions */}
        <div className="w-px h-8" style={{ backgroundColor: "var(--border)" }} />

        {/* Division columns */}
        <div className="flex gap-4 flex-wrap justify-center">
          {Object.entries(divisionGroups).map(([division, divAgents]) => {
            const color = divAgents[0].divisionColor;
            const DivIcon: LucideIcon = DIVISION_ICONS[division] || Bot;

            // Special Trading hierarchy: Quant at top, Atlas/Nimbus/Cipher below
            if (division === "Trading") {
              const quant = divAgents.find((a) => a.id === "quant");
              const traders = divAgents.filter((a) => a.id !== "quant");
              return (
                <div key={division} className="flex flex-col items-center">
                  <div
                    className="px-4 py-1.5 rounded-lg text-xs font-bold mb-3 flex items-center gap-1.5"
                    style={{ backgroundColor: `${color}20`, color, border: `1px solid ${color}40` }}
                  >
                    <DivIcon className="w-3 h-3" />
                    {division}
                  </div>
                  {quant && (
                    <>
                      {/* Quant node */}
                      <div
                        className="px-4 py-2 rounded-xl flex flex-col items-center mb-1"
                        style={{ backgroundColor: `${color}20`, border: `2px solid ${color}60`, minWidth: "140px" }}
                      >
                        <AgentAvatar agentId={quant.id} size={40} borderColor={color} borderWidth={2} className="mb-1.5" />
                        <div className="text-xs font-bold" style={{ color: "var(--text-primary)" }}>{quant.name}</div>
                        <div className="text-xs mt-0.5" style={{ color: color }}>Strategy Architect</div>
                        <div className="text-xs mt-0.5" style={{ color: "#6b7280" }}>NOT DEPLOYED</div>
                      </div>
                      {/* Connector */}
                      <div className="w-px h-4" style={{ backgroundColor: "var(--border)" }} />
                      {/* Executor label */}
                      <div className="text-xs mb-2" style={{ color: "var(--text-muted)" }}>executes via</div>
                      {/* Trader nodes */}
                      <div className="flex flex-col gap-2">
                        {traders.map((agent) => {
                          const statusCfg = STATUS_CONFIG[agent.status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG["NOT DEPLOYED"];
                          return (
                            <div
                              key={agent.id}
                              className="px-4 py-2 rounded-xl flex flex-col items-center"
                              style={{ backgroundColor: `${color}10`, border: `1px solid ${color}30`, minWidth: "140px" }}
                            >
                              <AgentAvatar agentId={agent.id} size={40} borderColor={color} borderWidth={2} className="mb-1.5" />
                              <div className="text-xs font-bold" style={{ color: "var(--text-primary)" }}>{agent.name}</div>
                              <div className="text-xs mt-0.5" style={{ color: statusCfg.color }}>{statusCfg.label}</div>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              );
            }

            return (
              <div key={division} className="flex flex-col items-center">
                {/* Division header */}
                <div
                  className="px-4 py-1.5 rounded-lg text-xs font-bold mb-3 flex items-center gap-1.5"
                  style={{
                    backgroundColor: `${color}20`,
                    color: color,
                    border: `1px solid ${color}40`,
                  }}
                >
                  <DivIcon className="w-3 h-3" />
                  {division}
                </div>

                {/* Agents in division */}
                <div className="flex flex-col gap-2">
                  {divAgents.map((agent) => {
                    const statusCfg =
                      STATUS_CONFIG[
                        agent.status as keyof typeof STATUS_CONFIG
                      ] || STATUS_CONFIG["NOT DEPLOYED"];
                    return (
                      <div
                        key={agent.id}
                        className="px-4 py-2 rounded-xl flex flex-col items-center"
                        style={{
                          backgroundColor: `${color}10`,
                          border: `1px solid ${color}30`,
                          minWidth: "140px",
                        }}
                      >
                        <AgentAvatar agentId={agent.id} size={40} borderColor={color} borderWidth={2} className="mb-1.5" />
                        <div
                          className="text-xs font-bold"
                          style={{ color: "var(--text-primary)" }}
                        >
                          {agent.name}
                        </div>
                        <div
                          className="text-xs mt-0.5"
                          style={{ color: statusCfg.color }}
                        >
                          {statusCfg.label}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
