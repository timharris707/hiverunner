import type { TaskPriority, TaskStatus, TaskType } from "@/lib/orchestration/types";

export const priorityTheme: Record<TaskPriority, { label: string; shortLabel: string; color: string; bg: string; icon: string }> = {
  P0: { label: "Critical", shortLabel: "P0", color: "var(--negative)", bg: "var(--negative-soft)", icon: "\u26a0" },
  P1: { label: "High", shortLabel: "P1", color: "var(--warning)", bg: "var(--warning-soft)", icon: "\u2191" },
  P2: { label: "Medium", shortLabel: "P2", color: "var(--warning)", bg: "var(--warning-soft)", icon: "\u2014" },
  P3: { label: "Low", shortLabel: "P3", color: "var(--text-secondary)", bg: "var(--surface-hover)", icon: "\u2193" },
};

export const statusTheme: Record<TaskStatus, { label: string; glow: string }> = {
  backlog: { label: "Backlog", glow: "0 0 0 1px rgba(148,163,184,0.25)" },
  "to-do": { label: "To-Do", glow: "0 0 0 1px rgba(251,191,36,0.3)" },
  "in-progress": { label: "In Progress", glow: "0 0 0 1px rgba(217,119,6,0.35)" },
  review: { label: "Review", glow: "0 0 0 1px rgba(245,158,11,0.35)" },
  done: { label: "Done", glow: "0 0 0 1px rgba(74,222,128,0.28)" },
  blocked: { label: "Blocked", glow: "0 0 0 1px rgba(248,113,113,0.35)" },
  cancelled: { label: "Cancelled", glow: "0 0 0 1px rgba(148,163,184,0.2)" },
};

export const typeIcon: Record<TaskType, string> = {
  feature: "🆕",
  bug: "🐛",
  maintenance: "🛠️",
  research: "🔬",
  infrastructure: "🏗️",
  directive: "📋",
  epic: "🧭",
  spike: "🔎",
  docs: "📄",
  infra: "🏗️",
  refactor: "♻️",
  review: "✓",
  qa: "☑️",
  release: "🚢",
};

const STALE_THRESHOLD_MINUTES: Partial<Record<TaskStatus, number>> = {
  review: 60,
  "in-progress": 240,
  blocked: 120,
};

export type StaleSeverity = "none" | "warning" | "critical";

export function getStaleSignal(taskStatus: TaskStatus, timestamp: string): {
  severity: StaleSeverity;
  ageMinutes: number;
  thresholdMinutes: number | null;
} {
  const thresholdMinutes = STALE_THRESHOLD_MINUTES[taskStatus] ?? null;
  const updatedMs = new Date(timestamp).getTime();
  const ageMinutes = Number.isFinite(updatedMs)
    ? Math.max(0, Math.floor((Date.now() - updatedMs) / 60_000))
    : 0;

  if (!thresholdMinutes) {
    return { severity: "none", ageMinutes, thresholdMinutes: null };
  }

  if (ageMinutes >= thresholdMinutes) {
    return { severity: "critical", ageMinutes, thresholdMinutes };
  }

  if (ageMinutes >= Math.floor(thresholdMinutes * 0.75)) {
    return { severity: "warning", ageMinutes, thresholdMinutes };
  }

  return { severity: "none", ageMinutes, thresholdMinutes };
}

export function classifyProjectState(status: string): "active" | "paused" | "archived" {
  if (["archived", "completed"].includes(status)) return "archived";
  if (["inactive", "on-hold", "paused"].includes(status)) return "paused";
  return "active";
}

export function formatAge(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const minutes = Math.max(1, Math.floor(diff / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function isStale(taskStatus: TaskStatus, timestamp: string): boolean {
  return getStaleSignal(taskStatus, timestamp).severity === "critical";
}
