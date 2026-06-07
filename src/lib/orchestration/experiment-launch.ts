import type { OrchestrationEvalCase } from "@/lib/orchestration/types";

export type ExperimentLaunchSourceKind = "eval_case" | "run_trace";
export type ExperimentLaunchObjectiveKey =
  | "reduce_review_returns"
  | "improve_acceptance"
  | "reduce_cost"
  | "shorten_runtime";
export type ExperimentWorkspaceModeKey = "snapshot" | "branch" | "live";
export type ExperimentLaunchAvailabilityState = "available" | "disabled" | "empty" | "error";

export interface ExperimentLaunchOption<Key extends string> {
  key: Key;
  label: string;
  description: string;
  recommended?: boolean;
  requiresExplicitConfirmation?: boolean;
}

export interface ExperimentLaunchLimitSpec {
  label: string;
  defaultValue: number;
  min: number;
  max: number;
  unit: string;
}

export interface ExperimentLaunchLimits {
  variantCap: ExperimentLaunchLimitSpec;
  attemptLimit: ExperimentLaunchLimitSpec;
  timeboxMinutes: ExperimentLaunchLimitSpec;
}

export interface ExperimentLaunchSourceSummary {
  kind: ExperimentLaunchSourceKind;
  id: string;
  label: string;
  title: string;
  subtitle: string;
  preferenceLabel: string;
  preferenceCopy: string;
  taskKey: string | null;
  taskTitle: string | null;
  reviewOutcome: string | null;
  reviewedAt: string | null;
  captureQuality: string | null;
  projectName: string | null;
  agentName: string | null;
  runnerLabel: string | null;
  modelLabel: string | null;
  snapshotSha256: string | null;
}

export interface ExperimentLaunchAvailability {
  state: ExperimentLaunchAvailabilityState;
  reason: string;
}

export interface ExperimentLaunchModel {
  source: ExperimentLaunchSourceSummary;
  availability: ExperimentLaunchAvailability;
  objectives: Array<ExperimentLaunchOption<ExperimentLaunchObjectiveKey>>;
  defaultObjective: ExperimentLaunchObjectiveKey;
  workspaceModes: Array<ExperimentLaunchOption<ExperimentWorkspaceModeKey>>;
  defaultWorkspaceMode: ExperimentWorkspaceModeKey;
  limits: ExperimentLaunchLimits;
  stubNotice: string;
}

export interface RunTraceExperimentLaunchInput {
  runId: string;
  runStatus: string | null;
  taskKey: string | null;
  taskTitle: string | null;
  taskStatus: string | null;
  agentName: string | null;
  providerLabel: string | null;
  runnerModel: string | null;
  captureQuality: string | null;
  evidenceGapCount: number | null;
  reviewOutcome?: string | null;
  reviewedAt?: string | null;
}

const REVIEWED_TASK_STATUSES = new Set(["review", "done", "blocked"]);
const TERMINAL_RUN_STATUSES = new Set(["succeeded", "completed", "failed", "cancelled", "timed_out"]);

export function experimentLaunchObjectives(): Array<ExperimentLaunchOption<ExperimentLaunchObjectiveKey>> {
  return [
    {
      key: "reduce_review_returns",
      label: "Reduce review returns",
      description: "Compare bounded variants that target the reviewer return reason.",
      recommended: true,
    },
    {
      key: "improve_acceptance",
      label: "Improve accepted outcome",
      description: "Test a focused change that may make a good result repeatable.",
    },
    {
      key: "reduce_cost",
      label: "Lower runtime cost",
      description: "Compare lower-cost variants without changing the accepted contract.",
    },
    {
      key: "shorten_runtime",
      label: "Shorten execution time",
      description: "Compare variants that reduce cycle time while preserving evidence.",
    },
  ];
}

export function experimentWorkspaceModes(): Array<ExperimentLaunchOption<ExperimentWorkspaceModeKey>> {
  return [
    {
      key: "snapshot",
      label: "Snapshot",
      description: "Use a read-only source snapshot for isolated comparison.",
      recommended: true,
    },
    {
      key: "branch",
      label: "Branch",
      description: "Use an isolated workspace branch for reversible changes.",
    },
    {
      key: "live",
      label: "Live workspace",
      description: "Requires explicit governed operator choice before execution.",
      requiresExplicitConfirmation: true,
    },
  ];
}

