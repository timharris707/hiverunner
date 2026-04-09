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

export function useVoiceSession() {
  const [state, setState] = useState<VoiceState>("idle");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSetupRequired, setIsSetupRequired] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const captureContextRef = useRef<AudioContext | null>(null);
  const playbackContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const captureNodeRef = useRef<AudioWorkletNode | null>(null);
  const playbackNodeRef = useRef<AudioWorkletNode | null>(null);
  const currentTextRef = useRef("");
  const transcriptRef = useRef<TranscriptEntry[]>([]);
  const currentInputTranscript = useRef("");
  const currentOutputTranscript = useRef("");
  const pendingUserIndexRef = useRef<number | null>(null);
  const pendingHenryIndexRef = useRef<number | null>(null);
  const lastSavedTranscriptLengthRef = useRef(0);

  // Keep transcriptRef in sync
  const updateTranscript = useCallback((updater: (prev: TranscriptEntry[]) => TranscriptEntry[]) => {
    setTranscript((prev) => {
      const next = updater(prev);
      transcriptRef.current = next;
      return next;
    });
  }, []);

  const persistTranscript = useCallback(() => {
    if (transcriptRef.current.length === 0) return;
    if (transcriptRef.current.length === lastSavedTranscriptLengthRef.current) return;

    const snapshot = [...transcriptRef.current];
    lastSavedTranscriptLengthRef.current = snapshot.length;
    fetch("/api/voice/transcript", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript: snapshot }),
    }).catch(() => {});
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

      // 3. Set up CAPTURE AudioContext + worklet (16kHz for mic)
      const captureCtx = new AudioContext({ sampleRate: 16000 });
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
        ws.send(
          JSON.stringify(
            buildSetupMessage({
              apiKey: "",
              systemInstruction: config.systemPrompt || HENRY_VOICE_SYSTEM_PROMPT,
              voiceName: config.voiceName,
            })
          )
        );
      };

      ws.onmessage = (event) => {
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
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify(buildAudioMessage(arrayBufferToBase64(e.data))));
                }
              };
              micSource.connect(captureNode);
              break;

            case "audio": {
              // Decode and stream into playback worklet ring buffer
              const float32 = base64ToFloat32(parsed.data);
              playbackNode.port.postMessage(float32.buffer, [float32.buffer]);
              setState("speaking");
              break;
            }

            case "input_transcription": {
              currentInputTranscript.current += parsed.text;
              const nextText = currentInputTranscript.current.trim();
              if (!nextText) break;
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
              const nextText = currentOutputTranscript.current.trim();
              if (!nextText) break;
              updateTranscript((prev) => {
                const next = [...prev];
                const pendingIndex = pendingHenryIndexRef.current;
                if (pendingIndex != null && next[pendingIndex]?.role === "henry") {
                  next[pendingIndex] = { ...next[pendingIndex], text: nextText };
                  return next;
                }
                pendingHenryIndexRef.current = next.length;
                next.push({ role: "henry", text: nextText, timestamp: Date.now() });
                return next;
              });
              break;
            }

            case "text":
              currentTextRef.current += parsed.text;
              break;

            case "turn_complete":
            case "generation_complete": {
              const henryTranscript = currentOutputTranscript.current.trim();
              const henryTextFallback = currentTextRef.current.trim();
              if (!henryTranscript && henryTextFallback) {
                updateTranscript((prev) => {
                  const next = [...prev];
                  const pendingIndex = pendingHenryIndexRef.current;
                  if (pendingIndex != null && next[pendingIndex]?.role === "henry") {
                    next[pendingIndex] = { ...next[pendingIndex], text: henryTextFallback };
                    return next;
                  }
                  pendingHenryIndexRef.current = next.length;
                  next.push({ role: "henry", text: henryTextFallback, timestamp: Date.now() });
                  return next;
                });
              }
              currentInputTranscript.current = "";
              currentOutputTranscript.current = "";
              currentTextRef.current = "";
              pendingUserIndexRef.current = null;
              pendingHenryIndexRef.current = null;
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
              pendingHenryIndexRef.current = null;
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
        setError("WebSocket connection failed");
        setState("error");
      };

      ws.onclose = () => {
        persistTranscript();
        setState((prev) => prev === "error" ? prev : "idle");
      };

      setState("connected");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Connection failed";
      setError(msg);
      setState("error");
    }
  }, [persistTranscript, state, updateTranscript]);

  const disconnect = useCallback(() => {
    persistTranscript();

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    if (captureNodeRef.current) {
      captureNodeRef.current.disconnect();
      captureNodeRef.current = null;
    }

    if (playbackNodeRef.current) {
      playbackNodeRef.current.disconnect();
      playbackNodeRef.current = null;
    }

    if (captureContextRef.current) {
      captureContextRef.current.close();
      captureContextRef.current = null;
    }

    if (playbackContextRef.current) {
      playbackContextRef.current.close();
      playbackContextRef.current = null;
    }

    currentTextRef.current = "";
    currentInputTranscript.current = "";
    currentOutputTranscript.current = "";
    pendingUserIndexRef.current = null;
    pendingHenryIndexRef.current = null;
    setState("idle");
  }, [persistTranscript]);

  const sendText = useCallback(
    (text: string) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      wsRef.current.send(JSON.stringify(buildTextMessage(text)));
      updateTranscript((prev) => [
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
