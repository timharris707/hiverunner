/**
 * useVoiceSession — React hook for managing a Gemini Live voice session.
 *
 * Handles:
 *   - WebSocket lifecycle (connect, setup, disconnect)
 *   - Mic capture via AudioWorklet (PCM16 @ 16kHz)
 *   - Audio playback via AudioContext
 *   - Transcript accumulation
 *   - Connection state management
 */

"use client";

import { useRef, useState, useCallback } from "react";
import {
  buildSetupMessage,
  buildAudioMessage,
  buildTextMessage,
  parseServerMessage,
  HENRY_VOICE_SYSTEM_PROMPT,
} from "@/lib/gemini-live";

export type VoiceState =
  | "idle"
  | "connecting"
  | "connected"
  | "listening"
  | "speaking"
  | "error";

export interface TranscriptEntry {
  role: "user" | "henry";
  text: string;
  timestamp: number;
}

interface SessionConfig {
  wsUrl: string;
  systemPrompt: string;
  voiceName: string;
}

// AudioWorklet processor code — inlined as a blob URL
const WORKLET_CODE = `
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

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToFloat32(base64: string, sampleRate: number): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  // PCM16 → Float32
  const pcm16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(pcm16.length);
  for (let i = 0; i < pcm16.length; i++) {
    float32[i] = pcm16[i] / (pcm16[i] < 0 ? 0x8000 : 0x7fff);
  }
  // We ignore sampleRate here since AudioContext handles resampling
  void sampleRate;
  return float32;
}

export function useVoiceSession() {
  const [state, setState] = useState<VoiceState>("idle");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSetupRequired, setIsSetupRequired] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const pendingAudioRef = useRef<Float32Array[]>([]);
  const isPlayingRef = useRef(false);
  const currentTextRef = useRef("");

  const playAudioQueue = useCallback(async () => {
    if (isPlayingRef.current || pendingAudioRef.current.length === 0) return;
    isPlayingRef.current = true;
    setState("speaking");

    const ctx = audioContextRef.current;
    if (!ctx) {
      isPlayingRef.current = false;
      return;
    }

    while (pendingAudioRef.current.length > 0) {
      const chunk = pendingAudioRef.current.shift()!;
      const buffer = ctx.createBuffer(1, chunk.length, 24000); // Gemini outputs 24kHz
      buffer.getChannelData(0).set(chunk);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start();
      await new Promise<void>((resolve) => {
        source.onended = () => resolve();
      });
    }

    isPlayingRef.current = false;
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      setState("listening");
    }
  }, []);

  const connect = useCallback(async () => {
    setState("connecting");
    setError(null);
    setIsSetupRequired(false);

    try {
      // 1. Get session config from server
      const res = await fetch("/api/voice/session", { method: "POST" });
      const data = await res.json();

      if (!res.ok) {
        if (data.setup) {
          setIsSetupRequired(true);
          setError(data.error);
          setState("error");
          return;
        }
        throw new Error(data.error || "Failed to get session config");
      }

      const config: SessionConfig = data;

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
      streamRef.current = stream;

      // 3. Set up AudioContext + worklet for PCM16 capture
      const audioCtx = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioCtx;

      const blob = new Blob([WORKLET_CODE], { type: "application/javascript" });
      const workletUrl = URL.createObjectURL(blob);
      await audioCtx.audioWorklet.addModule(workletUrl);
      URL.revokeObjectURL(workletUrl);

      const source = audioCtx.createMediaStreamSource(stream);
      const workletNode = new AudioWorkletNode(audioCtx, "pcm16-processor");
      workletNodeRef.current = workletNode;

      // 4. Open WebSocket to Gemini
      const ws = new WebSocket(config.wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        // Send setup message
        ws.send(
          JSON.stringify(
            buildSetupMessage({
              apiKey: "", // not needed — already in URL
              systemInstruction: config.systemPrompt || HENRY_VOICE_SYSTEM_PROMPT,
              voiceName: config.voiceName,
            })
          )
        );
      };

      ws.onmessage = (event) => {
        const parsed = parseServerMessage(JSON.parse(event.data));

        switch (parsed.type) {
          case "setup_complete":
            setState("listening");
            // Start sending audio after setup
            workletNode.port.onmessage = (e: MessageEvent) => {
              if (ws.readyState === WebSocket.OPEN) {
                const base64 = arrayBufferToBase64(e.data);
                ws.send(JSON.stringify(buildAudioMessage(base64)));
              }
            };
            source.connect(workletNode);
            workletNode.connect(audioCtx.destination);
            break;

          case "audio":
            pendingAudioRef.current.push(
              base64ToFloat32(parsed.data, 24000)
            );
            playAudioQueue();
            break;

          case "text":
            currentTextRef.current += parsed.text;
            break;

          case "turn_complete":
            if (currentTextRef.current.trim()) {
              setTranscript((prev) => [
                ...prev,
                {
                  role: "henry",
                  text: currentTextRef.current.trim(),
                  timestamp: Date.now(),
                },
              ]);
              currentTextRef.current = "";
            }
            break;

          case "interrupted":
            // Clear pending audio on interruption
            pendingAudioRef.current = [];
            isPlayingRef.current = false;
            currentTextRef.current = "";
            setState("listening");
            break;

          case "error":
            setError(parsed.message);
            setState("error");
            break;
        }
      };

      ws.onerror = () => {
        setError("WebSocket connection failed");
        setState("error");
      };

      ws.onclose = () => {
        if (state !== "error") {
          setState("idle");
        }
      };

      setState("connected");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Connection failed";
      setError(msg);
      setState("error");
    }
  }, [playAudioQueue, state]);

  const disconnect = useCallback(() => {
    // Close WebSocket
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    // Stop mic
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    // Disconnect worklet
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }

    // Close audio context
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    pendingAudioRef.current = [];
    isPlayingRef.current = false;
    currentTextRef.current = "";
    setState("idle");
  }, []);

  const sendText = useCallback(
    (text: string) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      wsRef.current.send(JSON.stringify(buildTextMessage(text)));
      setTranscript((prev) => [
        ...prev,
        { role: "user", text, timestamp: Date.now() },
      ]);
    },
    []
  );

  return {
    state,
    transcript,
    error,
    isSetupRequired,
    connect,
    disconnect,
    sendText,
  };
}
