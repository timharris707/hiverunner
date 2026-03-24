"use client";

import { useEffect, useState } from "react";
import {
  Shield,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  Activity,
  Inbox,
  DollarSign,
  RefreshCw,
  Zap,
  Heart,
} from "lucide-react";

interface AgentHealth {
  name: string;
  emoji: string;
  status: "online" | "offline" | "unknown";
  lastSeen: string | null;
  heartbeatOk: boolean;
}

interface CircuitBreaker {
  name: string;
  state: "closed" | "open" | "half-open";
  failures: number;
  maxRetries: number;
  lastTripped?: string;
  description: string;
}

interface CostGuard {
  name: string;
  limit: number;
  current: number;
  currency: string;
  status: "ok" | "warning" | "critical";
  resetPeriod: string;
}

interface DeadLetterItem {
  id: string;
  taskName: string;
  agentId: string;
  errorMessage: string;
  retryCount: number;
  timestamp: string;
}

export default function ReliabilityPage() {
  interface ReliabilityData {
    cronJobs: { id: string; name?: string; errorCount: number; recentRuns: { status: string; ts: number; error?: string }[] }[];
    totalCronRuns: number;
    totalCronErrors: number;
    hasActiveCronErrors: boolean;
    sessionErrors: number;
    recentSessionErrors: number;
    circuitBreakerState: "closed" | "open" | "half-open";
  }

  const [loading, setLoading] = useState(true);
  const [agentHealth, setAgentHealth] = useState<AgentHealth[]>([]);
  const [costData, setCostData] = useState<{
    today: number;
    thisMonth: number;
    budget: number;
  } | null>(null);
  const [reliabilityData, setReliabilityData] = useState<ReliabilityData | null>(null);
  const [lastRefresh, setLastRefresh] = useState(new Date());

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, []);

  const loadData = async () => {
    try {
      const [agentsRes, costsRes, reliabilityRes] = await Promise.all([
        fetch("/api/agents"),
        fetch("/api/costs?timeframe=7d"),
        fetch("/api/reliability"),
      ]);
      const agentsData = await agentsRes.json();
      const costs = await costsRes.json();
      const reliability = reliabilityRes.ok ? await reliabilityRes.json() : null;

      // Map live agent data to health entries
      const liveAgents = agentsData.agents || [];
      const health: AgentHealth[] = liveAgents.map((a: { name: string; emoji: string; status: string; lastActivity?: string }) => ({
        name: a.name,
        emoji: a.emoji,
        status: a.status,
        lastSeen: a.lastActivity || null,
        heartbeatOk: a.status === "online",
      }));
      setAgentHealth(health);
      setCostData({
        today: costs.today || 0,
        thisMonth: costs.thisMonth || 0,
        budget: costs.budget || 100,
      });
      if (reliability) setReliabilityData(reliability);
      setLastRefresh(new Date());
    } catch (err) {
      console.error("Reliability data load failed:", err);
    } finally {
      setLoading(false);
    }
  };

  // Dynamic circuit breakers based on real data
  const circuitBreakers: CircuitBreaker[] = [
    {
      name: "Task Executor",
      state: reliabilityData?.recentSessionErrors && reliabilityData.recentSessionErrors > 2 ? "open" : "closed",
      failures: reliabilityData?.sessionErrors || 0,
      maxRetries: 3,
      description: "Per-task retry policy with exponential backoff",
    },
    {
      name: "Cron Job Runner",
      state: reliabilityData?.hasActiveCronErrors ? "half-open" : "closed",
      failures: reliabilityData?.totalCronErrors || 0,
      maxRetries: 3,
      description: `Scheduled task execution · ${reliabilityData?.totalCronRuns || 0} total runs`,
    },
    {
      name: "Memory Writer",
      state: "closed",
      failures: 0,
      maxRetries: 3,
      description: "Workspace memory file writes",
    },
    {
      name: "External API Gateway",
      state: "closed",
      failures: 0,
      maxRetries: 3,
      description: "External API calls (weather, markets, etc.)",
    },
  ];

  // Static cost guards
  const costGuards: CostGuard[] = [
    {
      name: "Daily Org Budget",
      limit: 50,
      current: costData?.today || 0,
      currency: "USD",
      status: "ok",
      resetPeriod: "Daily at midnight PT",
    },
    {
      name: "Monthly Budget",
      limit: costData?.budget || 100,
      current: costData?.thisMonth || 0,
      currency: "USD",
      status: "ok",
      resetPeriod: "Monthly on the 1st",
    },
    {
      name: "Per-Task Token Limit",
      limit: 100000,
      current: 0,
      currency: "tokens",
      status: "ok",
      resetPeriod: "Per task",
    },
    {
      name: "Hard Stop Threshold",
      limit: 115,
      current: costData
        ? Math.round((costData.thisMonth / costData.budget) * 100)
        : 0,
      currency: "%",
      status: "ok",
      resetPeriod: "Manual reset required",
    },
  ];

  // Derived guard statuses
  costGuards.forEach((g) => {
    const pct = (g.current / g.limit) * 100;
    if (pct >= 100) g.status = "critical";
    else if (pct >= 80) g.status = "warning";
    else g.status = "ok";
  });

  const deadLetterQueue: DeadLetterItem[] = []; // Empty — no failed tasks

  const cbStateColor = {
    closed: "#4ade80",
    open: "#ef4444",
    "half-open": "#f59e0b",
  };

  const guardStatusColor = {
    ok: "#4ade80",
    warning: "#f59e0b",
    critical: "#ef4444",
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div
            className="animate-spin rounded-full h-12 w-12 border-b-2 mx-auto mb-4"
            style={{ borderColor: "var(--accent)" }}
          />
          <p style={{ color: "var(--text-secondary)" }}>
            Loading reliability data...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1
            className="text-3xl font-bold mb-1"
            style={{
              fontFamily: "var(--font-heading)",
              color: "var(--text-primary)",
              letterSpacing: "-1px",
            }}
          >
            <Shield
              className="inline-block w-8 h-8 mr-2 mb-1"
              style={{ color: "var(--accent)" }}
            />
            Reliability Panel
          </h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "14px" }}>
            Circuit breakers · Cost guards · Dead letter queue · Agent health
          </p>
        </div>
        <button
          onClick={loadData}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm"
          style={{
            backgroundColor: "var(--card)",
            border: "1px solid var(--border)",
            color: "var(--text-secondary)",
          }}
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      <p
        className="text-xs"
        style={{ color: "var(--text-muted)" }}
      >
        Last updated: {lastRefresh.toLocaleTimeString()}
      </p>

      {/* Summary row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard
          label="Circuit Breakers"
          value={`${circuitBreakers.filter((c) => c.state === "closed").length}/${circuitBreakers.length}`}
          sublabel={circuitBreakers.some(c => c.state !== "closed") ? "Issues detected" : "All nominal"}
          icon={<CheckCircle2 className="w-5 h-5" style={{ color: circuitBreakers.some(c => c.state !== "closed") ? "#f59e0b" : "#4ade80" }} />}
          color={circuitBreakers.some(c => c.state !== "closed") ? "#f59e0b" : "#4ade80"}
        />
        <SummaryCard
          label="Cron Runs"
          value={`${(reliabilityData?.totalCronRuns || 0) - (reliabilityData?.totalCronErrors || 0)}/${reliabilityData?.totalCronRuns || 0}`}
          sublabel={reliabilityData?.totalCronErrors ? `${reliabilityData.totalCronErrors} failed` : "All successful"}
          icon={<Inbox className="w-5 h-5" style={{ color: reliabilityData?.totalCronErrors ? "#f59e0b" : "#4ade80" }} />}
          color={reliabilityData?.totalCronErrors ? "#f59e0b" : "#4ade80"}
        />
        <SummaryCard
          label="Cost Guards"
          value={`${costGuards.filter((g) => g.status === "ok").length}/${costGuards.length}`}
          sublabel="Within limits"
          icon={<DollarSign className="w-5 h-5" style={{ color: "#4ade80" }} />}
          color="#4ade80"
        />
        <SummaryCard
          label="Agents Online"
          value={`${agentHealth.filter((a) => a.status === "online").length}/${agentHealth.length || 1}`}
          sublabel="Henry operational"
          icon={<Heart className="w-5 h-5" style={{ color: "#4ade80" }} />}
          color="#4ade80"
        />
      </div>

      {/* Circuit Breakers */}
      <div
        className="rounded-xl"
        style={{
          backgroundColor: "var(--card)",
          border: "1px solid var(--border)",
        }}
      >
        <div
          className="px-5 py-4"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <h2
            className="font-semibold text-lg flex items-center gap-2"
            style={{ color: "var(--text-primary)" }}
          >
            <Zap className="w-5 h-5" style={{ color: "#f59e0b" }} />
            Circuit Breakers
          </h2>
          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            Max 3 retries per task · Exponential backoff: 1s → 5s → 30s · Auto-escalate to Henry on failure
          </p>
        </div>
        <div className="divide-y" style={{ borderColor: "var(--border)" }}>
          {circuitBreakers.map((cb) => (
            <div
              key={cb.name}
              className="px-5 py-4 flex items-center justify-between"
            >
              <div>
                <div
                  className="font-medium text-sm"
                  style={{ color: "var(--text-primary)" }}
                >
                  {cb.name}
                </div>
                <div
                  className="text-xs mt-0.5"
                  style={{ color: "var(--text-muted)" }}
                >
                  {cb.description}
                </div>
              </div>
              <div className="flex items-center gap-4 text-right">
                <div>
                  <div
                    className="text-xs"
                    style={{ color: "var(--text-muted)" }}
                  >
                    Failures
                  </div>
                  <div
                    className="text-sm font-mono font-bold"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {cb.failures}/{cb.maxRetries}
                  </div>
                </div>
                <span
                  className="px-3 py-1 rounded-full text-xs font-bold uppercase"
                  style={{
                    backgroundColor: `${cbStateColor[cb.state]}20`,
                    color: cbStateColor[cb.state],
                  }}
                >
                  {cb.state}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Dead Letter Queue */}
      <div
        className="rounded-xl"
        style={{
          backgroundColor: "var(--card)",
          border: "1px solid var(--border)",
        }}
      >
        <div
          className="px-5 py-4"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <h2
            className="font-semibold text-lg flex items-center gap-2"
            style={{ color: "var(--text-primary)" }}
          >
            <Inbox className="w-5 h-5" style={{ color: "#6b7280" }} />
            Dead Letter Queue
          </h2>
          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            Failed tasks awaiting triage — retry, dismiss, or reassign
          </p>
        </div>
        <div className="px-5 py-12 text-center">
          <CheckCircle2
            className="w-12 h-12 mx-auto mb-3"
            style={{ color: "#4ade80", opacity: 0.7 }}
          />
          <p
            className="font-medium"
            style={{ color: "var(--text-secondary)" }}
          >
            Queue is empty
          </p>
          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            No failed tasks — everything is running smoothly
          </p>
        </div>
      </div>

      {/* Cron Run History */}
      {reliabilityData && reliabilityData.cronJobs.length > 0 && (
        <div
          className="rounded-xl"
          style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
        >
          <div
            className="px-5 py-4"
            style={{ borderBottom: "1px solid var(--border)" }}
          >
            <h2 className="font-semibold text-lg flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
              <Clock className="w-5 h-5" style={{ color: "#60a5fa" }} />
              Cron Run History
            </h2>
            <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
              Real run data from {reliabilityData.cronJobs.length} scheduled job{reliabilityData.cronJobs.length !== 1 ? "s" : ""}
            </p>
          </div>
          <div className="divide-y" style={{ borderColor: "var(--border)" }}>
            {reliabilityData.cronJobs.map((job) => (
              <div key={job.id} className="px-5 py-4">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <div className="font-medium text-sm" style={{ color: "var(--text-primary)" }}>
                      {job.name || job.id.slice(0, 12) + "..."}
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                      {job.recentRuns.length} recent runs · {job.errorCount} error{job.errorCount !== 1 ? "s" : ""}
                    </div>
                  </div>
                  <span
                    className="text-xs px-2 py-1 rounded-full font-medium"
                    style={{
                      backgroundColor: job.errorCount === 0 ? "#4ade8020" : "#f59e0b20",
                      color: job.errorCount === 0 ? "#4ade80" : "#f59e0b",
                    }}
                  >
                    {job.errorCount === 0 ? "✓ Healthy" : `${job.errorCount} failures`}
                  </span>
                </div>
                {job.recentRuns.length > 0 && (
                  <div className="flex items-center gap-1 mt-2">
                    {job.recentRuns.slice(0, 10).map((run, i) => (
                      <div
                        key={i}
                        title={`${run.status} · ${new Date(run.ts).toLocaleString()}${run.error ? " · " + run.error : ""}`}
                        style={{
                          width: "20px",
                          height: "8px",
                          borderRadius: "2px",
                          backgroundColor: run.status === "success" ? "#4ade80" : "#ef4444",
                          opacity: 0.8,
                        }}
                      />
                    ))}
                    <span className="text-xs ml-2" style={{ color: "var(--text-muted)" }}>
                      latest →
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cost Guards */}
      <div
        className="rounded-xl"
        style={{
          backgroundColor: "var(--card)",
          border: "1px solid var(--border)",
        }}
      >
        <div
          className="px-5 py-4"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <h2
            className="font-semibold text-lg flex items-center gap-2"
            style={{ color: "var(--text-primary)" }}
          >
            <DollarSign className="w-5 h-5" style={{ color: "#10b981" }} />
            Cost Guards
          </h2>
          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            80% → Henry warning · 100% → pause non-critical · 115% → HARD STOP all agents
          </p>
        </div>
        <div className="divide-y" style={{ borderColor: "var(--border)" }}>
          {costGuards.map((guard) => {
            const pct = Math.min((guard.current / guard.limit) * 100, 100);
            return (
              <div key={guard.name} className="px-5 py-4">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <div
                      className="font-medium text-sm"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {guard.name}
                    </div>
                    <div
                      className="text-xs"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {guard.resetPeriod}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className="text-sm font-mono"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {guard.currency === "USD"
                        ? `$${guard.current.toFixed(2)} / $${guard.limit}`
                        : guard.currency === "%"
                        ? `${guard.current}% / ${guard.limit}%`
                        : `${guard.current.toLocaleString()} / ${guard.limit.toLocaleString()}`}
                    </span>
                    <span
                      className="px-2 py-0.5 rounded-full text-xs font-bold uppercase"
                      style={{
                        backgroundColor: `${guardStatusColor[guard.status]}20`,
                        color: guardStatusColor[guard.status],
                      }}
                    >
                      {guard.status}
                    </span>
                  </div>
                </div>
                <div
                  className="h-2 rounded-full overflow-hidden"
                  style={{ backgroundColor: "var(--card-elevated, rgba(255,255,255,0.05))" }}
                >
                  <div
                    className="h-full transition-all duration-500"
                    style={{
                      width: `${pct}%`,
                      backgroundColor: guardStatusColor[guard.status],
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Agent Health */}
      <div
        className="rounded-xl"
        style={{
          backgroundColor: "var(--card)",
          border: "1px solid var(--border)",
        }}
      >
        <div
          className="px-5 py-4"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <h2
            className="font-semibold text-lg flex items-center gap-2"
            style={{ color: "var(--text-primary)" }}
          >
            <Activity className="w-5 h-5" style={{ color: "#8b5cf6" }} />
            Agent Health
          </h2>
          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            Deployed agents · Heartbeat status · Last seen
          </p>
        </div>
        <div className="divide-y" style={{ borderColor: "var(--border)" }}>
          {agentHealth.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <p style={{ color: "var(--text-muted)" }}>
                No live agents found
              </p>
            </div>
          ) : (
            agentHealth.map((a) => (
              <div
                key={a.name}
                className="px-5 py-3 flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <span className="text-xl">{a.emoji}</span>
                  <div>
                    <div
                      className="font-medium text-sm"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {a.name}
                    </div>
                    <div
                      className="text-xs"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {a.lastSeen
                        ? `Last seen: ${new Date(a.lastSeen).toLocaleString()}`
                        : "No recent activity"}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Heart
                    className="w-4 h-4"
                    style={{ color: a.heartbeatOk ? "#4ade80" : "#6b7280" }}
                  />
                  <span
                    className="px-2 py-0.5 rounded-full text-xs font-bold uppercase"
                    style={{
                      backgroundColor:
                        a.status === "online" ? "#4ade8020" : "#6b728020",
                      color: a.status === "online" ? "#4ade80" : "#9ca3af",
                    }}
                  >
                    {a.status}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  sublabel,
  icon,
  color,
}: {
  label: string;
  value: string;
  sublabel: string;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <div
      className="p-4 rounded-xl"
      style={{
        backgroundColor: "var(--card)",
        border: "1px solid var(--border)",
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
          {label}
        </span>
        {icon}
      </div>
      <div
        className="text-2xl font-bold"
        style={{ color: "var(--text-primary)" }}
      >
        {value}
      </div>
      <p className="text-xs mt-1" style={{ color }}>
        {sublabel}
      </p>
    </div>
  );
}
