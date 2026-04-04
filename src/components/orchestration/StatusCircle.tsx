import type { TaskStatus } from "@/lib/orchestration/types";
import { statusDotStyle, statusInnerDotStyle } from "./task-display";

interface Props {
  status: TaskStatus;
  size?: number;
  onClick?: (e: React.MouseEvent) => void;
  title?: string;
  style?: React.CSSProperties;
}

/**
 * Canonical status circle renderer. Outline ring for every status except `done`,
 * which has a centered filled dot. Matches Paperclip's issue status styling.
 */
export function StatusCircle({ status, size = 14, onClick, title, style }: Props) {
  const outer = statusDotStyle(status, size);
  const inner = statusInnerDotStyle(status, size);
  return (
    <span
      onClick={onClick}
      title={title}
      style={{
        ...outer,
        ...(onClick ? { cursor: "pointer" } : {}),
        ...style,
      }}
    >
      {inner ? <span style={inner} aria-hidden /> : null}
    </span>
  );
}
