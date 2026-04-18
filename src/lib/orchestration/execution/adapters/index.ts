/**
 * Mission Control — Execution Adapter Registry
 *
 * Resolves an ExecutionAdapter by adapter type. The engine dispatches
 * heartbeat turns through this entry point so provider-specific logic
 * (OpenClaw, Anthropic, future) stays out of engine.ts.
 */

import type { ExecutionAdapter } from "./types";
import { openclawExecutionAdapter } from "./openclaw";
import { anthropicExecutionAdapter } from "./anthropic";

export type {
  ExecutionAdapter,
  ExecutionInput,
  ExecutionResult,
  ExecutionSelfHealInput,
} from "./types";

export { openclawExecutionAdapter, OPENCLAW_BIN, callGateway } from "./openclaw";
export { anthropicExecutionAdapter } from "./anthropic";

const ADAPTERS: ReadonlyMap<string, ExecutionAdapter> = new Map([
  [openclawExecutionAdapter.adapterType, openclawExecutionAdapter],
  [anthropicExecutionAdapter.adapterType, anthropicExecutionAdapter],
]);

/**
 * Resolve the execution adapter for a given adapter type.
 * Unknown or missing types fall back to the OpenClaw adapter,
 * which is Mission Control's default provider.
 */
export function getExecutionAdapter(adapterType: string | null | undefined): ExecutionAdapter {
  const key = (adapterType ?? "").trim().toLowerCase();
  return ADAPTERS.get(key) ?? openclawExecutionAdapter;
}
