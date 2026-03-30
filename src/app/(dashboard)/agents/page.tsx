"use client";

import { useState } from "react";
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
  RefreshCw,
  Wifi,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import { AgentAvatar } from "@/components/AgentAvatar";
import { AGENT_CONFIGS, getDisplayName } from "@/config/agents";
import {
  useAgentStatus,
  mapToDisplayStatus,
  type AgentStatus,
} from "@/hooks/useAgentStatus";

// ─── Org Roster — derived from the central agent registry ────────────────────

interface OrgAgent {
  id: string;
  name: string;
  emoji: string;
  role: string;
  division: string;
  divisionColor: string;
  description: string;
  reportsTo: string;
  comms: string;
}

const ORG_AGENTS: OrgAgent[] = AGENT_CONFIGS.map((a) => ({
  id: a.id,
  name: getDisplayName(a),
  emoji: a.emoji,
  role: a.role,
  division: a.division,
  divisionColor: a.divisionColor,
  description: a.description,
  reportsTo: a.reportsTo,
  comms: a.id === "henry" ? "Telegram (primary)" : "Internal",
}));

// ─── Status display config ───────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  string,
  { color: string; bg: string; label: string; dotClass?: string }
> = {
  ONLINE: {
    color: "#4ade80",
    bg: "#4ade8020",
    label: "ONLINE",
    dotClass: "animate-pulse",
  },
  BUILDING: {
    color: "#f59e0b",
    bg: "#f59e0b20",
    label: "BUILDING",
    dotClass: "animate-pulse",
  },
  ACTIVE: {
    color: "#60a5fa",
    bg: "#60a5fa20",
    label: "ACTIVE",
    dotClass: "",
  },
  "NOT DEPLOYED": {
    color: "#6b7280",
    bg: "#6b728020",
    label: "NOT DEPLOYED",
    dotClass: "",
  },
  OFFLINE: {
    color: "#ef4444",
    bg: "#ef444420",
    label: "OFFLINE",
    dotClass: "",
  },
};

const DIVISION_ICONS: Record<string, LucideIcon> = {
  Leadership: Zap,
  Trading: TrendingUp,
  Engineering: Code2,
  Research: Search,
  Creative: Pen,
  Legal: Scale,
};

// ─── Page component ──────────────────────────────────────────────────────────

