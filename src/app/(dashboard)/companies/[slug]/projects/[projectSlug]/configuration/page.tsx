"use client";

import { use, useEffect, useState } from "react";
import { AlertTriangle, ExternalLink, FolderOpen, Trash2 } from "lucide-react";
import { listProjects, updateProjectSettings } from "@/lib/orchestration/client";
import type { OrchestrationProject } from "@/lib/orchestration/types";

const C = {
  bg: "#0c0a09",
  card: "rgba(28,25,23,0.6)",
  cardBorder: "rgba(120,113,108,0.18)",
  text: "#f5f5f4",
  textSec: "#a8a29e",
  muted: "#57534e",
  divider: "rgba(120,113,108,0.15)",
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

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const projects = await listProjects({ company: slug });
      if (cancelled) return;
      const p = projects.find((p) => p.slug === projectSlug || p.id === projectSlug) ?? null;
      setProject(p);
      if (p) { setName(p.name); setDescription(p.description ?? ""); }
      setLoading(false);
    };
    void load();
    return () => { cancelled = true; };
  }, [slug, projectSlug]);

  const handleSave = async () => {
    if (!project || saving) return;
    setSaving(true);
    try {
      await updateProjectSettings({ projectIdOrSlug: project.id });  // TODO: add name/description support to API
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch { /* best-effort */ }
    setSaving(false);
  };

  if (loading) return <div style={{ padding: 32, color: C.muted, fontSize: 13 }}>Loading...</div>;
  if (!project) return <div style={{ padding: 32, color: "#fca5a5", fontSize: 13 }}>Project not found.</div>;

  const inputStyle: React.CSSProperties = {
    width: "100%", borderRadius: 8, border: `1px solid ${C.cardBorder}`,
    background: "rgba(41,37,36,0.4)", padding: "10px 14px",
    fontSize: 13, color: C.text, outline: "none",
  };

  return (
    <div style={{ padding: "20px 24px", maxWidth: 700 }}>
      <h1 style={{ margin: "0 0 20px", fontSize: 22, fontWeight: 600, color: C.text }}>
        Configuration
      </h1>

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
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <PropRow label="Status">
              <span style={{
                fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 4,
                color: "#22c55e", background: "rgba(34,197,94,0.12)",
              }}>
                {project.status}
              </span>
            </PropRow>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              style={{
                padding: "8px 20px", borderRadius: 8,
                border: `1px solid ${C.cardBorder}`,
                background: "rgba(120,113,108,0.15)",
                fontSize: 13, fontWeight: 600, color: C.text,
                cursor: saving ? "default" : "pointer",
                opacity: saving ? 0.5 : 1,
              }}
            >
              {saving ? "Saving..." : saved ? "Saved ✓" : "Save Changes"}
            </button>
          </div>
        </div>
      </Section>

      {/* Codebase */}
      <Section title="Codebase">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <PropRow label="Repo">
            <span style={{ fontSize: 13, color: C.textSec }}>—</span>
          </PropRow>
          <PropRow label="Local Folder">
            <span style={{ fontSize: 13, color: C.textSec, fontFamily: "monospace" }}>—</span>
          </PropRow>
        </div>
      </Section>

      {/* Dates */}
      <Section title="Dates">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <PropRow label="Created">
            <span style={{ fontSize: 13, color: C.textSec }}>
              {project.created ? new Date(project.created).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}
            </span>
          </PropRow>
          <PropRow label="Updated">
            <span style={{ fontSize: 13, color: C.textSec }}>
              {project.created ? new Date(project.created).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}
            </span>
          </PropRow>
        </div>
      </Section>

      {/* Danger Zone */}
      <div style={{
        marginTop: 24, padding: 20, borderRadius: 10,
        border: "1px solid rgba(239,68,68,0.2)",
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
            border: "1px solid rgba(239,68,68,0.3)",
            background: "rgba(239,68,68,0.08)",
            fontSize: 12, fontWeight: 600, color: "#ef4444",
            cursor: "pointer",
          }}
        >
          <Trash2 size={13} /> Archive project
        </button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      marginBottom: 20, padding: "16px 20px", borderRadius: 10,
      border: `1px solid rgba(120,113,108,0.18)`,
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
