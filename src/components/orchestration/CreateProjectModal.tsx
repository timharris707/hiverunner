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
  companySlug: string;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function CreateProjectModal({ open, onClose, onCreated, companyId, companyCode, companySlug }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [status, setStatus] = useState<"active" | "paused" | "archived">("active");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slug = slugify(name);
  const localFolder = slug ? `/projects/${companySlug}/${slug}` : "";

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
    setRepoUrl("");
    setStatus("active");
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
      status,
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
    borderRadius: "10px",
    border: "1px solid rgba(120,113,108,0.3)",
    background: "rgba(41,37,36,0.5)",
    padding: "10px 14px",
    fontSize: "13px",
    color: "#f5f5f4",
    outline: "none",
  };

  const labelStyle: React.CSSProperties = {
    fontSize: "12px",
    color: "#78716c",
    marginBottom: "6px",
    display: "flex",
    alignItems: "center",
    gap: "4px",
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
        background: "rgba(12,10,9,0.7)",
        backdropFilter: "blur(6px)",
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
          borderRadius: "16px",
          border: "1px solid rgba(120,113,108,0.3)",
          background: "linear-gradient(180deg, rgba(41,37,36,0.95), rgba(20,17,15,0.98))",
          boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
          overflow: "hidden",
        }}
      >
        {/* header */}
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 20px",
          borderBottom: "1px solid rgba(120,113,108,0.2)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "3px 8px",
              borderRadius: "6px",
              border: "1px solid rgba(120,113,108,0.35)",
              background: "rgba(41,37,36,0.6)",
              fontSize: "11px",
              fontWeight: 700,
              letterSpacing: "0.08em",
              color: "#a8a29e",
            }}>
              {companyCode}
            </span>
            <span style={{ fontSize: "13px", color: "#78716c" }}>›</span>
            <span style={{ fontSize: "14px", fontWeight: 600, color: "#f5f5f4" }}>New project</span>
          </div>
          <button
            type="button"
            onClick={() => { if (!submitting) { reset(); onClose(); } }}
            style={{
              width: "28px",
              height: "28px",
              borderRadius: "8px",
              border: "1px solid rgba(120,113,108,0.25)",
              background: "transparent",
              color: "#78716c",
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
            autoFocus
            style={{
              ...inputStyle,
              fontSize: "20px",
              fontWeight: 500,
              border: "none",
              background: "transparent",
              padding: "0 0 8px",
              borderBottom: "1px solid rgba(120,113,108,0.2)",
              borderRadius: 0,
              color: name ? "#f5f5f4" : undefined,
            }}
          />

          {/* description */}
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Add description..."
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
              color: description ? "#d6d3d1" : undefined,
            }}
          />

          <div style={{ marginTop: "20px", borderTop: "1px solid rgba(120,113,108,0.15)", paddingTop: "16px", display: "grid", gap: "14px" }}>
            {/* repo url */}
            <div>
              <label style={labelStyle}>
                Repo URL <span style={{ color: "#57534e" }}>optional</span>
              </label>
              <input
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder="https://github.com/org/repo"
                style={inputStyle}
              />
            </div>

            {/* local folder (read-only, auto-computed) */}
            <div>
              <label style={labelStyle}>
                Local folder
              </label>
              <input
                value={localFolder}
                readOnly
                placeholder="Auto-generated from project name"
                style={{ ...inputStyle, color: "#78716c", cursor: "default" }}
              />
            </div>

            {/* status */}
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              {(["active", "paused", "archived"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  style={{
                    padding: "5px 14px",
                    borderRadius: "999px",
                    border: status === s
                      ? "1px solid rgba(214,211,209,0.4)"
                      : "1px solid rgba(120,113,108,0.3)",
                    background: status === s
                      ? "rgba(120,113,108,0.25)"
                      : "rgba(41,37,36,0.4)",
                    fontSize: "12px",
                    fontWeight: status === s ? 600 : 400,
                    color: status === s ? "#f5f5f4" : "#78716c",
                    cursor: "pointer",
                    transition: "all 120ms ease",
                    textTransform: "capitalize",
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* error */}
          {error ? (
            <p style={{ marginTop: "12px", fontSize: "13px", color: "#d6d3d1" }}>{error}</p>
          ) : null}
        </div>

        {/* footer */}
        <div style={{
          display: "flex",
          justifyContent: "flex-end",
          padding: "14px 20px",
          borderTop: "1px solid rgba(120,113,108,0.2)",
        }}>
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={submitting || name.trim().length < 2}
            style={{
              padding: "8px 20px",
              borderRadius: "10px",
              border: "1px solid rgba(120,113,108,0.4)",
              background: name.trim().length >= 2 ? "rgba(168,162,158,0.2)" : "rgba(41,37,36,0.4)",
              fontSize: "13px",
              fontWeight: 600,
              color: name.trim().length >= 2 ? "#f5f5f4" : "#57534e",
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
