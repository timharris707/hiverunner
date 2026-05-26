"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, Plus, Trash2, X } from "lucide-react";
import { DateWindowChip } from "@/components/goals/DateWindowChip";
import { GoalProgressBar, GoalStatusPill } from "@/components/goals/GoalPrimitives";
import { SprintGroupedList } from "@/components/goals/SprintGroupedList";
import { SprintRow } from "@/components/goals/SprintRow";
import { AgentAvatarInline } from "@/components/tasks/InlineAssigneePicker";
import { TaskRow as TaskRowComponent } from "@/components/tasks/TaskRow";
import { type InlineEditCallbacks, type TaskRow as TaskRowT, getActiveRunLabel } from "@/components/tasks/types";
import {
  createGoalContractItem,
  createSprintPlanningTask,
  archiveCompanyGoal,
  deleteCompanyGoal,
  getPendingSprintPlanDrafts,
  listCompanies,
  listCompanyAgents,
  listCompanyGoals,
  listTasks,
  recordGoalContractEvidence,
  reviewSprintPlanDraft,
  updateCompanyGoal,
  updateGoalContractItem,
  updateTaskAssignee,
  updateTaskStatus,
} from "@/lib/orchestration/client";
import { determineGoalKind } from "@/lib/orchestration/goal-kind";
import { groupBySprint, type GroupableItem } from "@/lib/orchestration/groupBySprint";
import { buildCanonicalCompanyPath, buildCanonicalGoalPath, goalRouteKey } from "@/lib/orchestration/route-paths";
import { useEventStream, type StreamEvent } from "@/lib/orchestration/use-event-stream";
import type {
  OrchestrationAgent,
  OrchestrationCompany,
  OrchestrationCompanyGoal,
  OrchestrationGoalContractItem,
  OrchestrationSprint,
  OrchestrationSprintPlanDraft,
  OrchestrationSprintPlanDraftSprint,
  OrchestrationSprintPlanDraftTask,
  OrchestrationTask,
  TaskExecutionEngine,
  TaskModelLane,
  TaskStatus,
} from "@/lib/orchestration/types";
import { P as tokens } from "@/lib/ui/tokens";

type GoalPatch = {
  name?: string;
  goal?: string;
  status?: OrchestrationSprint["status"];
  owner?: string | null;
  leadAgentId?: string | null;
  startDate?: string;
  endDate?: string | null;
  stopCondition?: string;
  progressSummary?: string;
  defaultExecutionEngine?: TaskExecutionEngine | null;
  defaultModelLane?: TaskModelLane | null;
};

type SprintTaskRow = TaskRowT & GroupableItem;

const EXECUTION_ENGINE_OPTIONS: TaskExecutionEngine[] = ["hiverunner", "symphony", "manual"];
const MODEL_LANE_OPTIONS: TaskModelLane[] = ["default", "fast", "mini", "deep"];

const P = {
  bg: tokens.bg,
  card: tokens.surface,
  cardBorder: tokens.cardBorder,
  text: tokens.text,
  textSec: tokens.textSec,
  muted: tokens.muted,
  surfaceHover: "var(--surface-hover)",
};

const GOAL_DETAIL_REFRESH_EVENT_TYPES = new Set([
  "goal.created",
  "goal.updated",
  "goal.contract_item_created",
  "goal.contract_item_updated",
  "goal.contract_item_archived",
  "goal.contract_evidence_recorded",
  "goal.sprint_plan_proposed",
  "goal.sprint_plan_approved",
  "goal.sprint_plan_rejected",
  "goal.completion_proposed",
  "goal.completion_approved",
  "goal.completion_rejected",
  "sprint.auto_completed",
]);

function toClientTaskStatus(raw?: string): TaskStatus | null {
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

function updateGoalCountForTaskStatus(sprint: OrchestrationSprint, status: TaskStatus, delta: 1 | -1) {
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
    const status = toClientTaskStatus(event.toStatus ?? event.taskStatus);
    sprint.taskCount += 1;
    if (status) updateGoalCountForTaskStatus(sprint, status, 1);
    return recalculateGoalProgress({ ...goal, sprint }, event.timestamp);
  }

  if (event.eventType === "task.status_changed") {
    const from = toClientTaskStatus(event.fromStatus);
    const to = toClientTaskStatus(event.toStatus ?? event.taskStatus);
    if (from) updateGoalCountForTaskStatus(sprint, from, -1);
    if (to) updateGoalCountForTaskStatus(sprint, to, 1);
    return recalculateGoalProgress({ ...goal, sprint }, event.timestamp);
  }

  if (event.eventType === "task.updated" || event.eventType === "task.reordered") {
    return recalculateGoalProgress({ ...goal, sprint }, event.timestamp);
  }

  return goal;
}

