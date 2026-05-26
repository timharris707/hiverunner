export type LocalTaskPriorityDb = "critical" | "high" | "medium" | "low";
export type LocalTaskStatusDb =
  | "backlog"
  | "to-do"
  | "in_progress"
  | "review"
  | "done"
  | "blocked";

export type BridgeExecutionMode = "manual" | "openclaw";
export type BridgeExecutionEngine = "hiverunner" | "symphony" | "manual";
export type BridgeRuntimeProvider =
  | "manual"
  | "openclaw"
  | "codex"
  | "anthropic"
  | "hermes"
  | "gemini"
  | "symphony";

export interface BridgeTaskRecord {
  id: string;
  title: string;
  description: string;
  priority: LocalTaskPriorityDb;
  status: LocalTaskStatusDb;
  projectId: string;
  projectName: string;
  companyId: string;
  assigneeAgentId?: string;
  assigneeAgentName?: string;
  assigneeAgentStatus?: "idle" | "working" | "paused" | "offline" | "error";
  assigneeAdapterType?: BridgeRuntimeProvider;
  assigneeModel?: string;
  assigneeOpenclawAgentId?: string;
  executionEngine: BridgeExecutionEngine;
  executionEngineOverride?: BridgeExecutionEngine | null;
  executionEngineSource?: "task" | "project" | "company" | "global";
  modelLane?: "default" | "fast" | "mini" | "deep";
  runnerProvider?: string;
  modelRouting?: string;
  modelRoutingLabel?: string;
  activeHiveId?: string;
  activeHiveName?: string;
  executionMode: BridgeExecutionMode;
  executionSessionId?: string;
}
