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
import { PageHeader } from "@/lib/ui/primitives";
import { P, color, font, radius, space } from "@/lib/ui/tokens";

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
  status: string;
  startedAt: string | null;
  completedAt: string | null;
};

type WorkspaceData = {
  company: { workspaceRoot: string | null; workspaceRootExists: boolean; source: "persisted" };
  projectDirectory: { path: string | null; exists: boolean; source: "convention"; verified: boolean };
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
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const projects = await listProjects({ company: slug });
        if (cancelled) return;
        const proj = projects.find((p) => p.slug === projectSlug || p.id === projectSlug) ?? null;
        setProject(proj);

        if (proj) {
          const res = await fetch(
            `/api/orchestration/projects/${encodeURIComponent(proj.id)}/workspaces`
          );
          if (res.ok) {
            const json = await res.json();
            if (!cancelled) setData(json);
          }
        }
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [slug, projectSlug]);

  if (loading) return <div style={{ padding: 32, color: P.muted, fontSize: 13 }}>Loading...</div>;
  if (!project) return <div style={{ padding: 32, color: P.error, fontSize: 13 }}>Project not found.</div>;
  if (error) return <div style={{ padding: 32, color: P.error, fontSize: 13 }}>Error: {error}</div>;

  return (
    <div style={{ minHeight: "100%", padding: `${space.md}px ${space.xl}px`, color: P.text, fontFamily: font.body }}>
      <PageHeader
        icon={<span style={{ display: "inline-block", width: 14, height: 14, borderRadius: radius.full, background: project.color ?? P.accent }} />}
        title={project.name}
      />

      <div style={{ marginTop: space.xs, marginBottom: space.md }}>
        <ProjectTabBar slug={slug} projectSlug={projectSlug} active="workspaces" />
      </div>

      <div style={{ maxWidth: 800 }}>

        {/* Company Workspace Root */}
        {data && (
          <SectionBlock title="Company Workspace Root">
            {data.company.workspaceRoot ? (
              <>
                <PropRow label="Root path" divider>
                  <code style={{ fontSize: 12, color: P.textSec, fontFamily: font.mono }}>
                    {data.company.workspaceRoot}
                  </code>
                </PropRow>
                <PropRow label="On disk" divider>
                  <StatusBadge ok={data.company.workspaceRootExists} />
                </PropRow>
                <PropRow label="Source">
                  <SourceBadge source="persisted" />
                </PropRow>
              </>
            ) : (
              <p style={{ margin: 0, fontSize: 13, color: P.muted, fontStyle: "italic" }}>
                No workspace root configured for this company.
              </p>
            )}
          </SectionBlock>
        )}

        {/* Project Directory */}
        {data && (
          <SectionBlock title="Project Directory">
            {data.projectDirectory.path ? (
              <>
                <PropRow label="Path" divider>
                  <code style={{ fontSize: 12, color: P.textSec, fontFamily: font.mono }}>
                    {data.projectDirectory.path}
                  </code>
                </PropRow>
                <PropRow label="On disk" divider>
                  <StatusBadge ok={data.projectDirectory.verified} />
                </PropRow>
                <PropRow label="Source">
                  <SourceBadge source="convention" />
                </PropRow>
              </>
            ) : (
              <p style={{ margin: 0, fontSize: 13, color: P.muted, fontStyle: "italic" }}>
                No project directory path could be determined.
              </p>
            )}
          </SectionBlock>
        )}

        {/* Agent Workspaces */}
        {data && (
          <SectionBlock title="Agent Workspaces">
            {data.agentWorkspaces.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                {data.agentWorkspaces.map((aw) => (
                  <Link
                    key={aw.agentId}
                    href={buildCompanyPath(
                      slug,
                      `/projects/${encodeURIComponent(projectSlug)}/workspaces/${encodeURIComponent(aw.agentSlug)}`
                    )}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "10px 0",
                      borderBottom: `0.5px solid ${P.cardBorder}`,
                      textDecoration: "none",
                      color: P.text,
                      transition: "background 120ms",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 500, color: P.text }}>{aw.agentName}</span>
                      <span style={{ fontSize: 11, color: P.muted }}>{aw.agentRole || aw.agentSlug}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <StatusBadge ok={aw.exists} compact />
                      <ExternalLink size={11} style={{ color: P.muted }} />
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <p style={{ margin: 0, fontSize: 13, color: P.muted, fontStyle: "italic", padding: "6px 0" }}>
                No agents are assigned to this project.
              </p>
            )}
          </SectionBlock>
        )}

        {/* Recent Execution Context */}
        {data && data.recentExecutionContext.length > 0 && (
          <SectionBlock title="Recent Execution Context">
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 80px 80px 90px",
                  gap: 8,
                  padding: "6px 0",
                  borderBottom: `0.5px solid ${P.cardBorder}`,
                }}
              >
                <span style={{ fontSize: 11, fontWeight: 600, color: P.muted, textTransform: "uppercase", letterSpacing: "0.04em" }}>Agent</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: P.muted, textTransform: "uppercase", letterSpacing: "0.04em" }}>Provider</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: P.muted, textTransform: "uppercase", letterSpacing: "0.04em" }}>Status</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: P.muted, textTransform: "uppercase", letterSpacing: "0.04em" }}>When</span>
              </div>
              {data.recentExecutionContext.map((run, i) => (
                <div
                  key={i}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 80px 80px 90px",
                    gap: 8,
                    padding: "8px 0",
                    borderBottom: i < data.recentExecutionContext.length - 1 ? `0.5px solid ${P.cardBorder}` : undefined,
                  }}
                >
                  <span style={{ fontSize: 13, color: P.text }}>{run.agentName || "\u2014"}</span>
                  <span style={{ fontSize: 12, color: P.textSec }}>{run.provider}</span>
                  <RunStatusBadge status={run.status} />
                  <span style={{ fontSize: 12, color: P.muted }}>
                    {run.startedAt ? formatRelative(run.startedAt) : "\u2014"}
                  </span>
                </div>
              ))}
            </div>
          </SectionBlock>
        )}

        {/* Data provenance — subtle inline note */}
        <p style={{ marginTop: space.xl, fontSize: 12, color: P.muted, lineHeight: 1.6 }}>
          The company workspace root is persisted in the orchestration database. Project and agent
          workspace paths are convention-derived and checked against the filesystem.
        </p>
      </div>
    </div>
  );
}

