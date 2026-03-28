"use client";

import { useState, useEffect } from "react";
import { AgentAvatar } from "@/components/AgentAvatar";
import {
  useAgentStatus,
  mapToDisplayStatus,
} from "@/hooks/useAgentStatus";

// ─── Types & Data ──────────────────────────────────────────────────────────

interface OrgAgent {
  id: string;
  name: string;
  emoji: string;
  role: string;
  department: string;
  departmentLabel: string;
  departmentColor: string;
  model: string;
  reportsTo: string;
}

const DEPARTMENTS = {
  trading: { label: "Trading Desk", color: "#10b981", icon: "📈" },
  engineering: { label: "Engineering", color: "#3b82f6", icon: "⚙️" },
  research: { label: "Research", color: "#8b5cf6", icon: "🔭" },
  creative_legal: { label: "Creative & Legal", color: "#f59e0b", icon: "✍️" },
  leadership: { label: "Leadership", color: "#eab308", icon: "⚡" },
} as const;

const AGENTS: OrgAgent[] = [
  {
    id: "henry",
    name: "Henry ⚡",
    emoji: "⚡",
    role: "Chief of Staff",
    department: "leadership",
    departmentLabel: "Leadership",
    departmentColor: DEPARTMENTS.leadership.color,
    model: "Opus 4.6",
    reportsTo: "Tim Harris",
  },
  {
    id: "quant",
    name: "Quant 📊",
    emoji: "📊",
    role: "Trading Strategy Architect",
    department: "trading",
    departmentLabel: "Trading Desk",
    departmentColor: DEPARTMENTS.trading.color,
    model: "Opus 4.6",
    reportsTo: "Henry",
  },
  {
    id: "t1",
    name: "Atlas 📈",
    emoji: "📈",
    role: "Stocks & Options Trader",
    department: "trading",
    departmentLabel: "Trading Desk",
    departmentColor: DEPARTMENTS.trading.color,
    model: "Sonnet 4.6",
    reportsTo: "Henry",
  },
  {
    id: "t2",
    name: "Nimbus 🌤️",
    emoji: "🌤️",
    role: "Weather Prediction Trader",
    department: "trading",
    departmentLabel: "Trading Desk",
    departmentColor: DEPARTMENTS.trading.color,
    model: "Sonnet 4.6",
    reportsTo: "Henry",
  },
  {
    id: "t3",
    name: "Cipher ₿",
    emoji: "₿",
    role: "Crypto Trader",
    department: "trading",
    departmentLabel: "Trading Desk",
    departmentColor: DEPARTMENTS.trading.color,
    model: "Sonnet 4.6",
    reportsTo: "Henry",
  },
  {
    id: "backend",
    name: "Forge 🔧",
    emoji: "🔧",
    role: "Backend Engineer",
    department: "engineering",
    departmentLabel: "Engineering",
    departmentColor: DEPARTMENTS.engineering.color,
    model: "Opus 4.6",
    reportsTo: "Henry",
  },
  {
    id: "fullstack",
    name: "Pixel 💻",
    emoji: "💻",
    role: "Senior Full-Stack Engineer",
    department: "engineering",
    departmentLabel: "Engineering",
    departmentColor: DEPARTMENTS.engineering.color,
    model: "Opus 4.6",
    reportsTo: "Henry",
  },
  {
    id: "scout",
    name: "Scout 🔭",
    emoji: "🔭",
    role: "Research & Intelligence",
    department: "research",
    departmentLabel: "Research",
    departmentColor: DEPARTMENTS.research.color,
    model: "Opus 4.6",
    reportsTo: "Henry",
  },
  {
    id: "quill",
    name: "Quill ✍️",
    emoji: "✍️",
    role: "Creative Writer & Marketing",
    department: "creative_legal",
    departmentLabel: "Creative & Legal",
    departmentColor: DEPARTMENTS.creative_legal.color,
    model: "Sonnet 4.6",
    reportsTo: "Henry",
  },
  {
    id: "counsel",
    name: "Counsel ⚖️",
    emoji: "⚖️",
    role: "Legal Expert",
    department: "creative_legal",
    departmentLabel: "Creative & Legal",
    departmentColor: DEPARTMENTS.creative_legal.color,
    model: "Sonnet 4.6",
    reportsTo: "Henry",
  },
];

