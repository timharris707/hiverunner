export type VoiceRuntimeProvider = "gemini-live" | "openai-realtime-2";

export interface VoiceRuntimeReadiness {
  ready: boolean;
  message?: string;
}

interface VoiceRuntimeGlobals {
  navigator?: Navigator;
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
  WebSocket?: typeof WebSocket;
  RTCPeerConnection?: typeof RTCPeerConnection;
  document?: Document;
}

export function getUnsupportedVoiceRuntimeMessage(
  provider: VoiceRuntimeProvider,
  globals: VoiceRuntimeGlobals = globalThis,
): string | null {
  if (!globals.navigator?.mediaDevices?.getUserMedia) {
    return "Voice chat needs microphone access from a secure local browser context. Open HiveRunner on localhost and allow microphone permission.";
  }

  if (provider === "openai-realtime-2") {
    if (!globals.RTCPeerConnection) {
      return "OpenAI Realtime voice needs WebRTC support in this browser. Use a current desktop browser with WebRTC enabled.";
    }

    if (!globals.document?.body) {
      return "OpenAI Realtime voice needs a browser document to attach remote audio playback.";
    }

    return null;
  }

  if (!globals.WebSocket) {
    return "Gemini Live voice needs WebSocket support in this browser.";
  }

  if (!globals.AudioContext && !globals.webkitAudioContext) {
    return "Gemini Live voice needs Web Audio support in this browser.";
  }

  return null;
}

export function getVoiceRuntimeReadiness(
  provider: VoiceRuntimeProvider,
  globals?: VoiceRuntimeGlobals,
): VoiceRuntimeReadiness {
  const message = getUnsupportedVoiceRuntimeMessage(provider, globals);
  return message ? { ready: false, message } : { ready: true };
}
