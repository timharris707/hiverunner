"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Paperclip, X } from "lucide-react";
import { createTask, listCompanyAgents, listProjects } from "@/lib/orchestration/client";
import { useActiveProjectState } from "@/lib/active-project-state";
import { resolveActiveProject } from "@/lib/active-project-utils";
import type { OrchestrationAgent, OrchestrationProject, TaskPriority, TaskStatus } from "@/lib/orchestration/types";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated?: () => void;
  companySlug: string;
  companyCode: string;
}

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
};

export function CreateTaskModal({ open, onClose, onCreated, companySlug, companyCode }: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState("");
  const [assignee, setAssignee] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("P2");
  const [status, setStatus] = useState<TaskStatus>("backlog");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((newFiles: FileList | File[]) => {
    setFiles((prev) => [...prev, ...Array.from(newFiles)]);
  }, []);

  const removeFile = (idx: number) => setFiles((prev) => prev.filter((_, i) => i !== idx));

  const [projects, setProjects] = useState<OrchestrationProject[]>([]);
  const [agents, setAgents] = useState<OrchestrationAgent[]>([]);
  const { activeProject } = useActiveProjectState();

  const canSubmit = useMemo(() => title.trim().length >= 2 && projectId.length > 0, [title, projectId]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !submitting) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, submitting, onClose]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = async () => {
      const [projectRows, agentRows] = await Promise.all([
        listProjects({ company: companySlug }),
        listCompanyAgents(companySlug),
      ]);
      if (cancelled) return;
      setProjects(projectRows);
      setAgents(agentRows.sort((a, b) => a.name.localeCompare(b.name)));

      const active = resolveActiveProject(projectRows, activeProject, companySlug);
      setProjectId((prev) => prev || active?.id || projectRows[0]?.id || "");
    };
    void load();
    return () => { cancelled = true; };
  }, [open, companySlug, activeProject]);

  const reset = () => {
    setTitle("");
    setDescription("");
    setAssignee("");
    setPriority("P2");
    setStatus("backlog");
    setError(null);
    setFiles([]);
  };

  const handleClose = () => { if (!submitting) { reset(); onClose(); } };

  const handleCreate = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError(null);

    const task = await createTask({
      projectId,
      title: title.trim(),
      description: description.trim(),
      priority,
      type: "feature",
      status,
      ...(assignee ? { assignee } : {}),
    });

    setSubmitting(false);
    if (!task) { setError("Failed to create task. Please try again."); return; }
    reset();
    onCreated?.();
    onClose();
  };

  if (!open) return null;

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(12,10,9,0.7)", backdropFilter: "blur(6px)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div role="dialog" aria-modal="true" aria-label="Create new task" style={{ width: "100%", maxWidth: "480px", borderRadius: "16px", border: "1px solid rgba(120,113,108,0.3)", background: "linear-gradient(180deg, rgba(41,37,36,0.95), rgba(20,17,15,0.98))", boxShadow: "0 24px 60px rgba(0,0,0,0.5)", overflow: "hidden" }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", borderBottom: "1px solid rgba(120,113,108,0.2)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "3px 8px", borderRadius: "6px", border: "1px solid rgba(120,113,108,0.35)", background: "rgba(41,37,36,0.6)", fontSize: "11px", fontWeight: 700, letterSpacing: "0.08em", color: "#a8a29e" }}>{companyCode}</span>
            <span style={{ fontSize: "13px", color: "#78716c" }}>›</span>
            <span style={{ fontSize: "14px", fontWeight: 600, color: "#f5f5f4" }}>New Task</span>
          </div>
          <button type="button" onClick={handleClose} style={{ width: "28px", height: "28px", borderRadius: "8px", border: "1px solid rgba(120,113,108,0.25)", background: "transparent", color: "#78716c", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <X size={14} />
          </button>
        </div>

        {/* body */}
        <div style={{ padding: "20px" }}>
          {/* title — large */}
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Task title"
            autoFocus
            style={{ ...inputStyle, fontSize: "20px", fontWeight: 500, border: "none", background: "transparent", padding: "0 0 8px", borderBottom: "1px solid rgba(120,113,108,0.2)", borderRadius: 0 }}
          />

          {/* for / assignee / in / project row */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "12px", flexWrap: "wrap" }}>
            <span style={{ fontSize: "12px", color: "#57534e" }}>For</span>
            <select value={assignee} onChange={(e) => setAssignee(e.target.value)} style={{ ...inputStyle, width: "auto", padding: "4px 8px", fontSize: "12px", borderRadius: "6px", border: "1px solid rgba(120,113,108,0.25)", background: "rgba(41,37,36,0.4)" }}>
              <option value="">Assignee</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <span style={{ fontSize: "12px", color: "#57534e" }}>in</span>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} style={{ ...inputStyle, width: "auto", padding: "4px 8px", fontSize: "12px", borderRadius: "6px", border: "1px solid rgba(120,113,108,0.25)", background: "rgba(41,37,36,0.4)" }}>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          {/* description */}
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Add description..."
            rows={3}
            style={{ ...inputStyle, marginTop: "12px", border: "none", background: "transparent", padding: "0", resize: "vertical", minHeight: "60px", fontSize: "14px", color: description ? "#d6d3d1" : undefined }}
          />

          {/* file attachments */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}
            onClick={() => fileInputRef.current?.click()}
            style={{
              marginTop: "12px",
              borderRadius: "10px",
              border: dragOver ? "1px dashed rgba(168,162,158,0.5)" : "1px dashed rgba(120,113,108,0.25)",
              background: dragOver ? "rgba(41,37,36,0.3)" : "transparent",
              padding: files.length > 0 ? "8px 12px" : "12px",
              cursor: "pointer",
              transition: "all 120ms ease",
            }}
          >
            <input ref={fileInputRef} type="file" multiple hidden onChange={(e) => { if (e.target.files?.length) { addFiles(e.target.files); e.target.value = ""; } }} />
            {files.length === 0 ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
                <Paperclip size={12} style={{ color: "#57534e" }} />
                <span style={{ fontSize: "12px", color: "#57534e" }}>Drop files here or click to attach</span>
              </div>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                {files.map((f, i) => (
                  <span key={`${f.name}-${i}`} style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "3px 8px", borderRadius: "6px", border: "1px solid rgba(120,113,108,0.25)", background: "rgba(41,37,36,0.4)", fontSize: "11px", color: "#a8a29e" }}>
                    <Paperclip size={10} />
                    {f.name.length > 24 ? `${f.name.slice(0, 22)}…` : f.name}
                    <button type="button" onClick={(e) => { e.stopPropagation(); removeFile(i); }} style={{ background: "none", border: "none", color: "#78716c", cursor: "pointer", padding: 0, display: "flex" }}><X size={10} /></button>
                  </span>
                ))}
                <span style={{ fontSize: "11px", color: "#57534e", alignSelf: "center" }}>+ more</span>
              </div>
            )}
          </div>

          {/* bottom pills: status + priority */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "16px", paddingTop: "12px", borderTop: "1px solid rgba(120,113,108,0.12)" }}>
            <select value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)} style={{ ...inputStyle, width: "auto", padding: "4px 10px", fontSize: "11px", borderRadius: "999px", border: "1px solid rgba(120,113,108,0.25)", background: "rgba(41,37,36,0.4)" }}>
              <option value="backlog">Todo</option>
              <option value="on-deck">On Deck</option>
              <option value="in-progress">In Progress</option>
            </select>
            <span style={{ fontSize: "11px", color: "#57534e" }}>—</span>
            <select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)} style={{ ...inputStyle, width: "auto", padding: "4px 10px", fontSize: "11px", borderRadius: "999px", border: "1px solid rgba(120,113,108,0.25)", background: "rgba(41,37,36,0.4)" }}>
              <option value="P0">P0</option>
              <option value="P1">P1</option>
              <option value="P2">P2</option>
              <option value="P3">P3</option>
            </select>
          </div>

          {error ? <p style={{ marginTop: "12px", fontSize: "13px", color: "#d6d3d1" }}>{error}</p> : null}
        </div>

        {/* footer */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", borderTop: "1px solid rgba(120,113,108,0.2)" }}>
          <button type="button" onClick={handleClose} style={{ background: "none", border: "none", fontSize: "13px", color: "#57534e", cursor: "pointer" }}>
            Discard Draft
          </button>
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={submitting || !canSubmit}
            style={{ padding: "8px 20px", borderRadius: "10px", border: "1px solid rgba(120,113,108,0.4)", background: canSubmit ? "rgba(168,162,158,0.2)" : "rgba(41,37,36,0.4)", fontSize: "13px", fontWeight: 600, color: canSubmit ? "#f5f5f4" : "#57534e", cursor: canSubmit ? "pointer" : "default", transition: "all 120ms ease", opacity: submitting ? 0.6 : 1 }}
          >
            {submitting ? "Creating..." : "Create Task"}
          </button>
        </div>
      </div>
    </div>
  );
}
