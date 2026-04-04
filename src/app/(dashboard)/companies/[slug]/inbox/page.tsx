"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCheck, Search, X } from "lucide-react";
import { StatusCircle } from "@/components/orchestration/StatusCircle";

import { CompanyErrorState } from "@/components/company/company-ui";
import { formatAge, statusTheme } from "@/components/orchestration/ui";
import {
  getCompanyInbox,
  listCompanies,
  markAllInboxRead,
  markInboxEventsRead,
} from "@/lib/orchestration/client";
import { canonicalProjectBoardHref } from "@/lib/orchestration/company-routes";
import type {
  OrchestrationCompany,
  OrchestrationCompanyInboxEvent,
  TaskStatus,
} from "@/lib/orchestration/types";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type TabKey = "recent" | "unread" | "all";

type CategoryFilter =
  | "all"
  | "task_events"
  | "execution_events"
  | "comments"
  | "status_changes"
  | "assignments";

type StatusFilterKey = "all" | TaskStatus;

type InboxState = {
  events: OrchestrationCompanyInboxEvent[];
  unreadCount: number;
  nextCursor?: string;
  hasMore: boolean;
};

const EMPTY: InboxState = { events: [], unreadCount: 0, hasMore: false };

/* ------------------------------------------------------------------ */
/*  Status indicator (uses canonical StatusCircle)                     */
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
/*  Event description helpers                                          */
/* ------------------------------------------------------------------ */

function eventVerb(event: OrchestrationCompanyInboxEvent): string {
  switch (event.eventType) {
    case "task.comment_added":
      return "commented";
    case "task.created":
      return "created";
    case "task.updated":
    case "task.reordered":
      return "updated";
    case "task.status_changed":
      return "updated";
    case "task.assigned":
    case "task.unassigned":
      return "updated";
    case "task.archived":
      return "archived";
    case "execution.pending":
    case "execution.running":
      return "updated";
    case "execution.completed":
      return "completed";
    case "execution.failed":
    case "execution.cancelled":
      return "updated";
    default:
      return "updated";
  }
}

function eventTargetHref(
  company: OrchestrationCompany | null,
  event: OrchestrationCompanyInboxEvent
): string {
  if (!event.projectSlug && !event.projectId) {
    return company
      ? `/companies/${encodeURIComponent(company.slug)}`
      : "/companies";
  }
  const projectKey = event.projectSlug || event.projectId;
  return canonicalProjectBoardHref(company, projectKey, event.taskId);
}

