"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronDown, ChevronRight, Flag, Layers3, Plus, Target, X } from "lucide-react";
import { DateWindowChip } from "@/components/goals/DateWindowChip";
import { OwnerChip } from "@/components/goals/OwnerChip";
import {
  createCompanyGoal,
  listPendingSprintPlanDrafts,
  listCompanyAgents,
  listCompanies,
  listCompanyGoals,
  listProjects,
  reviewSprintPlanDraft,
  updateCompanyGoal,
} from "@/lib/orchestration/client";
import { AgentAvatarInline } from "@/components/tasks/InlineAssigneePicker";
import { determineGoalKind, type GoalKind } from "@/lib/orchestration/goal-kind";
import { useEventStream, type StreamEvent } from "@/lib/orchestration/use-event-stream";
import type {
  OrchestrationAgent,
  OrchestrationCompany,
  OrchestrationCompanyGoal,
  OrchestrationPendingSprintPlanDraftSummary,
  OrchestrationProject,
  OrchestrationSprint,
} from "@/lib/orchestration/types";
import { buildCanonicalGoalPath, goalRouteKey } from "@/lib/orchestration/route-paths";
import { P as tokens } from "@/lib/ui/tokens";

const STATUS_COLORS: Record<string, { color: string; bg: string }> = {
  active: { color: "var(--positive)", bg: "var(--positive-soft)" },
  blocked: { color: "var(--negative)", bg: "var(--negative-soft)" },
  paused: { color: "var(--text-muted)", bg: "color-mix(in srgb, var(--text-muted) 14%, transparent)" },
  planned: { color: "var(--text-muted)", bg: "var(--surface-hover)" },
  done: { color: "var(--text-secondary)", bg: "color-mix(in srgb, var(--text-secondary) 14%, transparent)" },
};

type CollapsePreference = "expanded" | "collapsed";
type StatusFilter = "active" | "planned" | "done";
type ProjectFilter = string | "company-wide";
type ComposerExecutionEngine = "" | NonNullable<OrchestrationSprint["defaultExecutionEngine"]>;
type ComposerModelLane = "" | NonNullable<OrchestrationSprint["defaultModelLane"]>;
type GoalPatch = {
  status?: OrchestrationSprint["status"];
  owner?: string | null;
  leadAgentId?: string | null;
  startDate?: string;
  endDate?: string | null;
};
type ApprovalPrompt = {
  kind: "next_sprint" | "all_sprints";
  draft: OrchestrationPendingSprintPlanDraftSummary;
} | null;
const COMPANY_WIDE_PROJECT_ID = "__company-wide__";
const NO_COMPANY_GOAL_ID = "__no-company-goal__";
const STATUS_OPTIONS: OrchestrationSprint["status"][] = ["planned", "active", "blocked", "paused", "done"];

type GoalRollup = {
  taskCount: number;
  doneCount: number;
  inProgressCount: number;
  reviewCount: number;
  remainingTasks: number;
  completionPercent: number;
};

const EMPTY_ROLLUP: GoalRollup = {
  taskCount: 0,
  doneCount: 0,
  inProgressCount: 0,
  reviewCount: 0,
  remainingTasks: 0,
  completionPercent: 0,
};

type GoalTaskStatus = "backlog" | "to-do" | "in-progress" | "review" | "done" | "blocked" | "cancelled";

const GOAL_REFETCH_EVENT_TYPES = new Set([
  "goal.created",
  "goal.updated",
  "goal.contract_item_created",
  "goal.contract_item_updated",
  "goal.contract_item_archived",
  "goal.contract_evidence_recorded",
  "goal.sprint_plan_proposed",
  "goal.sprint_plan_approved",
  "goal.sprint_plan_rejected",
  "sprint.auto_completed",
]);

function toGoalTaskStatus(raw?: string): GoalTaskStatus | null {
  if (!raw) return null;
  if (raw === "in_progress") return "in-progress";
  if (
    raw === "backlog" ||
    raw === "to-do" ||
    raw === "in-progress" ||
    raw === "review" ||
    raw === "done" ||
    raw === "blocked" ||
    raw === "cancelled"
  ) {
    return raw;
  }
  return null;
}

function updateGoalCountForTaskStatus(sprint: OrchestrationSprint, status: GoalTaskStatus, delta: 1 | -1) {
  if (status === "in-progress") sprint.inProgressCount = Math.max(0, sprint.inProgressCount + delta);
  if (status === "review") sprint.reviewCount = Math.max(0, sprint.reviewCount + delta);
  if (status === "done") sprint.doneCount = Math.max(0, sprint.doneCount + delta);
}

function recalculateGoalProgress(goal: OrchestrationCompanyGoal, timestamp?: string): OrchestrationCompanyGoal {
  const sprint = {
    ...goal.sprint,
    ...(timestamp ? { updated: timestamp } : {}),
  };
  const taskCount = Math.max(0, sprint.taskCount);
  const doneCount = Math.max(0, sprint.doneCount);
  return {
    ...goal,
    sprint,
    remainingTasks: Math.max(taskCount - doneCount, 0),
    completionPercent: taskCount > 0 ? Math.round((doneCount / taskCount) * 100) : 0,
  };
}

function patchGoalForTaskEvent(goal: OrchestrationCompanyGoal, event: StreamEvent): OrchestrationCompanyGoal {
  const sprint = { ...goal.sprint };
  if (event.eventType === "task.created") {
    const status = toGoalTaskStatus(event.toStatus ?? event.taskStatus);
    sprint.taskCount += 1;
    if (status) updateGoalCountForTaskStatus(sprint, status, 1);
    return recalculateGoalProgress({ ...goal, sprint }, event.timestamp);
  }

  if (event.eventType === "task.status_changed") {
    const from = toGoalTaskStatus(event.fromStatus);
    const to = toGoalTaskStatus(event.toStatus ?? event.taskStatus);
    if (from) updateGoalCountForTaskStatus(sprint, from, -1);
    if (to) updateGoalCountForTaskStatus(sprint, to, 1);
    return recalculateGoalProgress({ ...goal, sprint }, event.timestamp);
  }

  if (event.eventType === "task.updated" || event.eventType === "task.reordered") {
    return recalculateGoalProgress({ ...goal, sprint }, event.timestamp);
  }

  return goal;
}

const fieldStyle: React.CSSProperties = {
  borderRadius: "10px",
  border: "0.5px solid var(--border-strong)",
  background: "transparent",
  padding: "8px 12px",
  fontSize: "13px",
  color: "var(--text-primary)",
  outline: "none",
  width: "100%",
};

const selectStyle: React.CSSProperties = {
  ...fieldStyle,
  color: "var(--text-secondary)",
  appearance: "none",
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2378716c' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 10px center",
  paddingRight: "28px",
};

function goalStatusLabel(status: OrchestrationSprint["status"]) {
  if (status === "done") return "done";
  if (status === "active") return "active";
  if (status === "blocked") return "blocked";
  if (status === "paused") return "paused";
  return "planned";
}

function sprintScopeLabel(goal: OrchestrationCompanyGoal): string {
  const slug = goal.projectSlug.toLowerCase();
  if (slug === "no-project" || slug.startsWith("no-project-") || goal.projectName.toLowerCase() === "no project") {
    return "Company-wide";
  }
  return goal.projectName;
}

function isCompanyWideGoal(goal: OrchestrationCompanyGoal): boolean {
  return sprintScopeLabel(goal) === "Company-wide";
}

function goalDisplayKey(goal: OrchestrationCompanyGoal): string | null | undefined {
  return determineGoalKind(goal) === "company" ? goal.sprint.goalKey : goal.sprint.sprintKey;
}

function goalKeySequenceValue(goal: OrchestrationCompanyGoal): number | null {
  const key = goalDisplayKey(goal);
  const match = key?.match(/-G(\d+)$/i);
  return match ? Number.parseInt(match[1] ?? "", 10) : null;
}

function findDefaultLeadAgentId(agents: OrchestrationAgent[]): string {
  const availableAgents = agents.filter((agent) => !agent.archivedAt);
  const ceo = availableAgents.find((agent) => {
    const haystack = `${agent.name} ${agent.role}`.toLowerCase();
    return haystack.includes("ceo") || haystack.includes("chief executive");
  });
  if (ceo) return ceo.id;
  const productLead = availableAgents.find((agent) => {
    const haystack = `${agent.name} ${agent.role}`.toLowerCase();
    return (
      haystack.includes("founder") ||
      haystack.includes("president") ||
      haystack.includes("product lead") ||
      haystack.includes("orchestrator")
    );
  });
  if (productLead) return productLead.id;
  const lead = availableAgents.find((agent) => {
    const haystack = `${agent.name} ${agent.role}`.toLowerCase();
    const qualityLead =
      haystack.includes("qa") ||
      haystack.includes("quality") ||
      haystack.includes("verification") ||
      haystack.includes("test");
    return haystack.includes("lead") && !qualityLead;
  });
  return lead?.id ?? "";
}

function todayDateInput() {
  return new Date().toISOString().slice(0, 10);
}

function isoToDateInput(value?: string | null) {
  return value ? value.slice(0, 10) : "";
}

function dateInputToIso(value: string): string | undefined {
  return value ? new Date(`${value}T00:00:00.000`).toISOString() : undefined;
}

function applyGoalPatch(goal: OrchestrationCompanyGoal, patch: GoalPatch): OrchestrationCompanyGoal {
  const sprint = { ...goal.sprint };
  if (patch.status !== undefined) sprint.status = patch.status;
  if (Object.prototype.hasOwnProperty.call(patch, "leadAgentId")) {
    sprint.leadAgentId = patch.leadAgentId ?? null;
  }
  if (patch.startDate !== undefined) sprint.startDate = patch.startDate;
  if (Object.prototype.hasOwnProperty.call(patch, "endDate")) {
    if (patch.endDate) sprint.endDate = patch.endDate;
    else delete sprint.endDate;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "owner")) {
    if (patch.owner) sprint.owner = patch.owner;
    else delete sprint.owner;
  }
  return { ...goal, sprint };
}

function sprintSequenceValue(goal: OrchestrationCompanyGoal): number | null {
  const match = goal.sprint.sprintKey?.match(/-S(\d+)$/i);
  return match ? Number.parseInt(match[1] ?? "", 10) : null;
}

function sprintPlanSequenceValue(goal: OrchestrationCompanyGoal): number | null {
  const match = goal.sprint.name.match(/^sprint\s+(\d+)\s+[—-]\s+/i);
  return match ? Number.parseInt(match[1] ?? "", 10) : null;
}

function compareSprintsBySequence(a: OrchestrationCompanyGoal, b: OrchestrationCompanyGoal): number {
  const aSeq = sprintSequenceValue(a);
  const bSeq = sprintSequenceValue(b);
  if (aSeq !== null && bSeq !== null && aSeq !== bSeq) return aSeq - bSeq;
  if (aSeq !== null && bSeq === null) return -1;
  if (aSeq === null && bSeq !== null) return 1;
  const aStart = new Date(a.sprint.startDate).getTime();
  const bStart = new Date(b.sprint.startDate).getTime();
  if (Number.isFinite(aStart) && Number.isFinite(bStart) && aStart !== bStart) return aStart - bStart;
  return a.sprint.created.localeCompare(b.sprint.created);
}

