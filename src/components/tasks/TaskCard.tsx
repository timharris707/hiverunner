"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Hexagon, LoaderCircle, Music2 } from "lucide-react";
import { PRIORITY_META } from "@/components/orchestration/task-display";
import { PriorityBars } from "@/components/orchestration/PriorityBars";
import { StatusCircle } from "@/components/orchestration/StatusCircle";
import { type ActiveTaskRunInfo, type TaskRow, getTaskIdentifier, getWaitingOnLabel } from "./types";
import { AssigneeAvatar } from "@/components/agents/AssigneeAvatar";
import { compactAgentModelLabel, resolveLiveRunnerModelDisplay } from "@/lib/orchestration/agent-model-display";
import { taskModelLaneLabel } from "@/lib/orchestration/task-model-routing";
import { formatRelativeTime } from "@/lib/format-relative-time";
import type { OrchestrationAgent } from "@/lib/orchestration/types";
import { font, P, radius, type as tokenType } from "@/lib/ui/tokens";
import type { TaskBoardDropTarget } from "./useTaskDragDrop";
import { selectPrimaryTaskUpdateComment, taskCardActivityLabel } from "./task-card-activity";
import { cleanAgentReference } from "./task-display-agent";

export interface TaskModelQuickOption {
  id: string;
  model: string;
  targetProvider: string;
  label: string;
  providerLabel: string;
  color: string;
  background: string;
  border: string;
}

type ModelMenuPosition = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
};

interface Props {
  task: TaskRow;
  agentMap: Map<string, OrchestrationAgent>;
  onContextMenu: (e: React.MouseEvent, task: TaskRow) => void;
  onOpenTask?: (task: TaskRow) => void;
  modelOptions?: TaskModelQuickOption[];
  onAgentModelChange?: (agent: OrchestrationAgent, option: TaskModelQuickOption) => void | Promise<void>;
  hasActiveRun?: boolean;
  activeAgentName?: string;
  activeRun?: ActiveTaskRunInfo;
  childCount?: number;
  isMovementTarget?: boolean;
  hideStatus?: boolean;
  hideAssignee?: boolean;
  dragDisabled?: boolean;
  dragTarget?: TaskBoardDropTarget;
  movementGroupKey?: string;
}

