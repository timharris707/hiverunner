/**
 * HiveRunner — OpenClaw Heartbeat Adapter
 *
 * First concrete MCProviderAdapter. Wraps the existing gateway-stream-bridge
 * and maps RunStreamEvent → MCLiveEvent.
 *
 * The gateway-stream-bridge.ts file is NOT modified — this adapter treats it
 * as an internal implementation detail of the OpenClaw provider.
 */

import { randomUUID } from "crypto";
import type { RunStreamEvent } from "../gateway-stream-bridge";
import {
  subscribe as bridgeSubscribe,
  initGatewayStreamBridge,
  getBridgeStatus,
  isConnected as bridgeIsConnected,
} from "../gateway-stream-bridge";
import type { MCLiveEvent, MCLiveEventKind } from "../live-events";
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

const PROVIDER_ID = "openclaw-heartbeat";
const DISPLAY_NAME = "OpenClaw Heartbeat";

/**
 * Maps RunStreamEvent.kind → MCLiveEventKind.
 * This is the single mapping table between the OpenClaw-specific
 * event model and the canonical HiveRunner model.
 */
const KIND_MAP: Record<RunStreamEvent["kind"], MCLiveEventKind> = {
  assistant_delta: "assistant_text_delta",
  assistant_final: "assistant_text_final",
  tool_start: "tool_call_start",
  tool_end: "tool_call_end",
  lifecycle_start: "run_start",
  lifecycle_end: "run_end",
  lifecycle_error: "run_error",
  error: "error",
};

/* ── Mapping Function ── */

/**
 * Pure function: maps a RunStreamEvent from the gateway bridge
 * into a canonical MCLiveEvent.
 */
export function mapRunStreamEvent(raw: RunStreamEvent): MCLiveEvent {
  const kind = KIND_MAP[raw.kind];

  // Build kind-specific payload
  const payload = buildPayload(kind, raw);

  return {
    id: randomUUID(),
    agentId: raw.agentId,
    runId: raw.runId,
    companyId: raw.companyId,
    kind,
    summary: raw.detail,
    ts: raw.ts,
    seq: raw.seq,
    provider: PROVIDER_ID,
    payload,
    providerMeta: {
      originalKind: raw.kind,
    },
  };
}

function buildPayload(kind: MCLiveEventKind, raw: RunStreamEvent): MCLiveEvent["payload"] {
  switch (kind) {
    case "assistant_text_delta":
      return {
        delta: raw.delta ?? "",
        accumulatedText: raw.text ?? "",
      };

    case "assistant_text_final":
      return {
        text: raw.text ?? "",
      };

    case "tool_call_start":
      return {
        toolCallId: randomUUID(),
        toolName: raw.toolName ?? "unknown",
      };

    case "tool_call_end":
      return {
        toolCallId: "",
        toolName: raw.toolName ?? "unknown",
        success: true,
      };

    case "run_start":
      return {
        invocationSource: "heartbeat",
      };

    case "run_end":
      return {};

    case "run_error":
      return {
        errorMessage: raw.detail,
        recoverable: false,
      };

    case "error":
      return {
        errorMessage: raw.detail,
      };

    default:
      return {};
  }
}

/* ── Adapter Implementation ── */

export function createOpenClawHeartbeatAdapter(): MCProviderAdapter {
  let unsubscribe: (() => void) | null = null;

  return {
    providerId: PROVIDER_ID,
    displayName: DISPLAY_NAME,
    maxTier: ObservabilityTier.ActionDetection, // Tier 3 today

    connect(
      _config: ProviderConnectionConfig,
      onEvent: EventCallback,
      onError: ErrorCallback,
    ): DisconnectFn {
      // Initialize the gateway bridge (idempotent)
      initGatewayStreamBridge();

      // Subscribe to bridge events and map to canonical model
      unsubscribe = bridgeSubscribe((rawEvent: RunStreamEvent) => {
        try {
          const canonical = mapRunStreamEvent(rawEvent);
          onEvent(canonical);
        } catch (err) {
          onError({
            code: "ADAPTER_MAP_ERROR",
            message: err instanceof Error ? err.message : String(err),
            recoverable: true,
            provider: PROVIDER_ID,
          });
        }
      });

      return () => {
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
      };
    },

    getStatus(): ProviderStatus {
      const bridgeStatus = getBridgeStatus();
      return {
        connected: bridgeIsConnected(),
        lastEventTs: null, // bridge doesn't track this directly
        activeSessionCount: bridgeStatus.activeSessionKeys.length,
        tier: ObservabilityTier.ActionDetection,
        diagnostics: {
          wsState: bridgeStatus.wsState,
          subscriberCount: bridgeStatus.subscriberCount,
          totalEmittedEvents: bridgeStatus.totalEmittedEvents,
          reconnectAttempt: bridgeStatus.reconnectAttempt,
        },
      };
    },
  };
}
