/**
 * HiveRunner — Provider Switch Service
 *
 * Owns both the decision logic (computeSwitchPlan) and the mutation
 * (switchAgentProvider). The plan is the single source of truth for
 * whether a switch is allowed, what would change, and why.
 *
 * Architecture:
 *   computeSwitchPlan()    — read-only decision; used by preflight route
 *   switchAgentProvider()  — calls computeSwitchPlan(), then applies mutations
 *
 * This ensures the preflight/simulation surface and the real mutation
 * path can never diverge in their decision logic.
 *
 * Keep this aligned with the runtime inventory and provider activation service.
 */

import { getOrchestrationDb } from "../db";
import {
  checkProviderActivation,
  resolveAgentProviderFromRecord,
} from "./provider-activation";
import type {
  AgentForActivationCheck,
  ProviderActivationResult,
} from "./provider-activation";
import { TIER_LABELS } from "../adapters/types";
import { createApproval, getApproval } from "./approval";
import { recordCompanyAuditEvent } from "./audit";
import { listCompanyCostLedger, type CompanyCostLedger, type ProviderProfile } from "../cost-ledger";

const PROVIDER_SWITCH_IN_FLIGHT_STALE_MS = 30 * 60 * 1000;

/* ══════════════════════════════════════════
   Shared Types
   ══════════════════════════════════════════ */

/**
 * Reason codes for why a switch is blocked.
 */
export type SwitchBlockReason =
  | "validation_failed"
  | "in_flight_execution"
  | "already_current"
  | "agent_not_found"
  | "approval_required"
  | "billing_confirmation_required";

/**
 * In-flight execution details.
 */
export interface InFlightRunDetail {
  kind: "heartbeat" | "wakeup" | "execution";
  id: string;
  status: string;
  provider: string | null;
  taskId: string | null;
  taskKey: string | null;
  taskTitle: string | null;
  taskStatus: string | null;
  createdAt: string | null;
  startedAt: string | null;
  updatedAt: string | null;
}

export interface InFlightDetails {
  activeHeartbeatRuns: number;
  pendingWakeupRequests: number;
  activeExecutionRuns: number;
  runs: InFlightRunDetail[];
}

/**
 * Non-blocking warning about the switch.
 */
export interface SwitchWarning {
  code: string;
  message: string;
}

export interface BillingBudgetImpact {
  budgetUsd: number;
  monthSpendUsd: number;
  projectedMonthSpendUsd: number;
  meteredSpendUsd: number;
  utilizationPercent: number;
  requiresBudgetApproval: boolean;
  reason: string | null;
}

/**
 * What would change (or did change) during a switch.
 */
export interface SwitchStateChanges {
  previousProvider: string;
  newProvider: string;
  previousModel: string | null;
  newModel: string | null;
  adapterTypeUpdated: boolean;
  modelUpdated: boolean;
  providerChangedAtSet: boolean;
  previousAdapterTypeRecorded: boolean;
  runtimeStateReset: boolean;
  modelKept: boolean;
  /** Human-readable list of preserved fields */
  preserved: string[];
  /** Human-readable list of reset fields */
  reset: string[];
}

/* ══════════════════════════════════════════
   Switch Plan — the shared decision type
   ══════════════════════════════════════════ */

/**
 * The outcome mode of a switch plan.
 *
 * - `noop`: target is already the current provider
 * - `blocked`: switch is refused due to one or more blockers
 * - `switchable`: switch is allowed and would proceed if executed
 */
export type SwitchPlanMode = "noop" | "blocked" | "switchable";

/**
 * A fully computed switch plan.
 *
 * This is the single canonical decision type for provider switching.
 * Both the preflight route and the mutation route consume this.
 * The preflight route returns it directly. The mutation route
 * checks `plan.mode === "switchable"` before applying changes.
 *
 * Read-only — computing a plan does NOT mutate anything.
 */
export interface SwitchPlan {
  /** Whether this switch would be allowed */
  allowed: boolean;

  /** Outcome mode */
  mode: SwitchPlanMode;

  /** Agent identity */
  companyId: string;
  agentId: string;
  agentName: string;

  /** Provider identities */
  currentProvider: string;
  targetProvider: string;

  /** Block reason (if mode is "blocked" or "noop") */
  blockReason: SwitchBlockReason | null;

  /** Human-readable summary */
  summary: string;

  /** Blockers: conditions that prevent the switch */
  blockers: Array<{ code: string; message: string }>;

  /** Warnings: non-blocking concerns the operator should know about */
  warnings: SwitchWarning[];