function matchesCategory(
  event: OrchestrationCompanyInboxEvent,
  cat: CategoryFilter
): boolean {
  switch (cat) {
    case "all":
      return true;
    case "task_events":
      return event.kind === "task";
    case "execution_events":
      return event.kind === "execution";
    case "comments":
      return event.eventType === "task.comment_added";
    case "status_changes":
      return event.eventType === "task.status_changed";
    case "assignments":
      return (
        event.eventType === "task.assigned" ||
        event.eventType === "task.unassigned"
      );
  }
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function CompanyInboxPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? "";

  // Data state
  const [company, setCompany] = useState<OrchestrationCompany | null>(null);
  const [inbox, setInbox] = useState<InboxState>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // UI state
  const [activeTab, setActiveTab] = useState<TabKey>("all");
  const [categoryFilter, setCategoryFilter] =
    useState<CategoryFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilterKey>("all");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");

  // Debounce search
  useEffect(() => {
    const t = window.setTimeout(() => setSearch(searchDraft.trim()), 250);
    return () => window.clearTimeout(t);
  }, [searchDraft]);

  /* ---- Data loading ---- */
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [companyRows, inboxData] = await Promise.all([
        listCompanies(),
        getCompanyInbox({
          companySlug: slug,
          search: search || undefined,
          includeDone: true,
          includeTaskSnapshot: false,
          limit: 100,
        }),
      ]);

      const current =
        companyRows.find((row) => row.slug === slug) ?? null;
      setCompany(current);

      if (!current) {
        setInbox(EMPTY);
        return;
      }

      if (!inboxData) {
        setInbox(EMPTY);
        return;
      }

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
  }, [slug, search]);

  useEffect(() => {
    void load();
  }, [load]);

  /* ---- Load more ---- */
  const loadMore = async () => {
    if (!inbox.hasMore || !inbox.nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await getCompanyInbox({
        companySlug: slug,
        search: search || undefined,
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

  /* ---- Filtering ---- */
  const filteredEvents = useMemo(() => {
    let items = inbox.events;

    // Tab filter
    if (activeTab === "unread") {
      items = items.filter((e) => !e.isRead);
    } else if (activeTab === "recent") {
      // Recent: last 7 days
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      items = items.filter(
        (e) => new Date(e.timestamp).getTime() > sevenDaysAgo
      );
    }

    // Category filter
    if (categoryFilter !== "all") {
      items = items.filter((e) => matchesCategory(e, categoryFilter));
    }

    // Status filter
    if (statusFilter !== "all") {
      items = items.filter((e) => e.status === statusFilter);
    }

    return items;
  }, [inbox.events, activeTab, categoryFilter, statusFilter]);

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

  /* ------------------------------------------------------------------ */
  /*  Styles                                                             */
  /* ------------------------------------------------------------------ */

  const TAB_BASE: React.CSSProperties = {
    padding: "8px 16px",
    fontSize: "13px",
    fontWeight: 500,
    color: "#8A8A8A",
    background: "transparent",
    border: "none",
    borderBottom: "2px solid transparent",
    cursor: "pointer",
    transition: "color 150ms, border-color 150ms",
  };

  const TAB_ACTIVE: React.CSSProperties = {
    ...TAB_BASE,
    color: "#FFFFFF",
    borderBottomColor: "#FFFFFF",
  };

  return (
    <div style={{ padding: "32px 40px", maxWidth: 960 }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 24,
        }}
      >
        <h1
          style={{
            fontSize: 20,
            fontWeight: 700,
            color: "#FFFFFF",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          Inbox
        </h1>
        {/* Search toggle */}
        {searchOpen ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ position: "relative" }}>
              <Search
                size={14}
                style={{
                  position: "absolute",
                  left: 10,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "#525252",
                  pointerEvents: "none",
                }}
              />
              <input
                autoFocus
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
                placeholder="Search inbox..."
                style={{
                  width: 240,
                  padding: "7px 12px 7px 32px",
                  fontSize: 13,
                  borderRadius: 8,
                  border: "1px solid #333",
                  background: "#1A1A1A",
                  color: "#FFFFFF",
                  outline: "none",
                }}
              />
            </div>
            <button
              type="button"
              onClick={() => {
                setSearchOpen(false);
                setSearchDraft("");
                setSearch("");
              }}
              style={{
                background: "transparent",
                border: "none",
                color: "#8A8A8A",
                cursor: "pointer",
                padding: 4,
              }}
            >
              <X size={16} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            style={{
              background: "transparent",
              border: "none",
              color: "#8A8A8A",
              cursor: "pointer",
              padding: 4,
            }}
          >
            <Search size={18} />
          </button>
        )}
      </div>

      {/* Tabs + Mark all + Filters row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid #242424",
          marginBottom: 0,
          gap: 12,
        }}
      >
        {/* Left: tabs + mark-all */}
        <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
          <div style={{ display: "flex", gap: 0 }} role="tablist">
            {(["recent", "unread", "all"] as TabKey[]).map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={activeTab === tab}
                onClick={() => setActiveTab(tab)}
                style={activeTab === tab ? TAB_ACTIVE : TAB_BASE}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => void handleMarkAllRead()}
            disabled={inbox.unreadCount === 0}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 14px",
              marginLeft: 12,
              fontSize: 12,
              fontWeight: 500,
              borderRadius: 6,
              border: "1px solid #333",
              background: "transparent",
              color: inbox.unreadCount > 0 ? "#FFFFFF" : "#525252",
              cursor: inbox.unreadCount > 0 ? "pointer" : "default",
              opacity: inbox.unreadCount > 0 ? 1 : 0.5,
            }}
          >
            Mark all as read
          </button>
        </div>

        {/* Right: filter dropdowns */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <select
            value={categoryFilter}
            onChange={(e) =>
              setCategoryFilter(e.target.value as CategoryFilter)
            }
            style={{
              padding: "6px 10px",
              fontSize: 12,
              borderRadius: 6,
              border: "1px solid #333",
              background: "#1A1A1A",
              color: "#FFFFFF",
              outline: "none",
              cursor: "pointer",
            }}
          >
            <option value="all">All categories</option>
            <option value="task_events">Task events</option>
            <option value="execution_events">Execution events</option>
            <option value="comments">Comments</option>
            <option value="status_changes">Status changes</option>
            <option value="assignments">Assignments</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilterKey)}
            style={{
              padding: "6px 10px",
              fontSize: 12,
              borderRadius: 6,
              border: "1px solid #333",
              background: "#1A1A1A",
              color: "#FFFFFF",
              outline: "none",
              cursor: "pointer",
            }}
          >
            <option value="all">All statuses</option>
            <option value="backlog">Backlog</option>
            <option value="on-deck">On Deck</option>
            <option value="in-progress">In Progress</option>
            <option value="review">Review</option>
            <option value="done">Done</option>
            <option value="blocked">Blocked</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div
          style={{
            padding: "12px 16px",
            margin: "12px 0",
            borderRadius: 8,
            border: "1px solid #7f1d1d",
            background: "rgba(127,29,29,0.15)",
            fontSize: 13,
            color: "#fca5a5",
          }}
        >
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div
          style={{
            padding: "48px 0",
            textAlign: "center",
            fontSize: 13,
            color: "#525252",
          }}
        >
          Loading inbox...
        </div>
      )}

      {/* Empty state */}
      {!loading && filteredEvents.length === 0 && !error && (
        <div
          style={{
            padding: "48px 0",
            textAlign: "center",
          }}
        >
          <p style={{ fontSize: 14, color: "#8A8A8A", marginBottom: 4 }}>
            {activeTab === "unread"
              ? "All caught up!"
              : "No activity yet."}
          </p>
          <p style={{ fontSize: 12, color: "#525252" }}>
            {activeTab === "unread"
              ? "You have no unread notifications."
              : "Events from tasks and executions will appear here."}
          </p>
        </div>
      )}

      {/* Event list */}
      {!loading && filteredEvents.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {filteredEvents.map((event) => {
            const isUnread = !event.isRead;
            const href = eventTargetHref(company, event);
            const verb = eventVerb(event);
            const age = formatAge(event.timestamp);

            const taskKey = event.taskKey ?? null;

            return (
              <div
                key={event.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 12px",
                  borderBottom: "1px solid #1A1A1A",
                  transition: "background 100ms",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(255,255,255,0.03)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                }}
              >
                {/* Unread dot */}
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: isUnread ? "#3b82f6" : "transparent",
                    flexShrink: 0,
                  }}
                />

                {/* Status icon */}
                <StatusDot status={event.status} />

                {/* Content */}
                <Link
                  href={href}
                  style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    textDecoration: "none",
                    overflow: "hidden",
                    minWidth: 0,
                  }}
                >
                  {/* Task key identifier */}
                  {taskKey ? (
                    <span
                      style={{
                        fontSize: 12,
                        color: "#525252",
                        flexShrink: 0,
                        fontFamily: "monospace",
                      }}
                    >
                      {taskKey}
                    </span>
                  ) : event.projectSlug ? (
                    <span
                      style={{
                        fontSize: 12,
                        color: "#525252",
                        flexShrink: 0,
                        fontFamily: "monospace",
                      }}
                    >
                      {event.projectName}
                    </span>
                  ) : null}

                  {/* Title */}
                  <span
                    style={{
                      fontSize: 13,
                      color: isUnread ? "#FFFFFF" : "#d4d4d4",
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
                </Link>

                {/* Timestamp */}
                <span
                  style={{
                    fontSize: 12,
                    color: "#525252",
                    flexShrink: 0,
                    whiteSpace: "nowrap",
                  }}
                >
                  {verb} {age} ago
                </span>

                {/* Mark as read button */}
                {isUnread && (
                  <button
                    type="button"
                    title="Mark as read"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleMarkRead(event.id);
                    }}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#525252",
                      cursor: "pointer",
                      padding: 4,
                      borderRadius: 4,
                      flexShrink: 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = "#FFFFFF";
                      e.currentTarget.style.background = "rgba(255,255,255,0.08)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = "#525252";
                      e.currentTarget.style.background = "transparent";
                    }}
                  >
                    <CheckCheck size={14} />
                  </button>
                )}
              </div>
            );
          })}

          {/* Load more */}
          {inbox.hasMore && (
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                padding: "16px 0",
              }}
            >
              <button
                type="button"
                onClick={() => void loadMore()}
                disabled={loadingMore}
                style={{
                  padding: "8px 20px",
                  fontSize: 12,
                  fontWeight: 500,
                  borderRadius: 6,
                  border: "1px solid #333",
                  background: "transparent",
                  color: "#FFFFFF",
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
