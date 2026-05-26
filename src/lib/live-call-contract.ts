export type VoiceRenderSourceKind =
  | "html-video-element"
  | "canvas-element"
  | "media-stream"
  | "webrtc-track"
  | "ws-frame-source";

export type VoiceRenderAttachmentOrigin =
  | "browser-local-canvas"
  | "provider-renderer"
  | "webrtc-peer"
  | "ws-frame-pipeline";

export type VoiceVisualMode = "placeholder" | "face-simulated-local" | "face-provider-rendered";

export interface VoiceTileRenderContract {
  current: {
    sourceKind: "placeholder" | VoiceRenderSourceKind;
    attached: boolean;
    attachedAt?: string;
    origin?: VoiceRenderAttachmentOrigin;
    visualMode: VoiceVisualMode;
    visualSource: "local-simulated" | "provider-rendered" | "unknown";
  };
  acceptedSourceKinds: VoiceRenderSourceKind[];
  attachmentHints: {
    htmlVideoElement: "attach-src-object-or-mse";
    canvasElement: "draw-loop-or-offscreen-canvas";
    mediaStream: "assign-to-video-srcObject";
    webrtcTrack: "add-track-to-media-stream";
    wsFrameSource: "decode-frames-into-video-or-canvas";
  };
  notes: string;
}

export function attachVoiceRenderSource(
  contract: VoiceTileRenderContract,
  input: {
    sourceKind: VoiceRenderSourceKind;
    origin: VoiceRenderAttachmentOrigin;
    attachedAt?: string;
    visualMode?: Exclude<VoiceVisualMode, "placeholder">;
    visualSource?: "local-simulated" | "provider-rendered" | "unknown";
  }
): VoiceTileRenderContract {
  return {
    ...contract,
    current: {
      ...contract.current,
      sourceKind: input.sourceKind,
      attached: true,
      origin: input.origin,
      attachedAt: input.attachedAt || new Date().toISOString(),
      visualMode: input.visualMode || contract.current.visualMode,
      visualSource: input.visualSource || contract.current.visualSource,
    },
  };
}

export function detachVoiceRenderSource(contract: VoiceTileRenderContract): VoiceTileRenderContract {
  return {
    ...contract,
    current: {
      sourceKind: "placeholder",
      attached: false,
      visualMode: "placeholder",
      visualSource: "unknown",
    },
  };
}

export interface LiveCallScaffold {
  status: "scaffold";
  callSessionId: string;
  participantModel: {
    local: {
      id: "operator";
      webcamPreview: true;
      microphone: true;
    };
    remote: {
      id: "assistant";
      audio: "gemini-live";
      videoTile: "avatar-render-slot";
    };
  };
  media: {
    localPreview: {
      source: "browser-getUserMedia";
      mirrored: true;
      defaultConstraints: {
        video: {
          facingMode: "user";
          width: { ideal: number };
          height: { ideal: number };
          frameRate: { ideal: number; max: number };
        };
        audio: true;
      };
    };
    remoteAssistantTile: {
      source: "avatar-provider-slot";
      elementHint: "video-or-canvas";
      placeholderMode: true;
      renderContract: VoiceTileRenderContract;
    };
    geminiVisualInput: {
      enabledNow: false;
      notes: string;
    };
  };
  transport: {
    active: "websocket";
    next: Array<"websocket" | "webrtc">;
  };
  sessionRefs: {
    voiceSessionId?: string;
    avatarSessionId: string;
  };
}