export function TaskCard({
  task, agentMap, onContextMenu, onOpenTask, modelOptions = [], onAgentModelChange, hasActiveRun, activeAgentName, activeRun, childCount, isMovementTarget, hideStatus = false, hideAssignee = false, dragDisabled = false, dragTarget, movementGroupKey
}: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { target: dragTarget ?? { mode: "status", status: task.status } },
    disabled: dragDisabled,
  });

  const assignedModelDisplay = task.modelDisplay;
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [pendingModelId, setPendingModelId] = useState<string | null>(null);
  const [modelMenuPosition, setModelMenuPosition] = useState<ModelMenuPosition | null>(null);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);

  const style: React.CSSProperties = {
    position: "relative",
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging || isMovementTarget ? 0.4 : 1,
    padding: "10px 12px",
    background: hasActiveRun
      ? "color-mix(in srgb, var(--accent) 8%, var(--surface))"
      : P.surface,
    border: hasActiveRun
      ? "0.5px solid color-mix(in srgb, var(--accent) 34%, var(--border))"
      : `0.5px solid ${P.cardBorder}`,
    borderRadius: radius.md,
    marginBottom: "8px",
    cursor: dragDisabled ? "default" : "grab",
    boxShadow: hasActiveRun ? "0 0 0 1px color-mix(in srgb, var(--accent) 10%, transparent)" : "none",
    filter: isMovementTarget ? "saturate(0.8)" : "none",
    minHeight: assignedModelDisplay ? 126 : undefined,
  };

  const displayAgentReference = cleanAgentReference(task.displayAgentName);
  const assigneeReference = cleanAgentReference(task.assignee);
  const displayAgent = task.displayAgentId
    ? agentMap.get(task.displayAgentId.toLowerCase())
    : displayAgentReference
      ? agentMap.get(displayAgentReference.toLowerCase())
      : undefined;
  const assigneeAgent = assigneeReference ? agentMap.get(assigneeReference.toLowerCase()) : undefined;
  const agent = displayAgent ?? assigneeAgent;
  const meta = PRIORITY_META[task.priority];
  const waitingOn = getWaitingOnLabel(task);
  const isActivelyRunning = activeRun?.status === "running" || activeRun?.status === "queued" || activeRun?.status === "pending";
  const runnerModelDisplay = useMemo(() => {
    if (!isActivelyRunning || !activeRun?.runnerModel) return null;
    return resolveLiveRunnerModelDisplay({
      provider: activeRun.runnerProvider ?? undefined,
      model: activeRun.runnerModel,
      executionEngine: task.executionEngine,
    });
  }, [activeRun?.runnerModel, activeRun?.runnerProvider, isActivelyRunning, task.executionEngine]);
  const modelDisplay = runnerModelDisplay ?? assignedModelDisplay;
  const elapsedLabel = useElapsedRunLabel(isActivelyRunning ? activeRun?.startedAt : null);
  const updatedRelativeLabel = useRelativeTimeLabel(task.updated);
  const modelLaneLabel = task.modelLane && task.modelLane !== "default" ? taskModelLaneLabel(task.modelLane) : null;
  const latestComment = selectPrimaryTaskUpdateComment(task.comments);
  const latestCommentPreview = latestComment ? plainTextCommentPreview(latestComment.text) : "";
  const assignedName = displayAgentReference || assigneeReference || undefined;
  const activeOwnerName = assignedName ? undefined : activeAgentName;
  const displayAssigneeName = assignedName ?? activeOwnerName;
  const assigneeLabel = assignedName
    ? (agent?.name ?? assignedName)
    : activeOwnerName
      ? `Runner: ${activeOwnerName}`
      : "";
  const inactiveActivityLabel = taskCardActivityLabel({
    status: task.status,
    displayAgentName: assigneeLabel || displayAssigneeName,
    latestCommentAuthor: latestComment?.author,
    latestCommentText: latestComment?.text,
    updatedRelativeLabel,
  });
  const currentModelKey = normalizeModelKey(agent?.model ?? assignedModelDisplay?.model ?? "");
  const visibleModelOptions = useMemo(() => {
    if (!agent || !assignedModelDisplay || !currentModelKey) return modelOptions;
    if (modelOptions.some((option) => normalizeModelKey(option.model) === currentModelKey)) return modelOptions;
    return [
      {
        id: `current:${currentModelKey}`,
        model: agent.model ?? assignedModelDisplay.model,
        targetProvider: agent.adapterType ?? assignedModelDisplay.provider,
        label: assignedModelDisplay.displayModel || compactModelLabel(assignedModelDisplay.model),
        providerLabel: assignedModelDisplay.providerLabel,
        color: assignedModelDisplay.color,
        background: assignedModelDisplay.background,
        border: assignedModelDisplay.border,
      },
      ...modelOptions,
    ];
  }, [agent, currentModelKey, assignedModelDisplay, modelOptions]);
  const canSwitchModel = Boolean(!runnerModelDisplay && agent && onAgentModelChange && visibleModelOptions.length > 0);
  const closeModelMenu = () => {
    setModelMenuOpen(false);
    setModelMenuPosition(null);
  };
  const openModelMenu = (anchor: HTMLElement) => {
    const rect = anchor.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const width = Math.min(340, Math.max(260, rect.width + 210));
    const left = Math.min(Math.max(8, rect.left), Math.max(8, viewportWidth - width - 8));
    const belowSpace = viewportHeight - rect.bottom - 8;
    const aboveSpace = rect.top - 8;
    const openBelow = belowSpace >= 220 || belowSpace >= aboveSpace;
    const maxHeight = Math.min(360, Math.max(150, openBelow ? belowSpace : aboveSpace));
    const top = openBelow
      ? rect.bottom + 6
      : Math.max(8, rect.top - maxHeight - 6);
    setModelMenuPosition({ top, left, width, maxHeight });
    setModelMenuOpen(true);
  };

  useEffect(() => {
    if (!modelMenuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (modelMenuRef.current?.contains(target)) return;
      if (target.closest("[data-task-model-trigger='true']")) return;
      closeModelMenu();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeModelMenu();
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [modelMenuOpen]);

  return (
    <div
      ref={setNodeRef}
      data-task-card-id={task.id}
      data-task-card-status={task.status}
      data-task-card-group-key={movementGroupKey}
      style={style}
      {...(dragDisabled ? {} : attributes)}
      {...(dragDisabled ? {} : listeners)}
      onContextMenu={(e) => onContextMenu(e, task)}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("[data-task-card-action='true']")) return;
        if (modelMenuOpen) closeModelMenu();
        onOpenTask?.(task);
      }}
    >
      <div style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "6px",
        rowGap: "4px",
        marginBottom: "6px",
        minWidth: 0,
        flexWrap: "wrap",
      }}>
        <span style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          minWidth: 0,
          flex: "1 1 auto",
          overflow: "hidden",
        }}>
          {hideStatus ? null : <StatusCircle status={task.status} size={12} />}
          <span style={{
            fontSize: "10px", color: P.textMuted, fontFamily: font.mono,
            fontWeight: 600, letterSpacing: "0.04em", whiteSpace: "nowrap",
            overflow: "hidden", textOverflow: "ellipsis",
            maxWidth: "100%",
          }}>
            {getTaskIdentifier(task)}
          </span>
        </span>
        <span style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "flex-end",
          flexWrap: "wrap",
          gap: 4,
          minWidth: 0,
          maxWidth: "100%",
          marginLeft: "auto",
          flex: "1 1 auto",
          overflow: "hidden",
        }}>
          <OrchestrationBadge engine={task.executionEngine} />
          {childCount && childCount > 0 ? (
            <span style={{
              fontSize: "10px",
              color: P.textSecondary,
              background: "rgba(255,255,255,0.05)",
              padding: "1px 4px",
              borderRadius: "4px",
              whiteSpace: "nowrap",
            }}>
              {childCount} sub
            </span>
          ) : null}
          {modelLaneLabel ? (
            <span style={{
              fontSize: 10,
              color: P.textSecondary,
              background: P.surfaceElevated,
              border: `0.5px solid ${P.cardBorder}`,
              padding: "1px 5px",
              borderRadius: radius.full,
              whiteSpace: "nowrap",
            }}>
              {modelLaneLabel}
            </span>
          ) : null}
          {hasActiveRun && activeAgentName ? (
            <span style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              minHeight: 18,
              padding: "0 6px",
              borderRadius: 999,
              background: "var(--accent-soft)",
              color: "var(--accent)",
              fontSize: 10,
              fontWeight: 700,
              whiteSpace: "nowrap",
            }}>
              {isActivelyRunning ? (
                <LoaderCircle size={11} style={{ animation: "spin 1s linear infinite", flexShrink: 0 }} />
              ) : null}
              {isActivelyRunning ? "Working" : "Updated"}
              {isActivelyRunning && elapsedLabel ? (
                <span style={{ color: "var(--accent)", opacity: 0.72, fontVariantNumeric: "tabular-nums" }}>
                  {elapsedLabel}
                </span>
              ) : null}
            </span>
          ) : null}
        </span>
      </div>

      <button
        type="button"
        data-task-card-action="true"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onOpenTask?.(task);
        }}
        style={{
          display: "-webkit-box", fontSize: tokenType.body.size, color: P.text, lineHeight: "1.4",
          marginBottom: "8px", textDecoration: "none", textAlign: "left",
          overflow: "hidden", textOverflow: "ellipsis",
          WebkitLineClamp: 3, WebkitBoxOrient: "vertical",
          width: "100%", padding: 0, background: "transparent", border: 0, cursor: "pointer",
        } as React.CSSProperties}
        title={`Open ${getTaskIdentifier(task)}`}
      >
        {task.title}
      </button>

      {waitingOn && (
        <div style={{
          marginTop: "-2px",
          marginBottom: "8px",
          fontSize: tokenType.bodySmall.size,
          color: waitingOn.tone === "blocked" ? "#ef4444" : P.textMuted,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}>
          {waitingOn.label}
        </div>
      )}

      {latestComment && latestCommentPreview ? (
        <div style={{
          marginTop: waitingOn ? "-2px" : "-2px",
          marginBottom: "8px",
          padding: "7px 8px",
          borderRadius: radius.sm,
          border: `0.5px solid ${P.cardBorder}`,
          background: P.surfaceElevated,
        }}>
          <div style={{ fontSize: "10px", color: P.textMuted, fontWeight: 650, marginBottom: 3 }}>
            Latest update
          </div>
          <div style={{
            display: "-webkit-box",
            overflow: "hidden",
            textOverflow: "ellipsis",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            color: P.textSecondary,
            fontSize: tokenType.bodySmall.size,
            lineHeight: 1.35,
            overflowWrap: "anywhere",
          } as React.CSSProperties}>
            {latestCommentPreview}
          </div>
        </div>
      ) : null}

      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        <span style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          fontSize: "10px",
          color: meta.color,
          fontWeight: 600,
          flexShrink: 0,
          whiteSpace: "nowrap",
        }}>
          <PriorityBars priority={task.priority} size={14} />
          {meta.label}
        </span>
        {modelDisplay ? (
          <ModelChip
            model={modelDisplay}
            switchable={canSwitchModel}
            open={modelMenuOpen}
            onToggle={(event) => {
              if (modelMenuOpen) {
                closeModelMenu();
                return;
              }
              openModelMenu(event.currentTarget);
            }}
          />
        ) : null}
        <span style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: "6px",
          fontSize: tokenType.bodySmall.size,
          color: P.textSecondary,
          minWidth: 0,
          flex: "1 1 auto",
          overflow: "hidden",
        }}>
          {displayAssigneeName && !hideAssignee ? (
            <span style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "flex-end",
              gap: 6,
              minWidth: 0,
              maxWidth: "100%",
              overflow: "hidden",
            }}>
              <AssigneeAvatar agent={agent} size={20} title={agent?.name ?? "Unassigned"} />
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {assigneeLabel}
              </span>
            </span>
          ) : null}
        </span>
      </div>

      {modelMenuOpen && canSwitchModel && agent && modelMenuPosition && typeof document !== "undefined" ? createPortal((
        <div
          ref={modelMenuRef}
          data-task-card-action="true"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          style={{
            position: "fixed",
            zIndex: 1000,
            left: modelMenuPosition.left,
            top: modelMenuPosition.top,
            width: modelMenuPosition.width,
            maxHeight: modelMenuPosition.maxHeight,
            padding: 8,
            borderRadius: radius.md,
            border: `0.5px solid ${P.cardBorderHover}`,
            background: "color-mix(in srgb, var(--surface-elevated) 94%, black)",
            boxShadow: "0 18px 42px rgba(0,0,0,0.48)",
            overflow: "hidden",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 10, color: P.textMuted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              {agent.name} model
            </span>
            <button
              type="button"
              onClick={closeModelMenu}
              style={{
                marginLeft: "auto",
                width: 18,
                height: 18,
                border: `0.5px solid ${P.cardBorder}`,
                borderRadius: radius.full,
                background: "transparent",
                color: P.textMuted,
                cursor: "pointer",
                fontSize: 12,
                lineHeight: "16px",
              }}
              aria-label="Close model switcher"
            >
              ×
            </button>
          </div>
          <div style={{ display: "grid", gap: 4, maxHeight: Math.max(110, modelMenuPosition.maxHeight - 38), overflowY: "auto" }}>
            {visibleModelOptions.map((option) => {
              const isCurrent = normalizeModelKey(option.model) === currentModelKey;
              const isPending = pendingModelId === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  disabled={Boolean(pendingModelId)}
                  onClick={async () => {
                    if (isCurrent || !onAgentModelChange) {
                      setModelMenuOpen(false);
                      return;
                    }
                    setPendingModelId(option.id);
                    try {
                      await onAgentModelChange(agent, option);
                      closeModelMenu();
                    } finally {
                      setPendingModelId(null);
                    }
                  }}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr) auto",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 7px",
                    borderRadius: radius.sm,
                    border: `0.5px solid ${isCurrent ? option.border : "transparent"}`,
                    background: isCurrent ? option.background : "transparent",
                    color: P.text,
                    cursor: pendingModelId ? "wait" : "pointer",
                    textAlign: "left",
                    font: "inherit",
                  }}
                >
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: option.color, fontSize: 12, fontWeight: 700 }}>
                      {option.label}
                    </span>
                    <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: P.textMuted, fontSize: 10 }}>
                      {option.providerLabel}
                    </span>
                  </span>
                  <span style={{ color: isCurrent ? option.color : P.textMuted, fontSize: 10, fontWeight: 700 }}>
                    {isPending ? "Saving" : isCurrent ? "Current" : "Switch"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ), document.body) : null}

      {hasActiveRun && activeAgentName && (
        <div style={{
          marginTop: "8px", paddingTop: "6px", borderTop: `0.5px solid ${P.cardBorder}`,
          fontSize: tokenType.bodySmall.size, color: "var(--accent)",
          display: "flex", alignItems: "center", gap: "4px", minWidth: 0,
        }}>
          {isActivelyRunning ? (
            <LoaderCircle size={12} style={{ animation: "spin 1s linear infinite", flexShrink: 0 }} />
          ) : null}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {activeAgentName} {isActivelyRunning ? "is working" : `updated this task${updatedRelativeLabel ? ` · ${updatedRelativeLabel}` : ""}`}
          </span>
          {isActivelyRunning && elapsedLabel ? (
            <span style={{ marginLeft: "auto", flexShrink: 0, fontVariantNumeric: "tabular-nums", color: P.textSecondary }}>
              {elapsedLabel}
            </span>
          ) : null}
        </div>
      )}

      {!hasActiveRun && inactiveActivityLabel ? (
        <div style={{
          marginTop: "8px",
          paddingTop: "6px",
          borderTop: `0.5px solid ${P.cardBorder}`,
          fontSize: tokenType.bodySmall.size,
          color: P.textMuted,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}>
          {inactiveActivityLabel}
        </div>
      ) : null}

    </div>
  );
}

