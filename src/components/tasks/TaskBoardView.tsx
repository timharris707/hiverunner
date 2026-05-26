"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { PriorityBars } from "@/components/orchestration/PriorityBars";
import { StatusCircle } from "@/components/orchestration/StatusCircle";
import { AssigneeAvatar } from "@/components/agents/AssigneeAvatar";
import { TaskCard, type TaskModelQuickOption } from "./TaskCard";
import { type TaskBoardDropTarget, useTaskDragDrop } from "./useTaskDragDrop";
import { type ActiveTaskRunInfo, type TaskRow, type GroupMode, getActiveRunLabel } from "./types";
import type { OrchestrationAgent, TaskPriority, TaskStatus } from "@/lib/orchestration/types";
import { groupTasksFlat, type FlatTaskGroup } from "@/lib/orchestration/groupBySprint";
import { font, P, radius, type as tokenType } from "@/lib/ui/tokens";

interface Props {
  tasks: TaskRow[];
  agentMap: Map<string, OrchestrationAgent>;
  onContextMenu: (e: React.MouseEvent, task: TaskRow) => void;
  onOpenTask: (task: TaskRow) => void;
  modelOptions?: TaskModelQuickOption[];
  onAgentModelChange?: (agent: OrchestrationAgent, option: TaskModelQuickOption) => void | Promise<void>;
  visibleStatuses: TaskStatus[];
  groupMode: GroupMode;
  onBoardGroupDrop: (taskId: string, target: TaskBoardDropTarget) => void | Promise<void>;
  activeRunsByTaskId?: Map<string, ActiveTaskRunInfo>;
}

function Column({
  group, groupMode, tasks, agentMap, onContextMenu, onOpenTask, modelOptions, onAgentModelChange, childrenMap, activeRunsByTaskId, movingTaskIds, dragDisabled
}: {
  group: FlatTaskGroup<TaskRow>;
  groupMode: Exclude<GroupMode, "none" | "project">;
  tasks: TaskRow[];
  agentMap: Map<string, OrchestrationAgent>;
  onContextMenu: (e: React.MouseEvent, task: TaskRow) => void;
  onOpenTask: (task: TaskRow) => void;
  modelOptions?: TaskModelQuickOption[];
  onAgentModelChange?: (agent: OrchestrationAgent, option: TaskModelQuickOption) => void | Promise<void>;
  childrenMap: Map<string, number>;
  activeRunsByTaskId?: Map<string, ActiveTaskRunInfo>;
  movingTaskIds: Set<string>;
  dragDisabled: boolean;
}) {
  const droppableId = group.status ?? group.id;
  const dropTarget = getGroupDropTarget(group, groupMode);
  const { setNodeRef, isOver } = useDroppable({ id: droppableId, data: { target: dropTarget } });

  return (
    <div data-task-board-column={group.id} style={{
      flex: "1 0 220px", minWidth: 220, display: "flex", flexDirection: "column",
      background: isOver ? "rgba(255,255,255,0.02)" : "transparent",
      borderRadius: radius.md, transition: "background 150ms ease"
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: "6px",
        padding: "8px 10px", borderBottom: `0.5px solid ${P.cardBorder}`,
      }}>
        <ColumnGlyph group={group} groupMode={groupMode} agentMap={agentMap} />
        <span style={{ fontSize: "11px", fontWeight: 600, color: P.textSecondary, textTransform: "uppercase", letterSpacing: "0.02em" }}>
          {group.label}
        </span>
        <span style={{ fontSize: "11px", color: P.textMuted, marginLeft: "auto" }}>{tasks.length}</span>
      </div>

      <div
        ref={setNodeRef}
        style={{
          flex: 1, overflowY: "auto", padding: "8px 6px",
          minHeight: "100px",
        }}
      >
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => {
            const activeRun = activeRunsByTaskId?.get(task.id);
            const activeLabel = activeRun ? activeRun.agentName : getActiveRunLabel(task, agentMap);
            const childCount = childrenMap.get(task.id) ?? 0;
            return (
              <TaskCard
                key={task.id}
                task={task}
                agentMap={agentMap}
                onContextMenu={onContextMenu}
                onOpenTask={onOpenTask}
                modelOptions={modelOptions}
                onAgentModelChange={onAgentModelChange}
                hasActiveRun={!!activeLabel}
                activeAgentName={activeLabel}
                activeRun={activeRun}
                childCount={childCount}
                isMovementTarget={movingTaskIds.has(task.id)}
                hideStatus={groupMode === "status"}
                hideAssignee={groupMode === "assignee"}
                dragDisabled={dragDisabled}
                dragTarget={dropTarget}
                movementGroupKey={group.id}
              />
            );
          })}
        </SortableContext>
      </div>
    </div>
  );
}

