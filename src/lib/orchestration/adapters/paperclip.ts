/**
 * Mission Control — Paperclip Provider Adapter
 *
 * Second concrete MCProviderAdapter. Represents Paperclip as an
 * execution backend for Mission Control tasks.
 *
 * Tier: 1 (Milestones)
 *
 * What Paperclip can provide through the current bridge integration:
 *   - Task lifecycle events (status changes via issue sync)
 *   - Run lifecycle (start/end from execution_runs)
 *   - Persisted comments (imported from Paperclip issues)
 *   - Agent wake status (queued/running/skipped)
 *
 * What Paperclip does NOT provide through this path:
 *   - Live assistant text streaming (bridge is poll-based)
 *   - Action detection from text (no streamed text available)
 *   - Structured tool call/result events
 *   - Thinking/reasoning blocks
 *   - Run steering (pause/resume/cancel)
 *   - Persisted full transcript
 *
 * Architecture note:
 *   Paperclip's own product treats adapter selection as a first-class
 *   concept (Claude Code, Codex, Gemini CLI, Hermes, etc.). Mission
 *   Control follows the same pattern: provider identity and capability
 *   depth are strategic concepts, not incidental metadata.
 *
 *   This adapter does NOT attempt live streaming. Its connect() is
 *   a no-op — Paperclip data flows through the bridge sync path
 *   into standard MC tables (execution_runs, comments, tasks),
 *   which the run detail API queries directly.
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

const PROVIDER_ID = "paperclip";
const DISPLAY_NAME = "Paperclip";

/* ── Adapter Implementation ── */

export function createPaperclipAdapter(): MCProviderAdapter {
  return {
    providerId: PROVIDER_ID,
    displayName: DISPLAY_NAME,
    maxTier: ObservabilityTier.Milestones, // Tier 1: lifecycle events only

    /**
     * Connect is a no-op for Paperclip.
     *
     * Paperclip integration is poll-based (bridge sync), not event-streamed.
     * Run data arrives in MC tables through the bridge sync path and is
     * queried by the run detail API. No live events flow through the
     * SSE pipeline for Paperclip-backed runs.
     *
     * This is honest: we do not fake streaming for a poll-based provider.
     */
    connect(
      _config: ProviderConnectionConfig,
      _onEvent: EventCallback,
      _onError: ErrorCallback,
    ): DisconnectFn {
      // No-op: Paperclip doesn't stream events through this path
      return () => {};
    },

    getStatus(): ProviderStatus {
      return {
        connected: true, // Paperclip "connection" means bridge is configured
        lastEventTs: null,
        activeSessionCount: 0,
        tier: ObservabilityTier.Milestones,
        diagnostics: {
          integrationPath: "bridge-sync",
          note: "Poll-based integration via Paperclip bridge. No live streaming.",
        },
      };
    },
  };
}