/* ─── Helpers ─── */

function SectionBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: space.xl }}>
      <h3 style={{
        margin: `0 0 ${space.sm}px`,
        fontSize: 13,
        fontWeight: 600,
        color: P.textSec,
      }}>
        {title}
      </h3>
      {children}
    </div>
  );
}

function PropRow({ label, children, divider }: { label: string; children: React.ReactNode; divider?: boolean }) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "10px 0",
      borderBottom: divider ? `0.5px solid ${P.cardBorder}` : "none",
    }}>
      <span style={{ width: 80, fontSize: 12, color: P.muted, flexShrink: 0 }}>{label}</span>
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
        borderRadius: 4, color: color.positive, background: color.positiveSoft,
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
      borderRadius: 4, color: color.negative, background: color.negativeSoft,
    }}>
      <XCircle size={11} />
      {!compact && "Not found"}
    </span>
  );
}

function SourceBadge({ source }: { source: string }) {
  const styles: Record<string, { color: string; bg: string; label: string }> = {
    persisted: { color: color.positive, bg: color.positiveSoft, label: "Persisted" },
    convention: { color: color.accent, bg: color.accentSoft, label: "Convention" },
  };
  const s = styles[source] ?? { color: P.muted, bg: "rgba(87,83,78,0.12)", label: source };
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
    completed: { color: color.positive, bg: color.positiveSoft },
    running: { color: color.info, bg: color.infoSoft },
    failed: { color: color.negative, bg: color.negativeSoft },
    cancelled: { color: P.muted, bg: "rgba(87,83,78,0.12)" },
    pending: { color: color.accent, bg: color.accentSoft },
  };
  const st = s[status] ?? { color: P.textSec, bg: "rgba(168,162,158,0.12)" };
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