  /** Activation validation result (if computed) */
  activation: ProviderActivationResult | null;

  /** In-flight execution details (if checked) */
  inFlight: InFlightDetails | null;

  /**
   * What would change if the switch is executed.
   * Only populated when mode is "switchable".
   */
  stateChanges: SwitchStateChanges | null;

  /**
   * Provider presentation for current and target.
   * Useful for UI confirmation displays.
   */
  currentProviderDisplay: {
    displayName: string;
    tier: number;
    tierLabel: string;
  };
  targetProviderDisplay: {
    displayName: string;
    tier: number;
    tierLabel: string;
  } | null;

  currentBillingProfile: ProviderProfile | null;
  targetBillingProfile: ProviderProfile | null;
  requiresBillingConfirmation: boolean;
  billingConfirmationReason: string | null;
  billingBudgetImpact: BillingBudgetImpact | null;
}

/* ══════════════════════════════════════════
   computeSwitchPlan — the shared decision
   ══════════════════════════════════════════ */

/**
 * Compute a switch plan for an agent without mutating anything.
 *
 * This is the canonical decision path. Both preflight and mutation
 * call this function. The plan describes exactly what would happen
 * if the switch were executed.
 *
 * @param agentIdOrSlug - Agent ID, slug, or name
 * @param targetProvider - Target adapter_type value (for example "openclaw", "codex", or "anthropic")
 * @param env - Environment variables (for activation checks)
 */