function sprintLeadOwner(goal: OrchestrationCompanyGoal, parent?: OrchestrationCompanyGoal): { value: string | null; inherited: boolean } {
  const own = goal.sprint.leadAgentId ?? goal.sprint.owner ?? null;
  if (own) return { value: own, inherited: false };
  const inherited = parent?.sprint.leadAgentId ?? parent?.sprint.owner ?? null;
  return { value: inherited, inherited: Boolean(inherited) };
}

function ProjectGlyph({
  project,
  color,
}: {
  project?: Pick<OrchestrationProject, "slug" | "name" | "color"> | Pick<OrchestrationCompanyGoal, "projectSlug" | "projectName" | "projectColor"> | null;
  color?: string;
}) {
  const fill = color
    ?? ("color" in (project ?? {}) ? (project as Pick<OrchestrationProject, "color">).color : undefined)
    ?? ("projectColor" in (project ?? {}) ? (project as Pick<OrchestrationCompanyGoal, "projectColor">).projectColor : undefined)
    ?? "#6366f1";
  return <span style={{ width: 9, height: 9, borderRadius: 2, background: fill, flexShrink: 0 }} />;
}

function goalHref(companyCode: string, goal: OrchestrationCompanyGoal) {
  return buildCanonicalGoalPath(companyCode, goalRouteKey(goal.sprint));
}

function goalRollup(goals: OrchestrationCompanyGoal[]): GoalRollup {
  const taskCount = goals.reduce((sum, goal) => sum + (goal.planTaskCount ?? goal.sprint.taskCount), 0);
  const doneCount = goals.reduce((sum, goal) => sum + (goal.planDoneTaskCount ?? goal.sprint.doneCount), 0);
  const inProgressCount = goals.reduce((sum, goal) => sum + goal.sprint.inProgressCount, 0);
  const reviewCount = goals.reduce((sum, goal) => sum + goal.sprint.reviewCount, 0);
  const remainingTasks = Math.max(taskCount - doneCount, 0);
  return {
    taskCount,
    doneCount,
    inProgressCount,
    reviewCount,
    remainingTasks,
    completionPercent: taskCount > 0 ? Math.round((doneCount / taskCount) * 100) : 0,
  };
}

function rowHoverHandlers<T extends HTMLElement>() {
  return {
    onMouseEnter: (e: React.MouseEvent<T>) => {
      e.currentTarget.style.background = "var(--surface-hover)";
    },
    onMouseLeave: (e: React.MouseEvent<T>) => {
      e.currentTarget.style.background = "transparent";
    },
  };
}

function defaultExpandedForCompanyGoal(goal: OrchestrationCompanyGoal, supportingSprints: OrchestrationCompanyGoal[]) {
  if (supportingSprints.length === 0) return false;
  if (goal.sprint.status === "active") return true;
  if (goal.sprint.status === "planned") {
    return supportingSprints.some((sprint) => sprint.sprint.status === "active");
  }
  return false;
}

function isStatusFilter(value: string | null): value is StatusFilter {
  return value === "active" || value === "planned" || value === "done";
}

function isProjectFilter(value: string | null): value is ProjectFilter {
  return Boolean(value && value.trim());
}

function ProjectFilterChip({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      }}
      style={{
        border: "none",
        borderRadius: "999px",
        background: selected ? "var(--surface-hover)" : "transparent",
        color: selected ? "var(--text-primary)" : "var(--text-muted)",
        cursor: "pointer",
        fontSize: "12px",
        padding: "3px 8px",
        transition: "background-color 120ms ease, color 120ms ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--surface-hover)";
        e.currentTarget.style.color = "var(--text-primary)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = selected ? "var(--surface-hover)" : "transparent";
        e.currentTarget.style.color = selected ? "var(--text-primary)" : "var(--text-muted)";
      }}
    >
      {label}
    </button>
  );
}

function GoalParentCombobox({
  goals,
  value,
  onChange,
}: {
  goals: OrchestrationCompanyGoal[];
  value: string;
  onChange: (value: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputId = "goal-parent-combobox";
  const listboxId = "goal-parent-combobox-list";
  const selectedGoal = goals.find((goal) => goal.sprint.id === value) ?? null;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const visibleGoals = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return goals;
    return goals.filter((goal) => goal.sprint.name.toLowerCase().includes(normalized));
  }, [goals, query]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  const safeHighlightedIndex = Math.min(highlightedIndex, Math.max(visibleGoals.length - 1, 0));

  const selectGoal = (goal: OrchestrationCompanyGoal) => {
    onChange(goal.sprint.id);
    setOpen(false);
    setQuery("");
    setHighlightedIndex(0);
  };

  const moveHighlight = (direction: 1 | -1) => {
    if (visibleGoals.length === 0) return;
    setHighlightedIndex((current) => (current + direction + visibleGoals.length) % visibleGoals.length);
  };

  return (
    <div ref={rootRef} style={{ position: "relative", flex: "1 1 240px", minWidth: 0 }}>
      <input
        id={inputId}
        role="combobox"
        aria-controls={listboxId}
        aria-expanded={open}
        aria-autocomplete="list"
        aria-activedescendant={open && visibleGoals[safeHighlightedIndex] ? `goal-parent-option-${visibleGoals[safeHighlightedIndex].sprint.id}` : undefined}
        value={open ? query : selectedGoal?.sprint.name ?? ""}
        placeholder="Pick a company goal"
        onFocus={() => {
          setOpen(true);
          setQuery("");
          setHighlightedIndex(0);
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setHighlightedIndex(0);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            moveHighlight(1);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            moveHighlight(-1);
          } else if (event.key === "Enter" && open) {
            event.preventDefault();
            const goal = visibleGoals[safeHighlightedIndex];
            if (goal) selectGoal(goal);
          } else if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
            setQuery("");
          }
        }}
        style={{ ...fieldStyle, color: selectedGoal || open ? "var(--text-primary)" : "var(--text-muted)" }}
      />
      {open ? (
        <div
          id={listboxId}
          role="listbox"
          aria-label="Company goals"
          style={{
            position: "absolute",
            zIndex: 70,
            top: "calc(100% + 6px)",
            left: 0,
            right: 0,
            maxHeight: 240,
            overflowY: "auto",
            padding: 6,
            borderRadius: "10px",
            border: "0.5px solid var(--border)",
            background: "var(--modal-glass)",
            boxShadow: "var(--shadow-glass)",
          }}
        >
          {visibleGoals.length === 0 ? (
            <div style={{ padding: "8px 10px", color: "var(--text-muted)", fontSize: "12px" }}>
              No matching company goals.
            </div>
          ) : visibleGoals.map((goal, index) => {
            const highlighted = index === safeHighlightedIndex;
            const selected = goal.sprint.id === value;
            return (
              <button
                key={goal.sprint.id}
                id={`goal-parent-option-${goal.sprint.id}`}
                type="button"
                role="option"
                aria-selected={selected}
                onMouseEnter={() => setHighlightedIndex(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  selectGoal(goal);
                }}
                style={{
                  width: "100%",
                  display: "grid",
                  gridTemplateColumns: "12px minmax(0, 1fr) auto",
                  alignItems: "center",
                  gap: "8px",
                  padding: "8px 10px",
                  border: "none",
                  borderRadius: "8px",
                  background: highlighted ? "var(--surface-hover)" : "transparent",
                  color: "var(--text-primary)",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <ProjectGlyph project={goal} />
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "12px", fontWeight: selected ? 600 : 500 }}>
                  {goal.sprint.name}
                </span>
                <span style={{ color: "var(--text-muted)", fontSize: "11px", whiteSpace: "nowrap" }}>
                  {sprintScopeLabel(goal)}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "block",
        width: "100%",
        height: 4,
        borderRadius: 999,
        background: "var(--surface-hover)",
        overflow: "hidden",
      }}
    >
      <span
        style={{
          display: "block",
          width: `${Math.max(0, Math.min(100, value))}%`,
          height: "100%",
          borderRadius: 999,
          background: "var(--text-primary)",
        }}
      />
    </span>
  );
}

function StatusPill({ status }: { status: OrchestrationSprint["status"] }) {
  const sc = STATUS_COLORS[status] ?? STATUS_COLORS.planned;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: 999, color: sc.color, background: sc.bg }}>
      {status === "done" ? <Check size={11} strokeWidth={2.4} /> : null}
      {goalStatusLabel(status)}
    </span>
  );
}

