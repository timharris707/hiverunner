"use client";

/**
 * HiveRunner Voice — realtime voice conversation with the assistant.
 *
 * Uses selectable realtime voice providers for low-latency bidirectional audio streaming.
 * Supports voice input, text fallback, bound task/project context, live
 * conversation flow, and structured voice action markers.
 */

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
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
  FolderKanban,
  ListTodo,
  UserRound,
} from "lucide-react";
import { ConversationFlow } from "@/components/voice/ConversationFlow";
import { ToolOutcomePanel } from "@/components/voice/ToolOutcomePanel";
import { useConversationFlow } from "@/hooks/useConversationFlow";
import {
  getStoredVoiceProviderOverride,
  storeVoiceProviderOverride,
  useVoiceSession,
  type VoiceSessionProvider,
  type VoiceState,
} from "@/hooks/useVoiceSession";
import {
  type ResolvedVoiceBinding,
  type VoiceBindingRequest,
} from "@/lib/voice-binding";
import type { VoiceRuntimeMode } from "@/lib/voice-runtime";
import { buildRequestedVoiceBindingFromSearchParams, resolveDisplayVoiceBinding } from "@/lib/voice-requested-binding";
import { formatVoiceBindingStatusLabel, getVoicePresenterCopy } from "@/lib/voice-ui-copy";

interface SearchParamReader {
  get(name: string): string | null;
}

