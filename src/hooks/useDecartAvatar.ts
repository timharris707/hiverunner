/**
 * useDecartAvatar — React hook for Decart Avatar Live lip-sync integration.
 *
 * Connects to Decart's realtime `live_avatar` model with the assistant portrait,
 * accepts PCM16 Float32Array audio chunks via feed(), and returns a
 * lip-synced video MediaStream via WebRTC.
 */

"use client";

import { useRef, useState, useCallback } from "react";

export type DecartAvatarState =
  | "idle"
  | "loading-config"
  | "connecting"
  | "connected"
  | "error"
  | "disconnected";

type ConnectionState = "connected" | "disconnected" | "failed" | string;

type RealTimeClient = {
  playAudio?: (audio: Blob) => Promise<void>;
  isConnected: () => boolean;
  disconnect: () => void;
  on(event: "connectionChange", handler: (state: ConnectionState) => void): void;
  on(event: "error", handler: (error: Error) => void): void;
};

type DecartClient = {
  realtime: {
    connect(
      room: null,
      options: {
        model: unknown;
        onRemoteStream: (stream: MediaStream) => void;
        initialState: {
          image: Blob;
          prompt: { text: string; enhance: boolean };
        };
      },
    ): Promise<RealTimeClient>;
  };
};

type DecartSdk = {
  createDecartClient(options: { apiKey: string }): DecartClient;
  models: {
    realtime(model: string): unknown;
  };
};

async function loadDecartSdk(): Promise<DecartSdk> {
  const importModule = new Function("specifier", "return import(specifier)") as (
    specifier: string,
  ) => Promise<DecartSdk>;
  return importModule("@decartai/sdk");
}

/** Minimum ms of audio to accumulate before flushing to Decart. */
const FLUSH_INTERVAL_MS = 250;
const SAMPLE_RATE = 24_000; // Gemini output is 24kHz PCM16

/**
 * Encode Float32Array PCM samples into a WAV Blob so Decart's
 * playAudio() receives a well-formed audio payload.
 */
function float32ToWavBlob(samples: Float32Array, sampleRate: number): Blob {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = samples.length * (bitsPerSample / 8);
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, "WAVE");

  // fmt sub-chunk
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data sub-chunk
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  // Convert float32 [-1,1] → int16
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

export function useDecartAvatar() {
  const [state, setState] = useState<DecartAvatarState>("idle");
  const [videoStream, setVideoStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  const clientRef = useRef<RealTimeClient | null>(null);
  const audioBufferRef = useRef<Float32Array[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const totalSamplesRef = useRef(0);

  const flushAudio = useCallback(() => {
    const client = clientRef.current;
    if (!client || !client.playAudio || !client.isConnected()) return;

    const chunks = audioBufferRef.current;
    if (chunks.length === 0) return;

    const total = totalSamplesRef.current;
    const merged = new Float32Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    audioBufferRef.current = [];
    totalSamplesRef.current = 0;

    const wav = float32ToWavBlob(merged, SAMPLE_RATE);
    client.playAudio(wav).catch(() => {
      // Non-fatal — Decart may drop frames under load
    });
  }, []);

  const feed = useCallback(
    (float32: Float32Array) => {
      audioBufferRef.current.push(float32);
      totalSamplesRef.current += float32.length;
    },
    [],
  );

  const connect = useCallback(async () => {
    if (clientRef.current) return;

    setState("loading-config");
    setError(null);

    try {
      // Fetch API key from server-side route
      const configRes = await fetch("/api/voice/decart-config");
      if (!configRes.ok) throw new Error("Failed to fetch Decart config");
      const { apiKey } = await configRes.json();
      if (!apiKey) throw new Error("DECART_API_KEY not configured");

      setState("connecting");

      const { createDecartClient, models } = await loadDecartSdk();
      const decart = createDecartClient({ apiKey });

      // Fetch the default assistant portrait for the initial state.
      const portraitRes = await fetch("/avatars/voice-assistant.jpg");
      const portraitBlob = await portraitRes.blob();

      const rtClient = await decart.realtime.connect(null, {
        model: models.realtime("live_avatar"),
        onRemoteStream: (stream: MediaStream) => {
          setVideoStream(stream);
        },
        initialState: {
          image: portraitBlob,
          prompt: { text: "Smile warmly, maintain eye contact", enhance: false },
        },
      });

      rtClient.on("connectionChange", (s: ConnectionState) => {
        if (s === "connected") setState("connected");
        else if (s === "disconnected") setState("disconnected");
        else if (s === "failed") {
          setState("error");
          setError("Decart connection failed");
        }
      });

      rtClient.on("error", (err: Error) => {
        setError(err.message ?? "Decart error");
      });

      clientRef.current = rtClient;
      setState("connected");

      // Start periodic audio flush
      flushTimerRef.current = setInterval(flushAudio, FLUSH_INTERVAL_MS);
    } catch (err: unknown) {
      setState("error");
      setError(err instanceof Error ? err.message : "Decart connection failed");
    }
  }, [flushAudio]);

  const disconnect = useCallback(() => {
    if (flushTimerRef.current) {
      clearInterval(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    audioBufferRef.current = [];
    totalSamplesRef.current = 0;

    if (clientRef.current) {
      clientRef.current.disconnect();
      clientRef.current = null;
    }
    setVideoStream(null);
    setState("disconnected");
  }, []);

  return { connect, disconnect, feed, videoStream, state, error };
}
