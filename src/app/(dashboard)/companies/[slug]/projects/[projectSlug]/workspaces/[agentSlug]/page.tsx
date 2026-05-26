"use client";

import { use, useEffect, useState } from "react";
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  Clock,
  File,
  Folder,
  GitBranch,
  HardDrive,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import Link from "next/link";
import { listProjects } from "@/lib/orchestration/client";
import type { OrchestrationProject } from "@/lib/orchestration/types";
import { ProjectTabBar } from "../../ProjectTabBar";
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

type FileEntry = {
  name: string;
  type: "file" | "directory";
  size?: number;
};

type RunEntry = {
  id: string;
  taskId: string | null;
  taskKey: string | null;
  taskTitle: string | null;
  provider: string;
  sessionId: string | null;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  tokenUsage: Record<string, unknown>;
};

type WorkspaceDetailData = {
  project: { id: string; name: string; slug: string };
  agent: {
    id: string;
    name: string;
    slug: string;
    role: string;
    status: string;
    provider: string;
    createdAt: string;
  };
  workspace: {
    path: string;
    exists: boolean;
    files: FileEntry[];
    identity: string | null;
    git: { branch?: string; hasRepo: boolean };
    source: "convention" | "persisted";
    verified: boolean;
  };
  recentRuns: RunEntry[];
};

