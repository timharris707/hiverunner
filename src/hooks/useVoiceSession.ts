/**
 * useVoiceSession — React hook for managing live voice sessions.
 *
 * Handles:
 *   - Gemini Live WebSocket lifecycle
 *   - OpenAI Realtime 2 WebRTC lifecycle
 *   - Mic capture/playback setup
 *   - Transcript accumulation
 *   - Connection state management
 */

"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import {
  buildSetupMessage,
  buildAudioMessage,
  buildTextMessage,
  parseServerMessage,
  VOICE_ASSISTANT_SYSTEM_PROMPT,
} from "@/lib/gemini-live";
import {
  extractActionIntents,
  type VoiceActionIntent,
} from "@/lib/voice-action-intent";
import {
  normalizeVoiceSessionBootstrap,
} from "@/lib/voice-session-bootstrap";
import {
  normalizeResolvedVoiceBinding,
  type ResolvedVoiceBinding,
  type VoiceBindingRequest,
} from "@/lib/voice-binding";
import {
  dispatchTool,
  extractToolRequest,
  isAllowedTool,
  type ToolDispatchEvent,
  type ToolResult,
} from "@/lib/voice-tool-dispatch";
import {
  buildToolResponseMessage,
  toLiveToolRequest,
  type GeminiLiveFunctionCall,
} from "@/lib/voice-live-tool-calling";
import {
  buildOpenAiFunctionOutput,
  buildOpenAiResponseCreate,
  buildOpenAiTextMessage,
  parseOpenAiRealtimeEvent,
  type OpenAiRealtimeFunctionCall,
} from "@/lib/openai-realtime-voice";
import { synthesizeDirectTaskActionIntents } from "@/lib/voice-direct-task-actions";
import {
  createVoiceUsageTelemetry,
  hasVoiceUsage,
  mergeGeminiLiveUsage,
  mergeOpenAiRealtimeUsage,
  type VoiceUsageTelemetry,
} from "@/lib/voice-usage-telemetry";

export type VoiceState =
  | "idle"
  | "connecting"
  | "connected"
  | "listening"
  | "speaking"
  | "error";

export interface TranscriptEntry {
  role: "user" | "assistant";
  text: string;
  timestamp: number;
}

type AudioTap = (chunk: Float32Array) => void;

export type VoiceSessionProvider = "gemini-live" | "openai-realtime-2";

interface SessionConfig {
  provider: VoiceSessionProvider;
  wsUrl: string;
  systemPrompt: string;
  voiceName: string;
  openai?: {
    realtimeUrl: string;
    clientSecret: string;
    expiresAt?: number;
    voice: string;
    reasoningEffort: "minimal" | "low" | "medium" | "high" | "xhigh";
  };
}

export interface UseVoiceSessionInput {
  bindingRequest?: VoiceBindingRequest;
  voiceProvider?: VoiceSessionProvider;
}

interface PersistedVoiceTranscriptResponse {
  filePath: string;
  filename: string;
  relativePath: string;
  rollupPath: string;
  rollupRelativePath: string;
  workspaceRoot: string;
  workspaceKind: "company" | "lane";
  durationSeconds: number;
  messages: number;
}

type VoiceUsageTelemetryPayload = VoiceUsageTelemetry & {
  sessionId?: string;
};

interface VoiceAcceptedMarkerPayload {
  id: string;
  kind: "note" | "decision" | "blocker" | "followup";
  summary: string;
  body: string;
}

function calculatePcm16Level(buffer: ArrayBuffer): number {
  const samples = new Int16Array(buffer);
  if (samples.length === 0) return 0;

  let sumSquares = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const normalized = samples[i] / 32768;
    sumSquares += normalized * normalized;
  }

  const rms = Math.sqrt(sumSquares / samples.length);
  return Math.min(1, rms * 8);
}

export function parseVoiceTurnOutput(
  transcriptText: string,
  turnId: string,
  now = Date.now(),
  textFallback = ""
): {
  cleanedText: string;
  intents: VoiceActionIntent[];
  hasTranscriptText: boolean;
} {
  const normalizedTranscriptText = transcriptText.trim();
  const normalizedTextFallback = textFallback.trim();
  const parsedTranscript = normalizedTranscriptText
    ? extractActionIntents(normalizedTranscriptText, turnId, now)
    : null;
  const parsedFallback = normalizedTextFallback
    ? extractActionIntents(normalizedTextFallback, turnId, now)
    : null;

  const cleanedTranscript = parsedTranscript?.cleanedText?.trim() ?? "";
  const cleanedFallback = parsedFallback?.cleanedText?.trim() ?? "";
  const cleanedText = cleanedTranscript || cleanedFallback;

  return {
    cleanedText,
    intents: parsedFallback?.intents.length
      ? parsedFallback.intents
      : (parsedTranscript?.intents ?? []),
    hasTranscriptText: cleanedText.length > 0,
  };
}

// AudioWorklet processor code for CAPTURE — inlined as a blob URL
const CAPTURE_WORKLET_CODE = `
class PCM16Processor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      const float32 = input[0];
      const pcm16 = new Int16Array(float32.length);
      for (let i = 0; i < float32.length; i++) {
        const s = Math.max(-1, Math.min(1, float32[i]));
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
    }
    return true;
  }
}
registerProcessor("pcm16-processor", PCM16Processor);
`;

const GEMINI_AUDIO_SAMPLE_RATE = 24000;
const GEMINI_ASSISTANT_ECHO_GUARD_PADDING_MS = 180;
const GEMINI_BARGE_IN_LEVEL = 0.24;

export function getGeminiAssistantPlaybackUntil(input: {
  now: number;
  currentPlaybackUntil: number;
  sampleCount: number;
  sampleRate?: number;
  paddingMs?: number;
}): number {
  const sampleRate = input.sampleRate ?? GEMINI_AUDIO_SAMPLE_RATE;
  const paddingMs = input.paddingMs ?? GEMINI_ASSISTANT_ECHO_GUARD_PADDING_MS;
  const durationMs = Math.max(0, (input.sampleCount / sampleRate) * 1000);
  return Math.max(input.now, input.currentPlaybackUntil) + durationMs + paddingMs;
}

