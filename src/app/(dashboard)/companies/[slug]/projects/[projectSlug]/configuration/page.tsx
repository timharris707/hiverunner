"use client";

import { use, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FolderOpen,
  HardDrive,
  Info,
  Trash2,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { listProjects, updateProjectSettings } from "@/lib/orchestration/client";
import type { OrchestrationProject } from "@/lib/orchestration/types";
import { ProjectTabBar } from "../ProjectTabBar";
import { buildCompanyPath } from "@/lib/orchestration/route-paths";
import { PageHeader } from "@/lib/ui/primitives";
import { P, color, font, radius, space } from "@/lib/ui/tokens";

const C = {
  bg: P.bg,
  card: P.surface,
  cardBorder: P.cardBorder,
  text: P.text,
  textSec: P.textSec,
  muted: P.muted,
  divider: P.cardBorder,
  accent: P.accent,
  green: color.positive,
  red: color.negative,
};

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
          // Load execution context from workspaces API
          const res = await fetch(
            `/api/orchestration/projects/${encodeURIComponent(p.id)}/workspaces`
          );
          if (res.ok && !cancelled) {
            const data = await res.json();
            setExecCtx({
              company: data.company,
              projectDirectory: data.projectDirectory,
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
      await updateProjectSettings({ projectIdOrSlug: project.id });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch { /* best-effort */ }
    setSaving(false);
  };

  if (loading) return <div style={{ padding: 32, color: C.muted, fontSize: 13 }}>Loading...</div>;
  if (!project) return <div style={{ padding: 32, color: "#fca5a5", fontSize: 13 }}>Project not found.</div>;

  const inputStyle: React.CSSProperties = {
    width: "100%", borderRadius: 8, border: `0.5px solid ${C.cardBorder}`,
    background: "rgba(41,37,36,0.4)", padding: "10px 14px",
    fontSize: 13, color: C.text, outline: "none",
  };

  const STATUS_STYLE: Record<string, { color: string; bg: string }> = {
    active: { color: C.green, bg: "rgba(34,197,94,0.12)" },
    "in-progress": { color: C.green, bg: "rgba(34,197,94,0.12)" },
    paused: { color: C.accent, bg: "rgba(234,179,8,0.12)" },
    archived: { color: C.muted, bg: "rgba(87,83,78,0.12)" },
  };
  const st = STATUS_STYLE[project.status] ?? { color: C.textSec, bg: "rgba(168,162,158,0.12)" };

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
      <Section title="General">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={{ display: "block", fontSize: 12, color: C.muted, marginBottom: 4 }}>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 12, color: C.muted, marginBottom: 4 }}>Description</label>
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
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              style={{
                padding: "8px 20px", borderRadius: 8,
                border: `0.5px solid ${C.cardBorder}`,
                background: "rgba(120,113,108,0.15)",
                fontSize: 13, fontWeight: 600, color: C.text,
                cursor: saving ? "default" : "pointer",
                opacity: saving ? 0.5 : 1,
              }}
            >
              {saving ? "Saving..." : saved ? "Saved" : "Save Changes"}
            </button>
          </div>
        </div>
      </Section>

      {/* Execution Context — replaces the old misleading "Codebase" section */}
      <Section title="Execution Context">
        {execCtx ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Company workspace root — persisted truth */}
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                <HardDrive size={13} style={{ color: C.textSec }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: C.textSec }}>Company Workspace Root</span>
                <SourceBadge source="persisted" />
              </div>
              {execCtx.company.workspaceRoot ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingLeft: 19 }}>
                  <code style={{ fontSize: 12, color: C.textSec, fontFamily: "monospace" }}>
                    {execCtx.company.workspaceRoot}
                  </code>
                  <DiskStatus exists={execCtx.company.workspaceRootExists} />
                </div>
              ) : (
                <span style={{ fontSize: 13, color: C.muted, fontStyle: "italic", paddingLeft: 19 }}>
                  Not configured
                </span>
              )}
            </div>

            {/* Project directory — convention-derived */}
            <div style={{ borderTop: `0.5px solid ${C.divider}`, paddingTop: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                <FolderOpen size={13} style={{ color: C.textSec }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: C.textSec }}>Project Directory</span>
                <SourceBadge source="convention" />
              </div>
              {execCtx.projectDirectory.path ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingLeft: 19 }}>
                  <code style={{ fontSize: 12, color: C.textSec, fontFamily: "monospace" }}>
                    {execCtx.projectDirectory.path}
                  </code>
                  <DiskStatus exists={execCtx.projectDirectory.verified} />
                </div>
              ) : (
                <span style={{ fontSize: 13, color: C.muted, fontStyle: "italic", paddingLeft: 19 }}>
                  Cannot be determined (no company workspace root)
                </span>
              )}
            </div>

            {/* Repo — not supported */}
            <div style={{ borderTop: `0.5px solid ${C.divider}`, paddingTop: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: C.textSec }}>Repository</span>
              </div>
              <span style={{ fontSize: 13, color: C.muted, fontStyle: "italic", paddingLeft: 0 }}>
                Not available — no repository field exists in the project schema.
              </span>
            </div>

            {/* Agent workspaces summary */}
            {execCtx.agentWorkspaces.length > 0 && (
              <div style={{ borderTop: `0.5px solid ${C.divider}`, paddingTop: 14 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: C.textSec }}>
                    Assigned Agents ({execCtx.agentWorkspaces.length})
                  </span>
                  <Link
                    href={buildCompanyPath(slug, `/projects/${encodeURIComponent(projectSlug)}/workspaces`)}
                    className="no-underline"
                    style={{ fontSize: 12, color: C.accent }}
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
                        border: `0.5px solid ${C.cardBorder}`,
                        background: "rgba(41,37,36,0.4)",
                        color: C.textSec,
                      }}
                    >
                      {aw.agentName}
                      {aw.exists ? (
                        <CheckCircle2 size={10} style={{ color: C.green }} />
                      ) : (
                        <XCircle size={10} style={{ color: C.muted }} />
                      )}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Provenance note */}
            <div style={{
              marginTop: 4, padding: "10px 12px", borderRadius: 6,
              background: "rgba(217,119,6,0.05)",
              border: "0.5px solid rgba(217,119,6,0.12)",
              display: "flex", alignItems: "flex-start", gap: 6,
            }}>
              <Info size={12} style={{ color: C.accent, marginTop: 2, flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: C.muted, lineHeight: 1.5 }}>
                The company workspace root is stored in the orchestration database.
                The project directory path is derived by naming convention and checked
                against the filesystem. There is no persisted project directory or
                repository field in the current schema.
              </span>
            </div>
          </div>
        ) : (
          <span style={{ fontSize: 13, color: C.muted, fontStyle: "italic" }}>
            Execution context unavailable.
          </span>
        )}
      </Section>

      {/* Dates */}
      <Section title="Dates">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <PropRow label="Created">
            <span style={{ fontSize: 13, color: C.textSec }}>
              {project.created ? new Date(project.created).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}
            </span>
          </PropRow>
        </div>
      </Section>

      {/* Danger Zone */}
      <div style={{
        marginTop: 24, padding: 20, borderRadius: 10,
        border: "0.5px solid rgba(239,68,68,0.2)",
        background: "rgba(239,68,68,0.04)",
      }}>
        <h3 style={{ margin: "0 0 8px", fontSize: 14, fontWeight: 600, color: "#ef4444", display: "flex", alignItems: "center", gap: 6 }}>
          <AlertTriangle size={14} /> Danger Zone
        </h3>
        <p style={{ margin: "0 0 12px", fontSize: 13, color: C.textSec }}>
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      marginBottom: 20, padding: "16px 20px", borderRadius: 10,
      border: `0.5px solid rgba(120,113,108,0.18)`,
      background: "rgba(28,25,23,0.6)",
    }}>
      <h2 style={{ margin: "0 0 14px", fontSize: 14, fontWeight: 600, color: "#f5f5f4" }}>{title}</h2>
      {children}
    </div>
  );
}

function PropRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <span style={{ width: 100, fontSize: 12, color: "#57534e" }}>{label}</span>
      <div>{children}</div>
    </div>
  );
}

function SourceBadge({ source }: { source: "persisted" | "convention" }) {
  const styles = {
    persisted: { color: "#22c55e", bg: "rgba(34,197,94,0.12)", label: "Persisted" },
    convention: { color: "#d97706", bg: "rgba(217,119,6,0.12)", label: "Convention" },
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
        fontSize: 11, color: "#22c55e",
      }}>
        <CheckCircle2 size={11} />
        Exists on disk
      </span>
    );
  }
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      fontSize: 11, color: "#57534e",
    }}>
      <XCircle size={11} />
      Not found on disk
    </span>
  );
}