function formatDate(value?: string | null) {
  if (!value) return "No date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No date";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function goalScopeLabel(goal: OrchestrationCompanyGoal) {
  const slug = goal.projectSlug.toLowerCase();
  if (slug === "no-project" || slug.startsWith("no-project-") || goal.projectName.toLowerCase() === "no project") {
    return "Company-wide";
  }
  return goal.projectName;
}

function goalDisplayKey(goal: OrchestrationCompanyGoal): string | null | undefined {
  return determineGoalKind(goal) === "company" ? goal.sprint.goalKey : goal.sprint.sprintKey;
}

function goalMatchesRoute(goal: OrchestrationCompanyGoal, routeId: string): boolean {
  const normalized = routeId.toLowerCase();
  return goal.sprint.id.toLowerCase() === normalized ||
    goal.sprint.goalKey?.toLowerCase() === normalized ||
    goal.sprint.sprintKey?.toLowerCase() === normalized;
}

function sprintPlanDraftAnchorId(draftId: string) {
  return `sprint-plan-draft-${draftId}`;
}

function statusWeight(status: OrchestrationSprint["status"]) {
  if (status === "active") return 0;
  if (status === "planned") return 1;
  return 2;
}

function sortGoals(a: OrchestrationCompanyGoal, b: OrchestrationCompanyGoal) {
  const aSeq = sprintSequence(a.sprint.sprintKey);
  const bSeq = sprintSequence(b.sprint.sprintKey);
  if (aSeq !== null && bSeq !== null && aSeq !== bSeq) return aSeq - bSeq;
  if (aSeq !== null && bSeq === null) return -1;
  if (aSeq === null && bSeq !== null) return 1;
  return statusWeight(a.sprint.status) - statusWeight(b.sprint.status)
    || new Date(b.sprint.updated).getTime() - new Date(a.sprint.updated).getTime()
    || a.sprint.name.localeCompare(b.sprint.name);
}

function sprintSequence(sprintKey?: string | null) {
  const match = sprintKey?.match(/-S(\d+)$/i);
  return match ? Number.parseInt(match[1] ?? "", 10) : null;
}

function projectMetaFromGoal(goal?: OrchestrationCompanyGoal | null) {
  if (!goal) return null;
  return {
    id: goal.projectId,
    slug: goal.projectSlug,
    name: goalScopeLabel(goal),
    color: goal.projectColor,
  };
}

function toTaskRow(
  task: OrchestrationTask,
  goal: OrchestrationCompanyGoal,
  parentGoal: OrchestrationCompanyGoal | null,
  allGoals: OrchestrationCompanyGoal[],
): SprintTaskRow {
  const taskProjectId = "projectId" in task && typeof task.projectId === "string" ? task.projectId : task.project;
  const projectGoal = allGoals.find((candidate) => candidate.projectId === taskProjectId);
  const meta = projectMetaFromGoal(projectGoal) ?? projectMetaFromGoal(goal) ?? {
    id: task.project,
    slug: "project",
    name: "Project",
    color: "#6366f1",
  };

  return {
    ...task,
    projectId: meta.id,
    projectSlug: meta.slug,
    projectName: meta.name,
    sprintId: task.sprintId ?? goal.sprint.id,
    sprintKey: task.sprintKey ?? goal.sprint.sprintKey ?? undefined,
    sprintName: task.sprintName ?? goal.sprint.name,
    sprintStatus: task.sprintStatus ?? goal.sprint.status,
    companyGoalId: task.companyGoalId ?? parentGoal?.sprint.id,
    companyGoalKey: task.companyGoalKey ?? parentGoal?.sprint.goalKey ?? undefined,
    companyGoalName: task.companyGoalName ?? parentGoal?.sprint.name,
    companyGoalStatus: task.companyGoalStatus ?? parentGoal?.sprint.status,
    updatedAt: task.updated,
  };
}

export default function GoalDetailPage({
  params,
}: {
  params: Promise<{ slug: string; goalId: string }>;
}) {
  const { slug, goalId } = use(params);
  const router = useRouter();

  const [goal, setGoal] = useState<OrchestrationCompanyGoal | null>(null);
  const [company, setCompany] = useState<OrchestrationCompany | null>(null);
  const [allGoals, setAllGoals] = useState<OrchestrationCompanyGoal[]>([]);
  const [agents, setAgents] = useState<OrchestrationAgent[]>([]);
  const [tasks, setTasks] = useState<OrchestrationTask[]>([]);
  const [pendingDrafts, setPendingDrafts] = useState<OrchestrationSprintPlanDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [planning, setPlanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focusedDraftId, setFocusedDraftId] = useState<string | null>(null);

  const companyCode = company?.code ?? slug;
  const activeCompanySlug = company?.slug ?? slug;
  const goalsRefetchTimerRef = useRef<number | null>(null);
  const tasksRefetchTimerRef = useRef<number | null>(null);
  const goalsRequestSeqRef = useRef(0);
  const tasksRequestSeqRef = useRef(0);
  const lastGoalsRefreshAtRef = useRef(new Date().toISOString());
  const allGoalsSnapshotRef = useRef<OrchestrationCompanyGoal[]>([]);
  const goalSnapshotRef = useRef<OrchestrationCompanyGoal | null>(null);

  const loadData = useCallback(async () => {
    setError(null);
    const [companyRows, goalPayload, agentList, taskRows] = await Promise.all([
      listCompanies(),
      listCompanyGoals({ companySlug: slug }),
      listCompanyAgents(slug),
      listTasks({ company: slug, includeNonProduction: true, sort: "updated-desc" }),
    ]);

    const slugKey = slug.toLowerCase();
    const currentCompany = companyRows.find(
      (row) => row.slug.toLowerCase() === slugKey || row.code.toLowerCase() === slugKey,
    ) ?? null;
    const goals = goalPayload?.goals ?? [];
    const currentGoal = goals.find((candidate) => goalMatchesRoute(candidate, goalId)) ?? null;
    const drafts = currentGoal
      ? await getPendingSprintPlanDrafts({ companySlug: slug, companyGoalId: currentGoal.sprint.id })
      : [];
    setCompany(currentCompany);
    setAllGoals(goals);
    setGoal(currentGoal);
    setAgents(agentList);
    setTasks(taskRows);
    setPendingDrafts(drafts);
    lastGoalsRefreshAtRef.current = new Date().toISOString();
    if (currentGoal) {
      const canonicalSegment = goalRouteKey(currentGoal.sprint);
      if (canonicalSegment.toLowerCase() !== goalId.toLowerCase()) {
        router.replace(buildCanonicalGoalPath(currentCompany?.code ?? slug, canonicalSegment), { scroll: false });
      }
    }
  }, [goalId, router, slug]);

  const refreshGoalsAndDraft = useCallback(async () => {
    const requestSeq = goalsRequestSeqRef.current + 1;
    goalsRequestSeqRef.current = requestSeq;
    const goalPayload = await listCompanyGoals({ companySlug: slug });
    if (goalsRequestSeqRef.current !== requestSeq) return;
    const goals = goalPayload?.goals ?? [];
    const currentGoal = goals.find((candidate) => goalMatchesRoute(candidate, goalId)) ?? null;
    const drafts = currentGoal
      ? await getPendingSprintPlanDrafts({ companySlug: slug, companyGoalId: currentGoal.sprint.id })
      : [];
    if (goalsRequestSeqRef.current !== requestSeq) return;
    setAllGoals(goals);
    setGoal(currentGoal);
    setPendingDrafts(drafts);
    lastGoalsRefreshAtRef.current = new Date().toISOString();
  }, [goalId, slug]);

  const refreshTasks = useCallback(async () => {
    const requestSeq = tasksRequestSeqRef.current + 1;
    tasksRequestSeqRef.current = requestSeq;
    const taskRows = await listTasks({ company: slug, includeNonProduction: true, sort: "updated-desc" });
    if (tasksRequestSeqRef.current !== requestSeq) return;
    setTasks(taskRows);
  }, [slug]);

  const scheduleGoalsAndDraftRefresh = useCallback((delayMs = 300) => {
    if (goalsRefetchTimerRef.current !== null) window.clearTimeout(goalsRefetchTimerRef.current);
    goalsRefetchTimerRef.current = window.setTimeout(() => {
      goalsRefetchTimerRef.current = null;
      void refreshGoalsAndDraft().catch(() => {
        // The next SSE event or operator action will retry.
      });
    }, delayMs);
  }, [refreshGoalsAndDraft]);

  const scheduleTasksRefresh = useCallback((delayMs = 300) => {
    if (tasksRefetchTimerRef.current !== null) window.clearTimeout(tasksRefetchTimerRef.current);
    tasksRefetchTimerRef.current = window.setTimeout(() => {
      tasksRefetchTimerRef.current = null;
      void refreshTasks().catch(() => {
        // The next SSE event or operator action will retry.
      });
    }, delayMs);
  }, [refreshTasks]);

  useEffect(() => {
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      void loadData()
        .catch((err) => {
          if (!cancelled) setError(err instanceof Error ? err.message : "Unable to load goal.");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [loadData]);

  useEffect(() => {
    allGoalsSnapshotRef.current = allGoals;
  }, [allGoals]);

  useEffect(() => {
    goalSnapshotRef.current = goal;
  }, [goal]);

  useEffect(() => () => {
    if (goalsRefetchTimerRef.current !== null) window.clearTimeout(goalsRefetchTimerRef.current);
    if (tasksRefetchTimerRef.current !== null) window.clearTimeout(tasksRefetchTimerRef.current);
  }, []);

  const handleLiveEvent = useCallback((event: StreamEvent) => {
    if (event.type === "connected") return;

    const currentGoal = goalSnapshotRef.current;
    const sprintId = event.sprintId ?? (typeof event.metadata?.sprintId === "string" ? event.metadata.sprintId : undefined);
    const companyGoalId = event.companyGoalId ??
      (typeof event.metadata?.companyGoalId === "string" ? event.metadata.companyGoalId : undefined);
    const currentGoalId = currentGoal?.sprint.id;
    const touchesCurrentGoal = Boolean(currentGoalId && (sprintId === currentGoalId || companyGoalId === currentGoalId));

    if (event.type === "comment") {
      if (touchesCurrentGoal) scheduleTasksRefresh();
      return;
    }
    if (event.type !== "activity") return;

    if (event.eventType && GOAL_DETAIL_REFRESH_EVENT_TYPES.has(event.eventType)) {
      if (touchesCurrentGoal || event.eventType === "goal.created" || event.eventType === "goal.updated") {
        scheduleGoalsAndDraftRefresh();
      }
      if (event.eventType === "goal.sprint_plan_approved" && touchesCurrentGoal) {
        scheduleTasksRefresh();
      }
      return;
    }

    if (event.timestamp && event.timestamp <= lastGoalsRefreshAtRef.current) return;

    if (event.eventType === "task.archived") {
      if (touchesCurrentGoal) {
        scheduleGoalsAndDraftRefresh();
        scheduleTasksRefresh();
      }
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

    if (!sprintId) {
      scheduleGoalsAndDraftRefresh();
      return;
    }

    if (
      event.eventType === "task.updated" &&
      (event.metadata?.sprintChanged || event.metadata?.projectChanged || event.metadata?.parentTaskChanged)
    ) {
      scheduleGoalsAndDraftRefresh();
      scheduleTasksRefresh();
      return;
    }

    const knownGoal = allGoalsSnapshotRef.current.some((candidate) => candidate.sprint.id === sprintId);
    if (!knownGoal) {
      scheduleGoalsAndDraftRefresh();
    } else {
      setAllGoals((current) => current.map((candidate) => (
        candidate.sprint.id === sprintId ? patchGoalForTaskEvent(candidate, event) : candidate
      )));
      if (currentGoal?.sprint.id === sprintId) {
        setGoal(patchGoalForTaskEvent(currentGoal, event));
      }
    }

    if (sprintId === currentGoalId) {
      if (event.eventType === "task.status_changed" && event.taskId) {
        const next = toClientTaskStatus(event.toStatus ?? event.taskStatus);
        if (next) {
          setTasks((current) => current.map((task) => (
            task.id === event.taskId ? { ...task, status: next, updated: event.timestamp ?? task.updated } : task
          )));
        } else {
          scheduleTasksRefresh();
        }
      } else {
        scheduleTasksRefresh();
      }
    }
  }, [scheduleGoalsAndDraftRefresh, scheduleTasksRefresh]);

  useEventStream({
    companySlug: activeCompanySlug,
    enabled: Boolean(activeCompanySlug),
    onEvent: handleLiveEvent,
  });

  const patchGoal = useCallback(async (sprintId: string, patch: GoalPatch) => {
    const previousGoals = allGoals;
    const previousGoal = goal;
    setAllGoals((prev) => prev.map((candidate) => (
      candidate.sprint.id === sprintId ? applyGoalPatch(candidate, patch) : candidate
    )));
    if (goal?.sprint.id === sprintId) setGoal(applyGoalPatch(goal, patch));

    const updated = await updateCompanyGoal({ companySlug: slug, sprintId, ...patch });
    if (!updated) {
      setAllGoals(previousGoals);
      setGoal(previousGoal);
      setError("Goal update failed.");
      return;
    }

    setAllGoals((prev) => prev.map((candidate) => (candidate.sprint.id === sprintId ? updated : candidate)));
    if (sprintId === goal?.sprint.id) setGoal(updated);
  }, [allGoals, goal, slug]);

  const replaceGoal = useCallback((updated: OrchestrationCompanyGoal) => {
    setAllGoals((prev) => prev.map((candidate) => (candidate.sprint.id === updated.sprint.id ? updated : candidate)));
    if (updated.sprint.id === goal?.sprint.id) setGoal(updated);
  }, [goal]);

  const handleCreateContractItem = useCallback(async (
    sprintId: string,
    kind: OrchestrationGoalContractItem["kind"],
    text: string,
  ) => {
    const result = await createGoalContractItem({
      companySlug: slug,
      sprintId,
      kind,
      text,
      actorUserId: "operator",
    });
    if (!result) {
      setError("Contract item create failed.");
      return;
    }
    replaceGoal(result.goal);
  }, [replaceGoal, slug]);

  const handleUpdateContractItem = useCallback(async (
    item: OrchestrationGoalContractItem,
    patch: { text?: string; archived?: boolean },
  ) => {
    const result = await updateGoalContractItem({
      companySlug: slug,
      itemId: item.id,
      sprintId: item.sprintId,
      ...patch,
      actorUserId: "operator",
    });
    if (!result) {
      setError("Contract item update failed.");
      return;
    }
    replaceGoal(result.goal);
  }, [replaceGoal, slug]);

  const handleRecordEvidence = useCallback(async (
    item: OrchestrationGoalContractItem,
    status: "passed" | "retracted",
  ) => {
    const result = await recordGoalContractEvidence({
      companySlug: slug,
      itemId: item.id,
      sprintId: item.sprintId,
      status,
      resultText: status === "passed" ? "Confirmed by operator." : "Retracted by operator.",
      actorUserId: "operator",
    });
    if (!result) {
      setError("Evidence update failed.");
      return;
    }
    replaceGoal(result.goal);
  }, [replaceGoal, slug]);

  const handleDelete = async () => {
    if (!goal) return;
    await deleteCompanyGoal({ companySlug: slug, sprintId: goal.sprint.id });
    router.push(buildCanonicalCompanyPath(companyCode, "/goals"));
  };

  const handleArchive = async () => {
    if (!goal) return;
    const archived = await archiveCompanyGoal({ companySlug: slug, sprintId: goal.sprint.id });
    if (!archived) {
      setError("Unable to archive goal.");
      return;
    }
    router.push(buildCanonicalCompanyPath(companyCode, "/goals"));
  };

  const handlePlanSprint = async () => {
    if (!goal || planning) return;
    setPlanning(true);
    setError(null);
    const created = await createSprintPlanningTask({
      companySlug: slug,
      companyGoalId: goal.sprint.id,
      leadAgentId: goal.sprint.leadAgentId ?? null,
    });
    setPlanning(false);
    if (!created) {
      setError("Unable to create sprint planning task.");
      return;
    }
    setError(`Planning task ${created.taskKey} created for the lead agent.`);
    void loadData();
  };

  const handleReviewDraft = async (input: {
    draftId: string;
    action: "approve" | "approve_all" | "reject" | "update";
    reason?: string;
    sprint?: OrchestrationSprintPlanDraftSprint;
    tasks?: OrchestrationSprintPlanDraftTask[];
  }) => {
    if (!goal) return;
    setError(null);
    const result = await reviewSprintPlanDraft({
      companySlug: slug,
      companyGoalId: goal.sprint.id,
      ...input,
    });
    if (!result) {
      setError(input.action === "approve" || input.action === "approve_all" ? "Unable to approve sprint plan." : input.action === "reject" ? "Unable to reject sprint plan." : "Unable to update sprint plan.");
      return;
    }
    if (input.action === "update") {
      setPendingDrafts((current) => current.map((draft) => (draft.id === input.draftId ? result.draft : draft)));
      return;
    }
    setPendingDrafts((current) => current.filter((draft) => draft.id !== input.draftId));
    if (result.assigneeResolutionFailures?.length) {
      const unresolved = result.assigneeResolutionFailures.map((failure) => `${failure.title}: ${failure.assignee}`).join("; ");
      setError(`Approved, but these proposed assignees could not be resolved and were left unassigned: ${unresolved}`);
    }
    await loadData();
  };

  const handleSprintDraftJump = useCallback((draftId: string) => {
    setFocusedDraftId(draftId);
    const alignDraft = (behavior: ScrollBehavior, force = false) => {
      const target = document.getElementById(sprintPlanDraftAnchorId(draftId));
      const scrollPane = target?.closest("main");
      if (!(target instanceof HTMLElement) || !(scrollPane instanceof HTMLElement)) return;
      const stickyHeader = scrollPane.querySelector("[data-sprint-plan-sticky-header='true']");
      const targetRect = target.getBoundingClientRect();
      const desiredTop = stickyHeader instanceof HTMLElement
        ? stickyHeader.getBoundingClientRect().bottom + 14
        : scrollPane.getBoundingClientRect().top + 96;
      const targetTop = scrollPane.scrollTop + targetRect.top - desiredTop;
      if (!force && Math.abs(targetRect.top - desiredTop) < 4) return;
      scrollPane.scrollTo({
        behavior,
        top: Math.max(0, targetTop),
      });
    };
    const behavior: ScrollBehavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    window.setTimeout(() => alignDraft(behavior, true), 40);
    window.setTimeout(() => alignDraft(behavior), 520);
  }, []);

  const taskCallbacks = useMemo<InlineEditCallbacks>(() => ({
    onStatusChange: async (taskId: string, status: TaskStatus) => {
      const previous = tasks;
      setTasks((prev) => prev.map((task) => (task.id === taskId ? { ...task, status } : task)));
      const ok = await updateTaskStatus(taskId, status);
      if (!ok) {
        setTasks(previous);
        setError("Task status update failed.");
        return;
      }
      void loadData();
    },
    onAssigneeChange: async (taskId: string, assignee: string) => {
      const nextAssignee = assignee || null;
      const previous = tasks;
      setTasks((prev) => prev.map((task) => (task.id === taskId ? { ...task, assignee: nextAssignee ?? undefined } : task)));
      const ok = await updateTaskAssignee(taskId, nextAssignee);
      if (!ok) {
        setTasks(previous);
        setError("Task assignee update failed.");
      }
    },
    onPriorityChange: async () => {},
  }), [loadData, tasks]);

  const agentMap = useMemo(() => {
    const map = new Map<string, OrchestrationAgent>();
    agents.forEach((agent) => {
      map.set(agent.id.toLowerCase(), agent);
      map.set(agent.name.toLowerCase(), agent);
      map.set(agent.slug.toLowerCase(), agent);
    });
    return map;
  }, [agents]);

  const supportingSprints = useMemo(() => {
    if (!goal) return [];
    return allGoals
      .filter((candidate) => candidate.sprint.parentId === goal.sprint.id && determineGoalKind(candidate) === "sprint")
      .slice()
      .sort(sortGoals);
  }, [allGoals, goal]);

  const parentGoal = useMemo(() => {
    if (!goal?.sprint.parentId) return null;
    return allGoals.find((candidate) => candidate.sprint.id === goal.sprint.parentId) ?? null;
  }, [allGoals, goal]);

  const sprintTasks = useMemo<SprintTaskRow[]>(() => {
    if (!goal || determineGoalKind(goal) !== "sprint") return [];
    return tasks
      .filter((task) => task.sprintId === goal.sprint.id || task.sprint === goal.sprint.id)
      .map((task) => toTaskRow(task, goal, parentGoal, allGoals));
  }, [allGoals, goal, parentGoal, tasks]);

  const groupedTasks = useMemo(() => groupBySprint(sprintTasks, "sprint"), [sprintTasks]);

  if (loading) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ height: 200, borderRadius: 8, background: P.card, border: `1px solid ${P.cardBorder}`, animation: "pulse 1.5s infinite" }} />
      </div>
    );
  }

  if (!goal) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ padding: 16, borderRadius: 8, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#fca5a5", fontSize: 13 }}>
          Goal not found.
        </div>
      </div>
    );
  }

  const goalKind = determineGoalKind(goal);
  const goalsHref = buildCanonicalCompanyPath(companyCode, "/goals");

  const renderTask = (task: SprintTaskRow) => {
    const activeRunLabel = getActiveRunLabel(task, agentMap);
    return (
      <TaskRowComponent
        key={task.id}
        task={task}
        href={buildCanonicalCompanyPath(companyCode, `/tasks/${encodeURIComponent(task.key ?? task.id)}`)}
        agents={agents}
        callbacks={taskCallbacks}
        isSelected={false}
        onContextMenu={(event) => event.preventDefault()}
        onClick={() => {}}
        hasActiveRun={Boolean(activeRunLabel)}
        activeAgentName={activeRunLabel}
      />
    );
  };

  return (
    <div style={{ display: "flex", flex: 1, height: "calc(100dvh - 72px)", maxHeight: "calc(100dvh - 72px)", minHeight: 0, overflow: "hidden", color: P.text, fontSize: 13 }}>
      <main className="task-detail-scrollbarless" style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "22px 28px 36px" }}>
        <Breadcrumb
          goalsHref={goalsHref}
          parent={goalKind === "sprint" ? parentGoal : null}
          goal={goal}
        />

        <EditableHeader
          key={goal.sprint.id}
          goal={goal}
          goalKind={goalKind}
          projectLabel={goalScopeLabel(goal)}
          onSave={(patch) => patchGoal(goal.sprint.id, patch)}
        />

        {error ? (
          <div role="status" style={{ marginTop: 14, color: "#ef4444", fontSize: 12 }}>{error}</div>
        ) : null}

        {goalKind === "sprint" ? (
          <ContractSection
            key={`${goal.sprint.id}:${goal.sprint.updated}:${goal.sprint.contractItems?.length ?? 0}`}
            goal={goal}
            parentGoal={parentGoal}
            goalKind={goalKind}
            onPatch={(patch) => patchGoal(goal.sprint.id, patch)}
            onCreateItem={handleCreateContractItem}
            onUpdateItem={handleUpdateContractItem}
            onRecordEvidence={handleRecordEvidence}
          />
        ) : null}

        {goalKind === "company" ? (
          <section style={{ marginTop: 34 }}>
            {pendingDrafts.length > 0 ? (
              <SprintPlanDraftPanel
                drafts={pendingDrafts}
                agents={agents}
                focusedDraftId={focusedDraftId}
                onUpdate={(draftId, sprint, draftTasks) => handleReviewDraft({ draftId, action: "update", sprint, tasks: draftTasks })}
                onApprove={(draftId, sprint, draftTasks) => handleReviewDraft({ draftId, action: "approve", sprint, tasks: draftTasks })}
                onApproveAll={(draftId) => handleReviewDraft({ draftId, action: "approve_all" })}
                onReject={(draftId, reason) => handleReviewDraft({ draftId, action: "reject", reason })}
              />
            ) : null}
            <SectionTitle
              title={`Supporting sprints (${supportingSprints.length})`}
              action={(
                <button type="button" onClick={handlePlanSprint} disabled={planning} style={secondaryButtonStyle}>
                  {planning ? "Planning..." : "Plan sprint"}
                </button>
              )}
            />
            {supportingSprints.length === 0 ? (
              <EmptyLine>No sprints supporting this goal yet.</EmptyLine>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {supportingSprints.map((supporting) => (
                  <SprintRow
                    key={supporting.sprint.id}
                    sprint={supporting.sprint}
                    completionPercent={supporting.completionPercent}
                    companyCode={companyCode}
                    parentGoalName={goal.sprint.name}
                    projectLabel={goalScopeLabel(supporting)}
                    agents={agents}
                    onOwnerChange={(sprintId, owner) => patchGoal(sprintId, { owner })}
                    onDateChange={(sprintId, startDate, endDate) => patchGoal(sprintId, { startDate, endDate })}
                  />
                ))}
              </div>
            )}
          </section>
        ) : (
          <section style={{ marginTop: 34 }}>
            <SectionTitle title={`Tasks (${sprintTasks.length})`} />
            {sprintTasks.length === 0 ? (
              <EmptyLine>No tasks in this sprint yet.</EmptyLine>
            ) : (
              <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", background: P.card }}>
                <SprintGroupedList
                  grouped={groupedTasks}
                  mode="sprint"
                  companyCode={companyCode}
                  persistenceKeyPrefix={`hr:goal-detail:tasks:${companyCode}:${goal.sprint.id}`}
                  itemCountLabel="tasks"
                  renderItem={renderTask}
                  empty={<EmptyLine>No tasks in this sprint yet.</EmptyLine>}
                />
              </div>
            )}
          </section>
        )}
      </main>

      <GoalSidebar
        goal={goal}
        agents={agents}
        supportingSprints={supportingSprints}
        onPatch={(patch) => patchGoal(goal.sprint.id, patch)}
        onArchive={handleArchive}
        onDelete={handleDelete}
        pendingDrafts={pendingDrafts}
        focusedDraftId={focusedDraftId}
        onDraftJump={handleSprintDraftJump}
      />
    </div>
  );
}

