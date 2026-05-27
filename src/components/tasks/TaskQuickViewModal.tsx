"use client";

import { useEffect, useState } from "react";
import { Bot, CalendarDays, ChevronDown, ExternalLink, FolderKanban, Gauge, Mic, Plus, Tag, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { InlineAssigneePicker } from "./InlineAssigneePicker";
import { InlinePriorityPicker } from "./InlinePriorityPicker";
import { InlineStatusPicker } from "./InlineStatusPicker";
import {
  type InlineEditCallbacks,
  type TaskRow,
  TYPE_LABEL,
  formatShortDate,
  getTaskIdentifier,
  getWaitingOnLabel,
} from "./types";
import { AvatarGlyph } from "@/components/orchestration/AvatarGlyph";
import { TaskVoiceModal } from "@/components/voice/TaskVoiceModal";
import { STATUS_META } from "@/components/orchestration/task-display";
import { TASK_MODEL_LANES } from "@/lib/orchestration/task-model-routing";
import type { OrchestrationAgent, OrchestrationProject, TaskModelLane } from "@/lib/orchestration/types";
import type { VoiceBindingRequest } from "@/lib/voice-binding";
import { color, P, radius, type as tokenType } from "@/lib/ui/tokens";
import { getTaskAgentOfRecord, shouldShowAgentOfRecord, taskAgentDisplayLabel } from "./task-display-agent";
import { selectPrimaryTaskUpdateComment } from "./task-card-activity";

interface Props {
  task: TaskRow | null;
  agents: OrchestrationAgent[];
  projects: OrchestrationProject[];
  noProjectId?: string;
  href: string;
  callbacks: InlineEditCallbacks;
  onClose: () => void;
  onVoiceSessionEnd?: () => void;
  companySlug?: string;
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "112px minmax(0, 1fr)", gap: 12, alignItems: "center" }}>
      <div style={{ fontSize: 11, color: P.textMuted, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 650 }}>
        {label}
      </div>
      <div style={{ minWidth: 0, color: P.textSecondary, fontSize: 13 }}>{children}</div>
    </div>
  );
}

function AgentRecordAvatar({ agent }: { agent: OrchestrationAgent | null }) {
  if (!agent) return null;

  return (
    <span
      style={{
        width: 18,
        height: 18,
        borderRadius: 999,
        overflow: "hidden",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        background: P.surfaceElevated,
        border: `0.5px solid ${P.cardBorder}`,
      }}
    >
      {agent.avatar ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={agent.avatar}
          alt=""
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : (
        <AvatarGlyph value={agent.emoji} size={12} color={P.textSecondary} />
      )}
    </span>
  );
}

