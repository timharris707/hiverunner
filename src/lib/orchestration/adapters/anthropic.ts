/**
 * HiveRunner — Anthropic Provider Adapter
 *
 * Represents Claude Code CLI as an execution backend for HiveRunner.
 *
 * Tier: 4 (Structured Tools)
 *
 * What Anthropic can provide through the current CLI integration:
 *   - Live assistant text blocks from `claude --print --output-format stream-json`
 *   - Structured tool call / tool result events
 *   - Exact token usage from the CLI result event
 *   - Exact total_cost_usd from the CLI result event
 *   - Claude session ID from the stream init event
 *
 * What this path still does NOT provide:
 *   - Run steering (pause/resume are not implemented in MC)
 *   - Persisted full transcript (MC stores structured telemetry, not a full replay log)
 *
 * Architecture note:
 *   This adapter wraps the Anthropic execution bridge, which parses Claude
 *   Code stream-json stdout from the build queue and emits canonical
 *   HiveRunner live events. The provider still follows MC's existing
 *   process-wrapper pattern rather than introducing a direct HTTP runtime.
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
import {
  getAnthropicBridgeStatus,
  subscribeAnthropicBridgeEvents,
} from "../anthropic-execution-bridge";

const PROVIDER_ID = "anthropic";
const DISPLAY_NAME = "Anthropic";

export function createAnthropicAdapter(): MCProviderAdapter {
  return {
    providerId: PROVIDER_ID,
    displayName: DISPLAY_NAME,
    maxTier: ObservabilityTier.StructuredTools,

    connect(
      _config: ProviderConnectionConfig,
      onEvent: EventCallback,
      _onError: ErrorCallback,
    ): DisconnectFn {
      return subscribeAnthropicBridgeEvents(onEvent);
    },

    getStatus(): ProviderStatus {
      const bridgeStatus = getAnthropicBridgeStatus();
      return {
        connected: true,
        lastEventTs: bridgeStatus.lastEventTs,
        activeSessionCount: bridgeStatus.activeRunCount,
        tier: ObservabilityTier.StructuredTools,
        diagnostics: {
          integrationPath: "cli-stream-json",
          totalEmittedEvents: bridgeStatus.totalEmittedEvents,
          activeBuildIds: bridgeStatus.activeBuildIds,
        },
      };
    },
  };
}
