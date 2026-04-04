export type VoiceRuntimeMode =
  | "idle"
  | "listening"
  | "thinking"
  | "tooling"
  | "speaking"
  | "interrupted"
  | "releasing"
  | "disconnected"
  | "error";

export interface VoiceRuntimeSnapshot {
  mode: VoiceRuntimeMode;
  changedAt: number;
  reason?: string;
  turnId: string | null;
}

export interface TurnTelemetry {
  turnId: string;
  openedAt: number;
  firstUserInputAt?: number;
  userFinalAt?: number;
  thinkingAt?: number;
  toolingAt?: number;
  speakingAt?: number;
  interruptedAt?: number;
  releasingAt?: number;
  completedAt?: number;
  status: "active" | "completed" | "interrupted" | "error";
  durationsMs: {
    listenToThink?: number;
    thinkToSpeak?: number;
    speakToComplete?: number;
    total?: number;
  };
  actionIntentIds: string[];
}

const ALLOWED_TRANSITIONS: Record<VoiceRuntimeMode, VoiceRuntimeMode[]> = {
  idle: ["listening", "disconnected", "error"],
  listening: ["thinking", "tooling", "speaking", "interrupted", "releasing", "disconnected", "error"],
  thinking: ["tooling", "speaking", "interrupted", "releasing", "listening", "disconnected", "error"],
  tooling: ["thinking", "speaking", "interrupted", "releasing", "listening", "disconnected", "error"],
  speaking: ["interrupted", "releasing", "listening", "disconnected", "error"],
  interrupted: ["releasing", "listening", "disconnected", "error"],
  releasing: ["listening", "idle", "disconnected", "error"],
  disconnected: ["idle", "listening", "error"],
  error: ["idle", "disconnected"],
};

export function canTransition(from: VoiceRuntimeMode, to: VoiceRuntimeMode): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function deriveVoiceState(mode: VoiceRuntimeMode):
  | "idle"
  | "connecting"
  | "connected"
  | "listening"
  | "speaking"
  | "error" {
  switch (mode) {
    case "idle":
      return "idle";
    case "disconnected":
      return "connected";
    case "error":
      return "error";
    case "speaking":
      return "speaking";
    case "listening":
    case "thinking":
    case "tooling":
    case "interrupted":
    case "releasing":
      return "listening";
  }
}
