/**
 * Mission Control — Provider Switch Service
 *
 * Phase 2 mutation layer: safely switch an agent's execution provider.
 *
 * This service owns the entire switch lifecycle:
 *   validate → check blockers → mutate → audit → reset state → return
 *
 * It is intentionally conservative:
 * - Refuses if validation fails (structured blockers)
 * - Refuses if the agent has in-flight execution
 * - Does NOT migrate session state between providers
 * - Does NOT silently change the model
 * - Records audit trail (previous_adapter_type, provider_changed_at)
 * - Returns structured result describing exactly what changed
 *
 * See: docs/provider-selection-contract.md
 */

import { getOrchestrationDb } from "../db";
import {
  checkProviderActivation,
} from "./provider-activation";
import type {
  AgentForActivationCheck,
  ProviderActivationResult,
} from "./provider-activation";

/* ── Result Types ── */

/**
 * Reason codes for why a switch was refused.
 */
export type SwitchBlockReason =
  | "validation_failed"       // checkProviderActivation returned canActivate: false
  | "in_flight_execution"     // agent has queued or running heartbeat/wakeup
  | "already_current"         // target is already the current provider
  | "agent_not_found";        // agent ID does not exist

/**
 * Result of a provider switch attempt.
 */
export interface ProviderSwitchResult {
  /** Whether the switch was executed */
  switched: boolean;

  /** The agent ID */
  agentId: string;

  /** Why the switch was refused, if switched is false */
  blockReason: SwitchBlockReason | null;

  /** Human-readable explanation */
  message: string;

  /** Detailed activation validation (always included) */
  activation: ProviderActivationResult | null;

  /** What changed, if switched is true */
  changes: ProviderSwitchChanges | null;

  /** In-flight execution details if that was the blocker */
  inFlightDetails: InFlightDetails | null;
}

/**
 * What actually changed during a successful switch.
 */
export interface ProviderSwitchChanges {
  previousProvider: string;
  newProvider: string;
  adapterTypeUpdated: boolean;
  providerChangedAtSet: boolean;
  previousAdapterTypeRecorded: boolean;
  runtimeStateReset: boolean;
  modelKept: boolean;
  /** Fields that were preserved (not cleared) */
  preserved: string[];
  /** Fields that were reset/cleared */
  reset: string[];
}

/**
 * Details about in-flight execution that blocked a switch.
 */
export interface InFlightDetails {
  activeHeartbeatRuns: number;
  pendingWakeupRequests: number;
  activeExecutionRuns: number;
}

/* ── Core Switch Function ── */

/**
 * Attempt to switch an agent's execution provider.
 *
 * This is the only authorized mutation path for adapter_type.
 * It validates, checks blockers, mutates, and returns a structured result.
 *
 * @param agentIdOrSlug - Agent ID, slug, or name
 * @param targetProvider - Target adapter_type value ("openclaw" or "paperclip")
 * @param env - Environment variables (for activation checks)
 */
export function switchAgentProvider(
  agentIdOrSlug: string,
  targetProvider: string,
  env?: Record<string, string | undefined>,
): ProviderSwitchResult {
  const db = getOrchestrationDb();

  // ── Step 1: Load agent ──

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
    return {
      switched: false,
      agentId: agentIdOrSlug,
      blockReason: "agent_not_found",
      message: `Agent '${agentIdOrSlug}' not found.`,
      activation: null,
      changes: null,
      inFlightDetails: null,
    };
  }

  // ── Step 2: Check if already current ──

  const normalizedCurrent = normalizeAdapterType(agent.adapter_type);
  const normalizedTarget = normalizeAdapterType(targetProvider);

  if (normalizedCurrent === normalizedTarget) {
    return {
      switched: false,
      agentId: agent.id,
      blockReason: "already_current",
      message: `Agent '${agent.name}' is already using ${targetProvider}. No switch needed.`,
      activation: null,
      changes: null,
      inFlightDetails: null,
    };
  }

  // ── Step 3: Validate activation ──

  const agentForCheck: AgentForActivationCheck = {
    id: agent.id,
    adapterType: agent.adapter_type,
    model: agent.model,
    openclawAgentId: agent.openclaw_agent_id,
    paperclipAgentId: agent.paperclip_agent_id,
  };

  // Map target to the provider ID used by the activation service
  const activationProviderId = targetProvider === "openclaw"
    ? "openclaw-heartbeat"
    : targetProvider;

  const activation = checkProviderActivation(agentForCheck, activationProviderId, env);

  if (!activation.canActivate) {
    return {
      switched: false,
      agentId: agent.id,
      blockReason: "validation_failed",
      message: activation.summary,
      activation,
      changes: null,
      inFlightDetails: null,
    };
  }

  // ── Step 4: Check in-flight execution ──

  const inFlight = checkInFlightExecution(db, agent.id);

  if (inFlight.hasInFlight) {
    return {
      switched: false,
      agentId: agent.id,
      blockReason: "in_flight_execution",
      message: `Cannot switch provider while agent '${agent.name}' has in-flight execution. Wait for current runs to complete.`,
      activation,
      changes: null,
      inFlightDetails: inFlight.details,
    };
  }

  // ── Step 5: Execute the switch ──

  const now = new Date().toISOString();
  const previousAdapterType = agent.adapter_type;

  // 5a. Update agents table — source of truth
  db.prepare(
    `UPDATE agents
     SET adapter_type = ?,
         previous_adapter_type = ?,
         provider_changed_at = ?,
         updated_at = ?
     WHERE id = ?`,
  ).run(targetProvider, previousAdapterType, now, now, agent.id);

  // 5b. Reset runtime state for the new provider
  //     Preserve cumulative tokens/cost (they're agent-level, not provider-level).
  //     Clear session_id and state_json (provider-specific ephemeral state).
  const runtimeStateExists = db
    .prepare("SELECT 1 FROM agent_runtime_state WHERE agent_id = ?")
    .get(agent.id);

  let runtimeStateReset = false;
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
    ).run(targetProvider, now, agent.id);
    runtimeStateReset = true;
  }

  // 5c. Agent task sessions are NOT deleted or migrated.
  //     The UNIQUE index (company_id, agent_id, adapter_type, task_key)
  //     means old sessions under the previous adapter_type are naturally
  //     isolated. New runs under the new adapter_type will create new
  //     session entries. Old sessions are preserved for potential rollback.

  return {
    switched: true,
    agentId: agent.id,
    blockReason: null,
    message: `Provider switched from ${previousAdapterType} to ${targetProvider} for agent '${agent.name}'.`,
    activation,
    changes: {
      previousProvider: previousAdapterType,
      newProvider: targetProvider,
      adapterTypeUpdated: true,
      providerChangedAtSet: true,
      previousAdapterTypeRecorded: true,
      runtimeStateReset,
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
    },
    inFlightDetails: null,
  };
}

/* ── In-Flight Detection ── */

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

/* ── Helpers ── */

function normalizeAdapterType(adapterType: string): string {
  // "openclaw" and "openclaw-heartbeat" are the same provider
  if (adapterType === "openclaw-heartbeat") return "openclaw";
  return adapterType;
}
