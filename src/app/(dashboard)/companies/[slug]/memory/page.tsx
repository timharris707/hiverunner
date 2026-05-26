"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  BookOpen,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  ExternalLink,
  FileText,
  GitBranch,
  Layers,
  Link2,
  MapPinned,
  Network,
  Search,
  ShieldCheck,
  Sparkles,
  User,
  X,
} from "lucide-react";

import { listCompanies } from "@/lib/orchestration/client";
import type { OrchestrationCompany } from "@/lib/orchestration/types";
import { buildCanonicalCompanyPath } from "@/lib/orchestration/route-paths";
import { PageHeader, Section, EmptyState } from "@/lib/ui/primitives";
import { color, type as T, space, radius, pageStyle } from "@/lib/ui/tokens";
import type { MemoryCandidate } from "@/lib/orchestration/memory-candidates";
import type { MemoryIndexRecord } from "@/lib/orchestration/memory-vault";
import type {
  MemoryQualityDashboard,
  MemoryQualityQueueItem,
  MemoryQualityQueueType,
} from "@/lib/orchestration/memory-quality";
import type {
  WikiWritebackApprovalState,
  WikiWritebackRequest,
} from "@/lib/orchestration/wiki-writeback-requests";
import { isLegacyHumanActor, publicHumanDisplayName, PUBLIC_HUMAN_LABEL } from "@/lib/public-identity";

type MemoryTab = "cards" | "graph" | "candidates" | "quality" | "wiki" | "evidence";

type MemoryGraph = {
  nodes: Array<{ id: string; label: string; layer: string; sourcePath?: string; taskKey?: string; degree?: number }>;
  edges: Array<{ source: string; target: string; label: string }>;
  readiness?: {
    status: "ready" | "needs_attention" | "blocked";
    score: number;
    summary: string;
  };
  qualitySignals?: {
    orphanNotes: GraphSignal[];
    duplicateClusters: GraphSignal[];
    missingBacklinks: GraphSignal[];
    staleEvidenceLinks: GraphSignal[];
  };
  mapCoverage?: {
    totalRecords: number;
    coveredRecords: number;
    uncoveredRecords: number;
    coveragePercent: number;
    uncoveredSample: Array<{ recordId: string; title: string; layer: string; sourcePath: string }>;
  };
};

type GraphSignal = {
  id: string;
  type: "orphan_note" | "duplicate_cluster" | "missing_backlink" | "stale_evidence_link";
  severity: "high" | "medium" | "low";
  title: string;
  recordIds: string[];
  detail: string;
  source?: string;
  target?: string;
  missingLink?: string;
};

type RetrievalQualityIssue = {
  recordId: string;
  title: string;
  type: string;
  severity: "high" | "medium" | "low";
  action: "warning" | "refusal";
  reason: string;
};

type RetrievalQuality = {
  status: "accepted" | "degraded" | "refused";
  score: number;
  warnings: RetrievalQualityIssue[];
  refusals: RetrievalQualityIssue[];
};

type MemoryEvidenceItem = {
  recordId: string;
  title: string;
  sourcePath: string | null;
  layer: string;
  reason: string;
  source: {
    type: "memory_source_index" | "company_memory_record";
    sourceId?: string;
    kind?: string;
    scope?: string;
    status?: string;
    confidence?: number;
    fileType?: string;
    fileMtime?: string | null;
    indexedAt?: string;
    updatedAt?: string;
    frontmatter?: Record<string, unknown>;
    tags?: string[];
    metadata?: Record<string, unknown>;
  };
};

type MemoryEvidenceDiagnostics = {
  version: 1;
  source: "memory_source_index" | "company_memory_records" | "none";
  quality: RetrievalQuality;
  evidence: Array<{
    recordId: string;
    title: string;
    sourcePath: string | null;
    layer: string;
    inclusionReasons: string[];
    evidenceEnvelope: {
      version: number;
      envelopeId: string;
      retrievalRank: number;
      sourceType: string;
      contentSha256: string;
      matched: {
        agentId: string;
        agentRole: string | null;
        projectId: string | null;
        roleTags: string[];
      };
    };
  }>;
};

type MemoryEvidenceResult = {
  company: { id: string; slug: string; name: string };
  run: {
    id: string;
    status: string;
    taskKey: string;
    taskTitle: string;
    projectName: string;
    agentName: string;
    agentRole: string | null;
    injectedMemorySha256: string | null;
  };
  injectionSource: "vault_index" | "memory_registry_fallback" | "none";
  evidence: MemoryEvidenceItem[];
  quality?: RetrievalQuality;
  diagnostics?: MemoryEvidenceDiagnostics;
};

type CandidateWritebackResult = {
  status: "written" | "failed";
  fileWritten?: boolean;
  filePath: string | null;
  fileSha256Before?: string | null;
  fileSha256After?: string | null;
  memoryRecordId?: string | null;
  action?: string;
  error?: string | null;
};

type CandidateReviewResponse = {
  candidate?: MemoryCandidate | null;
  outcome?: string;
  writeback?: CandidateWritebackResult | null;
  error?: string;
};

/* ── Helpers ── */

function routingLabel(routingTarget: string | null, category: string | null, operatorLabel = PUBLIC_HUMAN_LABEL): string {
  if (!routingTarget || isLegacyHumanActor(routingTarget)) return `${operatorLabel} — general`;
  const target = routingTarget.trim();
  const cat = category?.trim() ?? "general";
  return `${target} — ${cat}`;
}

function categoryTone(category: string | null): string {
  switch (category?.toLowerCase()) {
    case "legal": return color.info;
    case "financial": return color.warning;
    case "implementation": return color.accent;
    case "workflow": return color.textSecondary;
    default: return color.textMuted;
  }
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatLabel(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function writebackActionLabel(action: string | null | undefined): string {
  switch (action) {
    case "append": return "Appended Markdown note";
    case "create": return "Created Markdown note";
    case "append_failed": return "Markdown append failed";
    default: return "Memory write-back";
  }
}

function containsText(value: string | null | undefined, query: string): boolean {
  return (value ?? "").toLowerCase().includes(query);
}

function chipStyle(active = false): CSSProperties {
  return {
    padding: `4px ${space.sm}px`,
    borderRadius: radius.sm,
    border: `0.5px solid ${active ? color.accent : color.border}`,
    color: active ? color.accent : color.textMuted,
    background: active ? `${color.accent}18` : "transparent",
    fontSize: T.caption.size,
    cursor: "pointer",
  };
}

function TabButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: `7px ${space.md}px`,
        borderRadius: radius.sm,
        border: `0.5px solid ${active ? color.accent : color.border}`,
        background: active ? `${color.accent}18` : color.surface,
        color: active ? color.accent : color.textSecondary,
        fontSize: T.bodySmall.size,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function MemoryRecordCard({
  record,
  selected,
  onSelect,
}: {
  record: MemoryIndexRecord;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        textAlign: "left",
        padding: `${space.lg}px ${space.xl}px`,
        borderRadius: radius.lg,
        border: `0.5px solid ${selected ? color.accent : color.border}`,
        background: selected ? `${color.accent}10` : color.surface,
        display: "flex",
        flexDirection: "column",
        gap: space.sm,
        cursor: "pointer",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: space.sm, flexWrap: "wrap" }}>
        <span
          style={{
            fontSize: T.caption.size,
            fontWeight: 600,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            padding: `2px ${space.sm}px`,
            borderRadius: radius.sm,
            background: `${color.accent}18`,
            color: color.accent,
            border: `0.5px solid ${color.accent}33`,
          }}
        >
          {record.layer}
        </span>
        <span style={{ fontSize: T.caption.size, color: color.textMuted }}>
          {record.sourceId}
        </span>
        {record.pinned && (
          <span style={{ fontSize: T.caption.size, color: color.warning }}>Pinned</span>
        )}
        {record.writeback && (
          <span
            style={{
              fontSize: T.caption.size,
              color: record.writeback.error ? color.negative : color.positive,
            }}
          >
            {record.writeback.error ? "Write-back error" : "Written from candidate"}
          </span>
        )}
      </div>
      <div style={{ fontSize: T.body.size, color: color.text, fontWeight: 600, lineHeight: 1.35 }}>
        {record.title}
      </div>
      <p
        style={{
          margin: 0,
          fontSize: T.bodySmall.size,
          color: color.textSecondary,
          lineHeight: 1.55,
          display: "-webkit-box",
          WebkitLineClamp: 3,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {record.contentExcerpt || "No excerpt indexed."}
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: space.sm, flexWrap: "wrap" }}>
        {record.tags.slice(0, 4).map((tag) => (
          <span key={tag} style={{ fontSize: T.caption.size, color: color.textMuted }}>
            #{tag}
          </span>
        ))}
        {record.tags.length > 4 && (
          <span style={{ fontSize: T.caption.size, color: color.textMuted }}>
            +{record.tags.length - 4}
          </span>
        )}
      </div>
    </button>
  );
}

function MemoryDetailPanel({ record }: { record: MemoryIndexRecord | null }) {
  if (!record) {
    return (
      <div
        style={{
          padding: `${space.xl}px`,
          borderRadius: radius.lg,
          border: `0.5px solid ${color.border}`,
          background: color.surface,
          color: color.textMuted,
          fontSize: T.bodySmall.size,
        }}
      >
        Select a memory card to inspect source, tags, excerpt, and links.
      </div>
    );
  }

  return (
    <aside
      style={{
        padding: `${space.xl}px`,
        borderRadius: radius.lg,
        border: `0.5px solid ${color.border}`,
        background: color.surface,
        display: "flex",
        flexDirection: "column",
        gap: space.lg,
        minWidth: 0,
      }}
    >
      <div>
        <div style={{ fontSize: T.caption.size, color: color.textMuted, marginBottom: space.xs }}>
          Selected record
        </div>
        <h2 style={{ margin: 0, fontSize: T.cardTitle.size, fontWeight: T.cardTitle.weight, color: color.text, lineHeight: 1.25 }}>
          {record.title}
        </h2>
      </div>

      <div style={{ display: "grid", gap: space.sm, fontSize: T.bodySmall.size }}>
        <div style={{ display: "flex", gap: space.sm, minWidth: 0 }}>
          <FileText size={14} style={{ color: color.textMuted, flexShrink: 0, marginTop: 2 }} />
          <span style={{ color: color.textSecondary, wordBreak: "break-all" }}>{record.sourcePath}</span>
        </div>
        <div style={{ display: "flex", gap: space.sm, color: color.textMuted, flexWrap: "wrap" }}>
          <span>{formatLabel(record.layer)}</span>
          <span>·</span>
          <span>{record.sourceId}</span>
          <span>·</span>
          <span>{record.status}</span>
        </div>
      </div>

      {record.writeback && (
        <div
          style={{
            border: `0.5px solid ${record.writeback.error ? color.negative : color.positive}33`,
            borderRadius: radius.md,
            background: `${record.writeback.error ? color.negative : color.positive}12`,
            padding: `${space.sm}px ${space.md}px`,
            display: "grid",
            gap: 4,
            fontSize: T.caption.size,
          }}
        >
          <span style={{ color: record.writeback.error ? color.negative : color.positive, fontWeight: 600 }}>
            {writebackActionLabel(record.writeback.action)}
          </span>
          <span style={{ color: color.textSecondary }}>
            {record.writeback.attribution ? `By ${record.writeback.attribution} · ` : ""}
            {formatRelative(record.writeback.writtenAt)}
            {record.writeback.candidateId ? ` · candidate ${record.writeback.candidateId.slice(0, 8)}` : ""}
          </span>
          {record.writeback.error && (
            <span style={{ color: color.negative }}>{record.writeback.error}</span>
          )}
        </div>
      )}

      {record.tags.length > 0 && (
        <div>
          <div style={{ fontSize: T.caption.size, color: color.textMuted, marginBottom: space.xs }}>
            Tags
          </div>
          <div style={{ display: "flex", gap: space.xs, flexWrap: "wrap" }}>
            {record.tags.map((tag) => (
              <span
                key={tag}
                style={{
                  fontSize: T.caption.size,
                  color: color.textSecondary,
                  border: `0.5px solid ${color.border}`,
                  borderRadius: radius.sm,
                  padding: `2px ${space.sm}px`,
                }}
              >
                #{tag}
              </span>
            ))}
          </div>
        </div>
      )}

      <div>
        <div style={{ fontSize: T.caption.size, color: color.textMuted, marginBottom: space.xs }}>
          Excerpt
        </div>
        <p
          style={{
            margin: 0,
            fontSize: T.bodySmall.size,
            color: color.text,
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
          }}
        >
          {record.contentExcerpt || "No excerpt indexed."}
        </p>
      </div>

      <div>
        <div style={{ fontSize: T.caption.size, color: color.textMuted, marginBottom: space.xs }}>
          Links
        </div>
        <div style={{ display: "grid", gap: space.xs, fontSize: T.bodySmall.size }}>
          {record.projectLink && <span style={{ color: color.textSecondary }}>Project: {record.projectLink}</span>}
          {record.agentAttribution && <span style={{ color: color.textSecondary }}>Agent: {record.agentAttribution}</span>}
          {record.linkedIds.map((linked) => (
            <span key={linked} style={{ color: color.textSecondary }}>{linked}</span>
          ))}
          {!record.projectLink && !record.agentAttribution && record.linkedIds.length === 0 && (
            <span style={{ color: color.textMuted }}>No links indexed.</span>
          )}
        </div>
      </div>
    </aside>
  );
}