export function shouldSendGeminiMicFrame(input: {
  now: number;
  inputLevel: number;
  assistantPlaybackUntil: number;
  bargeInLevel?: number;
}): boolean {
  if (input.now >= input.assistantPlaybackUntil) {
    return true;
  }

  return input.inputLevel >= (input.bargeInLevel ?? GEMINI_BARGE_IN_LEVEL);
}

// AudioWorklet processor code for PLAYBACK — ring buffer, continuous output at 24kHz
const PLAYBACK_WORKLET_CODE = `
class PCM16PlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Ring buffer: 10 seconds at 24kHz
    this._size = 24000 * 10;
    this._buffer = new Float32Array(this._size);
    this._writePos = 0;
    this._readPos = 0;

    this.port.onmessage = (e) => {
      if (e.data === 'clear') {
        this._writePos = 0;
        this._readPos = 0;
        return;
      }
      // e.data is a Float32Array of PCM samples
      const samples = new Float32Array(e.data);
      for (let i = 0; i < samples.length; i++) {
        this._buffer[this._writePos % this._size] = samples[i];
        this._writePos++;
      }
    };
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || !output[0]) return true;
    const channel = output[0];
    for (let i = 0; i < channel.length; i++) {
      if (this._readPos < this._writePos) {
        channel[i] = this._buffer[this._readPos % this._size];
        this._readPos++;
      } else {
        channel[i] = 0; // silence on underrun
      }
    }
    // Reset positions when buffer is fully drained to prevent unbounded growth
    if (this._readPos >= this._writePos && this._writePos > 0) {
      this._readPos = 0;
      this._writePos = 0;
    }
    return true;
  }
}
registerProcessor("pcm16-playback-processor", PCM16PlaybackProcessor);
`;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const pcm16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(pcm16.length);
  for (let i = 0; i < pcm16.length; i++) {
    float32[i] = pcm16[i] / (pcm16[i] < 0 ? 0x8000 : 0x7fff);
  }
  return float32;
}

