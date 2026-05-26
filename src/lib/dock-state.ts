"use client";

import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "dock-collapsed";
const EVENT_NAME = "dock-toggle";

function getInitial(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(STORAGE_KEY) === "1";
}

function subscribeDockCollapsed(onStoreChange: () => void): () => void {
  window.addEventListener(EVENT_NAME, onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    window.removeEventListener(EVENT_NAME, onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

export function useDockCollapsed() {
  const collapsed = useSyncExternalStore(subscribeDockCollapsed, getInitial, () => false);

  const toggle = useCallback(() => {
    const next = !getInitial();
    localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    window.dispatchEvent(new Event(EVENT_NAME));
  }, []);

  return { collapsed, toggle };
}
