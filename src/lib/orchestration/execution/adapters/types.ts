/**
 * Mission Control — Execution Adapter Types
 *
 * Defines the interface that all execution adapters implement.
 * An execution adapter owns the provider-specific details of
 * sending a heartbeat prompt to an agent and self-healing its
 * task-session state.
 *
 * Distinct from the observability adapters under
 * `src/lib/orchestration/adapters/` — those stream live events
 * into the registry. Execution adapters dispatch work.
 */

import type Database from "better-sqlite3";

import type { AgentRow, RuntimeState, TaskSession } from "@/lib/orchestration/engine/engine";

export interface ExecutionResult {
  sessionId?: string;
  sessionKey?: string;
  messageCountBefore?: number;
  error?: string;
  usage?: Record<string, unknown>;
}

export interface ExecutionInput {
  agent: AgentRow;
  prompt: string;
  session: TaskSession;
  runtimeState: RuntimeState;
}

export interface ExecutionSelfHealInput {
  companyId: string;
  agentId: string;
  taskKey: string;
  reason: string;
}

export interface ExecutionAdapter {
  readonly adapterType: string;
  execute(input: ExecutionInput): Promise<ExecutionResult>;
  clearTaskSessionForSelfHeal(db: Database.Database, input: ExecutionSelfHealInput): void;
}