export function computeSwitchPlan(
  agentIdOrSlug: string,
  targetProvider: string,
  env?: Record<string, string | undefined>,
  options: { targetModel?: string | null; ignoreInFlight?: boolean } = {},
): SwitchPlan {
  const db = getOrchestrationDb();

  // ── Load agent ──

  const agent = db
    .prepare(
      `SELECT id, company_id, adapter_type, model, openclaw_agent_id,
              name, status
       FROM agents
       WHERE (id = ? OR slug = ? OR lower(name) = lower(?))
         AND archived_at IS NULL
       LIMIT 1`,
    )
    .get(agentIdOrSlug, agentIdOrSlug, agentIdOrSlug) as {
      id: string;
      company_id: string;
      adapter_type: string;
      model: string | null;
      openclaw_agent_id: string | null;
      name: string;
      status: string;
    } | undefined;

  if (!agent) {
    return notFoundPlan(agentIdOrSlug);
  }

  // Resolve current provider display
  const currentPres = resolveAgentProviderFromRecord({
    adapterType: agent.adapter_type,
    openclawAgentId: agent.openclaw_agent_id ?? undefined,
  });

  const currentProviderDisplay = {
    displayName: currentPres.displayName,
    tier: currentPres.tier,
    tierLabel: TIER_LABELS[currentPres.tier] ?? "Unknown",
  };

  // ── Already current? ──

  const normalizedCurrent = normalizeAdapterType(agent.adapter_type);
  const normalizedTarget = normalizeAdapterType(targetProvider);
  const requestedModel = options.targetModel?.trim() || null;
  const normalizedCurrentModel = agent.model?.trim() || null;
  const targetModel = requestedModel ?? normalizedCurrentModel;
  const modelWillChange = requestedModel !== null && requestedModel !== normalizedCurrentModel;
  const providerWillChange = normalizedCurrent !== normalizedTarget;
  const costLedger = listCompanyCostLedger(agent.company_id, "mtd");
  const billingProfiles = costLedger.providerProfiles;
  const currentBillingProfile = findBillingProfile(billingProfiles, normalizedCurrent);
  const targetBillingProfile = findBillingProfile(billingProfiles, normalizedTarget);
  const billingConfirmation = billingConfirmationForProfile(targetProvider, targetBillingProfile);
  const billingBudgetImpact = budgetImpactForProfile(costLedger, targetBillingProfile);

  if (!providerWillChange && !modelWillChange) {
    return {
      allowed: false,
      mode: "noop",
      companyId: agent.company_id,
      agentId: agent.id,
      agentName: agent.name,
      currentProvider: agent.adapter_type,
      targetProvider,
      blockReason: "already_current",
      summary: `Agent '${agent.name}' is already using ${targetProvider}${targetModel ? ` with ${targetModel}` : ""}. No change needed.`,
      blockers: [],
      warnings: [],
      activation: null,
      inFlight: null,
      stateChanges: null,
      currentProviderDisplay,
      targetProviderDisplay: currentProviderDisplay, // same
      currentBillingProfile,
      targetBillingProfile: currentBillingProfile,
      requiresBillingConfirmation: false,
      billingConfirmationReason: null,
      billingBudgetImpact: budgetImpactForProfile(costLedger, currentBillingProfile),
    };
  }

  // ── Validate activation ──

  const agentForCheck: AgentForActivationCheck = {
    id: agent.id,
    adapterType: agent.adapter_type,
    model: targetModel,
    openclawAgentId: agent.openclaw_agent_id,
  };

  const activationProviderId = targetProvider === "openclaw"
    ? "openclaw-heartbeat"
    : targetProvider;

  const activation = checkProviderActivation(agentForCheck, activationProviderId, env);

  // Build target display from activation result
  const targetProviderDisplay = activation.consequences
    ? {
        displayName: activation.providerId,
        tier: activation.consequences.tierChange?.to.tier ?? currentPres.tier,
        tierLabel: activation.consequences.tierChange?.to.label ?? currentProviderDisplay.tierLabel,
      }
    : null;

  // Resolve display name for target from the activation's product descriptors
  const targetPres = resolveAgentProviderFromRecord({
    adapterType: targetProvider,
    openclawAgentId: agent.openclaw_agent_id ?? undefined,
  });
  const resolvedTargetDisplay = targetProviderDisplay ?? {
    displayName: targetPres.displayName,
    tier: targetPres.tier,
    tierLabel: TIER_LABELS[targetPres.tier] ?? "Unknown",
  };

  if (!activation.canActivate) {
    const blockers = activation.checks
      .filter((c) => c.blocking && !c.passed)
      .map((c) => ({ code: c.check, message: c.detail }));

    return {
      allowed: false,
      mode: "blocked",
      companyId: agent.company_id,
      agentId: agent.id,
      agentName: agent.name,
      currentProvider: agent.adapter_type,
      targetProvider,
      blockReason: "validation_failed",
      summary: activation.summary,
      blockers,
      warnings: [],
      activation,
      inFlight: null,
      stateChanges: null,
      currentProviderDisplay,
      targetProviderDisplay: resolvedTargetDisplay,
      currentBillingProfile,
      targetBillingProfile,
      requiresBillingConfirmation: billingConfirmation.required,
      billingConfirmationReason: billingConfirmation.reason,
      billingBudgetImpact,
    };
  }

  // ── Check in-flight execution ──

  const inFlight = checkInFlightExecution(db, agent.id);
  const inFlightBlockers = buildInFlightBlockers(inFlight.details);

  if (inFlight.hasInFlight && options.ignoreInFlight !== true) {
    return {
      allowed: false,
      mode: "blocked",
      companyId: agent.company_id,
      agentId: agent.id,
      agentName: agent.name,
      currentProvider: agent.adapter_type,
      targetProvider,
      blockReason: "in_flight_execution",
      summary: providerWillChange
        ? `Cannot switch provider while agent '${agent.name}' has in-flight execution. Wait for current runs to complete.`
        : `Cannot change model while agent '${agent.name}' has in-flight execution. Wait for current runs to complete.`,
      blockers: inFlightBlockers,
      warnings: [],
      activation,
      inFlight: inFlight.details,
      stateChanges: null,
      currentProviderDisplay,
      targetProviderDisplay: resolvedTargetDisplay,
      currentBillingProfile,
      targetBillingProfile,
      requiresBillingConfirmation: billingConfirmation.required,
      billingConfirmationReason: billingConfirmation.reason,
      billingBudgetImpact,
    };
  }

  // ── Switchable — compute warnings and state changes ──

  const warnings: SwitchWarning[] = [];
  if (inFlight.hasInFlight && options.ignoreInFlight === true) {
    warnings.push({
      code: "in_flight_execution",
      message: `${providerWillChange ? "Provider switch" : "Model change"} is ready, but apply is locked until current work finishes: ${inFlightBlockers.map((item) => item.message).join(" ")}`,
    });
  }
  warnings.push(...billingWarningsForProfile(targetProvider, targetBillingProfile));
  const budgetWarning = budgetWarningForImpact(billingBudgetImpact);
  if (budgetWarning) warnings.push(budgetWarning);

  // Non-blocking warnings
  const modelCheck = activation.checks.find((c) => c.check === "model_compatible");
  if (modelCheck && !modelCheck.passed && !modelCheck.blocking) {
    warnings.push({
      code: "model_compatibility_unknown",
      message: modelCheck.detail,
    });
  }

  // Tier downgrade warning
  if (activation.consequences?.tierChange) {
    const { from, to } = activation.consequences.tierChange;
    if (to.tier < from.tier) {
      warnings.push({
        code: "tier_downgrade",
        message: `Live activity detail changes from T${from.tier} (${from.label}) to T${to.tier} (${to.label}). The agent can still run; HiveRunner will have less live telemetry to show while it works.`,
      });
    }
  }

  // Capability loss warnings
  if (activation.consequences?.capabilityChanges) {
    const losses = activation.consequences.capabilityChanges.filter(
      (c) => c.from === true && c.to === false,
    );
    if (losses.length > 0) {
      warnings.push({
        code: "capability_loss",
        message: `This runtime does not currently stream ${losses.map((l) => l.capability).join(", ")} into the dashboard.`,
      });
    }
  }

  // State change preview
  const hasRuntimeState = !!(db
    .prepare("SELECT 1 FROM agent_runtime_state WHERE agent_id = ?")
    .get(agent.id));

  const stateChanges: SwitchStateChanges = {
    previousProvider: agent.adapter_type,
    newProvider: targetProvider,
    previousModel: normalizedCurrentModel,
    newModel: targetModel,
    adapterTypeUpdated: providerWillChange,
    modelUpdated: modelWillChange,
    providerChangedAtSet: providerWillChange,
    previousAdapterTypeRecorded: providerWillChange,
    runtimeStateReset: hasRuntimeState,
    modelKept: !modelWillChange,
    preserved: [
      "agent identity (name, emoji, role, personality)",
      "external IDs (openclaw_agent_id)",
      "task history (execution_runs, heartbeat_runs)",
      "task sessions under previous adapter_type",
      "cumulative token/cost accounting",
      ...(!modelWillChange ? ["model selection"] : []),
    ],
    reset: [
      "agent_runtime_state.session_id",
      "agent_runtime_state.state_json",
      "agent_runtime_state.last_run_id",
      "agent_runtime_state.last_run_status",
      "agent_runtime_state.last_error",
      ...(providerWillChange ? ["agent_runtime_state.adapter_type (updated to new provider)"] : []),
      ...(modelWillChange && !providerWillChange ? ["agent_runtime_state session context (cleared for model change)"] : []),
    ],
  };

  return {
    allowed: true,
    mode: "switchable",
    companyId: agent.company_id,
    agentId: agent.id,
    agentName: agent.name,
    currentProvider: agent.adapter_type,
    targetProvider,
    blockReason: null,
    summary: providerWillChange
      ? `${agent.name} can run on ${resolvedTargetDisplay.displayName}${targetModel ? ` using ${targetModel}` : ""}.`
      : `${agent.name} can keep ${resolvedTargetDisplay.displayName} and use ${targetModel ?? "the provider default model"}.`,
    blockers: [],
    warnings,
    activation,
    inFlight: inFlight.details,
    stateChanges,
    currentProviderDisplay,
    targetProviderDisplay: resolvedTargetDisplay,
    currentBillingProfile,
    targetBillingProfile,
    requiresBillingConfirmation: billingConfirmation.required,
    billingConfirmationReason: billingConfirmation.reason,
    billingBudgetImpact,
  };
}

