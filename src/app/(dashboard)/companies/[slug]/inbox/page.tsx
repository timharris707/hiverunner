"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Archive, ArrowUpDown, Check, ChevronDown, Columns3, Filter, Inbox as InboxIcon, Layers, Lightbulb, Search, ShieldAlert, User, UserPlus } from "lucide-react";
import { AgentAvatar } from "@/components/AgentAvatar";
import { PageHeader } from "@/lib/ui/primitives";
import { P, radius, space } from "@/lib/ui/tokens";
import { StatusCircle } from "@/components/orchestration/StatusCircle";
import { getAgentByAnyId } from "@/config/agents";

import { CompanyErrorState } from "@/components/company/company-ui";
import { formatAge } from "@/components/orchestration/ui";
import {
  archiveInboxEvents,
  getCompanyInbox,
  listCompanies,
  markAllInboxRead,
  markInboxThreadRead,
  approveApproval,
  rejectApproval,
  wakeupAgent,
  cancelTaskExecution,
} from "@/lib/orchestration/client";
import { buildApprovalDetailPath, buildCompanyPath } from "@/lib/orchestration/route-paths";
import type {
  OrchestrationCompany,
  OrchestrationCompanyInboxEvent,
  TaskStatus,
} from "@/lib/orchestration/types";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type TabKey = "mine" | "recent" | "unread" | "all";
type InboxColumn = "status" | "id" | "assignee" | "project" | "type" | "updated";
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
/*  Column visibility persistence                                      */
/* ------------------------------------------------------------------ */

const COLUMNS_STORAGE_KEY = "mc:inbox:columns";
const DEFAULT_COLUMNS: InboxColumn[] = ["status", "id", "assignee", "updated"];