function getOptionalQueryValue(searchParams: SearchParamReader, key: string): string | undefined {
  const value = searchParams.get(key);
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function buildBindingRequestFromSearchParams(searchParams: SearchParamReader): VoiceBindingRequest | undefined {
  const request: VoiceBindingRequest = {};

  const companySlug = getOptionalQueryValue(searchParams, "companySlug");
  const projectId = getOptionalQueryValue(searchParams, "projectId");
  const projectSlug = getOptionalQueryValue(searchParams, "projectSlug");
  const taskId = getOptionalQueryValue(searchParams, "taskId");
  const taskKey = getOptionalQueryValue(searchParams, "taskKey");
  const agentId = getOptionalQueryValue(searchParams, "agentId");
  const source = getOptionalQueryValue(searchParams, "source");
  const mode = getOptionalQueryValue(searchParams, "mode");

  if (companySlug) request.companySlug = companySlug;
  if (projectId) request.projectId = projectId;
  if (projectSlug) request.projectSlug = projectSlug;
  if (taskId) request.taskId = taskId;
  if (taskKey) request.taskKey = taskKey;
  if (agentId) request.agentId = agentId;
  if (source) request.source = source as VoiceBindingRequest["source"];
  if (mode) request.mode = mode as VoiceBindingRequest["mode"];

  return Object.keys(request).length > 0 ? request : undefined;
}

function formatTitleToken(value: string | undefined): string {
  if (!value) {
    return "Discuss";
  }

  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function deriveRuntimeMode(state: VoiceState): VoiceRuntimeMode {
  switch (state) {
    case "speaking":
      return "speaking";
    case "connected":
    case "listening":
      return "listening";
    case "error":
      return "error";
    case "connecting":
    case "idle":
    default:
      return "idle";
  }
}

function buildTaskLabel(binding: ResolvedVoiceBinding): string | null {
  if (binding.taskTitle && binding.taskKey) {
    return `[${binding.taskKey}] ${binding.taskTitle}`;
  }

  return binding.taskTitle ?? binding.taskKey ?? binding.taskId ?? null;
}

function buildProjectLabel(binding: ResolvedVoiceBinding): string {
  return binding.projectName ?? binding.projectSlug ?? binding.projectId ?? "Unscoped project";
}

function buildAgentFallback(binding: ResolvedVoiceBinding): string | null {
  return binding.agentName ?? binding.agentId ?? null;
}

function BoundContextCard({ binding }: { binding: ResolvedVoiceBinding }) {
  const taskLabel = buildTaskLabel(binding);
  const projectLabel = buildProjectLabel(binding);
  const agentLabel = buildAgentFallback(binding);
  const modeLabel = formatTitleToken(binding.mode);
  const scopeLabel = binding.scope === "task" ? "Task-bound session" : "Project-bound session";
  const statusLabel = formatVoiceBindingStatusLabel(binding.taskStatus);
  const companyLabel = binding.companySlug ?? "hiverunner";

  return (
    <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-amber-200">
          {scopeLabel}
        </span>
        <span className="rounded-full border border-zinc-700 bg-zinc-900/80 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-zinc-300">
          {modeLabel}
        </span>
        <span className="rounded-full border border-zinc-700/80 bg-zinc-950/80 px-2 py-1 text-[10px] font-medium text-zinc-500">
          {companyLabel}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-md border border-zinc-800 bg-zinc-950/70 p-3">
          <div className="mb-1 flex items-center gap-2 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
            <FolderKanban size={12} />
            Project
          </div>
          <div className="text-sm font-medium text-zinc-100">{projectLabel}</div>
        </div>

        {taskLabel && (
          <div className="rounded-md border border-zinc-800 bg-zinc-950/70 p-3">
            <div className="mb-1 flex items-center gap-2 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
              <ListTodo size={12} />
              Task
            </div>
            <div className="text-sm font-medium text-zinc-100">{taskLabel}</div>
            {statusLabel && (
              <div className="mt-1 text-[11px] text-zinc-500">Status: {statusLabel}</div>
            )}
          </div>
        )}

        {agentLabel && (
          <div className="rounded-md border border-zinc-800 bg-zinc-950/70 p-3">
            <div className="mb-1 flex items-center gap-2 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
              <UserRound size={12} />
              Agent
            </div>
            <div className="flex items-center gap-2">
              {binding.agentAvatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={binding.agentAvatarUrl}
                  alt={agentLabel}
                  className="h-8 w-8 rounded-full border border-zinc-700 object-cover"
                />
              ) : (
                <div className="flex h-8 w-8 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 text-[10px] font-semibold text-zinc-300">
                  {agentLabel.slice(0, 2).toUpperCase()}
                </div>
              )}
              <div className="text-sm font-medium text-zinc-100">{agentLabel}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Voice State Indicator ───────────────────────────────────────────────────

function StateIndicator({ state, speakingLabel }: { state: VoiceState; speakingLabel: string }) {
  const config: Record<
    VoiceState,
    { label: string; color: string; pulse: boolean }
  > = {
    idle: { label: "Ready", color: "var(--text-muted)", pulse: false },
    connecting: { label: "Connecting", color: "var(--accent)", pulse: true },
    connected: { label: "Connected", color: "var(--positive)", pulse: false },
    listening: { label: "Listening", color: "var(--accent)", pulse: true },
    speaking: { label: speakingLabel, color: "var(--accent)", pulse: true },
    error: { label: "Error", color: "var(--negative)", pulse: false },
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
  const color = "var(--accent)";

  return (
    <div className="relative flex items-center justify-center w-48 h-48 mx-auto my-8">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="absolute rounded-full border-2 transition-all duration-500"
          style={{
            width: `${80 + i * 40}px`,
            height: `${80 + i * 40}px`,
            borderColor: isActive ? color : "var(--border)",
            opacity: isActive ? 0.3 - i * 0.08 : 0.1,
            transform: isActive ? `scale(${1 + i * 0.05})` : "scale(1)",
            animation: isActive
              ? `pulse ${1.5 + i * 0.3}s ease-in-out infinite`
              : "none",
          }}
        />
      ))}

      <div
        className="relative z-10 w-20 h-20 rounded-full flex items-center justify-center text-3xl border-2 transition-all duration-300"
        style={{
          backgroundColor: isActive ? "var(--accent-soft)" : "var(--surface-elevated)",
          borderColor: isActive ? color : "var(--border-strong)",
          boxShadow: isActive ? "var(--shadow-cta)" : "none",
        }}
      >
        <Zap size={32} style={{ color: isActive ? color : "var(--text-muted)" }} />
      </div>
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
        <p>To use Voice Chat, you need a Google AI API key with Gemini Live access:</p>
        <ol className="list-decimal list-inside space-y-1 text-zinc-400">
          <li>
            Go to{" "}
            <span className="text-stone-300 font-mono text-xs">
              https://aistudio.google.com/apikey
            </span>
          </li>
          <li>Create or select an API key</li>
          <li>
            Add{" "}
            <code className="bg-zinc-800 px-1 py-0.5 rounded text-xs">
              GOOGLE_AI_API_KEY=***
            </code>{" "}
            to <code className="bg-zinc-800 px-1 py-0.5 rounded text-xs">.env.local</code>
          </li>
          <li>Restart the dev server</li>
        </ol>
        <p className="text-xs text-zinc-500 mt-2">
          Gemini 3.1 Flash Live is available on the free tier with generous rate limits.
        </p>
      </div>
    </div>
  );
}

// ─── Voice Architecture Panel ────────────────────────────────────────────────

function VoiceWorkflowArchitecture() {
  return (
    <div className="bg-zinc-900/50 border border-zinc-700/50 rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-2 text-zinc-300 font-medium">
        <Info size={18} />
        Voice Chat Architecture
      </div>
      <div className="text-xs text-zinc-400 space-y-2 font-mono">
        <div className="bg-zinc-800/50 rounded p-3 space-y-1">
          <div className="text-zinc-300 text-sm font-sans font-medium mb-2">
            Current Flow
          </div>
          <div>┌──────────┐ mic audio  ┌──────────────┐</div>
          <div>│ Browser  │───────────▶│ Gemini Live  │</div>
          <div>│ Voice UI │◀───────────│ (assistant)  │</div>
          <div>└────┬─────┘ audio+text └──────┬───────┘</div>
          <div>     │ transcript               │ tool_call</div>
          <div>     ▼                          ▼</div>
          <div>┌──────────┐           ┌──────────────┐</div>
          <div>│ Task     │◀──────────│ Agent Router  │</div>
          <div>│ Context  │  delegate │ (fan-out to   │</div>
          <div>│ (state)  │           │  workspace)   │</div>
          <div>└──────────┘           └──────────────┘</div>
        </div>

        <div className="text-sm font-sans text-zinc-300 space-y-2">
          <p>
            <strong>Voice Chat:</strong> Direct 1:1 voice
            conversation with the HiveRunner assistant via Gemini Live WebSocket. Validates audio I/O,
            latency, interruption handling, and persona consistency.
          </p>
          <p>
            <strong>Workspace delegation path:</strong>
          </p>
          <ul className="list-disc list-inside space-y-1 text-zinc-400 ml-2">
            <li>
              Voice moderator accepts spoken instructions and routes to workspace agents
            </li>
            <li>
              Gemini Live function calling to trigger agent responses (Atlas, Nimbus, etc.)
            </li>
            <li>
              Task context syncs bidirectionally — voice transcript feeds into workspace events
            </li>
            <li>
              Multi-turn moderation: &quot;Ask Atlas about the options flow&quot; →
              the assistant delegates and reads back Atlas&apos;s response aloud
            </li>
            <li>
              Text-to-speech for non-voice agents via Gemini or browser TTS fallback
            </li>
          </ul>
          <p>
            <strong>Key findings:</strong>
          </p>
          <ul className="list-disc list-inside space-y-1 text-zinc-400 ml-2">
            <li>Gemini 3.1 Flash Live supports bidirectional audio streaming via WebSocket</li>
            <li>Interruption is native — client can speak over server audio, server detects and stops</li>
            <li>Audio format: PCM16 @ 16kHz input, PCM16 @ 24kHz output</li>
            <li>System instruction sets persona at connection time (no per-turn system prompts)</li>
            <li>Function calling is supported — enables tool-use patterns for agent delegation</li>
            <li>Session duration: ~15 min default, extendable. Reconnect logic needed for long sessions.</li>
            <li>Recommended architecture: browser-direct WebSocket (no server proxy needed for audio)</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function VoicePage() {
  const searchParams = useSearchParams();
  const bindingRequest = useMemo(
    () => buildBindingRequestFromSearchParams(searchParams),
    [searchParams]
  );
  const requestedBinding = useMemo(
    () => buildRequestedVoiceBindingFromSearchParams(searchParams) ?? undefined,
    [searchParams]
  );
  const queryVoiceProvider = searchParams.get("voiceProvider");
  const [voiceProvider, setVoiceProvider] = useState<VoiceSessionProvider>(() => {
    if (queryVoiceProvider === "openai-realtime-2" || queryVoiceProvider === "gemini-live") {
      return queryVoiceProvider;
    }
    return getStoredVoiceProviderOverride() ?? "gemini-live";
  });

  const {
    state,
    transcript,
    intents,
    toolEvents,
    binding,
    error,
    isSetupRequired,
    connect,
    disconnect,
    sendText,
    acknowledgeIntent,
  } = useVoiceSession({ bindingRequest, voiceProvider });

  const [textInput, setTextInput] = useState("");
  const [showArchitecture, setShowArchitecture] = useState(false);

  const isConnected = state !== "idle" && state !== "error" && state !== "connecting";
  const conversationEntries = useConversationFlow(transcript, toolEvents);
  const hasInflightTool = useMemo(
    () => conversationEntries.some((entry) => entry.kind === "tool" && entry.inflight),
    [conversationEntries]
  );
  const runtimeMode = useMemo(
    () => (hasInflightTool ? "tooling" : deriveRuntimeMode(state)),
    [hasInflightTool, state]
  );
  const visibleIntents = useMemo(
    () => intents.filter((intent) => intent.name === "session.marker" || intent.name === "tool.request"),
    [intents]
  );
  const displayBinding = useMemo(
    () => resolveDisplayVoiceBinding(binding, requestedBinding),
    [binding, requestedBinding]
  );
  const presenterCopy = useMemo(() => getVoicePresenterCopy(displayBinding), [displayBinding]);

  function handleSendText() {
    if (!textInput.trim()) return;
    sendText(textInput.trim());
    setTextInput("");
  }

  function handleVoiceProviderChange(provider: VoiceSessionProvider) {
    setVoiceProvider(provider);
    storeVoiceProviderOverride(provider);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100 flex items-center gap-2">
            <Zap className="text-stone-400" size={24} />
            {presenterCopy.heading}
            <span className="text-sm font-normal text-zinc-500 ml-2">
              {voiceProvider === "openai-realtime-2" ? "OpenAI Realtime 2" : "Gemini Live"}
            </span>
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            {presenterCopy.subtitle}
          </p>
          {displayBinding ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
              <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-amber-200">
                {displayBinding.scope === "task" ? "Task session" : "Project session"}
              </span>
              <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-1">
                {formatTitleToken(displayBinding.mode)} mode
              </span>
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
              <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-1">
                Voice Chat
              </span>
              <span className="rounded-full border border-zinc-800 bg-zinc-950 px-2 py-1">
                Unbound session
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className={`inline-flex rounded-lg border border-zinc-700 bg-zinc-900 p-1 ${isConnected ? "opacity-50" : ""}`}>
            {([
              ["gemini-live", "Gemini"],
              ["openai-realtime-2", "Realtime 2"],
            ] as const).map(([provider, label]) => (
              <button
                key={provider}
                type="button"
                disabled={isConnected}
                onClick={() => handleVoiceProviderChange(provider)}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                  voiceProvider === provider
                    ? "bg-amber-500/15 text-amber-200"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <StateIndicator state={state} speakingLabel={presenterCopy.speakingLabel} />
          <button
            onClick={() => setShowArchitecture(!showArchitecture)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-700 transition-colors"
          >
            {showArchitecture ? "Hide" : "Show"} Architecture
          </button>
        </div>
      </div>

      {isSetupRequired && <SetupGuide />}
      {showArchitecture && <VoiceWorkflowArchitecture />}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-6 items-stretch">
        <div className="bg-zinc-900/50 border border-zinc-700/50 rounded-lg p-6 flex flex-col items-center">
          <VoiceVisualizer state={state} />

          <div className="flex items-center gap-4 mt-4">
            {!isConnected ? (
              <button
                onClick={connect}
                disabled={state === "connecting"}
                className="flex items-center gap-2 px-6 py-3 rounded-full bg-green-600 hover:bg-green-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-medium transition-colors"
              >
                <Phone size={18} />
                {state === "connecting" ? "Connecting" : presenterCopy.startSessionLabel}
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

          {displayBinding && (
            <div className="mt-3 text-xs text-zinc-500 text-center max-w-md leading-relaxed">
              {presenterCopy.boundSessionHint}
            </div>
          )}

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

          {isConnected && (
            <div className="mt-6 w-full max-w-md">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSendText()}
                  placeholder="Type a message"
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

          {error && !isSetupRequired && (
            <div className="mt-4 text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 w-full max-w-md text-center">
              {error}
            </div>
          )}

          <div className="mt-6 text-xs text-zinc-600 text-center">
            Gemini 3.1 Flash Live · PCM16 @ 16kHz in / 24kHz out · WebSocket direct
          </div>
        </div>

        <div className="bg-zinc-900/50 border border-zinc-700/50 rounded-lg p-4 flex flex-col gap-4 min-h-[400px] lg:max-h-[720px]">
          {displayBinding && <BoundContextCard binding={displayBinding} />}

          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-medium text-zinc-300 flex items-center gap-2">
              Conversation
              {transcript.length > 0 && (
                <span className="text-xs text-zinc-600">
                  {transcript.length} message{transcript.length !== 1 ? "s" : ""}
                </span>
              )}
            </div>
            <div className="text-[11px] text-zinc-500">
              {displayBinding ? "Bound HiveRunner context" : "Voice Chat"}
            </div>
          </div>

          <div className="min-h-[260px] flex-1 overflow-hidden rounded-lg border border-zinc-800/80 bg-zinc-950/60 p-3">
            <ConversationFlow entries={conversationEntries} runtimeMode={runtimeMode} />
          </div>

          <ToolOutcomePanel intents={visibleIntents} onAcknowledge={acknowledgeIntent} />
        </div>
      </div>

      <div className="bg-zinc-900/50 border border-zinc-700/50 rounded-lg p-4">
        <h3 className="text-sm font-medium text-zinc-300 mb-2">
          Runtime Status
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="space-y-1">
            <div className="text-green-400 font-medium">Confirmed</div>
            <ul className="text-zinc-400 space-y-0.5">
              <li>Gemini 3.1 Flash Live model available</li>
              <li>WebSocket bidirectional audio streaming</li>
              <li>Native interruption support (VAD)</li>
              <li>System instruction for persona injection</li>
              <li>Text + audio dual output modality</li>
              <li>Function calling for tool use</li>
            </ul>
          </div>
          <div className="space-y-1">
            <div className="text-stone-300 font-medium">Next Hardening</div>
            <ul className="text-zinc-400 space-y-0.5">
              <li>GOOGLE_AI_API_KEY access (add to .env.local)</li>
              <li>AudioWorklet browser compatibility (Chrome/Edge)</li>
              <li>Latency under real network conditions</li>
              <li>Persona consistency over extended sessions</li>
              <li>Function calling for multi-agent delegation</li>
            </ul>
          </div>
          <div className="space-y-1">
            <div className="text-stone-300 font-medium">Workspace Path</div>
            <ul className="text-zinc-400 space-y-0.5">
              <li>Voice Chat with the HiveRunner assistant</li>
              <li>Voice moderator for workspace agents</li>
              <li>Multi-agent voice with agent-switching</li>
              <li>Reconnect logic for 15min+ sessions</li>
              <li>Server-side WS proxy for production auth</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
