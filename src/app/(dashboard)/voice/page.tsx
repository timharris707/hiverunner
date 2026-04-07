"use client";

/**
 * Voice Henry — realtime voice conversation with Henry (Chief of Staff).
 *
 * Uses Gemini 2.0 Flash Live API for low-latency bidirectional audio streaming.
 * Supports voice input, text fallback, live transcript, and interruption.
 */

import { useState, useRef, useEffect } from "react";
import {
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  Send,
  Volume2,
  Zap,
  AlertCircle,
  Info,
} from "lucide-react";
import { useVoiceSession, type VoiceState } from "@/hooks/useVoiceSession";

// ─── Voice State Indicator ───────────────────────────────────────────────────

function StateIndicator({ state }: { state: VoiceState }) {
  const config: Record<
    VoiceState,
    { label: string; color: string; pulse: boolean }
  > = {
    idle: { label: "Ready", color: "#64748b", pulse: false },
    connecting: { label: "Connecting...", color: "#f59e0b", pulse: true },
    connected: { label: "Connected", color: "#10b981", pulse: false },
    listening: { label: "Listening", color: "#d97706", pulse: true },
    speaking: { label: "Henry is speaking", color: "#d97706", pulse: true },
    error: { label: "Error", color: "#ef4444", pulse: false },
  };

  const { label, color, pulse } = config[state];

  return (
    <div className="flex items-center gap-2">
      <div className="relative">
        <div
          className="w-3 h-3 rounded-full"
          style={{ backgroundColor: color }}
        />
        {pulse && (
          <div
            className="absolute inset-0 w-3 h-3 rounded-full animate-ping"
            style={{ backgroundColor: color, opacity: 0.4 }}
          />
        )}
      </div>
      <span className="text-sm font-mono" style={{ color }}>
        {label}
      </span>
    </div>
  );
}

// ─── Voice Visualizer (simple ring animation) ────────────────────────────────

function VoiceVisualizer({ state }: { state: VoiceState }) {
  const isActive = state === "listening" || state === "speaking";
  const color = state === "speaking" ? "#d97706" : "#d97706";

  return (
    <div className="relative flex items-center justify-center w-48 h-48 mx-auto my-8">
      {/* Outer rings */}
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="absolute rounded-full border-2 transition-all duration-500"
          style={{
            width: `${80 + i * 40}px`,
            height: `${80 + i * 40}px`,
            borderColor: isActive ? color : "#334155",
            opacity: isActive ? 0.3 - i * 0.08 : 0.1,
            transform: isActive ? `scale(${1 + i * 0.05})` : "scale(1)",
            animation: isActive
              ? `pulse ${1.5 + i * 0.3}s ease-in-out infinite`
              : "none",
          }}
        />
      ))}

      {/* Center avatar */}
      <div
        className="relative z-10 w-20 h-20 rounded-full flex items-center justify-center text-3xl border-2 transition-all duration-300"
        style={{
          backgroundColor: isActive ? `${color}22` : "#1e293b",
          borderColor: isActive ? color : "#475569",
          boxShadow: isActive ? `0 0 30px ${color}40` : "none",
        }}
      >
        <Zap size={32} style={{ color: isActive ? color : "#64748b" }} />
      </div>
    </div>
  );
}

// ─── Transcript Panel ────────────────────────────────────────────────────────

