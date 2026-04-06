/**
 * Mission Control — Provider Switch Service
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
 * See: docs/provider-selection-contract.md
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
  | "agent_not_found";

/**
 * In-flight execution details.
 */
export interface InFlightDetails {
  activeHeartbeatRuns: number;
  pendingWakeupRequests: number;
  activeExecutionRuns: number;
}

/**
 * Non-blocking warning about the switch.
 */
export interface SwitchWarning {
  code: string;
  message: string;
}

/**
 * What would change (or did change) during a switch.
 */
export interface SwitchStateChanges {
  previousProvider: string;
  newProvider: string;
  adapterTypeUpdated: boolean;
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
 * @param targetProvider - Target adapter_type value (for example "openclaw", "paperclip", "codex", or "anthropic")
 * @param env - Environment variables (for activation checks)
 */
export function computeSwitchPlan(
  agentIdOrSlug: string,
  targetProvider: string,
  env?: Record<string, string | undefined>,
): SwitchPlan {
  const db = getOrchestrationDb();

  // ── Load agent ──

  const agent = db
    .prepare(
      `SELECT id, adapter_type, model, openclaw_agent_id, paperclip_agent_id,
              name, status
       FROM agents
       WHERE (id = ? OR slug = ? OR lower(name) = lower(?))
         AND archived_at IS NULL
       LIMIT 1`,
    )
    .get(agentIdOrSlug, agentIdOrSlug, agentIdOrSlug) as {
      id: string;
      adapter_type: string;
      model: string | null;
      openclaw_agent_id: string | null;
      paperclip_agent_id: string | null;
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
    paperclipAgentId: agent.paperclip_agent_id ?? undefined,
  });

  const currentProviderDisplay = {
    displayName: currentPres.displayName,
    tier: currentPres.tier,
    tierLabel: TIER_LABELS[currentPres.tier] ?? "Unknown",
  };

  // ── Already current? ──

  const normalizedCurrent = normalizeAdapterType(agent.adapter_type);
  const normalizedTarget = normalizeAdapterType(targetProvider);

  if (normalizedCurrent === normalizedTarget) {
    return {
      allowed: false,
      mode: "noop",
      agentId: agent.id,
      agentName: agent.name,
      currentProvider: agent.adapter_type,
      targetProvider,
      blockReason: "already_current",
      summary: `Agent '${agent.name}' is already using ${targetProvider}. No switch needed.`,
      blockers: [],
      warnings: [],
      activation: null,
      inFlight: null,
      stateChanges: null,
      currentProviderDisplay,
      targetProviderDisplay: currentProviderDisplay, // same
    };
  }

  // ── Validate activation ──

