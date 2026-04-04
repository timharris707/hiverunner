"use client";

import { useState, useEffect, use } from "react";
import { Grid3X3, List, RefreshCw } from "lucide-react";
import { FileBrowser } from "@/components/FileBrowser";
import { listProjects } from "@/lib/orchestration/client";
import type { OrchestrationProject } from "@/lib/orchestration/types";

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

  const C = {
    card: "rgba(28,25,23,0.6)",
    cardBorder: "rgba(120,113,108,0.18)",
    text: "#f5f5f4",
    textSec: "#a8a29e",
    muted: "#57534e",
  };

  if (loading) return <div style={{ padding: 32, color: C.muted, fontSize: 13 }}>Loading files...</div>;
  if (!project) return <div style={{ padding: 32, color: "#fca5a5", fontSize: 13 }}>Project not found.</div>;

  // Use project slug as workspace identifier — the files API resolves this
  const workspaceId = `project-${project.slug ?? project.id}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#0c0a09" }}>
      {/* header */}
      <div style={{ padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <span style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            FILES — {project.name}
          </span>
          <p style={{ margin: "2px 0 0", fontSize: 12, color: C.textSec }}>
            Browse project workspace files
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            onClick={() => setViewMode(viewMode === "list" ? "grid" : "list")}
            style={{
              display: "grid", placeItems: "center",
              width: 28, height: 28, borderRadius: 6,
              border: `1px solid ${C.cardBorder}`, background: C.card,
              color: C.textSec, cursor: "pointer",
            }}
          >
            {viewMode === "list" ? <Grid3X3 size={13} /> : <List size={13} />}
          </button>
        </div>
      </div>

      {/* file browser — scoped to project workspace */}
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
