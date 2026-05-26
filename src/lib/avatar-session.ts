/**
 * avatar-session.ts
 *
 * Lean provider abstraction for the assistant avatar/video rendering layer,
 * biased for Zoom-style call sessions with local webcam + assistant video
 * presence.
 *
 * Goal: keep Gemini Live voice untouched while giving UI/server a stable shape
 * for swapping renderer backends (mock tonight, fal/Replicate/self-host later).
 */

import { randomUUID } from "crypto";
import type { LiveCallScaffold } from "@/lib/live-call-contract";

export type AvatarProviderId =
  | "mock"
  | "fal-musetalk"
  | "replicate-musetalk"
  | "selfhost-musetalk";

export type AvatarProviderStatus = "ready" | "not_configured" | "experimental";

export interface AvatarProviderDescriptor {
  id: AvatarProviderId;
  label: string;
  status: AvatarProviderStatus;
  configured: boolean;
  capabilities: {
    realtime: boolean;
    audioDriven: boolean;
    returnsVideoStream: boolean;
    returnsPreviewClip: boolean;
  };
  notes?: string;
}

export type CallTransportKind = "webrtc" | "websocket" | "http";

export interface AvatarSessionInitInput {
  provider?: AvatarProviderId;
  voiceSessionId?: string;
  persona?: string;
  callSessionId?: string;
  preferredTransport?: CallTransportKind;
}

export interface AvatarSessionInitResult {
  sessionId: string;
  createdAt: string;
  provider: AvatarProviderDescriptor;
  mode: "mock" | "experimental";
  voiceSessionId?: string;
  callSessionId: string;
  persona: string;
  call: {
    mode: "video-call";
    participantTracks: {
      operatorWebcamExpected: true;
      assistantVideoExpected: true;
      geminiAudioExpected: true;
    };
  };
  transport: {
    kind: "mock" | "provider-webrtc" | "provider-websocket" | "provider-http";
    preferred: CallTransportKind;
    endpoint: string | null;
  };
  sync: {
    strategy: "transcript-timestamps" | "phoneme-stream";
    notes: string;
  };
  liveCall: LiveCallScaffold;
}

export function buildLiveCallScaffold(input: {
  callSessionId: string;
  avatarSessionId: string;
  voiceSessionId?: string;
}): LiveCallScaffold {
  return {
    status: "scaffold" as const,
    callSessionId: input.callSessionId,
    participantModel: {
      local: {
        id: "operator" as const,
        webcamPreview: true as const,
        microphone: true as const,
      },
      remote: {
        id: "assistant" as const,
        audio: "gemini-live" as const,
        videoTile: "avatar-render-slot" as const,
      },
    },
    media: {
      localPreview: {
        source: "browser-getUserMedia" as const,
        mirrored: true as const,
        defaultConstraints: {
          video: {
            facingMode: "user" as const,
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 24, max: 30 },
          },
          audio: true as const,
        },
      },
      remoteAssistantTile: {
        source: "avatar-provider-slot" as const,
        elementHint: "video-or-canvas" as const,
        placeholderMode: true as const,
        renderContract: {
          current: {
            sourceKind: "placeholder" as const,
            attached: false as const,
            visualMode: "placeholder" as const,
            visualSource: "unknown" as const,
          },
          acceptedSourceKinds: [
            "html-video-element",
            "canvas-element",
            "media-stream",
            "webrtc-track",
            "ws-frame-source",
          ] as const,
          attachmentHints: {
            htmlVideoElement: "attach-src-object-or-mse" as const,
            canvasElement: "draw-loop-or-offscreen-canvas" as const,
            mediaStream: "assign-to-video-srcObject" as const,
            webrtcTrack: "add-track-to-media-stream" as const,
            wsFrameSource: "decode-frames-into-video-or-canvas" as const,
          },
          notes:
            "Contract-only in scaffold mode. Local face simulation may attach now (visualSource=local-simulated). Provider-rendered face can replace it later by re-attaching the same contract with visualSource=provider-rendered.",
        },
      },
      geminiVisualInput: {
        enabledNow: false as const,
        notes:
          "Voice path is live today. Visual-input transport is contract-only until webcam frame relay is wired.",
      },
    },
    transport: {
      active: "websocket" as const,
      next: ["websocket", "webrtc"] as const,
    },
    sessionRefs: {
      voiceSessionId: input.voiceSessionId,
      avatarSessionId: input.avatarSessionId,
    },
  };
}

function hasEnv(name: string): boolean {
  return typeof process.env[name] === "string" && process.env[name]!.trim().length > 0;
}

