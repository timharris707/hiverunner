"use client";

import { useEffect, useState, useCallback, useRef } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Task {
  id: string;
  title: string;
  status: string;
  priority?: "high" | "medium" | "low" | string;
  assignedAgent?: string;
}

interface Agent {
  id: string;
  name: string;
  emoji: string;
  color: string;
  status: "online" | "offline";
}

type StationId = "backlog" | "research" | "build" | "review" | "ship" | "done";

interface Station {
  id: StationId;
  label: string;
  emoji: string;
  color: string;
  borderColor: string;
  bgGlow: string;
  statusKeys: string[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATIONS: Station[] = [
  {
    id: "backlog",
    label: "Backlog",
    emoji: "📋",
    color: "#1e1e2e",
    borderColor: "#6366f1",
    bgGlow: "rgba(99,102,241,0.08)",
    statusKeys: ["backlog", "todo", "open"],
  },
  {
    id: "research",
    label: "Research",
    emoji: "🔬",
    color: "#1e1e2e",
    borderColor: "#8b5cf6",
    bgGlow: "rgba(139,92,246,0.08)",
    statusKeys: ["research", "planning"],
  },
  {
    id: "build",
    label: "Build",
    emoji: "🏗️",
    color: "#1e1e2e",
    borderColor: "#f59e0b",
    bgGlow: "rgba(245,158,11,0.08)",
    statusKeys: ["in-progress", "in_progress", "active", "building"],
  },
  {
    id: "review",
    label: "Review",
    emoji: "🔍",
    color: "#1e1e2e",
    borderColor: "#06b6d4",
    bgGlow: "rgba(6,182,212,0.08)",
    statusKeys: ["review", "testing", "qa"],
  },
  {
    id: "ship",
    label: "Ship",
    emoji: "✅",
    color: "#1e1e2e",
    borderColor: "#10b981",
    bgGlow: "rgba(16,185,129,0.08)",
    statusKeys: ["done", "complete", "completed", "shipped"],
  },
  {
    id: "done",
    label: "Done",
    emoji: "🎉",
    color: "#1e1e2e",
    borderColor: "#ec4899",
    bgGlow: "rgba(236,72,153,0.08)",
    statusKeys: ["archived", "closed"],
  },
];

const PRIORITY_COLORS: Record<string, string> = {
  high: "#ef4444",
  medium: "#f59e0b",
  low: "#6b7280",
};

function mapTaskToStation(status: string): StationId {
  const s = (status || "").toLowerCase().trim();
  for (const station of STATIONS) {
    if (station.statusKeys.includes(s)) return station.id;
  }
  return "backlog";
}

// ─── Subcomponents ────────────────────────────────────────────────────────────

function AgentSprite({
  agent,
  paused,
  phase,
}: {
  agent: Agent;
  paused: boolean;
  phase: number;
}) {
  const y = paused ? 0 : Math.sin((Date.now() / 800 + phase) * Math.PI) * 3;
  return (
    <div
      title={agent.name}
      style={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "2px",
        cursor: "default",
        userSelect: "none",
      }}
    >
      <span
        style={{
          fontSize: "22px",
          lineHeight: 1,
          display: "block",
          filter: agent.status === "offline" ? "grayscale(0.7) opacity(0.5)" : "none",
          transform: `translateY(${y}px)`,
          transition: paused ? "none" : "transform 0.1s ease",
          animation: paused ? "none" : `bob-${Math.round(phase * 10) % 5} 1.6s ease-in-out infinite`,
        }}
      >
        {agent.emoji}
      </span>
      <span
        style={{
          fontSize: "8px",
          color: "var(--text-muted)",
          fontFamily: "var(--font-mono)",
          maxWidth: "40px",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {agent.name.split(" ")[0]}
      </span>
    </div>
  );
}

function TaskCard({ task }: { task: Task }) {
  const priorityColor = PRIORITY_COLORS[task.priority || ""] ?? PRIORITY_COLORS.low;
  return (
    <div
      title={task.title}
      style={{
        padding: "4px 7px",
        borderRadius: "4px",
        backgroundColor: "var(--surface-elevated, #1a1a2e)",
        border: `1px solid ${priorityColor}44`,
        borderLeft: `3px solid ${priorityColor}`,
        marginBottom: "4px",
        maxWidth: "100%",
      }}
    >
      <div
        style={{
          fontSize: "10px",
          fontFamily: "var(--font-mono)",
          color: "var(--text-secondary)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          lineHeight: 1.3,
        }}
      >
        {task.title}
      </div>
      <div style={{ fontSize: "9px", color: priorityColor, marginTop: "2px", opacity: 0.8 }}>
        {task.priority || ""}
      </div>
    </div>
  );
}

function StationRoom({
  station,
  tasks,
  agents,
  paused,
}: {
  station: Station;
  tasks: Task[];
  agents: Agent[];
  paused: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minWidth: "160px",
        maxWidth: "200px",
        flex: 1,
        borderRadius: "12px",
        border: `1.5px solid ${station.borderColor}66`,
        backgroundColor: station.bgGlow,
        boxShadow: `0 0 20px ${station.borderColor}22, inset 0 0 20px ${station.bgGlow}`,
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* Station header */}
      <div
        style={{
          padding: "8px 10px 6px",
          borderBottom: `1px solid ${station.borderColor}33`,
          backgroundColor: `${station.borderColor}11`,
          display: "flex",
          alignItems: "center",
          gap: "6px",
        }}
      >
        <span style={{ fontSize: "14px" }}>{station.emoji}</span>
        <span
          style={{
            fontSize: "11px",
            fontWeight: 700,
            color: station.borderColor,
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.05em",
            textTransform: "uppercase",
          }}
        >
          {station.label}
        </span>
        <span
          style={{
            marginLeft: "auto",
            fontSize: "10px",
            color: station.borderColor,
            backgroundColor: `${station.borderColor}22`,
            borderRadius: "10px",
            padding: "1px 6px",
            fontFamily: "var(--font-mono)",
          }}
        >
          {tasks.length}
        </span>
      </div>

      {/* Agents row */}
      {agents.length > 0 && (
        <div
          style={{
            padding: "8px 10px 4px",
            display: "flex",
            flexWrap: "wrap",
            gap: "6px",
            borderBottom: `1px solid ${station.borderColor}22`,
          }}
        >
          {agents.map((agent, i) => (
            <AgentSprite key={agent.id} agent={agent} paused={paused} phase={i * 0.7} />
          ))}
        </div>
      )}

      {/* Tasks list */}
      <div
        style={{
          flex: 1,
          padding: "8px",
          overflowY: "auto",
          maxHeight: "200px",
        }}
      >
        {tasks.length === 0 ? (
          <div style={{ fontSize: "10px", color: "var(--text-muted)", textAlign: "center", padding: "12px 0", opacity: 0.5 }}>
            empty
          </div>
        ) : (
          tasks.slice(0, 8).map((task) => <TaskCard key={task.id} task={task} />)
        )}
        {tasks.length > 8 && (
          <div style={{ fontSize: "10px", color: "var(--text-muted)", textAlign: "center", opacity: 0.6 }}>
            +{tasks.length - 8} more
          </div>
        )}
      </div>
    </div>
  );
}

function ConveyorArrow({ color }: { color: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 4px",
        flexShrink: 0,
        alignSelf: "center",
      }}
    >
      <div
        style={{
          width: "32px",
          height: "2px",
          background: `linear-gradient(90deg, ${color}44, ${color})`,
          position: "relative",
          borderRadius: "1px",
        }}
      >
        <div
          style={{
            position: "absolute",
            right: "-1px",
            top: "-4px",
            width: 0,
            height: 0,
            borderLeft: `6px solid ${color}`,
            borderTop: "5px solid transparent",
            borderBottom: "5px solid transparent",
          }}
        />
      </div>
    </div>
  );
}

