import type {
  OrchestrationSprintPlanDraftSprint,
  OrchestrationSprintPlanDraftTask,
} from "@/lib/orchestration/types";

export type PlanningPolicySize = "tiny" | "small" | "medium" | "large";
export type PlanningPolicyRisk = "low" | "normal" | "high";
export type PlanningPolicyQaMode = "skip_by_default" | "optional" | "required";
export type PlanningPolicyParallelism = "none" | "limited" | "useful" | "required";
export type PlanningPolicyBlastRadius =
  | "scratch"
  | "tests"
  | "single_module"
  | "ui"
  | "runtime"
  | "data"
  | "provider"
  | "release";
export type PlanningPolicyValidationMode = "deterministic" | "review" | "visual" | "migration" | "security";

export type PlanningPolicy = {
  schema: "hiverunner.planning_policy.v1";
  size: PlanningPolicySize;
  risk: PlanningPolicyRisk;
  blastRadius: PlanningPolicyBlastRadius;
  validationMode: PlanningPolicyValidationMode;
  qaMode: PlanningPolicyQaMode;
  requireQa: boolean;
  parallelism: PlanningPolicyParallelism;
  maxSprints?: number;
  maxTasksPerSprint?: number;
  maxImplementationTasksPerSprint?: number;
  maxQaTasksPerSprint?: number;
  reasons: string[];
};

export type PlanningPolicyGoalInput = {
  id?: string | null;
  name?: string | null;
  goal?: string | null;
  stopCondition?: string | null;
  progressSummary?: string | null;
};

export type PlanningPolicyDraftInput = {
  sprint: OrchestrationSprintPlanDraftSprint;
  tasks: OrchestrationSprintPlanDraftTask[];
};

export type PlanningPolicyViolation = {
  code: string;
  message: string;
  severity: "error";
  sprintIndex?: number;
  taskId?: string;
};

export type PlanningPolicyValidation = {
  ok: boolean;
  violations: PlanningPolicyViolation[];
};

const SMALL_SELF_CONTAINED_GOAL_PATTERN =
  /\b(?:small|self-contained|one focused sprint|few simple tasks?|prompt-based benchmark|single local artifact|scratch utility)\b|scratch\/harness-comparison/;
const ONE_SPRINT_REQUIRED_PATTERN =
  /\bone focused sprint\b|\bdo not create follow-up sprints\b|\bsingle sprint\b/;
const DETERMINISTIC_VALIDATION_PATTERN =
  /\b(?:fixture|fixtures?|tests?|parser|utility|summary|readme|usage note|no network|local|scratch)\b/;
const TIGHT_UTILITY_TASK_PATTERN =
  /\b(?:parser|fixtures?|tests?|readme|usage note|docs?|summary|utility|scratch|integrat(?:e|ion)|validation)\b/;
const RUNTIME_RISK_PATTERN =
  /\bruntime (?:behavior|execution|engine|runner|routing|refactor|platform|lane|promotion|provider|adapter|change|changes|hardening)\b|\borchestration\b/;
const HIGH_RISK_PATTERN =
  /\b(?:provider|model routing|api key|auth|permission|migration|database|schema|deploy|promotion|production|shared api|security|payment|billing|rollback)\b|runtime (?:behavior|execution|engine|runner|routing|refactor|platform|lane|promotion|provider|adapter|change|changes|hardening)\b|\borchestration\b/;
const DATA_RISK_PATTERN = /\b(?:migration|database|schema|sql|sqlite|postgres|backfill|data)\b/;
const PROVIDER_RISK_PATTERN = /\b(?:provider|model routing|api key|openai|anthropic|gemini|adapter)\b/;
const UI_RISK_PATTERN = /\b(?:ui|frontend|visual|browser|screenshot|playwright|layout|css)\b/;
const RELEASE_RISK_PATTERN = /\b(?:deploy|promotion|release|stable lane|production|rollback)\b/;
const SECURITY_RISK_PATTERN = /\b(?:security|auth|permission|api key|secret|credential)\b/;
const OPERATOR_REQUESTED_QA_PATTERN =
  /\b(?:independent qa|qa required|required qa|separate qa|review required|second-pass review|human review|approval before closure)\b/;
