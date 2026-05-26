/**
 * AvatarMode — Pipecat avatar session UI for the /voice page.
 *
 * Renders a "talking head" video panel that connects to the Pipecat backend
 * via Daily WebRTC. Supports:
 *   - Backend availability indicator
 *   - One-click session start
 *   - Video display of the assistant avatar
 *   - Session state / error display
 *   - Clean hang-up
 */

"use client";

import { useEffect, useRef } from "react";
import {
  Phone,
  PhoneOff,
  Mic,
  AlertCircle,
  Loader2,
  Video,
  VideoOff,
  Wifi,
  WifiOff,
  Zap,
} from "lucide-react";
import { useAvatarSession, type AvatarSessionState } from "@/hooks/useAvatarSession";

function stateLabel(s: AvatarSessionState): { text: string; color: string; pulse: boolean } {
  switch (s) {
    case "idle":
      return { text: "Ready", color: "#64748b", pulse: false };
    case "checking":
      return { text: "Checking backend…", color: "#f59e0b", pulse: true };
    case "available":
      return { text: "Backend online", color: "#10b981", pulse: false };
    case "unavailable":
      return { text: "Backend offline", color: "#ef4444", pulse: false };
    case "starting":
      return { text: "Starting session…", color: "#f59e0b", pulse: true };
    case "joining":
      return { text: "Joining room…", color: "#f59e0b", pulse: true };
    case "connected":
      return { text: "Connected", color: "#10b981", pulse: false };
    case "leaving":
      return { text: "Leaving…", color: "#f59e0b", pulse: true };
    case "error":
      return { text: "Error", color: "#ef4444", pulse: false };
  }
}

export function AvatarMode() {
  const { state, error, roomUrl, videoRef, checkAvailability, start, hangup } =
    useAvatarSession();
  const checkedRef = useRef(false);

  // Auto-check backend availability on mount
  useEffect(() => {
    if (!checkedRef.current) {
      checkedRef.current = true;
      void checkAvailability();
    }
  }, [checkAvailability]);

  const { text: statusText, color: statusColor, pulse } = stateLabel(state);
  const isInSession = state === "connected" || state === "joining";
  const canStart =
    state === "available" || state === "idle" || state === "error" || state === "unavailable";
  const isBusy = state === "checking" || state === "starting" || state === "joining" || state === "leaving";

  return (
    <div className="bg-zinc-900/70 border border-zinc-700/60 rounded-2xl p-4 md:p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
            <Zap size={16} className="text-amber-300" />
            Assistant Avatar Session
          </div>
          <div className="text-xs text-zinc-400 mt-1">
            Pipecat + Daily WebRTC — talking-head avatar
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Status dot */}
          <div className="flex items-center gap-1.5">
            <div className="relative">
              <div
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: statusColor }}
              />
              {pulse && (
                <div
                  className="absolute inset-0 w-2.5 h-2.5 rounded-full animate-ping"
                  style={{ backgroundColor: statusColor, opacity: 0.4 }}
                />
              )}
            </div>
            <span className="text-xs font-mono" style={{ color: statusColor }}>
              {statusText}
            </span>
          </div>
          <div className="px-2 py-1 rounded-md border border-purple-500/40 bg-purple-500/10 text-[10px] font-semibold tracking-wide text-purple-300 uppercase">
            Phase 12
          </div>
        </div>
      </div>

      {/* Video stage */}
      <div className="relative rounded-xl border border-zinc-700/50 bg-zinc-950/90 overflow-hidden min-h-[360px]">
        {/* Video element — always mounted, hidden until connected */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className={`w-full h-full min-h-[360px] object-cover transition-opacity duration-500 ${
            isInSession ? "opacity-100" : "opacity-0 absolute inset-0"
          }`}
        />

        {/* Overlay when not connected */}
        {!isInSession && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6">
            <div
              className="w-24 h-24 rounded-full border-2 flex items-center justify-center"
              style={{
                borderColor: state === "available" ? "#10b981" : "#475569",
                backgroundColor: state === "available" ? "#10b98115" : "#1e293b",
              }}
            >
              {isBusy ? (
                <Loader2 size={36} className="text-amber-400 animate-spin" />
              ) : state === "unavailable" ? (
                <WifiOff size={36} className="text-zinc-500" />
              ) : state === "available" ? (
                <Video size={36} className="text-emerald-400" />
              ) : state === "error" ? (
                <AlertCircle size={36} className="text-red-400" />
              ) : (
                <VideoOff size={36} className="text-zinc-500" />
              )}
            </div>

            <div className="text-center">
              <div className="text-sm font-medium text-zinc-200">
                {state === "available" && "Avatar backend ready — start a session"}
                {state === "unavailable" && "Avatar backend offline"}
                {state === "idle" && "Checking avatar backend…"}
                {state === "checking" && "Checking avatar backend…"}
                {state === "starting" && "Starting Pipecat session…"}
                {state === "error" && "Session error"}
                {state === "leaving" && "Disconnecting…"}
              </div>
              {error && (
                <div className="text-xs text-red-400 mt-2 max-w-sm">{error}</div>
              )}
              {state === "unavailable" && (
                <div className="text-xs text-zinc-500 mt-2">
                  Ensure Pipecat server is running on port 8108
                </div>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-3 mt-2">
              {canStart && (
                <button
                  onClick={() => void start()}
                  disabled={isBusy}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-green-600 hover:bg-green-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-medium transition-colors"
                >
                  <Phone size={16} />
                  Start Avatar Session
                </button>
              )}
              {state === "unavailable" && (
                <button
                  onClick={() => void checkAvailability()}
                  disabled={isBusy}
                  className="flex items-center gap-2 px-4 py-2 rounded-full border border-zinc-600 bg-zinc-800 text-zinc-200 hover:border-zinc-500 disabled:opacity-50 transition-colors"
                >
                  <Wifi size={14} />
                  Retry
                </button>
              )}
            </div>
          </div>
        )}

        {/* Connected overlay badges */}
        {isInSession && (
          <>
            <div className="absolute top-3 left-3 px-2.5 py-1 rounded-lg bg-black/60 border border-emerald-500/40 text-[11px] text-emerald-300 flex items-center gap-1.5 backdrop-blur-sm">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Assistant Avatar · Live
            </div>
            <div className="absolute top-3 right-3 px-2.5 py-1 rounded-lg bg-black/60 border border-zinc-600 text-[11px] text-zinc-300 flex items-center gap-1.5 backdrop-blur-sm">
              <Mic size={12} className="text-green-400" />
              Mic active
            </div>
            {roomUrl && (
              <div className="absolute bottom-3 left-3 px-2 py-1 rounded bg-black/60 text-[10px] text-zinc-500 font-mono backdrop-blur-sm">
                {roomUrl.replace("https://", "").slice(0, 50)}
              </div>
            )}
          </>
        )}
      </div>

      {/* Session controls (when connected) */}
      {isInSession && (
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={hangup}
            className="flex items-center gap-2 px-6 py-3 rounded-full bg-red-600 hover:bg-red-500 text-white font-medium transition-colors"
          >
            <PhoneOff size={18} />
            End Avatar Session
          </button>
        </div>
      )}

      {/* Footer info */}
      <div className="text-xs text-zinc-600 text-center">
        Pipecat avatar · Daily WebRTC · Deepgram STT · Cartesia TTS
        {isInSession && (
          <span className="text-emerald-400/80 ml-2">● streaming</span>
        )}
      </div>
    </div>
  );
}