export default function WorkspaceDetailPage({
  params,
}: {
  params: Promise<{ slug: string; projectSlug: string; agentSlug: string }>;
}) {
  const { slug, projectSlug, agentSlug } = use(params);
  const [project, setProject] = useState<OrchestrationProject | null>(null);
  const [data, setData] = useState<WorkspaceDetailData | null>(null);
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
            `/api/orchestration/projects/${encodeURIComponent(p.id)}/workspaces/${encodeURIComponent(agentSlug)}`
          );
          if (!res.ok) throw new Error("Failed to load workspace detail");
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
  }, [slug, projectSlug, agentSlug]);

  if (loading) return <div style={{ padding: 32, color: C.muted, fontSize: 13 }}>Loading...</div>;
  if (!project) return <div style={{ padding: 32, color: "#fca5a5", fontSize: 13 }}>Project not found.</div>;
  if (error) return <div style={{ padding: 32, color: "#fca5a5", fontSize: 13 }}>Error: {error}</div>;
  if (!data) return <div style={{ padding: 32, color: C.muted, fontSize: 13 }}>No workspace data.</div>;

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
        {/* Back link */}
        <Link
          href={buildCompanyPath(slug, `/projects/${encodeURIComponent(projectSlug)}/workspaces`)}
          className="no-underline"
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            fontSize: 13, color: C.textSec, marginBottom: 16,
          }}
        >
          <ArrowLeft size={14} />
          All workspaces
        </Link>

        {/* Agent header */}
        <div style={{
          display: "flex", alignItems: "center", gap: 12, marginBottom: 20,
        }}>
          <Bot size={20} style={{ color: C.accent }} />
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: C.text }}>
              {data.agent.name}
            </h2>
            <span style={{ fontSize: 13, color: C.textSec }}>
              {data.agent.role || data.agent.slug} &middot; {data.agent.provider}
            </span>
          </div>
          <AgentStatusBadge status={data.agent.status} />
        </div>

        {/* Workspace Directory */}
        <Section title="Workspace Directory" icon={<HardDrive size={14} />}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <PropRow label="Path">
              <code style={{ fontSize: 12, color: C.textSec, fontFamily: "monospace" }}>
                {data.workspace.path}
              </code>
            </PropRow>
            <PropRow label="On disk">
              <StatusBadge ok={data.workspace.exists} />
            </PropRow>
            <PropRow label="Source">
              <span style={{
                fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 4,
                color: C.accent, background: "rgba(217,119,6,0.12)",
              }}>
                Convention
              </span>
            </PropRow>
            {data.workspace.git.hasRepo && (
              <PropRow label="Git">
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  fontSize: 12, color: C.textSec,
                }}>
                  <GitBranch size={12} />
                  {data.workspace.git.branch || "detached HEAD"}
                </span>
              </PropRow>
            )}
          </div>
        </Section>

        {/* Files */}
        {data.workspace.exists && data.workspace.files.length > 0 && (
          <Section title="Workspace Contents" icon={<Folder size={14} />}>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {data.workspace.files.map((f) => (
                <div
                  key={f.name}
                  style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "5px 8px", borderRadius: 4,
                    fontSize: 13,
                  }}
                >
                  {f.type === "directory" ? (
                    <Folder size={13} style={{ color: C.accent, flexShrink: 0 }} />
                  ) : (
                    <File size={13} style={{ color: C.muted, flexShrink: 0 }} />
                  )}
                  <span style={{ color: f.type === "directory" ? C.text : C.textSec, fontFamily: "monospace", fontSize: 12 }}>
                    {f.name}
                  </span>
                  {f.size != null && (
                    <span style={{ fontSize: 11, color: C.muted, marginLeft: "auto" }}>
                      {formatBytes(f.size)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Identity */}
        {data.workspace.identity && (
          <Section title="Identity" icon={<Bot size={14} />}>
            <pre style={{
              margin: 0, padding: 12, borderRadius: 6,
              background: "rgba(41,37,36,0.5)",
              fontSize: 12, color: C.textSec, fontFamily: "monospace",
              whiteSpace: "pre-wrap", wordBreak: "break-word",
              maxHeight: 200, overflow: "auto",
            }}>
              {data.workspace.identity}
            </pre>
          </Section>
        )}

        {/* Recent Runs */}
        <Section title="Recent Execution Runs" icon={<Clock size={14} />}>
          {data.recentRuns.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 80px 80px 70px 90px",
                  gap: 8,
                  padding: "6px 0",
                  borderBottom: `1px solid ${C.divider}`,
                }}
              >
                {["Task", "Provider", "Status", "Duration", "When"].map((h) => (
                  <span key={h} style={{
                    fontSize: 11, fontWeight: 600, color: C.muted,
                    textTransform: "uppercase", letterSpacing: "0.04em",
                  }}>
                    {h}
                  </span>
                ))}
              </div>
              {data.recentRuns.map((run, i) => (
                <div
                  key={run.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 80px 80px 70px 90px",
                    gap: 8,
                    padding: "8px 0",
                    borderBottom: i < data.recentRuns.length - 1 ? `1px solid ${C.divider}` : undefined,
                  }}
                >
                  <span style={{ fontSize: 13, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {run.taskKey || run.taskTitle || "—"}
                  </span>
                  <span style={{ fontSize: 12, color: C.textSec }}>{run.provider}</span>
                  <RunStatusBadge status={run.status} />
                  <span style={{ fontSize: 12, color: C.muted }}>
                    {run.durationMs != null ? formatDuration(run.durationMs) : "—"}
                  </span>
                  <span style={{ fontSize: 12, color: C.muted }}>
                    {run.startedAt ? formatRelative(run.startedAt) : "—"}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ margin: 0, fontSize: 13, color: C.muted, fontStyle: "italic" }}>
              No execution runs recorded for this agent on this project.
            </p>
          )}
        </Section>

        {/* Not-found state for workspace */}
        {!data.workspace.exists && (
          <div style={{
            marginTop: 8, padding: "12px 16px", borderRadius: 8,
            background: "rgba(217,119,6,0.06)",
            border: "1px solid rgba(217,119,6,0.15)",
            display: "flex", alignItems: "flex-start", gap: 8,
          }}>
            <AlertTriangle size={13} style={{ color: C.accent, marginTop: 2, flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: C.textSec, lineHeight: 1.5 }}>
              The convention-derived path for this agent&rsquo;s workspace does not exist on disk.
              The path was inferred from the agent slug &mdash; no persisted workspace path is stored in
              the agents table. The actual workspace may not have been created yet, or it may use
              a non-standard location not discoverable by convention.
            </span>
          </div>
        )}
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

function StatusBadge({ ok }: { ok: boolean }) {
  if (ok) {
    return (
      <span style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        fontSize: 11, fontWeight: 500, padding: "2px 8px",
        borderRadius: 4, color: C.green, background: "rgba(34,197,94,0.12)",
      }}>
        <CheckCircle2 size={11} />
        Exists on disk
      </span>
    );
  }
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      fontSize: 11, fontWeight: 500, padding: "2px 8px",
      borderRadius: 4, color: C.red, background: "rgba(239,68,68,0.12)",
    }}>
      <XCircle size={11} />
      Not found
    </span>
  );
}

function AgentStatusBadge({ status }: { status: string }) {
  const s: Record<string, { color: string; bg: string }> = {
    active: { color: C.green, bg: "rgba(34,197,94,0.12)" },
    idle: { color: C.textSec, bg: "rgba(168,162,158,0.12)" },
    paused: { color: C.accent, bg: "rgba(217,119,6,0.12)" },
    error: { color: C.red, bg: "rgba(239,68,68,0.12)" },
  };
  const st = s[status] ?? { color: C.textSec, bg: "rgba(168,162,158,0.12)" };
  return (
    <span style={{
      fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 4,
      color: st.color, background: st.bg, marginLeft: "auto",
    }}>
      {status}
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

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return `${min}m ${rem}s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
