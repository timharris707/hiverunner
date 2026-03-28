"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AgentAvatar } from "@/components/AgentAvatar";
import {
  Plus,
  ChevronRight,
  Search,
  Radar,
  Trash2,
  Pause,
  Play,
  Rocket,
  ArrowRight,
} from "lucide-react";

/* ── Types (mirrors server types) ── */

type PipelineStage = "idea" | "architecture" | "build" | "test" | "deploy";

interface StageTransition {
  from: string;
  to: PipelineStage;
  timestamp: string;
  agent?: string;
  summary?: string;
}

interface FactoryPipeline {
  id: string;
  name: string;
  description: string;
  source: "manual" | "reddit" | "idea-intake";
  stage: PipelineStage;
  status: "active" | "completed" | "failed" | "paused";
  createdAt: string;
  updatedAt: string;
  assignedAgent?: string;
  idea?: {
    problem: string;
    targetAudience: string;
    marketSignal?: string;
    sourceUrl?: string;
    subreddit?: string;
    viabilityScore?: number;
    competitors?: string[];
    keywords?: string[];
  };
  architecture?: {
    techStack: string[];
    components: { name: string; description: string }[];
    estimatedEffort: "hours" | "days" | "weeks";
    overview: string;
  };
  build?: {
    taskId?: string;
    buildId?: string;
    repoName?: string;
    status?: string;
    output?: string;
  };
  test?: {
    passed?: boolean;
    testCount?: number;
    passCount?: number;
    failCount?: number;
    testOutput?: string;
  };
  deploy?: {
    url?: string;
    platform?: string;
    deployedAt?: string;
    status?: string;
  };
  stageHistory: StageTransition[];
}

interface RedditOpportunity {
  id: string;
  title: string;
  subreddit: string;
  url: string;
  score: number;
  commentCount: number;
  problem: string;
  targetAudience: string;
  viabilityScore: number;
  keywords: string[];
  scannedAt: string;
}

/* ── Constants ── */

const STAGES: {
  id: PipelineStage;
  label: string;
  emoji: string;
  color: string;
  description: string;
}[] = [
  { id: "idea", label: "Idea", emoji: "💡", color: "#f59e0b", description: "Problem & market signal" },
  { id: "architecture", label: "Architecture", emoji: "📐", color: "#8b5cf6", description: "Tech stack & design" },
  { id: "build", label: "Build", emoji: "🔨", color: "#3b82f6", description: "Autonomous MVP build" },
  { id: "test", label: "Test", emoji: "🧪", color: "#06b6d4", description: "Automated testing" },
  { id: "deploy", label: "Deploy", emoji: "🚀", color: "#10b981", description: "Ship to production" },
];

const STAGE_INDEX: Record<PipelineStage, number> = { idea: 0, architecture: 1, build: 2, test: 3, deploy: 4 };

const STATUS_COLORS: Record<string, string> = {
  active: "#22c55e",
  completed: "#06b6d4",
  failed: "#ef4444",
  paused: "#f59e0b",
};

/* ── Helpers ── */

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/* ── Stage Progress Bar ── */