export default function AgentsPage() {
  const { statusMap, gatewayReachable, lastUpdated, loading, refetch } =
    useAgentStatus(30_000);
  const [activeTab, setActiveTab] = useState<"cards" | "orgchart">("cards");
  const [filterDivision, setFilterDivision] = useState<string | null>(null);

  // Merge live status into org roster
  const mergedAgents = ORG_AGENTS.map((agent) => {
    const live = statusMap[agent.id];
    const displayStatus = live
      ? mapToDisplayStatus(live.status)
      : "NOT DEPLOYED";
    return {
      ...agent,
      displayStatus,
      model: live?.model || (agent.id === "henry" ? "claude-opus-4-6" : "TBD"),
      lastActivity: live?.lastActivity,
      activeSessions: live?.activeSessions || 0,
      sessionLabel: live?.label,
    };
  });

  const divisions = [...new Set(ORG_AGENTS.map((a) => a.division))];
  const filteredAgents = filterDivision
    ? mergedAgents.filter((a) => a.division === filterDivision)
    : mergedAgents;

  const onlineCount = mergedAgents.filter(
    (a) => a.displayStatus === "ONLINE"
  ).length;
  const buildingCount = mergedAgents.filter(
    (a) => a.displayStatus === "BUILDING"
  ).length;
  const activeCount = mergedAgents.filter(
    (a) => a.displayStatus === "ACTIVE"
  ).length;
  const pendingCount = mergedAgents.filter(
    (a) => a.displayStatus === "NOT DEPLOYED"
  ).length;

  if (loading) {
    return (
      <div className="p-8">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="flex flex-col items-center gap-3">
            <div
              className="w-8 h-8 border-2 rounded-full animate-spin"
              style={{
                borderColor: "var(--border)",
                borderTopColor: "var(--accent)",
              }}
            />
            <div
              className="text-sm font-medium"
              style={{ color: "var(--text-muted)" }}
            >
              Polling agent sessions…
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-1">
          <h1
            className="text-2xl md:text-3xl font-bold"
            style={{
              fontFamily: "var(--font-heading)",
              color: "var(--text-primary)",
              letterSpacing: "-1.5px",
            }}
          >
            <Users className="inline-block w-8 h-8 mr-2 mb-1" />
            Agent Roster — Harris Autonomous
          </h1>

          {/* Gateway status + refresh */}
          <div className="flex items-center gap-3">
            <div
              className="flex items-center gap-1.5 text-xs"
              style={{
                color: gatewayReachable
                  ? "var(--text-muted)"
                  : "#ef4444",
              }}
              title={
                gatewayReachable
                  ? `Last polled ${lastUpdated ? new Date(lastUpdated).toLocaleTimeString() : "never"}`
                  : "Gateway unreachable — statuses may be stale"
              }
            >
              {gatewayReachable ? (
                <Wifi className="w-3.5 h-3.5" />
              ) : (
                <WifiOff className="w-3.5 h-3.5" />
              )}
              <span className="hidden sm:inline">
                {gatewayReachable ? "Live" : "Disconnected"}
              </span>
            </div>
            <button
              onClick={refetch}
              className="p-1.5 rounded-lg transition-all hover:scale-105 active:scale-95"
              style={{
                backgroundColor: "var(--card)",
                border: "1px solid var(--border)",
                color: "var(--text-muted)",
              }}
              title="Refresh now"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-4 flex-wrap">
          <span style={{ color: "var(--text-secondary)", fontSize: "14px" }}>
            {AGENT_CONFIGS.length} agents · {new Set(AGENT_CONFIGS.map(a => a.division)).size} divisions · Henry ⚡ orchestrating
          </span>
          <div className="flex items-center gap-3">
            {onlineCount > 0 && (
              <StatusPill color="#4ade80" count={onlineCount} label="Online" pulse />
            )}
            {buildingCount > 0 && (
              <StatusPill color="#f59e0b" count={buildingCount} label="Building" pulse />
            )}
            {activeCount > 0 && (
              <StatusPill color="#60a5fa" count={activeCount} label="Active" />
            )}
            {pendingCount > 0 && (
              <StatusPill color="#6b7280" count={pendingCount} label="Pending" textColor="#9ca3af" />
            )}
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
        <OrgChartView agents={mergedAgents} />
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
                  filterDivision === null ? "white" : "var(--text-secondary)",
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
            {filteredAgents.map((agent) => (
              <AgentCard key={agent.id} agent={agent} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── StatusPill ──────────────────────────────────────────────────────────────

function StatusPill({
  color,
  count,
  label,
  pulse,
  textColor,
}: {
  color: string;
  count: number;
  label: string;
  pulse?: boolean;
  textColor?: string;
}) {
  return (
    <span
      className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ backgroundColor: `${color}20`, color: textColor || color }}
    >
      <span className="relative flex h-2 w-2">
        {pulse && (
          <span
            className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-50"
            style={{ backgroundColor: color }}
          />
        )}
        <span
          className="relative inline-flex rounded-full h-2 w-2"
          style={{ backgroundColor: color }}
        />
      </span>
      {count} {label}
    </span>
  );
}

// ─── AgentCard ───────────────────────────────────────────────────────────────

interface MergedAgent extends OrgAgent {
  displayStatus: string;
  model: string;
  lastActivity?: number;
  activeSessions: number;
  sessionLabel?: string;
}

function AgentCard({ agent }: { agent: MergedAgent }) {
  const statusCfg =
    STATUS_CONFIG[agent.displayStatus] || STATUS_CONFIG["NOT DEPLOYED"];
  const DivIcon: LucideIcon = DIVISION_ICONS[agent.division] || Bot;

  const timeAgo = agent.lastActivity
    ? formatTimeAgo(agent.lastActivity)
    : null;

  return (
    <div
      className="rounded-xl overflow-hidden transition-all hover:scale-[1.02]"
      style={{
        backgroundColor: "var(--card)",
        border: `1px solid var(--border)`,
        boxShadow:
          agent.displayStatus === "ONLINE" || agent.displayStatus === "BUILDING"
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
          <div className="relative">
            <AgentAvatar
              agentId={agent.id}
              size={64}
              borderColor={agent.divisionColor}
              borderWidth={2}
              className="rounded-full"
            />
            {/* Live status dot — positioned bottom-right of avatar */}
            <span
              className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full"
              style={{ backgroundColor: "var(--card)" }}
            >
              <span className="relative flex h-3 w-3">
                {(agent.displayStatus === "ONLINE" ||
                  agent.displayStatus === "BUILDING") && (
                  <span
                    className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-40"
                    style={{ backgroundColor: statusCfg.color }}
                  />
                )}
                <span
                  className="relative inline-flex rounded-full h-3 w-3"
                  style={{ backgroundColor: statusCfg.color }}
                />
              </span>
            </span>
          </div>
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
              {timeAgo && (
                <span
                  className="text-xs"
                  style={{ color: "var(--text-muted)" }}
                >
                  {timeAgo}
                </span>
              )}
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

        {/* Active session label (if building/active) */}
        {agent.sessionLabel &&
          (agent.displayStatus === "BUILDING" ||
            agent.displayStatus === "ACTIVE") && (
            <div
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs"
              style={{
                backgroundColor: `${statusCfg.color}10`,
                border: `1px solid ${statusCfg.color}20`,
                color: statusCfg.color,
              }}
            >
              <Activity className="w-3 h-3 flex-shrink-0" />
              <span className="truncate font-mono">{agent.sessionLabel}</span>
              {agent.activeSessions > 1 && (
                <span
                  className="ml-auto flex-shrink-0 px-1.5 py-0.5 rounded-full text-xs font-bold"
                  style={{
                    backgroundColor: `${statusCfg.color}20`,
                  }}
                >
                  +{agent.activeSessions - 1}
                </span>
              )}
            </div>
          )}

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
          {agent.displayStatus === "ONLINE" && (
            <div className="flex items-center gap-1">
              <Activity className="w-3 h-3" style={{ color: "#4ade80" }} />
              <span className="text-xs" style={{ color: "#4ade80" }}>
                Active
              </span>
            </div>
          )}
          {agent.displayStatus === "BUILDING" && (
            <div className="flex items-center gap-1">
              <div
                className="w-2 h-2 rounded-full animate-pulse"
                style={{ backgroundColor: "#f59e0b" }}
              />
              <span className="text-xs" style={{ color: "#f59e0b" }}>
                Building
              </span>
            </div>
          )}
          {agent.displayStatus === "ACTIVE" && (
            <div className="flex items-center gap-1">
              <Circle
                className="w-2 h-2"
                style={{ fill: "#60a5fa", color: "#60a5fa" }}
              />
              <span className="text-xs" style={{ color: "#60a5fa" }}>
                Recent
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Org Chart View ──────────────────────────────────────────────────────────

function OrgChartView({ agents }: { agents: MergedAgent[] }) {
  const divisionGroups: Record<string, MergedAgent[]> = {};
  for (const agent of agents) {
    if (agent.id === "henry") continue;
    if (!divisionGroups[agent.division]) divisionGroups[agent.division] = [];
    divisionGroups[agent.division].push(agent);
  }

  const henry = agents.find((a) => a.id === "henry")!;
  const henryStatusCfg =
    STATUS_CONFIG[henry.displayStatus] || STATUS_CONFIG["ONLINE"];

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
      <p className="text-sm mb-8" style={{ color: "var(--text-muted)" }}>
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
          <AgentAvatar
            agentId="henry"
            size={56}
            borderColor={henry.divisionColor}
            borderWidth={2}
            className="mb-2"
          />
          <div style={{ fontFamily: "var(--font-heading)" }}>{henry.name}</div>
          <div className="text-xs" style={{ color: henry.divisionColor }}>
            {henry.role}
          </div>
          <div className="text-xs mt-0.5 flex items-center justify-center gap-1">
            <span className="relative flex h-2 w-2">
              {henry.displayStatus === "ONLINE" && (
                <span
                  className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-40"
                  style={{ backgroundColor: henryStatusCfg.color }}
                />
              )}
              <span
                className="relative inline-flex rounded-full h-2 w-2"
                style={{ backgroundColor: henryStatusCfg.color }}
              />
            </span>
            <span style={{ color: henryStatusCfg.color }}>
              {henryStatusCfg.label}
            </span>
          </div>
        </div>

        {/* Connectors to divisions */}
        <div
          className="w-px h-8"
          style={{ backgroundColor: "var(--border)" }}
        />

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
                    style={{
                      backgroundColor: `${color}20`,
                      color,
                      border: `1px solid ${color}40`,
                    }}
                  >
                    <DivIcon className="w-3 h-3" />
                    {division}
                  </div>
                  {quant && (
                    <>
                      <OrgChartNode agent={quant} color={color} subtitle="Strategy Architect" />
                      <div
                        className="w-px h-4"
                        style={{ backgroundColor: "var(--border)" }}
                      />
                      <div
                        className="text-xs mb-2"
                        style={{ color: "var(--text-muted)" }}
                      >
                        executes via
                      </div>
                      <div className="flex flex-col gap-2">
                        {traders.map((agent) => (
                          <OrgChartNode key={agent.id} agent={agent} color={color} />
                        ))}
                      </div>
                    </>
                  )}
                </div>
              );
            }

            return (
              <div key={division} className="flex flex-col items-center">
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
                <div className="flex flex-col gap-2">
                  {divAgents.map((agent) => (
                    <OrgChartNode key={agent.id} agent={agent} color={color} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function OrgChartNode({
  agent,
  color,
  subtitle,
}: {
  agent: MergedAgent;
  color: string;
  subtitle?: string;
}) {
  const statusCfg =
    STATUS_CONFIG[agent.displayStatus] || STATUS_CONFIG["NOT DEPLOYED"];
  const isLive =
    agent.displayStatus === "ONLINE" ||
    agent.displayStatus === "BUILDING" ||
    agent.displayStatus === "ACTIVE";

  return (
    <div
      className="px-4 py-2 rounded-xl flex flex-col items-center"
      style={{
        backgroundColor: isLive ? `${color}20` : `${color}10`,
        border: `${isLive ? 2 : 1}px solid ${color}${isLive ? "60" : "30"}`,
        minWidth: "140px",
      }}
    >
      <AgentAvatar
        agentId={agent.id}
        size={40}
        borderColor={color}
        borderWidth={2}
        className="mb-1.5"
      />
      <div
        className="text-xs font-bold"
        style={{ color: "var(--text-primary)" }}
      >
        {agent.name}
      </div>
      {subtitle && (
        <div className="text-xs mt-0.5" style={{ color }}>
          {subtitle}
        </div>
      )}
      <div className="text-xs mt-0.5 flex items-center gap-1">
        <span className="relative flex h-1.5 w-1.5">
          {(agent.displayStatus === "ONLINE" ||
            agent.displayStatus === "BUILDING") && (
            <span
              className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-40"
              style={{ backgroundColor: statusCfg.color }}
            />
          )}
          <span
            className="relative inline-flex rounded-full h-1.5 w-1.5"
            style={{ backgroundColor: statusCfg.color }}
          />
        </span>
        <span style={{ color: statusCfg.color }}>{statusCfg.label}</span>
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