export function defaultExperimentLaunchLimits(): ExperimentLaunchLimits {
  return {
    variantCap: {
      label: "Variant cap",
      defaultValue: 2,
      min: 1,
      max: 3,
      unit: "variants",
    },
    attemptLimit: {
      label: "Attempt limit",
      defaultValue: 3,
      min: 1,
      max: 10,
      unit: "attempts",
    },
    timeboxMinutes: {
      label: "Timebox",
      defaultValue: 30,
      min: 5,
      max: 120,
      unit: "minutes",
    },
  };
}

export function buildEvalCaseExperimentLaunchModel(item: OrchestrationEvalCase): ExperimentLaunchModel {
  return {
    source: {
      kind: "eval_case",
      id: item.id,
      label: "Eval Case",
      title: `${item.sourceTask.key} · ${item.sourceTask.title}`,
      subtitle: item.review.rationale,
      preferenceLabel: "Preferred source: Eval Case",
      preferenceCopy: "Eval Cases carry immutable review context and should be used instead of the raw Run Trace when both are available.",
      taskKey: item.sourceTask.key,
      taskTitle: item.sourceTask.title,
      reviewOutcome: item.review.outcome,
      reviewedAt: item.review.reviewedAt,
      captureQuality: item.captureQuality,
      projectName: item.sourceProject.name,
      agentName: item.sourceRun.agentName,
      runnerLabel: item.sourceRun.runnerProvider ?? item.sourceRun.providerId,
      modelLabel: item.sourceRun.runnerModel,
      snapshotSha256: item.snapshotSha256,
    },
    availability: {
      state: "available",
      reason: "Ready to stage a launch request from this reviewed Eval Case.",
    },
    objectives: experimentLaunchObjectives(),
    defaultObjective: objectiveForReviewOutcome(item.review.outcome),
    workspaceModes: experimentWorkspaceModes(),
    defaultWorkspaceMode: "snapshot",
    limits: defaultExperimentLaunchLimits(),
    stubNotice: "Selected variants are approved only after the limit review; approved experiments are ready for attempt execution.",
  };
}

export function buildEmptyEvalCaseExperimentLaunchModel(): ExperimentLaunchModel {
  return {
    source: placeholderSource({
      kind: "eval_case",
      label: "Eval Case",
      title: "No Eval Case selected",
      subtitle: "Reviewed Run Trace saves will unlock the preferred experiment source.",
      preferenceLabel: "Preferred source: Eval Case",
      preferenceCopy: "Launch controls need a saved Eval Case source before the preferred path is available.",
    }),
    availability: {
      state: "empty",
      reason: "No saved Eval Cases are available for this filter set.",
    },
    objectives: experimentLaunchObjectives(),
    defaultObjective: "reduce_review_returns",
    workspaceModes: experimentWorkspaceModes(),
    defaultWorkspaceMode: "snapshot",
    limits: defaultExperimentLaunchLimits(),
    stubNotice: "Selected variants are approved only after the limit review; approved experiments are ready for attempt execution.",
  };
}

export function buildEvalCaseExperimentLaunchErrorModel(reason: string): ExperimentLaunchModel {
  return {
    source: placeholderSource({
      kind: "eval_case",
      label: "Eval Case",
      title: "Eval Case source unavailable",
      subtitle: "The library did not load a source that can launch an experiment.",
      preferenceLabel: "Preferred source: Eval Case",
      preferenceCopy: "Retry once Eval Case data is available; raw Run Trace remains a secondary source.",
    }),
    availability: {
      state: "error",
      reason,
    },
    objectives: experimentLaunchObjectives(),
    defaultObjective: "reduce_review_returns",
    workspaceModes: experimentWorkspaceModes(),
    defaultWorkspaceMode: "snapshot",
    limits: defaultExperimentLaunchLimits(),
    stubNotice: "Selected variants are approved only after the limit review; approved experiments are ready for attempt execution.",
  };
}

