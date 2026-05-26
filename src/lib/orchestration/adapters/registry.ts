/**
 * HiveRunner — Provider Adapter Registry
 *
 * Manages the lifecycle of provider adapters and provides a unified
 * subscription interface that emits canonical MCLiveEvent objects
 * from all connected providers.
 *
 * Singleton: call initAdapterRegistry() once from server.js on startup.
 */

import type { MCLiveEvent } from "../live-events";
import type {
  MCProviderAdapter,
  ProviderConnectionConfig,
  ProviderError,
  ProviderStatus,
} from "./types";
import { createOpenClawHeartbeatAdapter } from "./openclaw-heartbeat";
import { createCodexAdapter } from "./codex";
import { createAnthropicAdapter } from "./anthropic";

/* ── Types ── */

type RegistrySubscriber = (event: MCLiveEvent) => void;

interface RegisteredAdapter {
  adapter: MCProviderAdapter;
  disconnect: (() => void) | null;
}

export interface RegistryStatus {
  initialized: boolean;
  adapters: Record<string, ProviderStatus & { providerId: string; displayName: string }>;
  subscriberCount: number;
}

/* ── Singleton State ── */

let initialized = false;
const adapters = new Map<string, RegisteredAdapter>();
const subscribers = new Set<RegistrySubscriber>();

/* ── Emit to all subscribers ── */

function emit(event: MCLiveEvent): void {
  for (const fn of subscribers) {
    try {
      fn(event);
    } catch {
      // Subscriber errors never break the registry
    }
  }
}

function handleError(error: ProviderError): void {
  console.error(
    `[adapter-registry] provider error [${error.provider}]: ${error.code} — ${error.message}`,
  );
}

/* ── Public API ── */

/**
 * Subscribe to canonical MCLiveEvent from all connected providers.
 * Returns an unsubscribe function.
 */
export function subscribe(fn: RegistrySubscriber): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

/**
 * Register and connect a provider adapter.
 * Events from the adapter flow through to all registry subscribers.
 */
export function registerAdapter(
  adapter: MCProviderAdapter,
  config?: ProviderConnectionConfig,
): void {
  // Disconnect existing adapter with same ID
  const existing = adapters.get(adapter.providerId);
  if (existing?.disconnect) {
    existing.disconnect();
  }

  const disconnect = adapter.connect(config ?? {}, emit, handleError);
  adapters.set(adapter.providerId, { adapter, disconnect });

  console.log(
    `[adapter-registry] registered adapter: ${adapter.displayName} (${adapter.providerId}), tier=${adapter.maxTier}`,
  );
}

/**
 * Initialize the registry with all available adapters.
 * Idempotent — second call is a no-op.
 *
 * Registers:
 *   - OpenClaw Heartbeat (Tier 3 — live text + action detection)
 *   - Codex (Tier 5 — Codex CLI JSON events with transcript and run-control evidence)
 *   - Anthropic (Tier 4 — Claude Code CLI stream-json bridge)
 */
export function initAdapterRegistry(): void {
  if (initialized) return;
  initialized = true;

  console.log("[adapter-registry] initializing");

  // OpenClaw heartbeat adapter (wraps gateway-stream-bridge)
  const openclawAdapter = createOpenClawHeartbeatAdapter();
  registerAdapter(openclawAdapter);

  // Codex adapter (CLI-based execution with JSON transcript evidence)
  const codexAdapter = createCodexAdapter();
  registerAdapter(codexAdapter);

  // Anthropic adapter (Claude Code CLI stream-json bridge)
  const anthropicAdapter = createAnthropicAdapter();
  registerAdapter(anthropicAdapter);
}

/**
 * Tear down all adapters and clear state.
 */
export function destroyAdapterRegistry(): void {
  for (const [, entry] of adapters) {
    if (entry.disconnect) {
      try {
        entry.disconnect();
      } catch {
        // Ignore cleanup errors
      }
    }
  }
  adapters.clear();
  subscribers.clear();
  initialized = false;
  console.log("[adapter-registry] destroyed");
}

/**
 * Look up a registered adapter by provider ID.
 * Used by the run events API to get provider-specific metadata.
 */
export function getAdapter(providerId: string): MCProviderAdapter | null {
  const entry = adapters.get(providerId);
  return entry?.adapter ?? null;
}

/**
 * Return status of the registry and all registered adapters.
 */
export function getRegistryStatus(): RegistryStatus {
  const adapterStatuses: RegistryStatus["adapters"] = {};

  for (const [id, entry] of adapters) {
    const status = entry.adapter.getStatus();
    adapterStatuses[id] = {
      ...status,
      providerId: entry.adapter.providerId,
      displayName: entry.adapter.displayName,
    };
  }

  return {
    initialized,
    adapters: adapterStatuses,
    subscriberCount: subscribers.size,
  };
}
