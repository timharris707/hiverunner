"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ChevronRight, Copy, ExternalLink, Tag, Folder } from "lucide-react";

import { CompanyErrorState } from "@/components/company/company-ui";
import { StatusCircle } from "@/components/orchestration/StatusCircle";
import { PRIORITY_META, STATUS_META } from "@/components/orchestration/task-display";
import {
  getTask,
  listCompanies,
  listCompanyAgents,
  listProjects,
  listTaskComments,
  addTaskComment,
  updateTaskStatus,
  updateTask,
  updateTaskAssignee,
} from "@/lib/orchestration/client";
import { InlineStatusPicker } from "@/components/tasks/InlineStatusPicker";
import { InlinePriorityPicker } from "@/components/tasks/InlinePriorityPicker";
import { InlineAssigneePicker } from "@/components/tasks/InlineAssigneePicker";
import { SURFACE, STATUS_LABEL, formatShortDate, assigneeInitials } from "@/components/tasks/types";
import type {
  OrchestrationAgent,
  OrchestrationCompany,
  OrchestrationProject,
  OrchestrationTask,
  TaskStatus,
  TaskPriority,
} from "@/lib/orchestration/types";

type Comment = NonNullable<OrchestrationTask["comments"]>[number];

type Tab = "comments" | "subtasks" | "activity";

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