function TranscriptPanel({
  transcript,
}: {
  transcript: Array<{ role: "user" | "henry"; text: string; timestamp: number }>;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript.length]);

  if (transcript.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-zinc-500 text-sm">
        Transcript will appear here during conversation
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto space-y-3 pr-2">
      {transcript.map((entry, i) => (
        <div
          key={i}
          className={`flex ${entry.role === "user" ? "justify-end" : "justify-start"}`}
        >
          <div
            className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
              entry.role === "user"
                ? "bg-stone-800/40 text-stone-300 border border-stone-600/30"
                : "bg-stone-800/40 text-stone-300 border border-stone-600/30"
            }`}
          >
            <div className="text-xs opacity-50 mb-1">
              {entry.role === "user" ? "You" : "Henry ⚡"}
            </div>
            {entry.text}
          </div>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

// ─── Setup Guide ─────────────────────────────────────────────────────────────

function SetupGuide() {
  return (
    <div className="bg-stone-800/40 border border-stone-600/30 rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-2 text-stone-300 font-medium">
        <AlertCircle size={18} />
        Google AI API Key Required
      </div>
      <div className="text-sm text-zinc-300 space-y-2">
        <p>To use Voice Henry, you need a Google AI API key with Gemini Live access:</p>
        <ol className="list-decimal list-inside space-y-1 text-zinc-400">
          <li>
            Go to{" "}
            <span className="text-stone-300 font-mono text-xs">
              https://aistudio.google.com/apikey
            </span>
          </li>
          <li>
            Create or select an API key
          </li>
          <li>
            Add{" "}
            <code className="bg-zinc-800 px-1 py-0.5 rounded text-xs">
              GOOGLE_AI_API_KEY=your-key
            </code>{" "}
            to <code className="bg-zinc-800 px-1 py-0.5 rounded text-xs">.env.local</code>
          </li>
          <li>Restart the dev server</li>
        </ol>
        <p className="text-xs text-zinc-500 mt-2">
          Gemini 2.0 Flash Live is available on the free tier with generous rate limits.
        </p>
      </div>
    </div>
  );
}

// ─── BoardRunner Architecture Panel ──────────────────────────────────────────

function BoardRunnerArchitecture() {
  return (
    <div className="bg-zinc-900/50 border border-zinc-700/50 rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-2 text-zinc-300 font-medium">
        <Info size={18} />
        BoardRunner Realtime Mode — Architecture
      </div>
      <div className="text-xs text-zinc-400 space-y-2 font-mono">
        <div className="bg-zinc-800/50 rounded p-3 space-y-1">
          <div className="text-zinc-300 text-sm font-sans font-medium mb-2">
            Proposed Flow
          </div>
          <div>┌──────────┐ mic audio  ┌──────────────┐</div>
          <div>│ Browser  │───────────▶│ Gemini Live  │</div>
          <div>│ Voice UI │◀───────────│ (Henry voice)│</div>
          <div>└────┬─────┘ audio+text └──────┬───────┘</div>
          <div>     │ transcript               │ tool_call</div>
          <div>     ▼                          ▼</div>
          <div>┌──────────┐           ┌──────────────┐</div>
          <div>│ Advisory │◀──────────│ Agent Router  │</div>
          <div>│ Session  │  delegate │ (fan-out to   │</div>
          <div>│ (state)  │           │  board agents)│</div>
          <div>└──────────┘           └──────────────┘</div>
        </div>

        <div className="text-sm font-sans text-zinc-300 space-y-2">
          <p>
            <strong>Phase 1 (this prototype):</strong> Voice Henry — direct 1:1 voice
            conversation with Henry via Gemini Live WebSocket. Validates audio I/O,
            latency, interruption handling, and persona consistency.
          </p>
          <p>
            <strong>Phase 2 — BoardRunner integration:</strong>
          </p>
          <ul className="list-disc list-inside space-y-1 text-zinc-400 ml-2">
            <li>
              Henry as voice moderator — accepts spoken instructions, routes to advisory agents
            </li>
            <li>
              Gemini Live function calling to trigger agent responses (Atlas, Nimbus, etc.)
            </li>
            <li>
              Advisory session state syncs bidirectionally — voice transcript feeds into session events
            </li>
            <li>
              Multi-turn moderation: &quot;Henry, ask Atlas about the options flow&quot; →
              Henry delegates, reads back Atlas&apos;s response aloud
            </li>
            <li>
              Text-to-speech for non-voice agents via Gemini or browser TTS fallback
            </li>
          </ul>
          <p>
            <strong>Key findings:</strong>
          </p>
          <ul className="list-disc list-inside space-y-1 text-zinc-400 ml-2">
            <li>
              Gemini 2.0 Flash Live supports bidirectional audio streaming via WebSocket
            </li>
            <li>
              Interruption is native — client can speak over server audio, server detects and stops
            </li>
            <li>
              Audio format: PCM16 @ 16kHz input, PCM16 @ 24kHz output
            </li>
            <li>
              System instruction sets persona at connection time (no per-turn system prompts)
            </li>
            <li>
              Function calling is supported — enables tool-use patterns for agent delegation
            </li>
            <li>
              Session duration: ~15 min default, extendable. Reconnect logic needed for long sessions.
            </li>
            <li>
              Recommended architecture: browser-direct WebSocket (no server proxy needed for audio)
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function VoiceHenryPage() {
  const {
    state,
    transcript,
    error,
    isSetupRequired,
    connect,
    disconnect,
    sendText,
  } = useVoiceSession();

  const [textInput, setTextInput] = useState("");
  const [showArchitecture, setShowArchitecture] = useState(false);

  const isConnected = state !== "idle" && state !== "error";

  function handleSendText() {
    if (!textInput.trim()) return;
    sendText(textInput.trim());
    setTextInput("");
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100 flex items-center gap-2">
            <Zap className="text-stone-400" size={24} />
            Voice Henry
            <span className="text-sm font-normal text-zinc-500 ml-2">
              Gemini Live prototype
            </span>
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            Realtime voice conversation with Henry — Chief of Staff
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StateIndicator state={state} />
          <button
            onClick={() => setShowArchitecture(!showArchitecture)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-700 transition-colors"
          >
            {showArchitecture ? "Hide" : "Show"} Architecture
          </button>
        </div>
      </div>

      {/* Setup guide if needed */}
      {isSetupRequired && <SetupGuide />}

      {/* Architecture panel */}
      {showArchitecture && <BoardRunnerArchitecture />}

      {/* Main voice interface */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Voice controls */}
        <div className="bg-zinc-900/50 border border-zinc-700/50 rounded-lg p-6 flex flex-col items-center">
          <VoiceVisualizer state={state} />

          {/* Connect/disconnect button */}
          <div className="flex items-center gap-4 mt-4">
            {!isConnected ? (
              <button
                onClick={connect}
                disabled={state === "connecting"}
                className="flex items-center gap-2 px-6 py-3 rounded-full bg-green-600 hover:bg-green-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-medium transition-colors"
              >
                <Phone size={18} />
                {state === "connecting" ? "Connecting..." : "Start Voice Session"}
              </button>
            ) : (
              <button
                onClick={disconnect}
                className="flex items-center gap-2 px-6 py-3 rounded-full bg-red-600 hover:bg-red-500 text-white font-medium transition-colors"
              >
                <PhoneOff size={18} />
                End Session
              </button>
            )}
          </div>

          {/* Status indicators */}
          <div className="flex items-center gap-6 mt-6 text-xs text-zinc-500">
            <div className="flex items-center gap-1.5">
              {state === "listening" ? (
                <Mic size={14} className="text-amber-400" />
              ) : (
                <MicOff size={14} />
              )}
              Mic {state === "listening" ? "active" : "off"}
            </div>
            <div className="flex items-center gap-1.5">
              <Volume2
                size={14}
                className={state === "speaking" ? "text-amber-400" : ""}
              />
              Speaker {state === "speaking" ? "active" : "standby"}
            </div>
          </div>

          {/* Text input fallback */}
          {isConnected && (
            <div className="mt-6 w-full max-w-md">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSendText()}
                  placeholder="Or type a message..."
                  className="flex-1 bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-stone-500"
                />
                <button
                  onClick={handleSendText}
                  disabled={!textInput.trim()}
                  className="px-3 py-2 rounded-lg bg-stone-600 hover:bg-stone-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white transition-colors"
                >
                  <Send size={16} />
                </button>
              </div>
            </div>
          )}

          {/* Error display */}
          {error && !isSetupRequired && (
            <div className="mt-4 text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 w-full max-w-md text-center">
              {error}
            </div>
          )}

          {/* Model info */}
          <div className="mt-6 text-xs text-zinc-600 text-center">
            Gemini 3.1 Flash Live · PCM16 @ 16kHz in / 24kHz out · WebSocket direct
          </div>
        </div>

        {/* Right: Transcript */}
        <div className="bg-zinc-900/50 border border-zinc-700/50 rounded-lg p-4 flex flex-col min-h-[400px]">
          <div className="text-sm font-medium text-zinc-400 mb-3 flex items-center gap-2">
            Live Transcript
            {transcript.length > 0 && (
              <span className="text-xs text-zinc-600">
                ({transcript.length} message{transcript.length !== 1 ? "s" : ""})
              </span>
            )}
          </div>
          <TranscriptPanel transcript={transcript} />
        </div>
      </div>

      {/* Feasibility summary */}
      <div className="bg-zinc-900/50 border border-zinc-700/50 rounded-lg p-4">
        <h3 className="text-sm font-medium text-zinc-300 mb-2">
          Feasibility Assessment
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="space-y-1">
            <div className="text-green-400 font-medium">Confirmed</div>
            <ul className="text-zinc-400 space-y-0.5">
              <li>Gemini 2.0 Flash Live model available</li>
              <li>WebSocket bidirectional audio streaming</li>
              <li>Native interruption support (VAD)</li>
              <li>System instruction for persona injection</li>
              <li>Text + audio dual output modality</li>
              <li>Function calling for tool use</li>
            </ul>
          </div>
          <div className="space-y-1">
            <div className="text-stone-300 font-medium">Requires Validation</div>
            <ul className="text-zinc-400 space-y-0.5">
              <li>GOOGLE_AI_API_KEY access (add to .env.local)</li>
              <li>AudioWorklet browser compatibility (Chrome/Edge)</li>
              <li>Latency under real network conditions</li>
              <li>Persona consistency over extended sessions</li>
              <li>Function calling for multi-agent delegation</li>
            </ul>
          </div>
          <div className="space-y-1">
            <div className="text-stone-300 font-medium">BoardRunner Path</div>
            <ul className="text-zinc-400 space-y-0.5">
              <li>Phase 1: Voice Henry (this prototype)</li>
              <li>Phase 2: Henry as voice moderator for advisory</li>
              <li>Phase 3: Multi-agent voice with agent-switching</li>
              <li>Reconnect logic for 15min+ sessions</li>
              <li>Server-side WS proxy for production auth</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
