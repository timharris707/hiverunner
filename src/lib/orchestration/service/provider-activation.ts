/**
 * Mission Control — Provider Activation Service
 *
 * Answers the question: "Can this provider be activated for this agent
 * in this environment?"
 *
 * This is the Phase 1 validation layer from the provider-selection
 * contract (docs/provider-selection-contract.md). It provides structured,
 * machine-readable activation checks without performing any mutations.
 *
 * Key design decisions:
 * - Pure validation: no side effects, no DB writes
 * - Structured results: every check has a code, pass/fail, and detail
 * - Honest about partiality: checks are tagged with what they verify
 * - Provider-specific: each provider has its own check set
 * - adapter_type is the source of truth for current provider identity
 */

import {
  ObservabilityTier,
  TIER_LABELS,
  capabilitiesFromTier,
  PROVIDER_PRODUCT_DESCRIPTORS,
  resolveProviderPresentation,
} from "../adapters/types";
import type {
  ProviderCapabilities,
  ProviderPresentationInfo,
  ProviderProductDescriptor,
} from "../adapters/types";

/* ── Result Types ── */

/**
 * A single activation check with machine-readable code.
 */
export interface ProviderActivationCheck {
  /** Machine-readable check identifier */
  check:
    | "provider_known"
    | "env_configured"
    | "external_id_linked"
    | "adapter_registered"
    | "model_compatible"
    | "not_current_provider";
  /** Whether this check passed */
  passed: boolean;
  /** Human-readable explanation */
  detail: string;
  /**
   * Whether this check is blocking (prevents activation)
   * vs advisory (warns but doesn't block).
   */
  blocking: boolean;
}

/**
 * Full activation result for a provider + agent combination.
 */
export interface ProviderActivationResult {
  /** Whether the provider can be activated for this agent */
  canActivate: boolean;
  /** The provider being checked */
  providerId: string;
  /** The agent being checked */
  agentId: string;
  /** The agent's current provider (from adapter_type) */
  currentProvider: string;
  /** Individual check results */
  checks: ProviderActivationCheck[];
  /** Human-readable summary */
  summary: string;
  /** What would change if this provider were activated */
  consequences: ProviderActivationConsequences | null;
}

/**
 * What would change if a provider were activated for an agent.
 * Only populated when canActivate is true.
 */
export interface ProviderActivationConsequences {
  tierChange: {
    from: { tier: ObservabilityTier; label: string };
    to: { tier: ObservabilityTier; label: string };
  } | null;
  capabilityChanges: Array<{
    capability: string;
    from: boolean;
    to: boolean;
  }>;
  configReset: boolean;
  modelCompatible: boolean;
}

/* ── Agent Shape (what we need from the DB) ── */

/**
 * Minimal agent shape for activation checks.
 * Intentionally narrow — only what the validation logic needs.
 */
export interface AgentForActivationCheck {
  id: string;
  adapterType: string;
  model: string | null;
  openclawAgentId: string | null;
  paperclipAgentId: string | null;
}

/* ── Environment Check ── */

/**
 * Check whether the environment is configured for a given provider.
 * This is a static check — it reads env vars, not runtime state.
 */
export function checkProviderEnvConfigured(
  providerId: string,
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): { configured: boolean; missing: string[] } {
  if (providerId === "openclaw-heartbeat" || providerId === "openclaw") {
    // OpenClaw needs a gateway URL (token is optional — falls back to config file)
    const missing: string[] = [];
    // Gateway URL has a default (ws://127.0.0.1:18789), so it's technically always "configured"
    // But we check if the workspace root exists as a proxy for real OpenClaw setup
    if (!env.OPENCLAW_WORKSPACE_ROOT && !env.HOME) {
      missing.push("OPENCLAW_WORKSPACE_ROOT");
    }
    return { configured: missing.length === 0, missing };
  }

  if (providerId === "paperclip") {
    const missing: string[] = [];
    if (!env.PAPERCLIP_API_URL) missing.push("PAPERCLIP_API_URL");
    if (!env.PAPERCLIP_API_KEY) missing.push("PAPERCLIP_API_KEY");
    if (!env.PAPERCLIP_COMPANY_ID) missing.push("PAPERCLIP_COMPANY_ID");
    return { configured: missing.length === 0, missing };
  }

  if (providerId === "codex") {
    // Codex is CLI-based: `codex exec --full-auto <prompt>`.
    // No env vars are required — the CLI reads its own config.
    // CLI availability is checked at execution time by the build-queue
    // (isCliAvailable), not at provider activation time.
    // Returning configured: true is honest — there's nothing to configure
    // in the environment for the provider identity to be valid.
    return { configured: true, missing: [] };
  }

  // Unknown/planned providers are never env-configured
  return { configured: false, missing: ["(provider not implemented)"] };
}

