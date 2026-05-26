"use client";

import { PRIORITY_META } from "@/components/orchestration/task-display";
import type { TaskPriority } from "@/lib/orchestration/types";

interface PriorityBarsProps {
  priority: TaskPriority;
  size?: number;
}

export function PriorityBars({ priority, size = 18 }: PriorityBarsProps) {
  const filled = priority === "P0" ? 4 : priority === "P1" ? 3 : priority === "P2" ? 2 : 1;
  const meta = PRIORITY_META[priority];

  return (
    <span
      aria-hidden
      style={{
        display: "inline-flex",
        alignItems: "end",
        gap: 2,
        width: size,
        height: size,
        color: meta.color,
        flexShrink: 0,
      }}
    >
      {[1, 2, 3, 4].map((bar) => (
        <span
          key={bar}
          style={{
            width: 3,
            height: 4 + bar * 3,
            borderRadius: 1,
            background: bar <= filled ? meta.color : "color-mix(in srgb, currentColor 20%, transparent)",
          }}
        />
      ))}
    </span>
  );
}
