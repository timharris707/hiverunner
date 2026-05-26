"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Mic, MicOff, Phone, PhoneForwarded, PhoneOff, X } from "lucide-react";
import { AvatarGlyph } from "@/components/orchestration/AvatarGlyph";
import {
  getStoredVoiceProviderOverride,
  storeVoiceProviderOverride,
  useVoiceSession,
  type VoiceSessionProvider,
  type VoiceState,
} from "@/hooks/useVoiceSession";
import type { VoiceBindingRequest } from "@/lib/voice-binding";
import type { OrchestrationAgent } from "@/lib/orchestration/types";
import { getAgentByAnyId } from "@/config/agents";
import { color } from "@/lib/ui/tokens";

interface Props {
  open: boolean;
  onClose: () => void;
  agent: OrchestrationAgent | null;
  bindingRequest: VoiceBindingRequest;
  /** Human-readable labels for the session-proof comment body. */
  taskTitle?: string;
  projectName?: string;
  /** Fires after a live session transitions back to idle.
   *  The server-side persist (session-proof comment) is async; parent should
   *  refresh comments shortly after this fires. */
  onSessionEnd?: () => void;
}

function resolveAvatarUrl(agent: OrchestrationAgent): string | undefined {
  if (agent.avatar) return agent.avatar;
  const lookup = getAgentByAnyId(agent.id) ?? getAgentByAnyId(agent.name);
  return lookup?.avatar;
}

function stateLabel(state: VoiceState): { label: string; tone: "idle" | "active" | "error" } {
  switch (state) {
    case "idle": return { label: "Ready", tone: "idle" };
    case "connecting": return { label: "Connecting…", tone: "active" };
    case "connected": return { label: "Ready", tone: "active" };
    case "listening": return { label: "Listening", tone: "active" };
    case "speaking": return { label: "Speaking", tone: "active" };
    case "error": return { label: "Error", tone: "error" };
    default: return { label: state, tone: "idle" };
  }
}

const CONNECTING_PROGRESS = [
  { afterMs: 0, label: "Connecting…" },
  { afterMs: 800, label: "Warming up the line…" },
  { afterMs: 2200, label: "Almost there…" },
  { afterMs: 4500, label: "Hang tight, still dialing…" },
];

function pickConnectingLabel(elapsedMs: number): string {
  let label = CONNECTING_PROGRESS[0].label;
  for (const step of CONNECTING_PROGRESS) {
    if (elapsedMs >= step.afterMs) label = step.label;
  }
  return label;
}

const VOICE_MODAL_KEYFRAMES_ID = "task-voice-modal-keyframes";
const VOICE_MODAL_STATUS_WIDTH = 172;
const VOICE_MODAL_PROVIDER_WIDTH = 166;
const VOICE_MODAL_INPUT_WIDTH = 204;
const VOICE_MODAL_ACTION_WIDTH = 142;
const VOICE_MODAL_KEYFRAMES = `
@keyframes taskVoiceConnectingPulse {
  0%   { box-shadow: 0 0 0 0 rgba(16,185,129,0.55), 0 0 0 0 rgba(16,185,129,0.0); }
  60%  { box-shadow: 0 0 0 10px rgba(16,185,129,0.0),  0 0 0 16px rgba(16,185,129,0.0); }
  100% { box-shadow: 0 0 0 0 rgba(16,185,129,0.0),    0 0 0 0 rgba(16,185,129,0.0); }
}
@keyframes taskVoiceListeningGlow {
  0%   { box-shadow: 0 0 0 0 rgba(16,185,129,0.45); }
  50%  { box-shadow: 0 0 0 6px rgba(16,185,129,0.0); }
  100% { box-shadow: 0 0 0 0 rgba(16,185,129,0.0); }
}
`;

function ensureVoiceModalKeyframes() {
  if (typeof document === "undefined") return;
  if (document.getElementById(VOICE_MODAL_KEYFRAMES_ID)) return;
  const style = document.createElement("style");
  style.id = VOICE_MODAL_KEYFRAMES_ID;
  style.textContent = VOICE_MODAL_KEYFRAMES;
  document.head.appendChild(style);
}

