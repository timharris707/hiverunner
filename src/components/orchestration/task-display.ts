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

/**
 * Renders the outer task status indicator. Inner fills or symbols come from
 * `statusInnerDotStyle` so every status surface can share the same glyphs.
 */
export function statusDotStyle(status: TaskStatus, size: number = 14): React.CSSProperties {
  const meta = STATUS_META[status];
  const px = `${size}px`;
  const borderWidth = size >= 12 ? "2px" : "1.5px";
  return {
    width: px,
    height: px,
    borderRadius: "999px",
    flexShrink: 0,
    background: "transparent",
    borderWidth,
    borderStyle: meta.style === "dotted-ring" ? "dotted" : "solid",
    borderColor: meta.color,
    position: "relative",
    display: "inline-block",
    overflow: "hidden",
  };
}

/** Returns the optional inner fill or symbol for a task status indicator. */
export function statusInnerDotStyle(status: TaskStatus, size: number = 14): React.CSSProperties | null {
  const meta = STATUS_META[status];
  const borderOffset = size >= 12 ? 2 : 1.5;
  if (meta.style === "half") {
    return {
      position: "absolute",
      top: `${borderOffset}px`,
      right: `${borderOffset}px`,
      bottom: `${borderOffset}px`,
      left: "50%",
      borderRadius: "0 999px 999px 0",
      background: meta.color,
    };
  }
  if (meta.style === "three-quarter") return null;
  if (meta.style === "blocked") {
    return {
      position: "absolute",
      top: "50%",
      left: "18%",
      right: "18%",
      height: `${Math.max(2, Math.round(size * 0.16))}px`,
      borderRadius: "999px",
      background: meta.color,
      transform: "translateY(-50%)",
      transformOrigin: "center",
    };
  }
  if (meta.style === "cancelled") {
    return {
      position: "absolute",
      inset: `${Math.max(3, Math.round(size * 0.28))}px`,
      background: meta.color,
      clipPath: "polygon(42% 0, 58% 0, 58% 42%, 100% 42%, 100% 58%, 58% 58%, 58% 100%, 42% 100%, 42% 58%, 0 58%, 0 42%, 42% 42%)",
      transform: "rotate(45deg)",
      transformOrigin: "center",
    };
  }
  if (meta.style !== "dot") return null;
  const dotSize = Math.max(4, Math.round(size * 0.45));
  return {
    position: "absolute",
    top: "50%",
    left: "50%",
    width: `${dotSize}px`,
    height: `${dotSize}px`,
    borderRadius: "999px",
    background: meta.color,
    transform: "translate(-50%, -50%)",
  };
}