/* ══════════════════════════════════════════
   switchAgentProvider — the mutation
   ══════════════════════════════════════════ */

/**
 * Result of a provider switch attempt.
 */
export interface ProviderSwitchResult {
  switched: boolean;
  agentId: string;
  blockReason: SwitchBlockReason | null;
  message: string;
  activation: ProviderActivationResult | null;
  changes: SwitchStateChanges | null;
  inFlightDetails: InFlightDetails | null;
  approval: {
    id: string;
    status: string;
    type: string;
  } | null;
  /** The full plan that governed this decision */
  plan: SwitchPlan;
}

export interface ProviderSwitchOptions {
  /**
   * Defaults to true for operator/UI initiated switches.
   * Internal callers may set false only after an approval has been granted
   * or when running controlled tests.
   */
  requireApproval?: boolean;
  approvedByApprovalId?: string | null;
  actorUserId?: string | null;
  billingConfirmed?: boolean;
  targetModel?: string | null;
}

/**
 * Attempt to switch an agent's execution provider.
 *
 * Computes a switch plan, then applies mutations only if the plan
 * says the switch is allowed. This ensures preflight and mutation
 * can never diverge.
 */
export function switchAgentProvider(
  agentIdOrSlug: string,
  targetProvider: string,
  env?: Record<string, string | undefined>,
  options: ProviderSwitchOptions = {},
): ProviderSwitchResult {
  // Compute the plan (read-only decision)
  const plan = computeSwitchPlan(agentIdOrSlug, targetProvider, env, {
    targetModel: options.targetModel,
  });

  // If not switchable, return structured refusal
  if (!plan.allowed || plan.mode !== "switchable") {
    return {
      switched: false,
      agentId: plan.agentId,
      blockReason: plan.blockReason,
      message: plan.summary,
      activation: plan.activation,
      changes: null,
      inFlightDetails: plan.inFlight,
      approval: null,
      plan,
    };
  }

  if (
    options.requireApproval !== false &&
    plan.requiresBillingConfirmation &&
    options.billingConfirmed !== true
  ) {
    return {
      switched: false,
      agentId: plan.agentId,
      blockReason: "billing_confirmation_required",
      message: plan.billingConfirmationReason ?? "Provider switch requires billing confirmation.",
      activation: plan.activation,
      changes: null,
      inFlightDetails: plan.inFlight,
      approval: null,
      plan,
    };
  }

  const providerWillChange = plan.stateChanges?.adapterTypeUpdated === true;
  if (providerWillChange && options.requireApproval !== false) {
    const approvedApproval = resolveApprovedProviderSwitchApproval(
      plan,
      options.approvedByApprovalId,
    );
    if (!approvedApproval) {
      const { approval } = createApproval({
        companyIdOrSlug: plan.companyId,
        type: "provider_switch",
        requestedByAgentId: plan.agentId,
        payload: {
          agentId: plan.agentId,
          agentName: plan.agentName,
          currentProvider: plan.currentProvider,
          targetProvider: plan.targetProvider,
          warnings: plan.warnings,
          billingProfile: plan.targetBillingProfile,
          billingBudgetImpact: plan.billingBudgetImpact,
          stateChanges: plan.stateChanges,
        },
      });

      recordCompanyAuditEvent({
        companyId: plan.companyId,
        agentId: plan.agentId,
        approvalId: approval.id,
        eventType: "agent.provider_switch.approval_requested",
        actorUserId: options.actorUserId ?? "operator",
        metadata: {
          currentProvider: plan.currentProvider,
          targetProvider: plan.targetProvider,
          approvalStatus: approval.status,
        },
      });

      return {
        switched: false,
        agentId: plan.agentId,
        blockReason: "approval_required",
        message: `Provider switch from ${plan.currentProvider} to ${plan.targetProvider} for agent '${plan.agentName}' requires approval.`,
        activation: plan.activation,
        changes: null,
        inFlightDetails: plan.inFlight,
        approval: {
          id: approval.id,
          status: approval.status,
          type: approval.type,
        },
        plan,
      };
    }
  }

  // ── Apply mutations ──

  const db = getOrchestrationDb();
  const now = new Date().toISOString();

  // Update agents table
  if (providerWillChange) {
    db.prepare(
      `UPDATE agents
       SET adapter_type = ?,
           model = COALESCE(?, model),
           previous_adapter_type = ?,
           provider_changed_at = ?,
           updated_at = ?
       WHERE id = ?`,
    ).run(targetProvider, plan.stateChanges?.newModel ?? null, plan.currentProvider, now, now, plan.agentId);
  } else if (plan.stateChanges?.modelUpdated) {
    db.prepare(
      `UPDATE agents
       SET model = ?,
           updated_at = ?
       WHERE id = ?`,
    ).run(plan.stateChanges.newModel, now, plan.agentId);
  }

  // Reset runtime state
  const runtimeStateExists = db
    .prepare("SELECT 1 FROM agent_runtime_state WHERE agent_id = ?")
    .get(plan.agentId);

  if (runtimeStateExists) {
    db.prepare(
      `UPDATE agent_runtime_state
       SET adapter_type = ?,
           session_id = NULL,
           state_json = '{}',
           last_run_id = NULL,
           last_run_status = NULL,
           last_error = NULL,
           updated_at = ?
       WHERE agent_id = ?`,
    ).run(targetProvider, now, plan.agentId);
  }

  recordCompanyAuditEvent({
    companyId: plan.companyId,
    agentId: plan.agentId,
    approvalId: options.approvedByApprovalId ?? null,
    eventType: providerWillChange ? "agent.provider_switched" : "agent.model_updated",
    actorUserId: options.actorUserId ?? "operator",
    metadata: {
      previousProvider: plan.currentProvider,
      targetProvider,
      previousModel: plan.stateChanges?.previousModel ?? null,
      targetModel: plan.stateChanges?.newModel ?? null,
      runtimeStateReset: Boolean(runtimeStateExists),
    },
  });

  return {
    switched: true,
    agentId: plan.agentId,
    blockReason: null,
    message: providerWillChange
      ? `Provider switched from ${plan.currentProvider} to ${targetProvider} for agent '${plan.agentName}'.`
      : `Model updated for agent '${plan.agentName}'.`,
    activation: plan.activation,
    changes: plan.stateChanges,
    inFlightDetails: null,
    approval: options.approvedByApprovalId
      ? {
          id: options.approvedByApprovalId,
          status: "approved",
          type: "provider_switch",
        }
      : null,
    plan,
  };
}

