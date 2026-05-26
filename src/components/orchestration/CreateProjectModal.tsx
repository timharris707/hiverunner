"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { createProject } from "@/lib/orchestration/client";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated?: (project: { id: string; slug: string; name: string }) => void;
  companyId: string;
  companyCode: string;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function CreateProjectModal({ open, onClose, onCreated, companyId, companyCode }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sourceWorkspaceRoot, setSourceWorkspaceRoot] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slug = slugify(name);

  // Lock body scroll when open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // ESC to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !submitting) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, submitting]);

  const reset = () => {
    setName("");
    setDescription("");
    setSourceWorkspaceRoot("");
    setError(null);
  };

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setError("Project name must be at least 2 characters.");
      return;
    }

    setSubmitting(true);
    setError(null);

    const project = await createProject({
      companyId,
      name: trimmed,
      slug: slug || undefined,
      description: description.trim() || undefined,
      sourceWorkspaceRoot: sourceWorkspaceRoot.trim() || null,
      status: "active",
    });

    setSubmitting(false);

    if (!project) {
      setError("Failed to create project. Please try again.");
      return;
    }

    reset();
    onCreated?.({ id: project.id, slug: project.slug, name: project.name });
    onClose();
  };

  if (!open) return null;

  const inputStyle: React.CSSProperties = {
    width: "100%",
    borderRadius: "8px",
    border: "1px solid var(--border)",
    background: "var(--surface)",
    padding: "10px 14px",
    fontSize: "13px",
    color: "var(--text-primary)",
    outline: "none",
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "color-mix(in srgb, var(--bg) 28%, transparent)",
        backdropFilter: "blur(18px)",
        WebkitBackdropFilter: "blur(18px)",
        padding: "24px",
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !submitting) { reset(); onClose(); } }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Create new project"
        style={{
          width: "100%",
          maxWidth: "560px",
          borderRadius: "8px",
          border: "1px solid var(--border)",
          background: "color-mix(in srgb, var(--surface-elevated) 92%, transparent)",
          backdropFilter: "blur(22px)",
          WebkitBackdropFilter: "blur(22px)",
          boxShadow: "var(--shadow-glass)",
          overflow: "hidden",
        }}
      >
        {/* header */}
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 20px",
          borderBottom: "1px solid var(--border)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "3px 8px",
              borderRadius: "6px",
              border: "1px solid var(--border)",
              background: "var(--surface)",
              fontSize: "11px",
              fontWeight: 700,
              letterSpacing: "0.08em",
              color: "var(--text-secondary)",
            }}>
              {companyCode}
            </span>
            <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>›</span>
            <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>New project</span>
          </div>
          <button
            type="button"
            onClick={() => { if (!submitting) { reset(); onClose(); } }}
            style={{
              width: "28px",
              height: "28px",
              borderRadius: "8px",
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--text-muted)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <X size={14} />
          </button>
        </div>

        {/* body */}
        <div style={{ padding: "20px" }}>
          {/* name */}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Project name"
            aria-label="Project name"
            autoFocus
            style={{
              ...inputStyle,
              fontSize: "20px",
              fontWeight: 500,
              border: "none",
              background: "transparent",
              padding: "0 0 8px",
              borderBottom: "1px solid var(--border)",
              borderRadius: 0,
              color: name ? "var(--text-primary)" : undefined,
            }}
          />

          {/* description */}
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Add description..."
            aria-label="Project description"
            rows={4}
            style={{
              ...inputStyle,
              marginTop: "12px",
              border: "none",
              background: "transparent",
              padding: "0",
              resize: "vertical",
              minHeight: "80px",
              fontSize: "14px",
              color: description ? "var(--text-secondary)" : undefined,
            }}
          />

          <input
            value={sourceWorkspaceRoot}
            onChange={(e) => setSourceWorkspaceRoot(e.target.value)}
            placeholder="Optional source workspace path"
            aria-label="Source workspace path"
            style={{
              ...inputStyle,
              marginTop: "12px",
              fontSize: "12px",
              fontFamily: "var(--font-mono, monospace)",
            }}
          />
          <p style={{ margin: "6px 0 0", fontSize: "12px", color: "var(--text-muted)", lineHeight: 1.5 }}>
            Use this for an existing repo. Leave blank to use HiveRunner&apos;s managed project workspace.
          </p>

          {/* error */}
          {error ? (
            <p style={{ marginTop: "12px", fontSize: "13px", color: "var(--negative)" }}>{error}</p>
          ) : null}
        </div>

        {/* footer */}
        <div style={{
          display: "flex",
          gap: "10px",
          justifyContent: "flex-end",
          padding: "14px 20px",
          borderTop: "1px solid var(--border)",
        }}>
          <button
            type="button"
            onClick={() => { if (!submitting) { reset(); onClose(); } }}
            disabled={submitting}
            style={{
              padding: "8px 18px",
              borderRadius: "8px",
              border: "1px solid var(--border)",
              background: "transparent",
              fontSize: "13px",
              fontWeight: 600,
              color: "var(--text-secondary)",
              cursor: submitting ? "default" : "pointer",
              opacity: submitting ? 0.6 : 1,
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={submitting || name.trim().length < 2}
            style={{
              padding: "8px 20px",
              borderRadius: "8px",
              border: "1px solid var(--border)",
              background: name.trim().length >= 2 ? "color-mix(in srgb, var(--text-primary) 72%, var(--surface))" : "var(--surface-hover)",
              fontSize: "13px",
              fontWeight: 600,
              color: name.trim().length >= 2 ? "var(--surface)" : "var(--text-muted)",
              cursor: name.trim().length >= 2 ? "pointer" : "default",
              transition: "all 120ms ease",
              opacity: submitting ? 0.6 : 1,
            }}
          >
            {submitting ? "Creating..." : "Create project"}
          </button>
        </div>
      </div>
    </div>
  );
}