function ColumnGlyph({
  group,
  groupMode,
  agentMap,
}: {
  group: FlatTaskGroup<TaskRow>;
  groupMode: Exclude<GroupMode, "none" | "project">;
  agentMap: Map<string, OrchestrationAgent>;
}) {
  if (groupMode === "status" && group.status) {
    return <StatusCircle status={group.status as TaskStatus} size={12} />;
  }
  if (groupMode === "priority" && group.priority) {
    return <PriorityBars priority={group.priority as TaskPriority} size={14} />;
  }
  if (groupMode === "assignee") {
    const agent = group.assignee ? agentMap.get(group.assignee.toLowerCase()) : undefined;
    return <AssigneeAvatar agent={agent} size={14} />;
  }
  const tone = group.sprintStatus ?? group.goalStatus;
  const background = tone === "active" ? "var(--positive)" : tone === "done" ? P.textMuted : P.textSecondary;
  return <span style={{ width: 8, height: 8, borderRadius: "50%", background, flexShrink: 0 }} />;
}

function getGroupDropTarget(
  group: FlatTaskGroup<TaskRow>,
  groupMode: Exclude<GroupMode, "none" | "project">
): TaskBoardDropTarget {
  if (groupMode === "priority") {
    return { mode: "priority", priority: (group.priority ?? "P2") as TaskPriority };
  }
  if (groupMode === "assignee") {
    return { mode: "assignee", assignee: group.assignee ?? null };
  }
  if (groupMode === "sprint") {
    return {
      mode: "sprint",
      sprintId: group.sprintId ?? null,
      sprintName: group.sprintName ?? null,
      sprintStatus: group.sprintStatus ?? null,
      companyGoalId: group.goalId ?? null,
      companyGoalName: group.goalName ?? null,
      companyGoalStatus: group.goalStatus ?? null,
      projectId: group.projectId ?? null,
      projectName: group.projectName ?? null,
    };
  }
  return { mode: "status", status: (group.status ?? "backlog") as TaskStatus };
}

interface MeasuredTask {
  groupKey: string;
  rect: DOMRect;
  title: string;
  identifier: string;
  activeAgentName?: string;
}

interface MovingTaskGhost {
  id: string;
  title: string;
  identifier: string;
  activeAgentName?: string;
  from: { x: number; y: number; width: number; height: number };
  to: { x: number; y: number; width: number; height: number };
  running: boolean;
}

const CARD_MOVE_DURATION_MS = 504;

