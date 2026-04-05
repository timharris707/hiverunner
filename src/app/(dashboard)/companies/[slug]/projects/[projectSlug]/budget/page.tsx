"use client";

import { use, useEffect, useState } from "react";
import { DollarSign } from "lucide-react";
import { listProjects } from "@/lib/orchestration/client";
import type { OrchestrationProject } from "@/lib/orchestration/types";
import { ProjectTabBar } from "../ProjectTabBar";

const C = {
  bg: "#0c0a09",
  card: "rgba(28,25,23,0.6)",
  cardBorder: "rgba(120,113,108,0.18)",
  text: "#f5f5f4",
  textSec: "#a8a29e",
  muted: "#57534e",
  divider: "rgba(120,113,108,0.15)",
};

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

  if (loading) return <div style={{ padding: 32, color: C.muted, fontSize: 13 }}>Loading...</div>;
  if (!project) return <div style={{ padding: 32, color: "#fca5a5", fontSize: 13 }}>Project not found.</div>;

  return (
    <div>
      {/* project header + tabs */}
      <div className="px-5 pt-5">
        <div className="flex items-center gap-3">
          <span
            className="inline-block h-4 w-4 shrink-0 rounded-md"
            style={{ backgroundColor: project.color ?? "#d97706" }}
          />
          <h1 className="text-lg font-semibold text-stone-100">{project.name}</h1>
        </div>
        <div className="mt-3">
          <ProjectTabBar slug={slug} projectSlug={projectSlug} active="budget" />
        </div>
      </div>

      <div style={{ padding: "20px 24px", maxWidth: 700 }}>
      <p style={{ margin: "0 0 20px", fontSize: 13, color: C.muted }}>Lifetime budget</p>

      {/* summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 24 }}>
        <div style={{
          padding: "16px 20px", borderRadius: 10,
          border: `1px solid ${C.cardBorder}`, background: C.card,
        }}>
          <p style={{ margin: 0, fontSize: 11, fontWeight: 600, color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>Observed</p>
          <p style={{ margin: "6px 0 0", fontSize: 28, fontWeight: 700, color: C.text }}>$0.00</p>
        </div>
        <div style={{
          padding: "16px 20px", borderRadius: 10,
          border: `1px solid ${C.cardBorder}`, background: C.card,
        }}>
          <p style={{ margin: 0, fontSize: 11, fontWeight: 600, color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>Budget</p>
          <p style={{ margin: "6px 0 0", fontSize: 28, fontWeight: 700, color: C.text }}>Disabled</p>
          <p style={{ margin: "2px 0 0", fontSize: 11, color: C.muted }}>Soft alert at 80%</p>
        </div>
      </div>

      {/* progress bar */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 12, color: C.muted }}>
          <span>Remaining</span>
          <span>Unlimited</span>
        </div>
        <div style={{ height: 6, borderRadius: 999, background: "rgba(120,113,108,0.15)", overflow: "hidden" }}>
          <div style={{ height: "100%", width: "0%", borderRadius: 999, background: C.textSec }} />
        </div>
      </div>

      {/* budget input */}
      <div style={{
        padding: "16px 20px", borderRadius: 10,
        border: `1px solid ${C.cardBorder}`, background: C.card,
      }}>
        <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
          Budget (USD)
        </label>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ position: "relative", flex: 1 }}>
            <DollarSign size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: C.muted }} />
            <input
              value={budgetInput}
              onChange={(e) => setBudgetInput(e.target.value)}
              style={{
                width: "100%", borderRadius: 8,
                border: `1px solid ${C.cardBorder}`,
                background: "rgba(41,37,36,0.4)",
                padding: "10px 14px 10px 30px",
                fontSize: 16, fontWeight: 600, color: C.text,
                outline: "none",
              }}
            />
          </div>
          <button
            type="button"
            style={{
              padding: "10px 20px", borderRadius: 8,
              border: `1px solid ${C.cardBorder}`,
              background: "rgba(120,113,108,0.15)",
              fontSize: 13, fontWeight: 600, color: C.text,
              cursor: "pointer",
            }}
          >
            Set budget
          </button>
        </div>
      </div>

      {/* cost breakdown placeholder */}
      <div style={{ marginTop: 24 }}>
        <h2 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 600, color: C.text }}>Cost Breakdown</h2>
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(4, 1fr)",
          borderRadius: 10,
          border: `1px solid ${C.cardBorder}`,
          overflow: "hidden",
        }}>
          {[
            { label: "Input tokens", value: "0" },
            { label: "Output tokens", value: "0" },
            { label: "Cached tokens", value: "0" },
            { label: "Total cost", value: "$0.00" },
          ].map((cell) => (
            <div key={cell.label} style={{
              padding: "14px 16px",
              borderRight: `1px solid ${C.cardBorder}`,
            }}>
              <p style={{ margin: 0, fontSize: 11, color: C.muted }}>{cell.label}</p>
              <p style={{ margin: "6px 0 0", fontSize: 16, fontWeight: 600, color: C.text }}>{cell.value}</p>
            </div>
          ))}
        </div>
      </div>
      </div>
    </div>
  );
}
