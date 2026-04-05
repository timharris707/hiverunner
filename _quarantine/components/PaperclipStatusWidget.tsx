"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Blocks, ChevronDown, ChevronUp, RefreshCw, ExternalLink, Circle, Zap, Pause, AlertTriangle } from "lucide-react";

interface RecentIssue {
  id: string;
  identifier: string;
  title: string;
  status: string;
  priority?: string;
  assigneeAgentId?: string | null;
  projectId?: string | null;
  updatedAt: string;
}

interface PaperclipStatus {
  configured: boolean;
  error?: string;
  agentStats?: {
    total: number;
    active: number;
    idle: number;
    paused: number;
  };
  issueCounts?: {
    in_progress: number;
    todo: number;
    blocked: number;
  };
  recentIssues?: RecentIssue[];
  fetchedAt?: string;
}

const STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  in_progress: { color: "#F59E0B", label: "In Progress" },
  todo: { color: "#60A5FA", label: "To Do" },
  blocked: { color: "#F87171", label: "Blocked" },
  done: { color: "#4ade80", label: "Done" },
  backlog: { color: "#6B7280", label: "Backlog" },
  in_review: { color: "#A78BFA", label: "In Review" },
};

const PRIORITY_CONFIG: Record<string, { color: string; label: string }> = {
  critical: { color: "#EF4444", label: "!" },
  high: { color: "#F97316", label: "↑" },
  medium: { color: "#F59E0B", label: "·" },
  low: { color: "#6B7280", label: "↓" },
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function PaperclipStatusWidget() {
  const [status, setStatus] = useState<PaperclipStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    try {
      const res = await fetch("/api/paperclip/status");
      const data = await res.json();
      setStatus(data);
    } catch {
      setStatus({ configured: false, error: "Network error" });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000); // refresh every 30s
    return () => clearInterval(interval);
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    load();
  };

  if (loading) {
    return (
      <div
        style={{
          backgroundColor: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: "12px",
          padding: "1.25rem",
          marginBottom: "1.5rem",
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
        }}
      >
        <Blocks size={18} style={{ color: "#A78BFA", flexShrink: 0 }} />
        <span style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>Loading Paperclip status...</span>
      </div>
    );
  }

  if (!status?.configured) {
    return (
      <div
        style={{
          backgroundColor: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: "12px",
          padding: "1rem 1.25rem",
          marginBottom: "1.5rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
          <Blocks size={16} style={{ color: "#6B7280" }} />
          <span style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>
            Paperclip not configured —{" "}
            <span style={{ color: "var(--text-secondary)" }}>set PAPERCLIP_COMPANY_ID + PAPERCLIP_API_KEY</span>
          </span>
        </div>
        <a
          href="http://localhost:3100"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "#A78BFA", fontSize: "0.75rem", display: "flex", alignItems: "center", gap: "0.25rem" }}
        >
          <ExternalLink size={12} /> Open
        </a>
      </div>
    );
  }

  const { agentStats, issueCounts, recentIssues } = status;
  const totalActive = (issueCounts?.in_progress ?? 0) + (issueCounts?.todo ?? 0) + (issueCounts?.blocked ?? 0);
  const sprintTotal = totalActive + (recentIssues?.filter((i) => i.status === "done").length ?? 0);

  return (
    <div
      style={{
        backgroundColor: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: "12px",
        marginBottom: "1.5rem",
        overflow: "hidden",
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0.875rem 1.25rem",
          borderBottom: expanded ? "1px solid var(--border)" : "none",
          background: "linear-gradient(135deg, var(--card) 0%, color-mix(in srgb, #A78BFA 4%, var(--card)) 100%)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
          <Blocks size={16} style={{ color: "#A78BFA" }} />
          <span
            style={{
              fontSize: "0.875rem",
              fontWeight: 700,
              color: "var(--text-primary)",
              fontFamily: "var(--font-heading)",
              letterSpacing: "-0.3px",
            }}
          >
            Paperclip
          </span>
          <span
            style={{
              fontSize: "0.7rem",
              color: "var(--text-muted)",
              backgroundColor: "var(--surface-elevated)",
              padding: "0.15rem 0.5rem",
              borderRadius: "999px",
              border: "1px solid var(--border)",
            }}
          >
            live
          </span>
        </div>

        {/* Stats summary */}
        <div style={{ display: "flex", alignItems: "center", gap: "1.25rem" }}>
          {/* Agent buckets */}
          {agentStats && (
            <div style={{ display: "flex", items: "center", gap: "0.875rem", display: "flex" }}>
              <AgentStat icon={<Zap size={11} />} value={agentStats.active} label="active" color="#4ade80" />
              <AgentStat icon={<Circle size={11} />} value={agentStats.idle} label="idle" color="#60A5FA" />
              {agentStats.paused > 0 && (
                <AgentStat icon={<Pause size={11} />} value={agentStats.paused} label="paused" color="#9CA3AF" />
              )}
            </div>
          )}

          {/* Issue counts */}
          {issueCounts && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
              <IssueStat value={issueCounts.in_progress} label="active" color="#F59E0B" />
              <IssueStat value={issueCounts.todo} label="todo" color="#60A5FA" />
              {issueCounts.blocked > 0 && (
                <IssueStat value={issueCounts.blocked} label="blocked" color="#F87171" icon={<AlertTriangle size={10} />} />
              )}
            </div>
          )}

          {/* Controls */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
            <button
              onClick={handleRefresh}
              title="Refresh"
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--text-muted)",
                padding: "0.25rem",
                display: "flex",
                alignItems: "center",
                borderRadius: "4px",
              }}
            >
              <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
            </button>
            <a
              href="http://localhost:3100"
              target="_blank"
              rel="noopener noreferrer"
              title="Open Paperclip"
              style={{
                color: "var(--text-muted)",
                padding: "0.25rem",
                display: "flex",
                alignItems: "center",
                borderRadius: "4px",
              }}
            >
              <ExternalLink size={12} />
            </a>
            <button
              onClick={() => setExpanded((e) => !e)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--text-muted)",
                padding: "0.25rem",
                display: "flex",
                alignItems: "center",
                borderRadius: "4px",
              }}
            >
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          </div>
        </div>
      </div>

      {/* Expanded: issue list */}
      {expanded && (
        <div>
          {/* Sprint progress bar */}
          {issueCounts && sprintTotal > 0 && (
            <div style={{ padding: "0.75rem 1.25rem", borderBottom: "1px solid var(--border)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.375rem" }}>
                <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Sprint Progress
                </span>
                <span style={{ fontSize: "0.7rem", color: "var(--text-secondary)" }}>
                  {issueCounts.in_progress} active · {issueCounts.todo} queued · {issueCounts.blocked > 0 ? `${issueCounts.blocked} blocked` : ""}
                </span>
              </div>
              <div
                style={{
                  height: "6px",
                  borderRadius: "3px",
                  backgroundColor: "var(--surface-elevated)",
                  overflow: "hidden",
                  display: "flex",
                  gap: "2px",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${(issueCounts.in_progress / sprintTotal) * 100}%`,
                    backgroundColor: "#F59E0B",
                    transition: "width 0.5s",
                  }}
                />
                <div
                  style={{
                    height: "100%",
                    width: `${(issueCounts.todo / sprintTotal) * 100}%`,
                    backgroundColor: "#3B82F6",
                    opacity: 0.5,
                    transition: "width 0.5s",
                  }}
                />
                {issueCounts.blocked > 0 && (
                  <div
                    style={{
                      height: "100%",
                      width: `${(issueCounts.blocked / sprintTotal) * 100}%`,
                      backgroundColor: "#EF4444",
                      transition: "width 0.5s",
                    }}
                  />
                )}
              </div>
            </div>
          )}

          {/* Recent issues */}
          <div style={{ maxHeight: "320px", overflowY: "auto" }}>
            {!recentIssues || recentIssues.length === 0 ? (
              <div style={{ padding: "1.5rem", textAlign: "center", color: "var(--text-muted)", fontSize: "0.8rem" }}>
                No active issues found
              </div>
            ) : (
              recentIssues.map((issue) => {
                const statusCfg = STATUS_CONFIG[issue.status] || { color: "#6B7280", label: issue.status };
                const priorityCfg = issue.priority ? PRIORITY_CONFIG[issue.priority] : null;
                return (
                  <a
                    key={issue.id}
                    href={`http://localhost:3100`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.625rem",
                      padding: "0.5rem 1.25rem",
                      borderBottom: "1px solid var(--border)",
                      textDecoration: "none",
                      transition: "background 0.15s",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--surface-elevated)")}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                  >
                    {/* Status dot */}
                    <span
                      style={{
                        width: "7px",
                        height: "7px",
                        borderRadius: "50%",
                        backgroundColor: statusCfg.color,
                        flexShrink: 0,
                      }}
                    />

                    {/* Priority */}
                    {priorityCfg && (
                      <span
                        style={{
                          fontSize: "0.7rem",
                          fontWeight: 700,
                          color: priorityCfg.color,
                          flexShrink: 0,
                          width: "10px",
                          textAlign: "center",
                        }}
                      >
                        {priorityCfg.label}
                      </span>
                    )}

                    {/* Identifier */}
                    <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", flexShrink: 0, minWidth: "60px" }}>
                      {issue.identifier}
                    </span>

                    {/* Title */}
                    <span
                      style={{
                        fontSize: "0.8rem",
                        color: "var(--text-secondary)",
                        flex: 1,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {issue.title}
                    </span>

                    {/* Status badge */}
                    <span
                      style={{
                        fontSize: "0.65rem",
                        fontWeight: 600,
                        color: statusCfg.color,
                        backgroundColor: `${statusCfg.color}18`,
                        padding: "0.1rem 0.45rem",
                        borderRadius: "999px",
                        flexShrink: 0,
                      }}
                    >
                      {statusCfg.label}
                    </span>

                    {/* Time */}
                    <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", flexShrink: 0, minWidth: "48px", textAlign: "right" }}>
                      {timeAgo(issue.updatedAt)}
                    </span>
                  </a>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div
            style={{
              padding: "0.5rem 1.25rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
              {status.fetchedAt ? `Updated ${timeAgo(status.fetchedAt)}` : ""}
            </span>
            <Link
              href="/paperclip"
              style={{ fontSize: "0.75rem", color: "#A78BFA", display: "flex", alignItems: "center", gap: "0.25rem" }}
            >
              Open in Paperclip <ExternalLink size={11} />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function AgentStat({
  icon,
  value,
  label,
  color,
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
  color: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
      <span style={{ color, display: "flex", alignItems: "center" }}>{icon}</span>
      <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--text-primary)" }}>{value}</span>
      <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>{label}</span>
    </div>
  );
}

function IssueStat({
  value,
  label,
  color,
  icon,
}: {
  value: number;
  label: string;
  color: string;
  icon?: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
      {icon && <span style={{ color, display: "flex", alignItems: "center" }}>{icon}</span>}
      <span style={{ fontSize: "0.8rem", fontWeight: 700, color }}>{value}</span>
      <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>{label}</span>
    </div>
  );
}
