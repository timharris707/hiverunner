import type { LiveCallScaffold } from "@/lib/live-call-contract";

export interface VoiceSessionBootstrap {
  wsUrl: string;
  systemPrompt: string;
  voiceName: string;
  liveCall?: LiveCallScaffold;
}

export function normalizeVoiceSessionBootstrap(input: unknown): VoiceSessionBootstrap {
  const data = (input || {}) as Partial<VoiceSessionBootstrap>;
  return {
    wsUrl: String(data.wsUrl || ""),
    systemPrompt: String(data.systemPrompt || ""),
    voiceName: String(data.voiceName || "Charon"),
    liveCall: data.liveCall,
  };
}
