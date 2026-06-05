import type { TaskPriority, TaskStatus } from "@/lib/orchestration/types";

export interface PriorityInfo {
  label: string;
  /** Hex color for the priority indicator */
  color: string;
  /** Unicode icon character for contexts where React elements aren't available */
  icon: string;
}

export interface StatusInfo {
  label: string;
  /** Hex color for the status dot */
  color: string;
  /** Visual treatment for the canonical status indicator */
  style: "ring" | "dotted-ring" | "half" | "three-quarter" | "dot" | "blocked" | "cancelled";
  /** @deprecated Use style instead */
  fill: "empty" | "half" | "full";
  /** @deprecated Use style instead */
  filled: boolean;
}

export const PRIORITY_META: Record<TaskPriority, PriorityInfo> = {
  P0: { label: "Critical", color: "var(--negative)", icon: "\u26a0" },
  P1: { label: "High", color: "var(--warning)", icon: "\u2191" },
  P2: { label: "Medium", color: "var(--info)", icon: "\u2014" },
  P3: { label: "Low", color: "var(--positive)", icon: "\u2193" },
};

export const STATUS_META: Record<TaskStatus, StatusInfo> = {
  backlog:       { label: "Backlog",     color: "var(--text-muted)", style: "dotted-ring", fill: "empty", filled: false },
  "to-do":     { label: "To-Do",      color: "var(--info)", style: "ring", fill: "empty", filled: false },
  "in-progress": { label: "In Progress", color: "var(--accent)", style: "half", fill: "half", filled: false },
  review:        { label: "In Review",   color: "var(--warning)", style: "three-quarter", fill: "half", filled: false },
  done:          { label: "Done",        color: "var(--positive)", style: "dot",  fill: "full",  filled: true  },
  blocked:       { label: "Blocked",     color: "var(--negative)", style: "blocked", fill: "empty", filled: false },
  cancelled:     { label: "Cancelled",   color: "var(--text-muted)", style: "cancelled", fill: "empty", filled: false },
};
