"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Lightbulb, ShieldAlert, UserPlus } from "lucide-react";
import { StatusCircle } from "@/components/orchestration/StatusCircle";

import { CompanyErrorState } from "@/components/company/company-ui";
import { formatAge } from "@/components/orchestration/ui";
import {
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

type InboxState = {
  events: OrchestrationCompanyInboxEvent[];
  unreadCount: number;
  nextCursor?: string;
  hasMore: boolean;
};

const EMPTY: InboxState = { events: [], unreadCount: 0, hasMore: false };

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
  // If we have a task key (e.g. "NEV-25"), link to the task detail route
  if (event.taskKey) {
    return buildCompanyPath(companySlug, `/tasks/${encodeURIComponent(event.taskKey)}`);
  }
  // Fallback to company root
  return buildCompanyPath(companySlug, "");
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

  /* ---- Filtering ---- */
  const filteredEvents = useMemo(() => {
    let items = inbox.events;
    if (activeTab === "unread") {
      items = items.filter((e) => !e.isRead);
    } else if (activeTab === "recent") {
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      items = items.filter((e) => new Date(e.timestamp).getTime() > sevenDaysAgo);
    }
    return items;
  }, [inbox.events, activeTab]);

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

  return (
    <div style={{ padding: "24px 32px" }}>
      {/* Header */}
      <p style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.18em", fontWeight: 600, color: "#78716c", marginBottom: "16px" }}>
        Inbox
      </p>

      {/* Tabs row */}
      <div style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: 0 }}>
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
        <button
          type="button"
          onClick={() => void handleMarkAllRead()}
          disabled={inbox.unreadCount === 0}
          style={{
            marginLeft: 12,
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
      {!loading && filteredEvents.length === 0 && !error && (
        <div style={{ padding: "48px 0", textAlign: "center" }}>
          <p style={{ fontSize: 14, color: "#a8a29e", marginBottom: 4 }}>
            {activeTab === "unread" ? "All caught up!" : "No activity yet."}
          </p>
          <p style={{ fontSize: 12, color: "#78716c" }}>
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
            // Approval rows render differently
            if (event.kind === "approval") {
              return <ApprovalRow key={event.id} event={event} onMarkRead={handleMarkRead} onRefresh={load} companySlug={company?.code ?? slug} />;
            }

            const isUnread = !event.isRead;
            const href = eventTargetHref(company?.slug ?? slug, event);
            const verb = eventVerb(event);
            const age = formatAge(event.timestamp);
            const taskKey = event.taskKey ?? null;
            const isFailed = event.eventType === "execution.failed";

            return (
              <Link
                key={event.id}
                href={href}
                onClick={() => { if (isUnread) void handleMarkRead(event.id); }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "9px 4px",
                  borderBottom: "1px solid rgba(120,113,108,0.08)",
                  textDecoration: "none",
                  transition: "background 100ms",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.025)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
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

                {/* Trailing: verb + time */}
                <span style={{ fontSize: 12, color: isFailed ? "#f87171" : "#57534e", flexShrink: 0, whiteSpace: "nowrap" }}>
                  {verb} {age} ago
                </span>
              </Link>
            );
          })}

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
/*  Approval row — matches Paperclip's nested approval rendering       */
/* ------------------------------------------------------------------ */

function ApprovalRow({
  event,
  onMarkRead,
  onRefresh,
  companySlug,
}: {
  event: OrchestrationCompanyInboxEvent;
  onMarkRead: (id: string) => void;
  onRefresh: () => void;
  companySlug: string;
}) {
  const router = useRouter();
  const [acting, setActing] = useState(false);
  const isUnread = !event.isRead;
  const age = formatAge(event.timestamp);
  const label = event.approvalLabel ?? event.message;
  const status = event.approvalStatus ?? "pending";
  const requester = event.requestedByName ?? event.agentName;
  const isPending = status === "pending";
  const isRevisionRequested = status === "revision_requested";
  const showInlineActions = isPending || isRevisionRequested;
  const approvalId = event.approvalId;
  const approvalType = event.approvalType ?? "hire_agent";

  const handleApprove = async () => {
    if (!approvalId || acting) return;
    setActing(true);
    await approveApproval(approvalId);
    if (isUnread) await markInboxEventsRead("", [event.id]).catch(() => {});
    onRefresh();
    setActing(false);
  };

  const handleReject = async () => {
    if (!approvalId || acting) return;
    setActing(true);
    await rejectApproval(approvalId);
    if (isUnread) await markInboxEventsRead("", [event.id]).catch(() => {});
    onRefresh();
    setActing(false);
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "10px 4px 10px 28px",
        borderBottom: "1px solid rgba(120,113,108,0.08)",
        transition: "background 100ms",
        cursor: "default",
      }}
      onClick={() => {
        if (isUnread) void onMarkRead(event.id);
        if (event.approvalId) router.push(`/${companySlug}/approvals/${event.approvalId}`);
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.025)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
    >
      {/* Approval icon — type-specific */}
      <div style={{ width: 28, height: 28, borderRadius: "50%", background: "rgba(120,113,108,0.15)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>
        {approvalType === "approve_ceo_strategy" ? <Lightbulb size={14} color="#78716c" /> :
         approvalType === "budget_override_required" ? <ShieldAlert size={14} color="#78716c" /> :
         <UserPlus size={14} color="#78716c" />}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: isUnread ? 500 : 400, color: isUnread ? "#f5f5f4" : "#d6d3d1", cursor: "pointer" }}>
          {label}
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
  );
}
