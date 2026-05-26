"use client";

import { useState, useCallback } from "react";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import type { SprintStatus, TaskPriority, TaskStatus } from "@/lib/orchestration/types";

export type TaskBoardDropTarget =
  | { mode: "status"; status: TaskStatus }
  | { mode: "priority"; priority: TaskPriority }
  | { mode: "assignee"; assignee: string | null }
  | {
      mode: "sprint";
      sprintId: string | null;
      sprintName?: string | null;
      sprintStatus?: SprintStatus | null;
      companyGoalId?: string | null;
      companyGoalName?: string | null;
      companyGoalStatus?: SprintStatus | null;
      projectId?: string | null;
      projectName?: string | null;
    };

interface UseTaskDragDropOpts {
  onDrop: (taskId: string, target: TaskBoardDropTarget) => void;
}

function targetsEqual(a?: TaskBoardDropTarget, b?: TaskBoardDropTarget) {
  if (!a || !b || a.mode !== b.mode) return false;
  if (a.mode === "status" && b.mode === "status") return a.status === b.status;
  if (a.mode === "priority" && b.mode === "priority") return a.priority === b.priority;
  if (a.mode === "assignee" && b.mode === "assignee") return (a.assignee ?? null) === (b.assignee ?? null);
  if (a.mode === "sprint" && b.mode === "sprint") return (a.sprintId ?? null) === (b.sprintId ?? null);
  return false;
}

export function useTaskDragDrop({ onDrop }: UseTaskDragDropOpts) {
  const [activeId, setActiveId] = useState<string | null>(null);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveId(null);
      const { active, over } = event;
      if (!over) return;
      const taskId = String(active.id);

      const target = over.data?.current?.target as TaskBoardDropTarget | undefined;
      const origin = active.data?.current?.target as TaskBoardDropTarget | undefined;
      if (target && !targetsEqual(origin, target)) {
        onDrop(taskId, target);
      }
    },
    [onDrop]
  );

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
  }, []);

  return { activeId, handleDragStart, handleDragEnd, handleDragCancel };
}
