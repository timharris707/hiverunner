"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { DateWindowChip } from "@/components/goals/DateWindowChip";
import { GoalDateWindowText, GoalOwnerAvatarChip, GoalProgressBar, GoalStatusPill } from "@/components/goals/GoalPrimitives";
import { OwnerChip } from "@/components/goals/OwnerChip";
import { buildCanonicalGoalPath, goalRouteKey } from "@/lib/orchestration/route-paths";
import type { OrchestrationAgent, OrchestrationSprint } from "@/lib/orchestration/types";

type SprintRowSprint = Pick<OrchestrationSprint, "id" | "name" | "status" | "startDate" | "owner" | "sprintKey" | "goalKey"> & {
  endDate?: string | null;
};

export function SprintRow({
  sprint,
  completionPercent,
  companyCode,
  parentGoalName,
  projectLabel,
  agents = [],
  rightAccessory,
  onOwnerChange,
  onDateChange,
}: {
  sprint: SprintRowSprint;
  completionPercent: number;
  companyCode: string;
  parentGoalName?: string;
  projectLabel?: string;
  agents?: OrchestrationAgent[];
  rightAccessory?: ReactNode;
  onOwnerChange?: (sprintId: string, owner: string | null) => void;
  onDateChange?: (sprintId: string, startDate: string, endDate: string | null) => void;
}) {
  const href = buildCanonicalGoalPath(companyCode, goalRouteKey(sprint));
  const context = [parentGoalName, projectLabel].filter(Boolean).join(" · ");
  const percent = Math.max(0, Math.min(100, completionPercent));
  const percentTransform = percent <= 5 ? "translateX(0)" : percent >= 95 ? "translateX(-100%)" : "translateX(-50%)";

  return (
    <Link
      href={href}
      className="grid gap-2 px-4 py-3 no-underline transition hover:bg-stone-900/20 sm:grid-cols-[minmax(0,1fr)_92px_116px]"
      style={{ color: "inherit" }}
    >
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <div className="truncate text-xs font-semibold text-stone-200">
            {sprint.sprintKey ? <span className="mr-2 font-mono text-stone-500">{sprint.sprintKey}</span> : null}
            {sprint.name}
          </div>
          <GoalStatusPill status={sprint.status} />
        </div>
        {context ? (
          <div className="mt-1 truncate text-[10px] text-stone-600">
            {context}
          </div>
        ) : null}
        <div style={{ position: "relative", marginTop: 8, paddingTop: 14 }}>
          <span
            style={{
              position: "absolute",
              top: 0,
              left: `${percent}%`,
              transform: percentTransform,
              color: "var(--text-muted)",
              fontSize: "10px",
              pointerEvents: "none",
              whiteSpace: "nowrap",
            }}
          >
            {Math.round(percent)}%
          </span>
          <GoalProgressBar value={completionPercent} />
        </div>
      </div>
      <div className="flex items-center gap-2 text-[11px] text-stone-500 sm:justify-end">
        {rightAccessory}
        {onOwnerChange ? (
          <OwnerChip sprint={sprint} agents={agents} onChange={(owner) => onOwnerChange(sprint.id, owner)} />
        ) : (
          <GoalOwnerAvatarChip owner={sprint.owner} agents={agents} status={sprint.status} />
        )}
      </div>
      <div className="flex items-center text-[11px] sm:justify-end">
        {onDateChange ? (
          <DateWindowChip sprint={sprint} onChange={(startDate, endDate) => onDateChange(sprint.id, startDate, endDate)} />
        ) : (
          <GoalDateWindowText status={sprint.status} startDate={sprint.startDate} endDate={sprint.endDate} />
        )}
      </div>
    </Link>
  );
}
