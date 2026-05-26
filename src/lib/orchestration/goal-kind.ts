import type { OrchestrationCompanyGoal } from "@/lib/orchestration/types";

export type GoalKind = "company" | "sprint";

export function determineGoalKind(goal: OrchestrationCompanyGoal): GoalKind {
  if (goal.sprint.goalKind === "company" || goal.sprint.goalKind === "sprint") {
    return goal.sprint.goalKind;
  }
  if (goal.sprint.parentId) return "sprint";
  if ((goal.sprint.taskCount ?? 0) > 0) return "sprint";
  return "company";
}
