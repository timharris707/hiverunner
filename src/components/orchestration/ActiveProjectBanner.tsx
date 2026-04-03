"use client";

import Link from "next/link";
import { Check, FolderKanban, Plus, X } from "lucide-react";

import { buildCompanyPath } from "@/lib/orchestration/route-paths";
import type { OrchestrationProject } from "@/lib/orchestration/types";

type Props = {
  companySlug: string;
  project: OrchestrationProject;
  onClear?: () => void;
  compact?: boolean;
};

export function ActiveProjectBanner({ companySlug, project, onClear, compact = false }: Props) {
  const btnStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    borderRadius: "10px",
    border: "1px solid rgba(120,113,108,0.35)",
    background: "rgba(41,37,36,0.5)",
    padding: "6px 12px",
    fontSize: "12px",
    color: "#d6d3d1",
    textDecoration: "none",
    cursor: "pointer",
    transition: "all 120ms ease",
  };

  return (
    <section
      style={{
        borderRadius: "14px",
        border: "1px solid rgba(120,113,108,0.25)",
        background: "rgba(28,25,23,0.65)",
        padding: "12px 16px",
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0 }}>
          <span
            style={{
              display: "inline-flex",
              width: "36px",
              height: "36px",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "10px",
              border: "1px solid rgba(120,113,108,0.3)",
              background: "rgba(41,37,36,0.5)",
              color: "#a8a29e",
              flexShrink: 0,
            }}
          >
            <FolderKanban size={16} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  borderRadius: "999px",
                  border: "1px solid rgba(120,113,108,0.3)",
                  background: "rgba(41,37,36,0.5)",
                  padding: "2px 8px",
                  fontSize: "10px",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.12em",
                  color: "#a8a29e",
                }}
              >
                <Check size={10} />
                Active project
              </span>
              <span style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.14em", color: "#57534e" }}>
                {project.slug}
              </span>
            </div>
            <p style={{ marginTop: "4px", fontSize: "13px", fontWeight: 600, color: "#f5f5f4", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {project.name}
            </p>
            {!compact ? (
              <p style={{ marginTop: "2px", fontSize: "12px", color: "#78716c" }}>
                {project.description || "Global project context is pinned across this company workspace."}
              </p>
            ) : null}
          </div>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
          <Link
            href={buildCompanyPath(companySlug, `/projects/${encodeURIComponent(project.slug || project.id)}/board`)}
            style={btnStyle}
          >
            Open board
          </Link>
          <Link
            href={`/companies/${encodeURIComponent(companySlug)}/issues/new?projectId=${encodeURIComponent(project.id)}`}
            style={btnStyle}
          >
            <Plus size={12} />
            New task in project
          </Link>
          {onClear ? (
            <button
              type="button"
              onClick={onClear}
              style={{ ...btnStyle, border: "1px solid rgba(120,113,108,0.25)" }}
            >
              <X size={12} />
              Clear
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
