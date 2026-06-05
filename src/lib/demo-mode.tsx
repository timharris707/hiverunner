"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

interface DemoModeContextType {
  isDemoMode: boolean;
  toggleDemoMode: () => void;
}

const DemoModeContext = createContext<DemoModeContextType>({
  isDemoMode: false,
  toggleDemoMode: () => {},
});

const STORAGE_KEY = "hiverunner-demo-mode";

export function readStoredDemoModeFromStorage(storage: Pick<Storage, "getItem"> | null | undefined): boolean {
  return storage?.getItem(STORAGE_KEY) === "true";
}

function readStoredDemoMode(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return readStoredDemoModeFromStorage(window.localStorage);
}

export function DemoModeProvider({ children }: { children: ReactNode }) {
  const [isDemoMode, setIsDemoMode] = useState(() => readStoredDemoMode());

  const toggleDemoMode = useCallback(() => {
    setIsDemoMode((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  }, []);

  return (
    <DemoModeContext.Provider value={{ isDemoMode, toggleDemoMode }}>
      {children}
    </DemoModeContext.Provider>
  );
}

export function useDemoMode() {
  return useContext(DemoModeContext);
}
