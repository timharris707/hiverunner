"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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
  RefreshCw,
  Copy,
  Download,
  Archive,
  Pause,
  Play,
  ChevronRight,
  ChevronDown,
  RotateCcw,
  Search,
  FileDown,
  TrendingUp,
  Rocket,
  Shield,
  Cpu,
  Megaphone,
  Settings,
  UserPlus,
  Trash2,
  GitBranch,
  Focus,
  ThumbsUp,
  ThumbsDown,
  BarChart3,
  Columns2,
  Lightbulb,
  Clock,
  AlertTriangle,
  Paperclip,
  Calendar,
} from "lucide-react";
import { exportSessionAsPDF } from "@/components/AdvisoryPDFExport";
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
  error?: boolean;
}

interface ActionItem {
  description: string;
  assignedAgent: string;
  priority: "high" | "medium" | "low";
  status: "pending" | "done";
}

interface SessionInsights {
  actionItems: ActionItem[];
  keyDecisions: string[];
  openQuestions: string[];
  risksIdentified: string[];
  extractedAt: string;
}

interface AdvisorySession {
  id: string;
  topic: string;
  title?: string;
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
  lastError?: string;
  insights?: SessionInsights | null;
  referenceContext?: string;
  reviewLoop?: ReviewLoopState | null;
}

interface ReviewTaskState {
  id: number;
  description: string;
  status: "pending" | "in-progress" | "in-review" | "approved" | "rejected" | "retrying" | "blocked";
  attempts: number;
  notes: string;
  overriddenBy: string | null;
  workerOutput?: string;
  reviewerFeedback?: string;
}

interface ReviewLoopState {
  tasks: ReviewTaskState[];
  currentTaskIndex: number;
  workerAgent: string;
  reviewerAgent: string;
  supervisorAgent: string;
  supervisorInterval: number;
  totalApproved: number;
  totalRejected: number;
  autoContinue: boolean;
  paused: boolean;
  maxRetries: number;
}

interface CustomAgent {
  id: string;
  name: string;
  emoji: string;
  role: string;
  persona: string;
  division: string;
  createdAt: string;
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
  { id: "claude-sonnet-4-6", label: "Claude Sonnet (Fast)", desc: "Best speed / cost ratio. Great for most sessions." },
  { id: "claude-opus-4-6", label: "Claude Opus (Deep)", desc: "Most capable. Slower but higher quality reasoning." },
  { id: "gpt-5.4", label: "GPT-5.4 (Alternative)", desc: "OpenAI alternative. Different reasoning style." },
];

// Per-agent recommended overlays
const AGENT_RECOMMENDED_OVERLAYS: Record<string, string[]> = {
  Atlas: ["trading-strategist", "data-analytics-reporter"],
  Nimbus: ["trading-strategist", "data-analytics-reporter"],
  Cipher: ["trading-strategist", "data-analytics-reporter"],
  Quant: ["trading-strategist", "data-analytics-reporter"],
  Forge: ["security-engineer", "devops-automator", "backend-architect"],
  Pixel: ["frontend-developer", "rapid-prototyper"],
  Scout: ["trend-researcher", "data-analytics-reporter"],
  Quill: ["seo-specialist", "growth-hacker", "content-creator"],
  Counsel: ["compliance-auditor"],
  Henry: ["autonomous-optimization-architect"],
};

// Add frontend-developer and rapid-prototyper to PERSONA_OVERLAYS display list
const PERSONA_OVERLAYS_EXTENDED = [
  ...PERSONA_OVERLAYS,
  { id: "frontend-developer", name: "Frontend Developer", emoji: "🎨", desc: "Component architecture, state management, accessibility, performance optimization", relevantAgents: ["Pixel", "Forge"] },
  { id: "rapid-prototyper", name: "Rapid Prototyper", emoji: "⚡", desc: "Fastest path to working demo, cut for v1, validate before building", relevantAgents: ["Pixel"] },
  { id: "autonomous-optimization-architect", name: "Autonomous Optimization Architect", emoji: "🤖", desc: "AI agents replacing manual work, feedback loops, self-improving systems", relevantAgents: ["Henry"] },
];

const PACING_OPTIONS = [
  { id: "instant", label: "Instant", desc: "Agents respond as fast as possible" },
  { id: "relaxed", label: "Relaxed (30s)", desc: "30 second pause between turns" },
  { id: "slow", label: "Slow (1 min)", desc: "1 minute pause between turns" },
  { id: "manual", label: "Manual (step-through)", desc: "Pauses after each turn — you advance manually" },
];

interface SessionTemplate {
  id: string;
  label: string;
  desc: string;
  icon: typeof TrendingUp;
  mode: "review" | "roundtable";
  agents: string[];
  responseLength: "concise" | "balanced" | "detailed" | "verbose";
  rounds: number;
  topic?: string;
}

const SESSION_TEMPLATES: SessionTemplate[] = [
  {
    id: "trading-strategy",
    label: "Trading Strategy Review",
    desc: "Deep-dive into trading strategies with quant rigor",
    icon: TrendingUp,
    mode: "review",
    agents: ["Henry", "Atlas", "Quant", "Cipher"],
    responseLength: "detailed",
    rounds: 3,
    topic: "Review and critique the proposed trading strategy, focusing on risk-adjusted returns, edge sustainability, and portfolio fit.",
  },
  {
    id: "product-launch",
    label: "Product Launch Planning",
    desc: "Cross-functional launch plan with marketing & engineering",
    icon: Rocket,
    mode: "roundtable",
    agents: ["Henry", "Pixel", "Scout", "Quill"],
    responseLength: "balanced",
    rounds: 3,
  },
  {
    id: "risk-legal",
    label: "Risk & Legal Assessment",
    desc: "Regulatory risk, compliance, and legal exposure review",
    icon: Shield,
    mode: "roundtable",
    agents: ["Henry", "Counsel", "Forge", "Scout"],
    responseLength: "detailed",
    rounds: 3,
  },
  {
    id: "tech-architecture",
    label: "Technical Architecture Review",
    desc: "System design, scalability, and engineering trade-offs",
    icon: Cpu,
    mode: "review",
    agents: ["Henry", "Forge", "Pixel", "Quant"],
    responseLength: "detailed",
    rounds: 3,
  },
  {
    id: "marketing-growth",
    label: "Marketing & Growth Strategy",
    desc: "Growth levers, content strategy, and market positioning",
    icon: Megaphone,
    mode: "roundtable",
    agents: ["Henry", "Quill", "Scout", "Pixel"],
    responseLength: "balanced",
    rounds: 3,
  },
  {
    id: "custom",
    label: "Custom",
    desc: "Blank slate — configure everything yourself",
    icon: Settings,
    mode: "roundtable",
    agents: ["Henry"],
    responseLength: "balanced",
    rounds: 3,
  },
];

