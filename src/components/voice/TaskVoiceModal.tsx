"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Mic, MicOff, Phone, PhoneOff, X } from "lucide-react";
import { AvatarGlyph } from "@/components/orchestration/AvatarGlyph";
import { useVoiceSession, type VoiceState } from "@/hooks/useVoiceSession";
import type { VoiceBindingRequest } from "@/lib/voice-binding";
import type { OrchestrationAgent } from "@/lib/orchestration/types";
import { getAgentByAnyId } from "@/config/agents";

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
}`;

function ensureVoiceModalKeyframes() {
  if (typeof document === "undefined") return;
  if (document.getElementById(VOICE_MODAL_KEYFRAMES_ID)) return;
  const style = document.createElement("style");
  style.id = VOICE_MODAL_KEYFRAMES_ID;
  style.textContent = VOICE_MODAL_KEYFRAMES;
  document.head.appendChild(style);
}

export function TaskVoiceModal({ open, onClose, agent, bindingRequest, taskTitle, projectName, onSessionEnd }: Props) {
  const memoizedBindingRequest = useMemo(() => bindingRequest, [bindingRequest]);
  const session = useVoiceSession({ bindingRequest: memoizedBindingRequest });
  const { state, transcript, toolEvents, error, connect, disconnect } = session;

  // Lock the displayed agent for the duration of an active session. If the
  // bound task is reassigned mid-call (e.g. via reassign_task voice tool), the
  // parent will pass a different `agent` prop on its next render — but the
  // user is still talking to whoever picked up the call. Showing a different
  // avatar/name mid-conversation is misleading. Snapshot at call start; drop
  // the snapshot when the session goes idle so the next call shows current.
  const [activeAgentSnapshot, setActiveAgentSnapshot] = useState<OrchestrationAgent | null>(null);
  const isSessionActive = state !== "idle" && state !== "error";
  useEffect(() => {
    if (isSessionActive && !activeAgentSnapshot && agent) {
      setActiveAgentSnapshot(agent);
    } else if (!isSessionActive && activeAgentSnapshot) {
      setActiveAgentSnapshot(null);
    }
  }, [isSessionActive, agent, activeAgentSnapshot]);
  const displayAgent = activeAgentSnapshot ?? agent;

  const transcriptRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const wasActiveRef = useRef(false);

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

  // Progressive copy during the "Connecting…" window so the user has feedback
  // while Next.js compile + Gemini setup blocks the first response.
  const [connectingElapsedMs, setConnectingElapsedMs] = useState(0);
  const connectingStartRef = useRef<number | null>(null);
  useEffect(() => {
    if (state !== "connecting") {
      connectingStartRef.current = null;
      setConnectingElapsedMs(0);
      return;
    }
    connectingStartRef.current = Date.now();
    setConnectingElapsedMs(0);
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
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
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
    [bindingRequest, taskTitle, projectName, displayAgent?.name],
  );

  // Escape key closes; closing always disconnects if live, then posts the final
  // outcome body with duration + message count.
  const handleClose = useCallback(async () => {
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
    modalSessionIdRef.current = `modal-${Date.now()}`;
    sessionStartedAtRef.current = Date.now();
    await postOutcome({});
    connect();
  }, [connect, postOutcome]);

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
      if (sessionRef.current.state !== "idle" && sessionRef.current.state !== "error") {
        sessionRef.current.disconnect();
      }
    };
  }, []);

  if (!open || !displayAgent) return null;

  const avatarUrl = resolveAvatarUrl(displayAgent);
  const completedToolEvents = toolEvents.filter((event) => event.type === "completed");

  const statusColor =
    statusInfo.tone === "error" ? "#ef4444" :
    statusInfo.tone === "active" ? "#10b981" :
    "#78716c";

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(12,10,9,0.75)", backdropFilter: "blur(8px)",
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Talk to ${displayAgent.name}`}
        style={{
          width: "100%", maxWidth: "560px",
          borderRadius: "16px",
          border: "1px solid rgba(120,113,108,0.3)",
          background: "linear-gradient(180deg, rgba(41,37,36,0.95), rgba(20,17,15,0.98))",
          boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
          overflow: "hidden",
          display: "flex", flexDirection: "column",
          maxHeight: "86vh",
        }}
      >
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 20px",
          borderBottom: "1px solid rgba(120,113,108,0.2)",
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
              <div style={{ fontSize: "16px", fontWeight: 600, color: "#f5f5f4" }}>{displayAgent.name}</div>
              {displayAgent.role && (
                <div style={{ fontSize: "12px", color: "#a8a29e" }}>{displayAgent.role}</div>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            style={{
              width: "32px", height: "32px", borderRadius: "8px",
              border: "1px solid rgba(120,113,108,0.25)",
              background: "transparent", color: "#78716c",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Status + controls */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "18px 20px",
          borderBottom: "1px solid rgba(120,113,108,0.15)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{
              width: "10px", height: "10px", borderRadius: "50%",
              background: statusColor,
              boxShadow: statusInfo.tone === "active" ? `0 0 8px ${statusColor}` : "none",
            }} />
            <span style={{ fontSize: "13px", color: "#d6d3d1", fontWeight: 500 }}>{statusInfo.label}</span>
            {state === "listening" && <Mic size={14} color="#a8a29e" />}
            {state === "idle" && <MicOff size={14} color="#57534e" />}
          </div>

          <button
            type="button"
            onClick={sessionActive ? disconnect : handleStartCall}
            disabled={state === "connecting"}
            style={{
              display: "inline-flex", alignItems: "center", gap: "8px",
              padding: "10px 18px",
              fontSize: "13px", fontWeight: 600,
              background: sessionActive ? "rgba(239,68,68,0.15)" : "rgba(16,185,129,0.15)",
              color: sessionActive ? "#fca5a5" : "#6ee7b7",
              border: `1px solid ${sessionActive ? "rgba(239,68,68,0.4)" : "rgba(16,185,129,0.4)"}`,
              borderRadius: "8px",
              cursor: state === "connecting" ? "wait" : "pointer",
              opacity: state === "connecting" ? 0.6 : 1,
            }}
          >
            {sessionActive ? <PhoneOff size={14} /> : <Phone size={14} />}
            {sessionActive ? "End call" : "Start call"}
          </button>
        </div>

        {/* Error banner */}
        {error && (
          <div style={{
            padding: "10px 20px",
            background: "rgba(239,68,68,0.08)",
            borderBottom: "1px solid rgba(239,68,68,0.25)",
            fontSize: "12px", color: "#fca5a5",
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
            <div style={{ margin: "auto", textAlign: "center", color: "#78716c", fontSize: "13px" }}>
              {sessionActive
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
                    fontSize: "11px", color: "#78716c", marginBottom: "2px",
                  }}>
                    {isUser ? "You" : displayAgent.name}
                  </div>
                  <div style={{
                    maxWidth: "85%",
                    padding: "8px 12px",
                    borderRadius: "12px",
                    background: isUser ? "rgba(217,119,6,0.12)" : "rgba(120,113,108,0.12)",
                    color: "#e7e5e4",
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
            borderTop: "1px solid rgba(120,113,108,0.15)",
            fontSize: "12px", color: "#a8a29e",
            display: "flex", flexDirection: "column", gap: "4px",
          }}>
            <div style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.08em", color: "#78716c" }}>
              Actions taken this session
            </div>
            {completedToolEvents.slice(-4).map((event) => {
              const summary =
                event.tool === "add_task_comment" ? "Posted a comment" :
                event.tool === "move_task_status" ? "Changed task status" :
                event.tool === "reassign_task" ? "Reassigned the task" :
                event.tool === "set_task_priority" ? "Updated task priority" :
                event.tool === "remember" ? "Saved a memory" :
                event.tool.replace(/_/g, " ");
              return (
                <div key={event.intentId} style={{ color: "#d6d3d1" }}>• {summary}</div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
