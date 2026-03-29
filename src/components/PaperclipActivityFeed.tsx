"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, AlertTriangle, RefreshCw, ExternalLink } from "lucide-react";

interface FeedEntry {
  type: "completed" | "active" | "blocked";
  id: string;
  identifier: string;
  title: string;
  priority?: string;
  assigneeAgentId?: string | null;
  assigneeName?: string | null;
  timestamp: string;
  isToday: boolean;
}

interface ActivityData {
  configured: boolean;
  error?: string;
  issueCounts?: {
    done: number;
    in_progress: number;
    todo: number;
    blocked: number;
  };
  completedToday?: number;
  sprintPercent?: number;
  workingAgents?: { id: string; name?: string; shortName?: string; currentIssueId?: string | null }[];
  feed?: FeedEntry[];
  fetchedAt?: string;
}

const ENTRY_CONFIG = {
  completed: {
    icon: <CheckCircle2 size={13} />,
    color: "#4ade80",
    label: "Done",
  },
  active: {
    icon: <Loader2 size={13} />,
    color: "#F59E0B",
    label: "Active",
  },
  blocked: {
    icon: <AlertTriangle size={13} />,
    color: "#F87171",
    label: "Blocked",
  },
};

const PRIORITY_SYMBOLS: Record<string, { symbol: string; color: string }> = {
  critical: { symbol: "!", color: "#EF4444" },
  high: { symbol: "↑", color: "#F97316" },
  medium: { symbol: "·", color: "#F59E0B" },
  low: { symbol: "↓", color: "#6B7280" },
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

export function PaperclipActivityFeed() {
  const [data, setData] = useState<ActivityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    try {
      const res = await fetch("/api/paperclip/activity");
      const json = await res.json();
      setData(json);
    } catch {
      setData({ configured: false, error: "Network error" });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    load();
  };

  if (loading) {
    return (
      <div style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)", fontSize: "0.8rem" }}>
        Loading Paperclip activity…
      </div>
    );
  }

  if (!data?.configured) {
    return (
      <div style={{ padding: "1.5rem", textAlign: "center", color: "var(--text-muted)", fontSize: "0.8rem" }}>
        Paperclip not configured
      </div>
    );
  }

  const { issueCounts, completedToday, sprintPercent, feed } = data;

  return (
    <div>
      {/* Metric strip */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <MetricCell
          value={completedToday ?? 0}
          label="done today"
          color="#4ade80"
        />
        <MetricCell
          value={issueCounts?.in_progress ?? 0}
          label="in progress"
          color="#F59E0B"
          border
        />
        <MetricCell
          value={`${sprintPercent ?? 0}%`}
          label="sprint done"
          color="#A78BFA"
          border
        />
      </div>

      {/* Sprint progress bar */}
      {issueCounts && (
        <SprintBar
          done={issueCounts.done}
          inProgress={issueCounts.in_progress}
          todo={issueCounts.todo}
          blocked={issueCounts.blocked}
        />
      )}

      {/* Feed entries */}
      <div style={{ maxHeight: "340px", overflowY: "auto" }}>
        {!feed || feed.length === 0 ? (
          <div style={{ padding: "1.5rem", textAlign: "center", color: "var(--text-muted)", fontSize: "0.8rem" }}>
            No recent activity
          </div>
        ) : (
          feed.map((entry) => <FeedRow key={entry.id} entry={entry} />)
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0.5rem 1rem",
          borderTop: "1px solid var(--border)",
        }}
      >
        <span style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>
          {data.fetchedAt ? `Updated ${timeAgo(data.fetchedAt)}` : ""}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <button
            onClick={handleRefresh}
            title="Refresh"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--text-muted)",
              padding: "0.2rem",
              display: "flex",
              alignItems: "center",
            }}
          >
            <RefreshCw size={11} className={refreshing ? "animate-spin" : ""} />
          </button>
          <a
            href="http://localhost:3100"
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: "0.7rem", color: "#A78BFA", display: "flex", alignItems: "center", gap: "0.2rem" }}
          >
            Paperclip <ExternalLink size={10} />
          </a>
        </div>
      </div>
    </div>
  );
}

