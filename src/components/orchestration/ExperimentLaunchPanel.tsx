"use client";

import { useId, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import {
  AlertTriangle,
  Check,
  FlaskConical,
  GitBranch,
  Play,
  Radio,
  ShieldCheck,
} from "lucide-react";

import {
  type ExperimentLaunchLimitSpec,
  type ExperimentLaunchModel,
  type ExperimentLaunchObjectiveKey,
  type ExperimentWorkspaceModeKey,
} from "@/lib/orchestration/experiment-launch";
import { color, font, radius, space, type as T } from "@/lib/ui/tokens";

type PanelMode = "standalone" | "details";

type LaunchResult = {
  status: "idle" | "working" | "approved" | "error";
  message: string | null;
  experiment?: ExperimentApiRecord | null;
};

type ProposedExperimentVariant = {
  key: string;
  name: string;
  description: string;
  reason: string;
  changeType: "runner_model" | "agent" | "prompt" | "tool_setup" | "task_decomposition" | "template_slot" | "context_package" | "other";
  plannedChange: Record<string, unknown>;
};

type ExperimentApiVariant = {
  id: string;
  key: string;
  name: string;
  status: string;
};

type ExperimentApiRecord = {
  id: string;
  status: string;
  workspaceMode: ExperimentWorkspaceModeKey;
  limits: {
    variantCap: number;
    attemptLimit: number;
    timeboxMinutes: number;
  };
  variants: ExperimentApiVariant[];
};

export function ExperimentLaunchPanel({
  model,
  companyKey,
  mode = "standalone",
  defaultExpanded = true,
  style,
}: {
  model: ExperimentLaunchModel;
  companyKey?: string | null;
  mode?: PanelMode;
  defaultExpanded?: boolean;
  style?: CSSProperties;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const summary = (
    <ExperimentLaunchSummary
      model={model}
      compact={mode === "details"}
    />
  );

  if (mode === "details") {
    return (
      <details
        open={expanded}
        onToggle={(event) => setExpanded(event.currentTarget.open)}
        style={{
          borderRadius: radius.md,
          border: `0.5px solid ${color.border}`,
          background: color.surfaceElevated,
          overflow: "hidden",
          ...style,
        }}
      >
        <summary
          style={{
            listStyle: "none",
            cursor: "pointer",
            padding: `${space.md}px ${space.lg}px`,
          }}
        >
          {summary}
        </summary>
        <div style={{ padding: `0 ${space.lg}px ${space.lg}px` }}>
          <ExperimentLaunchControls model={model} companyKey={companyKey} />
        </div>
      </details>
    );
  }

  return (
    <section
      aria-label="Experiment launch"
      style={{
        borderRadius: radius.md,
        border: `0.5px solid ${color.border}`,
        background: color.surface,
        padding: space.lg,
        display: "grid",
        gap: space.md,
        ...style,
      }}
    >
      {summary}
      <ExperimentLaunchControls model={model} companyKey={companyKey} />
    </section>
  );
}

function ExperimentLaunchSummary({
  model,
  compact,
}: {
  model: ExperimentLaunchModel;
  compact: boolean;
}) {
  const statusTone = availabilityTone(model.availability.state);
  return (
    <div style={{ display: "flex", gap: space.md, alignItems: "flex-start", minWidth: 0 }}>
      <span
        aria-hidden
        style={{
          width: compact ? 28 : 34,
          height: compact ? 28 : 34,
          borderRadius: radius.md,
          display: "grid",
          placeItems: "center",
          color: color.accent,
          background: color.accentSoft,
          border: `0.5px solid ${color.border}`,
          flexShrink: 0,
        }}
      >
        <FlaskConical size={compact ? 14 : 16} />
      </span>
      <div style={{ minWidth: 0, flex: 1, display: "grid", gap: 5 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ color: color.text, fontSize: compact ? T.bodySmall.size : T.cardTitle.size, fontWeight: 700 }}>
            Experiment launch
          </span>
          <span
            style={{
              borderRadius: radius.full,
              border: `0.5px solid ${statusTone.border}`,
              background: statusTone.bg,
              color: statusTone.text,
              fontSize: T.caption.size,
              padding: "2px 7px",
              fontWeight: 700,
            }}
          >
            {statusTone.label}
          </span>
          <span
            style={{
              borderRadius: radius.full,
              border: `0.5px solid ${color.border}`,
              color: color.textSecondary,
              fontSize: T.caption.size,
              padding: "2px 7px",
            }}
          >
            {model.source.preferenceLabel}
          </span>
        </div>
        <div style={{ color: color.textSecondary, fontSize: T.bodySmall.size, lineHeight: T.bodySmall.lineHeight }}>
          {model.source.title}
        </div>
        {!compact ? (
          <div style={{ color: color.textMuted, fontSize: T.caption.size, lineHeight: 1.45 }}>
            {model.source.preferenceCopy}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ExperimentLaunchControls({ model, companyKey }: { model: ExperimentLaunchModel; companyKey?: string | null }) {
  const objectiveGroupId = useId();
  const modeGroupId = useId();
  const variantGroupId = useId();
  const [objective, setObjective] = useState<ExperimentLaunchObjectiveKey>(model.defaultObjective);
  const [workspaceMode, setWorkspaceMode] = useState<ExperimentWorkspaceModeKey>(model.defaultWorkspaceMode);
  const [variantCap, setVariantCap] = useState(model.limits.variantCap.defaultValue);
  const [attemptLimit, setAttemptLimit] = useState(model.limits.attemptLimit.defaultValue);
  const [timeboxMinutes, setTimeboxMinutes] = useState(model.limits.timeboxMinutes.defaultValue);
  const [liveConfirmed, setLiveConfirmed] = useState(false);
  const [limitsReviewed, setLimitsReviewed] = useState(false);
  const [selectedVariantKeys, setSelectedVariantKeys] = useState<string[]>(() => (
    defaultSelectedVariantKeys(proposedVariantsForObjective(model, model.defaultObjective), model.limits.variantCap.defaultValue)
  ));
  const [result, setResult] = useState<LaunchResult>({ status: "idle", message: null });

  const selectedWorkspaceMode = model.workspaceModes.find((item) => item.key === workspaceMode);
  const proposedVariants = useMemo(
    () => proposedVariantsForObjective(model, objective),
    [model, objective],
  );
  const selectedVariants = useMemo(
    () => proposedVariants.filter((variant) => selectedVariantKeys.includes(variant.key)),
    [proposedVariants, selectedVariantKeys],
  );
  const limitErrors = useMemo(() => {
    const errors: string[] = [];
    collectLimitError(errors, model.limits.variantCap, variantCap);
    collectLimitError(errors, model.limits.attemptLimit, attemptLimit);
    collectLimitError(errors, model.limits.timeboxMinutes, timeboxMinutes);
    return errors;
  }, [attemptLimit, model.limits.attemptLimit, model.limits.timeboxMinutes, model.limits.variantCap, timeboxMinutes, variantCap]);

  const sourceReady = model.availability.state === "available";
  const hasOptions = model.objectives.length > 0 && model.workspaceModes.length > 0;
  const liveReady = !selectedWorkspaceMode?.requiresExplicitConfirmation || liveConfirmed;
  const apiReady = typeof companyKey === "string" && companyKey.trim().length > 0;
  const selectionErrors = variantSelectionErrors(selectedVariants.length, variantCap);
  const reviewErrors = [...limitErrors, ...selectionErrors];
  const launchReady = (
    sourceReady &&
    hasOptions &&
    apiReady &&
    liveReady &&
    limitsReviewed &&
    reviewErrors.length === 0 &&
    result.status !== "working" &&
    result.status !== "approved"
  );

  const resetApprovalReview = () => {
    setLimitsReviewed(false);
    setResult((current) => current.status === "approved" ? { status: "idle", message: null } : current);
  };

  const approveLaunch = async () => {
    if (!launchReady) {
      setResult({
        status: "error",
        message: launchBlockedMessage({
          apiReady,
          liveReady,
          limitsReviewed,
          reviewErrors,
          fallback: model.availability.reason,
        }),
      });
      return;
    }
    const liveWorkspaceReason = workspaceMode === "live"
      ? "Operator explicitly selected governed live workspace mode during variant approval review."
      : null;

    setResult({ status: "working", message: "Creating draft and applying variant approval.", experiment: null });
    try {
      const draft = await createExperimentDraftFromPanel(companyKey, {
        source: { kind: model.source.kind, id: model.source.id },
        objective,
        definitionOfBetter: definitionForObjective(objective),
        hypothesis: hypothesisForSelection(selectedVariants),
        workspaceMode,
        liveWorkspaceConfirmed: workspaceMode === "live" ? true : undefined,
        liveWorkspaceReason,
        limits: { variantCap, attemptLimit, timeboxMinutes },
        variants: selectedVariants.map((variant) => ({
          key: variant.key,
          name: variant.name,
          description: variant.description,
          changeType: variant.changeType,
          plannedChange: variant.plannedChange,
        })),
      });
      const approved = await approveExperimentVariantsFromPanel(companyKey, draft.id, {
        variantKeys: selectedVariants.map((variant) => variant.key),
        liveWorkspaceConfirmed: workspaceMode === "live" ? true : undefined,
        liveWorkspaceReason,
      });
      const approvedCount = approved.variants.filter((variant) => variant.status === "approved").length;
      setResult({
        status: "approved",
        experiment: approved,
        message: `Approved experiment ready for attempt execution: ${approvedCount} variant${approvedCount === 1 ? "" : "s"}, ${approved.limits.attemptLimit} attempt${approved.limits.attemptLimit === 1 ? "" : "s"} each, ${approved.limits.timeboxMinutes} minute timebox.`,
      });
    } catch (error) {
      setResult({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
        experiment: null,
      });
    }
  };

  if (model.availability.state !== "available") {
    return (
      <ExperimentLaunchUnavailableState model={model} />
    );
  }

  if (!hasOptions) {
    return (
      <ExperimentLaunchStateMessage
        state="empty"
        title="Launch controls are not configured"
        body="No objective or workspace mode options are available for this source."
      />
    );
  }

  return (
    <div style={{ display: "grid", gap: space.md }}>
      <SourceSummary model={model} />

      <fieldset
        aria-labelledby={objectiveGroupId}
        style={fieldsetStyle}
      >
        <legend id={objectiveGroupId} style={legendStyle}>Objective</legend>
        <div style={optionGridStyle}>
          {model.objectives.map((item) => (
            <label key={item.key} style={optionCardStyle(objective === item.key)}>
              <input
                type="radio"
                name={objectiveGroupId}
                value={item.key}
                checked={objective === item.key}
                onChange={() => {
                  setObjective(item.key);
                  setSelectedVariantKeys(defaultSelectedVariantKeys(proposedVariantsForObjective(model, item.key), variantCap));
                  resetApprovalReview();
                }}
              />
              <span style={{ display: "grid", gap: 3, minWidth: 0 }}>
                <span style={{ color: color.text, fontSize: T.bodySmall.size, fontWeight: 700 }}>
                  {item.label}
                  {item.recommended ? <span style={{ color: color.accent }}> recommended</span> : null}
                </span>
                <span style={{ color: color.textMuted, fontSize: T.caption.size, lineHeight: 1.4 }}>
                  {item.description}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset
        aria-labelledby={modeGroupId}
        style={fieldsetStyle}
      >
        <legend id={modeGroupId} style={legendStyle}>Workspace mode</legend>
        <div style={modeGridStyle}>
          {model.workspaceModes.map((item) => (
            <label key={item.key} style={modeCardStyle(workspaceMode === item.key, item.requiresExplicitConfirmation)}>
              <input
                type="radio"
                name={modeGroupId}
                value={item.key}
                checked={workspaceMode === item.key}
                onChange={() => {
                  setWorkspaceMode(item.key);
                  setLiveConfirmed(false);
                  resetApprovalReview();
                }}
              />
              <WorkspaceModeIcon mode={item.key} />
              <span style={{ display: "grid", gap: 3, minWidth: 0 }}>
                <span style={{ color: color.text, fontSize: T.bodySmall.size, fontWeight: 700 }}>
                  {item.label}
                  {item.recommended ? <span style={{ color: color.accent }}> default</span> : null}
                </span>
                <span style={{ color: color.textMuted, fontSize: T.caption.size, lineHeight: 1.4 }}>
                  {item.description}
                </span>
              </span>
            </label>
          ))}
        </div>
        {selectedWorkspaceMode?.requiresExplicitConfirmation ? (
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", color: color.warning, fontSize: T.caption.size, lineHeight: 1.45 }}>
            <input
              type="checkbox"
              checked={liveConfirmed}
              onChange={(event) => {
                setLiveConfirmed(event.currentTarget.checked);
                resetApprovalReview();
              }}
              style={{ marginTop: 2 }}
            />
            Explicitly choose governed live workspace mode before variant approval.
          </label>
        ) : null}
      </fieldset>

      <fieldset
        aria-labelledby={variantGroupId}
        style={fieldsetStyle}
      >
        <legend id={variantGroupId} style={legendStyle}>Proposed variants</legend>
        <div style={variantGridStyle}>
          {proposedVariants.map((variant) => {
            const selected = selectedVariantKeys.includes(variant.key);
            return (
              <label key={variant.key} style={variantCardStyle(selected)}>
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={(event) => {
                    const { checked } = event.currentTarget;
                    setSelectedVariantKeys((current) => toggleSelectedVariant(current, variant.key, checked));
                    resetApprovalReview();
                  }}
                />
                <span style={{ display: "grid", gap: 5, minWidth: 0 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ color: color.text, fontSize: T.bodySmall.size, fontWeight: 700 }}>{variant.name}</span>
                    <span style={variantTypePillStyle}>{variant.changeType.replaceAll("_", " ")}</span>
                  </span>
                  <span style={{ color: color.textMuted, fontSize: T.caption.size, lineHeight: 1.4 }}>{variant.description}</span>
                  <span style={{ color: color.textSecondary, fontSize: T.caption.size, lineHeight: 1.4 }}>
                    <strong style={{ color: color.text }}>Why:</strong> {variant.reason}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
        {selectionErrors.length > 0 ? (
          <div role="alert" style={errorTextStyle}>{selectionErrors[0]}</div>
        ) : null}
      </fieldset>

      <fieldset style={fieldsetStyle}>
        <legend style={legendStyle}>Limits</legend>
        <div style={limitsGridStyle}>
          <LimitInput spec={model.limits.variantCap} value={variantCap} onChange={(value) => {
            setVariantCap(value);
            resetApprovalReview();
          }} />
          <LimitInput spec={model.limits.attemptLimit} value={attemptLimit} onChange={(value) => {
            setAttemptLimit(value);
            resetApprovalReview();
          }} />
          <LimitInput spec={model.limits.timeboxMinutes} value={timeboxMinutes} onChange={(value) => {
            setTimeboxMinutes(value);
            resetApprovalReview();
          }} />
        </div>
        {limitErrors.length > 0 ? (
          <div role="alert" style={errorTextStyle}>{limitErrors[0]}</div>
        ) : null}
        <div style={limitReviewStyle}>
          <div style={{ display: "grid", gap: 3, minWidth: 0 }}>
            <div style={{ color: color.text, fontSize: T.bodySmall.size, fontWeight: 700 }}>Review limits before approval</div>
            <div style={{ color: color.textSecondary, fontSize: T.caption.size, lineHeight: 1.45 }}>
              Cost exposure is bounded by {selectedVariants.length} selected variant{selectedVariants.length === 1 ? "" : "s"} and {attemptLimit || 0} attempt{attemptLimit === 1 ? "" : "s"} each; no attempt starts from this approval step.
            </div>
          </div>
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", color: color.textSecondary, fontSize: T.caption.size, lineHeight: 1.45 }}>
            <input
              type="checkbox"
              checked={limitsReviewed}
              onChange={(event) => setLimitsReviewed(event.currentTarget.checked)}
              style={{ marginTop: 2 }}
            />
            I reviewed the variant count, attempt limit, and timebox before approving.
          </label>
        </div>
      </fieldset>

      <div style={{ display: "flex", alignItems: "center", gap: space.md, flexWrap: "wrap" }}>
        <button
          type="button"
          disabled={!launchReady}
          onClick={approveLaunch}
          style={launchButtonStyle(launchReady)}
        >
          <Play size={13} />
          {result.status === "working" ? "Approving variants" : "Approve selected variants"}
        </button>
        <span style={{ color: color.textMuted, fontSize: T.caption.size, lineHeight: 1.4, flex: "1 1 240px" }}>
          {model.stubNotice}
        </span>
      </div>

      {result.status !== "idle" && result.message ? (
        <ExperimentLaunchStateMessage
          state={result.status === "approved" || result.status === "working" ? "available" : "error"}
          title={result.status === "approved" ? "Variants approved" : result.status === "working" ? "Approval running" : "Approval not applied"}
          body={result.message}
        />
      ) : null}
    </div>
  );
}

function proposedVariantsForObjective(
  model: ExperimentLaunchModel,
  objective: ExperimentLaunchObjectiveKey,
): ProposedExperimentVariant[] {
  const sourceLabel = model.source.kind === "eval_case" ? "Eval Case" : "Run Trace";
  const sourceContext = model.source.taskKey ?? model.source.title;

  if (objective === "reduce_cost") {
    return [
      {
        key: "lower-cost-runner",
        name: "Lower-cost runner",
        description: "Compare a lower-cost model lane while preserving the reviewed source contract.",
        reason: `${sourceLabel} evidence shows enough structure to test cost reduction without changing the task goal.`,
        changeType: "runner_model",
        plannedChange: { runnerModel: "lower-cost-compatible", sourceContext },
      },
      {
        key: "context-slimming",
        name: "Context slimming",
        description: "Trim repeated context and keep only source-linked acceptance evidence.",
        reason: "The comparison can measure whether smaller prompts preserve reviewer confidence.",
        changeType: "context_package",
        plannedChange: { contextPackage: "source-linked-minimal" },
      },
      {
        key: "single-pass-handoff",
        name: "Single-pass handoff",
        description: "Require one concise final handoff with explicit verification evidence.",
        reason: "Reducing revision loops is the most direct cost guard for this source.",
        changeType: "prompt",
        plannedChange: { promptDelta: "single-pass verification handoff" },
      },
    ];
  }

  if (objective === "shorten_runtime") {
    return [
      {
        key: "fast-plan-first",
        name: "Fast plan first",
        description: "Use a shorter implementation plan with immediate focused verification.",
        reason: "The source already identifies the critical path, so the experiment can test shorter cycle time.",
        changeType: "task_decomposition",
        plannedChange: { decomposition: "shortest-focused-verification-loop" },
      },
      {
        key: "parallel-context-check",
        name: "Parallel context check",
        description: "Read source, tests, and route contracts in one pass before editing.",
        reason: "The run intelligence source can reveal whether context gathering is the runtime bottleneck.",
        changeType: "context_package",
        plannedChange: { contextPackage: "parallel-source-test-route-read" },
      },
      {
        key: "runtime-fast-lane",
        name: "Runtime fast lane",
        description: "Compare a faster compatible model lane against the current runner model.",
        reason: "Runtime is an explicit objective, and the source carries enough evidence to compare output quality.",
        changeType: "runner_model",
        plannedChange: { runnerModel: "fast-compatible" },
      },
    ];
  }

  if (objective === "improve_acceptance") {
    return [
      {
        key: "acceptance-proof",
        name: "Acceptance proof",
        description: "Make acceptance criteria and verification evidence explicit before final handoff.",
        reason: `${sourceLabel} was accepted, so this variant tests whether the accepted proof pattern is repeatable.`,
        changeType: "prompt",
        plannedChange: { promptDelta: "acceptance-proof-first" },
      },
      {
        key: "source-pattern-reuse",
        name: "Source pattern reuse",
        description: "Reuse the source task's successful context and evidence shape.",
        reason: "Accepted source work is the strongest available pattern for a bounded comparison.",
        changeType: "context_package",
        plannedChange: { contextPackage: "accepted-source-pattern" },
      },
      {
        key: "review-ready-final",
        name: "Review-ready final",
        description: "Force the final answer to name changed files, tests, and residual risk.",
        reason: "Accepted outcomes often depend on reviewer-ready evidence, not only implementation success.",
        changeType: "prompt",
        plannedChange: { promptDelta: "review-ready-final-format" },
      },
    ];
  }

  return [
    {
      key: "review-return-fix",
      name: "Review return fix",
      description: "Target the likely reviewer return reason with a narrower task contract.",
      reason: `${sourceLabel} review context points to a specific correction loop to compare.`,
      changeType: "prompt",
      plannedChange: { promptDelta: "review-return-targeted-contract" },
    },
    {
      key: "evidence-linking",
      name: "Evidence linking",
      description: "Require source links, test names, and acceptance evidence in the final handoff.",
      reason: "Reviewer returns usually hinge on missing or weak evidence links.",
      changeType: "context_package",
      plannedChange: { contextPackage: "source-linked-evidence" },
    },
    {
      key: "smaller-work-slice",
      name: "Smaller work slice",
      description: "Split the work into the smallest runnable implementation and verification loop.",
      reason: "A smaller slice tests whether review returns fall when scope is easier to audit.",
      changeType: "task_decomposition",
      plannedChange: { decomposition: "smallest-reviewable-slice" },
    },
  ];
}

function defaultSelectedVariantKeys(proposals: ProposedExperimentVariant[], variantCap: number): string[] {
  const capped = Math.min(Math.max(1, Number.isInteger(variantCap) ? variantCap : 1), 3);
  return proposals.slice(0, capped).map((variant) => variant.key);
}

function toggleSelectedVariant(current: string[], key: string, selected: boolean): string[] {
  if (!selected) return current.filter((item) => item !== key);
  return Array.from(new Set([...current, key]));
}

export function variantSelectionErrors(selectedCount: number, variantCap: number): string[] {
  if (selectedCount < 1) return ["Select at least one proposed variant."];
  if (selectedCount > 3) return ["Experiments can approve at most three variants."];
  if (Number.isFinite(variantCap) && selectedCount > variantCap) {
    return [`Selected variants must stay at or below the reviewed variant cap of ${variantCap}.`];
  }
  return [];
}

function definitionForObjective(objective: ExperimentLaunchObjectiveKey): string {
  if (objective === "improve_acceptance") return "Accepted output quality improves or stays accepted with stronger repeatability evidence.";
  if (objective === "reduce_cost") return "Cost exposure is lower without weakening accepted task evidence.";
  if (objective === "shorten_runtime") return "Runtime is shorter while preserving source-linked verification.";
  return "Reviewer return risk is reduced with clearer evidence and a narrower work contract.";
}

function hypothesisForSelection(variants: ProposedExperimentVariant[]): string {
  return `Selected variants test: ${variants.map((variant) => variant.reason).join(" ")}`;
}

export function launchBlockedMessage(input: {
  apiReady: boolean;
  liveReady: boolean;
  limitsReviewed: boolean;
  reviewErrors: string[];
  fallback: string;
}): string {
  if (!input.apiReady) return "Experiment approval needs a company context before calling the API.";
  if (!input.liveReady) return "Live workspace mode requires explicit governed operator selection before approval.";
  if (input.reviewErrors.length > 0) return input.reviewErrors[0];
  if (!input.limitsReviewed) return "Review limits before approving selected variants.";
  return input.fallback;
}

async function createExperimentDraftFromPanel(
  companyKey: string,
  payload: Record<string, unknown>,
): Promise<ExperimentApiRecord> {
  const response = await fetch(`/api/orchestration/companies/${encodeURIComponent(companyKey)}/experiments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await readExperimentApiResponse(response);
  return normalizeExperimentApiRecord(body.experiment);
}

async function approveExperimentVariantsFromPanel(
  companyKey: string,
  experimentId: string,
  payload: Record<string, unknown>,
): Promise<ExperimentApiRecord> {
  const response = await fetch(`/api/orchestration/companies/${encodeURIComponent(companyKey)}/experiments/${encodeURIComponent(experimentId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "approve_variants", ...payload }),
  });
  const body = await readExperimentApiResponse(response);
  return normalizeExperimentApiRecord(body.experiment);
}

async function readExperimentApiResponse(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = isRecord(body.error) ? body.error : {};
    const message = typeof error.message === "string"
      ? error.message
      : typeof error.code === "string"
        ? error.code
        : `Experiment API request failed with ${response.status}`;
    throw new Error(message);
  }
  return isRecord(body) ? body : {};
}

function normalizeExperimentApiRecord(value: unknown): ExperimentApiRecord {
  const record = isRecord(value) ? value : {};
  const limits = isRecord(record.limits) ? record.limits : {};
  return {
    id: String(record.id ?? ""),
    status: String(record.status ?? "draft"),
    workspaceMode: record.workspaceMode === "branch" || record.workspaceMode === "live" ? record.workspaceMode : "snapshot",
    limits: {
      variantCap: numberValue(limits.variantCap, 1),
      attemptLimit: numberValue(limits.attemptLimit, 1),
      timeboxMinutes: numberValue(limits.timeboxMinutes, 5),
    },
    variants: Array.isArray(record.variants)
      ? record.variants.map((variant) => {
          const item = isRecord(variant) ? variant : {};
          return {
            id: String(item.id ?? ""),
            key: String(item.key ?? ""),
            name: String(item.name ?? ""),
            status: String(item.status ?? "draft"),
          };
        })
      : [],
  };
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function SourceSummary({ model }: { model: ExperimentLaunchModel }) {
  const rows = [
    { label: "Source", value: model.source.label },
    { label: "Task", value: model.source.taskKey ?? model.source.taskTitle },
    { label: "Review", value: model.source.reviewOutcome },
    { label: "Capture", value: model.source.captureQuality },
    { label: "Project", value: model.source.projectName },
    { label: "Agent", value: model.source.agentName },
    { label: "Runner", value: model.source.runnerLabel },
    { label: "Model", value: model.source.modelLabel },
    { label: "Snapshot", value: model.source.snapshotSha256 ? model.source.snapshotSha256.slice(0, 12) : null, mono: true },
  ].filter((row): row is { label: string; value: string; mono?: boolean } => typeof row.value === "string" && row.value.length > 0);

  return (
    <div
      style={{
        borderRadius: radius.md,
        border: `0.5px solid ${color.border}`,
        background: color.surfaceElevated,
        padding: space.md,
        display: "grid",
        gap: space.sm,
      }}
    >
      <div style={{ color: color.text, fontSize: T.bodySmall.size, fontWeight: 700 }}>Source summary</div>
      <div style={{ color: color.textSecondary, fontSize: T.bodySmall.size, lineHeight: T.bodySmall.lineHeight }}>
        {model.source.subtitle}
      </div>
      <div style={summaryGridStyle}>
        {rows.map((row) => (
          <div key={`${row.label}:${row.value}`} style={{ minWidth: 0 }}>
            <div style={{ color: color.textMuted, fontSize: T.caption.size }}>{row.label}</div>
            <div
              title={row.value}
              style={{
                color: color.text,
                fontSize: row.mono ? T.caption.size : T.bodySmall.size,
                fontFamily: row.mono ? font.mono : font.body,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {row.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ExperimentLaunchUnavailableState({ model }: { model: ExperimentLaunchModel }) {
  const title = model.availability.state === "empty"
    ? "No launch source"
    : model.availability.state === "error"
      ? "Launch source error"
      : "Launch disabled";
  return (
    <ExperimentLaunchStateMessage
      state={model.availability.state}
      title={title}
      body={model.availability.reason}
    />
  );
}

function ExperimentLaunchStateMessage({
  state,
  title,
  body,
}: {
  state: "available" | "disabled" | "empty" | "error";
  title: string;
  body: string;
}) {
  const tone = availabilityTone(state);
  const Icon = state === "available" ? Check : AlertTriangle;
  return (
    <div
      role={state === "error" ? "alert" : "status"}
      style={{
        display: "flex",
        gap: space.sm,
        alignItems: "flex-start",
        borderRadius: radius.md,
        border: `0.5px solid ${tone.border}`,
        background: tone.bg,
        color: tone.text,
        padding: space.md,
      }}
    >
      <Icon size={14} style={{ flexShrink: 0, marginTop: 1 }} />
      <span style={{ display: "grid", gap: 3 }}>
        <span style={{ fontSize: T.bodySmall.size, fontWeight: 700 }}>{title}</span>
        <span style={{ fontSize: T.caption.size, color: tone.bodyText, lineHeight: 1.45 }}>{body}</span>
      </span>
    </div>
  );
}

function LimitInput({
  spec,
  value,
  onChange,
}: {
  spec: ExperimentLaunchLimitSpec;
  value: number;
  onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <label htmlFor={id} style={{ display: "grid", gap: 5, minWidth: 0 }}>
      <span style={{ color: color.textSecondary, fontSize: T.caption.size, fontWeight: 700 }}>{spec.label}</span>
      <input
        id={id}
        type="number"
        value={value}
        min={spec.min}
        max={spec.max}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        style={{
          width: "100%",
          minHeight: 34,
          borderRadius: radius.sm,
          border: `0.5px solid ${color.border}`,
          background: color.surface,
          color: color.text,
          padding: "5px 8px",
          fontSize: T.bodySmall.size,
          fontFamily: font.mono,
          outline: "none",
        }}
      />
      <span style={{ color: color.textMuted, fontSize: T.caption.size }}>
        {spec.min}-{spec.max} {spec.unit}
      </span>
    </label>
  );
}

function WorkspaceModeIcon({ mode }: { mode: ExperimentWorkspaceModeKey }) {
  const Icon = mode === "snapshot" ? ShieldCheck : mode === "branch" ? GitBranch : Radio;
  return <Icon size={14} style={{ color: mode === "live" ? color.warning : color.accent, flexShrink: 0, marginTop: 2 }} />;
}

function collectLimitError(errors: string[], spec: ExperimentLaunchLimitSpec, value: number) {
  if (!Number.isFinite(value)) {
    errors.push(`${spec.label} must be a number.`);
    return;
  }
  if (value < spec.min || value > spec.max) {
    errors.push(`${spec.label} must stay between ${spec.min} and ${spec.max} ${spec.unit}.`);
  }
}

function availabilityTone(state: "available" | "disabled" | "empty" | "error") {
  if (state === "available") {
    return {
      label: "Ready",
      text: color.positive,
      bodyText: color.textSecondary,
      bg: color.positiveSoft,
      border: "rgba(34,197,94,0.24)",
    };
  }
  if (state === "error") {
    return {
      label: "Error",
      text: color.negative,
      bodyText: color.textSecondary,
      bg: color.negativeSoft,
      border: "rgba(239,68,68,0.28)",
    };
  }
  if (state === "empty") {
    return {
      label: "Empty",
      text: color.warning,
      bodyText: color.textSecondary,
      bg: color.warningSoft,
      border: "rgba(245,158,11,0.28)",
    };
  }
  return {
    label: "Disabled",
    text: color.textMuted,
    bodyText: color.textSecondary,
    bg: "rgba(120,113,108,0.12)",
    border: "rgba(120,113,108,0.22)",
  };
}

const fieldsetStyle: CSSProperties = {
  border: `0.5px solid ${color.border}`,
  borderRadius: radius.md,
  padding: space.md,
  margin: 0,
  display: "grid",
  gap: space.sm,
  minWidth: 0,
};

const legendStyle: CSSProperties = {
  color: color.textSecondary,
  fontSize: T.caption.size,
  fontWeight: 700,
  padding: "0 5px",
};

const optionGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
  gap: space.sm,
};

const modeGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
  gap: space.sm,
};

const limitsGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
  gap: space.sm,
};

const variantGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: space.sm,
};

const summaryGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(115px, 1fr))",
  gap: space.sm,
};

function optionCardStyle(active: boolean): CSSProperties {
  return {
    display: "flex",
    gap: space.sm,
    alignItems: "flex-start",
    minWidth: 0,
    borderRadius: radius.md,
    border: `0.5px solid ${active ? color.accent : color.border}`,
    background: active ? color.accentSoft : color.surfaceElevated,
    padding: space.sm,
    cursor: "pointer",
  };
}

function modeCardStyle(active: boolean, guarded?: boolean): CSSProperties {
  return {
    ...optionCardStyle(active),
    borderColor: active ? (guarded ? color.warning : color.accent) : color.border,
    background: active ? (guarded ? color.warningSoft : color.accentSoft) : color.surfaceElevated,
  };
}

function variantCardStyle(active: boolean): CSSProperties {
  return {
    display: "flex",
    gap: space.sm,
    alignItems: "flex-start",
    minWidth: 0,
    minHeight: 122,
    borderRadius: radius.md,
    border: `0.5px solid ${active ? color.accent : color.border}`,
    background: active ? color.accentSoft : color.surfaceElevated,
    padding: space.sm,
    cursor: "pointer",
  };
}

const variantTypePillStyle: CSSProperties = {
  borderRadius: radius.full,
  border: `0.5px solid ${color.border}`,
  color: color.textMuted,
  fontSize: T.caption.size,
  padding: "1px 6px",
  textTransform: "capitalize",
};

const limitReviewStyle: CSSProperties = {
  borderRadius: radius.md,
  border: `0.5px solid ${color.border}`,
  background: color.surfaceElevated,
  padding: space.md,
  display: "grid",
  gap: space.sm,
};

function launchButtonStyle(enabled: boolean): CSSProperties {
  return {
    minHeight: 34,
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    borderRadius: radius.sm,
    border: `0.5px solid ${enabled ? color.accent : color.border}`,
    background: enabled ? color.accentSoft : "rgba(120,113,108,0.1)",
    color: enabled ? color.accent : color.textMuted,
    padding: "6px 11px",
    fontSize: T.bodySmall.size,
    fontWeight: 700,
    cursor: enabled ? "pointer" : "not-allowed",
  };
}

const errorTextStyle: CSSProperties = {
  color: color.negative,
  fontSize: T.caption.size,
  lineHeight: 1.4,
};