/* ══════════════════════════════════════════
   Backward-compatible re-exports
   ══════════════════════════════════════════ */

/** @deprecated Use SwitchStateChanges instead */
export type ProviderSwitchChanges = SwitchStateChanges;

/* ══════════════════════════════════════════
   Helpers
   ══════════════════════════════════════════ */

function notFoundPlan(agentIdOrSlug: string): SwitchPlan {
  return {
    allowed: false,
    mode: "blocked",
    companyId: "",
    agentId: agentIdOrSlug,
    agentName: "unknown",
    currentProvider: "unknown",
    targetProvider: "unknown",
    blockReason: "agent_not_found",
    summary: `Agent '${agentIdOrSlug}' not found.`,
    blockers: [{ code: "agent_not_found", message: `Agent '${agentIdOrSlug}' not found.` }],
    warnings: [],
    activation: null,
    inFlight: null,
    stateChanges: null,
    currentProviderDisplay: { displayName: "unknown", tier: 0, tierLabel: "Unknown" },
    targetProviderDisplay: null,
    currentBillingProfile: null,
    targetBillingProfile: null,
    requiresBillingConfirmation: false,
    billingConfirmationReason: null,
    billingBudgetImpact: null,
  };
}

function findBillingProfile(profiles: ProviderProfile[], provider: string): ProviderProfile | null {
  const normalized = normalizeAdapterType(provider).toLowerCase();
  return profiles.find((profile) => normalizeAdapterType(profile.provider).toLowerCase() === normalized) ?? null;
}

