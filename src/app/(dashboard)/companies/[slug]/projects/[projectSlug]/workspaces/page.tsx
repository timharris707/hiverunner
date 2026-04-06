"use client";

import { use, useEffect, useState } from "react";
import {
  FolderOpen,
  HardDrive,
  CheckCircle2,
  XCircle,
  Clock,
  Bot,
  ExternalLink,
  AlertTriangle,
} from "lucide-react";
import { listProjects } from "@/lib/orchestration/client";
import type { OrchestrationProject } from "@/lib/orchestration/types";
import { ProjectTabBar } from "../ProjectTabBar";
import Link from "next/link";
import { buildCompanyPath } from "@/lib/orchestration/route-paths";

const C = {
  bg: "#0c0a09",
  card: "rgba(28,25,23,0.6)",
  cardBorder: "rgba(120,113,108,0.18)",
  text: "#f5f5f4",
  textSec: "#a8a29e",
  muted: "#57534e",
  divider: "rgba(120,113,108,0.15)",
  accent: "#d97706",
  green: "#22c55e",
  red: "#ef4444",
};

type AgentWorkspace = {
  agentId: string;
  agentName: string;
  agentSlug: string;
  agentRole: string;
  agentStatus: string;
  workspacePath: string;
  exists: boolean;
  hasIdentity: boolean;
  source: "convention";
  verified: boolean;
};

type RunContext = {
  agentId: string | null;
  agentName: string | null;
  provider: string;
  sessionId: string | null;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
};

type WorkspacesData = {
  project: { id: string; name: string; slug: string };
  company: {
    id: string | null;
    slug: string | null;
    name: string | null;
    workspaceRoot: string | null;
    workspaceRootExists: boolean;
    source: "persisted";
  };
  projectDirectory: {
    path: string | null;
    exists: boolean;
    source: "convention";
    verified: boolean;
  };
  agentWorkspaces: AgentWorkspace[];
  recentExecutionContext: RunContext[];
};

