"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "hiverunner-active-project";
const EVENT_NAME = "hiverunner-active-project-change";

export type ActiveProjectState = {
  companySlug: string;
  projectId: string;
  projectSlug?: string;
  projectName?: string;
};

function readState(): ActiveProjectState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ActiveProjectState;
    if (!parsed?.companySlug || !parsed?.projectId) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeState(next: ActiveProjectState | null) {
  if (typeof window === "undefined") return;
  if (!next) {
    localStorage.removeItem(STORAGE_KEY);
  } else {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }
  window.dispatchEvent(new Event(EVENT_NAME));
}

export function useActiveProjectState() {
  const [activeProject, setActiveProjectState] = useState<ActiveProjectState | null>(readState);

  useEffect(() => {
    const sync = () => setActiveProjectState(readState());
    window.addEventListener(EVENT_NAME, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT_NAME, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const setActiveProject = useCallback((next: ActiveProjectState | null) => {
    writeState(next);
    setActiveProjectState(next);
  }, []);

  const clearActiveProject = useCallback(() => {
    writeState(null);
    setActiveProjectState(null);
  }, []);

  return { activeProject, setActiveProject, clearActiveProject };
}
