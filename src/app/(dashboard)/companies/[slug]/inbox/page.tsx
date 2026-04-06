"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Lightbulb, Search, ShieldAlert, UserPlus, X } from "lucide-react";
import { StatusCircle } from "@/components/orchestration/StatusCircle";

import { CompanyErrorState } from "@/components/company/company-ui";
import { formatAge } from "@/components/orchestration/ui";
import {
  archiveInboxEvents,
  getCompanyInbox,
  listCompanies,
  markAllInboxRead,
  markInboxEventsRead,
  approveApproval,
  rejectApproval,
} from "@/lib/orchestration/client";
import { buildCompanyPath } from "@/lib/orchestration/route-paths";
import type {
  OrchestrationCompany,
  OrchestrationCompanyInboxEvent,
  TaskStatus,
} from "@/lib/orchestration/types";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type TabKey = "recent" | "unread" | "all";
type CategoryFilter = "everything" | "tasks" | "executions" | "approvals";
type ApprovalStatusFilter = "all" | "pending" | "approved" | "rejected" | "revision_requested";

type InboxState = {
  events: OrchestrationCompanyInboxEvent[];
  unreadCount: number;
  nextCursor?: string;
  hasMore: boolean;
};

const EMPTY: InboxState = { events: [], unreadCount: 0, hasMore: false };

/* ------------------------------------------------------------------ */
/*  Event grouping                                                     */
/* ------------------------------------------------------------------ */

/** A group of events sharing the same task/approval, rendered as one row. */
interface EventGroup {
  /** The most recent event — used for display */
  primary: OrchestrationCompanyInboxEvent;
  /** All events in the group (most-recent first) */
  events: OrchestrationCompanyInboxEvent[];
  /** Grouping key */
  groupKey: string;
}

/** Priority of event verbs for picking the "most important" status in a group */
const VERB_PRIORITY: Record<string, number> = {
  failed: 6,
  cancelled: 5,
  completed: 4,
  "revision requested": 3,
  rejected: 3,
  approved: 2,
  requested: 2,
  created: 1,
  commented: 1,
  archived: 1,
  updated: 0,
};

function eventGroupKey(event: OrchestrationCompanyInboxEvent): string {
  if (event.kind === "approval" && event.approvalId) return `approval:${event.approvalId}`;
  if (event.taskKey) return `task:${event.taskKey}`;
  // Ungroupable — use unique id
  return `event:${event.id}`;
}

function groupEvents(events: OrchestrationCompanyInboxEvent[]): EventGroup[] {
  const map = new Map<string, OrchestrationCompanyInboxEvent[]>();
  const order: string[] = [];

  for (const ev of events) {
    const key = eventGroupKey(ev);
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key)!.push(ev);
  }

  const groups: EventGroup[] = [];
  for (const key of order) {
    const evts = map.get(key)!;
    // Events are already sorted most-recent first from the API.
    // Pick the event with the highest-priority verb as primary (tiebreak: most recent).
    let primary = evts[0];
    let bestPriority = VERB_PRIORITY[eventVerb(primary)] ?? 0;
    for (let i = 1; i < evts.length; i++) {
      const p = VERB_PRIORITY[eventVerb(evts[i])] ?? 0;
      if (p > bestPriority) {
        bestPriority = p;
        primary = evts[i];
      }
    }
    // But always keep the most recent timestamp visible, so override timestamp on primary if needed.
    // We'll pass the group's newest timestamp separately via the group object.
    groups.push({ primary, events: evts, groupKey: key });
  }

  return groups;
}

/** Human-readable count badge text */
function groupCountLabel(group: EventGroup): string | null {
  if (group.events.length <= 1) return null;
  // Try to summarise — if all events are comments, say "3 comments"
  const allComments = group.events.every((e) => e.eventType === "task.comment_added");
  if (allComments) return `${group.events.length} comments`;
  return `\u00d7${group.events.length}`;
}

/** Whether any event in the group is unread */
function groupHasUnread(group: EventGroup): boolean {
  return group.events.some((e) => !e.isRead);
}

/** The most recent timestamp in the group */
function groupNewestTimestamp(group: EventGroup): string {
  return group.events[0].timestamp;
}

/* ------------------------------------------------------------------ */
/*  Status indicator                                                   */
/* ------------------------------------------------------------------ */

