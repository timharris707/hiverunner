/**
 * Mission Control — Provider Adapter Types
 *
 * Defines the interface that all provider adapters must implement.
 * Each adapter translates a provider-specific event stream into
 * canonical MCLiveEvent objects.
 */

import type { MCLiveEvent } from "../live-events";

/* ── Observability Tiers ── */

export enum ObservabilityTier {
  /** Post-run artifacts only (run record, final comments) */
  PostRun = 0,
  /** Engine-side in-flight milestones (run_start, run_end, run_error) */
  Milestones = 1,
  /** Live assistant text streaming */
  LiveText = 2,
  /** Action detection from live text */
  ActionDetection = 3,
  /** Structured tool call/result events */
  StructuredTools = 4,
  /** Full interactive streaming parity (thinking, steering) */
  FullParity = 5,
}

/* ── Provider Capabilities ── */

/**
 * What a provider can actually show at a given observability tier.
 * This is the single source of truth for capability rendering.
 * Derived from tier, consumed by API and UI. No second copy.
 */
export interface ProviderCapabilities {
  /** Live assistant text streaming (Tier 2+) */
  liveText: boolean;
  /** Action detection from streamed text (Tier 3+) */
  actionDetection: boolean;
  /** Structured tool call / result events (Tier 4+) */
  structuredTools: boolean;
  /** Thinking / reasoning block visibility (Tier 5) */
  thinking: boolean;
  /** Interactive run steering: pause, resume, cancel (Tier 5) */
  runSteering: boolean;
  /** Full transcript persistence (not tier-gated — depends on provider) */
  persistedTranscript: boolean;
}

/**
 * Derive capabilities from an observability tier.
 * Additional overrides allow providers to declare capabilities
 * that don't follow the tier hierarchy (e.g. transcript persistence).
 */
export function capabilitiesFromTier(
  tier: ObservabilityTier,
  overrides?: Partial<ProviderCapabilities>,
): ProviderCapabilities {
  return {
    liveText: tier >= ObservabilityTier.LiveText,
    actionDetection: tier >= ObservabilityTier.ActionDetection,
    structuredTools: tier >= ObservabilityTier.StructuredTools,
    thinking: tier >= ObservabilityTier.FullParity,
    runSteering: tier >= ObservabilityTier.FullParity,
    persistedTranscript: false, // default: no provider persists full transcripts yet
    ...overrides,
  };
}

/* ── Tier Labels ── */

/**
 * Human-readable labels for each observability tier.
 * Used in configuration and run detail surfaces.
 * Single source — no second copy.
 */
export const TIER_LABELS: Record<ObservabilityTier, string> = {
  [ObservabilityTier.PostRun]: "Post-Run",
  [ObservabilityTier.Milestones]: "Milestones",
  [ObservabilityTier.LiveText]: "Live Text",
  [ObservabilityTier.ActionDetection]: "Action Detection",
  [ObservabilityTier.StructuredTools]: "Structured Tools",
  [ObservabilityTier.FullParity]: "Full Parity",
};

/* ── Provider Presentation View-Model ── */

/**
 * Canonical view-model for provider identity + capabilities.
 * This is the shared shape consumed by BOTH the Configuration tab
 * and the Run Detail surface. It is the single contract for
 * "how we describe a provider to the operator."
 *
 * Built by resolveProviderPresentation() below.
 */
export interface ProviderPresentationInfo {
  providerId: string;
  displayName: string;
  tier: ObservabilityTier;
  tierLabel: string;
  integrationPath: string;
  capabilities: ProviderCapabilities;
}

/**
 * Resolve a ProviderPresentationInfo from a provider ID and
 * an optional effective tier. This is the canonical provider
 * resolution used by the run events API, configuration page,
 * and any future surface that needs to present provider identity.
 *
 * Resolution order:
 *  1. Match against PROVIDER_PRODUCT_DESCRIPTORS (canonical product truth)
 *  2. Fall back to "openclaw" → "openclaw-heartbeat" alias
 *  3. Fall back to generic unknown-provider presentation
 *
 * Note: This function is intentionally pure — it does NOT query
 * the adapter registry at runtime. Both server-side (API routes)
 * and client-side (React pages) can call it. Server-side callers
 * that need runtime adapter truth should query getAdapter() first
 * and pass the effective tier here.
 */
