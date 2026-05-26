"use client";

import { useState, useEffect, use } from "react";
import { Grid3X3, List } from "lucide-react";
import { FileBrowser } from "@/components/FileBrowser";
import { listProjects } from "@/lib/orchestration/client";
import type { OrchestrationProject } from "@/lib/orchestration/types";
import { PageHeader } from "@/lib/ui/primitives";
import { P, font, radius, space } from "@/lib/ui/tokens";

type Workspace = {
  id: string;
  name: string;
  kind?: string;
  path: string;
  exists?: boolean;
  description?: string;
  projectId?: string;
  projectSlug?: string;
};

export default function ProjectFilesPage({
  params,
}: {
  params: Promise<{ slug: string; projectSlug: string }>;
}) {
  const { slug, projectSlug } = use(params);
  const [project, setProject] = useState<OrchestrationProject | null>(null);
  const [currentPath, setCurrentPath] = useState("");
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [loading, setLoading] = useState(true);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const [projects, workspaceRes] = await Promise.all([
        listProjects({ company: slug }),
        fetch(`/api/files/workspaces?company=${encodeURIComponent(slug)}`),
      ]);
      if (cancelled) return;
      const nextProject = projects.find((p) => p.slug === projectSlug || p.id === projectSlug) ?? null;
      setProject(nextProject);
      const workspaceData = await workspaceRes.json().catch(() => ({ workspaces: [] }));
      const projectWorkspaces = ((workspaceData.workspaces || []) as Workspace[])
        .filter((workspace) =>
          workspace.projectId === nextProject?.id &&
          (workspace.kind === "project_files" || workspace.kind === "project_source")
        );
      setWorkspaces(projectWorkspaces);
      setSelectedWorkspaceId((projectWorkspaces.find((workspace) => workspace.kind === "project_source" && workspace.exists !== false)
        ?? projectWorkspaces.find((workspace) => workspace.exists !== false)
        ?? projectWorkspaces[0]
        ?? null)?.id ?? null);
      setLoading(false);
    };
    void load();
    return () => { cancelled = true; };
  }, [slug, projectSlug]);

  if (loading) return <div style={{ padding: 32, color: P.muted, fontSize: 13 }}>Loading files...</div>;
  if (!project) return <div style={{ padding: 32, color: P.error, fontSize: 13 }}>Project not found.</div>;

  const selectedWorkspace = workspaces.find((workspace) => workspace.id === selectedWorkspaceId);
  const workspaceId = selectedWorkspace?.id ?? `project:${project.id}:files`;

  return (
    <div style={{ minHeight: "100%", padding: `${space.md}px ${space.xl}px`, color: P.text, fontFamily: font.body }}>
      <PageHeader
        icon={<span style={{ display: "inline-block", width: 14, height: 14, borderRadius: radius.full, background: project.color ?? P.accent }} />}
        title={project.name}
        actions={
          <button
            type="button"
            onClick={() => setViewMode(viewMode === "list" ? "grid" : "list")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 34,
              height: 34,
              borderRadius: radius.md,
              border: `0.5px solid ${P.cardBorder}`,
              background: "transparent",
              color: P.textSec,
              cursor: "pointer",
            }}
            title={viewMode === "list" ? "Grid view" : "List view"}
          >
            {viewMode === "list" ? <Grid3X3 size={14} /> : <List size={14} />}
          </button>
        }
      />

      {workspaces.length > 1 && (
        <div style={{ display: "flex", gap: 8, marginBottom: space.md, flexWrap: "wrap" }}>
          {workspaces.map((workspace) => {
            const selected = workspace.id === workspaceId;
            const missing = workspace.exists === false;
            return (
              <button
                key={workspace.id}
                type="button"
                disabled={missing}
                onClick={() => {
                  setSelectedWorkspaceId(workspace.id);
                  setCurrentPath("");
                }}
                title={workspace.path}
                style={{
                  display: "inline-flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: 2,
                  maxWidth: 360,
                  padding: "8px 10px",
                  borderRadius: radius.md,
                  border: `0.5px solid ${selected ? P.accent : P.cardBorder}`,
                  background: selected ? "var(--surface-hover)" : "transparent",
                  color: missing ? P.muted : P.text,
                  cursor: missing ? "not-allowed" : "pointer",
                  opacity: missing ? 0.58 : 1,
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 600 }}>
                  {workspace.kind === "project_source" ? "Source repo" : "Project files"}
                </span>
                <span
                  style={{
                    maxWidth: "100%",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontFamily: font.mono,
                    fontSize: 11,
                    color: P.muted,
                  }}
                >
                  {workspace.path}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div style={{ flex: 1, overflow: "auto" }}>
        {selectedWorkspace && (
          <div
            title={selectedWorkspace.path}
            style={{
              marginBottom: 8,
              color: P.muted,
              fontFamily: font.mono,
              fontSize: 11,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {selectedWorkspace.path}
          </div>
        )}
        <FileBrowser
          workspace={workspaceId}
          path={currentPath}
          onNavigate={setCurrentPath}
          viewMode={viewMode}
        />
      </div>
    </div>
  );
}
