import type { TaskStatus } from "@/lib/orchestration/types";
import { STATUS_META } from "./task-display";

interface Props {
  status: TaskStatus;
  size?: number;
  onClick?: (e: React.MouseEvent) => void;
  title?: string;
  style?: React.CSSProperties;
}

/** Canonical task status glyph renderer shared by task lists, boards, and pickers. */
export function StatusCircle({ status, size = 14, onClick, title, style }: Props) {
  const meta = STATUS_META[status];
  return (
    <span
      onClick={onClick}
      title={title}
      style={{
        width: size,
        height: size,
        color: meta.color,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        lineHeight: 0,
        ...(onClick ? { cursor: "pointer" } : {}),
        ...style,
      }}
    >
      <StatusButtonGlyph status={status} />
    </span>
  );
}

function StatusButtonGlyph({ status }: { status: TaskStatus }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      width="100%"
      height="100%"
      aria-hidden="true"
      focusable="false"
      style={{ display: "block" }}
    >
      {status === "backlog" && (
        <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="0.01 3.657" pathLength="44" />
      )}
      {status === "to-do" && (
        <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
      )}
      {status === "in-progress" && (
        <>
          <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M 8 8 L 8 3 A 5 5 0 0 1 8 13 Z" fill="currentColor" />
        </>
      )}
      {status === "review" && (
        <>
          <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M 8 8 L 8 4.2 M 8 8 L 11.2 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </>
      )}
      {status === "done" && (
        <>
          <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="8" cy="8" r="4.5" fill="currentColor" />
        </>
      )}
      {status === "blocked" && (
        <>
          <circle cx="8" cy="8" r="7" fill="currentColor" />
          <rect x="3.5" y="7.15" width="9" height="1.7" rx="0.85" fill="#ffffff" />
        </>
      )}
      {status === "cancelled" && (
        <>
          <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M 5.4 5.4 L 10.6 10.6 M 10.6 5.4 L 5.4 10.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}
