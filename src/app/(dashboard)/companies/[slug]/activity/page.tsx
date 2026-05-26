"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { formatAge } from "@/components/orchestration/ui";
import { listActivityFeed, listCompanies, listProjects } from "@/lib/orchestration/client";
import type { OrchestrationActivityEvent, OrchestrationCompany, OrchestrationProject } from "@/lib/orchestration/types";
import { P as tokens } from "@/lib/ui/tokens";

/* ─── Palette (from shared tokens) ─── */
const P = {
  text: tokens.text,
  textSec: tokens.textSec,
  muted: tokens.muted,
  cardBorder: tokens.cardBorder,
  card: tokens.surface,
};

/* ─── Stable agent color palette ─── */
const AGENT_COLORS = [
  "#6366f1", // indigo
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#f43f5e", // rose
  "#ef4444", // red
  "#f97316", // orange
  "#a8a6a0", // gray
  "#22c55e", // green
  "#14b8a6", // teal
  "#06b6d4", // cyan
  "#3b82f6", // blue
  "#a855f7", // purple
];

function agentColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  }
  return AGENT_COLORS[Math.abs(hash) % AGENT_COLORS.length];
}

const EVENT_TYPE_OPTIONS = [
  { value: "all", label: "All types" },
  { value: "comment", label: "Comments" },
  { value: "status", label: "Status changes" },
  { value: "assignment", label: "Assignments" },
  { value: "sprint", label: "Sprints" },
  { value: "read", label: "Read marks" },
];

const PAGE_LIMIT = 40;
const API_PAGE_SIZE = 100;
const MAX_FETCHES = 6;

/* ─── Page ─── */
export default function CompanyActivityPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? "";

  const [company, setCompany] = useState<OrchestrationCompany | null>(null);
  const [projects, setProjects] = useState<OrchestrationProject[]>([]);
  const [events, setEvents] = useState<OrchestrationActivityEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [typeFilter, setTypeFilter] = useState("all");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const [companies, projectRows] = await Promise.all([
        listCompanies(),
        listProjects({ company: slug }),
      ]);
      if (cancelled) return;
      const current = companies.find((r) => r.slug === slug) ?? null;
      setCompany(current);
      if (!current) { setLoading(false); return; }

      const companyProjects = projectRows.filter((r) => r.companyId === current.id);
      setProjects(companyProjects);

      const projectSet = new Set(companyProjects.map((p) => p.id));
      const slice = await fetchSlice(slug, projectSet);
      if (cancelled) return;
      setEvents(slice.events);
      setNextCursor(slice.nextCursor);
      setHasMore(slice.hasMore);
      setLoading(false);
    };
    void load();
    return () => { cancelled = true; };
  }, [slug]);

  const handleLoadMore = async () => {
    if (!hasMore || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    const projectSet = new Set(projects.map((p) => p.id));
    const slice = await fetchSlice(slug, projectSet, nextCursor);
    setEvents((prev) => [...prev, ...slice.events]);
    setNextCursor(slice.nextCursor);
    setHasMore(slice.hasMore);
    setLoadingMore(false);
  };

  const filtered = useMemo(() => {
    if (typeFilter === "all") return events;
    return events.filter((e) => {
      if (typeFilter === "comment") return e.eventType === "task.comment_added";
      if (typeFilter === "status") return e.eventType === "task.status_changed";
      if (typeFilter === "assignment") return e.eventType === "task.assigned" || e.eventType === "task.unassigned";
      if (typeFilter === "sprint") return e.eventType.startsWith("sprint.");
      if (typeFilter === "read") return e.eventType === "task.read_marked";
      return true;
    });
  }, [events, typeFilter]);

  if (!loading && !company) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ padding: 16, borderRadius: 8, background: "rgba(239,68,68,0.1)", border: "0.5px solid rgba(239,68,68,0.3)", color: "#fca5a5", fontSize: 13 }}>
          Company not found.
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "16px 20px", color: P.text, fontSize: 13 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <h1 style={{
          margin: 0, fontSize: 17, fontWeight: 600,
          letterSpacing: "-0.01em",
          color: P.text, fontFamily: "var(--font-heading)",
        }}>
          Activity
        </h1>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          style={{
            padding: "6px 12px", borderRadius: 6,
            border: `0.5px solid ${P.cardBorder}`, background: "transparent",
            color: P.textSec, fontSize: 12, outline: "none", cursor: "pointer",
          }}
        >
          {EVENT_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {/* Event list */}
      <div style={{ borderRadius: 8, border: `0.5px solid ${P.cardBorder}` }}>
        {loading ? (
          <div style={{ padding: 32, textAlign: "center" }}>
            <Loader2 size={20} style={{ color: P.muted, animation: "spin 1s linear infinite", margin: "0 auto" }} />
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 32, textAlign: "center", color: P.muted, fontSize: 12 }}>
            No activity events yet.
          </div>
        ) : (
          filtered.map((event, i) => (
            <ActivityRow key={`${event.id}-${event.timestamp}-${i}`} event={event} />
          ))
        )}
      </div>

      {/* Load more */}
      {!loading && hasMore && (
        <div style={{ display: "flex", justifyContent: "center", marginTop: 12 }}>
          <button
            type="button"
            onClick={() => void handleLoadMore()}
            disabled={loadingMore}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "6px 16px", borderRadius: 6, fontSize: 11, fontWeight: 500,
              background: "transparent", border: `0.5px solid ${P.cardBorder}`,
              color: P.textSec, cursor: "pointer", opacity: loadingMore ? 0.5 : 1,
            }}
          >
            {loadingMore && <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} />}
            {loadingMore ? "Loading..." : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}

