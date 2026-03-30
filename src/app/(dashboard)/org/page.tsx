"use client";

import { useState, useEffect } from "react";
import { AgentAvatar } from "@/components/AgentAvatar";
import { AGENT_CONFIGS, DIVISIONS as DIVISION_META, getDisplayName } from "@/config/agents";
import {
  useAgentStatus,
  mapToDisplayStatus,
  type AgentStatusEntry,
} from "@/hooks/useAgentStatus";

// ─── Types & Data — derived from the central agent registry ────────────────

interface OrgAgent {
  id: string;
  name: string;
  emoji: string;
  role: string;
  department: string;
  departmentColor: string;
  model: string;
  reportsTo: string;
  capabilities: string[];
  cronCount: number;
}

// Derive departments from the central agent registry
const DEPARTMENTS = DIVISION_META;

function formatModelName(model: string): string {
  if (model.includes("opus")) return "Opus 4.6";
  if (model.includes("sonnet")) return "Sonnet 4.6";
  if (model.includes("haiku")) return "Haiku 4.5";
  if (model === "TBD") return "TBD";
  return model;
}

const AGENTS: OrgAgent[] = AGENT_CONFIGS.map((a) => ({
  id: a.id,
  name: getDisplayName(a),
  emoji: a.emoji,
  role: a.role,
  department: a.division,
  departmentColor: a.divisionColor,
  model: formatModelName(a.model),
  reportsTo: getDisplayName(a) === "Henry" ? "Tim Harris" : "Henry",
  capabilities: a.capabilities,
  cronCount: 0,
}));

const STATUS_CONFIG: Record<string, { color: string; bg: string; label: string; dot: string }> = {
  ONLINE: { color: "#4ade80", bg: "#4ade8018", label: "Online", dot: "#4ade80" },
  BUILDING: { color: "#f59e0b", bg: "#f59e0b18", label: "Building", dot: "#f59e0b" },
  ACTIVE: { color: "#60a5fa", bg: "#60a5fa18", label: "Active", dot: "#60a5fa" },
  "NOT DEPLOYED": { color: "#6b7280", bg: "#6b728018", label: "Idle", dot: "#6b7280" },
  OFFLINE: { color: "#ef4444", bg: "#ef444418", label: "Offline", dot: "#ef4444" },
};

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function OrgChartPage() {
  const { statusMap, loading } = useAgentStatus(30_000);
  const [hoveredAgent, setHoveredAgent] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

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

  // Derive department order from the registry, excluding Leadership (Henry is shown separately)
  const deptOrder = (Object.keys(DEPARTMENTS) as (keyof typeof DEPARTMENTS)[]).filter((k) => k !== "Leadership");
  const grouped = deptOrder.map((deptKey) => ({
    key: deptKey,
    ...DEPARTMENTS[deptKey],
    agents: AGENTS.filter((a) => a.department === deptKey),
  }));

  const henry = AGENTS.find((a) => a.id === "henry")!;
  const henryStatus = getDisplayStatus("henry");

  const totalOnline = AGENTS.filter((a) => {
    const s = getDisplayStatus(a.id);
    return s === "ONLINE" || s === "ACTIVE" || s === "BUILDING";
  }).length;

  const totalCrons = AGENTS.reduce((sum, a) => sum + a.cronCount, 0);

  return (
    <div style={{ padding: "24px", maxWidth: 1500, margin: "0 auto" }}>
      {/* ─── Header ─── */}
      <div style={{ marginBottom: 32, display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 26, fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>
            Organization Chart
          </h1>
          <p style={{ color: "var(--text-muted)", fontSize: 13, margin: "4px 0 0" }}>
            Harris Autonomous — Agent Hierarchy &amp; Reporting Structure
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <StatPill value={totalOnline} label="agents active" color="#4ade80" />
          <StatPill value={AGENTS.length} label="total agents" color="#f59e0b" />
          <StatPill value={totalCrons} label="cron jobs" color="#8b5cf6" />
          <StatPill value={grouped.length} label="departments" color="#60a5fa" />
        </div>
      </div>

      {/* ─── Tree Layout ─── */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0 }}>

        {/* CEO */}
        <CeoCard />

        <ConnectorLine height={36} />

        {/* Henry */}
        <HenryCard
          agent={henry}
          status={henryStatus}
          model={getModel(henry)}
          liveEntry={statusMap["henry"]}
          isHighlighted={hoveredAgent === "henry"}
          onHover={setHoveredAgent}
          mounted={mounted}
        />

        <ConnectorLine height={28} />
        <BranchLine depts={grouped} />

        {/* ─── Departments ─── */}
        <div
          style={{
            display: "flex",
            gap: 12,
            flexWrap: "wrap",
            justifyContent: "center",
            width: "100%",
            paddingTop: 0,
          }}
        >
          {grouped.map((dept) => (
            <DepartmentGroup
              key={dept.key}
              department={dept}
              getDisplayStatus={getDisplayStatus}
              getModel={getModel}
              getLiveEntry={(id) => statusMap[id]}
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

// ─── Stat Pill ───────────────────────────────────────────────────────────────

function StatPill({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 12px",
        borderRadius: 20,
        backgroundColor: `${color}15`,
        border: `1px solid ${color}30`,
        color,
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: color, flexShrink: 0 }} />
      {value} {label}
    </span>
  );
}

// ─── CEO Card ────────────────────────────────────────────────────────────────

function CeoCard() {
  return (
    <div
      style={{
        position: "relative",
        padding: "20px 36px",
        borderRadius: 16,
        background: "linear-gradient(135deg, #1c1a12 0%, #18150a 100%)",
        border: "2px solid #eab308",
        boxShadow: "0 0 40px rgba(234,179,8,0.15), 0 8px 32px rgba(0,0,0,0.5)",
        textAlign: "center",
        minWidth: 280,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: -1,
          left: "50%",
          transform: "translateX(-50%)",
          padding: "2px 18px",
          borderRadius: "0 0 8px 8px",
          background: "linear-gradient(135deg, #eab308, #ca8a04)",
          fontSize: 9,
          fontWeight: 800,
          color: "#000",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          whiteSpace: "nowrap",
        }}
      >
        Founder &amp; CEO
      </div>
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: "50%",
          background: "linear-gradient(135deg, #eab30840, #f59e0b20)",
          border: "3px solid #eab308",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 28,
          margin: "10px auto 12px",
          boxShadow: "0 0 20px rgba(234,179,8,0.2)",
        }}
      >
        👤
      </div>
      <div style={{ fontFamily: "var(--font-heading)", fontSize: 18, fontWeight: 700, color: "var(--text-primary)" }}>
        Tim Harris
      </div>
      <div style={{ fontSize: 11, color: "#eab308", fontWeight: 600, marginTop: 2 }}>CEO / Founder</div>
      <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4, fontStyle: "italic" }}>
        Harris Autonomous
      </div>
    </div>
  );
}

