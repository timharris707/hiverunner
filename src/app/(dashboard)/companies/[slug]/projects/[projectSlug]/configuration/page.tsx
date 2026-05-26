"use client";

import { use, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FolderOpen,
  HardDrive,
  Trash2,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { listProjects, updateProjectSettings } from "@/lib/orchestration/client";
import { formatOrchestrationModeLabel } from "@/lib/orchestration/execution-hives";
import type { OrchestrationProject, TaskExecutionEngine } from "@/lib/orchestration/types";
import { ProjectTabBar } from "../ProjectTabBar";
import { buildCanonicalCompanyPath, buildCompanyPath } from "@/lib/orchestration/route-paths";
import { PageHeader } from "@/lib/ui/primitives";
import { P, color, font, radius, space } from "@/lib/ui/tokens";


type ExecutionContext = {
  company: {
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
  sourceWorkspace: {
    path: string | null;
    exists: boolean;
    source: "project_settings" | "project_directory";
    effectivePath: string | null;
    effectiveExists: boolean;
  };
  agentWorkspaces: Array<{
    agentId: string;
    agentName: string;
    agentSlug: string;
    exists: boolean;
  }>;
};

export default function ProjectConfigurationPage({
  params,
}: {
  params: Promise<{ slug: string; projectSlug: string }>;
}) {
  const { slug, projectSlug } = use(params);
  const [project, setProject] = useState<OrchestrationProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [defaultExecutionEngine, setDefaultExecutionEngine] = useState<TaskExecutionEngine | "">("");
  const [sourceWorkspaceRoot, setSourceWorkspaceRoot] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [execCtx, setExecCtx] = useState<ExecutionContext | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const projects = await listProjects({ company: slug });
        if (cancelled) return;
        const p = projects.find((p) => p.slug === projectSlug || p.id === projectSlug) ?? null;
        setProject(p);
        if (p) {
          setName(p.name);
          setDescription(p.description ?? "");
          setDefaultExecutionEngine(p.defaultExecutionEngine ?? "");
          setSourceWorkspaceRoot(p.sourceWorkspaceRoot ?? "");
          // Load execution context from workspaces API
          const res = await fetch(
            `/api/orchestration/projects/${encodeURIComponent(p.id)}/workspaces`
          );
          if (res.ok && !cancelled) {
            const data = await res.json();
            setExecCtx({
              company: data.company,
              projectDirectory: data.projectDirectory,
              sourceWorkspace: data.sourceWorkspace,
              agentWorkspaces: (data.agentWorkspaces ?? []).map((aw: { agentId: string; agentName: string; agentSlug: string; exists: boolean }) => ({
                agentId: aw.agentId,
                agentName: aw.agentName,
                agentSlug: aw.agentSlug,
                exists: aw.exists,
              })),
            });
          }
        }
      } catch {
        // best-effort
      }
      if (!cancelled) setLoading(false);
    };
    void load();
    return () => { cancelled = true; };
  }, [slug, projectSlug]);

  const handleSave = async () => {
    if (!project || saving) return;
    setSaving(true);
    try {
      const updated = await updateProjectSettings({
        projectIdOrSlug: project.id,
        name: name.trim(),
        defaultExecutionEngine: defaultExecutionEngine || null,
        sourceWorkspaceRoot: sourceWorkspaceRoot.trim() || null,
      });
      if (updated) {
        setProject(updated);
        setName(updated.name);
        setDefaultExecutionEngine(updated.defaultExecutionEngine ?? "");
        setSourceWorkspaceRoot(updated.sourceWorkspaceRoot ?? "");
        const res = await fetch(
          `/api/orchestration/projects/${encodeURIComponent(updated.id)}/workspaces`
        );
        if (res.ok) {
          const data = await res.json();
          setExecCtx({
            company: data.company,
            projectDirectory: data.projectDirectory,
            sourceWorkspace: data.sourceWorkspace,
            agentWorkspaces: (data.agentWorkspaces ?? []).map((aw: { agentId: string; agentName: string; agentSlug: string; exists: boolean }) => ({
              agentId: aw.agentId,
              agentName: aw.agentName,
              agentSlug: aw.agentSlug,
              exists: aw.exists,
            })),
          });
        }
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch { /* best-effort */ }
    setSaving(false);
  };

  if (loading) return <div style={{ padding: 32, color: P.muted, fontSize: 13 }}>Loading...</div>;
  if (!project) return <div style={{ padding: 32, color: "#fca5a5", fontSize: 13 }}>Project not found.</div>;

  const inputStyle: React.CSSProperties = {
    width: "100%", borderRadius: radius.md, border: `0.5px solid ${P.cardBorder}`,
    background: "transparent", padding: "10px 14px",
    fontSize: 13, color: P.text, outline: "none",
  };

  const STATUS_STYLE: Record<string, { color: string; bg: string }> = {
    active: { color: color.positive, bg: "rgba(34,197,94,0.12)" },
    "in-progress": { color: color.positive, bg: "rgba(34,197,94,0.12)" },
    paused: { color: color.accent, bg: "rgba(234,179,8,0.12)" },
    archived: { color: P.muted, bg: "rgba(87,83,78,0.12)" },
  };
  const st = STATUS_STYLE[project.status] ?? { color: P.textSec, bg: "rgba(168,162,158,0.12)" };

  return (
    <div style={{ minHeight: "100%", padding: `${space.md}px ${space.xl}px`, color: P.text, fontFamily: font.body }}>
      <PageHeader
        icon={<span style={{ display: "inline-block", width: 14, height: 14, borderRadius: radius.full, background: project.color ?? P.accent }} />}
        title={project.name}
      />

      <div style={{ marginTop: space.xs, marginBottom: space.md }}>
        <ProjectTabBar slug={slug} projectSlug={projectSlug} active="configuration" />
      </div>

      <div style={{ maxWidth: 700 }}>

      {/* Name & Description */}
      <SectionBlock title="General">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={{ display: "block", fontSize: 12, color: P.muted, marginBottom: 4 }}>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 12, color: P.muted, marginBottom: 4 }}>Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add a description..."
              rows={3}
              style={{ ...inputStyle, resize: "vertical", minHeight: 60 }}
            />
          </div>
          <PropRow label="Status">
            <span style={{
              fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 4,
              color: st.color, background: st.bg,
            }}>
              {project.status}
            </span>
          </PropRow>
          <div>
            <label style={{ display: "block", fontSize: 12, color: P.muted, marginBottom: 4 }}>Project orchestration mode</label>
            <select
              value={defaultExecutionEngine}
              onChange={(e) => setDefaultExecutionEngine(e.target.value as TaskExecutionEngine | "")}
              style={inputStyle}
            >
              <option value="">Inherit company Execution Hive</option>
              <option value="hiverunner">{formatOrchestrationModeLabel("hiverunner")}</option>
              <option value="symphony">{formatOrchestrationModeLabel("symphony")}</option>
              <option value="manual">{formatOrchestrationModeLabel("manual")}</option>
            </select>
            <p style={{ margin: "6px 0 0", fontSize: 12, color: P.muted, lineHeight: 1.5 }}>
              Project overrides set the orchestration mode only. Runtime and model routing stay governed by the company Execution Hive unless a task chooses a more specific route.
              {" "}
              <Link href={buildCanonicalCompanyPath(slug, "/runtimes")} style={{ color: color.accent, textDecoration: "none", fontWeight: 650 }}>
                Configure the Execution Matrix
              </Link>
              .
            </p>
          </div>
          <div>
            <label style={{ display: "block", fontSize: 12, color: P.muted, marginBottom: 4 }}>Source workspace</label>
            <input
              value={sourceWorkspaceRoot}
              onChange={(e) => setSourceWorkspaceRoot(e.target.value)}
              placeholder="Optional existing repo path, e.g. /path/to/loanmeld"
              style={{ ...inputStyle, fontFamily: "var(--font-mono, monospace)", fontSize: 12 }}
            />
            <p style={{ margin: "6px 0 0", fontSize: 12, color: P.muted, lineHeight: 1.5 }}>
              Leave blank to use the managed project directory. Set this when the project already has a real product repo.
            </p>
          </div>
          <div>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              style={{
                padding: "8px 20px", borderRadius: radius.md,
                border: `0.5px solid ${P.cardBorder}`,
                background: "transparent",
                fontSize: 13, fontWeight: 600, color: P.text,
                cursor: saving ? "default" : "pointer",
                opacity: saving ? 0.5 : 1,
              }}
            >
              {saving ? "Saving..." : saved ? "Saved" : "Save Changes"}
            </button>
          </div>
        </div>
      </SectionBlock>

      {/* Execution Context — replaces the old misleading "Codebase" section */}
      <SectionBlock title="Execution Context">
        {execCtx ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Company workspace root — persisted truth */}
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                <HardDrive size={13} style={{ color: P.textSec }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: P.textSec }}>Company Workspace Root</span>
                <SourceBadge source="persisted" />
              </div>
              {execCtx.company.workspaceRoot ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingLeft: 19 }}>
                  <code style={{ fontSize: 12, color: P.textSec, fontFamily: "monospace" }}>
                    {execCtx.company.workspaceRoot}
                  </code>
                  <DiskStatus exists={execCtx.company.workspaceRootExists} />
                </div>
              ) : (
                <span style={{ fontSize: 13, color: P.muted, fontStyle: "italic", paddingLeft: 19 }}>
                  Not configured
                </span>
              )}
            </div>

            {/* Project directory — convention-derived */}
            <div style={{ borderTop: `0.5px solid ${P.cardBorder}`, paddingTop: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                <FolderOpen size={13} style={{ color: P.textSec }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: P.textSec }}>Project Directory</span>
                <SourceBadge source="convention" />
              </div>
              {execCtx.projectDirectory.path ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingLeft: 19 }}>
                  <code style={{ fontSize: 12, color: P.textSec, fontFamily: "monospace" }}>
                    {execCtx.projectDirectory.path}
                  </code>
                  <DiskStatus exists={execCtx.projectDirectory.verified} />
                </div>
              ) : (
                <span style={{ fontSize: 13, color: P.muted, fontStyle: "italic", paddingLeft: 19 }}>
                  Cannot be determined (no company workspace root)
                </span>
              )}
            </div>

            {/* Source workspace — operator configured */}
            <div style={{ borderTop: `0.5px solid ${P.cardBorder}`, paddingTop: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <FolderOpen size={13} style={{ color: P.textSec }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: P.textSec }}>Source Workspace</span>
                <SourceBadge source={execCtx.sourceWorkspace.source === "project_settings" ? "project_settings" : "convention"} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingLeft: 19 }}>
                <code style={{ fontSize: 12, color: P.textSec, fontFamily: "monospace" }}>
                  {execCtx.sourceWorkspace.effectivePath ?? "Not configured"}
                </code>
                <DiskStatus exists={execCtx.sourceWorkspace.effectiveExists} />
              </div>
            </div>

            {/* Agent workspaces summary */}
            {execCtx.agentWorkspaces.length > 0 && (
              <div style={{ borderTop: `0.5px solid ${P.cardBorder}`, paddingTop: 14 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: P.textSec }}>
                    Assigned Agents ({execCtx.agentWorkspaces.length})
                  </span>
                  <Link
                    href={buildCompanyPath(slug, `/projects/${encodeURIComponent(projectSlug)}/workspaces`)}
                    className="no-underline"
                    style={{ fontSize: 12, color: color.accent }}
                  >
                    View workspaces
                  </Link>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, paddingLeft: 0 }}>
                  {execCtx.agentWorkspaces.map((aw) => (
                    <span
                      key={aw.agentId}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 4,
                        fontSize: 12, padding: "3px 8px", borderRadius: 6,
                        border: `0.5px solid ${P.cardBorder}`,
                        background: "transparent",
                        color: P.textSec,
                      }}
                    >
                      {aw.agentName}
                      {aw.exists ? (
                        <CheckCircle2 size={10} style={{ color: color.positive }} />
                      ) : (
                        <XCircle size={10} style={{ color: P.muted }} />
                      )}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Provenance note */}
            <p style={{ marginTop: space.md, fontSize: 12, color: P.muted, lineHeight: 1.6 }}>
              The company workspace root is stored in the orchestration database.
              The project directory path is derived by naming convention. The source
              workspace is where Codex or an external runner should make code changes and run tests.
            </p>
          </div>
        ) : (
          <span style={{ fontSize: 13, color: P.muted, fontStyle: "italic" }}>
            Execution context unavailable.
          </span>
        )}
      </SectionBlock>

      {/* Dates */}
      <SectionBlock title="Dates">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <PropRow label="Created">
            <span style={{ fontSize: 13, color: P.textSec }}>
              {project.created ? new Date(project.created).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}
            </span>
          </PropRow>
        </div>
      </SectionBlock>

      {/* Danger Zone */}
      <div style={{
        marginTop: 24, padding: 20, borderRadius: 10,
        border: "0.5px solid rgba(239,68,68,0.2)",
        background: "rgba(239,68,68,0.04)",
      }}>
        <h3 style={{ margin: "0 0 8px", fontSize: 14, fontWeight: 600, color: "#ef4444", display: "flex", alignItems: "center", gap: 6 }}>
          <AlertTriangle size={14} /> Danger Zone
        </h3>
        <p style={{ margin: "0 0 12px", fontSize: 13, color: P.textSec }}>
          Archive this project to hide it from the sidebar and project selectors.
        </p>
        <button
          type="button"
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "8px 16px", borderRadius: 8,
            border: "0.5px solid rgba(239,68,68,0.3)",
            background: "rgba(239,68,68,0.08)",
            fontSize: 12, fontWeight: 600, color: "#ef4444",
            cursor: "pointer",
          }}
        >
          <Trash2 size={13} /> Archive project
        </button>
      </div>
      </div>
    </div>
  );
}