export function resolveProviderPresentation(
  providerId: string,
  effectiveTier?: ObservabilityTier,
): ProviderPresentationInfo {
  // Direct match
  const desc = PROVIDER_PRODUCT_DESCRIPTORS.find((p) => p.providerId === providerId);
  if (desc) {
    const tier = effectiveTier ?? desc.maxTier;
    return {
      providerId: desc.providerId,
      displayName: desc.displayName,
      tier,
      tierLabel: TIER_LABELS[tier] ?? "Unknown",
      integrationPath: desc.integrationPath,
      capabilities: capabilitiesFromTier(tier),
    };
  }

  // Alias: "openclaw" → "openclaw-heartbeat"
  if (providerId === "openclaw") {
    return resolveProviderPresentation("openclaw-heartbeat", effectiveTier);
  }

  // Unknown provider: honest fallback
  const tier = effectiveTier ?? ObservabilityTier.PostRun;
  return {
    providerId,
    displayName: providerId,
    tier,
    tierLabel: TIER_LABELS[tier] ?? "Unknown",
    integrationPath: "Unknown integration path",
    capabilities: capabilitiesFromTier(tier),
  };
}

/**
 * Resolve provider presentation for an agent.
 *
 * Prefers explicit adapterType (source of truth per provider-selection
 * contract). Falls back to external ID inference for backward compat
 * with agents created before adapter_type was added.
 *
 * For full activation validation, use the provider-activation service
 * (src/lib/orchestration/service/provider-activation.ts) instead.
 */
export function resolveAgentProviderPresentation(agent: {
  adapterType?: string;
  openclawAgentId?: string;
  paperclipAgentId?: string;
}): ProviderPresentationInfo {
  // 1. Explicit adapter_type (source of truth)
  if (agent.adapterType && agent.adapterType !== "openclaw") {
    // Non-default value — trust it
    const mappedId = agent.adapterType === "paperclip" ? "paperclip" : agent.adapterType;
    return resolveProviderPresentation(mappedId);
  }

  // 2. Default "openclaw" — use ID presence as tiebreaker
  if (agent.adapterType === "openclaw" || !agent.adapterType) {
    if (agent.openclawAgentId) return resolveProviderPresentation("openclaw-heartbeat");
    if (agent.paperclipAgentId) return resolveProviderPresentation("paperclip");
  }

  return resolveProviderPresentation("none");
}

/* ── Provider Availability ── */

/**
 * Availability state for providers in the comparison view.
 * "active"   — Currently backing this agent's execution
 * "available" — Registered in adapter registry, can be used
 * "limited"  — Available but with known constraints
 * "planned"  — Not yet integrated, on roadmap
 */
export type ProviderAvailability = "active" | "available" | "limited" | "planned";

/* ── Provider Product Descriptors ── */

/**
 * Static product-level descriptor for a provider.
 *
 * IMPORTANT: These are product definitions, NOT runtime adapter queries.
 * They include planned providers that have no runtime adapter yet.
 * For providers that ARE registered in the adapter registry, the
 * providerId, displayName, and maxTier MUST match the adapter's values.
 *
 * This list drives the Configuration tab's comparison view.
 * It is intentionally static — Mission Control does not yet have
 * dynamic provider discovery.
 */
export interface ProviderProductDescriptor {
  /** Must match the adapter's providerId where one exists */
  providerId: string;
  displayName: string;
  maxTier: ObservabilityTier;
  /** Short honest description of integration approach */
  integrationPath: string;
  /**
   * Default availability when no agent context is known.
   * The configuration UI overrides this to "active" for the
   * agent's current provider.
   */
  defaultAvailability: ProviderAvailability;
  /** Short note about current state / limitations */
  statusNote: string;
}

/**
 * All providers Mission Control knows about, including planned ones.
 *
 * This is a PRODUCT-LEVEL list, not a runtime registry query.
 * Providers marked "planned" have no adapter implementation.
 * Providers marked "available" have a registered adapter but
 * are not necessarily backing the current agent.
 *
 * Order matters: shown in this order in the UI.
 */