function ModelChip({
  model,
  switchable,
  open,
  onToggle,
}: {
  model: NonNullable<TaskRow["modelDisplay"]>;
  switchable: boolean;
  open: boolean;
  onToggle: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  const label = model.displayModel || compactModelLabel(model.model);
  const style: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifySelf: "end",
    maxWidth: model.source === "runner" ? 138 : 96,
    minWidth: 0,
    height: 17,
    padding: "0 5px",
    borderRadius: radius.full,
    border: `0.5px solid ${model.border}`,
    background: model.background,
    color: model.color,
    fontSize: 10,
    fontWeight: 650,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    flexShrink: 1,
    fontFamily: "inherit",
  };

  if (switchable) {
    return (
      <button
        type="button"
        data-task-card-action="true"
        data-task-model-trigger="true"
        aria-label={`Change model from ${label}`}
        aria-expanded={open}
        title={`${model.label}. Click to change this agent's model.`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onToggle(event);
        }}
        style={{ ...style, cursor: "pointer" }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
          {label}
        </span>
      </button>
    );
  }

  return (
    <span
      title={model.label}
      style={style}
    >
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
        {label}
      </span>
    </span>
  );
}

function compactModelLabel(model: string) {
  return compactAgentModelLabel(model);
}

function useElapsedRunLabel(startedAt: string | null | undefined): string | null {
  const startedAtMs = useMemo(() => {
    if (!startedAt) return null;
    const parsed = Date.parse(startedAt);
    return Number.isFinite(parsed) ? parsed : null;
  }, [startedAt]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!startedAtMs) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [startedAtMs]);

  if (!startedAtMs) return null;
  return formatElapsedMs(Math.max(0, now - startedAtMs));
}