function applyGoalPatch(goal: OrchestrationCompanyGoal, patch: GoalPatch): OrchestrationCompanyGoal {
  const sprint = { ...goal.sprint };
  if (patch.name !== undefined) sprint.name = patch.name;
  if (patch.goal !== undefined) sprint.goal = patch.goal;
  if (patch.status !== undefined) sprint.status = patch.status;
  if (patch.owner !== undefined) {
    if (patch.owner) sprint.owner = patch.owner;
    else delete sprint.owner;
  }
  if (patch.leadAgentId !== undefined) sprint.leadAgentId = patch.leadAgentId;
  if (patch.startDate !== undefined) sprint.startDate = patch.startDate;
  if (Object.prototype.hasOwnProperty.call(patch, "endDate")) {
    if (patch.endDate) sprint.endDate = patch.endDate;
    else delete sprint.endDate;
  }
  if (patch.stopCondition !== undefined) sprint.stopCondition = patch.stopCondition;
  if (patch.progressSummary !== undefined) sprint.progressSummary = patch.progressSummary;
  if (patch.defaultExecutionEngine !== undefined) sprint.defaultExecutionEngine = patch.defaultExecutionEngine;
  if (patch.defaultModelLane !== undefined) sprint.defaultModelLane = patch.defaultModelLane;
  return { ...goal, sprint };
}