function getStoredColumns(): InboxColumn[] {
  try {
    const stored = localStorage.getItem(COLUMNS_STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch {}
  return DEFAULT_COLUMNS;
}

function hashStringToColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 55%, 55%)`;
}

/* ------------------------------------------------------------------ */
/*  Thread helpers                                                     */
/* ------------------------------------------------------------------ */

/** Derive a thread key for an event — used for thread-level mark-as-read */
function eventThreadKey(event: OrchestrationCompanyInboxEvent): string {
  if (event.kind === "approval" && event.approvalId) return event.approvalId;
  if (event.taskKey) return event.taskKey;
  return event.id;
}

function eventThreadKind(event: OrchestrationCompanyInboxEvent): "task" | "approval" {
  return event.kind === "approval" ? "approval" : "task";
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
    return buildCompanyPath(companySlug, `/tasks/${encodeURIComponent(event.taskKey)}?from=inbox`);
  }
  return buildCompanyPath(companySlug, "");
}

/** Persist the current inbox item list to sessionStorage for prev/next navigation on the task detail page. */
const INBOX_CONTEXT_KEY = "mc:inbox:context";

function persistInboxContext(events: OrchestrationCompanyInboxEvent[], companySlug: string) {
  try {
    const items = events
      .filter((e) => e.taskKey)
      .map((e) => ({ taskKey: e.taskKey!, title: e.taskTitle ?? e.message }));
    const inboxHref = buildCompanyPath(companySlug, "/inbox");
    sessionStorage.setItem(INBOX_CONTEXT_KEY, JSON.stringify({ items, inboxHref }));
  } catch {}
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
          borderRadius: 6, border: "0.5px solid rgba(120,113,108,0.25)",
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
          border: "0.5px solid rgba(120,113,108,0.2)",
          background: "var(--surface-elevated)", boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
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
  const [activeTab, setActiveTab] = useState<TabKey>("mine");
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("everything");
  const [approvalStatusFilter, setApprovalStatusFilter] = useState<ApprovalStatusFilter>("all");
  const [visibleColumns, setVisibleColumns] = useState<InboxColumn[]>(DEFAULT_COLUMNS);
  const [columnsDropdownOpen, setColumnsDropdownOpen] = useState(false);
  const columnsDropdownRef = useRef<HTMLDivElement>(null);
  // Persist sort/filter/group across sessions
  const inboxPrefsKey = `mc:inbox:prefs:${slug}`;
  const loadInboxPrefs = () => { try { const r = localStorage.getItem(inboxPrefsKey); if (r) return JSON.parse(r); } catch {} return {}; };
  const savedInboxPrefs = useRef(loadInboxPrefs());

  const [sortDir, setSortDir] = useState<"newest" | "oldest">(savedInboxPrefs.current.sortDir || "newest");
  const [kindFilter, setKindFilter] = useState<"all" | "task" | "execution" | "approval">(savedInboxPrefs.current.kindFilter || "all");
  const [groupBy, setGroupBy] = useState<"none" | "kind" | "project">(savedInboxPrefs.current.groupBy || "none");
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  const sortRef = useRef<HTMLDivElement>(null);
  const groupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try { localStorage.setItem(inboxPrefsKey, JSON.stringify({ sortDir, kindFilter, groupBy })); } catch {}
  }, [sortDir, kindFilter, groupBy, inboxPrefsKey]);

  // Hydrate columns from localStorage on mount
  useEffect(() => {
    setVisibleColumns(getStoredColumns());
  }, []);

  // Close columns dropdown on outside click
  useEffect(() => {
    if (!columnsDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (columnsDropdownRef.current && !columnsDropdownRef.current.contains(e.target as Node)) setColumnsDropdownOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [columnsDropdownOpen]);

  useEffect(() => {
    if (!filterOpen) return;
    const handler = (e: MouseEvent) => { if (filterRef.current && !filterRef.current.contains(e.target as Node)) setFilterOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [filterOpen]);

  useEffect(() => {
    if (!sortOpen) return;
    const handler = (e: MouseEvent) => { if (sortRef.current && !sortRef.current.contains(e.target as Node)) setSortOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [sortOpen]);

  useEffect(() => {
    if (!groupOpen) return;
    const handler = (e: MouseEvent) => { if (groupRef.current && !groupRef.current.contains(e.target as Node)) setGroupOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [groupOpen]);

  const toggleColumn = (col: InboxColumn) => {
    setVisibleColumns((prev) => {
      const next = prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col];
      try { localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const resetColumns = () => {
    setVisibleColumns(DEFAULT_COLUMNS);
    try { localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(DEFAULT_COLUMNS)); } catch {}
  };
  /** Map active tab to the server `kinds` filter so the API returns only relevant threads. */
  const kindsForTab = (tab: TabKey): string | undefined => {
    if (tab === "mine") return "task,approval,execution";
    return undefined; // "all", "recent", "unread" show everything
  };

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
          limit: 25,
          kinds: kindsForTab(activeTab),
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
  }, [slug, activeTab]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") {
        void load();
      }
    };

    const interval = window.setInterval(refreshIfVisible, 10000);
    window.addEventListener("focus", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshIfVisible);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [load]);

  /* ---- Load more ---- */
  const loadMore = async () => {
    if (!inbox.hasMore || !inbox.nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await getCompanyInbox({
        companySlug: slug,
        includeDone: true,
        includeTaskSnapshot: false,
        limit: 25,
        cursor: inbox.nextCursor,
        kinds: kindsForTab(activeTab),
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
      window.dispatchEvent(new CustomEvent("inbox-unread-change", { detail: { count: 0 } }));
    }
  };

  /** Mark the entire thread for an event as read (all comments/updates for that task/approval) */
  const handleMarkThreadRead = async (event: OrchestrationCompanyInboxEvent) => {
    if (event.isRead) return;
    const threadKey = eventThreadKey(event);
    const threadKind = eventThreadKind(event);
    const ok = await markInboxThreadRead(slug, threadKey, threadKind);
    if (ok) {
      setInbox((prev) => {
        const newUnread = Math.max(0, prev.unreadCount - 1);
        // Signal the Dock to update its badge immediately
        window.dispatchEvent(new CustomEvent("inbox-unread-change", { detail: { count: newUnread } }));
        return {
          ...prev,
          events: prev.events.map((e) =>
            e.id === event.id ? { ...e, isRead: true } : e
          ),
          unreadCount: newUnread,
        };
      });
    }
  };

  /* ---- Dismiss / archive ---- */
  const handleDismiss = async (event: OrchestrationCompanyInboxEvent) => {
    await archiveInboxEvents(slug, [event.id]);
    void load();
  };

  /* ---- Filtering ---- */
  const filteredEvents = useMemo(() => {
    let items = inbox.events;

    // Kind filtering is now server-side (via `kinds` param). Only apply lightweight
    // client-side filters that refine within the current server result set.
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
        if (e.kind !== "approval") return true;
        return e.approvalStatus === approvalStatusFilter;
      });
    }

    // Search filter
    if (searchQuery.trim()) {
      items = items.filter((e) => eventMatchesSearch(e, searchQuery.trim()));
    }

    // Kind filter (toolbar)
    if (kindFilter !== "all") {
      items = items.filter((e) => e.kind === kindFilter);
    }

    // Sort
    if (sortDir === "oldest") {
      items = [...items].reverse();
    }

    return items;
  }, [inbox.events, activeTab, searchQuery, categoryFilter, approvalStatusFilter, kindFilter, sortDir]);

  // Persist the current visible inbox items for prev/next navigation on task detail pages
  useEffect(() => {
    if (filteredEvents.length > 0 && company) {
      persistInboxContext(filteredEvents, company.slug);
    }
  }, [filteredEvents, company]);

  /* ---- Time-split rendering (events are already 1-per-thread from server) ---- */
  const { todayEvents, earlierEvents } = useMemo(() => {
    const today: OrchestrationCompanyInboxEvent[] = [];
    const earlier: OrchestrationCompanyInboxEvent[] = [];
    for (const event of filteredEvents) {
      if (isToday(event.timestamp)) {
        today.push(event);
      } else {
        earlier.push(event);
      }
    }
    return { todayEvents: today, earlierEvents: earlier };
  }, [filteredEvents]);

  /* ---- Grouped event sections (for Group control) ---- */
  const groupedSections = useMemo(() => {
    if (groupBy === "none") return null;
    const groups = new Map<string, OrchestrationCompanyInboxEvent[]>();
    for (const event of filteredEvents) {
      const key = groupBy === "kind"
        ? (event.kind ?? "task")
        : (event.projectName ?? "No project");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(event);
    }
    return Array.from(groups.entries()).map(([label, items]) => ({
      label: groupBy === "kind" ? (label.charAt(0).toUpperCase() + label.slice(1) + "s") : label,
      items,
    }));
  }, [filteredEvents, groupBy]);

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
    { key: "mine", label: "Mine" },
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
    <div style={{ padding: `${space.md}px ${space.xl}px 24px` }}>
      <PageHeader
        icon={<InboxIcon size={14} style={{ color: P.textSecondary }} />}
        title="Inbox"
      />

      {/* Tab bar with underline */}
      <div style={{ borderBottom: "0.5px solid rgba(222,220,209,0.10)", marginBottom: space.md }}>
        <nav style={{ display: "flex", gap: 0 }}>
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                position: "relative",
                padding: "8px 12px",
                fontSize: 14,
                fontWeight: 500,
                color: activeTab === tab.key ? "#eae8e4" : "#7a7872",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                transition: "color 150ms",
                textDecoration: "none",
              }}
            >
              {tab.label}
              {activeTab === tab.key && (
                <span style={{
                  position: "absolute",
                  left: 0, right: 0, bottom: 0,
                  height: 2,
                  background: "#d97706",
                }} />
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Toolbar: search + actions */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: space.sm }}>

        {/* Left: search */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, flex: 1 }}>
          <div style={{ position: "relative", minWidth: 200, flex: "0 1 280px" }}>
            <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: P.textMuted, pointerEvents: "none" }} />
            <input
              type="text"
              placeholder="Search inbox..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: "100%", height: 34, borderRadius: radius.md,
                border: `0.5px solid ${P.cardBorder}`, background: "transparent",
                padding: "0 12px 0 32px", fontSize: 13, color: P.text, outline: "none",
              }}
            />
          </div>
        </div>

        {/* Right: filter/sort/group + columns + mark all read */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>

          {/* Filter */}
          <div ref={filterRef} style={{ position: "relative" }}>
            <button type="button" onClick={() => setFilterOpen(!filterOpen)} style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "0 10px", height: 34, fontSize: 13, fontWeight: 500,
              borderRadius: radius.md, border: `0.5px solid ${P.cardBorder}`,
              background: filterOpen ? "rgba(255,255,255,0.05)" : "transparent",
              color: kindFilter !== "all" ? P.text : P.textSecondary, cursor: "pointer",
            }}>
              <Filter size={13} />
              Filters{kindFilter !== "all" ? " (1)" : ""}
            </button>
            {filterOpen && (
              <div style={{
                position: "absolute", top: "100%", right: 0, marginTop: 4, minWidth: 180,
                borderRadius: radius.md, border: `1px solid ${P.cardBorder}`,
                background: P.surfaceElevated, boxShadow: "0 16px 36px rgba(0,0,0,0.35)",
                zIndex: 50, padding: 8,
              }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: P.textMuted, padding: "4px 6px", textTransform: "uppercase", letterSpacing: "0.08em" }}>Kind</div>
                {(["all", "task", "execution", "approval"] as const).map((k) => (
                  <button key={k} type="button" onClick={() => { setKindFilter(k); setFilterOpen(false); }} style={{
                    display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left",
                    padding: "5px 8px", borderRadius: radius.sm, fontSize: 12,
                    background: kindFilter === k ? "rgba(255,255,255,0.06)" : "transparent",
                    border: "none", cursor: "pointer", color: kindFilter === k ? P.text : P.textSecondary,
                    fontWeight: kindFilter === k ? 600 : 400,
                  }}>
                    {k === "all" ? "All" : k.charAt(0).toUpperCase() + k.slice(1) + "s"}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Sort */}
          <div ref={sortRef} style={{ position: "relative" }}>
            <button type="button" onClick={() => setSortOpen(!sortOpen)} style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "0 10px", height: 34, fontSize: 13, fontWeight: 500,
              borderRadius: radius.md, border: `0.5px solid ${P.cardBorder}`,
              background: sortOpen ? "rgba(255,255,255,0.05)" : "transparent",
              color: sortDir !== "newest" ? P.text : P.textSecondary, cursor: "pointer",
            }}>
              <ArrowUpDown size={13} />
              Sort
            </button>
            {sortOpen && (
              <div style={{
                position: "absolute", top: "100%", right: 0, marginTop: 4, minWidth: 160,
                borderRadius: radius.md, border: `1px solid ${P.cardBorder}`,
                background: P.surfaceElevated, boxShadow: "0 16px 36px rgba(0,0,0,0.35)",
                zIndex: 50, padding: 8,
              }}>
                {(["newest", "oldest"] as const).map((dir) => (
                  <button key={dir} type="button" onClick={() => { setSortDir(dir); setSortOpen(false); }} style={{
                    display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left",
                    padding: "5px 8px", borderRadius: radius.sm, fontSize: 12,
                    background: sortDir === dir ? "rgba(255,255,255,0.06)" : "transparent",
                    border: "none", cursor: "pointer", color: sortDir === dir ? P.text : P.textSecondary,
                    fontWeight: sortDir === dir ? 600 : 400,
                  }}>
                    {dir === "newest" ? "Newest first" : "Oldest first"}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Group */}
          <div ref={groupRef} style={{ position: "relative" }}>
            <button type="button" onClick={() => setGroupOpen(!groupOpen)} style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "0 10px", height: 34, fontSize: 13, fontWeight: 500,
              borderRadius: radius.md, border: `0.5px solid ${P.cardBorder}`,
              background: groupOpen ? "rgba(255,255,255,0.05)" : "transparent",
              color: groupBy !== "none" ? P.text : P.textSecondary, cursor: "pointer",
            }}>
              <Layers size={13} />
              Group
            </button>
            {groupOpen && (
              <div style={{
                position: "absolute", top: "100%", right: 0, marginTop: 4, minWidth: 160,
                borderRadius: radius.md, border: `1px solid ${P.cardBorder}`,
                background: P.surfaceElevated, boxShadow: "0 16px 36px rgba(0,0,0,0.35)",
                zIndex: 50, padding: 8,
              }}>
                {([["none", "None"], ["kind", "Kind"], ["project", "Project"]] as const).map(([mode, label]) => (
                  <button key={mode} type="button" onClick={() => { setGroupBy(mode as typeof groupBy); setGroupOpen(false); }} style={{
                    display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left",
                    padding: "5px 8px", borderRadius: radius.sm, fontSize: 12,
                    background: groupBy === mode ? "rgba(255,255,255,0.06)" : "transparent",
                    border: "none", cursor: "pointer", color: groupBy === mode ? P.text : P.textSecondary,
                    fontWeight: groupBy === mode ? 600 : 400,
                  }}>
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Show / hide columns */}
          <div ref={columnsDropdownRef} style={{ position: "relative" }}>
            <button
              type="button"
              onClick={() => setColumnsDropdownOpen(!columnsDropdownOpen)}
              title="Show / hide columns"
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "0 10px", height: 34, fontSize: 13, fontWeight: 500,
                borderRadius: radius.md, border: `0.5px solid ${P.cardBorder}`,
                background: columnsDropdownOpen ? "rgba(255,255,255,0.05)" : "transparent",
                color: P.textSecondary, cursor: "pointer",
              }}
            >
              <Columns3 size={13} />
              Columns
            </button>
            {columnsDropdownOpen && (
              <div style={{
                position: "absolute", top: "100%", right: 0, marginTop: 4,
                minWidth: 220, borderRadius: 8,
                border: "0.5px solid rgba(120,113,108,0.2)",
                background: "var(--surface-elevated)", boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
                zIndex: 50, overflow: "hidden", padding: "4px 0",
              }}>
                {([
                  { key: "status" as InboxColumn, label: "Status", desc: "Task status indicator" },
                  { key: "id" as InboxColumn, label: "ID", desc: "Task identifier like NEV-45" },
                  { key: "assignee" as InboxColumn, label: "Assignee", desc: "Assigned agent" },
                  { key: "project" as InboxColumn, label: "Project", desc: "Project name with color" },
                  { key: "type" as InboxColumn, label: "Type", desc: "Update type (commented, failed, etc.)" },
                  { key: "updated" as InboxColumn, label: "Updated", desc: "Last changed time" },
                ]).map((col) => (
                  <button
                    key={col.key}
                    type="button"
                    onClick={() => toggleColumn(col.key)}
                    style={{
                      display: "flex", alignItems: "center", gap: 8,
                      width: "100%", textAlign: "left",
                      padding: "7px 12px", fontSize: 12,
                      color: "#d6d3d1",
                      background: "transparent",
                      border: "none", cursor: "pointer",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                  >
                    <span style={{
                      width: 16, height: 16, borderRadius: 3,
                      border: "0.5px solid rgba(120,113,108,0.4)",
                      background: visibleColumns.includes(col.key) ? "rgba(59,130,246,0.3)" : "transparent",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      flexShrink: 0,
                    }}>
                      {visibleColumns.includes(col.key) && <Check size={10} color="#93c5fd" />}
                    </span>
                    <span style={{ flex: 1 }}>
                      <span style={{ fontWeight: 500 }}>{col.label}</span>
                      <span style={{ color: "#78716c", marginLeft: 6 }}>{col.desc}</span>
                    </span>
                  </button>
                ))}
                <div style={{ borderTop: "0.5px solid rgba(120,113,108,0.15)", marginTop: 4, paddingTop: 4 }}>
                  <button
                    type="button"
                    onClick={resetColumns}
                    style={{
                      display: "block", width: "100%", textAlign: "left",
                      padding: "7px 12px", fontSize: 12,
                      color: "#78716c", background: "transparent",
                      border: "none", cursor: "pointer",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; e.currentTarget.style.color = "#a8a29e"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#78716c"; }}
                  >
                    Reset defaults
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Mark all as read */}
          <button
            type="button"
            onClick={() => void handleMarkAllRead()}
            disabled={inbox.unreadCount === 0}
            style={{
              display: "inline-flex", alignItems: "center",
              padding: "0 10px", height: 34,
              fontSize: 13, fontWeight: 500,
              borderRadius: radius.md,
              border: `0.5px solid ${P.cardBorder}`,
              background: "transparent",
              color: inbox.unreadCount > 0 ? P.text : "#57534e",
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
        <div style={{ padding: "12px 16px", margin: "12px 0", borderRadius: 8, border: "0.5px solid #7f1d1d", background: "rgba(127,29,29,0.15)", fontSize: 13, color: "#fca5a5" }}>
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
            {activeTab === "unread" ? "All caught up!" : activeTab === "mine" ? "Nothing here yet." : searchQuery ? "No matching events." : "No activity yet."}
          </p>
          <p style={{ fontSize: 12, color: "#78716c" }}>
            {activeTab === "unread"
              ? "You have no unread notifications."
              : activeTab === "mine"
              ? "Task and approval events will appear here."
              : searchQuery
              ? "Try a different search term."
              : "Events from tasks and executions will appear here."}
          </p>
        </div>
      )}

      {/* Event list — each event is one thread (server de-duplicated) */}
      {!loading && filteredEvents.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", marginTop: 4 }}>
          {groupedSections ? (
            /* Grouped rendering */
            groupedSections.map((section) => (
              <div key={section.label}>
                <div style={{ padding: "8px 4px 4px", display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: P.textSecondary, textTransform: "uppercase", letterSpacing: "0.02em" }}>
                    {section.label}
                  </span>
                  <span style={{ fontSize: 11, color: P.textMuted }}>({section.items.length})</span>
                </div>
                {section.items.map((event) => (
                  <EventRow
                    key={event.id}
                    event={event}
                    company={company}
                    slug={slug}
                    onMarkThreadRead={handleMarkThreadRead}
                    onRefresh={load}
                    onDismiss={handleDismiss}
                    visibleColumns={visibleColumns}
                  />
                ))}
              </div>
            ))
          ) : (
            /* Time-based rendering (default) */
            <>
              {todayEvents.map((event) => (
                <EventRow
                  key={event.id}
                  event={event}
                  company={company}
                  slug={slug}
                  onMarkThreadRead={handleMarkThreadRead}
                  onRefresh={load}
                  onDismiss={handleDismiss}
                  visibleColumns={visibleColumns}
                />
              ))}

              {earlierEvents.length > 0 && todayEvents.length > 0 && (
                <TimeDivider label="Earlier" />
              )}

              {earlierEvents.map((event) => (
                <EventRow
                  key={event.id}
                  event={event}
                  company={company}
                  slug={slug}
                  onMarkThreadRead={handleMarkThreadRead}
                  onRefresh={load}
                  onDismiss={handleDismiss}
                  visibleColumns={visibleColumns}
                />
              ))}
            </>
          )}

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
                  border: "0.5px solid rgba(120,113,108,0.3)",
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
/*  Unified event row — one per thread (server de-duplicated)          */
/* ------------------------------------------------------------------ */

function EventRow({
  event, company, slug, onMarkThreadRead, onRefresh, onDismiss, visibleColumns,
}: {
  event: OrchestrationCompanyInboxEvent;
  company: OrchestrationCompany | null;
  slug: string;
  onMarkThreadRead: (event: OrchestrationCompanyInboxEvent) => void;
  onRefresh: () => void;
  onDismiss: (event: OrchestrationCompanyInboxEvent) => void;
  visibleColumns: InboxColumn[];
}) {
  const router = useRouter();
  const [hovered, setHovered] = useState(false);
  const [acting, setActing] = useState(false);
  const isUnread = !event.isRead;
  const verb = eventVerb(event);
  const age = formatAge(event.timestamp);
  const isFailed = event.eventType === "execution.failed";

  const showAssignee = visibleColumns.includes("assignee");
  const showProject = visibleColumns.includes("project");
  const showType = visibleColumns.includes("type");
  const showUpdated = visibleColumns.includes("updated");

  // Approval-specific
  const isApproval = event.kind === "approval";
  const approvalId = event.approvalId;
  const approvalType = event.approvalType ?? "hire_agent";
  const approvalStatus = event.approvalStatus ?? "pending";
  const isPendingApproval = isApproval && (approvalStatus === "pending" || approvalStatus === "revision_requested");
  const showInlineActions = isPendingApproval && approvalType !== "budget_override_required";

  const handleApprove = async () => {
    if (!approvalId || acting) return;
    setActing(true);
    await approveApproval(approvalId);
    onRefresh();
    setActing(false);
  };

  const handleReject = async () => {
    if (!approvalId || acting) return;
    setActing(true);
    await rejectApproval(approvalId);
    onRefresh();
    setActing(false);
  };

  const href = isApproval && approvalId
    ? buildApprovalDetailPath({
        companyCode: company?.code,
        companySlug: company?.slug ?? slug,
        approvalId,
        linkedTaskKey: event.taskKey,
      })
    : eventTargetHref(company?.slug ?? slug, event);

  const handleClick = () => {
    if (isUnread) void onMarkThreadRead(event);
    if (isApproval && approvalId) {
      router.push(href);
    }
  };

  // Approval rows — two-line Paperclip-style treatment
  if (isApproval) {
    const label = event.approvalLabel ?? event.message;
    const requester = event.requestedByName ?? event.agentName;

    // Status badge colors
    const statusBadge: Record<string, { color: string; bg: string; border: string }> = {
      pending:             { color: "#fbbf24", bg: "rgba(251,191,36,0.10)", border: "rgba(251,191,36,0.30)" },
      revision_requested:  { color: "#fbbf24", bg: "rgba(251,191,36,0.10)", border: "rgba(251,191,36,0.30)" },
      approved:            { color: "#4ade80", bg: "rgba(74,222,128,0.10)", border: "rgba(74,222,128,0.30)" },
      rejected:            { color: "#f87171", bg: "rgba(248,113,113,0.10)", border: "rgba(248,113,113,0.30)" },
      cancelled:           { color: "#78716c", bg: "rgba(120,113,108,0.10)", border: "rgba(120,113,108,0.30)" },
    };
    const badge = statusBadge[approvalStatus] ?? statusBadge.pending;

    return (
      <div
        style={{ position: "relative" }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <div
          style={{
            display: "flex", flexDirection: "column", gap: 2,
            padding: "8px 4px 8px 20px", paddingRight: 30,
            borderBottom: "0.5px solid rgba(120,113,108,0.08)",
            transition: "background 100ms", cursor: "pointer",
            background: hovered ? "rgba(255,255,255,0.025)" : "transparent",
          }}
          onClick={handleClick}
        >
          {/* Primary line: unread dot + icon + label + time */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: isUnread ? "#3b82f6" : "transparent", flexShrink: 0 }} />
            <div style={{ width: 20, height: 20, borderRadius: "50%", background: "rgba(120,113,108,0.15)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              {approvalType === "approve_ceo_strategy" ? <Lightbulb size={11} color="#78716c" /> :
               approvalType === "budget_override_required" ? <ShieldAlert size={11} color="#78716c" /> :
               <UserPlus size={11} color="#78716c" />}
            </div>
            <span style={{
              fontSize: 13, fontWeight: isUnread ? 500 : 400,
              color: isUnread ? "#f5f5f4" : "#d6d3d1",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              flex: 1, minWidth: 0,
            }}>
              {label}
            </span>
            {showUpdated && (
              <span style={{ fontSize: 11, color: "#57534e", whiteSpace: "nowrap", flexShrink: 0 }}>
                {age} ago
              </span>
            )}
          </div>

          {/* Secondary line: status badge + requester + time */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: 34 }}>
            <span style={{
              display: "inline-flex", alignItems: "center",
              padding: "1px 7px", fontSize: 10, fontWeight: 600, borderRadius: 9999,
              border: `0.5px solid ${badge.border}`, background: badge.bg, color: badge.color,
              textTransform: "capitalize", whiteSpace: "nowrap", lineHeight: "16px",
            }}>
              {approvalStatus.replace(/_/g, " ")}
            </span>
            {requester && (
              <span style={{ fontSize: 11, color: "#78716c" }}>
                requested by {requester}
              </span>
            )}
            <span style={{ fontSize: 11, color: "#57534e" }}>
              updated {age} ago
            </span>
            {showInlineActions && approvalId ? (
              <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
                <button type="button" disabled={acting} onClick={(e) => { e.stopPropagation(); void handleApprove(); }}
                  style={{ padding: "2px 10px", fontSize: 11, fontWeight: 500, borderRadius: 5, border: "0.5px solid rgba(34,197,94,0.4)", background: "rgba(34,197,94,0.1)", color: "#4ade80", cursor: acting ? "wait" : "pointer", opacity: acting ? 0.5 : 1 }}>
                  Approve
                </button>
                <button type="button" disabled={acting} onClick={(e) => { e.stopPropagation(); void handleReject(); }}
                  style={{ padding: "2px 10px", fontSize: 11, fontWeight: 500, borderRadius: 5, border: "0.5px solid rgba(239,68,68,0.4)", background: "rgba(239,68,68,0.1)", color: "#f87171", cursor: acting ? "wait" : "pointer", opacity: acting ? 0.5 : 1 }}>
                  Reject
                </button>
              </div>
            ) : null}
          </div>
        </div>
        {/* Archive button */}
        <button type="button" onClick={(e) => { e.stopPropagation(); e.preventDefault(); onDismiss(event); }} title="Archive"
          style={{ position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)", width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 4, border: "none", background: hovered ? "rgba(120,113,108,0.15)" : "transparent", color: hovered ? "#78716c" : "transparent", cursor: "pointer", transition: "all 100ms", zIndex: 2 }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(120,113,108,0.3)"; e.currentTarget.style.color = "#d6d3d1"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = hovered ? "rgba(120,113,108,0.15)" : "transparent"; e.currentTarget.style.color = hovered ? "#78716c" : "transparent"; }}>
          <Archive size={12} />
        </button>
      </div>
    );
  }

  // Task / execution row
  const taskKey = event.taskKey ?? null;

  // Resolve avatar using the same shared component/source as the agent pages.
  // Inbox payload avatarUrl can drift from the currently selected agent avatar,
  // so prefer the canonical agent identity path here instead of rendering the
  // feed snapshot directly.
  const agentConfig = event.agentName ? (getAgentByAnyId(event.agentName) ?? (event.agentId ? getAgentByAnyId(event.agentId) : undefined)) : undefined;
  const avatarAgentId = event.agentId || event.agentName || undefined;
  const avatarUrl = event.avatarUrl || agentConfig?.avatar;

  // Failed execution two-line treatment (Paperclip-style, indented like approvals)
  if (isFailed) {
    const failBadge = { color: "#f87171", bg: "rgba(248,113,113,0.10)", border: "rgba(248,113,113,0.30)" };
    const isTimedOut = event.eventType === "execution.cancelled";

    const handleRetry = async () => {
      if (!event.agentId || acting) return;
      setActing(true);
      await wakeupAgent(event.agentId, {
        source: "explicit",
        reason: "retry_failed_run",
        payload: { taskId: event.taskId, taskKey: event.taskKey },
      });
      onRefresh();
      setActing(false);
    };

    const handleExit = async () => {
      if (!event.taskId || acting) return;
      setActing(true);
      try { await cancelTaskExecution({ taskId: event.taskId, targetStatus: "on-deck" }); } catch {}
      onRefresh();
      setActing(false);
    };

    // Error detail from event metadata
    const errorDetail = event.errorMessage || event.failureReason || (isTimedOut ? "Execution timed out" : null);

    return (
      <div
        style={{ position: "relative" }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <Link
          href={href}
          onClick={() => { if (isUnread) void onMarkThreadRead(event); }}
          style={{
            display: "flex", flexDirection: "column", gap: 2,
            padding: "8px 4px 8px 20px", paddingRight: 30,
            borderBottom: "0.5px solid rgba(120,113,108,0.08)",
            textDecoration: "none", transition: "background 100ms",
            background: hovered ? "rgba(255,255,255,0.025)" : "transparent",
          }}
        >
          {/* Primary line: unread dot + status + id + title + time */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: isUnread ? "#3b82f6" : "transparent", flexShrink: 0 }} />
            {visibleColumns.includes("status") && <StatusDot status={event.status} />}
            {visibleColumns.includes("id") && taskKey ? (
              <span style={{ fontSize: 12, color: "#78716c", flexShrink: 0, fontFamily: "var(--font-mono, monospace)" }}>{taskKey}</span>
            ) : null}
            <span style={{
              fontSize: 13, fontWeight: isUnread ? 500 : 400,
              color: "#fca5a5",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0,
            }}>
              {event.taskTitle ?? event.message}
            </span>
          </div>

          {/* Secondary line: fail badge + avatar + agent + error detail + time + actions */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: 14 }}>
            <span style={{
              display: "inline-flex", alignItems: "center",
              padding: "1px 7px", fontSize: 10, fontWeight: 600, borderRadius: 9999,
              border: `0.5px solid ${failBadge.border}`, background: failBadge.bg, color: failBadge.color,
              whiteSpace: "nowrap", lineHeight: "16px",
            }}>
              {verb}
            </span>
            {event.agentName && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                {avatarAgentId ? (
                  <AgentAvatar agentId={avatarAgentId} size={16} borderWidth={1} />
                ) : avatarUrl ? (
                  <img src={avatarUrl} alt={event.agentName} style={{ width: 16, height: 16, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                ) : (
                  <span style={{ width: 16, height: 16, borderRadius: "50%", background: "rgba(255,255,255,0.06)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 8, fontWeight: 700, color: P.textSecondary, flexShrink: 0 }}>
                    {event.agentName.slice(0, 1).toUpperCase()}
                  </span>
                )}
                <span style={{ fontSize: 11, color: "#a8a29e" }}>{event.agentName}</span>
              </span>
            )}
            {errorDetail && (
              <span style={{ fontSize: 11, color: "#78716c", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200 }} title={errorDetail}>
                — {errorDetail}
              </span>
            )}
            <span style={{ fontSize: 11, color: "#57534e" }}>{age} ago</span>

            {/* Retry + Exit actions */}
            <div style={{ display: "flex", gap: 4, marginLeft: "auto" }} onClick={(e) => e.preventDefault()}>
              {event.agentId && (
                <button type="button" disabled={acting} onClick={(e) => { e.stopPropagation(); e.preventDefault(); void handleRetry(); }}
                  style={{ padding: "2px 10px", fontSize: 11, fontWeight: 500, borderRadius: 5, border: `0.5px solid ${P.cardBorder}`, background: "transparent", color: P.textSecondary, cursor: acting ? "wait" : "pointer", opacity: acting ? 0.5 : 1, display: "inline-flex", alignItems: "center", gap: 4 }}>
                  ↻ Retry
                </button>
              )}
              {event.taskId && (
                <button type="button" disabled={acting} onClick={(e) => { e.stopPropagation(); e.preventDefault(); void handleExit(); }}
                  style={{ padding: "2px 8px", fontSize: 11, fontWeight: 500, borderRadius: 5, border: "0.5px solid rgba(120,113,108,0.25)", background: "transparent", color: "#78716c", cursor: acting ? "wait" : "pointer", opacity: acting ? 0.5 : 1 }}
                  title="Stop retrying — return task to on-deck">
                  ✕
                </button>
              )}
            </div>
          </div>
        </Link>
        {/* Archive button */}
        <button type="button" onClick={(e) => { e.stopPropagation(); e.preventDefault(); onDismiss(event); }} title="Archive"
          style={{ position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)", width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 4, border: "none", background: hovered ? "rgba(120,113,108,0.15)" : "transparent", color: hovered ? "#78716c" : "transparent", cursor: "pointer", transition: "all 100ms", zIndex: 2 }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(120,113,108,0.3)"; e.currentTarget.style.color = "#d6d3d1"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = hovered ? "rgba(120,113,108,0.15)" : "transparent"; e.currentTarget.style.color = hovered ? "#78716c" : "transparent"; }}>
          <Archive size={12} />
        </button>
      </div>
    );
  }

  // Normal task / execution row
  return (
    <div
      style={{ position: "relative" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Link
        href={href}
        onClick={() => { if (isUnread) void onMarkThreadRead(event); }}
        style={{
          display: "flex", alignItems: "center",
          padding: "9px 4px", paddingRight: 30,
          borderBottom: "0.5px solid rgba(120,113,108,0.08)",
          textDecoration: "none", transition: "background 100ms",
          background: hovered ? "rgba(255,255,255,0.025)" : "transparent",
        }}
      >
        {/* Left section */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0, overflow: "hidden" }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: isUnread ? "#3b82f6" : "transparent", flexShrink: 0 }} />
          {visibleColumns.includes("status") && <StatusDot status={event.status} />}
          {visibleColumns.includes("id") && taskKey ? (
            <span style={{ fontSize: 12, color: "#78716c", flexShrink: 0, fontFamily: "var(--font-mono, monospace)" }}>{taskKey}</span>
          ) : null}
          <span style={{
            fontSize: 13, color: isUnread ? "#f5f5f4" : "#d6d3d1",
            fontWeight: isUnread ? 500 : 400,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0,
          }}>
            {event.taskTitle ?? event.message}
          </span>
        </div>

        {/* Right section */}
        <div style={{ display: "flex", alignItems: "center", gap: 0, flexShrink: 0 }}>
          {showAssignee && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, width: 120, flexShrink: 0, paddingLeft: 8 }}>
              {event.agentName ? (
                <>
                  {avatarAgentId ? (
                    <AgentAvatar agentId={avatarAgentId} size={20} borderWidth={1} />
                  ) : avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={avatarUrl} alt={event.agentName} style={{ width: 20, height: 20, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                  ) : (
                    <span style={{
                      width: 20, height: 20, borderRadius: "50%",
                      background: "rgba(255,255,255,0.06)", border: `1px solid ${P.cardBorder}`,
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      fontSize: 9, fontWeight: 700, color: P.textSecondary, flexShrink: 0,
                    }}>
                      {event.agentName.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <span style={{ fontSize: 12, color: P.textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {event.agentName}
                  </span>
                </>
              ) : (
                <>
                  <span style={{
                    width: 20, height: 20, borderRadius: "50%",
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    border: `1px dashed ${P.cardBorder}`, color: P.textMuted, flexShrink: 0,
                  }}>
                    <User size={11} />
                  </span>
                  <span style={{ fontSize: 12, color: P.textMuted }}>Assignee</span>
                </>
              )}
            </span>
          )}
          {showProject && (
            <span style={{ width: 160, display: "inline-flex", alignItems: "center", justifyContent: "flex-start", gap: 5, fontSize: 11, color: "#78716c", paddingLeft: 8, overflow: "hidden", whiteSpace: "nowrap" }}>
              {event.projectName ? (
                <>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: hashStringToColor(event.projectName), flexShrink: 0 }} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{event.projectName}</span>
                </>
              ) : (
                <span style={{ color: "#57534e" }}>—</span>
              )}
            </span>
          )}
          {showType && (
            <span style={{
              width: 80, fontSize: 11, color: "#78716c",
              textAlign: "left", whiteSpace: "nowrap", paddingLeft: 8, textTransform: "capitalize",
            }}>
              {verb}
            </span>
          )}
          {showUpdated && (
            <span style={{ width: 90, fontSize: 11, color: "#57534e", textAlign: "right", whiteSpace: "nowrap", paddingLeft: 8 }}>
              {age} ago
            </span>
          )}
        </div>
      </Link>
      {/* Archive button */}
      <button type="button" onClick={(e) => { e.stopPropagation(); e.preventDefault(); onDismiss(event); }} title="Archive"
        style={{ position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)", width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 4, border: "none", background: hovered ? "rgba(120,113,108,0.15)" : "transparent", color: hovered ? "#78716c" : "transparent", cursor: "pointer", transition: "all 100ms", zIndex: 2 }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(120,113,108,0.3)"; e.currentTarget.style.color = "#d6d3d1"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = hovered ? "rgba(120,113,108,0.15)" : "transparent"; e.currentTarget.style.color = hovered ? "#78716c" : "transparent"; }}>
        <Archive size={12} />
      </button>
    </div>
  );
}
