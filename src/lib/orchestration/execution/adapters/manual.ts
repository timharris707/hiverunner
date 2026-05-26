/**
 * HiveRunner — Manual/Unconfigured Execution Adapter
 *
 * This adapter is the neutral fallback for agents that do not have a real
 * execution runtime attached. It prevents missing or unknown provider config
 * from silently routing work into OpenClaw.
 */

import type Database from "better-sqlite3";

import type {
  ExecutionAdapter,
  ExecutionInput,
  ExecutionResult,
  ExecutionSelfHealInput,
} from "./types";

async function execute(input: ExecutionInput): Promise<ExecutionResult> {
  return {
    error:
      `Agent ${input.agent.name} has no executable runtime configured. ` +
      "Attach a Codex, Anthropic, Gemini, OpenClaw, or custom runtime before running this task.",
  };
}

function clearTaskSessionForSelfHeal(
  _db: Database.Database,
  _input: ExecutionSelfHealInput,
): void {
  // Stateless fallback: there is no provider session to clear.
}

export const manualExecutionAdapter: ExecutionAdapter = {
  adapterType: "manual",
  execute,
  clearTaskSessionForSelfHeal,
};