function Breadcrumb({
  goalsHref,
  parent,
  goal,
}: {
  goalsHref: string;
  parent: OrchestrationCompanyGoal | null;
  goal: OrchestrationCompanyGoal;
}) {
  return (
    <nav style={{ display: "flex", alignItems: "center", gap: 8, color: P.muted, fontSize: 12, marginBottom: 18 }}>
      <Link href={goalsHref} style={{ color: P.muted, textDecoration: "none" }}>Goals</Link>
      {parent ? (
        <>
          <span aria-hidden="true">›</span>
          <Link
            href={`${goalsHref}/${encodeURIComponent(goalRouteKey(parent.sprint))}`}
            style={{ color: P.muted, textDecoration: "none", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {goalDisplayKey(parent) ? `${goalDisplayKey(parent)} · ` : ""}{parent.sprint.name}
          </Link>
        </>
      ) : null}
      <span aria-hidden="true">›</span>
      <span style={{ color: P.textSec, maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {goalDisplayKey(goal) ? `${goalDisplayKey(goal)} · ` : ""}{goal.sprint.name}
      </span>
    </nav>
  );
}

function EditableHeader({
  goal,
  goalKind,
  projectLabel,
  onSave,
}: {
  goal: OrchestrationCompanyGoal;
  goalKind: "company" | "sprint";
  projectLabel: string;
  onSave: (patch: GoalPatch) => void;
}) {
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(goal.sprint.name);
  const [goalDraft, setGoalDraft] = useState(goal.sprint.goal ?? "");
  const descriptionRows = Math.min(
    14,
    Math.max(4, goalDraft.split("\n").length + Math.ceil(goalDraft.length / 92))
  );

  const saveName = () => {
    const next = nameDraft.trim();
    if (next.length >= 2 && next !== goal.sprint.name) onSave({ name: next });
    setEditingName(false);
  };

  const saveGoal = () => {
    const next = goalDraft.trim();
    if (next !== (goal.sprint.goal ?? "")) onSave({ goal: next });
  };

  return (
    <header style={{ maxWidth: 940 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {editingName ? (
          <input
            autoFocus
            value={nameDraft}
            onChange={(event) => setNameDraft(event.target.value)}
            onBlur={saveName}
            onKeyDown={(event) => {
              if (event.key === "Enter") saveName();
              if (event.key === "Escape") {
                setNameDraft(goal.sprint.name);
                setEditingName(false);
              }
            }}
            style={{
              border: "1px solid var(--border-strong)",
              borderRadius: 8,
              background: "transparent",
              color: P.text,
              fontSize: 26,
              fontWeight: 760,
              letterSpacing: 0,
              padding: "4px 8px",
              minWidth: 280,
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditingName(true)}
            style={{ border: "none", background: "transparent", color: P.text, padding: 0, cursor: "text", textAlign: "left" }}
          >
            <h1 style={{ margin: 0, fontSize: 28, lineHeight: 1.16, letterSpacing: "-0.01em", fontWeight: 720 }}>
              {goalDisplayKey(goal) ? <span style={{ fontFamily: "var(--font-mono)", color: P.muted, fontSize: 18, marginRight: 10 }}>{goalDisplayKey(goal)}</span> : null}
              {goal.sprint.name}
            </h1>
          </button>
        )}
        <GoalStatusPill status={goal.sprint.status} />
        {goalKind === "company" ? <ProjectChip label={projectLabel} color={goal.projectColor} /> : null}
      </div>
      <textarea
        value={goalDraft}
        onChange={(event) => setGoalDraft(event.target.value)}
        onBlur={saveGoal}
        placeholder={goalKind === "company" ? "Describe the outcome this company goal is trying to reach." : "Describe how this sprint advances its company goal."}
        rows={descriptionRows}
        style={{
          marginTop: 14,
          width: "100%",
          maxWidth: 760,
          resize: "vertical",
          border: "1px solid transparent",
          borderRadius: 8,
          background: "transparent",
          color: P.textSec,
          fontSize: 16,
          lineHeight: 1.45,
          padding: 0,
          outline: "none",
        }}
      />
    </header>
  );
}

function ProjectChip({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      border: "1px solid var(--border)",
      borderRadius: 999,
      padding: "4px 9px",
      color: P.textSec,
      fontSize: 12,
      background: "var(--surface)",
    }}>
      <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: color }} />
      {label}
    </span>
  );
}

function SectionTitle({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
      <h2 style={{ margin: 0, fontSize: 18, lineHeight: 1.2, color: P.text, letterSpacing: 0, fontWeight: 760 }}>{title}</h2>
      {action}
    </div>
  );
}

function EmptyLine({ children }: { children: string }) {
  return <p style={{ margin: 0, color: P.muted, fontSize: 14 }}>{children}</p>;
}

function ContractSection({
  goal,
  parentGoal,
  goalKind,
  onPatch,
  onCreateItem,
  onUpdateItem,
  onRecordEvidence,
}: {
  goal: OrchestrationCompanyGoal;
  parentGoal: OrchestrationCompanyGoal | null;
  goalKind: "company" | "sprint";
  onPatch: (patch: GoalPatch) => void;
  onCreateItem: (sprintId: string, kind: OrchestrationGoalContractItem["kind"], text: string) => void;
  onUpdateItem: (item: OrchestrationGoalContractItem, patch: { text?: string; archived?: boolean }) => void;
  onRecordEvidence: (item: OrchestrationGoalContractItem, status: "passed" | "retracted") => void;
}) {
  const [stopDraft, setStopDraft] = useState(goal.sprint.stopCondition ?? "");
  const [summaryDraft, setSummaryDraft] = useState(goal.sprint.progressSummary ?? "");
  const items = goal.sprint.contractItems ?? [];
  const successCriteria = items.filter((item) => item.kind === "success_criterion");
  const validationChecks = items.filter((item) => item.kind === "validation_check");
  const outOfScope = items.filter((item) => item.kind === "out_of_scope");
  const inheritedEngine = parentGoal?.sprint.defaultExecutionEngine ?? "hiverunner";
  const inheritedLane = parentGoal?.sprint.defaultModelLane ?? "default";

  const saveStopCondition = () => {
    const next = stopDraft.trim();
    if (next !== (goal.sprint.stopCondition ?? "")) onPatch({ stopCondition: next });
  };

  const saveSummary = () => {
    const next = summaryDraft.trim();
    if (next !== (goal.sprint.progressSummary ?? "")) onPatch({ progressSummary: next });
  };

  return (
    <section style={{
      marginTop: 26,
      border: "1px solid var(--border)",
      borderRadius: 8,
      background: P.card,
      padding: 16,
      display: "grid",
      gap: 16,
      maxWidth: 980,
    }}>
      <div>
        <h2 style={{ margin: 0, color: P.text, fontSize: 16, fontWeight: 760 }}>Contract</h2>
        <p style={{ margin: "4px 0 0", color: P.muted, fontSize: 12 }}>
          {goalKind === "company"
            ? "The operator-approved bounds this goal is measured against."
            : "This sprint inherits the company goal context and can refine its own execution defaults."}
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
        <label style={contractFieldStyle}>
          <span>Stop condition</span>
          <textarea
            value={stopDraft}
            onChange={(event) => setStopDraft(event.target.value)}
            onBlur={saveStopCondition}
            rows={3}
            placeholder="When should the lead stop and return to the operator?"
            style={{ ...draftInputStyle, resize: "vertical", minHeight: 78 }}
          />
        </label>
        <div style={{ display: "grid", gap: 10 }}>
          <label style={contractFieldStyle}>
            <span>Default execution engine</span>
            <select
              value={goal.sprint.defaultExecutionEngine ?? ""}
              onChange={(event) => onPatch({ defaultExecutionEngine: event.target.value ? event.target.value as TaskExecutionEngine : null })}
              style={draftInputStyle}
            >
              <option value="">{goalKind === "sprint" ? `Inherit (${inheritedEngine})` : "Use project default"}</option>
              {EXECUTION_ENGINE_OPTIONS.map((engine) => <option key={engine} value={engine}>{engine}</option>)}
            </select>
          </label>
          <label style={contractFieldStyle}>
            <span>Default model lane</span>
            <select
              value={goal.sprint.defaultModelLane ?? ""}
              onChange={(event) => onPatch({ defaultModelLane: event.target.value ? event.target.value as TaskModelLane : null })}
              style={draftInputStyle}
            >
              <option value="">{goalKind === "sprint" ? `Inherit (${inheritedLane})` : "Use project default"}</option>
              {MODEL_LANE_OPTIONS.map((lane) => <option key={lane} value={lane}>{lane}</option>)}
            </select>
          </label>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
        <ContractItemList
          title="Success criteria"
          empty="No success criteria yet."
          items={successCriteria}
          kind="success_criterion"
          checkable
          onAdd={(text) => onCreateItem(goal.sprint.id, "success_criterion", text)}
          onUpdate={onUpdateItem}
          onEvidence={onRecordEvidence}
        />
        <ContractItemList
          title="Validation checks"
          empty="No validation checks yet."
          items={validationChecks}
          kind="validation_check"
          checkable
          onAdd={(text) => onCreateItem(goal.sprint.id, "validation_check", text)}
          onUpdate={onUpdateItem}
          onEvidence={onRecordEvidence}
        />
        <ContractItemList
          title="Out of scope"
          empty="No boundaries called out yet."
          items={outOfScope}
          kind="out_of_scope"
          onAdd={(text) => onCreateItem(goal.sprint.id, "out_of_scope", text)}
          onUpdate={onUpdateItem}
          onEvidence={onRecordEvidence}
        />
      </div>

      <label style={contractFieldStyle}>
        <span>Progress summary</span>
        <textarea
          value={summaryDraft}
          onChange={(event) => setSummaryDraft(event.target.value)}
          onBlur={saveSummary}
          rows={3}
          placeholder="Latest agent-maintained checkpoint for this goal."
          style={{ ...draftInputStyle, resize: "vertical", minHeight: 78 }}
        />
      </label>
    </section>
  );
}

function ContractItemList({
  title,
  empty,
  items,
  checkable,
  onAdd,
  onUpdate,
  onEvidence,
}: {
  title: string;
  empty: string;
  items: OrchestrationGoalContractItem[];
  kind: OrchestrationGoalContractItem["kind"];
  checkable?: boolean;
  onAdd: (text: string) => void;
  onUpdate: (item: OrchestrationGoalContractItem, patch: { text?: string; archived?: boolean }) => void;
  onEvidence: (item: OrchestrationGoalContractItem, status: "passed" | "retracted") => void;
}) {
  const [draft, setDraft] = useState("");
  const addItem = () => {
    const next = draft.trim();
    if (!next) return;
    onAdd(next);
    setDraft("");
  };

  return (
    <div style={{ display: "grid", gap: 8, alignContent: "start" }}>
      <h3 style={{ margin: 0, color: P.textSec, fontSize: 13, fontWeight: 720 }}>{title}</h3>
      {items.length === 0 ? <p style={{ margin: 0, color: P.muted, fontSize: 12 }}>{empty}</p> : null}
      {items.map((item) => (
        <ContractItemRow
          key={`${item.id}:${item.updatedAt}`}
          item={item}
          checkable={checkable}
          onUpdate={onUpdate}
          onEvidence={onEvidence}
        />
      ))}
      <div style={{ display: "flex", gap: 6 }}>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") addItem();
          }}
          placeholder={`Add ${title.toLowerCase()}`}
          style={{ ...draftInputStyle, minWidth: 0, flex: 1 }}
        />
        <button type="button" onClick={addItem} style={{ ...secondaryButtonStyle, padding: "7px 8px" }} aria-label={`Add ${title.toLowerCase()}`}>
          <Plus size={14} />
        </button>
      </div>
    </div>
  );
}

function ContractItemRow({
  item,
  checkable,
  onUpdate,
  onEvidence,
}: {
  item: OrchestrationGoalContractItem;
  checkable?: boolean;
  onUpdate: (item: OrchestrationGoalContractItem, patch: { text?: string; archived?: boolean }) => void;
  onEvidence: (item: OrchestrationGoalContractItem, status: "passed" | "retracted") => void;
}) {
  const [draft, setDraft] = useState(item.text);
  const passed = item.latestEvidence?.status === "passed";

  const saveText = () => {
    const next = draft.trim();
    if (next && next !== item.text) onUpdate(item, { text: next });
    if (!next) setDraft(item.text);
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: checkable ? "18px minmax(0, 1fr) 24px" : "minmax(0, 1fr) 24px", gap: 8, alignItems: "center" }}>
      {checkable ? (
        <input
          type="checkbox"
          checked={passed}
          onChange={(event) => onEvidence(item, event.target.checked ? "passed" : "retracted")}
          aria-label={passed ? "Retract evidence" : "Confirm evidence"}
        />
      ) : null}
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={saveText}
        style={{ ...draftInputStyle, padding: "6px 8px", minWidth: 0 }}
      />
      <button
        type="button"
        onClick={() => onUpdate(item, { archived: true })}
        style={{ border: "none", background: "transparent", color: P.muted, cursor: "pointer", padding: 2 }}
        aria-label="Remove contract item"
      >
        <X size={13} />
      </button>
    </div>
  );
}