export default function ProjectWorkspacesPage({
  params,
}: {
  params: Promise<{ slug: string; projectSlug: string }>;
}) {
  const { slug, projectSlug } = use(params);
  const [project, setProject] = useState<OrchestrationProject | null>(null);
  const [data, setData] = useState<WorkspacesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const projects = await listProjects({ company: slug });
        if (cancelled) return;
        const p = projects.find((p) => p.slug === projectSlug || p.id === projectSlug) ?? null;
        setProject(p);

        if (p) {
          const res = await fetch(
            `/api/orchestration/projects/${encodeURIComponent(p.id)}/workspaces`
          );
          if (!res.ok) throw new Error("Failed to load workspace data");
          const json = await res.json();
          if (!cancelled) setData(json);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Unknown error");
      }
      if (!cancelled) setLoading(false);
    };
    void load();
    return () => { cancelled = true; };
  }, [slug, projectSlug]);

  if (loading) return <div style={{ padding: 32, color: C.muted, fontSize: 13 }}>Loading...</div>;
  if (!project) return <div style={{ padding: 32, color: "#fca5a5", fontSize: 13 }}>Project not found.</div>;
  if (error) return <div style={{ padding: 32, color: "#fca5a5", fontSize: 13 }}>Error: {error}</div>;

  return (
    <div>
      {/* project header + tabs */}
      <div className="px-5 pt-5">
        <div className="flex items-center gap-3">
          <span
            className="inline-block h-4 w-4 shrink-0 rounded-md"
            style={{ backgroundColor: project.color ?? C.accent }}
          />
          <h1 className="text-lg font-semibold text-stone-100">{project.name}</h1>
        </div>
        <div className="mt-3">
          <ProjectTabBar slug={slug} projectSlug={projectSlug} active="workspaces" />
        </div>
      </div>

      <div style={{ padding: "20px 24px", maxWidth: 800 }}>
        <h2 style={{ margin: "0 0 20px", fontSize: 18, fontWeight: 600, color: C.text }}>
          Workspaces
        </h2>

        {/* Company Workspace Root */}
        {data && (
          <Section title="Company Workspace Root" icon={<HardDrive size={14} />}>
            {data.company.workspaceRoot ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <PropRow label="Root path">
                  <code style={{ fontSize: 12, color: C.textSec, fontFamily: "monospace" }}>
                    {data.company.workspaceRoot}
                  </code>
                </PropRow>
                <PropRow label="On disk">
                  <StatusBadge ok={data.company.workspaceRootExists} />
                </PropRow>
                <PropRow label="Source">
                  <SourceBadge source="persisted" />
                </PropRow>
              </div>
            ) : (
              <p style={{ margin: 0, fontSize: 13, color: C.muted, fontStyle: "italic" }}>
                No workspace root configured for this company.
              </p>
            )}
          </Section>
        )}

        {/* Project Directory */}
        {data && (
          <Section title="Project Directory" icon={<FolderOpen size={14} />}>
            {data.projectDirectory.path ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <PropRow label="Path">
                  <code style={{ fontSize: 12, color: C.textSec, fontFamily: "monospace" }}>
                    {data.projectDirectory.path}
                  </code>
                </PropRow>
                <PropRow label="On disk">
                  <StatusBadge ok={data.projectDirectory.verified} />
                </PropRow>
                <PropRow label="Source">
                  <SourceBadge source="convention" />
                </PropRow>
              </div>
            ) : (
              <p style={{ margin: 0, fontSize: 13, color: C.muted, fontStyle: "italic" }}>
                No project directory path could be determined.
              </p>
            )}
          </Section>
        )}

        {/* Agent Workspaces */}
        {data && (
          <Section title="Agent Workspaces" icon={<Bot size={14} />}>
            {data.agentWorkspaces.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {data.agentWorkspaces.map((aw) => (
                  <Link
                    key={aw.agentId}
                    href={buildCompanyPath(
                      slug,
                      `/projects/${encodeURIComponent(projectSlug)}/workspaces/${encodeURIComponent(aw.agentSlug)}`
                    )}
                    className="no-underline"
                  >
                    <div
                      style={{
                        padding: "12px 16px",
                        borderRadius: 8,
                        border: `1px solid ${C.cardBorder}`,
                        background: "rgba(41,37,36,0.4)",
                        cursor: "pointer",
                        transition: "border-color 0.15s",
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLElement).style.borderColor = "rgba(120,113,108,0.35)";
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLElement).style.borderColor = C.cardBorder;
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <Bot size={14} style={{ color: C.textSec }} />
                          <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>
                            {aw.agentName}
                          </span>
                          <span style={{
                            fontSize: 11, color: C.muted, padding: "1px 6px",
                            borderRadius: 4, background: "rgba(120,113,108,0.1)",
                          }}>
                            {aw.agentRole || aw.agentSlug}
                          </span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <StatusBadge ok={aw.exists} compact />
                          <ExternalLink size={12} style={{ color: C.muted }} />
                        </div>
                      </div>
                      <div style={{ marginTop: 6 }}>
                        <code style={{ fontSize: 11, color: C.muted, fontFamily: "monospace" }}>
                          {aw.workspacePath}
                        </code>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <p style={{ margin: 0, fontSize: 13, color: C.muted, fontStyle: "italic" }}>
                No agents are assigned to this project.
              </p>
            )}
          </Section>
        )}

        {/* Recent Execution Context */}
        {data && (
          <Section title="Recent Execution Context" icon={<Clock size={14} />}>
            {data.recentExecutionContext.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 80px 80px 90px",
                    gap: 8,
                    padding: "6px 0",
                    borderBottom: `1px solid ${C.divider}`,
                  }}
                >
                  <span style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: "uppercase", letterSpacing: "0.04em" }}>Agent</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: "uppercase", letterSpacing: "0.04em" }}>Provider</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: "uppercase", letterSpacing: "0.04em" }}>Status</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: "uppercase", letterSpacing: "0.04em" }}>When</span>
                </div>
                {data.recentExecutionContext.map((run, i) => (
                  <div
                    key={i}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 80px 80px 90px",
                      gap: 8,
                      padding: "8px 0",
                      borderBottom: i < data.recentExecutionContext.length - 1 ? `1px solid ${C.divider}` : undefined,
                    }}
                  >
                    <span style={{ fontSize: 13, color: C.text }}>{run.agentName || "—"}</span>
                    <span style={{ fontSize: 12, color: C.textSec }}>{run.provider}</span>
                    <RunStatusBadge status={run.status} />
                    <span style={{ fontSize: 12, color: C.muted }}>
                      {run.startedAt ? formatRelative(run.startedAt) : "—"}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ margin: 0, fontSize: 13, color: C.muted, fontStyle: "italic" }}>
                No execution runs recorded for this project.
              </p>
            )}
          </Section>
        )}

        {/* Data provenance footer */}
        <div style={{
          marginTop: 16, padding: "12px 16px",
          borderRadius: 8,
          background: "rgba(217,119,6,0.06)",
          border: "1px solid rgba(217,119,6,0.15)",
          display: "flex", alignItems: "flex-start", gap: 8,
        }}>
          <AlertTriangle size={13} style={{ color: C.accent, marginTop: 2, flexShrink: 0 }} />
          <div style={{ fontSize: 12, color: C.textSec, lineHeight: 1.5 }}>
            <strong style={{ color: C.textSec }}>Data provenance:</strong> The company workspace root is persisted
            in the orchestration database. Project and agent workspace paths are <em>convention-derived</em> (not
            persisted) &mdash; there is no workspace path column on projects or agents. Paths follow the
            convention <code style={{ fontFamily: "monospace", fontSize: 11 }}>{'{'}<em>root</em>{'}'}/projects/{'{'}<em>slug</em>{'}'}</code> and <code style={{ fontFamily: "monospace", fontSize: 11 }}>~/.openclaw/workspace-{'{'}<em>agent-slug</em>{'}'}</code>,
            then are checked against the filesystem. Paths marked &ldquo;not found&rdquo; may not exist yet or may use
            a non-standard location not discoverable by convention.
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Helpers ─── */

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{
      marginBottom: 20, padding: "16px 20px", borderRadius: 10,
      border: `1px solid ${C.cardBorder}`,
      background: C.card,
    }}>
      <h3 style={{
        margin: "0 0 14px", fontSize: 14, fontWeight: 600, color: C.text,
        display: "flex", alignItems: "center", gap: 8,
      }}>
        {icon}
        {title}
      </h3>
      {children}
    </div>
  );
}

function PropRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <span style={{ width: 100, fontSize: 12, color: C.muted, flexShrink: 0 }}>{label}</span>
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

function StatusBadge({ ok, compact }: { ok: boolean; compact?: boolean }) {
  if (ok) {
    return (
      <span style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        fontSize: 11, fontWeight: 500, padding: compact ? "1px 5px" : "2px 8px",
        borderRadius: 4, color: C.green, background: "rgba(34,197,94,0.12)",
      }}>
        <CheckCircle2 size={11} />
        {!compact && "Exists on disk"}
      </span>
    );
  }
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      fontSize: 11, fontWeight: 500, padding: compact ? "1px 5px" : "2px 8px",
      borderRadius: 4, color: C.red, background: "rgba(239,68,68,0.12)",
    }}>
      <XCircle size={11} />
      {!compact && "Not found"}
    </span>
  );
}

function SourceBadge({ source }: { source: string }) {
  const styles: Record<string, { color: string; bg: string; label: string }> = {
    persisted: { color: C.green, bg: "rgba(34,197,94,0.12)", label: "Persisted" },
    convention: { color: C.accent, bg: "rgba(217,119,6,0.12)", label: "Convention" },
  };
  const s = styles[source] ?? { color: C.muted, bg: "rgba(87,83,78,0.12)", label: source };
  return (
    <span style={{
      fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 4,
      color: s.color, background: s.bg,
    }}>
      {s.label}
    </span>
  );
}

function RunStatusBadge({ status }: { status: string }) {
  const s: Record<string, { color: string; bg: string }> = {
    completed: { color: C.green, bg: "rgba(34,197,94,0.12)" },
    running: { color: "#3b82f6", bg: "rgba(59,130,246,0.12)" },
    failed: { color: C.red, bg: "rgba(239,68,68,0.12)" },
    cancelled: { color: C.muted, bg: "rgba(87,83,78,0.12)" },
    pending: { color: C.accent, bg: "rgba(217,119,6,0.12)" },
  };
  const st = s[status] ?? { color: C.textSec, bg: "rgba(168,162,158,0.12)" };
  return (
    <span style={{
      fontSize: 11, fontWeight: 500, padding: "1px 6px", borderRadius: 4,
      color: st.color, background: st.bg,
    }}>
      {status}
    </span>
  );
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