/* ── Model Compatibility ── */

/**
 * Known model-provider compatibility.
 *
 * IMPORTANT: This is a PARTIAL compatibility matrix. It covers
 * models we know about today. An unknown model is treated as
 * "compatibility unknown" (advisory warning, not blocking).
 *
 * When the matrix grows, this should move to a config file or
 * database table. For now, inline is honest about the scope.
 */
const MODEL_PROVIDER_COMPAT: Record<string, string[]> = {
  // Anthropic models — work on OpenClaw
  "anthropic/claude-opus-4-6": ["openclaw-heartbeat", "openclaw"],
  "anthropic/claude-sonnet-4-6": ["openclaw-heartbeat", "openclaw"],
  // OpenAI models — work on OpenClaw (via adapter), Paperclip, and Codex natively
  "openai-codex/gpt-5.4": ["openclaw-heartbeat", "openclaw", "paperclip", "codex"],
  // Google models — work on OpenClaw (via adapter)
  "google/gemini-3.1-pro-preview": ["openclaw-heartbeat", "openclaw"],
};

/**
 * Check whether a model is compatible with a target provider.
 *
 * Returns one of three states:
 * - compatible: model is in the known-compatible list for this provider
 * - incompatible: model is in the known list but NOT for this provider
 * - unknown: model is not in the known list at all
 */
export function checkModelProviderCompatibility(
  model: string | null,
  targetProviderId: string,
): { status: "compatible" | "incompatible" | "unknown"; detail: string } {
  if (!model) {
    return {
      status: "unknown",
      detail: "No model configured. Model compatibility cannot be checked.",
    };
  }

  const knownProviders = MODEL_PROVIDER_COMPAT[model];
  if (!knownProviders) {
    return {
      status: "unknown",
      detail: `Model "${model}" is not in the known compatibility matrix. Compatibility with ${targetProviderId} is unverified.`,
    };
  }

  const normalizedTarget =
    targetProviderId === "openclaw" ? "openclaw-heartbeat" : targetProviderId;

  if (knownProviders.includes(normalizedTarget) || knownProviders.includes(targetProviderId)) {
    return {
      status: "compatible",
      detail: `Model "${model}" is known to be compatible with ${targetProviderId}.`,
    };
  }

  return {
    status: "incompatible",
    detail: `Model "${model}" is not known to be compatible with ${targetProviderId}. A model change may be required.`,
  };
}

/* ── Core Activation Check ── */

/**
 * Check whether a target provider can be activated for an agent.
 *
 * This is the core validation function for Phase 1. It performs
 * all checks and returns a structured result that can be consumed
 * by API routes, UI, or tests.
 *
 * It does NOT mutate anything. It does NOT query the database.
 * The caller provides the agent shape and environment.
 */