function normalizeDraftAssigneeLookup(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function stripAgentRoleSuffix(value: string) {
  return value.replace(/-(lead|research|researcher|qa|quality|planner|planning|orchestrator|engineer|specialist|runner|agent)$/i, "");
}

function resolveDraftAssignee(value: string | null | undefined, agents: OrchestrationAgent[]) {
  const raw = value?.trim();
  if (!raw) return { agent: null, unresolved: null };
  const normalized = normalizeDraftAssigneeLookup(raw);
  const agent = agents.find((candidate) => candidate.id === raw)
    ?? agents.find((candidate) => candidate.name.toLowerCase() === raw.toLowerCase())
    ?? agents.find((candidate) => normalizeDraftAssigneeLookup(candidate.slug) === normalized)
    ?? agents.find((candidate) => stripAgentRoleSuffix(normalizeDraftAssigneeLookup(candidate.slug)) === normalized)
    ?? null;
  return { agent, unresolved: agent ? null : raw };
}

function splitDraftListInput(value: string) {
  return value.split(/\n|;/).map((item) => item.trim()).filter(Boolean);
}

function SprintPlanDraftPanel({
  drafts,
  agents,
  focusedDraftId,
  onUpdate,
  onApprove,
  onApproveAll,
  onReject,
}: {
  drafts: OrchestrationSprintPlanDraft[];
  agents: OrchestrationAgent[];
  focusedDraftId: string | null;
  onUpdate: (draftId: string, sprint: OrchestrationSprintPlanDraftSprint, tasks: OrchestrationSprintPlanDraftTask[]) => Promise<void> | void;
  onApprove: (draftId: string, sprint: OrchestrationSprintPlanDraftSprint, tasks: OrchestrationSprintPlanDraftTask[]) => void;
  onApproveAll: (draftId: string) => void;
  onReject: (draftId: string, reason: string) => void;
}) {
  const orderedDrafts = drafts.slice().sort((a, b) => a.sequenceNumber - b.sequenceNumber || a.createdAt.localeCompare(b.createdAt));
  const nextApprovableSequence = orderedDrafts[0]?.sequenceNumber ?? 1;
  const totalTasks = orderedDrafts.reduce((sum, draft) => sum + draft.tasks.length, 0);
  const completionProposalCount = orderedDrafts.filter((draft) => draft.sprint.completionProposal).length;
  const sprintDraftCount = orderedDrafts.length - completionProposalCount;
  const nextDraft = orderedDrafts.find((draft) => !draft.sprint.completionProposal);
  const [approvalPrompt, setApprovalPrompt] = useState<{
    kind: "next_sprint" | "all_sprints";
    draft: OrchestrationSprintPlanDraft;
  } | null>(null);
  return (
    <section style={{
      marginBottom: 26,
      border: "1px solid var(--border)",
      borderRadius: 8,
      background: P.card,
      padding: 14,
      display: "grid",
      gap: 12,
    }}>
      <div style={{
        position: "sticky",
        top: -22,
        zIndex: 4,
        display: "flex",
        justifyContent: "space-between",
        gap: 10,
        alignItems: "flex-start",
        margin: "-14px -14px 0",
        padding: "10px 14px",
        background: "color-mix(in srgb, var(--surface) 96%, transparent)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        borderBottom: "1px solid var(--border)",
        boxShadow: "0 10px 22px rgba(0,0,0,0.22)",
      }} data-sprint-plan-sticky-header="true">
        <div style={{ minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: 15, color: P.text, fontWeight: 740, lineHeight: 1.2 }}>
            Plan: {sprintDraftCount} sprints proposed, {totalTasks} total tasks{completionProposalCount > 0 ? " + completion review" : ""}
          </h2>
          <p style={{ margin: "3px 0 0", color: P.muted, fontSize: 11, lineHeight: 1.35 }}>
            Review the full goal arc. Approve sprints sequentially; later sprints remain visible and editable before their turn.
          </p>
        </div>
        {nextDraft ? (
          <div style={{ display: "inline-flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end", flexShrink: 0 }}>
            {sprintDraftCount > 1 ? (
              <button
                type="button"
                onClick={() => setApprovalPrompt({ kind: "all_sprints", draft: nextDraft })}
                style={{ ...secondaryButtonStyle, padding: "7px 9px", fontSize: 11 }}
              >
                Materialize all sprints
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setApprovalPrompt({ kind: "next_sprint", draft: nextDraft })}
              style={{ ...primaryButtonStyle, padding: "7px 9px", fontSize: 11 }}
            >
              Approve roadmap + Sprint {nextDraft.sequenceNumber}
            </button>
          </div>
        ) : null}
      </div>
      {orderedDrafts.map((draft) => (
        <SprintPlanDraftCard
          key={draft.id}
          draft={draft}
          agents={agents}
          focused={focusedDraftId === draft.id}
          approveEnabled={draft.sequenceNumber === nextApprovableSequence || Boolean(draft.sprint.completionProposal)}
          onUpdate={onUpdate}
          onApprove={onApprove}
          onReject={onReject}
        />
      ))}
      {approvalPrompt ? (
        <SprintPlanApprovalDialog
          kind={approvalPrompt.kind}
          draft={approvalPrompt.draft}
          sprintCount={sprintDraftCount}
          totalTasks={totalTasks}
          onCancel={() => setApprovalPrompt(null)}
          onConfirm={() => {
            const { kind, draft } = approvalPrompt;
            setApprovalPrompt(null);
            if (kind === "all_sprints") {
              onApproveAll(draft.id);
            } else {
              onApprove(draft.id, draft.sprint, draft.tasks);
            }
          }}
        />
      ) : null}
    </section>
  );
}

function SprintPlanApprovalDialog({
  kind,
  draft,
  sprintCount,
  totalTasks,
  onCancel,
  onConfirm,
}: {
  kind: "next_sprint" | "all_sprints";
  draft: OrchestrationSprintPlanDraft;
  sprintCount: number;
  totalTasks: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const isBulk = kind === "all_sprints";
  const laterDraftCount = Math.max(0, sprintCount - 1);
  const title = isBulk ? "Materialize every sprint now?" : `Approve Sprint ${draft.sequenceNumber}?`;
  const primaryLabel = isBulk ? "Materialize all" : `Approve roadmap + Sprint ${draft.sequenceNumber}`;

  return (
    <div
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
      style={approvalModalBackdropStyle}
    >
      <section role="dialog" aria-modal="true" aria-labelledby="sprint-plan-approval-title" style={approvalModalPanelStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 14 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: P.muted, fontSize: 11, fontWeight: 760, letterSpacing: "0.12em", textTransform: "uppercase" }}>
              Sprint approval
            </div>
            <h2 id="sprint-plan-approval-title" style={{ margin: "6px 0 0", color: P.text, fontSize: 18, lineHeight: 1.2 }}>
              {title}
            </h2>
          </div>
          <button type="button" aria-label="Close approval dialog" onClick={onCancel} style={approvalIconButtonStyle}>
            <X size={16} />
          </button>
        </div>

        <div style={{ border: "0.5px solid var(--border)", borderRadius: 10, padding: 12, background: "var(--surface-recessed)", display: "grid", gap: 8 }}>
          <div style={{ color: P.text, fontSize: 14, fontWeight: 720 }}>{draft.sprint.name}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
            <ApprovalMetric label={isBulk ? "Sprints" : "Approving"} value={isBulk ? String(sprintCount) : `Sprint ${draft.sequenceNumber}`} />
            <ApprovalMetric label={isBulk ? "Total tasks" : "Sprint tasks"} value={isBulk ? String(totalTasks) : String(draft.tasks.length)} />
            <ApprovalMetric label="Later drafts" value={isBulk ? "Used now" : `${laterDraftCount} editable`} />
          </div>
        </div>

        <p style={{ margin: 0, color: P.textSec, fontSize: 13, lineHeight: 1.45 }}>
          {isBulk
            ? "This creates every sprint and every proposed task immediately. Use it only when you want to skip later sprint-by-sprint revision."
            : `This approves the roadmap shape and creates only Sprint ${draft.sequenceNumber}'s ${draft.tasks.length} ${draft.tasks.length === 1 ? "task" : "tasks"}. Later sprint drafts stay visible and editable after this sprint teaches us what needs to change.`}
        </p>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" onClick={onCancel} style={approvalSecondaryButtonStyle}>Not yet</button>
          <button type="button" onClick={onConfirm} style={isBulk ? approvalWarningButtonStyle : approvalPrimaryButtonStyle}>{primaryLabel}</button>
        </div>
      </section>
    </div>
  );
}

function ApprovalMetric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: "0.5px solid var(--border)", borderRadius: 8, padding: "8px 9px", background: "var(--surface)", minWidth: 0 }}>
      <div style={{ color: P.muted, fontSize: 10, fontWeight: 720, letterSpacing: "0.08em", textTransform: "uppercase" }}>{label}</div>
      <div style={{ color: P.text, fontSize: 13, fontWeight: 740, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</div>
    </div>
  );
}

function DraftStringList({
  title,
  items,
  onChange,
}: {
  title: string;
  items: string[];
  onChange: (items: string[]) => void;
}) {
  const [draft, setDraft] = useState(items.join("\n"));

  useEffect(() => {
    setDraft(items.join("\n"));
  }, [items]);

  const rows = Math.min(10, Math.max(3, items.length + 1));

  return (
    <label style={draftFieldStyle}>
      <span>{title}</span>
      {items.length > 0 ? (
        <ul style={{ margin: "0 0 6px 16px", padding: 0, color: P.textSec, fontSize: 12, lineHeight: 1.45, display: "grid", gap: 4 }}>
          {items.map((item, index) => <li key={`${item}:${index}`}>{item}</li>)}
        </ul>
      ) : (
        <span style={{ color: P.muted, fontSize: 12 }}>No items proposed.</span>
      )}
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => onChange(splitDraftListInput(draft))}
        rows={rows}
        style={{ ...draftInputStyle, resize: "vertical", lineHeight: 1.45 }}
        aria-label={`${title} editor`}
      />
    </label>
  );
}