/* ─── Activity Row ─── */
function ActivityRow({ event }: { event: OrchestrationActivityEvent }) {
  const { initials, agentName, description, color } = parseEventDisplay(event);

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "9px 14px",
      borderBottom: `0.5px solid ${P.cardBorder}`,
    }}>
      {/* Agent avatar circle — neutral treatment */}
      <span style={{
        width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
        background: `color-mix(in srgb, ${color} 14%, var(--surface))`,
        border: `0.5px solid color-mix(in srgb, ${color} 34%, ${P.cardBorder})`,
        display: "grid", placeItems: "center",
        fontSize: 10, fontWeight: 700, color,
        textTransform: "uppercase", letterSpacing: "0.02em",
      }}>
        {initials}
      </span>

      {/* Event description */}
      <span style={{
        flex: 1, fontSize: 13, color: P.textSec, minWidth: 0,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        <span style={{ fontWeight: 600, color: P.text }}>{agentName}</span>
        {" "}
        {description}
      </span>

      {/* Timestamp */}
      <span style={{ fontSize: 12, color: P.muted, flexShrink: 0, whiteSpace: "nowrap" }}>
        {formatAge(event.timestamp)}
      </span>
    </div>
  );
}

/* ─── Parse event into display ─── */
function parseEventDisplay(event: OrchestrationActivityEvent): {
  initials: string;
  agentName: string;
  description: React.ReactNode;
  color: string;
} {
  const agentName = event.agentName || "System";
  const initials = agentName.slice(0, 2).toUpperCase();
  const color = agentColor(agentName);

  // Use real durable task_key (e.g. NEV-25) if available
  const taskKey = event.taskKey || "";

  const taskRef = taskKey && event.taskTitle
    ? <><span style={{ fontWeight: 600, color: P.text }}>{taskKey}</span>{" — "}{event.taskTitle}</>
    : event.taskTitle
      ? <>{event.taskTitle}</>
      : "";

  switch (event.eventType) {
    case "task.read_marked":
      return { initials, agentName, color, description: <>issue read marked {taskRef}</> };
    case "task.comment_added":
      return { initials, agentName, color, description: <>commented on {taskRef}</> };
    case "task.status_changed": {
      const transition = event.oldStatus && event.newStatus
        ? `from ${event.oldStatus} to ${event.newStatus} on `
        : "on ";
      return { initials, agentName, color, description: <>changed status {transition}{taskRef}</> };
    }
    case "task.assigned":
      return { initials, agentName, color, description: <>assigned to {taskRef}</> };
    case "task.unassigned":
      return { initials, agentName, color, description: <>unassigned from {taskRef}</> };
    case "sprint.created":
      return { initials, agentName, color, description: <>created sprint {event.sprintName || ""}</> };
    case "sprint.updated":
      return { initials, agentName, color, description: <>updated sprint {event.sprintName || ""}</> };
    case "sprint.completed":
      return { initials, agentName, color, description: <>completed sprint {event.sprintName || ""}</> };
    default: {
      const msg = event.message || "";
      return { initials, agentName, color, description: <>{msg.replace(new RegExp(`^${agentName}\\s*`, "i"), "")}</> };
    }
  }
}

/* ─── Fetch helper ─── */
async function fetchSlice(
  slug: string,
  projectSet: Set<string>,
  cursor?: string
): Promise<{ events: OrchestrationActivityEvent[]; nextCursor?: string; hasMore: boolean }> {
  let nextCursor = cursor;
  let hasMore = true;
  let fetches = 0;
  let collected: OrchestrationActivityEvent[] = [];

  while (hasMore && collected.length < PAGE_LIMIT && fetches < MAX_FETCHES) {
    const feed = await listActivityFeed({ limit: API_PAGE_SIZE, cursor: nextCursor });
    if (!feed) return { events: collected, nextCursor: undefined, hasMore: false };

    const filtered = feed.activity.filter((e) => {
      if (e.companySlug) return e.companySlug === slug;
      return projectSet.has(e.projectId);
    });
    collected = [...collected, ...filtered];
    nextCursor = feed.page.nextCursor;
    hasMore = feed.page.hasMore && Boolean(nextCursor);
    fetches++;
  }

  return { events: collected.slice(0, PAGE_LIMIT), nextCursor, hasMore };
}
