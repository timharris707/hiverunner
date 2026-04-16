"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Copy, ExternalLink, Tag, Folder, Paperclip, Upload, RotateCcw, User, AtSign, Activity, Bot, Wrench, CheckCircle2, AlertCircle, MessageSquare, GitBranch, Clock } from "lucide-react";
import { color, space, radius, type as typeScale, font } from "@/lib/ui/tokens";
import { buildCompanyPath } from "@/lib/orchestration/route-paths";

import { CompanyErrorState } from "@/components/company/company-ui";
import { AvatarGlyph } from "@/components/orchestration/AvatarGlyph";
import { StatusCircle } from "@/components/orchestration/StatusCircle";
import { PRIORITY_META, STATUS_META } from "@/components/orchestration/task-display";
import {
  getTaskDetail,
  listCompanies,
  listCompanyAgents,
  listCompanyApprovals,
  listProjects,
  listTaskComments,
  addTaskComment,
  updateTaskStatus,
  updateTask,
  updateTaskAssignee,
} from "@/lib/orchestration/client";
import { InlineStatusPicker } from "@/components/tasks/InlineStatusPicker";
import { InlinePriorityPicker } from "@/components/tasks/InlinePriorityPicker";
import { InlineAssigneePicker, resolveAvatar } from "@/components/tasks/InlineAssigneePicker";
import { LaunchHenryLink } from "@/components/voice/LaunchHenryLink";
import { getAgentByAnyId } from "@/config/agents";
import { STATUS_LABEL, formatShortDate, assigneeInitials } from "@/components/tasks/types";
import type {
  OrchestrationAgent,
  OrchestrationCompany,
  OrchestrationProject,
  OrchestrationTask,
  OrchestrationApproval,
  OrchestrationTaskDetail,
  OrchestrationTaskTimelineItem,
  TaskStatus,
  TaskPriority,
} from "@/lib/orchestration/types";
import { useLiveRunStream, type StreamTranscriptEntry } from "@/hooks/useLiveRunStream";

type Comment = NonNullable<OrchestrationTask["comments"]>[number];