function SprintPlanDraftCard({
  draft,
  agents,
  focused,
  approveEnabled,
  onUpdate,
  onApprove,
  onReject,
}: {
  draft: OrchestrationSprintPlanDraft;
  agents: OrchestrationAgent[];
  focused: boolean;
  approveEnabled: boolean;
  onUpdate: (draftId: string, sprint: OrchestrationSprintPlanDraftSprint, tasks: OrchestrationSprintPlanDraftTask[]) => Promise<void> | void;
  onApprove: (draftId: string, sprint: OrchestrationSprintPlanDraftSprint, tasks: OrchestrationSprintPlanDraftTask[]) => void;
  onReject: (draftId: string, reason: string) => void;
}) {
  const [sprint, setSprint] = useState<OrchestrationSprintPlanDraftSprint>(draft.sprint);
  const [draftTasks, setDraftTasks] = useState<OrchestrationSprintPlanDraftTask[]>(draft.tasks);
  const [rejectReason, setRejectReason] = useState("");
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftSaveError, setDraftSaveError] = useState<string | null>(null);
  const isCompletionProposal = Boolean(draft.sprint.completionProposal);
  const [expanded, setExpanded] = useState(() => approveEnabled || isCompletionProposal);

  useEffect(() => {
    setSprint(draft.sprint);
    setDraftTasks(draft.tasks);
    setExpanded(approveEnabled || Boolean(draft.sprint.completionProposal));
  }, [approveEnabled, draft]);

  useEffect(() => {
    if (focused) setExpanded(true);
  }, [focused]);

  const persistDraft = async (
    nextSprint: OrchestrationSprintPlanDraftSprint,
    nextTasks: OrchestrationSprintPlanDraftTask[],
  ) => {
    setSavingDraft(true);
    setDraftSaveError(null);
    try {
      await onUpdate(draft.id, nextSprint, nextTasks);
    } catch {
      setDraftSaveError("Draft changes could not be saved.");
    } finally {
      setSavingDraft(false);
    }
  };

  const updateSprintAndPersist = (patch: Partial<OrchestrationSprintPlanDraftSprint>) => {
    const nextSprint = { ...sprint, ...patch };
    setSprint(nextSprint);
    void persistDraft(nextSprint, draftTasks);
  };

  const updateTask = (taskId: string, patch: Partial<OrchestrationSprintPlanDraftTask>, persist = false) => {
    const nextTasks = draftTasks.map((task) => (task.id === taskId ? { ...task, ...patch } : task));
    setDraftTasks(nextTasks);
    if (persist) void persistDraft(sprint, nextTasks);
  };

  const setSprintDefaultEngine = (engine: TaskExecutionEngine) => {
    const nextSprint = { ...sprint, defaultExecutionEngine: engine };
    const nextTasks = draftTasks.map((task) => ({ ...task, executionEngine: engine }));
    setSprint(nextSprint);
    setDraftTasks(nextTasks);
    void persistDraft(nextSprint, nextTasks);
  };

  const setSprintDefaultLane = (lane: TaskModelLane) => {
    const nextSprint = { ...sprint, defaultModelLane: lane };
    const nextTasks = draftTasks.map((task) => ({ ...task, modelLane: lane }));
    setSprint(nextSprint);
    setDraftTasks(nextTasks);
    void persistDraft(nextSprint, nextTasks);
  };

  return (
    <div id={sprintPlanDraftAnchorId(draft.id)} style={{
      border: "1px solid var(--border)",
      borderRadius: 8,
      background: "var(--surface-recessed)",
      padding: 13,
      display: "grid",
      gap: 11,
      scrollMarginTop: 110,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          style={{
            appearance: "none",
            border: 0,
            background: "transparent",
            color: "inherit",
            padding: 0,
            display: "grid",
            gap: 4,
            minWidth: 0,
            textAlign: "left",
            cursor: "pointer",
          }}
        >
          <h3 style={{ margin: 0, fontSize: 14, color: P.text, fontWeight: 760 }}>
            {isCompletionProposal ? "Goal completion proposal" : `Sprint ${draft.sequenceNumber}: ${draft.sprint.name}`}
          </h3>
          <p style={{ margin: "4px 0 0", color: P.muted, fontSize: 12 }}>
            {isCompletionProposal
              ? "Lead agent believes the goal is complete. Operator approval is required."
              : approveEnabled ? "Ready for approval." : "Awaiting earlier sprint approval."}
          </p>
        </button>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <span style={{ color: P.muted, fontSize: 11 }}>{isCompletionProposal ? "completion review" : `${draft.tasks.length} proposed tasks`}</span>
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            style={{
              height: 26,
              padding: "0 9px",
              borderRadius: 7,
              border: "0.5px solid var(--border)",
              background: "var(--surface)",
              color: P.textSec,
              fontSize: 12,
              fontWeight: 650,
              cursor: "pointer",
            }}
          >
            {expanded ? "Collapse" : "Review"}
          </button>
        </div>
      </div>

      {!expanded ? (
        <div style={{
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: 10,
          color: P.textSec,
          fontSize: 12,
          lineHeight: 1.5,
          display: "grid",
          gap: 8,
        }}>
          <p style={{ margin: 0 }}>{sprint.objective || "No objective proposed."}</p>
          {!isCompletionProposal && draftTasks.length > 0 ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {draftTasks.slice(0, 4).map((task) => (
                <span
                  key={task.id}
                  title={task.title}
                  style={{
                    maxWidth: 260,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    border: "0.5px solid var(--border)",
                    borderRadius: 999,
                    padding: "3px 7px",
                    background: "var(--surface)",
                    color: P.textSec,
                  }}
                >
                  {task.title}
                </span>
              ))}
              {draftTasks.length > 4 ? <span style={{ color: P.muted, padding: "3px 0" }}>+{draftTasks.length - 4} more</span> : null}
            </div>
          ) : null}
        </div>
      ) : (
      <>
      <div style={{ display: "grid", gap: 10 }}>
        <label style={draftFieldStyle}>
          <span>Sprint name</span>
          <input value={sprint.name} onChange={(event) => setSprint((prev) => ({ ...prev, name: event.target.value }))} onBlur={() => void persistDraft(sprint, draftTasks)} style={draftInputStyle} />
        </label>
        <label style={draftFieldStyle}>
          <span>Objective</span>
          <textarea value={sprint.objective} onChange={(event) => setSprint((prev) => ({ ...prev, objective: event.target.value }))} onBlur={() => void persistDraft(sprint, draftTasks)} rows={4} style={{ ...draftInputStyle, resize: "vertical", lineHeight: 1.45 }} />
        </label>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1.15fr) minmax(0, 1fr) minmax(0, 0.9fr)",
            gap: 10,
            alignItems: "end",
            minWidth: 0,
          }}
        >
          <label style={draftFieldStyle}>
            <span>Owner</span>
            <select value={sprint.owner ?? ""} onChange={(event) => updateSprintAndPersist({ owner: event.target.value || null })} style={draftInputStyle}>
              <option value="">Unassigned</option>
              {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} - {agent.role}</option>)}
            </select>
          </label>
          <label style={draftFieldStyle}>
            <span>Sprint default execution engine</span>
            <select
              value={sprint.defaultExecutionEngine ?? "hiverunner"}
              onChange={(event) => setSprintDefaultEngine(event.target.value as TaskExecutionEngine)}
              style={draftInputStyle}
            >
              {EXECUTION_ENGINE_OPTIONS.map((engine) => <option key={engine} value={engine}>{engine}</option>)}
            </select>
          </label>
          <label style={draftFieldStyle}>
            <span>Sprint default model lane</span>
            <select
              value={sprint.defaultModelLane ?? "default"}
              onChange={(event) => setSprintDefaultLane(event.target.value as TaskModelLane)}
              style={draftInputStyle}
            >
              {MODEL_LANE_OPTIONS.map((lane) => <option key={lane} value={lane}>{lane}</option>)}
            </select>
          </label>
        </div>
        {savingDraft || draftSaveError ? (
          <p style={{ margin: 0, color: draftSaveError ? "#ef4444" : P.muted, fontSize: 11 }}>
            {draftSaveError ?? "Saving draft defaults..."}
          </p>
        ) : null}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
          <DraftStringList
            title="Success criteria"
            items={sprint.successCriteria ?? []}
            onChange={(items) => updateSprintAndPersist({ successCriteria: items })}
          />
          <DraftStringList
            title="Validation checks"
            items={sprint.validationChecks ?? []}
            onChange={(items) => updateSprintAndPersist({ validationChecks: items })}
          />
          <DraftStringList
            title="Out of scope"
            items={sprint.outOfScope ?? []}
            onChange={(items) => updateSprintAndPersist({ outOfScope: items })}
          />
        </div>
      </div>

      {isCompletionProposal ? (
        <div style={{
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: 10,
          color: P.textSec,
          fontSize: 13,
          lineHeight: 1.5,
        }}>
          {sprint.completionReason ?? sprint.objective}
        </div>
      ) : (
      <div style={{ display: "grid", gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 13, color: P.textSec, fontWeight: 720 }}>Proposed tasks</h3>
        {draftTasks.map((task) => {
          const assigneeResolution = resolveDraftAssignee(task.assignee, agents);
          const selectedAssignee = assigneeResolution.agent?.id ?? "";
          const descriptionRows = Math.min(12, Math.max(4, (task.description ?? "").split("\n").length + Math.ceil((task.description ?? "").length / 88)));
          const engineOverridesDefault = Boolean(sprint.defaultExecutionEngine && task.executionEngine && task.executionEngine !== sprint.defaultExecutionEngine);
          const laneOverridesDefault = Boolean(sprint.defaultModelLane && task.modelLane && task.modelLane !== sprint.defaultModelLane);
          return (
            <div key={task.id} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 10, display: "grid", gap: 8 }}>
              <input value={task.title} onChange={(event) => updateTask(task.id, { title: event.target.value })} onBlur={() => void persistDraft(sprint, draftTasks)} style={{ ...draftInputStyle, fontWeight: 700, color: P.text }} />
              <textarea
                value={task.description ?? ""}
                onChange={(event) => updateTask(task.id, { description: event.target.value })}
                onBlur={() => void persistDraft(sprint, draftTasks)}
                rows={descriptionRows}
                style={{ ...draftInputStyle, resize: "vertical", lineHeight: 1.45, maxHeight: 260, overflowY: "auto" }}
              />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
                <label style={draftFieldStyle}>
                  <span>Assignee</span>
                  <select value={selectedAssignee} onChange={(event) => updateTask(task.id, { assignee: event.target.value || null }, true)} style={draftInputStyle}>
                    <option value="">Unassigned</option>
                    {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                  </select>
                  {assigneeResolution.unresolved ? <span style={{ color: "#f59e0b", fontSize: 11 }}>Could not resolve {assigneeResolution.unresolved}</span> : null}
                </label>
                <label style={draftFieldStyle}>
                  <span>Priority</span>
                  <select value={task.priority ?? "P2"} onChange={(event) => updateTask(task.id, { priority: event.target.value as OrchestrationSprintPlanDraftTask["priority"] }, true)} style={draftInputStyle}>
                    {["P0", "P1", "P2", "P3"].map((priority) => <option key={priority} value={priority}>{priority}</option>)}
                  </select>
                </label>
                <label style={draftFieldStyle}>
                  <span>Type</span>
                  <select value={task.type ?? "feature"} onChange={(event) => updateTask(task.id, { type: event.target.value as OrchestrationSprintPlanDraftTask["type"] }, true)} style={draftInputStyle}>
                    {["feature", "bug", "research", "epic", "spike", "docs", "infra", "refactor", "review", "qa", "release"].map((type) => <option key={type} value={type}>{type}</option>)}
                  </select>
                </label>
                <label style={draftFieldStyle}>
                  <span>Engine</span>
                  <select value={task.executionEngine ?? sprint.defaultExecutionEngine ?? "hiverunner"} onChange={(event) => updateTask(task.id, { executionEngine: event.target.value as OrchestrationSprintPlanDraftTask["executionEngine"] }, true)} style={draftInputStyle}>
                    {EXECUTION_ENGINE_OPTIONS.map((engine) => <option key={engine} value={engine}>{engine}</option>)}
                  </select>
                  {engineOverridesDefault ? <span style={{ color: "#f59e0b", fontSize: 11 }}>Overrides sprint default</span> : null}
                </label>
                <label style={draftFieldStyle}>
                  <span>Model lane</span>
                  <select value={task.modelLane ?? sprint.defaultModelLane ?? "default"} onChange={(event) => updateTask(task.id, { modelLane: event.target.value as OrchestrationSprintPlanDraftTask["modelLane"] }, true)} style={draftInputStyle}>
                    {MODEL_LANE_OPTIONS.map((lane) => <option key={lane} value={lane}>{lane}</option>)}
                  </select>
                  {laneOverridesDefault ? <span style={{ color: "#f59e0b", fontSize: 11 }}>Overrides sprint default</span> : null}
                </label>
              </div>
              <textarea value={task.validation ?? ""} onChange={(event) => updateTask(task.id, { validation: event.target.value })} onBlur={() => void persistDraft(sprint, draftTasks)} placeholder="Task validation" rows={3} style={{ ...draftInputStyle, resize: "vertical", lineHeight: 1.45 }} />
            </div>
          );
        })}
      </div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
        <label style={{ ...draftFieldStyle, maxWidth: 320 }}>
          <span>Reject reason</span>
          <input
            value={rejectReason}
            onChange={(event) => setRejectReason(event.target.value)}
            placeholder="Rejection reason"
            style={draftInputStyle}
          />
          <span style={{ color: P.muted, fontSize: 11 }}>Reason required when rejecting.</span>
        </label>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={() => onReject(draft.id, rejectReason.trim())} disabled={!rejectReason.trim()} style={dangerGhostButtonStyle}>Reject</button>
          <button
            type="button"
            onClick={() => onApprove(draft.id, sprint, draftTasks)}
            disabled={!approveEnabled}
            title={approveEnabled ? (isCompletionProposal ? "Approve goal completion" : "Approve this sprint") : "Awaiting earlier sprint approval"}
            style={approveEnabled ? secondaryButtonStyle : disabledButtonStyle}
          >
            Edit and approve sprint
          </button>
          <button
            type="button"
            onClick={() => onApprove(draft.id, sprint, draftTasks)}
            disabled={!approveEnabled}
            title={approveEnabled ? (isCompletionProposal ? "Approve goal completion as proposed" : "Approve this sprint as proposed") : "Awaiting earlier sprint approval"}
            style={approveEnabled ? primaryButtonStyle : disabledButtonStyle}
          >
            Approve sprint as proposed
          </button>
        </div>
      </div>
      </>
      )}
    </div>
  );
}