/* ─── Helpers ─── */

function SectionBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: space.xl }}>
      <h3 style={{ margin: `0 0 ${space.sm}px`, fontSize: 13, fontWeight: 600, color: P.textSec }}>{title}</h3>
      {children}
    </div>
  );
}

function PropRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <span style={{ width: 100, fontSize: 12, color: P.muted, flexShrink: 0 }}>{label}</span>
      <div>{children}</div>
    </div>
  );
}

function SourceBadge({ source }: { source: "persisted" | "convention" | "project_settings" }) {
  const styles = {
    persisted: { color: color.positive, bg: color.positiveSoft, label: "Persisted" },
    convention: { color: color.accent, bg: color.accentSoft, label: "Convention" },
    project_settings: { color: color.positive, bg: color.positiveSoft, label: "Project setting" },
  };
  const s = styles[source];
  return (
    <span style={{
      fontSize: 10, fontWeight: 500, padding: "1px 6px", borderRadius: 4,
      color: s.color, background: s.bg,
    }}>
      {s.label}
    </span>
  );
}

function DiskStatus({ exists }: { exists: boolean }) {
  if (exists) {
    return (
      <span style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        fontSize: 11, color: color.positive,
      }}>
        <CheckCircle2 size={11} />
        Exists on disk
      </span>
    );
  }
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      fontSize: 11, color: P.muted,
    }}>
      <XCircle size={11} />
      Not found on disk
    </span>
  );
}
