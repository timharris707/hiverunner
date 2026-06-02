export type OverseerSessionStatus =
  | "idle"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "approval_required";

export type OverseerTurnStatus =
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "approval_required";

export type OverseerMessageRole = "user" | "assistant" | "system" | "tool" | "approval";
export type OverseerRuntimeProvider = "anthropic" | "codex" | "gemini";
export type OverseerCompactionPolicy = "manual" | "ask" | "auto";

export type OverseerUsageSnapshot = {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  totalTokens?: number;
  turnCount?: number;
};

export type OverseerQuotaSnapshot = {
  status: "available" | "unavailable";
  reason?: string;
  updatedAt?: string;
  buckets?: Array<{
    label: string;
    usedPercent?: number;
    resetsAt?: string;
    windowDurationMins?: number;
  }>;
};

export type OverseerCompactionSettings = {
  enabled: boolean;
  triggerPercent: number;
};

export type OverseerCompactionDecision = {
  shouldCompact: boolean;
  reason: string;
  source: "codex_session_file" | "unavailable";
  triggerPercent: number;
  context: {
    usedTokens: number | null;
    limitTokens: number | null;
    percent: number | null;
    updatedAt?: string;
  };
};

export type OverseerSettings = {
  enabled: boolean;
  codexCommand: string;
  approvalMode: "writes" | "manual";
  sandboxMode: "read-only";
  compaction: OverseerCompactionSettings;
};

export type OverseerCompactionSummary = {
  summary: string;
  generatedAt: string;
  strategy: "deterministic_summary_turn";
  limitation: string;
  sourceCodexSessionId: string | null;
  context: OverseerCompactionDecision["context"];
  reason: string;
};

export type OverseerCompactionState = {
  policy: OverseerCompactionPolicy;
  contextThreshold: number;
  latestSummary: string | null;
  compactedAt: string | null;
  compactedBy: string | null;
  metadata: Record<string, unknown>;
};

export type OverseerContextSnapshotSourceBounds = {
  messages: {
    count: number;
    minSequence: number | null;
    maxSequence: number | null;
  };
  events: {
    count: number;
    minSequence: number | null;
    maxSequence: number | null;
  };
  turns: {
    count: number;
    firstStartedAt: string | null;
    lastStartedAt: string | null;
  };
};

export type OverseerContextSnapshot = {
  id: string;
  sessionId: string;
  companyId: string;
  version: number;
  summary: string;
  summaryHash: string;
  sourceBounds: OverseerContextSnapshotSourceBounds;
  usage: OverseerUsageSnapshot;
  attachmentManifest: Array<Record<string, unknown>>;
  compactionMetadata: Record<string, unknown>;
  createdBy: string | null;
  createdAt: string;
};

export type OverseerReadiness = {
  settings: OverseerSettings;
  codex: {
    command: string;
    installed: boolean;
    version: string | null;
    authReady: boolean;
    authMode: "chatgpt" | "api_key" | "unknown" | "missing";
    loginStatus: string;
    error?: string;
  };
  workspace: {
    root: string | null;
    exists: boolean;
    writable: boolean;
    source: "company_workspace" | "project_workspace" | "unavailable";
    projectId?: string | null;
  };
  quota: OverseerQuotaSnapshot;
  ready: boolean;
};

export type OverseerSession = {
  id: string;
  companyId: string;
  companySlug?: string;
  companyCode?: string | null;
  projectId: string | null;
  projectName?: string | null;
  title: string;
  status: OverseerSessionStatus;
  codexSessionId: string | null;
  workspaceRoot: string;
  model: string | null;
  reasoningEffort: string | null;
  approvalMode: "writes" | "manual";
  compaction: OverseerCompactionState;
  scope: Record<string, unknown>;
  usage: OverseerUsageSnapshot;
  quota: OverseerQuotaSnapshot;
  lastError: string | null;
  processPid: number | null;
  createdBy: string | null;
  lastTurnAt: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  messageCount?: number;
};

export type OverseerTurn = {
  id: string;
  sessionId: string;
  companyId: string;
  userMessageId: string | null;
  assistantMessageId: string | null;
  status: OverseerTurnStatus;
  codexSessionId: string | null;
  prompt: string;
  usage: OverseerUsageSnapshot;
  errorMessage: string | null;
  processPid: number | null;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  createdAt: string;
  updatedAt: string;
};

export type OverseerMessage = {
  id: string;
  sessionId: string;
  turnId: string | null;
  companyId: string;
  role: OverseerMessageRole;
  content: string;
  metadata: Record<string, unknown>;
  sequence: number;
  createdAt: string;
};

export type OverseerEvent = {
  id: string;
  sessionId: string;
  turnId: string | null;
  companyId: string;
  eventType: string;
  event: Record<string, unknown>;
  sequence: number;
  occurredAt: string;
  createdAt: string;
};

export type OverseerCodexEvent = {
  type: string;
  record: Record<string, unknown>;
  occurredAt: string;
};

export type OverseerCodexRunResult = {
  ok: boolean;
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
  threadId: string | null;
  assistantText: string;
  usage: OverseerUsageSnapshot;
  quota?: OverseerQuotaSnapshot;
  events: OverseerCodexEvent[];
  stdout: string;
  stderr: string;
  errorMessage: string | null;
};

export type OverseerCodexSessionTelemetry = {
  sessionId: string;
  source: "codex_session_file";
  updatedAt: string;
  context: {
    usedTokens: number | null;
    limitTokens: number | null;
    totalTokens: number | null;
    cumulativeTotalTokens: number | null;
  };
  quota: OverseerQuotaSnapshot;
};
