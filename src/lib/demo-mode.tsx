"use client";

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

interface DemoModeContextType {
  isDemoMode: boolean;
  toggleDemoMode: () => void;
}

const DemoModeContext = createContext<DemoModeContextType>({
  isDemoMode: false,
  toggleDemoMode: () => {},
});

const STORAGE_KEY = "mission-control-demo-mode";

export function DemoModeProvider({ children }: { children: ReactNode }) {
  const [isDemoMode, setIsDemoMode] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "true") setIsDemoMode(true);
  }, []);

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

// --- Masking utilities ---

/** Mask a dollar amount: "$1,234.56" → "$X,XXX" */
export function maskDollar(value: number | string | null | undefined, prefix = "$"): string {
  if (value == null) return "—";
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "—";
  // Preserve sign and rough magnitude
  const sign = num < 0 ? "-" : num > 0 ? "+" : "";
  const abs = Math.abs(num);
  if (abs >= 1000) return `${sign}${prefix}X,XXX`;
  if (abs >= 100) return `${sign}${prefix}XXX`;
  if (abs >= 10) return `${sign}${prefix}XX`;
  return `${sign}${prefix}X.XX`;
}

/** Mask an API key or ID: "abc123def456" → "••••••••" */
export function maskKey(value: string | null | undefined): string {
  if (!value) return "••••••••";
  return "••••••••";
}

/** Mask an email: "tim@example.com" → "t••@••••••" */
export function maskEmail(value: string): string {
  const at = value.indexOf("@");
  if (at < 1) return "••••@••••";
  return value[0] + "••@••••••";
}

/** Mask a connection subtext that might contain key IDs */
export function maskConnectionSubtext(text: string, configured: boolean): string {
  if (!configured) return text;
  return "Connected (••••••••)";
}

/** Mask a percentage value */
export function maskPercent(): string {
  return "XX.X%";
}
