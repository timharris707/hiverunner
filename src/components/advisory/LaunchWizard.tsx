"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Plus, X, Loader2, AlertCircle, UserPlus, Trash2, Focus, Paperclip, ChevronDown, ChevronRight, Code, Wrench, Bug, Rocket, Search, Sparkles } from "lucide-react";
import type { AdvisorySession, CustomAgent } from "@/types/advisory";
import { AGENTS, PERSONA_OVERLAYS_EXTENDED, AGENT_RECOMMENDED_OVERLAYS, MODELS, PACING_OPTIONS, SESSION_TEMPLATES, DIVISIONS } from "./constants";
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

// ─── Custom Agent Dropdown ────────────────────────────────────────────────────

function AgentDropdown({
  value,
  onChange,
  agents,
  placeholder,
  accentColor,
}: {
  value: string;
  onChange: (id: string) => void;
  agents: { id: string; emoji: string; role: string }[];
  placeholder: string;
  accentColor: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selected = agents.find((a) => a.id === value);

  return (
    <div ref={ref} style={{ flex: 1, position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          width: "100%",
          padding: "8px 12px",
          borderRadius: "8px",
          border: `1px solid ${value ? accentColor : "var(--border)"}`,
          backgroundColor: value ? `${accentColor}12` : "var(--surface-elevated)",
          color: "var(--text-primary)",
          fontSize: "12px",
          cursor: "pointer",
          outline: "none",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          textAlign: "left",
        }}
      >
        {selected ? (
          <>
            <AgentAvatar agentId={selected.id} size={22} borderWidth={1} />
            <span style={{ fontWeight: 600 }}>{selected.id}</span>
            <span style={{ color: "var(--text-muted)", fontSize: "11px" }}>{selected.role}</span>
          </>
        ) : (
          <span style={{ color: "var(--text-muted)" }}>{placeholder}</span>
        )}
        <ChevronDown size={12} style={{ marginLeft: "auto", color: "var(--text-muted)" }} />
      </button>
      {open && (
        <div style={{
          position: "absolute",
          top: "100%",
          left: 0,
          right: 0,
          marginTop: "4px",
          backgroundColor: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "10px",
          boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
          zIndex: 50,
          maxHeight: "240px",
          overflowY: "auto",
          padding: "4px",
        }}>
          {agents.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => { onChange(a.id); setOpen(false); }}
              style={{
                width: "100%",
                padding: "8px 10px",
                borderRadius: "6px",
                border: "none",
                backgroundColor: value === a.id ? "var(--accent-soft)" : "transparent",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "8px",
                textAlign: "left",
                transition: "background-color 100ms",
              }}
              onMouseEnter={(e) => { if (value !== a.id) (e.currentTarget as HTMLElement).style.backgroundColor = "var(--surface-elevated)"; }}
              onMouseLeave={(e) => { if (value !== a.id) (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"; }}
            >
              <AgentAvatar agentId={a.id} size={24} borderWidth={1} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-primary)" }}>{a.id}</div>
                <div style={{ fontSize: "10px", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.role}</div>
              </div>
              {value === a.id && <span style={{ fontSize: "10px", color: "var(--accent)", fontWeight: 700 }}>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Overlay Catalog Modal ───────────────────────────────────────────────────

function OverlayCatalogModal({
  agentId,
  currentOverlays,
  maxOverlays,
  onToggle,
  onClose,
}: {
  agentId: string;
  currentOverlays: string[];
  maxOverlays: number;
  onToggle: (agentId: string, overlayId: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const recommended = AGENT_RECOMMENDED_OVERLAYS[agentId] || [];
  const filtered = PERSONA_OVERLAYS_EXTENDED.filter((o) =>
    o.name.toLowerCase().includes(search.toLowerCase()) ||
    o.desc.toLowerCase().includes(search.toLowerCase())
  );
  // Sort: recommended first, then alphabetical
  const sorted = [...filtered].sort((a, b) => {
    const aRec = recommended.includes(a.id) ? 0 : 1;
    const bRec = recommended.includes(b.id) ? 0 : 1;
    if (aRec !== bRec) return aRec - bRec;
    return a.name.localeCompare(b.name);
  });

  return (
    <div
      style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300, padding: "20px" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)", borderRadius: "16px", width: "100%", maxWidth: "480px", maxHeight: "75vh", display: "flex", flexDirection: "column", overflow: "hidden" }}
      >
        {/* Header */}
        <div style={{ padding: "20px 20px 0", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <AgentAvatar agentId={agentId} size={28} borderWidth={2} />
              <div>
                <h3 style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-primary)", margin: 0, fontFamily: "var(--font-heading)" }}>
                  Add Expertise to {agentId}
                </h3>
                <p style={{ fontSize: "10px", color: "var(--text-muted)", margin: "2px 0 0" }}>
                  {currentOverlays.length}/{maxOverlays} overlays selected
                </p>
              </div>
            </div>
            <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: "4px" }}>
              <X size={18} />
            </button>
          </div>
          {/* Search */}
          <div style={{ position: "relative", marginBottom: "12px" }}>
            <Search size={14} style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search overlays..."
              style={{ width: "100%", padding: "8px 12px 8px 32px", borderRadius: "8px", border: "1px solid var(--border)", backgroundColor: "var(--surface-elevated)", color: "var(--text-primary)", fontSize: "12px", outline: "none", boxSizing: "border-box" }}
            />
          </div>
        </div>
        {/* List */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 20px 20px" }}>
          {sorted.map((overlay) => {
            const isSelected = currentOverlays.includes(overlay.id);
            const isRec = recommended.includes(overlay.id);
            const atMax = currentOverlays.length >= maxOverlays && !isSelected;
            return (
              <button
                key={overlay.id}
                type="button"
                onClick={() => { if (!atMax || isSelected) onToggle(agentId, overlay.id); }}
                disabled={atMax && !isSelected}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: "8px",
                  border: `1px solid ${isSelected ? "#a78bfa" : "var(--border)"}`,
                  backgroundColor: isSelected ? "rgba(167,139,250,0.12)" : "var(--surface-elevated)",
                  cursor: atMax && !isSelected ? "not-allowed" : "pointer",
                  textAlign: "left",
                  marginBottom: "6px",
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "10px",
                  opacity: atMax && !isSelected ? 0.4 : 1,
                  transition: "all 150ms ease",
                }}
              >
                <span style={{ fontSize: "18px", lineHeight: 1, marginTop: "2px" }}>{overlay.emoji}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "2px" }}>
                    <span style={{ fontSize: "12px", fontWeight: 700, color: isSelected ? "#a78bfa" : "var(--text-primary)" }}>{overlay.name}</span>
                    {isRec && (
                      <span style={{ fontSize: "8px", fontWeight: 700, color: "#4ade80", backgroundColor: "rgba(74,222,128,0.12)", border: "1px solid rgba(74,222,128,0.3)", padding: "1px 5px", borderRadius: "3px" }}>
                        RECOMMENDED
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: "11px", color: "var(--text-muted)", lineHeight: 1.4 }}>{overlay.desc}</div>
                </div>
                {isSelected && <span style={{ fontSize: "14px", color: "#a78bfa", fontWeight: 700, marginTop: "2px" }}>✓</span>}
              </button>
            );
          })}
          {sorted.length === 0 && (
            <div style={{ textAlign: "center", padding: "20px", color: "var(--text-muted)", fontSize: "12px" }}>No overlays match your search</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Personality trait definitions ────────────────────────────────────────────

const PERSONALITY_TRAITS = [
  "Skeptical", "Encouraging", "Difficult", "Shy", "Bold",
  "Cautious", "Provocative", "Empathetic", "Analytical", "Creative",
] as const;

const COMM_STYLES = ["Verbose", "Concise", "Thoughtful", "Rapid-fire"] as const;

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
  const [showTemplates, setShowTemplates] = useState(false);
  const [agentRatings, setAgentRatings] = useState<Record<string, { up: number; down: number; total: number; pct: number | null; bestTopic: string | null }>>({});

  useEffect(() => {
    fetch("/api/advisory/ratings")
      .then((r) => r.json())
      .then((d) => { if (d.ratings) setAgentRatings(d.ratings); })
      .catch(() => {});
  }, []);
  const [topic, setTopic] = useState("");
  const [referenceContext, setReferenceContext] = useState("");
  const [mode, setMode] = useState<"review" | "roundtable" | "competitive">("roundtable");
  const [selectedAgents, setSelectedAgents] = useState<string[]>(["Henry"]);
  const [reviewStyle, setReviewStyle] = useState<"strict" | "flexible" | "open">("open");
  const [model, setModel] = useState("claude-sonnet-4-6");
  const [rounds, setRounds] = useState<number | "persistent">(3);
  const [pacing, setPacing] = useState<string>("manual"); // default: manual for roundtable
  const [responseLength, setResponseLength] = useState<"concise" | "balanced" | "detailed" | "verbose">("balanced");
  const [extendedThinking, setExtendedThinking] = useState(false);
  // Per-agent overlay map: { agentId: overlayId[] } — max 2 overlays per agent
  const [personaOverlays, setPersonaOverlays] = useState<Record<string, string[]>>({});
  const [overlayCatalogAgent, setOverlayCatalogAgent] = useState<string | null>(null);
  // Per-agent model overrides: { agentId: modelId } — empty means use session default
  const [agentModelOverrides, setAgentModelOverrides] = useState<Record<string, string>>({});
  // Per-agent personality: traits, communication style, intensity
  const [agentTraits, setAgentTraits] = useState<Record<string, string[]>>({});
  const [agentCommStyles, setAgentCommStyles] = useState<Record<string, string>>({});
  const [agentIntensity, setAgentIntensity] = useState<Record<string, number>>({});
  const [agentResponseLengths, setAgentResponseLengths] = useState<Record<string, string>>({});
  // Track which per-agent personality sections are expanded
  const [expandedPersonality, setExpandedPersonality] = useState<Set<string>>(new Set());
  const MAX_OVERLAYS_PER_AGENT = 2;
  // Moderator selection (roundtable only) — defaults to Henry if present
  const [moderator, setModerator] = useState<string>("Henry");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // AI-generated persona state
  interface AIPersona { id: string; name: string; emoji: string; description: string }
  const [aiPersonas, setAiPersonas] = useState<AIPersona[]>([]);
  const [aiPersonasLoading, setAiPersonasLoading] = useState(false);
  const [aiPersonasCachedTopic, setAiPersonasCachedTopic] = useState("");
  // Click-to-assign: selected persona waiting to be assigned to an agent
  const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(null);
  // Drag-and-drop: persona being dragged
  const [draggingPersonaId, setDraggingPersonaId] = useState<string | null>(null);
  const [dragOverAgentId, setDragOverAgentId] = useState<string | null>(null);

  // Review Loop specific state
  const [taskListText, setTaskListText] = useState("");
  const [workerAgent, setWorkerAgent] = useState("");
  const [reviewerAgent, setReviewerAgent] = useState("");
  const [supervisorAgent, setSupervisorAgent] = useState("Henry");
  const [autoContinue, setAutoContinue] = useState(true);
  const [maxRetries, setMaxRetries] = useState(3);

  // Review-mode specific templates
  const REVIEW_TEMPLATES = [
    { id: "code-build-sprint", label: "Code Build Sprint", desc: "Rapid build-test-ship cycle with structured reviews", icon: Code, agents: { worker: "Pixel", reviewer: "Counsel", supervisor: "Henry" } },
    { id: "refactor-cleanup", label: "Refactor & Cleanup", desc: "Systematic code improvement with quality gates", icon: Wrench, agents: { worker: "Forge", reviewer: "Pixel", supervisor: "Henry" } },
    { id: "bug-fix-checklist", label: "Bug Fix Checklist", desc: "Triage, fix, and verify bugs one by one", icon: Bug, agents: { worker: "Forge", reviewer: "Counsel", supervisor: "Henry" } },
    { id: "feature-implementation", label: "Feature Implementation", desc: "Build features with worker/reviewer approval chain", icon: Rocket, agents: { worker: "Pixel", reviewer: "Forge", supervisor: "Henry" } },
  ];

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

  // Auto-select moderator: Henry if present, else first selected agent
  useEffect(() => {
    if (mode !== "roundtable") return;
    if (selectedAgents.includes("Henry")) {
      setModerator("Henry");
    } else if (selectedAgents.length > 0 && !selectedAgents.includes(moderator)) {
      setModerator(selectedAgents[0]);
    }
  }, [selectedAgents, mode, moderator]);

  const toggleAgentOverlay = (agentId: string, overlayId: string) => {
    setPersonaOverlays((prev) => {
      const current = prev[agentId] || [];
      if (current.includes(overlayId)) {
        // Remove overlay
        const next = current.filter((id) => id !== overlayId);
        if (next.length === 0) {
          const copy = { ...prev };
          delete copy[agentId];
          return copy;
        }
        return { ...prev, [agentId]: next };
      }
      // Add overlay (max 2)
      if (current.length >= MAX_OVERLAYS_PER_AGENT) return prev;
      return { ...prev, [agentId]: [...current, overlayId] };
    });
  };

  // Generate AI personas when entering persona step
  const generateAiPersonas = useCallback(async (topicText: string) => {
    // Don't re-generate if topic hasn't changed
    if (topicText === aiPersonasCachedTopic && aiPersonas.length > 0) return;
    setAiPersonasLoading(true);
    try {
      const res = await fetch("/api/advisory/generate-personas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: topicText }),
      });
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      if (data.personas?.length > 0) {
        setAiPersonas(data.personas);
        setAiPersonasCachedTopic(topicText);
        // Clear static overlays — user will assign AI personas via click or drag
        setPersonaOverlays((prev) => {
          const next = { ...prev };
          for (const agentId of selectedAgents) {
            const current = (next[agentId] || []).filter((id) => id.startsWith("ai-"));
            if (current.length === 0) {
              delete next[agentId];
            } else {
              next[agentId] = current;
            }
          }
          return next;
        });
      }
    } catch {
      // Silently fall back to static list
      console.warn("AI persona generation failed, using static overlays");
    } finally {
      setAiPersonasLoading(false);
    }
  }, [aiPersonasCachedTopic, aiPersonas.length, selectedAgents, MAX_OVERLAYS_PER_AGENT]);

  const handleNext = () => {
    if (!topic.trim()) { setError("Mission/Topic is required."); return; }
    if (mode === "review") {
      if (!taskListText.trim()) { setError("Paste a task list for the review loop."); return; }
      if (!workerAgent) { setError("Select a Worker agent."); return; }
      if (!reviewerAgent) { setError("Select a Reviewer agent."); return; }
      if (!supervisorAgent) { setError("Select a Supervisor agent."); return; }
      if (workerAgent === reviewerAgent) { setError("Worker and Reviewer must be different agents."); return; }
      // Skip persona overlay step for review mode — agents already have assigned roles
      setError("");
      handleLaunch();
      return;
    } else {
      if (selectedAgents.length < 1) { setError("Select at least one agent."); return; }
    }
    setError("");
    setStep("personas");
    generateAiPersonas(topic.trim());
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
          // API expects Record<string, string> — send first overlay per agent for backwards compat
          personaOverlays: Object.keys(personaOverlays).length > 0
            ? Object.fromEntries(Object.entries(personaOverlays).map(([k, v]) => [k, v[0]]).filter(([, v]) => v))
            : undefined,
          // Full multi-overlay data
          personaOverlaysList: Object.keys(personaOverlays).length > 0 ? personaOverlays : undefined,
          // AI persona metadata for system prompts and badge display
          aiPersonas: aiPersonas.length > 0 ? aiPersonas : undefined,
          referenceContext: referenceContext.trim() || undefined,
          reviewLoop: reviewLoopPayload,
          agentModelOverrides: Object.keys(agentModelOverrides).length > 0 ? agentModelOverrides : undefined,
          agentPersonalityTraits: Object.keys(agentTraits).length > 0 ? agentTraits : undefined,
          agentCommunicationStyles: Object.keys(agentCommStyles).length > 0 ? agentCommStyles : undefined,
          agentIntensityLevels: Object.keys(agentIntensity).length > 0 ? agentIntensity : undefined,
          agentResponseLengths: Object.keys(agentResponseLengths).length > 0 ? agentResponseLengths : undefined,
        }),
      });
      if (!res.ok) throw new Error("Failed to create session");
      const data = await res.json();

      // Step 2: For review mode, trigger the loop start; for roundtable, page.handleLaunch handles firing
      try {
        if (mode === "review" && reviewLoopPayload) {
          await fetch(`/api/advisory/sessions/${data.session.id}/review-loop`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "start" }),
          });
        }
        // Roundtable: do NOT call /run here — page.handleLaunch fires next-agent or full-round
        // based on pacing mode, avoiding a race condition where multiple agents fire at once.
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
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          (e.currentTarget as HTMLElement).dataset.backdropMouseDown = "true";
          (e.currentTarget as HTMLElement).dataset.backdropMouseDownX = String(e.clientX);
          (e.currentTarget as HTMLElement).dataset.backdropMouseDownY = String(e.clientY);
        }
      }}
      onMouseUp={(e) => {
        const el = e.currentTarget as HTMLElement;
        // Only close if mouseDown started on backdrop AND ended on backdrop AND didn't drag far
        if (e.target === e.currentTarget && el.dataset.backdropMouseDown === "true") {
          const dx = Math.abs(e.clientX - Number(el.dataset.backdropMouseDownX || 0));
          const dy = Math.abs(e.clientY - Number(el.dataset.backdropMouseDownY || 0));
          if (dx < 5 && dy < 5) onClose();
        }
        el.dataset.backdropMouseDown = "false";
      }}
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
              {step === "config"
                ? mode === "review" ? "Configure review loop" : "Step 1 of 2 — Configure session"
                : "Step 2 of 2 — Persona Overlays (optional)"}
            </p>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: "4px" }}>
            <X size={20} />
          </button>
        </div>

        {/* Step indicator — single bar for review mode (no persona step) */}
        {mode === "review" ? (
          <div style={{ height: "3px", borderRadius: "2px", backgroundColor: "var(--accent)", marginBottom: "20px" }} />
        ) : (
          <div style={{ display: "flex", gap: "6px", marginBottom: "20px" }}>
            {["config", "personas"].map((s, i) => (
              <div key={s} style={{ flex: 1, height: "3px", borderRadius: "2px", backgroundColor: step === s || (i === 0) ? "var(--accent)" : "var(--border)", opacity: step === s ? 1 : i === 0 ? 0.5 : 0.3 }} />
            ))}
          </div>
        )}

        {step === "config" && (
          <>
            {/* Templates — collapsed by default */}
            <div style={{ marginBottom: "20px" }}>
              <button
                onClick={() => setShowTemplates((v) => !v)}
                style={{
                  background: "none", border: "none", cursor: "pointer", padding: "0",
                  display: "flex", alignItems: "center", gap: "6px",
                  fontSize: "11px", fontWeight: 600, color: "var(--accent)",
                }}
              >
                {showTemplates ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                Browse templates
              </button>
              {showTemplates && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginTop: "10px" }}>
                  {mode === "review" ? (
                    /* Review mode templates */
                    REVIEW_TEMPLATES.map((tmpl) => {
                      const Icon = tmpl.icon;
                      return (
                        <button
                          key={tmpl.id}
                          onClick={() => {
                            setWorkerAgent(tmpl.agents.worker);
                            setReviewerAgent(tmpl.agents.reviewer);
                            setSupervisorAgent(tmpl.agents.supervisor);
                            setShowTemplates(false);
                          }}
                          style={{
                            padding: "10px 8px", borderRadius: "8px",
                            border: "1px solid var(--border)", backgroundColor: "var(--surface-elevated)",
                            cursor: "pointer", textAlign: "left", transition: "all 150ms ease",
                          }}
                        >
                          <Icon size={14} style={{ color: "var(--accent)", marginBottom: "4px" }} />
                          <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-primary)", lineHeight: 1.3, marginBottom: "2px" }}>{tmpl.label}</div>
                          <div style={{ fontSize: "9px", color: "var(--text-muted)", lineHeight: 1.3 }}>{tmpl.desc}</div>
                        </button>
                      );
                    })
                  ) : (
                    /* Roundtable templates */
                    SESSION_TEMPLATES.map((tmpl) => {
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
                            setShowTemplates(false);
                          }}
                          style={{
                            padding: "10px 8px", borderRadius: "8px",
                            border: "1px solid var(--border)", backgroundColor: "var(--surface-elevated)",
                            cursor: "pointer", textAlign: "left", transition: "all 150ms ease",
                          }}
                        >
                          <Icon size={14} style={{ color: isCustom ? "var(--text-muted)" : "var(--accent)", marginBottom: "4px" }} />
                          <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-primary)", lineHeight: 1.3, marginBottom: "2px" }}>{tmpl.label}</div>
                          <div style={{ fontSize: "9px", color: "var(--text-muted)", lineHeight: 1.3 }}>{tmpl.desc}</div>
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </div>

            {/* Mission/Topic */}
            <div style={{ marginBottom: "20px" }}>
              <label style={{ display: "block", fontSize: "11px", fontWeight: 700, letterSpacing: "0.06em", color: "var(--text-muted)", marginBottom: "8px", fontFamily: "var(--font-mono)" }}>
                MISSION / TOPIC
              </label>
              <textarea
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                onDoubleClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                placeholder={mode === "roundtable"
                  ? "e.g., Should we pivot our crypto strategy to focus on DeFi protocols?\ne.g., Plan the Q2 product launch — marketing, engineering, and legal angles\ne.g., Evaluate whether to build or buy our data pipeline"
                  : "e.g., Review and improve our API error handling across all endpoints\ne.g., Audit the authentication flow for security vulnerabilities\ne.g., Refactor the payment module for better test coverage"
                }
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
                onDoubleClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
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
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
                {[
                  { id: "roundtable", label: "Roundtable", desc: "Open collaborative discussion", icon: "🔄" },
                  { id: "competitive", label: "Competitive", desc: "Agents pitch, debate & vote on best idea", icon: "⚔️" },
                  { id: "review", label: "Review Loop", desc: "Structured task pipeline with worker/reviewer", icon: "🔄" },
                ].map((m) => (
                  <button
                    key={m.id}
                    onClick={() => {
                      setMode(m.id as "review" | "roundtable" | "competitive");
                      // Set sensible default pacing per mode
                      setPacing(m.id === "roundtable" ? "manual" : "instant");
                      // Auto-fill topic for review mode if empty
                      if (m.id === "review" && !topic.trim()) {
                        setTopic("Work through the task list below");
                      }
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

            {/* ─── Competitive Mode: Pitch Card ─── */}
            {mode === "competitive" && (
              <div style={{
                marginBottom: "20px",
                padding: "16px 18px",
                borderRadius: "10px",
                border: "1px solid rgba(251,191,36,0.35)",
                backgroundColor: "rgba(251,191,36,0.04)",
              }}>
                <div style={{ fontSize: "13px", fontWeight: 700, color: "#fbbf24", marginBottom: "6px", fontFamily: "var(--font-heading)", letterSpacing: "-0.01em" }}>
                  ⚔️ 5 AI advisors. 5 wild ideas. 1 winner.
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                  {[
                    { round: "Round 1", icon: "🎯", label: "PITCH", desc: "Each agent pitches their boldest, most original idea" },
                    { round: "Round 2", icon: "🔥", label: "CRITIQUE", desc: "Agents tear each other's pitches apart by name" },
                    { round: "Round 3", icon: "🗳️", label: "VOTE", desc: "Agents vote for the best idea — not their own" },
                    { round: "Final", icon: "🏆", label: "RESULTS", desc: "Ranked leaderboard with vote counts and reasoning" },
                  ].map((r) => (
                    <div key={r.round} style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
                      <span style={{ fontSize: "9px", fontWeight: 700, color: "var(--text-muted)", fontFamily: "var(--font-mono)", minWidth: "50px" }}>{r.round}</span>
                      <span style={{ fontSize: "9px" }}>{r.icon}</span>
                      <span style={{ fontSize: "10px", fontWeight: 700, color: "#fbbf24", fontFamily: "var(--font-mono)", minWidth: "58px" }}>{r.label}</span>
                      <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>{r.desc}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

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
                    onDoubleClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
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
                      <AgentDropdown
                        value={workerAgent}
                        onChange={setWorkerAgent}
                        agents={AGENTS}
                        placeholder="Select worker agent..."
                        accentColor="rgba(96,165,250,0.5)"
                      />
                    </div>
                    {/* Reviewer */}
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <div style={{ width: "90px", flexShrink: 0 }}>
                        <span style={{ fontSize: "10px", fontWeight: 700, color: "#fbbf24", fontFamily: "var(--font-mono)", letterSpacing: "0.04em" }}>REVIEWER</span>
                        <div style={{ fontSize: "9px", color: "var(--text-muted)", marginTop: "1px" }}>Approves/rejects</div>
                      </div>
                      <AgentDropdown
                        value={reviewerAgent}
                        onChange={setReviewerAgent}
                        agents={AGENTS.filter((a) => a.id !== workerAgent)}
                        placeholder="Select reviewer agent..."
                        accentColor="rgba(251,191,36,0.5)"
                      />
                    </div>
                    {/* Supervisor */}
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <div style={{ width: "90px", flexShrink: 0 }}>
                        <span style={{ fontSize: "10px", fontWeight: 700, color: "#fb923c", fontFamily: "var(--font-mono)", letterSpacing: "0.04em" }}>SUPERVISOR</span>
                        <div style={{ fontSize: "9px", color: "var(--text-muted)", marginTop: "1px" }}>Tracks progress</div>
                      </div>
                      <AgentDropdown
                        value={supervisorAgent}
                        onChange={setSupervisorAgent}
                        agents={AGENTS}
                        placeholder="Select supervisor agent..."
                        accentColor="rgba(251,146,60,0.5)"
                      />
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
                  fontFamily: "var(--font-heading)",
                  opacity: loading ? 0.7 : 1,
                }}
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                {mode === "review" ? "Launch Review Loop" : "Next: Persona Overlays →"}
              </button>
            </div>
          </>
        )}

        {step === "personas" && (
          <>
            <div style={{ marginBottom: "8px" }}>
              <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: "0 0 16px 0", lineHeight: 1.6 }}>
                Add specialized expertise to each agent. Click a persona to select it, then click an agent to assign — or drag and drop. Up to {MAX_OVERLAYS_PER_AGENT} overlays per agent.
              </p>

              {/* AI-Generated Personas Section */}
              {aiPersonasLoading && (
                <div
                  style={{
                    padding: "20px",
                    borderRadius: "12px",
                    border: "1px solid rgba(168,85,247,0.3)",
                    background: "linear-gradient(135deg, rgba(168,85,247,0.06) 0%, rgba(139,92,246,0.04) 100%)",
                    marginBottom: "20px",
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                  }}
                >
                  <div style={{ display: "flex", gap: "6px" }}>
                    {[0, 1, 2, 3].map((i) => (
                      <div
                        key={i}
                        style={{
                          width: "8px",
                          height: "8px",
                          borderRadius: "50%",
                          backgroundColor: "#a855f7",
                          opacity: 0.4,
                          animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
                        }}
                      />
                    ))}
                  </div>
                  <span style={{ fontSize: "12px", color: "#c084fc", fontWeight: 600 }}>
                    <Sparkles size={12} style={{ display: "inline", verticalAlign: "text-bottom", marginRight: "4px" }} />
                    Generating expert recommendations for your topic...
                  </span>
                  <style>{`@keyframes pulse { 0%, 100% { opacity: 0.3; transform: scale(0.8); } 50% { opacity: 1; transform: scale(1.2); } }`}</style>
                </div>
              )}

              {aiPersonas.length > 0 && !aiPersonasLoading && (
                <div style={{ marginBottom: "20px", animation: "fadeInUp 0.4s ease-out" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
                    <Sparkles size={14} style={{ color: "#a855f7" }} />
                    <span style={{ fontSize: "11px", fontWeight: 700, color: "#c084fc", letterSpacing: "0.06em", fontFamily: "var(--font-mono)" }}>
                      AI GENERATED FOR YOUR TOPIC
                    </span>
                  </div>
                  {selectedPersonaId && (
                    <div style={{
                      padding: "8px 12px",
                      marginBottom: "8px",
                      borderRadius: "8px",
                      backgroundColor: "rgba(168,85,247,0.1)",
                      border: "1px solid rgba(168,85,247,0.3)",
                      fontSize: "11px",
                      color: "#c084fc",
                      fontWeight: 600,
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                    }}>
                      <span>Click an agent below to assign &quot;{aiPersonas.find(p => p.id === selectedPersonaId)?.name ?? PERSONA_OVERLAYS_EXTENDED.find(o => o.id === selectedPersonaId)?.name ?? selectedPersonaId}&quot;</span>
                      <button
                        onClick={() => setSelectedPersonaId(null)}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "#c084fc", fontSize: "10px", padding: "2px 6px", borderRadius: "4px", backgroundColor: "rgba(168,85,247,0.15)" }}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "8px" }}>
                    {aiPersonas.map((persona) => {
                      const isUsed = Object.values(personaOverlays).flat().includes(persona.id);
                      const isHighlighted = selectedPersonaId === persona.id;
                      return (
                        <button
                          key={persona.id}
                          type="button"
                          draggable
                          onDragStart={(e) => {
                            setDraggingPersonaId(persona.id);
                            setSelectedPersonaId(null);
                            e.dataTransfer.effectAllowed = "copy";
                            e.dataTransfer.setData("text/plain", persona.id);
                          }}
                          onDragEnd={() => {
                            setDraggingPersonaId(null);
                            setDragOverAgentId(null);
                          }}
                          onClick={() => {
                            // Toggle highlight for click-to-assign
                            setSelectedPersonaId((prev) => prev === persona.id ? null : persona.id);
                          }}
                          style={{
                            padding: "12px",
                            borderRadius: "10px",
                            border: `1px solid ${isHighlighted ? "#a855f7" : isUsed ? "rgba(168,85,247,0.5)" : "rgba(168,85,247,0.2)"}`,
                            background: isHighlighted
                              ? "linear-gradient(135deg, rgba(168,85,247,0.25) 0%, rgba(139,92,246,0.18) 100%)"
                              : isUsed
                                ? "linear-gradient(135deg, rgba(168,85,247,0.15) 0%, rgba(139,92,246,0.1) 100%)"
                                : "linear-gradient(135deg, rgba(168,85,247,0.05) 0%, rgba(139,92,246,0.02) 100%)",
                            cursor: draggingPersonaId ? "grabbing" : "grab",
                            textAlign: "left",
                            transition: "all 200ms ease",
                            position: "relative",
                            overflow: "hidden",
                            boxShadow: isHighlighted ? "0 0 12px rgba(168,85,247,0.3)" : "none",
                            transform: isHighlighted ? "scale(1.02)" : "none",
                          }}
                        >
                          {/* Purple glow accent */}
                          <div style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            right: 0,
                            height: "2px",
                            background: "linear-gradient(90deg, #a855f7, #7c3aed, #a855f7)",
                            opacity: isHighlighted ? 1 : isUsed ? 1 : 0.4,
                          }} />
                          <div style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
                            <span style={{ fontSize: "22px", lineHeight: 1 }}>{persona.emoji}</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "3px" }}>
                                <span style={{ fontSize: "11px", fontWeight: 700, color: isHighlighted || isUsed ? "#c084fc" : "var(--text-primary)" }}>
                                  {persona.name}
                                </span>
                                <span style={{
                                  fontSize: "7px",
                                  fontWeight: 700,
                                  color: "#a855f7",
                                  backgroundColor: "rgba(168,85,247,0.15)",
                                  border: "1px solid rgba(168,85,247,0.3)",
                                  padding: "1px 4px",
                                  borderRadius: "3px",
                                  letterSpacing: "0.04em",
                                }}>
                                  AI GENERATED
                                </span>
                              </div>
                              <div style={{ fontSize: "10px", color: "var(--text-muted)", lineHeight: 1.4 }}>
                                {persona.description}
                              </div>
                            </div>
                            {isHighlighted && <span style={{ fontSize: "12px", color: "#a855f7", fontWeight: 700 }}>⎋</span>}
                            {!isHighlighted && isUsed && <span style={{ fontSize: "12px", color: "#a855f7", fontWeight: 700 }}>✓</span>}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {/* Divider */}
                  <div style={{ display: "flex", alignItems: "center", gap: "12px", margin: "18px 0 4px" }}>
                    <div style={{ flex: 1, height: "1px", backgroundColor: "var(--border)" }} />
                    <span style={{ fontSize: "10px", color: "var(--text-muted)", fontWeight: 500, whiteSpace: "nowrap" }}>or choose from library</span>
                    <div style={{ flex: 1, height: "1px", backgroundColor: "var(--border)" }} />
                  </div>
                  <style>{`@keyframes fadeInUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }`}</style>
                </div>
              )}

              {/* Per-agent overlay rows */}
              <div style={{ display: "flex", flexDirection: "column", gap: "16px", marginBottom: "16px" }}>
                {selectedAgents.map((agentId) => {
                  const agentDef = AGENTS.find((a) => a.id === agentId);
                  const agentOverlays = personaOverlays[agentId] || [];
                  const isDragOver = dragOverAgentId === agentId;
                  const isClickTarget = !!selectedPersonaId;
                  const canReceive = agentOverlays.length < MAX_OVERLAYS_PER_AGENT;

                  return (
                    <div
                      key={agentId}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = canReceive ? "copy" : "none";
                        setDragOverAgentId(agentId);
                      }}
                      onDragLeave={() => {
                        setDragOverAgentId((prev) => prev === agentId ? null : prev);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDragOverAgentId(null);
                        setDraggingPersonaId(null);
                        const overlayId = e.dataTransfer.getData("text/plain");
                        if (overlayId && canReceive && !agentOverlays.includes(overlayId)) {
                          toggleAgentOverlay(agentId, overlayId);
                        }
                      }}
                      onClick={() => {
                        if (selectedPersonaId && canReceive && !agentOverlays.includes(selectedPersonaId)) {
                          toggleAgentOverlay(agentId, selectedPersonaId);
                          setSelectedPersonaId(null);
                        }
                      }}
                      style={{
                        padding: "12px",
                        borderRadius: "10px",
                        border: `1px solid ${isDragOver && canReceive ? "#a855f7" : isClickTarget && canReceive ? "rgba(168,85,247,0.5)" : "var(--border)"}`,
                        backgroundColor: isDragOver && canReceive ? "rgba(168,85,247,0.08)" : "var(--surface-elevated)",
                        cursor: isClickTarget && canReceive ? "pointer" : "default",
                        transition: "all 200ms ease",
                        boxShadow: isDragOver && canReceive ? "0 0 16px rgba(168,85,247,0.2)" : "none",
                      }}
                    >
                      {/* Agent header */}
                      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
                        <AgentAvatar agentId={agentId} size={32} borderWidth={2} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-primary)" }}>{agentId}</div>
                          <div style={{ fontSize: "10px", color: "var(--text-muted)" }}>{agentDef?.role ?? "Agent"}</div>
                        </div>
                        {/* Per-agent model selector */}
                        <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "2px" }}>
                          <span style={{ fontSize: "9px", fontWeight: 600, color: "var(--text-muted)", letterSpacing: "0.5px", textTransform: "uppercase" }}>Model</span>
                          <select
                            value={agentModelOverrides[agentId] || ""}
                            onChange={(e) => {
                              const val = e.target.value;
                              setAgentModelOverrides((prev) => {
                                if (!val) {
                                  const next = { ...prev };
                                  delete next[agentId];
                                  return next;
                                }
                                return { ...prev, [agentId]: val };
                              });
                            }}
                            style={{
                              padding: "4px 8px",
                              borderRadius: "6px",
                              border: `1px solid ${agentModelOverrides[agentId] ? "rgba(139,92,246,0.5)" : "var(--border)"}`,
                              backgroundColor: agentModelOverrides[agentId] ? "rgba(139,92,246,0.08)" : "var(--surface)",
                              color: agentModelOverrides[agentId] ? "#a78bfa" : "var(--text-muted)",
                              fontSize: "10px",
                              fontWeight: agentModelOverrides[agentId] ? 700 : 500,
                              fontFamily: "var(--font-mono)",
                              cursor: "pointer",
                              outline: "none",
                              maxWidth: "150px",
                            }}
                          >
                            <option value="">Session Default</option>
                            {MODELS.map((m) => (
                              <option key={m.id} value={m.id}>{m.label}</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {/* Selected overlay badges */}
                      {agentOverlays.length > 0 && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "8px" }}>
                          {agentOverlays.map((oId) => {
                            const overlay = PERSONA_OVERLAYS_EXTENDED.find((o) => o.id === oId);
                            const aiOverlay = aiPersonas.find((p) => p.id === oId);
                            const displayEmoji = overlay?.emoji ?? aiOverlay?.emoji ?? "🤖";
                            const displayName = overlay?.name ?? aiOverlay?.name ?? oId;
                            const isAi = !overlay && !!aiOverlay;
                            return (
                              <span
                                key={oId}
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "4px",
                                  padding: "3px 10px",
                                  borderRadius: "12px",
                                  backgroundColor: isAi ? "rgba(168,85,247,0.15)" : "rgba(167,139,250,0.15)",
                                  border: `1px solid ${isAi ? "rgba(168,85,247,0.4)" : "rgba(167,139,250,0.4)"}`,
                                  fontSize: "10px",
                                  fontWeight: 700,
                                  color: isAi ? "#c084fc" : "#a78bfa",
                                }}
                              >
                                {displayEmoji} {displayName}
                                {isAi && <span style={{ fontSize: "7px", opacity: 0.7 }}>AI</span>}
                                <button
                                  onClick={() => toggleAgentOverlay(agentId, oId)}
                                  style={{ background: "none", border: "none", cursor: "pointer", color: isAi ? "#c084fc" : "#a78bfa", padding: "0 0 0 2px", fontSize: "10px", lineHeight: 1 }}
                                >
                                  ✕
                                </button>
                              </span>
                            );
                          })}
                        </div>
                      )}

                      {/* Add overlay button */}
                      {agentOverlays.length < MAX_OVERLAYS_PER_AGENT && (
                        <button
                          onClick={() => setOverlayCatalogAgent(agentId)}
                          style={{
                            padding: "6px 12px",
                            borderRadius: "20px",
                            border: "1px dashed rgba(167,139,250,0.4)",
                            backgroundColor: "transparent",
                            color: "#a78bfa",
                            cursor: "pointer",
                            fontSize: "10px",
                            fontWeight: 600,
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                            transition: "all 150ms ease",
                          }}
                        >
                          <Plus size={10} />
                          Add Expertise
                        </button>
                      )}

                      {/* Personality traits section */}
                      <div style={{ marginTop: "10px", borderTop: "1px solid rgba(148,163,184,0.12)", paddingTop: "10px" }}>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedPersonality((prev) => {
                              const next = new Set(prev);
                              if (next.has(agentId)) next.delete(agentId); else next.add(agentId);
                              return next;
                            });
                          }}
                          style={{
                            background: "none", border: "none", cursor: "pointer",
                            display: "flex", alignItems: "center", gap: "6px",
                            fontSize: "10px", fontWeight: 600, color: "var(--text-muted)", padding: 0,
                          }}
                        >
                          {expandedPersonality.has(agentId) ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                          Personality
                          {(agentTraits[agentId]?.length || agentCommStyles[agentId] || agentIntensity[agentId] != null || agentResponseLengths[agentId]) && (
                            <span style={{ fontSize: "7px", fontWeight: 700, color: "#f59e0b", backgroundColor: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.3)", padding: "1px 5px", borderRadius: "3px" }}>
                              CONFIGURED
                            </span>
                          )}
                        </button>

                        {expandedPersonality.has(agentId) && (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            onMouseDown={(e) => e.stopPropagation()}
                            style={{ marginTop: "10px", display: "flex", flexDirection: "column", gap: "12px" }}
                          >
                            {/* Trait pills */}
                            <div>
                              <div style={{ fontSize: "9px", fontWeight: 700, letterSpacing: "0.06em", color: "var(--text-muted)", marginBottom: "6px", fontFamily: "var(--font-mono)" }}>
                                TRAITS (multi-select)
                              </div>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
                                {PERSONALITY_TRAITS.map((trait) => {
                                  const isOn = (agentTraits[agentId] || []).includes(trait);
                                  return (
                                    <button
                                      key={trait}
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setAgentTraits((prev) => {
                                          const curr = prev[agentId] || [];
                                          const next = isOn ? curr.filter((t) => t !== trait) : [...curr, trait];
                                          if (next.length === 0) { const copy = { ...prev }; delete copy[agentId]; return copy; }
                                          return { ...prev, [agentId]: next };
                                        });
                                      }}
                                      style={{
                                        padding: "3px 9px",
                                        borderRadius: "12px",
                                        border: `1px solid ${isOn ? "rgba(251,191,36,0.6)" : "var(--border)"}`,
                                        backgroundColor: isOn ? "rgba(251,191,36,0.12)" : "var(--surface)",
                                        color: isOn ? "#fbbf24" : "var(--text-muted)",
                                        cursor: "pointer",
                                        fontSize: "10px",
                                        fontWeight: isOn ? 700 : 500,
                                        transition: "all 120ms ease",
                                      }}
                                    >
                                      {trait}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>

                            {/* Communication style */}
                            <div>
                              <div style={{ fontSize: "9px", fontWeight: 700, letterSpacing: "0.06em", color: "var(--text-muted)", marginBottom: "6px", fontFamily: "var(--font-mono)" }}>
                                COMMUNICATION STYLE
                              </div>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
                                {COMM_STYLES.map((style) => {
                                  const isOn = agentCommStyles[agentId] === style;
                                  return (
                                    <button
                                      key={style}
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setAgentCommStyles((prev) => {
                                          if (isOn) { const copy = { ...prev }; delete copy[agentId]; return copy; }
                                          return { ...prev, [agentId]: style };
                                        });
                                      }}
                                      style={{
                                        padding: "3px 9px",
                                        borderRadius: "12px",
                                        border: `1px solid ${isOn ? "rgba(52,211,153,0.6)" : "var(--border)"}`,
                                        backgroundColor: isOn ? "rgba(52,211,153,0.12)" : "var(--surface)",
                                        color: isOn ? "#34d399" : "var(--text-muted)",
                                        cursor: "pointer",
                                        fontSize: "10px",
                                        fontWeight: isOn ? 700 : 500,
                                        transition: "all 120ms ease",
                                      }}
                                    >
                                      {style}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>

                            {/* Intensity slider */}
                            <div>
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                                <div style={{ fontSize: "9px", fontWeight: 700, letterSpacing: "0.06em", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                                  INTENSITY
                                </div>
                                <div style={{ fontSize: "10px", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                                  {agentIntensity[agentId] != null
                                    ? `${agentIntensity[agentId]}/10 · ${agentIntensity[agentId] <= 3 ? "Gentle" : agentIntensity[agentId] <= 6 ? "Moderate" : agentIntensity[agentId] <= 8 ? "Assertive" : "Aggressive"}`
                                    : "default"}
                                </div>
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                <span style={{ fontSize: "9px", color: "var(--text-muted)" }}>Gentle</span>
                                <input
                                  type="range"
                                  min={1}
                                  max={10}
                                  step={1}
                                  value={agentIntensity[agentId] ?? 5}
                                  onChange={(e) => {
                                    const val = Number(e.target.value);
                                    setAgentIntensity((prev) => ({ ...prev, [agentId]: val }));
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                  onMouseDown={(e) => e.stopPropagation()}
                                  style={{ flex: 1, accentColor: "#f59e0b", cursor: "pointer" }}
                                />
                                <span style={{ fontSize: "9px", color: "var(--text-muted)" }}>Aggressive</span>
                                {agentIntensity[agentId] != null && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setAgentIntensity((prev) => { const copy = { ...prev }; delete copy[agentId]; return copy; });
                                    }}
                                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: "10px", padding: "0 2px" }}
                                    title="Reset to default"
                                  >✕</button>
                                )}
                              </div>
                            </div>

                            {/* Per-agent response length */}
                            <div>
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                                <div style={{ fontSize: "9px", fontWeight: 700, letterSpacing: "0.06em", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                                  RESPONSE LENGTH
                                </div>
                                {agentResponseLengths[agentId] && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setAgentResponseLengths((prev) => { const copy = { ...prev }; delete copy[agentId]; return copy; });
                                    }}
                                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: "10px", padding: "0 2px" }}
                                    title="Use session default"
                                  >✕ reset</button>
                                )}
                              </div>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
                                {([
                                  { id: "concise", label: "Concise", desc: "2–3 sentences" },
                                  { id: "balanced", label: "Balanced", desc: "~200 words" },
                                  { id: "detailed", label: "Detailed", desc: "~400 words" },
                                  { id: "verbose", label: "Verbose", desc: "deep dive" },
                                ] as const).map((opt) => {
                                  const isOn = agentResponseLengths[agentId] === opt.id;
                                  return (
                                    <button
                                      key={opt.id}
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setAgentResponseLengths((prev) => {
                                          if (isOn) { const copy = { ...prev }; delete copy[agentId]; return copy; }
                                          return { ...prev, [agentId]: opt.id };
                                        });
                                      }}
                                      title={opt.desc}
                                      style={{
                                        padding: "3px 9px",
                                        borderRadius: "12px",
                                        border: `1px solid ${isOn ? "rgba(99,179,237,0.6)" : "var(--border)"}`,
                                        backgroundColor: isOn ? "rgba(99,179,237,0.12)" : "var(--surface)",
                                        color: isOn ? "#63b3ed" : "var(--text-muted)",
                                        cursor: "pointer",
                                        fontSize: "10px",
                                        fontWeight: isOn ? 700 : 500,
                                        transition: "all 120ms ease",
                                      }}
                                    >
                                      {opt.label}
                                    </button>
                                  );
                                })}
                              </div>
                              {!agentResponseLengths[agentId] && (
                                <div style={{ fontSize: "9px", color: "var(--text-muted)", marginTop: "4px", fontFamily: "var(--font-mono)" }}>
                                  using session default
                                </div>
                              )}
                            </div>

                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {Object.keys(personaOverlays).length > 0 && (
                <div style={{ padding: "8px 12px", backgroundColor: "rgba(148,163,184,0.08)", border: "1px solid rgba(148,163,184,0.2)", borderRadius: "8px", marginBottom: "16px" }}>
                  <span style={{ fontSize: "11px", color: "rgba(148,163,184,0.7)", fontWeight: 500 }}>
                    {Object.values(personaOverlays).flat().length} overlay{Object.values(personaOverlays).flat().length > 1 ? "s" : ""} across {Object.keys(personaOverlays).length} agent{Object.keys(personaOverlays).length > 1 ? "s" : ""} · Each overlay is injected into the agent&apos;s system prompt
                  </span>
                </div>
              )}
            </div>

            {/* Overlay Catalog Modal */}
            {overlayCatalogAgent && (
              <OverlayCatalogModal
                agentId={overlayCatalogAgent}
                currentOverlays={personaOverlays[overlayCatalogAgent] || []}
                maxOverlays={MAX_OVERLAYS_PER_AGENT}
                onToggle={toggleAgentOverlay}
                onClose={() => setOverlayCatalogAgent(null)}
              />
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
