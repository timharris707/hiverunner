import {
  normalizeResolvedVoiceBinding,
  type ResolvedVoiceBinding,
  type VoiceBindingRequest,
} from "@/lib/voice-binding";

export interface SearchParamReader {
  get(name: string): string | null;
}

export function getOptionalQueryValue(searchParams: SearchParamReader, key: string): string | undefined {
  const value = searchParams.get(key);
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function buildRequestedVoiceBindingFromSearchParams(
  searchParams: SearchParamReader
): ResolvedVoiceBinding | null {
  const request: VoiceBindingRequest = {};

  const companySlug = getOptionalQueryValue(searchParams, "companySlug");
  const projectId = getOptionalQueryValue(searchParams, "projectId");
  const projectSlug = getOptionalQueryValue(searchParams, "projectSlug");
  const taskId = getOptionalQueryValue(searchParams, "taskId");
  const taskKey = getOptionalQueryValue(searchParams, "taskKey");
  const agentId = getOptionalQueryValue(searchParams, "agentId");
  const agentName = getOptionalQueryValue(searchParams, "agentName");
  const source = getOptionalQueryValue(searchParams, "source");
  const mode = getOptionalQueryValue(searchParams, "mode");

  if (companySlug) request.companySlug = companySlug;
  if (projectId) request.projectId = projectId;
  if (projectSlug) request.projectSlug = projectSlug;
  if (taskId) request.taskId = taskId;
  if (taskKey) request.taskKey = taskKey;
  if (agentId) request.agentId = agentId;
  if (source) request.source = source as VoiceBindingRequest["source"];
  if (mode) request.mode = mode as VoiceBindingRequest["mode"];

  if (Object.keys(request).length === 0 && !agentName) {
    return null;
  }

  return normalizeResolvedVoiceBinding({
    ...request,
    ...(agentName ? { agentName } : {}),
  });
}

export function resolveDisplayVoiceBinding(
  liveBinding: ResolvedVoiceBinding | null | undefined,
  requestedBinding: ResolvedVoiceBinding | null | undefined,
): ResolvedVoiceBinding | null {
  const preferredLive = liveBinding && liveBinding.scope !== "global" ? liveBinding : null;
  const preferredRequested = requestedBinding && requestedBinding.scope !== "global" ? requestedBinding : null;

  if (!preferredLive) {
    return preferredRequested;
  }

  if (!preferredRequested) {
    return preferredLive;
  }

  return normalizeResolvedVoiceBinding({
    ...preferredRequested,
    ...preferredLive,
    agentName: preferredLive.agentName ?? preferredRequested.agentName,
    agentAvatarUrl: preferredLive.agentAvatarUrl ?? preferredRequested.agentAvatarUrl,
  });
}
