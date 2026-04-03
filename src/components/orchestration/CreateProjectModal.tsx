"use client";

import { useEffect, useMemo, useState } from "react";
import { FolderOpen, X } from "lucide-react";
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

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span
        style={{
          fontSize: "11px",
          textTransform: "uppercase",
          letterSpacing: "0.16em",
          color: "#a8a29e",
        }}
      >
        {label}
        {required ? <span style={{ marginLeft: "4px", color: "#d6d3d1" }}>*</span> : null}
      </span>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  borderRadius: "12px",
  border: "1px solid rgba(120,113,108,0.35)",
  background: "rgba(28,25,23,0.92)",
  padding: "10px 14px",
  fontSize: "14px",
  color: "#f5f5f4",
  outline: "none",
  transition: "border-color 120ms ease",
};

export function CreateProjectModal({ open, onClose, onCreated, companyId, companyCode, companySlug }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [status, setStatus] = useState<"active" | "paused" | "archived">("active");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slug = slugify(name);
  const localFolder = slug ? `~/.openclaw/workspace/projects/${slug}` : "";
  const canSubmit = useMemo(() => name.trim().length >= 2, [name]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !submitting) handleClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, submitting]);

  const reset = () => {
    setName("");
    setDescription("");
    setRepoUrl("");
    setStatus("active");
    setError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleCreate = async () => {
    if (!canSubmit || submitting) return;

    setSubmitting(true);
    setError(null);

    const project = await createProject({
      companyId,
      name: name.trim(),
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

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "32px 16px",
        background: "rgba(12,10,9,0.72)",
        backdropFilter: "blur(8px)",
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !submitting) handleClose(); }}
    >
      {/* subtle gradient overlay */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(180deg, rgba(12,10,9,0.22), rgba(12,10,9,0.7))",
          pointerEvents: "none",
        }}
      />

      <div style={{ position: "relative", zIndex: 1, width: "100%", maxWidth: "640px" }}>
        {/* header — outside the card, matching agent creation layout */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px", marginBottom: "24px" }}>
          <div>
            <p style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.22em", color: "#78716c" }}>
              {companyCode} · New Project
            </p>
            <h1 style={{ marginTop: "8px", fontSize: "28px", fontWeight: 600, letterSpacing: "-0.01em", color: "#f5f5f4" }}>
              Create a Project
            </h1>
            <p style={{ marginTop: "8px", maxWidth: "480px", fontSize: "14px", color: "#78716c" }}>
              Set up a new project workspace with its own tasks, agents, and configuration.
            </p>
          </div>
          <button
            type="button"
            onClick={() => { if (!submitting) handleClose(); }}
            style={{
              width: "40px",
              height: "40px",
              borderRadius: "12px",
              border: "1px solid rgba(120,113,108,0.35)",
              background: "rgba(28,25,23,0.82)",
              color: "#a8a29e",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              transition: "all 120ms ease",
              flexShrink: 0,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(168,162,158,0.5)"; e.currentTarget.style.color = "#f5f5f4"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(120,113,108,0.35)"; e.currentTarget.style.color = "#a8a29e"; }}
          >
            <X size={18} />
          </button>
        </div>

        {/* card */}
        <div
          style={{
            borderRadius: "24px",
            border: "1px solid rgba(120,113,108,0.25)",
            background: "linear-gradient(165deg, rgba(41,37,36,0.96), rgba(12,10,9,0.99))",
            padding: "24px",
            boxShadow: "0 30px 80px rgba(12,10,9,0.65)",
          }}
        >
          {/* project name */}
          <Field label="Project Name" required>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Weather Trading"
              autoFocus
              style={inputStyle}
            />
          </Field>

          {/* description */}
          <div style={{ marginTop: "16px" }}>
            <Field label="Description">
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What is this project about?"
                rows={3}
                style={{ ...inputStyle, minHeight: "80px", resize: "vertical" }}
              />
            </Field>
          </div>

          {/* repo url + local folder — two column */}
          <div style={{ marginTop: "16px", display: "grid", gap: "16px", gridTemplateColumns: "1fr 1fr" }}>
            <Field label="Repo URL">
              <input
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder="https://github.com/org/repo"
                style={inputStyle}
              />
            </Field>

            <Field label="Local Folder">
              <input
                value={localFolder}
                readOnly
                placeholder="Auto-generated from name"
                style={{ ...inputStyle, color: "#78716c", cursor: "default" }}
              />
            </Field>
          </div>

          {/* status */}
          <div style={{ marginTop: "16px" }}>
            <Field label="Status">
              <div style={{ display: "flex", gap: "8px", marginTop: "2px" }}>
                {(["active", "paused", "archived"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStatus(s)}
                    style={{
                      padding: "8px 18px",
                      borderRadius: "12px",
                      border: status === s
                        ? "1px solid rgba(214,211,209,0.4)"
                        : "1px solid rgba(120,113,108,0.35)",
                      background: status === s
                        ? "rgba(120,113,108,0.2)"
                        : "rgba(28,25,23,0.92)",
                      fontSize: "13px",
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
            </Field>
          </div>

          {/* error */}
          {error ? (
            <div style={{
              marginTop: "16px",
              borderRadius: "12px",
              border: "1px solid rgba(120,113,108,0.3)",
              background: "rgba(28,25,23,0.8)",
              padding: "12px 14px",
              fontSize: "13px",
              color: "#d6d3d1",
            }}>
              {error}
            </div>
          ) : null}

          {/* footer */}
          <div style={{
            marginTop: "24px",
            paddingTop: "20px",
            borderTop: "1px solid rgba(120,113,108,0.2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}>
            <button
              type="button"
              onClick={() => { if (!submitting) handleClose(); }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                fontSize: "13px",
                color: "#78716c",
                background: "none",
                border: "none",
                cursor: "pointer",
                transition: "color 120ms ease",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "#f5f5f4"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "#78716c"; }}
            >
              <FolderOpen size={14} />
              Back to Projects
            </button>

            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={!canSubmit || submitting}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                padding: "10px 20px",
                borderRadius: "12px",
                border: "none",
                background: canSubmit ? "rgba(168,162,158,0.2)" : "rgba(41,37,36,0.5)",
                fontSize: "13px",
                fontWeight: 600,
                color: canSubmit ? "#f5f5f4" : "#57534e",
                cursor: canSubmit ? "pointer" : "default",
                transition: "all 120ms ease",
                opacity: submitting ? 0.6 : 1,
              }}
              onMouseEnter={(e) => { if (canSubmit) e.currentTarget.style.background = "rgba(168,162,158,0.3)"; }}
              onMouseLeave={(e) => { if (canSubmit) e.currentTarget.style.background = "rgba(168,162,158,0.2)"; }}
            >
              <FolderOpen size={14} />
              {submitting ? "Creating..." : "Create Project"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
