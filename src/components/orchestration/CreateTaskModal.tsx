"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Bot, BriefcaseBusiness, Calendar, Check, ChevronLeft, ChevronRight, Gauge, Loader2, Maximize2, Link2, Tag, Workflow, X } from "lucide-react";
import { createTask, createTaskComment, listCompanies, listCompanyAgents, listCompanyExecutionHives, listProjects, updateTask } from "@/lib/orchestration/client";
import { PRIORITY_META, STATUS_META } from "@/components/orchestration/task-display";
import { StatusCircle } from "@/components/orchestration/StatusCircle";
import { PriorityBars } from "@/components/orchestration/PriorityBars";
import { AvatarGlyph } from "@/components/orchestration/AvatarGlyph";
import { HiveRunnerMarkIcon } from "@/components/HiveRunnerMarkIcon";
import { buildCreateTaskModalInput } from "@/components/orchestration/create-task-modal-input";
import { resolveAvatar } from "@/components/tasks/InlineAssigneePicker";
import { STATUS_ORDER } from "@/components/tasks/types";
import { formatOrchestrationModeLabel, type ExecutionHive, type RouteTarget } from "@/lib/orchestration/execution-hives";
import { formatProjectDisplayName, isHiveRunnerOrchestrationProject } from "@/lib/orchestration/project-display";
import { TASK_MODEL_LANES } from "@/lib/orchestration/task-model-routing";
import { color, font } from "@/lib/ui/tokens";
import type { OrchestrationAgent, OrchestrationProject, TaskExecutionEngine, TaskModelLane, TaskPriority, TaskStatus } from "@/lib/orchestration/types";

export interface CreateTaskModalParentContext {
  taskId: string;
  taskKey?: string;
  title: string;
  projectId: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated?: () => void;
  companySlug: string;
  companyCode: string;
  companyName?: string;
  defaultAssignee?: string;
  defaultProjectId?: string;
  parentContext?: CreateTaskModalParentContext;
}

type MenuKey = "status" | "priority" | "assignee" | "project" | "engine" | "model" | "due" | "tags" | null;
type UploadedAttachment = {
  id: string;
  name: string;
  type: string;
  size: number;
  path: string;
};

const priorities: TaskPriority[] = ["P0", "P1", "P2", "P3"];
const inheritedExecutionEngineOption: { value: TaskExecutionEngine | null; label: string } = { value: null, label: "Inherited" };
const baseExecutionEngineOptions: Array<{ value: TaskExecutionEngine; label: string }> = [
  { value: "hiverunner", label: formatCreateTaskExecutionModeLabel("hiverunner") },
  { value: "symphony", label: formatOrchestrationModeLabel("symphony") },
  { value: "manual", label: formatCreateTaskExecutionModeLabel("manual") },
];
const weekdayLabels = ["S", "M", "T", "W", "T", "F", "S"];

function formatCreateTaskExecutionModeLabel(value: TaskExecutionEngine): string {
  if (value === "manual") return "Manual";
  return formatOrchestrationModeLabel(value);
}

function menuButtonStyle(active = false): React.CSSProperties {
  return {
    height: 34,
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    borderRadius: 999,
    border: `1px solid ${active ? color.borderStrong : color.border}`,
    background: active ? color.surfaceHover : color.surface,
    color: color.text,
    padding: "0 12px",
    fontFamily: font.body,
    fontSize: 14,
    lineHeight: 1,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };
}

function ProjectMenuGlyph({ project }: { project: OrchestrationProject }) {
  if (isHiveRunnerOrchestrationProject(project)) {
    return <HiveRunnerMarkIcon size={16} strokeWidth={2.2} />;
  }
  return <span style={{ width: 8, height: 8, borderRadius: 999, background: project.color, flexShrink: 0 }} />;
}

