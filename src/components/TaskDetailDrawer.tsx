"use client";

import { useEffect, useState, useRef } from "react";
import {
  X,
  Link2,
  Upload,
  FileText,
  Film,
  ImageIcon,
  Trash2,
  ExternalLink,
  Wrench,
  Bug,
  Sparkles,
  Plus,
  Play,
  CheckCircle2,
  Inbox,
  ListOrdered,
  MessageSquare,
  Send,
} from "lucide-react";
import { AGENT_CONFIGS, getAgentByAnyId } from "@/config/agents";
import { agentDisplayLabel } from "@/lib/orchestration/avatar-icons";
import { isLegacyHumanActor, PUBLIC_ASSISTANT_LABEL, PUBLIC_HUMAN_LABEL } from "@/lib/public-identity";

export interface TaskComment {
  id: string;
  author: string;
  authorEmoji: string;
  text: string;
  timestamp: string;
  type: "note" | "review" | "rejection" | "resolution";
}

export interface Attachment {
  id: string;
  name: string;
  type: string;
  size: number;
  path: string;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: "backlog" | "to-do" | "in-progress" | "review" | "done";
  priority: "P0" | "P1" | "P2" | "P3";
  assignee?: string;
  project?: string;
  type?: "feature" | "bug" | "maintenance";
  tags?: string[];
  attachments?: Attachment[];
  source_url?: string;
  github_issue?: string;
  notes?: string;
  comments?: TaskComment[];
  buildState?: "queued" | "spawning" | "running" | "completed" | "failed" | "blocked";
  buildError?: string | null;
  buildTriggeredAt?: string;
  buildQueuedAt?: string;
  buildStartedAt?: string;
  buildCompletedAt?: string;
  activeBuildId?: string;
  routedModel?: string;
  routedTier?: string;
  routingReason?: string;
  complexityScore?: number;
  savingsPercent?: number;
  reviewRequired?: boolean;
  reviewStatus?: string;
  reviewRequestedAt?: string;
  reviewCompletedAt?: string;
  visualReview?: {
    required?: boolean;
    status?: string;
    targetPath?: string;
    targetUrl?: string;
    captureStatus?: string;
    lastCapturedAt?: string;
    lastUpdatedAt?: string;
    browser?: string;
    screenshotEvidenceCount?: number;
    captures?: Array<{
      id: string;
      path: string;
      name?: string;
      url?: string;
      targetPath?: string;
      capturedAt?: string;
      browser?: string;
    }>;
  };
  created: string;
  updated: string;
  completedAt?: string;
  created_by?: string;
}

export interface ProjectInfo {
  id: string;
  name: string;
  emoji: string;
  color: string;
}

export const COLUMNS: { id: Task["status"]; label: string; icon: React.ComponentType<{ className?: string }>; color: string }[] = [
  { id: "backlog", label: "Backlog", icon: Inbox, color: "#6b7280" },
  { id: "to-do", label: "To-Do", icon: ListOrdered, color: "#fbbf24" },
  { id: "in-progress", label: "In Progress", icon: Play, color: "#f59e0b" },
  { id: "review", label: "Review", icon: CheckCircle2, color: "#d97706" },
  { id: "done", label: "Done", icon: CheckCircle2, color: "#4ade80" },
];

export const PRIORITY_COLORS: Record<string, string> = {
  P0: "var(--negative)",
  P1: "var(--warning)",
  P2: "var(--info)",
  P3: "var(--positive)",
};

/** Resolve the emoji for any assignee string — handles both "Forge", "Forge 🔧", "backend", etc. */
export function getAssigneeEmoji(assignee: string): string {
  return getAgentByAnyId(assignee)?.emoji ?? "🤖";
}

/** Resolve the display name for any assignee string */
export function getAssigneeName(assignee: string): string {
  return getAgentByAnyId(assignee)?.name ?? assignee;
}

/** Legacy lookup for backwards compatibility */
export const ASSIGNEE_EMOJIS: Record<string, string> = Object.fromEntries(
  AGENT_CONFIGS.map((a) => [a.name, a.emoji])
);

export const ALL_ASSIGNEES = AGENT_CONFIGS.map((a) => a.name);
export const ALL_PRIORITIES = ["P0", "P1", "P2", "P3"] as const;
export const ALL_TYPES: { id: Task["type"]; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "feature", label: "Feature", icon: Sparkles },
  { id: "bug", label: "Bug", icon: Bug },
  { id: "maintenance", label: "Maintenance", icon: Wrench },
];

export function formatDate(dateStr: string) {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

export function formatDateFull(dateStr: string) {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImageType(type: string) {
  return type.startsWith("image/");
}

function isVideoType(type: string) {
  return type.startsWith("video/");
}

function hasUiTag(task: Task) {
  return Array.isArray(task.tags) && task.tags.some((tag) => String(tag).toLowerCase() === "ui");
}

function AttachmentIcon({ type }: { type: string }) {
  if (isImageType(type)) return <ImageIcon className="w-4 h-4" />;
  if (isVideoType(type)) return <Film className="w-4 h-4" />;
  return <FileText className="w-4 h-4" />;
}

async function uploadAttachments(taskId: string, files: File[]): Promise<Attachment[]> {
  const formData = new FormData();
  formData.append("taskId", taskId);
  for (const file of files) {
    formData.append("files", file);
  }
  const res = await fetch("/api/tasks/attachments", { method: "POST", body: formData });
  const data = await res.json();
  return data.attachments || [];
}

async function triggerBuildRetry(taskId: string): Promise<Task | null> {
  const res = await fetch("/api/tasks/build", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ taskId, action: "retry" }),
  });
  const data = await res.json();
  return data.task || null;
}

