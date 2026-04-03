"use client";

/**
 * NarrativeFeed — plain-English activity stream.
 * "Pixel picked up auth redesign." not "file_write: src/components/auth.tsx"
 *
 * Polls /api/narrative every 20s. Shows agent avatars and colored type dots.
 */

import { useEffect, useState, useCallback } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  Play,
  Eye,
  CheckCircle2,
  AlertTriangle,
  Hammer,
  XCircle,
  BarChart3,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { AgentAvatar } from "./AgentAvatar";
import type { NarrativeItem } from "@/lib/task-narrative";

const TYPE_CONFIG: Record<
  NarrativeItem["type"],
  {
    icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
    color: string;
    bg: string;
    dot: string;
  }
> = {
  task_started: {
    icon: Play,
    color: "#d97706",
    bg: "#d9770618",
    dot: "#d97706",
  },
  task_review: {
    icon: Eye,
    color: "#d97706",
    bg: "#d9770618",
    dot: "#d97706",
  },
  task_done: {
    icon: CheckCircle2,
    color: "#4ade80",
    bg: "#4ade8018",
    dot: "#4ade80",
  },
  task_blocked: {
    icon: AlertTriangle,
    color: "#f87171",
    bg: "#f8717118",
    dot: "#f87171",
  },
  build_passed: {
    icon: Hammer,
    color: "#4ade80",
    bg: "#4ade8012",
    dot: "#4ade80",
  },
  build_failed: {
    icon: XCircle,
    color: "#f87171",
    bg: "#f8717112",
    dot: "#f87171",
  },
  daily_summary: {
    icon: BarChart3,
    color: "#f59e0b",
    bg: "#f59e0b18",
    dot: "#f59e0b",
  },
  activity: {
    icon: Zap,
    color: "var(--text-muted)",
    bg: "var(--card-elevated)",
    dot: "#6b7280",
  },
};

interface NarrativeFeedProps {
  /** Max items to display (default 8) */
  limit?: number;
  /** Poll interval in ms (default 20_000) */
  pollMs?: number;
  /** Show the daily summary row (default true) */
  showSummary?: boolean;
}

export function NarrativeFeed({
  limit = 8,
  pollMs = 20_000,
  showSummary = true,
}: NarrativeFeedProps) {
  const [items, setItems] = useState<NarrativeItem[] | null>(null);
  const [meta, setMeta] = useState<{ doneToday: number; inProgress: number; blocked: number } | null>(null);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/narrative");
      if (!res.ok) return;
      const data = await res.json();
      const incoming: NarrativeItem[] = data.items ?? [];
      setItems((prev) => {
        if (prev === null) return incoming;
        // Detect truly new items (not previously seen) for highlight animation
        const prevIds = new Set(prev.map((x) => x.id));
        const freshIds = incoming
          .filter((x) => !prevIds.has(x.id))
          .map((x) => x.id);
        if (freshIds.length > 0) {
          setNewIds(new Set(freshIds));
          setTimeout(() => setNewIds(new Set()), 2500);
        }
        return incoming;
      });
      if (data.meta) setMeta(data.meta);
    } catch {
      // Silent — network blip, retry next poll
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, pollMs);
    return () => clearInterval(id);
  }, [load, pollMs]);

  // ── Loading skeleton ────────────────────────────────────────────────────
  if (items === null) {
    return (
      <div className="animate-pulse p-2 space-y-2">
        {[...Array(5)].map((_, i) => (
          <div
            key={i}
            className="h-14 rounded-lg"
            style={{ backgroundColor: "var(--card-elevated)" }}
          />
        ))}
      </div>
    );
  }

  // ── Empty state ─────────────────────────────────────────────────────────
  if (items.filter((x) => x.type !== "daily_summary").length === 0) {
    return (
      <div className="text-center py-10" style={{ color: "var(--text-muted)" }}>
        <Zap className="w-10 h-10 mx-auto mb-3 opacity-40" />
        <p className="text-sm">No activity yet — agents are standing by.</p>
      </div>
    );
  }

  const visible = showSummary ? items.slice(0, limit) : items.filter((x) => x.type !== "daily_summary").slice(0, limit);

  return (
    <div>
      {visible.map((item) => {
        const cfg = TYPE_CONFIG[item.type] ?? TYPE_CONFIG.activity;
        const Icon = cfg.icon;
        const isNew = newIds.has(item.id);
        const isSummary = item.type === "daily_summary";

        return (
          <div
            key={item.id}
            className="flex items-center gap-3 px-4 py-3 transition-all"
            style={{
              borderRadius: "8px",
              backgroundColor: isNew ? `${cfg.dot}12` : "transparent",
              transition: "background-color 0.6s ease",
            }}
            onMouseEnter={(e) => {
              if (!isNew) e.currentTarget.style.backgroundColor = "var(--card-elevated)";
            }}
            onMouseLeave={(e) => {
              if (!isNew) e.currentTarget.style.backgroundColor = "transparent";
            }}
          >
            {/* Avatar or icon */}
            {item.agentId && !isSummary ? (
              <AgentAvatar agentId={item.agentId} size={32} borderWidth={2} className="flex-shrink-0" />
            ) : (
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: cfg.bg }}
              >
                <Icon className="w-3.5 h-3.5" style={{ color: cfg.color }} />
              </div>
            )}

            {/* Narrative text */}
            <div className="flex-1 min-w-0">
              {isSummary ? (
                <p
                  className="text-xs font-semibold"
                  style={{ color: cfg.color }}
                >
                  {item.text}
                </p>
              ) : (
                <NarrativeText text={item.text} type={item.type} taskId={item.taskId} />
              )}
            </div>

            {/* Timestamp */}
            {!isSummary && (
              <time
                className="text-[10px] whitespace-nowrap flex-shrink-0"
                style={{ color: "var(--text-muted)" }}
                title={new Date(item.timestamp).toLocaleString()}
              >
                {formatDistanceToNow(new Date(item.timestamp), { addSuffix: false })}
              </time>
            )}

            {/* New badge */}
            {isNew && (
              <span
                className="text-[9px] font-bold px-1.5 py-0.5 rounded flex-shrink-0"
                style={{ backgroundColor: `${cfg.dot}30`, color: cfg.dot }}
              >
                NEW
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Renders narrative text with the quoted task title bolded.
 * If a taskId is provided, the title becomes a link to /tasks.
 */
function NarrativeText({
  text,
  type,
  taskId,
}: {
  text: string;
  type: NarrativeItem["type"];
  taskId?: string;
}) {
  // Find quoted section: "task title"
  const match = text.match(/^(.*?)"([^"]+)"(.*)$/);

  const cfg = TYPE_CONFIG[type] ?? TYPE_CONFIG.activity;

  if (!match) {
    return (
      <p className="text-sm leading-tight" style={{ color: "var(--text-primary)" }}>
        {text}
      </p>
    );
  }

  const [, before, title, after] = match;

  const titleEl = taskId ? (
    <Link
      href={`/tasks?id=${taskId}`}
      className="font-semibold hover:underline"
      style={{ color: cfg.color }}
    >
      {title}
    </Link>
  ) : (
    <strong className="font-semibold" style={{ color: cfg.color }}>
      {title}
    </strong>
  );

  return (
    <p className="text-sm leading-tight" style={{ color: "var(--text-primary)" }}>
      {before}
      {titleEl}
      {after}
    </p>
  );
}
