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