function attachmentUrl(attachment: UploadedAttachment): string {
  const params = new URLSearchParams({ path: attachment.path });
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/api/tasks/attachments?${params.toString()}`;
}

function markdownLabel(value: string): string {
  return value.replace(/[\[\]\n\r]/g, " ").replace(/\s+/g, " ").trim() || "attachment";
}

function extensionForMime(type: string): string {
  if (type === "image/jpeg") return "jpg";
  if (type === "image/png") return "png";
  if (type === "image/gif") return "gif";
  if (type === "image/webp") return "webp";
  return "png";
}

function attachmentMarkdown(attachments: UploadedAttachment[]): string {
  if (attachments.length === 0) return "";
  const lines = attachments.map((attachment) => {
    const label = markdownLabel(attachment.name);
    const url = attachmentUrl(attachment);
    return attachment.type.startsWith("image/")
      ? `![${label}](${url})`
      : `[${label}](${url})`;
  });
  return `**Attachments**\n\n${lines.join("\n\n")}`;
}

async function uploadTaskAttachments(taskId: string, files: File[]): Promise<UploadedAttachment[]> {
  if (files.length === 0) return [];
  const formData = new FormData();
  formData.append("taskId", taskId);
  for (const file of files) {
    formData.append("files", file);
  }
  const response = await fetch("/api/tasks/attachments", { method: "POST", body: formData });
  if (!response.ok) throw new Error("attachment_upload_failed");
  const payload = await response.json() as { attachments?: UploadedAttachment[] };
  return payload.attachments ?? [];
}

function popoverStyle(width = 220, align: "left" | "right" = "left"): React.CSSProperties {
  return {
    position: "absolute",
    zIndex: 140,
    ...(align === "right" ? { right: 0 } : { left: 0 }),
    bottom: "calc(100% + 8px)",
    width,
    borderRadius: 12,
    border: `1px solid ${color.border}`,
    background: color.surfaceElevated,
    boxShadow: "0 18px 50px rgba(0,0,0,0.24)",
    padding: 6,
  };
}

function formatCreateTaskLaneLabel(value: TaskModelLane): string {
  switch (value) {
    case "fast":
      return "Fast Lane";
    case "mini":
      return "Mini Lane";
    case "deep":
      return "Deep Lane";
    case "default":
    default:
      return "Default Lane";
  }
}

function routeTargetProviderName(targetValue: RouteTarget): string {
  const runtime = targetValue.runtimeLabel ?? targetValue.runtimeId;
  if (runtime) {
    const normalized = runtime.toLowerCase();
    if (normalized.includes("claude") || normalized.includes("anthropic")) return "Claude Code";
    if (normalized.includes("gemini") || normalized.includes("google")) return "Gemini CLI";
    if (normalized.includes("hermes")) return "Hermes";
    if (normalized.includes("openclaw")) return "OpenClaw";
    if (normalized.includes("codex")) return "Codex";
    return runtime;
  }
  return targetValue.modelSourceLabel ?? targetValue.modelSourceId ?? "Runtime";
}

function isGenericRouteModel(value: string | null | undefined): boolean {
  if (!value) return true;
  const normalized = value.trim().toLowerCase();
  return [
    "runtime managed",
    "hive managed",
    "mini/fast model",
    "deep profile",
    "deep reasoning profile",
    "vision-capable model",
    "gemini vision-capable model",
    "local capable model",
    "cheap capable fallback",
    "platform managed",
    "profile managed",
  ].includes(normalized);
}

function formatRouteTargetCompact(targetValue: RouteTarget): string {
  const provider = routeTargetProviderName(targetValue);
  const model = targetValue.modelId ?? (isGenericRouteModel(targetValue.modelLabel) ? null : targetValue.modelLabel);
  if (model) return `${provider} (${model})`;
  if (targetValue.mode === "broker") return `${provider} (broker)`;
  if (targetValue.mode === "direct_source") return `${provider} (direct)`;
  if (targetValue.mode === "local") return `${provider} (local)`;
  return `${provider} (Auto)`;
}

function formatFallbackSummary(targets: RouteTarget[]): string {
  if (targets.length === 0) return "No fallback";
  return targets.map(formatRouteTargetCompact).join(" → ");
}

function formatDateValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateValue(value: string): Date | null {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

function formatDueDateLabel(value: string): string {
  const date = parseDateValue(value);
  if (!date) return "Due date";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function sameCalendarDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function buildCalendarDays(monthDate: Date): Date[] {
  const start = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  start.setDate(start.getDate() - start.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

export function CreateTaskModal({
  open,
  onClose,
  onCreated,
  companySlug,
  companyCode,
  companyName,
  defaultAssignee,
  defaultProjectId,
  parentContext,
}: Props) {
  const isSubtaskFlow = Boolean(parentContext);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState("");
  const [assignee, setAssignee] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("P2");
  const [status, setStatus] = useState<TaskStatus>("to-do");
  const [dueDate, setDueDate] = useState("");
  const [executionEngine, setExecutionEngine] = useState<TaskExecutionEngine | null>(() => isSubtaskFlow ? null : "hiverunner");
  const [modelLaneOverride, setModelLaneOverride] = useState<TaskModelLane | null>(null);
  const [dueMonth, setDueMonth] = useState(() => new Date());
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolvedCompanyName, setResolvedCompanyName] = useState(companyName ?? "");
  const [projects, setProjects] = useState<OrchestrationProject[]>([]);
  const [agents, setAgents] = useState<OrchestrationAgent[]>([]);
  const [activeHive, setActiveHive] = useState<ExecutionHive | null>(null);
  const [menu, setMenu] = useState<MenuKey>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const executionEngineOptions = useMemo<Array<{ value: TaskExecutionEngine | null; label: string }>>(
    () => isSubtaskFlow ? [inheritedExecutionEngineOption, ...baseExecutionEngineOptions] : baseExecutionEngineOptions,
    [isSubtaskFlow],
  );

  const canSubmit = useMemo(() => title.trim().length >= 2, [title]);
  const selectedAgent = agents.find((agent) => agent.id === assignee);
  const selectedProject = projects.find((project) => project.id === projectId);
  const effectiveExecutionEngine = isSubtaskFlow ? executionEngine : (executionEngine ?? "hiverunner");
  const selectedEngineOption = executionEngineOptions.find((option) => option.value === effectiveExecutionEngine) ?? executionEngineOptions[0];
  const selectedModelLane = parentContext && modelLaneOverride === null
    ? "Inherited"
    : formatCreateTaskLaneLabel(modelLaneOverride ?? "default");
  const selectedLane = activeHive?.lanes.find((lane) => lane.id === (modelLaneOverride ?? "default"));
  const selectedLanePrimary = selectedLane ? formatRouteTargetCompact(selectedLane.primary) : null;
  const selectedLaneFallbacks = selectedLane ? formatFallbackSummary(selectedLane.fallbacks) : null;
  const displayCompanyName = resolvedCompanyName.trim() || companyName?.trim() || companySlug || companyCode;
  const createButtonLabel = parentContext ? "Create subtask" : "Create task";

  const reset = useCallback(() => {
    setTitle("");
    setDescription("");
    setProjectId(parentContext?.projectId ?? defaultProjectId ?? "");
    setAssignee("");
    setPriority("P2");
    setStatus("to-do");
    setExecutionEngine(isSubtaskFlow ? null : "hiverunner");
    setModelLaneOverride(null);
    setDueDate("");
    setDueMonth(new Date());
    setTags([]);
    setTagDraft("");
    setFiles([]);
    setError(null);
    setMenu(null);
  }, [defaultProjectId, isSubtaskFlow, parentContext?.projectId]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) {
        setMenu(null);
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, submitting]);

  useEffect(() => {
    if (!menu) return;
    const close = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenu(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = async () => {
      const [projectRows, agentRows, companyRows, hiveRows] = await Promise.all([
        listProjects({ company: companySlug }),
        listCompanyAgents(companySlug),
        companyName?.trim() ? Promise.resolve([]) : listCompanies(),
        listCompanyExecutionHives(companySlug),
      ]);
      if (cancelled) return;
      setProjects(projectRows);
      setAgents(agentRows.sort((a, b) => a.name.localeCompare(b.name)));
      setActiveHive(hiveRows.find((hive) => hive.isActive) ?? hiveRows[0] ?? null);
      if (companyName?.trim()) {
        setResolvedCompanyName(companyName);
      } else {
        const key = companySlug.toLowerCase();
        const code = companyCode.toLowerCase();
        const match = companyRows.find((row) => row.slug.toLowerCase() === key || row.code.toLowerCase() === key || row.code.toLowerCase() === code);
        setResolvedCompanyName(match?.name ?? "");
      }

      if (defaultAssignee) {
        const match = agentRows.find((agent) => agent.name.toLowerCase() === defaultAssignee.toLowerCase());
        if (match) setAssignee(match.id);
      }

      setProjectId(parentContext?.projectId ?? defaultProjectId ?? "");
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [open, companySlug, companyCode, companyName, defaultAssignee, defaultProjectId, parentContext?.projectId]);

  const handleClose = () => {
    if (submitting) return;
    reset();
    onClose();
  };

  const handleCreate = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError(null);

    try {
      const task = await createTask(buildCreateTaskModalInput({
        companySlug,
        projectId,
        title,
        description,
        priority,
        status,
        assignee,
        dueDate,
        tags,
        executionEngine: effectiveExecutionEngine,
        modelLaneOverride,
        parentTaskId: parentContext?.taskId,
      }));

      if (!task) {
        setError("Failed to create task. Please try again.");
        return;
      }

      if (files.length > 0) {
        const attachments = await uploadTaskAttachments(task.id, files);
        const markdown = attachmentMarkdown(attachments);
        if (markdown) {
          const nextDescription = [description.trim(), markdown].filter(Boolean).join("\n\n");
          await updateTask({ taskId: task.id, description: nextDescription });
          await createTaskComment({
            taskId: task.id,
            body: markdown,
            authorUserId: "me",
          });
        }
      }

      reset();
      onCreated?.();
      onClose();
    } catch {
      setError("Created task details could not be saved. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const addFiles = useCallback((incoming: File[] | FileList) => {
    const nextFiles = Array.from(incoming).filter((file) => file.size > 0);
    if (nextFiles.length === 0) return;
    setFiles((current) => {
      const seen = new Set(current.map((file) => `${file.name}:${file.size}:${file.type}`));
      const next = [...current];
      for (const file of nextFiles) {
        const key = `${file.name}:${file.size}:${file.type}`;
        if (seen.has(key)) continue;
        seen.add(key);
        next.push(file);
      }
      return next;
    });
  }, []);

  const removeFile = (index: number) => {
    setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index));
  };

  const handleDescriptionPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pastedFiles: File[] = [];
    for (const item of Array.from(event.clipboardData.items)) {
      if (!item.type.startsWith("image/")) continue;
      const file = item.getAsFile();
      if (!file) continue;
      const name = file.name && file.name !== "image.png"
        ? file.name
        : `pasted-image-${Date.now()}-${pastedFiles.length + 1}.${extensionForMime(file.type)}`;
      pastedFiles.push(new File([file], name, { type: file.type, lastModified: file.lastModified }));
    }
    if (pastedFiles.length > 0) {
      event.preventDefault();
      addFiles(pastedFiles);
    }
  };

  const addTags = (value: string) => {
    const incoming = value
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean)
      .map((tag) => tag.slice(0, 60));
    if (incoming.length === 0) return;
    setTags((current) => {
      const seen = new Set(current.map((tag) => tag.toLowerCase()));
      const next = [...current];
      for (const tag of incoming) {
        const key = tag.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        next.push(tag);
        if (next.length >= 32) break;
      }
      return next;
    });
    setTagDraft("");
  };

  const removeTag = (tag: string) => {
    setTags((current) => current.filter((item) => item !== tag));
  };

  const calendarDays = useMemo(() => buildCalendarDays(dueMonth), [dueMonth]);
  const selectedDueDate = useMemo(() => parseDateValue(dueDate), [dueDate]);
  const today = useMemo(() => new Date(), []);
  const tomorrow = useMemo(() => {
    const date = new Date(today);
    date.setDate(today.getDate() + 1);
    return date;
  }, [today]);

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--modal-backdrop)",
        backdropFilter: "blur(12px) saturate(1.25)",
        WebkitBackdropFilter: "blur(12px) saturate(1.25)",
        padding: 24,
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) handleClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Create new task"
        style={{
          width: "min(1120px, calc(100vw - 48px))",
          minHeight: "min(520px, calc(100vh - 80px))",
          maxHeight: "calc(100vh - 64px)",
          display: "flex",
          flexDirection: "column",
          borderRadius: 16,
          border: `1px solid ${color.border}`,
          background: "var(--modal-glass)",
          color: color.text,
          boxShadow: "0 24px 70px rgba(0,0,0,0.22)",
          backdropFilter: "blur(28px) saturate(1.35)",
          WebkitBackdropFilter: "blur(28px) saturate(1.35)",
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 24px 8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, color: color.textSecondary, fontSize: 14 }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 280 }}>{displayCompanyName}</span>
            <span style={{ color: color.textMuted }}>›</span>
            <strong style={{ color: color.text, fontWeight: 600 }}>{parentContext ? "New subtask" : "New task"}</strong>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button type="button" aria-label="Expand" style={menuButtonStyle(false)}>
              <Maximize2 size={15} />
            </button>
            <button type="button" aria-label="Close" onClick={handleClose} style={{ ...menuButtonStyle(false), width: 34, padding: 0, justifyContent: "center" }}>
              <X size={17} />
            </button>
          </div>
        </div>

        <div style={{ flex: 1, padding: "18px 24px 12px", display: "flex", flexDirection: "column", minHeight: 0 }}>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Task title"
            autoFocus
            style={{
              width: "100%",
              border: 0,
              outline: "none",
              background: "transparent",
              color: color.text,
              fontFamily: font.body,
              fontSize: 26,
              fontWeight: 650,
              letterSpacing: 0,
              padding: 0,
            }}
          />
          <textarea
            ref={descriptionRef}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            onPaste={handleDescriptionPaste}
            placeholder="Add description..."
            style={{
              flex: 1,
              minHeight: 260,
              width: "100%",
              border: 0,
              outline: "none",
              resize: "none",
              background: "transparent",
              color: color.text,
              fontFamily: font.body,
              fontSize: 18,
              lineHeight: 1.45,
              padding: "22px 0 0",
            }}
          />
          {files.length > 0 ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, paddingTop: 12 }}>
              {files.map((file, index) => (
                <button
                  key={`${file.name}-${file.size}-${index}`}
                  type="button"
                  onClick={() => removeFile(index)}
                  title={`Remove ${file.name}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    maxWidth: 240,
                    minHeight: 28,
                    borderRadius: 999,
                    border: `1px solid ${color.border}`,
                    background: color.surface,
                    color: color.textSecondary,
                    padding: "0 9px",
                    fontFamily: font.body,
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  <Link2 size={13} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name}</span>
                  <X size={12} />
                </button>
              ))}
            </div>
          ) : null}
          {error ? <p style={{ margin: "8px 0 0", fontSize: 13, color: color.negative }}>{error}</p> : null}
        </div>

        <div ref={menuRef} style={{ position: "relative", borderTop: `1px solid ${color.border}` }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, padding: "14px 24px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "nowrap", minWidth: 0, overflow: "visible" }}>
              <div style={{ position: "relative" }}>
                <button type="button" onClick={() => setMenu(menu === "status" ? null : "status")} style={menuButtonStyle(menu === "status")}>
                  <StatusCircle status={status} size={16} />
                  {STATUS_META[status].label}
                </button>
                {menu === "status" ? (
                  <div style={popoverStyle(230)}>
                    {STATUS_ORDER.map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => {
                          setStatus(item);
                          setMenu(null);
                        }}
                        style={{ ...menuButtonStyle(status === item), width: "100%", justifyContent: "space-between", borderRadius: 8, marginBottom: 2 }}
                      >
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                          <StatusCircle status={item} size={16} />
                          {STATUS_META[item].label}
                        </span>
                        {status === item ? <Check size={15} /> : null}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <div style={{ position: "relative" }}>
                <button type="button" onClick={() => setMenu(menu === "priority" ? null : "priority")} style={menuButtonStyle(menu === "priority")}>
                  <PriorityBars priority={priority} />
                  {PRIORITY_META[priority].label}
                </button>
                {menu === "priority" ? (
                  <div style={popoverStyle(220)}>
                    {priorities.map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => {
                          setPriority(item);
                          setMenu(null);
                        }}
                        style={{ ...menuButtonStyle(priority === item), width: "100%", justifyContent: "space-between", borderRadius: 8, marginBottom: 2 }}
                      >
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 10, color: PRIORITY_META[item].color }}>
                          <PriorityBars priority={item} />
                          {PRIORITY_META[item].label}
                        </span>
                        {priority === item ? <Check size={15} /> : null}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <div style={{ position: "relative" }}>
                <button type="button" onClick={() => setMenu(menu === "assignee" ? null : "assignee")} style={menuButtonStyle(menu === "assignee")}>
                  {selectedAgent ? (
                    <>
                      {resolveAvatar(selectedAgent) ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={resolveAvatar(selectedAgent)} alt="" style={{ width: 18, height: 18, borderRadius: 999, objectFit: "cover" }} />
                      ) : (
                        <AvatarGlyph value={selectedAgent.emoji} size={16} />
                      )}
                      {selectedAgent.name}
                    </>
                  ) : (
                    <>
                      <Bot size={16} />
                      Assignee
                    </>
                  )}
                </button>
                {menu === "assignee" ? (
                  <div style={{ ...popoverStyle(380), maxHeight: 360, overflowY: "auto" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                    <button type="button" onClick={() => { setAssignee(""); setMenu(null); }} style={{ ...menuButtonStyle(!assignee), gridColumn: "1 / -1", width: "100%", justifyContent: "space-between", borderRadius: 8 }}>
                      Unassigned {!assignee ? <Check size={15} /> : null}
                    </button>
                    {agents.map((agent) => {
                      const avatar = resolveAvatar(agent);
                      return (
                        <button key={agent.id} type="button" title={agent.name} onClick={() => { setAssignee(agent.id); setMenu(null); }} style={{ ...menuButtonStyle(assignee === agent.id), width: "100%", minWidth: 0, justifyContent: "space-between", borderRadius: 8 }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                            {avatar ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={avatar} alt="" style={{ width: 18, height: 18, borderRadius: 999, objectFit: "cover" }} />
                            ) : (
                              <AvatarGlyph value={agent.emoji} size={16} />
                            )}
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{agent.name}</span>
                          </span>
                          {assignee === agent.id ? <Check size={15} /> : null}
                        </button>
                      );
                    })}
                    </div>
                  </div>
                ) : null}
              </div>

              <div style={{ position: "relative" }}>
                <button
                  type="button"
                  onClick={() => {
                    setDueMonth(parseDateValue(dueDate) ?? new Date());
                    setMenu(menu === "due" ? null : "due");
                  }}
                  style={menuButtonStyle(menu === "due")}
                >
                  <Calendar size={16} />
                  {formatDueDateLabel(dueDate)}
                </button>
                {menu === "due" ? (
                  <div style={popoverStyle(250)}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "2px 2px 8px" }}>
                      <button
                        type="button"
                        aria-label="Previous month"
                        onClick={() => setDueMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}
                        style={{ ...menuButtonStyle(false), width: 30, height: 30, padding: 0, justifyContent: "center", borderRadius: 8 }}
                      >
                        <ChevronLeft size={15} />
                      </button>
                      <div style={{ fontSize: 13, fontWeight: 700, color: color.text, textAlign: "center" }}>
                        {dueMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
                      </div>
                      <button
                        type="button"
                        aria-label="Next month"
                        onClick={() => setDueMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}
                        style={{ ...menuButtonStyle(false), width: 30, height: 30, padding: 0, justifyContent: "center", borderRadius: 8 }}
                      >
                        <ChevronRight size={15} />
                      </button>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3, marginBottom: 4 }}>
                      {weekdayLabels.map((label, index) => (
                        <div key={`${label}-${index}`} style={{ height: 22, display: "grid", placeItems: "center", fontSize: 11, fontWeight: 700, color: color.textMuted }}>
                          {label}
                        </div>
                      ))}
                      {calendarDays.map((date) => {
                        const inMonth = date.getMonth() === dueMonth.getMonth();
                        const selected = selectedDueDate ? sameCalendarDay(date, selectedDueDate) : false;
                        const isToday = sameCalendarDay(date, today);
                        return (
                          <button
                            key={formatDateValue(date)}
                            type="button"
                            onClick={() => {
                              setDueDate(formatDateValue(date));
                              setMenu(null);
                            }}
                            style={{
                              height: 30,
                              borderRadius: 8,
                              border: `1px solid ${selected ? color.borderStrong : "transparent"}`,
                              background: selected ? color.accent : isToday ? color.accentSoft : "transparent",
                              color: selected ? "#fff" : inMonth ? color.text : color.textMuted,
                              opacity: inMonth ? 1 : 0.55,
                              fontFamily: font.body,
                              fontSize: 12,
                              fontWeight: selected ? 700 : 500,
                              cursor: "pointer",
                            }}
                          >
                            {date.getDate()}
                          </button>
                        );
                      })}
                    </div>
                    <div style={{ display: "flex", gap: 6, paddingTop: 6, borderTop: `1px solid ${color.border}` }}>
                      <button
                        type="button"
                        onClick={() => {
                          setDueDate(formatDateValue(today));
                          setMenu(null);
                        }}
                        style={{ ...menuButtonStyle(false), flex: 1, justifyContent: "center", borderRadius: 8, fontSize: 12 }}
                      >
                        Today
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDueDate(formatDateValue(tomorrow));
                          setMenu(null);
                        }}
                        style={{ ...menuButtonStyle(false), flex: 1, justifyContent: "center", borderRadius: 8, fontSize: 12 }}
                      >
                        Tomorrow
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDueDate("");
                          setMenu(null);
                        }}
                        style={{ ...menuButtonStyle(false), flex: 1, justifyContent: "center", borderRadius: 8, fontSize: 12 }}
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              <div style={{ position: "relative" }}>
                <button
                  type="button"
                  disabled={Boolean(parentContext)}
                  onClick={() => setMenu(menu === "project" ? null : "project")}
                  style={{ ...menuButtonStyle(menu === "project"), cursor: parentContext ? "not-allowed" : "pointer", opacity: parentContext ? 0.72 : 1 }}
                >
                  <BriefcaseBusiness size={16} />
                  {selectedProject ? formatProjectDisplayName(selectedProject) : "No project"}
                </button>
                {menu === "project" && !parentContext ? (
                  <div style={popoverStyle(260)}>
                    <button type="button" onClick={() => { setProjectId(""); setMenu(null); }} style={{ ...menuButtonStyle(!projectId), width: "100%", justifyContent: "space-between", borderRadius: 8, marginBottom: 2 }}>
                      No project {!projectId ? <Check size={15} /> : null}
                    </button>
                    {projects.map((project) => (
                      <button key={project.id} type="button" onClick={() => { setProjectId(project.id); setMenu(null); }} style={{ ...menuButtonStyle(projectId === project.id), width: "100%", justifyContent: "space-between", borderRadius: 8, marginBottom: 2 }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                          <ProjectMenuGlyph project={project} />
                          {formatProjectDisplayName(project)}
                        </span>
                        {projectId === project.id ? <Check size={15} /> : null}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <div style={{ position: "relative" }}>
                <button type="button" onClick={() => setMenu(menu === "engine" ? null : "engine")} style={{ ...menuButtonStyle(menu === "engine"), minWidth: 150, justifyContent: "center" }}>
                  <Workflow size={16} />
                  {selectedEngineOption.label}
                </button>
                {menu === "engine" ? (
                  <div style={popoverStyle(250, "right")}>
                    {executionEngineOptions.map((item) => (
                      <button
                        key={item.value ?? "inherit"}
                        type="button"
                        onClick={() => {
                          setExecutionEngine(item.value);
                          setMenu(null);
                        }}
                        style={{ ...menuButtonStyle(effectiveExecutionEngine === item.value), width: "100%", justifyContent: "space-between", borderRadius: 8, marginBottom: 2 }}
                      >
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                          <Workflow size={15} />
                          {item.label}
                        </span>
                        {effectiveExecutionEngine === item.value ? <Check size={15} /> : null}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <div style={{ position: "relative" }}>
                <button type="button" onClick={() => setMenu(menu === "model" ? null : "model")} style={menuButtonStyle(menu === "model")}>
                  <Gauge size={16} />
                  {selectedModelLane}
                </button>
                {menu === "model" ? (
                  <div style={popoverStyle(400, "right")}>
                    {parentContext ? (
                      <button
                        type="button"
                        onClick={() => {
                          setModelLaneOverride(null);
                          setMenu(null);
                        }}
                        style={{ ...menuButtonStyle(modelLaneOverride === null), width: "100%", minHeight: 44, height: "auto", justifyContent: "space-between", borderRadius: 8, marginBottom: 2, alignItems: "flex-start", padding: "8px 10px" }}
                      >
                        <span style={{ display: "grid", gap: 3, textAlign: "left" }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                            <Gauge size={15} />
                            Inherited
                          </span>
                          <span style={{ color: color.textMuted, fontSize: 12, lineHeight: 1.3 }}>Use parent task lane.</span>
                        </span>
                        {modelLaneOverride === null ? <Check size={15} style={{ marginTop: 2, flexShrink: 0 }} /> : null}
                      </button>
                    ) : null}
                    {TASK_MODEL_LANES.map((item) => (
                      (() => {
                        const lane = activeHive?.lanes.find((candidate) => candidate.id === item.value);
                        const primary = lane ? formatRouteTargetCompact(lane.primary) : null;
                        const fallbacks = lane ? formatFallbackSummary(lane.fallbacks) : null;
                        const selected = modelLaneOverride === item.value || (!parentContext && modelLaneOverride === null && item.value === "default");
                        const laneLabel = formatCreateTaskLaneLabel(item.value);
                        return (
                          <button
                            key={item.value}
                            type="button"
                            onClick={() => {
                              setModelLaneOverride(item.value);
                              setMenu(null);
                            }}
                            style={{ ...menuButtonStyle(selected), width: "100%", minHeight: 54, height: "auto", justifyContent: "space-between", borderRadius: 8, marginBottom: 2, alignItems: "flex-start", padding: "8px 10px" }}
                          >
                            <span style={{ display: "grid", gap: 3, textAlign: "left", minWidth: 0 }}>
                              <span style={{ display: "flex", alignItems: "flex-start", gap: 10, minWidth: 0, whiteSpace: "normal", lineHeight: 1.25 }}>
                                <Gauge size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                                <span style={{ minWidth: 0, whiteSpace: "normal", lineHeight: 1.25 }}>
                                  <strong>{laneLabel}</strong>
                                  {primary ? ` · ${primary}` : null}
                                </span>
                              </span>
                              <span style={{ color: color.textMuted, fontSize: 12, lineHeight: 1.3 }}>
                                {fallbacks
                                  ? `Fallback: ${fallbacks}`
                                  : item.description}
                              </span>
                            </span>
                            {selected ? <Check size={15} style={{ marginTop: 2, flexShrink: 0 }} /> : null}
                          </button>
                        );
                      })()
                    ))}
                    {!parentContext && selectedLanePrimary ? (
                      <div style={{ marginTop: 6, padding: "8px 10px", borderTop: `1px solid ${color.border}`, color: color.textMuted, fontSize: 12, lineHeight: 1.35 }}>
                        Runs on {selectedLanePrimary}. Fallback: {selectedLaneFallbacks}.
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div style={{ position: "relative" }}>
                <button type="button" onClick={() => setMenu(menu === "tags" ? null : "tags")} style={menuButtonStyle(menu === "tags")}>
                  <Tag size={16} />
                  {tags.length > 0 ? `${tags.length} tag${tags.length === 1 ? "" : "s"}` : "Tags"}
                </button>
                {menu === "tags" ? (
                  <div style={popoverStyle(280, "right")}>
                    <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                      <input
                        value={tagDraft}
                        onChange={(event) => setTagDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === ",") {
                            event.preventDefault();
                            addTags(tagDraft);
                          }
                          if (event.key === "Backspace" && !tagDraft && tags.length > 0) {
                            removeTag(tags[tags.length - 1]);
                          }
                        }}
                        placeholder="Add tags..."
                        autoFocus
                        style={{
                          flex: 1,
                          minWidth: 0,
                          height: 34,
                          borderRadius: 8,
                          border: `1px solid ${color.border}`,
                          background: color.surface,
                          color: color.text,
                          padding: "0 10px",
                          fontFamily: font.body,
                          fontSize: 13,
                          outline: "none",
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => addTags(tagDraft)}
                        disabled={!tagDraft.trim() || tags.length >= 32}
                        style={{
                          ...menuButtonStyle(false),
                          borderRadius: 8,
                          opacity: !tagDraft.trim() || tags.length >= 32 ? 0.55 : 1,
                        }}
                      >
                        Add
                      </button>
                    </div>
                    {tags.length > 0 ? (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {tags.map((tag) => (
                          <button
                            key={tag}
                            type="button"
                            onClick={() => removeTag(tag)}
                            title={`Remove ${tag}`}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 5,
                              minHeight: 26,
                              borderRadius: 999,
                              border: `1px solid ${color.border}`,
                              background: color.surface,
                              color: color.textSecondary,
                              padding: "0 8px",
                              fontFamily: font.body,
                              fontSize: 12,
                              cursor: "pointer",
                            }}
                          >
                            {tag}
                            <X size={12} />
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div style={{ padding: "4px 2px 2px", fontSize: 12, color: color.textMuted }}>
                        Use comma or Enter to add multiple tags.
                      </div>
                    )}
                  </div>
                ) : null}
              </div>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                style={{ ...menuButtonStyle(false), width: 34, padding: 0, justifyContent: "center" }}
                aria-label="Attach file"
                title="Attach file"
              >
                <Link2 size={16} />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                hidden
                onChange={(event) => {
                  if (event.target.files?.length) addFiles(event.target.files);
                  event.target.value = "";
                }}
              />
            </div>

            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={submitting || !canSubmit}
              aria-label={createButtonLabel}
              title={createButtonLabel}
              style={{
                width: 40,
                height: 40,
                display: "inline-grid",
                placeItems: "center",
                flexShrink: 0,
                borderRadius: 10,
                border: `1px solid ${canSubmit ? color.borderStrong : color.border}`,
                background: canSubmit ? "color-mix(in srgb, var(--text-primary) 72%, var(--surface))" : color.surfaceHover,
                color: canSubmit ? "var(--bg)" : color.textMuted,
                padding: 0,
                fontFamily: font.body,
                fontSize: 14,
                fontWeight: 700,
                cursor: canSubmit ? "pointer" : "default",
                opacity: submitting ? 0.65 : 1,
              }}
            >
              {submitting ? <Loader2 size={18} className="animate-spin" /> : <ArrowRight size={18} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