function StatusDot({ status }: { status?: TaskStatus }) {
  if (!status) {
    return (
      <span
        style={{
          width: 14, height: 14, borderRadius: "999px",
          border: "2px solid #737373", background: "transparent",
          flexShrink: 0, display: "inline-block",
        }}
      />
    );
  }
  return <StatusCircle status={status} size={14} />;
}

/* ------------------------------------------------------------------ */
/*  Event helpers                                                      */
/* ------------------------------------------------------------------ */

function eventVerb(event: OrchestrationCompanyInboxEvent): string {
  switch (event.eventType) {
    case "task.comment_added": return "commented";
    case "task.created": return "created";
    case "task.updated":
    case "task.reordered":
    case "task.status_changed":
    case "task.assigned":
    case "task.unassigned": return "updated";
    case "task.archived": return "archived";
    case "execution.pending":
    case "execution.running": return "updated";
    case "execution.completed": return "completed";
    case "execution.failed": return "failed";
    case "execution.cancelled": return "cancelled";
    case "approval.pending": return "requested";
    case "approval.approved": return "approved";
    case "approval.rejected": return "rejected";
    case "approval.revision_requested": return "revision requested";
    default: return "updated";
  }
}

function eventTargetHref(
  companySlug: string,
  event: OrchestrationCompanyInboxEvent
): string {
  if (event.taskKey) {
    return buildCompanyPath(companySlug, `/tasks/${encodeURIComponent(event.taskKey)}`);
  }
  return buildCompanyPath(companySlug, "");
}

function eventMatchesSearch(event: OrchestrationCompanyInboxEvent, query: string): boolean {
  const q = query.toLowerCase();
  if (event.taskKey?.toLowerCase().includes(q)) return true;
  if (event.taskTitle?.toLowerCase().includes(q)) return true;
  if (event.message?.toLowerCase().includes(q)) return true;
  if (event.approvalLabel?.toLowerCase().includes(q)) return true;
  if (event.agentName?.toLowerCase().includes(q)) return true;
  if (event.requestedByName?.toLowerCase().includes(q)) return true;
  return false;
}

function eventMatchesCategory(event: OrchestrationCompanyInboxEvent, category: CategoryFilter): boolean {
  if (category === "everything") return true;
  return event.kind === category.replace(/s$/, "") as OrchestrationCompanyInboxEvent["kind"];
}

/* ------------------------------------------------------------------ */
/*  Time dividers                                                      */
/* ------------------------------------------------------------------ */

function isToday(dateStr: string): boolean {
  const date = new Date(dateStr);
  const now = new Date();
  return date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
}

function TimeDivider({ label }: { label: string }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: "12px 4px 4px",
    }}>
      <div style={{ flex: 1, height: 1, background: "rgba(120,113,108,0.15)" }} />
      <span style={{
        fontSize: 10, fontWeight: 600, letterSpacing: "0.08em",
        textTransform: "uppercase", color: "#78716c", flexShrink: 0,
      }}>
        {label}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Dropdown                                                           */
/* ------------------------------------------------------------------ */

