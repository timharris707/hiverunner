"use client";

import { use, useEffect, useState } from "react";
import { DollarSign } from "lucide-react";
import { listProjects } from "@/lib/orchestration/client";
import type { OrchestrationProject } from "@/lib/orchestration/types";
import { ProjectTabBar } from "../ProjectTabBar";
import { PageHeader } from "@/lib/ui/primitives";
import { P, font, radius, space } from "@/lib/ui/tokens";

export default function ProjectBudgetPage({
  params,
}: {
  params: Promise<{ slug: string; projectSlug: string }>;
}) {
  const { slug, projectSlug } = use(params);
  const [project, setProject] = useState<OrchestrationProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [budgetInput, setBudgetInput] = useState("0.00");

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

  return (
    <div style={{ minHeight: "100%", padding: `${space.md}px ${space.xl}px`, color: P.text, fontFamily: font.body }}>
      <PageHeader
        icon={<span style={{ display: "inline-block", width: 14, height: 14, borderRadius: radius.full, background: project.color ?? P.accent }} />}
        title={project.name}
      />

      <div style={{ marginTop: space.xs, marginBottom: space.md }}>
        <ProjectTabBar slug={slug} projectSlug={projectSlug} active="budget" />
      </div>

      <div style={{ maxWidth: 700 }}>
        {/* Summary — flat rows on canvas */}
        <div style={{ display: "flex", gap: space.xxxl, marginBottom: space.xl }}>
          <div>
            <p style={{ margin: 0, fontSize: 11, fontWeight: 600, color: P.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>Observed</p>
            <p style={{ margin: "6px 0 0", fontSize: 28, fontWeight: 700, color: P.text }}>$0.00</p>
          </div>
          <div>
            <p style={{ margin: 0, fontSize: 11, fontWeight: 600, color: P.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>Budget</p>
            <p style={{ margin: "6px 0 0", fontSize: 28, fontWeight: 700, color: P.text }}>Disabled</p>
            <p style={{ margin: "2px 0 0", fontSize: 11, color: P.muted }}>Soft alert at 80%</p>
          </div>
        </div>

        {/* Progress bar */}
        <div style={{ marginBottom: space.xl }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 12, color: P.muted }}>
            <span>Remaining</span>
            <span>Unlimited</span>
          </div>
          <div style={{ height: 4, borderRadius: 999, background: P.cardBorder, overflow: "hidden" }}>
            <div style={{ height: "100%", width: "0%", borderRadius: 999, background: P.textSec }} />
          </div>
        </div>

        {/* Budget input — flat on canvas */}
        <div style={{ marginBottom: space.xl }}>
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: P.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
            Budget (USD)
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ position: "relative", flex: 1 }}>
              <DollarSign size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: P.muted }} />
              <input
                value={budgetInput}
                onChange={(e) => setBudgetInput(e.target.value)}
                style={{
                  width: "100%", borderRadius: radius.md,
                  border: `0.5px solid ${P.cardBorder}`,
                  background: "transparent",
                  padding: "10px 14px 10px 30px",
                  fontSize: 16, fontWeight: 600, color: P.text,
                  outline: "none",
                }}
              />
            </div>
            <button
              type="button"
              style={{
                padding: "10px 20px", borderRadius: radius.md,
                border: `0.5px solid ${P.cardBorder}`,
                background: "transparent",
                fontSize: 13, fontWeight: 600, color: P.text,
                cursor: "pointer",
              }}
            >
              Set budget
            </button>
          </div>
        </div>

        {/* Cost breakdown — flat rows */}
        <div>
          <h3 style={{ margin: `0 0 ${space.sm}px`, fontSize: 13, fontWeight: 600, color: P.textSec }}>Cost Breakdown</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 0 }}>
            {[
              { label: "Input tokens", value: "0" },
              { label: "Output tokens", value: "0" },
              { label: "Cached tokens", value: "0" },
              { label: "Total cost", value: "$0.00" },
            ].map((cell, i) => (
              <div key={cell.label} style={{
                padding: "10px 0",
                borderRight: i < 3 ? `0.5px solid ${P.cardBorder}` : "none",
                paddingRight: i < 3 ? 16 : 0,
                paddingLeft: i > 0 ? 16 : 0,
              }}>
                <p style={{ margin: 0, fontSize: 11, color: P.muted }}>{cell.label}</p>
                <p style={{ margin: "4px 0 0", fontSize: 16, fontWeight: 600, color: P.text }}>{cell.value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