function MetricCell({
  value,
  label,
  color,
  border,
}: {
  value: number | string;
  label: string;
  color: string;
  border?: boolean;
}) {
  return (
    <div
      style={{
        padding: "0.875rem 1rem",
        textAlign: "center",
        borderLeft: border ? "1px solid var(--border)" : undefined,
      }}
    >
      <div style={{ fontSize: "1.5rem", fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginTop: "0.25rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </div>
    </div>
  );
}

function SprintBar({
  done,
  inProgress,
  todo,
  blocked,
}: {
  done: number;
  inProgress: number;
  todo: number;
  blocked: number;
}) {
  const total = done + inProgress + todo + blocked;
  if (total === 0) return null;

  return (
    <div
      style={{
        height: "4px",
        display: "flex",
        backgroundColor: "var(--surface-elevated)",
        overflow: "hidden",
      }}
    >
      <div style={{ height: "100%", width: `${(done / total) * 100}%`, backgroundColor: "#4ade80", transition: "width 0.5s" }} />
      <div style={{ height: "100%", width: `${(inProgress / total) * 100}%`, backgroundColor: "#F59E0B", transition: "width 0.5s" }} />
      <div style={{ height: "100%", width: `${(todo / total) * 100}%`, backgroundColor: "#3B82F6", opacity: 0.4, transition: "width 0.5s" }} />
      {blocked > 0 && (
        <div style={{ height: "100%", width: `${(blocked / total) * 100}%`, backgroundColor: "#EF4444", transition: "width 0.5s" }} />
      )}
    </div>
  );
}

function FeedRow({ entry }: { entry: FeedEntry }) {
  const cfg = ENTRY_CONFIG[entry.type];
  const priorityCfg = entry.priority ? PRIORITY_SYMBOLS[entry.priority] : null;
  const isActiveType = entry.type === "active";

  return (
    <a
      href="http://localhost:3100"
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        padding: "0.45rem 1rem",
        borderBottom: "1px solid var(--border)",
        textDecoration: "none",
        transition: "background 0.15s",
        opacity: entry.type === "completed" && !entry.isToday ? 0.65 : 1,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--surface-elevated)")}
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
    >
      {/* Type icon */}
      <span
        style={{
          color: cfg.color,
          display: "flex",
          alignItems: "center",
          flexShrink: 0,
          animation: isActiveType ? undefined : undefined,
        }}
        className={isActiveType ? "animate-spin-slow" : ""}
      >
        {cfg.icon}
      </span>

      {/* Priority */}
      {priorityCfg && (
        <span style={{ fontSize: "0.65rem", fontWeight: 700, color: priorityCfg.color, flexShrink: 0, width: "8px", textAlign: "center" }}>
          {priorityCfg.symbol}
        </span>
      )}

      {/* Identifier */}
      <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", flexShrink: 0, minWidth: "56px" }}>
        {entry.identifier}
      </span>

      {/* Title */}
      <span
        style={{
          fontSize: "0.78rem",
          color: entry.type === "completed" ? "var(--text-muted)" : "var(--text-secondary)",
          flex: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          textDecoration: entry.type === "completed" ? "line-through" : undefined,
          textDecorationColor: "var(--border)",
        }}
      >
        {entry.title}
      </span>

      {/* Assignee */}
      {entry.assigneeName && (
        <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", flexShrink: 0 }}>
          {entry.assigneeName}
        </span>
      )}

      {/* Time */}
      <span style={{ fontSize: "0.62rem", color: "var(--text-muted)", flexShrink: 0, minWidth: "44px", textAlign: "right" }}>
        {timeAgo(entry.timestamp)}
      </span>
    </a>
  );
}
