"use client";

import { useState, useCallback } from "react";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import type { TaskStatus } from "@/lib/orchestration/types";

interface UseTaskDragDropOpts {
  onStatusChange: (taskId: string, newStatus: TaskStatus) => void;
}

export function useTaskDragDrop({ onStatusChange }: UseTaskDragDropOpts) {
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
      const overId = String(over.id);

      // over.id is the column status id (e.g. "in-progress")
      // or another task id — in which case we use the over.data.current?.status
      const newStatus = (over.data?.current?.status as TaskStatus) ?? (overId as TaskStatus);
      if (newStatus && active.data?.current?.status !== newStatus) {
        onStatusChange(taskId, newStatus);
      }
    },
    [onStatusChange]
  );

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
  }, []);

  return { activeId, handleDragStart, handleDragEnd, handleDragCancel };
}
