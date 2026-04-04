export type HenryRenderSourceKind =
  | "html-video-element"
  | "canvas-element"
  | "media-stream"
  | "webrtc-track"
  | "ws-frame-source";

export type HenryRenderAttachmentOrigin =
  | "browser-local-canvas"
  | "provider-renderer"
  | "webrtc-peer"
  | "ws-frame-pipeline";

export type HenryVisualMode = "placeholder" | "face-simulated-local" | "face-provider-rendered";

export interface HenryTileRenderContract {
  current: {
    sourceKind: "placeholder" | HenryRenderSourceKind;
    attached: boolean;
    attachedAt?: string;
    origin?: HenryRenderAttachmentOrigin;
    visualMode: HenryVisualMode;
    visualSource: "local-simulated" | "provider-rendered" | "unknown";
  };
  acceptedSourceKinds: HenryRenderSourceKind[];
  attachmentHints: {
    htmlVideoElement: "attach-src-object-or-mse";
    canvasElement: "draw-loop-or-offscreen-canvas";
    mediaStream: "assign-to-video-srcObject";
    webrtcTrack: "add-track-to-media-stream";
    wsFrameSource: "decode-frames-into-video-or-canvas";
  };
  notes: string;
}

export function attachHenryRenderSource(
  contract: HenryTileRenderContract,
  input: {
    sourceKind: HenryRenderSourceKind;
    origin: HenryRenderAttachmentOrigin;
    attachedAt?: string;
    visualMode?: Exclude<HenryVisualMode, "placeholder">;
    visualSource?: "local-simulated" | "provider-rendered" | "unknown";
  }
): HenryTileRenderContract {
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

export function detachHenryRenderSource(contract: HenryTileRenderContract): HenryTileRenderContract {
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
      id: "tim";
      webcamPreview: true;
      microphone: true;
    };
    remote: {
      id: "henry";
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
    remoteHenryTile: {
      source: "avatar-provider-slot";
      elementHint: "video-or-canvas";
      placeholderMode: true;
      renderContract: HenryTileRenderContract;
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