const QA_REVIEW_RELEASE_TASK_PATTERN = /^(?:qa|review|release)$/i;
const NEGATED_RISK_CLAUSE_PATTERN =
  /\b(?:do not|don't|dont|must not|should not|no|zero|0|avoid|avoiding|without)\b[^.!;\n]*(?:runtime|execution|engine|runner|routing|refactor|platform|lane|promotion|provider|adapter|orchestration|model routing|api key|auth|permission|migration|database|schema|deploy|production|shared api|security|payment|billing|rollback|ui|frontend|visual|browser|screenshot|playwright|layout|css|qa|review|release)[^.!;\n]*/g;

function normalizedPlanText(parts: Array<string | null | undefined>): string {
  return parts
    .filter((part): part is string => Boolean(part?.trim()))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function planText(input: {
  goal: PlanningPolicyGoalInput;
  drafts: PlanningPolicyDraftInput[];
}): string {
  return normalizedPlanText([
    input.goal.name,
    input.goal.goal,
    input.goal.stopCondition,
    input.goal.progressSummary,
    ...input.drafts.flatMap((draft) => [
      draft.sprint.name,
      draft.sprint.objective,
      ...(draft.sprint.successCriteria ?? []),
      ...(draft.sprint.validationChecks ?? []),
      ...(draft.sprint.outOfScope ?? []),
      ...draft.tasks.flatMap((task) => [
        task.title,
        task.description,
        task.validation,
        task.type,
      ]),
    ]),
  ]);
}

function riskSignalText(text: string): string {
  return text.replace(NEGATED_RISK_CLAUSE_PATTERN, " ");
}

export function buildPlanningPolicy(input: {
  goal: PlanningPolicyGoalInput;
  drafts: PlanningPolicyDraftInput[];
}): PlanningPolicy {
  const text = planText(input);
  const riskText = riskSignalText(text);
  const reasons: string[] = [];
  const explicitlySmall = SMALL_SELF_CONTAINED_GOAL_PATTERN.test(text);
  const oneSprintRequired = ONE_SPRINT_REQUIRED_PATTERN.test(text);
  const deterministic = DETERMINISTIC_VALIDATION_PATTERN.test(text);
  const highRisk = HIGH_RISK_PATTERN.test(riskText);
  const operatorRequestedQa = OPERATOR_REQUESTED_QA_PATTERN.test(riskText);

  let blastRadius: PlanningPolicyBlastRadius = "single_module";
  if (/scratch\/|scratch utility|\bscratch\b/.test(text)) blastRadius = "scratch";
  if (/\btests?\b/.test(text) && !explicitlySmall) blastRadius = "tests";
  if (UI_RISK_PATTERN.test(riskText)) blastRadius = "ui";
  if (DATA_RISK_PATTERN.test(riskText)) blastRadius = "data";
  if (PROVIDER_RISK_PATTERN.test(riskText)) blastRadius = "provider";
  if (RUNTIME_RISK_PATTERN.test(riskText)) blastRadius = "runtime";
  if (RELEASE_RISK_PATTERN.test(riskText)) blastRadius = "release";

  let validationMode: PlanningPolicyValidationMode = deterministic ? "deterministic" : "review";
  if (UI_RISK_PATTERN.test(riskText)) validationMode = "visual";
  if (DATA_RISK_PATTERN.test(riskText)) validationMode = "migration";
  if (SECURITY_RISK_PATTERN.test(riskText)) validationMode = "security";

  if (explicitlySmall) reasons.push("operator framed the goal as small or self-contained");
  if (oneSprintRequired) reasons.push("operator requested one sprint/no follow-up sprints");
  if (deterministic) reasons.push("work has deterministic local validation signals");
  if (highRisk) reasons.push("goal touches high-blast-radius runtime/data/provider/release behavior");
  if (operatorRequestedQa) reasons.push("operator explicitly requested separate QA/review");

  if (explicitlySmall && deterministic && !highRisk && !operatorRequestedQa) {
    return {
      schema: "hiverunner.planning_policy.v1",
      size: "tiny",
      risk: "low",
      blastRadius,
      validationMode,
      qaMode: "skip_by_default",
      requireQa: false,
      parallelism: "none",
      maxSprints: 1,
      maxTasksPerSprint: 1,
      maxImplementationTasksPerSprint: 1,
      maxQaTasksPerSprint: 0,
      reasons,
    };
  }

  if (highRisk || operatorRequestedQa) {
    return {
      schema: "hiverunner.planning_policy.v1",
      size: explicitlySmall ? "small" : "medium",
      risk: highRisk ? "high" : "normal",
      blastRadius,
      validationMode,
      qaMode: "required",
      requireQa: true,
      parallelism: "limited",
      maxSprints: oneSprintRequired ? 1 : undefined,
      maxTasksPerSprint: explicitlySmall ? 5 : 10,
      maxImplementationTasksPerSprint: explicitlySmall ? 3 : 8,
      maxQaTasksPerSprint: 2,
      reasons,
    };
  }

  return {
    schema: "hiverunner.planning_policy.v1",
    size: explicitlySmall ? "small" : "medium",
    risk: "normal",
    blastRadius,
    validationMode,
    qaMode: "optional",
    requireQa: false,
    parallelism: explicitlySmall ? "limited" : "useful",
    maxSprints: oneSprintRequired ? 1 : undefined,
    maxTasksPerSprint: explicitlySmall ? 3 : 10,
    maxImplementationTasksPerSprint: explicitlySmall ? 2 : 8,
    maxQaTasksPerSprint: 1,
    reasons,
  };
}

export function validateSprintPlanAgainstPlanningPolicy(
  policy: PlanningPolicy,
  drafts: PlanningPolicyDraftInput[],
): PlanningPolicyValidation {
  const violations: PlanningPolicyViolation[] = [];
  const materialDrafts = drafts.filter((draft) => !draft.sprint.completionProposal);

  if (policy.maxSprints !== undefined && materialDrafts.length > policy.maxSprints) {
    violations.push({
      code: "planning_policy:sprint_count_exceeded",
      message: `Policy allows at most ${policy.maxSprints} sprint(s), but the plan proposed ${materialDrafts.length}.`,
      severity: "error",
    });
  }

  materialDrafts.forEach((draft, index) => {
    const tasks = draft.tasks;
    const qaTasks = tasks.filter(isQaReviewOrReleaseTask);
    const implementationTasks = tasks.filter((task) => !isQaReviewOrReleaseTask(task));

    if (policy.maxTasksPerSprint !== undefined && tasks.length > policy.maxTasksPerSprint) {
      violations.push({
        code: "planning_policy:task_count_exceeded",
        message: `Policy allows at most ${policy.maxTasksPerSprint} task(s) in sprint ${index + 1}, but the plan proposed ${tasks.length}.`,
        severity: "error",
        sprintIndex: index,
      });
    }

    if (policy.maxImplementationTasksPerSprint !== undefined && implementationTasks.length > policy.maxImplementationTasksPerSprint) {
      violations.push({
        code: "planning_policy:implementation_fanout_exceeded",
        message: `Policy allows at most ${policy.maxImplementationTasksPerSprint} implementation task(s) in sprint ${index + 1}, but the plan proposed ${implementationTasks.length}.`,
        severity: "error",
        sprintIndex: index,
      });
    }

    if (policy.maxQaTasksPerSprint !== undefined && qaTasks.length > policy.maxQaTasksPerSprint) {
      violations.push({
        code: policy.maxQaTasksPerSprint === 0 ? "planning_policy:qa_not_allowed" : "planning_policy:qa_count_exceeded",
        message: `Policy allows at most ${policy.maxQaTasksPerSprint} QA/review/release task(s) in sprint ${index + 1}, but the plan proposed ${qaTasks.length}.`,
        severity: "error",
        sprintIndex: index,
      });
    }

    if (policy.qaMode === "skip_by_default" && qaTasks.length > 0) {
      for (const task of qaTasks) {
        violations.push({
          code: "planning_policy:unneeded_qa",
          message: "Tiny deterministic plans should keep validation inside the implementation task unless the operator explicitly requests separate QA.",
          severity: "error",
          sprintIndex: index,
          taskId: task.id,
        });
      }
    }

    if (policy.requireQa && tasks.length > 0 && qaTasks.length === 0) {
      violations.push({
        code: "planning_policy:qa_required",
        message: 'This plan touches higher-risk work or explicitly requested review, so it needs a QA/review task: set one task\'s "type" field to "qa", "review", or "release".',
        severity: "error",
        sprintIndex: index,
      });
    }

    for (const task of qaTasks) {
      if (implementationTasks.length > 0 && !task.dependsOn?.length) {
        violations.push({
          code: "planning_policy:qa_dependency_missing",
          message: "QA/review/release tasks must depend on the implementation output they validate.",
          severity: "error",
          sprintIndex: index,
          taskId: task.id,
        });
      }
    }

    const activitySplit = activitySplitViolation(tasks);
    if (activitySplit) {
      violations.push({
        ...activitySplit,
        sprintIndex: index,
      });
    }
  });

  return { ok: violations.length === 0, violations };
}

export function formatPlanningPolicyViolationMessage(
  policy: PlanningPolicy,
  violations: PlanningPolicyViolation[],
): string {
  const first = violations[0];
  const reasons = policy.reasons.length ? ` Reasons: ${policy.reasons.join("; ")}.` : "";
  const guidance = policy.qaMode === "skip_by_default"
    ? "For this tiny deterministic goal, propose one implementation task that owns code, fixtures, tests, docs, validation, and final reporting."
    : policy.requireQa
      ? "For this higher-risk goal, keep implementation slices focused and include a dependent QA/review task with concrete validation evidence."
      : "Revise the plan so each task is an independently useful slice and dependencies reflect hard prerequisites.";
  return [
    `Sprint plan violates ${policy.schema}: ${first?.message ?? "planning policy failed"}`,
    `Policy: size=${policy.size}, risk=${policy.risk}, qa=${policy.qaMode}, parallelism=${policy.parallelism}.${reasons}`,
    guidance,
  ].join("\n\n");
}

function isQaReviewOrReleaseTask(task: OrchestrationSprintPlanDraftTask): boolean {
  return QA_REVIEW_RELEASE_TASK_PATTERN.test(String(task.type ?? ""));
}

function activitySplitViolation(tasks: OrchestrationSprintPlanDraftTask[]): PlanningPolicyViolation | null {
  if (tasks.length <= 3) return null;

  const tightTaskSignals = countTightUtilityTasks(tasks);
  const nonQaTasks = tasks.filter((task) => !isQaReviewOrReleaseTask(task)).length;
  const immediatelyRunnable = tasks.filter((task) => !task.dependsOn?.length).length;
  if (tasks.length >= 5 && tightTaskSignals >= 4) {
    return {
      code: "planning_policy:activity_split",
      message: "The plan splits tightly coupled utility work into activity tasks instead of one owned deliverable.",
      severity: "error",
    };
  }
  if (nonQaTasks > 3 && immediatelyRunnable >= Math.ceil(tasks.length / 2) && tightTaskSignals >= 3) {
    return {
      code: "planning_policy:parallel_fanout",
      message: "The plan fans out tightly coupled utility work across too many immediately runnable tasks.",
      severity: "error",
    };
  }
  return null;
}

function countTightUtilityTasks(tasks: OrchestrationSprintPlanDraftTask[]): number {
  return tasks.filter((task) => {
    const taskText = normalizedPlanText([task.title, task.description, task.validation]);
    return TIGHT_UTILITY_TASK_PATTERN.test(taskText);
  }).length;
}
