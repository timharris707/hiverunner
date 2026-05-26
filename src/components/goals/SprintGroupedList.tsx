"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";

import { GoalStatusPill } from "@/components/goals/GoalPrimitives";
import { buildCanonicalGoalPath } from "@/lib/orchestration/route-paths";
import type { GroupableItem, SprintGroupedGoal, SprintGroupedResult, SprintGroupedSprint } from "@/lib/orchestration/groupBySprint";

type GroupStatus = "planned" | "active" | "blocked" | "paused" | "done";

function defaultCollapsed(status?: GroupStatus | null) {
  return status === "done";
}

function ProjectGlyph({ color, title }: { color?: string | null; title?: string }) {
  return (
    <span
      aria-hidden="true"
      title={title}
      style={{ width: 9, height: 9, borderRadius: 2, background: color ?? "#6366f1", flexShrink: 0 }}
    />
  );
}

export function SprintGroupedList<T extends GroupableItem>({
  grouped,
  mode,
  companyCode,
  persistenceKeyPrefix,
  renderItem,
  renderSprint,
  getGoalProject,
  plainPersistenceIds = false,
  itemCountLabel = "items",
  unassignedLabel,
  empty,
  itemCompletion,
  className,
}: {
  grouped: SprintGroupedResult<T>;
  mode: "sprint" | "company-goal";
  companyCode: string;
  persistenceKeyPrefix: string;
  renderItem: (item: T) => React.ReactNode;
  renderSprint?: (sprint: SprintGroupedSprint<T>, goal: SprintGroupedGoal<T>) => React.ReactNode;
  getGoalProject?: (goal: SprintGroupedGoal<T>) => { name?: string | null; color?: string | null } | null | undefined;
  plainPersistenceIds?: boolean;
  itemCountLabel?: string;
  unassignedLabel?: string;
  empty?: React.ReactNode;
  itemCompletion?: (items: T[]) => number | undefined;
  className?: string;
}) {
  const [, rerender] = React.useReducer((value: number) => value + 1, 0);
  const hasGroups = grouped.groups.length > 0 || grouped.unassigned.length > 0;
  if (!hasGroups) return <>{empty ?? null}</>;

  const readCollapsed = (id: string, status?: GroupStatus | null) => {
    if (typeof window === "undefined") return defaultCollapsed(status);
    try {
      const saved = localStorage.getItem(`${persistenceKeyPrefix}:${id}`);
      if (saved === "collapsed") return true;
      if (saved === "expanded") return false;
    } catch {}
    return defaultCollapsed(status);
  };

  const toggle = (id: string, status?: GroupStatus | null) => {
    const next = !readCollapsed(id, status);
    try { localStorage.setItem(`${persistenceKeyPrefix}:${id}`, next ? "collapsed" : "expanded"); } catch {}
    rerender();
  };

  const countLabel = (count: number) => `${count} ${count === 1 ? itemCountLabel.replace(/s$/, "") : itemCountLabel}`;

  return (
    <div className={className}>
      {grouped.groups.map((goal) => {
          const goalId = plainPersistenceIds ? goal.goalId : `${mode}:goal:${goal.goalId}`;
          const goalCollapsed = readCollapsed(goalId, goal.goalStatus);
          const goalCount = goal.sprints.reduce((total, sprint) => total + sprint.items.length, 0);
          const project = getGoalProject?.(goal);
          return (
            <div key={goal.goalId} style={{ marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 8px" }}>
                <button
                  type="button"
                  onClick={() => toggle(goalId, goal.goalStatus)}
                  style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, border: "none", borderRadius: 6, background: "transparent", color: "var(--text-muted)", cursor: "pointer" }}
                  aria-label={goalCollapsed ? `Expand ${goal.goalName}` : `Collapse ${goal.goalName}`}
                >
                  {goalCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                </button>
                {project ? <ProjectGlyph color={project.color} title={project.name ?? undefined} /> : null}
                <Link
                  href={buildCanonicalGoalPath(companyCode, goal.goalKey ?? goal.goalId)}
                  style={{ minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-secondary)", textDecoration: "none", fontSize: 12, fontWeight: 700 }}
                >
                  {goal.goalKey ? <span style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginRight: 6 }}>{goal.goalKey}</span> : null}
                  {goal.goalName}
                </Link>
                {goal.goalStatus ? <GoalStatusPill status={goal.goalStatus} /> : null}
                <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{countLabel(goalCount)}</span>
              </div>
              {!goalCollapsed && (
                <div style={{ paddingLeft: mode === "company-goal" ? 10 : 14 }}>
                  {goal.sprints.map((sprint) => {
                    const sprintKey = plainPersistenceIds ? sprint.sprintId : `${mode}:sprint:${sprint.sprintId}`;
                    const sprintCollapsed = readCollapsed(sprintKey, sprint.sprintStatus);
                    const completion = itemCompletion?.(sprint.items);
                    const showSprintHeader = mode === "sprint";
                    if (!showSprintHeader) {
                      return (
                        <div key={sprint.sprintId}>
                          {sprint.items.map((item) => renderItem(item))}
                        </div>
                      );
                    }
                    if (renderSprint) {
                      return <div key={sprint.sprintId}>{renderSprint(sprint, goal)}</div>;
                    }
                    return (
                      <div key={sprint.sprintId} style={{ margin: "2px 0 8px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 8px" }}>
                          <button
                            type="button"
                            onClick={() => toggle(sprintKey, sprint.sprintStatus)}
                            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 18, height: 18, border: "none", borderRadius: 6, background: "transparent", color: "var(--text-muted)", cursor: "pointer" }}
                            aria-label={sprintCollapsed ? `Expand ${sprint.sprintName}` : `Collapse ${sprint.sprintName}`}
                          >
                            {sprintCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                          </button>
                          <Link
                            href={buildCanonicalGoalPath(companyCode, sprint.sprintKey ?? sprint.sprintId)}
                            style={{ minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-muted)", textDecoration: "none", fontSize: 11, fontWeight: 650 }}
                          >
                            {sprint.sprintKey ? <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)", marginRight: 6 }}>{sprint.sprintKey}</span> : null}
                            {sprint.sprintName}
                          </Link>
                          {sprint.sprintStatus ? <GoalStatusPill status={sprint.sprintStatus} /> : null}
                          {typeof completion === "number" ? <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{Math.round(completion)}%</span> : null}
                          <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{countLabel(sprint.items.length)}</span>
                        </div>
                        {!sprintCollapsed && (
                          <div style={{ paddingLeft: 10 }}>
                            {sprint.items.map((item) => renderItem(item))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
      })}
      {grouped.unassigned.length > 0 && (
          <div style={{ marginTop: grouped.groups.length > 0 ? 12 : 0 }}>
            <div style={{ padding: "4px 8px", display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>{unassignedLabel ?? "Unassigned"}</span>
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>({grouped.unassigned.length})</span>
            </div>
            {grouped.unassigned.map((item) => renderItem(item))}
          </div>
      )}
    </div>
  );
}