export function checkProviderActivation(
  agent: AgentForActivationCheck,
  targetProviderId: string,
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): ProviderActivationResult {
  const checks: ProviderActivationCheck[] = [];
  const currentProvider = normalizeProviderId(agent.adapterType);

  // 1. Is this a known provider?
  const descriptor = PROVIDER_PRODUCT_DESCRIPTORS.find(
    (p) => p.providerId === targetProviderId,
  );
  checks.push({
    check: "provider_known",
    passed: !!descriptor,
    detail: descriptor
      ? `${descriptor.displayName} is a known provider.`
      : `Provider "${targetProviderId}" is not recognized by Mission Control.`,
    blocking: true,
  });

  // 2. Is the target different from the current provider?
  const isSameProvider =
    normalizeProviderId(targetProviderId) === currentProvider;
  checks.push({
    check: "not_current_provider",
    passed: !isSameProvider,
    detail: isSameProvider
      ? `Agent is already using ${targetProviderId}. No switch needed.`
      : `Agent is currently using ${currentProvider}. Would switch to ${targetProviderId}.`,
    blocking: false, // Advisory, not blocking — re-activating same provider is a no-op
  });

  // 3. Is the environment configured for this provider?
  const envCheck = checkProviderEnvConfigured(targetProviderId, env);
  checks.push({
    check: "env_configured",
    passed: envCheck.configured,
    detail: envCheck.configured
      ? `Environment is configured for ${targetProviderId}.`
      : `Missing environment variables: ${envCheck.missing.join(", ")}.`,
    blocking: true,
  });

  // 4. Does the agent have an external ID for this provider?
  const hasExternalId = checkExternalIdLinked(agent, targetProviderId);
  checks.push({
    check: "external_id_linked",
    passed: hasExternalId.linked,
    detail: hasExternalId.detail,
    blocking: true,
  });

  // 5. Is the adapter registered in the runtime registry?
  // Note: this check is advisory because the registry may not be
  // initialized yet (it lazy-inits on first SSE connection).
  // We check PROVIDER_PRODUCT_DESCRIPTORS availability instead.
  const isImplemented =
    descriptor?.defaultAvailability === "available" ||
    descriptor?.defaultAvailability === "limited";
  checks.push({
    check: "adapter_registered",
    passed: isImplemented,
    detail: isImplemented
      ? `${targetProviderId} has an adapter implementation.`
      : descriptor
        ? `${descriptor.displayName} is ${descriptor.defaultAvailability}. No adapter implementation yet.`
        : `No adapter implementation for "${targetProviderId}".`,
    blocking: true,
  });

  // 6. Is the model compatible with the target provider?
  const modelCheck = checkModelProviderCompatibility(
    agent.model,
    targetProviderId,
  );
  checks.push({
    check: "model_compatible",
    passed: modelCheck.status !== "incompatible",
    detail: modelCheck.detail,
    blocking: modelCheck.status === "incompatible",
  });

  // Compute overall result
  const blockingFailures = checks.filter((c) => c.blocking && !c.passed);
  const canActivate = blockingFailures.length === 0;

  // Compute consequences if activation is possible
  let consequences: ProviderActivationConsequences | null = null;
  if (canActivate && descriptor && !isSameProvider) {
    const currentDescriptor = PROVIDER_PRODUCT_DESCRIPTORS.find(
      (p) => normalizeProviderId(p.providerId) === currentProvider,
    );
    const currentTier = currentDescriptor?.maxTier ?? ObservabilityTier.PostRun;
    const targetTier = descriptor.maxTier;

    const currentCaps = capabilitiesFromTier(currentTier);
    const targetCaps = capabilitiesFromTier(targetTier);

    const capKeys: (keyof ProviderCapabilities)[] = [
      "liveText",
      "actionDetection",
      "structuredTools",
      "thinking",
      "runSteering",
      "persistedTranscript",
    ];

    consequences = {
      tierChange:
        currentTier !== targetTier
          ? {
              from: { tier: currentTier, label: TIER_LABELS[currentTier] },
              to: { tier: targetTier, label: TIER_LABELS[targetTier] },
            }
          : null,
      capabilityChanges: capKeys
        .filter((k) => currentCaps[k] !== targetCaps[k])
        .map((k) => ({
          capability: k,
          from: currentCaps[k],
          to: targetCaps[k],
        })),
      configReset: true, // Provider-specific config always resets on switch
      modelCompatible: modelCheck.status !== "incompatible",
    };
  }

  // Summary
  const summary = canActivate
    ? isSameProvider
      ? `Agent is already using ${targetProviderId}.`
      : `${targetProviderId} can be activated for this agent.`
    : `Cannot activate ${targetProviderId}: ${blockingFailures.map((c) => c.detail).join(" ")}`;

  return {
    canActivate,
    providerId: targetProviderId,
    agentId: agent.id,
    currentProvider,
    checks,
    summary,
    consequences,
  };
}

/* ── Resolve Current Provider ── */