export function getAvatarProviders(): AvatarProviderDescriptor[] {
  const falConfigured = hasEnv("FAL_KEY");
  const replicateConfigured = hasEnv("REPLICATE_API_TOKEN");
  const selfHostConfigured = hasEnv("MUSE_TALK_BASE_URL");

  return [
    {
      id: "mock",
      label: "Local Mock Renderer",
      status: "ready",
      configured: true,
      capabilities: {
        realtime: false,
        audioDriven: false,
        returnsVideoStream: false,
        returnsPreviewClip: true,
      },
      notes:
        "Deterministic local placeholder for UI/contract testing. No real lip sync yet.",
    },
    {
      id: "fal-musetalk",
      label: "fal.ai (MuseTalk-style)",
      status: falConfigured ? "experimental" : "not_configured",
      configured: falConfigured,
      capabilities: {
        realtime: false,
        audioDriven: true,
        returnsVideoStream: false,
        returnsPreviewClip: true,
      },
      notes: falConfigured
        ? "Credentials detected. Endpoint integration intentionally deferred."
        : "Set FAL_KEY to enable future fal provider wiring.",
    },
    {
      id: "replicate-musetalk",
      label: "Replicate (MuseTalk-style)",
      status: replicateConfigured ? "experimental" : "not_configured",
      configured: replicateConfigured,
      capabilities: {
        realtime: false,
        audioDriven: true,
        returnsVideoStream: false,
        returnsPreviewClip: true,
      },
      notes: replicateConfigured
        ? "Credentials detected. Model/endpoint selection still pending."
        : "Set REPLICATE_API_TOKEN to enable future Replicate wiring.",
    },
    {
      id: "selfhost-musetalk",
      label: "Self-hosted MuseTalk",
      status: selfHostConfigured ? "experimental" : "not_configured",
      configured: selfHostConfigured,
      capabilities: {
        realtime: true,
        audioDriven: true,
        returnsVideoStream: true,
        returnsPreviewClip: true,
      },
      notes: selfHostConfigured
        ? "Base URL detected. Runtime contract can be attached next."
        : "Set MUSE_TALK_BASE_URL when a self-hosted renderer is available.",
    },
  ];
}

export function resolveAvatarProvider(preferred?: string): AvatarProviderDescriptor {
  const providers = getAvatarProviders();

  const envPreferred = process.env.HIVERUNNER_AVATAR_PROVIDER?.trim();
  const selectedId = (preferred || envPreferred || "mock") as AvatarProviderId;

  return providers.find((p) => p.id === selectedId) ?? providers[0];
}

export function buildAvatarSession(input: AvatarSessionInitInput = {}): AvatarSessionInitResult {
  const provider = resolveAvatarProvider(input.provider);
  const isMock = provider.id === "mock";
  const preferred = input.preferredTransport || "websocket";
  const callSessionId = input.callSessionId || `call_${randomUUID()}`;
  const sessionId = `avatar_${randomUUID()}`;

  return {
    sessionId,
    createdAt: new Date().toISOString(),
    provider,
    mode: isMock ? "mock" : "experimental",
    voiceSessionId: input.voiceSessionId,
    callSessionId,
    persona: input.persona || "voice-assistant-v1",
    call: {
      mode: "video-call",
      participantTracks: {
        operatorWebcamExpected: true,
        assistantVideoExpected: true,
        geminiAudioExpected: true,
      },
    },
    transport: {
      kind: isMock
        ? "mock"
        : preferred === "webrtc"
          ? "provider-webrtc"
          : preferred === "websocket"
            ? "provider-websocket"
            : "provider-http",
      preferred,
      endpoint: null,
    },
    sync: {
      strategy: "transcript-timestamps",
      notes:
        "Call scaffold mode: drive avatar mouth/pose from Gemini transcript timing first; upgrade to phoneme/viseme stream over WebRTC/WS for low-latency live calls.",
    },
    liveCall: buildLiveCallScaffold({
      callSessionId,
      avatarSessionId: sessionId,
      voiceSessionId: input.voiceSessionId,
    }),
  };
}

/**
 * Small helper for voice/session responses so UI can discover avatar mode
 * without changing current voice connection behavior.
 */
export function getAvatarBootstrapConfig() {
  const selected = resolveAvatarProvider();
  return {
    enabled: true,
    selectedProvider: selected.id,
    mode: selected.id === "mock" ? "mock" : "experimental",
    discoveryEndpoint: "/api/avatar/session",
    call: {
      mode: "video-call",
      preferredTransport: "webrtc",
      supports: {
        operatorWebcamPresence: true,
        assistantVideoPresence: true,
      },
    },
  } as const;
}
