"use client";

import { use, useEffect, useState } from "react";
import { listProjects } from "@/lib/orchestration/client";
import type { OrchestrationProject } from "@/lib/orchestration/types";
import { ProjectTabBar } from "../ProjectTabBar";
import { PageHeader } from "@/lib/ui/primitives";
import { P, color, font, radius, space } from "@/lib/ui/tokens";

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

  if (loading) return <div style={{ padding: 32, color: P.muted, fontSize: 13 }}>Loading...</div>;
  if (!project) return <div style={{ padding: 32, color: P.error, fontSize: 13 }}>Project not found.</div>;

  const STATUS_STYLE: Record<string, { color: string; bg: string }> = {
    active: { color: color.positive, bg: color.positiveSoft },
    "in-progress": { color: color.positive, bg: color.positiveSoft },
    paused: { color: color.warning, bg: color.warningSoft },
    archived: { color: P.muted, bg: "rgba(87,83,78,0.12)" },
  };
  const st = STATUS_STYLE[project.status] ?? { color: P.textSec, bg: "rgba(168,162,158,0.12)" };

  return (
    <div style={{ minHeight: "100%", padding: `${space.md}px ${space.xl}px`, color: P.text, fontFamily: font.body }}>
      <PageHeader
        icon={<span style={{ display: "inline-block", width: 14, height: 14, borderRadius: radius.full, background: project.color ?? P.accent }} />}
        title={project.name}
      />

      <div style={{ marginTop: space.xs, marginBottom: space.md }}>
        <ProjectTabBar slug={slug} projectSlug={projectSlug} active="overview" />
      </div>

      <div style={{ maxWidth: 700 }}>
        <p style={{ margin: "0 0 20px", fontSize: 13, color: project.description ? P.textSec : P.muted, fontStyle: project.description ? "normal" : "italic" }}>
          {project.description || "Add a description..."}
        </p>

        <div style={{
          borderRadius: radius.lg, border: `0.5px solid ${P.cardBorder}`,
          background: P.surface, padding: "16px 20px",
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
            <span style={{ fontSize: 13, color: P.textSec }}>
              {project.created ? new Date(project.created).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "\u2014"}
            </span>
          </PropRow>

          <PropRow label="Updated">
            <span style={{ fontSize: 13, color: P.textSec }}>
              {project.created ? new Date(project.created).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "\u2014"}
            </span>
          </PropRow>

          <PropRow label="Tasks">
            <span style={{ fontSize: 13, color: P.text, fontWeight: 600 }}>
              {project.taskCount ?? 0}
            </span>
          </PropRow>
        </div>
      </div>
    </div>
  );
}

function PropRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <span style={{ width: 80, fontSize: 12, color: P.muted }}>{label}</span>
      <div>{children}</div>
    </div>
  );
}