export const PROVIDER_PRODUCT_DESCRIPTORS: ProviderProductDescriptor[] = [
  {
    providerId: "openclaw-heartbeat",
    displayName: "OpenClaw Heartbeat",
    maxTier: ObservabilityTier.ActionDetection,
    integrationPath: "WebSocket gateway \u2014 live event streaming",
    defaultAvailability: "available",
    statusNote: "Tier 3 today. Tier 4 gated on gateway scope fix.",
  },
  {
    providerId: "paperclip",
    displayName: "Paperclip",
    maxTier: ObservabilityTier.Milestones,
    integrationPath: "Bridge sync \u2014 poll-based lifecycle events",
    defaultAvailability: "available",
    statusNote: "Tier 1 via bridge sync. No live streaming.",
  },
  {
    providerId: "hermes",
    displayName: "Hermes Agent",
    maxTier: ObservabilityTier.StructuredTools,
    integrationPath: "Direct API \u2014 structured events",
    defaultAvailability: "planned",
    statusNote: "Not yet integrated. Expected Tier 4\u20135.",
  },
  {
    providerId: "byo-webhook",
    displayName: "BYO Webhook",
    maxTier: ObservabilityTier.ActionDetection,
    integrationPath: "Inbound webhook \u2014 structured payloads",
    defaultAvailability: "planned",
    statusNote: "Not yet integrated. Expected Tier 1\u20133.",
  },
];

/**
 * Backward-compatible alias.
 * @deprecated Use PROVIDER_PRODUCT_DESCRIPTORS — the name is more honest.
 */
export const KNOWN_PROVIDERS = PROVIDER_PRODUCT_DESCRIPTORS;

/** Backward-compatible alias for the descriptor type. */
export type KnownProviderDescriptor = ProviderProductDescriptor;

/* ══════════════════════════════════════════════════════════════
   PROPOSED: Provider Selection Contract Types
   ──────────────────────────────────────────────────────────────
   These types define the FUTURE state model for editable provider
   selection. They are NOT yet implemented in the DB, API, or UI.

   See: docs/provider-selection-contract.md for the full proposal.

   When Phase 1 implementation begins, these types will govern
   the PATCH /api/orchestration/agents/{id}/provider endpoint
   and the provider switch lifecycle.
   ══════════════════════════════════════════════════════════════ */

/**
 * The four execution providers Mission Control can route to.
 * This is the typed version of the `agents.adapter_type` column.
 *
 * NOT YET ENFORCED — current code uses freeform strings.
 * Phase 1 will constrain adapter_type to this union.
 */
export type ExecutionProviderId = "openclaw" | "paperclip";

/**
 * Agent's configured provider identity.
 * Proposed canonical shape for the agent → provider relationship.
 *
 * NOT YET IMPLEMENTED — see provider-selection-contract.md Phase 1.
 */
export interface AgentProviderConfig {
  /** Which execution backend runs this agent */
  executionProvider: ExecutionProviderId;

  /** LLM model identifier. Semi-portable across providers. */
  model: string;

  /** When the provider was last changed. null = original assignment. */
  providerChangedAt: string | null;
}

/**
 * Result of checking whether a provider can be activated for an agent.
 * Returned by the future `canActivateProvider()` function.
 *
 * NOT YET IMPLEMENTED — see provider-selection-contract.md Phase 1.
 */
export interface ProviderActivationCheck {
  canActivate: boolean;
  providerId: string;
  /** Why activation is blocked, if canActivate is false */
  blockReason: string | null;
  /** What will change if activated */
  consequences: {
    tierChange: { from: ObservabilityTier; to: ObservabilityTier } | null;
    configReset: boolean;
    modelCompatible: boolean;
  };
}

/* ── Provider Status ── */

export interface ProviderStatus {
  connected: boolean;
  lastEventTs: number | null;
  activeSessionCount: number;
  tier: ObservabilityTier;
  /** Provider-specific diagnostics */
  diagnostics?: Record<string, unknown>;
}

/* ── Provider Error ── */

export interface ProviderError {
  code: string;
  message: string;
  recoverable: boolean;
  provider: string;
}

/* ── Connection Config ── */

export interface ProviderConnectionConfig {
  companyId?: string;
  credentials?: Record<string, string>;
  options?: Record<string, unknown>;
}

/* ── Adapter Interface ── */

export type EventCallback = (event: MCLiveEvent) => void;
export type ErrorCallback = (error: ProviderError) => void;
export type DisconnectFn = () => void;

export interface MCProviderAdapter {
  /** Unique provider identifier (e.g. "openclaw-heartbeat", "paperclip", "hermes") */
  readonly providerId: string;

  /** Human-readable display name */
  readonly displayName: string;

  /** Maximum observability tier this provider can support */
  readonly maxTier: ObservabilityTier;

  /**
   * Connect to the provider's event source and begin emitting
   * canonical MCLiveEvent objects through the callback.
   * Returns a disconnect function.
   */
  connect(
    config: ProviderConnectionConfig,
    onEvent: EventCallback,
    onError: ErrorCallback,
  ): DisconnectFn;

  /** Return current connection health and diagnostics. */
  getStatus(): ProviderStatus;
}