const STATUS_CONFIG: Record<
  string,
  { color: string; label: string }
> = {
  ONLINE: { color: "#4ade80", label: "Online" },
  BUILDING: { color: "#f59e0b", label: "Building" },
  ACTIVE: { color: "#60a5fa", label: "Active" },
  "NOT DEPLOYED": { color: "#6b7280", label: "Not Deployed" },
  OFFLINE: { color: "#ef4444", label: "Offline" },
};

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function OrgChartPage() {
  const { statusMap, loading } = useAgentStatus(30_000);
  const [hoveredAgent, setHoveredAgent] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const getDisplayStatus = (agentId: string) => {
    const live = statusMap[agentId];
    return live ? mapToDisplayStatus(live.status) : "NOT DEPLOYED";
  };

  const getModel = (agent: OrgAgent) => {
    const live = statusMap[agent.id];
    if (live?.model) {
      const m = live.model;
      if (m.includes("opus")) return "Opus 4.6";
      if (m.includes("sonnet")) return "Sonnet 4.6";
      if (m.includes("haiku")) return "Haiku 4.5";
      return m;
    }
    return agent.model;
  };

  const deptOrder = ["trading", "engineering", "research", "creative_legal"] as const;
  const grouped = deptOrder.map((deptKey) => ({
    key: deptKey,
    ...DEPARTMENTS[deptKey],
    agents: AGENTS.filter((a) => a.department === deptKey),
  }));

  const henry = AGENTS.find((a) => a.id === "henry")!;
  const henryStatus = getDisplayStatus("henry");
  const henryStatusCfg = STATUS_CONFIG[henryStatus] || STATUS_CONFIG["NOT DEPLOYED"];

  const totalOnline = AGENTS.filter(
    (a) => getDisplayStatus(a.id) === "ONLINE" || getDisplayStatus(a.id) === "ACTIVE"
  ).length;

  return (
    <div style={{ padding: "24px", maxWidth: 1400, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <h1
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 28,
            fontWeight: 700,
            color: "var(--text-primary)",
            margin: 0,
          }}
        >
          Organization Chart
        </h1>
        <p
          style={{
            color: "var(--text-muted)",
            fontSize: 14,
            margin: "4px 0 0",
          }}
        >
          Harris Autonomous — Agent Hierarchy & Reporting Structure
        </p>
        <div
          style={{
            display: "flex",
            gap: 16,
            marginTop: 12,
            alignItems: "center",
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 12px",
              borderRadius: 20,
              backgroundColor: "#4ade8018",
              border: "1px solid #4ade8030",
              color: "#4ade80",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                backgroundColor: "#4ade80",
              }}
            />
            {totalOnline} Agent{totalOnline !== 1 ? "s" : ""} Online
          </span>
          <span
            style={{
              fontSize: 12,
              color: "var(--text-muted)",
            }}
          >
            {AGENTS.length} total agents
          </span>
        </div>
      </div>

      {/* Org Chart Container */}
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 0,
        }}
      >
        {/* ─── CEO Card ───────────────────────────────────── */}
        <div
          style={{
            position: "relative",
            padding: "20px 32px",
            borderRadius: 16,
            background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
            border: "2px solid #eab308",
            boxShadow: "0 0 40px rgba(234, 179, 8, 0.15), 0 8px 32px rgba(0,0,0,0.4)",
            textAlign: "center",
            minWidth: 260,
            transition: "all 300ms ease",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: -1,
              left: "50%",
              transform: "translateX(-50%)",
              padding: "2px 16px",
              borderRadius: "0 0 8px 8px",
              background: "linear-gradient(135deg, #eab308, #f59e0b)",
              fontSize: 10,
              fontWeight: 700,
              color: "#000",
              letterSpacing: "0.05em",
              textTransform: "uppercase",
            }}
          >
            Founder & CEO
          </div>
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: "50%",
              background: "linear-gradient(135deg, #eab30840, #f59e0b20)",
              border: "3px solid #eab308",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 32,
              margin: "8px auto 12px",
              boxShadow: "0 0 20px rgba(234, 179, 8, 0.25)",
            }}
          >
            👤
          </div>
          <div
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: 20,
              fontWeight: 700,
              color: "var(--text-primary)",
            }}
          >
            Tim Harris
          </div>
          <div style={{ fontSize: 12, color: "#eab308", fontWeight: 600, marginTop: 2 }}>
            CEO / Founder
          </div>
          <div
            style={{
              fontSize: 10,
              color: "var(--text-muted)",
              marginTop: 6,
              fontStyle: "italic",
            }}
          >
            Harris Autonomous
          </div>
        </div>

        {/* Connector line */}
        <ConnectorLine height={40} />

        {/* ─── Henry Card ─────────────────────────────────── */}
        <AgentCard
          agent={henry}
          status={henryStatus}
          statusCfg={henryStatusCfg}
          model={getModel(henry)}
          isHighlighted={hoveredAgent === "henry"}
          onHover={setHoveredAgent}
          mounted={mounted}
          isLeader
        />

        {/* Connector + Branch */}
        <ConnectorLine height={32} />
        <BranchLine departments={grouped} />

        {/* ─── Department Groups ─────────────────────────── */}
        <div
          style={{
            display: "flex",
            gap: 16,
            flexWrap: "wrap",
            justifyContent: "center",
            width: "100%",
            marginTop: 16,
          }}
        >
          {grouped.map((dept) => (
            <DepartmentGroup
              key={dept.key}
              department={dept}
              getDisplayStatus={getDisplayStatus}
              getModel={getModel}
              hoveredAgent={hoveredAgent}
              setHoveredAgent={setHoveredAgent}
              mounted={mounted}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Department Group ───────────────────────────────────────────────────────

function DepartmentGroup({
  department,
  getDisplayStatus,
  getModel,
  hoveredAgent,
  setHoveredAgent,
  mounted,
}: {
  department: {
    key: string;
    label: string;
    color: string;
    icon: string;
    agents: OrgAgent[];
  };
  getDisplayStatus: (id: string) => string;
  getModel: (agent: OrgAgent) => string;
  hoveredAgent: string | null;
  setHoveredAgent: (id: string | null) => void;
  mounted: boolean;
}) {
  const { color, label, icon, agents } = department;

  return (
    <div
      style={{
        flex: "1 1 280px",
        maxWidth: 340,
        minWidth: 260,
      }}
    >
      {/* Department Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 14px",
          borderRadius: "10px 10px 0 0",
          background: `linear-gradient(135deg, ${color}25, ${color}10)`,
          borderTop: `2px solid ${color}`,
          borderLeft: `1px solid ${color}30`,
          borderRight: `1px solid ${color}30`,
        }}
      >
        <span style={{ fontSize: 16 }}>{icon}</span>
        <span
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 13,
            fontWeight: 700,
            color,
            letterSpacing: "0.02em",
          }}
        >
          {label}
        </span>
        <span
          style={{
            marginLeft: "auto",
            fontSize: 10,
            color: "var(--text-muted)",
            fontWeight: 500,
          }}
        >
          {agents.length} agent{agents.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Agent Cards */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 1,
          backgroundColor: `${color}08`,
          border: `1px solid ${color}20`,
          borderTop: "none",
          borderRadius: "0 0 10px 10px",
          overflow: "hidden",
        }}
      >
        {agents.map((agent) => {
          const status = getDisplayStatus(agent.id);
          const statusCfg = STATUS_CONFIG[status] || STATUS_CONFIG["NOT DEPLOYED"];
          return (
            <AgentCard
              key={agent.id}
              agent={agent}
              status={status}
              statusCfg={statusCfg}
              model={getModel(agent)}
              isHighlighted={hoveredAgent === agent.id}
              onHover={setHoveredAgent}
              mounted={mounted}
            />
          );
        })}
      </div>
    </div>
  );
}

// ─── Agent Card ─────────────────────────────────────────────────────────────

function AgentCard({
  agent,
  status,
  statusCfg,
  model,
  isHighlighted,
  onHover,
  mounted,
  isLeader,
}: {
  agent: OrgAgent;
  status: string;
  statusCfg: { color: string; label: string };
  model: string;
  isHighlighted: boolean;
  onHover: (id: string | null) => void;
  mounted: boolean;
  isLeader?: boolean;
}) {
  const isLive = status === "ONLINE" || status === "BUILDING" || status === "ACTIVE";
  const color = agent.departmentColor;

  return (
    <div
      onMouseEnter={() => onHover(agent.id)}
      onMouseLeave={() => onHover(null)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: isLeader ? "16px 24px" : "10px 14px",
        backgroundColor: isHighlighted
          ? `${color}18`
          : isLeader
          ? `${color}10`
          : "var(--card)",
        borderRadius: isLeader ? 14 : 0,
        border: isLeader ? `2px solid ${color}60` : "none",
        boxShadow: isLeader
          ? `0 0 30px ${color}20, 0 4px 20px rgba(0,0,0,0.3)`
          : "none",
        cursor: "default",
        transition: "background-color 200ms ease",
        minWidth: isLeader ? 280 : undefined,
      }}
    >
      {/* Avatar */}
      <div style={{ position: "relative", flexShrink: 0 }}>
        <AgentAvatar
          agentId={agent.id}
          size={isLeader ? 52 : 38}
          borderColor={color}
          borderWidth={isLive ? 2 : 1}
        />
        {/* Status dot */}
        <span
          style={{
            position: "absolute",
            bottom: isLeader ? 2 : 0,
            right: isLeader ? 2 : 0,
            width: isLeader ? 12 : 10,
            height: isLeader ? 12 : 10,
            borderRadius: "50%",
            backgroundColor: statusCfg.color,
            border: "2px solid var(--card)",
            boxShadow: isLive ? `0 0 6px ${statusCfg.color}80` : "none",
          }}
        />
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: isLeader ? 16 : 13,
              fontWeight: 700,
              color: "var(--text-primary)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {agent.name}
          </span>
          {/* Model badge */}
          <span
            style={{
              fontSize: 9,
              fontWeight: 600,
              padding: "1px 6px",
              borderRadius: 4,
              backgroundColor:
                model.includes("Opus")
                  ? "#a78bfa20"
                  : model.includes("Sonnet")
                  ? "#60a5fa20"
                  : "#6b728020",
              color:
                model.includes("Opus")
                  ? "#a78bfa"
                  : model.includes("Sonnet")
                  ? "#60a5fa"
                  : "#6b7280",
              border: `1px solid ${
                model.includes("Opus")
                  ? "#a78bfa30"
                  : model.includes("Sonnet")
                  ? "#60a5fa30"
                  : "#6b728030"
              }`,
              whiteSpace: "nowrap",
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.02em",
            }}
          >
            {model}
          </span>
        </div>
        <div
          style={{
            fontSize: isLeader ? 12 : 11,
            color: color,
            fontWeight: 500,
            marginTop: 1,
          }}
        >
          {agent.role}
        </div>
      </div>

      {/* Status label */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: statusCfg.color,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            fontFamily: "var(--font-mono)",
          }}
        >
          {statusCfg.label}
        </span>
      </div>
    </div>
  );
}

// ─── Visual Connectors ──────────────────────────────────────────────────────

function ConnectorLine({ height = 32 }: { height?: number }) {
  return (
    <div
      style={{
        width: 2,
        height,
        background: "linear-gradient(180deg, var(--border-strong), var(--border))",
        borderRadius: 1,
      }}
    />
  );
}

function BranchLine({
  departments,
}: {
  departments: { color: string }[];
}) {
  return (
    <div
      style={{
        width: "70%",
        maxWidth: 800,
        height: 2,
        background: `linear-gradient(90deg, ${departments
          .map((d) => d.color)
          .join(", ")})`,
        borderRadius: 1,
        opacity: 0.5,
      }}
    />
  );
}
