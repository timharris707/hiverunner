import type { LiveCallScaffold } from "@/lib/live-call-contract";

import type { ResolvedVoiceBinding } from "./voice-binding";
import { normalizeResolvedVoiceBinding } from "./voice-binding";

type OpenAiRealtimeReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";

export interface VoiceSessionBootstrap {
  provider: "gemini-live" | "openai-realtime-2";
  wsUrl: string;
  systemPrompt: string;
  voiceName: string;
  model?: string;
  openai?: {
    realtimeUrl: string;
    clientSecret: string;
    expiresAt?: number;
    voice: string;
    reasoningEffort: "minimal" | "low" | "medium" | "high" | "xhigh";
  };
  liveCall?: LiveCallScaffold;
  binding?: ResolvedVoiceBinding;
}

const VOICE_RENDER_SOURCE_KINDS = new Set([
  "html-video-element",
  "canvas-element",
  "media-stream",
  "webrtc-track",
  "ws-frame-source",
]);

const VOICE_RENDER_ATTACHMENT_ORIGINS = new Set([
  "browser-local-canvas",
  "provider-renderer",
  "webrtc-peer",
  "ws-frame-pipeline",
]);

const VOICE_VISUAL_MODES = new Set([
  "placeholder",
  "face-simulated-local",
  "face-provider-rendered",
]);

const VOICE_VISUAL_SOURCES = new Set([
  "local-simulated",
  "provider-rendered",
  "unknown",
]);

