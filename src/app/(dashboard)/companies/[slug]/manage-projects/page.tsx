"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useParams } from "next/navigation";
import { Archive, Eye, EyeOff, FolderKanban, Pause, Play, Plus, Search } from "lucide-react";

import { CompanyErrorState } from "@/components/company/company-ui";
import { CreateProjectModal } from "@/components/orchestration/CreateProjectModal";
import { listCompanies, listProjects, updateProjectSettings } from "@/lib/orchestration/client";
import { buildCanonicalProjectTasksPath } from "@/lib/orchestration/route-paths";
import { useHiddenProjects } from "@/lib/hidden-project-state";
import type { OrchestrationCompany, OrchestrationProject } from "@/lib/orchestration/types";
import { color, type as T, space, radius } from "@/lib/ui/tokens";
import { PageHeader } from "@/lib/ui/primitives";

type FilterMode = "active" | "paused" | "archived" | "all";

export default function ManageProjectsPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? "";

  const [company, setCompany] = useState<OrchestrationCompany | null>(null);
  const [projects, setProjects] = useState<OrchestrationProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterMode>("active");
  const { hiddenProjects, setHidden } = useHiddenProjects(slug);
  const [busyProjectId, setBusyProjectId] = useState<string | null>(null);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [companyRows, activeRows, archivedRows] = await Promise.all([
          listCompanies(),
          listProjects({ company: slug, includeArchived: false }),
          listProjects({ company: slug, includeArchived: true }),
        ]);
        if (cancelled) return;
        const current = companyRows.find((row) => row.slug === slug) ?? null;
        setCompany(current);
        if (!current) { setProjects([]); return; }

        const merged = new Map<string, OrchestrationProject>();
        for (const project of archivedRows) merged.set(project.id, project);
        for (const project of activeRows) merged.set(project.id, project);

        setProjects(Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name)));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [slug]);

  const filteredProjects = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return projects.filter((project) => {
      if (filter !== "all" && project.status !== filter) return false;
      if (!needle) return true;
      return `${project.name} ${project.description} ${project.slug}`.toLowerCase().includes(needle);
    });
  }, [filter, projects, query]);

  const counts = useMemo(() => {
    return projects.reduce(
      (acc, project) => {
        acc.all += 1;
        if (project.status === "active") acc.active += 1;
        if (project.status === "paused") acc.paused += 1;
        if (project.status === "archived") acc.archived += 1;
        if (project.status !== "archived" && hiddenProjects[project.id]) acc.hidden += 1;
        return acc;
      },
      { all: 0, active: 0, paused: 0, archived: 0, hidden: 0 },
    );
  }, [hiddenProjects, projects]);

  if (!loading && !company) {
    return <CompanyErrorState title="Company not found" detail="This company could not be resolved from orchestration data." href="/" />;
  }

  const updateStatus = async (project: OrchestrationProject, status: "active" | "paused" | "archived") => {
    setBusyProjectId(project.id);
    const updated = await updateProjectSettings({ projectIdOrSlug: project.id, status });
    if (updated) {
      setProjects((prev) => prev.map((c) => (c.id === project.id ? updated : c)));
    }
    setBusyProjectId(null);
  };

  return (
    <div style={{ padding: `${space.lg}px ${space.xl}px`, color: color.text, fontSize: T.body.size }}>
      <PageHeader
        icon={<FolderKanban size={16} />}
        title="Manage Projects"
        description="Control visibility, status, and lifecycle for all projects in this company."
        actions={
          <button
            type="button"
            onClick={() => setCreateProjectOpen(true)}
            style={{
              display: "inline-flex", alignItems: "center", gap: space.sm,
              padding: `${space.sm}px ${space.md}px`, borderRadius: radius.md,
              border: `1px solid ${color.border}`, background: color.surface,
              color: color.text, fontSize: T.bodySmall.size, fontWeight: 500,
              cursor: "pointer",
            }}
          >
            <Plus size={14} /> New project
          </button>
        }
      />

      {/* ── Toolbar ── */}
      <div style={{
        display: "flex", flexWrap: "wrap", alignItems: "center",
        gap: space.sm, marginBottom: space.lg,
      }}>
        <div style={{ position: "relative", flex: 1, minWidth: 200, maxWidth: 360 }}>
          <Search size={14} style={{
            position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)",
            color: color.textMuted, pointerEvents: "none",
          }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects"
            style={{
              width: "100%", padding: `${space.sm}px ${space.md}px ${space.sm}px 32px`,
              borderRadius: radius.md, border: `1px solid ${color.border}`,
              background: color.surface, color: color.text,
              fontSize: T.body.size, outline: "none",
            }}
          />
        </div>
        {([
          ["active", `${counts.active} active`],
          ["paused", `${counts.paused} paused`],
          ["archived", `${counts.archived} archived`],
          ["all", `${counts.all} total`],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            style={{
              padding: `${space.sm}px ${space.md}px`, borderRadius: radius.md,
              border: `1px solid ${filter === value ? color.borderStrong : color.border}`,
              background: filter === value ? "rgba(255,255,255,0.06)" : "transparent",
              color: filter === value ? color.text : color.textSecondary,
              fontSize: T.body.size, cursor: "pointer",
            }}
          >
            {label}
          </button>
        ))}
        <span style={{ marginLeft: "auto", fontSize: T.caption.size, color: color.textMuted }}>
          {counts.hidden} hidden from dock
        </span>
      </div>

      {/* ── Table ── */}
      <div style={{
        borderRadius: radius.lg, border: `1px solid ${color.border}`,
        background: color.surface, overflow: "hidden",
      }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: T.body.size }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${color.border}`, background: "rgba(255,255,255,0.02)" }}>
              {["Project", "Actions"].map((h) => (
                <th key={h} style={{
                  padding: `${space.md}px ${space.lg}px`,
                  fontSize: T.sectionLabel.size, fontWeight: T.sectionLabel.weight,
                  letterSpacing: T.sectionLabel.letterSpacing, textTransform: "uppercase",
                  color: color.textMuted, textAlign: h === "Actions" ? "right" : "left",
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={2} style={{ padding: `${space.xxxl}px ${space.lg}px`, textAlign: "center", color: color.textMuted }}>
                  Loading projects...
                </td>
              </tr>
            ) : filteredProjects.length === 0 ? (
              <tr>
                <td colSpan={2} style={{ padding: `${space.xxxl}px ${space.lg}px`, textAlign: "center", color: color.textMuted }}>
                  No projects match this filter.
                </td>
              </tr>
            ) : (
              filteredProjects.map((project) => {
                const hidden = Boolean(hiddenProjects[project.id]);
                const busy = busyProjectId === project.id;
                const projectTasksHref = buildCanonicalProjectTasksPath(
                  company?.code ?? slug.slice(0, 3).toUpperCase(),
                  project.slug || project.id,
                );
                return (
                  <tr key={project.id} style={{ borderBottom: `1px solid ${color.border}` }}>
                    {/* Project */}
                    <td style={{ padding: `${space.md}px ${space.lg}px`, verticalAlign: "top" }}>
                      <Link href={projectTasksHref} style={{ fontWeight: 500, color: color.text, textDecoration: "none" }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = color.text; e.currentTarget.style.textDecoration = "underline"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = color.text; e.currentTarget.style.textDecoration = "none"; }}
                      >
                        {project.name}
                      </Link>
                      <div style={{ fontSize: T.caption.size, color: color.textMuted, marginTop: 2 }}>{project.slug}</div>
                      {project.description ? (
                        <div style={{ fontSize: T.bodySmall.size, color: color.textSecondary, marginTop: 4 }}>{project.description}</div>
                      ) : null}
                    </td>
                    {/* Actions */}
                    <td style={{ padding: `${space.md}px ${space.lg}px`, verticalAlign: "top", textAlign: "right" }}>
                      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: space.sm }}>
                        {project.status === "archived" ? (
                          <TableAction
                            icon={<Play size={13} />}
                            label="Restore"
                            disabled={busy}
                            onClick={() => void updateStatus(project, "active")}
                          />
                        ) : (
                          <TableAction
                            icon={hidden ? <Eye size={13} /> : <EyeOff size={13} />}
                            label={hidden ? "Unhide" : "Hide"}
                            disabled={busy}
                            onClick={() => setHidden(project.id, !hidden)}
                          />
                        )}
                        {project.status !== "archived" && (
                          project.status === "paused" ? (
                            <TableAction
                              icon={<Play size={13} />}
                              label="Resume"
                              disabled={busy}
                              onClick={() => void updateStatus(project, "active")}
                            />
                          ) : (
                            <TableAction
                              icon={<Pause size={13} />}
                              label="Pause"
                              disabled={busy}
                              onClick={() => void updateStatus(project, "paused")}
                            />
                          )
                        )}
                        {project.status !== "archived" && (
                          <TableAction
                            icon={<Archive size={13} />}
                            label="Archive"
                            disabled={busy}
                            onClick={() => void updateStatus(project, "archived")}
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {company && mounted && createPortal(
        <CreateProjectModal
          open={createProjectOpen}
          onClose={() => setCreateProjectOpen(false)}
          onCreated={(project) => {
            setCreateProjectOpen(false);
            const createdProject: OrchestrationProject = {
              id: project.id,
              slug: project.slug,
              name: project.name,
              description: "",
              emoji: "",
              color: "#0ea5e9",
              owner: "",
              status: "active",
              created: new Date().toISOString(),
              taskCount: 0,
              inProgress: 0,
              backlog: 0,
              review: 0,
              completed: 0,
            };
            setProjects((prev) => [...prev, createdProject].sort((a, b) => a.name.localeCompare(b.name)));
          }}
          companyId={company.id}
          companyCode={company.code}
        />,
        document.body,
      )}
    </div>
  );
}

/* ─── Sub-components ─── */

function TableAction({
  icon, label, onClick, disabled, href,
}: {
  icon?: React.ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  href?: string;
}) {
  const style: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: 4,
    padding: `4px ${space.sm}px`, borderRadius: radius.sm,
    border: `1px solid ${color.border}`, background: "transparent",
    color: color.text, fontSize: T.caption.size,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    textDecoration: "none",
  };

  if (href) {
    return <Link href={href} style={style}>{icon}{label}</Link>;
  }

  return (
    <button type="button" disabled={disabled} onClick={onClick} style={style}>
      {icon}{label}
    </button>
  );
}