function EditableStatusPill({
  status,
  label,
  onChange,
}: {
  status: OrchestrationSprint["status"];
  label: string;
  onChange: (status: OrchestrationSprint["status"]) => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(() => Math.max(STATUS_OPTIONS.indexOf(status), 0));

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  useEffect(() => {
    setHighlightedIndex(Math.max(STATUS_OPTIONS.indexOf(status), 0));
  }, [status]);

  const selectStatus = (nextStatus: OrchestrationSprint["status"]) => {
    setOpen(false);
    if (nextStatus !== status) onChange(nextStatus);
  };

  const moveHighlight = (direction: 1 | -1) => {
    setHighlightedIndex((current) => (current + direction + STATUS_OPTIONS.length) % STATUS_OPTIONS.length);
  };

  return (
    <div
      ref={rootRef}
      style={{ position: "relative", display: "inline-flex", justifyContent: "flex-end" }}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        aria-label={`Change status for ${label}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen((current) => !current);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            moveHighlight(1);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            moveHighlight(-1);
          } else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen((current) => !current);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
        style={{
          border: "none",
          borderRadius: "999px",
          background: "transparent",
          padding: 0,
          color: "inherit",
          cursor: "pointer",
        }}
      >
        <StatusPill status={status} />
      </button>
      {open ? (
        <div
          role="listbox"
          aria-label={`Status options for ${label}`}
          style={{
            position: "absolute",
            zIndex: 60,
            top: "calc(100% + 6px)",
            right: 0,
            minWidth: 132,
            padding: 6,
            borderRadius: "10px",
            border: "0.5px solid var(--border)",
            background: "var(--modal-glass)",
            boxShadow: "var(--shadow-glass)",
          }}
        >
          {STATUS_OPTIONS.map((option, index) => {
            const highlighted = index === highlightedIndex;
            return (
              <button
                key={option}
                type="button"
                role="option"
                aria-selected={option === status}
                onMouseEnter={() => setHighlightedIndex(index)}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  selectStatus(option);
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    moveHighlight(1);
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    moveHighlight(-1);
                  } else if (event.key === "Enter") {
                    event.preventDefault();
                    selectStatus(STATUS_OPTIONS[highlightedIndex]);
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    setOpen(false);
                  }
                }}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "8px",
                  padding: "7px 8px",
                  border: "none",
                  borderRadius: "8px",
                  background: highlighted ? "var(--surface-hover)" : "transparent",
                  color: "var(--text-primary)",
                  cursor: "pointer",
                  fontSize: "12px",
                  textAlign: "left",
                }}
              >
                <span>{goalStatusLabel(option)}</span>
                {option === status ? <Check size={12} /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function ComposerLeadAgentPicker({
  agents,
  value,
  onChange,
}: {
  agents: OrchestrationAgent[];
  value: string;
  onChange: (agentId: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selectedAgent = agents.find((agent) => agent.id === value) ?? null;
  const filteredAgents = agents
    .filter((agent) => {
      const needle = query.trim().toLowerCase();
      if (!needle) return true;
      return `${agent.name} ${agent.role}`.toLowerCase().includes(needle);
    })
    .slice(0, 8);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  return (
    <div ref={rootRef} style={{ position: "relative", flex: "1 1 210px", minWidth: 0 }}>
      <label style={{ display: "block", marginBottom: "5px", fontSize: "11px", fontWeight: 600, color: "var(--text-secondary)" }}>
        Lead agent
      </label>
      <p style={{ margin: "-2px 0 6px", fontSize: "11px", color: "var(--text-muted)" }}>
        Who plans + monitors this goal
      </p>
      <button
        type="button"
        aria-label="Pick lead agent"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          setOpen((current) => !current);
          setQuery("");
        }}
        style={{
          ...selectStyle,
          width: "100%",
          backgroundImage: "none",
          paddingRight: "12px",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          textAlign: "left",
          cursor: "pointer",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          {selectedAgent ? <AgentAvatarInline agent={selectedAgent} size={20} /> : null}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {selectedAgent ? selectedAgent.name : "No lead"}
          </span>
        </span>
        <ChevronDown size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
      </button>
      {open ? (
        <div
          role="listbox"
          aria-label="Lead agent options"
          style={{
            position: "absolute",
            zIndex: 70,
            top: "calc(100% + 6px)",
            left: 0,
            right: 0,
            minWidth: 240,
            overflow: "hidden",
            padding: 6,
            borderRadius: "10px",
            border: "0.5px solid var(--border)",
            background: "var(--modal-glass)",
            boxShadow: "var(--shadow-glass)",
          }}
        >
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search agents"
            aria-label="Search lead agents"
            style={{ ...fieldStyle, width: "100%", marginBottom: "6px", padding: "7px 9px", fontSize: "12px" }}
          />
          <button
            type="button"
            role="option"
            aria-selected={!value}
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
            style={{
              width: "100%",
              padding: "8px 10px",
              border: "none",
              borderRadius: "8px",
              background: !value ? "var(--surface-hover)" : "transparent",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: "12px",
              textAlign: "left",
            }}
          >
            No lead
          </button>
          {filteredAgents.map((agent) => (
            <button
              key={agent.id}
              type="button"
              role="option"
              aria-selected={selectedAgent?.id === agent.id}
              onClick={() => {
                onChange(agent.id);
                setOpen(false);
              }}
              style={{
                width: "100%",
                display: "grid",
                gridTemplateColumns: "24px minmax(0, 1fr)",
                alignItems: "center",
                gap: "8px",
                padding: "8px 10px",
                border: "none",
                borderRadius: "8px",
                background: selectedAgent?.id === agent.id ? "var(--surface-hover)" : "transparent",
                color: "var(--text-primary)",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <AgentAvatarInline agent={agent} size={22} />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "12px", fontWeight: 600 }}>
                  {agent.name}
                </span>
                <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "11px", color: "var(--text-muted)" }}>
                  {agent.role}
                </span>
              </span>
            </button>
          ))}
          {filteredAgents.length === 0 ? (
            <p style={{ margin: "8px 10px", fontSize: "12px", color: "var(--text-muted)" }}>
              No matching agents.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SectionTitle({
  icon,
  title,
}: {
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0, marginBottom: "10px" }}>
      <span style={{ display: "grid", placeItems: "center", width: 24, height: 24, color: "var(--text-secondary)", flexShrink: 0 }}>
        {icon}
      </span>
      <div style={{ minWidth: 0 }}>
        <h2 style={{ margin: 0, fontSize: "15px", fontWeight: 600, color: "var(--text-primary)" }}>{title}</h2>
      </div>
    </div>
  );
}

function StatBlock({ value, label }: { value: string; label: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: "20px", lineHeight: 1.1, fontWeight: 650, color: "var(--text-primary)" }}>{value}</div>
      <div style={{ marginTop: 6, fontSize: "12px", color: "var(--text-muted)" }}>{label}</div>
    </div>
  );
}

function SprintGoalRow({
  goal,
  companyCode,
  parent,
  agents,
  onStatusChange,
  onOwnerChange,
  onDateChange,
}: {
  goal: OrchestrationCompanyGoal;
  companyCode: string;
  parent?: OrchestrationCompanyGoal;
  agents: OrchestrationAgent[];
  onStatusChange: (goal: OrchestrationCompanyGoal, status: OrchestrationSprint["status"]) => void;
  onOwnerChange: (goal: OrchestrationCompanyGoal, owner: string | null) => void;
  onDateChange: (goal: OrchestrationCompanyGoal, startDate: string, endDate: string | null) => void;
}) {
  const scope = sprintScopeLabel(goal);
  const leadOwner = sprintLeadOwner(goal, parent);
  const ownerSprint = { ...goal.sprint, owner: leadOwner.value };
  return (
    <div
      className="goals-sprint-row"
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(220px, 1fr) minmax(150px, 220px) 86px 104px 126px 76px",
        alignItems: "center",
        gap: "16px",
        padding: "12px 8px",
        borderTop: "0.5px solid var(--border)",
        borderRadius: "6px",
        background: "transparent",
        color: "inherit",
        transition: "background-color 120ms ease",
      }}
      {...rowHoverHandlers<HTMLDivElement>()}
    >
      <Link
        href={goalHref(companyCode, goal)}
        prefetch={false}
        className="goals-sprint-link"
        style={{
          display: "grid",
          gridColumn: "1 / 4",
          gridTemplateColumns: "minmax(220px, 1fr) minmax(150px, 220px) 86px",
          alignItems: "center",
          gap: "16px",
          minWidth: 0,
          color: "inherit",
          textDecoration: "none",
        }}
      >
      <div className="goals-row-name" style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
        <div style={{ minWidth: 0 }}>
          <div className="goals-row-title" style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {goalDisplayKey(goal) ? <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-muted)", marginRight: 8 }}>{goalDisplayKey(goal)}</span> : null}
            {goal.sprint.name}
          </div>
          <div className="goals-row-subtitle" style={{ marginTop: 3, fontSize: "11px", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {scope}{parent ? ` · Supports ${parent.sprint.name}` : goal.sprint.goal ? ` · ${goal.sprint.goal}` : ""}
          </div>
        </div>
      </div>
      <div className="goals-row-progress" style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6, color: "var(--text-secondary)", fontSize: "12px" }}>
          <span>{goal.completionPercent}%</span>
          <span>{goal.sprint.doneCount}/{goal.sprint.taskCount} tasks</span>
        </div>
        <ProgressBar value={goal.completionPercent} />
      </div>
      <div className="goals-row-open" style={{ color: "var(--text-muted)", fontSize: "12px", whiteSpace: "nowrap" }}>{goal.remainingTasks} open</div>
      </Link>
      <div className="goals-row-owner" style={{ display: "flex", justifyContent: "flex-end" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <OwnerChip sprint={ownerSprint} agents={agents} onChange={(owner) => onOwnerChange(goal, owner)} />
          {leadOwner.inherited ? <span style={{ fontSize: 10, color: "var(--text-muted)" }}>(inherited)</span> : null}
        </span>
      </div>
      <div className="goals-row-date" style={{ display: "flex", justifyContent: "flex-end" }}>
        <DateWindowChip sprint={goal.sprint} onChange={(startDate, endDate) => onDateChange(goal, startDate, endDate)} />
      </div>
      <div className="goals-row-status" style={{ display: "flex", justifyContent: "flex-end" }}>
        <EditableStatusPill
          status={goal.sprint.status}
          label={goal.sprint.name}
          onChange={(status) => onStatusChange(goal, status)}
        />
      </div>
    </div>
  );
}

function CompanyOutcomeRow({
  goal,
  rollup,
  supportCount,
  pendingDraftCount,
  pendingDraftSprintCount,
  pendingDraftTaskCount,
  companyCode,
  expanded,
  onToggle,
  agents,
  onStatusChange,
  onOwnerChange,
  onDateChange,
}: {
  goal: OrchestrationCompanyGoal;
  rollup: GoalRollup;
  supportCount: number;
  pendingDraftCount: number;
  pendingDraftSprintCount: number;
  pendingDraftTaskCount: number;
  companyCode: string;
  expanded: boolean;
  onToggle?: () => void;
  agents: OrchestrationAgent[];
  onStatusChange: (goal: OrchestrationCompanyGoal, status: OrchestrationSprint["status"]) => void;
  onOwnerChange: (goal: OrchestrationCompanyGoal, owner: string | null) => void;
  onDateChange: (goal: OrchestrationCompanyGoal, startDate: string, endDate: string | null) => void;
}) {
  const hasChildren = supportCount + pendingDraftCount > 0;
  const quietDone = goal.sprint.status === "done" && !expanded;
  const hasPlan = goal.planHasTasks ?? rollup.taskCount > 0;
  const sprintStepLabel = goal.planSprintCount && goal.planSprintCount > 0
    ? `Sprint ${Math.min((goal.planDoneSprintCount ?? 0) + 1, goal.planSprintCount)} of ${goal.planSprintCount}`
    : "Plan not yet proposed";
  const pendingDraftLabel = pendingDraftCount > 0
    ? `${pendingDraftCount} pending ${pendingDraftCount === 1 ? "draft" : "drafts"} containing ${pendingDraftSprintCount} ${pendingDraftSprintCount === 1 ? "sprint" : "sprints"}${pendingDraftTaskCount > 0 ? ` / ${pendingDraftTaskCount} ${pendingDraftTaskCount === 1 ? "task" : "tasks"}` : ""}`
    : "";
  const supportLabel = supportCount > 0
    ? `${pendingDraftLabel ? `${pendingDraftLabel} · ` : ""}${supportCount} supporting ${supportCount === 1 ? "sprint" : "sprints"}`
    : pendingDraftCount > 0
      ? pendingDraftLabel
      : goal.sprint.goal || "No sprints supporting this goal yet";
  const leadOwner = sprintLeadOwner(goal);
  const ownerSprint = { ...goal.sprint, owner: leadOwner.value };
  return (
    <div
      className="goals-row-shell"
      style={{
        display: "grid",
        gridTemplateColumns: "28px minmax(0, 1fr) 104px 126px 76px",
        alignItems: "center",
        gap: "16px",
        padding: "13px 8px",
        borderTop: "0.5px solid var(--border)",
        borderRadius: "6px",
        background: "transparent",
        color: "inherit",
        opacity: quietDone ? 0.7 : 1,
        transition: "background-color 120ms ease",
      }}
      {...rowHoverHandlers<HTMLDivElement>()}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        {hasChildren ? (
          <button
            type="button"
            aria-label={expanded ? `Collapse sprints for ${goal.sprint.name}` : `Expand sprints for ${goal.sprint.name}`}
            title={expanded ? "Collapse sprints" : "Expand sprints"}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onToggle?.();
            }}
            style={{
              display: "grid",
              placeItems: "center",
              width: 24,
              height: 24,
              border: "none",
              borderRadius: "6px",
              background: "transparent",
              color: "var(--text-muted)",
              cursor: "pointer",
              transition: "background-color 120ms ease, color 120ms ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--surface-hover)";
              e.currentTarget.style.color = "var(--text-primary)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "var(--text-muted)";
            }}
          >
            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        ) : null}
      </div>
      <Link
        href={goalHref(companyCode, goal)}
        prefetch={false}
        className="goals-row-link"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(240px, 1fr) minmax(160px, 240px) 90px",
          alignItems: "center",
          gap: "16px",
          minWidth: 0,
          color: "inherit",
          textDecoration: "none",
        }}
      >
      <div className="goals-row-name" style={{ minWidth: 0 }}>
        <div className="goals-row-title" style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {goalDisplayKey(goal) ? <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-muted)", marginRight: 8 }}>{goalDisplayKey(goal)}</span> : null}
          {goal.sprint.name}
        </div>
        <div className="goals-row-subtitle" style={{ marginTop: 3, fontSize: "11px", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {supportLabel}
        </div>
      </div>
      <div className="goals-row-progress" style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6, color: "var(--text-secondary)", fontSize: "12px" }}>
          <span>{hasPlan ? `${rollup.completionPercent}%` : "—"}</span>
          <span>{hasPlan ? `${sprintStepLabel} — ${rollup.doneCount}/${rollup.taskCount} tasks` : "Plan pending"}</span>
        </div>
        <ProgressBar value={rollup.completionPercent} />
      </div>
      <div className="goals-row-open" style={{ color: "var(--text-muted)", fontSize: "12px", whiteSpace: "nowrap" }}>{hasPlan ? `${rollup.remainingTasks} left` : "unplanned"}</div>
      </Link>
      <div className="goals-row-owner" style={{ display: "flex", justifyContent: "flex-end" }}>
        <OwnerChip sprint={ownerSprint} agents={agents} onChange={(owner) => onOwnerChange(goal, owner)} />
      </div>
      <div className="goals-row-date" style={{ display: "flex", justifyContent: "flex-end" }}>
        <DateWindowChip sprint={goal.sprint} onChange={(startDate, endDate) => onDateChange(goal, startDate, endDate)} />
      </div>
      <div className="goals-row-status" style={{ display: "flex", justifyContent: "flex-end" }}>
        <EditableStatusPill
          status={goal.sprint.status}
          label={goal.sprint.name}
          onChange={(status) => onStatusChange(goal, status)}
        />
      </div>
    </div>
  );
}

function PendingDraftRow({
  draft,
  agents,
  onReview,
  onApprove,
  onApprovePlan,
}: {
  draft: OrchestrationPendingSprintPlanDraftSummary;
  agents: OrchestrationAgent[];
  onReview: (draft: OrchestrationPendingSprintPlanDraftSummary) => void;
  onApprove: (draft: OrchestrationPendingSprintPlanDraftSummary) => void;
  onApprovePlan: (draft: OrchestrationPendingSprintPlanDraftSummary) => void;
}) {
  const proposedBy = agents.find((agent) => agent.id === draft.proposedByAgentId || agent.name === draft.proposedByAgentName);
  const isCompletionProposal = Boolean(draft.completionProposal);
  const sprintBreakdown = draft.sprints?.filter((sprint) => !Number.isNaN(sprint.sequenceNumber)) ?? [];
  return (
    <div
      className="goals-pending-draft-row"
      style={{
        margin: "6px 0 6px 0",
        border: "0.5px dashed color-mix(in srgb, var(--warning, #f59e0b) 55%, var(--border))",
        borderRadius: 8,
        background: "color-mix(in srgb, var(--warning, #f59e0b) 8%, transparent)",
        padding: "10px 12px",
        display: "grid",
        gridTemplateColumns: "minmax(260px, 1fr) minmax(130px, auto) minmax(110px, auto) auto",
        alignItems: "center",
        gap: 12,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              height: 20,
              padding: "0 8px",
              borderRadius: 999,
              background: "color-mix(in srgb, #f59e0b 16%, var(--surface))",
              color: "color-mix(in srgb, #f59e0b 70%, var(--text-primary))",
              border: "0.5px solid color-mix(in srgb, #f59e0b 32%, transparent)",
              fontSize: 11,
              fontWeight: 700,
              whiteSpace: "nowrap",
            }}
          >
            {isCompletionProposal ? "Completion review" : "Pending review"}
          </span>
          <span style={{ fontSize: 13, fontWeight: 650, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {isCompletionProposal ? "Goal completion proposed" : draft.sprintName}
          </span>
        </div>
        <div style={{ marginTop: 4, fontSize: 11, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {isCompletionProposal
            ? draft.completionReason ?? "Lead agent is requesting operator approval to mark this goal complete."
            : draft.sprintCount > 1
            ? `Plan with ${draft.sprintCount} sprints proposed (sprint ${draft.nextSequenceNumber} awaiting approval)`
            : `Proposed sprint plan for ${draft.companyGoalName}`}
        </div>
        {!isCompletionProposal && sprintBreakdown.length > 1 ? (
          <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: "5px 8px", color: "var(--text-secondary)", fontSize: 11 }}>
            {sprintBreakdown.map((sprint) => (
              <span
                key={sprint.id}
                title={sprint.sprintName}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "2px 6px",
                  borderRadius: 999,
                  border: "0.5px solid color-mix(in srgb, var(--warning, #f59e0b) 28%, var(--border))",
                  background: "color-mix(in srgb, var(--warning, #f59e0b) 5%, transparent)",
                  whiteSpace: "nowrap",
                }}
              >
                <span style={{ fontFamily: "var(--font-mono)", color: "color-mix(in srgb, #f59e0b 70%, var(--text-primary))" }}>S{sprint.sequenceNumber}</span>
                <span>{sprint.taskCount} {sprint.taskCount === 1 ? "task" : "tasks"}</span>
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 7, color: "var(--text-secondary)", fontSize: 12, minWidth: 0 }}>
        {proposedBy ? (
          <AgentAvatarInline agent={proposedBy} size={18} />
        ) : (
          <span style={{ width: 18, height: 18, borderRadius: "50%", background: "var(--surface-hover)", border: "0.5px solid var(--border)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700 }}>
            {(draft.proposedByAgentName ?? "A").slice(0, 1).toUpperCase()}
          </span>
        )}
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          Proposed by {draft.proposedByAgentName ?? "agent"}
        </span>
      </div>
      <div style={{ color: "var(--text-muted)", fontSize: 12, whiteSpace: "nowrap" }}>
        {isCompletionProposal
          ? "operator approval"
          : `${draft.taskCount} total ${draft.taskCount === 1 ? "task" : "tasks"} proposed`}
      </div>
      <div style={{ display: "inline-flex", justifyContent: "flex-end", gap: 6, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => onReview(draft)}
          style={{
            height: 28,
            padding: "0 10px",
            borderRadius: 7,
            border: "0.5px solid var(--border-strong)",
            background: "var(--surface-strong)",
            color: "var(--text-primary)",
            fontSize: 12,
            fontWeight: 650,
            cursor: "pointer",
          }}
        >
          Review
        </button>
        {!isCompletionProposal && draft.sprintCount > 1 ? (
          <button
            type="button"
            onClick={() => onApprovePlan(draft)}
            title={`Materialize all ${draft.sprintCount} sprints and create ${draft.taskCount} tasks now`}
            style={{
              height: 28,
              padding: "0 10px",
              borderRadius: 7,
              border: "0.5px solid var(--border)",
              background: "transparent",
              color: "var(--text-muted)",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Materialize all
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => onApprove(draft)}
          title="Approve the roadmap shape and create only the next sprint's tasks"
          style={{
            height: 28,
            padding: "0 9px",
            borderRadius: 7,
            border: "0.5px solid color-mix(in srgb, #22c55e 70%, var(--border))",
            background: "color-mix(in srgb, #22c55e 18%, var(--surface))",
            color: "color-mix(in srgb, #16a34a 84%, var(--text-primary))",
            fontSize: 12,
            fontWeight: 750,
            cursor: "pointer",
          }}
        >
          {isCompletionProposal ? "Approve" : `Approve roadmap + Sprint ${draft.nextSequenceNumber}`}
        </button>
      </div>
    </div>
  );
}

function SprintApprovalModal({
  prompt,
  onCancel,
  onConfirm,
}: {
  prompt: NonNullable<ApprovalPrompt>;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { draft } = prompt;
  const isBulk = prompt.kind === "all_sprints";
  const nextSprintTaskCount = draft.nextSprintTaskCount
    ?? draft.sprints?.find((sprint) => sprint.sequenceNumber === draft.nextSequenceNumber)?.taskCount
    ?? draft.sprints?.[0]?.taskCount
    ?? draft.taskCount;
  const laterDraftCount = Math.max(0, draft.sprintCount - 1);
  const title = isBulk ? "Materialize every sprint now?" : `Approve Sprint ${draft.nextSequenceNumber}?`;
  const primaryLabel = isBulk ? "Materialize all" : `Approve roadmap + Sprint ${draft.nextSequenceNumber}`;
  const primaryStyle = isBulk ? warningButtonStyle : modalPrimaryButtonStyle;

  return (
    <div
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
      style={modalBackdropStyle}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="sprint-approval-title"
        style={modalPanelStyle}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: "var(--text-muted)", fontSize: 11, fontWeight: 760, letterSpacing: "0.12em", textTransform: "uppercase" }}>
              Sprint approval
            </div>
            <h2 id="sprint-approval-title" style={{ margin: "6px 0 0", color: "var(--text-primary)", fontSize: 18, lineHeight: 1.2 }}>
              {title}
            </h2>
          </div>
          <button type="button" aria-label="Close approval dialog" onClick={onCancel} style={iconButtonStyle}>
            <X size={16} />
          </button>
        </div>

        <div style={{ border: "0.5px solid var(--border)", borderRadius: 10, padding: 12, background: "var(--surface-recessed)", display: "grid", gap: 8 }}>
          <div style={{ color: "var(--text-primary)", fontSize: 14, fontWeight: 720 }}>{draft.sprintName}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
            <DecisionMetric label={isBulk ? "Sprints" : "Approving"} value={isBulk ? String(draft.sprintCount) : `Sprint ${draft.nextSequenceNumber}`} />
            <DecisionMetric label={isBulk ? "Total tasks" : "Sprint tasks"} value={isBulk ? String(draft.taskCount) : String(nextSprintTaskCount)} />
            <DecisionMetric label="Later drafts" value={isBulk ? "Used now" : `${laterDraftCount} editable`} />
          </div>
        </div>

        <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: 13, lineHeight: 1.45 }}>
          {isBulk
            ? "This creates every sprint and every proposed task immediately. Use this only when you are sure the full plan should execute without later sprint-by-sprint revision."
            : `This approves the roadmap shape and creates only Sprint ${draft.nextSequenceNumber}'s ${nextSprintTaskCount} ${nextSprintTaskCount === 1 ? "task" : "tasks"}. Later sprint drafts remain visible and editable after this sprint teaches us what needs to change.`}
        </p>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" onClick={onCancel} style={modalSecondaryButtonStyle}>Not yet</button>
          <button type="button" onClick={onConfirm} style={primaryStyle}>{primaryLabel}</button>
        </div>
      </section>
    </div>
  );
}

function DecisionMetric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: "0.5px solid var(--border)", borderRadius: 8, padding: "8px 9px", background: "var(--surface)", minWidth: 0 }}>
      <div style={{ color: "var(--text-muted)", fontSize: 10, fontWeight: 720, letterSpacing: "0.08em", textTransform: "uppercase" }}>{label}</div>
      <div style={{ color: "var(--text-primary)", fontSize: 13, fontWeight: 740, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</div>
    </div>
  );
}

const modalBackdropStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 80,
  background: "rgba(0,0,0,0.48)",
  display: "grid",
  placeItems: "center",
  padding: 24,
};

const modalPanelStyle: React.CSSProperties = {
  width: "min(560px, calc(100vw - 40px))",
  borderRadius: 14,
  border: "1px solid var(--border)",
  background: "var(--modal-glass, var(--surface))",
  boxShadow: "0 24px 80px rgba(0,0,0,0.34)",
  padding: 18,
  display: "grid",
  gap: 14,
};

const iconButtonStyle: React.CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 8,
  border: "0.5px solid var(--border)",
  background: "transparent",
  color: "var(--text-secondary)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
};

const modalSecondaryButtonStyle: React.CSSProperties = {
  height: 34,
  padding: "0 13px",
  borderRadius: 8,
  border: "0.5px solid var(--border)",
  background: "transparent",
  color: "var(--text-secondary)",
  fontSize: 13,
  fontWeight: 650,
  cursor: "pointer",
};

const modalPrimaryButtonStyle: React.CSSProperties = {
  ...modalSecondaryButtonStyle,
  border: "0.5px solid color-mix(in srgb, #22c55e 70%, var(--border))",
  background: "color-mix(in srgb, #22c55e 18%, var(--surface))",
  color: "color-mix(in srgb, #16a34a 84%, var(--text-primary))",
  fontWeight: 760,
};