function ProjectPicker({
  currentProjectId,
  noProjectId,
  projects,
  onChange,
}: {
  currentProjectId: string;
  noProjectId?: string;
  projects: OrchestrationProject[];
  onChange: (projectId: string | null) => void;
}) {
  const noProjectValue = noProjectId || "";
  const [active, setActive] = useState(false);
  return (
    <span
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
      onFocus={() => setActive(true)}
      onBlur={() => setActive(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        minWidth: 0,
        maxWidth: 280,
        borderRadius: radius.sm,
        background: active ? P.surfaceElevated : "transparent",
        padding: "3px 6px 3px 0",
        transition: "background 120ms ease",
      }}
    >
      <FolderKanban size={13} style={{ flexShrink: 0 }} />
      <span
        style={{
          position: "relative",
          display: "inline-flex",
          alignItems: "center",
          minWidth: 0,
          flex: 1,
        }}
      >
        <select
          value={currentProjectId || noProjectValue}
          aria-label="Project"
          onChange={(event) => onChange(event.target.value || null)}
          disabled={!onChange}
          style={{
            appearance: "none",
            WebkitAppearance: "none",
            minWidth: 0,
            width: "100%",
            border: "none",
            background: "transparent",
            color: P.textSecondary,
            fontSize: 13,
            lineHeight: 1.35,
            padding: "0 20px 0 0",
            outline: "none",
            cursor: "pointer",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          <option value={noProjectValue}>No project</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
        <ChevronDown
          size={13}
          style={{
            position: "absolute",
            right: 1,
            color: P.textMuted,
            opacity: active ? 1 : 0,
            pointerEvents: "none",
            transition: "opacity 120ms ease",
          }}
        />
      </span>
    </span>
  );
}

function ModelLanePicker({
  current,
  onChange,
}: {
  current: TaskModelLane;
  onChange?: (modelLane: TaskModelLane) => void;
}) {
  const [active, setActive] = useState(false);
  return (
    <span
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
      onFocus={() => setActive(true)}
      onBlur={() => setActive(false)}
      title={TASK_MODEL_LANES.find((item) => item.value === current)?.description}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        minWidth: 0,
        maxWidth: 280,
        borderRadius: radius.sm,
        background: active ? P.surfaceElevated : "transparent",
        padding: "3px 6px 3px 0",
        transition: "background 120ms ease",
      }}
    >
      <Gauge size={13} style={{ flexShrink: 0 }} />
      <span style={{ position: "relative", display: "inline-flex", alignItems: "center", minWidth: 0 }}>
        <select
          value={current}
          aria-label="Model lane"
          onChange={(event) => onChange?.(event.target.value as TaskModelLane)}
          disabled={!onChange}
          style={{
            appearance: "none",
            WebkitAppearance: "none",
            minWidth: 0,
            width: "100%",
            border: "none",
            background: "transparent",
            color: P.textSecondary,
            fontSize: 13,
            lineHeight: 1.35,
            padding: "0 20px 0 0",
            outline: "none",
            cursor: onChange ? "pointer" : "default",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {TASK_MODEL_LANES.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
        <ChevronDown
          size={13}
          style={{
            position: "absolute",
            right: 1,
            color: P.textMuted,
            opacity: active && onChange ? 1 : 0,
            pointerEvents: "none",
            transition: "opacity 120ms ease",
          }}
        />
      </span>
    </span>
  );
}

function TagsEditor({
  tags,
  onChange,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const [active, setActive] = useState(false);

  const addTag = () => {
    const next = draft.trim().replace(/^#/, "");
    if (!next) return;
    const exists = tags.some((tag) => tag.toLowerCase() === next.toLowerCase());
    if (!exists) onChange([...tags, next]);
    setDraft("");
  };

  return (
    <div
      role="group"
      tabIndex={0}
      aria-label="Tags"
      onMouseEnter={() => setActive(true)}
      onClick={() => setActive(true)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          setActive(true);
        }
      }}
      onMouseLeave={() => {
        if (!draft.trim()) setActive(false);
      }}
      onFocus={() => setActive(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          if (!draft.trim()) setActive(false);
        }
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        flexWrap: "wrap",
        minWidth: 0,
        minHeight: 24,
        borderRadius: radius.sm,
      }}
    >
      {tags.length > 0 ? tags.map((tag) => (
        <span
          key={tag}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            minHeight: 24,
            borderRadius: radius.full,
            border: active ? `0.5px solid ${P.cardBorder}` : "0.5px solid transparent",
            padding: "2px 6px",
            color: P.textSecondary,
            background: active ? P.surfaceElevated : "transparent",
            fontSize: 12,
          }}
        >
          <Tag size={11} />
          {tag}
          <button
            type="button"
            onClick={() => onChange(tags.filter((item) => item !== tag))}
            title={`Remove ${tag}`}
            style={{
              width: 16,
              height: 16,
              borderRadius: radius.full,
              border: "none",
              background: "transparent",
              color: P.textMuted,
              display: active ? "inline-flex" : "none",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              padding: 0,
            }}
          >
            <X size={10} />
          </button>
        </span>
      )) : !active ? (
        <span style={{ color: P.textMuted }}>No tags</span>
      ) : null}
      {active ? (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            minHeight: 24,
            color: P.textMuted,
          }}
        >
          <Plus size={13} style={{ flexShrink: 0 }} />
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === ",") {
                event.preventDefault();
                addTag();
              }
            }}
            onBlur={addTag}
            placeholder="Add tag..."
            style={{
              width: 110,
              height: 22,
              border: "none",
              background: "transparent",
              color: P.text,
              fontSize: 13,
              padding: 0,
              outline: "none",
            }}
          />
        </span>
      ) : null}
    </div>
  );
}

