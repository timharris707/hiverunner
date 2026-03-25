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
  Copy,
  Download,
  Archive,
  Pause,
  Play,
  ChevronRight,
  ChevronDown,
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
  model?: string;
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
  pacing?: string;
  paused?: boolean;
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
  { id: "Quant", emoji: "📊", role: "Trading Strategy Architect", defaultRole: "worker" },
  { id: "Forge", emoji: "🔧", role: "Backend Engineer", defaultRole: "worker" },
  { id: "Pixel", emoji: "💻", role: "Senior Full-Stack Engineer", defaultRole: "worker" },
  { id: "Scout", emoji: "🔭", role: "Research & Intelligence", defaultRole: "worker" },
  { id: "Quill", emoji: "✍️", role: "Creative Writer & Marketing", defaultRole: "worker" },
  { id: "Counsel", emoji: "⚖️", role: "Legal Expert", defaultRole: "reviewer" },
];

const PERSONA_OVERLAYS = [
  { id: "trading-strategist", name: "Trading Strategist", emoji: "📊", desc: "Deep quant analysis: momentum, mean-reversion, risk-reward optimization", relevantAgents: ["Atlas", "Nimbus", "Cipher", "Quant", "Henry"] },
  { id: "seo-specialist", name: "SEO Specialist", emoji: "🔍", desc: "Keyword research, on-page optimization, SERP strategy, content gap analysis", relevantAgents: ["Quill", "Scout"] },
  { id: "growth-hacker", name: "Growth Hacker", emoji: "🚀", desc: "Viral loops, acquisition funnels, retention mechanics, rapid experimentation", relevantAgents: ["Quill", "Scout", "Henry"] },
  { id: "content-creator", name: "Content Creator", emoji: "✍️", desc: "Audience-first storytelling, platform-native formats, engagement optimization", relevantAgents: ["Quill"] },
  { id: "compliance-auditor", name: "Compliance Auditor", emoji: "⚖️", desc: "Regulatory risk review, audit trails, policy adherence, legal exposure analysis", relevantAgents: ["Counsel", "Henry"] },
  { id: "security-engineer", name: "Security Engineer", emoji: "🔐", desc: "Threat modeling, vulnerability assessment, secure design review, auth hardening", relevantAgents: ["Forge", "Pixel"] },
  { id: "devops-automator", name: "DevOps Automator", emoji: "⚙️", desc: "CI/CD pipelines, infra-as-code, monitoring, incident response playbooks", relevantAgents: ["Forge"] },
  { id: "reality-checker", name: "Reality Checker", emoji: "🎯", desc: "Cuts through hype, stress-tests assumptions, identifies blind spots and risks", relevantAgents: ["Henry", "Scout", "Counsel"] },
  { id: "trend-researcher", name: "Trend Researcher", emoji: "📡", desc: "Emerging signals, market timing, early-mover opportunities, competitive intelligence", relevantAgents: ["Scout", "Quant"] },
  { id: "data-analytics-reporter", name: "Data Analytics Reporter", emoji: "📈", desc: "Structured data analysis, metrics framing, visual storytelling with numbers", relevantAgents: ["Scout", "Quant", "Atlas"] },
  { id: "backend-architect", name: "Backend Architect", emoji: "🏗️", desc: "System design, API contracts, scalability patterns, database schema review", relevantAgents: ["Forge", "Pixel"] },
];

const MODELS = [
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-haiku-4-6",
];

