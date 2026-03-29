"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import {
  Kanban,
  Plus,
  RefreshCw,
  CheckCircle2,
  Inbox,
  Play,
  X,
  ListOrdered,
  Paperclip,
  Upload,
  FileText,
  Film,
  ImageIcon,
  Trash2,
  ExternalLink,
  Wrench,
  Bug,
  Sparkles,
} from "lucide-react";

interface Attachment {
  id: string;
  name: string;
  type: string;
  size: number;
  path: string;
}

interface Task {
  id: string;
  title: string;
  description?: string;
  status: "backlog" | "on-deck" | "in-progress" | "review" | "done";
  priority: "P0" | "P1" | "P2" | "P3";
  assignee?: string;
  project?: string;
  type?: "feature" | "bug" | "maintenance";
  tags?: string[];
  attachments?: Attachment[];
  source_url?: string;
  github_issue?: string;
  notes?: string;
  buildState?: "queued" | "spawning" | "running" | "completed" | "failed";
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
  reviewFailureCount?: number;
  lastReviewVerdict?: string;
  lastReviewerAgent?: string;
  lastReviewNotes?: string;
  lastReviewAt?: string;
  escalatedToHenry?: boolean;
  escalatedAt?: string;
  escalationReason?: string;
  codeReviewState?: string;
  visualReview?: {
    required?: boolean;
    status?: string;
    targetPath?: string;
    targetUrl?: string;
    captures?: Array<{ id: string; path: string; capturedAt?: string; targetPath?: string; url?: string }>;
  };
  created: string;
  updated: string;
  completedAt?: string;
  source?: string;
}

interface ProjectInfo {
  id: string;
  name: string;
  emoji: string;
  color: string;
}

const COLUMNS: { id: Task["status"]; label: string; icon: React.ComponentType<any>; color: string }[] = [
  { id: "backlog", label: "Backlog", icon: Inbox, color: "#6b7280" },
  { id: "on-deck", label: "On Deck", icon: ListOrdered, color: "#c084fc" },
  { id: "in-progress", label: "In Progress", icon: Play, color: "#f59e0b" },
  { id: "review", label: "Review", icon: CheckCircle2, color: "#60a5fa" },
  { id: "done", label: "Done", icon: CheckCircle2, color: "#4ade80" },
];

const PRIORITY_COLORS: Record<string, string> = {
  P0: "#ef4444",
  P1: "#f97316",
  P2: "#f59e0b",
  P3: "#6b7280",
};

// PROJECT_COLORS is now loaded dynamically from projects.json

const ASSIGNEE_EMOJIS: Record<string, string> = {
  Henry: "⚡",
  "Atlas 📈": "📈",
  "Nimbus 🌤️": "🌤️",
  "Cipher ₿": "₿",
  "Quant 📊": "📊",
  "Forge 🔧": "🔧",
  "Pixel 💻": "💻",
  Scout: "🔭",
  Quill: "✍️",
  Counsel: "⚖️",
};

const ALL_ASSIGNEES = Object.keys(ASSIGNEE_EMOJIS);
const ALL_PRIORITIES = ["P0", "P1", "P2", "P3"] as const;
const ALL_TYPES: { id: Task["type"]; label: string; icon: React.ComponentType<any> }[] = [
  { id: "feature", label: "Feature", icon: Sparkles },
  { id: "bug", label: "Bug", icon: Bug },
  { id: "maintenance", label: "Maintenance", icon: Wrench },
];

