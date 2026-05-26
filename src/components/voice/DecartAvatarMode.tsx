/**
 * DecartAvatarMode — Combines Gemini Live voice with Decart Avatar Live lip sync.
 *
 * Gemini stays the voice + brain; Decart receives the audio tap and returns
 * a lip-synced video stream of the assistant portrait via WebRTC.
 */

"use client";

import { useEffect, useRef, useState } from "react";
import {
  Phone,
  PhoneOff,
  Mic,
  MicOff,
  Send,
  Video,
  VideoOff,
  AlertCircle,
  Loader2,
  Zap,
} from "lucide-react";
import { useVoiceSession, type VoiceState } from "@/hooks/useVoiceSession";
import { useDecartAvatar, type DecartAvatarState } from "@/hooks/useDecartAvatar";

function connectionBadge(label: string, ok: boolean) {
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${
        ok
          ? "border-green-500/40 bg-green-500/10 text-green-300"
          : "border-zinc-700 bg-zinc-800/60 text-zinc-500"
      }`}
    >
      {label}
    </span>
  );
}

function stateColor(s: DecartAvatarState): string {
  switch (s) {
    case "connected":
      return "#10b981";
    case "connecting":
    case "loading-config":
      return "#f59e0b";
    case "error":
      return "#ef4444";
    default:
      return "#64748b";
  }
}

export function DecartAvatarMode() {
  const {
    state: geminiState,
    isMicMuted,
    connect: connectGemini,
    disconnect: disconnectGemini,
    toggleMic,
    sendText,
    registerAudioTap,
    talkActivity,
    error: geminiError,
  } = useVoiceSession();

  const {
    connect: connectDecart,
    disconnect: disconnectDecart,
    feed,
    videoStream,
    state: decartState,
    error: decartError,
  } = useDecartAvatar();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [textInput, setTextInput] = useState("");

  const geminiConnected = !["idle", "error", "disconnected"].includes(geminiState);
  const decartConnected = decartState === "connected";

  // Attach Decart video stream to <video> element
  useEffect(() => {
    if (videoRef.current && videoStream) {
      videoRef.current.srcObject = videoStream;
    }
  }, [videoStream]);

  // Register audio tap: pipe Gemini PCM chunks to Decart
  useEffect(() => {
    if (!geminiConnected || !decartConnected) return;
    const unregister = registerAudioTap(feed);
    return unregister;
  }, [geminiConnected, decartConnected, registerAudioTap, feed]);

  async function handleConnect() {
    // Connect Decart first (takes longer), then Gemini
    await connectDecart();
    connectGemini();
  }

  function handleDisconnect() {
    disconnectGemini();
    disconnectDecart();
  }

  function handleSendText() {
    if (!textInput.trim()) return;
    sendText(textInput.trim());
    setTextInput("");
  }

  return (
    <div className="rounded-xl border border-zinc-700/70 bg-zinc-950/80 p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Video size={18} className="text-cyan-400" />
          <h3 className="text-sm font-semibold text-zinc-100">
            Decart Avatar Live
          </h3>
          <span className="text-[10px] text-zinc-500">
            Gemini voice + Decart lip sync
          </span>
        </div>
        <div className="flex items-center gap-2">
          {connectionBadge("Gemini", geminiConnected)}
          {connectionBadge("Decart", decartConnected)}
        </div>
      </div>

      {/* Video / Placeholder */}
      <div className="relative aspect-video w-full max-w-2xl mx-auto rounded-lg overflow-hidden border border-zinc-700/50 bg-black">
        {videoStream ? (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            {/* Static portrait fallback */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/avatars/voice-assistant.jpg"
              alt="Assistant"
              className="w-28 h-28 rounded-full object-cover border-2 border-zinc-700 opacity-60"
            />
            <span className="text-xs text-zinc-500">
              {decartState === "connecting" || decartState === "loading-config"
                ? "Connecting to Decart…"
                : "Connect to see the assistant speak"}
            </span>
            {(decartState === "connecting" || decartState === "loading-config") && (
              <Loader2 size={16} className="text-cyan-400 animate-spin" />
            )}
          </div>
        )}

        {/* Speaking indicator overlay */}
        {talkActivity.isTalking && videoStream && (
          <div className="absolute bottom-3 left-3 px-2 py-1 rounded bg-black/60 border border-amber-500/40 text-[10px] text-amber-300 flex items-center gap-1.5">
            <Zap size={10} />
            Assistant is speaking
          </div>
        )}
      </div>

      {/* Errors */}
      {(geminiError || decartError) && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-xs">
          <AlertCircle size={14} />
          {geminiError || decartError}
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-center justify-center gap-3">
        {!geminiConnected ? (
          <button
            onClick={handleConnect}
            className="flex items-center gap-2 px-6 py-2.5 rounded-full bg-green-600 hover:bg-green-500 text-white text-sm font-medium transition-colors"
          >
            <Phone size={16} />
            Start Session
          </button>
        ) : (
          <>
            <button
              onClick={toggleMic}
              className={`flex items-center gap-2 px-4 py-2 rounded-full border text-sm transition-colors ${
                isMicMuted
                  ? "bg-red-500/15 border-red-500/40 text-red-300"
                  : "bg-zinc-800 border-zinc-600 text-zinc-100 hover:border-zinc-500"
              }`}
            >
              {isMicMuted ? <MicOff size={14} /> : <Mic size={14} />}
              {isMicMuted ? "Unmute" : "Mute"}
            </button>
            <button
              onClick={handleDisconnect}
              className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-red-600 hover:bg-red-500 text-white text-sm font-medium transition-colors"
            >
              <PhoneOff size={14} />
              End
            </button>
          </>
        )}
      </div>

      {/* Text fallback input */}
      {geminiConnected && (
        <div className="flex items-center gap-2 max-w-lg mx-auto">
          <input
            type="text"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSendText()}
            placeholder="Type a message…"
            className="flex-1 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
          />
          <button
            onClick={handleSendText}
            disabled={!textInput.trim()}
            className="p-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 hover:text-zinc-100 disabled:opacity-40 transition-colors"
          >
            <Send size={14} />
          </button>
        </div>
      )}

      {/* Connection state detail */}
      <div className="flex items-center justify-center gap-4 text-[10px] text-zinc-600">
        <span>
          Gemini: <span style={{ color: geminiConnected ? "#10b981" : "#64748b" }}>{geminiState}</span>
        </span>
        <span>
          Decart:{" "}
          <span style={{ color: stateColor(decartState) }}>{decartState}</span>
        </span>
      </div>
    </div>
  );
}