function AttachmentDropZone({
  files,
  onFilesAdded,
  onFileRemoved,
}: {
  files: File[];
  onFilesAdded: (files: File[]) => void;
  onFileRemoved: (index: number) => void;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const dropped = Array.from(e.dataTransfer.files);
    if (dropped.length > 0) onFilesAdded(dropped);
  };

  return (
    <div>
      <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: "0.375rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        Attachments
      </label>
      <div
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); }}
        onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        tabIndex={0}
        style={{
          border: `2px dashed ${isDragging ? "var(--accent)" : "var(--border)"}`,
          borderRadius: "0.5rem",
          padding: files.length > 0 ? "0.5rem" : "1rem",
          backgroundColor: isDragging ? "rgba(255,59,48,0.05)" : "var(--card-elevated)",
          cursor: "pointer",
          transition: "all 0.15s ease",
          minHeight: files.length > 0 ? undefined : "60px",
          display: "flex",
          flexDirection: "column",
          alignItems: files.length > 0 ? "stretch" : "center",
          justifyContent: "center",
          gap: "0.5rem",
        }}
      >
        {files.length === 0 ? (
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--text-muted)", fontSize: "0.8rem" }}>
            <Upload className="w-4 h-4" />
            <span>Drop files, paste anywhere, or click to browse</span>
          </div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
            {files.map((file, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.375rem",
                  padding: "0.25rem 0.5rem",
                  borderRadius: "0.375rem",
                  backgroundColor: "var(--surface)",
                  border: "1px solid var(--border)",
                  fontSize: "0.75rem",
                  color: "var(--text-secondary)",
                  maxWidth: "200px",
                }}
              >
                {isImageType(file.type) ? (
                  <img
                    src={URL.createObjectURL(file)}
                    alt=""
                    style={{ width: 20, height: 20, borderRadius: 3, objectFit: "cover" }}
                  />
                ) : (
                  <AttachmentIcon type={file.type} />
                )}
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                  {file.name}
                </span>
                <span style={{ color: "var(--text-muted)", fontSize: "0.65rem", flexShrink: 0 }}>
                  {formatFileSize(file.size)}
                </span>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onFileRemoved(i); }}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 0, display: "flex" }}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
            <div style={{ display: "flex", alignItems: "center", gap: "0.25rem", padding: "0.25rem 0.5rem", fontSize: "0.7rem", color: "var(--text-muted)" }}>
              <Plus className="w-3 h-3" /> Add more
            </div>
          </div>
        )}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,video/*,application/pdf,.md,.txt,.csv,.json"
        style={{ display: "none" }}
        onChange={(e) => {
          const selected = Array.from(e.target.files || []);
          if (selected.length > 0) onFilesAdded(selected);
          e.target.value = "";
        }}
      />
    </div>
  );
}

const COMMENT_TYPE_STYLES: Record<string, { bg: string; border: string; color: string; label: string }> = {
  note: { bg: "rgba(107,114,128,0.1)", border: "rgba(107,114,128,0.25)", color: "#9ca3af", label: "Note" },
  review: { bg: "rgba(217,119,6,0.1)", border: "rgba(217,119,6,0.25)", color: "#d97706", label: "Review" },
  rejection: { bg: "rgba(239,68,68,0.1)", border: "rgba(239,68,68,0.25)", color: "#f87171", label: "Rejection" },
  resolution: { bg: "rgba(74,222,128,0.1)", border: "rgba(74,222,128,0.25)", color: "#4ade80", label: "Resolution" },
};

function CommentThread({
  taskId,
  comments: initialComments,
  onCommentAdded,
}: {
  taskId: string;
  comments: TaskComment[];
  onCommentAdded: (comments: TaskComment[]) => void;
}) {
  const [comments, setComments] = useState<TaskComment[]>(initialComments);
  const [newText, setNewText] = useState("");
  const [commentType, setCommentType] = useState<TaskComment["type"]>("note");
  const [selectedAuthor, setSelectedAuthor] = useState("local-owner");
  const [submitting, setSubmitting] = useState(false);
  const threadEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setComments(initialComments);
  }, [initialComments]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [comments.length]);

  const handleSubmit = async () => {
    if (!newText.trim() || submitting) return;
    setSubmitting(true);
    try {
      const agent = getAgentByAnyId(selectedAuthor);
      const authorName = isLegacyHumanActor(selectedAuthor) || selectedAuthor === "local-owner" ? PUBLIC_HUMAN_LABEL : (agent?.name || selectedAuthor);
      const authorEmoji = isLegacyHumanActor(selectedAuthor) || selectedAuthor === "local-owner" ? "👤" : (agent?.emoji || "🤖");
      const res = await fetch(`/api/tasks/${taskId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          author: authorName,
          authorEmoji,
          text: newText.trim(),
          type: commentType,
        }),
      });
      const data = await res.json();
      if (data.comments) {
        setComments(data.comments);
        onCommentAdded(data.comments);
      }
      setNewText("");
    } catch (err) {
      console.error("Failed to post comment:", err);
    } finally {
      setSubmitting(false);
    }
  };

  const agent = getAgentByAnyId(selectedAuthor);
  const isHumanAuthor = isLegacyHumanActor(selectedAuthor) || selectedAuthor === "local-owner";
  const displayEmoji = isHumanAuthor ? "👤" : (agent?.emoji || "🤖");
  const displayName = isHumanAuthor ? PUBLIC_HUMAN_LABEL : (agent?.name || selectedAuthor);

  return (
    <div>
      <label style={{ ...DRAWER_LABEL_STYLE, display: "flex", alignItems: "center", gap: "0.375rem" }}>
        <MessageSquare className="w-3.5 h-3.5" /> Comments ({comments.length})
      </label>
      <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginBottom: "0.5rem", lineHeight: 1.5 }}>
        Comments are discussion only. Use the task timeline as the primary record of status, runs, and task history.
      </div>

      {/* Thread */}
      <div
        style={{
          maxHeight: "320px",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: "0.5rem",
          marginBottom: "0.75rem",
        }}
      >
        {comments.length === 0 && (
          <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", padding: "0.75rem", textAlign: "center" }}>
            No comments yet. Add the first one below.
          </div>
        )}
        {comments.map((c) => {
          const style = COMMENT_TYPE_STYLES[c.type] || COMMENT_TYPE_STYLES.note;
          return (
            <div
              key={c.id}
              style={{
                padding: "0.625rem 0.75rem",
                borderRadius: "0.5rem",
                backgroundColor: style.bg,
                border: `1px solid ${style.border}`,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.375rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
                  <span style={{ fontSize: "0.85rem" }}>{c.authorEmoji}</span>
                  <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text-primary)" }}>{c.author}</span>
                  <span
                    style={{
                      fontSize: "0.6rem",
                      fontWeight: 700,
                      padding: "0.1rem 0.375rem",
                      borderRadius: "9999px",
                      backgroundColor: style.bg,
                      color: style.color,
                      border: `1px solid ${style.border}`,
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                    }}
                  >
                    {style.label}
                  </span>
                </div>
                <span style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>
                  {formatDateFull(c.timestamp)}
                </span>
              </div>
              <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                {c.text}
              </div>
            </div>
          );
        })}
        <div ref={threadEndRef} />
      </div>

      {/* Add comment */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <select
            value={selectedAuthor}
            onChange={(e) => setSelectedAuthor(e.target.value)}
            style={{
              flex: "0 0 auto",
              padding: "0.375rem 0.5rem",
              borderRadius: "0.375rem",
              backgroundColor: "var(--card-elevated)",
              border: "1px solid var(--border)",
              color: "var(--text-primary)",
              fontSize: "0.75rem",
              outline: "none",
            }}
          >
            <option value="local-owner">👤 {PUBLIC_HUMAN_LABEL}</option>
            {AGENT_CONFIGS.map((a) => (
              <option key={a.id} value={a.name}>{agentDisplayLabel(a.emoji, a.name)}</option>
            ))}
          </select>
          <select
            value={commentType}
            onChange={(e) => setCommentType(e.target.value as TaskComment["type"])}
            style={{
              flex: "0 0 auto",
              padding: "0.375rem 0.5rem",
              borderRadius: "0.375rem",
              backgroundColor: "var(--card-elevated)",
              border: "1px solid var(--border)",
              color: COMMENT_TYPE_STYLES[commentType]?.color || "var(--text-primary)",
              fontSize: "0.75rem",
              fontWeight: 700,
              outline: "none",
            }}
          >
            <option value="note">Note</option>
            <option value="review">Review</option>
            <option value="rejection">Rejection</option>
            <option value="resolution">Resolution</option>
          </select>
        </div>
        <div style={{ display: "flex", gap: "0.375rem" }}>
          <textarea
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            placeholder={`Add a ${commentType} as ${displayEmoji} ${displayName}...`}
            rows={2}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            style={{
              flex: 1,
              padding: "0.5rem 0.625rem",
              borderRadius: "0.5rem",
              backgroundColor: "var(--card-elevated)",
              border: "1px solid var(--border)",
              color: "var(--text-primary)",
              fontSize: "0.8rem",
              outline: "none",
              resize: "vertical",
              boxSizing: "border-box",
              fontFamily: "inherit",
              lineHeight: 1.6,
            }}
          />
          <button
            onClick={handleSubmit}
            disabled={!newText.trim() || submitting}
            style={{
              alignSelf: "flex-end",
              padding: "0.5rem",
              borderRadius: "0.5rem",
              backgroundColor: newText.trim() ? "var(--accent)" : "var(--card-elevated)",
              border: "1px solid var(--border)",
              color: newText.trim() ? "#000" : "var(--text-muted)",
              cursor: newText.trim() && !submitting ? "pointer" : "not-allowed",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            title="Post comment (Cmd+Enter)"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

const DRAWER_LABEL_STYLE: React.CSSProperties = {
  display: "block", fontSize: "0.65rem", fontWeight: 700, color: "var(--text-muted)",
  marginBottom: "0.375rem", textTransform: "uppercase", letterSpacing: "0.08em",
};

const DRAWER_LABEL: React.CSSProperties = {
  display: "block", fontSize: "0.65rem", fontWeight: 700, color: "var(--text-muted)",
  marginBottom: "0.375rem", textTransform: "uppercase", letterSpacing: "0.08em",
};
const DRAWER_SELECT: React.CSSProperties = {
  width: "100%", padding: "0.5rem 0.625rem", borderRadius: "0.5rem",
  backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)",
  color: "var(--text-primary)", fontSize: "0.8rem", outline: "none",
};

export function TaskDetailDrawer({
  task,
  onClose,
  onTaskUpdated,
  projectsMap,
}: {
  task: Task;
  onClose: () => void;
  onTaskUpdated: (updated: Task) => void;
  projectsMap: Record<string, ProjectInfo>;
}) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description || "");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [retryingBuild, setRetryingBuild] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [routing, setRouting] = useState<{
    tier: string; modelName: string; reason: string;
    complexityScore: number; savingsPercent: number; signals: string[];
  } | null>(null);
  const [capturePath, setCapturePath] = useState(task.visualReview?.targetPath || "");
  const [captureUrl, setCaptureUrl] = useState(task.visualReview?.targetUrl || "");
  const [capturingVisual, setCapturingVisual] = useState(false);
  const [visualCaptureError, setVisualCaptureError] = useState<string | null>(null);

  useEffect(() => {
    requestAnimationFrame(() => setOpen(true));
  }, []);

  useEffect(() => {
    fetch(`/api/tasks/route-model?taskId=${task.id}`)
      .then((r) => r.json())
      .then((data) => { if (data.decision) setRouting(data.decision); })
      .catch(() => {});
  }, [task.id]);

  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description || "");
    setCapturePath(task.visualReview?.targetPath || "");
    setCaptureUrl(task.visualReview?.targetUrl || "");
    setVisualCaptureError(null);
  }, [task.id, task.title, task.description, task.visualReview?.targetPath, task.visualReview?.targetUrl]);

  const proj = projectsMap[task.project || ""];
  const attachments = task.attachments || [];
  const visualReview = task.visualReview;
  const visualCaptures = visualReview?.captures || [];
  const visualReviewRequired = Boolean(visualReview?.required || hasUiTag(task));
  const screenshotEvidenceCount = visualCaptures.length || attachments.filter((attachment) => isImageType(attachment.type)).length;

  const patchTask = async (updates: Partial<Task>) => {
    try {
      const res = await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: task.id, ...updates }),
      });
      const data = await res.json();
      if (data.task) onTaskUpdated(data.task);
    } catch (err) {
      console.error("Patch failed:", err);
    }
  };

  const handleRetryBuild = async () => {
    try {
      setRetryingBuild(true);
      const updated = await triggerBuildRetry(task.id);
      if (updated) onTaskUpdated(updated);
    } catch (err) {
      console.error("Retry failed:", err);
    } finally {
      setRetryingBuild(false);
    }
  };

  const handleVisualCapture = async () => {
    try {
      setCapturingVisual(true);
      setVisualCaptureError(null);
      const response = await fetch("/api/tasks/visual-qc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: task.id,
          targetPath: capturePath || undefined,
          targetUrl: captureUrl || undefined,
          fullPage: true,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Screenshot capture failed");
      }
      if (data.task) {
        onTaskUpdated(data.task);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Screenshot capture failed";
      setVisualCaptureError(message);
    } finally {
      setCapturingVisual(false);
    }
  };

  const handleClose = () => {
    setOpen(false);
    setTimeout(onClose, 200);
  };

  const handleUpload = async () => {
    if (pendingFiles.length === 0) return;
    setUploading(true);
    try {
      const newAttachments = await uploadAttachments(task.id, pendingFiles);
      const allAttachments = [...attachments, ...newAttachments];
      const res = await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: task.id, attachments: allAttachments }),
      });
      const data = await res.json();
      if (data.task) onTaskUpdated(data.task);
      setPendingFiles([]);
    } catch (err) {
      console.error("Upload failed:", err);
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveAttachment = async (att: Attachment) => {
    try {
      await fetch("/api/tasks/attachments", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: att.path }),
      });
      const updated = attachments.filter((a) => a.id !== att.id);
      const res = await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: task.id, attachments: updated }),
      });
      const data = await res.json();
      if (data.task) onTaskUpdated(data.task);
    } catch (err) {
      console.error("Delete failed:", err);
    }
  };

  const colInfo = COLUMNS.find((c) => c.id === task.status);

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        backgroundColor: open ? "rgba(0,0,0,0.5)" : "rgba(0,0,0,0)",
        transition: "background-color 0.2s ease",
      }}
      onClick={handleClose}
    >
      {/* Drawer panel */}
      <div
        style={{
          position: "absolute", top: 0, right: 0, bottom: 0, width: "min(440px, 90vw)",
          backgroundColor: "#18181b",
          borderLeft: "1px solid var(--border)",
          transform: open ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.2s ease",
          display: "flex", flexDirection: "column",
          overflowY: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
        onPaste={(e) => {
          const files = Array.from(e.clipboardData.items)
            .filter((item) => item.kind === "file")
            .map((item) => item.getAsFile())
            .filter((f): f is File => f !== null);
          if (files.length > 0) {
            e.preventDefault();
            setPendingFiles((prev) => [...prev, ...files]);
          }
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", fontFamily: "monospace" }}>{task.id}</span>
          <button onClick={handleClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: "0.25rem" }}>
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          {/* Title — editable */}
          <div>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => { if (title.trim() && title !== task.title) patchTask({ title: title.trim() }); }}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              style={{
                width: "100%", background: "none", border: "none", outline: "none",
                fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: "1.2rem",
                color: "var(--text-primary)", padding: "0.25rem 0", lineHeight: 1.3, boxSizing: "border-box",
                borderBottom: "1px solid transparent",
              }}
              onFocus={(e) => { (e.target as HTMLInputElement).style.borderBottomColor = "var(--accent)"; }}
              onBlurCapture={(e) => { (e.target as HTMLInputElement).style.borderBottomColor = "transparent"; }}
            />
          </div>

          {/* Status + Priority row */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            <div>
              <label style={DRAWER_LABEL}>Status</label>
              <select
                value={task.status}
                onChange={(e) => patchTask({ status: e.target.value as Task["status"] })}
                style={{ ...DRAWER_SELECT, color: colInfo?.color || "var(--text-primary)" }}
              >
                {COLUMNS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label style={DRAWER_LABEL}>Priority</label>
              <select
                value={task.priority}
                onChange={(e) => patchTask({ priority: e.target.value as Task["priority"] })}
                style={{ ...DRAWER_SELECT, color: PRIORITY_COLORS[task.priority], fontWeight: 700 }}
              >
                {ALL_PRIORITIES.map((p) => (
                  <option key={p} value={p}>{p} — {p === "P0" ? "Critical" : p === "P1" ? "High" : p === "P2" ? "Medium" : "Low"}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Project + Type row */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            <div>
              <label style={DRAWER_LABEL}>Project</label>
              <select
                value={task.project || ""}
                onChange={(e) => patchTask({ project: e.target.value || undefined })}
                style={{ ...DRAWER_SELECT, color: proj?.color || "var(--text-primary)" }}
              >
                <option value="">No Project</option>
                {Object.values(projectsMap).map((p) => <option key={p.id} value={p.id}>{p.emoji} {p.name}</option>)}
              </select>
            </div>
            <div>
              <label style={DRAWER_LABEL}>Type</label>
              <select
                value={task.type || ""}
                onChange={(e) => patchTask({ type: (e.target.value || undefined) as Task["type"] })}
                style={DRAWER_SELECT}
              >
                <option value="">None</option>
                {ALL_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </div>
          </div>

          {/* Assignee */}
          <div>
            <label style={DRAWER_LABEL}>Assignee</label>
            <select
              value={task.assignee || ""}
              onChange={(e) => patchTask({ assignee: e.target.value || undefined })}
              style={DRAWER_SELECT}
            >
              <option value="">🤖 Auto-assign</option>
              {ALL_ASSIGNEES.map((a) => <option key={a} value={a}>{ASSIGNEE_EMOJIS[a]} {a}</option>)}
            </select>
          </div>

          {/* Description — editable */}
          <div>
            <label style={DRAWER_LABEL}>Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={() => { if (description !== (task.description || "")) patchTask({ description: description || undefined }); }}
              placeholder="Add a description..."
              rows={4}
              style={{
                width: "100%", padding: "0.5rem 0.625rem", borderRadius: "0.5rem",
                backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)",
                color: "var(--text-primary)", fontSize: "0.8rem", outline: "none",
                resize: "vertical", boxSizing: "border-box", fontFamily: "inherit", lineHeight: 1.6,
              }}
            />
          </div>

          {/* Tags */}
          {task.tags && task.tags.length > 0 && (
            <div>
              <label style={DRAWER_LABEL}>Tags</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.375rem" }}>
                {task.tags.map((tag) => (
                  <span
                    key={tag}
                    style={{
                      fontSize: "0.75rem", padding: "0.25rem 0.625rem", borderRadius: "9999px",
                      backgroundColor: "var(--card-elevated)", color: "var(--text-secondary)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Links */}
          {(task.source_url || task.github_issue) && (
            <div>
              <label style={DRAWER_LABEL}>Links</label>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
                {task.source_url && (
                  <a
                    href={task.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: "inline-flex", alignItems: "center", gap: "0.375rem",
                      fontSize: "0.8rem", color: "#d97706", textDecoration: "none",
                      padding: "0.375rem 0.625rem", borderRadius: "0.375rem",
                      backgroundColor: "rgba(217,119,6,0.08)", border: "1px solid rgba(217,119,6,0.2)",
                      width: "fit-content",
                    }}
                  >
                    <ExternalLink className="w-3.5 h-3.5" /> Source
                  </a>
                )}
                {task.github_issue && (
                  <a
                    href={`https://github.com/${task.github_issue}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: "inline-flex", alignItems: "center", gap: "0.375rem",
                      fontSize: "0.8rem", color: "#d97706", textDecoration: "none",
                      padding: "0.375rem 0.625rem", borderRadius: "0.375rem",
                      backgroundColor: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)",
                      width: "fit-content",
                    }}
                  >
                    <ExternalLink className="w-3.5 h-3.5" /> GitHub Issue
                  </a>
                )}
              </div>
            </div>
          )}

          {/* Comment Thread */}
          <CommentThread
            taskId={task.id}
            comments={task.comments || []}
            onCommentAdded={(comments) => onTaskUpdated({ ...task, comments })}
          />

          {/* Attachments */}
          {attachments.length > 0 && (
            <div>
              <label style={DRAWER_LABEL}>Attachments ({attachments.length})</label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: "0.5rem" }}>
                {attachments.map((att) => (
                  <div
                    key={att.id}
                    style={{ borderRadius: "0.5rem", border: "1px solid var(--border)", backgroundColor: "var(--card-elevated)", overflow: "hidden" }}
                  >
                    {isImageType(att.type) ? (
                      <div
                        style={{ width: "100%", height: "80px", cursor: "pointer" }}
                        onClick={() => setLightboxSrc(`/api/tasks/attachments?path=${encodeURIComponent(att.path)}`)}
                      >
                        <img
                          src={`/api/tasks/attachments?path=${encodeURIComponent(att.path)}`}
                          alt={att.name}
                          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                        />
                      </div>
                    ) : isVideoType(att.type) ? (
                      <div style={{ width: "100%", height: "80px", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "var(--surface)" }}>
                        <Film className="w-6 h-6" style={{ color: "var(--text-muted)" }} />
                      </div>
                    ) : (
                      <div style={{ width: "100%", height: "80px", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "var(--surface)" }}>
                        <FileText className="w-6 h-6" style={{ color: "var(--text-muted)" }} />
                      </div>
                    )}
                    <div style={{ padding: "0.25rem 0.375rem", display: "flex", alignItems: "center", gap: "0.25rem" }}>
                      <span style={{ fontSize: "0.6rem", color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                        {att.name}
                      </span>
                      <button
                        onClick={() => handleRemoveAttachment(att)}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 0, display: "flex", flexShrink: 0 }}
                        title="Remove"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Add attachments */}
          <AttachmentDropZone
            files={pendingFiles}
            onFilesAdded={(newFiles) => setPendingFiles((prev) => [...prev, ...newFiles])}
            onFileRemoved={(i) => setPendingFiles((prev) => prev.filter((_, idx) => idx !== i))}
          />
          {pendingFiles.length > 0 && (
            <button
              onClick={handleUpload}
              disabled={uploading}
              style={{
                padding: "0.5rem", borderRadius: "0.5rem",
                backgroundColor: "var(--accent)", border: "none",
                color: "#000", fontWeight: 700, fontSize: "0.8rem",
                cursor: uploading ? "not-allowed" : "pointer",
                opacity: uploading ? 0.7 : 1,
              }}
            >
              {uploading ? "Uploading..." : `Upload ${pendingFiles.length} file${pendingFiles.length > 1 ? "s" : ""}`}
            </button>
          )}

          {/* LLM Router recommendation */}
          {routing && (
            <div style={{ padding: "0.75rem", borderRadius: "0.5rem", backgroundColor: "rgba(180,83,9,0.06)", border: "1px solid rgba(180,83,9,0.15)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
                <label style={{ ...DRAWER_LABEL, marginBottom: 0, display: "flex", alignItems: "center", gap: "0.375rem" }}>
                  <span style={{ fontSize: "0.8rem" }}>{"🧠"}</span> Smart Router
                </label>
                {routing.savingsPercent > 0 && (
                  <span style={{
                    fontSize: "0.65rem", fontWeight: 700, padding: "0.15rem 0.5rem",
                    borderRadius: "9999px", backgroundColor: "rgba(74,222,128,0.12)",
                    color: "#4ade80", border: "1px solid rgba(74,222,128,0.25)",
                  }}>
                    {routing.savingsPercent}% savings
                  </span>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.375rem" }}>
                <span style={{
                  fontSize: "0.75rem", fontWeight: 700,
                  color: routing.tier === "opus" ? "#f59e0b" : routing.tier === "sonnet" ? "#d97706" : routing.tier === "haiku" ? "#d97706" : routing.tier === "gemini-pro" ? "#34d399" : "#6ee7b7",
                }}>
                  {routing.modelName}
                </span>
                <span style={{
                  fontSize: "0.6rem", padding: "0.1rem 0.375rem", borderRadius: "0.25rem",
                  backgroundColor: "var(--card-elevated)", color: "var(--text-muted)", fontFamily: "monospace",
                }}>
                  complexity: {routing.complexityScore}/100
                </span>
              </div>
              <p style={{ fontSize: "0.7rem", color: "var(--text-secondary)", margin: 0, lineHeight: 1.5 }}>
                {routing.reason}
              </p>
            </div>
          )}

          {/* Build health */}
          {(task.buildState || task.buildError || task.routedModel) && (
            <div style={{ padding: "0.85rem", borderRadius: "0.5rem", backgroundColor: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.18)", display: "flex", flexDirection: "column", gap: "0.6rem" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem", flexWrap: "wrap" }}>
                <label style={{ ...DRAWER_LABEL, marginBottom: 0 }}>Factory status</label>
                <span style={{
                  fontSize: "0.65rem",
                  fontWeight: 700,
                  padding: "0.15rem 0.5rem",
                  borderRadius: "9999px",
                  backgroundColor:
                    task.buildState === "failed" ? "rgba(239,68,68,0.12)" :
                    task.buildState === "completed" ? "rgba(74,222,128,0.12)" :
                    task.buildState === "queued" ? "rgba(192,132,252,0.12)" :
                    task.buildState === "blocked" ? "rgba(251,146,60,0.12)" :
                    "rgba(251,191,36,0.12)",
                  color:
                    task.buildState === "failed" ? "#f87171" :
                    task.buildState === "completed" ? "#4ade80" :
                    task.buildState === "queued" ? "#fbbf24" :
                    task.buildState === "blocked" ? "#fb923c" :
                    "#fbbf24",
                }}>
                  {(task.buildState || "idle").replace(/-/g, " ")}
                </span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                {task.routedModel && (
                  <div>
                    <label style={DRAWER_LABEL}>Model</label>
                    <div style={{ fontSize: "0.78rem", color: "var(--text-primary)" }}>{task.routedModel}</div>
                  </div>
                )}
                {task.activeBuildId && (
                  <div>
                    <label style={DRAWER_LABEL}>Active build</label>
                    <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)", fontFamily: "monospace" }}>{task.activeBuildId}</div>
                  </div>
                )}
                {task.buildTriggeredAt && (
                  <div>
                    <label style={DRAWER_LABEL}>Triggered</label>
                    <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)" }}>{formatDateFull(task.buildTriggeredAt)}</div>
                  </div>
                )}
                {task.buildCompletedAt && (
                  <div>
                    <label style={DRAWER_LABEL}>Last finished</label>
                    <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)" }}>{formatDateFull(task.buildCompletedAt)}</div>
                  </div>
                )}
              </div>

              {task.buildError && (
                <div>
                  <label style={DRAWER_LABEL}>Last failure</label>
                  <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: "0.72rem", lineHeight: 1.5, color: "#fca5a5", backgroundColor: "rgba(127,29,29,0.2)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: "0.5rem", padding: "0.6rem", maxHeight: "180px", overflowY: "auto" }}>
                    {task.buildError}
                  </pre>
                </div>
              )}

              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                {task.buildState === "failed" && (
                  <button
                    onClick={handleRetryBuild}
                    disabled={retryingBuild}
                    style={{ padding: "0.5rem 0.75rem", borderRadius: "0.5rem", border: "none", backgroundColor: "#f59e0b", color: "#111827", fontWeight: 700, cursor: retryingBuild ? "not-allowed" : "pointer", opacity: retryingBuild ? 0.7 : 1 }}
                  >
                    {retryingBuild ? "Retrying..." : "Retry build"}
                  </button>
                )}
                {task.buildState === "completed" && task.status === "done" && (
                  <button
                    onClick={() => patchTask({ status: "review", reviewStatus: "pending", reviewRequired: true })}
                    style={{ padding: "0.5rem 0.75rem", borderRadius: "0.5rem", border: "1px solid rgba(217,119,6,0.3)", backgroundColor: "rgba(217,119,6,0.12)", color: "#f59e0b", fontWeight: 700, cursor: "pointer" }}
                  >
                    Send to review
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Visual QC */}
          {(visualReviewRequired || task.status === "review") && (
            <div style={{ padding: "0.85rem", borderRadius: "0.5rem", backgroundColor: "rgba(217,119,6,0.08)", border: "1px solid rgba(217,119,6,0.2)", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem", flexWrap: "wrap" }}>
                <label style={{ ...DRAWER_LABEL, marginBottom: 0 }}>Visual QC</label>
                <span style={{ fontSize: "0.65rem", fontWeight: 700, padding: "0.15rem 0.5rem", borderRadius: "9999px", backgroundColor: screenshotEvidenceCount > 0 ? "rgba(74,222,128,0.12)" : "rgba(251,191,36,0.12)", color: screenshotEvidenceCount > 0 ? "#4ade80" : "#fbbf24" }}>
                  {screenshotEvidenceCount > 0 ? `${screenshotEvidenceCount} screenshot${screenshotEvidenceCount === 1 ? "" : "s"}` : "needs screenshot evidence"}
                </span>
              </div>

              <p style={{ margin: 0, fontSize: "0.78rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                Honest first version: HiveRunner stores screenshot evidence for human/agent review. It does <strong>not</strong> claim automated visual AI sign-off.
              </p>

              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "0.5rem" }}>
                <div>
                  <label style={DRAWER_LABEL}>Target route / path</label>
                  <input
                    value={capturePath}
                    onChange={(e) => setCapturePath(e.target.value)}
                    placeholder="/tasks or /projects/hiverunner"
                    style={{ width: "100%", padding: "0.5rem 0.625rem", borderRadius: "0.5rem", backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)", fontSize: "0.8rem", outline: "none", boxSizing: "border-box" }}
                  />
                </div>
                <div>
                  <label style={DRAWER_LABEL}>Target URL override</label>
                  <input
                    value={captureUrl}
                    onChange={(e) => setCaptureUrl(e.target.value)}
                    placeholder="https://hiverunner.example.com/tasks"
                    style={{ width: "100%", padding: "0.5rem 0.625rem", borderRadius: "0.5rem", backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)", fontSize: "0.8rem", outline: "none", boxSizing: "border-box" }}
                  />
                </div>
              </div>

              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                <button
                  onClick={handleVisualCapture}
                  disabled={capturingVisual || (!capturePath.trim() && !captureUrl.trim() && !visualReview?.targetUrl)}
                  style={{ padding: "0.5rem 0.75rem", borderRadius: "0.5rem", border: "none", backgroundColor: "#d97706", color: "white", fontWeight: 700, cursor: capturingVisual ? "not-allowed" : "pointer", opacity: capturingVisual ? 0.7 : 1 }}
                >
                  {capturingVisual ? "Capturing..." : screenshotEvidenceCount > 0 ? "Recapture screenshot" : "Capture screenshot"}
                </button>
                {!visualReview?.required && (
                  <button
                    onClick={() => patchTask({
                      visualReview: {
                        ...(task.visualReview || {}),
                        required: true,
                        status: screenshotEvidenceCount > 0 ? "ready" : "pending-capture",
                        targetPath: capturePath || task.visualReview?.targetPath,
                        targetUrl: captureUrl || task.visualReview?.targetUrl,
                      },
                      reviewRequired: true,
                      reviewStatus: task.reviewStatus || "pending",
                      status: task.status === "done" ? "review" : task.status,
                    })}
                    style={{ padding: "0.5rem 0.75rem", borderRadius: "0.5rem", border: "1px solid rgba(217,119,6,0.3)", backgroundColor: "rgba(217,119,6,0.12)", color: "#fcd34d", fontWeight: 700, cursor: "pointer" }}
                  >
                    Mark visual review required
                  </button>
                )}
              </div>

              {visualCaptureError && (
                <div style={{ fontSize: "0.72rem", color: "#fca5a5", backgroundColor: "rgba(127,29,29,0.18)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: "0.5rem", padding: "0.6rem" }}>
                  {visualCaptureError}
                </div>
              )}

              {visualCaptures.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {visualCaptures.slice().reverse().map((capture) => (
                    <button
                      key={capture.id}
                      type="button"
                      onClick={() => setLightboxSrc(`/api/tasks/attachments?path=${encodeURIComponent(capture.path)}`)}
                      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", textAlign: "left", padding: "0.6rem 0.75rem", borderRadius: "0.5rem", border: "1px solid rgba(217,119,6,0.18)", backgroundColor: "rgba(24,24,27,0.6)", color: "var(--text-primary)", cursor: "pointer" }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {capture.targetPath || capture.url || capture.name || "Visual capture"}
                        </div>
                        <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", marginTop: "0.2rem" }}>
                          {capture.capturedAt ? formatDateFull(capture.capturedAt) : "Captured"}
                          {capture.browser ? ` • ${capture.browser}` : ""}
                        </div>
                      </div>
                      <span style={{ fontSize: "0.68rem", color: "#fcd34d" }}>Open</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Review loop */}
          {(task.status === "review" || task.reviewRequired) && (
            <div style={{ padding: "0.85rem", borderRadius: "0.5rem", backgroundColor: "rgba(217,119,6,0.06)", border: "1px solid rgba(217,119,6,0.18)", display: "flex", flexDirection: "column", gap: "0.6rem" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem", flexWrap: "wrap" }}>
                <label style={{ ...DRAWER_LABEL, marginBottom: 0 }}>QC / review</label>
                <span style={{ fontSize: "0.65rem", fontWeight: 700, padding: "0.15rem 0.5rem", borderRadius: "9999px", backgroundColor: task.reviewStatus === "approved" ? "rgba(74,222,128,0.12)" : task.reviewStatus === "changes-requested" ? "rgba(239,68,68,0.12)" : "rgba(217,119,6,0.12)", color: task.reviewStatus === "approved" ? "#4ade80" : task.reviewStatus === "changes-requested" ? "#f87171" : "#f59e0b" }}>
                  {task.reviewStatus || "pending"}
                </span>
              </div>
              <p style={{ margin: 0, fontSize: "0.78rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                Manual review scaffold only — this is a handoff/status loop, not an automated code reviewer.
                {visualReviewRequired && screenshotEvidenceCount === 0 ? " Screenshot evidence is still missing for this visual review." : ""}
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                {task.reviewRequestedAt && (
                  <div>
                    <label style={DRAWER_LABEL}>Requested</label>
                    <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)" }}>{formatDateFull(task.reviewRequestedAt)}</div>
                  </div>
                )}
                {task.reviewCompletedAt && (
                  <div>
                    <label style={DRAWER_LABEL}>Completed</label>
                    <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)" }}>{formatDateFull(task.reviewCompletedAt)}</div>
                  </div>
                )}
              </div>
              {task.status === "review" && (
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                  <button
                    onClick={() => patchTask({ status: "done", reviewStatus: "approved" })}
                    style={{ padding: "0.5rem 0.75rem", borderRadius: "0.5rem", border: "none", backgroundColor: "#22c55e", color: "#0b1220", fontWeight: 700, cursor: "pointer" }}
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => patchTask({ status: "in-progress", reviewStatus: "changes-requested" })}
                    style={{ padding: "0.5rem 0.75rem", borderRadius: "0.5rem", border: "1px solid rgba(239,68,68,0.25)", backgroundColor: "rgba(239,68,68,0.12)", color: "#fca5a5", fontWeight: 700, cursor: "pointer" }}
                  >
                    Request changes
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Created by + Dates */}
          <div style={{ display: "flex", gap: "1.5rem", paddingTop: "0.5rem", borderTop: "1px solid var(--border)", flexWrap: "wrap" }}>
            {task.created_by && (
              <div>
                <label style={DRAWER_LABEL}>Created by</label>
                <span style={{
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  color: isLegacyHumanActor(task.created_by) ? "#d97706" : task.created_by === "ideas-pipeline" ? "#fbbf24" : "#d97706",
                }}>
                  {isLegacyHumanActor(task.created_by) ? `👤 ${PUBLIC_HUMAN_LABEL}` : task.created_by === "ideas-pipeline" ? "💡 Ideas Pipeline" : `⚡ ${PUBLIC_ASSISTANT_LABEL}`}
                </span>
              </div>
            )}
            <div>
              <label style={DRAWER_LABEL}>Created</label>
              <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>{formatDateFull(task.created)}</span>
            </div>
            <div>
              <label style={DRAWER_LABEL}>Updated</label>
              <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>{formatDateFull(task.updated)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Lightbox */}
      {lightboxSrc && (
        <div
          style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.9)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1100, cursor: "pointer" }}
          onClick={(e) => { e.stopPropagation(); setLightboxSrc(null); }}
        >
          <img src={lightboxSrc} alt="" style={{ maxWidth: "90vw", maxHeight: "90vh", borderRadius: "0.5rem", objectFit: "contain" }} />
        </div>
      )}
    </div>
  );
}
