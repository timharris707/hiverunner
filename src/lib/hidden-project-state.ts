"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

const STORAGE_PREFIX = "mission-control-hidden-projects:";
const EVENT_NAME = "mission-control-hidden-projects-change";

type HiddenProjectMap = Record<string, boolean>;

function storageKey(companySlug: string) {
  return `${STORAGE_PREFIX}${companySlug}`;
}

function readHiddenProjects(companySlug: string): HiddenProjectMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(storageKey(companySlug));
    if (!raw) return {};
    return JSON.parse(raw) as HiddenProjectMap;
  } catch {
    return {};
  }
}

function writeHiddenProjects(companySlug: string, next: HiddenProjectMap) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey(companySlug), JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { companySlug } }));
}

export function useHiddenProjects(companySlug: string) {
  const [hiddenProjects, setHiddenProjects] = useState<HiddenProjectMap>({});

  useEffect(() => {
    setHiddenProjects(readHiddenProjects(companySlug));

    const sync = (event?: Event) => {
      const custom = event as CustomEvent<{ companySlug?: string }> | undefined;
      if (custom?.detail?.companySlug && custom.detail.companySlug !== companySlug) return;
      setHiddenProjects(readHiddenProjects(companySlug));
    };

    window.addEventListener(EVENT_NAME, sync as EventListener);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT_NAME, sync as EventListener);
      window.removeEventListener("storage", sync);
    };
  }, [companySlug]);

  const setHidden = useCallback(
    (projectId: string, hidden: boolean) => {
      const next = {
        ...readHiddenProjects(companySlug),
        [projectId]: hidden,
      };
      writeHiddenProjects(companySlug, next);
      setHiddenProjects(next);
    },
    [companySlug]
  );

  const visibleProjectIds = useMemo(
    () => Object.entries(hiddenProjects).filter(([, hidden]) => !hidden).map(([projectId]) => projectId),
    [hiddenProjects]
  );

  return { hiddenProjects, setHidden, visibleProjectIds };
}