type GraphSignalFilter = "all" | GraphSignal["type"] | "map_gap";

function graphSignalLabel(type: GraphSignalFilter): string {
  switch (type) {
    case "all": return "All signals";
    case "orphan_note": return "Orphans";
    case "duplicate_cluster": return "Duplicates";
    case "missing_backlink": return "Missing backlinks";
    case "stale_evidence_link": return "Stale evidence";
    case "map_gap": return "Map gaps";
  }
}

function signalColor(severity: GraphSignal["severity"]): string {
  if (severity === "high") return color.negative;
  if (severity === "medium") return color.warning;
  return color.info;
}

function GraphList({ graph }: { graph: MemoryGraph | null }) {
  const [signalFilter, setSignalFilter] = useState<GraphSignalFilter>("all");
  const [nodeQuery, setNodeQuery] = useState("");

  if (!graph) {
    return <EmptyState icon={<GitBranch size={24} />} title="Graph unavailable" description="The memory graph endpoint did not return data." />;
  }

  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const readiness = graph.readiness ?? {
    status: graph.edges.length > 0 ? "needs_attention" : "blocked",
    score: graph.edges.length > 0 ? 70 : 0,
    summary: "Graph health metadata is unavailable from this endpoint.",
  };
  const qualitySignals = graph.qualitySignals ?? {
    orphanNotes: [],
    duplicateClusters: [],
    missingBacklinks: [],
    staleEvidenceLinks: [],
  };
  const allSignals = [
    ...qualitySignals.orphanNotes,
    ...qualitySignals.duplicateClusters,
    ...qualitySignals.missingBacklinks,
    ...qualitySignals.staleEvidenceLinks,
  ];
  const mapCoverage = graph.mapCoverage ?? {
    totalRecords: graph.nodes.filter((node) => node.layer !== "task").length,
    coveredRecords: 0,
    uncoveredRecords: 0,
    coveragePercent: 0,
    uncoveredSample: [],
  };
  const visibleSignals = signalFilter === "all"
    ? allSignals
    : signalFilter === "map_gap"
      ? []
      : allSignals.filter((signal) => signal.type === signalFilter);
  const normalizedNodeQuery = nodeQuery.trim().toLowerCase();
  const visibleNodes = graph.nodes
    .filter((node) => !normalizedNodeQuery || containsText(node.label, normalizedNodeQuery) || containsText(node.layer, normalizedNodeQuery) || containsText(node.sourcePath, normalizedNodeQuery))
    .sort((a, b) => (b.degree ?? 0) - (a.degree ?? 0) || a.label.localeCompare(b.label));
  const readinessColor = readiness.status === "ready" ? color.positive : readiness.status === "blocked" ? color.negative : color.warning;
  const signalCounts: Record<GraphSignalFilter, number> = {
    all: allSignals.length,
    orphan_note: qualitySignals.orphanNotes.length,
    duplicate_cluster: qualitySignals.duplicateClusters.length,
    missing_backlink: qualitySignals.missingBacklinks.length,
    stale_evidence_link: qualitySignals.staleEvidenceLinks.length,
    map_gap: mapCoverage.uncoveredRecords,
  };

  return (
    <div data-testid="memory-graph-explorer" style={{ display: "grid", gap: space.xl }}>
      <div data-testid="memory-graph-health" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 150px), 1fr))", gap: space.md }}>
        {[
          { label: "Readiness", value: `${readiness.score}`, icon: <ShieldCheck size={14} />, tone: readinessColor, detail: readiness.status.replace("_", " ") },
          { label: "Graph Links", value: graph.edges.length, icon: <Network size={14} />, tone: color.accent, detail: `${graph.nodes.length} nodes` },
          { label: "Open Signals", value: allSignals.length, icon: <AlertTriangle size={14} />, tone: allSignals.length ? color.warning : color.positive, detail: "quality checks" },
          { label: "Map Coverage", value: `${mapCoverage.coveragePercent}%`, icon: <MapPinned size={14} />, tone: mapCoverage.coveragePercent >= 80 ? color.positive : color.warning, detail: `${mapCoverage.coveredRecords}/${mapCoverage.totalRecords}` },
        ].map((metric) => (
          <div key={metric.label} style={{ padding: space.lg, border: `0.5px solid ${color.border}`, borderRadius: radius.lg, background: color.surface, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: T.caption.size, color: color.textMuted }}>
              <span style={{ color: metric.tone, display: "inline-flex" }}>{metric.icon}</span>
              {metric.label}
            </div>
            <div style={{ marginTop: 4, fontSize: 20, fontWeight: 600, color: metric.tone }}>{metric.value}</div>
            <div style={{ fontSize: T.caption.size, color: color.textMuted }}>{metric.detail}</div>
          </div>
        ))}
      </div>

      <div style={{ padding: `${space.sm}px ${space.lg}px`, borderRadius: radius.md, border: `0.5px solid ${readinessColor}33`, background: `${readinessColor}10`, color: readinessColor, fontSize: T.bodySmall.size }}>
        {readiness.summary}
      </div>

      <div data-testid="memory-graph-signal-tabs" style={{ display: "flex", gap: space.sm, flexWrap: "wrap", borderBottom: `0.5px solid ${color.border}`, paddingBottom: space.md }}>
        {(["all", "orphan_note", "duplicate_cluster", "missing_backlink", "stale_evidence_link", "map_gap"] as GraphSignalFilter[]).map((filter) => (
          <button
            key={filter}
            type="button"
            onClick={() => setSignalFilter(filter)}
            style={{
              padding: `6px ${space.md}px`,
              borderRadius: radius.full,
              border: `0.5px solid ${signalFilter === filter ? color.accent : color.border}`,
              background: signalFilter === filter ? `${color.accent}11` : "transparent",
              color: signalFilter === filter ? color.accent : color.textSecondary,
              cursor: "pointer",
              fontSize: T.caption.size,
            }}
          >
            {graphSignalLabel(filter)} ({signalCounts[filter]})
          </button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 0.9fr) minmax(0, 1.1fr)", gap: space.xl, alignItems: "start" }}>
        <div style={{ display: "grid", gap: space.md, minWidth: 0 }}>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: space.sm,
              border: `0.5px solid ${color.border}`,
              borderRadius: radius.md,
              background: color.surface,
              padding: `0 ${space.md}px`,
              minWidth: 0,
            }}
          >
            <Search size={14} style={{ color: color.textMuted, flexShrink: 0 }} />
            <input
              value={nodeQuery}
              onChange={(event) => setNodeQuery(event.target.value)}
              placeholder="Filter graph nodes"
              style={{ width: "100%", border: "none", outline: "none", background: "transparent", color: color.text, fontSize: T.bodySmall.size, padding: `${space.sm}px 0`, minWidth: 0 }}
            />
          </label>

          <div style={{ borderRadius: radius.lg, border: `0.5px solid ${color.border}`, background: color.surface, padding: space.xl, minWidth: 0 }}>
            <div style={{ fontSize: T.caption.size, color: color.textMuted, marginBottom: space.md }}>
              Nodes
            </div>
            <div style={{ display: "grid", gap: space.sm }}>
              {visibleNodes.length === 0 ? (
                <span style={{ fontSize: T.bodySmall.size, color: color.textMuted }}>No nodes match the current filter.</span>
              ) : visibleNodes.slice(0, 120).map((node) => (
                <div key={node.id} style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr) auto", alignItems: "center", gap: space.sm, minWidth: 0, fontSize: T.bodySmall.size }}>
                  <span style={{ width: 8, height: 8, borderRadius: 8, background: node.layer === "task" ? color.warning : color.accent, flexShrink: 0 }} />
                  <span style={{ color: color.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{node.label}</span>
                  <span style={{ color: color.textMuted, flexShrink: 0 }}>{node.layer} · {node.degree ?? 0}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ borderRadius: radius.lg, border: `0.5px solid ${color.border}`, background: color.surface, padding: space.xl, minWidth: 0 }}>
            <div style={{ fontSize: T.caption.size, color: color.textMuted, marginBottom: space.md }}>Edges</div>
            <div style={{ display: "grid", gap: space.sm }}>
              {graph.edges.length === 0 ? (
                <span style={{ fontSize: T.bodySmall.size, color: color.textMuted }}>No linked records yet.</span>
              ) : graph.edges.slice(0, 120).map((edge, index) => {
                const source = nodeById.get(edge.source);
                const target = nodeById.get(edge.target);
                return (
                  <div key={`${edge.source}-${edge.target}-${index}`} style={{ display: "grid", gap: 2, fontSize: T.bodySmall.size, minWidth: 0 }}>
                    <span style={{ color: color.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{source?.label ?? edge.source}</span>
                    <span style={{ color: color.textMuted, display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
                      <Link2 size={11} style={{ flexShrink: 0 }} />
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{edge.label} to {target?.label ?? edge.target}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div data-testid="memory-graph-quality-signals" style={{ display: "grid", gap: space.md, minWidth: 0 }}>
          {signalFilter === "map_gap" ? (
            <div style={{ padding: space.xl, borderRadius: radius.lg, border: `0.5px solid ${color.border}`, background: color.surface, display: "grid", gap: space.sm }}>
              <div style={{ display: "flex", alignItems: "center", gap: space.sm, fontSize: T.body.size, fontWeight: 600, color: color.text }}>
                <MapPinned size={15} style={{ color: color.warning }} />
                Map-note coverage gaps
              </div>
              <div style={{ fontSize: T.bodySmall.size, color: color.textSecondary }}>
                {mapCoverage.uncoveredRecords} indexed notes are not represented by a map note or map-tagged source.
              </div>
              {mapCoverage.uncoveredSample.length === 0 ? (
                <div style={{ fontSize: T.bodySmall.size, color: color.positive }}>All indexed notes have map coverage.</div>
              ) : mapCoverage.uncoveredSample.map((record) => (
                <div key={record.recordId} style={{ paddingTop: space.sm, borderTop: `0.5px solid ${color.border}`, fontSize: T.caption.size, color: color.textSecondary, minWidth: 0 }}>
                  <div style={{ color: color.text, fontSize: T.bodySmall.size, fontWeight: 600, overflowWrap: "anywhere" }}>{record.title}</div>
                  <div style={{ overflowWrap: "anywhere" }}>{record.layer} · {record.sourcePath}</div>
                </div>
              ))}
            </div>
          ) : visibleSignals.length === 0 ? (
            <div style={{ padding: space.xl, borderRadius: radius.lg, border: `0.5px solid ${color.border}`, background: color.surface, color: color.textMuted, fontSize: T.bodySmall.size }}>
              No graph quality signals in this view.
            </div>
          ) : visibleSignals.slice(0, 80).map((signal) => (
            <div key={signal.id} data-testid="memory-graph-signal-row" style={{ padding: space.lg, borderRadius: radius.lg, border: `0.5px solid ${signalColor(signal.severity)}33`, background: color.surface, display: "grid", gap: space.sm, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: space.sm, flexWrap: "wrap" }}>
                <span style={{ fontSize: T.caption.size, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: signalColor(signal.severity), background: `${signalColor(signal.severity)}12`, border: `0.5px solid ${signalColor(signal.severity)}33`, borderRadius: radius.sm, padding: `2px ${space.sm}px` }}>
                  {formatLabel(signal.type)}
                </span>
                <span style={{ fontSize: T.caption.size, color: color.textMuted }}>{signal.severity}</span>
              </div>
              <div style={{ fontSize: T.bodySmall.size, color: color.text, fontWeight: 600, overflowWrap: "anywhere" }}>{signal.title}</div>
              <div style={{ fontSize: T.caption.size, color: color.textSecondary, lineHeight: 1.5, overflowWrap: "anywhere" }}>{signal.detail}</div>
              {signal.recordIds.length > 0 && (
                <div style={{ display: "flex", gap: space.xs, flexWrap: "wrap" }}>
                  {signal.recordIds.slice(0, 4).map((id) => (
                    <span key={id} style={{ fontSize: T.caption.size, color: color.textMuted, border: `0.5px solid ${color.border}`, borderRadius: radius.sm, padding: `2px ${space.sm}px`, fontFamily: "monospace" }}>
                      {id.slice(0, 12)}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Card ── */

function CandidateCard({
  candidate,
  viewer,
  operatorLabel,
  companyCode,
  onReview,
}: {
  candidate: MemoryCandidate;
  viewer: string;
  operatorLabel: string;
  companyCode: string;
  onReview: (id: string, decision: "approved" | "rejected") => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState<"approved" | "rejected" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isOperatorViewer = viewer.toLowerCase() === operatorLabel.toLowerCase();
  const isRoutedToViewer =
    (!candidate.routingTarget && isOperatorViewer) ||
    (isLegacyHumanActor(candidate.routingTarget) && isOperatorViewer) ||
    candidate.routingTarget?.toLowerCase() === viewer.toLowerCase();

  const isSpecialistRouted =
    !isRoutedToViewer &&
    candidate.routingTarget !== null;

  const truncatedBody = candidate.body.length > 280
    ? candidate.body.slice(0, 280).trimEnd() + "…"
    : candidate.body;

  const displayBody = expanded ? candidate.body : truncatedBody;
  const needsTruncation = candidate.body.length > 280;

  const handleReview = async (decision: "approved" | "rejected") => {
    setBusy(decision);
    setError(null);
    try {
      await onReview(candidate.id, decision);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(null);
    }
  };

  const taskHref = candidate.sourceTaskKey
    ? `/${encodeURIComponent(companyCode)}/tasks/${encodeURIComponent(candidate.sourceTaskKey)}`
    : null;

  return (
    <div
      style={{
        padding: `${space.lg}px ${space.xl}px`,
        borderRadius: radius.lg,
        border: `0.5px solid ${color.border}`,
        background: color.surface,
        display: "flex",
        flexDirection: "column",
        gap: space.md,
      }}
    >
      {/* Top row: category badge + routing label */}
      <div style={{ display: "flex", alignItems: "center", gap: space.sm, flexWrap: "wrap" }}>
        {candidate.category && (
          <span
            style={{
              fontSize: T.caption.size,
              fontWeight: 600,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              padding: `2px ${space.sm}px`,
              borderRadius: radius.sm,
              background: `${categoryTone(candidate.category)}22`,
              color: categoryTone(candidate.category),
              border: `0.5px solid ${categoryTone(candidate.category)}44`,
            }}
          >
            {candidate.category}
          </span>
        )}
        <span
          style={{
            fontSize: T.caption.size,
            color: color.textSecondary,
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          <User size={11} style={{ flexShrink: 0 }} />
          {routingLabel(candidate.routingTarget, candidate.category, operatorLabel)}
        </span>
      </div>

      {/* Specialist pending notice */}
      {isSpecialistRouted && isOperatorViewer && !isLegacyHumanActor(candidate.routingTarget) && (
        <div
          style={{
            fontSize: T.caption.size,
            color: color.info,
            background: `${color.info}18`,
            border: `0.5px solid ${color.info}33`,
            borderRadius: radius.sm,
            padding: `${space.xs}px ${space.sm}px`,
          }}
        >
          Pending specialist review by {candidate.routingTarget}
        </div>
      )}

      {/* Body */}
      <div>
        <p
          style={{
            margin: 0,
            fontSize: T.bodySmall.size,
            color: color.text,
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {displayBody}
        </p>
        {needsTruncation && (
          <button
            type="button"
            onClick={() => setExpanded((p) => !p)}
            style={{
              marginTop: space.xs,
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: T.caption.size,
              color: color.accent,
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: 0,
            }}
          >
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            {expanded ? "Show less" : "Show more"}
          </button>
        )}
      </div>

      {/* Meta row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: space.md,
          flexWrap: "wrap",
          fontSize: T.caption.size,
          color: color.textMuted,
        }}
      >
        {candidate.proposedByAgent && (
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <Brain size={11} style={{ flexShrink: 0 }} />
            {candidate.proposedByAgent}
          </span>
        )}
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <Clock size={11} style={{ flexShrink: 0 }} />
          {formatRelative(candidate.proposedAt)}
        </span>
        {taskHref && candidate.sourceTaskKey && (
          <Link
            href={taskHref}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              color: color.accent,
              textDecoration: "none",
              fontSize: T.caption.size,
            }}
          >
            <ExternalLink size={11} style={{ flexShrink: 0 }} />
            {candidate.sourceTaskKey}
          </Link>
        )}
        <span>Status: {formatLabel(candidate.status)}</span>
      </div>

      <div
        style={{
          display: "grid",
          gap: 4,
          fontSize: T.caption.size,
          color: color.textMuted,
          borderTop: `0.5px solid ${color.border}`,
          paddingTop: space.sm,
        }}
      >
        <span>
          Write target: {candidate.targetSourceFile ? candidate.targetSourceFile : "new company vault note"}
        </span>
        {candidate.reviewedBy && candidate.reviewedAt && (
          <span>
            Reviewed by {candidate.reviewedBy} {formatRelative(candidate.reviewedAt)}
          </span>
        )}
      </div>

      {/* Error */}
      {error && (
        <div
          style={{
            fontSize: T.caption.size,
            color: color.negative,
            background: `${color.negative}18`,
            border: `0.5px solid ${color.negative}33`,
            borderRadius: radius.sm,
            padding: `${space.xs}px ${space.sm}px`,
          }}
        >
          {error}
        </div>
      )}

      {/* Actions */}
      {isRoutedToViewer && (
        <div style={{ display: "flex", alignItems: "center", gap: space.sm }}>
          <button
            type="button"
            disabled={!!busy}
            onClick={() => handleReview("approved")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: `6px ${space.md}px`,
              borderRadius: radius.sm,
              border: `0.5px solid ${color.positive}55`,
              background: busy === "approved" ? `${color.positive}22` : "transparent",
              color: color.positive,
              fontSize: T.bodySmall.size,
              cursor: busy ? "not-allowed" : "pointer",
              opacity: busy && busy !== "approved" ? 0.5 : 1,
              transition: "background 0.15s",
            }}
          >
            <Check size={13} />
            {busy === "approved" ? "Approving…" : "Approve"}
          </button>
          <button
            type="button"
            disabled={!!busy}
            onClick={() => handleReview("rejected")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: `6px ${space.md}px`,
              borderRadius: radius.sm,
              border: `0.5px solid ${color.negative}55`,
              background: busy === "rejected" ? `${color.negative}22` : "transparent",
              color: color.negative,
              fontSize: T.bodySmall.size,
              cursor: busy ? "not-allowed" : "pointer",
              opacity: busy && busy !== "rejected" ? 0.5 : 1,
              transition: "background 0.15s",
            }}
          >
            <X size={13} />
            {busy === "rejected" ? "Rejecting…" : "Reject"}
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Quality Tab ── */

function QualityTab({ slug, viewer }: { slug: string; viewer: string }) {
  const [dashboard, setDashboard] = useState<MemoryQualityDashboard | null>(null);
  const [queueItems, setQueueItems] = useState<MemoryQualityQueueItem[]>([]);
  const [selectedQueue, setSelectedQueue] = useState<MemoryQualityQueueType>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    try {
      const res = await fetch(`/api/orchestration/companies/${encodeURIComponent(slug)}/memory/quality?view=dashboard`, { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load quality dashboard");
      setDashboard(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Load failed");
    }
  }, [slug]);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/orchestration/companies/${encodeURIComponent(slug)}/memory/quality?view=queue&queue=${selectedQueue}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load queue");
      const data = await res.json();
      setQueueItems(data.items || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [slug, selectedQueue]);

  useEffect(() => { void loadDashboard(); }, [loadDashboard]);
  useEffect(() => { void loadQueue(); }, [loadQueue]);

  const handleAction = async (targetType: string, targetId: string, action: string) => {
    setActionBusy(targetId);
    setError(null);
    setActionNotice(null);
    try {
      const res = await fetch(`/api/orchestration/companies/${encodeURIComponent(slug)}/memory/quality/issues/${encodeURIComponent(targetType)}/${encodeURIComponent(targetId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, actor: viewer })
      });
      if (!res.ok) throw new Error("Action failed");
      const result = await res.json() as { state?: { state?: string } };
      await Promise.all([loadDashboard(), loadQueue()]);
      setActionNotice(`${formatLabel(action)} saved: ${formatLabel(result.state?.state ?? "updated")}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setActionBusy(null);
    }
  };

  const selectedIssue = queueItems.find(i => i.targetId === selectedIssueId) ?? null;

  return (
    <div style={{ display: "grid", gap: space.xl }}>
      {error && <div style={{ color: color.negative, padding: space.sm, background: color.negativeSoft, borderRadius: radius.md }}>{error}</div>}
      {actionNotice && <div role="status" data-testid="memory-quality-action-confirmation" style={{ color: color.positive, padding: space.sm, background: color.positiveSoft, borderRadius: radius.md }}>{actionNotice}</div>}

      {dashboard && (
        <div data-testid="memory-quality-kpis" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 150px), 1fr))", gap: space.md }}>
          <div style={{ padding: space.lg, border: `0.5px solid ${color.border}`, borderRadius: radius.lg, background: color.surface }}>
            <div style={{ fontSize: T.caption.size, color: color.textMuted }}>Total Scored</div>
            <div style={{ fontSize: 20, fontWeight: 600 }}>{dashboard.kpis.totalScored}</div>
          </div>
          <div style={{ padding: space.lg, border: `0.5px solid ${color.border}`, borderRadius: radius.lg, background: color.surface }}>
            <div style={{ fontSize: T.caption.size, color: color.textMuted }}>Open Issues</div>
            <div style={{ fontSize: 20, fontWeight: 600, color: dashboard.kpis.openIssues > 0 ? color.warning : color.text }}>{dashboard.kpis.openIssues}</div>
          </div>
          <div style={{ padding: space.lg, border: `0.5px solid ${color.border}`, borderRadius: radius.lg, background: color.surface }}>
            <div style={{ fontSize: T.caption.size, color: color.textMuted }}>Critical Issues</div>
            <div style={{ fontSize: 20, fontWeight: 600, color: dashboard.kpis.criticalIssues > 0 ? color.negative : color.text }}>{dashboard.kpis.criticalIssues}</div>
          </div>
          <div style={{ padding: space.lg, border: `0.5px solid ${color.border}`, borderRadius: radius.lg, background: color.surface }}>
            <div style={{ fontSize: T.caption.size, color: color.textMuted }}>Reviewed</div>
            <div style={{ fontSize: 20, fontWeight: 600 }}>{dashboard.kpis.reviewedIssues}</div>
          </div>
          <div style={{ padding: space.lg, border: `0.5px solid ${color.border}`, borderRadius: radius.lg, background: color.surface }}>
            <div style={{ fontSize: T.caption.size, color: color.textMuted }}>Acknowledged</div>
            <div style={{ fontSize: 20, fontWeight: 600 }}>{dashboard.kpis.acknowledgedIssues}</div>
          </div>
          <div style={{ padding: space.lg, border: `0.5px solid ${color.border}`, borderRadius: radius.lg, background: color.surface }}>
            <div style={{ fontSize: T.caption.size, color: color.textMuted }}>Resolved</div>
            <div style={{ fontSize: 20, fontWeight: 600, color: color.positive }}>{dashboard.kpis.resolvedIssues}</div>
          </div>
          <div style={{ padding: space.lg, border: `0.5px solid ${color.border}`, borderRadius: radius.lg, background: color.surface }}>
            <div style={{ fontSize: T.caption.size, color: color.textMuted }}>Dismissed</div>
            <div style={{ fontSize: 20, fontWeight: 600 }}>{dashboard.kpis.dismissedIssues}</div>
          </div>
          <div style={{ padding: space.lg, border: `0.5px solid ${color.border}`, borderRadius: radius.lg, background: color.surface }}>
            <div style={{ fontSize: T.caption.size, color: color.textMuted }}>Superseded</div>
            <div style={{ fontSize: 20, fontWeight: 600 }}>{dashboard.kpis.supersededIssues}</div>
          </div>
          <div style={{ padding: space.lg, border: `0.5px solid ${color.border}`, borderRadius: radius.lg, background: color.surface }}>
            <div style={{ fontSize: T.caption.size, color: color.textMuted }}>Archived</div>
            <div style={{ fontSize: 20, fontWeight: 600 }}>{dashboard.kpis.archivedIssues}</div>
          </div>
          <div style={{ padding: space.lg, border: `0.5px solid ${color.border}`, borderRadius: radius.lg, background: color.surface }}>
            <div style={{ fontSize: T.caption.size, color: color.textMuted }}>Rewrite Requested</div>
            <div style={{ fontSize: 20, fontWeight: 600 }}>{dashboard.kpis.rewriteRequestedIssues}</div>
          </div>
          <div style={{ padding: space.lg, border: `0.5px solid ${color.border}`, borderRadius: radius.lg, background: color.surface }}>
            <div style={{ fontSize: T.caption.size, color: color.textMuted }}>Merge Candidate</div>
            <div style={{ fontSize: 20, fontWeight: 600 }}>{dashboard.kpis.mergeCandidateIssues}</div>
          </div>
          <div style={{ padding: space.lg, border: `0.5px solid ${color.border}`, borderRadius: radius.lg, background: color.surface }}>
            <div style={{ fontSize: T.caption.size, color: color.textMuted }}>Average Score</div>
            <div style={{ fontSize: 20, fontWeight: 600, color: dashboard.kpis.averageQualityScore !== null && dashboard.kpis.averageQualityScore < 50 ? color.warning : color.positive }}>
              {dashboard.kpis.averageQualityScore ?? "N/A"}
            </div>
          </div>
        </div>
      )}

      <div data-testid="memory-quality-queue-tabs" style={{ display: "flex", gap: space.sm, borderBottom: `0.5px solid ${color.border}`, paddingBottom: space.md, flexWrap: "wrap" }}>
        {(["all", "duplicates", "stale", "weak_provenance", "broken_links", "low_confidence"] as MemoryQualityQueueType[]).map(q => (
          <button
            key={q}
            type="button"
            onClick={() => { setSelectedQueue(q); setSelectedIssueId(null); setActionNotice(null); }}
            style={{
              padding: `6px ${space.md}px`,
              borderRadius: radius.full,
              border: `0.5px solid ${selectedQueue === q ? color.accent : color.border}`,
              background: selectedQueue === q ? `${color.accent}11` : "transparent",
              color: selectedQueue === q ? color.accent : color.textSecondary,
              cursor: "pointer",
              fontSize: T.caption.size,
            }}
          >
            {formatLabel(q)} {(dashboard?.queues as Record<string, { count: number; worstScore: number | null; }>)?.[q]?.count !== undefined ? `(${(dashboard!.queues as Record<string, { count: number; worstScore: number | null; }>)[q].count})` : ""}
          </button>
        ))}
      </div>

      <div data-testid="memory-quality-workspace" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))", gap: space.xl, alignItems: "start" }}>
        <div data-testid="memory-quality-queue-panel" style={{ display: "grid", gap: space.sm, minWidth: 0 }}>
          {loading ? (
            <div style={{ padding: space.xl, textAlign: "center", color: color.textMuted }}>Loading queue...</div>
          ) : queueItems.length === 0 ? (
            <div style={{ padding: space.xl, textAlign: "center", color: color.textMuted, border: `0.5px solid ${color.border}`, borderRadius: radius.lg }}>No issues found in this queue.</div>
          ) : (
            queueItems.map(item => (
              <div
                key={item.id}
                data-testid="memory-quality-issue-row"
                onClick={() => setSelectedIssueId(item.targetId)}
                style={{
                  padding: space.md,
                  border: `0.5px solid ${selectedIssueId === item.targetId ? color.accent : color.border}`,
                  borderRadius: radius.md,
                  background: selectedIssueId === item.targetId ? `${color.accent}08` : color.surface,
                  cursor: "pointer",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: space.sm, marginBottom: space.xs, minWidth: 0 }}>
                  <span style={{ fontWeight: 600, fontSize: T.bodySmall.size, minWidth: 0, overflowWrap: "anywhere" }}>{item.target.title}</span>
                  <span style={{ color: item.severity === "critical" ? color.negative : item.severity === "high" ? color.warning : color.textSecondary, fontSize: T.caption.size, flexShrink: 0 }}>{item.qualityScore} score</span>
                </div>
                <div style={{ fontSize: T.caption.size, color: color.textMuted, overflowWrap: "anywhere" }}>{item.reasons.join(", ")}</div>
              </div>
            ))
          )}
        </div>

        {selectedIssue ? (
          <div data-testid="memory-quality-drill-in" style={{ padding: space.xl, border: `0.5px solid ${color.border}`, borderRadius: radius.lg, background: color.surface, display: "grid", gap: space.md, minWidth: 0 }}>
            <h3 style={{ margin: 0, fontSize: T.body.size, fontWeight: 600, overflowWrap: "anywhere" }}>{selectedIssue.target.title}</h3>
            <div style={{ fontSize: T.bodySmall.size, color: color.textSecondary, overflowWrap: "anywhere" }}>{selectedIssue.target.excerpt}</div>

            <div style={{ display: "grid", gap: space.xs, fontSize: T.caption.size }}>
              <div><strong style={{ color: color.textMuted }}>Severity:</strong> <span style={{ color: selectedIssue.severity === "critical" ? color.negative : color.text }}>{selectedIssue.severity}</span></div>
              <div><strong style={{ color: color.textMuted }}>Score:</strong> {selectedIssue.qualityScore}</div>
              <div><strong style={{ color: color.textMuted }}>State:</strong> {selectedIssue.curationState}</div>
              <div><strong style={{ color: color.textMuted }}>Queues:</strong> {selectedIssue.queues.map(formatLabel).join(", ")}</div>
            </div>

            <div style={{ borderTop: `0.5px solid ${color.border}`, paddingTop: space.md, display: "flex", gap: space.sm, flexWrap: "wrap" }}>
              {(selectedIssue.curationState === "dismissed" || selectedIssue.curationState === "archived" || selectedIssue.curationState === "superseded") ? (
                <button
                  type="button"
                  disabled={actionBusy === selectedIssue.targetId}
                  onClick={() => handleAction(selectedIssue.targetType, selectedIssue.targetId, "restore")}
                  style={{
                    padding: `6px ${space.md}px`,
                    borderRadius: radius.sm,
                    border: `0.5px solid ${color.accent}55`,
                    background: `${color.accent}11`,
                    color: color.accent,
                    cursor: actionBusy === selectedIssue.targetId ? "not-allowed" : "pointer",
                    fontSize: T.caption.size,
                    opacity: actionBusy === selectedIssue.targetId ? 0.5 : 1,
                  }}
                >
                  Restore to Open
                </button>
              ) : (
                <>
                  {[
                    { id: "mark_reviewed", label: "Mark Reviewed" },
                    { id: "acknowledge", label: "Acknowledge" },
                    { id: "dismiss", label: "Dismiss" },
                    { id: "archive", label: "Archive" },
                    { id: "request_rewrite", label: "Request Rewrite" },
                    { id: "suggest_merge", label: "Merge Candidate" },
                    { id: "resolve", label: "Resolve" },
                  ].map(action => (
                    <button
                      key={action.id}
                      type="button"
                      disabled={actionBusy === selectedIssue.targetId}
                      onClick={() => handleAction(selectedIssue.targetType, selectedIssue.targetId, action.id)}
                      style={{
                        padding: `6px ${space.md}px`,
                        borderRadius: radius.sm,
                        border: `0.5px solid ${color.border}`,
                        background: "transparent",
                        color: color.text,
                        cursor: actionBusy === selectedIssue.targetId ? "not-allowed" : "pointer",
                        fontSize: T.caption.size,
                        opacity: actionBusy === selectedIssue.targetId ? 0.5 : 1,
                      }}
                    >
                      {action.label}
                    </button>
                  ))}
                </>
              )}
            </div>
          </div>
        ) : (
           <div style={{ padding: space.xl, border: `0.5px solid ${color.border}`, borderRadius: radius.lg, background: color.surface, color: color.textMuted, fontSize: T.bodySmall.size, textAlign: "center" }}>
             Select an issue to view details and curation controls.
           </div>
        )}
      </div>
    </div>
  );
}

/* ── Wiki Governance Tab ── */

type WikiStateFilter = WikiWritebackApprovalState | "all";

const WIKI_STATE_FILTERS: WikiStateFilter[] = ["all", "requested", "approved", "written", "failed", "rolled_back"];

function wikiStateBadgeColor(state: WikiWritebackApprovalState): string {
  switch (state) {
    case "requested": return color.info;
    case "approved": return color.positive;
    case "written": return color.positive;
    case "rejected": return color.textMuted;
    case "failed": return color.negative;
    case "rolled_back": return color.warning;
    default: return color.textMuted;
  }
}

function WikiStateBadge({ state }: { state: WikiWritebackApprovalState }) {
  const c = wikiStateBadgeColor(state);
  return (
    <span
      style={{
        fontSize: T.caption.size,
        fontWeight: 600,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        padding: `2px ${space.sm}px`,
        borderRadius: radius.sm,
        background: `${c}18`,
        color: c,
        border: `0.5px solid ${c}44`,
        flexShrink: 0,
      }}
    >
      {state.replace("_", " ")}
    </span>
  );
}

function WikiRequestRow({
  request,
  selected,
  onClick,
}: {
  request: WikiWritebackRequest;
  selected: boolean;
  onClick: () => void;
}) {
  const filename = request.targetPath.split("/").pop() ?? request.targetPath;
  return (
    <button
      type="button"
      data-testid="wiki-request-row"
      onClick={onClick}
      style={{
        textAlign: "left",
        padding: `${space.md}px ${space.lg}px`,
        borderRadius: radius.md,
        border: `0.5px solid ${selected ? color.accent : color.border}`,
        background: selected ? `${color.accent}10` : color.surface,
        display: "flex",
        flexDirection: "column",
        gap: space.xs,
        cursor: "pointer",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: space.sm, flexWrap: "wrap" }}>
        <WikiStateBadge state={request.approvalState} />
        <span
          style={{
            fontSize: T.bodySmall.size,
            fontWeight: 600,
            color: color.text,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            maxWidth: 200,
          }}
        >
          {filename}
        </span>
      </div>
      <div style={{ fontSize: T.caption.size, color: color.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {request.targetPath}
      </div>
      <div style={{ display: "flex", gap: space.sm, fontSize: T.caption.size, color: color.textMuted, flexWrap: "wrap" }}>
        {request.requestedBy && <span>{request.requestedBy}</span>}
        <span>{formatRelative(request.createdAt)}</span>
        <span>{request.sourceMemoryIds.length} mem</span>
      </div>
    </button>
  );
}

function WikiPreviewPanel({
  slug,
  request,
  onClose,
}: {
  slug: string;
  request: WikiWritebackRequest;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [provenanceOpen, setProvenanceOpen] = useState(false);

  const loadPreview = useCallback(async () => {
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const res = await fetch(
        `/api/orchestration/companies/${encodeURIComponent(slug)}/wiki/writeback`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targetPath: request.targetPath,
            sourceMemoryIds: request.sourceMemoryIds,
            curationActionIds: request.curationActionIds,
            idempotencyKey: request.idempotencyKey,
            requestedBy: request.requestedBy,
          }),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => null) as { message?: string } | null;
        throw new Error(err?.message ?? `Preview failed: ${res.status}`);
      }
      const data = await res.json() as { generatedMarkdown?: string };
      setPreview(data.generatedMarkdown ?? null);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "Preview unavailable");
    } finally {
      setPreviewLoading(false);
    }
  }, [slug, request]);

  useEffect(() => {
    void loadPreview();
  }, [loadPreview]);

  return (
    <div
      data-testid="wiki-preview-panel"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: space.sm,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: T.caption.size, color: color.textMuted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Markdown Preview
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{ background: "none", border: "none", color: color.textMuted, cursor: "pointer", padding: 2 }}
        >
          <X size={14} />
        </button>
      </div>
      {previewLoading && (
        <div style={{ fontSize: T.bodySmall.size, color: color.textMuted, padding: space.sm }}>
          Generating preview…
        </div>
      )}
      {previewError && (
        <div style={{ fontSize: T.caption.size, color: color.warning, padding: `${space.xs}px ${space.sm}px`, background: `${color.warning}12`, borderRadius: radius.sm, border: `0.5px solid ${color.warning}33` }}>
          {previewError}
        </div>
      )}
      {preview && !previewLoading && (
        <pre
          style={{
            margin: 0,
            fontSize: 11,
            color: color.textSecondary,
            background: `${color.accent}08`,
            border: `0.5px solid ${color.border}`,
            borderRadius: radius.sm,
            padding: space.md,
            overflowX: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            maxHeight: 320,
            overflowY: "auto",
            lineHeight: 1.5,
          }}
        >
          {preview}
        </pre>
      )}

      {/* Provenance drawer */}
      <button
        type="button"
        data-testid="wiki-provenance-drawer"
        onClick={() => setProvenanceOpen((p) => !p)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: "none",
          border: `0.5px solid ${color.border}`,
          borderRadius: radius.sm,
          padding: `${space.xs}px ${space.sm}px`,
          cursor: "pointer",
          color: color.textSecondary,
          fontSize: T.caption.size,
          marginTop: space.xs,
        }}
      >
        {provenanceOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        Provenance &amp; Idempotency
      </button>
      {provenanceOpen && (
        <div style={{ display: "grid", gap: space.xs, fontSize: T.caption.size, color: color.textSecondary, padding: `${space.sm}px ${space.md}px`, border: `0.5px solid ${color.border}`, borderRadius: radius.sm }}>
          <div><strong style={{ color: color.textMuted }}>Idempotency key:</strong> <span style={{ wordBreak: "break-all" }}>{request.idempotencyKey}</span></div>
          <div><strong style={{ color: color.textMuted }}>Content hash:</strong> <span style={{ wordBreak: "break-all", fontFamily: "monospace" }}>{request.generatedContentHash.slice(0, 16)}…</span></div>
          {request.previousFileHash && (
            <div><strong style={{ color: color.textMuted }}>Prev file hash:</strong> <span style={{ wordBreak: "break-all", fontFamily: "monospace" }}>{request.previousFileHash.slice(0, 16)}…</span></div>
          )}
          {request.curationActionIds.length > 0 && (
            <div><strong style={{ color: color.textMuted }}>Curation actions:</strong> {request.curationActionIds.length}</div>
          )}
        </div>
      )}
    </div>
  );
}

function WikiDetailPanel({
  slug,
  request,
  onApprove,
  onReject,
  onWrite,
}: {
  slug: string;
  request: WikiWritebackRequest | null;
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
  onWrite: (id: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    setActionError(null);
    setShowPreview(false);
    setBusy(null);
  }, [request?.id]);

  if (!request) {
    return (
      <div
        style={{
          padding: `${space.xl}px`,
          borderRadius: radius.lg,
          border: `0.5px solid ${color.border}`,
          background: color.surface,
          color: color.textMuted,
          fontSize: T.bodySmall.size,
        }}
      >
        Select a write-back request to inspect and take action.
      </div>
    );
  }

  const handleAction = async (action: () => Promise<void>, label: string) => {
    setBusy(label);
    setActionError(null);
    try {
      await action();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(null);
    }
  };

  const rollback = request.rollback as {
    strategy?: string;
    targetPath?: string;
    previousFileHash?: string | null;
    writtenFileHash?: string | null;
    conflictHash?: string | null;
  };

  return (
    <aside
      style={{
        padding: `${space.xl}px`,
        borderRadius: radius.lg,
        border: `0.5px solid ${color.border}`,
        background: color.surface,
        display: "flex",
        flexDirection: "column",
        gap: space.lg,
        minWidth: 0,
      }}
    >
      {/* Target path */}
      <div>
        <div style={{ fontSize: T.caption.size, color: color.textMuted, marginBottom: space.xs }}>Target path</div>
        <div
          data-testid="wiki-request-target-path"
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: space.sm,
            padding: `${space.sm}px ${space.md}px`,
            borderRadius: radius.sm,
            background: `${color.accent}08`,
            border: `0.5px solid ${color.border}`,
            wordBreak: "break-all",
            fontSize: T.bodySmall.size,
            color: color.text,
            fontFamily: "monospace",
          }}
        >
          <FileText size={14} style={{ color: color.accent, flexShrink: 0, marginTop: 1 }} />
          {request.targetPath}
        </div>
      </div>

      {/* State badge */}
      <div style={{ display: "flex", alignItems: "center", gap: space.sm }}>
        <WikiStateBadge state={request.approvalState} />
        <span data-testid="wiki-request-state" style={{ display: "none" }}>{request.approvalState}</span>
      </div>

      {/* Action error */}
      {actionError && (
        <div
          style={{
            fontSize: T.caption.size,
            color: color.negative,
            background: `${color.negative}12`,
            border: `0.5px solid ${color.negative}33`,
            borderRadius: radius.sm,
            padding: `${space.xs}px ${space.sm}px`,
          }}
        >
          {actionError}
        </div>
      )}

      {/* Conflict / failure notice */}
      {request.approvalState === "failed" && request.failureReason && (
        <div
          data-testid="wiki-conflict-notice"
          style={{
            padding: `${space.sm}px ${space.md}px`,
            borderRadius: radius.md,
            background: `${color.negative}12`,
            border: `0.5px solid ${color.negative}33`,
            display: "grid",
            gap: space.xs,
          }}
        >
          <div style={{ fontSize: T.bodySmall.size, fontWeight: 600, color: color.negative }}>
            Write-back failed
          </div>
          <div style={{ fontSize: T.caption.size, color: color.textSecondary }}>
            {request.failureReason}
          </div>
          {rollback.conflictHash && (
            <div style={{ fontSize: T.caption.size, color: color.textMuted }}>
              Conflicting hash: <span style={{ fontFamily: "monospace" }}>{rollback.conflictHash.slice(0, 16)}…</span>
            </div>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: "flex", gap: space.sm, flexWrap: "wrap" }}>
        {request.approvalState === "requested" && (
          <>
            <button
              type="button"
              data-testid="wiki-action-approve"
              disabled={!!busy}
              onClick={() => handleAction(() => onApprove(request.id), "approve")}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: `6px ${space.md}px`,
                borderRadius: radius.sm,
                border: `0.5px solid ${color.positive}55`,
                background: busy === "approve" ? `${color.positive}22` : "transparent",
                color: color.positive,
                fontSize: T.bodySmall.size,
                cursor: busy ? "not-allowed" : "pointer",
                opacity: busy && busy !== "approve" ? 0.5 : 1,
              }}
            >
              <Check size={13} />
              {busy === "approve" ? "Approving…" : "Approve"}
            </button>
            <button
              type="button"
              data-testid="wiki-action-reject"
              disabled={!!busy}
              onClick={() => handleAction(() => onReject(request.id), "reject")}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: `6px ${space.md}px`,
                borderRadius: radius.sm,
                border: `0.5px solid ${color.negative}55`,
                background: busy === "reject" ? `${color.negative}22` : "transparent",
                color: color.negative,
                fontSize: T.bodySmall.size,
                cursor: busy ? "not-allowed" : "pointer",
                opacity: busy && busy !== "reject" ? 0.5 : 1,
              }}
            >
              <X size={13} />
              {busy === "reject" ? "Rejecting…" : "Reject"}
            </button>
            <button
              type="button"
              onClick={() => setShowPreview((p) => !p)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: `6px ${space.md}px`,
                borderRadius: radius.sm,
                border: `0.5px solid ${color.border}`,
                background: showPreview ? `${color.accent}11` : "transparent",
                color: showPreview ? color.accent : color.textSecondary,
                fontSize: T.bodySmall.size,
                cursor: "pointer",
              }}
            >
              <FileText size={13} />
              {showPreview ? "Hide preview" : "Preview"}
            </button>
          </>
        )}

        {request.approvalState === "approved" && (
          <>
            <button
              type="button"
              data-testid="wiki-action-write"
              disabled={!!busy}
              onClick={() => handleAction(() => onWrite(request.id), "write")}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: `6px ${space.md}px`,
                borderRadius: radius.sm,
                border: `0.5px solid ${color.positive}55`,
                background: busy === "write" ? `${color.positive}22` : `${color.positive}0a`,
                color: color.positive,
                fontSize: T.bodySmall.size,
                fontWeight: 600,
                cursor: busy ? "not-allowed" : "pointer",
                opacity: busy && busy !== "write" ? 0.5 : 1,
              }}
            >
              <Check size={13} />
              {busy === "write" ? "Writing…" : "Write to vault"}
            </button>
            <button
              type="button"
              data-testid="wiki-action-reject"
              disabled={!!busy}
              onClick={() => handleAction(() => onReject(request.id), "reject")}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: `6px ${space.md}px`,
                borderRadius: radius.sm,
                border: `0.5px solid ${color.negative}55`,
                background: "transparent",
                color: color.negative,
                fontSize: T.bodySmall.size,
                cursor: busy ? "not-allowed" : "pointer",
                opacity: busy ? 0.5 : 1,
              }}
            >
              <X size={13} />
              {busy === "reject" ? "Rejecting…" : "Reject"}
            </button>
            <button
              type="button"
              onClick={() => setShowPreview((p) => !p)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: `6px ${space.md}px`,
                borderRadius: radius.sm,
                border: `0.5px solid ${color.border}`,
                background: showPreview ? `${color.accent}11` : "transparent",
                color: showPreview ? color.accent : color.textSecondary,
                fontSize: T.bodySmall.size,
                cursor: "pointer",
              }}
            >
              <FileText size={13} />
              {showPreview ? "Hide preview" : "Preview"}
            </button>
          </>
        )}
      </div>

      {/* Preview panel */}
      {showPreview && (
        <WikiPreviewPanel
          slug={slug}
          request={request}
          onClose={() => setShowPreview(false)}
        />
      )}

      {/* Rollback metadata */}
      {request.approvalState === "written" && (
        <div
          data-testid="wiki-rollback-metadata"
          style={{
            padding: `${space.sm}px ${space.md}px`,
            borderRadius: radius.md,
            background: `${color.positive}08`,
            border: `0.5px solid ${color.positive}33`,
            display: "grid",
            gap: space.xs,
            fontSize: T.caption.size,
          }}
        >
          <div style={{ fontWeight: 600, color: color.positive }}>Written to vault</div>
          {rollback.strategy && (
            <div style={{ color: color.textSecondary }}>Rollback strategy: {rollback.strategy}</div>
          )}
          {rollback.writtenFileHash && (
            <div style={{ color: color.textMuted }}>
              Written hash: <span style={{ fontFamily: "monospace" }}>{rollback.writtenFileHash.slice(0, 16)}…</span>
            </div>
          )}
          {rollback.previousFileHash ? (
            <div style={{ color: color.textMuted }}>
              Previous hash: <span style={{ fontFamily: "monospace" }}>{rollback.previousFileHash.slice(0, 16)}…</span>
            </div>
          ) : (
            <div style={{ color: color.textMuted }}>No previous file — rollback will delete the created file.</div>
          )}
        </div>
      )}

      {/* Metadata grid */}
      <div style={{ display: "grid", gap: space.sm, fontSize: T.caption.size }}>
        {request.requestedBy && (
          <div style={{ display: "flex", gap: space.sm }}>
            <span style={{ color: color.textMuted, flexShrink: 0 }}>Requested by</span>
            <span style={{ color: color.textSecondary }}>{request.requestedBy}</span>
          </div>
        )}
        <div style={{ display: "flex", gap: space.sm }}>
          <span style={{ color: color.textMuted, flexShrink: 0 }}>Requested</span>
          <span style={{ color: color.textSecondary }}>{formatRelative(request.createdAt)}</span>
        </div>
        {request.approvedBy && (
          <div style={{ display: "flex", gap: space.sm }}>
            <span style={{ color: color.textMuted, flexShrink: 0 }}>Approved by</span>
            <span style={{ color: color.textSecondary }}>{request.approvedBy}</span>
          </div>
        )}
        {request.approvedAt && (
          <div style={{ display: "flex", gap: space.sm }}>
            <span style={{ color: color.textMuted, flexShrink: 0 }}>Approved</span>
            <span style={{ color: color.textSecondary }}>{formatRelative(request.approvedAt)}</span>
          </div>
        )}
        {request.writtenAt && (
          <div style={{ display: "flex", gap: space.sm }}>
            <span style={{ color: color.textMuted, flexShrink: 0 }}>Written</span>
            <span style={{ color: color.positive }}>{formatRelative(request.writtenAt)}</span>
          </div>
        )}
        {request.rejectionReason && (
          <div style={{ display: "flex", gap: space.sm }}>
            <span style={{ color: color.textMuted, flexShrink: 0 }}>Rejected because</span>
            <span style={{ color: color.textSecondary }}>{request.rejectionReason}</span>
          </div>
        )}
        <div style={{ display: "flex", gap: space.sm }}>
          <span style={{ color: color.textMuted, flexShrink: 0 }}>Source memories</span>
          <span style={{ color: color.textSecondary }}>{request.sourceMemoryIds.length}</span>
        </div>
      </div>

      {/* Source memory IDs */}
      {request.sourceMemoryIds.length > 0 && (
        <div>
          <div style={{ fontSize: T.caption.size, color: color.textMuted, marginBottom: space.xs }}>Source memory IDs</div>
          <div style={{ display: "grid", gap: 2 }}>
            {request.sourceMemoryIds.map((id) => (
              <span key={id} style={{ fontSize: T.caption.size, color: color.textSecondary, fontFamily: "monospace" }}>
                {id.slice(0, 12)}…
              </span>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}

function WikiGovernanceTab({ slug, viewer }: { slug: string; viewer: string }) {
  const [requests, setRequests] = useState<WikiWritebackRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState<WikiStateFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/orchestration/companies/${encodeURIComponent(slug)}/wiki/writeback?approvalState=all`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error(`Failed to load wiki requests: ${res.status}`);
      const data = await res.json() as { requests?: WikiWritebackRequest[] };
      setRequests(data.requests ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    if (stateFilter === "all") return requests;
    return requests.filter((r) => r.approvalState === stateFilter);
  }, [requests, stateFilter]);

  const selectedRequest = requests.find((r) => r.id === selectedId) ?? null;

  const handleApprove = useCallback(async (id: string) => {
    const res = await fetch(
      `/api/orchestration/companies/${encodeURIComponent(slug)}/wiki/writeback/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve", approvedBy: viewer }),
      },
    );
    if (!res.ok) {
      const body = await res.json().catch(() => null) as { message?: string } | null;
      throw new Error(body?.message ?? `Approve failed: ${res.status}`);
    }
    const data = await res.json() as { request: WikiWritebackRequest };
    setRequests((prev) => prev.map((r) => r.id === id ? data.request : r));
    setNotice({ tone: "success", text: "Request approved — ready to write to vault." });
  }, [slug, viewer]);

  const handleReject = useCallback(async (id: string) => {
    const res = await fetch(
      `/api/orchestration/companies/${encodeURIComponent(slug)}/wiki/writeback/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject", approvedBy: viewer }),
      },
    );
    if (!res.ok) {
      const body = await res.json().catch(() => null) as { message?: string } | null;
      throw new Error(body?.message ?? `Reject failed: ${res.status}`);
    }
    const data = await res.json() as { request: WikiWritebackRequest };
    setRequests((prev) => prev.map((r) => r.id === id ? data.request : r));
    setNotice({ tone: "info", text: "Request rejected." });
  }, [slug, viewer]);

  const handleWrite = useCallback(async (id: string) => {
    const res = await fetch(
      `/api/orchestration/companies/${encodeURIComponent(slug)}/wiki/writeback/${encodeURIComponent(id)}/submit`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actor: viewer }),
      },
    );
    if (!res.ok) {
      const body = await res.json().catch(() => null) as { message?: string } | null;
      throw new Error(body?.message ?? `Write failed: ${res.status}`);
    }
    const data = await res.json() as { request: WikiWritebackRequest; fileWritten?: boolean; filePath?: string };
    setRequests((prev) => prev.map((r) => r.id === id ? data.request : r));
    setNotice({
      tone: "success",
      text: `Written to vault${data.filePath ? `: ${data.filePath}` : ""}.`,
    });
  }, [slug, viewer]);

  const pendingCount = requests.filter((r) => r.approvalState === "requested").length;

  return (
    <div style={{ display: "grid", gap: space.xl }}>
      {/* Notice banner */}
      {notice && (
        <div
          role="status"
          data-testid="wiki-governance-notice"
          style={{
            padding: `${space.sm}px ${space.lg}px`,
            borderRadius: radius.md,
            background: notice.tone === "error" ? color.negativeSoft : notice.tone === "success" ? `${color.positive}12` : `${color.info}12`,
            border: `0.5px solid ${notice.tone === "error" ? "rgba(239,68,68,0.2)" : notice.tone === "success" ? `${color.positive}33` : `${color.info}33`}`,
            fontSize: T.bodySmall.size,
            color: notice.tone === "error" ? color.negative : notice.tone === "success" ? color.positive : color.info,
          }}
        >
          {notice.text}
        </div>
      )}

      {error && (
        <div style={{ color: color.negative, padding: space.sm, background: color.negativeSoft, borderRadius: radius.md }}>
          {error}
        </div>
      )}

      {/* Summary stats */}
      {!loading && requests.length > 0 && (
        <div style={{ display: "flex", gap: space.md, flexWrap: "wrap", fontSize: T.caption.size, color: color.textMuted }}>
          <span>{requests.length} total</span>
          {pendingCount > 0 && (
            <span style={{ color: color.info, fontWeight: 600 }}>{pendingCount} pending review</span>
          )}
          <span style={{ color: color.positive }}>{requests.filter((r) => r.approvalState === "written").length} written</span>
          <span style={{ color: color.negative }}>{requests.filter((r) => r.approvalState === "failed").length} failed</span>
        </div>
      )}

      {/* State filter strip */}
      <div
        data-testid="wiki-governance-filter-strip"
        style={{ display: "flex", gap: space.sm, flexWrap: "wrap", borderBottom: `0.5px solid ${color.border}`, paddingBottom: space.md }}
      >
        {WIKI_STATE_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            data-testid={`wiki-governance-filter-${f}`}
            onClick={() => { setStateFilter(f); }}
            style={{
              padding: `6px ${space.md}px`,
              borderRadius: radius.full,
              border: `0.5px solid ${stateFilter === f ? color.accent : color.border}`,
              background: stateFilter === f ? `${color.accent}11` : "transparent",
              color: stateFilter === f ? color.accent : color.textSecondary,
              cursor: "pointer",
              fontSize: T.caption.size,
            }}
          >
            {formatLabel(f)}
            {f !== "all" && ` (${requests.filter((r) => r.approvalState === f).length})`}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ display: "grid", gap: space.md }}>
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              style={{ height: 80, borderRadius: radius.lg, border: `0.5px solid ${color.border}`, background: color.surface, opacity: 0.5 }}
            />
          ))}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(300px, 420px)", gap: space.xl, alignItems: "start" }}>
          {/* Request list */}
          <div style={{ display: "grid", gap: space.sm }}>
            {filtered.length === 0 ? (
              <EmptyState
                icon={<BookOpen size={24} />}
                title="No write-back requests"
                description={stateFilter === "all" ? "No wiki write-back requests have been created for this company." : `No requests in '${stateFilter}' state.`}
              />
            ) : (
              filtered.map((r) => (
                <WikiRequestRow
                  key={r.id}
                  request={r}
                  selected={r.id === selectedId}
                  onClick={() => setSelectedId((prev) => prev === r.id ? null : r.id)}
                />
              ))
            )}
          </div>

          {/* Detail panel — always rendered so state survives filter changes */}
          <WikiDetailPanel
            slug={slug}
            request={selectedRequest}
            onApprove={handleApprove}
            onReject={handleReject}
            onWrite={handleWrite}
          />
        </div>
      )}
    </div>
  );
}

/* -- Retrieval Evidence Tab -- */

function qualityTone(status: RetrievalQuality["status"] | "none"): string {
  if (status === "accepted") return color.positive;
  if (status === "refused") return color.negative;
  if (status === "degraded") return color.warning;
  return color.textMuted;
}

function issueTone(severity: RetrievalQualityIssue["severity"]): string {
  if (severity === "high") return color.negative;
  if (severity === "medium") return color.warning;
  return color.info;
}

function readNumericMetadata(source: MemoryEvidenceItem["source"], keys: string[]): number | null {
  const dictionaries = [source.frontmatter, source.metadata].filter(Boolean) as Array<Record<string, unknown>>;
  for (const dictionary of dictionaries) {
    for (const key of keys) {
      const value = dictionary[key];
      if (typeof value === "number" && Number.isFinite(value)) return value;
      if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
    }
  }
  return typeof source.confidence === "number" ? source.confidence : null;
}

function confidenceSummary(item: MemoryEvidenceItem): { label: string; tone: string } {
  const confidence = readNumericMetadata(item.source, ["confidence", "quality_confidence"]);
  if (confidence === null) return { label: "Confidence not declared", tone: color.textMuted };
  if (confidence < 0.5) return { label: `Low confidence ${Math.round(confidence * 100)}%`, tone: color.negative };
  if (confidence < 0.7) return { label: `Review confidence ${Math.round(confidence * 100)}%`, tone: color.warning };
  return { label: `High confidence ${Math.round(confidence * 100)}%`, tone: color.positive };
}

function freshnessSummary(item: MemoryEvidenceItem): { label: string; tone: string } {
  const dateValue = item.source.fileMtime ?? item.source.updatedAt ?? item.source.indexedAt ?? null;
  if (!dateValue) return { label: "Freshness unknown", tone: color.textMuted };
  const parsed = Date.parse(dateValue);
  if (!Number.isFinite(parsed)) return { label: "Freshness unknown", tone: color.textMuted };
  const days = Math.max(0, Math.floor((Date.now() - parsed) / 86_400_000));
  if (days > 365) return { label: `Stale ${days}d`, tone: color.negative };
  if (days > 180) return { label: `Aging ${days}d`, tone: color.warning };
  return { label: `Fresh ${days}d`, tone: color.positive };
}

function sourceTypeLabel(source: MemoryEvidenceResult["injectionSource"] | MemoryEvidenceDiagnostics["source"]): string {
  if (source === "vault_index" || source === "memory_source_index") return "Vault index";
  if (source === "memory_registry_fallback" || source === "company_memory_records") return "Memory registry fallback";
  return "No injection";
}

function RetrievalEvidenceTab({
  slug,
  initialRunId,
}: {
  slug: string;
  initialRunId: string;
}) {
  const [runIdInput, setRunIdInput] = useState(initialRunId);
  const [activeRunId, setActiveRunId] = useState(initialRunId.trim());
  const [data, setData] = useState<MemoryEvidenceResult | null>(null);
  const [loadingEvidence, setLoadingEvidence] = useState(false);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);

  useEffect(() => {
    setRunIdInput(initialRunId);
    setActiveRunId(initialRunId.trim());
  }, [initialRunId]);

  const loadEvidence = useCallback(async () => {
    if (!activeRunId) {
      setData(null);
      return;
    }
    setLoadingEvidence(true);
    setEvidenceError(null);
    try {
      const res = await fetch(
        `/api/orchestration/companies/${encodeURIComponent(slug)}/memory/evidence?runId=${encodeURIComponent(activeRunId)}&includeDiagnostics=true`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: { message?: string }; message?: string } | null;
        throw new Error(body?.error?.message ?? body?.message ?? `Evidence request failed: ${res.status}`);
      }
      setData(await res.json() as MemoryEvidenceResult);
    } catch (err) {
      setData(null);
      setEvidenceError(err instanceof Error ? err.message : "Failed to load retrieval evidence");
    } finally {
      setLoadingEvidence(false);
    }
  }, [activeRunId, slug]);

  useEffect(() => { void loadEvidence(); }, [loadEvidence]);

  const quality = data?.quality ?? data?.diagnostics?.quality ?? null;
  const diagnosticEvidenceById = useMemo(() => {
    const map = new Map<string, NonNullable<MemoryEvidenceDiagnostics["evidence"]>[number]>();
    for (const item of data?.diagnostics?.evidence ?? []) {
      map.set(item.recordId, item);
    }
    return map;
  }, [data]);
  const refusalReasons = quality?.refusals ?? [];
  const warningReasons = quality?.warnings ?? [];
  const qualityStatus = quality?.status ?? "none";
  const tone = qualityTone(qualityStatus);

  return (
    <div data-testid="memory-evidence-view" style={{ display: "grid", gap: space.xl }}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setActiveRunId(runIdInput.trim());
        }}
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) auto",
          gap: space.sm,
          alignItems: "center",
        }}
      >
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: space.sm,
            border: `0.5px solid ${color.border}`,
            borderRadius: radius.md,
            background: color.surface,
            padding: `0 ${space.md}px`,
            minWidth: 0,
          }}
        >
          <Search size={14} style={{ color: color.textMuted, flexShrink: 0 }} />
          <input
            value={runIdInput}
            onChange={(event) => setRunIdInput(event.target.value)}
            placeholder="Execution run ID"
            style={{
              width: "100%",
              border: "none",
              outline: "none",
              background: "transparent",
              color: color.text,
              fontSize: T.bodySmall.size,
              padding: `${space.sm}px 0`,
              minWidth: 0,
            }}
          />
        </label>
        <button
          type="submit"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: `7px ${space.md}px`,
            borderRadius: radius.sm,
            border: `0.5px solid ${color.accent}`,
            background: `${color.accent}12`,
            color: color.accent,
            fontSize: T.bodySmall.size,
            cursor: "pointer",
          }}
        >
          <Search size={13} />
          Inspect
        </button>
      </form>

      {!activeRunId && (
        <EmptyState
          icon={<ShieldCheck size={24} />}
          title="Choose a run to inspect"
          description="Paste an execution run ID or open this tab with ?runId=... to review injected retrieval context."
        />
      )}

      {evidenceError && (
        <div style={{ padding: `${space.sm}px ${space.lg}px`, borderRadius: radius.md, background: color.negativeSoft, border: `0.5px solid rgba(239,68,68,0.2)`, color: color.negative, fontSize: T.bodySmall.size }}>
          {evidenceError}
        </div>
      )}

      {loadingEvidence && activeRunId && (
        <div style={{ height: 180, borderRadius: radius.lg, border: `0.5px solid ${color.border}`, background: color.surface, opacity: 0.55 }} />
      )}

      {data && !loadingEvidence && (
        <>
          <div data-testid="memory-evidence-summary" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 160px), 1fr))", gap: space.md }}>
            {[
              { label: "Retrieval Source", value: sourceTypeLabel(data.injectionSource), icon: <Layers size={14} />, tone: color.accent },
              { label: "Quality", value: qualityStatus === "none" ? "Not scored" : formatLabel(qualityStatus), icon: <ShieldCheck size={14} />, tone },
              { label: "Score", value: quality ? String(quality.score) : "N/A", icon: <Sparkles size={14} />, tone },
              { label: "Sources", value: String(data.evidence.length), icon: <FileText size={14} />, tone: data.evidence.length > 0 ? color.positive : color.textMuted },
              { label: "Warnings", value: String(warningReasons.length), icon: <AlertTriangle size={14} />, tone: warningReasons.length > 0 ? color.warning : color.positive },
              { label: "Refusals", value: String(refusalReasons.length), icon: <X size={14} />, tone: refusalReasons.length > 0 ? color.negative : color.positive },
            ].map((metric) => (
              <div key={metric.label} style={{ padding: space.lg, border: `0.5px solid ${color.border}`, borderRadius: radius.lg, background: color.surface, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: T.caption.size, color: color.textMuted }}>
                  <span style={{ color: metric.tone, display: "inline-flex" }}>{metric.icon}</span>
                  {metric.label}
                </div>
                <div style={{ marginTop: 4, fontSize: 18, fontWeight: 600, color: metric.tone, overflowWrap: "anywhere" }}>{metric.value}</div>
              </div>
            ))}
          </div>

          <div style={{ padding: space.xl, borderRadius: radius.lg, border: `0.5px solid ${color.border}`, background: color.surface, display: "grid", gap: space.md, minWidth: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: space.md, flexWrap: "wrap" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: T.caption.size, color: color.textMuted, marginBottom: 4 }}>Run</div>
                <div style={{ fontSize: T.body.size, color: color.text, fontWeight: 600, overflowWrap: "anywhere" }}>{data.run.taskKey} · {data.run.taskTitle}</div>
                <div style={{ fontSize: T.caption.size, color: color.textMuted, marginTop: 3, overflowWrap: "anywhere" }}>
                  {data.run.projectName} · {data.run.agentName}{data.run.agentRole ? ` (${data.run.agentRole})` : ""} · {data.run.status}
                </div>
              </div>
              {data.run.injectedMemorySha256 && (
                <div style={{ fontSize: T.caption.size, color: color.textMuted, fontFamily: "monospace", overflowWrap: "anywhere", maxWidth: 280 }}>
                  sha256 {data.run.injectedMemorySha256}
                </div>
              )}
            </div>
          </div>

          {(warningReasons.length > 0 || refusalReasons.length > 0) && (
            <div data-testid="memory-evidence-quality-reasons" style={{ display: "grid", gap: space.sm }}>
              {[...refusalReasons, ...warningReasons].map((issue, index) => {
                const c = issueTone(issue.severity);
                return (
                  <div key={`${issue.recordId}-${issue.type}-${index}`} style={{ padding: space.lg, borderRadius: radius.lg, border: `0.5px solid ${c}33`, background: `${c}0d`, display: "grid", gap: space.xs }}>
                    <div style={{ display: "flex", alignItems: "center", gap: space.sm, flexWrap: "wrap" }}>
                      <span data-testid={issue.action === "refusal" ? "memory-evidence-refusal" : "memory-evidence-warning"} style={{ fontSize: T.caption.size, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: c }}>
                        {issue.action === "refusal" ? "Refusal reason" : "Quality warning"}
                      </span>
                      <span style={{ fontSize: T.caption.size, color: color.textMuted }}>{formatLabel(issue.type)} · {issue.severity}</span>
                    </div>
                    <div style={{ fontSize: T.bodySmall.size, color: color.text, fontWeight: 600, overflowWrap: "anywhere" }}>{issue.title}</div>
                    <div style={{ fontSize: T.bodySmall.size, color: color.textSecondary, lineHeight: 1.5, overflowWrap: "anywhere" }}>{issue.reason}</div>
                  </div>
                );
              })}
            </div>
          )}

          <div data-testid="memory-evidence-source-list" style={{ display: "grid", gap: space.md }}>
            {data.evidence.length === 0 ? (
              <div style={{ padding: space.xl, borderRadius: radius.lg, border: `0.5px solid ${color.border}`, background: color.surface, color: color.textMuted, fontSize: T.bodySmall.size }}>
                No source snippets were injected for this run.
              </div>
            ) : data.evidence.map((item) => {
              const confidence = confidenceSummary(item);
              const freshness = freshnessSummary(item);
              const diagnostic = diagnosticEvidenceById.get(item.recordId);
              return (
                <div key={item.recordId} data-testid="memory-evidence-source-card" style={{ padding: space.xl, borderRadius: radius.lg, border: `0.5px solid ${color.border}`, background: color.surface, display: "grid", gap: space.md, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: space.md, flexWrap: "wrap" }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: space.sm, flexWrap: "wrap", marginBottom: space.xs }}>
                        <span style={{ fontSize: T.caption.size, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: color.accent, background: `${color.accent}14`, border: `0.5px solid ${color.accent}33`, borderRadius: radius.sm, padding: `2px ${space.sm}px` }}>
                          {item.layer}
                        </span>
                        <span style={{ fontSize: T.caption.size, color: color.textMuted }}>{item.source.type === "memory_source_index" ? "Vault note" : "Memory record"}</span>
                      </div>
                      <div style={{ fontSize: T.body.size, color: color.text, fontWeight: 600, overflowWrap: "anywhere" }}>{item.title}</div>
                    </div>
                    <div style={{ display: "flex", gap: space.xs, flexWrap: "wrap" }}>
                      <span data-testid="memory-evidence-confidence" style={{ fontSize: T.caption.size, color: confidence.tone, border: `0.5px solid ${confidence.tone}33`, borderRadius: radius.sm, padding: `2px ${space.sm}px` }}>
                        {confidence.label}
                      </span>
                      <span data-testid="memory-evidence-freshness" style={{ fontSize: T.caption.size, color: freshness.tone, border: `0.5px solid ${freshness.tone}33`, borderRadius: radius.sm, padding: `2px ${space.sm}px` }}>
                        {freshness.label}
                      </span>
                    </div>
                  </div>

                  <div style={{ display: "grid", gap: space.xs, fontSize: T.bodySmall.size }}>
                    <div style={{ display: "flex", gap: space.sm, minWidth: 0 }}>
                      <FileText size={14} style={{ color: color.textMuted, flexShrink: 0, marginTop: 2 }} />
                      {item.sourcePath ? (
                        <a data-testid="memory-evidence-source-link" href={`file://${item.sourcePath}`} style={{ color: color.accent, textDecoration: "none", overflowWrap: "anywhere" }}>
                          {item.sourcePath}
                        </a>
                      ) : (
                        <span style={{ color: color.textMuted }}>No source path recorded.</span>
                      )}
                    </div>
                    <div data-testid="memory-evidence-inclusion-reasons" style={{ color: color.textSecondary, lineHeight: 1.5, overflowWrap: "anywhere" }}>
                      {item.reason}
                    </div>
                  </div>

                  {diagnostic && (
                    <details data-testid="memory-evidence-envelope" style={{ borderTop: `0.5px solid ${color.border}`, paddingTop: space.sm }}>
                      <summary style={{ cursor: "pointer", color: color.textMuted, fontSize: T.caption.size }}>
                        Evidence envelope · rank {diagnostic.evidenceEnvelope.retrievalRank}
                      </summary>
                      <div style={{ marginTop: space.sm, display: "grid", gap: 4, fontSize: T.caption.size, color: color.textSecondary }}>
                        <span style={{ overflowWrap: "anywhere" }}>Envelope {diagnostic.evidenceEnvelope.envelopeId}</span>
                        <span style={{ overflowWrap: "anywhere" }}>Content {diagnostic.evidenceEnvelope.contentSha256}</span>
                        <span>Matched {diagnostic.evidenceEnvelope.matched.agentRole ?? "untyped agent"}{diagnostic.evidenceEnvelope.matched.roleTags.length > 0 ? ` via ${diagnostic.evidenceEnvelope.matched.roleTags.join(", ")}` : ""}</span>
                        <span>{diagnostic.inclusionReasons.join("; ")}</span>
                      </div>
                    </details>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/* ── Page ── */

export default function CompanyMemoryPage() {
  const params = useParams<{ slug: string }>();
  const searchParams = useSearchParams();
  const slug = params?.slug ?? "";

  const [company, setCompany] = useState<OrchestrationCompany | null>(null);
  const [activeTab, setActiveTab] = useState<MemoryTab>("cards");
  const [records, setRecords] = useState<MemoryIndexRecord[]>([]);
  const [graph, setGraph] = useState<MemoryGraph | null>(null);
  const [candidates, setCandidates] = useState<MemoryCandidate[]>([]);
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [layerFilter, setLayerFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [writebackNotice, setWritebackNotice] = useState<{
    tone: "success" | "error" | "info";
    title: string;
    detail: string;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setGraphError(null);
    try {
      const [companies, indexRes, graphRes, candidatesRes] = await Promise.all([
        listCompanies(),
        fetch(
          `/api/orchestration/companies/${encodeURIComponent(slug)}/memory/index?status=active&limit=500`,
          { cache: "no-store" },
        ),
        fetch(
          `/api/orchestration/companies/${encodeURIComponent(slug)}/memory/graph?limit=500`,
          { cache: "no-store" },
        ),
        fetch(
          `/api/orchestration/companies/${encodeURIComponent(slug)}/memory/candidates?status=pending`,
          { cache: "no-store" },
        ),
      ]);

      const normalizedSlug = slug.trim().toLowerCase();
      setCompany(
        companies.find(
          (c) => c.slug.toLowerCase() === normalizedSlug || c.code.toLowerCase() === normalizedSlug,
        ) ?? null,
      );

      if (!indexRes.ok) throw new Error("Failed to load memory cards");
      if (!candidatesRes.ok) throw new Error("Failed to load candidates");

      const indexData = await indexRes.json() as { records?: MemoryIndexRecord[] };
      const candidateData = await candidatesRes.json() as { candidates?: MemoryCandidate[] };
      setRecords(indexData.records ?? []);
      setSelectedRecordId((current) => current ?? indexData.records?.[0]?.recordId ?? null);
      setCandidates(candidateData.candidates ?? []);

      if (graphRes.ok) {
        const graphData = await graphRes.json() as MemoryGraph;
        setGraph(graphData);
      } else {
        setGraph(null);
        setGraphError(`Failed to load graph: ${graphRes.status}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load memory data");
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => { void load(); }, [load]);

  const operatorLabel = publicHumanDisplayName(company?.owner?.displayName);
  const viewer = (searchParams.get("as") ?? operatorLabel).trim();
  const normalizedViewer = viewer.toLowerCase();
  const isOperatorViewer = normalizedViewer === operatorLabel.toLowerCase();
  const companyCode = company?.code ?? slug.slice(0, 8).toUpperCase();
  const companyHref = (path = "") => buildCanonicalCompanyPath(companyCode, path);
  const initialRunId = (searchParams.get("runId") ?? searchParams.get("executionRunId") ?? "").trim();

  const handleReview = useCallback(
    async (id: string, decision: "approved" | "rejected") => {
      const res = await fetch(
        `/api/orchestration/companies/${encodeURIComponent(slug)}/memory/candidates`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, decision, reviewedBy: viewer }),
        },
      );

      if (!res.ok) {
        const body = await res.json().catch(() => null) as (Omit<CandidateReviewResponse, "error"> & {
          error?: string | { message?: string };
        }) | null;
        const responseError = body?.error;
        const message =
          typeof responseError === "string"
            ? responseError
            : responseError?.message ?? body?.writeback?.error ?? `Request failed: ${res.status}`;
        if (body?.writeback) {
          setWritebackNotice({
            tone: "error",
            title: "Memory write-back failed",
            detail: `${message}${body.writeback.filePath ? ` · ${body.writeback.filePath}` : ""}`,
          });
        }
        throw new Error(message);
      }

      const body = await res.json() as CandidateReviewResponse;
      if (body.writeback) {
        const failed = body.writeback.status === "failed" || !!body.writeback.error;
        setWritebackNotice({
          tone: failed ? "error" : "success",
          title: failed ? "Memory write-back failed" : writebackActionLabel(body.writeback.action),
          detail: failed
            ? body.writeback.error ?? "The candidate was reviewed, but the Markdown write-back failed."
            : `${body.writeback.filePath ?? "Company vault"}${body.writeback.memoryRecordId ? ` · memory ${body.writeback.memoryRecordId.slice(0, 8)}` : ""}`,
        });
      } else if (body.outcome === "specialist_approved") {
        setWritebackNotice({
          tone: "info",
          title: "Specialist review recorded",
          detail: "Candidate is now available for final operator approval.",
        });
      } else if (decision === "rejected") {
        setWritebackNotice({
          tone: "info",
          title: "Candidate rejected",
          detail: "No Markdown write-back was attempted.",
        });
      }

      setCandidates((prev) => prev.filter((c) => c.id !== id));
      if (decision === "approved") {
        void load();
      }
    },
    [load, slug, viewer],
  );

  useEffect(() => {
    if (initialRunId) setActiveTab("evidence");
  }, [initialRunId]);

  const layers = useMemo(
    () => Array.from(new Set(records.map((record) => record.layer).filter(Boolean))).sort(),
    [records],
  );
  const sources = useMemo(
    () => Array.from(new Set(records.map((record) => record.sourceId).filter(Boolean))).sort(),
    [records],
  );

  const filteredRecords = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return records.filter((record) => {
      if (layerFilter !== "all" && record.layer !== layerFilter) return false;
      if (sourceFilter !== "all" && record.sourceId !== sourceFilter) return false;
      if (!normalizedQuery) return true;
      return (
        containsText(record.title, normalizedQuery) ||
        containsText(record.contentExcerpt, normalizedQuery) ||
        containsText(record.sourcePath, normalizedQuery) ||
        record.tags.some((tag) => containsText(tag, normalizedQuery)) ||
        record.linkedIds.some((linked) => containsText(linked, normalizedQuery))
      );
    });
  }, [records, query, layerFilter, sourceFilter]);

  useEffect(() => {
    if (filteredRecords.length === 0) {
      setSelectedRecordId(null);
      return;
    }
    if (!selectedRecordId || !filteredRecords.some((record) => record.recordId === selectedRecordId)) {
      setSelectedRecordId(filteredRecords[0].recordId);
    }
  }, [filteredRecords, selectedRecordId]);

  const selectedRecord = filteredRecords.find((record) => record.recordId === selectedRecordId) ?? null;

  const viewerOptions = useMemo(() => {
    const names = new Set<string>([operatorLabel]);
    for (const candidate of candidates) {
      const target = candidate.routingTarget?.trim();
      if (target && !isLegacyHumanActor(target)) names.add(target);
    }
    return Array.from(names);
  }, [candidates, operatorLabel]);

  // Split candidates: actionable for this viewer vs. specialist-pending
  const myQueue = isOperatorViewer
    ? candidates.filter((c) => !c.routingTarget || isLegacyHumanActor(c.routingTarget))
    : candidates.filter(
        (c) => c.routingTarget?.toLowerCase() === normalizedViewer,
      );

  const specialistPending = isOperatorViewer
    ? candidates.filter(
        (c) => c.routingTarget && !isLegacyHumanActor(c.routingTarget),
      )
    : [];

  return (
    <div style={pageStyle}>
      <PageHeader
        icon={<Brain size={16} style={{ color: color.textSecondary }} />}
        title="Memory"
        description={`Browse indexed company memory${!isOperatorViewer ? ` — viewing as ${viewer}` : ""}`}
      />

      {/* Viewer switcher — for specialist validation */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: space.sm,
          marginBottom: space.xl,
          fontSize: T.caption.size,
          color: color.textMuted,
        }}
      >
        <span>Viewing as:</span>
        {viewerOptions.map((name) => (
          <Link
            key={name}
            href={`${companyHref("/memory")}${name === operatorLabel ? "" : `?as=${encodeURIComponent(name)}`}`}
            style={{
              padding: `2px ${space.sm}px`,
              borderRadius: radius.sm,
              border: `0.5px solid ${viewer === name ? color.accent : color.border}`,
              color: viewer === name ? color.accent : color.textMuted,
              textDecoration: "none",
              fontSize: T.caption.size,
              background: viewer === name ? `${color.accent}18` : "transparent",
            }}
          >
            {name}
          </Link>
        ))}
      </div>

      {error && (
        <div
          style={{
            marginBottom: space.md,
            padding: `${space.sm}px ${space.lg}px`,
            borderRadius: radius.md,
            background: color.negativeSoft,
            border: `0.5px solid rgba(239,68,68,0.2)`,
            fontSize: T.bodySmall.size,
            color: color.negative,
          }}
        >
          {error}
        </div>
      )}

      {writebackNotice && (
        <div
          style={{
            marginBottom: space.md,
            padding: `${space.sm}px ${space.lg}px`,
            borderRadius: radius.md,
            background:
              writebackNotice.tone === "error"
                ? color.negativeSoft
                : writebackNotice.tone === "success"
                  ? `${color.positive}12`
                  : `${color.info}12`,
            border: `0.5px solid ${
              writebackNotice.tone === "error"
                ? "rgba(239,68,68,0.2)"
                : writebackNotice.tone === "success"
                  ? `${color.positive}33`
                  : `${color.info}33`
            }`,
            display: "grid",
            gap: 4,
          }}
        >
          <div
            style={{
              fontSize: T.bodySmall.size,
              color:
                writebackNotice.tone === "error"
                  ? color.negative
                  : writebackNotice.tone === "success"
                    ? color.positive
                    : color.info,
              fontWeight: 600,
            }}
          >
            {writebackNotice.title}
          </div>
          <div style={{ fontSize: T.caption.size, color: color.textSecondary, wordBreak: "break-word" }}>
            {writebackNotice.detail}
          </div>
        </div>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: space.sm,
          marginBottom: space.xl,
          flexWrap: "wrap",
        }}
      >
        <TabButton active={activeTab === "cards"} onClick={() => setActiveTab("cards")}>
          <FileText size={14} />
          Cards
        </TabButton>
        <TabButton active={activeTab === "graph"} onClick={() => setActiveTab("graph")}>
          <GitBranch size={14} />
          Graph
        </TabButton>
        <TabButton active={activeTab === "candidates"} onClick={() => setActiveTab("candidates")}>
          <Brain size={14} />
          Pending Candidates
          {!loading && myQueue.length > 0 ? ` (${myQueue.length})` : ""}
        </TabButton>
        <TabButton active={activeTab === "quality"} onClick={() => setActiveTab("quality")}>
          <Layers size={14} />
          Quality
        </TabButton>
        <TabButton active={activeTab === "wiki"} onClick={() => setActiveTab("wiki")}>
          <BookOpen size={14} />
          Wiki
        </TabButton>
        <TabButton active={activeTab === "evidence"} onClick={() => setActiveTab("evidence")}>
          <ShieldCheck size={14} />
          Evidence
        </TabButton>
      </div>

      {activeTab === "cards" && (
        <Section title="Memory Cards" card={false} trailing={!loading ? `${filteredRecords.length} records` : undefined}>
          <div style={{ display: "grid", gap: space.lg }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(220px, 1fr) auto auto",
                gap: space.sm,
                alignItems: "center",
              }}
            >
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: space.sm,
                  border: `0.5px solid ${color.border}`,
                  borderRadius: radius.md,
                  background: color.surface,
                  padding: `0 ${space.md}px`,
                  minWidth: 0,
                }}
              >
                <Search size={14} style={{ color: color.textMuted, flexShrink: 0 }} />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search title, excerpt, path, tags, links"
                  style={{
                    width: "100%",
                    border: "none",
                    outline: "none",
                    background: "transparent",
                    color: color.text,
                    fontSize: T.bodySmall.size,
                    padding: `${space.sm}px 0`,
                    minWidth: 0,
                  }}
                />
              </label>
              <select
                value={layerFilter}
                onChange={(event) => setLayerFilter(event.target.value)}
                style={{
                  border: `0.5px solid ${color.border}`,
                  borderRadius: radius.md,
                  background: color.surface,
                  color: color.textSecondary,
                  fontSize: T.bodySmall.size,
                  padding: `${space.sm}px ${space.md}px`,
                }}
              >
                <option value="all">All layers</option>
                {layers.map((layer) => (
                  <option key={layer} value={layer}>{formatLabel(layer)}</option>
                ))}
              </select>
              <select
                value={sourceFilter}
                onChange={(event) => setSourceFilter(event.target.value)}
                style={{
                  border: `0.5px solid ${color.border}`,
                  borderRadius: radius.md,
                  background: color.surface,
                  color: color.textSecondary,
                  fontSize: T.bodySmall.size,
                  padding: `${space.sm}px ${space.md}px`,
                }}
              >
                <option value="all">All sources</option>
                {sources.map((source) => (
                  <option key={source} value={source}>{source}</option>
                ))}
              </select>
            </div>

            <div style={{ display: "flex", gap: space.xs, flexWrap: "wrap" }}>
              <button type="button" onClick={() => setLayerFilter("all")} style={chipStyle(layerFilter === "all")}>
                All layers
              </button>
              {layers.map((layer) => (
                <button key={layer} type="button" onClick={() => setLayerFilter(layer)} style={chipStyle(layerFilter === layer)}>
                  <Layers size={11} style={{ verticalAlign: "-1px", marginRight: 4 }} />
                  {formatLabel(layer)}
                </button>
              ))}
            </div>

            {loading ? (
              <div style={{ display: "grid", gap: space.md }}>
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    style={{
                      height: 120,
                      borderRadius: radius.lg,
                      border: `0.5px solid ${color.border}`,
                      background: color.surface,
                      opacity: 0.5,
                    }}
                  />
                ))}
              </div>
            ) : filteredRecords.length === 0 ? (
              <EmptyState
                icon={<FileText size={24} />}
                title="No memory cards"
                description="No indexed memory records match the current filters."
              />
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(280px, 360px)", gap: space.xl, alignItems: "start" }}>
                <div style={{ display: "grid", gap: space.md }}>
                  {filteredRecords.map((record) => (
                    <MemoryRecordCard
                      key={record.recordId}
                      record={record}
                      selected={record.recordId === selectedRecordId}
                      onSelect={() => setSelectedRecordId(record.recordId)}
                    />
                  ))}
                </div>
                <MemoryDetailPanel record={selectedRecord} />
              </div>
            )}
          </div>
        </Section>
      )}

      {activeTab === "graph" && (
        <Section
          title="Memory Graph"
          card={false}
          trailing={graph ? `${graph.nodes.length} nodes / ${graph.edges.length} edges` : undefined}
        >
          {graphError && (
            <div
              style={{
                marginBottom: space.md,
                padding: `${space.sm}px ${space.lg}px`,
                borderRadius: radius.md,
                background: color.negativeSoft,
                border: `0.5px solid rgba(239,68,68,0.2)`,
                fontSize: T.bodySmall.size,
                color: color.negative,
              }}
            >
              {graphError}
            </div>
          )}
          {loading ? (
            <div
              style={{
                height: 240,
                borderRadius: radius.lg,
                border: `0.5px solid ${color.border}`,
                background: color.surface,
                opacity: 0.5,
              }}
            />
          ) : (
            <GraphList graph={graph} />
          )}
        </Section>
      )}

      {activeTab === "candidates" && (
        <Section
          title="Pending Candidates"
          card={false}
          trailing={
            !loading && myQueue.length > 0
              ? `${myQueue.length} awaiting review`
              : undefined
          }
        >
          {loading ? (
            <div style={{ display: "grid", gap: space.md }}>
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  style={{
                    height: 120,
                    borderRadius: radius.lg,
                    border: `0.5px solid ${color.border}`,
                    background: color.surface,
                    opacity: 0.5,
                  }}
                />
              ))}
            </div>
          ) : myQueue.length === 0 ? (
            <EmptyState
              icon={<Brain size={24} />}
              title="No pending candidates"
              description={
                !isOperatorViewer
                  ? `No memory candidates routed to ${viewer}.`
                  : "All memory candidates have been reviewed or none have been proposed yet."
              }
            />
          ) : (
            <div style={{ display: "grid", gap: space.md }}>
              {myQueue.map((candidate) => (
                <CandidateCard
                  key={candidate.id}
                  candidate={candidate}
                  viewer={viewer}
                  operatorLabel={operatorLabel}
                  companyCode={companyCode}
                  onReview={handleReview}
                />
              ))}
            </div>
          )}
        </Section>
      )}

      {activeTab === "candidates" && specialistPending.length > 0 && (
        <Section
          title="Pending Specialist Review"
          card={false}
          trailing={`${specialistPending.length} pending`}
        >
          <div style={{ display: "grid", gap: space.md }}>
            {specialistPending.map((candidate) => (
              <CandidateCard
                key={candidate.id}
                candidate={candidate}
                viewer={viewer}
                operatorLabel={operatorLabel}
                companyCode={companyCode}
                onReview={handleReview}
              />
            ))}
          </div>
        </Section>
      )}

      {activeTab === "quality" && (
        <Section title="Quality Dashboard" card={false}>
          <QualityTab slug={slug} viewer={viewer} />
        </Section>
      )}

      {activeTab === "wiki" && (
        <Section title="Wiki Governance" card={false}>
          <WikiGovernanceTab slug={slug} viewer={viewer} />
        </Section>
      )}

      {activeTab === "evidence" && (
        <Section title="Retrieval Evidence" card={false}>
          <RetrievalEvidenceTab slug={slug} initialRunId={initialRunId} />
        </Section>
      )}
    </div>
  );
}
