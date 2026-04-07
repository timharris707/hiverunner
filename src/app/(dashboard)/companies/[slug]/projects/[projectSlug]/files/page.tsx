"use client";

import { useState, useEffect, use } from "react";
import { Grid3X3, List } from "lucide-react";
import { FileBrowser } from "@/components/FileBrowser";
import { listProjects } from "@/lib/orchestration/client";
import type { OrchestrationProject } from "@/lib/orchestration/types";
import { PageHeader } from "@/lib/ui/primitives";
import { P, font, radius, space } from "@/lib/ui/tokens";

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

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const projects = await listProjects({ company: slug });
      if (cancelled) return;
      setProject(projects.find((p) => p.slug === projectSlug || p.id === projectSlug) ?? null);
      setLoading(false);
    };
    void load();
    return () => { cancelled = true; };
  }, [slug, projectSlug]);

  if (loading) return <div style={{ padding: 32, color: P.muted, fontSize: 13 }}>Loading files...</div>;
  if (!project) return <div style={{ padding: 32, color: P.error, fontSize: 13 }}>Project not found.</div>;

  const workspaceId = `project-${project.slug ?? project.id}`;

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

      <div style={{ flex: 1, overflow: "auto" }}>
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
