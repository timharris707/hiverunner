"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import {
  Users,
  Plus,
  X,
  Send,
  CheckCircle2,
  Loader2,
  AlertCircle,
  MessageSquarePlus,
  History,
  Radio,
  Trophy,
  RefreshCw,
} from "lucide-react";
import { AgentAvatar, AvatarStack } from "@/components/AgentAvatar";
import { getAgentByAnyId } from "@/config/agents";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AdvisoryEvent {
  id: string;
  timestamp: string;
  type: string;
  speaker: string;
  emoji: string;
  role: "worker" | "supervisor" | "reviewer";
  text: string;
  verdict?: string;
}

interface AdvisorySession {
  id: string;
  topic: string;
  mode: "review" | "roundtable";
  agents: string[];
  status: "active" | "completed" | "abandoned";
  createdAt: string;
  completedAt?: string;
  outcome?: string;
  reviewStyle?: string;
  model?: string;
  eventCount?: number;
  lastEvent?: AdvisoryEvent | null;
  events?: AdvisoryEvent[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const AGENTS = [
  { id: "Henry", emoji: "⚡", role: "Chief of Staff", defaultRole: "supervisor" },
  { id: "Atlas", emoji: "📈", role: "Stocks & Options Trader", defaultRole: "worker" },
  { id: "Nimbus", emoji: "🌤️", role: "Weather Prediction Trader", defaultRole: "worker" },
  { id: "Cipher", emoji: "₿", role: "Crypto Trader", defaultRole: "worker" },
  { id: "Forge", emoji: "🔧", role: "Backend Engineer", defaultRole: "worker" },
  { id: "Pixel", emoji: "💻", role: "Senior Full-Stack Engineer", defaultRole: "worker" },
  { id: "Scout", emoji: "🔭", role: "Research & Intelligence", defaultRole: "worker" },
  { id: "Quill", emoji: "✍️", role: "Creative Writer & Marketing", defaultRole: "worker" },
  { id: "Counsel", emoji: "⚖️", role: "Legal Expert", defaultRole: "reviewer" },
];

const MODELS = [
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-haiku-4-6",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getEventStyle(event: AdvisoryEvent): { bg: string; border: string; badge: string } {
  const type = event.type;
  const role = event.role;

  if (type === "start") return { bg: "rgba(139, 92, 246, 0.08)", border: "rgba(139, 92, 246, 0.3)", badge: "#8b5cf6" };
  if (type === "complete") return { bg: "rgba(74, 222, 128, 0.08)", border: "rgba(74, 222, 128, 0.3)", badge: "#4ade80" };
  if (type === "approve" || event.verdict === "approve") return { bg: "rgba(74, 222, 128, 0.06)", border: "rgba(74, 222, 128, 0.25)", badge: "#4ade80" };
  if (type === "reject" || event.verdict === "reject") return { bg: "rgba(239, 68, 68, 0.06)", border: "rgba(239, 68, 68, 0.25)", badge: "#ef4444" };

  if (role === "supervisor") return { bg: "rgba(251, 146, 60, 0.06)", border: "rgba(251, 146, 60, 0.2)", badge: "#fb923c" };
  if (role === "reviewer") return { bg: "rgba(96, 165, 250, 0.06)", border: "rgba(96, 165, 250, 0.2)", badge: "#60a5fa" };
  // worker
  return { bg: "rgba(100, 116, 139, 0.05)", border: "rgba(100, 116, 139, 0.15)", badge: "#94a3b8" };
}

function getEventIcon(type: string, verdict?: string): string {
  if (type === "start") return "🚀";
  if (type === "complete") return "🎉";
  if (type === "approve" || verdict === "approve") return "🟢";
  if (type === "reject" || verdict === "reject") return "🔴";
  if (type === "supervisor") return "🟠";
  if (type === "worker") return "🔵";
  if (type === "reviewer") return "🟡";
  return "💬";
}

function getRoleBadge(role: string, type?: string): { label: string; color: string } {
  if (type === "start" || type === "complete") return { label: "SYSTEM", color: "#8b5cf6" };
  if (role === "supervisor") return { label: "SUPERVISOR", color: "#fb923c" };
  if (role === "reviewer") return { label: "REVIEWER", color: "#60a5fa" };
  return { label: "WORKER", color: "#94a3b8" };
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function getStatusBadge(status: string): { label: string; color: string; bg: string } {
  if (status === "active") return { label: "LIVE", color: "#4ade80", bg: "rgba(74,222,128,0.12)" };
  if (status === "completed") return { label: "DONE", color: "#94a3b8", bg: "rgba(148,163,184,0.1)" };
  return { label: "ABANDONED", color: "#ef4444", bg: "rgba(239,68,68,0.1)" };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function EventBubble({ event }: { event: AdvisoryEvent }) {
  const style = getEventStyle(event);
  const icon = getEventIcon(event.type, event.verdict);
  const badge = getRoleBadge(event.role, event.type);
  const isSystem = event.type === "start" || event.type === "complete";
  const agentConfig = getAgentByAnyId(event.speaker);

  return (
    <div
      style={{
        padding: "14px 16px",
        borderRadius: "12px",
        border: `1px solid ${style.border}`,
        backgroundColor: style.bg,
        marginBottom: "12px",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px", flexWrap: "wrap" }}>
        {isSystem ? (
          <span style={{ fontSize: "16px", lineHeight: 1 }}>{icon}</span>
        ) : agentConfig ? (
          <AgentAvatar agentId={event.speaker} size={32} borderWidth={2} />
        ) : (
          <span style={{ fontSize: "16px", lineHeight: 1 }}>{event.emoji}</span>
        )}
        <span style={{ fontWeight: 700, fontSize: "13px", color: "var(--text-primary)", fontFamily: "var(--font-heading)" }}>
          {event.speaker}
        </span>
        <span
          style={{
            fontSize: "9px",
            fontWeight: 700,
            letterSpacing: "0.08em",
            color: badge.color,
            backgroundColor: `${badge.color}18`,
            border: `1px solid ${badge.color}40`,
            padding: "2px 6px",
            borderRadius: "4px",
            fontFamily: "var(--font-mono)",
          }}
        >
          {badge.label}
        </span>
        <span style={{ fontSize: "11px", color: "var(--text-muted)", marginLeft: "auto" }}>
          {formatTime(event.timestamp)}
        </span>
      </div>

      {/* Content */}
      <div
        style={{ fontSize: "13px", color: "var(--text-primary)", lineHeight: 1.6 }}
        className="advisory-markdown"
      >
        <ReactMarkdown>{event.text}</ReactMarkdown>
      </div>
    </div>
  );
}

function SessionListItem({
  session,
  active,
  onClick,
}: {
  session: AdvisorySession;
  active: boolean;
  onClick: () => void;
}) {
  const badge = getStatusBadge(session.status);

  return (
    <button
      onClick={onClick}
      style={{
        width: "100%",
        textAlign: "left",
        padding: "12px 14px",
        borderRadius: "10px",
        border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
        backgroundColor: active ? "var(--accent-soft)" : "transparent",
        cursor: "pointer",
        transition: "all 150ms ease",
        marginBottom: "6px",
        display: "block",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
        <span
          style={{
            fontSize: "9px",
            fontWeight: 700,
            letterSpacing: "0.08em",
            color: badge.color,
            backgroundColor: badge.bg,
            padding: "2px 6px",
            borderRadius: "4px",
            fontFamily: "var(--font-mono)",
          }}
        >
          {badge.label}
        </span>
        <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>
          {formatDate(session.createdAt)}
        </span>
      </div>
      <div
        style={{
          fontSize: "12px",
          fontWeight: 600,
          color: "var(--text-primary)",
          marginBottom: "6px",
          lineHeight: 1.4,
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        } as React.CSSProperties}
      >
        {session.topic}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <AvatarStack agentIds={session.agents} size={22} max={4} />
        <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>
          {session.eventCount ?? session.events?.length ?? 0} events
        </span>
      </div>
    </button>
  );
}

// ─── Launch Modal ─────────────────────────────────────────────────────────────

interface LaunchModalProps {
  onClose: () => void;
  onLaunch: (session: AdvisorySession) => void;
}

function LaunchModal({ onClose, onLaunch }: LaunchModalProps) {
  const [topic, setTopic] = useState("");
  const [mode, setMode] = useState<"review" | "roundtable">("roundtable");
  const [selectedAgents, setSelectedAgents] = useState<string[]>(["Henry"]);
  const [reviewStyle, setReviewStyle] = useState<"strict" | "flexible" | "open">("open");
  const [model, setModel] = useState("claude-opus-4-6");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const toggleAgent = (id: string) => {
    setSelectedAgents((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]
    );
  };

  const handleLaunch = async () => {
    if (!topic.trim()) { setError("Mission/Topic is required."); return; }
    if (selectedAgents.length < 1) { setError("Select at least one agent."); return; }
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/advisory/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, mode, agents: selectedAgents, reviewStyle, model }),
      });
      if (!res.ok) throw new Error("Failed to create session");
      const data = await res.json();
      onLaunch(data.session);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 200,
        padding: "20px",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          backgroundColor: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "16px",
          width: "100%",
          maxWidth: "580px",
          maxHeight: "90vh",
          overflowY: "auto",
          padding: "28px",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "24px" }}>
          <div>
            <h2 style={{ fontSize: "18px", fontWeight: 700, color: "var(--text-primary)", margin: 0, fontFamily: "var(--font-heading)" }}>
              🚀 New Advisory Session
            </h2>
            <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: "4px 0 0 0" }}>
              Launch a multi-agent collaboration
            </p>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: "4px" }}>
            <X size={20} />
          </button>
        </div>

        {/* Mission/Topic */}
        <div style={{ marginBottom: "20px" }}>
          <label style={{ display: "block", fontSize: "11px", fontWeight: 700, letterSpacing: "0.06em", color: "var(--text-muted)", marginBottom: "8px", fontFamily: "var(--font-mono)" }}>
            MISSION / TOPIC
          </label>
          <textarea
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="What should the agents collaborate on? Be specific about objectives and context..."
            rows={3}
            style={{
              width: "100%",
              padding: "10px 12px",
              backgroundColor: "var(--surface-elevated)",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              color: "var(--text-primary)",
              fontSize: "13px",
              fontFamily: "var(--font-body)",
              resize: "vertical",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
        </div>

        {/* Mode */}
        <div style={{ marginBottom: "20px" }}>
          <label style={{ display: "block", fontSize: "11px", fontWeight: 700, letterSpacing: "0.06em", color: "var(--text-muted)", marginBottom: "8px", fontFamily: "var(--font-mono)" }}>
            SESSION MODE
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
            {[
              { id: "roundtable", label: "Roundtable", desc: "Open collaborative discussion", icon: "🔄" },
              { id: "review", label: "Review Loop", desc: "Worker submits, reviewer approves", icon: "🔍" },
            ].map((m) => (
              <button
                key={m.id}
                onClick={() => setMode(m.id as "review" | "roundtable")}
                style={{
                  padding: "12px",
                  borderRadius: "8px",
                  border: `1px solid ${mode === m.id ? "var(--accent)" : "var(--border)"}`,
                  backgroundColor: mode === m.id ? "var(--accent-soft)" : "var(--surface-elevated)",
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "all 150ms ease",
                }}
              >
                <div style={{ fontSize: "16px", marginBottom: "4px" }}>{m.icon}</div>
                <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-primary)" }}>{m.label}</div>
                <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>{m.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Agents */}
        <div style={{ marginBottom: "20px" }}>
          <label style={{ display: "block", fontSize: "11px", fontWeight: 700, letterSpacing: "0.06em", color: "var(--text-muted)", marginBottom: "8px", fontFamily: "var(--font-mono)" }}>
            AGENTS ({selectedAgents.length} selected)
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px" }}>
            {AGENTS.map((agent) => {
              const sel = selectedAgents.includes(agent.id);
              return (
                <button
                  key={agent.id}
                  onClick={() => toggleAgent(agent.id)}
                  style={{
                    padding: "8px 10px",
                    borderRadius: "8px",
                    border: `1px solid ${sel ? "var(--accent)" : "var(--border)"}`,
                    backgroundColor: sel ? "var(--accent-soft)" : "var(--surface-elevated)",
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "all 150ms ease",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                  }}
                >
                  <AgentAvatar agentId={agent.id} size={28} borderWidth={2} />
                  <div>
                    <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-primary)" }}>{agent.id}</div>
                    <div style={{ fontSize: "9px", color: "var(--text-muted)", lineHeight: 1.3, marginTop: "2px" }}>{agent.role}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Review Style */}
        {mode === "review" && (
          <div style={{ marginBottom: "20px" }}>
            <label style={{ display: "block", fontSize: "11px", fontWeight: 700, letterSpacing: "0.06em", color: "var(--text-muted)", marginBottom: "8px", fontFamily: "var(--font-mono)" }}>
              REVIEW STYLE
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
              {[
                { id: "strict", label: "Strict", desc: "PASS/FAIL only" },
                { id: "flexible", label: "Flexible", desc: "Conditions allowed" },
                { id: "open", label: "Open", desc: "Free discussion" },
              ].map((s) => (
                <button
                  key={s.id}
                  onClick={() => setReviewStyle(s.id as "strict" | "flexible" | "open")}
                  style={{
                    padding: "10px",
                    borderRadius: "8px",
                    border: `1px solid ${reviewStyle === s.id ? "var(--accent)" : "var(--border)"}`,
                    backgroundColor: reviewStyle === s.id ? "var(--accent-soft)" : "var(--surface-elevated)",
                    cursor: "pointer",
                    textAlign: "center",
                    transition: "all 150ms ease",
                  }}
                >
                  <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-primary)" }}>{s.label}</div>
                  <div style={{ fontSize: "10px", color: "var(--text-muted)" }}>{s.desc}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Model */}
        <div style={{ marginBottom: "24px" }}>
          <label style={{ display: "block", fontSize: "11px", fontWeight: 700, letterSpacing: "0.06em", color: "var(--text-muted)", marginBottom: "8px", fontFamily: "var(--font-mono)" }}>
            MODEL
          </label>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            style={{
              width: "100%",
              padding: "10px 12px",
              backgroundColor: "var(--surface-elevated)",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              color: "var(--text-primary)",
              fontSize: "13px",
              fontFamily: "var(--font-mono)",
              outline: "none",
              cursor: "pointer",
            }}
          >
            {MODELS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>

        {error && (
          <div style={{ marginBottom: "16px", padding: "10px 12px", backgroundColor: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "8px", color: "#ef4444", fontSize: "12px", display: "flex", alignItems: "center", gap: "6px" }}>
            <AlertCircle size={14} />
            {error}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{ padding: "10px 20px", borderRadius: "8px", border: "1px solid var(--border)", backgroundColor: "transparent", color: "var(--text-secondary)", cursor: "pointer", fontSize: "13px", fontWeight: 500 }}
          >
            Cancel
          </button>
          <button
            onClick={handleLaunch}
            disabled={loading}
            style={{
              padding: "10px 24px",
              borderRadius: "8px",
              border: "none",
              backgroundColor: "var(--accent)",
              color: "#fff",
              cursor: loading ? "not-allowed" : "pointer",
              fontSize: "13px",
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: "8px",
              opacity: loading ? 0.7 : 1,
              fontFamily: "var(--font-heading)",
            }}
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Launch Session
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdvisoryPage() {
  const [sessions, setSessions] = useState<AdvisorySession[]>([]);
  const [activeSession, setActiveSession] = useState<AdvisorySession | null>(null);
  const [events, setEvents] = useState<AdvisoryEvent[]>([]);
  const [showLaunchModal, setShowLaunchModal] = useState(false);
  const [humanMessage, setHumanMessage] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeView, setActiveView] = useState<"live" | "history">("live");
  const eventsEndRef = useRef<HTMLDivElement>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const scrollToBottom = useCallback(() => {
    eventsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Load sessions list
  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/advisory/sessions");
      const data = await res.json();
      setSessions(data.sessions || []);
    } catch (e) {
      console.error("Failed to load sessions:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load a specific session's events
  const loadSessionEvents = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/advisory/sessions/${id}`);
      const data = await res.json();
      if (data.session) {
        setActiveSession(data.session);
        setEvents(data.session.events || []);
      }
    } catch (e) {
      console.error("Failed to load session:", e);
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // Auto-scroll when new events arrive
  useEffect(() => {
    scrollToBottom();
  }, [events, scrollToBottom]);

  // Polling for active sessions
  useEffect(() => {
    if (pollingRef.current) clearInterval(pollingRef.current);

    if (activeSession?.status === "active") {
      pollingRef.current = setInterval(async () => {
        try {
          const lastId = events.length > 0 ? events[events.length - 1].id : undefined;
          const url = lastId
            ? `/api/advisory/sessions/${activeSession.id}/events?after=${lastId}`
            : `/api/advisory/sessions/${activeSession.id}/events`;
          const res = await fetch(url);
          const data = await res.json();
          if (data.events && data.events.length > 0) {
            setEvents((prev) => [...prev, ...data.events]);
          }
        } catch (e) {
          console.error("Polling error:", e);
        }
      }, 2000);
    }

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [activeSession, events]);

  const handleSelectSession = async (session: AdvisorySession) => {
    setEvents([]);
    await loadSessionEvents(session.id);
  };

  const handleLaunch = async (session: AdvisorySession) => {
    setShowLaunchModal(false);
    await loadSessions();
    await handleSelectSession(session);
    setActiveView("live");
  };

  const handleSendMessage = async () => {
    if (!humanMessage.trim() || !activeSession) return;
    setSendingMessage(true);
    try {
      const res = await fetch(`/api/advisory/sessions/${activeSession.id}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: humanMessage }),
      });
      const data = await res.json();
      if (data.event) {
        setEvents((prev) => [...prev, data.event]);
        setHumanMessage("");
      }
    } catch (e) {
      console.error("Failed to send message:", e);
    } finally {
      setSendingMessage(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadSessions();
    if (activeSession) await loadSessionEvents(activeSession.id);
    setRefreshing(false);
  };

  const liveSessions = sessions.filter((s) => s.status === "active");
  const completedSessions = sessions.filter((s) => s.status !== "active");

  return (
    <>
      {/* Markdown styles */}
      <style>{`
        .advisory-markdown p { margin: 0 0 8px 0; }
        .advisory-markdown p:last-child { margin-bottom: 0; }
        .advisory-markdown ul { margin: 6px 0; padding-left: 20px; }
        .advisory-markdown ol { margin: 6px 0; padding-left: 20px; }
        .advisory-markdown li { margin-bottom: 3px; }
        .advisory-markdown strong { color: var(--text-primary); font-weight: 700; }
        .advisory-markdown h1, .advisory-markdown h2, .advisory-markdown h3 {
          margin: 12px 0 6px 0;
          color: var(--text-primary);
          font-family: var(--font-heading);
        }
        .advisory-markdown code {
          font-family: var(--font-mono);
          font-size: 11px;
          background: rgba(255,255,255,0.07);
          padding: 1px 5px;
          border-radius: 3px;
        }
        .advisory-markdown pre code {
          background: none;
          padding: 0;
        }
        .advisory-markdown pre {
          background: rgba(0,0,0,0.3);
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 12px;
          overflow-x: auto;
          margin: 8px 0;
        }
        .advisory-markdown hr { border-color: var(--border); margin: 12px 0; }
        .advisory-markdown blockquote {
          border-left: 3px solid var(--accent);
          padding-left: 12px;
          color: var(--text-muted);
          margin: 8px 0;
        }
      `}</style>

      <div style={{ display: "flex", height: "calc(100vh - 80px)", gap: "0", minHeight: 0 }}>

        {/* ─── LEFT SIDEBAR ──────────────────────────────── */}
        <div
          style={{
            width: "280px",
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            borderRight: "1px solid var(--border)",
            backgroundColor: "var(--surface)",
            overflow: "hidden",
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: "20px 16px 12px",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <Users size={18} color="var(--accent)" />
                <h1 style={{ fontSize: "15px", fontWeight: 700, color: "var(--text-primary)", margin: 0, fontFamily: "var(--font-heading)" }}>
                  Advisory Board
                </h1>
              </div>
              <button
                onClick={handleRefresh}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: "4px" }}
                title="Refresh"
              >
                <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
              </button>
            </div>

            <button
              onClick={() => setShowLaunchModal(true)}
              style={{
                width: "100%",
                padding: "9px",
                borderRadius: "8px",
                border: "none",
                backgroundColor: "var(--accent)",
                color: "#fff",
                cursor: "pointer",
                fontSize: "12px",
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "6px",
                fontFamily: "var(--font-heading)",
              }}
            >
              <MessageSquarePlus size={14} />
              New Session
            </button>
          </div>

          {/* View Toggle */}
          <div style={{ display: "flex", borderBottom: "1px solid var(--border)", padding: "8px 12px", gap: "4px" }}>
            {[
              { id: "live", label: "Live", icon: Radio, count: liveSessions.length },
              { id: "history", label: "History", icon: History, count: completedSessions.length },
            ].map((tab) => {
              const Icon = tab.icon;
              const active = activeView === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveView(tab.id as "live" | "history")}
                  style={{
                    flex: 1,
                    padding: "6px 8px",
                    borderRadius: "6px",
                    border: `1px solid ${active ? "var(--accent)" : "transparent"}`,
                    backgroundColor: active ? "var(--accent-soft)" : "transparent",
                    color: active ? "var(--accent)" : "var(--text-muted)",
                    cursor: "pointer",
                    fontSize: "11px",
                    fontWeight: 600,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "5px",
                    fontFamily: "var(--font-body)",
                    transition: "all 150ms ease",
                  }}
                >
                  <Icon size={11} />
                  {tab.label}
                  <span
                    style={{
                      fontSize: "9px",
                      padding: "1px 5px",
                      borderRadius: "9px",
                      backgroundColor: active ? "var(--accent)" : "var(--border)",
                      color: active ? "#fff" : "var(--text-muted)",
                    }}
                  >
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Session list */}
          <div style={{ flex: 1, overflowY: "auto", padding: "10px 12px" }}>
            {loading ? (
              <div style={{ display: "flex", justifyContent: "center", padding: "32px 0", color: "var(--text-muted)" }}>
                <Loader2 size={18} className="animate-spin" />
              </div>
            ) : (() => {
              const displaySessions = activeView === "live" ? liveSessions : completedSessions;
              if (displaySessions.length === 0) {
                return (
                  <div style={{ textAlign: "center", padding: "32px 16px", color: "var(--text-muted)" }}>
                    {activeView === "live" ? (
                      <>
                        <Radio size={24} style={{ opacity: 0.4, margin: "0 auto 8px" }} />
                        <div style={{ fontSize: "12px", marginBottom: "4px" }}>No active sessions</div>
                        <div style={{ fontSize: "11px", opacity: 0.6 }}>Launch one to get started</div>
                      </>
                    ) : (
                      <>
                        <History size={24} style={{ opacity: 0.4, margin: "0 auto 8px" }} />
                        <div style={{ fontSize: "12px" }}>No past sessions yet</div>
                      </>
                    )}
                  </div>
                );
              }
              return displaySessions.map((s) => (
                <SessionListItem
                  key={s.id}
                  session={s}
                  active={activeSession?.id === s.id}
                  onClick={() => handleSelectSession(s)}
                />
              ));
            })()}
          </div>
        </div>

        {/* ─── MAIN CONTENT ─────────────────────────────── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
          {activeSession ? (
            <>
              {/* Session header */}
              <div
                style={{
                  padding: "16px 24px",
                  borderBottom: "1px solid var(--border)",
                  backgroundColor: "var(--surface)",
                  flexShrink: 0,
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px", flexWrap: "wrap" }}>
                      {(() => {
                        const badge = getStatusBadge(activeSession.status);
                        return (
                          <span
                            style={{
                              fontSize: "9px",
                              fontWeight: 700,
                              letterSpacing: "0.08em",
                              color: badge.color,
                              backgroundColor: badge.bg,
                              padding: "2px 8px",
                              borderRadius: "4px",
                              fontFamily: "var(--font-mono)",
                              display: "flex",
                              alignItems: "center",
                              gap: "4px",
                            }}
                          >
                            {activeSession.status === "active" && (
                              <span style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: badge.color, display: "inline-block", animation: "pulse 2s infinite" }} />
                            )}
                            {badge.label}
                          </span>
                        );
                      })()}
                      <span
                        style={{
                          fontSize: "9px",
                          fontWeight: 600,
                          color: "var(--text-muted)",
                          backgroundColor: "var(--surface-elevated)",
                          padding: "2px 8px",
                          borderRadius: "4px",
                          fontFamily: "var(--font-mono)",
                          textTransform: "uppercase",
                        }}
                      >
                        {activeSession.mode}
                      </span>
                      {activeSession.model && (
                        <span style={{ fontSize: "10px", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                          {activeSession.model}
                        </span>
                      )}
                    </div>
                    <h2
                      style={{
                        fontSize: "15px",
                        fontWeight: 700,
                        color: "var(--text-primary)",
                        margin: 0,
                        fontFamily: "var(--font-heading)",
                        lineHeight: 1.3,
                      }}
                    >
                      {activeSession.topic}
                    </h2>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "12px", flexShrink: 0 }}>
                    {/* Participants */}
                    <AvatarStack agentIds={activeSession.agents} size={28} max={5} />

                    <div style={{ fontSize: "11px", color: "var(--text-muted)", textAlign: "right" }}>
                      <div>{events.length} events</div>
                      <div>{formatDate(activeSession.createdAt)}</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Events stream */}
              <div
                style={{
                  flex: 1,
                  overflowY: "auto",
                  padding: "20px 24px",
                  backgroundColor: "var(--background)",
                }}
              >
                {events.length === 0 ? (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-muted)" }}>
                    <Loader2 size={20} className="animate-spin" />
                  </div>
                ) : (
                  <>
                    {events.map((event) => (
                      <EventBubble key={event.id} event={event} />
                    ))}
                    <div ref={eventsEndRef} />
                  </>
                )}
              </div>

              {/* Human input bar */}
              {activeSession.status === "active" && (
                <div
                  style={{
                    padding: "12px 24px 16px",
                    borderTop: "1px solid var(--border)",
                    backgroundColor: "var(--surface)",
                    flexShrink: 0,
                  }}
                >
                  <div style={{ display: "flex", gap: "10px", alignItems: "flex-end" }}>
                    <div style={{ flex: 1 }}>
                      <textarea
                        value={humanMessage}
                        onChange={(e) => setHumanMessage(e.target.value)}
                        placeholder="Type a directive to inject into the session..."
                        rows={2}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && e.metaKey) handleSendMessage();
                        }}
                        style={{
                          width: "100%",
                          padding: "10px 12px",
                          backgroundColor: "var(--surface-elevated)",
                          border: "1px solid var(--border)",
                          borderRadius: "8px",
                          color: "var(--text-primary)",
                          fontSize: "13px",
                          fontFamily: "var(--font-body)",
                          resize: "none",
                          outline: "none",
                          boxSizing: "border-box",
                        }}
                      />
                      <div style={{ fontSize: "10px", color: "var(--text-muted)", marginTop: "4px" }}>
                        ⌘↵ to send · Appears as a Supervisor directive in the stream
                      </div>
                    </div>
                    <button
                      onClick={handleSendMessage}
                      disabled={sendingMessage || !humanMessage.trim()}
                      style={{
                        padding: "10px 18px",
                        borderRadius: "8px",
                        border: "none",
                        backgroundColor: "var(--accent)",
                        color: "#fff",
                        cursor: sendingMessage || !humanMessage.trim() ? "not-allowed" : "pointer",
                        fontSize: "12px",
                        fontWeight: 600,
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        opacity: sendingMessage || !humanMessage.trim() ? 0.5 : 1,
                        flexShrink: 0,
                        fontFamily: "var(--font-heading)",
                        height: "fit-content",
                      }}
                    >
                      {sendingMessage ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                      Send as Directive
                    </button>
                  </div>
                </div>
              )}

              {/* Completed session summary */}
              {activeSession.status === "completed" && (
                <div
                  style={{
                    padding: "14px 24px",
                    borderTop: "1px solid var(--border)",
                    backgroundColor: "var(--surface)",
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    flexShrink: 0,
                  }}
                >
                  <Trophy size={16} color="#4ade80" />
                  <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                    Session completed{activeSession.completedAt ? ` · ${formatDate(activeSession.completedAt)}` : ""}
                    {activeSession.outcome ? ` · Outcome: ${activeSession.outcome}` : ""}
                  </span>
                </div>
              )}
            </>
          ) : (
            /* Empty state */
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexDirection: "column",
                gap: "16px",
                color: "var(--text-muted)",
                padding: "40px",
                textAlign: "center",
              }}
            >
              <Users size={48} style={{ opacity: 0.2 }} />
              <div>
                <div style={{ fontSize: "18px", fontWeight: 700, color: "var(--text-primary)", marginBottom: "8px", fontFamily: "var(--font-heading)" }}>
                  Advisory Board
                </div>
                <div style={{ fontSize: "13px", color: "var(--text-muted)", maxWidth: "360px", lineHeight: 1.6, marginBottom: "20px" }}>
                  Launch multi-agent sessions where your AI team debates, researches, and collaborates in real-time. Select a session from the sidebar or start a new one.
                </div>
                <div style={{ display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap", marginBottom: "24px" }}>
                  {[
                    { icon: "🔄", label: "Roundtables", desc: "Open collaborative discussion" },
                    { icon: "🔍", label: "Review Loops", desc: "Worker + reviewer approval chain" },
                    { icon: "👤", label: "Human Input", desc: "Jump in with directives" },
                  ].map((f) => (
                    <div
                      key={f.label}
                      style={{
                        padding: "12px 16px",
                        borderRadius: "10px",
                        border: "1px solid var(--border)",
                        backgroundColor: "var(--surface)",
                        textAlign: "center",
                        minWidth: "120px",
                      }}
                    >
                      <div style={{ fontSize: "20px", marginBottom: "4px" }}>{f.icon}</div>
                      <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-primary)" }}>{f.label}</div>
                      <div style={{ fontSize: "10px", color: "var(--text-muted)", marginTop: "2px" }}>{f.desc}</div>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => setShowLaunchModal(true)}
                  style={{
                    padding: "10px 24px",
                    borderRadius: "8px",
                    border: "none",
                    backgroundColor: "var(--accent)",
                    color: "#fff",
                    cursor: "pointer",
                    fontSize: "13px",
                    fontWeight: 600,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "8px",
                    fontFamily: "var(--font-heading)",
                  }}
                >
                  <MessageSquarePlus size={14} />
                  Launch First Session
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ─── RIGHT SIDEBAR — Session metadata (desktop only) ── */}
        {activeSession && (
          <div
            style={{
              width: "220px",
              flexShrink: 0,
              borderLeft: "1px solid var(--border)",
              backgroundColor: "var(--surface)",
              overflowY: "auto",
              padding: "16px",
              display: "flex",
              flexDirection: "column",
              gap: "16px",
            }}
          >
            {/* Participants detail */}
            <div>
              <div style={{ fontSize: "9px", fontWeight: 700, letterSpacing: "0.08em", color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginBottom: "10px" }}>
                PARTICIPANTS
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {activeSession.agents.map((agentId) => {
                  const agent = AGENTS.find((a) => a.id === agentId);
                  return (
                    <div key={agentId} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <AgentAvatar agentId={agentId} size={32} borderWidth={2} />
                      <div>
                        <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-primary)" }}>{agentId}</div>
                        <div style={{ fontSize: "9px", color: "var(--text-muted)" }}>{agent?.role ?? "Agent"}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{ borderTop: "1px solid var(--border)" }} />

            {/* Session info */}
            <div>
              <div style={{ fontSize: "9px", fontWeight: 700, letterSpacing: "0.08em", color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginBottom: "10px" }}>
                SESSION INFO
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <InfoRow label="Mode" value={activeSession.mode} />
                <InfoRow label="Style" value={activeSession.reviewStyle ?? "—"} />
                <InfoRow label="Model" value={activeSession.model?.replace("claude-", "").replace("-4-6", "") ?? "—"} />
                <InfoRow label="Events" value={String(events.length)} />
                <InfoRow label="Started" value={formatDate(activeSession.createdAt)} />
                {activeSession.completedAt && (
                  <InfoRow label="Ended" value={formatDate(activeSession.completedAt)} />
                )}
              </div>
            </div>

            <div style={{ borderTop: "1px solid var(--border)" }} />

            {/* Event legend */}
            <div>
              <div style={{ fontSize: "9px", fontWeight: 700, letterSpacing: "0.08em", color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginBottom: "10px" }}>
                LEGEND
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {[
                  { icon: "🚀", label: "Session start" },
                  { icon: "🔵", label: "Worker turn" },
                  { icon: "🟠", label: "Supervisor" },
                  { icon: "🟢", label: "Approved" },
                  { icon: "🔴", label: "Rejected" },
                  { icon: "🎉", label: "Complete" },
                ].map((l) => (
                  <div key={l.icon} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontSize: "12px", width: "16px" }}>{l.icon}</span>
                    <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>{l.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Quick actions */}
            {activeSession.status === "active" && (
              <>
                <div style={{ borderTop: "1px solid var(--border)" }} />
                <div>
                  <div style={{ fontSize: "9px", fontWeight: 700, letterSpacing: "0.08em", color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginBottom: "10px" }}>
                    ACTIONS
                  </div>
                  <button
                    onClick={async () => {
                      await fetch(`/api/advisory/sessions/${activeSession.id}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ status: "completed", completedAt: new Date().toISOString() }),
                      });
                      await loadSessionEvents(activeSession.id);
                      await loadSessions();
                    }}
                    style={{
                      width: "100%",
                      padding: "8px",
                      borderRadius: "6px",
                      border: "1px solid var(--border)",
                      backgroundColor: "transparent",
                      color: "var(--text-secondary)",
                      cursor: "pointer",
                      fontSize: "11px",
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      fontFamily: "var(--font-body)",
                    }}
                  >
                    <CheckCircle2 size={12} />
                    Mark Complete
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {showLaunchModal && (
        <LaunchModal
          onClose={() => setShowLaunchModal(false)}
          onLaunch={handleLaunch}
        />
      )}
    </>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>{label}</span>
      <span style={{ fontSize: "10px", fontWeight: 600, color: "var(--text-primary)", fontFamily: "var(--font-mono)", textTransform: "capitalize" }}>{value}</span>
    </div>
  );
}