// ─── Henry Card ──────────────────────────────────────────────────────────────

function HenryCard({
  agent,
  status,
  model,
  liveEntry,
  isHighlighted,
  onHover,
  mounted,
}: {
  agent: OrgAgent;
  status: string;
  model: string;
  liveEntry?: AgentStatusEntry;
  isHighlighted: boolean;
  onHover: (id: string | null) => void;
  mounted: boolean;
}) {
  const statusCfg = STATUS_CONFIG[status] || STATUS_CONFIG["NOT DEPLOYED"];
  const isLive = status === "ONLINE" || status === "BUILDING" || status === "ACTIVE";
  const color = agent.departmentColor;

  return (
    <div
      onMouseEnter={() => onHover(agent.id)}
      onMouseLeave={() => onHover(null)}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 16,
        padding: "18px 28px",
        borderRadius: 16,
        background: isHighlighted
          ? `linear-gradient(135deg, ${color}20, ${color}0a)`
          : `linear-gradient(135deg, ${color}14, ${color}06)`,
        border: `2px solid ${color}60`,
        boxShadow: isHighlighted
          ? `0 0 40px ${color}30, 0 8px 32px rgba(0,0,0,0.4)`
          : `0 0 24px ${color}15, 0 4px 20px rgba(0,0,0,0.3)`,
        cursor: "default",
        transition: "all 250ms ease",
        minWidth: 420,
        maxWidth: 520,
      }}
    >
      {/* Avatar with status dot */}
      <div style={{ position: "relative", flexShrink: 0 }}>
        <AgentAvatar agentId={agent.id} size={56} borderColor={color} borderWidth={isLive ? 2 : 1} />
        <span
          style={{
            position: "absolute",
            bottom: 2,
            right: 2,
            width: 13,
            height: 13,
            borderRadius: "50%",
            backgroundColor: statusCfg.dot,
            border: "2px solid #111",
            boxShadow: isLive ? `0 0 8px ${statusCfg.dot}` : "none",
          }}
        />
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontFamily: "var(--font-heading)", fontSize: 17, fontWeight: 700, color: "var(--text-primary)" }}>
            {agent.name} {agent.emoji}
          </span>
          <ModelBadge model={model} />
          <StatusBadge cfg={statusCfg} pulse={isLive} />
        </div>
        <div style={{ fontSize: 12, color, fontWeight: 600, marginTop: 2 }}>{agent.role}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 7 }}>
          {agent.capabilities.map((cap) => (
            <CapabilityChip key={cap} label={cap} color={color} />
          ))}
        </div>
        <div style={{ display: "flex", gap: 14, marginTop: 7, alignItems: "center" }}>
          {liveEntry?.lastActivity && mounted ? (
            <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
              Last active: {formatRelativeTime(liveEntry.lastActivity)}
            </span>
          ) : null}
          {liveEntry?.activeSessions ? (
            <span style={{ fontSize: 10, color: color, fontWeight: 600 }}>
              {liveEntry.activeSessions} active session{liveEntry.activeSessions !== 1 ? "s" : ""}
            </span>
          ) : null}
          <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
            {agent.cronCount} cron{agent.cronCount !== 1 ? "s" : ""}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Department Group ─────────────────────────────────────────────────────────

