"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

const STORAGE_PREFIX = "hiverunner-hidden-projects:";
const EVENT_NAME = "hiverunner-hidden-projects-change";

type HiddenProjectMap = Record<string, boolean>;
const EMPTY_HIDDEN_PROJECTS = Object.freeze({}) as HiddenProjectMap;

function storageKey(companySlug: string) {
  return `${STORAGE_PREFIX}${companySlug}`;
}

export function parseHiddenProjects(raw: string | null): HiddenProjectMap {
  if (!raw) return EMPTY_HIDDEN_PROJECTS;

  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as HiddenProjectMap) : EMPTY_HIDDEN_PROJECTS;
  } catch {
    return EMPTY_HIDDEN_PROJECTS;
  }
}

export function getEmptyHiddenProjectsSnapshot(): HiddenProjectMap {
  return EMPTY_HIDDEN_PROJECTS;
}

export function createHiddenProjectsSnapshotReader(storage: Pick<Storage, "getItem"> | null | undefined, key: string) {
  let lastRaw: string | null | undefined;
  let lastParsed = EMPTY_HIDDEN_PROJECTS;

  return () => {
    const raw = storage?.getItem(key) ?? null;
    if (raw === lastRaw) {
      return lastParsed;
    }

    lastRaw = raw;
    lastParsed = parseHiddenProjects(raw);
    return lastParsed;
  };
}

function writeHiddenProjects(companySlug: string, next: HiddenProjectMap) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey(companySlug), JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { companySlug } }));
}

function subscribeToHiddenProjects(companySlug: string, onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const sync = (event?: Event) => {
    const custom = event as CustomEvent<{ companySlug?: string }> | undefined;
    if (custom?.detail?.companySlug && custom.detail.companySlug !== companySlug) return;
    onStoreChange();
  };

  window.addEventListener(EVENT_NAME, sync as EventListener);
  window.addEventListener("storage", sync);

  return () => {
    window.removeEventListener(EVENT_NAME, sync as EventListener);
    window.removeEventListener("storage", sync);
  };
}

export function useHiddenProjects(companySlug: string) {
  const subscribe = useCallback(
    (onStoreChange: () => void) => subscribeToHiddenProjects(companySlug, onStoreChange),
    [companySlug]
  );
  const getSnapshot = useMemo(() => {
    if (typeof window === "undefined") {
      return getEmptyHiddenProjectsSnapshot;
    }

    return createHiddenProjectsSnapshotReader(window.localStorage, storageKey(companySlug));
  }, [companySlug]);
  const hiddenProjects = useSyncExternalStore(subscribe, getSnapshot, getEmptyHiddenProjectsSnapshot);

  const setHidden = useCallback(
    (projectId: string, hidden: boolean) => {
      const next = { ...getSnapshot() };
      if (hidden) {
        next[projectId] = true;
      } else {
        delete next[projectId];
      }
      writeHiddenProjects(companySlug, next);
    },
    [companySlug, getSnapshot]
  );

  const visibleProjectIds = useMemo(
    () => Object.entries(hiddenProjects).filter(([, hidden]) => !hidden).map(([projectId]) => projectId),
    [hiddenProjects]
  );

  return { hiddenProjects, setHidden, visibleProjectIds };
}