const PACING_OPTIONS = [
  { id: "instant", label: "Instant", desc: "Agents respond as fast as possible" },
  { id: "relaxed", label: "Relaxed (30s)", desc: "30 second pause between turns" },
  { id: "slow", label: "Slow (1 min)", desc: "1 minute pause between turns" },
  { id: "manual", label: "Manual (step-through)", desc: "Pauses after each turn — you advance manually" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getAgentRole(agentId: string): string {
  return AGENTS.find((a) => a.id === agentId)?.role ?? "Agent";
}

function getOverlayName(overlayId: string): string {
  return PERSONA_OVERLAYS.find((o) => o.id === overlayId)?.name ?? overlayId;
}

function getOverlayEmoji(overlayId: string): string {
  return PERSONA_OVERLAYS.find((o) => o.id === overlayId)?.emoji ?? "🎭";
}

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

function formatMarkdownExport(session: AdvisorySession, events: AdvisoryEvent[]): string {
  const topic = session.topic;
  const mode = session.mode;
  const dateStr = new Date(session.createdAt).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const overlays: string[] = (session as unknown as Record<string, unknown>).personaOverlays as string[] ?? [];

  // Build participants section
  const participantLines: string[] = [];
  for (const agentDisplayName of session.agents) {
    const agentConfig = getAgentByAnyId(agentDisplayName);
    const role = agentConfig?.role ?? getAgentRole(agentDisplayName);
    const avatarPath = agentConfig?.avatar;
    const emoji = agentConfig?.emoji ?? "🤖";
    // Find overlays relevant to this agent
    const agentOverlays = overlays
      .filter((oid) => {
        const o = PERSONA_OVERLAYS.find((p) => p.id === oid);
        return o?.relevantAgents.includes(agentDisplayName);
      })
      .map((oid) => `${getOverlayEmoji(oid)} ${getOverlayName(oid)}`);

    const avatarMd = avatarPath ? `![${agentDisplayName}](${avatarPath}) ` : `${emoji} `;
    const overlayStr = agentOverlays.length > 0 ? ` | Persona: ${agentOverlays.join(", ")}` : "";
    participantLines.push(`- ${avatarMd}**${agentDisplayName}** — ${role}${overlayStr}`);
  }

  // Collect unique models used across events
  const allEvents = events as (AdvisoryEvent & { model?: string })[];
  const modelsUsed = [...new Set(allEvents.map((e) => e.model).filter(Boolean))];
  const modelsStr = modelsUsed.length > 0 ? modelsUsed.join(", ") : "N/A";

  const lines: string[] = [
    `# Advisory Board: ${topic}`,
    ``,
    `**Date:** ${dateStr} | **Mode:** ${mode} | **Model(s):** ${modelsStr}`,
    `**Pacing:** ${(session as unknown as Record<string, unknown>).pacing as string ?? "instant"}`,
    ``,
    `## Participants`,
    ``,
    ...participantLines,
    ``,
    `---`,
    ``,
  ];

  for (const event of events) {
    if (!event.text || !event.speaker) continue;
    const agentConfig = getAgentByAnyId(event.speaker);
    const role = agentConfig?.role ?? getAgentRole(event.speaker);
    const avatarPath = agentConfig?.avatar;
    const emoji = agentConfig?.emoji ?? event.emoji;
    const avatarMd = avatarPath ? `![${event.speaker}](${avatarPath}) ` : `${emoji} `;
    // Speaker overlays
    const speakerOverlays = overlays
      .filter((oid) => {
        const o = PERSONA_OVERLAYS.find((p) => p.id === oid);
        return o?.relevantAgents.includes(event.speaker);
      })
      .map((oid) => `${getOverlayEmoji(oid)} ${getOverlayName(oid)}`);
    const overlayStr = speakerOverlays.length > 0 ? ` | *Persona: ${speakerOverlays.join(", ")}*` : "";

    const modelStr = event.model ? ` | Model: ${event.model}` : "";
    lines.push(`## ${avatarMd}${event.speaker} — ${role} (${event.role})${overlayStr}${modelStr}`);
    lines.push(``);
    lines.push(event.text);
    lines.push(``);
    lines.push(`---`);
    lines.push(``);
  }

  return lines.join("\n");
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function getStatusBadge(status: string): { label: string; color: string; bg: string } {
  if (status === "active") return { label: "LIVE", color: "#4ade80", bg: "rgba(74,222,128,0.12)" };
  if (status === "completed") return { label: "DONE", color: "#94a3b8", bg: "rgba(148,163,184,0.1)" };
  return { label: "ABANDONED", color: "#ef4444", bg: "rgba(239,68,68,0.1)" };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function formatModelName(model?: string): string {
  if (!model) return "";
  // Shorten common model names for compact display
  return model
    .replace("gemini-", "gemini/")
    .replace("claude-", "claude/");
}

function EventBubble({
  event,
  sessionOverlays = [],
}: {
  event: AdvisoryEvent;
  sessionOverlays?: string[];
}) {
  const style = getEventStyle(event);
  const icon = getEventIcon(event.type, event.verdict);
  const badge = getRoleBadge(event.role, event.type);
  const isSystem = event.type === "start" || event.type === "complete";
  const agentConfig = getAgentByAnyId(event.speaker);
  const agentRole = agentConfig?.role ?? getAgentRole(event.speaker);

  // Which overlays apply to this speaker?
  const speakerOverlays = sessionOverlays.filter((oid) => {
    const o = PERSONA_OVERLAYS.find((p) => p.id === oid);
    return o?.relevantAgents.includes(event.speaker);
  });

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
      <div style={{ display: "flex", alignItems: "flex-start", gap: "10px", marginBottom: "8px" }}>
        {/* Avatar */}
        <div style={{ flexShrink: 0, marginTop: "1px" }}>
          {isSystem ? (
            <span style={{ fontSize: "20px", lineHeight: 1, display: "block" }}>{icon}</span>
          ) : agentConfig ? (
            <AgentAvatar agentId={event.speaker} size={36} borderWidth={2} />
          ) : (
            <span style={{ fontSize: "20px", lineHeight: 1, display: "block" }}>{event.emoji}</span>
          )}
        </div>

        {/* Name + role line + badges */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap", marginBottom: "2px" }}>
            <span style={{ fontWeight: 700, fontSize: "13px", color: "var(--text-primary)", fontFamily: "var(--font-heading)" }}>
              {event.speaker}
            </span>
            {!isSystem && (
              <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                — {agentRole}
              </span>
            )}
            <span style={{ marginLeft: "auto", fontSize: "11px", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
              {formatTime(event.timestamp)}
            </span>
          </div>

          {/* Role badge + overlay chips */}
          <div style={{ display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap" }}>
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
            {speakerOverlays.map((oid) => (
              <span
                key={oid}
                style={{
                  fontSize: "9px",
                  fontWeight: 600,
                  color: "#a78bfa",
                  backgroundColor: "rgba(167,139,250,0.12)",
                  border: "1px solid rgba(167,139,250,0.3)",
                  padding: "2px 6px",
                  borderRadius: "4px",
                  fontFamily: "var(--font-mono)",
                  letterSpacing: "0.04em",
                }}
              >
                {getOverlayEmoji(oid)} {getOverlayName(oid)}
              </span>
            ))}
            {event.model && !isSystem && (
              <span
                style={{
                  fontSize: "9px",
                  fontWeight: 500,
                  color: "#64748b",
                  backgroundColor: "rgba(100,116,139,0.08)",
                  border: "1px solid rgba(100,116,139,0.2)",
                  padding: "2px 6px",
                  borderRadius: "4px",
                  fontFamily: "var(--font-mono)",
                  letterSpacing: "0.03em",
                }}
              >
                {formatModelName(event.model)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div
        style={{ fontSize: "13px", color: "var(--text-primary)", lineHeight: 1.6, marginLeft: "46px" }}
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
  const [step, setStep] = useState<"config" | "personas">("config");
  const [topic, setTopic] = useState("");
  const [mode, setMode] = useState<"review" | "roundtable">("roundtable");
  const [selectedAgents, setSelectedAgents] = useState<string[]>(["Henry"]);
  const [reviewStyle, setReviewStyle] = useState<"strict" | "flexible" | "open">("open");
  const [model, setModel] = useState("claude-opus-4-6");
  const [rounds, setRounds] = useState<number | "persistent">(3);
  const [pacing, setPacing] = useState<string>("manual"); // default: manual for roundtable
  const [selectedOverlays, setSelectedOverlays] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const toggleAgent = (id: string) => {
    setSelectedAgents((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]
    );
  };

  const toggleOverlay = (id: string) => {
    setSelectedOverlays((prev) =>
      prev.includes(id) ? prev.filter((o) => o !== id) : [...prev, id]
    );
  };

  // Filter overlays relevant to selected agents
  const relevantOverlays = PERSONA_OVERLAYS.filter((o) =>
    o.relevantAgents.some((a) => selectedAgents.includes(a))
  );
  const otherOverlays = PERSONA_OVERLAYS.filter((o) =>
    !o.relevantAgents.some((a) => selectedAgents.includes(a))
  );

  const handleNext = () => {
    if (!topic.trim()) { setError("Mission/Topic is required."); return; }
    if (selectedAgents.length < 1) { setError("Select at least one agent."); return; }
    setError("");
    setStep("personas");
  };

  const handleLaunch = async () => {
    setError("");
    setLoading(true);
    try {
      // Step 1: Create the session
      const res = await fetch("/api/advisory/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic,
          mode,
          agents: selectedAgents,
          reviewStyle,
          model,
          rounds,
          pacing,
          personaOverlays: selectedOverlays.length > 0 ? selectedOverlays : undefined,
        }),
      });
      if (!res.ok) throw new Error("Failed to create session");
      const data = await res.json();

      // Step 2: Trigger the conversation run (fire-and-forget on server side)
      try {
        await fetch(`/api/advisory/sessions/${data.session.id}/run`, {
          method: "POST",
        });
      } catch (runErr) {
        console.warn("Run trigger error (non-fatal):", runErr);
      }

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
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
          <div>
            <h2 style={{ fontSize: "18px", fontWeight: 700, color: "var(--text-primary)", margin: 0, fontFamily: "var(--font-heading)" }}>
              🚀 New Advisory Session
            </h2>
            <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: "4px 0 0 0" }}>
              {step === "config" ? "Step 1 of 2 — Configure session" : "Step 2 of 2 — Persona Overlays (optional)"}
            </p>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: "4px" }}>
            <X size={20} />
          </button>
        </div>

        {/* Step indicator */}
        <div style={{ display: "flex", gap: "6px", marginBottom: "20px" }}>
          {["config", "personas"].map((s, i) => (
            <div key={s} style={{ flex: 1, height: "3px", borderRadius: "2px", backgroundColor: step === s || (i === 0) ? "var(--accent)" : "var(--border)", opacity: step === s ? 1 : i === 0 ? 0.5 : 0.3 }} />
          ))}
        </div>

        {step === "config" && (
          <>
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
                    onClick={() => {
                      setMode(m.id as "review" | "roundtable");
                      // Set sensible default pacing per mode
                      setPacing(m.id === "roundtable" ? "manual" : "instant");
                    }}
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
            <div style={{ marginBottom: "16px" }}>
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

            {/* Rounds */}
            <div style={{ marginBottom: "24px" }}>
              <label style={{ display: "block", fontSize: "11px", fontWeight: 700, letterSpacing: "0.06em", color: "var(--text-muted)", marginBottom: "8px", fontFamily: "var(--font-mono)" }}>
                ROUNDS
              </label>
              <select
                value={rounds === "persistent" ? "persistent" : String(rounds)}
                onChange={(e) => {
                  const v = e.target.value;
                  setRounds(v === "persistent" ? "persistent" : parseInt(v, 10));
                }}
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
                {[2, 3, 5, 10].map((r) => (
                  <option key={r} value={String(r)}>{r} rounds</option>
                ))}
                <option value="persistent">Persistent (open-ended)</option>
              </select>
              {rounds === "persistent" && (
                <div style={{ fontSize: "10px", color: "var(--text-muted)", marginTop: "6px" }}>
                  Session stays active — agents respond when you inject a directive
                </div>
              )}
            </div>

            {/* Pacing */}
            <div style={{ marginBottom: "24px" }}>
              <label style={{ display: "block", fontSize: "11px", fontWeight: 700, letterSpacing: "0.06em", color: "var(--text-muted)", marginBottom: "8px", fontFamily: "var(--font-mono)" }}>
                PACING
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
                {PACING_OPTIONS.map((opt) => {
                  const sel = pacing === opt.id;
                  return (
                    <button
                      key={opt.id}
                      onClick={() => setPacing(opt.id)}
                      style={{
                        padding: "9px 11px",
                        borderRadius: "8px",
                        border: `1px solid ${sel ? "var(--accent)" : "var(--border)"}`,
                        backgroundColor: sel ? "var(--accent-soft)" : "var(--surface-elevated)",
                        cursor: "pointer",
                        textAlign: "left",
                        transition: "all 150ms ease",
                      }}
                    >
                      <div style={{ fontSize: "11px", fontWeight: 700, color: sel ? "var(--accent)" : "var(--text-primary)", marginBottom: "2px" }}>{opt.label}</div>
                      <div style={{ fontSize: "10px", color: "var(--text-muted)", lineHeight: 1.3 }}>{opt.desc}</div>
                    </button>
                  );
                })}
              </div>
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
                onClick={handleNext}
                style={{
                  padding: "10px 24px",
                  borderRadius: "8px",
                  border: "none",
                  backgroundColor: "var(--accent)",
                  color: "#fff",
                  cursor: "pointer",
                  fontSize: "13px",
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  fontFamily: "var(--font-heading)",
                }}
              >
                Next: Persona Overlays →
              </button>
            </div>
          </>
        )}

        {step === "personas" && (
          <>
            <div style={{ marginBottom: "8px" }}>
              <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: "0 0 16px 0", lineHeight: 1.6 }}>
                Persona overlays inject specialized expertise lenses into the session. They shape how agents approach and frame their contributions. All are optional.
              </p>

              {/* Relevant overlays */}
              {relevantOverlays.length > 0 && (
                <>
                  <label style={{ display: "block", fontSize: "11px", fontWeight: 700, letterSpacing: "0.06em", color: "var(--accent)", marginBottom: "8px", fontFamily: "var(--font-mono)" }}>
                    ✨ RECOMMENDED FOR YOUR AGENTS
                  </label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "16px" }}>
                    {relevantOverlays.map((overlay) => {
                      const sel = selectedOverlays.includes(overlay.id);
                      return (
                        <button
                          key={overlay.id}
                          onClick={() => toggleOverlay(overlay.id)}
                          style={{
                            padding: "10px 12px",
                            borderRadius: "8px",
                            border: `1px solid ${sel ? "var(--accent)" : "var(--border)"}`,
                            backgroundColor: sel ? "var(--accent-soft)" : "var(--surface-elevated)",
                            cursor: "pointer",
                            textAlign: "left",
                            transition: "all 150ms ease",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                            <span style={{ fontSize: "14px" }}>{overlay.emoji}</span>
                            <span style={{ fontSize: "11px", fontWeight: 700, color: sel ? "var(--accent)" : "var(--text-primary)" }}>{overlay.name}</span>
                            {sel && <span style={{ fontSize: "9px", marginLeft: "auto", color: "var(--accent)", fontWeight: 700 }}>✓</span>}
                          </div>
                          <div style={{ fontSize: "10px", color: "var(--text-muted)", lineHeight: 1.4 }}>{overlay.desc}</div>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}

              {/* Other overlays */}
              {otherOverlays.length > 0 && (
                <>
                  <label style={{ display: "block", fontSize: "11px", fontWeight: 700, letterSpacing: "0.06em", color: "var(--text-muted)", marginBottom: "8px", fontFamily: "var(--font-mono)" }}>
                    OTHER OVERLAYS
                  </label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "16px" }}>
                    {otherOverlays.map((overlay) => {
                      const sel = selectedOverlays.includes(overlay.id);
                      return (
                        <button
                          key={overlay.id}
                          onClick={() => toggleOverlay(overlay.id)}
                          style={{
                            padding: "10px 12px",
                            borderRadius: "8px",
                            border: `1px solid ${sel ? "var(--accent)" : "var(--border)"}`,
                            backgroundColor: sel ? "var(--accent-soft)" : "var(--surface-elevated)",
                            cursor: "pointer",
                            textAlign: "left",
                            transition: "all 150ms ease",
                            opacity: 0.7,
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                            <span style={{ fontSize: "14px" }}>{overlay.emoji}</span>
                            <span style={{ fontSize: "11px", fontWeight: 700, color: sel ? "var(--accent)" : "var(--text-primary)" }}>{overlay.name}</span>
                            {sel && <span style={{ fontSize: "9px", marginLeft: "auto", color: "var(--accent)", fontWeight: 700 }}>✓</span>}
                          </div>
                          <div style={{ fontSize: "10px", color: "var(--text-muted)", lineHeight: 1.4 }}>{overlay.desc}</div>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}

              {selectedOverlays.length > 0 && (
                <div style={{ padding: "8px 12px", backgroundColor: "var(--accent-soft)", border: "1px solid var(--accent)", borderRadius: "8px", marginBottom: "16px" }}>
                  <span style={{ fontSize: "11px", color: "var(--accent)", fontWeight: 600 }}>
                    {selectedOverlays.length} overlay{selectedOverlays.length > 1 ? "s" : ""} selected · Will be noted in session metadata
                  </span>
                </div>
              )}
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
                onClick={() => setStep("config")}
                style={{ padding: "10px 20px", borderRadius: "8px", border: "1px solid var(--border)", backgroundColor: "transparent", color: "var(--text-secondary)", cursor: "pointer", fontSize: "13px", fontWeight: 500 }}
              >
                ← Back
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
          </>
        )}
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
  const [isGenerating, setIsGenerating] = useState(false);
  const [copiedToast, setCopiedToast] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [togglingPause, setTogglingPause] = useState(false);
  const [showNewMessages, setShowNewMessages] = useState(false);
  const [endSessionConfirm, setEndSessionConfirm] = useState(false);
  const [endingSession, setEndingSession] = useState(false);
  const [advancingTurn, setAdvancingTurn] = useState(false);

  const eventsEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Scroll helpers ──────────────────────────────────────────────────────────

  const isNearBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return true;
    return el.scrollTop + el.clientHeight >= el.scrollHeight - 100;
  }, []);

  const scrollToBottom = useCallback((smooth = true) => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "instant" });
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
        setIsPaused(data.session.paused ?? false);
        setEvents(data.session.events || []);
      }
    } catch (e) {
      console.error("Failed to load session:", e);
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // Auto-scroll only when near bottom; show badge otherwise
  useEffect(() => {
    if (events.length === 0) return;
    if (isNearBottom()) {
      scrollToBottom();
      setShowNewMessages(false);
    } else {
      setShowNewMessages(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events]);

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
            setIsGenerating(true);
          }
          // Sync paused state from server
          if (typeof data.paused === "boolean") {
            setIsPaused(data.paused);
          }
          // Check if session has completed
          if (data.status && data.status !== "active") {
            setIsGenerating(false);
            await loadSessions();
            await loadSessionEvents(activeSession.id);
          }
        } catch (e) {
          console.error("Polling error:", e);
        }
      }, 2000);
    } else {
      setIsGenerating(false);
    }

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [activeSession, events, loadSessions, loadSessionEvents]);

  const handleSelectSession = async (session: AdvisorySession) => {
    setEvents([]);
    setShowNewMessages(false);
    setEndSessionConfirm(false);
    await loadSessionEvents(session.id);
  };

  const handleLaunch = async (session: AdvisorySession) => {
    setShowLaunchModal(false);
    setIsGenerating(true);
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

  const handleCopyToClipboard = async () => {
    if (!activeSession) return;
    const markdown = formatMarkdownExport(activeSession, events);
    try {
      await navigator.clipboard.writeText(markdown);
      setCopiedToast(true);
      setTimeout(() => setCopiedToast(false), 2000);
    } catch (e) {
      console.error("Clipboard error:", e);
    }
  };

  const handleExportMarkdown = () => {
    if (!activeSession) return;
    const markdown = formatMarkdownExport(activeSession, events);
    const dateStr = new Date(activeSession.createdAt).toISOString().split("T")[0];
    const topicSlug = slugify(activeSession.topic);
    const fileName = `advisory-${dateStr}-${topicSlug}.md`;
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleArchive = async () => {
    if (!activeSession) return;
    setArchiving(true);
    try {
      await fetch(`/api/advisory/sessions/${activeSession.id}/archive`, {
        method: "POST",
      });
    } catch (e) {
      console.error("Archive error:", e);
    } finally {
      setArchiving(false);
    }
  };

  // ── Pause / Resume ──────────────────────────────────────────────────────────
  const handleTogglePause = async () => {
    if (!activeSession) return;
    setTogglingPause(true);
    try {
      const newPaused = !isPaused;
      await fetch(`/api/advisory/sessions/${activeSession.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paused: newPaused }),
      });
      setIsPaused(newPaused);
      setActiveSession((s) => s ? { ...s, paused: newPaused } : s);
    } catch (e) {
      console.error("Pause toggle error:", e);
    } finally {
      setTogglingPause(false);
    }
  };

  // ── Next Turn (manual mode) ─────────────────────────────────────────────────
  const handleNextTurn = async () => {
    if (!activeSession) return;
    setAdvancingTurn(true);
    try {
      await fetch(`/api/advisory/sessions/${activeSession.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paused: false }),
      });
      setIsPaused(false);
      setActiveSession((s) => s ? { ...s, paused: false } : s);
    } catch (e) {
      console.error("Next turn error:", e);
    } finally {
      setAdvancingTurn(false);
    }
  };

  // ── End Session ─────────────────────────────────────────────────────────────
  const handleEndSession = async () => {
    if (!activeSession) return;
    setEndingSession(true);
    try {
      // 1. Trigger the end-session synthesis via a special run call
      await fetch(`/api/advisory/sessions/${activeSession.id}/end`, {
        method: "POST",
      });
      // 2. Reload to see the final state
      await loadSessionEvents(activeSession.id);
      await loadSessions();
    } catch (e) {
      console.error("End session error:", e);
    } finally {
      setEndingSession(false);
      setEndSessionConfirm(false);
    }
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

                    {/* Session controls */}
                    <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                      {/* Pause / Resume — only when active */}
                      {activeSession.status === "active" && (
                        <button
                          onClick={handleTogglePause}
                          disabled={togglingPause}
                          title={isPaused ? "Resume session" : "Pause session"}
                          style={{
                            padding: "6px 10px",
                            borderRadius: "6px",
                            border: `1px solid ${isPaused ? "rgba(74,222,128,0.5)" : "var(--border)"}`,
                            backgroundColor: isPaused ? "rgba(74,222,128,0.12)" : "var(--surface-elevated)",
                            color: isPaused ? "#4ade80" : "var(--text-muted)",
                            cursor: togglingPause ? "not-allowed" : "pointer",
                            fontSize: "11px",
                            display: "flex",
                            alignItems: "center",
                            gap: "5px",
                            fontWeight: 600,
                            transition: "all 150ms ease",
                            opacity: togglingPause ? 0.6 : 1,
                          }}
                        >
                          {togglingPause ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : isPaused ? (
                            <Play size={12} />
                          ) : (
                            <Pause size={12} />
                          )}
                          {isPaused ? "Resume" : "Pause"}
                        </button>
                      )}

                      {/* End Session — only when active */}
                      {activeSession.status === "active" && !endSessionConfirm && (
                        <button
                          onClick={() => setEndSessionConfirm(true)}
                          title="End session with Henry's synthesis"
                          style={{
                            padding: "6px 10px",
                            borderRadius: "6px",
                            border: "1px solid rgba(239,68,68,0.35)",
                            backgroundColor: "rgba(239,68,68,0.06)",
                            color: "#ef4444",
                            cursor: "pointer",
                            fontSize: "11px",
                            display: "flex",
                            alignItems: "center",
                            gap: "5px",
                            fontWeight: 600,
                            transition: "all 150ms ease",
                          }}
                        >
                          <X size={12} />
                          End
                        </button>
                      )}

                      {/* Confirm End Session */}
                      {activeSession.status === "active" && endSessionConfirm && (
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", padding: "4px 8px", borderRadius: "8px", border: "1px solid rgba(239,68,68,0.4)", backgroundColor: "rgba(239,68,68,0.08)" }}>
                          <span style={{ fontSize: "10px", color: "#ef4444", fontWeight: 600, whiteSpace: "nowrap" }}>
                            Henry synthesizes & closes →
                          </span>
                          <button
                            onClick={handleEndSession}
                            disabled={endingSession}
                            style={{
                              padding: "4px 10px",
                              borderRadius: "5px",
                              border: "none",
                              backgroundColor: "#ef4444",
                              color: "#fff",
                              cursor: endingSession ? "not-allowed" : "pointer",
                              fontSize: "10px",
                              fontWeight: 700,
                              display: "flex",
                              alignItems: "center",
                              gap: "4px",
                              opacity: endingSession ? 0.7 : 1,
                            }}
                          >
                            {endingSession ? <Loader2 size={10} className="animate-spin" /> : null}
                            Confirm
                          </button>
                          <button
                            onClick={() => setEndSessionConfirm(false)}
                            style={{
                              padding: "4px 8px",
                              borderRadius: "5px",
                              border: "1px solid rgba(239,68,68,0.3)",
                              backgroundColor: "transparent",
                              color: "#ef4444",
                              cursor: "pointer",
                              fontSize: "10px",
                              fontWeight: 600,
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      )}

                      {/* Export buttons */}
                      <button
                        onClick={handleCopyToClipboard}
                        title="Copy as Markdown"
                        style={{
                          padding: "6px 10px",
                          borderRadius: "6px",
                          border: "1px solid var(--border)",
                          backgroundColor: copiedToast ? "rgba(74,222,128,0.15)" : "var(--surface-elevated)",
                          color: copiedToast ? "#4ade80" : "var(--text-muted)",
                          cursor: "pointer",
                          fontSize: "11px",
                          display: "flex",
                          alignItems: "center",
                          gap: "5px",
                          transition: "all 150ms ease",
                          fontWeight: 600,
                        }}
                      >
                        <Copy size={12} />
                        {copiedToast ? "Copied!" : "Copy"}
                      </button>
                      <button
                        onClick={handleExportMarkdown}
                        title="Export as Markdown file"
                        style={{
                          padding: "6px 10px",
                          borderRadius: "6px",
                          border: "1px solid var(--border)",
                          backgroundColor: "var(--surface-elevated)",
                          color: "var(--text-muted)",
                          cursor: "pointer",
                          fontSize: "11px",
                          display: "flex",
                          alignItems: "center",
                          gap: "5px",
                          fontWeight: 600,
                        }}
                      >
                        <Download size={12} />
                        Export
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Paused banner */}
              {isPaused && activeSession.status === "active" && (
                <div style={{
                  padding: "8px 24px",
                  backgroundColor: "rgba(251,146,60,0.08)",
                  borderBottom: "1px solid rgba(251,146,60,0.25)",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  flexShrink: 0,
                }}>
                  <Pause size={12} color="#fb923c" />
                  <span style={{ fontSize: "11px", color: "#fb923c", fontWeight: 600 }}>
                    Session paused — agents are waiting
                  </span>
                </div>
              )}

              {/* Events stream (scroll container) */}
              <div
                ref={scrollContainerRef}
                style={{
                  flex: 1,
                  overflowY: "auto",
                  padding: "20px 24px",
                  backgroundColor: "var(--background)",
                  position: "relative",
                }}
                onScroll={() => {
                  if (isNearBottom()) setShowNewMessages(false);
                }}
              >
                {events.length === 0 ? (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-muted)", flexDirection: "column", gap: "12px" }}>
                    <Loader2 size={20} className="animate-spin" />
                    <span style={{ fontSize: "12px" }}>Starting conversation...</span>
                  </div>
                ) : (
                  <>
                    {events.map((event) => (
                      <EventBubble
                        key={event.id}
                        event={event}
                        sessionOverlays={(activeSession as unknown as Record<string, unknown>).personaOverlays as string[] ?? []}
                      />
                    ))}
                    {isGenerating && activeSession?.status === "active" && !isPaused && (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "10px",
                          padding: "12px 16px",
                          borderRadius: "12px",
                          border: "1px solid rgba(139, 92, 246, 0.2)",
                          backgroundColor: "rgba(139, 92, 246, 0.05)",
                          marginBottom: "12px",
                        }}
                      >
                        <Loader2 size={14} className="animate-spin" style={{ color: "#8b5cf6" }} />
                        <span style={{ fontSize: "12px", color: "#8b5cf6", fontWeight: 500 }}>
                          Agents are deliberating...
                        </span>
                      </div>
                    )}
                    <div ref={eventsEndRef} />
                  </>
                )}
              </div>

              {/* New messages badge */}
              {showNewMessages && (
                <div style={{ position: "relative", flexShrink: 0, height: 0 }}>
                  <button
                    onClick={() => { scrollToBottom(); setShowNewMessages(false); }}
                    style={{
                      position: "absolute",
                      bottom: "16px",
                      left: "50%",
                      transform: "translateX(-50%)",
                      padding: "6px 14px",
                      borderRadius: "20px",
                      border: "1px solid var(--accent)",
                      backgroundColor: "var(--accent)",
                      color: "#fff",
                      cursor: "pointer",
                      fontSize: "11px",
                      fontWeight: 700,
                      display: "flex",
                      alignItems: "center",
                      gap: "5px",
                      zIndex: 10,
                      boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <ChevronDown size={12} />
                    New messages
                  </button>
                </div>
              )}

              {/* Next Turn / End Session bar — shown when paused */}
              {activeSession.status === "active" && isPaused && (
                <div
                  style={{
                    padding: "10px 24px",
                    borderTop: "1px solid rgba(251,146,60,0.2)",
                    backgroundColor: "rgba(251,146,60,0.04)",
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    flexShrink: 0,
                  }}
                >
                  <span style={{ fontSize: "11px", color: "var(--text-muted)", flex: 1 }}>
                    {(activeSession as unknown as Record<string, unknown>).pacing === "manual"
                      ? "Manual mode · Advance when ready"
                      : "Session paused · Resume or advance"}
                  </span>
                  <button
                    onClick={handleNextTurn}
                    disabled={advancingTurn}
                    style={{
                      padding: "8px 16px",
                      borderRadius: "7px",
                      border: "none",
                      backgroundColor: "var(--accent)",
                      color: "#fff",
                      cursor: advancingTurn ? "not-allowed" : "pointer",
                      fontSize: "12px",
                      fontWeight: 700,
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      opacity: advancingTurn ? 0.7 : 1,
                      fontFamily: "var(--font-heading)",
                    }}
                  >
                    {advancingTurn ? <Loader2 size={13} className="animate-spin" /> : <ChevronRight size={13} />}
                    Next Turn →
                  </button>
                  {!endSessionConfirm ? (
                    <button
                      onClick={() => setEndSessionConfirm(true)}
                      style={{
                        padding: "8px 14px",
                        borderRadius: "7px",
                        border: "1px solid rgba(239,68,68,0.4)",
                        backgroundColor: "rgba(239,68,68,0.08)",
                        color: "#ef4444",
                        cursor: "pointer",
                        fontSize: "12px",
                        fontWeight: 600,
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                      }}
                    >
                      <X size={12} />
                      End Session
                    </button>
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <span style={{ fontSize: "10px", color: "#ef4444", fontWeight: 600 }}>Confirm end?</span>
                      <button
                        onClick={handleEndSession}
                        disabled={endingSession}
                        style={{
                          padding: "5px 10px",
                          borderRadius: "5px",
                          border: "none",
                          backgroundColor: "#ef4444",
                          color: "#fff",
                          cursor: endingSession ? "not-allowed" : "pointer",
                          fontSize: "11px",
                          fontWeight: 700,
                          display: "flex",
                          alignItems: "center",
                          gap: "4px",
                        }}
                      >
                        {endingSession ? <Loader2 size={10} className="animate-spin" /> : null}
                        Yes, end
                      </button>
                      <button
                        onClick={() => setEndSessionConfirm(false)}
                        style={{
                          padding: "5px 8px",
                          borderRadius: "5px",
                          border: "1px solid rgba(239,68,68,0.3)",
                          backgroundColor: "transparent",
                          color: "#ef4444",
                          cursor: "pointer",
                          fontSize: "11px",
                          fontWeight: 600,
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              )}

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
                  <span style={{ fontSize: "12px", color: "var(--text-muted)", flex: 1 }}>
                    Session completed{activeSession.completedAt ? ` · ${formatDate(activeSession.completedAt)}` : ""}
                    {activeSession.outcome ? ` · Outcome: ${activeSession.outcome}` : ""}
                  </span>
                  <button
                    onClick={handleArchive}
                    disabled={archiving}
                    title="Archive session to workspace memory"
                    style={{
                      padding: "6px 12px",
                      borderRadius: "6px",
                      border: "1px solid var(--border)",
                      backgroundColor: "var(--surface-elevated)",
                      color: "var(--text-muted)",
                      cursor: archiving ? "not-allowed" : "pointer",
                      fontSize: "11px",
                      display: "flex",
                      alignItems: "center",
                      gap: "5px",
                      fontWeight: 600,
                      opacity: archiving ? 0.6 : 1,
                    }}
                  >
                    {archiving ? <Loader2 size={12} className="animate-spin" /> : <Archive size={12} />}
                    {archiving ? "Archiving..." : "Archive"}
                  </button>
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
            <>
              <div style={{ borderTop: "1px solid var(--border)" }} />
              <div>
                <div style={{ fontSize: "9px", fontWeight: 700, letterSpacing: "0.08em", color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginBottom: "10px" }}>
                  ACTIONS
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  {activeSession.status === "active" && (
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
                  )}
                  <button
                    onClick={handleArchive}
                    disabled={archiving}
                    style={{
                      width: "100%",
                      padding: "8px",
                      borderRadius: "6px",
                      border: "1px solid var(--border)",
                      backgroundColor: "transparent",
                      color: "var(--text-secondary)",
                      cursor: archiving ? "not-allowed" : "pointer",
                      fontSize: "11px",
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      fontFamily: "var(--font-body)",
                      opacity: archiving ? 0.6 : 1,
                    }}
                  >
                    {archiving ? <Loader2 size={12} className="animate-spin" /> : <Archive size={12} />}
                    {archiving ? "Archiving..." : "Archive to Memory"}
                  </button>
                </div>
              </div>
            </>
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
