/**
 * Mission Control — Anthropic Execution Adapter (stub)
 *
 * Proof-of-extensibility placeholder. Returns an explicit error so
 * any agent configured with adapter_type='anthropic' fails loudly
 * rather than silently falling through to OpenClaw.
 *
 * A future landing will wire this to the Claude Code CLI bridge
 * (see anthropic-execution-bridge.ts) once we're ready to route
 * real heartbeats through stream-json.
 */

import type Database from "better-sqlite3";

import type {
  ExecutionAdapter,
  ExecutionInput,
  ExecutionResult,
  ExecutionSelfHealInput,
} from "./types";

async function execute(_input: ExecutionInput): Promise<ExecutionResult> {
  return {
    error:
      "Anthropic execution adapter is not yet wired. " +
      "See src/lib/orchestration/execution/adapters/anthropic.ts.",
  };
}

function clearTaskSessionForSelfHeal(
  _db: Database.Database,
  _input: ExecutionSelfHealInput,
): void {
  // No-op: stateless provider has no stored OpenClaw-style session
  // to wipe. When the adapter is wired, revisit whether Anthropic
  // session_params warrant their own reset.
}

export const anthropicExecutionAdapter: ExecutionAdapter = {
  adapterType: "anthropic",
  execute,
  clearTaskSessionForSelfHeal,
};