function DepartmentGroup({
  department,
  getDisplayStatus,
  getModel,
  getLiveEntry,
  hoveredAgent,
  setHoveredAgent,
  mounted,
}: {
  department: { key: string; label: string; color: string; icon: string; agents: OrgAgent[] };
  getDisplayStatus: (id: string) => string;
  getModel: (agent: OrgAgent) => string;
  getLiveEntry: (id: string) => AgentStatusEntry | undefined;
  hoveredAgent: string | null;
  setHoveredAgent: (id: string | null) => void;
  mounted: boolean;
}) {
  const { color, label, icon, agents } = department;
  const activeCount = agents.filter((a) => {
    const s = getDisplayStatus(a.id);
    return s === "ONLINE" || s === "ACTIVE" || s === "BUILDING";
  }).length;
  const totalCrons = agents.reduce((sum, a) => sum + a.cronCount, 0);

  return (
    <div style={{ flex: "1 1 260px", maxWidth: 320, minWidth: 240 }}>
      {/* Department Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          padding: "9px 14px",
          borderRadius: "12px 12px 0 0",
          background: `linear-gradient(135deg, ${color}20, ${color}08)`,
          borderTop: `2px solid ${color}`,
          borderLeft: `1px solid ${color}28`,
          borderRight: `1px solid ${color}28`,
        }}
      >
        <span style={{ fontSize: 14 }}>{icon}</span>
        <span style={{ fontFamily: "var(--font-heading)", fontSize: 12, fontWeight: 700, color, letterSpacing: "0.03em" }}>
          {label}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          {activeCount > 0 && (
            <span style={{ fontSize: 9, color: "#4ade80", fontWeight: 700, background: "#4ade8015", padding: "1px 6px", borderRadius: 10, border: "1px solid #4ade8025" }}>
              {activeCount} active
            </span>
          )}
          {totalCrons > 0 && (
            <span style={{ fontSize: 9, color: "#8b5cf6", fontWeight: 600, background: "#8b5cf615", padding: "1px 6px", borderRadius: 10, border: "1px solid #8b5cf625" }}>
              {totalCrons} cron{totalCrons !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>

      {/* Agent Cards */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 1,
          backgroundColor: `${color}06`,
          border: `1px solid ${color}20`,
          borderTop: "none",
          borderRadius: "0 0 12px 12px",
          overflow: "hidden",
        }}
      >
        {agents.map((agent, idx) => {
          const status = getDisplayStatus(agent.id);
          const statusCfg = STATUS_CONFIG[status] || STATUS_CONFIG["NOT DEPLOYED"];
          return (
            <AgentCard
              key={agent.id}
              agent={agent}
              status={status}
              statusCfg={statusCfg}
              model={getModel(agent)}
              liveEntry={getLiveEntry(agent.id)}
              isHighlighted={hoveredAgent === agent.id}
              onHover={setHoveredAgent}
              mounted={mounted}
              isLast={idx === agents.length - 1}
            />
          );
        })}
      </div>
    </div>
  );
}

// ─── Agent Card ───────────────────────────────────────────────────────────────