function FilterDropdown({ value, options, onChange }: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "5px 10px", fontSize: 12, fontWeight: 500,
          borderRadius: 6, border: "1px solid rgba(120,113,108,0.25)",
          background: "transparent", color: "#a8a29e", cursor: "pointer",
        }}
      >
        {selected?.label ?? value}
        <ChevronDown size={12} />
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "100%", left: 0, marginTop: 4,
          minWidth: 160, borderRadius: 8,
          border: "1px solid rgba(120,113,108,0.2)",
          background: "#1c1917", boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
          zIndex: 50, overflow: "hidden",
        }}>
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { onChange(opt.value); setOpen(false); }}
              style={{
                display: "block", width: "100%", textAlign: "left",
                padding: "7px 12px", fontSize: 12,
                color: opt.value === value ? "#f5f5f4" : "#a8a29e",
                background: opt.value === value ? "rgba(255,255,255,0.05)" : "transparent",
                border: "none", cursor: "pointer",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = opt.value === value ? "rgba(255,255,255,0.05)" : "transparent"; }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function CompanyInboxPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? "";

  const [company, setCompany] = useState<OrchestrationCompany | null>(null);
  const [inbox, setInbox] = useState<InboxState>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("recent");
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("everything");
  const [approvalStatusFilter, setApprovalStatusFilter] = useState<ApprovalStatusFilter>("all");
  /* ---- Data loading ---- */
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [companyRows, inboxData] = await Promise.all([
        listCompanies(),
        getCompanyInbox({
          companySlug: slug,
          includeDone: true,
          includeTaskSnapshot: false,
          limit: 100,
        }),
      ]);
      const current = companyRows.find((row) => row.slug === slug) ?? null;
      setCompany(current);
      if (!current || !inboxData) { setInbox(EMPTY); return; }
      setInbox({
        events: inboxData.events,
        unreadCount: inboxData.unreadCount,
        nextCursor: inboxData.page.nextCursor,
        hasMore: inboxData.page.hasMore,
      });
    } catch {
      setError("Unable to load inbox.");
      setInbox(EMPTY);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => { void load(); }, [load]);

  /* ---- Load more ---- */
  const loadMore = async () => {
    if (!inbox.hasMore || !inbox.nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await getCompanyInbox({
        companySlug: slug,
        includeDone: true,
        includeTaskSnapshot: false,
        limit: 100,
        cursor: inbox.nextCursor,
      });
      if (!next) return;
      setInbox((prev) => ({
        ...prev,
        events: prev.events.concat(next.events),
        nextCursor: next.page.nextCursor,
        hasMore: next.page.hasMore,
      }));
    } finally {
      setLoadingMore(false);
    }
  };

  /* ---- Mark read ---- */
  const handleMarkAllRead = async () => {
    const ok = await markAllInboxRead(slug);
    if (ok) {
      setInbox((prev) => ({
        ...prev,
        events: prev.events.map((e) => ({ ...e, isRead: true })),
        unreadCount: 0,
      }));
    }
  };

  const handleMarkRead = async (eventId: string) => {
    const ok = await markInboxEventsRead(slug, [eventId]);
    if (ok) {
      setInbox((prev) => ({
        ...prev,
        events: prev.events.map((e) =>
          e.id === eventId ? { ...e, isRead: true } : e
        ),
        unreadCount: Math.max(0, prev.unreadCount - 1),
      }));
    }
  };

  /** Mark all events in a group as read */
  const handleMarkGroupRead = async (group: EventGroup) => {
    const unreadIds = group.events.filter((e) => !e.isRead).map((e) => e.id);
    if (unreadIds.length === 0) return;
    const ok = await markInboxEventsRead(slug, unreadIds);
    if (ok) {
      const idSet = new Set(unreadIds);
      setInbox((prev) => ({
        ...prev,
        events: prev.events.map((e) =>
          idSet.has(e.id) ? { ...e, isRead: true } : e
        ),
        unreadCount: Math.max(0, prev.unreadCount - unreadIds.length),
      }));
    }
  };

  /* ---- Dismiss / archive ---- */
  const handleDismiss = async (group: EventGroup) => {
    const eventIds = group.events.map((ev) => ev.id);
    await archiveInboxEvents(slug, eventIds);
    void load();
  };

  /* ---- Filtering ---- */
  const filteredEvents = useMemo(() => {
    let items = inbox.events;

    // Tab filter
    if (activeTab === "unread") {
      items = items.filter((e) => !e.isRead);
    } else if (activeTab === "recent") {
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      items = items.filter((e) => new Date(e.timestamp).getTime() > sevenDaysAgo);
    }

    // Category filter (only on "all" tab)
    if (activeTab === "all" && categoryFilter !== "everything") {
      items = items.filter((e) => eventMatchesCategory(e, categoryFilter));
    }

    // Approval status filter (only on "all" tab)
    if (activeTab === "all" && approvalStatusFilter !== "all") {
      items = items.filter((e) => {
        if (e.kind !== "approval") return true; // non-approval events pass through
        return e.approvalStatus === approvalStatusFilter;
      });
    }

    // Search filter
    if (searchQuery.trim()) {
      items = items.filter((e) => eventMatchesSearch(e, searchQuery.trim()));
    }

    return items;
  }, [inbox.events, activeTab, searchQuery, categoryFilter, approvalStatusFilter]);

  /* ---- Group events ---- */
  const groupedEvents = useMemo(() => groupEvents(filteredEvents), [filteredEvents]);

  /* ---- Time-grouped rendering ---- */
  const { todayGroups, earlierGroups } = useMemo(() => {
    const today: EventGroup[] = [];
    const earlier: EventGroup[] = [];
    for (const group of groupedEvents) {
      const newestTs = groupNewestTimestamp(group);
      if (isToday(newestTs)) {
        today.push(group);
      } else {
        earlier.push(group);
      }
    }
    return { todayGroups: today, earlierGroups: earlier };
  }, [groupedEvents]);

  /* ---- Render guards ---- */
  if (!loading && !company) {
    return (
      <CompanyErrorState
        title="Company not found"
        detail="This company could not be resolved from orchestration data."
        href="/companies"
      />
    );
  }

  const TABS: { key: TabKey; label: string }[] = [
    { key: "recent", label: "Recent" },
    { key: "unread", label: "Unread" },
    { key: "all", label: "All" },
  ];

  const CATEGORY_OPTIONS = [
    { value: "everything", label: "All categories" },
    { value: "tasks", label: "Tasks" },
    { value: "executions", label: "Executions" },
    { value: "approvals", label: "Approvals" },
  ];

  const APPROVAL_STATUS_OPTIONS = [
    { value: "all", label: "All approval statuses" },
    { value: "pending", label: "Pending" },
    { value: "approved", label: "Approved" },
    { value: "rejected", label: "Rejected" },
    { value: "revision_requested", label: "Revision requested" },
  ];

  return (
    <div style={{ padding: "24px 32px" }}>
      {/* Header */}
      <p style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.18em", fontWeight: 600, color: "#78716c", marginBottom: "16px" }}>
        Inbox
      </p>

      {/* Toolbar: tabs left, search + actions right */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 0 }}>
        {/* Tabs */}
        <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                padding: "6px 12px",
                fontSize: "14px",
                fontWeight: activeTab === tab.key ? 600 : 400,
                color: activeTab === tab.key ? "#f5f5f4" : "#78716c",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                transition: "color 150ms",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Right side: search + mark all read */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* Search */}
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "5px 10px", borderRadius: 6,
            border: "1px solid rgba(120,113,108,0.2)",
            background: "rgba(255,255,255,0.02)",
          }}>
            <Search size={13} color="#78716c" />
            <input
              type="text"
              placeholder="Search inbox..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                border: "none", background: "transparent", outline: "none",
                fontSize: 12, color: "#d6d3d1", width: 140,
              }}
            />
          </div>

          {/* Mark all as read */}
          <button
            type="button"
            onClick={() => void handleMarkAllRead()}
            disabled={inbox.unreadCount === 0}
            style={{
              padding: "6px 14px",
              fontSize: "13px",
              fontWeight: 500,
              borderRadius: 6,
              border: "1px solid rgba(120,113,108,0.3)",
              background: "transparent",
              color: inbox.unreadCount > 0 ? "#d6d3d1" : "#57534e",
              cursor: inbox.unreadCount > 0 ? "pointer" : "default",
              opacity: inbox.unreadCount > 0 ? 1 : 0.5,
            }}
          >
            Mark all as read
          </button>
        </div>
      </div>

      {/* Category + approval status filters — visible on "All" tab */}
      {activeTab === "all" && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
          <FilterDropdown
            value={categoryFilter}
            options={CATEGORY_OPTIONS}
            onChange={(v) => setCategoryFilter(v as CategoryFilter)}
          />
          <FilterDropdown
            value={approvalStatusFilter}
            options={APPROVAL_STATUS_OPTIONS}
            onChange={(v) => setApprovalStatusFilter(v as ApprovalStatusFilter)}
          />
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ padding: "12px 16px", margin: "12px 0", borderRadius: 8, border: "1px solid #7f1d1d", background: "rgba(127,29,29,0.15)", fontSize: 13, color: "#fca5a5" }}>
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ padding: "48px 0", textAlign: "center", fontSize: 13, color: "#78716c" }}>
          Loading inbox...
        </div>
      )}

      {/* Empty state */}
      {!loading && groupedEvents.length === 0 && !error && (
        <div style={{ padding: "48px 0", textAlign: "center" }}>
          <p style={{ fontSize: 14, color: "#a8a29e", marginBottom: 4 }}>
            {activeTab === "unread" ? "All caught up!" : searchQuery ? "No matching events." : "No activity yet."}
          </p>
          <p style={{ fontSize: 12, color: "#78716c" }}>
            {activeTab === "unread"
              ? "You have no unread notifications."
              : searchQuery
              ? "Try a different search term."
              : "Events from tasks and executions will appear here."}
          </p>
        </div>
      )}

      {/* Event list */}
      {!loading && groupedEvents.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", marginTop: 4 }}>
          {/* Today section */}
          {todayGroups.length > 0 && todayGroups.map((group) => (
            <GroupRow
              key={group.groupKey}
              group={group}
              company={company}
              slug={slug}
              onMarkRead={handleMarkRead}
              onMarkGroupRead={handleMarkGroupRead}
              onRefresh={load}
              onDismiss={handleDismiss}
            />
          ))}

          {/* Earlier divider */}
          {earlierGroups.length > 0 && todayGroups.length > 0 && (
            <TimeDivider label="Earlier" />
          )}

          {/* Earlier section */}
          {earlierGroups.map((group) => (
            <GroupRow
              key={group.groupKey}
              group={group}
              company={company}
              slug={slug}
              onMarkRead={handleMarkRead}
              onMarkGroupRead={handleMarkGroupRead}
              onRefresh={load}
              onDismiss={handleDismiss}
            />
          ))}

          {/* Load more */}
          {inbox.hasMore && (
            <div style={{ display: "flex", justifyContent: "center", padding: "16px 0" }}>
              <button
                type="button"
                onClick={() => void loadMore()}
                disabled={loadingMore}
                style={{
                  padding: "8px 20px",
                  fontSize: 12,
                  fontWeight: 500,
                  borderRadius: 6,
                  border: "1px solid rgba(120,113,108,0.3)",
                  background: "transparent",
                  color: "#d6d3d1",
                  cursor: "pointer",
                  opacity: loadingMore ? 0.5 : 1,
                }}
              >
                {loadingMore ? "Loading..." : "Load more"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Group row — dispatches to approval or task row                     */
/* ------------------------------------------------------------------ */

function GroupRow({
  group, company, slug, onMarkRead, onMarkGroupRead, onRefresh, onDismiss,
}: {
  group: EventGroup;
  company: OrchestrationCompany | null;
  slug: string;
  onMarkRead: (id: string) => void;
  onMarkGroupRead: (group: EventGroup) => void;
  onRefresh: () => void;
  onDismiss: (group: EventGroup) => void;
}) {
  const event = group.primary;

  if (event.kind === "approval") {
    return (
      <ApprovalRow
        group={group}
        event={event}
        onMarkRead={onMarkRead}
        onMarkGroupRead={onMarkGroupRead}
        onRefresh={onRefresh}
        onDismiss={onDismiss}
        companySlug={company?.code ?? slug}
      />
    );
  }

  return (
    <TaskEventRow
      group={group}
      event={event}
      company={company}
      slug={slug}
      onMarkRead={onMarkRead}
      onMarkGroupRead={onMarkGroupRead}
      onDismiss={onDismiss}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Task / execution event row                                         */
/* ------------------------------------------------------------------ */

function TaskEventRow({
  group, event, company, slug, onMarkRead, onMarkGroupRead, onDismiss,
}: {
  group: EventGroup;
  event: OrchestrationCompanyInboxEvent;
  company: OrchestrationCompany | null;
  slug: string;
  onMarkRead: (id: string) => void;
  onMarkGroupRead: (group: EventGroup) => void;
  onDismiss: (group: EventGroup) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const isUnread = groupHasUnread(group);
  const href = eventTargetHref(company?.slug ?? slug, event);
  const verb = eventVerb(event);
  const newestTimestamp = groupNewestTimestamp(group);
  const age = formatAge(newestTimestamp);
  const taskKey = event.taskKey ?? null;
  const isFailed = event.eventType === "execution.failed";
  const badge = groupCountLabel(group);

  return (
    <div
      style={{ position: "relative" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Link
        href={href}
        onClick={() => {
          if (isUnread) {
            if (group.events.length === 1) void onMarkRead(event.id);
            else void onMarkGroupRead(group);
          }
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "9px 4px",
          paddingRight: 30, // leave room for dismiss button
          borderBottom: "1px solid rgba(120,113,108,0.08)",
          textDecoration: "none",
          transition: "background 100ms",
          background: hovered ? "rgba(255,255,255,0.025)" : "transparent",
        }}
      >
        {/* Unread dot */}
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: isUnread ? "#3b82f6" : "transparent", flexShrink: 0 }} />

        {/* Status icon */}
        <StatusDot status={event.status} />

        {/* Task key */}
        {taskKey ? (
          <span style={{ fontSize: 12, color: "#78716c", flexShrink: 0, fontFamily: "var(--font-mono, monospace)" }}>
            {taskKey}
          </span>
        ) : null}

        {/* Title */}
        <span
          style={{
            fontSize: 13,
            color: isFailed ? "#fca5a5" : isUnread ? "#f5f5f4" : "#d6d3d1",
            fontWeight: isUnread ? 500 : 400,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
            minWidth: 0,
          }}
        >
          {event.taskTitle ?? event.message}
        </span>

        {/* Count badge */}
        {badge && (
          <span style={{
            fontSize: 11,
            fontWeight: 600,
            color: "#a8a29e",
            background: "rgba(120,113,108,0.15)",
            borderRadius: 10,
            padding: "1px 7px",
            flexShrink: 0,
            whiteSpace: "nowrap",
          }}>
            {badge}
          </span>
        )}

        {/* Trailing: verb + time */}
        <span style={{ fontSize: 12, color: isFailed ? "#f87171" : "#57534e", flexShrink: 0, whiteSpace: "nowrap" }}>
          {verb} {age} ago
        </span>
      </Link>

      {/* Dismiss button */}
      {hovered && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); e.preventDefault(); onDismiss(group); }}
          title="Dismiss"
          style={{
            position: "absolute",
            right: 4,
            top: "50%",
            transform: "translateY(-50%)",
            width: 22,
            height: 22,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 4,
            border: "none",
            background: "rgba(120,113,108,0.15)",
            color: "#78716c",
            cursor: "pointer",
            transition: "all 100ms",
            zIndex: 2,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(120,113,108,0.3)"; e.currentTarget.style.color = "#d6d3d1"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(120,113,108,0.15)"; e.currentTarget.style.color = "#78716c"; }}
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Approval row — matches Paperclip's nested approval rendering       */
/* ------------------------------------------------------------------ */

function ApprovalRow({
  group,
  event,
  onMarkRead,
  onMarkGroupRead,
  onRefresh,
  onDismiss,
  companySlug,
}: {
  group: EventGroup;
  event: OrchestrationCompanyInboxEvent;
  onMarkRead: (id: string) => void;
  onMarkGroupRead: (group: EventGroup) => void;
  onRefresh: () => void;
  onDismiss: (group: EventGroup) => void;
  companySlug: string;
}) {
  const router = useRouter();
  const [acting, setActing] = useState(false);
  const [hovered, setHovered] = useState(false);
  const isUnread = groupHasUnread(group);
  const newestTimestamp = groupNewestTimestamp(group);
  const age = formatAge(newestTimestamp);
  const label = event.approvalLabel ?? event.message;
  const status = event.approvalStatus ?? "pending";
  const requester = event.requestedByName ?? event.agentName;
  const isPending = status === "pending";
  const isRevisionRequested = status === "revision_requested";
  const showInlineActions = isPending || isRevisionRequested;
  const approvalId = event.approvalId;
  const approvalType = event.approvalType ?? "hire_agent";
  const badge = groupCountLabel(group);

  const handleApprove = async () => {
    if (!approvalId || acting) return;
    setActing(true);
    await approveApproval(approvalId);
    if (isUnread) await markInboxEventsRead("", group.events.filter((e) => !e.isRead).map((e) => e.id)).catch(() => {});
    onRefresh();
    setActing(false);
  };

  const handleReject = async () => {
    if (!approvalId || acting) return;
    setActing(true);
    await rejectApproval(approvalId);
    if (isUnread) await markInboxEventsRead("", group.events.filter((e) => !e.isRead).map((e) => e.id)).catch(() => {});
    onRefresh();
    setActing(false);
  };

  return (
    <div
      style={{
        position: "relative",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
          padding: "10px 4px 10px 28px",
          paddingRight: 30,
          borderBottom: "1px solid rgba(120,113,108,0.08)",
          transition: "background 100ms",
          cursor: "default",
          background: hovered ? "rgba(255,255,255,0.025)" : "transparent",
        }}
        onClick={() => {
          if (isUnread) {
            if (group.events.length === 1) void onMarkRead(event.id);
            else void onMarkGroupRead(group);
          }
          if (event.approvalId) router.push(`/${companySlug}/approvals/${event.approvalId}`);
        }}
      >
        {/* Approval icon — type-specific */}
        <div style={{ width: 28, height: 28, borderRadius: "50%", background: "rgba(120,113,108,0.15)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>
          {approvalType === "approve_ceo_strategy" ? <Lightbulb size={14} color="#78716c" /> :
           approvalType === "budget_override_required" ? <ShieldAlert size={14} color="#78716c" /> :
           <UserPlus size={14} color="#78716c" />}
        </div>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: isUnread ? 500 : 400, color: isUnread ? "#f5f5f4" : "#d6d3d1", cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
            {badge && (
              <span style={{
                fontSize: 11,
                fontWeight: 600,
                color: "#a8a29e",
                background: "rgba(120,113,108,0.15)",
                borderRadius: 10,
                padding: "1px 7px",
                flexShrink: 0,
                whiteSpace: "nowrap",
              }}>
                {badge}
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: "#78716c", marginTop: 2, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{
              textTransform: "capitalize",
              color: status === "approved" ? "#22c55e" : status === "rejected" ? "#ef4444" : status === "revision_requested" ? "#a855f7" : status === "pending" ? "#f59e0b" : "#78716c",
            }}>{status.replace(/_/g, " ")}</span>
            {requester ? <span>requested by {requester}</span> : null}
            <span>updated {age} ago</span>
          </div>
        </div>

        {/* Inline approve/reject buttons for actionable approvals */}
        {showInlineActions && approvalId && approvalType !== "budget_override_required" ? (
          <div style={{ display: "flex", gap: 6, flexShrink: 0, alignItems: "center" }}>
            <button
              type="button"
              disabled={acting}
              onClick={(e) => { e.stopPropagation(); void handleApprove(); }}
              style={{
                padding: "4px 12px",
                fontSize: 12,
                fontWeight: 500,
                borderRadius: 6,
                border: "1px solid rgba(34,197,94,0.4)",
                background: "rgba(34,197,94,0.1)",
                color: "#4ade80",
                cursor: acting ? "wait" : "pointer",
                opacity: acting ? 0.5 : 1,
                transition: "all 120ms ease",
              }}
              onMouseEnter={(e) => { if (!acting) { e.currentTarget.style.background = "rgba(34,197,94,0.2)"; e.currentTarget.style.borderColor = "rgba(34,197,94,0.6)"; } }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(34,197,94,0.1)"; e.currentTarget.style.borderColor = "rgba(34,197,94,0.4)"; }}
            >
              Approve
            </button>
            <button
              type="button"
              disabled={acting}
              onClick={(e) => { e.stopPropagation(); void handleReject(); }}
              style={{
                padding: "4px 12px",
                fontSize: 12,
                fontWeight: 500,
                borderRadius: 6,
                border: "1px solid rgba(239,68,68,0.4)",
                background: "rgba(239,68,68,0.1)",
                color: "#f87171",
                cursor: acting ? "wait" : "pointer",
                opacity: acting ? 0.5 : 1,
                transition: "all 120ms ease",
              }}
              onMouseEnter={(e) => { if (!acting) { e.currentTarget.style.background = "rgba(239,68,68,0.2)"; e.currentTarget.style.borderColor = "rgba(239,68,68,0.6)"; } }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(239,68,68,0.1)"; e.currentTarget.style.borderColor = "rgba(239,68,68,0.4)"; }}
            >
              Reject
            </button>
          </div>
        ) : null}
      </div>

      {/* Dismiss button */}
      {hovered && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); e.preventDefault(); onDismiss(group); }}
          title="Dismiss"
          style={{
            position: "absolute",
            right: 4,
            top: "50%",
            transform: "translateY(-50%)",
            width: 22,
            height: 22,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 4,
            border: "none",
            background: "rgba(120,113,108,0.15)",
            color: "#78716c",
            cursor: "pointer",
            transition: "all 100ms",
            zIndex: 2,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(120,113,108,0.3)"; e.currentTarget.style.color = "#d6d3d1"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(120,113,108,0.15)"; e.currentTarget.style.color = "#78716c"; }}
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}