function billingWarningsForProfile(targetProvider: string, profile: ProviderProfile | null): SwitchWarning[] {
  if (!profile) {
    return [{
      code: "billing_profile_unknown",
      message: `${targetProvider} has no billing profile yet. Confirm whether this route is metered, subscription-included, local/free, or hybrid before relying on spend controls.`,
    }];
  }

  if (profile.billingModel === "metered_tokens" || profile.billingModel === "subscription_overage") {
    return [{
      code: "metered_billing",
      message: `${targetProvider} is classified as ${profile.billingModel.replace(/_/g, " ")} billed by ${profile.biller}. Token usage is expected to create billable spend.`,
    }];
  }

  if (profile.billingModel === "hybrid" || profile.billingModel === "unknown") {
    return [{
      code: "billing_profile_needs_confirmation",
      message: `${targetProvider} is classified as ${profile.billingModel.replace(/_/g, " ")} through ${profile.biller}. Confirm the profile if this provider can route to metered downstream usage.`,
    }];
  }

  return [];
}

function billingConfirmationForProfile(
  targetProvider: string,
  profile: ProviderProfile | null,
): { required: boolean; reason: string | null } {
  if (!profile) {
    return { required: false, reason: null };
  }

  if (profile.billingModel === "metered_tokens" || profile.billingModel === "subscription_overage") {
    return {
      required: true,
      reason: `${targetProvider} is classified as ${profile.billingModel.replace(/_/g, " ")} billed by ${profile.biller}. Confirm that billable spend is acceptable before requesting this switch.`,
    };
  }

  if (profile.billingModel === "hybrid" || profile.billingModel === "unknown") {
    return {
      required: true,
      reason: `${targetProvider} is classified as ${profile.billingModel.replace(/_/g, " ")} through ${profile.biller}. Confirm this uncertain billing path before requesting this switch.`,
    };
  }

  return { required: false, reason: null };
}