function GoalSidebar({
  goal,
  agents,
  supportingSprints,
  pendingDrafts,
  focusedDraftId,
  onPatch,
  onArchive,
  onDelete,
  onDraftJump,
}: {
  goal: OrchestrationCompanyGoal;
  agents: OrchestrationAgent[];
  supportingSprints: OrchestrationCompanyGoal[];
  pendingDrafts: OrchestrationSprintPlanDraft[];
  focusedDraftId: string | null;
  onPatch: (patch: GoalPatch) => void;
  onArchive: () => void;
  onDelete: () => void;
  onDraftJump: (draftId: string) => void;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const percent = Math.round(goal.completionPercent ?? 0);
  const planTaskCount = goal.planTaskCount ?? goal.sprint.taskCount;
  const planDoneTaskCount = goal.planDoneTaskCount ?? goal.sprint.doneCount;
  const hasPlan = goal.planHasTasks ?? planTaskCount > 0;
  const sprintLevel = goal.planSprintCount && goal.planSprintCount > 0
    ? `Sprint ${Math.min((goal.planDoneSprintCount ?? 0) + 1, goal.planSprintCount)} of ${goal.planSprintCount}`
    : "Plan not yet proposed";
  const orderedPendingDrafts = pendingDrafts
    .filter((draft) => !draft.sprint.completionProposal)
    .slice()
    .sort((a, b) => a.sequenceNumber - b.sequenceNumber || a.createdAt.localeCompare(b.createdAt));
  const selectedDraftId = focusedDraftId ?? orderedPendingDrafts[0]?.id ?? null;
  const leadAgent = goal.sprint.leadAgentId
    ? agents.find((agent) => agent.id === goal.sprint.leadAgentId) ?? null
    : null;
  const orderedSupportingSprints = supportingSprints.slice().sort(sortGoals);
  const activeSprint = orderedSupportingSprints.find((sprint) => sprint.sprint.status === "active") ?? null;
  const reviewSprint = orderedSupportingSprints.find((sprint) => sprint.sprint.reviewCount > 0) ?? null;
  const lastCompletedSprint = orderedSupportingSprints
    .filter((sprint) => sprint.sprint.status === "done")
    .sort((a, b) => new Date(b.sprint.updated).getTime() - new Date(a.sprint.updated).getTime())[0] ?? null;
  const nextPendingDraft = orderedPendingDrafts.find((draft) => !draft.sprint.completionProposal) ?? null;
  const currentSprintForDecision = activeSprint ?? reviewSprint ?? lastCompletedSprint;
  const wrapSprint = lastCompletedSprint ?? reviewSprint ?? activeSprint ?? null;
  const wrapTaskCount = wrapSprint?.sprint.taskCount ?? 0;
  const wrapDoneCount = wrapSprint?.sprint.doneCount ?? 0;
  const wrapOpenCount = wrapSprint ? Math.max(wrapTaskCount - wrapDoneCount, 0) : 0;
  const wrapPercent = wrapTaskCount > 0 ? Math.round((wrapDoneCount / wrapTaskCount) * 100) : 0;
  const wrapSummary = wrapSprint?.sprint.progressSummary?.trim();
  const wrapLabel = wrapSprint?.sprint.sprintKey ?? (nextPendingDraft ? `Sprint ${nextPendingDraft.sequenceNumber}` : "");
  const wrapState = lastCompletedSprint
    ? "Ready for next sprint"
    : reviewSprint
      ? "Review before wrap-up"
      : activeSprint
        ? "Sprint in flight"
        : "Waiting for Sprint 1";
  const wrapDecision = lastCompletedSprint
    ? nextPendingDraft
      ? `Review Sprint ${nextPendingDraft.sequenceNumber}'s draft, apply what changed, then approve the next sprint.`
      : "All planned sprint drafts have been used. Decide whether this goal is complete or needs a new sprint."
    : reviewSprint
      ? "Clear review items first. The sprint should not roll forward until review is resolved."
      : activeSprint
        ? "Let execution finish, then use this wrap-up to decide whether Sprint 2 needs revision."
        : nextPendingDraft
          ? `Approve roadmap + Sprint ${nextPendingDraft.sequenceNumber} to start execution while later drafts stay editable.`
          : "Create or request a sprint plan before execution starts.";
  const decisionState = activeSprint
    ? "Sprint executing"
    : reviewSprint
      ? "Sprint in review"
      : lastCompletedSprint
        ? "Sprint wrapped"
        : nextPendingDraft
          ? "Draft ready"
          : "No active sprint";

  return (
    <aside style={{
      width: 318,
      flexShrink: 0,
      height: "100%",
      background: "var(--background)",
      padding: "8px 12px 10px 0",
      overflow: "hidden",
    }}>
      <div
        className="task-detail-scrollbarless"
        style={{
          height: "100%",
          overflowY: "auto",
          background: P.card,
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: "14px 15px",
          display: "grid",
          gap: 14,
        }}
      >
        <SidebarSection title="Planning">
          <div style={{ display: "grid", gap: 7 }}>
          <CompactDetailField label="Status">
            <GoalStatusPill status={goal.sprint.status} />
          </CompactDetailField>
          <CompactDetailField label="Lead">
            <span style={{ display: "inline-flex", alignItems: "center", gap: 7, minWidth: 0, color: P.textSec, fontSize: 12 }}>
              {leadAgent ? <AgentAvatarInline agent={leadAgent} size={18} /> : null}
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{leadAgent?.name ?? "Unassigned"}</span>
            </span>
          </CompactDetailField>
          <CompactDetailField label="Window">
            <DateWindowChip sprint={goal.sprint} onChange={(startDate, endDate) => onPatch({ startDate, endDate })} />
          </CompactDetailField>
          </div>
        </SidebarSection>

        {orderedPendingDrafts.length > 0 ? (
          <SidebarSection title="Sprint plan">
            <div style={{ display: "grid", gap: 7 }}>
              <div style={{ color: P.textSec, fontSize: 12 }}>
                {orderedPendingDrafts.length} sprints / {orderedPendingDrafts.reduce((sum, draft) => sum + draft.tasks.length, 0)} tasks proposed
              </div>
              {orderedPendingDrafts.map((draft, index) => {
                const selected = draft.id === selectedDraftId;
                return (
                <button
                  key={draft.id}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onDraftJump(draft.id)}
                  style={{
                    appearance: "none",
                    width: "100%",
                    textAlign: "left",
                    border: selected ? "1px solid color-mix(in srgb, #60a5fa 70%, var(--border))" : "0.5px solid var(--border)",
                    borderRadius: 8,
                    padding: "8px 9px",
                    background: selected ? "color-mix(in srgb, #3b82f6 12%, var(--surface-recessed))" : "var(--surface-recessed)",
                    display: "grid",
                    gap: 4,
                    cursor: "pointer",
                    boxShadow: selected ? "0 0 0 1px color-mix(in srgb, #60a5fa 34%, transparent)" : "none",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                    <span style={{ color: P.text, fontSize: 12, fontWeight: 700 }}>
                      Sprint {draft.sequenceNumber}
                    </span>
                    <span style={{ color: P.muted, fontSize: 11 }}>{draft.tasks.length} tasks</span>
                  </div>
                  <div title={draft.sprint.name} style={{ color: P.textSec, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {draft.sprint.name}
                  </div>
                  <div style={{ color: index === 0 ? "color-mix(in srgb, #22c55e 72%, var(--text-primary))" : P.muted, fontSize: 11, fontWeight: index === 0 ? 650 : 400 }}>
                    {index === 0 ? "ready for approval" : "pending prior sprint"}
                  </div>
                </button>
              );
              })}
            </div>
          </SidebarSection>
        ) : null}

        <SidebarSection title="Next decision">
          <div style={decisionCardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
              <span style={{ color: P.text, fontSize: 12, fontWeight: 720 }}>{decisionState}</span>
              {currentSprintForDecision ? (
                <span style={{ color: P.muted, fontSize: 11 }}>{currentSprintForDecision.sprint.sprintKey ?? ""}</span>
              ) : null}
            </div>
            {activeSprint ? (
              <>
                <div style={{ color: P.textSec, fontSize: 12 }}>{activeSprint.sprint.name}</div>
                <div style={{ color: P.muted, fontSize: 11 }}>
                  {activeSprint.sprint.doneCount}/{activeSprint.sprint.taskCount} done · {activeSprint.sprint.inProgressCount} active · {activeSprint.sprint.reviewCount} in review
                </div>
              </>
            ) : reviewSprint ? (
              <>
                <div style={{ color: P.textSec, fontSize: 12 }}>{reviewSprint.sprint.name}</div>
                <div style={{ color: P.muted, fontSize: 11 }}>
                  {reviewSprint.sprint.reviewCount} task{reviewSprint.sprint.reviewCount === 1 ? "" : "s"} waiting for review before wrap-up.
                </div>
              </>
            ) : lastCompletedSprint ? (
              <>
                <div style={{ color: P.textSec, fontSize: 12 }}>{lastCompletedSprint.sprint.name}</div>
                <div style={{ color: P.muted, fontSize: 11 }}>
                  Wrapped with {lastCompletedSprint.sprint.doneCount}/{lastCompletedSprint.sprint.taskCount} tasks done. Review the remaining drafts before approving the next sprint.
                </div>
              </>
            ) : nextPendingDraft ? (
              <>
                <div style={{ color: P.textSec, fontSize: 12 }}>Sprint {nextPendingDraft.sequenceNumber}: {nextPendingDraft.sprint.name}</div>
                <div style={{ color: P.muted, fontSize: 11 }}>
                  Recommended: approve roadmap + Sprint {nextPendingDraft.sequenceNumber}. Later sprints remain editable.
                </div>
              </>
            ) : (
              <div style={{ color: P.muted, fontSize: 11 }}>No sprint is currently executing and no pending sprint draft is ready.</div>
            )}
          </div>
        </SidebarSection>

        <SidebarSection title="Sprint wrap-up">
          <div style={wrapUpCardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
              <span style={{ color: P.text, fontSize: 12, fontWeight: 730 }}>{wrapState}</span>
              {wrapLabel ? <span style={{ color: P.muted, fontSize: 11 }}>{wrapLabel}</span> : null}
            </div>
            <div style={{ color: P.textSec, fontSize: 12 }}>
              {wrapSprint ? wrapSprint.sprint.name : nextPendingDraft ? nextPendingDraft.sprint.name : "No sprint has executed yet."}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 6 }}>
              <WrapMetric label="Done" value={wrapSprint ? `${wrapDoneCount}/${wrapTaskCount}` : "—"} />
              <WrapMetric label="Open" value={wrapSprint ? String(wrapOpenCount) : "—"} />
              <WrapMetric label="Result" value={wrapSprint ? `${wrapPercent}%` : "—"} />
            </div>
            <GoalProgressBar value={wrapSprint ? wrapPercent : 0} />
            <div style={{ ...wrapNoteStyle, borderColor: "color-mix(in srgb, #60a5fa 28%, var(--border))" }}>
              <strong style={{ color: P.textSec }}>Sprint state:</strong>{" "}
              {wrapSprint
                ? `${wrapSprint.sprint.status === "done" ? "Completed" : wrapSprint.sprint.status === "active" ? "Executing" : "In review"} · ${wrapSprint.sprint.inProgressCount} active · ${wrapSprint.sprint.reviewCount} review`
                : "Not started yet."}
            </div>
            <div style={wrapNoteStyle}>
              <strong style={{ color: P.textSec }}>Draft state:</strong>{" "}
              {nextPendingDraft
                ? `Sprint ${nextPendingDraft.sequenceNumber} draft is editable with ${nextPendingDraft.tasks.length} proposed tasks.`
                : "No pending sprint draft is waiting."}
            </div>
            {wrapSummary ? (
              <div style={wrapNoteStyle}>
                <strong style={{ color: P.textSec }}>Summary:</strong> {wrapSummary}
              </div>
            ) : null}
            <div style={{ ...wrapNoteStyle, color: "color-mix(in srgb, #22c55e 70%, var(--text-primary))" }}>
              <strong>Decision:</strong> {wrapDecision}
            </div>
          </div>
        </SidebarSection>

        <SidebarSection title="Progress">
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", color: P.textSec, fontSize: 12 }}>
              <span>{hasPlan ? `${planDoneTaskCount} / ${planTaskCount} planned tasks done` : "Plan not yet proposed"}</span>
              <span>{hasPlan ? `${percent}%` : "—"}</span>
            </div>
            <GoalProgressBar value={percent} />
            <div style={{ color: P.muted, fontSize: 11 }}>{sprintLevel}</div>
            <div style={{ display: "flex", gap: 12, color: P.muted, fontSize: 11 }}>
              <span>{goal.sprint.inProgressCount} active</span>
              <span>{goal.sprint.reviewCount} review</span>
              <span>{hasPlan ? `${goal.remainingTasks} left` : "unplanned"}</span>
            </div>
          </div>
        </SidebarSection>

        <SidebarSection title="Metadata">
          <ReadOnlyRow label="Created" value={formatDate(goal.sprint.created)} />
          <ReadOnlyRow label="Updated" value={formatDate(goal.sprint.updated)} />
        </SidebarSection>

        <div style={{ display: "grid", gap: 8 }}>
          {confirmingArchive ? (
            <div style={{ display: "grid", gap: 8 }}>
              <p style={{ margin: 0, color: "#f59e0b", fontSize: 12 }}>Archive this goal and hide its child sprints from active planning?</p>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" onClick={onArchive} style={archiveGhostButtonStyle}>Archive</button>
                <button type="button" onClick={() => setConfirmingArchive(false)} style={secondaryButtonStyle}>Cancel</button>
              </div>
            </div>
          ) : confirmingDelete ? (
            <div style={{ display: "grid", gap: 8 }}>
              <p style={{ margin: 0, color: "#ef4444", fontSize: 12 }}>Permanently delete this goal? Use only for test cleanup.</p>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" onClick={onDelete} style={dangerButtonStyle}>Delete</button>
                <button type="button" onClick={() => setConfirmingDelete(false)} style={secondaryButtonStyle}>Cancel</button>
              </div>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <button
                type="button"
                onClick={() => setConfirmingArchive(true)}
                style={archiveGhostButtonStyle}
              >
                <Archive size={14} />
                Archive
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                style={dangerGhostButtonStyle}
              >
                <Trash2 size={14} />
                Delete
              </button>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

function SidebarSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ display: "grid", gap: 10 }}>
      <h3 style={{ margin: 0, color: P.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.12em", fontWeight: 760 }}>{title}</h3>
      {children}
    </section>
  );
}

function CompactDetailField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
      <span style={{ width: 54, flexShrink: 0, color: P.muted, fontSize: 11, fontWeight: 650 }}>{label}</span>
      <span style={{ flex: 1, minWidth: 0 }}>{children}</span>
    </label>
  );
}

function ReadOnlyRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, color: P.textSec, fontSize: 12 }}>
      <span style={{ color: P.muted }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function WrapMetric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      border: "0.5px solid var(--border)",
      borderRadius: 7,
      padding: "6px 7px",
      background: "color-mix(in srgb, var(--surface-recessed) 84%, transparent)",
      display: "grid",
      gap: 2,
      minWidth: 0,
    }}>
      <span style={{ color: P.muted, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 720 }}>{label}</span>
      <span style={{ color: P.text, fontSize: 12, fontWeight: 730, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</span>
    </div>
  );
}

const draftFieldStyle: React.CSSProperties = {
  display: "grid",
  gap: 5,
  color: P.muted,
  fontSize: 11,
  fontWeight: 650,
  minWidth: 0,
};

const contractFieldStyle: React.CSSProperties = {
  display: "grid",
  gap: 6,
  color: P.muted,
  fontSize: 11,
  fontWeight: 650,
};

const draftInputStyle: React.CSSProperties = {
  width: "100%",
  minWidth: 0,
  boxSizing: "border-box",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "transparent",
  color: P.textSec,
  padding: "7px 9px",
  fontSize: 12,
  outline: "none",
};

const decisionCardStyle: React.CSSProperties = {
  border: "0.5px solid var(--border)",
  borderRadius: 8,
  background: "var(--surface-recessed)",
  padding: "9px 10px",
  display: "grid",
  gap: 5,
};

const wrapUpCardStyle: React.CSSProperties = {
  border: "0.5px solid color-mix(in srgb, #22c55e 26%, var(--border))",
  borderRadius: 8,
  background: "color-mix(in srgb, #22c55e 5%, var(--surface-recessed))",
  padding: "9px 10px",
  display: "grid",
  gap: 7,
};

const wrapNoteStyle: React.CSSProperties = {
  border: "0.5px solid var(--border)",
  borderRadius: 7,
  background: "color-mix(in srgb, var(--surface) 46%, transparent)",
  color: P.muted,
  fontSize: 11,
  lineHeight: 1.35,
  padding: "7px 8px",
};

const approvalModalBackdropStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 80,
  background: "rgba(0,0,0,0.48)",
  display: "grid",
  placeItems: "center",
  padding: 24,
};

