"use client";

import { use, useEffect, useState } from "react";
import { formatAge } from "@/components/orchestration/ui";
import { listProjects } from "@/lib/orchestration/client";
import type { OrchestrationProject } from "@/lib/orchestration/types";

const C = {
  bg: "#0c0a09",
  card: "rgba(28,25,23,0.6)",
  cardBorder: "rgba(120,113,108,0.18)",
  text: "#f5f5f4",
  textSec: "#a8a29e",
  muted: "#57534e",
  divider: "rgba(120,113,108,0.15)",
};

export default function ProjectOverviewPage({
  params,
}: {
  params: Promise<{ slug: string; projectSlug: string }>;
}) {
  const { slug, projectSlug } = use(params);
  const [project, setProject] = useState<OrchestrationProject | null>(null);
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

  if (loading) return <div style={{ padding: 32, color: C.muted, fontSize: 13 }}>Loading...</div>;
  if (!project) return <div style={{ padding: 32, color: "#fca5a5", fontSize: 13 }}>Project not found.</div>;

  const STATUS_STYLE: Record<string, { color: string; bg: string }> = {
    active: { color: "#22c55e", bg: "rgba(34,197,94,0.12)" },
    "in-progress": { color: "#22c55e", bg: "rgba(34,197,94,0.12)" },
    paused: { color: "#eab308", bg: "rgba(234,179,8,0.12)" },
    archived: { color: "#57534e", bg: "rgba(87,83,78,0.12)" },
  };
  const st = STATUS_STYLE[project.status] ?? { color: C.textSec, bg: "rgba(168,162,158,0.12)" };

  return (
    <div style={{ padding: "20px 24px", maxWidth: 700 }}>
      {/* project name */}
      <h1 style={{ margin: "0 0 16px", fontSize: 22, fontWeight: 600, color: C.text }}>
        {project.name}
      </h1>

      {/* description */}
      <p style={{ margin: "0 0 20px", fontSize: 14, color: project.description ? C.textSec : C.muted, fontStyle: project.description ? "normal" : "italic" }}>
        {project.description || "Add a description..."}
      </p>

      {/* properties */}
      <div style={{
        borderRadius: 10, border: `1px solid ${C.cardBorder}`,
        background: C.card, padding: "16px 20px",
        display: "flex", flexDirection: "column", gap: 14,
      }}>
        <PropRow label="Status">
          <span style={{
            fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 4,
            color: st.color, background: st.bg,
          }}>
            {project.status}
          </span>
        </PropRow>

        <PropRow label="Created">
          <span style={{ fontSize: 13, color: C.textSec }}>
            {project.created ? new Date(project.created).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}
          </span>
        </PropRow>

        <PropRow label="Updated">
          <span style={{ fontSize: 13, color: C.textSec }}>
            {project.created ? new Date(project.created).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}
          </span>
        </PropRow>

        <PropRow label="Tasks">
          <span style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>
            {project.taskCount ?? 0}
          </span>
        </PropRow>
      </div>
    </div>
  );
}

function PropRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <span style={{ width: 80, fontSize: 12, color: "#57534e" }}>{label}</span>
      <div>{children}</div>
    </div>
  );
}
