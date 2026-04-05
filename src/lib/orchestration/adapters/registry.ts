/**
 * Mission Control — Provider Adapter Registry
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
 * Initialize the registry with the default adapters.
 * Idempotent — second call is a no-op.
 *
 * Currently registers: OpenClaw Heartbeat adapter.
 * Future: Paperclip, Hermes, webhook adapters.
 */
export function initAdapterRegistry(): void {
  if (initialized) return;
  initialized = true;

  console.log("[adapter-registry] initializing");

  // Register the OpenClaw heartbeat adapter (wraps gateway-stream-bridge)
  const openclawAdapter = createOpenClawHeartbeatAdapter();
  registerAdapter(openclawAdapter);
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
