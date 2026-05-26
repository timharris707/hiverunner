"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Check, Download, Package } from "lucide-react";
import { listCompanies } from "@/lib/orchestration/client";
import type { OrchestrationCompany } from "@/lib/orchestration/types";
import { P, color, type as T, space, radius } from "@/lib/ui/tokens";
import { PageHeader, InfoNote } from "@/lib/ui/primitives";

/* ─── Category definitions ─── */
const CATEGORIES = [
  { key: "company", label: "Company Settings", desc: "Theme, description, workspace configuration" },
  { key: "projects", label: "Projects", desc: "Project names, colors, status, settings" },
  { key: "agents", label: "Agents", desc: "Agent profiles, roles, models, permissions, skills declarations" },
  { key: "tasks", label: "Tasks", desc: "Task titles, descriptions, status, priorities, labels" },
  { key: "sprints", label: "Sprints / Goals", desc: "Sprint definitions, goals, date ranges" },
  { key: "comments", label: "Comments", desc: "Task discussion threads" },
  { key: "routines", label: "Routines", desc: "Recurring task definitions, concurrency policies" },
  { key: "approvals", label: "Approvals", desc: "Governance requests and decisions" },
] as const;

/* ─── Page ─── */
export default function CompanyExportPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? "";

  const [company, setCompany] = useState<OrchestrationCompany | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(CATEGORIES.map((c) => c.key))
  );
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<{
    counts: Record<string, number>;
    size: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    listCompanies().then((companies) => {
      if (cancelled) return;
      setCompany(companies.find((c) => c.slug === slug) ?? null);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [slug]);

  const toggleCategory = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setExportResult(null);
  }, []);

  const selectAll = useCallback(() => {
    setSelected(new Set(CATEGORIES.map((c) => c.key)));
    setExportResult(null);
  }, []);

  const selectNone = useCallback(() => {
    setSelected(new Set());
    setExportResult(null);
  }, []);

  const handleExport = useCallback(async () => {
    if (selected.size === 0) return;
    setExporting(true);
    setExportResult(null);
    try {
      const categories = Array.from(selected).join(",");
      const res = await fetch(
        `/api/orchestration/companies/${encodeURIComponent(slug)}/export?categories=${categories}`
      );
      if (!res.ok) throw new Error(`Export failed: ${res.status}`);
      const pkg = await res.json();

      // Download as JSON file
      const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${slug}-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setExportResult({
        counts: pkg._counts ?? {},
        size: formatBytes(blob.size),
      });
    } catch (e) {
      console.error("Export error:", e);
    } finally {
      setExporting(false);
    }
  }, [slug, selected]);

  if (loading) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ height: 200, borderRadius: 8, background: P.card, border: `1px solid ${P.cardBorder}`, animation: "pulse 1.5s infinite" }} />
      </div>
    );
  }

  return (
    <div style={{ padding: `${space.lg}px ${space.xl}px`, maxWidth: 960, color: color.text, fontSize: T.body.size }}>
      {/* Back link */}
      <Link
        href={`/companies/${encodeURIComponent(slug)}/org`}
        style={{ display: "inline-flex", alignItems: "center", gap: space.sm, color: color.textMuted, fontSize: T.bodySmall.size, textDecoration: "none", marginBottom: space.lg }}
      >
        <ArrowLeft size={12} /> Org Chart
      </Link>

      <PageHeader
        icon={<Package size={16} />}
        title="Export Company"
        description={`Download a structured JSON package of ${company?.name ?? slug} data. Select the categories to include.`}
      />

      {/* Category checklist */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.12em", fontWeight: 600, color: P.muted }}>
            Categories ({selected.size}/{CATEGORIES.length})
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={selectAll} style={linkBtnStyle}>Select all</button>
            <button type="button" onClick={selectNone} style={linkBtnStyle}>Select none</button>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {CATEGORIES.map((cat) => {
            const checked = selected.has(cat.key);
            const count = exportResult?.counts?.[cat.key];
            return (
              <button
                key={cat.key}
                type="button"
                onClick={() => toggleCategory(cat.key)}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "10px 14px", borderRadius: 8,
                  background: checked ? P.card : "transparent",
                  border: `1px solid ${checked ? P.cardBorder : "transparent"}`,
                  color: P.text, cursor: "pointer", textAlign: "left",
                  transition: "background 0.1s",
                }}
              >
                <div style={{
                  width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                  border: `1.5px solid ${checked ? P.accent : P.muted}`,
                  background: checked ? P.accentDim : "transparent",
                  display: "grid", placeItems: "center",
                }}>
                  {checked && <Check size={12} style={{ color: P.accent }} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{cat.label}</div>
                  <div style={{ fontSize: 11, color: P.muted, marginTop: 1 }}>{cat.desc}</div>
                </div>
                {count != null && (
                  <span style={{
                    fontSize: 11, color: P.success, fontWeight: 600,
                    background: P.successDim, padding: "2px 8px", borderRadius: 4,
                  }}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Exclusions note */}
      <div style={{ marginBottom: space.xl }}>
        <InfoNote>
          <strong style={{ color: color.textSecondary }}>Not included:</strong> Execution runs, heartbeat telemetry,
          agent runtime state, inbox read state, avatar images, and ideas/reviews.
          These are either runtime-ephemeral or user-specific and are not portable across companies.
        </InfoNote>
      </div>

      {/* Export button */}
      <button
        type="button"
        onClick={handleExport}
        disabled={exporting || selected.size === 0}
        style={{
          display: "inline-flex", alignItems: "center", gap: 8,
          padding: "10px 24px", borderRadius: 8,
          background: selected.size === 0 ? P.surface : P.accent,
          border: "none", color: selected.size === 0 ? P.muted : "#000",
          fontSize: 13, fontWeight: 600, cursor: selected.size === 0 ? "not-allowed" : "pointer",
          opacity: exporting ? 0.7 : 1,
        }}
      >
        <Download size={14} />
        {exporting ? "Exporting..." : "Download Package"}
      </button>

      {/* Result */}
      {exportResult && (
        <div style={{
          marginTop: 16, padding: "12px 16px", borderRadius: 8,
          background: P.successDim, border: "1px solid rgba(34,197,94,0.25)",
          fontSize: 12, color: "#86efac", lineHeight: 1.6,
        }}>
          <strong>Export complete.</strong> Package size: {exportResult.size}.
          {Object.entries(exportResult.counts).length > 0 && (
            <span> Included: {Object.entries(exportResult.counts).map(([k, v]) => `${v} ${k}`).join(", ")}.</span>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Helpers ─── */
const linkBtnStyle: React.CSSProperties = {
  background: "none", border: "none", color: color.accent,
  fontSize: T.caption.size, cursor: "pointer", padding: 0, textDecoration: "underline",
  textUnderlineOffset: 2,
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