function budgetImpactForProfile(
  ledger: CompanyCostLedger,
  profile: ProviderProfile | null,
): BillingBudgetImpact | null {
  if (!profile) return null;
  const billableOrUncertain = profile.billingModel === "metered_tokens"
    || profile.billingModel === "subscription_overage"
    || profile.billingModel === "hybrid"
    || profile.billingModel === "unknown";
  if (!billableOrUncertain) return null;

  const utilizationPercent = ledger.budget > 0 ? (ledger.thisMonth / ledger.budget) * 100 : 0;
  const projectedOverBudget = ledger.budget > 0 && ledger.projected > ledger.budget;
  const currentOverBudget = ledger.budget > 0 && ledger.thisMonth >= ledger.budget;
  const highUtilization = ledger.budget > 0 && utilizationPercent >= 80;
  const requiresBudgetApproval = projectedOverBudget || currentOverBudget;
  const reason = currentOverBudget
    ? `Company spend is already at or above the monthly budget (${ledger.thisMonth.toFixed(2)} of ${ledger.budget.toFixed(2)}).`
    : projectedOverBudget
      ? `Projected month spend (${ledger.projected.toFixed(2)}) is above the monthly budget (${ledger.budget.toFixed(2)}).`
      : highUtilization
        ? `Company spend is at ${Math.round(utilizationPercent)}% of the monthly budget.`
        : null;

  return {
    budgetUsd: ledger.budget,
    monthSpendUsd: ledger.thisMonth,
    projectedMonthSpendUsd: ledger.projected,
    meteredSpendUsd: ledger.meteredSpend,
    utilizationPercent,
    requiresBudgetApproval,
    reason,
  };
}

function budgetWarningForImpact(impact: BillingBudgetImpact | null): SwitchWarning | null {
  if (!impact?.reason) return null;
  return {
    code: impact.requiresBudgetApproval ? "budget_approval_recommended" : "budget_utilization_high",
    message: impact.reason,
  };
}

function resolveApprovedProviderSwitchApproval(
  plan: SwitchPlan,
  approvalId?: string | null,
): { id: string } | null {
  if (!approvalId) return null;
  try {
    const { approval } = getApproval(approvalId);
    if (approval.companyId !== plan.companyId) return null;
    if (approval.type !== "provider_switch") return null;
    if (approval.status !== "approved") return null;
    if (approval.payload.agentId !== plan.agentId) return null;
    if (approval.payload.targetProvider !== plan.targetProvider) return null;
    return { id: approval.id };
  } catch {
    return null;
  }
}

function buildInFlightBlockers(details: InFlightDetails): Array<{ code: string; message: string }> {
  const blockers: Array<{ code: string; message: string }> = [];
  if (details.activeHeartbeatRuns > 0) {
    const run = details.runs.find((item) => item.kind === "heartbeat");
    blockers.push({
      code: "active_heartbeat_runs",
      message: run
        ? `${details.activeHeartbeatRuns} heartbeat run(s) queued or running. Latest: ${formatInFlightRunLabel(run)}.`
        : `${details.activeHeartbeatRuns} heartbeat run(s) queued or running.`,
    });
  }
  if (details.pendingWakeupRequests > 0) {
    const run = details.runs.find((item) => item.kind === "wakeup");
    blockers.push({
      code: "pending_wakeup_requests",
      message: run
        ? `${details.pendingWakeupRequests} wakeup request(s) queued or claimed. Latest: ${formatInFlightRunLabel(run)}.`
        : `${details.pendingWakeupRequests} wakeup request(s) queued or claimed.`,
    });
  }
  if (details.activeExecutionRuns > 0) {
    const run = details.runs.find((item) => item.kind === "execution");
    blockers.push({
      code: "active_execution_runs",
      message: run
        ? `${details.activeExecutionRuns} runtime execution record(s) still open. Latest: ${formatInFlightRunLabel(run)}.`
        : `${details.activeExecutionRuns} runtime execution record(s) still open.`,
    });
  }
  return blockers;
}

function formatInFlightRunLabel(run: InFlightRunDetail): string {
  const taskLabel = run.taskKey ?? run.taskTitle ?? "no linked task";
  const provider = run.provider ? ` via ${run.provider}` : "";
  return `${taskLabel} (${run.status}${provider})`;
}