function formatDate(dateStr: string) {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

function formatDateFull(dateStr: string) {
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

// Shared drop zone for file attachments
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

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    const pasted: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const file = items[i].getAsFile();
      if (file) pasted.push(file);
    }
    if (pasted.length > 0) {
      e.preventDefault();
      onFilesAdded(pasted);
    }
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
        onPaste={handlePaste}
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

interface NewTaskModalProps {
  onClose: () => void;
  onSave: (task: Partial<Task>, files?: File[]) => void;
  defaultStatus?: Task["status"];
  projectsMap: Record<string, ProjectInfo>;
}

function NewTaskModal({ onClose, onSave, defaultStatus = "backlog", projectsMap }: NewTaskModalProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<Task["status"]>(defaultStatus);
  const [priority, setPriority] = useState<Task["priority"]>("P2");
  const [assignee, setAssignee] = useState("");
  const [project, setProject] = useState("");
  const [type, setType] = useState<Task["type"]>(undefined);
  const [tagsInput, setTagsInput] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    const tags = tagsInput.trim()
      ? tagsInput.split(",").map((t) => t.trim().replace(/^#/, "")).filter(Boolean)
      : undefined;
    await onSave(
      { title: title.trim(), description: description.trim() || undefined, status, priority, assignee: assignee || undefined, project: project || undefined, type: type || undefined, tags },
      pendingFiles.length > 0 ? pendingFiles : undefined,
    );
    setSaving(false);
  };

  return (
    <div
      data-modal-open="true"
      style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "1rem" }}
    >
      <div
        style={{ backgroundColor: "var(--card)", borderRadius: "1rem", width: "100%", maxWidth: "520px", border: "1px solid var(--border)", maxHeight: "90vh", overflowY: "auto" }}
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
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1.25rem 1.5rem", borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ fontFamily: "var(--font-heading)", fontWeight: 700, color: "var(--text-primary)", fontSize: "1.1rem" }}>
            <Plus className="inline-block w-5 h-5 mr-2 mb-0.5" />
            New Task
          </h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: "0.25rem" }}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: "0.375rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Title *
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs to be done?"
              autoFocus
              style={{ width: "100%", padding: "0.625rem 0.875rem", borderRadius: "0.5rem", backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)", fontSize: "0.875rem", outline: "none", boxSizing: "border-box" }}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: "0.375rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional details..."
              rows={3}
              style={{ width: "100%", padding: "0.625rem 0.875rem", borderRadius: "0.5rem", backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)", fontSize: "0.875rem", outline: "none", resize: "vertical", boxSizing: "border-box", fontFamily: "inherit" }}
            />
          </div>

          {/* Attachments */}
          <AttachmentDropZone
            files={pendingFiles}
            onFilesAdded={(newFiles) => setPendingFiles((prev) => [...prev, ...newFiles])}
            onFileRemoved={(i) => setPendingFiles((prev) => prev.filter((_, idx) => idx !== i))}
          />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: "0.375rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Priority
              </label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as Task["priority"])}
                style={{ width: "100%", padding: "0.625rem 0.875rem", borderRadius: "0.5rem", backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)", color: PRIORITY_COLORS[priority], fontSize: "0.875rem", outline: "none", fontWeight: 700 }}
              >
                {ALL_PRIORITIES.map((p) => (
                  <option key={p} value={p} style={{ color: PRIORITY_COLORS[p] }}>{p} — {p === "P0" ? "Critical" : p === "P1" ? "High" : p === "P2" ? "Medium" : "Low"}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: "0.375rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Status
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as Task["status"])}
                style={{ width: "100%", padding: "0.625rem 0.875rem", borderRadius: "0.5rem", backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)", fontSize: "0.875rem", outline: "none" }}
              >
                {COLUMNS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: "0.375rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Assignee
              </label>
              <select
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                style={{ width: "100%", padding: "0.625rem 0.875rem", borderRadius: "0.5rem", backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)", fontSize: "0.875rem", outline: "none" }}
              >
                <option value="">🤖 Auto-assign</option>
                {ALL_ASSIGNEES.map((a) => <option key={a} value={a}>{ASSIGNEE_EMOJIS[a]} {a}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: "0.375rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Project
              </label>
              <select
                value={project}
                onChange={(e) => setProject(e.target.value)}
                style={{ width: "100%", padding: "0.625rem 0.875rem", borderRadius: "0.5rem", backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)", fontSize: "0.875rem", outline: "none" }}
              >
                <option value="">No Project</option>
                {Object.values(projectsMap).map((p) => <option key={p.id} value={p.id}>{p.emoji} {p.name}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: "0.375rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Type
              </label>
              <select
                value={type ?? ""}
                onChange={(e) => setType((e.target.value as Task["type"]) || undefined)}
                style={{ width: "100%", padding: "0.625rem 0.875rem", borderRadius: "0.5rem", backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)", fontSize: "0.875rem", outline: "none" }}
              >
                <option value="">No Type</option>
                {ALL_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: "0.375rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Tags
              </label>
              <input
                type="text"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder="e.g. api, auth, ui"
                style={{ width: "100%", padding: "0.625rem 0.875rem", borderRadius: "0.5rem", backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)", fontSize: "0.875rem", outline: "none", boxSizing: "border-box" }}
              />
            </div>
          </div>

          <div style={{ display: "flex", gap: "0.75rem", paddingTop: "0.5rem" }}>
            <button
              type="button"
              onClick={onClose}
              style={{ flex: 1, padding: "0.625rem", borderRadius: "0.5rem", backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)", cursor: "pointer", fontSize: "0.875rem", fontWeight: 600 }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim() || saving}
              style={{
                flex: 2, padding: "0.625rem", borderRadius: "0.5rem",
                backgroundColor: title.trim() ? "var(--accent)" : "var(--card-elevated)",
                border: "none", color: title.trim() ? "#000" : "var(--text-muted)",
                cursor: title.trim() ? "pointer" : "not-allowed", fontSize: "0.875rem", fontWeight: 700,
                opacity: saving ? 0.7 : 1,
              }}
            >
              {saving ? "Creating..." : "Create Task"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Shared label style for drawer fields
const DRAWER_LABEL: React.CSSProperties = {
  display: "block", fontSize: "0.65rem", fontWeight: 700, color: "var(--text-muted)",
  marginBottom: "0.375rem", textTransform: "uppercase", letterSpacing: "0.08em",
};
const DRAWER_SELECT: React.CSSProperties = {
  width: "100%", padding: "0.5rem 0.625rem", borderRadius: "0.5rem",
  backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)",
  color: "var(--text-primary)", fontSize: "0.8rem", outline: "none",
};

// Task Detail Drawer — slide-in from right with full inline editing
function TaskDetailDrawer({
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
  const [notes, setNotes] = useState(task.notes || "");
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

  // Animate in on mount
  useEffect(() => {
    requestAnimationFrame(() => setOpen(true));
  }, []);

  // Fetch routing recommendation
  useEffect(() => {
    fetch(`/api/tasks/route-model?taskId=${task.id}`)
      .then((r) => r.json())
      .then((data) => { if (data.decision) setRouting(data.decision); })
      .catch(() => {});
  }, [task.id]);

  // Sync local state when task prop changes (e.g. after a save)
  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description || "");
    setNotes(task.notes || "");
    setCapturePath(task.visualReview?.targetPath || "");
    setCaptureUrl(task.visualReview?.targetUrl || "");
    setVisualCaptureError(null);
  }, [task.id, task.title, task.description, task.notes, task.visualReview?.targetPath, task.visualReview?.targetUrl]);

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
  const typeInfo = ALL_TYPES.find((t) => t.id === task.type);

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
                      fontSize: "0.8rem", color: "#60a5fa", textDecoration: "none",
                      padding: "0.375rem 0.625rem", borderRadius: "0.375rem",
                      backgroundColor: "rgba(96,165,250,0.08)", border: "1px solid rgba(96,165,250,0.2)",
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
                      fontSize: "0.8rem", color: "#a78bfa", textDecoration: "none",
                      padding: "0.375rem 0.625rem", borderRadius: "0.375rem",
                      backgroundColor: "rgba(167,139,250,0.08)", border: "1px solid rgba(167,139,250,0.2)",
                      width: "fit-content",
                    }}
                  >
                    <ExternalLink className="w-3.5 h-3.5" /> GitHub Issue
                  </a>
                )}
              </div>
            </div>
          )}

          {/* Notes — editable */}
          <div>
            <label style={DRAWER_LABEL}>Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => { if (notes !== (task.notes || "")) patchTask({ notes: notes || undefined }); }}
              placeholder="Add notes..."
              rows={3}
              style={{
                width: "100%", padding: "0.5rem 0.625rem", borderRadius: "0.5rem",
                backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)",
                color: "var(--text-primary)", fontSize: "0.8rem", outline: "none",
                resize: "vertical", boxSizing: "border-box", fontFamily: "inherit", lineHeight: 1.6,
              }}
            />
          </div>

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
            <div style={{ padding: "0.75rem", borderRadius: "0.5rem", backgroundColor: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.15)" }}>
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
                  color: routing.tier === "opus" ? "#f59e0b" : routing.tier === "gpt-5.4" ? "#22c55e" : routing.tier === "sonnet" ? "#60a5fa" : routing.tier === "haiku" ? "#a78bfa" : routing.tier === "gemini-pro" ? "#34d399" : "#6ee7b7",
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
                    "rgba(251,191,36,0.12)",
                  color:
                    task.buildState === "failed" ? "#f87171" :
                    task.buildState === "completed" ? "#4ade80" :
                    task.buildState === "queued" ? "#c084fc" :
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
                    style={{ padding: "0.5rem 0.75rem", borderRadius: "0.5rem", border: "1px solid rgba(96,165,250,0.3)", backgroundColor: "rgba(96,165,250,0.12)", color: "#93c5fd", fontWeight: 700, cursor: "pointer" }}
                  >
                    Send to review
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Visual QC */}
          {(visualReviewRequired || task.status === "review") && (
            <div style={{ padding: "0.85rem", borderRadius: "0.5rem", backgroundColor: "rgba(168,85,247,0.08)", border: "1px solid rgba(168,85,247,0.2)", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem", flexWrap: "wrap" }}>
                <label style={{ ...DRAWER_LABEL, marginBottom: 0 }}>Visual QC</label>
                <span style={{ fontSize: "0.65rem", fontWeight: 700, padding: "0.15rem 0.5rem", borderRadius: "9999px", backgroundColor: screenshotEvidenceCount > 0 ? "rgba(74,222,128,0.12)" : "rgba(251,191,36,0.12)", color: screenshotEvidenceCount > 0 ? "#4ade80" : "#fbbf24" }}>
                  {screenshotEvidenceCount > 0 ? `${screenshotEvidenceCount} screenshot${screenshotEvidenceCount === 1 ? "" : "s"}` : "needs screenshot evidence"}
                </span>
              </div>

              <p style={{ margin: 0, fontSize: "0.78rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                Honest first version: Mission Control stores screenshot evidence for human/agent review. It does <strong>not</strong> claim automated visual AI sign-off.
              </p>

              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "0.5rem" }}>
                <div>
                  <label style={DRAWER_LABEL}>Target route / path</label>
                  <input
                    value={capturePath}
                    onChange={(e) => setCapturePath(e.target.value)}
                    placeholder="/tasks or /projects/mission-control"
                    style={{ width: "100%", padding: "0.5rem 0.625rem", borderRadius: "0.5rem", backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)", fontSize: "0.8rem", outline: "none", boxSizing: "border-box" }}
                  />
                </div>
                <div>
                  <label style={DRAWER_LABEL}>Target URL override</label>
                  <input
                    value={captureUrl}
                    onChange={(e) => setCaptureUrl(e.target.value)}
                    placeholder="https://mission-control-app-iota.vercel.app/tasks"
                    style={{ width: "100%", padding: "0.5rem 0.625rem", borderRadius: "0.5rem", backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)", fontSize: "0.8rem", outline: "none", boxSizing: "border-box" }}
                  />
                </div>
              </div>

              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                <button
                  onClick={handleVisualCapture}
                  disabled={capturingVisual || (!capturePath.trim() && !captureUrl.trim() && !visualReview?.targetUrl)}
                  style={{ padding: "0.5rem 0.75rem", borderRadius: "0.5rem", border: "none", backgroundColor: "#a855f7", color: "white", fontWeight: 700, cursor: capturingVisual ? "not-allowed" : "pointer", opacity: capturingVisual ? 0.7 : 1 }}
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
                    style={{ padding: "0.5rem 0.75rem", borderRadius: "0.5rem", border: "1px solid rgba(168,85,247,0.3)", backgroundColor: "rgba(168,85,247,0.12)", color: "#d8b4fe", fontWeight: 700, cursor: "pointer" }}
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
                      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", textAlign: "left", padding: "0.6rem 0.75rem", borderRadius: "0.5rem", border: "1px solid rgba(168,85,247,0.18)", backgroundColor: "rgba(24,24,27,0.6)", color: "var(--text-primary)", cursor: "pointer" }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {capture.targetPath || capture.url || "Visual capture"}
                        </div>
                        <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", marginTop: "0.2rem" }}>
                          {capture.capturedAt ? formatDateFull(capture.capturedAt) : "Captured"}
                        </div>
                      </div>
                      <span style={{ fontSize: "0.68rem", color: "#d8b4fe" }}>Open</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Review loop */}
          {(task.status === "review" || task.reviewRequired || task.lastReviewVerdict || task.codeReviewState) && (
            <div style={{
              padding: "0.85rem", borderRadius: "0.5rem",
              backgroundColor: task.escalatedToHenry ? "rgba(239,68,68,0.08)" : "rgba(96,165,250,0.06)",
              border: `1px solid ${task.escalatedToHenry ? "rgba(239,68,68,0.25)" : "rgba(96,165,250,0.18)"}`,
              display: "flex", flexDirection: "column", gap: "0.6rem",
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem", flexWrap: "wrap" }}>
                <label style={{ ...DRAWER_LABEL, marginBottom: 0 }}>QC Pipeline</label>
                <div style={{ display: "flex", gap: "0.375rem", alignItems: "center", flexWrap: "wrap" }}>
                  {task.codeReviewState && (
                    <span style={{
                      fontSize: "0.6rem", fontWeight: 700, padding: "0.15rem 0.5rem", borderRadius: "9999px",
                      backgroundColor: task.codeReviewState === "approved" ? "rgba(74,222,128,0.12)" : task.codeReviewState === "needs-fix" ? "rgba(239,68,68,0.12)" : task.codeReviewState === "running" ? "rgba(251,191,36,0.12)" : "rgba(96,165,250,0.12)",
                      color: task.codeReviewState === "approved" ? "#4ade80" : task.codeReviewState === "needs-fix" ? "#f87171" : task.codeReviewState === "running" ? "#fbbf24" : "#93c5fd",
                    }}>
                      auto: {task.codeReviewState}
                    </span>
                  )}
                  <span style={{
                    fontSize: "0.6rem", fontWeight: 700, padding: "0.15rem 0.5rem", borderRadius: "9999px",
                    backgroundColor: task.reviewStatus === "approved" ? "rgba(74,222,128,0.12)" : task.reviewStatus === "changes-requested" ? "rgba(239,68,68,0.12)" : "rgba(96,165,250,0.12)",
                    color: task.reviewStatus === "approved" ? "#4ade80" : task.reviewStatus === "changes-requested" ? "#f87171" : "#93c5fd",
                  }}>
                    {task.reviewStatus || "pending"}
                  </span>
                </div>
              </div>

              {/* Escalation banner */}
              {task.escalatedToHenry && (
                <div style={{ padding: "0.6rem", borderRadius: "0.375rem", backgroundColor: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.25)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", marginBottom: "0.25rem" }}>
                    <span>🚨</span>
                    <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "#f87171" }}>Escalated to Henry</span>
                  </div>
                  <p style={{ margin: 0, fontSize: "0.72rem", color: "#fca5a5", lineHeight: 1.5 }}>
                    Failed auto-review {task.reviewFailureCount || 0}× — needs manual intervention.
                    {task.escalatedAt ? ` Escalated ${formatDateFull(task.escalatedAt)}` : ""}
                  </p>
                </div>
              )}

              {/* Reviewer info */}
              {task.lastReviewerAgent && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                  <div>
                    <label style={DRAWER_LABEL}>Reviewer</label>
                    <div style={{ fontSize: "0.78rem", color: "var(--text-primary)" }}>{task.lastReviewerAgent}</div>
                  </div>
                  <div>
                    <label style={DRAWER_LABEL}>Verdict</label>
                    <div style={{
                      fontSize: "0.78rem", fontWeight: 700,
                      color: task.lastReviewVerdict === "APPROVED" ? "#4ade80" : task.lastReviewVerdict === "NEEDS_FIX" ? "#f87171" : "var(--text-secondary)",
                    }}>
                      {task.lastReviewVerdict === "APPROVED" ? "✅ Passed" : task.lastReviewVerdict === "NEEDS_FIX" ? "❌ Failed" : task.lastReviewVerdict || "—"}
                    </div>
                  </div>
                </div>
              )}

              {/* Failure count */}
              {(task.reviewFailureCount || 0) > 0 && (
                <div>
                  <label style={DRAWER_LABEL}>Review Failures</label>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <div style={{ display: "flex", gap: "0.25rem" }}>
                      {Array.from({ length: Math.min(task.reviewFailureCount || 0, 5) }).map((_, i) => (
                        <div key={i} style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "#ef4444" }} />
                      ))}
                      {Array.from({ length: Math.max(0, 2 - (task.reviewFailureCount || 0)) }).map((_, i) => (
                        <div key={`e-${i}`} style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "var(--border)" }} />
                      ))}
                    </div>
                    <span style={{ fontSize: "0.72rem", color: (task.reviewFailureCount || 0) >= 2 ? "#f87171" : "#fbbf24" }}>
                      {task.reviewFailureCount}× failed{(task.reviewFailureCount || 0) >= 2 ? " — escalated" : ""}
                    </span>
                  </div>
                </div>
              )}

              {/* Last review notes */}
              {task.lastReviewNotes && (
                <div>
                  <label style={DRAWER_LABEL}>Latest Review Notes</label>
                  <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: "0.72rem", lineHeight: 1.5, color: "#fca5a5", backgroundColor: "rgba(127,29,29,0.15)", border: "1px solid rgba(239,68,68,0.15)", borderRadius: "0.5rem", padding: "0.6rem", maxHeight: "150px", overflowY: "auto" }}>
                    {task.lastReviewNotes}
                  </pre>
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                {task.reviewRequestedAt && (
                  <div>
                    <label style={DRAWER_LABEL}>Requested</label>
                    <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)" }}>{formatDateFull(task.reviewRequestedAt)}</div>
                  </div>
                )}
                {task.lastReviewAt && (
                  <div>
                    <label style={DRAWER_LABEL}>Last Reviewed</label>
                    <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)" }}>{formatDateFull(task.lastReviewAt)}</div>
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
                    ✅ Approve
                  </button>
                  <button
                    onClick={() => patchTask({ status: "in-progress", reviewStatus: "changes-requested" })}
                    style={{ padding: "0.5rem 0.75rem", borderRadius: "0.5rem", border: "1px solid rgba(239,68,68,0.25)", backgroundColor: "rgba(239,68,68,0.12)", color: "#fca5a5", fontWeight: 700, cursor: "pointer" }}
                  >
                    ❌ Request changes
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Created by + Dates */}
          <div style={{ display: "flex", gap: "1.5rem", paddingTop: "0.5rem", borderTop: "1px solid var(--border)", flexWrap: "wrap" }}>
            {(task as any).created_by && (
              <div>
                <label style={DRAWER_LABEL}>Created by</label>
                <span style={{
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  color: (task as any).created_by === "tim" ? "#60a5fa" : (task as any).created_by === "ideas-pipeline" ? "#fbbf24" : "#a78bfa",
                }}>
                  {(task as any).created_by === "tim" ? "👤 Tim" : (task as any).created_by === "ideas-pipeline" ? "💡 Ideas Pipeline" : "⚡ Henry"}
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

function TaskCard({
  task,
  onDragStart,
  onStatusChange,
  onClick,
  projectsMap,
  isBuilding,
}: {
  task: Task;
  onDragStart: (e: React.DragEvent, task: Task) => void;
  onStatusChange: (id: string, status: Task["status"]) => void;
  onClick: (task: Task) => void;
  projectsMap: Record<string, ProjectInfo>;
  isBuilding?: boolean;
}) {
  const proj = projectsMap[task.project || ""];
  const projectColor = proj?.color || "#6b7280";
  const projectLabel = proj ? `${proj.emoji} ${proj.name}` : task.project || "";
  const attachmentCount = task.attachments?.length || 0;
  const dragRef = useRef(false);
  const mouseDownPos = useRef<{ x: number; y: number } | null>(null);

  return (
    <div
      draggable
      onDragStart={(e) => { dragRef.current = true; onDragStart(e, task); }}
      onDragEnd={() => { setTimeout(() => { dragRef.current = false; }, 0); }}
      onMouseDown={(e) => { mouseDownPos.current = { x: e.clientX, y: e.clientY }; }}
      onClick={(e) => {
        if (dragRef.current) return;
        const mp = mouseDownPos.current;
        if (mp && (Math.abs(e.clientX - mp.x) > 5 || Math.abs(e.clientY - mp.y) > 5)) return;
        onClick(task);
      }}
      className="group p-4 rounded-xl mb-2.5 last:mb-0 transition-all duration-150 hover:translate-y-[-1px] cursor-pointer"
      style={{
        backgroundColor: "var(--card)",
        border: "1px solid var(--border)",
        borderLeft: `3px solid ${projectColor}`,
        boxShadow: "0 1px 2px rgba(0,0,0,0.25)",
      }}
    >
      {/* Priority + Project */}
      <div className="flex items-center justify-between mb-3">
        <span
          className="text-xs font-bold px-2 py-0.5 rounded-md"
          style={{
            backgroundColor: `${PRIORITY_COLORS[task.priority]}20`,
            color: PRIORITY_COLORS[task.priority],
          }}
        >
          {task.priority}
        </span>
        {task.project && (
          <span
            className="text-xs px-2 py-0.5 rounded-md truncate max-w-[140px]"
            style={{
              backgroundColor: `${projectColor}12`,
              color: `${projectColor}bb`,
              border: `1px solid ${projectColor}22`,
            }}
          >
            {projectLabel}
          </span>
        )}
      </div>

      {/* Status chips row — compact inline badges */}
      {(() => {
        const chips: React.ReactNode[] = [];

        // Build state
        if (isBuilding || (task.status === "in-progress" && ["queued", "spawning", "running", "failed"].includes(task.buildState || ""))) {
          if (task.buildState === "failed") {
            chips.push(
              <span key="build" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md" style={{ backgroundColor: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.18)", fontSize: "10px", fontWeight: 600, color: "#f87171", letterSpacing: "0.3px" }}>
                <span style={{ width: 5, height: 5, borderRadius: "50%", backgroundColor: "#f87171", display: "inline-block", flexShrink: 0 }} />
                Build failed
              </span>
            );
          } else if (task.buildState === "queued") {
            chips.push(
              <a key="build" href="/factory" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md transition-opacity hover:opacity-80" style={{ backgroundColor: "rgba(192,132,252,0.10)", border: "1px solid rgba(192,132,252,0.20)", fontSize: "10px", fontWeight: 600, color: "#c084fc", letterSpacing: "0.3px", textDecoration: "none" }}>
                <span style={{ width: 5, height: 5, borderRadius: "50%", backgroundColor: "#c084fc", display: "inline-block", flexShrink: 0 }} />
                Queued
              </a>
            );
          } else if (isBuilding || task.buildState === "spawning") {
            chips.push(
              <span key="build" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md" style={{ backgroundColor: "rgba(251,191,36,0.10)", border: "1px solid rgba(251,191,36,0.20)", fontSize: "10px", fontWeight: 600, color: "#fbbf24", letterSpacing: "0.3px" }}>
                <span className="animate-pulse" style={{ width: 5, height: 5, borderRadius: "50%", backgroundColor: "#fbbf24", display: "inline-block", flexShrink: 0 }} />
                Spawning…
              </span>
            );
          } else {
            chips.push(
              <a key="build" href="/factory" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md transition-opacity hover:opacity-80" style={{ backgroundColor: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.18)", fontSize: "10px", fontWeight: 600, color: "#4ade80", letterSpacing: "0.3px", textDecoration: "none" }}>
                <span style={{ width: 5, height: 5, borderRadius: "50%", backgroundColor: "#4ade80", boxShadow: "0 0 5px #4ade8066", animation: "pulse 2s ease-in-out infinite", display: "inline-block", flexShrink: 0 }} />
                Agent active
              </a>
            );
          }
        }

        // Review state
        if (task.status === "review" || task.reviewRequired || task.codeReviewState === "pending" || task.codeReviewState === "running") {
          const isPending = task.codeReviewState === "pending" || task.codeReviewState === "running";
          const isApproved = task.reviewStatus === "approved" || task.lastReviewVerdict === "APPROVED";
          const isFailed = task.lastReviewVerdict === "NEEDS_FIX";
          const dotColor = isPending ? "#fbbf24" : isApproved ? "#4ade80" : isFailed ? "#f87171" : "#93c5fd";
          const bgColor = isPending ? "rgba(251,191,36,0.10)" : isApproved ? "rgba(74,222,128,0.08)" : isFailed ? "rgba(239,68,68,0.10)" : "rgba(96,165,250,0.08)";
          const borderColor = isPending ? "rgba(251,191,36,0.18)" : isApproved ? "rgba(74,222,128,0.16)" : isFailed ? "rgba(239,68,68,0.18)" : "rgba(96,165,250,0.16)";
          const label = task.codeReviewState === "pending" ? "QA queued" :
                        task.codeReviewState === "running" ? "QA reviewing" :
                        task.reviewStatus === "approved" ? "Approved" :
                        task.reviewStatus === "changes-requested" ? "Changes needed" :
                        task.lastReviewVerdict === "NEEDS_FIX" ? `Failed${task.reviewFailureCount ? ` ×${task.reviewFailureCount}` : ""}` :
                        task.lastReviewVerdict === "APPROVED" ? "QA passed" : "Review needed";
          chips.push(
            <span key="review" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md" style={{ backgroundColor: bgColor, border: `1px solid ${borderColor}`, fontSize: "10px", fontWeight: 600, color: dotColor, letterSpacing: "0.3px" }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", backgroundColor: dotColor, display: "inline-block", flexShrink: 0 }} />
              {label}
            </span>
          );
        }

        // Escalation
        if (task.escalatedToHenry) {
          chips.push(
            <span key="escalation" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md" style={{ backgroundColor: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.25)", fontSize: "10px", fontWeight: 600, color: "#f87171", letterSpacing: "0.3px" }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", backgroundColor: "#f87171", display: "inline-block", flexShrink: 0 }} />
              Escalated
            </span>
          );
        }

        // Visual QC
        if (task.visualReview?.required || hasUiTag(task)) {
          const captureCount = task.visualReview?.captures?.length || 0;
          chips.push(
            <span key="visual" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md" style={{ backgroundColor: "rgba(168,85,247,0.10)", border: "1px solid rgba(168,85,247,0.18)", fontSize: "10px", fontWeight: 600, color: "#d8b4fe", letterSpacing: "0.3px" }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", backgroundColor: "#d8b4fe", display: "inline-block", flexShrink: 0 }} />
              {captureCount > 0 ? `Visual QC · ${captureCount}` : "Visual QC"}
            </span>
          );
        }

        // From tasks log
        if (task.source === "tasks-log") {
          chips.push(
            <span key="source" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md" style={{ backgroundColor: "rgba(20,184,166,0.08)", border: "1px solid rgba(20,184,166,0.16)", fontSize: "10px", fontWeight: 600, color: "#5eead4", letterSpacing: "0.3px" }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", backgroundColor: "#5eead4", display: "inline-block", flexShrink: 0 }} />
              Tasks log
            </span>
          );
        }

        return chips.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 mb-3">{chips}</div>
        ) : null;
      })()}

      {/* Title */}
      <div
        className="text-sm font-semibold mb-1.5 leading-snug"
        style={{ color: "var(--text-primary)" }}
      >
        {task.title}
      </div>

      {task.description && (
        <div className="text-xs mb-3 line-clamp-2 leading-relaxed" style={{ color: "var(--text-secondary)", opacity: 0.75 }}>
          {task.description}
        </div>
      )}

      {/* Image thumbnail strip */}
      {attachmentCount > 0 && task.attachments!.some((a) => isImageType(a.type)) && (
        <div className="flex gap-1.5 mb-3 overflow-hidden" style={{ maxHeight: "44px" }}>
          {task.attachments!.filter((a) => isImageType(a.type)).slice(0, 3).map((att) => (
            <img
              key={att.id}
              src={`/api/tasks/attachments?path=${encodeURIComponent(att.path)}`}
              alt=""
              style={{ width: 44, height: 44, borderRadius: 6, objectFit: "cover", border: "1px solid var(--border)" }}
            />
          ))}
          {task.attachments!.filter((a) => isImageType(a.type)).length > 3 && (
            <div style={{ width: 44, height: 44, borderRadius: 6, backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.65rem", color: "var(--text-muted)" }}>
              +{task.attachments!.filter((a) => isImageType(a.type)).length - 3}
            </div>
          )}
        </div>
      )}

      {/* Tags — subtle pills, before footer */}
      {task.tags && task.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {task.tags.slice(0, 4).map((tag) => (
            <span
              key={tag}
              className="text-xs px-2 py-0.5 rounded-full"
              style={{
                backgroundColor: "rgba(255,255,255,0.04)",
                color: "var(--text-muted)",
                border: "1px solid rgba(255,255,255,0.07)",
              }}
            >
              #{tag}
            </span>
          ))}
          {(task.tags.length > 4) && (
            <span className="text-xs px-2 py-0.5 rounded-full" style={{ color: "var(--text-muted)", opacity: 0.5 }}>
              +{task.tags.length - 4}
            </span>
          )}
        </div>
      )}

      {/* Footer — single row: agent + model left, links + date right */}
      <div className="flex items-center justify-between pt-2.5" style={{ borderTop: "1px solid var(--border)" }}>
        <div className="flex items-center gap-2 min-w-0">
          {task.assignee && (
            <span className="flex items-center gap-1 text-xs min-w-0" style={{ color: "var(--text-secondary)" }}>
              <span className="flex-shrink-0">{ASSIGNEE_EMOJIS[task.assignee] || "🤖"}</span>
              <span className="truncate" style={{ color: "var(--text-muted)", maxWidth: 80 }}>{task.assignee}</span>
            </span>
          )}
          {(task as any).routedModel && (
            <span
              className="flex-shrink-0 text-xs px-1.5 py-0.5 rounded-md"
              style={{
                backgroundColor: (task as any).routedTier === "opus" ? "rgba(245,158,11,0.1)" : (task as any).routedTier === "gpt-5.4" ? "rgba(34,197,94,0.1)" : (task as any).routedTier === "haiku" ? "rgba(167,139,250,0.1)" : "rgba(96,165,250,0.1)",
                color: (task as any).routedTier === "opus" ? "#f59e0b" : (task as any).routedTier === "gpt-5.4" ? "#22c55e" : (task as any).routedTier === "haiku" ? "#a78bfa" : "#60a5fa",
                fontSize: "0.6rem", fontWeight: 600,
              }}
              title={`Routed to ${(task as any).routedModel} (complexity: ${(task as any).complexityScore}/100)`}
            >
              {(task as any).routedModel}
            </span>
          )}
          {attachmentCount > 0 && (
            <span className="flex-shrink-0 flex items-center gap-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
              <Paperclip className="w-3 h-3" />
              {attachmentCount}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
          {task.source_url && (
            <a
              href={task.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs transition-opacity hover:opacity-80 opacity-0 group-hover:opacity-100"
              style={{ color: "#60a5fa", textDecoration: "none" }}
              onClick={(e) => e.stopPropagation()}
              title="Source"
            >
              🔗
            </a>
          )}
          {task.github_issue && (
            <a
              href={`https://github.com/${task.github_issue}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs transition-opacity hover:opacity-80 opacity-0 group-hover:opacity-100"
              style={{ color: "#a78bfa", textDecoration: "none" }}
              onClick={(e) => e.stopPropagation()}
              title="GitHub"
            >
              GH
            </a>
          )}
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            {formatDate(task.updated)}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projectsMap, setProjectsMap] = useState<Record<string, ProjectInfo>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const [showNewTask, setShowNewTask] = useState(false);
  const [newTaskStatus, setNewTaskStatus] = useState<Task["status"]>("backlog");
  const [draggedTask, setDraggedTask] = useState<Task | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<Task["status"] | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  // Listen for Cmd+T global shortcut to open new task modal
  useEffect(() => {
    const openNewTask = () => setShowNewTask(true);
    window.addEventListener("mission-control:open-new-task", openNewTask);
    return () => window.removeEventListener("mission-control:open-new-task", openNewTask);
  }, []);

  const fetchTasks = async () => {
    try {
      const res = await fetch("/api/tasks");
      const data = await res.json();
      setTasks(data.tasks || []);
    } catch (error) {
      console.error("Error fetching tasks:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
    fetch("/api/projects")
      .then((r) => r.json())
      .then((data) => {
        const map: Record<string, ProjectInfo> = {};
        for (const p of data.projects || []) {
          map[p.id] = { id: p.id, name: p.name, emoji: p.emoji, color: p.color };
        }
        setProjectsMap(map);
      })
      .catch(console.error);
    const interval = setInterval(() => {
      // Don't refresh while user is creating/editing a task
      if (document.querySelector('[data-modal-open="true"]')) return;
      fetchTasks();
    }, 30_000);
    return () => clearInterval(interval);
  }, []);

  const handleCreateTask = async (taskData: Partial<Task>, files?: File[]) => {
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...taskData, created_by: "tim" }),
      });
      const data = await res.json();
      if (data.task) {
        let createdTask = data.task;

        // Upload attachments if provided
        if (files && files.length > 0) {
          const attachments = await uploadAttachments(createdTask.id, files);
          if (attachments.length > 0) {
            const patchRes = await fetch("/api/tasks", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: createdTask.id, attachments }),
            });
            const patchData = await patchRes.json();
            if (patchData.task) createdTask = patchData.task;
          }
        }

        setTasks((prev) => [createdTask, ...prev]);
        setShowNewTask(false);
      }
    } catch (error) {
      console.error("Error creating task:", error);
    }
  };

  const [buildingTaskId, setBuildingTaskId] = useState<string | null>(null);

  const handleStatusChange = async (id: string, newStatus: Task["status"]) => {
    setTasks((prev) => prev.map((t) => t.id === id ? { ...t, status: newStatus, updated: new Date().toISOString() } : t));
    try {
      await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status: newStatus }),
      });

      if (newStatus === "in-progress") {
        setBuildingTaskId(id);
        fetchTasks();
        setTimeout(() => setBuildingTaskId(null), 3000);
      }
    } catch (error) {
      console.error("Error updating task:", error);
      fetchTasks();
    }
  };

  const handleTaskUpdated = (updated: Task) => {
    setTasks((prev) => prev.map((t) => t.id === updated.id ? updated : t));
    setSelectedTask(updated);
  };

  const handleDragStart = (e: React.DragEvent, task: Task) => {
    setDraggedTask(task);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, columnId: Task["status"]) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverColumn(columnId);
  };

  const handleDrop = (e: React.DragEvent, columnId: Task["status"]) => {
    e.preventDefault();
    if (draggedTask && draggedTask.status !== columnId) {
      handleStatusChange(draggedTask.id, columnId);
    }
    setDraggedTask(null);
    setDragOverColumn(null);
  };

  const handleDragEnd = () => {
    setDraggedTask(null);
    setDragOverColumn(null);
  };

  const projectIds = ["all", ...Array.from(new Set(tasks.map((t) => t.project || "").filter(Boolean)))];
  const filteredTasks = filter === "all" ? tasks : tasks.filter((t) => t.project === filter);

  const tasksByStatus = COLUMNS.reduce((acc, col) => {
    acc[col.id] = filteredTasks.filter((t) => t.status === col.id);
    return acc;
  }, {} as Record<string, Task[]>);

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[400px]">
        <div className="animate-pulse text-lg" style={{ color: "var(--text-muted)" }}>
          Loading tasks...
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1
              className="text-3xl font-bold mb-2"
              style={{
                fontFamily: "var(--font-heading)",
                color: "var(--text-primary)",
                letterSpacing: "-1.5px",
              }}
            >
              <Kanban className="inline-block w-8 h-8 mr-2 mb-1" />
              Task Board
            </h1>
            <p style={{ color: "var(--text-secondary)", fontSize: "14px" }}>
              {tasks.length} total · {tasksByStatus["in-progress"]?.length || 0} building · {tasksByStatus["review"]?.length || 0} in review
              {tasks.filter((t) => t.escalatedToHenry).length > 0 && (
                <span style={{ color: "#f87171", marginLeft: "0.5rem", fontWeight: 700 }}>
                  · 🚨 {tasks.filter((t) => t.escalatedToHenry).length} escalated
                </span>
              )}
              {tasks.filter((t) => t.source === "tasks-log").length > 0 && (
                <span style={{ color: "#5eead4", marginLeft: "0.5rem" }}>
                  · {tasks.filter((t) => t.source === "tasks-log").length} from log
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchTasks}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all hover:scale-105"
              style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
            <button
              onClick={() => { setNewTaskStatus("backlog"); setShowNewTask(true); }}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all hover:scale-105"
              style={{ backgroundColor: "var(--accent)", border: "none", color: "#000", fontWeight: 700 }}
            >
              <Plus className="w-4 h-4" />
              New Task
            </button>
          </div>
        </div>

        {/* Project Filter */}
        <div className="flex gap-2 mt-4 flex-wrap">
          {projectIds.map((p) => {
            const proj = projectsMap[p];
            const label = p === "all" ? "All Projects" : proj ? `${proj.emoji} ${proj.name}` : p;
            return (
              <button
                key={p}
                onClick={() => setFilter(p)}
                className="text-sm px-3 py-1 rounded-full font-medium transition-all"
                style={{
                  backgroundColor: filter === p ? "var(--accent)" : "var(--card)",
                  color: filter === p ? "var(--background)" : "var(--text-secondary)",
                  border: `1px solid ${filter === p ? "var(--accent)" : "var(--border)"}`,
                  cursor: "pointer",
                }}
              >
                {label}
                {p !== "all" && (
                  <span className="ml-1.5 opacity-70">
                    {tasks.filter((t) => t.project === p).length}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Kanban Board */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
        {COLUMNS.map((col) => {
          const colTasks = tasksByStatus[col.id] || [];
          const Icon = col.icon;
          const isOver = dragOverColumn === col.id;
          return (
            <div
              key={col.id}
              className="flex flex-col"
              onDragOver={(e) => handleDragOver(e, col.id)}
              onDrop={(e) => handleDrop(e, col.id)}
              onDragLeave={() => setDragOverColumn(null)}
            >
              {/* Column Header */}
              <div
                className="flex items-center justify-between px-3 py-2.5 rounded-t-xl"
                style={{
                  backgroundColor: "var(--card)",
                  borderTop: `3px solid ${col.color}`,
                  borderLeft: "1px solid var(--border)",
                  borderRight: "1px solid var(--border)",
                }}
              >
                <div className="flex items-center gap-2">
                  <Icon className="w-4 h-4" style={{ color: col.color }} />
                  <span
                    className="text-sm font-semibold"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {col.label}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className="text-xs font-bold px-2 py-0.5 rounded-full"
                    style={{
                      backgroundColor: `${col.color}20`,
                      color: col.color,
                    }}
                  >
                    {colTasks.length}
                  </span>
                  <button
                    onClick={() => { setNewTaskStatus(col.id); setShowNewTask(true); }}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: "0.125rem", borderRadius: "0.25rem" }}
                    title={`Add to ${col.label}`}
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Column Body */}
              <div
                className="flex-1 p-3 rounded-b-xl min-h-[200px] transition-colors"
                style={{
                  backgroundColor: isOver ? `${col.color}10` : "var(--card-elevated)",
                  border: isOver ? `1px dashed ${col.color}80` : "1px solid var(--border)",
                  borderTop: "none",
                }}
              >
                {colTasks.length === 0 ? (
                  <div
                    className="text-center py-8 text-xs"
                    style={{ color: isOver ? col.color : "var(--text-muted)", opacity: isOver ? 1 : 0.6 }}
                  >
                    {isOver ? "Drop here" : "No tasks"}
                  </div>
                ) : (
                  colTasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      onDragStart={handleDragStart}
                      onStatusChange={handleStatusChange}
                      onClick={setSelectedTask}
                      projectsMap={projectsMap}
                      isBuilding={buildingTaskId === task.id}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* New Task Modal */}
      {showNewTask && (
        <NewTaskModal
          onClose={() => setShowNewTask(false)}
          onSave={handleCreateTask}
          defaultStatus={newTaskStatus}
          projectsMap={projectsMap}
        />
      )}

      {/* Task Detail Drawer */}
      {selectedTask && (
        <TaskDetailDrawer
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
          onTaskUpdated={handleTaskUpdated}
          projectsMap={projectsMap}
        />
      )}
    </div>
  );
}
