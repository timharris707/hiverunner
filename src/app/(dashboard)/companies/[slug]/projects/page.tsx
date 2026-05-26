"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Plus } from "lucide-react";
import { listCompanies, listProjects } from "@/lib/orchestration/client";
import { buildCanonicalProjectTasksPath } from "@/lib/orchestration/route-paths";
import type { OrchestrationCompany, OrchestrationProject } from "@/lib/orchestration/types";
import { P as tokens } from "@/lib/ui/tokens";

const P = {
  text: tokens.text,
  textSec: tokens.textSec,
  muted: tokens.muted,
  cardBorder: tokens.cardBorder,
  card: tokens.surface,
};

const STATUS_COLORS: Record<string, { color: string; bg: string }> = {
  active: { color: "var(--positive)", bg: "var(--positive-soft)" },
  "in progress": { color: "var(--warning)", bg: "var(--warning-soft)" },
  "in-progress": { color: "var(--warning)", bg: "var(--warning-soft)" },
  planned: { color: "var(--text-muted)", bg: "var(--surface-hover)" },
  paused: { color: "var(--warning)", bg: "var(--warning-soft)" },
  archived: { color: "var(--text-muted)", bg: "var(--surface-hover)" },
};

export default function CompanyProjectsPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? "";

  const [company, setCompany] = useState<OrchestrationCompany | null>(null);
  const [projects, setProjects] = useState<OrchestrationProject[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const [companyRows, projectRows] = await Promise.all([
        listCompanies(),
        listProjects({ company: slug }),
      ]);
      if (cancelled) return;
      setCompany(companyRows.find((r) => r.slug === slug) ?? null);
      setProjects(projectRows.sort((a, b) => a.name.localeCompare(b.name)));
      setLoading(false);
    };
    void load();
    return () => { cancelled = true; };
  }, [slug]);

  const cc = company?.code || slug.slice(0, 3).toUpperCase();

  if (!loading && !company) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ padding: 16, borderRadius: 8, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#fca5a5", fontSize: 13 }}>
          Company not found.
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "16px 20px", color: P.text, fontSize: 13 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <h1 style={{
          margin: 0, fontSize: 13, fontWeight: 700,
          letterSpacing: "0.12em", textTransform: "uppercase",
          color: P.textSec, fontFamily: "var(--font-heading)",
        }}>
          Projects
        </h1>
        <Link
          href={`/companies/${encodeURIComponent(slug)}?createProject=1`}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "7px 14px", borderRadius: 6, fontSize: 12, fontWeight: 500,
            background: "transparent", border: `1px solid ${P.cardBorder}`,
            color: P.text, textDecoration: "none", cursor: "pointer",
          }}
        >
          <Plus size={14} /> Add Project
        </Link>
      </div>

      {/* Project list */}
      <div style={{ borderRadius: 8, border: `1px solid ${P.cardBorder}` }}>
        {loading ? (
          <div style={{ padding: 32, textAlign: "center", color: P.muted, fontSize: 12 }}>Loading projects...</div>
        ) : projects.length === 0 ? (
          <div style={{ padding: 32, textAlign: "center", color: P.muted, fontSize: 12 }}>No projects yet.</div>
        ) : (
          projects.map((project) => {
            const sc = STATUS_COLORS[project.status] ?? STATUS_COLORS.active;
            const href = buildCanonicalProjectTasksPath(cc, project.slug || project.id);

            return (
              <Link
                key={project.id}
                href={href}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 14px",
                  borderBottom: `1px solid ${P.cardBorder}`,
                  textDecoration: "none", cursor: "pointer",
                  transition: "background 0.12s",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.02)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                {/* Project info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: P.text }}>{project.name}</div>
                  {project.description && (
                    <div style={{
                      fontSize: 11, color: P.muted, marginTop: 2,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {project.description}
                    </div>
                  )}
                </div>

                {/* Status pill */}
                <span style={{
                  fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 4,
                  color: sc.color, background: sc.bg, flexShrink: 0,
                }}>
                  {project.status}
                </span>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