function createVoiceSessionId(): string {
  return `voice-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getStoredVoiceProviderOverride(): VoiceSessionProvider | undefined {
  if (typeof window === "undefined") return undefined;

  const queryProvider = new URLSearchParams(window.location.search).get("voiceProvider");
  if (queryProvider === "gemini-live" || queryProvider === "openai-realtime-2") {
    return queryProvider;
  }

  const storedProvider = window.localStorage.getItem("hiverunner.voiceProvider");
  return storedProvider === "gemini-live" || storedProvider === "openai-realtime-2"
    ? storedProvider
    : undefined;
}

export function storeVoiceProviderOverride(provider: VoiceSessionProvider) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem("hiverunner.voiceProvider", provider);
}

function normalizeAcceptedMarkers(intents: VoiceActionIntent[]): VoiceAcceptedMarkerPayload[] {
  return intents
    .filter((intent) => intent.name === "session.marker" && intent.status === "acknowledged")
    .map((intent) => ({
      id: intent.id,
      kind:
        typeof intent.payload.kind === "string" &&
        ["note", "decision", "blocker", "followup"].includes(intent.payload.kind)
          ? (intent.payload.kind as VoiceAcceptedMarkerPayload["kind"])
          : "note",
      summary:
        typeof intent.payload.summary === "string" && intent.payload.summary.trim()
          ? intent.payload.summary.trim()
          : "Voice session note",
      body:
        typeof intent.payload.body === "string" && intent.payload.body.trim()
          ? intent.payload.body.trim()
          : typeof intent.payload.summary === "string" && intent.payload.summary.trim()
            ? intent.payload.summary.trim()
            : "Voice session note",
    }));
}

const TOOL_APPROVAL_REGEX = /\b(?:go ahead|do it now|yes(?:,)? do it|yes(?:,)? go ahead|please do|confirm(?: that)?|approved?|sounds good|make it happen)\b/i;

function normalizeAutoApprovalText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim();
}

function getStatusApprovalAliases(status: string): string[] {
  const normalized = normalizeAutoApprovalText(status).replace(/\s+/g, "-");
  switch (normalized) {
    case "done":
    case "complete":
    case "completed":
    case "closed":
      return ["done", "complete", "completed", "closed"];
    case "to-do":
    case "to-do":
    case "todo":
      return ["to do", "to-do", "todo", "on deck"];
    case "in-progress":
    case "in progress":
    case "active":
    case "working":
      return ["in progress", "in-progress", "active", "working"];
    case "blocked":
    case "waiting":
      return ["blocked", "waiting", "on hold", "hold"];
    case "review":
      return ["review"];
    default:
      return normalized ? [normalized.replace(/-/g, " "), normalized] : [];
  }
}

function isDirectlyAuthorizedToolRequest(intent: VoiceActionIntent, userText: string): boolean {
  const request = extractToolRequest(intent.payload);
  if (!request) {
    return false;
  }

  const normalizedUserText = normalizeAutoApprovalText(userText);
  if (!normalizedUserText) {
    return false;
  }

  switch (request.tool) {
    case "move_task_status": {
      const requestedStatus =
        request.params && typeof request.params === "object" && "status" in request.params
          ? String((request.params as { status?: unknown }).status ?? "")
          : "";
      const hasActionVerb = /\b(?:change|move|set|mark|put|switch)\b/.test(normalizedUserText);
      if (!hasActionVerb) {
        return false;
      }
      return getStatusApprovalAliases(requestedStatus).some((alias) => normalizedUserText.includes(alias));
    }
    case "add_task_comment":
      return /\b(?:comment|note|post|leave|add|tell)\b/.test(normalizedUserText);
    default:
      return false;
  }
}

export function findDirectlyAuthorizedToolIntents(
  intents: VoiceActionIntent[],
  userText: string,
): VoiceActionIntent[] {
  return intents.filter(
    (intent) => intent.name === "tool.request" && intent.status === "proposed" && isDirectlyAuthorizedToolRequest(intent, userText),
  );
}

export function findAutoApprovedToolIntent(
  intents: VoiceActionIntent[],
  userText: string,
): VoiceActionIntent | null {
  const proposedToolIntents = intents.filter(
    (intent) => intent.name === "tool.request" && intent.status === "proposed",
  );

  if (proposedToolIntents.length !== 1) {
    return null;
  }

  const [candidate] = proposedToolIntents;
  if (!candidate) {
    return null;
  }

  const normalizedUserText = userText.trim();
  if (TOOL_APPROVAL_REGEX.test(normalizedUserText)) {
    return candidate;
  }

  return isDirectlyAuthorizedToolRequest(candidate, normalizedUserText) ? candidate : null;
}

export function shouldSynthesizeDirectTaskActionFallback(input: {
  bindingScope?: ResolvedVoiceBinding["scope"];
  lastUserText?: string;
  currentTurnHadNativeToolCall: boolean;
}): boolean {
  return input.bindingScope === "task" && !!input.lastUserText && !input.currentTurnHadNativeToolCall;
}

export function useVoiceSession(input?: UseVoiceSessionInput) {
  const [state, setState] = useState<VoiceState>("idle");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [intents, setIntents] = useState<VoiceActionIntent[]>([]);
  const [toolEvents, setToolEvents] = useState<ToolDispatchEvent[]>([]);
  const [audioInputLevel, setAudioInputLevel] = useState(0);
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [binding, setBinding] = useState<ResolvedVoiceBinding | undefined>(() => {
    return input?.bindingRequest
      ? normalizeResolvedVoiceBinding(input.bindingRequest)
      : undefined;
  });
  const [error, setError] = useState<string | null>(null);
  const [isSetupRequired, setIsSetupRequired] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const openAiPeerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const openAiDataChannelRef = useRef<RTCDataChannel | null>(null);
  const openAiAudioElementRef = useRef<HTMLAudioElement | null>(null);
  const captureContextRef = useRef<AudioContext | null>(null);
  const playbackContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const captureNodeRef = useRef<AudioWorkletNode | null>(null);
  const playbackNodeRef = useRef<AudioWorkletNode | null>(null);
  const currentTextRef = useRef("");
  const transcriptRef = useRef<TranscriptEntry[]>([]);
  const intentsRef = useRef<VoiceActionIntent[]>([]);
  const toolEventsRef = useRef<ToolDispatchEvent[]>([]);
  const executedToolIntentIdsRef = useRef<Set<string>>(new Set());
  const inFlightNativeToolControllersRef = useRef<Map<string, AbortController>>(new Map());
  const cancelledNativeToolCallIdsRef = useRef<Set<string>>(new Set());
  const currentVoiceTurnHadNativeToolCallRef = useRef(false);
  const bindingRef = useRef<ResolvedVoiceBinding | undefined>(binding);
  const currentInputTranscript = useRef("");
  const currentOutputTranscript = useRef("");
  const lastUserTextRef = useRef("");
  const pendingUserIndexRef = useRef<number | null>(null);
  const pendingAssistantIndexRef = useRef<number | null>(null);
  const lastSavedTranscriptLengthRef = useRef(0);
  const voiceTurnCounterRef = useRef(0);
  const sessionIdRef = useRef<string | null>(null);
  const persistedArtifactSessionIdRef = useRef<string | null>(null);
  const sessionGenerationRef = useRef(0);
  const lastInputLevelUpdateRef = useRef(0);
  const geminiAssistantPlaybackUntilRef = useRef(0);
  const usageTelemetryRef = useRef<VoiceUsageTelemetry | null>(null);
  const audioTapsRef = useRef<Set<AudioTap>>(new Set());
  const bindingRequest = input?.bindingRequest;

  useEffect(() => {
    intentsRef.current = intents;
  }, [intents]);

  useEffect(() => {
    toolEventsRef.current = toolEvents;
  }, [toolEvents]);

  useEffect(() => {
    bindingRef.current = binding;
  }, [binding]);

  // Keep transcriptRef in sync
  const updateTranscript = useCallback((updater: (prev: TranscriptEntry[]) => TranscriptEntry[]) => {
    setTranscript((prev) => {
      const next = updater(prev);
      transcriptRef.current = next;
      return next;
    });
  }, []);

  const appendToolEvent = useCallback((event: ToolDispatchEvent) => {
    setToolEvents((prev) => {
      const next = [...prev, event];
      toolEventsRef.current = next;
      return next;
    });
  }, []);

  const executeAcceptedToolIntent = useCallback(async (intent: VoiceActionIntent) => {
    if (intent.name !== "tool.request") {
      return;
    }

    if (executedToolIntentIdsRef.current.has(intent.id)) {
      return;
    }
    executedToolIntentIdsRef.current.add(intent.id);

    const request = extractToolRequest(intent.payload);
    if (!request) {
      appendToolEvent({
        type: "rejected",
        intentId: intent.id,
        tool: "get_current_context",
        error: "Invalid or unsupported tool request payload",
      });
      return;
    }

    appendToolEvent({
      type: "dispatching",
      intentId: intent.id,
      tool: request.tool,
    });

    try {
      const result = await dispatchTool({
        ...request,
        binding: bindingRef.current,
        sessionId: sessionIdRef.current ?? undefined,
        intentId: intent.id,
      });

      if (result.status === "rejected") {
        appendToolEvent({
          type: "rejected",
          intentId: intent.id,
          tool: request.tool,
          result,
        });
        return;
      }

      if (result.status === "error") {
        const outputError =
          result.output && typeof result.output === "object" && "error" in result.output
            ? String((result.output as { error?: unknown }).error ?? "Tool execution failed")
            : "Tool execution failed";
        appendToolEvent({
          type: "error",
          intentId: intent.id,
          tool: request.tool,
          error: outputError,
          result,
        });
        return;
      }

      appendToolEvent({
        type: "completed",
        intentId: intent.id,
        tool: request.tool,
        result,
      });
    } catch (error) {
      appendToolEvent({
        type: "error",
        intentId: intent.id,
        tool: request.tool,
        error: error instanceof Error ? error.message : "Tool execution failed",
      });
    }
  }, [appendToolEvent]);

  const executeNativeFunctionCall = useCallback(async (call: GeminiLiveFunctionCall) => {
    const request = toLiveToolRequest(call);
    if (!request) {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          toolResponse: {
            functionResponses: [
              {
                id: call.id,
                name: call.name,
                response: {
                  status: "rejected",
                  output: { error: `Unsupported tool '${call.name}'` },
                },
              },
            ],
          },
        }));
      }
      return;
    }

    const intentId = `live:${call.id}`;
    const startedAt = Date.now();
    const controller = new AbortController();
    cancelledNativeToolCallIdsRef.current.delete(call.id);
    inFlightNativeToolControllersRef.current.set(call.id, controller);

    appendToolEvent({
      type: "dispatching",
      intentId,
      tool: request.tool,
    });

    let result: ToolResult;

    try {
      result = await dispatchTool({
        ...request,
        binding: bindingRef.current,
        sessionId: sessionIdRef.current ?? undefined,
        intentId,
      }, controller.signal);

      if (result.status === "rejected") {
        appendToolEvent({
          type: "rejected",
          intentId,
          tool: request.tool,
          result,
        });
      } else if (result.status === "error") {
        const outputError =
          result.output && typeof result.output === "object" && "error" in result.output
            ? String((result.output as { error?: unknown }).error ?? "Tool execution failed")
            : "Tool execution failed";
        appendToolEvent({
          type: "error",
          intentId,
          tool: request.tool,
          error: outputError,
          result,
        });
      } else {
        appendToolEvent({
          type: "completed",
          intentId,
          tool: request.tool,
          result,
        });
      }
    } catch (error) {
      result = {
        tool: request.tool,
        status: controller.signal.aborted ? "rejected" : "error",
        output: {
          error: error instanceof Error ? error.message : "Tool execution failed",
        },
        durationMs: Date.now() - startedAt,
        executedAt: startedAt,
      };

      appendToolEvent({
        type: controller.signal.aborted ? "rejected" : "error",
        intentId,
        tool: request.tool,
        error: error instanceof Error ? error.message : "Tool execution failed",
        result,
      });
    } finally {
      inFlightNativeToolControllersRef.current.delete(call.id);
    }

    if (cancelledNativeToolCallIdsRef.current.has(call.id)) {
      return;
    }

    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(buildToolResponseMessage([{ id: call.id, name: call.name, result }])));
    }
  }, [appendToolEvent]);

  const executeOpenAiFunctionCalls = useCallback(async (calls: OpenAiRealtimeFunctionCall[]) => {
    const dc = openAiDataChannelRef.current;
    if (!dc || dc.readyState !== "open") {
      return;
    }

    for (const call of calls) {
      if (call.name === "wait_for_user") {
        dc.send(JSON.stringify(buildOpenAiFunctionOutput(call.callId, {
          status: "success",
          output: { waited: true },
        })));
        continue;
      }

      if (!isAllowedTool(call.name)) {
        dc.send(JSON.stringify({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: call.callId,
            output: JSON.stringify({
              status: "error",
              output: { error: `Unsupported tool '${call.name}'` },
            }),
          },
        }));
        dc.send(JSON.stringify(buildOpenAiResponseCreate()));
        continue;
      }

      const intentId = `openai:${call.callId}`;
      const startedAt = Date.now();
      const controller = new AbortController();
      const request = {
        tool: call.name,
        params: call.arguments,
      };

      appendToolEvent({
        type: "dispatching",
        intentId,
        tool: request.tool,
      });

      let result: ToolResult;

      try {
        result = await dispatchTool({
          ...request,
          binding: bindingRef.current,
          sessionId: sessionIdRef.current ?? undefined,
          intentId,
        }, controller.signal);

        if (result.status === "rejected") {
          appendToolEvent({
            type: "rejected",
            intentId,
            tool: request.tool,
            result,
          });
        } else if (result.status === "error") {
          const outputError =
            result.output && typeof result.output === "object" && "error" in result.output
              ? String((result.output as { error?: unknown }).error ?? "Tool execution failed")
              : "Tool execution failed";
          appendToolEvent({
            type: "error",
            intentId,
            tool: request.tool,
            error: outputError,
            result,
          });
        } else {
          appendToolEvent({
            type: "completed",
            intentId,
            tool: request.tool,
            result,
          });
        }
      } catch (error) {
        result = {
          tool: request.tool,
          status: controller.signal.aborted ? "rejected" : "error",
          output: {
            error: error instanceof Error ? error.message : "Tool execution failed",
          },
          durationMs: Date.now() - startedAt,
          executedAt: startedAt,
        };

        appendToolEvent({
          type: controller.signal.aborted ? "rejected" : "error",
          intentId,
          tool: request.tool,
          error: error instanceof Error ? error.message : "Tool execution failed",
          result,
        });
      }

      if (dc.readyState === "open") {
        dc.send(JSON.stringify(buildOpenAiFunctionOutput(call.callId, result)));
        dc.send(JSON.stringify(buildOpenAiResponseCreate()));
      }
    }
  }, [appendToolEvent]);

  const setIntentStatus = useCallback((intentId: string, accepted: boolean) => {
    const targetIntent = intentsRef.current.find((intent) => intent.id === intentId);
    setIntents((prev) => {
      const next = prev.map((intent) =>
        intent.id === intentId
          ? { ...intent, status: accepted ? ("acknowledged" as const) : ("rejected" as const) }
          : intent,
      );
      intentsRef.current = next;
      return next;
    });

    if (accepted && targetIntent?.name === "tool.request") {
      void executeAcceptedToolIntent(targetIntent);
    }
  }, [executeAcceptedToolIntent]);

  const maybeAutoApprovePendingToolIntent = useCallback((userText: string) => {
    const targetIntent = findAutoApprovedToolIntent(intentsRef.current, userText);
    if (!targetIntent) {
      return;
    }
    setIntentStatus(targetIntent.id, true);
  }, [setIntentStatus]);

  const persistTranscript = useCallback(async (): Promise<PersistedVoiceTranscriptResponse | null> => {
    if (transcriptRef.current.length === 0) return null;
    if (transcriptRef.current.length === lastSavedTranscriptLengthRef.current) return null;

    const effectiveBinding = bindingRef.current ?? (bindingRequest ? normalizeResolvedVoiceBinding(bindingRequest) : undefined);
    const snapshot = [...transcriptRef.current];
    const response = await fetch("/api/voice/transcript", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        transcript: snapshot,
        binding: effectiveBinding,
        sessionId: sessionIdRef.current,
        acceptedMarkers: normalizeAcceptedMarkers(intentsRef.current),
        usage: hasVoiceUsage(usageTelemetryRef.current)
          ? ({
              ...usageTelemetryRef.current,
              sessionId: sessionIdRef.current ?? undefined,
            } satisfies VoiceUsageTelemetryPayload)
          : undefined,
      }),
    });

    if (!response.ok) {
      throw new Error("Failed to persist voice transcript");
    }

    const saved = await response.json() as PersistedVoiceTranscriptResponse;
    lastSavedTranscriptLengthRef.current = snapshot.length;
    return saved;
  }, [bindingRequest]);

  const persistAcceptedVoiceOutcome = useCallback(async (transcript: PersistedVoiceTranscriptResponse | null) => {
    const effectiveBinding = bindingRef.current ?? (bindingRequest ? normalizeResolvedVoiceBinding(bindingRequest) : undefined);
    if (!effectiveBinding || effectiveBinding.scope !== "task" || !effectiveBinding.taskId) {
      return;
    }

    // Post the outcome even for empty-transcript sessions so the session-proof
    // comment + agent session-log entry always land.

    const response = await fetch("/api/voice/outcome", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        sessionId: sessionIdRef.current,
        binding: effectiveBinding,
        acceptedMarkers: normalizeAcceptedMarkers(intentsRef.current),
        transcript,
      }),
    });

    if (!response.ok) {
      throw new Error("Failed to persist task-bound voice outcome");
    }
  }, [bindingRequest]);

  const persistSessionArtifacts = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    if (!sessionId || persistedArtifactSessionIdRef.current === sessionId) {
      return;
    }

    try {
      const transcript = await persistTranscript();
      await persistAcceptedVoiceOutcome(transcript);
      persistedArtifactSessionIdRef.current = sessionId;
    } catch {
      // Non-fatal in the realtime UI. We keep the conversation intact even if persistence fails.
    }
  }, [persistAcceptedVoiceOutcome, persistTranscript]);

  const teardownSessionResources = useCallback((options?: { persist?: boolean; nextState?: VoiceState | null }) => {
    const shouldPersist = options?.persist !== false;

    if (shouldPersist) {
      void persistSessionArtifacts();
    }

    const ws = wsRef.current;
    if (ws) {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      wsRef.current = null;
      try {
        ws.close();
      } catch {}
    }

    const dc = openAiDataChannelRef.current;
    if (dc) {
      dc.onopen = null;
      dc.onmessage = null;
      dc.onerror = null;
      openAiDataChannelRef.current = null;
      try {
        dc.close();
      } catch {}
    }

    const pc = openAiPeerConnectionRef.current;
    if (pc) {
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      openAiPeerConnectionRef.current = null;
      try {
        pc.close();
      } catch {}
    }

    const audioEl = openAiAudioElementRef.current;
    if (audioEl) {
      openAiAudioElementRef.current = null;
      try {
        audioEl.pause();
      } catch {}
      audioEl.srcObject = null;
      audioEl.remove();
    }

    for (const controller of inFlightNativeToolControllersRef.current.values()) {
      controller.abort();
    }
    inFlightNativeToolControllersRef.current.clear();
    cancelledNativeToolCallIdsRef.current.clear();
    currentVoiceTurnHadNativeToolCallRef.current = false;

    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    const captureNode = captureNodeRef.current;
    if (captureNode) {
      captureNode.port.onmessage = null;
      captureNodeRef.current = null;
      try {
        captureNode.disconnect();
      } catch {}
    }

    const playbackNode = playbackNodeRef.current;
    if (playbackNode) {
      try {
        playbackNode.port.postMessage("clear");
      } catch {}
      playbackNodeRef.current = null;
      try {
        playbackNode.disconnect();
      } catch {}
    }

    const captureContext = captureContextRef.current;
    if (captureContext) {
      captureContextRef.current = null;
      void captureContext.close().catch(() => {});
    }

    const playbackContext = playbackContextRef.current;
    if (playbackContext) {
      playbackContextRef.current = null;
      void playbackContext.close().catch(() => {});
    }

    currentTextRef.current = "";
    currentInputTranscript.current = "";
    currentOutputTranscript.current = "";
    geminiAssistantPlaybackUntilRef.current = 0;
    pendingUserIndexRef.current = null;
    pendingAssistantIndexRef.current = null;
    setAudioInputLevel(0);
    setIsUserSpeaking(false);
    setIsMicMuted(false);
    if (options?.nextState !== null) {
      setState(options?.nextState ?? "idle");
    }
  }, [persistSessionArtifacts]);

  const finalizeVoiceOutput = useCallback((transcriptText: string, textFallback = "") => {
    const now = Date.now();
    voiceTurnCounterRef.current += 1;
    const turnId = `voice-turn:${voiceTurnCounterRef.current}:${now.toString(36)}`;
    const parsed = parseVoiceTurnOutput(transcriptText, turnId, now, textFallback);
    const syntheticDirectIntents = shouldSynthesizeDirectTaskActionFallback({
      bindingScope: bindingRef.current?.scope,
      lastUserText: lastUserTextRef.current,
      currentTurnHadNativeToolCall: currentVoiceTurnHadNativeToolCallRef.current,
    })
      ? synthesizeDirectTaskActionIntents(lastUserTextRef.current, turnId, now, parsed.intents)
      : [];
    const incomingIntents = [...parsed.intents, ...syntheticDirectIntents];

    if (incomingIntents.length > 0) {
      const nextIntents = [...intentsRef.current, ...incomingIntents];
      const newIntentIds = new Set(incomingIntents.map((intent) => intent.id));
      const directlyAuthorizedIntents = lastUserTextRef.current
        ? findDirectlyAuthorizedToolIntents(nextIntents, lastUserTextRef.current).filter((intent) => newIntentIds.has(intent.id))
        : [];
      const genericAutoApprovedCandidate = directlyAuthorizedIntents.length === 0 && lastUserTextRef.current
        ? findAutoApprovedToolIntent(nextIntents, lastUserTextRef.current)
        : null;
      const acknowledgedIntentIds = new Set(directlyAuthorizedIntents.map((intent) => intent.id));
      if (genericAutoApprovedCandidate && newIntentIds.has(genericAutoApprovedCandidate.id)) {
        acknowledgedIntentIds.add(genericAutoApprovedCandidate.id);
      }
      const committedIntents = acknowledgedIntentIds.size > 0
        ? nextIntents.map((intent) =>
            acknowledgedIntentIds.has(intent.id)
              ? { ...intent, status: "acknowledged" as const }
              : intent
          )
        : nextIntents;
      intentsRef.current = committedIntents;
      setIntents(committedIntents);
      if (acknowledgedIntentIds.size > 0) {
        for (const intent of committedIntents) {
          if (intent.name === "tool.request" && intent.status === "acknowledged" && acknowledgedIntentIds.has(intent.id)) {
            void executeAcceptedToolIntent(intent);
          }
        }
      }
    }

    if (!parsed.hasTranscriptText) {
      return;
    }

    updateTranscript((prev) => {
      const next = [...prev];
      const pendingIndex = pendingAssistantIndexRef.current;
      if (pendingIndex != null && next[pendingIndex]?.role === "assistant") {
        next[pendingIndex] = { ...next[pendingIndex], text: parsed.cleanedText };
        return next;
      }
      pendingAssistantIndexRef.current = next.length;
      next.push({ role: "assistant", text: parsed.cleanedText, timestamp: now });
      return next;
    });
  }, [executeAcceptedToolIntent, updateTranscript]);

  const connect = useCallback(async () => {
    const generation = sessionGenerationRef.current + 1;
    sessionGenerationRef.current = generation;
    teardownSessionResources({ persist: true, nextState: null });

    const isCurrentSession = () => sessionGenerationRef.current === generation;

    sessionIdRef.current = createVoiceSessionId();
    persistedArtifactSessionIdRef.current = null;
    transcriptRef.current = [];
    intentsRef.current = [];
    toolEventsRef.current = [];
    executedToolIntentIdsRef.current = new Set();
    inFlightNativeToolControllersRef.current = new Map();
    cancelledNativeToolCallIdsRef.current = new Set();
    currentVoiceTurnHadNativeToolCallRef.current = false;
    currentTextRef.current = "";
    currentInputTranscript.current = "";
    currentOutputTranscript.current = "";
    geminiAssistantPlaybackUntilRef.current = 0;
    lastUserTextRef.current = "";
    pendingUserIndexRef.current = null;
    pendingAssistantIndexRef.current = null;
    lastSavedTranscriptLengthRef.current = 0;
    usageTelemetryRef.current = null;
    setTranscript([]);
    setIntents([]);
    setToolEvents([]);
    setAudioInputLevel(0);
    setIsUserSpeaking(false);
    setIsMicMuted(false);
    setState("connecting");
    setError(null);
    setIsSetupRequired(false);
    setBinding(bindingRequest ? normalizeResolvedVoiceBinding(bindingRequest) : undefined);
    bindingRef.current = bindingRequest ? normalizeResolvedVoiceBinding(bindingRequest) : undefined;

    try {
      const sessionRequestBody = {
        ...(bindingRequest ?? {}),
        ...(input?.voiceProvider ?? getStoredVoiceProviderOverride()
          ? { voiceProvider: input?.voiceProvider ?? getStoredVoiceProviderOverride() }
          : {}),
      };

      // 1. Get session config from server
      const res = await fetch("/api/voice/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sessionRequestBody),
      });
      const data = await res.json();

      if (!isCurrentSession()) {
        return;
      }

      if (!res.ok) {
        if (data.setup) {
          setIsSetupRequired(true);
          setError(data.error);
          setState("error");
          return;
        }
        throw new Error(data.error || "Failed to get session config");
      }

      const bootstrap = normalizeVoiceSessionBootstrap(data);
      const config: SessionConfig = bootstrap;
      setBinding(bootstrap.binding);
      bindingRef.current = bootstrap.binding;
      usageTelemetryRef.current = createVoiceUsageTelemetry(config.provider, bootstrap.model ?? config.openai?.reasoningEffort ?? "unknown");

      if (config.provider === "openai-realtime-2") {
        if (!config.openai?.clientSecret) {
          throw new Error("OpenAI Realtime client secret was not returned");
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        if (!isCurrentSession()) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;

        const pc = new RTCPeerConnection();
        openAiPeerConnectionRef.current = pc;

        const audioEl = document.createElement("audio");
        audioEl.autoplay = true;
        audioEl.style.display = "none";
        document.body.appendChild(audioEl);
        openAiAudioElementRef.current = audioEl;

        pc.ontrack = (event) => {
          audioEl.srcObject = event.streams[0] ?? null;
        };

        for (const track of stream.getAudioTracks()) {
          pc.addTrack(track, stream);
        }

        const dc = pc.createDataChannel("oai-events");
        openAiDataChannelRef.current = dc;

        dc.onopen = () => {
          if (!isCurrentSession()) return;
          setState("listening");
        };

        dc.onmessage = (event) => {
          if (!isCurrentSession()) return;
          const raw = typeof event.data === "string" ? event.data : "";
          if (!raw) return;

          const parsed = parseOpenAiRealtimeEvent(JSON.parse(raw));
          switch (parsed.type) {
            case "session_ready":
              setState("listening");
              break;

            case "input_speech_started":
              setIsUserSpeaking(true);
              setAudioInputLevel(0.8);
              break;

            case "input_speech_stopped":
              setIsUserSpeaking(false);
              setAudioInputLevel(0);
              break;

            case "input_transcription": {
              if (usageTelemetryRef.current) {
                mergeOpenAiRealtimeUsage(usageTelemetryRef.current, parsed.usage, "transcription");
              }
              const nextText = parsed.text.trim();
              if (!nextText) break;
              currentInputTranscript.current = nextText;
              lastUserTextRef.current = nextText;
              maybeAutoApprovePendingToolIntent(nextText);
              updateTranscript((prev) => {
                const next = [...prev];
                const pendingIndex = pendingUserIndexRef.current;
                if (pendingIndex != null && next[pendingIndex]?.role === "user") {
                  next[pendingIndex] = { ...next[pendingIndex], text: nextText };
                  return next;
                }
                pendingUserIndexRef.current = next.length;
                next.push({ role: "user", text: nextText, timestamp: Date.now() });
                return next;
              });
              break;
            }

            case "output_transcription_delta":
              currentOutputTranscript.current += parsed.text;
              setState("speaking");
              break;

            case "output_transcription_done":
              currentOutputTranscript.current = parsed.text || currentOutputTranscript.current;
              break;

            case "output_text_delta":
              currentTextRef.current += parsed.text;
              break;

            case "response_created":
              setState("speaking");
              break;

            case "response_cancelled":
              currentTextRef.current = "";
              currentOutputTranscript.current = "";
              currentVoiceTurnHadNativeToolCallRef.current = false;
              pendingAssistantIndexRef.current = null;
              setState("listening");
              break;

            case "response_done": {
              if (usageTelemetryRef.current) {
                mergeOpenAiRealtimeUsage(usageTelemetryRef.current, parsed.usage, "response");
              }
              if (parsed.functionCalls.length > 0) {
                currentVoiceTurnHadNativeToolCallRef.current = true;
                void executeOpenAiFunctionCalls(parsed.functionCalls);
                break;
              }

              const assistantTranscript = currentOutputTranscript.current.trim();
              const assistantTextFallback = (currentTextRef.current.trim() || parsed.outputText.trim());
              if (assistantTranscript || assistantTextFallback) {
                finalizeVoiceOutput(assistantTranscript, assistantTextFallback);
              }
              currentInputTranscript.current = "";
              currentOutputTranscript.current = "";
              currentTextRef.current = "";
              currentVoiceTurnHadNativeToolCallRef.current = false;
              lastUserTextRef.current = "";
              pendingUserIndexRef.current = null;
              pendingAssistantIndexRef.current = null;
              setState("listening");
              break;
            }

            case "error":
              setError(parsed.message);
              setState("error");
              break;
          }
        };

        dc.onerror = () => {
          if (!isCurrentSession()) return;
          setError("OpenAI Realtime data channel failed");
          setState("error");
        };

        pc.onconnectionstatechange = () => {
          if (!isCurrentSession()) return;
          if (pc.connectionState === "failed" || pc.connectionState === "closed") {
            void persistSessionArtifacts();
            setAudioInputLevel(0);
            setIsUserSpeaking(false);
            setState((prev) => prev === "error" ? prev : "idle");
          }
        };

        const offer = await pc.createOffer();
        if (!isCurrentSession()) return;
        await pc.setLocalDescription(offer);
        if (!isCurrentSession()) return;

        const sdpResponse = await fetch(config.openai.realtimeUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.openai.clientSecret}`,
            "Content-Type": "application/sdp",
          },
          body: offer.sdp ?? "",
        });

        if (!sdpResponse.ok) {
          const details = await sdpResponse.text().catch(() => "");
          const normalizedDetails = details.trim().slice(0, 240);
          throw new Error(
            normalizedDetails
              ? `OpenAI Realtime call failed: ${sdpResponse.status} ${normalizedDetails}`
              : `OpenAI Realtime call failed: ${sdpResponse.status}`
          );
        }

        await pc.setRemoteDescription({
          type: "answer",
          sdp: await sdpResponse.text(),
        });

        if (!isCurrentSession()) return;

        setState("connected");
        return;
      }

      // 2. Request mic access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (!isCurrentSession()) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;

      // 3. Set up CAPTURE AudioContext + worklet (16kHz for mic)
      const captureCtx = new AudioContext({ sampleRate: 16000 });
      if (!isCurrentSession()) {
        void captureCtx.close().catch(() => {});
        return;
      }
      captureContextRef.current = captureCtx;

      const captureBlob = new Blob([CAPTURE_WORKLET_CODE], { type: "application/javascript" });
      const captureUrl = URL.createObjectURL(captureBlob);
      await captureCtx.audioWorklet.addModule(captureUrl);
      URL.revokeObjectURL(captureUrl);

      const micSource = captureCtx.createMediaStreamSource(stream);
      const captureNode = new AudioWorkletNode(captureCtx, "pcm16-processor");
      captureNodeRef.current = captureNode;

      // 4. Set up PLAYBACK AudioContext + streaming worklet (24kHz for Gemini output)
      const playbackCtx = new AudioContext({ sampleRate: 24000 });
      if (!isCurrentSession()) {
        void playbackCtx.close().catch(() => {});
        return;
      }
      playbackContextRef.current = playbackCtx;

      const playbackBlob = new Blob([PLAYBACK_WORKLET_CODE], { type: "application/javascript" });
      const playbackUrl = URL.createObjectURL(playbackBlob);
      await playbackCtx.audioWorklet.addModule(playbackUrl);
      URL.revokeObjectURL(playbackUrl);

      const playbackNode = new AudioWorkletNode(playbackCtx, "pcm16-playback-processor");
      playbackNodeRef.current = playbackNode;
      playbackNode.connect(playbackCtx.destination);

      // 5. Open WebSocket to Gemini
      const ws = new WebSocket(config.wsUrl);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => {
        if (!isCurrentSession()) return;
        ws.send(
          JSON.stringify(
            buildSetupMessage({
              apiKey: "",
              systemInstruction: config.systemPrompt || VOICE_ASSISTANT_SYSTEM_PROMPT,
              voiceName: config.voiceName,
            })
          )
        );
      };

      ws.onmessage = (event) => {
        if (!isCurrentSession()) return;
        const raw = typeof event.data === "string"
          ? event.data
          : new TextDecoder().decode(event.data);
        const parsedEvents = parseServerMessage(JSON.parse(raw));

        for (const parsed of parsedEvents) {
          switch (parsed.type) {
            case "setup_complete":
              setState("listening");
              // Wire up mic capture → WebSocket
              captureNode.port.onmessage = (e: MessageEvent) => {
                const audioBuffer = e.data instanceof ArrayBuffer ? e.data : null;
                if (!audioBuffer) return;

                const now = Date.now();
                const nextInputLevel = calculatePcm16Level(audioBuffer);
                if (now - lastInputLevelUpdateRef.current >= 80) {
                  lastInputLevelUpdateRef.current = now;
                  setAudioInputLevel(nextInputLevel);
                  setIsUserSpeaking(nextInputLevel > 0.08);
                }

                if (ws.readyState === WebSocket.OPEN) {
                  if (!shouldSendGeminiMicFrame({
                    now,
                    inputLevel: nextInputLevel,
                    assistantPlaybackUntil: geminiAssistantPlaybackUntilRef.current,
                  })) {
                    return;
                  }
                  ws.send(JSON.stringify(buildAudioMessage(arrayBufferToBase64(audioBuffer))));
                }
              };
              micSource.connect(captureNode);
              break;

            case "audio": {
              // Decode and stream into playback worklet ring buffer
              const float32 = base64ToFloat32(parsed.data);
              for (const tap of audioTapsRef.current) {
                tap(float32.slice());
              }
              const now = Date.now();
              geminiAssistantPlaybackUntilRef.current = getGeminiAssistantPlaybackUntil({
                now,
                currentPlaybackUntil: geminiAssistantPlaybackUntilRef.current,
                sampleCount: float32.length,
              });
              playbackNode.port.postMessage(float32.buffer, [float32.buffer]);
              setState("speaking");
              break;
            }

            case "input_transcription": {
              currentInputTranscript.current += parsed.text;
              const nextText = currentInputTranscript.current.trim();
              if (!nextText) break;
              lastUserTextRef.current = nextText;
              maybeAutoApprovePendingToolIntent(nextText);
              updateTranscript((prev) => {
                const next = [...prev];
                const pendingIndex = pendingUserIndexRef.current;
                if (pendingIndex != null && next[pendingIndex]?.role === "user") {
                  next[pendingIndex] = { ...next[pendingIndex], text: nextText };
                  return next;
                }
                pendingUserIndexRef.current = next.length;
                next.push({ role: "user", text: nextText, timestamp: Date.now() });
                return next;
              });
              break;
            }

            case "output_transcription": {
              currentOutputTranscript.current += parsed.text;
              setState("speaking");
              break;
            }

            case "tool_call": {
              currentVoiceTurnHadNativeToolCallRef.current = true;
              for (const functionCall of parsed.functionCalls) {
                void executeNativeFunctionCall(functionCall);
              }
              break;
            }

            case "tool_call_cancellation": {
              for (const id of parsed.ids) {
                cancelledNativeToolCallIdsRef.current.add(id);
                const controller = inFlightNativeToolControllersRef.current.get(id);
                controller?.abort();
                inFlightNativeToolControllersRef.current.delete(id);
              }
              break;
            }

            case "text":
              currentTextRef.current += parsed.text;
              break;

            case "usage":
              if (usageTelemetryRef.current) {
                mergeGeminiLiveUsage(usageTelemetryRef.current, parsed.usage);
              }
              break;

            case "turn_complete":
            case "generation_complete": {
              const assistantTranscript = currentOutputTranscript.current.trim();
              const assistantTextFallback = currentTextRef.current.trim();
              if (assistantTranscript || assistantTextFallback) {
                finalizeVoiceOutput(assistantTranscript, assistantTextFallback);
              }
              currentInputTranscript.current = "";
              currentOutputTranscript.current = "";
              currentTextRef.current = "";
              currentVoiceTurnHadNativeToolCallRef.current = false;
              lastUserTextRef.current = "";
              pendingUserIndexRef.current = null;
              pendingAssistantIndexRef.current = null;
              if (ws.readyState === WebSocket.OPEN) {
                setState("listening");
              }
              break;
            }

            case "interrupted":
              // Clear the playback ring buffer and in-flight transcript accumulation
              playbackNode.port.postMessage("clear");
              currentTextRef.current = "";
              currentOutputTranscript.current = "";
              geminiAssistantPlaybackUntilRef.current = 0;
              currentVoiceTurnHadNativeToolCallRef.current = false;
              pendingAssistantIndexRef.current = null;
              setState("listening");
              break;

            case "error":
              setError(parsed.message);
              setState("error");
              break;
          }
        }
      };

      ws.onerror = () => {
        if (!isCurrentSession()) return;
        setError("WebSocket connection failed");
        setState("error");
      };

      ws.onclose = () => {
        if (!isCurrentSession()) return;
        void persistSessionArtifacts();
        setAudioInputLevel(0);
        setIsUserSpeaking(false);
        setState((prev) => prev === "error" ? prev : "idle");
      };

      setState("connected");
    } catch (err) {
      if (!isCurrentSession()) {
        return;
      }
      const msg = err instanceof Error ? err.message : "Connection failed";
      teardownSessionResources({ persist: false, nextState: null });
      setError(msg);
      setAudioInputLevel(0);
      setIsUserSpeaking(false);
      setState("error");
    }
  }, [bindingRequest, executeNativeFunctionCall, executeOpenAiFunctionCalls, finalizeVoiceOutput, input?.voiceProvider, maybeAutoApprovePendingToolIntent, persistSessionArtifacts, teardownSessionResources, updateTranscript]);

  const disconnect = useCallback(() => {
    sessionGenerationRef.current += 1;
    teardownSessionResources({ persist: true, nextState: "idle" });
  }, [teardownSessionResources]);

  const toggleMic = useCallback(() => {
    setIsMicMuted((prev) => {
      const next = !prev;
      const stream = streamRef.current;
      if (stream) {
        for (const track of stream.getAudioTracks()) {
          track.enabled = !next;
        }
      }
      return next;
    });
  }, []);

  const registerAudioTap = useCallback((tap: AudioTap) => {
    audioTapsRef.current.add(tap);
    return () => {
      audioTapsRef.current.delete(tap);
    };
  }, []);

  const sendText = useCallback(
    (text: string) => {
      const dc = openAiDataChannelRef.current;
      if (dc && dc.readyState === "open") {
        dc.send(JSON.stringify(buildOpenAiTextMessage(text)));
        dc.send(JSON.stringify(buildOpenAiResponseCreate()));
        lastUserTextRef.current = text;
        maybeAutoApprovePendingToolIntent(text);
        updateTranscript((prev) => [
          ...prev,
          { role: "user", text, timestamp: Date.now() },
        ]);
        return;
      }

      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      wsRef.current.send(JSON.stringify(buildTextMessage(text)));
      lastUserTextRef.current = text;
      maybeAutoApprovePendingToolIntent(text);
      updateTranscript((prev) => [
        ...prev,
        { role: "user", text, timestamp: Date.now() },
      ]);
    },
    [maybeAutoApprovePendingToolIntent, updateTranscript]
  );

  return {
    state,
    transcript,
    intents,
    toolEvents,
    binding,
    error,
    isSetupRequired,
    audioInputLevel,
    isUserSpeaking,
    isMicMuted,
    connect,
    disconnect,
    toggleMic,
    sendText,
    registerAudioTap,
    talkActivity: {
      isTalking: state === "speaking",
    },
    acknowledgeIntent: setIntentStatus,
    persistSessionArtifacts,
  };
}