const warningButtonStyle: React.CSSProperties = {
  ...modalSecondaryButtonStyle,
  border: "0.5px solid color-mix(in srgb, #f59e0b 70%, var(--border))",
  background: "color-mix(in srgb, #f59e0b 15%, var(--surface))",
  color: "color-mix(in srgb, #b45309 88%, var(--text-primary))",
  fontWeight: 760,
};

function CompanyOutcomePanel({
  goal,
  supportingSprints,
  pendingDrafts,
  rollup,
  companyCode,
  expanded,
  onToggle,
  agents,
  onStatusChange,
  onOwnerChange,
  onDateChange,
  onReviewDraft,
  onApproveDraft,
  onApprovePlanDraft,
}: {
  goal: OrchestrationCompanyGoal;
  supportingSprints: OrchestrationCompanyGoal[];
  pendingDrafts: OrchestrationPendingSprintPlanDraftSummary[];
  rollup: GoalRollup;
  companyCode: string;
  expanded: boolean;
  onToggle: () => void;
  agents: OrchestrationAgent[];
  onStatusChange: (goal: OrchestrationCompanyGoal, status: OrchestrationSprint["status"]) => void;
  onOwnerChange: (goal: OrchestrationCompanyGoal, owner: string | null) => void;
  onDateChange: (goal: OrchestrationCompanyGoal, startDate: string, endDate: string | null) => void;
  onReviewDraft: (draft: OrchestrationPendingSprintPlanDraftSummary) => void;
  onApproveDraft: (draft: OrchestrationPendingSprintPlanDraftSummary) => void;
  onApprovePlanDraft: (draft: OrchestrationPendingSprintPlanDraftSummary) => void;
}) {
  const pendingSequences = new Set(
    pendingDrafts.flatMap((draft) => draft.sprints?.map((sprint) => sprint.sequenceNumber) ?? []),
  );
  const pendingDraftSprintCount = pendingDrafts.reduce((sum, draft) => sum + Math.max(1, draft.sprintCount), 0);
  const pendingDraftTaskCount = pendingDrafts.reduce((sum, draft) => sum + Math.max(0, draft.taskCount), 0);
  const visibleSupportingSprints = supportingSprints.filter((sprint) => {
    const sequence = sprintPlanSequenceValue(sprint);
    const isEmptyWrapper =
      sprint.sprint.taskCount === 0 &&
      sprint.sprint.doneCount === 0 &&
      sprint.sprint.inProgressCount === 0 &&
      sprint.sprint.reviewCount === 0;
    return !(sequence !== null && pendingSequences.has(sequence) && isEmptyWrapper);
  });
  const childCount = visibleSupportingSprints.length + pendingDrafts.length;
  return (
    <div style={{ padding: "4px 0 18px" }}>
      <CompanyOutcomeRow
        goal={goal}
        rollup={rollup}
        supportCount={visibleSupportingSprints.length}
        pendingDraftCount={pendingDrafts.length}
        pendingDraftSprintCount={pendingDraftSprintCount}
        pendingDraftTaskCount={pendingDraftTaskCount}
        companyCode={companyCode}
        expanded={expanded}
        onToggle={onToggle}
        agents={agents}
        onStatusChange={onStatusChange}
        onOwnerChange={onOwnerChange}
        onDateChange={onDateChange}
      />
      {expanded && childCount > 0 ? (
        <div className="goals-children" style={{ paddingLeft: 28 }}>
          {pendingDrafts.map((draft) => (
            <PendingDraftRow
              key={draft.id}
              draft={draft}
              agents={agents}
              onReview={onReviewDraft}
              onApprove={onApproveDraft}
              onApprovePlan={onApprovePlanDraft}
            />
          ))}
          {visibleSupportingSprints.map((sprint) => (
            <SprintGoalRow
              key={sprint.sprint.id}
              goal={sprint}
              companyCode={companyCode}
              parent={goal}
              agents={agents}
              onStatusChange={onStatusChange}
              onOwnerChange={onOwnerChange}
              onDateChange={onDateChange}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function CompanyGoalsPage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const slug = params?.slug ?? "";
  const statusParam = searchParams.get("status");
  const statusFilter: StatusFilter | null = isStatusFilter(statusParam) ? statusParam : null;
  const projectParam = searchParams.get("project");
  const projectFilter: ProjectFilter | null = isProjectFilter(projectParam) ? projectParam : null;

  const [company, setCompany] = useState<OrchestrationCompany | null>(null);
  const [projects, setProjects] = useState<OrchestrationProject[]>([]);
  const [agents, setAgents] = useState<OrchestrationAgent[]>([]);
  const [goals, setGoals] = useState<OrchestrationCompanyGoal[]>([]);
  const [pendingDrafts, setPendingDrafts] = useState<OrchestrationPendingSprintPlanDraftSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const [composerOpen, setComposerOpen] = useState(false);
  const [goalKind, setGoalKind] = useState<GoalKind>("company");
  const [createName, setCreateName] = useState("");
  const [createGoal, setCreateGoal] = useState("");
  const [createProjectId, setCreateProjectId] = useState(COMPANY_WIDE_PROJECT_ID);
  const [createParentId, setCreateParentId] = useState(NO_COMPANY_GOAL_ID);
  const [createStatus, setCreateStatus] = useState<OrchestrationSprint["status"]>("planned");
  const [createLeadAgentId, setCreateLeadAgentId] = useState("");
  const [createDefaultExecutionEngine, setCreateDefaultExecutionEngine] = useState<ComposerExecutionEngine>("");
  const [createDefaultModelLane, setCreateDefaultModelLane] = useState<ComposerModelLane>("");
  const [createNameFocused, setCreateNameFocused] = useState(false);
  const [createStartDate, setCreateStartDate] = useState(() => todayDateInput());
  const [createEndDate, setCreateEndDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [collapsePrefs, setCollapsePrefs] = useState<Record<string, CollapsePreference>>({});
  const [statusMessage, setStatusMessage] = useState("");
  const [approvalPrompt, setApprovalPrompt] = useState<ApprovalPrompt>(null);
  const goalsRefetchTimerRef = useRef<number | null>(null);
  const goalsRequestSeqRef = useRef(0);
  const lastGoalsRefreshAtRef = useRef(new Date().toISOString());
  const goalsSnapshotRef = useRef<OrchestrationCompanyGoal[]>([]);

  const refreshGoals = useCallback(async () => {
    const requestSeq = goalsRequestSeqRef.current + 1;
    goalsRequestSeqRef.current = requestSeq;
    const [payload, draftRows] = await Promise.all([
      listCompanyGoals({ companySlug: slug }),
      listPendingSprintPlanDrafts({ companySlug: slug }),
    ]);
    if (goalsRequestSeqRef.current !== requestSeq) return;
    setGoals(payload?.goals ?? []);
    setPendingDrafts(draftRows);
    lastGoalsRefreshAtRef.current = new Date().toISOString();
  }, [slug]);

  const scheduleGoalsRefresh = useCallback((delayMs = 300) => {
    if (goalsRefetchTimerRef.current !== null) window.clearTimeout(goalsRefetchTimerRef.current);
    goalsRefetchTimerRef.current = window.setTimeout(() => {
      goalsRefetchTimerRef.current = null;
      void refreshGoals().catch(() => {
        // The next SSE event or manual interaction will retry.
      });
    }, delayMs);
  }, [refreshGoals]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [companyRows, projectRows, goalPayload, agentRows, draftRows] = await Promise.all([
        listCompanies(),
        listProjects({ company: slug }),
        listCompanyGoals({ companySlug: slug }),
        listCompanyAgents(slug),
        listPendingSprintPlanDrafts({ companySlug: slug }),
      ]);
      if (cancelled) return;

      const slugKey = slug.toLowerCase();
      const current = companyRows.find(
        (r) => r.slug.toLowerCase() === slugKey || r.code.toLowerCase() === slugKey
      ) ?? null;
      setCompany(current);
      setProjects(projectRows);
      setGoals(goalPayload?.goals ?? []);
      setPendingDrafts(draftRows);
      setAgents(agentRows);
      setCreateProjectId((cur) => cur || COMPANY_WIDE_PROJECT_ID);
      lastGoalsRefreshAtRef.current = new Date().toISOString();
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [slug]);

  useEffect(() => () => {
    if (goalsRefetchTimerRef.current !== null) window.clearTimeout(goalsRefetchTimerRef.current);
  }, []);

  useEffect(() => {
    goalsSnapshotRef.current = goals;
  }, [goals]);

  useEffect(() => {
    if (!composerOpen || agents.length === 0 || createLeadAgentId !== "") return;
    const timer = window.setTimeout(() => {
      setCreateLeadAgentId(findDefaultLeadAgentId(agents));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [composerOpen, agents, createLeadAgentId]);

  const companyGoals = useMemo(
    () => goals.filter((goal) => determineGoalKind(goal) === "company"),
    [goals]
  );

  const sprintGoals = useMemo(
    () => goals.filter((goal) => determineGoalKind(goal) === "sprint"),
    [goals]
  );

  const companyGoalRollup = useMemo(
    () => goalRollup(companyGoals),
    [companyGoals]
  );

  const sprintsByCompanyGoalId = useMemo(() => {
    const groups = new Map<string, OrchestrationCompanyGoal[]>();
    for (const goal of sprintGoals) {
      const parentId = goal.sprint.parentId;
      if (!parentId) continue;
      const current = groups.get(parentId) ?? [];
      current.push(goal);
      groups.set(parentId, current);
    }

    for (const [parentId, children] of groups.entries()) {
      groups.set(parentId, children.toSorted(compareSprintsBySequence));
    }

    return groups;
  }, [sprintGoals]);

  const pendingDraftsByCompanyGoalId = useMemo(() => {
    const groups = new Map<string, OrchestrationPendingSprintPlanDraftSummary[]>();
    for (const draft of pendingDrafts) {
      const current = groups.get(draft.companyGoalId) ?? [];
      current.push(draft);
      groups.set(draft.companyGoalId, current);
    }
    for (const [goalId, drafts] of groups.entries()) {
      groups.set(goalId, drafts.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt)));
    }
    return groups;
  }, [pendingDrafts]);

  const companyGoalIdSet = useMemo(
    () => new Set(companyGoals.map((goal) => goal.sprint.id)),
    [companyGoals]
  );

  const orphanedSprints = useMemo(
    () => sprintGoals
      .filter((goal) => goal.sprint.parentId && !companyGoalIdSet.has(goal.sprint.parentId))
      .toSorted((a, b) => b.sprint.updated.localeCompare(a.sprint.updated)),
    [companyGoalIdSet, sprintGoals]
  );

  const sortedCompanyGoals = useMemo(
    () => companyGoals.toSorted((a, b) => {
      const aGoalSeq = goalKeySequenceValue(a);
      const bGoalSeq = goalKeySequenceValue(b);
      if (aGoalSeq !== null && bGoalSeq !== null && aGoalSeq !== bGoalSeq) return bGoalSeq - aGoalSeq;
      if (aGoalSeq !== null && bGoalSeq === null) return -1;
      if (aGoalSeq === null && bGoalSeq !== null) return 1;
      const aChildren = sprintsByCompanyGoalId.get(a.sprint.id)?.length ?? 0;
      const bChildren = sprintsByCompanyGoalId.get(b.sprint.id)?.length ?? 0;
      const statusWeight = (status: OrchestrationSprint["status"]) => status === "active" ? 0 : status === "planned" ? 1 : 2;
      return statusWeight(a.sprint.status) - statusWeight(b.sprint.status)
        || bChildren - aChildren
        || b.sprint.updated.localeCompare(a.sprint.updated);
    }),
    [companyGoals, sprintsByCompanyGoalId]
  );

  const projectFilterOptions = useMemo(() => {
    const projectSlugs = new Set<string>();
    for (const goal of goals) {
      if (!isCompanyWideGoal(goal)) projectSlugs.add(goal.projectSlug);
    }
    return projects
      .filter((project) => projectSlugs.has(project.slug))
      .toSorted((a, b) => a.name.localeCompare(b.name));
  }, [goals, projects]);

  const hasCompanyWideGoals = useMemo(
    () => goals.some((goal) => isCompanyWideGoal(goal)),
    [goals]
  );

  const filteredCompanyGoals = useMemo(
    () => sortedCompanyGoals.filter((goal) => {
      if (statusFilter && goal.sprint.status !== statusFilter) return false;
      if (!projectFilter) return true;
      const supportingSprints = sprintsByCompanyGoalId.get(goal.sprint.id) ?? [];
      const goalPendingDrafts = pendingDraftsByCompanyGoalId.get(goal.sprint.id) ?? [];
      if (projectFilter === "company-wide") {
        return isCompanyWideGoal(goal) || supportingSprints.some((sprint) => isCompanyWideGoal(sprint)) || goalPendingDrafts.length > 0;
      }
      return goal.projectSlug === projectFilter || supportingSprints.some((sprint) => sprint.projectSlug === projectFilter);
    }),
    [sortedCompanyGoals, statusFilter, projectFilter, sprintsByCompanyGoalId, pendingDraftsByCompanyGoalId]
  );

  const filteredOrphanedSprints = useMemo(
    () => orphanedSprints.filter((goal) => {
      if (statusFilter && goal.sprint.status !== statusFilter) return false;
      if (!projectFilter) return true;
      if (projectFilter === "company-wide") return isCompanyWideGoal(goal);
      return goal.projectSlug === projectFilter;
    }),
    [orphanedSprints, statusFilter, projectFilter]
  );

  const companyOutcomeRollups = useMemo(() => {
    const result = new Map<string, { supportCount: number; rollup: GoalRollup }>();
    for (const companyGoal of companyGoals) {
      const supportingSprints = sprintsByCompanyGoalId.get(companyGoal.sprint.id) ?? [];
      result.set(companyGoal.sprint.id, {
        supportCount: supportingSprints.length,
        rollup: goalRollup([companyGoal]),
      });
    }
    return result;
  }, [companyGoals, sprintsByCompanyGoalId]);

  const selectedProject = createProjectId === COMPANY_WIDE_PROJECT_ID
    ? null
    : projects.find((project) => project.id === createProjectId) ?? null;
  const canCreate = createName.trim().length >= 2
    && (goalKind === "company" || createParentId !== NO_COMPANY_GOAL_ID);
  const createDisabledReason = createName.trim().length < 2
    ? "Add a name to continue."
    : goalKind === "sprint" && createParentId === NO_COMPANY_GOAL_ID
      ? "Pick a parent company goal."
      : "";

  const companyCode = company?.code ?? slug;
  const activeCompanySlug = company?.slug ?? slug;

  const handleLiveEvent = useCallback((event: StreamEvent) => {
    if (event.type === "connected") return;
    if (event.type !== "activity") return;

    if (event.eventType && GOAL_REFETCH_EVENT_TYPES.has(event.eventType)) {
      scheduleGoalsRefresh();
      return;
    }

    if (event.timestamp && event.timestamp <= lastGoalsRefreshAtRef.current) return;

    if (event.eventType === "task.archived") {
      scheduleGoalsRefresh();
      return;
    }

    if (
      event.eventType !== "task.created" &&
      event.eventType !== "task.status_changed" &&
      event.eventType !== "task.updated" &&
      event.eventType !== "task.reordered"
    ) {
      return;
    }

    const sprintId = event.sprintId ?? (typeof event.metadata?.sprintId === "string" ? event.metadata.sprintId : undefined);
    if (!sprintId) {
      scheduleGoalsRefresh();
      return;
    }

    if (
      event.eventType === "task.updated" &&
      (event.metadata?.sprintChanged || event.metadata?.projectChanged || event.metadata?.parentTaskChanged)
    ) {
      scheduleGoalsRefresh();
      return;
    }

    const matched = goalsSnapshotRef.current.some((item) => item.sprint.id === sprintId);
    if (!matched) {
      scheduleGoalsRefresh();
      return;
    }
    setGoals((current) => current.map((item) => {
      if (item.sprint.id !== sprintId) return item;
      return patchGoalForTaskEvent(item, event);
    }));
  }, [scheduleGoalsRefresh]);

  useEventStream({
    companySlug: activeCompanySlug,
    enabled: Boolean(activeCompanySlug),
    onEvent: handleLiveEvent,
  });

  const resetComposer = () => {
    setCreateName("");
    setCreateGoal("");
    setCreateStatus("planned");
    setCreateLeadAgentId("");
    setCreateDefaultExecutionEngine("");
    setCreateDefaultModelLane("");
    setCreateNameFocused(false);
    setCreateStartDate(todayDateInput());
    setCreateEndDate("");
    setCreateParentId(NO_COMPANY_GOAL_ID);
    setCreateProjectId(COMPANY_WIDE_PROJECT_ID);
    setGoalKind("company");
  };

  const openComposer = (kind: GoalKind = "company") => {
    const nextKind = kind === "sprint" && companyGoals.length === 0 ? "company" : kind;
    setGoalKind(nextKind);
    setCreateParentId(NO_COMPANY_GOAL_ID);
    setCreateProjectId(COMPANY_WIDE_PROJECT_ID);
    setCreateLeadAgentId(findDefaultLeadAgentId(agents));
    setComposerOpen(true);
  };

  const handleCreateGoal = async () => {
    if (!canCreate) return;
    setSubmitting(true);
    const parentId = goalKind === "sprint" && createParentId !== NO_COMPANY_GOAL_ID ? createParentId : undefined;
    const projectId = createProjectId !== COMPANY_WIDE_PROJECT_ID ? createProjectId : undefined;
    const startDate = dateInputToIso(createStartDate) ?? new Date().toISOString();
    const endDate = createEndDate ? dateInputToIso(createEndDate) ?? null : undefined;
    const created = await createCompanyGoal({
      companySlug: slug,
      ...(projectId ? { projectId } : {}),
      name: createName.trim(),
      goal: createGoal.trim(),
      goalKind,
      status: createStatus,
      startDate,
      ...(endDate !== undefined ? { endDate } : {}),
      ...(parentId ? { parentId } : {}),
      ...(createLeadAgentId ? { leadAgentId: createLeadAgentId } : {}),
      ...(createDefaultExecutionEngine ? { defaultExecutionEngine: createDefaultExecutionEngine } : {}),
      ...(createDefaultModelLane ? { defaultModelLane: createDefaultModelLane } : {}),
    });
    if (created) {
      setGoals((prev) => [created, ...prev]);
      setComposerOpen(false);
      resetComposer();
    }
    setSubmitting(false);
  };

  const setProjectFilter = (nextProject: ProjectFilter | null) => {
    const params = new URLSearchParams(searchParams.toString());
    const selectedProject = nextProject && projectFilter !== nextProject ? nextProject : null;
    if (selectedProject) {
      params.set("project", selectedProject);
    } else {
      params.delete("project");
    }
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const handleGoalPatch = async (goal: OrchestrationCompanyGoal, patch: GoalPatch, failureMessage: string) => {
    const previous = goal;
    setStatusMessage("");
    setGoals((prev) => prev.map((item) => item.sprint.id === goal.sprint.id
      ? applyGoalPatch(item, patch)
      : item
    ));

    try {
      const updated = await updateCompanyGoal({
        companySlug: slug,
        sprintId: goal.sprint.id,
        ...patch,
      });
      if (updated) {
        setGoals((prev) => prev.map((item) => item.sprint.id === goal.sprint.id ? updated : item));
      }
    } catch {
      setGoals((prev) => prev.map((item) => item.sprint.id === goal.sprint.id ? previous : item));
      setStatusMessage(failureMessage);
    }
  };

  const handleStatusChange = async (
    goal: OrchestrationCompanyGoal,
    nextStatus: OrchestrationSprint["status"]
  ) => {
    if (goal.sprint.status === nextStatus) return;
    await handleGoalPatch(goal, { status: nextStatus }, `Could not update ${goal.sprint.name}. Status was restored.`);
  };

  const handleOwnerChange = async (goal: OrchestrationCompanyGoal, owner: string | null) => {
    const nextLeadAgentId = owner ? agents.find((agent) => agent.id === owner || agent.name === owner || agent.slug === owner)?.id ?? owner : null;
    if ((goal.sprint.leadAgentId ?? null) === nextLeadAgentId) return;
    await handleGoalPatch(goal, { leadAgentId: nextLeadAgentId }, `Could not update ${goal.sprint.name}. Lead was restored.`);
  };

  const handleDateChange = async (goal: OrchestrationCompanyGoal, startDate: string, endDate: string | null) => {
    await handleGoalPatch(goal, { startDate, endDate }, `Could not update ${goal.sprint.name}. Date window was restored.`);
  };

  const handleReviewDraft = useCallback((draft: OrchestrationPendingSprintPlanDraftSummary) => {
    const draftGoal = goals.find((goal) => goal.sprint.id === draft.companyGoalId);
    router.push(draftGoal ? goalHref(companyCode, draftGoal) : buildCanonicalGoalPath(companyCode, draft.companyGoalId));
  }, [companyCode, goals, router]);

  const handleApproveDraft = useCallback(async (draft: OrchestrationPendingSprintPlanDraftSummary) => {
    setApprovalPrompt(null);
    const result = await reviewSprintPlanDraft({
      companySlug: slug,
      companyGoalId: draft.companyGoalId,
      draftId: draft.id,
      action: "approve",
    });
    if (result) {
      setPendingDrafts((current) => current.filter((item) => item.id !== draft.id));
      if (result.sprint) {
        setGoals((current) => [result.sprint!, ...current.filter((item) => item.sprint.id !== result.sprint!.sprint.id)]);
      }
      window.dispatchEvent(new CustomEvent("goals-pending-drafts-change", { detail: { companySlug: slug } }));
      scheduleGoalsRefresh(250);
    }
  }, [scheduleGoalsRefresh, slug]);

  const handleApprovePlanDraft = useCallback(async (draft: OrchestrationPendingSprintPlanDraftSummary) => {
    setApprovalPrompt(null);
    const result = await reviewSprintPlanDraft({
      companySlug: slug,
      companyGoalId: draft.companyGoalId,
      draftId: draft.id,
      action: "approve_all",
    });
    if (result) {
      setPendingDrafts((current) => current.filter((item) => item.companyGoalId !== draft.companyGoalId || item.proposalGroupId !== draft.proposalGroupId));
      if (result.sprints?.length) {
        setGoals((current) => [
          ...result.sprints!,
          ...current.filter((item) => !result.sprints!.some((created) => created.sprint.id === item.sprint.id)),
        ]);
      }
      window.dispatchEvent(new CustomEvent("goals-pending-drafts-change", { detail: { companySlug: slug } }));
      scheduleGoalsRefresh(250);
    }
  }, [scheduleGoalsRefresh, slug]);

  const requestApproveDraft = useCallback((draft: OrchestrationPendingSprintPlanDraftSummary) => {
    setApprovalPrompt({ kind: "next_sprint", draft });
  }, []);

  const requestApprovePlanDraft = useCallback((draft: OrchestrationPendingSprintPlanDraftSummary) => {
    setApprovalPrompt({ kind: "all_sprints", draft });
  }, []);

  const toggleCompanyGoalCollapse = (goal: OrchestrationCompanyGoal, supportingSprints: OrchestrationCompanyGoal[]) => {
    const stored = window.localStorage.getItem(`hr:goals:collapse:${companyCode}:${goal.sprint.id}`);
    const current = collapsePrefs[goal.sprint.id] ?? (stored === "expanded" || stored === "collapsed" ? stored : undefined);
    const expanded = current
      ? current === "expanded"
      : defaultExpandedForCompanyGoal(goal, supportingSprints);
    const next: CollapsePreference = expanded ? "collapsed" : "expanded";
    window.localStorage.setItem(`hr:goals:collapse:${companyCode}:${goal.sprint.id}`, next);
    setCollapsePrefs((prev) => ({ ...prev, [goal.sprint.id]: next }));
  };

  if (loading) {
    return (
      <div style={{ padding: "24px 32px" }}>
        <div style={{ height: 180, borderRadius: 8, background: tokens.surface, border: `0.5px solid ${tokens.cardBorder}`, animation: "pulse 1.5s infinite" }} />
      </div>
    );
  }

  if (!company) {
    return (
      <div style={{ padding: "24px 32px" }}>
        <div style={{ padding: 16, borderRadius: 8, background: "rgba(239,68,68,0.1)", border: "0.5px solid rgba(239,68,68,0.3)", color: "#fca5a5", fontSize: 13 }}>
          Company not found.
        </div>
      </div>
    );
  }

  return (
    <div className="goals-page-shell" style={{ padding: "24px 32px", color: "var(--text-primary)", fontSize: "13px" }}>
      <div style={{ marginBottom: "20px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: "22px", fontWeight: 650, letterSpacing: "-0.01em", color: "var(--text-primary)" }}>
              Goals
            </h1>
            <p style={{ fontSize: "13px", color: "var(--text-secondary)", margin: "4px 0 0" }}>
              Goals are where the company wants to go. Sprints are how we get there.
            </p>
            <div role="status" aria-live="polite" style={{ minHeight: statusMessage ? 18 : 0, marginTop: statusMessage ? 6 : 0, color: "var(--negative)", fontSize: "12px" }}>
              {statusMessage}
            </div>
          </div>
          <button
            type="button"
            onClick={() => openComposer("company")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              padding: "8px 16px",
              borderRadius: "8px",
              border: "0.5px solid var(--border-strong)",
              background: "transparent",
              color: "var(--text-secondary)",
              fontSize: "13px",
              fontWeight: 500,
              cursor: "pointer",
              whiteSpace: "nowrap",
              flexShrink: 0,
              transition: "all 120ms ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "rgba(168,162,158,0.5)";
              e.currentTarget.style.background = "var(--surface-hover)";
              e.currentTarget.style.color = "var(--text-primary)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "var(--border-strong)";
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "var(--text-secondary)";
            }}
          >
            <Plus size={14} strokeWidth={2.2} />
            Add
          </button>
        </div>
      </div>

      {composerOpen ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 50,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--modal-backdrop)",
            backdropFilter: "blur(4px)",
          }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !submitting) {
              setComposerOpen(false);
              resetComposer();
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Create goal"
            className="goals-modal"
            style={{
              width: "100%",
              maxWidth: "900px",
              maxHeight: "calc(100dvh - 2rem)",
              display: "flex",
              flexDirection: "column",
              borderRadius: "16px",
              border: "1px solid var(--border)",
              background: "var(--modal-glass)",
              boxShadow: "var(--shadow-glass)",
              overflow: "hidden",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", borderBottom: "0.5px solid var(--border)", flexShrink: 0 }}>
              <div>
                <p style={{ margin: 0, fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.2em", color: "var(--text-muted)" }}>New goal</p>
                <p style={{ margin: "2px 0 0", fontSize: "12px", color: "var(--text-secondary)" }}>
                  Choose whether this is the outcome or the sprint that advances it.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close create goal"
                title="Close create goal"
                onClick={() => { setComposerOpen(false); resetComposer(); }}
                disabled={submitting}
                style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: "4px" }}
              >
                <X size={16} />
              </button>
            </div>

            <div style={{ flex: 1, overflow: "auto", padding: "18px 20px 16px", display: "grid", gap: "16px" }}>
              <div className="goals-composer-kind-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "10px" }}>
                {([
                  ["company", Target, "Company goal", "An outcome we want to reach. Sprints support it."],
                  ["sprint", Flag, "Sprint", "A chunk of work that advances a company goal. Tasks roll up here."],
                ] as const).map(([kind, Icon, label, detail]) => {
                  const active = goalKind === kind;
                  const disabled = kind === "sprint" && companyGoals.length === 0;
                  return (
                    <button
                      key={kind}
                      type="button"
                      disabled={disabled}
                      title={disabled ? "Create a company goal first." : undefined}
                      onClick={() => {
                        if (disabled) return;
                        setGoalKind(kind);
                        setCreateParentId(kind === "sprint" ? createParentId || NO_COMPANY_GOAL_ID : NO_COMPANY_GOAL_ID);
                      }}
                      style={{
                        display: "flex",
                        gap: "10px",
                        alignItems: "flex-start",
                        textAlign: "left",
                        padding: "12px",
                        borderRadius: "10px",
                        border: active ? "0.5px solid var(--border-strong)" : "0.5px solid var(--border)",
                        background: active ? "var(--surface-hover)" : "transparent",
                        color: "var(--text-primary)",
                        cursor: disabled ? "not-allowed" : "pointer",
                        opacity: disabled ? 0.48 : 1,
                      }}
                    >
                      <Icon size={16} color="var(--text-secondary)" style={{ flexShrink: 0, marginTop: 1 }} />
                      <span>
                        <span style={{ display: "block", fontSize: "13px", fontWeight: 600 }}>{label}</span>
                        <span style={{ display: "block", marginTop: 3, fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.4 }}>{detail}</span>
                      </span>
                    </button>
                  );
                })}
              </div>

              <div>
                <label htmlFor="goal-create-name" style={{ display: "block", marginBottom: "5px", fontSize: "11px", fontWeight: 600, color: "var(--text-secondary)" }}>
                  Name
                </label>
                <input
                  id="goal-create-name"
                  autoFocus
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  onFocus={() => setCreateNameFocused(true)}
                  onBlur={() => setCreateNameFocused(false)}
                  placeholder={goalKind === "company" ? "e.g. Make customer intake production-ready" : "e.g. Customer intake execution sprint"}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleCreateGoal();
                    if (e.key === "Escape") {
                      setComposerOpen(false);
                      resetComposer();
                    }
                  }}
                  style={{
                    ...fieldStyle,
                    fontSize: "17px",
                    fontWeight: 600,
                    border: "none",
                    borderBottom: `1px solid ${createNameFocused ? "var(--text-primary)" : "var(--border-strong)"}`,
                    borderRadius: 0,
                    padding: "6px 0 8px",
                  }}
                />
                {goalKind === "company" ? (
                  <p style={{ margin: "6px 0 0", fontSize: "12px", color: "var(--text-muted)" }}>
                    Company goals work best at quarter-size — about 5 to 15 sprints. Bigger goals are often two goals.
                  </p>
                ) : null}
              </div>

              <textarea
                value={createGoal}
                onChange={(e) => setCreateGoal(e.target.value)}
                placeholder="Goal statement"
                rows={4}
                style={{ ...fieldStyle, minHeight: 120, resize: "vertical", lineHeight: 1.55 }}
              />

              <div
                className="goals-composer-fields-grid"
                style={{
                  display: "grid",
                  gridTemplateColumns: goalKind === "sprint"
                    ? "minmax(0, 1fr) minmax(0, 1fr) minmax(220px, 0.9fr)"
                    : "minmax(0, 1fr) minmax(220px, 0.8fr) minmax(220px, 0.8fr)",
                  gap: "12px",
                  alignItems: "end",
                }}
              >
                <label style={{ display: "grid", gap: "5px", minWidth: 0 }}>
                  <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-secondary)" }}>Project</span>
                  <span style={{ position: "relative", minWidth: 0 }}>
                    <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", display: "grid", placeItems: "center", color: "var(--text-secondary)", pointerEvents: "none" }}>
                      {selectedProject ? <ProjectGlyph project={selectedProject} /> : <Layers3 size={14} />}
                    </span>
                    <select value={createProjectId} onChange={(e) => setCreateProjectId(e.target.value)} style={{ ...selectStyle, width: "100%", paddingLeft: "34px" }}>
                      <option value={COMPANY_WIDE_PROJECT_ID}>Company-wide</option>
                      {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </span>
                </label>
                {goalKind === "sprint" && companyGoals.length > 0 ? (
                  <div style={{ display: "grid", gap: "5px", minWidth: 0 }}>
                    <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-secondary)" }}>Parent company goal</span>
                    <GoalParentCombobox
                      goals={companyGoals}
                      value={createParentId}
                      onChange={(parentId) => {
                        setCreateParentId(parentId);
                        const parent = companyGoals.find((goal) => goal.sprint.id === parentId);
                        if (parent?.sprint.endDate) {
                          setCreateEndDate(isoToDateInput(parent.sprint.endDate));
                        }
                      }}
                    />
                  </div>
                ) : null}
                <ComposerLeadAgentPicker agents={agents} value={createLeadAgentId} onChange={setCreateLeadAgentId} />
                <label style={{ display: "grid", gap: "5px", minWidth: 0 }}>
                  <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-secondary)" }}>Status</span>
                  <select value={createStatus} onChange={(e) => setCreateStatus(e.target.value as OrchestrationSprint["status"])} style={{ ...selectStyle, width: "100%" }}>
                    <option value="active">Active — lead begins planning</option>
                    <option value="planned">Planned — parked</option>
                  </select>
                </label>
                <label style={{ display: "grid", gap: "5px", minWidth: 0 }}>
                  <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-secondary)" }}>Default execution engine</span>
                  <select
                    value={createDefaultExecutionEngine}
                    onChange={(e) => setCreateDefaultExecutionEngine(e.target.value as ComposerExecutionEngine)}
                    style={{ ...selectStyle, width: "100%" }}
                  >
                    <option value="">Use project default</option>
                    <option value="hiverunner">HiveRunner</option>
                    <option value="symphony">Symphony</option>
                    <option value="manual">Manual</option>
                  </select>
                </label>
                <label style={{ display: "grid", gap: "5px", minWidth: 0 }}>
                  <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-secondary)" }}>Default model lane</span>
                  <select
                    value={createDefaultModelLane}
                    onChange={(e) => setCreateDefaultModelLane(e.target.value as ComposerModelLane)}
                    style={{ ...selectStyle, width: "100%" }}
                  >
                    <option value="">Use project default</option>
                    <option value="default">Default</option>
                    <option value="fast">Fast</option>
                    <option value="mini">Mini</option>
                    <option value="deep">Deep</option>
                  </select>
                </label>
                <label style={{ display: "grid", gap: "5px", minWidth: 0 }}>
                  <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-secondary)" }}>Start date</span>
                  <input
                    type="date"
                    value={createStartDate}
                    onChange={(e) => setCreateStartDate(e.target.value)}
                    style={fieldStyle}
                  />
                </label>
                <label style={{ display: "grid", gap: "5px", minWidth: 0 }}>
                  <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-secondary)" }}>End date</span>
                  <input
                    type="date"
                    value={createEndDate}
                    onChange={(e) => setCreateEndDate(e.target.value)}
                    style={fieldStyle}
                  />
                </label>
              </div>
              <p style={{ margin: "-4px 0 0", fontSize: "12px", color: "var(--text-muted)", lineHeight: 1.45 }}>
                {createStatus === "active"
                  ? goalKind === "sprint"
                    ? "Active: this sprint is current operating work. Agents may execute tasks against it once tasks exist."
                    : "Active: the lead agent will begin proposing sprint plans on the next heartbeat."
                  : goalKind === "sprint"
                    ? "Planned: parked until you set it active. Agents will not treat it as current work."
                    : "Planned: parked until you set it active. No automatic planning wake is created."}
              </p>
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", padding: "16px 20px", borderTop: "0.5px solid var(--border)", flexShrink: 0 }}>
              <p style={{ margin: 0, fontSize: "12px", color: "var(--text-muted)", maxWidth: "390px" }}>
                {!canCreate && createDisabledReason ? createDisabledReason : ""}
              </p>
              <button
                type="button"
                onClick={() => void handleCreateGoal()}
                disabled={submitting || !canCreate}
                title={!canCreate ? createDisabledReason : undefined}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "8px 16px",
                  borderRadius: "8px",
                  border: "0.5px solid var(--border-strong)",
                  background: "transparent",
                  color: !canCreate ? "color-mix(in srgb, var(--text-muted) 72%, transparent)" : "var(--text-primary)",
                  fontSize: "13px",
                  fontWeight: 500,
                  cursor: submitting ? "wait" : !canCreate ? "not-allowed" : "pointer",
                  opacity: !canCreate ? 0.5 : 1,
                }}
              >
                <Plus size={14} />
                {submitting ? "Creating..." : "Create goal"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "18px", paddingBottom: "24px" }}>
        <StatBlock value={companyGoalRollup.taskCount > 0 ? `${companyGoalRollup.completionPercent}%` : "—"} label="goal completion" />
        <StatBlock value={String(sprintGoals.filter((goal) => goal.sprint.status === "active").length)} label="active sprints" />
        <StatBlock value={String(companyGoals.length)} label="company goals" />
        <StatBlock value={String(companyGoalRollup.remainingTasks)} label="planned tasks left" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "32px" }}>
        <section>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 10 }}>
            <SectionTitle
              icon={<Target size={16} />}
              title="Company goals"
            />
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", gap: "4px" }}>
              <ProjectFilterChip
                label="All projects"
                selected={!projectFilter}
                onClick={() => setProjectFilter(null)}
              />
              {projectFilterOptions.map((project) => (
                <ProjectFilterChip
                  key={project.slug}
                  label={project.name}
                  selected={projectFilter === project.slug}
                  onClick={() => setProjectFilter(project.slug)}
                />
              ))}
              {hasCompanyWideGoals ? (
                <ProjectFilterChip
                  label="Company-wide"
                  selected={projectFilter === "company-wide"}
                  onClick={() => setProjectFilter("company-wide")}
                />
              ) : null}
            </div>
          </div>
          {filteredCompanyGoals.length === 0 ? (
            <div style={{ padding: "28px 0", borderTop: "0.5px solid var(--border)", color: "var(--text-muted)", fontSize: "13px" }}>
              {projectFilter && statusFilter ? "No goals match the current filters." : statusFilter ? `No ${statusFilter} goals.` : projectFilter ? "No goals match the current filters." : "No company goals yet."}
            </div>
          ) : (
            filteredCompanyGoals.map((goal) => {
              const supportingSprints = sprintsByCompanyGoalId.get(goal.sprint.id) ?? [];
              const goalPendingDrafts = pendingDraftsByCompanyGoalId.get(goal.sprint.id) ?? [];
              const rollup = companyOutcomeRollups.get(goal.sprint.id) ?? { supportCount: 0, rollup: EMPTY_ROLLUP };
              const storedCollapsePref = typeof window === "undefined"
                ? null
                : window.localStorage.getItem(`hr:goals:collapse:${companyCode}:${goal.sprint.id}`);
              const collapsePref = collapsePrefs[goal.sprint.id]
                ?? (storedCollapsePref === "expanded" || storedCollapsePref === "collapsed" ? storedCollapsePref : undefined);
              const expanded = collapsePref
                ? collapsePref === "expanded"
                : goalPendingDrafts.length > 0 || defaultExpandedForCompanyGoal(goal, supportingSprints);
              return (
              <CompanyOutcomePanel
                key={goal.sprint.id}
                goal={goal}
                supportingSprints={supportingSprints}
                pendingDrafts={goalPendingDrafts}
                rollup={rollup.rollup}
                companyCode={companyCode}
                expanded={expanded}
                onToggle={() => toggleCompanyGoalCollapse(goal, supportingSprints)}
                agents={agents}
                onStatusChange={handleStatusChange}
                onOwnerChange={handleOwnerChange}
                onDateChange={handleDateChange}
                onReviewDraft={handleReviewDraft}
                onApproveDraft={requestApproveDraft}
                onApprovePlanDraft={requestApprovePlanDraft}
              />
              );
            })
          )}
        </section>

        {approvalPrompt ? (
          <SprintApprovalModal
            prompt={approvalPrompt}
            onCancel={() => setApprovalPrompt(null)}
            onConfirm={() => {
              if (approvalPrompt.kind === "all_sprints") {
                void handleApprovePlanDraft(approvalPrompt.draft);
              } else {
                void handleApproveDraft(approvalPrompt.draft);
              }
            }}
          />
        ) : null}

        {filteredOrphanedSprints.length > 0 ? (
          <section>
            <SectionTitle
              icon={<Layers3 size={16} />}
              title="Orphaned sprints"
            />
            <p style={{ margin: "-4px 0 10px 34px", fontSize: "12px", color: "var(--text-muted)" }}>
              Parent company goal was removed. Reassign or archive.
            </p>
            <div style={{ opacity: 0.72 }}>
              {filteredOrphanedSprints.map((goal) => (
                <SprintGoalRow
                  key={goal.sprint.id}
                  goal={goal}
                  companyCode={companyCode}
                  agents={agents}
                  onStatusChange={handleStatusChange}
                  onOwnerChange={handleOwnerChange}
                  onDateChange={handleDateChange}
                />
              ))}
            </div>
          </section>
        ) : null}
      </div>
      <style jsx global>{`
        @media (max-width: 720px) {
          .goals-page-shell {
            padding: 18px 16px !important;
            overflow-x: hidden;
          }

          .goals-row-shell {
            grid-template-columns: 24px minmax(0, 1fr) auto !important;
            gap: 10px !important;
            align-items: start !important;
          }

          .goals-row-link {
            grid-column: 2 / 3 !important;
            grid-row: 1 / 2 !important;
            grid-template-columns: minmax(0, 1fr) !important;
            gap: 8px !important;
          }

          .goals-sprint-row {
            grid-template-columns: minmax(0, 1fr) auto !important;
            gap: 10px !important;
            align-items: start !important;
          }

          .goals-sprint-link {
            grid-column: 1 / 2 !important;
            grid-row: 1 / 2 !important;
            grid-template-columns: minmax(0, 1fr) !important;
            gap: 8px !important;
          }

          .goals-row-status {
            grid-column: -2 / -1 !important;
            grid-row: 1 / 2 !important;
            justify-content: flex-end !important;
          }

          .goals-row-owner {
            grid-column: 2 / 3 !important;
            grid-row: 2 / 3 !important;
            justify-content: flex-start !important;
          }

          .goals-sprint-row > .goals-row-owner {
            grid-column: 1 / 2 !important;
          }

          .goals-row-date {
            grid-column: 2 / 3 !important;
            grid-row: 3 / 4 !important;
            justify-content: flex-start !important;
          }

          .goals-sprint-row > .goals-row-date {
            grid-column: 1 / 2 !important;
          }

          .goals-sprint-row > .goals-row-status {
            grid-column: 2 / 3 !important;
          }

          .goals-row-owner button,
          .goals-row-date button {
            max-width: min(180px, 100%) !important;
          }

          .goals-row-shell > :first-child {
            grid-column: 1 / 2 !important;
            grid-row: 1 / 2 !important;
          }

          .goals-row-open {
            justify-content: flex-start !important;
          }

          .goals-row-progress {
            max-width: 100% !important;
          }

          .goals-row-shell > .goals-row-status,
          .goals-sprint-row > .goals-row-status {
            justify-content: flex-end !important;
          }

          .goals-children {
            padding-left: 16px !important;
          }

          .goals-row-title,
          .goals-row-subtitle {
            white-space: normal !important;
            overflow: visible !important;
            text-overflow: clip !important;
          }
        }

        @media (max-width: 520px) {
          .goals-composer-kind-grid {
            grid-template-columns: 1fr !important;
          }

          .goals-composer-fields-grid {
            grid-template-columns: 1fr !important;
          }

          .goals-modal {
            max-width: calc(100vw - 20px) !important;
            max-height: calc(100dvh - 20px) !important;
            border-radius: 12px !important;
          }
        }
      `}</style>
    </div>
  );
}