const approvalModalPanelStyle: React.CSSProperties = {
  width: "min(560px, calc(100vw - 40px))",
  borderRadius: 14,
  border: "1px solid var(--border)",
  background: "var(--modal-glass, var(--surface))",
  boxShadow: "0 24px 80px rgba(0,0,0,0.34)",
  padding: 18,
  display: "grid",
  gap: 14,
};

const approvalIconButtonStyle: React.CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 8,
  border: "0.5px solid var(--border)",
  background: "transparent",
  color: P.textSec,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
};

const approvalSecondaryButtonStyle: React.CSSProperties = {
  height: 34,
  padding: "0 13px",
  borderRadius: 8,
  border: "0.5px solid var(--border)",
  background: "transparent",
  color: P.textSec,
  fontSize: 13,
  fontWeight: 650,
  cursor: "pointer",
};

const approvalPrimaryButtonStyle: React.CSSProperties = {
  ...approvalSecondaryButtonStyle,
  border: "0.5px solid color-mix(in srgb, #22c55e 70%, var(--border))",
  background: "color-mix(in srgb, #22c55e 18%, var(--surface))",
  color: "color-mix(in srgb, #16a34a 84%, var(--text-primary))",
  fontWeight: 760,
};

const approvalWarningButtonStyle: React.CSSProperties = {
  ...approvalSecondaryButtonStyle,
  border: "0.5px solid color-mix(in srgb, #f59e0b 70%, var(--border))",
  background: "color-mix(in srgb, #f59e0b 15%, var(--surface))",
  color: "color-mix(in srgb, #b45309 88%, var(--text-primary))",
  fontWeight: 760,
};

const dangerGhostButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "flex-start",
  gap: 7,
  border: "1px solid color-mix(in srgb, #ef4444 35%, transparent)",
  borderRadius: 8,
  background: "transparent",
  color: "#ef4444",
  padding: "8px 10px",
  cursor: "pointer",
  fontSize: 12,
};

const archiveGhostButtonStyle: React.CSSProperties = {
  ...dangerGhostButtonStyle,
  border: "1px solid var(--border)",
  color: P.textSec,
};

const dangerButtonStyle: React.CSSProperties = {
  ...dangerGhostButtonStyle,
  background: "color-mix(in srgb, #ef4444 12%, transparent)",
};

const primaryButtonStyle: React.CSSProperties = {
  border: "1px solid var(--border-strong)",
  borderRadius: 8,
  background: "var(--surface-hover)",
  color: P.text,
  padding: "8px 10px",
  cursor: "pointer",
  fontSize: 12,
};

const secondaryButtonStyle: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 8,
  background: "transparent",
  color: P.textSec,
  padding: "8px 10px",
  cursor: "pointer",
  fontSize: 12,
};

const disabledButtonStyle: React.CSSProperties = {
  ...secondaryButtonStyle,
  opacity: 0.5,
  cursor: "not-allowed",
};