/**
 * Resolve an agent's current provider identity from explicit state.
 *
 * This is the Phase 1 replacement for resolveAgentProviderPresentation().
 * It uses adapter_type as the source of truth instead of inferring
 * from external ID presence.
 *
 * Fallback logic:
 *  1. adapter_type field (source of truth)
 *  2. If adapter_type is missing/default, fall back to ID inference
 *     (backward compat for agents created before adapter_type existed)
 *  3. If nothing, return "none"
 */
export function resolveAgentProviderFromRecord(agent: {
  adapterType?: string;
  openclawAgentId?: string;
  paperclipAgentId?: string;
}): ProviderPresentationInfo {
  // 1. Explicit adapter_type (source of truth)
  if (agent.adapterType && agent.adapterType !== "openclaw") {
    // Non-default adapter_type — use it directly
    return resolveProviderPresentation(
      mapAdapterTypeToProviderId(agent.adapterType),
    );
  }

  // 2. adapter_type is "openclaw" (the default) — could be explicit or
  //    could be the migration default for a pre-existing agent.
  //    Use ID presence as a tiebreaker for the default case.
  if (agent.adapterType === "openclaw") {
    // If the agent has an openclaw ID, the default is correct
    if (agent.openclawAgentId) {
      return resolveProviderPresentation("openclaw-heartbeat");
    }
    // If the agent has ONLY a paperclip ID but adapter_type says openclaw,
    // the adapter_type is probably stale from migration default.
    // Prefer the actual link, but this is a data inconsistency.
    if (agent.paperclipAgentId) {
      return resolveProviderPresentation("paperclip");
    }
  }

  // 3. No adapter_type set — legacy fallback to ID inference
  if (agent.openclawAgentId) {
    return resolveProviderPresentation("openclaw-heartbeat");
  }
  if (agent.paperclipAgentId) {
    return resolveProviderPresentation("paperclip");
  }

  return resolveProviderPresentation("none");
}

/* ── Helpers ── */

/**
 * Map the DB adapter_type value to the adapter registry's provider ID.
 * These are different naming conventions that need to be bridged.
 */
export function mapAdapterTypeToProviderId(adapterType: string): string {
  switch (adapterType) {
    case "openclaw":
      return "openclaw-heartbeat";
    case "paperclip":
      return "paperclip";
    default:
      return adapterType;
  }
}

/**
 * Normalize a provider ID for comparison.
 * "openclaw" and "openclaw-heartbeat" should be treated as the same provider.
 */
function normalizeProviderId(providerId: string): string {
  if (providerId === "openclaw") return "openclaw-heartbeat";
  return providerId;
}

/**
 * Check whether an agent has the required external ID for a provider.
 */
function checkExternalIdLinked(
  agent: AgentForActivationCheck,
  targetProviderId: string,
): { linked: boolean; detail: string } {
  if (targetProviderId === "openclaw-heartbeat" || targetProviderId === "openclaw") {
    return agent.openclawAgentId
      ? { linked: true, detail: `Agent has OpenClaw ID: ${agent.openclawAgentId}` }
      : { linked: false, detail: "Agent has no openclaw_agent_id. Cannot route to OpenClaw." };
  }

  if (targetProviderId === "paperclip") {
    return agent.paperclipAgentId
      ? { linked: true, detail: `Agent has Paperclip ID: ${agent.paperclipAgentId}` }
      : { linked: false, detail: "Agent has no paperclip_agent_id. Cannot route to Paperclip." };
  }

  if (targetProviderId === "codex") {
    // Codex is CLI-based — no external agent ID linkage required.
    // The build-queue dispatches work via `codex exec` CLI args,
    // not via an agent API that requires a linked remote ID.
    return { linked: true, detail: "Codex is CLI-based. No external agent ID required." };
  }

  // Planned providers don't have external ID requirements yet
  return { linked: false, detail: `Provider "${targetProviderId}" has no external ID linkage defined.` };
}

/**
 * Check all providers' activation status for an agent.
 * Returns a map of providerId → activation result.
 * Used by the inspection route and future UI.
 */
export function checkAllProviderActivations(
  agent: AgentForActivationCheck,
  env?: Record<string, string | undefined>,
): Record<string, ProviderActivationResult> {
  const results: Record<string, ProviderActivationResult> = {};
  for (const desc of PROVIDER_PRODUCT_DESCRIPTORS) {
    results[desc.providerId] = checkProviderActivation(agent, desc.providerId, env);
  }
  return results;
}