export default function TaskDetailPage() {
  const params = useParams<{ slug: string; taskKey: string }>();
  const slug = params?.slug ?? "";
  const taskKey = decodeURIComponent(params?.taskKey ?? "");

  const [company, setCompany] = useState<OrchestrationCompany | null>(null);
  const [project, setProject] = useState<OrchestrationProject | null>(null);
  const [task, setTask] = useState<OrchestrationTask | null>(null);
  const [agents, setAgents] = useState<OrchestrationAgent[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<Tab>("comments");
  const [commentDraft, setCommentDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [propsOpen, setPropsOpen] = useState(true);
  const [copyHint, setCopyHint] = useState(false);

  const loadTask = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [companies, fetchedTask] = await Promise.all([
        listCompanies(),
        getTask(taskKey),
      ]);
      const curCompany = companies.find((c) => c.slug === slug) ?? null;
      setCompany(curCompany);
      if (!fetchedTask) {
        setError("Task not found.");
        setTask(null);
        return;
      }
      setTask(fetchedTask);
      const [projectRows, agentRows, commentRows] = await Promise.all([
        listProjects({ company: slug }),
        curCompany ? listCompanyAgents(curCompany.slug) : Promise.resolve([]),
        listTaskComments(fetchedTask.id),
      ]);
      const proj = projectRows.find((p) => p.id === fetchedTask.project) ?? null;
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
      const refreshed = await listTaskComments(task.id);
      setComments(refreshed);
    }
    setPosting(false);
  }, [task, commentDraft, posting]);

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

  return (
    <div style={{ display: "flex", height: "100%", background: SURFACE.page, color: SURFACE.text }}>
      {/* ── Main column ── */}
      <div style={{ flex: 1, overflowY: "auto", padding: "24px 32px 64px", minWidth: 0 }}>
        {loading ? (
          <div style={{ padding: "48px 0", textAlign: "center", fontSize: "12px", color: SURFACE.textGhost }}>
            Loading task…
          </div>
        ) : task && (
          <>
            {/* Breadcrumbs */}
            <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: SURFACE.textDim, marginBottom: "16px" }}>
              <Link href={tasksHref} style={{ color: SURFACE.textDim, textDecoration: "none" }}>Tasks</Link>
              <ChevronRight size={12} color={SURFACE.textGhost} />
              <span style={{ color: SURFACE.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {task.title}
              </span>
            </div>

            {/* Meta row: status, priority, key, project */}
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "12px" }}>
              <StatusCircle status={task.status} size={16} />
              {priorityMeta && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "12px", color: priorityMeta.color }}>
                  <span style={{ fontSize: "13px", lineHeight: 1 }}>{priorityMeta.icon}</span>
                  {priorityMeta.label}
                </span>
              )}
              <span style={{ fontSize: "12px", color: SURFACE.textDim, fontFamily: "var(--font-mono, monospace)", whiteSpace: "nowrap", flexShrink: 0 }}>
                {task.key ?? task.id.slice(0, 8).toUpperCase()}
              </span>
              {project && (
                <div style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: project.color }} />
                  <span style={{ fontSize: "12px", color: SURFACE.textDim }}>{project.name}</span>
                </div>
              )}
              <button
                type="button"
                onClick={copyKey}
                title="Copy task ID and title"
                style={{
                  marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: "4px",
                  padding: "4px 8px", fontSize: "11px", color: SURFACE.textDim,
                  background: "transparent", border: `1px solid ${SURFACE.line}`, borderRadius: "6px",
                  cursor: "pointer",
                }}
              >
                <Copy size={12} />
                {copyHint ? "Copied" : "Copy"}
              </button>
            </div>

            {/* Title */}
            <h1 style={{
              fontSize: "24px", fontWeight: 700, color: SURFACE.text, margin: "0 0 16px 0",
              letterSpacing: "-0.01em", lineHeight: 1.25,
            }}>
              {task.title}
            </h1>

            {/* Description */}
            {task.description && (
              <div style={{
                fontSize: "13px", color: SURFACE.textMuted, lineHeight: 1.65,
                whiteSpace: "pre-wrap", wordBreak: "break-word",
                paddingBottom: "20px", borderBottom: `1px solid ${SURFACE.line}`,
              }}>
                {task.description}
              </div>
            )}

            {/* Tabs */}
            <div style={{
              display: "flex", gap: "0", marginTop: "24px",
              borderBottom: `1px solid ${SURFACE.line}`,
            }}>
              {([["comments", "Comments"], ["subtasks", "Sub-tasks"], ["activity", "Activity"]] as [Tab, string][]).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActiveTab(key)}
                  style={{
                    padding: "10px 16px", background: "transparent", border: "none",
                    borderBottom: activeTab === key ? "2px solid #f5f5f4" : "2px solid transparent",
                    marginBottom: "-1px", cursor: "pointer",
                    fontSize: "12px", fontWeight: 500,
                    color: activeTab === key ? SURFACE.text : SURFACE.textFaint,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div style={{ paddingTop: "16px" }}>
              {activeTab === "comments" && (
                <>
                  <div style={{ fontSize: "13px", fontWeight: 600, color: SURFACE.text, marginBottom: "12px" }}>
                    Comments ({comments.length})
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "20px" }}>
                    {comments.length === 0 ? (
                      <div style={{ padding: "16px 0", fontSize: "12px", color: SURFACE.textGhost, textAlign: "center" }}>
                        No comments yet.
                      </div>
                    ) : (
                      comments.map((c) => (
                        <div
                          key={c.id}
                          style={{
                            padding: "12px 14px", borderRadius: "8px",
                            border: `1px solid ${SURFACE.line}`, background: SURFACE.card,
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                            <span style={{
                              width: "22px", height: "22px", borderRadius: "50%",
                              background: "rgba(120,113,108,0.25)", border: "1px solid rgba(120,113,108,0.15)",
                              display: "inline-flex", alignItems: "center", justifyContent: "center",
                              fontSize: "9px", fontWeight: 700, color: SURFACE.textDim,
                            }}>
                              {assigneeInitials(c.author)}
                            </span>
                            <span style={{ fontSize: "12px", fontWeight: 600, color: SURFACE.text }}>{c.author}</span>
                            <span style={{ marginLeft: "auto", fontSize: "11px", color: SURFACE.textGhost }}>
                              {formatTimestamp(c.timestamp)}
                            </span>
                          </div>
                          <div style={{ fontSize: "13px", color: SURFACE.textMuted, whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.5 }}>
                            {c.text}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  {/* Comment composer */}
                  <div style={{
                    border: `1px solid ${SURFACE.line}`, borderRadius: "8px",
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
                        color: SURFACE.text, fontSize: "13px", outline: "none", fontFamily: "inherit",
                        minHeight: "56px",
                      }}
                    />
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "6px" }}>
                      <span style={{ fontSize: "10px", color: SURFACE.textGhost, alignSelf: "center" }}>
                        ⌘ + Enter
                      </span>
                      <button
                        type="button"
                        onClick={() => void onSubmitComment()}
                        disabled={!commentDraft.trim() || posting}
                        style={{
                          padding: "6px 12px", fontSize: "12px", fontWeight: 600,
                          background: commentDraft.trim() && !posting ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.03)",
                          color: commentDraft.trim() && !posting ? SURFACE.text : SURFACE.textGhost,
                          border: `1px solid ${SURFACE.line}`, borderRadius: "6px",
                          cursor: commentDraft.trim() && !posting ? "pointer" : "default",
                        }}
                      >
                        {posting ? "Posting…" : "Comment"}
                      </button>
                    </div>
                  </div>
                </>
              )}
              {activeTab === "subtasks" && (
                <div style={{ padding: "24px 0", fontSize: "12px", color: SURFACE.textGhost, textAlign: "center" }}>
                  No sub-tasks.
                </div>
              )}
              {activeTab === "activity" && (
                <div style={{ fontSize: "12px", color: SURFACE.textMuted }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <span style={{ color: SURFACE.textGhost, minWidth: "100px" }}>{formatTimestamp(task.created)}</span>
                      <span>Task created</span>
                    </div>
                    {task.updated !== task.created && (
                      <div style={{ display: "flex", gap: "8px" }}>
                        <span style={{ color: SURFACE.textGhost, minWidth: "100px" }}>{formatTimestamp(task.updated)}</span>
                        <span>Task updated</span>
                      </div>
                    )}
                    {task.completedAt && (
                      <div style={{ display: "flex", gap: "8px" }}>
                        <span style={{ color: SURFACE.textGhost, minWidth: "100px" }}>{formatTimestamp(task.completedAt)}</span>
                        <span>Task completed</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Properties panel ── */}
      {propsOpen && task && (
        <aside style={{
          width: "280px", flexShrink: 0, borderLeft: `1px solid ${SURFACE.line}`,
          padding: "24px 20px", overflowY: "auto",
          background: "rgba(12,10,9,0.6)",
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
            <div style={{ fontSize: "11px", fontWeight: 600, color: SURFACE.textGhost, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Properties
            </div>
            <button
              type="button"
              onClick={() => setPropsOpen(false)}
              style={{ background: "transparent", border: "none", color: SURFACE.textGhost, cursor: "pointer", padding: "2px" }}
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
                <span style={{ fontSize: "12px", color: SURFACE.text }}>
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
              <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: SURFACE.textDim }}>
                <Tag size={12} />
                {task.tags && task.tags.length > 0 ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                    {task.tags.map((t) => (
                      <span key={t} style={{
                        fontSize: "10px", padding: "2px 6px", borderRadius: "4px",
                        background: "rgba(255,255,255,0.06)", color: SURFACE.textMuted,
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
              <InlineAssigneePicker
                current={task.assignee}
                agents={agents}
                onChange={(a) => onAssigneeChange(task.id, a)}
              />
            </PropertyRow>

            {/* Project */}
            <PropertyRow label="Project">
              {project ? (
                <Link
                  href={`/${encodeURIComponent(companyCode.toUpperCase())}/projects/${encodeURIComponent(project.slug)}`}
                  style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12px", color: SURFACE.text, textDecoration: "none" }}
                >
                  <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: project.color }} />
                  {project.name}
                  <ExternalLink size={11} color={SURFACE.textGhost} />
                </Link>
              ) : (
                <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12px", color: SURFACE.textDim }}>
                  <Folder size={12} /> —
                </span>
              )}
            </PropertyRow>

            {/* Divider */}
            <div style={{ height: "1px", background: SURFACE.line, margin: "4px 0" }} />

            {/* Created */}
            <PropertyRow label="Created">
              <span style={{ fontSize: "12px", color: SURFACE.textMuted }}>{formatShortDate(task.created)}</span>
            </PropertyRow>

            {/* Updated */}
            <PropertyRow label="Updated">
              <span style={{ fontSize: "12px", color: SURFACE.textMuted }}>{relativeAge(task.updated)}</span>
            </PropertyRow>

            {/* Completed */}
            {task.completedAt && (
              <PropertyRow label="Completed">
                <span style={{ fontSize: "12px", color: SURFACE.textMuted }}>{formatShortDate(task.completedAt)}</span>
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
            padding: "6px 10px", fontSize: "11px", color: SURFACE.textDim,
            background: "rgba(41,37,36,0.5)", border: `1px solid ${SURFACE.line}`, borderRadius: "6px",
            cursor: "pointer",
          }}
        >
          Show properties
        </button>
      )}
    </div>
  );
}

/* ── Property row helper ── */
function PropertyRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
      <div style={{ width: "72px", fontSize: "11px", color: SURFACE.textGhost, flexShrink: 0 }}>
        {label}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {children}
      </div>
    </div>
  );
}