export function TaskBoardView({ tasks, agentMap, onContextMenu, onOpenTask, modelOptions, onAgentModelChange, visibleStatuses, groupMode, onBoardGroupDrop, activeRunsByTaskId }: Props) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const boardRef = useRef<HTMLDivElement | null>(null);
  const previousMeasurementsRef = useRef<Map<string, MeasuredTask>>(new Map());
  const movementTimersRef = useRef<number[]>([]);
  const [movingTaskIds, setMovingTaskIds] = useState<Set<string>>(new Set());
  const [movingGhosts, setMovingGhosts] = useState<MovingTaskGhost[]>([]);

  const { activeId, handleDragStart, handleDragEnd, handleDragCancel } = useTaskDragDrop({
    onDrop: onBoardGroupDrop,
  });

  const childrenMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const task of tasks) {
      if (task.parentTaskId) {
        map.set(task.parentTaskId, (map.get(task.parentTaskId) ?? 0) + 1);
      }
    }
    return map;
  }, [tasks]);

  const effectiveGroupMode: Exclude<GroupMode, "none" | "project"> = groupMode === "priority" || groupMode === "assignee" || groupMode === "sprint" || groupMode === "company-goal" ? groupMode : "status";
  const dragDisabled = effectiveGroupMode === "company-goal";

  const boardGroups = useMemo(() => {
    const visibleTasks = tasks.filter((task) => !task.parentTaskId || activeRunsByTaskId?.has(task.id));
    return groupTasksFlat(visibleTasks, effectiveGroupMode, {
      includeEmptyStatusGroups: effectiveGroupMode === "status",
      statusOrder: visibleStatuses,
    });
  }, [activeRunsByTaskId, effectiveGroupMode, tasks, visibleStatuses]);

  const activeTask = activeId ? tasks.find((t) => t.id === activeId) : undefined;

  useLayoutEffect(() => {
    if (!boardRef.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      previousMeasurementsRef.current = measureTaskCards(boardRef.current, tasks, agentMap, activeRunsByTaskId);
      return;
    }

    const nextMeasurements = measureTaskCards(boardRef.current, tasks, agentMap, activeRunsByTaskId);
    const previousMeasurements = previousMeasurementsRef.current;
    const ghosts: MovingTaskGhost[] = [];

    for (const [taskId, next] of nextMeasurements) {
      const previous = previousMeasurements.get(taskId);
      if (!previous || previous.groupKey === next.groupKey) continue;

      ghosts.push({
        id: taskId,
        title: next.title,
        identifier: next.identifier,
        activeAgentName: next.activeAgentName,
        from: rectToBox(previous.rect),
        to: rectToBox(next.rect),
        running: false,
      });
    }

    previousMeasurementsRef.current = nextMeasurements;

    if (ghosts.length === 0) return;

    const movedIds = new Set(ghosts.map((ghost) => ghost.id));
    let runFrame: number | null = null;
    const startFrame = window.requestAnimationFrame(() => {
      setMovingTaskIds((current) => new Set([...current, ...movedIds]));
      setMovingGhosts((current) => [
        ...current.filter((ghost) => !movedIds.has(ghost.id)),
        ...ghosts,
      ]);

      runFrame = window.requestAnimationFrame(() => {
        setMovingGhosts((current) => current.map((ghost) => (
          movedIds.has(ghost.id) ? { ...ghost, running: true } : ghost
        )));
      });
    });

    const timer = window.setTimeout(() => {
      setMovingGhosts((current) => current.filter((ghost) => !movedIds.has(ghost.id)));
      setMovingTaskIds((current) => {
        const next = new Set(current);
        for (const id of movedIds) next.delete(id);
        return next;
      });
    }, CARD_MOVE_DURATION_MS + 80);

    movementTimersRef.current.push(timer);
    return () => {
      window.cancelAnimationFrame(startFrame);
      if (runFrame !== null) window.cancelAnimationFrame(runFrame);
    };
  }, [activeRunsByTaskId, agentMap, tasks]);

  useLayoutEffect(() => () => {
    for (const timer of movementTimersRef.current) window.clearTimeout(timer);
    movementTimersRef.current = [];
  }, []);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div ref={boardRef} style={{
        display: "flex", gap: "12px", flex: 1, minWidth: 0, overflowX: "auto", padding: "12px 16px",
      }}>
        {boardGroups.map((group) => (
          <Column
            key={group.id}
            group={group}
            groupMode={effectiveGroupMode}
            tasks={group.items}
            agentMap={agentMap}
            onContextMenu={onContextMenu}
            onOpenTask={onOpenTask}
            modelOptions={modelOptions}
            onAgentModelChange={onAgentModelChange}
            childrenMap={childrenMap}
            activeRunsByTaskId={activeRunsByTaskId}
            movingTaskIds={movingTaskIds}
            dragDisabled={dragDisabled}
          />
        ))}
      </div>
      {movingGhosts.length > 0 ? (
        <div aria-hidden="true" style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 80 }}>
          {movingGhosts.map((ghost) => (
            <div
              key={ghost.id}
              data-task-moving-ghost-id={ghost.id}
              style={{
                position: "fixed",
                left: ghost.from.x,
                top: ghost.from.y,
                width: ghost.from.width,
                minHeight: ghost.from.height,
                padding: "10px 12px",
                borderRadius: radius.md,
                border: `0.5px solid ${P.cardBorderHover}`,
                background: "color-mix(in srgb, var(--accent) 8%, var(--surface))",
                boxShadow: "0 18px 42px rgba(0,0,0,0.42), 0 0 0 1px color-mix(in srgb, var(--accent) 18%, transparent)",
                color: P.text,
                fontFamily: font.body,
                transform: ghost.running
                  ? `translate3d(${ghost.to.x - ghost.from.x}px, ${ghost.to.y - ghost.from.y}px, 0) scale(${ghost.to.width / Math.max(ghost.from.width, 1)}, ${ghost.to.height / Math.max(ghost.from.height, 1)})`
                  : "translate3d(0, 0, 0) scale(1)",
                transformOrigin: "top left",
                transition: `transform ${CARD_MOVE_DURATION_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity ${CARD_MOVE_DURATION_MS}ms ease`,
                opacity: ghost.running ? 0.98 : 1,
                willChange: "transform",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                <span style={{
                  fontSize: "10px",
                  color: P.textMuted,
                  fontFamily: font.mono,
                  fontWeight: 600,
                  letterSpacing: "0.04em",
                }}>
                  {ghost.identifier}
                </span>
                {ghost.activeAgentName ? (
                  <span style={{
                    marginLeft: "auto",
                    height: 18,
                    padding: "0 6px",
                    borderRadius: 999,
                    background: "var(--accent-soft)",
                    color: "var(--accent)",
                    fontSize: 10,
                    fontWeight: 700,
                    display: "inline-flex",
                    alignItems: "center",
                  }}>
                    Moving
                  </span>
                ) : null}
              </div>
              <div style={{
                display: "-webkit-box",
                overflow: "hidden",
                textOverflow: "ellipsis",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                fontSize: tokenType.body.size,
                lineHeight: 1.35,
              } as React.CSSProperties}>
                {ghost.title}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      <DragOverlay>
        {activeTask ? (
          <div style={{
            padding: "10px 12px", background: P.surfaceElevated,
            border: `0.5px solid ${P.cardBorderHover}`, borderRadius: radius.md,
            boxShadow: "0 12px 32px rgba(0,0,0,0.6)", width: "240px",
            fontSize: "12px", color: P.text,
          }}>
            <div style={{ fontSize: "10px", color: P.textMuted, marginBottom: "4px" }}>
              {activeTask.key ?? activeTask.id.slice(0, 8)}
            </div>
            {activeTask.title}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function rectToBox(rect: DOMRect): MovingTaskGhost["from"] {
  return {
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function measureTaskCards(
  board: HTMLDivElement,
  tasks: TaskRow[],
  agentMap: Map<string, OrchestrationAgent>,
  activeRunsByTaskId?: Map<string, ActiveTaskRunInfo>
) {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const measurements = new Map<string, MeasuredTask>();
  const cards = board.querySelectorAll<HTMLElement>("[data-task-card-id]");

  cards.forEach((card) => {
    const taskId = card.dataset.taskCardId;
    if (!taskId) return;
    const task = taskById.get(taskId);
    if (!task || (task.parentTaskId && !activeRunsByTaskId?.has(task.id))) return;
    const activeRun = activeRunsByTaskId?.get(task.id);
    measurements.set(taskId, {
      groupKey: card.dataset.taskCardGroupKey ?? task.status,
      rect: card.getBoundingClientRect(),
      title: task.title,
      identifier: task.key ?? task.id.slice(0, 8),
      activeAgentName: activeRun ? activeRun.agentName : getActiveRunLabel(task, agentMap),
    });
  });

  return measurements;
}
