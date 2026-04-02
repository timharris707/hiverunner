export { getPaperclipBridgeConfigFromEnv, type PaperclipBridgeConfig } from "@/lib/orchestration/bridge/config";
export { PaperclipBridgeClient, PaperclipBridgeError } from "@/lib/orchestration/bridge/client";
export { getBridgeStatus } from "@/lib/orchestration/bridge/health";
export {
  isBridgeClientError,
  pullTaskBridgeStatus,
  triggerTaskAssignmentHeartbeat,
  type PullTaskBridgeStatusResult,
  type TriggerTaskAssignmentHeartbeatResult,
} from "@/lib/orchestration/bridge/sync";
export {
  buildPaperclipIssueDescription,
  mapLocalPriorityToPaperclip,
  mapLocalStatusToPaperclip,
  mapPaperclipStatusToLocal,
} from "@/lib/orchestration/bridge/mapping";
export {
  getLatestTaskExternalCommentRef,
  getTaskBridgeRecord,
  listTaskExternalCommentRefs,
  resolveTaskPaperclipAssignee,
  setTaskExecutionMode,
  setTaskPaperclipIssueMapping,
} from "@/lib/orchestration/bridge/store";
export type {
  BridgeExecutionMode,
  BridgeTaskRecord,
  LocalTaskPriorityDb,
  LocalTaskStatusDb,
  PaperclipIssueCreateInput,
  PaperclipIssueComment,
  PaperclipAgentWakeInput,
  PaperclipAgentWakeResult,
  PaperclipIssuePriority,
  PaperclipIssueReference,
  PaperclipIssueStatus,
  PaperclipIssueUpdateInput,
  BridgeHealthStatusResult,
  BridgeMappingError,
  BridgeMappingErrorCode,
} from "@/lib/orchestration/bridge/types";
