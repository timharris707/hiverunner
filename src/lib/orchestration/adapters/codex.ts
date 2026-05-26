/**
 * HiveRunner — Codex Provider Adapter
 *
 * Represents OpenAI Codex as an execution backend for HiveRunner.
 *
 * Tier: 5 (Full Parity)
 *
 * What Codex can provide through the current CLI JSON integration:
 *   - Run lifecycle events (start/end from process wrapper)
 *   - Assistant text when the CLI emits text events
 *   - Tool call/result activity when the CLI emits tool events
 *   - Exit code and wall-clock duration
 *   - Agent wake status (queued/running/finished/failed)
 *   - Persisted transcript/session evidence for later inspection
 *   - Operator controls around queued/running execution records
 *
 * Current limits:
 *   - Exact token/cost telemetry unless present in JSON event payloads
 *
 * Architecture note:
 *   Codex execution is CLI-based: `codex exec --json --full-auto <prompt>`
 *   run by the heartbeat execution adapter. The provider adapter declares
 *   identity, tier, and capabilities; actual run events flow through
 *   execution_runs/heartbeat_run_events and execution_run_transcript_events.
 *
 *   Like the legacy external bridge, this adapter's connect() is a no-op.
 *   Codex JSON events are captured during execution by
 *   src/lib/orchestration/execution/adapters/codex.ts, not by a separate
 *   provider registry stream.
 *
 *   - Token/cost details depend on what the CLI emits
 */

import type {
  MCProviderAdapter,
  ProviderStatus,
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
    maxTier: ObservabilityTier.FullParity,

    /**
     * Connect is a no-op for Codex.
     *
     * Codex integration is CLI-based. JSON event capture happens inside the
     * heartbeat execution adapter for each run, not through this provider
     * registry connection.
     */
    connect(): DisconnectFn {
      // No-op: Codex doesn't stream events through this registry path.
      return () => {};
    },

    getStatus(): ProviderStatus {
      return {
        connected: true, // Codex "connection" means CLI path is configured
        lastEventTs: null,
        activeSessionCount: 0,
        tier: ObservabilityTier.FullParity,
        diagnostics: {
          integrationPath: "cli-json-execution",
          note: "Execution adapter captures Codex JSON events during runs via `codex exec --json`; provider registry connect is not a separate stream.",
        },
      };
    },
  };
}