  const agentForCheck: AgentForActivationCheck = {
    id: agent.id,
    adapterType: agent.adapter_type,
    model: agent.model,
    openclawAgentId: agent.openclaw_agent_id,
    paperclipAgentId: agent.paperclip_agent_id,
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
    paperclipAgentId: agent.paperclip_agent_id ?? undefined,
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
    };
  }

  // ── Check in-flight execution ──

  const inFlight = checkInFlightExecution(db, agent.id);

  if (inFlight.hasInFlight) {
    const blockers = [];
    if (inFlight.details.activeHeartbeatRuns > 0) {
      blockers.push({
        code: "active_heartbeat_runs",
        message: `${inFlight.details.activeHeartbeatRuns} heartbeat run(s) queued or running.`,
      });
    }
    if (inFlight.details.pendingWakeupRequests > 0) {
      blockers.push({
        code: "pending_wakeup_requests",
        message: `${inFlight.details.pendingWakeupRequests} wakeup request(s) queued or claimed.`,
      });
    }
    if (inFlight.details.activeExecutionRuns > 0) {
      blockers.push({
        code: "active_execution_runs",
        message: `${inFlight.details.activeExecutionRuns} execution run(s) pending or running.`,
      });
    }

    return {
      allowed: false,
      mode: "blocked",
      agentId: agent.id,
      agentName: agent.name,
      currentProvider: agent.adapter_type,
      targetProvider,
      blockReason: "in_flight_execution",
      summary: `Cannot switch provider while agent '${agent.name}' has in-flight execution. Wait for current runs to complete.`,
      blockers,
      warnings: [],
      activation,
      inFlight: inFlight.details,
      stateChanges: null,
      currentProviderDisplay,
      targetProviderDisplay: resolvedTargetDisplay,
    };
  }

  // ── Switchable — compute warnings and state changes ──

  const warnings: SwitchWarning[] = [];

  // Advisory warnings
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
        message: `Observability will decrease from T${from.tier} (${from.label}) to T${to.tier} (${to.label}). Some live event types will no longer be available.`,
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
        message: `${losses.length} capability(ies) will become unavailable: ${losses.map((l) => l.capability).join(", ")}.`,
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
    adapterTypeUpdated: true,
    providerChangedAtSet: true,
    previousAdapterTypeRecorded: true,
    runtimeStateReset: hasRuntimeState,
    modelKept: true,
    preserved: [
      "agent identity (name, emoji, role, personality)",
      "model selection",
      "external IDs (openclaw_agent_id, paperclip_agent_id)",
      "task history (execution_runs, heartbeat_runs)",
      "task sessions under previous adapter_type",
      "cumulative token/cost accounting",
    ],
    reset: [
      "agent_runtime_state.session_id",
      "agent_runtime_state.state_json",
      "agent_runtime_state.last_run_id",
      "agent_runtime_state.last_run_status",
      "agent_runtime_state.last_error",
      "agent_runtime_state.adapter_type (updated to new provider)",
    ],
  };

  return {
    allowed: true,
    mode: "switchable",
    agentId: agent.id,
    agentName: agent.name,
    currentProvider: agent.adapter_type,
    targetProvider,
    blockReason: null,
    summary: `Provider can be switched from ${agent.adapter_type} to ${targetProvider} for agent '${agent.name}'.`,
    blockers: [],
    warnings,
    activation,
    inFlight: inFlight.details,
    stateChanges,
    currentProviderDisplay,
    targetProviderDisplay: resolvedTargetDisplay,
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
  /** The full plan that governed this decision */
  plan: SwitchPlan;
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
): ProviderSwitchResult {
  // Compute the plan (read-only decision)
  const plan = computeSwitchPlan(agentIdOrSlug, targetProvider, env);

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
      plan,
    };
  }

  // ── Apply mutations ──

  const db = getOrchestrationDb();
  const now = new Date().toISOString();

  // Update agents table
  db.prepare(
    `UPDATE agents
     SET adapter_type = ?,
         previous_adapter_type = ?,
         provider_changed_at = ?,
         updated_at = ?
     WHERE id = ?`,
  ).run(targetProvider, plan.currentProvider, now, now, plan.agentId);

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

  return {
    switched: true,
    agentId: plan.agentId,
    blockReason: null,
    message: `Provider switched from ${plan.currentProvider} to ${targetProvider} for agent '${plan.agentName}'.`,
    activation: plan.activation,
    changes: plan.stateChanges,
    inFlightDetails: null,
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
  };
}

function checkInFlightExecution(
  db: ReturnType<typeof getOrchestrationDb>,
  agentId: string,
): { hasInFlight: boolean; details: InFlightDetails } {
  const activeHeartbeatRuns = (
    db
      .prepare(
        `SELECT COUNT(*) as count FROM heartbeat_runs
         WHERE agent_id = ? AND status IN ('queued', 'running')`,
      )
      .get(agentId) as { count: number }
  ).count;

  const pendingWakeupRequests = (
    db
      .prepare(
        `SELECT COUNT(*) as count FROM agent_wakeup_requests
         WHERE agent_id = ? AND status IN ('queued', 'claimed')`,
      )
      .get(agentId) as { count: number }
  ).count;

  const activeExecutionRuns = (
    db
      .prepare(
        `SELECT COUNT(*) as count FROM execution_runs
         WHERE agent_id = ? AND status IN ('pending', 'running')`,
      )
      .get(agentId) as { count: number }
  ).count;

  const details: InFlightDetails = {
    activeHeartbeatRuns,
    pendingWakeupRequests,
    activeExecutionRuns,
  };

  return {
    hasInFlight:
      activeHeartbeatRuns > 0 ||
      pendingWakeupRequests > 0 ||
      activeExecutionRuns > 0,
    details,
  };
}

function normalizeAdapterType(adapterType: string): string {
  if (adapterType === "openclaw-heartbeat") return "openclaw";
  return adapterType;
}