function RoundsDisplay({ session }: { session: AdvisorySession }) {
  const rounds = (session as unknown as Record<string, unknown>).rounds;
  if (rounds === "persistent") {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "4px",
          fontSize: "9px",
          fontWeight: 700,
          color: "#a78bfa",
          backgroundColor: "rgba(167,139,250,0.12)",
          border: "1px solid rgba(167,139,250,0.3)",
          padding: "2px 7px",
          borderRadius: "4px",
          fontFamily: "var(--font-mono)",
          letterSpacing: "0.06em",
        }}
      >
        ∞ PERSISTENT
      </span>
    );
  }
  return <span style={{ fontSize: "10px", fontWeight: 600, color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}>{String(rounds ?? "—")}</span>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getAgentRole(agentId: string): string {
  return AGENTS.find((a) => a.id === agentId)?.role ?? "Agent";
}

function getOverlayName(overlayId: string): string {
  // Search extended list first (includes frontend-developer, rapid-prototyper, autonomous-optimization-architect)
  // We do a lazy search across both lists at call time since PERSONA_OVERLAYS_EXTENDED is defined later
  const extraOverlays = [
    { id: "frontend-developer", name: "Frontend Developer", emoji: "🎨" },
    { id: "rapid-prototyper", name: "Rapid Prototyper", emoji: "⚡" },
    { id: "autonomous-optimization-architect", name: "Autonomous Optimization Architect", emoji: "🤖" },
  ];
  return (
    PERSONA_OVERLAYS.find((o) => o.id === overlayId)?.name ??
    extraOverlays.find((o) => o.id === overlayId)?.name ??
    overlayId
  );
}

function getOverlayEmoji(overlayId: string): string {
  const extraOverlays = [
    { id: "frontend-developer", emoji: "🎨" },
    { id: "rapid-prototyper", emoji: "⚡" },
    { id: "autonomous-optimization-architect", emoji: "🤖" },
  ];
  return (
    PERSONA_OVERLAYS.find((o) => o.id === overlayId)?.emoji ??
    extraOverlays.find((o) => o.id === overlayId)?.emoji ??
    "🎭"
  );
}

function getEventStyle(event: AdvisoryEvent): { bg: string; border: string; badge: string } {
  const type = event.type;
  const role = event.role;

  // Error events — red alert style
  if (type === "error" || event.error) {
    return { bg: "rgba(239, 68, 68, 0.08)", border: "rgba(239, 68, 68, 0.4)", badge: "#ef4444" };
  }

  // Human directive — gold/amber style
  if (event.speaker === "Tim" || type === "human-directive") {
    return { bg: "rgba(251, 191, 36, 0.06)", border: "rgba(251, 191, 36, 0.25)", badge: "#fbbf24" };
  }

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

function getRoleBadge(role: string, type?: string, speaker?: string): { label: string; color: string } {
  if (speaker === "Tim") return { label: "DIRECTIVE", color: "#fbbf24" };
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

// Strip markdown artifacts and produce clean plain text
function stripMarkdown(text: string): string {
  return text
    // Remove bold/italic markers
    .replace(/\*\*\*(.+?)\*\*\*/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    // Remove inline code
    .replace(/`([^`]+)`/g, "$1")
    // Remove markdown links, keep text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // Remove images
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "")
    // Remove headings markers (keep text)
    .replace(/^#{1,6}\s+/gm, "")
    // Remove blockquote markers
    .replace(/^>\s+/gm, "")
    // Remove horizontal rules
    .replace(/^[-*_]{3,}\s*$/gm, "")
    // Normalize multiple blank lines
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatMarkdownExport(session: AdvisorySession, events: AdvisoryEvent[]): string {
  const topic = session.topic;
  const mode = session.mode;
  const dateStr = new Date(session.createdAt).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  // Support both old array and new object format
  const rawOverlays = (session as unknown as Record<string, unknown>).personaOverlays;
  const overlaysObj: Record<string, string> = Array.isArray(rawOverlays)
    ? {}
    : (rawOverlays as Record<string, string>) ?? {};

  // Build participants section
  const participantLines: string[] = [];
  for (const agentDisplayName of session.agents) {
    const agentConfig = getAgentByAnyId(agentDisplayName);
    const role = agentConfig?.role ?? getAgentRole(agentDisplayName);
    const emoji = agentConfig?.emoji ?? "🤖";
    const agentOverlayId = overlaysObj[agentDisplayName];
    const agentOverlayStr = agentOverlayId
      ? ` [${getOverlayEmoji(agentOverlayId)} ${getOverlayName(agentOverlayId)}]`
      : "";
    participantLines.push(`  ${emoji} ${agentDisplayName} — ${role}${agentOverlayStr}`);
  }

  // Collect unique models
  const allEvents = events as (AdvisoryEvent & { model?: string })[];
  const modelsUsed = [...new Set(allEvents.map((e) => e.model).filter(Boolean))];
  const modelsStr = modelsUsed.length > 0 ? modelsUsed.join(", ") : "N/A";
  const responseLengthStr = (session as unknown as Record<string, unknown>).responseLength as string ?? "balanced";

  const lines: string[] = [
    `════════════════════════════════════════════════════════════`,
    `  HARRIS AUTONOMOUS — ADVISORY BOARD`,
    `════════════════════════════════════════════════════════════`,
    ``,
    `  Topic:    ${topic}`,
    `  Date:     ${dateStr}`,
    `  Mode:     ${mode.charAt(0).toUpperCase() + mode.slice(1)}`,
    `  Length:   ${responseLengthStr.charAt(0).toUpperCase() + responseLengthStr.slice(1)}`,
    `  Model(s): ${modelsStr}`,
    ``,
    `────────────────────────────────────────────────────────────`,
    `  PARTICIPANTS`,
    `────────────────────────────────────────────────────────────`,
    ``,
    ...participantLines,
    ``,
    `════════════════════════════════════════════════════════════`,
    ``,
  ];

  for (const event of events) {
    if (!event.text || !event.speaker) continue;
    if (event.type === "start") continue; // Skip session-start system event
    const agentConfig = getAgentByAnyId(event.speaker);
    const role = agentConfig?.role ?? getAgentRole(event.speaker);
    const emoji = agentConfig?.emoji ?? event.emoji ?? "";
    const speakerOverlayId = overlaysObj[event.speaker];
    const overlayStr = speakerOverlayId
      ? ` [${getOverlayEmoji(speakerOverlayId)} ${getOverlayName(speakerOverlayId)}]`
      : "";
    const timeStr = new Date(event.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

    lines.push(`────────────────────────────────────────────────────────────`);
    lines.push(`${emoji} ${event.speaker.toUpperCase()} — ${role}${overlayStr}  [${timeStr}]`);
    lines.push(`────────────────────────────────────────────────────────────`);
    lines.push(``);
    // Strip markdown artifacts for clean plain text
    lines.push(stripMarkdown(event.text));
    lines.push(``);
  }

  lines.push(`════════════════════════════════════════════════════════════`);
  lines.push(`  End of Advisory Session Transcript`);
  lines.push(`════════════════════════════════════════════════════════════`);

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
  sessionOverlays = {},
  sessionTopic,
  onRetry,
  onFork,
}: {
  event: AdvisoryEvent;
  // New: object format { agentId: overlayId } — or empty object
  sessionOverlays?: Record<string, string> | string[];
  sessionTopic?: string;
  onRetry?: () => void;
  onFork?: () => void;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  const [hovered, setHovered] = useState(false);
  const [ratingState, setRatingState] = useState<"up" | "down" | null>(null);

  const handleRate = async (rating: "up" | "down") => {
    if (ratingState === rating) return; // already rated this way
    setRatingState(rating);
    try {
      await fetch("/api/advisory/ratings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent: event.speaker, rating, topic: sessionTopic }),
      });
    } catch {
      // ignore — non-critical
    }
  };

  const isHuman = event.speaker === "Tim";
  const isError = event.type === "error" || event.error === true;
  const style = getEventStyle(event);
  const icon = getEventIcon(event.type, event.verdict);
  const badge = getRoleBadge(event.role, event.type, event.speaker);
  const isSystem = event.type === "start" || event.type === "complete";
  const agentConfig = isHuman ? null : getAgentByAnyId(event.speaker);
  const agentRole = agentConfig?.role ?? getAgentRole(event.speaker);

  // Strip the "[Human Directive]" prefix from Tim's messages for display
  const displayText = isHuman
    ? event.text.replace(/^\*\*\[Human Directive\]\*\*\s*/i, "").trim()
    : event.text;

  // Which overlays apply to this speaker?
  // Support both new object format and legacy array format
  const speakerOverlays: string[] = isHuman ? [] : (() => {
    if (!sessionOverlays) return [];
    if (Array.isArray(sessionOverlays)) {
      return sessionOverlays.filter((oid) => {
        const o = PERSONA_OVERLAYS.find((p) => p.id === oid);
        return o?.relevantAgents.includes(event.speaker);
      });
    }
    // Object format: { agentId: overlayId }
    const overlayId = sessionOverlays[event.speaker];
    return overlayId ? [overlayId] : [];
  })();

  const handleCopyMessage = async () => {
    try {
      await navigator.clipboard.writeText(displayText);
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  return (
    <div
      className="advisory-event-bubble"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: "14px 16px",
        borderRadius: "12px",
        border: `1px solid ${style.border}`,
        backgroundColor: style.bg,
        marginBottom: "12px",
        position: "relative",
        maxWidth: "100%",
        overflow: "hidden",
      }}
    >
      {/* Action buttons — appear on hover for non-system messages */}
      {!isSystem && !isError && (hovered || copyState === "copied") && (
        <div style={{
          position: "absolute",
          top: "10px",
          right: "10px",
          display: "flex",
          gap: "4px",
          zIndex: 2,
        }}>
          {/* Fork button */}
          {onFork && hovered && (
            <button
              onClick={onFork}
              title="Fork from here — create a new session branching from this point"
              style={{
                padding: "4px 8px",
                borderRadius: "6px",
                border: "1px solid rgba(139,92,246,0.3)",
                backgroundColor: "rgba(139,92,246,0.08)",
                color: "#a78bfa",
                cursor: "pointer",
                fontSize: "10px",
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                gap: "4px",
                transition: "all 150ms ease",
              }}
            >
              <GitBranch size={11} />
              Fork
            </button>
          )}
          {/* Copy button */}
          <button
            onClick={handleCopyMessage}
            title="Copy message"
            style={{
              padding: "4px 8px",
              borderRadius: "6px",
              border: `1px solid ${copyState === "copied" ? "rgba(74,222,128,0.5)" : "var(--border)"}`,
              backgroundColor: copyState === "copied" ? "rgba(74,222,128,0.12)" : "var(--surface-elevated)",
              color: copyState === "copied" ? "#4ade80" : "var(--text-muted)",
              cursor: "pointer",
              fontSize: "10px",
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: "4px",
              transition: "all 150ms ease",
            }}
          >
            <Copy size={11} />
            {copyState === "copied" ? "Copied!" : "Copy"}
          </button>
        </div>
      )}

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: "10px", marginBottom: "8px" }}>
        {/* Avatar */}
        <div style={{ flexShrink: 0, marginTop: "1px" }}>
          {isError ? (
            <div style={{
              width: 36, height: 36, borderRadius: "50%",
              backgroundColor: "rgba(239,68,68,0.15)",
              border: "2px solid rgba(239,68,68,0.5)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <AlertCircle size={16} color="#ef4444" />
            </div>
          ) : isHuman ? (
            // Human (Tim) — gold circle avatar
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: "50%",
                backgroundColor: "rgba(251,191,36,0.15)",
                border: "2px solid rgba(251,191,36,0.5)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "14px",
                fontWeight: 700,
                color: "#fbbf24",
                fontFamily: "var(--font-heading)",
              }}
            >
              T
            </div>
          ) : isSystem ? (
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
            <span style={{ fontWeight: 700, fontSize: "13px", color: isError ? "#ef4444" : isHuman ? "#fbbf24" : "var(--text-primary)", fontFamily: "var(--font-heading)" }}>
              {isError ? "Session Error" : isHuman ? "Tim Harris" : event.speaker}
            </span>
            {!isSystem && !isHuman && !isError && (
              <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                — {agentRole}
              </span>
            )}
            {isHuman && (
              <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                — CEO
              </span>
            )}
            <span style={{ marginLeft: "auto", fontSize: "11px", color: "var(--text-muted)", whiteSpace: "nowrap", paddingRight: hovered && !isSystem && !isError ? "70px" : "0" }}>
              {formatTime(event.timestamp)}
            </span>
          </div>

          {/* Role badge + overlay chips */}
          <div style={{ display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap" }}>
            {isError ? (
              <span style={{
                fontSize: "9px", fontWeight: 700, letterSpacing: "0.08em",
                color: "#ef4444", backgroundColor: "rgba(239,68,68,0.15)",
                border: "1px solid rgba(239,68,68,0.4)", padding: "2px 6px",
                borderRadius: "4px", fontFamily: "var(--font-mono)",
              }}>ERROR</span>
            ) : (
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
            )}
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
            {event.model && !isSystem && !isHuman && !isError && (
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
        style={{ fontSize: "13px", color: isError ? "#fca5a5" : "var(--text-primary)", lineHeight: 1.6, marginLeft: "46px", maxWidth: "100%", overflow: "hidden", wordBreak: "normal", overflowWrap: "break-word" }}
        className="advisory-markdown"
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayText}</ReactMarkdown>
      </div>

      {/* Rating buttons — thumbs up/down for agent messages */}
      {!isSystem && !isHuman && !isError && (
        <div style={{ marginLeft: "46px", marginTop: "8px", display: "flex", alignItems: "center", gap: "6px" }}>
          <button
            onClick={() => handleRate("up")}
            title="Good response"
            style={{
              padding: "3px 8px",
              borderRadius: "6px",
              border: `1px solid ${ratingState === "up" ? "rgba(74,222,128,0.5)" : "var(--border)"}`,
              backgroundColor: ratingState === "up" ? "rgba(74,222,128,0.12)" : "transparent",
              color: ratingState === "up" ? "#4ade80" : "var(--text-muted)",
              cursor: "pointer",
              fontSize: "10px",
              fontWeight: 600,
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              transition: "all 150ms ease",
              opacity: ratingState === "down" ? 0.4 : 1,
            }}
          >
            <ThumbsUp size={11} />
          </button>
          <button
            onClick={() => handleRate("down")}
            title="Needs improvement"
            style={{
              padding: "3px 8px",
              borderRadius: "6px",
              border: `1px solid ${ratingState === "down" ? "rgba(239,68,68,0.5)" : "var(--border)"}`,
              backgroundColor: ratingState === "down" ? "rgba(239,68,68,0.12)" : "transparent",
              color: ratingState === "down" ? "#ef4444" : "var(--text-muted)",
              cursor: "pointer",
              fontSize: "10px",
              fontWeight: 600,
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              transition: "all 150ms ease",
              opacity: ratingState === "up" ? 0.4 : 1,
            }}
          >
            <ThumbsDown size={11} />
          </button>
        </div>
      )}

      {/* Retry button for errors */}
      {isError && onRetry && (
        <div style={{ marginLeft: "46px", marginTop: "10px" }}>
          <button
            onClick={onRetry}
            style={{
              padding: "6px 14px",
              borderRadius: "7px",
              border: "1px solid rgba(239,68,68,0.5)",
              backgroundColor: "rgba(239,68,68,0.12)",
              color: "#ef4444",
              cursor: "pointer",
              fontSize: "11px",
              fontWeight: 700,
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              transition: "all 150ms ease",
            }}
          >
            <RotateCcw size={11} />
            Retry Session
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Session Insights Panel ──────────────────────────────────────────────────

function SessionInsightsPanel({
  insights,
  onToggleAction,
  extracting,
  onExtract,
}: {
  insights: SessionInsights | null;
  onToggleAction: (index: number, status: "pending" | "done") => void;
  extracting: boolean;
  onExtract: () => void;
}) {
  const [expanded, setExpanded] = useState(true);

  if (!insights && !extracting) {
    return (
      <div style={{ margin: "16px 0", padding: "12px 16px", borderRadius: "12px", border: "1px solid rgba(251,191,36,0.25)", backgroundColor: "rgba(251,191,36,0.04)" }}>
        <button
          onClick={onExtract}
          style={{
            display: "flex", alignItems: "center", gap: "8px", background: "none", border: "none",
            cursor: "pointer", color: "#fbbf24", fontSize: "12px", fontWeight: 700, padding: 0,
            fontFamily: "var(--font-heading)",
          }}
        >
          <Lightbulb size={14} />
          Extract Insights
        </button>
        <div style={{ fontSize: "10px", color: "var(--text-muted)", marginTop: "4px" }}>
          Analyze conversation for action items, decisions, open questions, and risks
        </div>
      </div>
    );
  }

  if (extracting) {
    return (
      <div style={{ margin: "16px 0", padding: "16px", borderRadius: "12px", border: "1px solid rgba(251,191,36,0.3)", backgroundColor: "rgba(251,191,36,0.06)", display: "flex", alignItems: "center", gap: "10px" }}>
        <Loader2 size={16} color="#fbbf24" className="animate-spin" />
        <span style={{ fontSize: "12px", color: "#fbbf24", fontWeight: 600 }}>Extracting insights from conversation...</span>
      </div>
    );
  }

  if (!insights) return null;

  const priorityColor = (p: string) => p === "high" ? "#ef4444" : p === "medium" ? "#fbbf24" : "#94a3b8";
  const priorityBg = (p: string) => p === "high" ? "rgba(239,68,68,0.12)" : p === "medium" ? "rgba(251,191,36,0.12)" : "rgba(148,163,184,0.1)";

  return (
    <div style={{ margin: "16px 0", borderRadius: "12px", border: "1px solid rgba(251,191,36,0.3)", backgroundColor: "rgba(251,191,36,0.03)", overflow: "hidden" }}>
      <button
        onClick={() => setExpanded((v) => !v)}
        style={{
          width: "100%", padding: "12px 16px", display: "flex", alignItems: "center", gap: "8px",
          background: "none", border: "none", cursor: "pointer", textAlign: "left",
        }}
      >
        <Lightbulb size={14} color="#fbbf24" />
        <span style={{ fontSize: "13px", fontWeight: 700, color: "#fbbf24", fontFamily: "var(--font-heading)", flex: 1 }}>
          Session Insights
        </span>
        <span style={{ fontSize: "9px", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
          {insights.actionItems.length} actions · {insights.keyDecisions.length} decisions
        </span>
        {expanded ? <ChevronDown size={14} color="var(--text-muted)" /> : <ChevronRight size={14} color="var(--text-muted)" />}
      </button>

      {expanded && (
        <div style={{ padding: "0 16px 16px" }}>
          {insights.actionItems.length > 0 && (
            <div style={{ marginBottom: "16px" }}>
              <div style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.06em", color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginBottom: "8px" }}>
                ACTION ITEMS
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {insights.actionItems.map((item, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: "flex", alignItems: "flex-start", gap: "8px", padding: "8px 10px",
                      borderRadius: "8px", border: "1px solid var(--border)", backgroundColor: "var(--surface-elevated)",
                      opacity: item.status === "done" ? 0.6 : 1,
                    }}
                  >
                    <button
                      onClick={() => onToggleAction(idx, item.status === "done" ? "pending" : "done")}
                      style={{
                        flexShrink: 0, width: 18, height: 18, borderRadius: "4px", marginTop: "1px",
                        border: `2px solid ${item.status === "done" ? "#4ade80" : "var(--border)"}`,
                        backgroundColor: item.status === "done" ? "#4ade80" : "transparent",
                        cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                      }}
                    >
                      {item.status === "done" && <CheckCircle2 size={12} color="#fff" />}
                    </button>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "12px", color: "var(--text-primary)", lineHeight: 1.5, textDecoration: item.status === "done" ? "line-through" : "none" }}>
                        {item.description}
                      </div>
                      <div style={{ display: "flex", gap: "6px", marginTop: "4px", flexWrap: "wrap" }}>
                        <span style={{ fontSize: "9px", fontWeight: 700, color: priorityColor(item.priority), backgroundColor: priorityBg(item.priority), padding: "1px 6px", borderRadius: "3px", fontFamily: "var(--font-mono)", letterSpacing: "0.04em" }}>
                          {item.priority.toUpperCase()}
                        </span>
                        <span style={{ fontSize: "9px", fontWeight: 600, color: "var(--text-muted)", backgroundColor: "rgba(100,116,139,0.08)", padding: "1px 6px", borderRadius: "3px", fontFamily: "var(--font-mono)" }}>
                          {item.assignedAgent}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {insights.keyDecisions.length > 0 && (
            <div style={{ marginBottom: "16px" }}>
              <div style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.06em", color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginBottom: "8px" }}>
                KEY DECISIONS
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                {insights.keyDecisions.map((d, idx) => (
                  <div key={idx} style={{ fontSize: "12px", color: "var(--text-primary)", lineHeight: 1.5, padding: "6px 10px", borderRadius: "6px", border: "1px solid rgba(74,222,128,0.2)", backgroundColor: "rgba(74,222,128,0.04)", display: "flex", alignItems: "flex-start", gap: "6px" }}>
                    <CheckCircle2 size={12} color="#4ade80" style={{ flexShrink: 0, marginTop: "2px" }} />
                    {d}
                  </div>
                ))}
              </div>
            </div>
          )}

          {insights.openQuestions.length > 0 && (
            <div style={{ marginBottom: "16px" }}>
              <div style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.06em", color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginBottom: "8px" }}>
                OPEN QUESTIONS
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                {insights.openQuestions.map((q, idx) => (
                  <div key={idx} style={{ fontSize: "12px", color: "var(--text-primary)", lineHeight: 1.5, padding: "6px 10px", borderRadius: "6px", border: "1px solid rgba(96,165,250,0.2)", backgroundColor: "rgba(96,165,250,0.04)", display: "flex", alignItems: "flex-start", gap: "6px" }}>
                    <Clock size={12} color="#60a5fa" style={{ flexShrink: 0, marginTop: "2px" }} />
                    {q}
                  </div>
                ))}
              </div>
            </div>
          )}

          {insights.risksIdentified.length > 0 && (
            <div>
              <div style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.06em", color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginBottom: "8px" }}>
                RISKS IDENTIFIED
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                {insights.risksIdentified.map((r, idx) => (
                  <div key={idx} style={{ fontSize: "12px", color: "var(--text-primary)", lineHeight: 1.5, padding: "6px 10px", borderRadius: "6px", border: "1px solid rgba(239,68,68,0.2)", backgroundColor: "rgba(239,68,68,0.04)", display: "flex", alignItems: "flex-start", gap: "6px" }}>
                    <AlertTriangle size={12} color="#ef4444" style={{ flexShrink: 0, marginTop: "2px" }} />
                    {r}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ fontSize: "9px", color: "var(--text-muted)", marginTop: "12px", fontFamily: "var(--font-mono)", opacity: 0.7 }}>
            Extracted {new Date(insights.extractedAt).toLocaleString()}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Typing Indicator ─────────────────────────────────────────────────────────

function TypingIndicator({ agentId }: { agentId: string | null }) {
  const agentDef = agentId ? AGENTS.find((a) => a.id === agentId) : null;
  const label = agentId
    ? `${agentId} is thinking...`
    : "Agents are deliberating...";

  return (
    <div
      className="typing-indicator"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "12px 16px",
        borderRadius: "12px",
        border: "1px solid rgba(139, 92, 246, 0.25)",
        backgroundColor: "rgba(139, 92, 246, 0.06)",
        marginBottom: "12px",
        animation: "msg-fadein 0.2s ease-out",
      }}
    >
      {/* Avatar with pulse ring */}
      <div style={{ position: "relative", flexShrink: 0 }}>
        {agentId ? (
          <>
            <div
              style={{
                position: "absolute",
                inset: "-4px",
                borderRadius: "50%",
                border: "2px solid rgba(139,92,246,0.5)",
                animation: "thinking-pulse 1.2s ease-in-out infinite",
              }}
            />
            <AgentAvatar agentId={agentId} size={32} borderWidth={2} />
          </>
        ) : (
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              backgroundColor: "rgba(139,92,246,0.15)",
              border: "2px solid rgba(139,92,246,0.4)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              animation: "thinking-pulse 1.2s ease-in-out infinite",
            }}
          >
            <span style={{ fontSize: "14px" }}>{agentDef?.emoji ?? "💬"}</span>
          </div>
        )}
      </div>

      <div style={{ flex: 1 }}>
        <div style={{ fontSize: "12px", color: "#a78bfa", fontWeight: 600, marginBottom: "5px" }}>
          {label}
        </div>
        {/* Animated dots */}
        <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              style={{
                width: "6px",
                height: "6px",
                borderRadius: "50%",
                backgroundColor: "#8b5cf6",
                animation: `typing-dot 1.2s ease-in-out infinite`,
                animationDelay: `${i * 0.2}s`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function SessionListItem({
  session,
  active,
  onClick,
  compareMode,
  compareSelected,
  onCompareToggle,
}: {
  session: AdvisorySession;
  active: boolean;
  onClick: () => void;
  compareMode?: boolean;
  compareSelected?: boolean;
  onCompareToggle?: () => void;
}) {
  const badge = getStatusBadge(session.status);

  return (
    <button
      onClick={compareMode ? onCompareToggle : onClick}
      style={{
        width: "100%",
        textAlign: "left",
        padding: "12px 14px",
        borderRadius: "10px",
        border: `1px solid ${compareSelected ? "rgba(96,165,250,0.5)" : active ? "var(--accent)" : "var(--border)"}`,
        backgroundColor: compareSelected ? "rgba(96,165,250,0.08)" : active ? "var(--accent-soft)" : "transparent",
        cursor: "pointer",
        transition: "all 150ms ease",
        marginBottom: "6px",
        display: "block",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
        {compareMode && (
          <div style={{
            width: 16, height: 16, borderRadius: "4px", marginRight: "6px", flexShrink: 0,
            border: `2px solid ${compareSelected ? "#60a5fa" : "var(--border)"}`,
            backgroundColor: compareSelected ? "#60a5fa" : "transparent",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {compareSelected && <span style={{ color: "#fff", fontSize: "10px", fontWeight: 700 }}>✓</span>}
          </div>
        )}
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
            display: "flex",
            alignItems: "center",
            gap: "4px",
          }}
        >
          {session.status === "active" && (
            <span className="live-dot" style={{ width: "5px", height: "5px", borderRadius: "50%", backgroundColor: badge.color, display: "inline-block", flexShrink: 0 }} />
          )}
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
        {session.title || session.topic}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <AvatarStack agentIds={session.agents} size={22} max={4} />
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          {!!(session as unknown as Record<string, unknown>).forkedFrom && (
            <span style={{
              fontSize: "8px",
              fontWeight: 700,
              color: "#60a5fa",
              backgroundColor: "rgba(96,165,250,0.12)",
              border: "1px solid rgba(96,165,250,0.25)",
              padding: "1px 5px",
              borderRadius: "3px",
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.04em",
              display: "inline-flex",
              alignItems: "center",
              gap: "2px",
            }}>
              <GitBranch size={7} />
            </span>
          )}
          {(session as unknown as Record<string, unknown>).specialist ? (
            <span style={{
              fontSize: "8px",
              fontWeight: 700,
              color: "#10b981",
              backgroundColor: "rgba(16,185,129,0.12)",
              border: "1px solid rgba(16,185,129,0.25)",
              padding: "1px 5px",
              borderRadius: "3px",
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.04em",
            }}>1:1</span>
          ) : (session as unknown as Record<string, unknown>).rounds === "persistent" && (
            <span style={{
              fontSize: "8px",
              fontWeight: 700,
              color: "#a78bfa",
              backgroundColor: "rgba(167,139,250,0.12)",
              border: "1px solid rgba(167,139,250,0.25)",
              padding: "1px 5px",
              borderRadius: "3px",
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.04em",
            }}>∞</span>
          )}
          <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>
            {session.eventCount ?? session.events?.length ?? 0} events
          </span>
        </div>
      </div>
    </button>
  );
}

// ─── Create Custom Agent Modal ────────────────────────────────────────────────

const DIVISIONS = ["Leadership", "Trading", "Engineering", "Research", "Creative", "Legal", "Custom"] as const;

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

// ─── Launch Modal ─────────────────────────────────────────────────────────────

interface LaunchModalProps {
  onClose: () => void;
  onLaunch: (session: AdvisorySession) => void;
  customAgents: CustomAgent[];
  onCustomAgentsChange: () => void;
  onDeepDive?: (agentId: string, agentName: string, agentEmoji: string, agentRole: string) => void;
}

function LaunchModal({ onClose, onLaunch, customAgents, onCustomAgentsChange, onDeepDive }: LaunchModalProps) {
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

// ─── Review Loop Task Panel (left panel) ──────────────────────────────────────

function ReviewLoopTaskPanel({
  loop,
  onOverride,
  onAddTask,
  onAdvance,
  onPause,
  onResume,
  selectedTaskId,
  onSelectTask,
  newTaskText,
  onNewTaskTextChange,
  addingTask,
  loopAdvancing,
  onSetAutoContinue,
  sessionStatus,
}: {
  loop: ReviewLoopState;
  onOverride: (taskId: number, newStatus: string, notes?: string) => void;
  onAddTask: () => void;
  onAdvance: () => void;
  onPause: () => void;
  onResume: () => void;
  selectedTaskId: number | null;
  onSelectTask: (id: number | null) => void;
  newTaskText: string;
  onNewTaskTextChange: (text: string) => void;
  addingTask: boolean;
  loopAdvancing: boolean;
  onSetAutoContinue?: (val: boolean) => void;
  sessionStatus: string;
}) {
  const totalTasks = loop.tasks.length;
  const completedTasks = loop.totalApproved;
  const pct = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const statusConfig: Record<string, { emoji: string; color: string; label: string }> = {
    "pending": { emoji: "\u2B1C", color: "#64748b", label: "Pending" },
    "in-progress": { emoji: "\uD83D\uDD04", color: "#60a5fa", label: "In Progress" },
    "in-review": { emoji: "\uD83D\uDC40", color: "#fbbf24", label: "Under Review" },
    "approved": { emoji: "\u2705", color: "#4ade80", label: "Approved" },
    "rejected": { emoji: "\u274C", color: "#ef4444", label: "Rejected" },
    "retrying": { emoji: "\uD83D\uDD01", color: "#fb923c", label: "Retrying" },
    "blocked": { emoji: "\u23F8\uFE0F", color: "#94a3b8", label: "Blocked" },
  };

  return (
    <div style={{
      width: "280px",
      minWidth: "220px",
      flexShrink: 0,
      borderRight: "1px solid var(--border)",
      backgroundColor: "var(--surface)",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
    }}>
      {/* Progress header */}
      <div style={{ padding: "16px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
          <span style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.06em", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
            TASK PROGRESS
          </span>
          <span style={{ fontSize: "12px", fontWeight: 700, color: pct === 100 ? "#4ade80" : "var(--text-primary)", fontFamily: "var(--font-mono)" }}>
            {completedTasks}/{totalTasks} ({pct}%)
          </span>
        </div>
        {/* Progress bar */}
        <div style={{ width: "100%", height: "6px", borderRadius: "3px", backgroundColor: "var(--border)", overflow: "hidden" }}>
          <div style={{
            width: `${pct}%`,
            height: "100%",
            borderRadius: "3px",
            backgroundColor: pct === 100 ? "#4ade80" : "#60a5fa",
            transition: "width 300ms ease",
          }} />
        </div>
        <div style={{ display: "flex", gap: "12px", marginTop: "8px", fontSize: "10px", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
          <span>{loop.totalApproved} approved</span>
          <span>{loop.totalRejected} rejected</span>
          <span>{loop.tasks.filter((t) => t.status === "pending").length} remaining</span>
        </div>

        {/* Loop controls */}
        {sessionStatus === "active" && (
          <div style={{ display: "flex", gap: "6px", marginTop: "10px" }}>
            {loop.paused ? (
              <button
                onClick={onResume}
                disabled={loopAdvancing}
                style={{
                  flex: 1, padding: "6px 10px", borderRadius: "6px", border: "1px solid rgba(74,222,128,0.5)",
                  backgroundColor: "rgba(74,222,128,0.12)", color: "#4ade80", cursor: "pointer",
                  fontSize: "10px", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: "4px",
                }}
              >
                <Play size={10} /> Resume
              </button>
            ) : (
              <button
                onClick={onPause}
                style={{
                  flex: 1, padding: "6px 10px", borderRadius: "6px", border: "1px solid rgba(251,146,60,0.5)",
                  backgroundColor: "rgba(251,146,60,0.08)", color: "#fb923c", cursor: "pointer",
                  fontSize: "10px", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: "4px",
                }}
              >
                <Pause size={10} /> Pause
              </button>
            )}
            <button
              onClick={onAdvance}
              disabled={loopAdvancing}
              style={{
                flex: 1, padding: "6px 10px", borderRadius: "6px", border: "none",
                backgroundColor: "var(--accent)", color: "#fff", cursor: loopAdvancing ? "not-allowed" : "pointer",
                fontSize: "10px", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: "4px",
                opacity: loopAdvancing ? 0.6 : 1,
              }}
            >
              {loopAdvancing ? <Loader2 size={10} className="animate-spin" /> : <ChevronRight size={10} />}
              {loop.tasks[loop.currentTaskIndex]?.status === "rejected" ? "Retry" : "Next"}
            </button>
          </div>
        )}

        {/* Auto-continue toggle + Agent roles */}
        <div style={{ display: "flex", gap: "6px", marginTop: "8px", alignItems: "center", flexWrap: "wrap" }}>
          {onSetAutoContinue && (
            <button
              onClick={() => onSetAutoContinue(!loop.autoContinue)}
              style={{
                padding: "4px 8px", borderRadius: "4px",
                border: `1px solid ${loop.autoContinue ? "rgba(74,222,128,0.4)" : "var(--border)"}`,
                backgroundColor: loop.autoContinue ? "rgba(74,222,128,0.08)" : "transparent",
                color: loop.autoContinue ? "#4ade80" : "var(--text-muted)", cursor: "pointer",
                fontSize: "9px", fontWeight: 700, fontFamily: "var(--font-mono)",
                letterSpacing: "0.04em", transition: "all 100ms ease",
              }}
            >
              AUTO {loop.autoContinue ? "ON" : "OFF"}
            </button>
          )}
          <span style={{ fontSize: "9px", color: "#60a5fa", fontFamily: "var(--font-mono)" }}>W:{loop.workerAgent}</span>
          <span style={{ fontSize: "9px", color: "#fbbf24", fontFamily: "var(--font-mono)" }}>R:{loop.reviewerAgent}</span>
          <span style={{ fontSize: "9px", color: "#fb923c", fontFamily: "var(--font-mono)" }}>S:{loop.supervisorAgent}</span>
        </div>
      </div>

      {/* Task list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "8px" }}>
        {loop.tasks.map((task) => {
          const sc = statusConfig[task.status] || statusConfig["pending"];
          const isSelected = selectedTaskId === task.id;
          const isCurrent = loop.tasks.indexOf(task) === loop.currentTaskIndex;

          return (
            <div
              key={task.id}
              onClick={() => onSelectTask(isSelected ? null : task.id)}
              style={{
                padding: "10px 12px",
                borderRadius: "8px",
                border: `1px solid ${isSelected ? "var(--accent)" : isCurrent ? "rgba(96,165,250,0.4)" : "transparent"}`,
                backgroundColor: isSelected ? "var(--accent-soft)" : isCurrent ? "rgba(96,165,250,0.06)" : "transparent",
                cursor: "pointer",
                marginBottom: "4px",
                transition: "all 150ms ease",
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
                <span style={{ fontSize: "14px", lineHeight: 1, flexShrink: 0, marginTop: "1px" }}>{sc.emoji}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: "12px",
                    fontWeight: 600,
                    color: task.status === "approved" ? "var(--text-muted)" : "var(--text-primary)",
                    lineHeight: 1.4,
                    textDecoration: task.status === "approved" ? "line-through" : "none",
                    opacity: task.status === "approved" ? 0.7 : 1,
                  }}>
                    #{task.id} {task.description}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "4px", flexWrap: "wrap" }}>
                    <span style={{
                      fontSize: "9px", fontWeight: 700, letterSpacing: "0.04em",
                      color: sc.color, backgroundColor: `${sc.color}18`, border: `1px solid ${sc.color}40`,
                      padding: "1px 6px", borderRadius: "3px", fontFamily: "var(--font-mono)",
                    }}>
                      {sc.label.toUpperCase()}
                    </span>
                    {task.attempts > 0 && (
                      <span style={{ fontSize: "9px", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                        {task.attempts} attempt{task.attempts !== 1 ? "s" : ""}
                      </span>
                    )}
                    {task.overriddenBy && (
                      <span style={{ fontSize: "9px", color: "#fbbf24", fontFamily: "var(--font-mono)" }}>
                        OVERRIDDEN
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Expanded task details */}
              {isSelected && sessionStatus === "active" && (
                <div style={{ marginTop: "10px", paddingTop: "10px", borderTop: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                    {task.status !== "approved" && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onOverride(task.id, "approved"); }}
                        style={{
                          padding: "4px 8px", borderRadius: "4px", border: "1px solid rgba(74,222,128,0.5)",
                          backgroundColor: "rgba(74,222,128,0.1)", color: "#4ade80", cursor: "pointer",
                          fontSize: "9px", fontWeight: 700,
                        }}
                      >
                        Approve
                      </button>
                    )}
                    {task.status !== "blocked" && task.status !== "approved" && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onOverride(task.id, "blocked"); }}
                        style={{
                          padding: "4px 8px", borderRadius: "4px", border: "1px solid rgba(148,163,184,0.5)",
                          backgroundColor: "rgba(148,163,184,0.1)", color: "#94a3b8", cursor: "pointer",
                          fontSize: "9px", fontWeight: 700,
                        }}
                      >
                        Block
                      </button>
                    )}
                    {task.status === "blocked" && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onOverride(task.id, "pending"); }}
                        style={{
                          padding: "4px 8px", borderRadius: "4px", border: "1px solid rgba(96,165,250,0.5)",
                          backgroundColor: "rgba(96,165,250,0.1)", color: "#60a5fa", cursor: "pointer",
                          fontSize: "9px", fontWeight: 700,
                        }}
                      >
                        Unblock
                      </button>
                    )}
                  </div>
                  {task.notes && (
                    <div style={{ fontSize: "10px", color: "var(--text-muted)", marginTop: "6px", fontStyle: "italic" }}>
                      {task.notes}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add task */}
      {sessionStatus === "active" && (
        <div style={{ padding: "12px", borderTop: "1px solid var(--border)", flexShrink: 0 }}>
          <div style={{ display: "flex", gap: "6px" }}>
            <input
              type="text"
              value={newTaskText}
              onChange={(e) => onNewTaskTextChange(e.target.value)}
              placeholder="Add a task..."
              onKeyDown={(e) => { if (e.key === "Enter" && newTaskText.trim()) onAddTask(); }}
              style={{
                flex: 1, padding: "7px 10px", borderRadius: "6px", border: "1px solid var(--border)",
                backgroundColor: "var(--surface-elevated)", color: "var(--text-primary)",
                fontSize: "11px", outline: "none", boxSizing: "border-box",
              }}
            />
            <button
              onClick={onAddTask}
              disabled={addingTask || !newTaskText.trim()}
              style={{
                padding: "7px 12px", borderRadius: "6px", border: "none",
                backgroundColor: "var(--accent)", color: "#fff",
                cursor: addingTask || !newTaskText.trim() ? "not-allowed" : "pointer",
                fontSize: "11px", fontWeight: 700, flexShrink: 0,
                opacity: addingTask || !newTaskText.trim() ? 0.5 : 1,
                display: "flex", alignItems: "center", gap: "4px",
              }}
            >
              {addingTask ? <Loader2 size={10} className="animate-spin" /> : <Plus size={10} />}
              Add
            </button>
          </div>
        </div>
      )}
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
  const [exportingPDF, setExportingPDF] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [togglingPause, setTogglingPause] = useState(false);
  const [showNewMessages, setShowNewMessages] = useState(false);
  const [endSessionConfirm, setEndSessionConfirm] = useState(false);
  const [endingSession, setEndingSession] = useState(false);
  const [advancingTurn, setAdvancingTurn] = useState(false);
  const [requestingFullRound, setRequestingFullRound] = useState(false);
  const [thinkingAgent, setThinkingAgent] = useState<string | null>(null);
  // Search/filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [filterAgent, setFilterAgent] = useState<string>("");
  const [showFilters, setShowFilters] = useState(false);
  // Mobile: sidebar toggle
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const [messageCopiedToast, setMessageCopiedToast] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [customAgents, setCustomAgents] = useState<CustomAgent[]>([]);
  const [agentRatingsGlobal, setAgentRatingsGlobal] = useState<Record<string, { up: number; down: number; total: number; pct: number | null; bestTopic: string | null }>>({});
  // Compare mode
  const [compareMode, setCompareMode] = useState(false);
  const [compareSelections, setCompareSelections] = useState<string[]>([]);
  const [showCompareView, setShowCompareView] = useState(false);
  const [compareSessions, setCompareSessions] = useState<[AdvisorySession | null, AdvisorySession | null]>([null, null]);
  // Insights state
  const [sessionInsights, setSessionInsights] = useState<SessionInsights | null>(null);
  const [extractingInsights, setExtractingInsights] = useState(false);

  // Review Loop state
  const [reviewLoop, setReviewLoop] = useState<ReviewLoopState | null>(null);
  const [addingTask, setAddingTask] = useState(false);
  const [newTaskText, setNewTaskText] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [loopAdvancing, setLoopAdvancing] = useState(false);

  const eventsEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const humanInputRef = useRef<HTMLTextAreaElement>(null);

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
  const loadSessionEvents = useCallback(async (id: string, preserveEvents = false) => {
    try {
      const res = await fetch(`/api/advisory/sessions/${id}`);
      const data = await res.json();
      if (data.session) {
        setActiveSession(data.session);
        setIsPaused(data.session.paused ?? false);
        if (!preserveEvents || (data.session.events?.length ?? 0) > 0) {
          setEvents(data.session.events || []);
        }
        // Load review loop state if present
        if (data.session.reviewLoop) {
          setReviewLoop(data.session.reviewLoop);
        }
      }
    } catch (e) {
      console.error("Failed to load session:", e);
    }
  }, []);

  const loadCustomAgents = useCallback(async () => {
    try {
      const res = await fetch("/api/advisory/custom-agents");
      const data = await res.json();
      setCustomAgents(data.agents || []);
    } catch (e) {
      console.error("Failed to load custom agents:", e);
    }
  }, []);

  const loadRatings = useCallback(async () => {
    try {
      const res = await fetch("/api/advisory/ratings");
      const data = await res.json();
      if (data.ratings) setAgentRatingsGlobal(data.ratings);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    loadSessions();
    loadCustomAgents();
    loadRatings();
  }, [loadSessions, loadCustomAgents, loadRatings]);

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
          // Sync thinking agent
          setThinkingAgent(data.thinkingAgent ?? null);
          // Sync auto-generated title
          if (data.title) {
            setActiveSession((s) => s && !s.title ? { ...s, title: data.title } : s);
          }
          // Check if session has completed
          if (data.status && data.status !== "active") {
            setIsGenerating(false);
            setThinkingAgent(null);
            await loadSessions();
            await loadSessionEvents(activeSession.id);
          }

          // Poll review loop state
          if (activeSession.mode === "review") {
            try {
              const loopRes = await fetch(`/api/advisory/sessions/${activeSession.id}/review-loop`);
              const loopData = await loopRes.json();
              if (loopData.reviewLoop) {
                setReviewLoop(loopData.reviewLoop);
              }
            } catch { /* ignore */ }
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
    setSessionInsights(null);
    setMobileSidebarOpen(false); // close sidebar on mobile when selecting a session
    await loadSessionEvents(session.id);
    // Load insights if they exist
    try {
      const res = await fetch(`/api/advisory/sessions/${session.id}/insights`);
      const data = await res.json();
      if (data.insights) setSessionInsights(data.insights);
    } catch { /* ignore */ }
  };

  const handleLaunch = async (session: AdvisorySession) => {
    setShowLaunchModal(false);
    setMobileSidebarOpen(false);
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

  // ── Review Loop handlers ───────────────────────────────────────────────────

  const handleLoopAction = async (action: string, extra?: Record<string, unknown>) => {
    if (!activeSession) return;
    setLoopAdvancing(true);
    try {
      await fetch(`/api/advisory/sessions/${activeSession.id}/review-loop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
    } catch (e) {
      console.error("Loop action error:", e);
    } finally {
      setLoopAdvancing(false);
    }
  };

  const handleAddLoopTask = async () => {
    if (!activeSession || !newTaskText.trim()) return;
    setAddingTask(true);
    try {
      await fetch(`/api/advisory/sessions/${activeSession.id}/review-loop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add-task", description: newTaskText.trim() }),
      });
      setNewTaskText("");
    } catch (e) {
      console.error("Add task error:", e);
    } finally {
      setAddingTask(false);
    }
  };

  const handleOverrideTask = async (taskId: number, newStatus: string, notes?: string) => {
    if (!activeSession) return;
    await handleLoopAction("override", { taskId, newStatus, notes });
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
    const fileName = `advisory-${dateStr}-${topicSlug}.txt`;
    const blob = new Blob([markdown], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportPDF = async () => {
    if (!activeSession || exportingPDF) return;
    setExportingPDF(true);
    try {
      await exportSessionAsPDF(
        activeSession as unknown as import("@/components/AdvisoryPDFExport").PDFSession,
        events as unknown as import("@/components/AdvisoryPDFExport").PDFEvent[]
      );
    } catch (e) {
      console.error("PDF export error:", e);
    } finally {
      setExportingPDF(false);
    }
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
      // 1. Immediately inject a "generating synthesis" placeholder into the event stream
      const synthesisPlaceholder = {
        id: `evt_synth_pending_${Date.now()}`,
        timestamp: new Date().toISOString(),
        type: "supervisor",
        speaker: "System",
        emoji: "⏳",
        role: "supervisor" as const,
        text: "⏳ **Generating final synthesis...** Henry is reviewing the full discussion and preparing closing remarks. This may take 15–30 seconds.",
      };
      setEvents((prev) => [...prev, synthesisPlaceholder]);
      setTimeout(() => scrollToBottom(), 100);

      // 2. Trigger the end-session synthesis (fire-and-forget on server)
      await fetch(`/api/advisory/sessions/${activeSession.id}/end`, {
        method: "POST",
      });
      // 3. Reload to see the updated session (events are still intact)
      await loadSessionEvents(activeSession.id, true);
      await loadSessions();
      // 4. Keep polling active so the synthesis event appears when it arrives
      setIsGenerating(true);
    } catch (e) {
      console.error("End session error:", e);
    } finally {
      setEndingSession(false);
      setEndSessionConfirm(false);
    }
  };

  // ── Request Full Round (persistent mode) ────────────────────────────────────
  const handleFullRound = async () => {
    if (!activeSession) return;
    setRequestingFullRound(true);
    try {
      await fetch(`/api/advisory/sessions/${activeSession.id}/full-round`, {
        method: "POST",
      });
      setIsGenerating(true);
    } catch (e) {
      console.error("Full round error:", e);
    } finally {
      setRequestingFullRound(false);
    }
  };

  // ── Continue Discussion (reopen completed session) ─────────────────────────
  const [continuing, setContinuing] = useState(false);
  const handleContinueDiscussion = async () => {
    if (!activeSession) return;
    setContinuing(true);
    try {
      // 1. Set status back to active with persistent rounds
      await fetch(`/api/advisory/sessions/${activeSession.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "active", completedAt: null, outcome: null, rounds: "persistent", paused: false }),
      });
      // 2. Update local state
      setActiveSession((s) => s ? { ...s, status: "active", completedAt: undefined, outcome: undefined } : s);
      setIsGenerating(false);
      await loadSessions();
      await loadSessionEvents(activeSession.id);
    } catch (e) {
      console.error("Continue discussion error:", e);
    } finally {
      setContinuing(false);
    }
  };

  // ── Insights extraction ─────────────────────────────────────────────────────
  const handleExtractInsights = async () => {
    if (!activeSession) return;
    setExtractingInsights(true);
    try {
      const res = await fetch(`/api/advisory/sessions/${activeSession.id}/insights`, {
        method: "POST",
      });
      const data = await res.json();
      if (data.insights) {
        setSessionInsights(data.insights);
      }
    } catch (e) {
      console.error("Insights extraction error:", e);
    } finally {
      setExtractingInsights(false);
    }
  };

  const handleToggleActionItem = async (index: number, status: "pending" | "done") => {
    if (!activeSession) return;
    try {
      const res = await fetch(`/api/advisory/sessions/${activeSession.id}/insights`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionIndex: index, status }),
      });
      const data = await res.json();
      if (data.insights) {
        setSessionInsights(data.insights);
      }
    } catch (e) {
      console.error("Toggle action item error:", e);
    }
  };

  // ── Retry session after error ────────────────────────────────────────────────
  const handleRetrySession = async () => {
    if (!activeSession) return;
    setRetrying(true);
    try {
      // Remove error events from local state
      setEvents((prev) => prev.filter((e) => e.type !== "error" && !e.error));
      // Re-trigger the run
      await fetch(`/api/advisory/sessions/${activeSession.id}/run`, {
        method: "POST",
      });
      setIsGenerating(true);
    } catch (e) {
      console.error("Retry error:", e);
    } finally {
      setRetrying(false);
    }
  };

  // ── Session Branching (Fork) ────────────────────────────────────────────────
  const [forking, setForking] = useState(false);

  const handleForkFromEvent = async (eventId: string) => {
    if (!activeSession || forking) return;
    setForking(true);
    try {
      // Find the event index and copy all events up to and including it
      const eventIndex = events.findIndex((e) => e.id === eventId);
      if (eventIndex === -1) return;
      const forkedEvents = events.slice(0, eventIndex + 1);

      // Create a new session with the same config
      const sessionData = activeSession as unknown as Record<string, unknown>;
      const res = await fetch("/api/advisory/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: activeSession.topic,
          mode: activeSession.mode,
          agents: activeSession.agents,
          reviewStyle: activeSession.reviewStyle,
          model: activeSession.model,
          rounds: "persistent",
          pacing: sessionData.pacing || "manual",
          responseLength: sessionData.responseLength || "balanced",
          extendedThinking: sessionData.extendedThinking || false,
          personaOverlays: sessionData.personaOverlays || {},
          specialist: sessionData.specialist || false,
          specialistAgent: sessionData.specialistAgent || null,
          forkedFrom: activeSession.id,
          forkedAtEvent: eventId,
        }),
      });
      if (!res.ok) throw new Error("Failed to create forked session");
      const data = await res.json();

      // Now patch the new session to replace the auto-generated start event with forked events
      // plus add a fork marker event
      const forkMarkerEvent: AdvisoryEvent = {
        id: `evt_fork_${Date.now()}`,
        timestamp: new Date().toISOString(),
        type: "start",
        speaker: "System",
        emoji: "🔀",
        role: "supervisor",
        text: `🔀 **Forked session.** This session was branched from "${activeSession.title || activeSession.topic}" at event ${eventIndex + 1} of ${events.length}.\n\nAll prior context has been preserved. Continue the discussion from this point.`,
      };

      const newEvents = [...forkedEvents, forkMarkerEvent];

      await fetch(`/api/advisory/sessions/${data.session.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          events: newEvents,
          forkedFrom: activeSession.id,
          forkedAtEvent: eventId,
        }),
      });

      // Navigate to the new session
      await loadSessions();
      await handleSelectSession({ ...data.session, events: newEvents });
      setActiveView("live");
    } catch (e) {
      console.error("Fork error:", e);
    } finally {
      setForking(false);
    }
  };

  // ── Deep Dive (1-on-1 specialist mode) ──────────────────────────────────────
  const [deepDiveAgent, setDeepDiveAgent] = useState<{ id: string; name: string; emoji: string; role: string } | null>(null);
  const [deepDiveTopic, setDeepDiveTopic] = useState("");
  const [deepDiveModel, setDeepDiveModel] = useState("claude-sonnet-4-6");
  const [launchingDeepDive, setLaunchingDeepDive] = useState(false);

  const handleDeepDive = (agentId: string, agentName: string, agentEmoji: string, agentRole: string) => {
    setShowLaunchModal(false);
    setDeepDiveAgent({ id: agentId, name: agentName, emoji: agentEmoji, role: agentRole });
    setDeepDiveTopic("");
    setDeepDiveModel("claude-sonnet-4-6");
  };

  const handleLaunchDeepDive = async () => {
    if (!deepDiveAgent || !deepDiveTopic.trim()) return;
    setLaunchingDeepDive(true);
    try {
      const res = await fetch("/api/advisory/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: deepDiveTopic,
          mode: "roundtable",
          agents: [deepDiveAgent.name],
          reviewStyle: "open",
          model: deepDiveModel,
          rounds: "persistent",
          pacing: "manual",
          responseLength: "detailed",
          specialist: true,
          specialistAgent: deepDiveAgent.name,
        }),
      });
      if (!res.ok) throw new Error("Failed to create session");
      const data = await res.json();

      // Trigger the first response
      try {
        await fetch(`/api/advisory/sessions/${data.session.id}/run`, { method: "POST" });
      } catch (runErr) {
        console.warn("Run trigger error (non-fatal):", runErr);
      }

      setDeepDiveAgent(null);
      await handleLaunch(data.session);
    } catch (e) {
      console.error("Deep dive launch error:", e);
    } finally {
      setLaunchingDeepDive(false);
    }
  };

  // ── Compare sessions ────────────────────────────────────────────────────────
  const handleToggleCompareSelection = (sessionId: string) => {
    setCompareSelections((prev) => {
      if (prev.includes(sessionId)) return prev.filter((s) => s !== sessionId);
      if (prev.length >= 2) return [prev[1], sessionId]; // replace oldest
      return [...prev, sessionId];
    });
  };

  const handleOpenCompare = async () => {
    if (compareSelections.length !== 2) return;
    const loaded: [AdvisorySession | null, AdvisorySession | null] = [null, null];
    for (let i = 0; i < 2; i++) {
      try {
        const res = await fetch(`/api/advisory/sessions/${compareSelections[i]}`);
        const data = await res.json();
        loaded[i] = data.session || null;
      } catch { /* ignore */ }
    }
    setCompareSessions(loaded as [AdvisorySession | null, AdvisorySession | null]);
    setShowCompareView(true);
    setCompareMode(false);
    setCompareSelections([]);
  };

  // ── Keyboard shortcuts ───────────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+N — new session (only when not in an input/textarea)
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
        if (tag !== "input" && tag !== "textarea") {
          e.preventDefault();
          setShowLaunchModal(true);
        }
      }

      // Escape — close open modals
      if (e.key === "Escape") {
        if (showCompareView) {
          setShowCompareView(false);
        } else if (compareMode) {
          setCompareMode(false);
          setCompareSelections([]);
        } else if (showLaunchModal) {
          setShowLaunchModal(false);
        }
        if (endSessionConfirm) {
          setEndSessionConfirm(false);
        }
        if (mobileSidebarOpen) {
          setMobileSidebarOpen(false);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showLaunchModal, endSessionConfirm, mobileSidebarOpen]);

  const liveSessions = sessions.filter((s) => s.status === "active");
  const completedSessions = sessions.filter((s) => s.status !== "active");

  return (
    <>
      {/* Markdown styles */}
      <style>{`
        .advisory-markdown p { margin: 0 0 0.85em 0; text-indent: 1.5em; word-break: normal; overflow-wrap: break-word; white-space: normal; line-height: 1.75; }
        .advisory-markdown p:first-child { text-indent: 0; }
        .advisory-markdown p:last-child { margin-bottom: 0; }
        .advisory-markdown h1 + p, .advisory-markdown h2 + p, .advisory-markdown h3 + p,
        .advisory-markdown blockquote p, .advisory-markdown li p { text-indent: 0; }
        .advisory-markdown ul { margin: 6px 0 10px 0; padding-left: 20px; list-style-type: disc; }
        .advisory-markdown ol { margin: 6px 0 10px 0; padding-left: 20px; list-style-type: decimal; }
        .advisory-markdown li { margin-bottom: 4px; word-break: normal; overflow-wrap: break-word; line-height: 1.6; }
        .advisory-markdown li > ul, .advisory-markdown li > ol { margin-top: 4px; margin-bottom: 4px; }
        .advisory-markdown strong { color: var(--text-primary); font-weight: 700; }
        .advisory-markdown em { font-style: italic; color: var(--text-secondary); }
        .advisory-markdown h1 { font-size: 16px; margin: 14px 0 6px 0; border-bottom: 1px solid var(--border); padding-bottom: 4px; }
        .advisory-markdown h2 { font-size: 14px; margin: 12px 0 5px 0; }
        .advisory-markdown h3 { font-size: 13px; margin: 10px 0 4px 0; }
        .advisory-markdown h4, .advisory-markdown h5, .advisory-markdown h6 { font-size: 12px; margin: 8px 0 4px 0; }
        .advisory-markdown h1, .advisory-markdown h2, .advisory-markdown h3,
        .advisory-markdown h4, .advisory-markdown h5, .advisory-markdown h6 {
          color: var(--text-primary);
          font-family: var(--font-heading);
          font-weight: 700;
          word-break: normal;
          overflow-wrap: break-word;
        }
        .advisory-markdown code {
          font-family: var(--font-mono);
          font-size: 11px;
          background: rgba(255,255,255,0.07);
          padding: 1px 5px;
          border-radius: 3px;
          border: 1px solid rgba(255,255,255,0.08);
        }
        .advisory-markdown pre code {
          background: none;
          padding: 0;
          border: none;
          font-size: 12px;
        }
        .advisory-markdown pre {
          background: rgba(0,0,0,0.35);
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 14px 16px;
          overflow-x: auto;
          margin: 10px 0;
          line-height: 1.5;
        }
        .advisory-markdown hr { border: none; border-top: 1px solid var(--border); margin: 14px 0; }
        .advisory-markdown blockquote {
          border-left: 3px solid var(--accent);
          padding: 4px 12px;
          color: var(--text-muted);
          margin: 8px 0;
          font-style: italic;
          background: rgba(139,92,246,0.04);
          border-radius: 0 6px 6px 0;
        }
        /* Tables */
        .advisory-markdown table {
          width: 100%;
          border-collapse: collapse;
          margin: 10px 0;
          font-size: 12px;
          overflow: hidden;
          border-radius: 8px;
          border: 1px solid var(--border);
        }
        .advisory-markdown th {
          background: rgba(139,92,246,0.1);
          color: var(--text-primary);
          font-weight: 700;
          padding: 8px 12px;
          text-align: left;
          font-size: 11px;
          letter-spacing: 0.04em;
          border-bottom: 1px solid var(--border);
        }
        .advisory-markdown td {
          padding: 7px 12px;
          border-bottom: 1px solid rgba(255,255,255,0.05);
          color: var(--text-secondary);
          vertical-align: top;
          line-height: 1.5;
        }
        .advisory-markdown tr:last-child td { border-bottom: none; }
        .advisory-markdown tr:nth-child(even) { background: rgba(255,255,255,0.02); }
        .advisory-markdown * {
          word-break: normal;
          overflow-wrap: break-word;
        }
        /* LIVE badge pulse */
        @keyframes live-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.8); }
        }
        .live-dot {
          animation: live-pulse 1.5s ease-in-out infinite;
        }
        /* Message fade-in from bottom */
        @keyframes msg-fadein {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .advisory-event-bubble {
          animation: msg-fadein 0.25s ease-out;
        }
        /* Typing indicator dot bounce */
        @keyframes typing-dot {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
          30% { transform: translateY(-5px); opacity: 1; }
        }
        /* Agent avatar thinking pulse */
        @keyframes thinking-pulse {
          0%, 100% { transform: scale(1); opacity: 0.6; }
          50% { transform: scale(1.15); opacity: 1; }
        }
        /* Mobile slide-in sidebar */
        @keyframes slide-in-left {
          from { transform: translateX(-100%); }
          to { transform: translateX(0); }
        }
        /* ─── Mobile responsive ─────────────────────── */
        @media (max-width: 768px) {
          /* Layout adjustments */
          .advisory-layout {
            position: relative;
          }
          /* Mobile sidebar overlay */
          .advisory-sidebar {
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            bottom: 0 !important;
            z-index: 300 !important;
            width: 300px !important;
            max-width: 85vw !important;
            box-shadow: 4px 0 24px rgba(0,0,0,0.4) !important;
            animation: slide-in-left 0.2s ease-out;
          }
          .advisory-sidebar.closed {
            display: none !important;
          }
          /* Mobile overlay backdrop */
          .mobile-sidebar-backdrop {
            display: block !important;
          }
          /* Hide right sidebar on mobile */
          .advisory-right-sidebar {
            display: none !important;
          }
          /* Full-width chat on mobile */
          .advisory-main {
            width: 100% !important;
          }
          /* Larger touch targets for buttons */
          .advisory-mobile-menu-btn {
            display: flex !important;
          }
          /* Event bubbles — tighter on mobile */
          .advisory-event-bubble {
            padding: 12px !important;
          }
          /* Reduce session header padding */
          .advisory-session-header {
            padding: 12px 16px !important;
          }
          /* Compact input bar */
          .advisory-input-bar {
            padding: 10px 16px 12px !important;
          }
          /* Events stream */
          .advisory-events-stream {
            padding: 14px 16px !important;
          }
          /* Smaller wizard modal */
          .advisory-modal-inner {
            padding: 20px 16px !important;
            border-radius: 12px !important;
          }
        }
        @media (min-width: 769px) {
          .advisory-mobile-menu-btn {
            display: none !important;
          }
          .advisory-sidebar {
            display: flex !important;
          }
          .mobile-sidebar-backdrop {
            display: none !important;
          }
        }
      `}</style>

      {/* Mobile sidebar backdrop */}
      {mobileSidebarOpen && (
        <div
          className="mobile-sidebar-backdrop"
          onClick={() => setMobileSidebarOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.5)",
            zIndex: 299,
            display: "none", // shown via CSS on mobile
          }}
        />
      )}

      <div className="advisory-layout" style={{ display: "flex", height: "calc(100vh - 80px)", gap: "0", minHeight: 0, position: "relative", margin: "-24px", width: "calc(100% + 48px)" }}>

        {/* ─── LEFT SIDEBAR ──────────────────────────────── */}
        <div
          className={`advisory-sidebar${mobileSidebarOpen ? "" : " closed"}`}
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
              <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <button
                  onClick={handleRefresh}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: "6px" }}
                  title="Refresh"
                >
                  <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
                </button>
                {/* Close button — mobile only */}
                <button
                  className="advisory-mobile-menu-btn"
                  onClick={() => setMobileSidebarOpen(false)}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--text-muted)",
                    padding: "6px",
                    alignItems: "center",
                    justifyContent: "center",
                    display: "none", // shown via CSS
                  }}
                  aria-label="Close sidebar"
                >
                  <X size={16} />
                </button>
              </div>
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
            <button
              onClick={() => {
                setCompareMode((v) => !v);
                setCompareSelections([]);
              }}
              style={{
                width: "100%",
                padding: "7px",
                borderRadius: "8px",
                border: `1px solid ${compareMode ? "rgba(96,165,250,0.5)" : "var(--border)"}`,
                backgroundColor: compareMode ? "rgba(96,165,250,0.1)" : "transparent",
                color: compareMode ? "#60a5fa" : "var(--text-muted)",
                cursor: "pointer",
                fontSize: "11px",
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "6px",
                fontFamily: "var(--font-body)",
                marginTop: "6px",
                transition: "all 150ms ease",
              }}
            >
              <Columns2 size={13} />
              {compareMode ? `Compare (${compareSelections.length}/2)` : "Compare Sessions"}
            </button>
            {compareMode && compareSelections.length === 2 && (
              <button
                onClick={handleOpenCompare}
                style={{
                  width: "100%",
                  padding: "8px",
                  borderRadius: "8px",
                  border: "none",
                  backgroundColor: "#60a5fa",
                  color: "#fff",
                  cursor: "pointer",
                  fontSize: "11px",
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "6px",
                  fontFamily: "var(--font-heading)",
                  marginTop: "4px",
                }}
              >
                <BarChart3 size={13} />
                Open Comparison
              </button>
            )}
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

          {/* Search bar */}
          <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)" }}>
            <div style={{ position: "relative" }}>
              <Search
                size={12}
                style={{
                  position: "absolute",
                  left: "9px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "var(--text-muted)",
                  pointerEvents: "none",
                }}
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search topics..."
                style={{
                  width: "100%",
                  padding: "6px 8px 6px 26px",
                  backgroundColor: "var(--surface-elevated)",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  color: "var(--text-primary)",
                  fontSize: "11px",
                  fontFamily: "var(--font-body)",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  style={{
                    position: "absolute",
                    right: "6px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--text-muted)",
                    padding: "2px",
                    display: "flex",
                    alignItems: "center",
                  }}
                >
                  <X size={10} />
                </button>
              )}
            </div>

            {/* Agent filter */}
            <div style={{ marginTop: "6px" }}>
              <button
                onClick={() => setShowFilters((v) => !v)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: filterAgent ? "var(--accent)" : "var(--text-muted)",
                  fontSize: "10px",
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                  padding: "2px 0",
                  fontWeight: filterAgent ? 700 : 500,
                }}
              >
                <Search size={10} />
                {filterAgent ? `Filter: ${filterAgent}` : "Filter by agent"}
                {filterAgent && (
                  <span
                    onClick={(e) => { e.stopPropagation(); setFilterAgent(""); }}
                    style={{ marginLeft: "4px", color: "var(--accent)", fontWeight: 700 }}
                  >
                    ✕
                  </span>
                )}
              </button>

              {showFilters && (
                <div
                  style={{
                    marginTop: "6px",
                    padding: "8px",
                    backgroundColor: "var(--surface-elevated)",
                    border: "1px solid var(--border)",
                    borderRadius: "8px",
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "4px",
                  }}
                >
                  {AGENTS.map((agent) => (
                    <button
                      key={agent.id}
                      onClick={() => {
                        setFilterAgent((prev) => prev === agent.id ? "" : agent.id);
                        setShowFilters(false);
                      }}
                      style={{
                        padding: "3px 7px",
                        borderRadius: "12px",
                        border: `1px solid ${filterAgent === agent.id ? "var(--accent)" : "var(--border)"}`,
                        backgroundColor: filterAgent === agent.id ? "var(--accent-soft)" : "transparent",
                        color: filterAgent === agent.id ? "var(--accent)" : "var(--text-muted)",
                        cursor: "pointer",
                        fontSize: "10px",
                        fontWeight: filterAgent === agent.id ? 700 : 500,
                        display: "flex",
                        alignItems: "center",
                        gap: "4px",
                        transition: "all 100ms ease",
                      }}
                    >
                      <span>{agent.emoji}</span>
                      <span>{agent.id}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Session list */}
          <div style={{ flex: 1, overflowY: "auto", padding: "10px 12px" }}>
            {loading ? (
              <div style={{ display: "flex", justifyContent: "center", padding: "32px 0", color: "var(--text-muted)" }}>
                <Loader2 size={18} className="animate-spin" />
              </div>
            ) : (() => {
              const baseSessions = activeView === "live" ? liveSessions : completedSessions;
              // Apply search filter
              const displaySessions = baseSessions.filter((s) => {
                const matchesSearch = !searchQuery ||
                  s.topic.toLowerCase().includes(searchQuery.toLowerCase());
                const matchesAgent = !filterAgent ||
                  s.agents.some((a) => a.toLowerCase() === filterAgent.toLowerCase());
                return matchesSearch && matchesAgent;
              });
              if (displaySessions.length === 0) {
                return (
                  <div style={{ textAlign: "center", padding: "32px 16px", color: "var(--text-muted)" }}>
                    {searchQuery || filterAgent ? (
                      <>
                        <Search size={20} style={{ opacity: 0.4, margin: "0 auto 8px" }} />
                        <div style={{ fontSize: "12px", marginBottom: "4px" }}>No matching sessions</div>
                        <button
                          onClick={() => { setSearchQuery(""); setFilterAgent(""); }}
                          style={{
                            marginTop: "8px",
                            fontSize: "10px",
                            color: "var(--accent)",
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                            fontWeight: 600,
                          }}
                        >
                          Clear filters
                        </button>
                      </>
                    ) : activeView === "live" ? (
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
                  compareMode={compareMode}
                  compareSelected={compareSelections.includes(s.id)}
                  onCompareToggle={() => handleToggleCompareSelection(s.id)}
                />
              ));
            })()}
          </div>
        </div>

        {/* ─── MAIN CONTENT ─────────────────────────────── */}
        <div className="advisory-main" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
          {/* Mobile top bar — always visible, shows hamburger + title */}
          <div
            className="advisory-mobile-menu-btn"
            style={{
              display: "none", // shown by CSS on mobile
              alignItems: "center",
              gap: "10px",
              padding: "10px 16px",
              borderBottom: "1px solid var(--border)",
              backgroundColor: "var(--surface)",
              flexShrink: 0,
            }}
          >
            <button
              onClick={() => setMobileSidebarOpen(true)}
              style={{
                background: "none",
                border: "1px solid var(--border)",
                cursor: "pointer",
                color: "var(--text-primary)",
                padding: "6px 10px",
                borderRadius: "6px",
                display: "flex",
                alignItems: "center",
                gap: "5px",
                fontSize: "12px",
                fontWeight: 600,
              }}
            >
              <Users size={14} />
              Sessions
            </button>
            <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-primary)", fontFamily: "var(--font-heading)" }}>
              Advisory Board
            </span>
            <button
              onClick={() => setShowLaunchModal(true)}
              style={{
                marginLeft: "auto",
                padding: "6px 12px",
                borderRadius: "6px",
                border: "none",
                backgroundColor: "var(--accent)",
                color: "#fff",
                cursor: "pointer",
                fontSize: "11px",
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                gap: "4px",
              }}
            >
              <Plus size={12} />
              New
            </button>
          </div>

          {activeSession ? (
            <>
              {/* Session header */}
              <div
                className="advisory-session-header"
                style={{
                  padding: "16px 24px",
                  borderBottom: `1px solid ${(activeSession as unknown as Record<string, unknown>).specialist ? "rgba(16,185,129,0.3)" : "var(--border)"}`,
                  backgroundColor: (activeSession as unknown as Record<string, unknown>).specialist ? "rgba(16,185,129,0.03)" : "var(--surface)",
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
                              <span className="live-dot" style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: badge.color, display: "inline-block" }} />
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
                      {!!(activeSession as unknown as Record<string, unknown>).specialist && (
                        <span style={{
                          fontSize: "9px",
                          fontWeight: 700,
                          color: "#10b981",
                          backgroundColor: "rgba(16,185,129,0.12)",
                          border: "1px solid rgba(16,185,129,0.3)",
                          padding: "2px 7px",
                          borderRadius: "4px",
                          fontFamily: "var(--font-mono)",
                          letterSpacing: "0.04em",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "4px",
                        }}>
                          <Focus size={9} />
                          DEEP DIVE
                        </span>
                      )}
                      {(activeSession as unknown as Record<string, unknown>).rounds === "persistent" && !(activeSession as unknown as Record<string, unknown>).specialist && (
                        <span style={{
                          fontSize: "9px",
                          fontWeight: 700,
                          color: "#a78bfa",
                          backgroundColor: "rgba(167,139,250,0.12)",
                          border: "1px solid rgba(167,139,250,0.3)",
                          padding: "2px 7px",
                          borderRadius: "4px",
                          fontFamily: "var(--font-mono)",
                          letterSpacing: "0.04em",
                        }}>∞ PERSISTENT</span>
                      )}
                      {!!(activeSession as unknown as Record<string, unknown>).forkedFrom && (
                        <span style={{
                          fontSize: "9px",
                          fontWeight: 700,
                          color: "#60a5fa",
                          backgroundColor: "rgba(96,165,250,0.12)",
                          border: "1px solid rgba(96,165,250,0.3)",
                          padding: "2px 7px",
                          borderRadius: "4px",
                          fontFamily: "var(--font-mono)",
                          letterSpacing: "0.04em",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "4px",
                        }}>
                          <GitBranch size={9} />
                          FORKED
                        </span>
                      )}
                      {!!(activeSession as unknown as Record<string, unknown>).referenceContext && (
                        <span style={{
                          fontSize: "9px",
                          fontWeight: 700,
                          color: "#a78bfa",
                          backgroundColor: "rgba(167,139,250,0.12)",
                          border: "1px solid rgba(167,139,250,0.3)",
                          padding: "2px 7px",
                          borderRadius: "4px",
                          fontFamily: "var(--font-mono)",
                          letterSpacing: "0.04em",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "4px",
                        }}>
                          <Paperclip size={9} />
                          REF MATERIAL
                        </span>
                      )}
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
                        wordBreak: "normal",
                        overflowWrap: "anywhere",
                        whiteSpace: "normal",
                      }}
                    >
                      {activeSession.title
                        ? activeSession.title
                        : activeSession.topic.length > 100
                        ? `${activeSession.topic.slice(0, 100)}...`
                        : activeSession.topic}
                    </h2>
                    {activeSession.title && (
                      <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "3px", fontStyle: "italic" }}>
                        {activeSession.topic.length > 80
                          ? `${activeSession.topic.slice(0, 80)}...`
                          : activeSession.topic}
                      </div>
                    )}
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
                        title="Export as plain text file"
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
                      <button
                        onClick={handleExportPDF}
                        disabled={exportingPDF}
                        title="Export as PDF"
                        style={{
                          padding: "6px 10px",
                          borderRadius: "6px",
                          border: "1px solid rgba(139,92,246,0.4)",
                          backgroundColor: exportingPDF ? "rgba(139,92,246,0.2)" : "rgba(139,92,246,0.1)",
                          color: "#a78bfa",
                          cursor: exportingPDF ? "not-allowed" : "pointer",
                          fontSize: "11px",
                          display: "flex",
                          alignItems: "center",
                          gap: "5px",
                          fontWeight: 600,
                          opacity: exportingPDF ? 0.7 : 1,
                          transition: "all 150ms ease",
                        }}
                      >
                        {exportingPDF ? <Loader2 size={12} className="animate-spin" /> : <FileDown size={12} />}
                        {exportingPDF ? "Generating..." : "PDF"}
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

              {/* Review Loop: Horizontal split layout */}
              <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

              {/* Review Loop Task Panel (left) */}
              {reviewLoop && activeSession?.mode === "review" && (
                <ReviewLoopTaskPanel
                  loop={reviewLoop}
                  onOverride={handleOverrideTask}
                  onAddTask={handleAddLoopTask}
                  onAdvance={() => handleLoopAction(
                    reviewLoop.tasks[reviewLoop.currentTaskIndex]?.status === "rejected" ? "advance" : "advance"
                  )}
                  onPause={() => handleLoopAction("pause")}
                  onResume={() => handleLoopAction("resume")}
                  selectedTaskId={selectedTaskId}
                  onSelectTask={setSelectedTaskId}
                  newTaskText={newTaskText}
                  onNewTaskTextChange={setNewTaskText}
                  addingTask={addingTask}
                  loopAdvancing={loopAdvancing}
                  sessionStatus={activeSession?.status || "active"}
                  onSetAutoContinue={(val) => handleLoopAction("set-auto-continue", { autoContinue: val })}
                />
              )}

              {/* Events stream (scroll container) */}
              <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
              <div
                ref={scrollContainerRef}
                className="advisory-events-stream"
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
                        sessionOverlays={
                          ((activeSession as unknown as Record<string, unknown>).personaOverlays as Record<string, string> | string[] | undefined) ?? {}
                        }
                        sessionTopic={activeSession?.topic}
                        onRetry={(event.type === "error" || event.error) ? handleRetrySession : undefined}
                        onFork={event.type !== "start" && !event.error ? () => handleForkFromEvent(event.id) : undefined}
                      />
                    ))}
                    {isGenerating && activeSession?.status === "active" && !isPaused && (
                      <TypingIndicator agentId={thinkingAgent} />
                    )}
                    {/* Session Insights Panel — shown for completed sessions */}
                    {activeSession?.status === "completed" && (
                      <SessionInsightsPanel
                        insights={sessionInsights}
                        onToggleAction={handleToggleActionItem}
                        extracting={extractingInsights}
                        onExtract={handleExtractInsights}
                      />
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
                </div>
              )}

              {/* Human input bar */}
              {activeSession.status === "active" && (
                <div
                  className="advisory-input-bar"
                  style={{
                    padding: "12px 24px 16px",
                    borderTop: "1px solid var(--border)",
                    backgroundColor: "var(--surface)",
                    flexShrink: 0,
                  }}
                >
                  <div style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                    <div style={{ flex: 1 }}>
                      <textarea
                        ref={humanInputRef}
                        value={humanMessage}
                        onChange={(e) => setHumanMessage(e.target.value)}
                        placeholder={
                          (activeSession as unknown as Record<string, unknown>).specialist
                            ? `Continue your conversation with ${(activeSession as unknown as Record<string, unknown>).specialistAgent || activeSession.agents[0]}...`
                            : "Type a directive to inject into the session..."
                        }
                        rows={2}
                        onKeyDown={(e) => {
                          // Enter (without Shift) = send; Shift+Enter = newline
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            if (humanMessage.trim()) handleSendMessage();
                          }
                          // Cmd+Enter also sends
                          if (e.key === "Enter" && e.metaKey) {
                            e.preventDefault();
                            if (humanMessage.trim()) handleSendMessage();
                          }
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
                        ↵ to send · Shift+↵ for newline · ⌘N new session · Esc close modal
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
                        marginTop: "0px",
                      }}
                    >
                      {sendingMessage ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                      Send
                    </button>
                  </div>
                </div>
              )}

              {/* Persistent session - Request Full Round button */}
              {activeSession.status === "active" && (activeSession as unknown as Record<string, unknown>).rounds === "persistent" && (
                <div
                  style={{
                    padding: "10px 24px",
                    borderTop: "1px solid rgba(139,92,246,0.2)",
                    backgroundColor: "rgba(139,92,246,0.04)",
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    flexShrink: 0,
                  }}
                >
                  <span style={{ fontSize: "11px", color: "var(--text-muted)", flex: 1 }}>
                    {(activeSession as unknown as Record<string, unknown>).specialist
                      ? `Deep dive with ${(activeSession as unknown as Record<string, unknown>).specialistAgent || activeSession.agents[0]} — ask anything`
                      : "Persistent session — agents wait for your directives"}
                  </span>
                  <button
                    onClick={handleFullRound}
                    disabled={requestingFullRound || isGenerating}
                    style={{
                      padding: "7px 14px",
                      borderRadius: "7px",
                      border: "1px solid rgba(139,92,246,0.5)",
                      backgroundColor: "rgba(139,92,246,0.12)",
                      color: "#a78bfa",
                      cursor: requestingFullRound || isGenerating ? "not-allowed" : "pointer",
                      fontSize: "11px",
                      fontWeight: 700,
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      opacity: requestingFullRound || isGenerating ? 0.6 : 1,
                      fontFamily: "var(--font-heading)",
                      transition: "all 150ms ease",
                    }}
                  >
                    {requestingFullRound ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                    Request Full Round
                  </button>
                </div>
              )}

              {/* Completed session summary */}
              {activeSession.status === "completed" && (
                <div
                  style={{
                    padding: "14px 24px",
                    borderTop: "2px solid rgba(74,222,128,0.4)",
                    backgroundColor: "rgba(74,222,128,0.05)",
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    flexShrink: 0,
                  }}
                >
                  <CheckCircle2 size={16} color="#4ade80" />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: "12px", fontWeight: 700, color: "#4ade80" }}>
                      Session Completed
                    </div>
                    <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "1px" }}>
                      {activeSession.completedAt ? formatDate(activeSession.completedAt) : ""}
                      {activeSession.outcome ? ` · ${activeSession.outcome.replace(/-/g, " ")}` : ""}
                    </div>
                  </div>
                  <button
                    onClick={handleContinueDiscussion}
                    disabled={continuing}
                    title="Reopen session for additional rounds"
                    style={{
                      padding: "6px 12px",
                      borderRadius: "6px",
                      border: "1px solid rgba(139,92,246,0.5)",
                      backgroundColor: continuing ? "rgba(139,92,246,0.2)" : "rgba(139,92,246,0.12)",
                      color: "#a78bfa",
                      cursor: continuing ? "not-allowed" : "pointer",
                      fontSize: "11px",
                      display: "flex",
                      alignItems: "center",
                      gap: "5px",
                      fontWeight: 700,
                      opacity: continuing ? 0.6 : 1,
                      fontFamily: "var(--font-heading)",
                      transition: "all 150ms ease",
                    }}
                  >
                    {continuing ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                    Continue Discussion
                  </button>
                  <button
                    onClick={handleExportPDF}
                    disabled={exportingPDF}
                    title="Export as PDF"
                    style={{
                      padding: "6px 12px",
                      borderRadius: "6px",
                      border: "1px solid rgba(139,92,246,0.4)",
                      backgroundColor: exportingPDF ? "rgba(139,92,246,0.2)" : "rgba(139,92,246,0.08)",
                      color: "#a78bfa",
                      cursor: exportingPDF ? "not-allowed" : "pointer",
                      fontSize: "11px",
                      display: "flex",
                      alignItems: "center",
                      gap: "5px",
                      fontWeight: 600,
                      opacity: exportingPDF ? 0.6 : 1,
                    }}
                  >
                    {exportingPDF ? <Loader2 size={12} className="animate-spin" /> : <FileDown size={12} />}
                    {exportingPDF ? "Generating..." : "Export PDF"}
                  </button>
                  <button
                    onClick={handleArchive}
                    disabled={archiving}
                    title="Archive session to workspace memory"
                    style={{
                      padding: "6px 12px",
                      borderRadius: "6px",
                      border: "1px solid rgba(74,222,128,0.3)",
                      backgroundColor: "rgba(74,222,128,0.08)",
                      color: "#4ade80",
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
              </div>{/* close events column */}
              </div>{/* close horizontal split */}
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
        {activeSession && false && (
          <div
            className="advisory-right-sidebar"
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
                  const r = agentRatingsGlobal[agentId];
                  return (
                    <div key={agentId} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <AgentAvatar agentId={agentId} size={32} borderWidth={2} />
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                          <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-primary)" }}>{agentId}</span>
                          {r && r.total > 0 && (
                            <span style={{
                              fontSize: "8px", fontWeight: 700, fontFamily: "var(--font-mono)",
                              color: (r.pct ?? 0) >= 70 ? "#4ade80" : (r.pct ?? 0) >= 40 ? "#fbbf24" : "#ef4444",
                              display: "flex", alignItems: "center", gap: "2px",
                            }}>
                              <ThumbsUp size={8} /> {r.pct}% ({r.total})
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: "9px", color: "var(--text-muted)" }}>
                          {agent?.role ?? "Agent"}
                          {r?.bestTopic && <span style={{ opacity: 0.7 }}> · Best: {r.bestTopic.length > 25 ? r.bestTopic.slice(0, 25) + "…" : r.bestTopic}</span>}
                        </div>
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
                <InfoRow label="Mode" value={activeSession.mode || "roundtable"} />
                <InfoRow label="Style" value={activeSession.reviewStyle || (activeSession.mode === "roundtable" ? "open" : "—")} />
                <InfoRow label="Model" value={
                  activeSession.model
                    ? activeSession.model.replace("claude-", "").replace("-4-6", "").replace("gemini-", "").replace("-flash", "/flash").replace("-pro", "/pro")
                    : "gemini-flash"
                } />
                <InfoRow label="Events" value={String(events.length > 0 ? events.length : (activeSession.eventCount ?? 0))} />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>Rounds</span>
                  <RoundsDisplay session={activeSession} />
                </div>
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
          customAgents={customAgents}
          onCustomAgentsChange={loadCustomAgents}
          onDeepDive={handleDeepDive}
        />
      )}

      {/* Deep Dive (1-on-1 Specialist) Modal */}
      {/* Session Comparison Modal */}
      {showCompareView && compareSessions[0] && compareSessions[1] && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 300,
            padding: "20px",
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowCompareView(false); }}
        >
          <div
            style={{
              backgroundColor: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "16px",
              width: "100%",
              maxWidth: "1200px",
              height: "85vh",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {/* Header */}
            <div style={{
              padding: "16px 20px",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexShrink: 0,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <Columns2 size={18} color="#60a5fa" />
                <h2 style={{ fontSize: "16px", fontWeight: 700, color: "var(--text-primary)", margin: 0, fontFamily: "var(--font-heading)" }}>
                  Session Comparison
                </h2>
              </div>
              <button onClick={() => setShowCompareView(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: "4px" }}>
                <X size={20} />
              </button>
            </div>

            {/* Side-by-side panels */}
            <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
              {([compareSessions[0], compareSessions[1]] as AdvisorySession[]).map((sess, idx) => {
                const sessEvents = (sess.events || []) as AdvisoryEvent[];
                const sessionData = sess as unknown as Record<string, unknown>;
                return (
                  <div
                    key={sess.id || idx}
                    style={{
                      flex: 1,
                      display: "flex",
                      flexDirection: "column",
                      borderRight: idx === 0 ? "1px solid var(--border)" : "none",
                      overflow: "hidden",
                    }}
                  >
                    {/* Session header */}
                    <div style={{
                      padding: "12px 16px",
                      borderBottom: "1px solid var(--border)",
                      backgroundColor: idx === 0 ? "rgba(96,165,250,0.04)" : "rgba(167,139,250,0.04)",
                      flexShrink: 0,
                    }}>
                      <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-primary)", marginBottom: "6px", lineHeight: 1.4 }}>
                        {sess.title || sess.topic}
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "6px" }}>
                        <span style={{
                          fontSize: "8px", fontWeight: 700, letterSpacing: "0.06em",
                          color: "#60a5fa", backgroundColor: "rgba(96,165,250,0.12)",
                          border: "1px solid rgba(96,165,250,0.3)", padding: "2px 5px",
                          borderRadius: "3px", fontFamily: "var(--font-mono)",
                        }}>{sess.mode}</span>
                        {sess.model && (
                          <span style={{
                            fontSize: "8px", fontWeight: 600,
                            color: "var(--text-muted)", backgroundColor: "rgba(100,116,139,0.08)",
                            border: "1px solid rgba(100,116,139,0.2)", padding: "2px 5px",
                            borderRadius: "3px", fontFamily: "var(--font-mono)",
                          }}>{sess.model}</span>
                        )}
                        {!!sessionData.responseLength && (
                          <span style={{
                            fontSize: "8px", fontWeight: 600,
                            color: "var(--text-muted)", backgroundColor: "rgba(100,116,139,0.08)",
                            border: "1px solid rgba(100,116,139,0.2)", padding: "2px 5px",
                            borderRadius: "3px", fontFamily: "var(--font-mono)",
                          }}>{String(sessionData.responseLength)}</span>
                        )}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <AvatarStack agentIds={sess.agents} size={20} max={5} />
                        <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>
                          {sess.agents.join(", ")} · {sessEvents.length} events
                        </span>
                      </div>
                      {sess.outcome && (
                        <div style={{ fontSize: "9px", color: "var(--text-muted)", marginTop: "4px", fontFamily: "var(--font-mono)" }}>
                          Outcome: {sess.outcome}
                        </div>
                      )}
                    </div>

                    {/* Events scroll */}
                    <div style={{
                      flex: 1,
                      overflowY: "auto",
                      padding: "12px 14px",
                    }}>
                      {sessEvents.filter((e) => e.text && e.speaker).map((event) => {
                        const evtStyle = getEventStyle(event);
                        const agentConfig = event.speaker !== "Tim" ? getAgentByAnyId(event.speaker) : null;
                        const isHuman = event.speaker === "Tim";
                        const isSystem = event.type === "start" || event.type === "complete";
                        const displayText = isHuman
                          ? event.text.replace(/^\*\*\[Human Directive\]\*\*\s*/i, "").trim()
                          : event.text;

                        return (
                          <div
                            key={event.id}
                            style={{
                              padding: "10px 12px",
                              borderRadius: "10px",
                              border: `1px solid ${evtStyle.border}`,
                              backgroundColor: evtStyle.bg,
                              marginBottom: "8px",
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                              {isHuman ? (
                                <div style={{
                                  width: 24, height: 24, borderRadius: "50%",
                                  backgroundColor: "rgba(251,191,36,0.15)", border: "2px solid rgba(251,191,36,0.5)",
                                  display: "flex", alignItems: "center", justifyContent: "center",
                                  fontSize: "10px", fontWeight: 700, color: "#fbbf24",
                                }}>T</div>
                              ) : isSystem ? (
                                <span style={{ fontSize: "14px" }}>{event.emoji}</span>
                              ) : agentConfig ? (
                                <AgentAvatar agentId={event.speaker} size={24} borderWidth={2} />
                              ) : (
                                <span style={{ fontSize: "14px" }}>{event.emoji}</span>
                              )}
                              <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-primary)" }}>
                                {isHuman ? "Tim Harris" : event.speaker}
                              </span>
                              <span style={{ fontSize: "9px", color: "var(--text-muted)", marginLeft: "auto" }}>
                                {formatTime(event.timestamp)}
                              </span>
                            </div>
                            <div
                              style={{ fontSize: "11px", color: "var(--text-primary)", lineHeight: 1.6, marginLeft: "32px" }}
                              className="advisory-markdown"
                            >
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayText}</ReactMarkdown>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {deepDiveAgent && (
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
          onClick={(e) => { if (e.target === e.currentTarget) setDeepDiveAgent(null); }}
        >
          <div
            style={{
              backgroundColor: "var(--surface)",
              border: "1px solid rgba(16,185,129,0.3)",
              borderRadius: "16px",
              width: "100%",
              maxWidth: "500px",
              padding: "32px",
            }}
          >
            {/* Agent showcase */}
            <div style={{ textAlign: "center", marginBottom: "24px" }}>
              <div style={{ marginBottom: "12px" }}>
                {getAgentByAnyId(deepDiveAgent.id) ? (
                  <AgentAvatar agentId={deepDiveAgent.id} size={72} borderWidth={3} />
                ) : (
                  <div style={{
                    width: 72,
                    height: 72,
                    borderRadius: "50%",
                    backgroundColor: "rgba(16,185,129,0.12)",
                    border: "3px solid rgba(16,185,129,0.4)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "32px",
                    margin: "0 auto",
                  }}>
                    {deepDiveAgent.emoji}
                  </div>
                )}
              </div>
              <h2 style={{ fontSize: "20px", fontWeight: 700, color: "var(--text-primary)", margin: "0 0 4px 0", fontFamily: "var(--font-heading)" }}>
                Deep Dive with {deepDiveAgent.name}
              </h2>
              <div style={{ fontSize: "12px", color: "#10b981", fontWeight: 600 }}>
                {deepDiveAgent.role}
              </div>
              <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "4px" }}>
                1-on-1 focused consultation · Persistent session
              </div>
            </div>

            {/* Topic */}
            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", fontSize: "11px", fontWeight: 700, letterSpacing: "0.06em", color: "var(--text-muted)", marginBottom: "6px", fontFamily: "var(--font-mono)" }}>
                TOPIC
              </label>
              <textarea
                value={deepDiveTopic}
                onChange={(e) => setDeepDiveTopic(e.target.value)}
                placeholder={`What would you like to discuss with ${deepDiveAgent.name}?`}
                rows={3}
                autoFocus
                style={{
                  width: "100%",
                  padding: "12px 14px",
                  backgroundColor: "var(--surface-elevated)",
                  border: "1px solid rgba(16,185,129,0.25)",
                  borderRadius: "10px",
                  color: "var(--text-primary)",
                  fontSize: "14px",
                  fontFamily: "var(--font-body)",
                  resize: "vertical",
                  outline: "none",
                  boxSizing: "border-box",
                  lineHeight: 1.6,
                }}
              />
            </div>

            {/* Model selection */}
            <div style={{ marginBottom: "24px" }}>
              <label style={{ display: "block", fontSize: "11px", fontWeight: 700, letterSpacing: "0.06em", color: "var(--text-muted)", marginBottom: "6px", fontFamily: "var(--font-mono)" }}>
                MODEL
              </label>
              <div style={{ display: "flex", gap: "6px" }}>
                {MODELS.map((m) => {
                  const sel = deepDiveModel === m.id;
                  return (
                    <button
                      key={m.id}
                      onClick={() => setDeepDiveModel(m.id)}
                      style={{
                        flex: 1,
                        padding: "8px 10px",
                        borderRadius: "8px",
                        border: `1px solid ${sel ? "rgba(16,185,129,0.5)" : "var(--border)"}`,
                        backgroundColor: sel ? "rgba(16,185,129,0.1)" : "var(--surface-elevated)",
                        cursor: "pointer",
                        textAlign: "center",
                        transition: "all 150ms ease",
                      }}
                    >
                      <div style={{ fontSize: "10px", fontWeight: 700, color: sel ? "#10b981" : "var(--text-primary)" }}>{m.label.split(" (")[0]}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
              <button
                onClick={() => setDeepDiveAgent(null)}
                style={{ padding: "10px 20px", borderRadius: "8px", border: "1px solid var(--border)", backgroundColor: "transparent", color: "var(--text-secondary)", cursor: "pointer", fontSize: "13px", fontWeight: 500 }}
              >
                Cancel
              </button>
              <button
                onClick={handleLaunchDeepDive}
                disabled={launchingDeepDive || !deepDiveTopic.trim()}
                style={{
                  padding: "10px 24px",
                  borderRadius: "8px",
                  border: "none",
                  backgroundColor: "#10b981",
                  color: "#fff",
                  cursor: launchingDeepDive || !deepDiveTopic.trim() ? "not-allowed" : "pointer",
                  fontSize: "13px",
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  opacity: launchingDeepDive || !deepDiveTopic.trim() ? 0.6 : 1,
                  fontFamily: "var(--font-heading)",
                }}
              >
                {launchingDeepDive ? <Loader2 size={14} className="animate-spin" /> : <Focus size={14} />}
                Start Deep Dive
              </button>
            </div>
          </div>
        </div>
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
