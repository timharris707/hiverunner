"use client";

import { useState, useEffect } from "react";
import { Plus, X, Loader2, AlertCircle, UserPlus, Trash2, Focus, Paperclip } from "lucide-react";
import type { AdvisorySession, CustomAgent } from "@/types/advisory";
import { AGENTS, PERSONA_OVERLAYS, PERSONA_OVERLAYS_EXTENDED, AGENT_RECOMMENDED_OVERLAYS, MODELS, PACING_OPTIONS, SESSION_TEMPLATES, DIVISIONS } from "./constants";
import { AgentAvatar } from "@/components/AgentAvatar";

// ─── Create Custom Agent Modal ────────────────────────────────────────────────

function CreateCustomAgentModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (agent: CustomAgent) => void;
}) {
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("🤖");
  const [role, setRole] = useState("");
  const [persona, setPersona] = useState("");
  const [division, setDivision] = useState("Custom");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleCreate = async () => {
    if (!name.trim()) { setError("Name is required."); return; }
    if (!role.trim()) { setError("Role is required."); return; }
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/advisory/custom-agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), emoji: emoji || "🤖", role: role.trim(), persona: persona.trim(), division }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create agent");
      }
      const data = await res.json();
      onCreated(data.agent);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
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
        zIndex: 250,
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
          maxWidth: "480px",
          maxHeight: "90vh",
          overflowY: "auto",
          padding: "28px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
          <h2 style={{ fontSize: "18px", fontWeight: 700, color: "var(--text-primary)", margin: 0, fontFamily: "var(--font-heading)" }}>
            <UserPlus size={18} style={{ display: "inline", verticalAlign: "text-bottom", marginRight: "8px" }} />
            Create Custom Agent
          </h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: "4px" }}>
            <X size={20} />
          </button>
        </div>

        {/* Name + Emoji row */}
        <div style={{ display: "flex", gap: "10px", marginBottom: "16px" }}>
          <div style={{ flex: 1 }}>
            <label style={{ display: "block", fontSize: "11px", fontWeight: 700, letterSpacing: "0.06em", color: "var(--text-muted)", marginBottom: "6px", fontFamily: "var(--font-mono)" }}>
              NAME
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Nova"
              style={{
                width: "100%",
                padding: "9px 12px",
                backgroundColor: "var(--surface-elevated)",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                color: "var(--text-primary)",
                fontSize: "13px",
                fontFamily: "var(--font-body)",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>
          <div style={{ width: "80px" }}>
            <label style={{ display: "block", fontSize: "11px", fontWeight: 700, letterSpacing: "0.06em", color: "var(--text-muted)", marginBottom: "6px", fontFamily: "var(--font-mono)" }}>
              EMOJI
            </label>
            <input
              type="text"
              value={emoji}
              onChange={(e) => setEmoji(e.target.value)}
              maxLength={4}
              style={{
                width: "100%",
                padding: "9px 12px",
                backgroundColor: "var(--surface-elevated)",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                color: "var(--text-primary)",
                fontSize: "18px",
                fontFamily: "var(--font-body)",
                outline: "none",
                boxSizing: "border-box",
                textAlign: "center",
              }}
            />
          </div>
        </div>

        {/* Role */}
        <div style={{ marginBottom: "16px" }}>
          <label style={{ display: "block", fontSize: "11px", fontWeight: 700, letterSpacing: "0.06em", color: "var(--text-muted)", marginBottom: "6px", fontFamily: "var(--font-mono)" }}>
            ROLE
          </label>
          <input
            type="text"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="e.g., Marketing Director"
            style={{
              width: "100%",
              padding: "9px 12px",
              backgroundColor: "var(--surface-elevated)",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              color: "var(--text-primary)",
              fontSize: "13px",
              fontFamily: "var(--font-body)",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
        </div>

        {/* Division */}
        <div style={{ marginBottom: "16px" }}>
          <label style={{ display: "block", fontSize: "11px", fontWeight: 700, letterSpacing: "0.06em", color: "var(--text-muted)", marginBottom: "6px", fontFamily: "var(--font-mono)" }}>
            DIVISION
          </label>
          <select
            value={division}
            onChange={(e) => setDivision(e.target.value)}
            style={{
              width: "100%",
              padding: "9px 12px",
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
            {DIVISIONS.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>

        {/* Persona */}
        <div style={{ marginBottom: "20px" }}>
          <label style={{ display: "block", fontSize: "11px", fontWeight: 700, letterSpacing: "0.06em", color: "var(--text-muted)", marginBottom: "6px", fontFamily: "var(--font-mono)" }}>
            PERSONA (SYSTEM PROMPT)
          </label>
          <textarea
            value={persona}
            onChange={(e) => setPersona(e.target.value)}
            placeholder="Describe the agent's personality, expertise, and communication style. This becomes their system prompt in advisory sessions..."
            rows={5}
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
              lineHeight: 1.6,
            }}
          />
          <div style={{ fontSize: "10px", color: "var(--text-muted)", marginTop: "4px" }}>
            Optional — agents without a persona will use a generic professional tone
          </div>
        </div>

        {error && (
          <div style={{ marginBottom: "16px", padding: "10px 12px", backgroundColor: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "8px", color: "#ef4444", fontSize: "12px", display: "flex", alignItems: "center", gap: "6px" }}>
            <AlertCircle size={14} />
            {error}
          </div>
        )}

        <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{ padding: "10px 20px", borderRadius: "8px", border: "1px solid var(--border)", backgroundColor: "transparent", color: "var(--text-secondary)", cursor: "pointer", fontSize: "13px", fontWeight: 500 }}
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
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
            {loading ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
            Create Agent
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Launch Wizard ────────────────────────────────────────────────────────────

interface LaunchWizardProps {
  onClose: () => void;
  onLaunch: (session: AdvisorySession) => void;
  customAgents: CustomAgent[];
  onCustomAgentsChange: () => void;
  onDeepDive?: (agentId: string, agentName: string, agentEmoji: string, agentRole: string) => void;
}

export default function LaunchWizard({ onClose, onLaunch, customAgents, onCustomAgentsChange, onDeepDive }: LaunchWizardProps) {
  const [showCreateAgent, setShowCreateAgent] = useState(false);
  const [step, setStep] = useState<"config" | "personas">("config");
  const [agentRatings, setAgentRatings] = useState<Record<string, { up: number; down: number; total: number; pct: number | null; bestTopic: string | null }>>({});

  useEffect(() => {
    fetch("/api/advisory/ratings")
      .then((r) => r.json())
      .then((d) => { if (d.ratings) setAgentRatings(d.ratings); })
      .catch(() => {});
  }, []);
  const [topic, setTopic] = useState("");
  const [referenceContext, setReferenceContext] = useState("");
  const [mode, setMode] = useState<"review" | "roundtable">("roundtable");
  const [selectedAgents, setSelectedAgents] = useState<string[]>(["Henry"]);
  const [reviewStyle, setReviewStyle] = useState<"strict" | "flexible" | "open">("open");
  const [model, setModel] = useState("claude-sonnet-4-6");
  const [rounds, setRounds] = useState<number | "persistent">(3);
  const [pacing, setPacing] = useState<string>("manual"); // default: manual for roundtable
  const [responseLength, setResponseLength] = useState<"concise" | "balanced" | "detailed" | "verbose">("balanced");
  const [extendedThinking, setExtendedThinking] = useState(false);
  // Per-agent overlay map: { agentId: overlayId }
  const [personaOverlays, setPersonaOverlays] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Review Loop specific state
  const [taskListText, setTaskListText] = useState("");
  const [workerAgent, setWorkerAgent] = useState("");
  const [reviewerAgent, setReviewerAgent] = useState("");
  const [supervisorAgent, setSupervisorAgent] = useState("Henry");
  const [autoContinue, setAutoContinue] = useState(true);
  const [maxRetries, setMaxRetries] = useState(3);

  const toggleAgent = (id: string) => {
    setSelectedAgents((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]
    );
    // Clear overlay for deselected agent
    if (selectedAgents.includes(id)) {
      setPersonaOverlays((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  const selectAgentOverlay = (agentId: string, overlayId: string) => {
    setPersonaOverlays((prev) => {
      // Toggle: if already selected, deselect
      if (prev[agentId] === overlayId) {
        const next = { ...prev };
        delete next[agentId];
        return next;
      }
      return { ...prev, [agentId]: overlayId };
    });
  };

  const handleNext = () => {
    if (!topic.trim()) { setError("Mission/Topic is required."); return; }
    if (mode === "review") {
      if (!taskListText.trim()) { setError("Paste a task list for the review loop."); return; }
      if (!workerAgent) { setError("Select a Worker agent."); return; }
      if (!reviewerAgent) { setError("Select a Reviewer agent."); return; }
      if (!supervisorAgent) { setError("Select a Supervisor agent."); return; }
      if (workerAgent === reviewerAgent) { setError("Worker and Reviewer must be different agents."); return; }
    } else {
      if (selectedAgents.length < 1) { setError("Select at least one agent."); return; }
    }
    setError("");
    setStep("personas");
  };

  // Parse task list text into structured tasks
  const parseTaskList = (text: string) => {
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line, idx) => {
        // Strip leading numbers, bullets, dashes, brackets
        const cleaned = line.replace(/^[\d]+[.):\-]\s*/, "").replace(/^[-*•]\s*/, "").replace(/^\[.\]\s*/, "").trim();
        return {
          id: idx + 1,
          description: cleaned || line,
          status: "pending" as const,
          attempts: 0,
          notes: "",
          overriddenBy: null as string | null,
        };
      });
  };

  const handleLaunch = async () => {
    setError("");
    setLoading(true);
    try {
      // Build review loop payload if in review mode
      const reviewLoopPayload = mode === "review" ? {
        tasks: parseTaskList(taskListText),
        currentTaskIndex: 0,
        workerAgent,
        reviewerAgent,
        supervisorAgent,
        supervisorInterval: 5,
        totalApproved: 0,
        totalRejected: 0,
        autoContinue,
        paused: false,
        maxRetries,
      } : undefined;

      // For review mode, agents are the three assigned roles (deduplicated)
      const reviewAgents = mode === "review"
        ? [...new Set([supervisorAgent, workerAgent, reviewerAgent])]
        : selectedAgents;

      // Step 1: Create the session
      const res = await fetch("/api/advisory/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic,
          mode,
          agents: reviewAgents,
          reviewStyle,
          model,
          rounds: mode === "review" ? "persistent" : rounds,
          pacing: mode === "review" ? "instant" : pacing,
          responseLength,
          extendedThinking,
          personaOverlays: Object.keys(personaOverlays).length > 0 ? personaOverlays : undefined,
          referenceContext: referenceContext.trim() || undefined,
          reviewLoop: reviewLoopPayload,
        }),
      });
      if (!res.ok) throw new Error("Failed to create session");
      const data = await res.json();

      // Step 2: For review mode, trigger the loop start; for roundtable, trigger run
      try {
        if (mode === "review" && reviewLoopPayload) {
          await fetch(`/api/advisory/sessions/${data.session.id}/review-loop`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "start" }),
          });
        } else {
          await fetch(`/api/advisory/sessions/${data.session.id}/run`, {
            method: "POST",
          });
        }
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
      onMouseDown={(e) => { if (e.target === e.currentTarget) (e.currentTarget as HTMLElement).dataset.backdropMouseDown = "true"; }}
      onMouseUp={(e) => { if (e.target === e.currentTarget && (e.currentTarget as HTMLElement).dataset.backdropMouseDown === "true") onClose(); (e.currentTarget as HTMLElement).dataset.backdropMouseDown = "false"; }}
      onClick={(e) => e.preventDefault()}
    >
      <div
        className="advisory-modal-inner"
        onMouseDown={(e) => e.stopPropagation()}
        onMouseUp={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
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
            {/* Templates */}
            <div style={{ marginBottom: "20px" }}>
              <label style={{ display: "block", fontSize: "11px", fontWeight: 700, letterSpacing: "0.06em", color: "var(--text-muted)", marginBottom: "8px", fontFamily: "var(--font-mono)" }}>
                USE TEMPLATE
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px" }}>
                {SESSION_TEMPLATES.map((tmpl) => {
                  const Icon = tmpl.icon;
                  const isCustom = tmpl.id === "custom";
                  return (
                    <button
                      key={tmpl.id}
                      onClick={() => {
                        if (!isCustom) {
                          setMode(tmpl.mode);
                          setSelectedAgents(tmpl.agents);
                          setResponseLength(tmpl.responseLength);
                          setRounds(tmpl.rounds);
                          if (tmpl.topic) setTopic(tmpl.topic);
                          setPacing(tmpl.mode === "roundtable" ? "manual" : "instant");
                        } else {
                          setMode("roundtable");
                          setSelectedAgents(["Henry"]);
                          setResponseLength("balanced");
                          setRounds(3);
                          setTopic("");
                          setPacing("manual");
                        }
                        setPersonaOverlays({});
                      }}
                      style={{
                        padding: "10px 8px",
                        borderRadius: "8px",
                        border: `1px solid var(--border)`,
                        backgroundColor: "var(--surface-elevated)",
                        cursor: "pointer",
                        textAlign: "left",
                        transition: "all 150ms ease",
                      }}
                    >
                      <Icon size={14} style={{ color: isCustom ? "var(--text-muted)" : "var(--accent)", marginBottom: "4px" }} />
                      <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-primary)", lineHeight: 1.3, marginBottom: "2px" }}>{tmpl.label}</div>
                      <div style={{ fontSize: "9px", color: "var(--text-muted)", lineHeight: 1.3 }}>{tmpl.desc}</div>
                    </button>
                  );
                })}
              </div>
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

            {/* Reference Documents */}
            <div style={{ marginBottom: "20px" }}>
              <label style={{ display: "block", fontSize: "11px", fontWeight: 700, letterSpacing: "0.06em", color: "var(--text-muted)", marginBottom: "8px", fontFamily: "var(--font-mono)" }}>
                <Paperclip size={10} style={{ display: "inline", verticalAlign: "middle", marginRight: "4px" }} />
                REFERENCE MATERIAL (OPTIONAL)
              </label>
              <textarea
                value={referenceContext}
                onChange={(e) => setReferenceContext(e.target.value.slice(0, 10000))}
                placeholder="Paste reference material — business docs, code snippets, data, or context for the agents..."
                rows={3}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  backgroundColor: "var(--surface-elevated)",
                  border: `1px solid ${referenceContext ? "rgba(139,92,246,0.4)" : "var(--border)"}`,
                  borderRadius: "8px",
                  color: "var(--text-primary)",
                  fontSize: "12px",
                  fontFamily: "var(--font-mono)",
                  resize: "vertical",
                  outline: "none",
                  boxSizing: "border-box",
                  lineHeight: 1.5,
                }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: "4px" }}>
                <div style={{ fontSize: "10px", color: "var(--text-muted)" }}>
                  Included as context for all agents in this session
                </div>
                <div style={{ fontSize: "10px", color: referenceContext.length > 9000 ? "#ef4444" : "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                  {referenceContext.length.toLocaleString()}/10,000
                </div>
              </div>
            </div>

            {/* Mode */}
            <div style={{ marginBottom: "20px" }}>
              <label style={{ display: "block", fontSize: "11px", fontWeight: 700, letterSpacing: "0.06em", color: "var(--text-muted)", marginBottom: "8px", fontFamily: "var(--font-mono)" }}>
                SESSION MODE
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                {[
                  { id: "roundtable", label: "Roundtable", desc: "Open collaborative discussion", icon: "🔄" },
                  { id: "review", label: "Review Loop", desc: "Structured task pipeline with worker/reviewer", icon: "🔄" },
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

            {/* ─── Review Mode: Task List + Role Assignment ─── */}
            {mode === "review" && (
              <>
                {/* Task List */}
                <div style={{ marginBottom: "20px" }}>
                  <label style={{ display: "block", fontSize: "11px", fontWeight: 700, letterSpacing: "0.06em", color: "var(--text-muted)", marginBottom: "8px", fontFamily: "var(--font-mono)" }}>
                    TASK LIST
                  </label>
                  <p style={{ fontSize: "11px", color: "var(--text-muted)", margin: "0 0 8px 0", lineHeight: 1.5 }}>
                    Paste your checklist — one task per line. Numbered lists, bullets, or plain text all work.
                  </p>
                  <textarea
                    value={taskListText}
                    onChange={(e) => setTaskListText(e.target.value)}
                    placeholder={"1. Review authentication flow for security vulnerabilities\n2. Audit database query performance\n3. Check API rate limiting implementation\n4. Verify error handling in payment flow\n5. Review logging and observability setup"}
                    rows={8}
                    style={{
                      width: "100%",
                      padding: "12px",
                      backgroundColor: "var(--surface-elevated)",
                      border: "1px solid var(--border)",
                      borderRadius: "8px",
                      color: "var(--text-primary)",
                      fontSize: "12px",
                      fontFamily: "var(--font-mono)",
                      resize: "vertical",
                      outline: "none",
                      lineHeight: 1.6,
                      boxSizing: "border-box",
                    }}
                  />
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: "6px" }}>
                    <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>
                      {taskListText.trim() ? `${taskListText.split("\n").filter((l) => l.trim()).length} tasks detected` : "No tasks yet"}
                    </span>
                  </div>
                </div>

                {/* Agent Role Assignment */}
                <div style={{ marginBottom: "20px" }}>
                  <label style={{ display: "block", fontSize: "11px", fontWeight: 700, letterSpacing: "0.06em", color: "var(--text-muted)", marginBottom: "8px", fontFamily: "var(--font-mono)" }}>
                    AGENT ROLES
                  </label>
                  <p style={{ fontSize: "11px", color: "var(--text-muted)", margin: "0 0 12px 0", lineHeight: 1.5 }}>
                    Assign which agent plays each role in the review loop.
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    {/* Worker */}
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <div style={{ width: "90px", flexShrink: 0 }}>
                        <span style={{ fontSize: "10px", fontWeight: 700, color: "#60a5fa", fontFamily: "var(--font-mono)", letterSpacing: "0.04em" }}>WORKER</span>
                        <div style={{ fontSize: "9px", color: "var(--text-muted)", marginTop: "1px" }}>Executes tasks</div>
                      </div>
                      <select
                        value={workerAgent}
                        onChange={(e) => setWorkerAgent(e.target.value)}
                        style={{
                          flex: 1,
                          padding: "8px 12px",
                          borderRadius: "8px",
                          border: `1px solid ${workerAgent ? "rgba(96,165,250,0.5)" : "var(--border)"}`,
                          backgroundColor: workerAgent ? "rgba(96,165,250,0.08)" : "var(--surface-elevated)",
                          color: "var(--text-primary)",
                          fontSize: "12px",
                          cursor: "pointer",
                          outline: "none",
                        }}
                      >
                        <option value="">Select worker agent...</option>
                        {AGENTS.map((a) => (
                          <option key={a.id} value={a.id}>{a.emoji} {a.id} — {a.role}</option>
                        ))}
                      </select>
                    </div>
                    {/* Reviewer */}
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <div style={{ width: "90px", flexShrink: 0 }}>
                        <span style={{ fontSize: "10px", fontWeight: 700, color: "#fbbf24", fontFamily: "var(--font-mono)", letterSpacing: "0.04em" }}>REVIEWER</span>
                        <div style={{ fontSize: "9px", color: "var(--text-muted)", marginTop: "1px" }}>Approves/rejects</div>
                      </div>
                      <select
                        value={reviewerAgent}
                        onChange={(e) => setReviewerAgent(e.target.value)}
                        style={{
                          flex: 1,
                          padding: "8px 12px",
                          borderRadius: "8px",
                          border: `1px solid ${reviewerAgent ? "rgba(251,191,36,0.5)" : "var(--border)"}`,
                          backgroundColor: reviewerAgent ? "rgba(251,191,36,0.08)" : "var(--surface-elevated)",
                          color: "var(--text-primary)",
                          fontSize: "12px",
                          cursor: "pointer",
                          outline: "none",
                        }}
                      >
                        <option value="">Select reviewer agent...</option>
                        {AGENTS.filter((a) => a.id !== workerAgent).map((a) => (
                          <option key={a.id} value={a.id}>{a.emoji} {a.id} — {a.role}</option>
                        ))}
                      </select>
                    </div>
                    {/* Supervisor */}
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <div style={{ width: "90px", flexShrink: 0 }}>
                        <span style={{ fontSize: "10px", fontWeight: 700, color: "#fb923c", fontFamily: "var(--font-mono)", letterSpacing: "0.04em" }}>SUPERVISOR</span>
                        <div style={{ fontSize: "9px", color: "var(--text-muted)", marginTop: "1px" }}>Tracks progress</div>
                      </div>
                      <select
                        value={supervisorAgent}
                        onChange={(e) => setSupervisorAgent(e.target.value)}
                        style={{
                          flex: 1,
                          padding: "8px 12px",
                          borderRadius: "8px",
                          border: `1px solid ${supervisorAgent ? "rgba(251,146,60,0.5)" : "var(--border)"}`,
                          backgroundColor: supervisorAgent ? "rgba(251,146,60,0.08)" : "var(--surface-elevated)",
                          color: "var(--text-primary)",
                          fontSize: "12px",
                          cursor: "pointer",
                          outline: "none",
                        }}
                      >
                        <option value="">Select supervisor agent...</option>
                        {AGENTS.map((a) => (
                          <option key={a.id} value={a.id}>{a.emoji} {a.id} — {a.role}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* ─── Roundtable Mode: Agent Selection Grid ─── */}
            {mode === "roundtable" && (
            <>
            <div style={{ marginBottom: "20px" }}>
              <label style={{ display: "block", fontSize: "11px", fontWeight: 700, letterSpacing: "0.06em", color: "var(--text-muted)", marginBottom: "8px", fontFamily: "var(--font-mono)" }}>
                AGENTS ({selectedAgents.length} selected)
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px" }}>
                {AGENTS.map((agent) => {
                  const sel = selectedAgents.includes(agent.id);
                  return (
                    <div key={agent.id} style={{ position: "relative" }}>
                      <button
                        onClick={() => toggleAgent(agent.id)}
                        style={{
                          width: "100%",
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
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                            <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-primary)" }}>{agent.id}</span>
                            {agentRatings[agent.id]?.total > 0 && (
                              <span style={{
                                fontSize: "8px",
                                fontWeight: 700,
                                color: (agentRatings[agent.id].pct ?? 0) >= 70 ? "#4ade80" : (agentRatings[agent.id].pct ?? 0) >= 40 ? "#fbbf24" : "#ef4444",
                                backgroundColor: (agentRatings[agent.id].pct ?? 0) >= 70 ? "rgba(74,222,128,0.12)" : (agentRatings[agent.id].pct ?? 0) >= 40 ? "rgba(251,191,36,0.12)" : "rgba(239,68,68,0.12)",
                                border: `1px solid ${(agentRatings[agent.id].pct ?? 0) >= 70 ? "rgba(74,222,128,0.3)" : (agentRatings[agent.id].pct ?? 0) >= 40 ? "rgba(251,191,36,0.3)" : "rgba(239,68,68,0.3)"}`,
                                padding: "1px 4px",
                                borderRadius: "3px",
                                fontFamily: "var(--font-mono)",
                              }}>
                                {agentRatings[agent.id].pct}%
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: "9px", color: "var(--text-muted)", lineHeight: 1.3, marginTop: "2px" }}>{agent.role}</div>
                        </div>
                      </button>
                      {onDeepDive && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeepDive(agent.id, agent.id, agent.emoji, agent.role);
                          }}
                          title={`Deep Dive with ${agent.id}`}
                          style={{
                            position: "absolute",
                            top: "3px",
                            right: "3px",
                            padding: "2px 5px",
                            borderRadius: "4px",
                            border: "1px solid rgba(16,185,129,0.3)",
                            backgroundColor: "rgba(16,185,129,0.1)",
                            color: "#10b981",
                            cursor: "pointer",
                            fontSize: "8px",
                            fontWeight: 700,
                            display: "flex",
                            alignItems: "center",
                            gap: "3px",
                            transition: "all 150ms ease",
                            letterSpacing: "0.04em",
                          }}
                        >
                          <Focus size={8} />
                          1:1
                        </button>
                      )}
                    </div>
                  );
                })}
                {/* Custom agents */}
                {customAgents.map((agent) => {
                  const sel = selectedAgents.includes(agent.name);
                  return (
                    <button
                      key={agent.id}
                      onClick={() => toggleAgent(agent.name)}
                      style={{
                        padding: "8px 10px",
                        borderRadius: "8px",
                        border: `1px solid ${sel ? "var(--accent)" : "rgba(167,139,250,0.3)"}`,
                        backgroundColor: sel ? "var(--accent-soft)" : "rgba(167,139,250,0.06)",
                        cursor: "pointer",
                        textAlign: "left",
                        transition: "all 150ms ease",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        position: "relative",
                      }}
                    >
                      <div style={{
                        width: 28,
                        height: 28,
                        borderRadius: "50%",
                        backgroundColor: "rgba(167,139,250,0.15)",
                        border: "2px solid rgba(167,139,250,0.4)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "14px",
                        flexShrink: 0,
                      }}>
                        {agent.emoji}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-primary)" }}>{agent.name}</div>
                        <div style={{ fontSize: "9px", color: "var(--text-muted)", lineHeight: 1.3, marginTop: "2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{agent.role}</div>
                      </div>
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          await fetch(`/api/advisory/custom-agents?id=${agent.id}`, { method: "DELETE" });
                          // Remove from selected if selected
                          setSelectedAgents((prev) => prev.filter((a) => a !== agent.name));
                          onCustomAgentsChange();
                        }}
                        title="Delete custom agent"
                        style={{
                          position: "absolute",
                          top: "2px",
                          right: "2px",
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          color: "var(--text-muted)",
                          padding: "2px",
                          opacity: 0.5,
                          fontSize: "10px",
                        }}
                      >
                        <Trash2 size={10} />
                      </button>
                    </button>
                  );
                })}
                {/* Create Custom Agent button */}
                <button
                  onClick={() => setShowCreateAgent(true)}
                  style={{
                    padding: "8px 10px",
                    borderRadius: "8px",
                    border: "1px dashed rgba(167,139,250,0.4)",
                    backgroundColor: "transparent",
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "all 150ms ease",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                  }}
                >
                  <div style={{
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    backgroundColor: "rgba(167,139,250,0.1)",
                    border: "2px dashed rgba(167,139,250,0.3)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}>
                    <UserPlus size={13} color="#a78bfa" />
                  </div>
                  <div>
                    <div style={{ fontSize: "11px", fontWeight: 600, color: "#a78bfa" }}>Create Custom</div>
                    <div style={{ fontSize: "9px", color: "var(--text-muted)", lineHeight: 1.3, marginTop: "2px" }}>Add your own agent</div>
                  </div>
                </button>
              </div>
            </div>

            {/* Create Custom Agent Modal */}
            {showCreateAgent && (
              <CreateCustomAgentModal
                onClose={() => setShowCreateAgent(false)}
                onCreated={(agent) => {
                  setShowCreateAgent(false);
                  onCustomAgentsChange();
                  // Auto-select the newly created agent
                  setSelectedAgents((prev) => [...prev, agent.name]);
                }}
              />
            )}
            </>
            )}

            {/* Review Loop Settings */}
            {mode === "review" && (
              <>
                {/* Auto-Continue Toggle */}
                <div style={{ marginBottom: "16px" }}>
                  <button
                    onClick={() => setAutoContinue((v) => !v)}
                    style={{
                      width: "100%",
                      padding: "12px 14px",
                      borderRadius: "8px",
                      border: `1px solid ${autoContinue ? "rgba(74,222,128,0.5)" : "rgba(251,146,60,0.4)"}`,
                      backgroundColor: autoContinue ? "rgba(74,222,128,0.08)" : "rgba(251,146,60,0.06)",
                      cursor: "pointer",
                      textAlign: "left",
                      transition: "all 150ms ease",
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                    }}
                  >
                    <div
                      style={{
                        width: "40px",
                        height: "22px",
                        borderRadius: "11px",
                        backgroundColor: autoContinue ? "#4ade80" : "#fb923c",
                        position: "relative",
                        transition: "background-color 150ms ease",
                        flexShrink: 0,
                      }}
                    >
                      <div
                        style={{
                          width: "18px",
                          height: "18px",
                          borderRadius: "50%",
                          backgroundColor: "#fff",
                          position: "absolute",
                          top: "2px",
                          left: autoContinue ? "20px" : "2px",
                          transition: "left 150ms ease",
                        }}
                      />
                    </div>
                    <div>
                      <div style={{ fontSize: "12px", fontWeight: 700, color: autoContinue ? "#4ade80" : "#fb923c" }}>
                        Auto-Continue: {autoContinue ? "ON" : "OFF"}
                      </div>
                      <div style={{ fontSize: "10px", color: "var(--text-muted)", marginTop: "2px", lineHeight: 1.4 }}>
                        {autoContinue
                          ? "Loop runs automatically. After reviewer approves, immediately moves to next task. You can pause anytime."
                          : "Loop pauses after each review. You manually click Continue before proceeding to the next task."}
                      </div>
                    </div>
                  </button>
                </div>

                {/* Max Retries */}
                <div style={{ marginBottom: "20px" }}>
                  <label style={{ display: "block", fontSize: "11px", fontWeight: 700, letterSpacing: "0.06em", color: "var(--text-muted)", marginBottom: "8px", fontFamily: "var(--font-mono)" }}>
                    MAX RETRIES PER TASK
                  </label>
                  <div style={{ display: "flex", gap: "6px" }}>
                    {[1, 2, 3, 5].map((n) => (
                      <button
                        key={n}
                        onClick={() => setMaxRetries(n)}
                        style={{
                          flex: 1,
                          padding: "8px",
                          borderRadius: "8px",
                          border: `1px solid ${maxRetries === n ? "var(--accent)" : "var(--border)"}`,
                          backgroundColor: maxRetries === n ? "var(--accent-soft)" : "var(--surface-elevated)",
                          color: maxRetries === n ? "var(--accent)" : "var(--text-primary)",
                          cursor: "pointer",
                          fontSize: "12px",
                          fontWeight: maxRetries === n ? 700 : 500,
                          fontFamily: "var(--font-mono)",
                          transition: "all 150ms ease",
                        }}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                  <div style={{ fontSize: "10px", color: "var(--text-muted)", marginTop: "4px" }}>
                    How many times the worker can retry after reviewer rejects
                  </div>
                </div>
              </>
            )}

            {/* Model */}
            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", fontSize: "11px", fontWeight: 700, letterSpacing: "0.06em", color: "var(--text-muted)", marginBottom: "8px", fontFamily: "var(--font-mono)" }}>
                MODEL
              </label>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {MODELS.map((m) => {
                  const sel = model === m.id;
                  return (
                    <button
                      key={m.id}
                      onClick={() => setModel(m.id)}
                      style={{
                        padding: "10px 12px",
                        borderRadius: "8px",
                        border: `1px solid ${sel ? "var(--accent)" : "var(--border)"}`,
                        backgroundColor: sel ? "var(--accent-soft)" : "var(--surface-elevated)",
                        cursor: "pointer",
                        textAlign: "left",
                        transition: "all 150ms ease",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                      }}
                    >
                      <div>
                        <div style={{ fontSize: "12px", fontWeight: 700, color: sel ? "var(--accent)" : "var(--text-primary)" }}>{m.label}</div>
                        <div style={{ fontSize: "10px", color: "var(--text-muted)", marginTop: "2px" }}>{m.desc}</div>
                      </div>
                      {sel && <span style={{ fontSize: "10px", color: "var(--accent)", fontWeight: 700 }}>✓</span>}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Extended Thinking Toggle */}
            <div style={{ marginBottom: "16px" }}>
              <button
                onClick={() => setExtendedThinking((v) => !v)}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: "8px",
                  border: `1px solid ${extendedThinking ? "rgba(139,92,246,0.5)" : "var(--border)"}`,
                  backgroundColor: extendedThinking ? "rgba(139,92,246,0.1)" : "var(--surface-elevated)",
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "all 150ms ease",
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                }}
              >
                <div
                  style={{
                    width: "36px",
                    height: "20px",
                    borderRadius: "10px",
                    backgroundColor: extendedThinking ? "var(--accent)" : "var(--border)",
                    position: "relative",
                    transition: "background-color 150ms ease",
                    flexShrink: 0,
                  }}
                >
                  <div
                    style={{
                      width: "16px",
                      height: "16px",
                      borderRadius: "50%",
                      backgroundColor: "#fff",
                      position: "absolute",
                      top: "2px",
                      left: extendedThinking ? "18px" : "2px",
                      transition: "left 150ms ease",
                    }}
                  />
                </div>
                <div>
                  <div style={{ fontSize: "12px", fontWeight: 700, color: extendedThinking ? "var(--accent)" : "var(--text-primary)" }}>
                    Extended Thinking
                  </div>
                  <div style={{ fontSize: "10px", color: "var(--text-muted)", marginTop: "1px" }}>
                    Agents show step-by-step reasoning. Slower but deeper analysis.
                  </div>
                </div>
              </button>
            </div>

            {/* Rounds — hidden in review mode (loop manages its own flow) */}
            {mode !== "review" && (
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
            )}

            {/* Response Length */}
            <div style={{ marginBottom: "20px" }}>
              <label style={{ display: "block", fontSize: "11px", fontWeight: 700, letterSpacing: "0.06em", color: "var(--text-muted)", marginBottom: "8px", fontFamily: "var(--font-mono)" }}>
                RESPONSE LENGTH
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
                {[
                  { id: "concise", label: "Concise", desc: "1-2 paragraphs, punchy", tokens: "~1K tokens" },
                  { id: "balanced", label: "Balanced", desc: "2-3 paragraphs, focused", tokens: "~2K tokens", default: true },
                  { id: "detailed", label: "Detailed", desc: "3-5 paragraphs, thorough", tokens: "~3K tokens" },
                  { id: "verbose", label: "Verbose", desc: "Every angle covered", tokens: "~4K tokens" },
                ].map((opt) => {
                  const sel = responseLength === opt.id;
                  return (
                    <button
                      key={opt.id}
                      onClick={() => setResponseLength(opt.id as "concise" | "balanced" | "detailed" | "verbose")}
                      style={{
                        padding: "9px 11px",
                        borderRadius: "8px",
                        border: `1px solid ${sel ? "var(--accent)" : "var(--border)"}`,
                        backgroundColor: sel ? "var(--accent-soft)" : "var(--surface-elevated)",
                        cursor: "pointer",
                        textAlign: "left",
                        transition: "all 150ms ease",
                        position: "relative",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "2px" }}>
                        <div style={{ fontSize: "11px", fontWeight: 700, color: sel ? "var(--accent)" : "var(--text-primary)" }}>{opt.label}</div>
                        {opt.default && (
                          <span style={{ fontSize: "8px", fontWeight: 700, color: "#a78bfa", backgroundColor: "rgba(167,139,250,0.15)", border: "1px solid rgba(167,139,250,0.3)", padding: "1px 4px", borderRadius: "3px" }}>DEFAULT</span>
                        )}
                      </div>
                      <div style={{ fontSize: "10px", color: "var(--text-muted)", lineHeight: 1.3 }}>{opt.desc}</div>
                      <div style={{ fontSize: "9px", color: "var(--text-muted)", opacity: 0.6, fontFamily: "var(--font-mono)", marginTop: "2px" }}>{opt.tokens}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Pacing — hidden in review mode */}
            {mode !== "review" && (
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
            )}

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
                Assign specialized expertise lenses to each agent. Each agent can have at most one overlay — it shapes how they approach and frame their contributions. All are optional.
              </p>

              {/* Per-agent overlay rows */}
              <div style={{ display: "flex", flexDirection: "column", gap: "16px", marginBottom: "16px" }}>
                {selectedAgents.map((agentId) => {
                  const agentDef = AGENTS.find((a) => a.id === agentId);
                  const recommended = (AGENT_RECOMMENDED_OVERLAYS[agentId] || []);
                  const availableOverlays = PERSONA_OVERLAYS_EXTENDED.filter((o) =>
                    recommended.includes(o.id)
                  );
                  const selectedOverlay = personaOverlays[agentId];

                  return (
                    <div
                      key={agentId}
                      style={{
                        padding: "12px",
                        borderRadius: "10px",
                        border: "1px solid var(--border)",
                        backgroundColor: "var(--surface-elevated)",
                      }}
                    >
                      {/* Agent header */}
                      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
                        <AgentAvatar agentId={agentId} size={32} borderWidth={2} />
                        <div>
                          <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-primary)" }}>{agentId}</div>
                          <div style={{ fontSize: "10px", color: "var(--text-muted)" }}>{agentDef?.role ?? "Agent"}</div>
                        </div>
                        {selectedOverlay && (
                          <span style={{
                            marginLeft: "auto",
                            fontSize: "9px",
                            fontWeight: 700,
                            color: "#a78bfa",
                            backgroundColor: "rgba(167,139,250,0.15)",
                            border: "1px solid rgba(167,139,250,0.4)",
                            padding: "2px 8px",
                            borderRadius: "12px",
                          }}>
                            {PERSONA_OVERLAYS_EXTENDED.find(o => o.id === selectedOverlay)?.emoji} {PERSONA_OVERLAYS_EXTENDED.find(o => o.id === selectedOverlay)?.name}
                          </span>
                        )}
                      </div>

                      {/* Overlay chips */}
                      {availableOverlays.length > 0 ? (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                          {availableOverlays.map((overlay) => {
                            const sel = selectedOverlay === overlay.id;
                            return (
                              <button
                                key={overlay.id}
                                onClick={() => selectAgentOverlay(agentId, overlay.id)}
                                title={overlay.desc}
                                style={{
                                  padding: "5px 10px",
                                  borderRadius: "20px",
                                  border: `1px solid ${sel ? "#a78bfa" : "var(--border)"}`,
                                  backgroundColor: sel ? "rgba(167,139,250,0.15)" : "var(--surface)",
                                  color: sel ? "#a78bfa" : "var(--text-muted)",
                                  cursor: "pointer",
                                  fontSize: "10px",
                                  fontWeight: sel ? 700 : 500,
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "4px",
                                  transition: "all 150ms ease",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                <span>{overlay.emoji}</span>
                                <span>{overlay.name}</span>
                                {sel && <span style={{ fontSize: "8px" }}>✕</span>}
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <div style={{ fontSize: "10px", color: "var(--text-muted)", fontStyle: "italic" }}>
                          No recommended overlays for this agent
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {Object.keys(personaOverlays).length > 0 && (
                <div style={{ padding: "8px 12px", backgroundColor: "var(--accent-soft)", border: "1px solid var(--accent)", borderRadius: "8px", marginBottom: "16px" }}>
                  <span style={{ fontSize: "11px", color: "var(--accent)", fontWeight: 600 }}>
                    {Object.keys(personaOverlays).length} agent{Object.keys(personaOverlays).length > 1 ? "s" : ""} have overlays · Each agent gets their assigned lens injected into their system prompt
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