export function buildRunTraceExperimentLaunchModel(input: RunTraceExperimentLaunchInput): ExperimentLaunchModel {
  const isReviewed = Boolean(input.reviewOutcome) || REVIEWED_TASK_STATUSES.has((input.taskStatus ?? "").toLowerCase());
  const isTerminal = TERMINAL_RUN_STATUSES.has((input.runStatus ?? "").toLowerCase());
  const availability = runTraceLaunchAvailability(isReviewed, isTerminal);
  const evidenceSummary = input.evidenceGapCount && input.evidenceGapCount > 0
    ? `${input.captureQuality ?? "unknown"} capture, ${input.evidenceGapCount} evidence gap${input.evidenceGapCount === 1 ? "" : "s"}`
    : input.captureQuality ? `${input.captureQuality} capture` : null;

  return {
    source: {
      kind: "run_trace",
      id: input.runId,
      label: "Reviewed Run Trace",
      title: input.taskKey && input.taskTitle ? `${input.taskKey} · ${input.taskTitle}` : input.taskTitle ?? `Run ${input.runId}`,
      subtitle: evidenceSummary ?? "Reviewed trace source",
      preferenceLabel: "Eval Case preferred",
      preferenceCopy: "Use a saved Eval Case when one exists because it preserves the immutable review snapshot. This Run Trace source is available for reviewed traces without a saved Eval Case.",
      taskKey: input.taskKey,
      taskTitle: input.taskTitle,
      reviewOutcome: input.reviewOutcome ?? reviewedOutcomeFromTaskStatus(input.taskStatus),
      reviewedAt: input.reviewedAt ?? null,
      captureQuality: input.captureQuality,
      projectName: null,
      agentName: input.agentName,
      runnerLabel: input.providerLabel,
      modelLabel: input.runnerModel,
      snapshotSha256: null,
    },
    availability,
    objectives: experimentLaunchObjectives(),
    defaultObjective: objectiveForReviewOutcome(input.reviewOutcome),
    workspaceModes: experimentWorkspaceModes(),
    defaultWorkspaceMode: "snapshot",
    limits: defaultExperimentLaunchLimits(),
    stubNotice: "Selected variants are approved only after the limit review; approved experiments are ready for attempt execution.",
  };
}

function runTraceLaunchAvailability(isReviewed: boolean, isTerminal: boolean): ExperimentLaunchAvailability {
  if (!isTerminal) {
    return {
      state: "disabled",
      reason: "Experiment launch is disabled until the source run is terminal.",
    };
  }
  if (!isReviewed) {
    return {
      state: "disabled",
      reason: "Experiment launch is disabled until this Run Trace has a reviewer outcome.",
    };
  }
  return {
    state: "available",
    reason: "Ready to stage a launch request from this reviewed Run Trace.",
  };
}

function objectiveForReviewOutcome(outcome?: string | null): ExperimentLaunchObjectiveKey {
  if (outcome === "accepted") return "improve_acceptance";
  if (outcome === "returned" || outcome === "rejected" || outcome === "blocked") return "reduce_review_returns";
  return "reduce_review_returns";
}

function reviewedOutcomeFromTaskStatus(taskStatus?: string | null): string | null {
  const status = (taskStatus ?? "").toLowerCase();
  if (status === "done") return "accepted";
  if (status === "review") return "reviewed";
  if (status === "blocked") return "blocked";
  return null;
}

function placeholderSource(input: {
  kind: ExperimentLaunchSourceKind;
  label: string;
  title: string;
  subtitle: string;
  preferenceLabel: string;
  preferenceCopy: string;
}): ExperimentLaunchSourceSummary {
  return {
    ...input,
    id: "unavailable",
    taskKey: null,
    taskTitle: null,
    reviewOutcome: null,
    reviewedAt: null,
    captureQuality: null,
    projectName: null,
    agentName: null,
    runnerLabel: null,
    modelLabel: null,
    snapshotSha256: null,
  };
}
