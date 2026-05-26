"use client";

import { User } from "lucide-react";

import { AgentAvatarInline } from "@/components/tasks/InlineAssigneePicker";
import type { OrchestrationAgent } from "@/lib/orchestration/types";
import { P } from "@/lib/ui/tokens";

export function AssigneeAvatar({
  agent,
  size = 20,
  title,
}: {
  agent?: OrchestrationAgent;
  size?: number;
  title?: string;
}) {
  if (agent) {
    return <AgentAvatarInline agent={agent} size={size} />;
  }

  return (
    <span
      title={title ?? "Unassigned"}
      aria-label={title ?? "Unassigned"}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: "var(--surface-elevated)",
        border: `0.5px solid ${P.cardBorder}`,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        color: P.textMuted,
        flexShrink: 0,
      }}
    >
      <User size={Math.max(10, Math.round(size * 0.55))} strokeWidth={1.8} />
    </span>
  );
}