function StagePipeline({ pipeline }: { pipeline: FactoryPipeline }) {
  const currentIdx = STAGE_INDEX[pipeline.stage];
  const isCompleted = pipeline.status === "completed";
  const isFailed = pipeline.status === "failed";

  return (
    <div className="flex items-center gap-1">
      {STAGES.map((stage, i) => {
        const isPast = i < currentIdx || isCompleted;
        const isCurrent = i === currentIdx && !isCompleted;
        const isFutureOrFailed = isFailed && i === currentIdx;

        let bg = "rgba(255,255,255,0.06)";
        let border = "rgba(255,255,255,0.08)";
        let textColor = "rgba(255,255,255,0.25)";

        if (isPast) {
          bg = `${stage.color}22`;
          border = `${stage.color}44`;
          textColor = stage.color;
        } else if (isCurrent) {
          bg = `${stage.color}30`;
          border = stage.color;
          textColor = "#fff";
        }
        if (isFutureOrFailed) {
          bg = "rgba(239,68,68,0.15)";
          border = "#ef4444";
          textColor = "#ef4444";
        }

        return (
          <div key={stage.id} className="flex items-center gap-1">
            <div
              className="flex items-center gap-1 rounded-md transition-all duration-200"
              style={{
                padding: "3px 8px",
                backgroundColor: bg,
                border: `1px solid ${border}`,
                fontSize: 10,
                fontFamily: "var(--font-mono)",
                color: textColor,
                fontWeight: isCurrent ? 700 : 500,
              }}
            >
              <span style={{ fontSize: 11 }}>{isPast ? "✓" : stage.emoji}</span>
              {stage.label}
            </div>
            {i < STAGES.length - 1 && (
              <ChevronRight size={10} style={{ color: "rgba(255,255,255,0.15)" }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Pipeline Card ── */

function PipelineCard({
  pipeline,
  onAdvance,
  onDelete,
  onTogglePause,
  advancing,
}: {
  pipeline: FactoryPipeline;
  onAdvance: (id: string) => void;
  onDelete: (id: string) => void;
  onTogglePause: (id: string) => void;
  advancing: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const stageColor = STAGES[STAGE_INDEX[pipeline.stage]]?.color || "#6366f1";
  const canAdvance = pipeline.status === "active";

  return (
    <div
      className="rounded-xl transition-all duration-200 hover:-translate-y-0.5"
      style={{
        backgroundColor: "var(--surface-elevated, #1a1a2e)",
        border: `1px solid var(--border, #2a2a2a)`,
        borderLeft: `4px solid ${stageColor}`,
        boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        className="cursor-pointer"
        style={{ padding: "16px 16px 12px" }}
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-lg flex-shrink-0">{STAGES[STAGE_INDEX[pipeline.stage]]?.emoji}</span>
            <div className="min-w-0">
              <span
                className="font-bold block truncate"
                style={{
                  fontSize: 15,
                  color: "var(--text-primary)",
                  fontFamily: "var(--font-heading, var(--font-body))",
                }}
              >
                {pipeline.name}
              </span>
              <span
                style={{
                  fontSize: 11,
                  color: "var(--text-muted)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {pipeline.source} · {timeAgo(pipeline.updatedAt)}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span
              className="rounded-full"
              style={{
                width: 8,
                height: 8,
                backgroundColor: STATUS_COLORS[pipeline.status] || "#64748b",
                boxShadow: pipeline.status === "active" ? `0 0 6px ${STATUS_COLORS.active}88` : "none",
              }}
            />
            <span
              style={{
                fontSize: 10,
                color: STATUS_COLORS[pipeline.status] || "#64748b",
                fontFamily: "var(--font-mono)",
                textTransform: "uppercase",
              }}
            >
              {pipeline.status}
            </span>
          </div>
        </div>

        <p
          style={{
            fontSize: 12,
            color: "var(--text-secondary)",
            margin: "0 0 10px",
            lineHeight: 1.4,
          }}
        >
          {pipeline.description}
        </p>

        <StagePipeline pipeline={pipeline} />
      </div>

      {/* Expanded details */}
      {expanded && (
        <div
          style={{
            padding: "0 16px 16px",
            borderTop: "1px solid var(--border, #2a2a2a)",
            paddingTop: 12,
          }}
        >
          {/* Idea stage data */}
          {pipeline.idea && (
            <div className="mb-3">
              <div
                style={{
                  fontSize: 10,
                  color: "rgba(255,255,255,0.4)",
                  fontFamily: "var(--font-mono)",
                  textTransform: "uppercase",
                  marginBottom: 4,
                }}
              >
                Problem
              </div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                {pipeline.idea.problem}
              </div>
              {pipeline.idea.targetAudience && pipeline.idea.targetAudience !== "TBD" && (
                <div className="mt-1" style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                  Audience: {pipeline.idea.targetAudience}
                </div>
              )}
              {pipeline.idea.viabilityScore != null && (
                <div className="mt-1 flex items-center gap-2">
                  <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                    Viability:
                  </span>
                  <div
                    style={{
                      width: 60,
                      height: 4,
                      borderRadius: 2,
                      backgroundColor: "rgba(255,255,255,0.08)",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${pipeline.idea.viabilityScore}%`,
                        height: "100%",
                        borderRadius: 2,
                        backgroundColor:
                          pipeline.idea.viabilityScore > 60
                            ? "#22c55e"
                            : pipeline.idea.viabilityScore > 30
                            ? "#f59e0b"
                            : "#ef4444",
                      }}
                    />
                  </div>
                  <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                    {pipeline.idea.viabilityScore}%
                  </span>
                </div>
              )}
              {pipeline.idea.keywords && pipeline.idea.keywords.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {pipeline.idea.keywords.map((kw) => (
                    <span
                      key={kw}
                      className="rounded-full"
                      style={{
                        fontSize: 9,
                        padding: "1px 6px",
                        backgroundColor: "rgba(139,92,246,0.12)",
                        border: "1px solid rgba(139,92,246,0.2)",
                        color: "rgba(167,139,250,0.9)",
                        fontFamily: "var(--font-mono)",
                      }}
                    >
                      {kw}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Architecture stage data */}
          {pipeline.architecture && (
            <div className="mb-3">
              <div
                style={{
                  fontSize: 10,
                  color: "rgba(255,255,255,0.4)",
                  fontFamily: "var(--font-mono)",
                  textTransform: "uppercase",
                  marginBottom: 4,
                }}
              >
                Architecture
              </div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                {pipeline.architecture.overview}
              </div>
              <div className="flex flex-wrap gap-1 mt-2">
                {pipeline.architecture.techStack.map((tech) => (
                  <span
                    key={tech}
                    className="rounded-full"
                    style={{
                      fontSize: 9,
                      padding: "2px 8px",
                      backgroundColor: "rgba(59,130,246,0.12)",
                      border: "1px solid rgba(59,130,246,0.25)",
                      color: "#93c5fd",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    {tech}
                  </span>
                ))}
              </div>
              <div className="mt-1" style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                Effort: {pipeline.architecture.estimatedEffort}
              </div>
            </div>
          )}

          {/* Build stage data */}
          {pipeline.build && (
            <div className="mb-3">
              <div
                style={{
                  fontSize: 10,
                  color: "rgba(255,255,255,0.4)",
                  fontFamily: "var(--font-mono)",
                  textTransform: "uppercase",
                  marginBottom: 4,
                }}
              >
                Build
              </div>
              {pipeline.build.status && (
                <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                  Status: {pipeline.build.status}
                  {pipeline.build.repoName && ` · ${pipeline.build.repoName}`}
                </div>
              )}
              {pipeline.build.output && (
                <pre
                  style={{
                    fontSize: 10,
                    color: "var(--text-muted)",
                    fontFamily: "var(--font-mono)",
                    backgroundColor: "rgba(0,0,0,0.3)",
                    borderRadius: 6,
                    padding: 8,
                    marginTop: 4,
                    maxHeight: 120,
                    overflow: "auto",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {pipeline.build.output}
                </pre>
              )}
            </div>
          )}

          {/* Test stage data */}
          {pipeline.test && (
            <div className="mb-3">
              <div
                style={{
                  fontSize: 10,
                  color: "rgba(255,255,255,0.4)",
                  fontFamily: "var(--font-mono)",
                  textTransform: "uppercase",
                  marginBottom: 4,
                }}
              >
                Tests
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                {pipeline.test.passed ? "✅ Passed" : "❌ Failed"}
                {pipeline.test.testCount != null && ` · ${pipeline.test.passCount}/${pipeline.test.testCount} passed`}
              </div>
            </div>
          )}

          {/* Deploy stage data */}
          {pipeline.deploy && (
            <div className="mb-3">
              <div
                style={{
                  fontSize: 10,
                  color: "rgba(255,255,255,0.4)",
                  fontFamily: "var(--font-mono)",
                  textTransform: "uppercase",
                  marginBottom: 4,
                }}
              >
                Deployment
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                {pipeline.deploy.platform && <span>{pipeline.deploy.platform} · </span>}
                {pipeline.deploy.status || "pending"}
                {pipeline.deploy.url && (
                  <a
                    href={pipeline.deploy.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-2"
                    style={{ color: "#60a5fa", textDecoration: "underline" }}
                  >
                    {pipeline.deploy.url}
                  </a>
                )}
              </div>
            </div>
          )}

          {/* Stage history */}
          {pipeline.stageHistory.length > 1 && (
            <div className="mb-3">
              <div
                style={{
                  fontSize: 10,
                  color: "rgba(255,255,255,0.4)",
                  fontFamily: "var(--font-mono)",
                  textTransform: "uppercase",
                  marginBottom: 4,
                }}
              >
                Timeline
              </div>
              <div className="flex flex-col gap-1">
                {pipeline.stageHistory.map((t, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2"
                    style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}
                  >
                    <span style={{ color: "rgba(255,255,255,0.3)" }}>
                      {new Date(t.timestamp).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <span>{t.from}</span>
                    <ArrowRight size={8} />
                    <span style={{ color: STAGES[STAGE_INDEX[t.to]]?.color }}>{t.to}</span>
                    {t.agent && <span style={{ color: "rgba(255,255,255,0.3)" }}>({t.agent})</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Assigned agent */}
          <div className="flex items-center gap-2 mb-3">
            <AgentAvatar agentId={pipeline.assignedAgent || "scout"} size={22} borderWidth={1.5} />
            <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
              {pipeline.assignedAgent || "scout"} assigned
            </span>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            {canAdvance && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onAdvance(pipeline.id);
                }}
                disabled={advancing}
                className="flex items-center gap-1.5 rounded-lg transition-colors"
                style={{
                  padding: "6px 12px",
                  fontSize: 11,
                  fontWeight: 600,
                  fontFamily: "var(--font-mono)",
                  backgroundColor: `${stageColor}22`,
                  border: `1px solid ${stageColor}55`,
                  color: stageColor,
                  cursor: advancing ? "wait" : "pointer",
                  opacity: advancing ? 0.6 : 1,
                }}
              >
                {advancing ? "Advancing..." : (
                  <>
                    {STAGE_INDEX[pipeline.stage] < 4 ? "Advance" : "Complete"}
                    <ChevronRight size={12} />
                  </>
                )}
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onTogglePause(pipeline.id);
              }}
              className="flex items-center gap-1 rounded-lg transition-colors"
              style={{
                padding: "6px 10px",
                fontSize: 11,
                fontFamily: "var(--font-mono)",
                backgroundColor: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.1)",
                color: "var(--text-muted)",
                cursor: "pointer",
              }}
            >
              {pipeline.status === "paused" ? <Play size={11} /> : <Pause size={11} />}
              {pipeline.status === "paused" ? "Resume" : "Pause"}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(pipeline.id);
              }}
              className="flex items-center gap-1 rounded-lg transition-colors"
              style={{
                padding: "6px 10px",
                fontSize: 11,
                fontFamily: "var(--font-mono)",
                backgroundColor: "rgba(239,68,68,0.06)",
                border: "1px solid rgba(239,68,68,0.15)",
                color: "#ef4444",
                cursor: "pointer",
              }}
            >
              <Trash2 size={11} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Reddit Scanner Modal ── */

function ScanModal({
  open,
  onClose,
  onImport,
}: {
  open: boolean;
  onClose: () => void;
  onImport: (opp: RedditOpportunity) => void;
}) {
  const [scanning, setScanning] = useState(false);
  const [opportunities, setOpportunities] = useState<RedditOpportunity[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const scan = useCallback(async () => {
    setScanning(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {};
      if (query.trim()) body.query = query.trim();
      const res = await fetch("/api/factory/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      setOpportunities(data.opportunities || []);
    } catch {
      setError("Failed to connect to scanner");
    } finally {
      setScanning(false);
    }
  }, [query]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        className="rounded-2xl w-full max-w-2xl max-h-[80vh] flex flex-col"
        style={{
          backgroundColor: "var(--surface-elevated, #1a1a2e)",
          border: "1px solid var(--border, #2a2a2a)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: "20px 20px 12px" }}>
          <h2
            className="flex items-center gap-2 m-0"
            style={{
              fontSize: 18,
              fontWeight: 800,
              color: "#fff",
              fontFamily: "var(--font-heading, var(--font-body))",
            }}
          >
            <Radar size={20} style={{ color: "#f59e0b" }} />
            Reddit Opportunity Scanner
          </h2>
          <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "4px 0 0", fontFamily: "var(--font-mono)" }}>
            Scan subreddits for pain points and unmet needs that could become micro-SaaS products.
          </p>
        </div>

        {/* Search */}
        <div className="flex gap-2" style={{ padding: "0 20px 12px" }}>
          <div className="flex-1 relative">
            <Search
              size={14}
              style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }}
            />
            <input
              type="text"
              placeholder="Custom query (or leave empty for default)..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && scan()}
              style={{
                width: "100%",
                padding: "8px 12px 8px 30px",
                fontSize: 12,
                fontFamily: "var(--font-mono)",
                backgroundColor: "rgba(0,0,0,0.3)",
                border: "1px solid var(--border, #2a2a2a)",
                borderRadius: 8,
                color: "var(--text-primary)",
                outline: "none",
              }}
            />
          </div>
          <button
            onClick={scan}
            disabled={scanning}
            className="flex items-center gap-1.5 rounded-lg"
            style={{
              padding: "8px 16px",
              fontSize: 12,
              fontWeight: 700,
              fontFamily: "var(--font-mono)",
              backgroundColor: scanning ? "rgba(245,158,11,0.1)" : "rgba(245,158,11,0.2)",
              border: "1px solid rgba(245,158,11,0.4)",
              color: "#f59e0b",
              cursor: scanning ? "wait" : "pointer",
            }}
          >
            <Radar size={14} className={scanning ? "animate-spin" : ""} />
            {scanning ? "Scanning..." : "Scan"}
          </button>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto" style={{ padding: "0 20px 20px" }}>
          {error && (
            <div
              className="rounded-lg mb-3"
              style={{
                padding: "8px 12px",
                fontSize: 11,
                fontFamily: "var(--font-mono)",
                backgroundColor: "rgba(239,68,68,0.08)",
                border: "1px solid rgba(239,68,68,0.25)",
                color: "#ef4444",
              }}
            >
              {error}
            </div>
          )}
          {opportunities.length === 0 && !scanning && !error && (
            <div
              className="text-center py-12"
              style={{ fontSize: 12, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}
            >
              Hit Scan to find opportunities across Reddit.
            </div>
          )}
          <div className="flex flex-col gap-2">
            {opportunities.map((opp) => (
              <div
                key={opp.id}
                className="rounded-lg"
                style={{
                  padding: "12px 14px",
                  backgroundColor: "rgba(0,0,0,0.2)",
                  border: "1px solid var(--border, #2a2a2a)",
                }}
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="min-w-0">
                    <div
                      className="font-bold truncate"
                      style={{
                        fontSize: 13,
                        color: "var(--text-primary)",
                        fontFamily: "var(--font-heading, var(--font-body))",
                      }}
                    >
                      {opp.title}
                    </div>
                    <div
                      style={{
                        fontSize: 10,
                        color: "var(--text-muted)",
                        fontFamily: "var(--font-mono)",
                        marginTop: 2,
                      }}
                    >
                      r/{opp.subreddit} · {opp.score} pts · {opp.commentCount} comments
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <div className="flex items-center gap-1">
                      <div
                        style={{
                          width: 40,
                          height: 4,
                          borderRadius: 2,
                          backgroundColor: "rgba(255,255,255,0.08)",
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            width: `${opp.viabilityScore}%`,
                            height: "100%",
                            borderRadius: 2,
                            backgroundColor:
                              opp.viabilityScore > 60
                                ? "#22c55e"
                                : opp.viabilityScore > 30
                                ? "#f59e0b"
                                : "#ef4444",
                          }}
                        />
                      </div>
                      <span style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                        {opp.viabilityScore}
                      </span>
                    </div>
                    <button
                      onClick={() => onImport(opp)}
                      className="flex items-center gap-1 rounded-md"
                      style={{
                        padding: "4px 10px",
                        fontSize: 10,
                        fontWeight: 700,
                        fontFamily: "var(--font-mono)",
                        backgroundColor: "rgba(34,197,94,0.15)",
                        border: "1px solid rgba(34,197,94,0.3)",
                        color: "#22c55e",
                        cursor: "pointer",
                      }}
                    >
                      <Rocket size={10} />
                      Import
                    </button>
                  </div>
                </div>
                <p
                  style={{
                    fontSize: 11,
                    color: "var(--text-secondary)",
                    margin: "4px 0 0",
                    lineHeight: 1.4,
                  }}
                >
                  {opp.problem}
                </p>
                {opp.keywords.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {opp.keywords.map((kw) => (
                      <span
                        key={kw}
                        className="rounded-full"
                        style={{
                          fontSize: 8,
                          padding: "1px 5px",
                          backgroundColor: "rgba(139,92,246,0.1)",
                          border: "1px solid rgba(139,92,246,0.2)",
                          color: "rgba(167,139,250,0.8)",
                          fontFamily: "var(--font-mono)",
                        }}
                      >
                        {kw}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Create Pipeline Modal ── */

function CreateModal({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (data: { name: string; description: string; problem: string; audience: string }) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [problem, setProblem] = useState("");
  const [audience, setAudience] = useState("");

  if (!open) return null;

  const inputStyle = {
    width: "100%",
    padding: "8px 12px",
    fontSize: 12,
    fontFamily: "var(--font-mono)" as const,
    backgroundColor: "rgba(0,0,0,0.3)",
    border: "1px solid var(--border, #2a2a2a)",
    borderRadius: 8,
    color: "var(--text-primary)",
    outline: "none",
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        className="rounded-2xl w-full max-w-md"
        style={{
          backgroundColor: "var(--surface-elevated, #1a1a2e)",
          border: "1px solid var(--border, #2a2a2a)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          padding: 24,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          className="flex items-center gap-2 m-0 mb-4"
          style={{
            fontSize: 18,
            fontWeight: 800,
            color: "#fff",
            fontFamily: "var(--font-heading, var(--font-body))",
          }}
        >
          <Plus size={20} style={{ color: "#22c55e" }} />
          New Pipeline
        </h2>

        <div className="flex flex-col gap-3">
          <div>
            <label style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)", textTransform: "uppercase", marginBottom: 4, display: "block" }}>
              App Name
            </label>
            <input type="text" placeholder="e.g. SnapAudit" value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)", textTransform: "uppercase", marginBottom: 4, display: "block" }}>
              Description
            </label>
            <input type="text" placeholder="One-line pitch for the product" value={description} onChange={(e) => setDescription(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)", textTransform: "uppercase", marginBottom: 4, display: "block" }}>
              Problem
            </label>
            <textarea placeholder="What pain point does this solve?" value={problem} onChange={(e) => setProblem(e.target.value)} rows={3} style={{ ...inputStyle, resize: "vertical" }} />
          </div>
          <div>
            <label style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)", textTransform: "uppercase", marginBottom: 4, display: "block" }}>
              Target Audience
            </label>
            <input type="text" placeholder="e.g. Freelancers, Small agencies" value={audience} onChange={(e) => setAudience(e.target.value)} style={inputStyle} />
          </div>
        </div>

        <div className="flex items-center gap-2 mt-5">
          <button
            onClick={() => {
              if (!name.trim() || !description.trim()) return;
              onCreate({ name: name.trim(), description: description.trim(), problem: problem.trim() || description.trim(), audience: audience.trim() || "TBD" });
              setName("");
              setDescription("");
              setProblem("");
              setAudience("");
            }}
            disabled={!name.trim() || !description.trim()}
            className="flex items-center gap-1.5 rounded-lg flex-1 justify-center"
            style={{
              padding: "10px 16px",
              fontSize: 12,
              fontWeight: 700,
              fontFamily: "var(--font-mono)",
              backgroundColor: "rgba(34,197,94,0.2)",
              border: "1px solid rgba(34,197,94,0.4)",
              color: "#22c55e",
              cursor: name.trim() && description.trim() ? "pointer" : "not-allowed",
              opacity: name.trim() && description.trim() ? 1 : 0.5,
            }}
          >
            <Rocket size={14} />
            Launch Pipeline
          </button>
          <button
            onClick={onClose}
            className="rounded-lg"
            style={{
              padding: "10px 16px",
              fontSize: 12,
              fontFamily: "var(--font-mono)",
              backgroundColor: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.1)",
              color: "var(--text-muted)",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Main Page ── */

export default function PipelinePage() {
  const [pipelines, setPipelines] = useState<FactoryPipeline[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showScan, setShowScan] = useState(false);
  const [advancing, setAdvancing] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | PipelineStage | "completed">("all");

  const loadPipelines = useCallback(async () => {
    try {
      const res = await fetch("/api/factory/pipelines");
      const data = await res.json();
      setPipelines(data.pipelines || []);
    } catch {
      console.error("Failed to load pipelines");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPipelines();
    const interval = window.setInterval(loadPipelines, 15000);
    return () => window.clearInterval(interval);
  }, [loadPipelines]);

  const createPipeline = useCallback(
    async (data: { name: string; description: string; problem: string; audience: string }) => {
      try {
        await fetch("/api/factory/pipelines", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: data.name,
            description: data.description,
            idea: {
              problem: data.problem,
              targetAudience: data.audience,
            },
          }),
        });
        setShowCreate(false);
        loadPipelines();
      } catch {
        console.error("Failed to create pipeline");
      }
    },
    [loadPipelines]
  );

  const importFromReddit = useCallback(
    async (opp: RedditOpportunity) => {
      try {
        await fetch("/api/factory/pipelines", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: opp.title.slice(0, 60),
            description: opp.problem,
            source: "reddit",
            idea: {
              problem: opp.problem,
              targetAudience: opp.targetAudience,
              sourceUrl: opp.url,
              subreddit: opp.subreddit,
              viabilityScore: opp.viabilityScore,
              keywords: opp.keywords,
            },
          }),
        });
        setShowScan(false);
        loadPipelines();
      } catch {
        console.error("Failed to import opportunity");
      }
    },
    [loadPipelines]
  );

  const advancePipeline = useCallback(
    async (id: string) => {
      setAdvancing(id);
      try {
        await fetch(`/api/factory/pipelines/${id}/advance`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        loadPipelines();
      } catch {
        console.error("Failed to advance pipeline");
      } finally {
        setAdvancing(null);
      }
    },
    [loadPipelines]
  );

  const deletePipeline = useCallback(
    async (id: string) => {
      try {
        await fetch(`/api/factory/pipelines/${id}`, { method: "DELETE" });
        loadPipelines();
      } catch {
        console.error("Failed to delete pipeline");
      }
    },
    [loadPipelines]
  );

  const togglePause = useCallback(
    async (id: string) => {
      const pipeline = pipelines.find((p) => p.id === id);
      if (!pipeline) return;
      const newStatus = pipeline.status === "paused" ? "active" : "paused";
      try {
        await fetch(`/api/factory/pipelines/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: newStatus }),
        });
        loadPipelines();
      } catch {
        console.error("Failed to toggle pause");
      }
    },
    [pipelines, loadPipelines]
  );

  const filtered = useMemo(() => {
    if (filter === "all") return pipelines;
    if (filter === "completed") return pipelines.filter((p) => p.status === "completed");
    return pipelines.filter((p) => p.stage === filter && p.status === "active");
  }, [pipelines, filter]);

  // Stage counts for filter badges
  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = { all: pipelines.length, completed: 0 };
    for (const s of STAGES) counts[s.id] = 0;
    for (const p of pipelines) {
      if (p.status === "completed") counts.completed++;
      else counts[p.stage] = (counts[p.stage] || 0) + 1;
    }
    return counts;
  }, [pipelines]);

  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--background)" }}>
      {/* Header */}
      <div
        className="px-6 pt-6 pb-5"
        style={{
          background: "linear-gradient(135deg, #1a0f2e 0%, #2d1b4e 30%, #1e1b4b 60%, #0f172a 100%)",
          borderBottom: "1px solid rgba(139,92,246,0.2)",
        }}
      >
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h1
              className="m-0 flex items-center gap-2"
              style={{
                fontSize: 26,
                fontWeight: 800,
                color: "#fff",
                fontFamily: "var(--font-heading, var(--font-body))",
                letterSpacing: "-0.02em",
              }}
            >
              <Rocket size={26} style={{ color: "#8b5cf6" }} />
              Software Factory Pipeline
            </h1>
            <p
              className="m-0 mt-1"
              style={{ fontSize: 13, color: "rgba(199,210,254,0.7)", fontFamily: "var(--font-mono)" }}
            >
              One-click idea to deployed app — Idea → Architecture → Build → Test → Deploy
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowScan(true)}
              className="flex items-center gap-1.5 rounded-lg"
              style={{
                padding: "8px 14px",
                fontSize: 12,
                fontWeight: 600,
                fontFamily: "var(--font-mono)",
                backgroundColor: "rgba(245,158,11,0.15)",
                border: "1px solid rgba(245,158,11,0.35)",
                color: "#f59e0b",
                cursor: "pointer",
              }}
            >
              <Radar size={14} />
              Scan Reddit
            </button>
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-1.5 rounded-lg"
              style={{
                padding: "8px 14px",
                fontSize: 12,
                fontWeight: 700,
                fontFamily: "var(--font-mono)",
                backgroundColor: "rgba(34,197,94,0.2)",
                border: "1px solid rgba(34,197,94,0.4)",
                color: "#22c55e",
                cursor: "pointer",
              }}
            >
              <Plus size={14} />
              New Pipeline
            </button>
          </div>
        </div>

        {/* Stats row */}
        <div className="flex gap-3 flex-wrap">
          {STAGES.map((stage) => {
            const count = pipelines.filter((p) => p.stage === stage.id && p.status === "active").length;
            return (
              <div
                key={stage.id}
                className="flex items-center gap-2 rounded-xl flex-1 min-w-[130px]"
                style={{
                  padding: "10px 14px",
                  backgroundColor: "rgba(0,0,0,0.25)",
                  border: `1px solid ${stage.color}33`,
                  backdropFilter: "blur(8px)",
                }}
              >
                <span style={{ fontSize: 18 }}>{stage.emoji}</span>
                <div>
                  <div
                    className="font-extrabold"
                    style={{ fontSize: 20, color: stage.color, fontFamily: "var(--font-mono)", lineHeight: 1 }}
                  >
                    {count}
                  </div>
                  <div
                    style={{
                      fontSize: 9,
                      color: "rgba(199,210,254,0.5)",
                      fontFamily: "var(--font-mono)",
                      marginTop: 1,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    {stage.label}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Filter bar */}
      <div className="px-6 py-3 flex items-center gap-1.5 flex-wrap" style={{ borderBottom: "1px solid var(--border, #2a2a2a)" }}>
        {[
          { id: "all" as const, label: "All", color: "#6366f1" },
          ...STAGES.map((s) => ({ id: s.id as PipelineStage, label: s.label, color: s.color })),
          { id: "completed" as const, label: "Completed", color: "#06b6d4" },
        ].map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className="rounded-full"
            style={{
              padding: "4px 12px",
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              fontWeight: filter === f.id ? 700 : 500,
              backgroundColor: filter === f.id ? `${f.color}22` : "transparent",
              border: `1px solid ${filter === f.id ? `${f.color}55` : "transparent"}`,
              color: filter === f.id ? f.color : "var(--text-muted)",
              cursor: "pointer",
            }}
          >
            {f.label}
            {(stageCounts[f.id] || 0) > 0 && (
              <span
                className="ml-1"
                style={{
                  fontSize: 9,
                  padding: "0 4px",
                  borderRadius: 4,
                  backgroundColor: `${f.color}18`,
                  color: f.color,
                }}
              >
                {stageCounts[f.id]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Pipeline list */}
      <div className="px-6 py-5">
        {loading ? (
          <div className="text-center py-16" style={{ fontSize: 13, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
            Loading pipelines...
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <div style={{ fontSize: 40, marginBottom: 12 }}>🏭</div>
            <div style={{ fontSize: 14, color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginBottom: 4 }}>
              No pipelines yet
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", fontFamily: "var(--font-mono)", opacity: 0.6 }}>
              Create one manually or scan Reddit for opportunities
            </div>
          </div>
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(400px, 1fr))" }}>
            {filtered.map((pipeline) => (
              <PipelineCard
                key={pipeline.id}
                pipeline={pipeline}
                onAdvance={advancePipeline}
                onDelete={deletePipeline}
                onTogglePause={togglePause}
                advancing={advancing === pipeline.id}
              />
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      <CreateModal open={showCreate} onClose={() => setShowCreate(false)} onCreate={createPipeline} />
      <ScanModal open={showScan} onClose={() => setShowScan(false)} onImport={importFromReddit} />
    </div>
  );
}