type Tab = "comments" | "subissues" | "activities";
type ExecutionSnapshot = {
  state: "running" | "completed" | "unknown" | "skipped";
  terminal: boolean;
  reason?: string;
  raw?: string;
  runId?: string;
  agentId?: string;
  sessionId?: string;
  polledAt: string;
} | null;

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  const hh = ((h + 11) % 12) + 1;
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}, ${hh}:${m} ${ampm}`;
}

function relativeAge(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.max(0, Math.floor(diff / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function timelineTone(entry: OrchestrationTaskTimelineItem): { bg: string; fg: string; border: string; label: string } {
  switch (entry.provenance) {
    case "comment":
      return { bg: "rgba(59,130,246,0.14)", fg: "#93c5fd", border: "rgba(59,130,246,0.28)", label: "Comment" };
    case "imported_report":
      return { bg: "rgba(168,85,247,0.14)", fg: "#d8b4fe", border: "rgba(168,85,247,0.28)", label: "Imported report" };
    case "approval_event":
      return { bg: "rgba(245,158,11,0.14)", fg: "#fcd34d", border: "rgba(245,158,11,0.28)", label: "Approval" };
    case "status_change":
      return { bg: "rgba(34,197,94,0.14)", fg: "#86efac", border: "rgba(34,197,94,0.28)", label: "Status" };
    case "run_event":
      return { bg: "rgba(217,119,6,0.14)", fg: "#fbbf24", border: "rgba(217,119,6,0.28)", label: "Run" };
    case "subtask_event":
      return { bg: "rgba(148,163,184,0.14)", fg: "#cbd5e1", border: "rgba(148,163,184,0.28)", label: "Subtask" };
    default:
      return { bg: "rgba(120,113,108,0.14)", fg: color.textMuted, border: "rgba(120,113,108,0.28)", label: "Event" };
  }
}

function timelineGlyph(entry: OrchestrationTaskTimelineItem) {
  switch (entry.provenance) {
    case "comment": return <MessageSquare size={11} />;
    case "imported_report": return <Paperclip size={11} />;
    case "approval_event": return <AlertCircle size={11} />;
    case "status_change": return <CheckCircle2 size={11} />;
    case "run_event": return <Bot size={11} />;
    case "subtask_event": return <GitBranch size={11} />;
    default: return <Clock size={11} />;
  }
}

/** Render text with task-key references (e.g. NEV-34) auto-linked. */
function LinkedText({ text, companySlug }: { text: string; companySlug: string }) {
  // Match task keys: 2-5 uppercase letters, dash, 1+ digits
  const parts = text.split(/(\b[A-Z]{2,5}-\d+\b)/g);
  if (parts.length === 1) return <>{text}</>;
  return (
    <>
      {parts.map((part, i) =>
        /^[A-Z]{2,5}-\d+$/.test(part) ? (
          <Link
            key={i}
            href={buildCompanyPath(companySlug, `/tasks/${encodeURIComponent(part)}`)}
            style={{ color: color.accent, textDecoration: "none", fontWeight: 500 }}
            onClick={(e) => e.stopPropagation()}
          >
            {part}
          </Link>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

/* ── Inbox review context ── */

type InboxContextItem = { taskKey: string; title: string };
type InboxContext = { items: InboxContextItem[]; inboxHref: string } | null;

const INBOX_CONTEXT_KEY = "mc:inbox:context";

function loadInboxContext(): InboxContext {
  try {
    const raw = sessionStorage.getItem(INBOX_CONTEXT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.items) && typeof parsed?.inboxHref === "string") return parsed;
  } catch {}
  return null;
}

export default function TaskDetailPage() {
  const params = useParams<{ slug: string; taskKey: string }>();
  const searchParams = useSearchParams();
  const slug = params?.slug ?? "";
  const taskKey = decodeURIComponent(params?.taskKey ?? "");
  const fromInbox = searchParams.get("from") === "inbox";

  // Inbox review context — loaded when ?from=inbox is present
  const inboxCtx = useMemo<InboxContext>(() => (fromInbox ? loadInboxContext() : null), [fromInbox]);
  const inboxNav = useMemo(() => {
    if (!inboxCtx) return null;
    const idx = inboxCtx.items.findIndex((item) => item.taskKey === taskKey);
    if (idx < 0) return { inboxHref: inboxCtx.inboxHref, prev: null, next: null, pos: 0, total: inboxCtx.items.length };
    const prev = idx > 0 ? inboxCtx.items[idx - 1] : null;
    const next = idx < inboxCtx.items.length - 1 ? inboxCtx.items[idx + 1] : null;
    return { inboxHref: inboxCtx.inboxHref, prev, next, pos: idx + 1, total: inboxCtx.items.length };
  }, [inboxCtx, taskKey]);

  const [company, setCompany] = useState<OrchestrationCompany | null>(null);
  const [project, setProject] = useState<OrchestrationProject | null>(null);
  const [task, setTask] = useState<OrchestrationTask | null>(null);
  const [agents, setAgents] = useState<OrchestrationAgent[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [taskDetail, setTaskDetail] = useState<OrchestrationTaskDetail | null>(null);
  const [linkedApprovals, setLinkedApprovals] = useState<OrchestrationApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activityTimeline, setActivityTimeline] = useState<OrchestrationTaskTimelineItem[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("comments");
  const [commentDraft, setCommentDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [propsOpen, setPropsOpen] = useState(true);
  const [copyHint, setCopyHint] = useState(false);
  const [reopenOnComment, setReopenOnComment] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [replyTarget, setReplyTarget] = useState<string | null>(null);
  const [replyPickerOpen, setReplyPickerOpen] = useState(false);
  const [execution, setExecution] = useState<ExecutionSnapshot>(null);
  const replyPickerRef = useRef<HTMLDivElement>(null);
  const dragCounter = useRef(0);

  const loadTask = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [companies, fetchedTaskDetail] = await Promise.all([
        listCompanies(),
        getTaskDetail(taskKey),
      ]);
      const curCompany = companies.find((c) => c.slug === slug) ?? null;
      setCompany(curCompany);
      if (!fetchedTaskDetail) {
        setError("Task not found.");
        setTask(null);
        setTaskDetail(null);
        return;
      }
      setTask(fetchedTaskDetail.task);
      setTaskDetail(fetchedTaskDetail.detail);
      setActivityTimeline(fetchedTaskDetail.detail.timeline);
      const [projectRows, agentRows, commentRows] = await Promise.all([
        listProjects({ company: slug }),
        curCompany ? listCompanyAgents(curCompany.slug) : Promise.resolve([]),
        listTaskComments(fetchedTaskDetail.task.id),
      ]);
      const proj = projectRows.find((p) => p.id === fetchedTaskDetail.task.project) ?? null;
      setProject(proj);
      setAgents(agentRows);
      setComments(commentRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load task.");
    } finally {
      setLoading(false);
    }
  }, [slug, taskKey]);

  useEffect(() => { void loadTask(); }, [loadTask]);

  // Unified task detail timeline now comes from the main task detail payload.
  useEffect(() => {
    if (activeTab !== "activities") return;
    setActivityLoading(false);
  }, [activeTab]);

  useEffect(() => {
    if (!task?.id) {
      setExecution(null);
      return;
    }

    let cancelled = false;

    const pollExecution = async () => {
      try {
        const res = await fetch(`/api/orchestration/tasks/${encodeURIComponent(task.id)}/execution`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setExecution({
          state: data?.status?.state ?? "unknown",
          terminal: Boolean(data?.status?.terminal),
          reason: data?.status?.reason,
          raw: data?.status?.raw,
          runId: data?.runId ?? undefined,
          agentId: data?.agentId ?? undefined,
          sessionId: data?.sessionId ?? undefined,
          polledAt: data?.polledAt ?? new Date().toISOString(),
        });
      } catch {
        if (!cancelled) {
          setExecution((prev) => prev ?? {
            state: "unknown",
            terminal: false,
            polledAt: new Date().toISOString(),
          });
        }
      }
    };

    void pollExecution();
    const interval = window.setInterval(() => { void pollExecution(); }, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [task?.id]);

  useEffect(() => {
    if (!task?.id || !slug) {
      setLinkedApprovals([]);
      return;
    }

    let cancelled = false;

    const pollApprovals = async () => {
      try {
        const approvals = await listCompanyApprovals({
          companySlug: slug,
          linkedTaskId: task.id,
        });
        if (!cancelled) {
          setLinkedApprovals(approvals);
        }
      } catch {
        if (!cancelled) {
          setLinkedApprovals([]);
        }
      }
    };

    void pollApprovals();
    const interval = window.setInterval(() => { void pollApprovals(); }, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [slug, task?.id]);

  const assignedAgent = useMemo(() => {
    const preferredAgentId = execution?.agentId;
    if (preferredAgentId) {
      const matched = agents.find((agent) => agent.id === preferredAgentId) ?? null;
      if (matched) return matched;
    }

    if (!task?.assignee) return null;
    return agents.find((agent) =>
      agent.id === task.assignee ||
      agent.name === task.assignee ||
      agent.slug === task.assignee
    ) ?? null;
  }, [agents, execution?.agentId, task?.assignee]);

  const voiceLaunchAgent = useMemo(() => {
    if (!task?.assignee) return null;
    return agents.find((agent) =>
      agent.id === task.assignee ||
      agent.name === task.assignee ||
      agent.slug === task.assignee
    ) ?? null;
  }, [agents, task?.assignee]);

  const liveActivityEnabled = Boolean(slug && execution?.state === "running" && assignedAgent?.id);
  const { streamByAgentId, connected: liveActivityConnected } = useLiveRunStream({
    companySlug: slug,
    enabled: liveActivityEnabled,
  });
  const rawLiveAgentStream = assignedAgent?.id ? streamByAgentId.get(assignedAgent.id) : undefined;
  const liveAgentStream = useMemo(() => {
    if (!rawLiveAgentStream) return undefined;
    if (!execution?.runId) return rawLiveAgentStream;
    if (rawLiveAgentStream.runId && rawLiveAgentStream.runId !== execution.runId) return undefined;

    const filteredEvents = rawLiveAgentStream.events.filter((event) => !event.runId || event.runId === execution.runId);
    return {
      ...rawLiveAgentStream,
      events: filteredEvents,
    };
  }, [execution?.runId, rawLiveAgentStream]);

  /* ── Mutations ── */

  const onStatusChange = useCallback(async (_id: string, status: TaskStatus) => {
    if (!task) return;
    setTask({ ...task, status, updated: new Date().toISOString() });
    await updateTaskStatus(task.id, status);
  }, [task]);

  const onPriorityChange = useCallback(async (_id: string, priority: TaskPriority) => {
    if (!task) return;
    setTask({ ...task, priority, updated: new Date().toISOString() });
    await updateTask({ taskId: task.id, priority });
  }, [task]);

  const onAssigneeChange = useCallback(async (_id: string, assignee: string) => {
    if (!task) return;
    setTask({ ...task, assignee: assignee || undefined, updated: new Date().toISOString() });
    await updateTaskAssignee(task.id, assignee);
  }, [task]);

  const onSubmitComment = useCallback(async () => {
    if (!task || !commentDraft.trim() || posting) return;
    setPosting(true);
    const ok = await addTaskComment(task.id, commentDraft.trim());
    if (ok) {
      setCommentDraft("");
      // Reopen if checked
      if (reopenOnComment && (task.status === "done" || task.status === "cancelled")) {
        await updateTaskStatus(task.id, "backlog");
        setTask((prev) => prev ? { ...prev, status: "backlog" as TaskStatus, updated: new Date().toISOString() } : prev);
        setReopenOnComment(false);
      }
      // Reassign to reply target if different from current assignee
      if (replyTarget && replyTarget !== task.assignee) {
        await updateTaskAssignee(task.id, replyTarget);
        setTask((prev) => prev ? { ...prev, assignee: replyTarget, updated: new Date().toISOString() } : prev);
      }
      const refreshed = await listTaskComments(task.id);
      setComments(refreshed);
    }
    setPosting(false);
  }, [task, commentDraft, posting, reopenOnComment, replyTarget]);

  const handleFileUpload = useCallback(async (file: File) => {
    if (!task || uploading) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("taskId", task.id);
      const res = await fetch("/api/tasks/attachments", { method: "POST", body: formData });
      if (res.ok) {
        await addTaskComment(task.id, `Uploaded file: ${file.name}`);
        const refreshed = await listTaskComments(task.id);
        setComments(refreshed);
      }
    } finally {
      setUploading(false);
    }
  }, [task, uploading]);

  const copyKey = useCallback(() => {
    if (!task) return;
    const text = `${task.key ?? task.id.slice(0, 8).toUpperCase()}: ${task.title}`;
    void navigator.clipboard.writeText(text);
    setCopyHint(true);
    setTimeout(() => setCopyHint(false), 1500);
  }, [task]);

  /* ── Render ── */

  if (!loading && !task) {
    return (
      <CompanyErrorState
        title={error ?? "Task not found"}
        detail="This task could not be resolved. It may have been archived."
        href={`/companies/${encodeURIComponent(slug)}/tasks`}
      />
    );
  }

  const companyCode = company?.code ?? slug.slice(0, 3).toUpperCase();
  const tasksHref = `/${encodeURIComponent(companyCode.toUpperCase())}/tasks`;
  const priorityMeta = task ? PRIORITY_META[task.priority] : null;
  const statusMeta = task ? STATUS_META[task.status] : null;
  const pendingLinkedApprovals = linkedApprovals.filter((approval) => approval.status === "pending" || approval.status === "revision_requested");
  const runStateLabel =
    execution?.state === "completed" && pendingLinkedApprovals.length > 0
      ? "Awaiting approval"
      : execution?.state === "running"
        ? "Running"
        : execution?.state === "completed"
          ? "Completed"
          : execution?.state;
  const runStateColor =
    execution?.state === "completed" && pendingLinkedApprovals.length > 0
      ? "#fbbf24"
      : execution?.state === "running"
        ? "#22c55e"
        : execution?.state === "completed"
          ? color.textMuted
          : "#f87171";

  return (
    <div
      style={{ display: "flex", height: "100%", background: color.bg, color: color.text, position: "relative" }}
      onDragEnter={(e) => {
        e.preventDefault();
        dragCounter.current++;
        if (e.dataTransfer.types.includes("Files")) setDragOver(true);
      }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
      onDragLeave={(e) => {
        e.preventDefault();
        dragCounter.current--;
        if (dragCounter.current <= 0) { setDragOver(false); dragCounter.current = 0; }
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        dragCounter.current = 0;
        const file = e.dataTransfer.files?.[0];
        if (file) void handleFileUpload(file);
      }}
    >
      {/* ── Drag overlay ── */}
      {dragOver && (
        <div style={{
          position: "absolute", inset: 0, zIndex: 100,
          background: "rgba(217,119,6,0.06)",
          border: "2px dashed rgba(217,119,6,0.4)",
          borderRadius: 12,
          display: "flex", alignItems: "center", justifyContent: "center",
          pointerEvents: "none",
        }}>
          <div style={{
            padding: "16px 32px", borderRadius: 10,
            background: "rgba(26,24,20,0.95)", border: "0.5px solid rgba(217,119,6,0.3)",
            display: "flex", alignItems: "center", gap: 10,
          }}>
            <Upload size={18} color="#f59e0b" />
            <span style={{ fontSize: 14, fontWeight: 600, color: "#f59e0b" }}>Drop file to attach</span>
          </div>
        </div>
      )}

      {/* ── Main column ── */}
      <div style={{ flex: 1, overflowY: "auto", padding: `${space.xl}px ${space.xxxl}px 64px`, minWidth: 0 }}>
        {loading ? (
          <div style={{ padding: "48px 0", textAlign: "center", fontSize: typeScale.bodySmall.size, color: color.textMuted }}>
            Loading task…
          </div>
        ) : task && (
          <>
            {/* ── Inbox review context bar ── */}
            {inboxNav && (
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: `${space.sm}px ${space.md}px`,
                marginBottom: space.lg,
                borderRadius: radius.md,
                border: `0.5px solid ${color.border}`,
                background: color.surface,
              }}>
                <Link
                  href={inboxNav.inboxHref}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: space.xs,
                    fontSize: typeScale.bodySmall.size, fontWeight: 500,
                    color: color.textSecondary, textDecoration: "none",
                  }}
                >
                  <ArrowLeft size={14} />
                  Back to Inbox
                </Link>

                <div style={{ display: "flex", alignItems: "center", gap: space.md }}>
                  {inboxNav.total > 0 && (
                    <span style={{ fontSize: typeScale.caption.size, color: color.textMuted }}>
                      {inboxNav.pos} of {inboxNav.total}
                    </span>
                  )}
                  <div style={{ display: "flex", gap: space.xs }}>
                    {inboxNav.prev ? (
                      <Link
                        href={buildCompanyPath(slug, `/tasks/${encodeURIComponent(inboxNav.prev.taskKey)}?from=inbox`)}
                        title={inboxNav.prev.title}
                        style={{
                          display: "inline-flex", alignItems: "center", justifyContent: "center",
                          width: 28, height: 28, borderRadius: radius.sm,
                          border: `0.5px solid ${color.border}`, background: "transparent",
                          color: color.textSecondary, textDecoration: "none",
                        }}
                      >
                        <ChevronLeft size={14} />
                      </Link>
                    ) : (
                      <span style={{
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                        width: 28, height: 28, borderRadius: radius.sm,
                        border: `0.5px solid ${color.border}`, background: "transparent",
                        color: color.textMuted, opacity: 0.4,
                      }}>
                        <ChevronLeft size={14} />
                      </span>
                    )}
                    {inboxNav.next ? (
                      <Link
                        href={buildCompanyPath(slug, `/tasks/${encodeURIComponent(inboxNav.next.taskKey)}?from=inbox`)}
                        title={inboxNav.next.title}
                        style={{
                          display: "inline-flex", alignItems: "center", justifyContent: "center",
                          width: 28, height: 28, borderRadius: radius.sm,
                          border: `0.5px solid ${color.border}`, background: "transparent",
                          color: color.textSecondary, textDecoration: "none",
                        }}
                      >
                        <ChevronRight size={14} />
                      </Link>
                    ) : (
                      <span style={{
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                        width: 28, height: 28, borderRadius: radius.sm,
                        border: `0.5px solid ${color.border}`, background: "transparent",
                        color: color.textMuted, opacity: 0.4,
                      }}>
                        <ChevronRight size={14} />
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Breadcrumbs */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: typeScale.bodySmall.size, color: color.textMuted, marginBottom: space.lg }}>
              <Link href={tasksHref} style={{ color: color.textMuted, textDecoration: "none" }}>Tasks</Link>
              <ChevronRight size={12} color={color.textMuted} style={{ opacity: 0.5 }} />
              <span style={{ color: color.textSecondary, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {task.title}
              </span>
            </div>

            {taskDetail?.parentTask && (
              <Link
                href={buildCompanyPath(slug, `/tasks/${encodeURIComponent(taskDetail.parentTask.key ?? taskDetail.parentTask.id)}`)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  marginBottom: space.md,
                  padding: "10px 12px",
                  borderRadius: radius.md,
                  border: `0.5px solid ${color.border}`,
                  background: "rgba(255,255,255,0.03)",
                  textDecoration: "none",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: typeScale.caption.size, color: color.textMuted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2 }}>
                    Parent task
                  </div>
                  <div style={{ fontSize: typeScale.bodySmall.size, color: color.textSecondary, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {taskDetail.parentTask.key ? `${taskDetail.parentTask.key} · ${taskDetail.parentTask.title}` : taskDetail.parentTask.title}
                  </div>
                </div>
                <div style={{ fontSize: 11, color: color.textMuted, flexShrink: 0 }}>
                  {STATUS_LABEL[taskDetail.parentTask.status] ?? taskDetail.parentTask.status}
                </div>
              </Link>
            )}

            {/* Meta row: status, priority, key, project */}
            <div style={{ display: "flex", alignItems: "center", gap: space.md, marginBottom: space.md }}>
              <StatusCircle status={task.status} size={16} />
              {priorityMeta && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: space.xs, fontSize: typeScale.bodySmall.size, color: priorityMeta.color }}>
                  <span style={{ fontSize: 13, lineHeight: 1 }}>{priorityMeta.icon}</span>
                  {priorityMeta.label}
                </span>
              )}
              <span style={{ fontSize: typeScale.mono.size, color: color.textMuted, fontFamily: font.mono, whiteSpace: "nowrap", flexShrink: 0 }}>
                {task.key ?? task.id.slice(0, 8).toUpperCase()}
              </span>
              {project && (
                <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: radius.full, background: project.color }} />
                  <span style={{ fontSize: typeScale.bodySmall.size, color: color.textMuted }}>{project.name}</span>
                </div>
              )}
              <button
                type="button"
                onClick={copyKey}
                title="Copy task ID and title"
                style={{
                  marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: space.xs,
                  padding: `${space.xs}px ${space.sm}px`, fontSize: typeScale.caption.size, color: color.textMuted,
                  background: "transparent", border: `0.5px solid ${color.border}`, borderRadius: radius.sm,
                  cursor: "pointer",
                }}
              >
                <Copy size={12} />
                {copyHint ? "Copied" : "Copy"}
              </button>
            </div>

            {/* Title */}
            <h1 style={{
              fontSize: typeScale.metric.size, fontWeight: 700, color: color.text, margin: `0 0 ${space.lg}px 0`,
              letterSpacing: "-0.01em", lineHeight: 1.25,
            }}>
              {task.title}
            </h1>

            {/* Description */}
            {task.description && (
              <div style={{
                fontSize: typeScale.body.size, color: color.textSecondary, lineHeight: 1.65,
                whiteSpace: "pre-wrap", wordBreak: "break-word",
                paddingBottom: space.xl, borderBottom: `0.5px solid ${color.border}`,
              }}>
                <LinkedText text={task.description} companySlug={slug} />
              </div>
            )}

            {taskDetail?.runSummary && (
              <div style={{
                display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16, marginBottom: 16,
                padding: "10px 12px", borderRadius: radius.md,
                border: `0.5px solid ${color.border}`, background: "rgba(255,255,255,0.02)",
              }}>
                <span style={{ fontSize: 11, color: color.textMuted }}>Runs {taskDetail.runSummary.totalRuns}</span>
                <span style={{ fontSize: 11, color: color.textMuted }}>Structured actions {taskDetail.runSummary.structuredActionCount}</span>
                <span style={{ fontSize: 11, color: color.textMuted }}>Imported reports {taskDetail.runSummary.importedReportCount}</span>
                {taskDetail.runSummary.latestRun && (
                  <span style={{ fontSize: 11, color: color.textSecondary }}>
                    Latest {taskDetail.runSummary.latestRun.provider} {taskDetail.runSummary.latestRun.status}
                  </span>
                )}
                {taskDetail.runSummary.activeRun && (
                  <span style={{ fontSize: 11, color: "#f59e0b", fontWeight: 600 }}>
                    Active run {taskDetail.runSummary.activeRun.status}
                  </span>
                )}
              </div>
            )}

            {execution?.state === "running" && assignedAgent && (
              <LiveActivityPanel
                agentName={assignedAgent.name}
                agentEmoji={assignedAgent.emoji}
                connected={liveActivityConnected}
                sessionId={execution.sessionId}
                streamText={liveAgentStream?.streamingText ?? ""}
                events={liveAgentStream?.events ?? []}
              />
            )}

            {/* Action buttons row */}
            <div style={{ display: "flex", gap: "10px", margin: "16px 0", flexWrap: "wrap" }}>
              <LaunchHenryLink
                label="Talk to Agent"
                companySlug={slug}
                projectId={project?.id ?? task.project}
                projectSlug={project?.slug}
                taskId={task.id}
                taskKey={task.key ?? taskKey}
                agentId={voiceLaunchAgent?.id}
                mode="discuss"
                source="task-detail"
              />
              <label
                style={{
                  display: "inline-flex", alignItems: "center", gap: "6px",
                  padding: "8px 14px", borderRadius: "8px",
                  border: `0.5px solid ${color.border}`, background: "transparent",
                  color: color.textSecondary, fontSize: "12px", fontWeight: 500,
                  cursor: uploading ? "wait" : "pointer",
                  opacity: uploading ? 0.5 : 1,
                }}
              >
                <Upload size={14} />
                {uploading ? "Uploading…" : "Upload attachment"}
                <input
                  type="file"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleFileUpload(f);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>

            {/* Tabs */}
            <div style={{
              display: "flex", gap: "0", marginTop: "24px",
              borderBottom: `0.5px solid ${color.border}`,
            }}>
              {([
                ["comments", "Comments", MessageSquare] as const,
                ["subissues", "Sub-Issues", GitBranch] as const,
                ["activities", "Activity", Clock] as const,
              ]).map(([key, label, TabIcon]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActiveTab(key as Tab)}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 5,
                    padding: "10px 16px", background: "transparent", border: "none",
                    borderBottom: activeTab === key ? `2px solid ${color.accent}` : "2px solid transparent",
                    marginBottom: "-1px", cursor: "pointer",
                    fontSize: typeScale.bodySmall.size, fontWeight: 500,
                    color: activeTab === key ? color.text : color.textMuted,
                  }}
                >
                  <TabIcon size={13} color={activeTab === key ? color.text : color.textMuted} />
                  {label}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div style={{ paddingTop: "16px" }}>
              {activeTab === "activities" && (
                <div style={{ fontSize: "12px", color: color.textMuted }}>
                  {execution && execution.state !== "unknown" && execution.runId && (
                    <div style={{
                      display: "flex", alignItems: "center", gap: 8,
                      padding: "8px 12px", marginBottom: 12, borderRadius: radius.md,
                      border: `0.5px solid ${color.border}`, background: "rgba(255,255,255,0.02)",
                      fontSize: 11, color: color.textMuted,
                    }}>
                      <span style={{
                        width: 5, height: 5, borderRadius: "50%",
                        background: runStateColor,
                        animation: execution.state === "running" ? "pulse 1.5s ease-in-out infinite" : undefined,
                        flexShrink: 0,
                      }} />
                      <span style={{ fontWeight: 500 }}>
                        {runStateLabel}
                      </span>
                      <span style={{ fontFamily: font.mono, fontSize: 10 }}>{execution.runId.slice(0, 8)}</span>
                      {execution.sessionId && (
                        <span style={{ fontFamily: font.mono, fontSize: 10, color: color.textMuted }}>
                          session {execution.sessionId.slice(0, 8)}
                        </span>
                      )}
                    </div>
                  )}
                  {pendingLinkedApprovals.length > 0 && (
                    <div
                      style={{
                        display: "flex",
                        gap: 10,
                        alignItems: "flex-start",
                        padding: "12px 14px",
                        marginBottom: 14,
                        borderRadius: 10,
                        border: "0.5px solid rgba(251,191,36,0.28)",
                        background: "rgba(251,191,36,0.08)",
                      }}
                    >
                      <AlertCircle size={15} color="#fbbf24" style={{ marginTop: 1, flexShrink: 0 }} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "#fcd34d", marginBottom: 4 }}>
                          {pendingLinkedApprovals.length} approval{pendingLinkedApprovals.length === 1 ? "" : "s"} requested
                        </div>
                        <div style={{ fontSize: 12, color: color.textSecondary, lineHeight: 1.5 }}>
                          {assignedAgent?.name ?? "This agent"} finished the current pass and is waiting on operator review before these hires appear under Agents.
                        </div>
                        <div style={{ fontSize: 12, color: color.textMuted, marginTop: 6, lineHeight: 1.5 }}>
                          {pendingLinkedApprovals.map((approval) => {
                            const name = typeof approval.payload.name === "string" ? approval.payload.name : "Unnamed agent";
                            const role = typeof approval.payload.role === "string" ? approval.payload.role : approval.type;
                            return `${name} (${role})`;
                          }).join(" • ")}
                        </div>
                        <div style={{ marginTop: 8 }}>
                          <Link
                            href={buildCompanyPath(slug, "/approvals/pending")}
                            style={{ color: "#fcd34d", fontSize: 12, fontWeight: 600, textDecoration: "none" }}
                          >
                            Review pending approvals
                          </Link>
                        </div>
                      </div>
                    </div>
                  )}
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: color.text, marginBottom: 4 }}>
                      Unified timeline
                    </div>
                    <div style={{ fontSize: 11, color: color.textMuted, lineHeight: 1.5 }}>
                      This is the primary task narrative, merged from comments, task events, approvals, run lifecycle, and linked subtasks.
                    </div>
                  </div>
                  {activityLoading && activityTimeline.length === 0 ? (
                    <div style={{ padding: "16px 0", textAlign: "center", color: color.textMuted }}>Loading timeline...</div>
                  ) : activityTimeline.length === 0 ? (
                    <div style={{ padding: "16px 0", textAlign: "center", color: color.textMuted }}>No timeline activity recorded yet.</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                      {taskDetail?.runSummary && (
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", paddingBottom: 12, marginBottom: 8, borderBottom: `0.5px solid ${color.border}` }}>
                          <span style={{ fontSize: 10, color: color.textMuted }}>Runs: {taskDetail.runSummary.totalRuns}</span>
                          <span style={{ fontSize: 10, color: color.textMuted }}>Actions: {taskDetail.runSummary.structuredActionCount}</span>
                          <span style={{ fontSize: 10, color: color.textMuted }}>Imported reports: {taskDetail.runSummary.importedReportCount}</span>
                          {taskDetail.runSummary.activeRun && <span style={{ fontSize: 10, color: "#f59e0b" }}>Active: {taskDetail.runSummary.activeRun.status}</span>}
                        </div>
                      )}
                      {activityTimeline.map((entry) => {
                        const tone = timelineTone(entry);
                        return (
                          <div
                            key={entry.id}
                            style={{
                              display: "flex", gap: "10px", padding: "10px 0",
                              borderBottom: `0.5px solid ${color.border}`,
                            }}
                          >
                            <div style={{ width: 24, flexShrink: 0, display: "flex", justifyContent: "center", paddingTop: 2 }}>
                              <span style={{
                                width: 22, height: 22, borderRadius: "50%",
                                background: tone.bg,
                                border: `0.5px solid ${tone.border}`,
                                display: "inline-flex", alignItems: "center", justifyContent: "center",
                                color: tone.fg,
                              }}>
                                {timelineGlyph(entry)}
                              </span>
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                                <span style={{
                                  fontSize: 10,
                                  color: tone.fg,
                                  background: tone.bg,
                                  border: `0.5px solid ${tone.border}`,
                                  borderRadius: 999,
                                  padding: "2px 6px",
                                  textTransform: "uppercase",
                                  letterSpacing: "0.04em",
                                }}>
                                  {tone.label}
                                </span>
                                {entry.actorLabel && (
                                  <span style={{ fontWeight: 600, color: color.textSecondary, fontSize: 11 }}>{entry.actorLabel}</span>
                                )}
                                <span style={{ color: color.text, fontSize: 11 }}>{entry.summary}</span>
                                <span style={{ marginLeft: "auto", fontSize: 10, color: color.textMuted, flexShrink: 0 }} title={formatTimestamp(entry.timestamp)}>
                                  {relativeAge(entry.timestamp)}
                                </span>
                              </div>
                              {entry.body && (
                                <div style={{
                                  marginTop: 6, padding: "8px 10px", borderRadius: 6,
                                  background: "rgba(255,255,255,0.02)",
                                  border: `0.5px solid ${color.border}`,
                                  fontSize: 11, color: color.textSecondary,
                                  lineHeight: 1.4, whiteSpace: "pre-wrap", wordBreak: "break-word",
                                }}>
                                  <LinkedText text={entry.body} companySlug={slug} />
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
              {activeTab === "comments" && (
                <>
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: "13px", fontWeight: 600, color: color.text, marginBottom: "4px" }}>
                      Comments ({comments.length})
                    </div>
                    <div style={{ fontSize: 11, color: color.textMuted, lineHeight: 1.5 }}>
                      Discussion stays here, but the merged timeline is now the default surface for reconstructing task truth.
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "20px" }}>
                    {comments.length === 0 ? (
                      <div style={{ padding: "16px 0", fontSize: "12px", color: color.textMuted, textAlign: "center" }}>
                        {pendingLinkedApprovals.length > 0
                          ? "Execution completed and is waiting on approval. Review the pending approvals to continue."
                          : "No comments yet."}
                      </div>
                    ) : (
                      comments.map((c) => (
                        <div
                          key={c.id}
                          style={{
                            padding: "12px 14px", borderRadius: "8px",
                            border: `0.5px solid ${color.border}`, background: color.surface,
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                            {(() => {
                              const commentAgent = agents.find((a) => a.name === c.author || a.slug === c.author);
                              const avatarUrl = commentAgent ? resolveAvatar(commentAgent) : (getAgentByAnyId(c.author)?.avatar ?? undefined);
                              if (avatarUrl) {
                                return (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={avatarUrl} alt={c.author} style={{
                                    width: 22, height: 22, borderRadius: "50%", objectFit: "cover", flexShrink: 0,
                                  }} />
                                );
                              }
                              const emoji = commentAgent?.emoji;
                              return (
                                <span style={{
                                  width: 22, height: 22, borderRadius: "50%",
                                  background: emoji ? "rgba(217,119,6,0.18)" : "rgba(120,113,108,0.25)",
                                  border: emoji ? "none" : "0.5px solid rgba(120,113,108,0.15)",
                                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                                  fontSize: emoji ? 12 : 9, fontWeight: 700,
                                  color: emoji ? "#fbbf24" : color.textSecondary,
                                }}>
                                  {emoji ? <AvatarGlyph value={emoji} size={12} /> : assigneeInitials(c.author)}
                                </span>
                              );
                            })()}
                            <span style={{ fontSize: "12px", fontWeight: 600, color: color.text }}>{c.author}</span>
                            <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
                              <span style={{ fontSize: "11px", color: color.textMuted }}>
                                {formatTimestamp(c.timestamp)}
                              </span>
                              <button
                                type="button"
                                title="Copy comment"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void navigator.clipboard.writeText(c.text);
                                }}
                                style={{
                                  background: "transparent", border: "none", cursor: "pointer",
                                  padding: 2, color: color.textMuted, opacity: 0.5,
                                  display: "inline-flex", alignItems: "center",
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
                                onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.5"; }}
                              >
                                <Copy size={11} />
                              </button>
                            </span>
                          </div>
                          <div style={{ fontSize: "13px", color: color.textSecondary, whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.5 }}>
                            <LinkedText text={c.text} companySlug={slug} />
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  {/* Comment composer */}
                  <div style={{
                    border: `0.5px solid ${color.border}`, borderRadius: "8px",
                    background: "rgba(41,37,36,0.3)", padding: "10px",
                  }}>
                    <textarea
                      value={commentDraft}
                      onChange={(e) => setCommentDraft(e.target.value)}
                      placeholder="Leave a comment..."
                      rows={3}
                      onKeyDown={(e) => {
                        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                          e.preventDefault();
                          void onSubmitComment();
                        }
                      }}
                      style={{
                        width: "100%", background: "transparent", border: "none", resize: "vertical",
                        color: color.text, fontSize: "13px", outline: "none", fontFamily: "inherit",
                        minHeight: "56px",
                      }}
                    />
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "6px" }}>
                      {/* Attachment icon */}
                      <label style={{ cursor: "pointer", display: "inline-flex", padding: "4px" }}>
                        <Paperclip size={14} color={color.textMuted} />
                        <input
                          type="file"
                          style={{ display: "none" }}
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) void handleFileUpload(f);
                            e.target.value = "";
                          }}
                        />
                      </label>

                      <div style={{ flex: 1 }} />

                      {/* Reply target picker */}
                      {agents.length > 0 && (
                        <div ref={replyPickerRef} style={{ position: "relative" }}>
                          <button
                            type="button"
                            onClick={() => setReplyPickerOpen((p) => !p)}
                            style={{
                              display: "inline-flex", alignItems: "center", gap: "4px",
                              padding: "4px 8px", borderRadius: "6px", fontSize: "11px",
                              border: `0.5px solid ${replyTarget ? "rgba(217,119,6,0.4)" : color.border}`,
                              background: replyTarget ? "rgba(217,119,6,0.08)" : "transparent",
                              color: replyTarget ? "#f59e0b" : color.textSecondary,
                              cursor: "pointer",
                            }}
                          >
                            <AtSign size={11} />
                            {replyTarget
                              ? agents.find((a) => a.name === replyTarget || a.slug === replyTarget)?.name ?? replyTarget
                              : "Assign"}
                          </button>
                          {replyPickerOpen && (
                            <>
                              <div
                                style={{ position: "fixed", inset: 0, zIndex: 98 }}
                                onClick={() => setReplyPickerOpen(false)}
                              />
                              <div style={{
                                position: "absolute", bottom: "calc(100% + 4px)", right: 0,
                                background: "var(--surface-elevated)", border: `0.5px solid ${color.border}`,
                                borderRadius: 8, padding: "4px 0", minWidth: 160,
                                boxShadow: "0 8px 24px rgba(0,0,0,0.5)", zIndex: 99,
                              }}>
                                <button
                                  type="button"
                                  onClick={() => { setReplyTarget(null); setReplyPickerOpen(false); }}
                                  style={{
                                    display: "block", width: "100%", padding: "7px 12px",
                                    fontSize: 12, color: !replyTarget ? color.text : color.textSecondary,
                                    background: !replyTarget ? "rgba(255,255,255,0.05)" : "transparent",
                                    border: "none", cursor: "pointer", textAlign: "left",
                                  }}
                                >
                                  No assignment change
                                </button>
                                {agents.map((a) => {
                                  const selected = replyTarget === a.name;
                                  return (
                                    <button
                                      key={a.id}
                                      type="button"
                                      onClick={() => { setReplyTarget(a.name); setReplyPickerOpen(false); }}
                                      style={{
                                        display: "flex", alignItems: "center", gap: "6px",
                                        width: "100%", padding: "7px 12px",
                                        fontSize: 12, color: selected ? color.text : color.textSecondary,
                                        background: selected ? "rgba(255,255,255,0.05)" : "transparent",
                                        border: "none", cursor: "pointer", textAlign: "left",
                                      }}
                                      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; }}
                                      onMouseLeave={(e) => { e.currentTarget.style.background = selected ? "rgba(255,255,255,0.05)" : "transparent"; }}
                                    >
                                      {(() => {
                                        const av = resolveAvatar(a);
                                        return av
                                          // eslint-disable-next-line @next/next/no-img-element
                                          ? <img src={av} alt="" style={{ width: 16, height: 16, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                                          : <AvatarGlyph value={a.emoji} size={13} />;
                                      })()}
                                      {a.name}
                                    </button>
                                  );
                                })}
                              </div>
                            </>
                          )}
                        </div>
                      )}

                      {/* Re-open toggle — show when task is done or cancelled */}
                      {(task.status === "done" || task.status === "cancelled") && (
                        <label style={{
                          display: "inline-flex", alignItems: "center", gap: "5px",
                          fontSize: "11px", color: color.textSecondary, cursor: "pointer",
                          padding: "4px 8px", borderRadius: "6px",
                          border: `0.5px solid ${reopenOnComment ? "rgba(59,130,246,0.4)" : color.border}`,
                          background: reopenOnComment ? "rgba(59,130,246,0.08)" : "transparent",
                        }}>
                          <input
                            type="checkbox"
                            checked={reopenOnComment}
                            onChange={(e) => setReopenOnComment(e.target.checked)}
                            style={{
                              appearance: "none",
                              WebkitAppearance: "none",
                              width: 13, height: 13, borderRadius: 3, flexShrink: 0,
                              border: `1.5px solid ${reopenOnComment ? "#3b82f6" : "rgba(120,113,108,0.5)"}`,
                              background: reopenOnComment ? "#3b82f6" : "transparent",
                              cursor: "pointer",
                            }}
                          />
                          <RotateCcw size={11} />
                          Re-open
                        </label>
                      )}

                      <span style={{ fontSize: "10px", color: color.textMuted }}>
                        ⌘ + Enter
                      </span>
                      <button
                        type="button"
                        onClick={() => void onSubmitComment()}
                        disabled={!commentDraft.trim() || posting}
                        style={{
                          padding: "6px 12px", fontSize: "12px", fontWeight: 600,
                          background: commentDraft.trim() && !posting ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.03)",
                          color: commentDraft.trim() && !posting ? color.text : color.textMuted,
                          border: `0.5px solid ${color.border}`, borderRadius: "6px",
                          cursor: commentDraft.trim() && !posting ? "pointer" : "default",
                        }}
                      >
                        {posting ? "Posting…" : "Comment"}
                      </button>
                    </div>
                  </div>
                </>
              )}
              {activeTab === "subissues" && (
                taskDetail?.childTasks && taskDetail.childTasks.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {taskDetail.childTasks.map((child) => (
                      <Link
                        key={child.id}
                        href={buildCompanyPath(slug, `/tasks/${encodeURIComponent(child.key ?? child.id)}`)}
                        style={{
                          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
                          padding: "10px 12px", borderRadius: 8, textDecoration: "none",
                          border: `0.5px solid ${color.border}`, background: "rgba(255,255,255,0.02)",
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: color.textSecondary }}>
                            {child.key ? `${child.key} · ${child.title}` : child.title}
                          </div>
                          <div style={{ fontSize: 11, color: color.textMuted }}>
                            {STATUS_LABEL[child.status] ?? child.status} · {child.priority} · {child.assignee ?? "Unassigned"}
                          </div>
                        </div>
                        <div style={{ fontSize: 10, color: color.textMuted, flexShrink: 0 }}>
                          {relativeAge(child.updated)}
                        </div>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <div style={{ padding: "24px 0", fontSize: "12px", color: color.textMuted, textAlign: "center" }}>
                    No sub-tasks.
                  </div>
                )
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Properties panel ── */}
      {propsOpen && task && (
        <aside style={{
          width: 280, flexShrink: 0,
          margin: `${space.lg}px ${space.lg}px ${space.lg}px 0`,
          padding: `${space.xl}px ${space.xl}px`,
          overflowY: "auto",
          background: color.surface,
          border: `0.5px solid ${color.border}`,
          borderRadius: radius.lg,
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
            <div style={{ fontSize: "11px", fontWeight: 600, color: color.textMuted, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Properties
            </div>
            <button
              type="button"
              onClick={() => setPropsOpen(false)}
              style={{ background: "transparent", border: "none", color: color.textMuted, cursor: "pointer", padding: "2px" }}
              title="Close properties"
            >
              ×
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            {/* Status */}
            <PropertyRow label="Status">
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <InlineStatusPicker
                  current={task.status}
                  onChange={(s) => onStatusChange(task.id, s)}
                />
                <span style={{ fontSize: "12px", color: color.text }}>
                  {statusMeta?.label ?? STATUS_LABEL[task.status]}
                </span>
              </div>
            </PropertyRow>

            {/* Priority */}
            <PropertyRow label="Priority">
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <InlinePriorityPicker
                  current={task.priority}
                  onChange={(p) => onPriorityChange(task.id, p)}
                />
              </div>
            </PropertyRow>

            {/* Labels */}
            <PropertyRow label="Labels">
              <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: color.textSecondary }}>
                <Tag size={12} />
                {task.tags && task.tags.length > 0 ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                    {task.tags.map((t) => (
                      <span key={t} style={{
                        fontSize: "10px", padding: "2px 6px", borderRadius: "4px",
                        background: "rgba(255,255,255,0.06)", color: color.textMuted,
                      }}>{t}</span>
                    ))}
                  </div>
                ) : (
                  <span>No labels</span>
                )}
              </div>
            </PropertyRow>

            {/* Assignee */}
            <PropertyRow label="Assignee">
              {task.status === "done" || task.status === "cancelled" ? (
                (() => {
                  if (!task.assignee) return <span style={{ fontSize: "12px", color: color.textMuted }}>—</span>;
                  const ag = agents.find(
                    (a) => a.name.toLowerCase() === task.assignee!.toLowerCase() || a.id.toLowerCase() === task.assignee!.toLowerCase()
                  );
                  if (ag) {
                    const av = resolveAvatar(ag);
                    return (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12px", color: color.textMuted }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {av ? <img src={av} alt="" style={{ width: 16, height: 16, borderRadius: "50%", objectFit: "cover" }} /> : <AvatarGlyph value={ag.emoji} size={14} />}
                        {ag.name}
                      </span>
                    );
                  }
                  return <span style={{ fontSize: "12px", color: color.textMuted }}>{task.assignee}</span>;
                })()
              ) : (
                <InlineAssigneePicker
                  current={task.assignee}
                  agents={agents}
                  onChange={(a) => onAssigneeChange(task.id, a)}
                />
              )}
            </PropertyRow>

            {/* Project */}
            <PropertyRow label="Project">
              {project ? (
                <Link
                  href={`/${encodeURIComponent(companyCode.toUpperCase())}/projects/${encodeURIComponent(project.slug)}`}
                  style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12px", color: color.text, textDecoration: "none" }}
                >
                  <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: project.color }} />
                  {project.name}
                  <ExternalLink size={11} color={color.textMuted} />
                </Link>
              ) : (
                <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12px", color: color.textSecondary }}>
                  <Folder size={12} /> —
                </span>
              )}
            </PropertyRow>

            {/* Divider */}
            <div style={{ height: "1px", background: color.border, margin: "4px 0" }} />

            {/* Created by */}
            <PropertyRow label="Created by">
              <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12px", color: color.textMuted }}>
                <User size={12} />
                {(() => {
                  const raw = task.createdBy;
                  if (raw === "mission-control" || raw === "pixel-ui") return "Mission Control";
                  if (raw === "system") return "System";
                  if (raw) return raw;
                  return task.assignee ?? "System";
                })()}
              </span>
            </PropertyRow>

            {/* Created */}
            <PropertyRow label="Created">
              <span style={{ fontSize: "12px", color: color.textMuted }}>{formatShortDate(task.created)}</span>
            </PropertyRow>

            {/* Updated */}
            <PropertyRow label="Updated">
              <span style={{ fontSize: "12px", color: color.textMuted }}>{relativeAge(task.updated)}</span>
            </PropertyRow>

            {/* Completed at */}
            {task.completedAt && (
              <PropertyRow label="Completed at">
                <span style={{ fontSize: "12px", color: color.textMuted }}>{formatShortDate(task.completedAt)}</span>
              </PropertyRow>
            )}
          </div>
        </aside>
      )}

      {/* Reopen panel button if closed */}
      {!propsOpen && task && (
        <button
          type="button"
          onClick={() => setPropsOpen(true)}
          style={{
            position: "absolute", right: "16px", top: "80px",
            padding: "6px 10px", fontSize: "11px", color: color.textSecondary,
            background: "rgba(41,37,36,0.5)", border: `0.5px solid ${color.border}`, borderRadius: "6px",
            cursor: "pointer",
          }}
        >
          Show properties
        </button>
      )}
    </div>
  );
}

function PropertyRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
      <div style={{ width: "72px", fontSize: "11px", color: color.textMuted, flexShrink: 0 }}>
        {label}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {children}
      </div>
    </div>
  );
}

function LiveActivityPanel({
  agentName,
  agentEmoji,
  connected,
  sessionId,
  streamText,
  events,
}: {
  agentName: string;
  agentEmoji?: string;
  connected: boolean;
  sessionId?: string;
  streamText: string;
  events: StreamTranscriptEntry[];
}) {
  const renderedEvents = events.slice(-8).reverse();

  return (
    <section
      style={{
        marginBottom: "20px",
        border: "0.5px solid rgba(245,245,244,0.12)",
        background: "rgba(28,25,23,0.72)",
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "14px 16px",
          borderBottom: "0.5px solid rgba(245,245,244,0.08)",
          background: "rgba(245,158,11,0.06)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 999,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(245,158,11,0.14)",
              border: "0.5px solid rgba(245,158,11,0.25)",
              fontSize: 14,
              flexShrink: 0,
            }}
          >
            {agentEmoji || <Bot size={14} color="#f59e0b" />}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: color.text }}>Live activity</span>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "2px 8px",
                  borderRadius: 999,
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  color: connected ? "#34d399" : "#fbbf24",
                  background: connected ? "rgba(52,211,153,0.12)" : "rgba(251,191,36,0.12)",
                }}
              >
                <Activity size={10} />
                {connected ? "streaming" : "connecting"}
              </span>
            </div>
            <div style={{ fontSize: 12, color: color.textSecondary }}>
              {agentName} is actively working this task{sessionId ? ` · session ${sessionId.slice(0, 8)}` : ""}
            </div>
          </div>
        </div>
      </div>

      <div style={{ padding: 16, display: "grid", gap: 14 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: color.textMuted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
            Current output
          </div>
          <div
            style={{
              padding: 12,
              borderRadius: 10,
              background: "rgba(12,10,9,0.7)",
              border: "0.5px solid rgba(245,245,244,0.08)",
              color: color.textMuted,
              fontSize: 13,
              lineHeight: 1.6,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              minHeight: 56,
            }}
          >
            {streamText.trim() || "Waiting for the next live output…"}
          </div>
        </div>

        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: color.textMuted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
            Recent actions
          </div>
          {renderedEvents.length === 0 ? (
            <div style={{ fontSize: 12, color: color.textMuted, padding: "8px 0" }}>
              No stream events yet.
            </div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {renderedEvents.map((event) => (
                <div
                  key={event.id}
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "flex-start",
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: "0.5px solid rgba(245,245,244,0.08)",
                    background: "rgba(12,10,9,0.4)",
                  }}
                >
                  <div style={{ marginTop: 1, flexShrink: 0 }}>{eventIcon(event)}</div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 12, color: color.text, lineHeight: 1.5 }}>{event.message}</div>
                    <div style={{ fontSize: 10, color: color.textMuted, marginTop: 4 }}>{relativeAge(event.ts)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function eventIcon(event: StreamTranscriptEntry) {
  if (event.kind === "tool_start" || event.kind === "tool_end" || event.kind === "action_detected") {
    return <Wrench size={14} color="#60a5fa" />;
  }
  if (event.kind === "lifecycle_error" || event.kind === "error") {
    return <AlertCircle size={14} color="#f87171" />;
  }
  if (event.kind === "lifecycle_end" || event.kind === "assistant_final") {
    return <CheckCircle2 size={14} color="#34d399" />;
  }
  return <Bot size={14} color="#f59e0b" />;
}
