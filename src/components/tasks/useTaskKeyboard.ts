"use client";

import { useEffect, useCallback } from "react";
import type { ViewMode } from "./types";

interface UseTaskKeyboardOpts {
  taskCount: number;
  selectedIndex: number;
  setSelectedIndex: (i: number) => void;
  onOpenTask: (index: number) => void;
  onOpenCreate: () => void;
  focusSearch: () => void;
  viewMode: ViewMode;
  setViewMode: (v: ViewMode) => void;
  enabled: boolean;
}

export function useTaskKeyboard(opts: UseTaskKeyboardOpts) {
  const {
    taskCount,
    selectedIndex,
    setSelectedIndex,
    onOpenTask,
    onOpenCreate,
    focusSearch,
    viewMode,
    setViewMode,
    enabled,
  } = opts;

  const handler = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled) return;
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable;

      if (e.key === "Escape") {
        if (isInput) {
          (target as HTMLInputElement).blur();
        }
        setSelectedIndex(-1);
        return;
      }

      if (isInput) return;

      switch (e.key) {
        case "n":
          e.preventDefault();
          onOpenCreate();
          break;
        case "/":
          e.preventDefault();
          focusSearch();
          break;
        case "1":
          e.preventDefault();
          setViewMode("list");
          break;
        case "2":
          e.preventDefault();
          setViewMode("board");
          break;
        case "3":
          e.preventDefault();
          setViewMode("table");
          break;
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex(Math.min(selectedIndex + 1, Math.max(0, taskCount - 1)));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex(Math.max(selectedIndex - 1, 0));
          break;
        case "Enter":
          if (selectedIndex >= 0 && selectedIndex < taskCount) {
            e.preventDefault();
            onOpenTask(selectedIndex);
          }
          break;
      }
    },
    [enabled, taskCount, selectedIndex, setSelectedIndex, onOpenTask, onOpenCreate, focusSearch, setViewMode]
  );

  useEffect(() => {
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handler]);
}