const LIVE_CALL_TRANSPORTS = new Set(["websocket", "webrtc"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNonEmptyString(value: unknown): value is string {
  return isString(value) && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeBootstrapString(value: unknown, fallback: string): string {
  if (!isString(value)) return fallback;

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : fallback;
}

function isVoiceRenderContract(value: unknown): boolean {
  if (!isRecord(value)) return false;

  const current = isRecord(value.current) ? value.current : null;
  const attachmentHints = isRecord(value.attachmentHints) ? value.attachmentHints : null;

  return !!current
    && (current.sourceKind === "placeholder"
      || (isString(current.sourceKind) && VOICE_RENDER_SOURCE_KINDS.has(current.sourceKind)))
    && typeof current.attached === "boolean"
    && (current.attachedAt === undefined || isString(current.attachedAt))
    && (current.origin === undefined
      || (isString(current.origin) && VOICE_RENDER_ATTACHMENT_ORIGINS.has(current.origin)))
    && isString(current.visualMode)
    && VOICE_VISUAL_MODES.has(current.visualMode)
    && isString(current.visualSource)
    && VOICE_VISUAL_SOURCES.has(current.visualSource)
    && Array.isArray(value.acceptedSourceKinds)
    && value.acceptedSourceKinds.every(
      (sourceKind) => isString(sourceKind) && VOICE_RENDER_SOURCE_KINDS.has(sourceKind),
    )
    && !!attachmentHints
    && attachmentHints.htmlVideoElement === "attach-src-object-or-mse"
    && attachmentHints.canvasElement === "draw-loop-or-offscreen-canvas"
    && attachmentHints.mediaStream === "assign-to-video-srcObject"
    && attachmentHints.webrtcTrack === "add-track-to-media-stream"
    && attachmentHints.wsFrameSource === "decode-frames-into-video-or-canvas"
    && isString(value.notes);
}

function isLiveCallScaffold(value: unknown): value is LiveCallScaffold {
  if (!isRecord(value)) return false;

  const participantModel = isRecord(value.participantModel) ? value.participantModel : null;
  const local = participantModel && isRecord(participantModel.local) ? participantModel.local : null;
  const remote = participantModel && isRecord(participantModel.remote) ? participantModel.remote : null;

  const media = isRecord(value.media) ? value.media : null;
  const localPreview = media && isRecord(media.localPreview) ? media.localPreview : null;
  const defaultConstraints = localPreview && isRecord(localPreview.defaultConstraints)
    ? localPreview.defaultConstraints
    : null;
  const video = defaultConstraints && isRecord(defaultConstraints.video) ? defaultConstraints.video : null;
  const width = video && isRecord(video.width) ? video.width : null;
  const height = video && isRecord(video.height) ? video.height : null;
  const frameRate = video && isRecord(video.frameRate) ? video.frameRate : null;
  const remoteAssistantTile = media && isRecord(media.remoteAssistantTile) ? media.remoteAssistantTile : null;
  const geminiVisualInput = media && isRecord(media.geminiVisualInput) ? media.geminiVisualInput : null;

  const transport = isRecord(value.transport) ? value.transport : null;
  const sessionRefs = isRecord(value.sessionRefs) ? value.sessionRefs : null;

  return value.status === "scaffold"
    && isNonEmptyString(value.callSessionId)
    && !!local
    && local.id === "operator"
    && local.webcamPreview === true
    && local.microphone === true
    && !!remote
    && remote.id === "assistant"
    && remote.audio === "gemini-live"
    && remote.videoTile === "avatar-render-slot"
    && !!localPreview
    && localPreview.source === "browser-getUserMedia"
    && localPreview.mirrored === true
    && !!defaultConstraints
    && defaultConstraints.audio === true
    && !!video
    && video.facingMode === "user"
    && !!width
    && isFiniteNumber(width.ideal)
    && !!height
    && isFiniteNumber(height.ideal)
    && !!frameRate
    && isFiniteNumber(frameRate.ideal)
    && isFiniteNumber(frameRate.max)
    && !!remoteAssistantTile
    && remoteAssistantTile.source === "avatar-provider-slot"
    && remoteAssistantTile.elementHint === "video-or-canvas"
    && remoteAssistantTile.placeholderMode === true
    && isVoiceRenderContract(remoteAssistantTile.renderContract)
    && !!geminiVisualInput
    && geminiVisualInput.enabledNow === false
    && isString(geminiVisualInput.notes)
    && !!transport
    && transport.active === "websocket"
    && Array.isArray(transport.next)
    && transport.next.every(
      (transportKind) => isString(transportKind) && LIVE_CALL_TRANSPORTS.has(transportKind),
    )
    && !!sessionRefs
    && isNonEmptyString(sessionRefs.avatarSessionId)
    && (sessionRefs.voiceSessionId === undefined || isNonEmptyString(sessionRefs.voiceSessionId));
}

export function normalizeVoiceSessionBootstrap(input: unknown): VoiceSessionBootstrap {
  const data = isRecord(input) ? input : {};
  const hasBinding = Object.prototype.hasOwnProperty.call(data, "binding") && data.binding !== undefined;
  const liveCall = isLiveCallScaffold(data.liveCall) ? data.liveCall : undefined;
  const provider = data.provider === "openai-realtime-2" ? "openai-realtime-2" : "gemini-live";
  const rawOpenAi = isRecord(data.openai) ? data.openai : {};
  const rawReasoningEffort = rawOpenAi.reasoningEffort;
  const reasoningEffort: OpenAiRealtimeReasoningEffort = rawReasoningEffort === "minimal"
    || rawReasoningEffort === "medium"
    || rawReasoningEffort === "high"
    || rawReasoningEffort === "xhigh"
    ? rawReasoningEffort
    : "low";
  const openai = provider === "openai-realtime-2"
    ? {
        realtimeUrl: normalizeBootstrapString(rawOpenAi.realtimeUrl, "https://api.openai.com/v1/realtime/calls"),
        clientSecret: normalizeBootstrapString(rawOpenAi.clientSecret, ""),
        ...(isFiniteNumber(rawOpenAi.expiresAt) ? { expiresAt: rawOpenAi.expiresAt } : {}),
        voice: normalizeBootstrapString(rawOpenAi.voice, "marin"),
        reasoningEffort,
      }
    : undefined;

  return {
    provider,
    wsUrl: normalizeBootstrapString(data.wsUrl, ""),
    ...(isNonEmptyString(data.model) ? { model: data.model } : {}),
    systemPrompt: normalizeBootstrapString(data.systemPrompt, ""),
    voiceName: normalizeBootstrapString(data.voiceName, "Charon"),
    ...(openai ? { openai } : {}),
    ...(liveCall ? { liveCall } : {}),
    ...(hasBinding ? { binding: normalizeResolvedVoiceBinding(data.binding) } : {}),
  };
}
