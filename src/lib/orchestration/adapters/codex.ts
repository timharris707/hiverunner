/**
 * Mission Control — Codex Provider Adapter
 *
 * Represents OpenAI Codex as an execution backend for Mission Control.
 *
 * Tier: 1 (Milestones)
 *
 * What Codex can provide through the current CLI integration:
 *   - Run lifecycle events (start/end from process wrapper)
 *   - Exit code and wall-clock duration
 *   - Agent wake status (queued/running/finished/failed)
 *
 * What Codex does NOT provide through this path:
 *   - Live assistant text streaming (CLI is batch, not streamed)
 *   - Action detection from text (no streamed text available)
 *   - Structured tool call/result events
 *   - Thinking/reasoning blocks
 *   - Run steering (pause/resume/cancel)
 *   - Persisted full transcript
 *   - Token usage breakdown (unless Codex CLI reports it in output)
 *   - Persistent session management (each CLI invocation is stateless)
 *
 * Architecture note:
 *   Codex execution today is CLI-based: `codex exec --full-auto <prompt>`
 *   dispatched by the build-queue (src/lib/build-queue.ts). The adapter
 *   does NOT manage execution — it declares provider identity, tier, and
 *   capabilities so the provider architecture can represent Codex honestly.
 *
 *   Like Paperclip, this adapter's connect() is a no-op. Codex run data
 *   flows through execution_runs/heartbeat_runs tables written by the
 *   build-queue and engine, then queried by the run detail API.
 *
 *   This is honest: we do not fake streaming or structured events
 *   for a CLI-backed provider. Tier 1 reflects what truly exists.
 *
 * Future path:
 *   If Codex exposes a streaming API or structured event protocol,
 *   this adapter can upgrade to Tier 2+ by implementing connect()
 *   with real event emission. Until then, Tier 1 is the truth.
 */

import type {
  MCProviderAdapter,
  ProviderConnectionConfig,
  ProviderStatus,
  EventCallback,
  ErrorCallback,
  DisconnectFn,
} from "./types";
import { ObservabilityTier } from "./types";

/* ── Constants ── */

const PROVIDER_ID = "codex";
const DISPLAY_NAME = "Codex";

/* ── Adapter Implementation ── */

export function createCodexAdapter(): MCProviderAdapter {
  return {
    providerId: PROVIDER_ID,
    displayName: DISPLAY_NAME,
    maxTier: ObservabilityTier.Milestones, // Tier 1: lifecycle events only

    /**
     * Connect is a no-op for Codex.
     *
     * Codex integration is CLI-based (codex exec --full-auto), not event-streamed.
     * Run data arrives in MC tables through the build-queue execution path and
     * is queried by the run detail API. No live events flow through the SSE
     * pipeline for Codex-backed runs.
     *
     * This is honest: we do not fake streaming for a CLI-backed provider.
     */
    connect(
      _config: ProviderConnectionConfig,
      _onEvent: EventCallback,
      _onError: ErrorCallback,
    ): DisconnectFn {
      // No-op: Codex doesn't stream events through this path
      return () => {};
    },

    getStatus(): ProviderStatus {
      return {
        connected: true, // Codex "connection" means CLI path is configured
        lastEventTs: null,
        activeSessionCount: 0,
        tier: ObservabilityTier.Milestones,
        diagnostics: {
          integrationPath: "cli-execution",
          note: "CLI-based execution via `codex exec --full-auto`. No live streaming. Lifecycle events only.",
        },
      };
    },
  };
}