function VoiceInputIndicator({
  level,
  active,
  disabled,
}: {
  level: number;
  active: boolean;
  disabled: boolean;
}) {
  const normalized = Math.max(0, Math.min(1, level));
  const bars = [0.35, 0.6, 0.95, 0.65, 0.4];
  const label = disabled ? "Mic idle" : active ? "Receiving voice" : "Mic open";

  return (
    <div
      aria-label={label}
      title={label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        flex: "0 0 auto",
        width: VOICE_MODAL_INPUT_WIDTH,
        height: 42,
        boxSizing: "border-box",
        justifyContent: "center",
        padding: "7px 10px",
        borderRadius: 8,
        border: `0.5px solid ${active ? color.borderStrong : color.border}`,
        background: active ? color.positiveSoft : color.surface,
        color: active ? color.positive : color.textSecondary,
      }}
    >
      <Mic
        size={13}
        style={{
          flexShrink: 0,
          opacity: active ? 1 : 0.72,
          transition: "opacity 120ms ease",
        }}
      />
      <div style={{ display: "inline-flex", alignItems: "center", gap: 3, width: 34, height: 16 }}>
        {bars.map((weight, index) => {
          const barLevel = active ? Math.max(0.18, Math.min(1, normalized * weight + 0.12)) : 0.16;
          return (
            <span
              key={index}
              style={{
                width: 4,
                height: `${Math.round(16 * barLevel)}px`,
                borderRadius: 999,
                background: active ? color.positive : color.textMuted,
                opacity: disabled ? 0.35 : active ? 0.9 : 0.5,
                transition: "height 80ms linear, opacity 120ms ease",
              }}
            />
          );
        })}
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>{label}</span>
    </div>
  );
}

