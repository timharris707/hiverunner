/**
 * HiveRunner - Execution Adapter Registry
 *
 * Resolves an ExecutionAdapter by adapter type. The engine dispatches
 * heartbeat turns through this entry point so provider-specific logic
 * (OpenClaw, Anthropic, future) stays out of engine.ts.
 */

import type { ExecutionAdapter } from "./types";
import { openclawExecutionAdapter } from "./openclaw";
import { codexExecutionAdapter } from "./codex";
import { anthropicExecutionAdapter } from "./anthropic";
import { hermesExecutionAdapter } from "./hermes";
import { geminiExecutionAdapter } from "./gemini";
import { symphonyExecutionAdapter } from "./symphony";
import { manualExecutionAdapter } from "./manual";

export type {
  ExecutionAdapter,
  ExecutionInput,
  ExecutionResult,
  ExecutionSelfHealInput,
} from "./types";

export { openclawExecutionAdapter, OPENCLAW_BIN, callGateway } from "./openclaw";
export { codexExecutionAdapter } from "./codex";
export { anthropicExecutionAdapter } from "./anthropic";
export { hermesExecutionAdapter } from "./hermes";
export { geminiExecutionAdapter } from "./gemini";
export { symphonyExecutionAdapter } from "./symphony";
export { manualExecutionAdapter } from "./manual";

const ADAPTERS: ReadonlyMap<string, ExecutionAdapter> = new Map([
  [openclawExecutionAdapter.adapterType, openclawExecutionAdapter],
  [codexExecutionAdapter.adapterType, codexExecutionAdapter],
  [anthropicExecutionAdapter.adapterType, anthropicExecutionAdapter],
  [hermesExecutionAdapter.adapterType, hermesExecutionAdapter],
  [geminiExecutionAdapter.adapterType, geminiExecutionAdapter],
  [symphonyExecutionAdapter.adapterType, symphonyExecutionAdapter],
  [manualExecutionAdapter.adapterType, manualExecutionAdapter],
]);

/**
 * Resolve the execution adapter for a given adapter type.
 * Unknown or missing types fall back to the neutral manual adapter.
 * This keeps OpenClaw available without making it the implicit sink for
 * every incomplete provider configuration.
 */
export function getExecutionAdapter(adapterType: string | null | undefined): ExecutionAdapter {
  const key = (adapterType ?? "").trim().toLowerCase();
  return ADAPTERS.get(key) ?? manualExecutionAdapter;
}
