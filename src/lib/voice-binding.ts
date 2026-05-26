export type VoiceBindingScope = "global" | "project" | "task";
export type VoiceSessionMode = "discuss" | "unblock" | "review" | "handoff" | "capture_note";
export type VoiceBindingSource = "voice-lab" | "task-detail" | "project-overview";

export interface VoiceBindingRequest {
  companySlug?: string;
  projectId?: string;
  projectSlug?: string;
  taskId?: string;
  taskKey?: string;
  agentId?: string;
  source?: VoiceBindingSource;
  mode?: VoiceSessionMode;
}

export interface ResolvedVoiceBinding {
  scope: VoiceBindingScope;
  companySlug?: string;
  projectId?: string;
  projectSlug?: string;
  projectName?: string;
  taskId?: string;
  taskKey?: string;
  taskTitle?: string;
  taskStatus?: string;
  agentId?: string;
  agentName?: string;
  agentAvatarUrl?: string;
  agentVoiceId?: string;
  mode: VoiceSessionMode;
  source: VoiceBindingSource;
}

const VOICE_SESSION_MODES = new Set<VoiceSessionMode>([
  "discuss",
  "unblock",
  "review",
  "handoff",
  "capture_note",
]);

const VOICE_BINDING_SOURCES = new Set<VoiceBindingSource>([
  "voice-lab",
  "task-detail",
  "project-overview",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
  }

  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }

  return undefined;
}

function normalizeMode(value: unknown): VoiceSessionMode {
  return typeof value === "string" && VOICE_SESSION_MODES.has(value as VoiceSessionMode)
    ? (value as VoiceSessionMode)
    : "discuss";
}

function normalizeSource(value: unknown): VoiceBindingSource {
  return typeof value === "string" && VOICE_BINDING_SOURCES.has(value as VoiceBindingSource)
    ? (value as VoiceBindingSource)
    : "voice-lab";
}

export interface NormalizedVoiceBindingRequest {
  scope: VoiceBindingScope;
  companySlug?: string;
  projectId?: string;
  projectSlug?: string;
  taskId?: string;
  taskKey?: string;
  agentId?: string;
  mode: VoiceSessionMode;
  source: VoiceBindingSource;
}

function normalizeBindingRequestFields(data: Record<string, unknown>): NormalizedVoiceBindingRequest {
  const companySlug = normalizeOptionalString(data.companySlug);
  const projectId = normalizeOptionalString(data.projectId);
  const projectSlug = normalizeOptionalString(data.projectSlug);
  const taskId = normalizeOptionalString(data.taskId);
  const taskKey = normalizeOptionalString(data.taskKey);
  const agentId = normalizeOptionalString(data.agentId);

  const scope: VoiceBindingScope = taskId || taskKey
    ? "task"
    : projectId || projectSlug
      ? "project"
      : "global";

  return {
    scope,
    ...(companySlug ? { companySlug } : {}),
    ...(projectId ? { projectId } : {}),
    ...(projectSlug ? { projectSlug } : {}),
    ...(taskId ? { taskId } : {}),
    ...(taskKey ? { taskKey } : {}),
    ...(agentId ? { agentId } : {}),
    mode: normalizeMode(data.mode),
    source: normalizeSource(data.source),
  };
}

export function normalizeVoiceBindingRequest(input: unknown): NormalizedVoiceBindingRequest {
  return normalizeBindingRequestFields(isRecord(input) ? input : {});
}

export function normalizeResolvedVoiceBinding(input: unknown): ResolvedVoiceBinding {
  const data = isRecord(input) ? input : {};
  const projectName = normalizeOptionalString(data.projectName);
  const taskTitle = normalizeOptionalString(data.taskTitle);
  const taskStatus = normalizeOptionalString(data.taskStatus);
  const agentName = normalizeOptionalString(data.agentName);
  const agentAvatarUrl = normalizeOptionalString(data.agentAvatarUrl);
  const agentVoiceId = normalizeOptionalString(data.agentVoiceId);

  return {
    ...normalizeBindingRequestFields(data),
    ...(projectName ? { projectName } : {}),
    ...(taskTitle ? { taskTitle } : {}),
    ...(taskStatus ? { taskStatus } : {}),
    ...(agentName ? { agentName } : {}),
    ...(agentAvatarUrl ? { agentAvatarUrl } : {}),
    ...(agentVoiceId ? { agentVoiceId } : {}),
  };
}