export function TaskVoiceModal({ open, onClose, agent, bindingRequest, taskTitle, projectName, onSessionEnd }: Props) {
  const memoizedBindingRequest = useMemo(() => bindingRequest, [bindingRequest]);
  const [voiceProvider, setVoiceProvider] = useState<VoiceSessionProvider>(() => getStoredVoiceProviderOverride() ?? "gemini-live");
  const session = useVoiceSession({ bindingRequest: memoizedBindingRequest, voiceProvider });
  const { state, transcript, toolEvents, error, connect, disconnect, audioInputLevel, isUserSpeaking } = session;

  // Lock the displayed agent for the duration of an active session. If the
  // bound task is reassigned mid-call (e.g. via reassign_task voice tool), the
  // parent will pass a different `agent` prop on its next render — but the
  // user is still talking to whoever picked up the call. Showing a different
  // avatar/name mid-conversation is misleading. Snapshot at call start; drop
  // the snapshot when the session goes idle so the next call shows current.
  const isSessionActive = state !== "idle" && state !== "error";
  const [activeAgentSnapshot, setActiveAgentSnapshot] = useState<OrchestrationAgent | null>(null);
  const displayAgent = isSessionActive ? (activeAgentSnapshot ?? agent) : agent;

  const transcriptRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef(session);
  const wasActiveRef = useRef(false);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  // Fire onSessionEnd when the session transitions from active → idle.
  // Server-side persist runs async on ws.close; caller should refresh with a short delay.
  useEffect(() => {
    const active = state !== "idle" && state !== "error";
    if (wasActiveRef.current && !active) {
      onSessionEnd?.();
    }
    wasActiveRef.current = active;
  }, [state, onSessionEnd]);

  const sessionActive = state !== "idle" && state !== "error";
  const baseStatusInfo = stateLabel(state);

  const handleProviderChange = useCallback((provider: VoiceSessionProvider) => {
    sessionRef.current.disconnect();
    setActiveAgentSnapshot(null);
    setVoiceProvider(provider);
    storeVoiceProviderOverride(provider);
  }, []);

  // Progressive copy during the "Connecting…" window so the user has feedback
  // while Next.js compile + Gemini setup blocks the first response.
  const [connectingElapsedMs, setConnectingElapsedMs] = useState(0);
  const connectingStartRef = useRef<number | null>(null);
  useEffect(() => {
    if (state !== "connecting") {
      connectingStartRef.current = null;
      return;
    }
    connectingStartRef.current = Date.now();
    const interval = window.setInterval(() => {
      if (connectingStartRef.current) {
        setConnectingElapsedMs(Date.now() - connectingStartRef.current);
      }
    }, 250);
    return () => window.clearInterval(interval);
  }, [state]);

  const statusInfo = state === "connecting"
    ? { ...baseStatusInfo, label: pickConnectingLabel(connectingElapsedMs) }
    : baseStatusInfo;

  // Inject keyframes once for the avatar pulse animation.
  useEffect(() => {
    if (open) ensureVoiceModalKeyframes();
  }, [open]);

  // Auto-scroll transcript to bottom as it grows.
  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [transcript]);

  // Body scroll lock while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    const prevPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
      document.body.style.paddingRight = prevPaddingRight;
    };
  }, [open]);

  // Modal-owned sessionId — same id used for start write AND end write so the
  // server UPDATES the existing comment rather than creating a duplicate.
  const modalSessionIdRef = useRef<string | null>(null);
  const sessionStartedAtRef = useRef<number | null>(null);

  const postOutcome = useCallback(
    async (opts: { durationSeconds?: number; messages?: number }) => {
      if (!modalSessionIdRef.current) return;
      if (!bindingRequest?.taskId) return;
      try {
        const body: Record<string, unknown> = {
          sessionId: modalSessionIdRef.current,
          binding: {
            ...bindingRequest,
            scope: "task",
            ...(taskTitle ? { taskTitle } : {}),
            ...(displayAgent?.name ? { agentName: displayAgent.name } : {}),
            ...(projectName ? { projectName } : {}),
          },
          acceptedMarkers: [],
        };
        if (typeof opts.durationSeconds === "number" && typeof opts.messages === "number") {
          body.transcript = {
            filePath: `modal://${modalSessionIdRef.current}`,
            filename: `${modalSessionIdRef.current}.md`,
            relativePath: `${modalSessionIdRef.current}.md`,
            rollupPath: `modal://${modalSessionIdRef.current}/rollup`,
            rollupRelativePath: "ROLLUP.md",
            workspaceRoot: "modal",
            workspaceKind: "company" as const,
            durationSeconds: opts.durationSeconds,
            messages: opts.messages,
          };
        } else {
          body.transcript = null;
        }
        await fetch("/api/voice/outcome", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          keepalive: true,
          body: JSON.stringify(body),
        });
      } catch {}
    },
    [bindingRequest, taskTitle, projectName, displayAgent],
  );

  // Escape key closes; closing always disconnects if live, then posts the final
  // outcome body with duration + message count.
  const handleClose = useCallback(async () => {
    sessionRef.current.disconnect();
    await new Promise((r) => setTimeout(r, 200));
    try {
      await sessionRef.current.persistSessionArtifacts();
    } catch {}

    if (modalSessionIdRef.current) {
      const currentTranscript = sessionRef.current.transcript;
      const messages = currentTranscript.length;
      const durationSeconds = sessionStartedAtRef.current
        ? Math.max(0, Math.round((Date.now() - sessionStartedAtRef.current) / 1000))
        : 0;
      await postOutcome({ durationSeconds, messages });
      // Trigger a second parent refresh so Comments/Activity reflect the
      // final-body UPDATE (duration + messages), not the initial placeholder.
      onSessionEnd?.();
    }

    modalSessionIdRef.current = null;
    sessionStartedAtRef.current = null;
    onClose();
  }, [onClose, postOutcome, onSessionEnd]);

  // Start Call: create a session-proof comment immediately. Same modal-owned
  // sessionId is reused on close to update the comment body with final stats.
  const handleStartCall = useCallback(async () => {
    sessionRef.current.disconnect();
    setActiveAgentSnapshot(agent);
    setConnectingElapsedMs(0);
    modalSessionIdRef.current = `modal-${Date.now()}`;
    sessionStartedAtRef.current = Date.now();
    await postOutcome({});
    connect();
  }, [agent, connect, postOutcome]);

  // Mid-call reassignment detection: `agent` (parent prop) reflects the live
  // DB assignee; `activeAgentSnapshot` is frozen at call start. If they
  // diverge while a session is active, a reassign happened during this call
  // (only reassign_task can cause that during an active session, since the
  // snapshot otherwise locks). Offer a real transfer: end the current
  // session and open a fresh one bound to the same task — the snapshot
  // clears on idle and the new session picks up the new assignee's persona
  // and voice.
  const pendingTransferTarget =
    sessionActive &&
    agent &&
    activeAgentSnapshot &&
    agent.id !== activeAgentSnapshot.id
      ? agent
      : null;

  const handleTransfer = useCallback(async () => {
    const stateNow = sessionRef.current.state;
    const isLive = stateNow !== "idle" && stateNow !== "error";

    if (isLive) {
      sessionRef.current.disconnect();
      await new Promise((r) => setTimeout(r, 200));
      try {
        await sessionRef.current.persistSessionArtifacts();
      } catch {}
    }

    if (modalSessionIdRef.current) {
      const currentTranscript = sessionRef.current.transcript;
      const messages = currentTranscript.length;
      const durationSeconds = sessionStartedAtRef.current
        ? Math.max(0, Math.round((Date.now() - sessionStartedAtRef.current) / 1000))
        : 0;
      await postOutcome({ durationSeconds, messages });
      onSessionEnd?.();
    }

    modalSessionIdRef.current = null;
    sessionStartedAtRef.current = null;

    // Brief beat so the snapshot clears (via the effect on isSessionActive)
    // and the new binding has a frame to settle before we reconnect.
    await new Promise((r) => setTimeout(r, 120));
    await handleStartCall();
  }, [postOutcome, onSessionEnd, handleStartCall]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, handleClose]);

  // When the modal unmounts while a session is live, stop it.
  useEffect(() => {
    return () => {
      sessionRef.current.disconnect();
    };
  }, []);

  if (!open || !displayAgent) return null;

  const avatarUrl = resolveAvatarUrl(displayAgent);
  const completedToolEvents = toolEvents.filter((event) => event.type === "completed");

  const statusColor =
    statusInfo.tone === "error" ? color.negative :
    statusInfo.tone === "active" ? color.positive :
    color.textMuted;

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "20px",
        background: "var(--modal-backdrop)",
        backdropFilter: "blur(12px)",
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Talk to ${displayAgent.name}`}
        style={{
          width: "min(100%, 780px)",
          maxWidth: "calc(100vw - 40px)",
          borderRadius: "12px",
          border: `0.5px solid ${color.borderStrong}`,
          background: color.surfaceElevated,
          boxShadow: "var(--shadow-glass)",
          overflow: "hidden",
          display: "flex", flexDirection: "column",
          maxHeight: "86vh",
        }}
      >
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 20px",
          borderBottom: `0.5px solid ${color.border}`,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div
              style={{
                width: 42, height: 42, borderRadius: "50%",
                flexShrink: 0,
                animation:
                  state === "connecting"
                    ? "taskVoiceConnectingPulse 1.4s ease-out infinite"
                    : state === "listening"
                      ? "taskVoiceListeningGlow 2.2s ease-out infinite"
                      : undefined,
              }}
            >
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatarUrl}
                  alt={displayAgent.name}
                  style={{ width: 42, height: 42, borderRadius: "50%", objectFit: "cover", display: "block" }}
                />
              ) : (
                <AvatarGlyph value={displayAgent.emoji} size={42} />
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
              <div style={{ fontSize: "16px", fontWeight: 600, color: color.text }}>{displayAgent.name}</div>
              {displayAgent.role && (
                <div style={{ fontSize: "12px", color: color.textSecondary }}>{displayAgent.role}</div>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            style={{
              width: "32px", height: "32px", borderRadius: "8px",
              border: `0.5px solid ${color.border}`,
              background: "transparent", color: color.textMuted,
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Status + controls */}
        <div style={{
          display: "grid",
          gridTemplateColumns: `${VOICE_MODAL_STATUS_WIDTH}px ${VOICE_MODAL_PROVIDER_WIDTH}px ${VOICE_MODAL_INPUT_WIDTH}px ${VOICE_MODAL_ACTION_WIDTH}px`,
          justifyContent: "space-between",
          alignItems: "center",
          gap: 10,
          padding: "18px 22px",
          borderBottom: `0.5px solid ${color.border}`,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0, width: VOICE_MODAL_STATUS_WIDTH }}>
            <span style={{
              width: "10px", height: "10px", borderRadius: "50%",
              flex: "0 0 auto",
              background: statusColor,
              boxShadow: statusInfo.tone === "active" ? `0 0 8px ${statusColor}` : "none",
            }} />
            <span style={{
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontSize: "13px",
              color: color.textSecondary,
              fontWeight: 500,
            }}>
              {statusInfo.label}
            </span>
            {state === "listening" && <Mic size={14} color={color.textSecondary} />}
            {state === "idle" && <MicOff size={14} color={color.textMuted} />}
          </div>

          <div
            aria-label="Voice provider"
            style={{
              display: "inline-flex",
              alignItems: "center",
              flex: "0 0 auto",
              width: VOICE_MODAL_PROVIDER_WIDTH,
              height: 42,
              boxSizing: "border-box",
              padding: 2,
              borderRadius: 8,
              border: `0.5px solid ${color.border}`,
              background: color.surface,
              opacity: sessionActive ? 0.56 : 1,
            }}
          >
            {([
              ["gemini-live", "Gemini"],
              ["openai-realtime-2", "Realtime 2"],
            ] as const).map(([provider, label]) => {
              const selected = voiceProvider === provider;
              return (
                <button
                  key={provider}
                  type="button"
                  disabled={sessionActive}
                  onClick={() => handleProviderChange(provider)}
                  style={{
                    border: 0,
                    borderRadius: 6,
                    flex: "1 1 0",
                    height: "100%",
                    padding: "0 8px",
                    background: selected ? color.accentSoft : "transparent",
                    color: selected ? color.accent : color.textSecondary,
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: sessionActive ? "not-allowed" : "pointer",
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>

          <VoiceInputIndicator
            level={audioInputLevel}
            active={isUserSpeaking}
            disabled={!sessionActive || state === "connecting"}
          />

          {pendingTransferTarget ? (
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <button
                type="button"
                onClick={handleTransfer}
                disabled={state === "connecting"}
                aria-label={`Transfer to ${pendingTransferTarget.name}`}
                style={{
                  display: "inline-flex", alignItems: "center", gap: "8px",
                  width: VOICE_MODAL_ACTION_WIDTH,
                  height: 42,
                  boxSizing: "border-box",
                  justifyContent: "center",
                  padding: "10px 17px",
                  fontSize: "13px", fontWeight: 700,
                  whiteSpace: "nowrap",
                  background: color.warningSoft,
                  color: color.warning,
                  border: `0.5px solid ${color.borderStrong}`,
                  borderRadius: "8px",
                  cursor: state === "connecting" ? "wait" : "pointer",
                  opacity: state === "connecting" ? 0.6 : 1,
                }}
              >
                <PhoneForwarded size={14} />
                Transfer
              </button>
              <button
                type="button"
                onClick={disconnect}
                aria-label="End call without transferring"
                title="End call without transferring"
                style={{
                  display: "inline-flex", alignItems: "center",
                  width: 42,
                  height: 42,
                  boxSizing: "border-box",
                  justifyContent: "center",
                  padding: "10px 12px",
                  background: "transparent",
                  color: color.textSecondary,
                  border: `0.5px solid ${color.border}`,
                  borderRadius: "8px",
                  cursor: "pointer",
                }}
              >
                <PhoneOff size={14} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={sessionActive ? () => {
                disconnect();
                setActiveAgentSnapshot(null);
              } : handleStartCall}
              style={{
                display: "inline-flex", alignItems: "center", gap: "8px",
                width: VOICE_MODAL_ACTION_WIDTH,
                height: 42,
                boxSizing: "border-box",
                justifyContent: "center",
                padding: "10px 17px",
                fontSize: "13px", fontWeight: 700,
                whiteSpace: "nowrap",
                background: sessionActive ? color.negativeSoft : color.positiveSoft,
                color: sessionActive ? color.negative : color.positive,
                border: `0.5px solid ${color.borderStrong}`,
                borderRadius: "8px",
                cursor: "pointer",
              }}
            >
              {sessionActive ? <PhoneOff size={14} /> : <Phone size={14} />}
              {sessionActive ? "End call" : "Start call"}
            </button>
          )}
        </div>

        {/* Error banner */}
        {error && (
          <div style={{
            padding: "10px 20px",
            background: color.negativeSoft,
            borderBottom: `0.5px solid ${color.border}`,
            fontSize: "12px", color: color.negative,
          }}>
            {error}
          </div>
        )}

        {/* Transcript */}
        <div
          ref={transcriptRef}
          style={{
            flex: 1, overflowY: "auto",
            padding: "16px 20px",
            display: "flex", flexDirection: "column", gap: "10px",
            minHeight: "180px",
          }}
        >
          {transcript.length === 0 ? (
            <div style={{ margin: "auto", textAlign: "center", color: color.textMuted, fontSize: "13px" }}>
              {state === "connecting"
                ? `Connecting to ${displayAgent.name}…`
                : sessionActive
                ? `Say something — ${displayAgent.name} is listening.`
                : `Press Start call to begin talking with ${displayAgent.name}.`}
            </div>
          ) : (
            transcript.map((entry, i) => {
              const isUser = entry.role === "user";
              return (
                <div
                  key={`${entry.timestamp}-${i}`}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: isUser ? "flex-end" : "flex-start",
                  }}
                >
                  <div style={{
                    fontSize: "11px", color: color.textMuted, marginBottom: "2px",
                  }}>
                    {isUser ? "You" : displayAgent.name}
                  </div>
                  <div style={{
                    maxWidth: "85%",
                    padding: "8px 12px",
                    borderRadius: "8px",
                    border: `0.5px solid ${isUser ? color.borderStrong : color.border}`,
                    background: isUser ? color.accentSoft : color.surface,
                    color: color.text,
                    fontSize: "13px",
                    lineHeight: 1.5,
                    whiteSpace: "pre-wrap",
                  }}>
                    {entry.text}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Actions taken (if any) */}
        {completedToolEvents.length > 0 && (
          <div style={{
            padding: "10px 20px 14px",
            borderTop: `0.5px solid ${color.border}`,
            fontSize: "12px", color: color.textSecondary,
            display: "flex", flexDirection: "column", gap: "4px",
          }}>
            <div style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.08em", color: color.textMuted }}>
              Actions taken this session
            </div>
            {completedToolEvents.slice(-4).map((event) => {
              const summary =
                event.tool === "add_task_comment" ? "Posted a comment" :
                event.tool === "start_task_work" ? "Started task work" :
                event.tool === "move_task_status" ? "Changed task status" :
                event.tool === "reassign_task" ? "Reassigned the task" :
                event.tool === "set_task_priority" ? "Updated task priority" :
                event.tool === "remember" ? "Saved a memory" :
                event.tool.replace(/_/g, " ");
              return (
                <div key={event.intentId} style={{ color: color.textSecondary }}>• {summary}</div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