function AgentCard({
  agent,
  status,
  statusCfg,
  model,
  liveEntry,
  isHighlighted,
  onHover,
  mounted,
  isLast,
}: {
  agent: OrgAgent;
  status: string;
  statusCfg: { color: string; bg: string; label: string; dot: string };
  model: string;
  liveEntry?: AgentStatusEntry;
  isHighlighted: boolean;
  onHover: (id: string | null) => void;
  mounted: boolean;
  isLast?: boolean;
}) {
  const isLive = status === "ONLINE" || status === "BUILDING" || status === "ACTIVE";
  const color = agent.departmentColor;

  return (
    <div
      onMouseEnter={() => onHover(agent.id)}
      onMouseLeave={() => onHover(null)}
      style={{
        display: "flex",
        flexDirection: "column",
        padding: "10px 12px",
        backgroundColor: isHighlighted ? `${color}14` : "transparent",
        borderLeft: `3px solid ${isHighlighted ? color : color + "40"}`,
        borderBottom: isLast ? "none" : "1px solid rgba(255,255,255,0.04)",
        cursor: "default",
        transition: "all 200ms ease",
        gap: 7,
      }}
    >
      {/* Top row: avatar + name + badges */}
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <div style={{ position: "relative", flexShrink: 0 }}>
          <AgentAvatar agentId={agent.id} size={36} borderColor={color} borderWidth={isLive ? 2 : 1} />
          <span
            style={{
              position: "absolute",
              bottom: 0,
              right: 0,
              width: 9,
              height: 9,
              borderRadius: "50%",
              backgroundColor: statusCfg.dot,
              border: "1.5px solid #111",
              boxShadow: isLive ? `0 0 5px ${statusCfg.dot}` : "none",
            }}
          />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
            <span style={{ fontFamily: "var(--font-heading)", fontSize: 13, fontWeight: 700, color: "var(--text-primary)", whiteSpace: "nowrap" }}>
              {agent.name}
            </span>
            <span style={{ fontSize: 11 }}>{agent.emoji}</span>
            <ModelBadge model={model} small />
          </div>
          <div style={{ fontSize: 10, color, fontWeight: 500, marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {agent.role}
          </div>
        </div>
        <StatusBadge cfg={statusCfg} pulse={isLive} small />
      </div>

      {/* Capabilities */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 3, paddingLeft: 45 }}>
        {agent.capabilities.map((cap) => (
          <CapabilityChip key={cap} label={cap} color={color} small />
        ))}
      </div>

      {/* Footer: last active + crons */}
      <div style={{ display: "flex", gap: 10, paddingLeft: 45, alignItems: "center" }}>
        {liveEntry?.lastActivity && mounted ? (
          <span style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
            {formatRelativeTime(liveEntry.lastActivity)}
          </span>
        ) : (
          <span style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
            —
          </span>
        )}
        {agent.cronCount > 0 && (
          <span style={{ fontSize: 9, color: "#8b5cf6", fontWeight: 600, marginLeft: "auto" }}>
            {agent.cronCount} cron{agent.cronCount !== 1 ? "s" : ""}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ModelBadge({ model, small }: { model: string; small?: boolean }) {
  const isOpus = model.includes("Opus");
  const isSonnet = model.includes("Sonnet");
  const color = isOpus ? "#a78bfa" : isSonnet ? "#60a5fa" : "#6b7280";
  return (
    <span
      style={{
        fontSize: small ? 8 : 9,
        fontWeight: 700,
        padding: small ? "1px 5px" : "2px 7px",
        borderRadius: 4,
        backgroundColor: `${color}18`,
        color,
        border: `1px solid ${color}30`,
        fontFamily: "var(--font-mono)",
        letterSpacing: "0.02em",
        whiteSpace: "nowrap",
      }}
    >
      {model}
    </span>
  );
}

function StatusBadge({
  cfg,
  pulse,
  small,
}: {
  cfg: { color: string; bg: string; label: string; dot: string };
  pulse?: boolean;
  small?: boolean;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: small ? "2px 7px" : "3px 9px",
        borderRadius: 20,
        backgroundColor: cfg.bg,
        border: `1px solid ${cfg.color}35`,
        color: cfg.color,
        fontSize: small ? 9 : 10,
        fontWeight: 700,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        fontFamily: "var(--font-mono)",
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      <span
        style={{
          width: small ? 5 : 6,
          height: small ? 5 : 6,
          borderRadius: "50%",
          backgroundColor: cfg.dot,
          boxShadow: pulse ? `0 0 5px ${cfg.dot}` : "none",
          flexShrink: 0,
        }}
      />
      {cfg.label}
    </span>
  );
}

function CapabilityChip({ label, color, small }: { label: string; color: string; small?: boolean }) {
  return (
    <span
      style={{
        fontSize: small ? 8 : 9,
        fontWeight: 500,
        padding: small ? "1px 6px" : "2px 8px",
        borderRadius: 10,
        backgroundColor: `${color}12`,
        color: `${color}cc`,
        border: `1px solid ${color}20`,
        whiteSpace: "nowrap",
        letterSpacing: "0.01em",
      }}
    >
      {label}
    </span>
  );
}

// ─── Visual Connectors ────────────────────────────────────────────────────────

function ConnectorLine({ height = 32 }: { height?: number }) {
  return (
    <div
      style={{
        width: 2,
        height,
        background: "linear-gradient(180deg, rgba(255,255,255,0.15), rgba(255,255,255,0.06))",
        borderRadius: 1,
      }}
    />
  );
}

function BranchLine({ depts }: { depts: { color: string }[] }) {
  return (
    <div
      style={{
        width: "80%",
        maxWidth: 1100,
        height: 2,
        background: `linear-gradient(90deg, ${depts.map((d) => d.color).join(", ")})`,
        borderRadius: 1,
        opacity: 0.35,
        marginBottom: 0,
      }}
    />
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatRelativeTime(ts: number): string {
  const diffMs = Date.now() - ts;
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}
