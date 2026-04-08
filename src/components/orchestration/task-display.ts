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
  /** "ring" = outline ring, "dot" = outline ring with inner centered dot */
  style: "ring" | "dot";
  /** @deprecated Use style instead */
  fill: "empty" | "half" | "full";
  /** @deprecated Use style instead */
  filled: boolean;
}

export const PRIORITY_META: Record<TaskPriority, PriorityInfo> = {
  P0: { label: "Critical", color: "#ef4444", icon: "\u26a0" },
  P1: { label: "High", color: "#f97316", icon: "\u2191" },
  P2: { label: "Medium", color: "#eab308", icon: "\u2014" },
  P3: { label: "Low", color: "#3b82f6", icon: "\u2193" },
};

export const STATUS_META: Record<TaskStatus, StatusInfo> = {
  backlog:       { label: "Backlog",     color: "#737373", style: "ring", fill: "empty", filled: false },
  "on-deck":     { label: "Todo",        color: "#60a5fa", style: "ring", fill: "empty", filled: false },
  "in-progress": { label: "In Progress", color: "#facc15", style: "ring", fill: "empty", filled: false },
  review:        { label: "In Review",   color: "#a78bfa", style: "ring", fill: "empty", filled: false },
  blocked:       { label: "Blocked",     color: "#f87171", style: "ring", fill: "empty", filled: false },
  done:          { label: "Done",        color: "#4ade80", style: "dot",  fill: "full",  filled: true  },
  cancelled:     { label: "Cancelled",   color: "#737373", style: "ring", fill: "empty", filled: false },
};

/**
 * Renders a status indicator as an outline circle matching Paperclip's style.
 * Default size is 14px (the canonical Paperclip size is 16px; 14px fits MC's denser rows).
 *
 * - "ring" style: 2px colored outline, transparent interior.
 * - "dot"  style: 2px colored outline with a centered filled dot (50% of outer size).
 *
 * Pass `size` explicitly when a different diameter is needed (detail page: 16, board header: 10).
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
    border: `${borderWidth} solid ${meta.color}`,
    position: "relative",
    display: "inline-block",
  };
}

/**
 * For the "dot" style (Done), this returns the inner-dot element style.
 * Callers that render an outer `<span>` with `statusDotStyle` can add a nested
 * `<span>` with these styles for the centered filled dot.
 */
export function statusInnerDotStyle(status: TaskStatus, size: number = 14): React.CSSProperties | null {
  const meta = STATUS_META[status];
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