function useRelativeTimeLabel(timestamp: string | null | undefined): string | null {
  const timestampMs = useMemo(() => {
    if (!timestamp) return null;
    const parsed = Date.parse(timestamp);
    return Number.isFinite(parsed) ? parsed : null;
  }, [timestamp]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!timestampMs) return;
    const interval = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, [timestampMs]);

  if (!timestampMs) return null;
  return formatRelativeTime(timestampMs, now, { compact: true });
}

function formatElapsedMs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
  return `${seconds}s`;
}

function normalizeModelKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^openai-codex\//, "")
    .replace(/^anthropic\//, "")
    .replace(/^openai\//, "")
    .replace(/^google\//, "")
    .replace(/^gemini\//, "")
    .replace(/^models\//, "");
}

function OrchestrationBadge({ engine }: { engine?: string | null }) {
  // Manual = omit: operator-controlled tasks have no orchestration layer to surface.
  if (!engine || engine === "manual") return null;

  if (engine === "hiverunner") {
    return (
      <span title="HiveRunner Native" style={{ display: "inline-flex", alignItems: "center", color: P.textMuted, flexShrink: 0 }}>
        <Hexagon size={12} strokeWidth={1.5} />
      </span>
    );
  }

  if (engine === "symphony") {
    return (
      <span title="Symphony" style={{ display: "inline-flex", alignItems: "center", color: P.textMuted, flexShrink: 0 }}>
        <Music2 size={12} strokeWidth={1.5} />
      </span>
    );
  }

  return null;
}

function plainTextCommentPreview(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .split(/\r?\n/)
    .map((line) => line
      .replace(/^\s{0,3}#{1,6}\s+/g, "")
      .replace(/^\s{0,3}[-*+]\s+/g, "")
      .replace(/^\s{0,3}>\s?/g, "")
      .trim())
    .filter(Boolean)
    .join(" ")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/\s+/g, " ")
    .trim();
}