function checkInFlightExecution(
  db: ReturnType<typeof getOrchestrationDb>,
  agentId: string,
): { hasInFlight: boolean; details: InFlightDetails } {
  const heartbeatRowsRaw = db
    .prepare(
      `SELECT hr.id, hr.status, hr.invocation_source, hr.created_at, hr.started_at, hr.updated_at,
              json_extract(hr.context_snapshot_json, '$.taskId') AS task_id,
              t.task_key, t.title, t.status AS task_status
       FROM heartbeat_runs hr
       LEFT JOIN tasks t ON t.id = json_extract(hr.context_snapshot_json, '$.taskId')
       WHERE hr.agent_id = ? AND hr.status IN ('queued', 'running')
       ORDER BY COALESCE(hr.started_at, hr.created_at) DESC
       LIMIT 5`,
    )
    .all(agentId) as Array<{
      id: string;
      status: string;
      invocation_source: string | null;
      created_at: string | null;
      started_at: string | null;
      updated_at: string | null;
      task_id: string | null;
      task_key: string | null;
      title: string | null;
      task_status: string | null;
    }>;

  const heartbeatRows = heartbeatRowsRaw.filter((row) =>
    isFreshInFlightRow(row.updated_at ?? row.started_at ?? row.created_at),
  );

  const wakeupRowsRaw = db
    .prepare(
      `SELECT awr.id, awr.status, awr.source, awr.reason, awr.created_at, awr.claimed_at, awr.updated_at,
              json_extract(awr.payload_json, '$.taskId') AS task_id,
              t.task_key, t.title, t.status AS task_status
       FROM agent_wakeup_requests awr
       LEFT JOIN tasks t ON t.id = json_extract(awr.payload_json, '$.taskId')
       WHERE awr.agent_id = ? AND awr.status IN ('queued', 'claimed')
       ORDER BY COALESCE(awr.claimed_at, awr.created_at) DESC
       LIMIT 5`,
    )
    .all(agentId) as Array<{
      id: string;
      status: string;
      source: string | null;
      reason: string | null;
      created_at: string | null;
      claimed_at: string | null;
      updated_at: string | null;
      task_id: string | null;
      task_key: string | null;
      title: string | null;
      task_status: string | null;
    }>;

  const wakeupRows = wakeupRowsRaw.filter((row) =>
    isFreshInFlightRow(row.updated_at ?? row.claimed_at ?? row.created_at),
  );

  const executionRowsRaw = db
    .prepare(
      `SELECT er.id, er.status, er.provider, er.task_id, er.created_at, er.started_at, er.updated_at,
              t.task_key, t.title, t.status AS task_status
       FROM execution_runs er
       LEFT JOIN tasks t ON t.id = er.task_id
       WHERE er.agent_id = ? AND er.status IN ('pending', 'running')
       ORDER BY COALESCE(er.started_at, er.created_at) DESC
       LIMIT 5`,
    )
    .all(agentId) as Array<{
      id: string;
      status: string;
      provider: string | null;
      task_id: string | null;
      created_at: string | null;
      started_at: string | null;
      updated_at: string | null;
      task_key: string | null;
      title: string | null;
      task_status: string | null;
    }>;

  const executionRows = executionRowsRaw.filter((row) =>
    isFreshInFlightRow(row.updated_at ?? row.started_at ?? row.created_at),
  );

  const runs: InFlightRunDetail[] = [
    ...heartbeatRows.map((row) => ({
      kind: "heartbeat" as const,
      id: row.id,
      status: row.status,
      provider: row.invocation_source,
      taskId: row.task_id,
      taskKey: row.task_key,
      taskTitle: row.title,
      taskStatus: row.task_status,
      createdAt: row.created_at,
      startedAt: row.started_at,
      updatedAt: row.updated_at,
    })),
    ...wakeupRows.map((row) => ({
      kind: "wakeup" as const,
      id: row.id,
      status: row.status,
      provider: row.reason ?? row.source,
      taskId: row.task_id,
      taskKey: row.task_key,
      taskTitle: row.title,
      taskStatus: row.task_status,
      createdAt: row.created_at,
      startedAt: row.claimed_at,
      updatedAt: row.updated_at,
    })),
    ...executionRows.map((row) => ({
      kind: "execution" as const,
      id: row.id,
      status: row.status,
      provider: row.provider,
      taskId: row.task_id,
      taskKey: row.task_key,
      taskTitle: row.title,
      taskStatus: row.task_status,
      createdAt: row.created_at,
      startedAt: row.started_at,
      updatedAt: row.updated_at,
    })),
  ];

  const activeHeartbeatRuns = heartbeatRows.length;
  const pendingWakeupRequests = wakeupRows.length;
  const activeExecutionRuns = executionRows.length;

  const details: InFlightDetails = {
    activeHeartbeatRuns,
    pendingWakeupRequests,
    activeExecutionRuns,
    runs,
  };

  return {
    hasInFlight:
      activeHeartbeatRuns > 0 ||
      pendingWakeupRequests > 0 ||
      activeExecutionRuns > 0,
    details,
  };
}

function isFreshInFlightRow(timestamp: string | null): boolean {
  if (!timestamp) return true;
  const time = new Date(timestamp).getTime();
  if (!Number.isFinite(time)) return true;
  return Date.now() - time <= PROVIDER_SWITCH_IN_FLIGHT_STALE_MS;
}

function normalizeAdapterType(adapterType: string): string {
  if (adapterType === "openclaw-heartbeat") return "openclaw";
  return adapterType;
}