function BreakRoom({
  agents,
  paused,
}: {
  agents: Agent[];
  paused: boolean;
}) {
  if (agents.length === 0) return null;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        borderRadius: "12px",
        border: "1.5px solid #374151",
        backgroundColor: "rgba(55,65,81,0.1)",
        padding: "8px 10px",
        minWidth: "120px",
        maxWidth: "150px",
        flexShrink: 0,
        alignSelf: "flex-start",
      }}
    >
      <div
        style={{
          fontSize: "10px",
          fontWeight: 700,
          color: "#6b7280",
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          fontFamily: "var(--font-mono)",
          marginBottom: "8px",
          display: "flex",
          alignItems: "center",
          gap: "4px",
        }}
      >
        <span>☕</span> Break Room
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
        {agents.map((agent, i) => (
          <AgentSprite key={agent.id} agent={agent} paused={paused} phase={i * 0.5} />
        ))}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function FactoryFloorPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [paused, setPaused] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [tasksRes, agentsRes] = await Promise.all([
        fetch("/api/tasks"),
        fetch("/api/agents"),
      ]);
      const tasksData = await tasksRes.json();
      const agentsData = await agentsRes.json();
      setTasks(tasksData.tasks ?? []);
      setAgents(agentsData.agents ?? []);
      setLastRefresh(new Date());
    } catch (err) {
      console.error("Factory fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Animation tick for bobbing
  useEffect(() => {
    if (paused) return;
    timerRef.current = setInterval(() => setTick((t) => t + 1), 100);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [paused]);

  // Auto-refresh every 30s
  useEffect(() => {
    const interval = setInterval(fetchData, 30_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Group tasks by station
  const tasksByStation: Record<StationId, Task[]> = {
    backlog: [],
    research: [],
    build: [],
    review: [],
    ship: [],
    done: [],
  };
  for (const task of tasks) {
    const sid = mapTaskToStation(task.status);
    tasksByStation[sid].push(task);
  }

  // Assign agents to stations based on task assignment or random distribution
  const agentsByStation: Record<StationId, Agent[]> = {
    backlog: [],
    research: [],
    build: [],
    review: [],
    ship: [],
    done: [],
  };
  const idleAgents: Agent[] = [];

  for (const agent of agents) {
    // Find if agent is assigned to any in-progress task
    const assignedTask = tasks.find(
      (t) =>
        t.assignedAgent === agent.id &&
        ["in-progress", "in_progress", "active", "building", "review", "testing"].includes(
          (t.status || "").toLowerCase()
        )
    );
    if (assignedTask) {
      const sid = mapTaskToStation(assignedTask.status);
      agentsByStation[sid].push(agent);
    } else if (agent.status === "online") {
      // Online agents with no tasks go to build (active station)
      agentsByStation["build"].push(agent);
    } else {
      idleAgents.push(agent);
    }
  }

  // Stats
  const statsShipped = tasksByStation.ship.length + tasksByStation.done.length;
  const statsInProgress = tasksByStation.build.length + tasksByStation.research.length + tasksByStation.review.length;
  const statsBacklog = tasksByStation.backlog.length;
  const statsBlocked = tasks.filter((t) => (t.status || "").toLowerCase().includes("block")).length;

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "var(--background)" }}>
      {/* CSS animations */}
      <style>{`
        @keyframes bob0 { 0%,100%{transform:translateY(0px)} 50%{transform:translateY(-4px)} }
        @keyframes bob1 { 0%,100%{transform:translateY(-1px)} 50%{transform:translateY(-5px)} }
        @keyframes bob2 { 0%,100%{transform:translateY(-2px)} 50%{transform:translateY(2px)} }
        @keyframes bob3 { 0%,100%{transform:translateY(0px)} 50%{transform:translateY(-3px)} }
        @keyframes bob4 { 0%,100%{transform:translateY(-1px)} 50%{transform:translateY(3px)} }
        @keyframes conveyor-scroll {
          0% { background-position: 0 0; }
          100% { background-position: 40px 0; }
        }
        @keyframes pulse-dot {
          0%,100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>

      {/* Header */}
      <div
        style={{
          padding: "20px 24px 16px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          gap: "16px",
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1
            style={{
              fontSize: "22px",
              fontWeight: 800,
              color: "var(--text-primary)",
              margin: 0,
              fontFamily: "var(--font-mono)",
              letterSpacing: "-0.02em",
            }}
          >
            🏭 Factory Floor
          </h1>
          <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: "2px 0 0", fontFamily: "var(--font-mono)" }}>
            Live pipeline · {tasks.length} tasks · {agents.length} agents
          </p>
        </div>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          {/* Live badge */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "4px 10px",
              borderRadius: "20px",
              backgroundColor: "#052e16",
              border: "1px solid #10b98166",
              fontSize: "11px",
              color: "#10b981",
              fontFamily: "var(--font-mono)",
            }}
          >
            <div
              style={{
                width: "6px",
                height: "6px",
                borderRadius: "50%",
                backgroundColor: "#10b981",
                animation: "pulse-dot 1.5s ease-in-out infinite",
              }}
            />
            Live sync
          </div>

          {/* Refresh */}
          <button
            onClick={fetchData}
            style={{
              padding: "4px 12px",
              borderRadius: "6px",
              border: "1px solid var(--border)",
              backgroundColor: "var(--surface)",
              color: "var(--text-secondary)",
              fontSize: "11px",
              cursor: "pointer",
              fontFamily: "var(--font-mono)",
            }}
          >
            ↺ Refresh
          </button>

          {/* Pause toggle */}
          <button
            onClick={() => setPaused((p) => !p)}
            style={{
              padding: "4px 12px",
              borderRadius: "6px",
              border: `1px solid ${paused ? "#f59e0b66" : "var(--border)"}`,
              backgroundColor: paused ? "#451a03" : "var(--surface)",
              color: paused ? "#f59e0b" : "var(--text-secondary)",
              fontSize: "11px",
              cursor: "pointer",
              fontFamily: "var(--font-mono)",
            }}
          >
            {paused ? "▶ Resume" : "⏸ Pause"}
          </button>
        </div>
      </div>

      {/* Main floor */}
      <div style={{ padding: "20px 24px" }}>
        {loading ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "300px",
              color: "var(--text-muted)",
              fontFamily: "var(--font-mono)",
              fontSize: "14px",
            }}
          >
            ⚙️ Spinning up the factory…
          </div>
        ) : (
          <>
            {/* Pipeline row */}
            <div
              style={{
                display: "flex",
                alignItems: "stretch",
                gap: "0",
                overflowX: "auto",
                paddingBottom: "8px",
              }}
            >
              {/* Break Room */}
              {idleAgents.length > 0 && (
                <>
                  <BreakRoom agents={idleAgents} paused={paused} />
                  <ConveyorArrow color="#6b7280" />
                </>
              )}

              {/* Stations */}
              {STATIONS.map((station, idx) => (
                <div key={station.id} style={{ display: "flex", alignItems: "stretch", flex: idx < STATIONS.length - 1 ? 1 : 1 }}>
                  <StationRoom
                    station={station}
                    tasks={tasksByStation[station.id]}
                    agents={agentsByStation[station.id]}
                    paused={paused}
                  />
                  {idx < STATIONS.length - 1 && (
                    <ConveyorArrow color={STATIONS[idx + 1].borderColor} />
                  )}
                </div>
              ))}
            </div>

            {/* Conveyor belt visual */}
            <div
              style={{
                height: "8px",
                borderRadius: "4px",
                margin: "12px 0",
                backgroundImage:
                  "repeating-linear-gradient(90deg, #374151 0px, #374151 20px, #1f2937 20px, #1f2937 40px)",
                backgroundSize: "40px 8px",
                animation: paused ? "none" : "conveyor-scroll 1s linear infinite",
                opacity: 0.6,
              }}
            />
          </>
        )}

        {/* Stats bar */}
        <div
          style={{
            display: "flex",
            gap: "12px",
            flexWrap: "wrap",
            marginTop: "8px",
          }}
        >
          {[
            { label: "Shipped Today", value: statsShipped, color: "#10b981", icon: "🚀" },
            { label: "In Progress", value: statsInProgress, color: "#f59e0b", icon: "⚡" },
            { label: "Backlog", value: statsBacklog, color: "#6366f1", icon: "📋" },
            ...(statsBlocked > 0
              ? [{ label: "Blocked", value: statsBlocked, color: "#ef4444", icon: "🚫" }]
              : []),
          ].map(({ label, value, color, icon }) => (
            <div
              key={label}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "10px 16px",
                borderRadius: "8px",
                border: `1px solid ${color}33`,
                backgroundColor: `${color}0d`,
                flex: 1,
                minWidth: "140px",
              }}
            >
              <span style={{ fontSize: "18px" }}>{icon}</span>
              <div>
                <div style={{ fontSize: "20px", fontWeight: 800, color, fontFamily: "var(--font-mono)", lineHeight: 1 }}>
                  {value}
                </div>
                <div style={{ fontSize: "10px", color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginTop: "2px" }}>
                  {label}
                </div>
              </div>
            </div>
          ))}

          {lastRefresh && (
            <div
              style={{
                marginLeft: "auto",
                display: "flex",
                alignItems: "center",
                fontSize: "10px",
                color: "var(--text-muted)",
                fontFamily: "var(--font-mono)",
                alignSelf: "center",
              }}
            >
              Last sync: {lastRefresh.toLocaleTimeString()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
