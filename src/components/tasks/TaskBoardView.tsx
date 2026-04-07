"use client";

import { useMemo } from "react";
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
import { StatusCircle } from "@/components/orchestration/StatusCircle";
import { TaskCard } from "./TaskCard";
import { useTaskDragDrop } from "./useTaskDragDrop";
import { type TaskRow, type InlineEditCallbacks, BOARD_COLUMNS, STATUS_LABEL, getActiveRunLabel } from "./types";
import type { OrchestrationAgent, TaskStatus } from "@/lib/orchestration/types";
import { P, radius } from "@/lib/ui/tokens";

interface Props {
  tasks: TaskRow[];
  agents: OrchestrationAgent[];
  agentMap: Map<string, OrchestrationAgent>;
  callbacks: InlineEditCallbacks;
  buildHref: (task: TaskRow) => string;
  onContextMenu: (e: React.MouseEvent, task: TaskRow) => void;
}

function Column({
  status, tasks, agentMap, buildHref, onContextMenu, childrenMap
}: {
  status: TaskStatus;
  tasks: TaskRow[];
  agentMap: Map<string, OrchestrationAgent>;
  buildHref: (task: TaskRow) => string;
  onContextMenu: (e: React.MouseEvent, task: TaskRow) => void;
  childrenMap: Map<string, number>;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status, data: { status } });

  return (
    <div style={{
      flex: 1, minWidth: "220px", maxWidth: "280px", display: "flex", flexDirection: "column",
      background: isOver ? "rgba(255,255,255,0.02)" : "transparent",
      borderRadius: radius.md, transition: "background 150ms ease"
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: "6px",
        padding: "8px 10px", borderBottom: `0.5px solid ${P.cardBorder}`,
      }}>
        <StatusCircle status={status} size={12} />
        <span style={{ fontSize: "11px", fontWeight: 600, color: P.textSecondary, textTransform: "uppercase", letterSpacing: "0.02em" }}>
          {STATUS_LABEL[status]}
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
            const activeLabel = getActiveRunLabel(task, agentMap);
            const childCount = childrenMap.get(task.id) ?? 0;
            return (
              <TaskCard
                key={task.id}
                task={task}
                href={buildHref(task)}
                agentMap={agentMap}
                onContextMenu={onContextMenu}
                hasActiveRun={!!activeLabel}
                activeAgentName={activeLabel}
                childCount={childCount}
              />
            );
          })}
        </SortableContext>
      </div>
    </div>
  );
}

export function TaskBoardView({ tasks, agents, agentMap, callbacks, buildHref, onContextMenu }: Props) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  
  const handleDrop = async (taskId: string, newStatus: TaskStatus) => {
    // Immediate optimistic update happens inside useTaskDragDrop calling onStatusChange
    await callbacks.onStatusChange(taskId, newStatus);
    
    // Also trigger the reorder API separately for columns
    await fetch("/api/orchestration/tasks/reorder", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId, status: newStatus }),
    }).catch(() => null);
  };

  const { activeId, handleDragStart, handleDragEnd, handleDragCancel } = useTaskDragDrop({
    onStatusChange: handleDrop,
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

  const columnTasks = useMemo(() => {
    const map: Record<string, TaskRow[]> = {};
    for (const col of BOARD_COLUMNS) map[col] = [];
    for (const task of tasks) {
      if (task.parentTaskId) continue; // Hide sub-issues from top level in board
      const col = BOARD_COLUMNS.includes(task.status) ? task.status : "backlog";
      map[col].push(task);
    }
    return map;
  }, [tasks]);

  const activeTask = activeId ? tasks.find((t) => t.id === activeId) : undefined;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div style={{
        display: "flex", gap: "12px", flex: 1, overflowX: "auto", padding: "12px 16px",
      }}>
        {BOARD_COLUMNS.map((status) => (
          <Column
            key={status}
            status={status}
            tasks={columnTasks[status] ?? []}
            agentMap={agentMap}
            buildHref={buildHref}
            onContextMenu={onContextMenu}
            childrenMap={childrenMap}
          />
        ))}
      </div>
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
