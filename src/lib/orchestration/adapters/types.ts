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

/* ── Known Provider Descriptors ── */

/**
 * Availability state for providers in the comparison view.
 * "active"   — Currently backing this agent's execution
 * "available" — Registered in adapter registry, can be used
 * "limited"  — Available but with known constraints
 * "planned"  — Not yet integrated, on roadmap
 */
export type ProviderAvailability = "active" | "available" | "limited" | "planned";

/**
 * Static provider descriptor for the configuration comparison view.
 * This is intentionally a display-side type — it does NOT replace
 * the MCProviderAdapter interface used by live adapters.
 *
 * The values here describe what providers CAN do at their maximum tier,
 * not what the current agent is using. The comparison view combines
 * these descriptors with the agent's actual provider to derive
 * which is "active" vs "available" vs "planned".
 */
export interface KnownProviderDescriptor {
  /** Must match the adapter's providerId where applicable */
  providerId: string;
  displayName: string;
  maxTier: ObservabilityTier;
  /** Short honest description of integration approach */
  integrationPath: string;
  /** What this provider is today — filled by config UI based on agent context */
  defaultAvailability: ProviderAvailability;
  /** Short note about current state / limitations */
  statusNote: string;
}

/**
 * All providers Mission Control knows about, including planned ones.
 * This is the single source of truth for the provider comparison view.
 * Order matters: shown in this order in the UI.
 */
export const KNOWN_PROVIDERS: KnownProviderDescriptor[] = [
  {
    providerId: "openclaw-heartbeat",
    displayName: "OpenClaw Heartbeat",
    maxTier: ObservabilityTier.ActionDetection,
    integrationPath: "WebSocket gateway — live event streaming",
    defaultAvailability: "available",
    statusNote: "Tier 3 today. Tier 4 gated on gateway scope fix.",
  },
  {
    providerId: "paperclip",
    displayName: "Paperclip",
    maxTier: ObservabilityTier.Milestones,
    integrationPath: "Bridge sync — poll-based lifecycle events",
    defaultAvailability: "available",
    statusNote: "Tier 1 via bridge sync. No live streaming.",
  },
  {
    providerId: "hermes",
    displayName: "Hermes Agent",
    maxTier: ObservabilityTier.StructuredTools,
    integrationPath: "Direct API — structured events",
    defaultAvailability: "planned",
    statusNote: "Not yet integrated. Expected Tier 4–5.",
  },
  {
    providerId: "byo-webhook",
    displayName: "BYO Webhook",
    maxTier: ObservabilityTier.ActionDetection,
    integrationPath: "Inbound webhook — structured payloads",
    defaultAvailability: "planned",
    statusNote: "Not yet integrated. Expected Tier 1–3.",
  },
];

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