function formatRelativeUpdate(isoString: string) {
  const then = new Date(isoString).getTime();
  if (!Number.isFinite(then)) return "";
  const diff = Math.max(0, Date.now() - then);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function TaskQuickViewModal({ task, agents, projects, noProjectId, href, callbacks, onClose, onVoiceSessionEnd, companySlug }: Props) {
  const [voiceModalOpen, setVoiceModalOpen] = useState(false);

  useEffect(() => {
    if (!task) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !voiceModalOpen) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, task, voiceModalOpen]);

  useEffect(() => {
    setVoiceModalOpen(false);
  }, [task?.id]);

  if (!task) return null;

  const agentOfRecord = getTaskAgentOfRecord(task, agents);
  const useAgentOfRecord = shouldShowAgentOfRecord(task);
  const voiceLaunchAgent = agentOfRecord;

  const projectId = task.projectId || task.project;
  const taskProject = projects.find((p) => p.id === projectId);
  const voiceBindingRequest: VoiceBindingRequest = {
    taskId: task.id,
    mode: "discuss",
    source: "task-detail",
    ...(companySlug ? { companySlug } : {}),
    ...(projectId ? { projectId } : {}),
    ...(taskProject?.slug ? { projectSlug: taskProject.slug } : {}),
    ...(task.key ?? getTaskIdentifier(task) ? { taskKey: task.key ?? getTaskIdentifier(task) } : {}),
    ...(voiceLaunchAgent?.id ? { agentId: voiceLaunchAgent.id } : {}),
  };

  const waitingOn = getWaitingOnLabel(task);
  const status = STATUS_META[task.status];
  const latestComment = selectPrimaryTaskUpdateComment(task.comments);

  const latestUpdate = latestComment ? {
    title: `${latestComment.author} commented ${formatRelativeUpdate(latestComment.timestamp)}`,
    text: latestComment.text,
  } : {
    title: `Updated ${formatRelativeUpdate(task.updated)}`,
    text: `${getTaskIdentifier(task)} is currently ${status.label.toLowerCase()}.`,
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${getTaskIdentifier(task)} task details`}
      onMouseDown={(event) => {
        if (voiceModalOpen) return;
        if (event.target === event.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 80,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "var(--modal-backdrop)",
        backdropFilter: "blur(4px) saturate(110%)",
      }}
    >
      <div
        onMouseDown={(event) => event.stopPropagation()}
        style={{
          width: "min(760px, 100%)",
          maxHeight: "min(760px, calc(100vh - 48px))",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          borderRadius: radius.lg,
          border: "1px solid var(--border)",
          background: "var(--modal-glass)",
          boxShadow: "var(--shadow-glass)",
        }}
      >
        <div style={{ padding: "18px 20px 14px", borderBottom: `0.5px solid ${P.cardBorder}` }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 8, color: P.textMuted, fontSize: 12 }}>
                <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: P.textSecondary }}>{getTaskIdentifier(task)}</span>
                <span style={{ width: 4, height: 4, borderRadius: 999, background: status.color }} />
                <span>{status.label}</span>
                <span>{TYPE_LABEL[task.type]}</span>
              </div>
              <h2 style={{ margin: 0, color: P.text, fontSize: 24, lineHeight: 1.18, fontWeight: 700 }}>
                {task.title}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              title="Close"
              style={{
                width: 32,
                height: 32,
                borderRadius: radius.md,
                border: `0.5px solid ${P.cardBorder}`,
                background: "transparent",
                color: P.textSecondary,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              <X size={15} />
            </button>
          </div>
        </div>

        <div style={{ overflowY: "auto", padding: 20, display: "grid", gap: 18 }}>
          {task.description?.trim() ? (
            <section>
              <div style={{ marginBottom: 8, color: P.textMuted, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 650 }}>
                Description
              </div>
              <div style={{ color: P.textSecondary, fontSize: 14, lineHeight: 1.55, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                {task.description}
              </div>
            </section>
          ) : null}

          {waitingOn ? (
            <div style={{
              border: `0.5px solid ${waitingOn.tone === "blocked" ? "rgba(239,68,68,0.35)" : P.cardBorder}`,
              borderRadius: radius.md,
              padding: "10px 12px",
              color: waitingOn.tone === "blocked" ? "#ef4444" : P.textSecondary,
              fontSize: 13,
              background: waitingOn.tone === "blocked" ? "rgba(127,29,29,0.12)" : P.surfaceElevated,
            }}>
              {waitingOn.label}
            </div>
          ) : null}

          <section>
            <div style={{ marginBottom: 8, color: P.textMuted, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 650 }}>
              Latest update
            </div>
            <div style={{
              border: `0.5px solid ${P.cardBorder}`,
              borderRadius: radius.md,
              background: P.surfaceElevated,
              padding: "10px 12px",
              display: "grid",
              gap: 5,
            }}>
              <div style={{ color: P.textSecondary, fontSize: 13, fontWeight: 650 }}>{latestUpdate.title}</div>
              <div style={{
                color: P.textSecondary,
                fontSize: 13,
                lineHeight: 1.45,
                overflow: "hidden",
                maxHeight: "7.25em",
              }}>
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    p: ({ children }) => <p style={{ margin: "0 0 0.35em 0" }}>{children}</p>,
                    h1: ({ children }) => <h1 style={{ fontSize: 13, fontWeight: 700, margin: "0 0 0.3em 0", color: P.text }}>{children}</h1>,
                    h2: ({ children }) => <h2 style={{ fontSize: 13, fontWeight: 700, margin: "0 0 0.3em 0", color: P.text }}>{children}</h2>,
                    h3: ({ children }) => <h3 style={{ fontSize: 13, fontWeight: 650, margin: "0 0 0.3em 0", color: P.text }}>{children}</h3>,
                    h4: ({ children }) => <h4 style={{ fontSize: 12, fontWeight: 650, margin: "0 0 0.25em 0", color: P.text }}>{children}</h4>,
                    h5: ({ children }) => <h5 style={{ fontSize: 12, fontWeight: 600, margin: "0 0 0.25em 0" }}>{children}</h5>,
                    h6: ({ children }) => <h6 style={{ fontSize: 12, fontWeight: 600, margin: "0 0 0.25em 0" }}>{children}</h6>,
                    ul: ({ children }) => <ul style={{ margin: "0.1em 0 0.35em 0", paddingLeft: 16, listStyleType: "disc" }}>{children}</ul>,
                    ol: ({ children }) => <ol style={{ margin: "0.1em 0 0.35em 0", paddingLeft: 16, listStyleType: "decimal" }}>{children}</ol>,
                    li: ({ children }) => <li style={{ marginBottom: 2 }}>{children}</li>,
                    strong: ({ children }) => <strong style={{ fontWeight: 700, color: P.text }}>{children}</strong>,
                    em: ({ children }) => <em style={{ fontStyle: "italic" }}>{children}</em>,
                    code: ({ children }) => <code style={{ fontFamily: "var(--font-mono)", fontSize: 11, background: "rgba(0,0,0,0.25)", borderRadius: 3, padding: "1px 4px" }}>{children}</code>,
                    a: ({ href, children }) => <a href={href} style={{ color: P.accent, textDecoration: "underline" }} target="_blank" rel="noopener noreferrer">{children}</a>,
                    hr: () => <hr style={{ border: "none", borderTop: `0.5px solid ${P.cardBorder}`, margin: "0.4em 0" }} />,
                  }}
                >
                  {latestUpdate.text}
                </ReactMarkdown>
              </div>
            </div>
          </section>

          <section style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "14px 22px" }}>
            <DetailRow label="Status">
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <InlineStatusPicker current={task.status} onChange={(statusValue) => callbacks.onStatusChange(task.id, statusValue)} />
                <span>{status.label}</span>
              </span>
            </DetailRow>
            <DetailRow label="Priority">
              <InlinePriorityPicker current={task.priority} onChange={(priority) => callbacks.onPriorityChange(task.id, priority)} />
            </DetailRow>
            <DetailRow label={useAgentOfRecord ? "Agent of record" : "Assignee"}>
              {useAgentOfRecord ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 7, color: P.text }}>
                  <AgentRecordAvatar agent={agentOfRecord} />
                  {agentOfRecord?.name ?? taskAgentDisplayLabel(task) ?? "Unassigned"}
                </span>
              ) : (
                <InlineAssigneePicker current={task.assignee} agents={agents} onChange={(assignee) => callbacks.onAssigneeChange(task.id, assignee)} />
              )}
            </DetailRow>
            <DetailRow label="Project">
              <ProjectPicker
                currentProjectId={task.projectId || task.project}
                noProjectId={noProjectId}
                projects={projects}
                onChange={(projectId) => callbacks.onProjectChange?.(task.id, projectId)}
              />
            </DetailRow>
            <DetailRow label="Created">
              <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                <CalendarDays size={13} />
                {formatShortDate(task.created)}
              </span>
            </DetailRow>
            <DetailRow label="Updated">
              <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                <CalendarDays size={13} />
                {formatShortDate(task.updated)}
              </span>
            </DetailRow>
            <DetailRow label="Engine">
              <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                <Bot size={13} />
                {task.executionEngine ?? "hiverunner"}
                {task.executionEngineSource ? ` (${task.executionEngineSource})` : ""}
              </span>
            </DetailRow>
            <DetailRow label="Model Lane">
              <ModelLanePicker
                current={(task.modelLane ?? "default") as TaskModelLane}
                onChange={callbacks.onModelLaneChange ? (modelLane) => callbacks.onModelLaneChange?.(task.id, modelLane) : undefined}
              />
            </DetailRow>
            <DetailRow label="Tags">
              <TagsEditor
                key={task.id}
                tags={task.tags ?? []}
                onChange={(tags) => callbacks.onTagsChange?.(task.id, tags)}
              />
            </DetailRow>
          </section>
        </div>

        <div style={{ padding: "14px 20px", borderTop: `0.5px solid ${P.cardBorder}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div style={{ color: P.textMuted, fontSize: tokenType.bodySmall.size }}>
            {getTaskIdentifier(task)}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              type="button"
              onClick={() => setVoiceModalOpen(true)}
              disabled={!voiceLaunchAgent || voiceModalOpen}
              title={
                voiceModalOpen
                  ? "Voice chat is already open"
                  :
                voiceLaunchAgent?.name
                  ? `Talk to ${voiceLaunchAgent.name} about this task`
                  : task.assignee
                  ? `${task.assignee} is offline`
                  : "Assign an agent to use voice chat"
              }
              style={{
                height: 34,
                padding: "0 12px",
                borderRadius: radius.md,
                border: `0.5px solid ${voiceLaunchAgent && !voiceModalOpen ? "rgba(217,119,6,0.24)" : P.cardBorder}`,
                background: "transparent",
                color: voiceLaunchAgent && !voiceModalOpen ? color.accent : P.textMuted,
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                fontSize: 13,
                fontWeight: 650,
                flexShrink: 0,
                cursor: voiceLaunchAgent && !voiceModalOpen ? "pointer" : "not-allowed",
              }}
            >
              <Mic size={13} />
              {voiceModalOpen ? "Talking" : "Talk"}
            </button>
            <a
              href={href}
              style={{
                height: 34,
                padding: "0 12px",
                borderRadius: radius.md,
                border: `0.5px solid ${P.cardBorder}`,
                color: P.text,
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                fontSize: 13,
                fontWeight: 650,
                flexShrink: 0,
              }}
            >
              Open full task
              <ExternalLink size={13} />
            </a>
          </div>
        </div>
      </div>

      {voiceBindingRequest && (
        <TaskVoiceModal
          open={voiceModalOpen}
          onClose={() => setVoiceModalOpen(false)}
          agent={voiceLaunchAgent}
          bindingRequest={voiceBindingRequest}
          taskTitle={task.title}
          projectName={taskProject?.name}
          onSessionEnd={onVoiceSessionEnd}
        />
      )}
    </div>
  );
}
