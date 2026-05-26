"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Package,
  Upload,
  X,
} from "lucide-react";
import { listCompanies } from "@/lib/orchestration/client";
import { buildCanonicalCompanyPath } from "@/lib/orchestration/route-paths";
import type { OrchestrationCompany } from "@/lib/orchestration/types";
import { P, color, type as T, space } from "@/lib/ui/tokens";
import { PageHeader, InfoNote } from "@/lib/ui/primitives";

type Strategy = "skip" | "overwrite";

interface ImportResult {
  category: string;
  imported: number;
  skipped: number;
  errors: string[];
}

interface ImportResponse {
  success: boolean;
  strategy: Strategy;
  targetCompany: string;
  summary: { imported: number; skipped: number; errors: number };
  results: ImportResult[];
}

/* ─── Page ─── */
export default function CompanyImportPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? "";

  const [company, setCompany] = useState<OrchestrationCompany | null>(null);
  const [loading, setLoading] = useState(true);
  const [pkg, setPkg] = useState<Record<string, unknown> | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<Strategy>("skip");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResponse | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    listCompanies().then((companies) => {
      if (cancelled) return;
      const slugKey = slug.toLowerCase();
      setCompany(companies.find((c) => (
        c.slug.toLowerCase() === slugKey || c.code.toLowerCase() === slugKey
      )) ?? null);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [slug]);

  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setParseError(null);
    setPkg(null);
    setResult(null);

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string);
        if (
          data?._meta?.format !== "hiverunner-company-package"
          && data?._meta?.format !== "mission-control-company-package"
        ) {
          setParseError("This file does not appear to be a HiveRunner export package (missing or invalid _meta.format).");
          return;
        }
        setPkg(data);
      } catch {
        setParseError("Failed to parse file as JSON. Please select a valid HiveRunner export package.");
      }
    };
    reader.readAsText(file);
  }, []);

  const clearFile = useCallback(() => {
    setPkg(null);
    setFileName(null);
    setParseError(null);
    setResult(null);
    if (fileRef.current) fileRef.current.value = "";
  }, []);

  const handleImport = useCallback(async () => {
    if (!pkg) return;
    setImporting(true);
    setResult(null);
    try {
      const res = await fetch(
        `/api/orchestration/companies/${encodeURIComponent(slug)}/import`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ package: pkg, strategy }),
        }
      );
      const data = await res.json();
      setResult(data);
    } catch (e) {
      console.error("Import error:", e);
    } finally {
      setImporting(false);
    }
  }, [slug, pkg, strategy]);

  // Package preview data
  const meta = pkg?._meta as Record<string, unknown> | undefined;
  const counts = pkg?._counts as Record<string, number> | undefined;
  const companyCode = company?.code ?? slug;
  const sourceCompanySlug = typeof meta?.sourceCompanySlug === "string" ? meta.sourceCompanySlug : null;
  const sourceMatchesTarget = sourceCompanySlug
    ? [slug, company?.slug, company?.code].some((value) => value?.toLowerCase() === sourceCompanySlug.toLowerCase())
    : true;

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
        href={buildCanonicalCompanyPath(companyCode, "/org")}
        style={{ display: "inline-flex", alignItems: "center", gap: space.sm, color: color.textMuted, fontSize: T.bodySmall.size, textDecoration: "none", marginBottom: space.lg }}
      >
        <ArrowLeft size={12} /> Org Chart
      </Link>

      <PageHeader
        icon={<Package size={16} />}
        title="Import Company Data"
        description={`Upload a previously exported HiveRunner package to import into ${company?.name ?? slug}.`}
      />

      {/* ── File upload ── */}
      {!pkg && (
        <div style={{ marginBottom: 20 }}>
          <input
            ref={fileRef}
            type="file"
            accept=".json"
            onChange={handleFile}
            style={{ display: "none" }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              gap: 10, width: "100%", padding: "32px 20px",
              borderRadius: 10, cursor: "pointer",
              border: `2px dashed ${P.cardBorder}`,
              background: "transparent", color: P.textSec, fontSize: 13,
              transition: "border-color 0.15s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = P.accent; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = P.cardBorder; }}
          >
            <Upload size={18} style={{ color: P.muted }} />
            <span>Select a <strong>.json</strong> export package</span>
          </button>

          {parseError && (
            <div style={{
              marginTop: 10, padding: "10px 14px", borderRadius: 8,
              background: P.errorDim, border: "1px solid rgba(239,68,68,0.25)",
              color: "#fca5a5", fontSize: 12, display: "flex", alignItems: "center", gap: 8,
            }}>
              <AlertTriangle size={14} /> {parseError}
            </div>
          )}
        </div>
      )}

      {/* ── Package preview ── */}
      {pkg && !result && (
        <>
          <div style={{
            padding: "14px 16px", borderRadius: 10, marginBottom: 16,
            border: `1px solid ${P.cardBorder}`, background: P.card,
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.12em", fontWeight: 600, color: P.muted }}>
                Package Preview
              </span>
              <button type="button" onClick={clearFile} style={{
                background: "none", border: "none", color: P.muted, cursor: "pointer", padding: 2,
              }}>
                <X size={14} />
              </button>
            </div>

            <div style={{ fontSize: 12, color: P.textSec, marginBottom: 6 }}>
              <strong style={{ color: P.text }}>File:</strong> {fileName}
            </div>
            <div style={{ fontSize: 12, color: P.textSec, marginBottom: 6 }}>
              <strong style={{ color: P.text }}>Source:</strong>{" "}
              {(meta?.sourceCompanyName as string) ?? "Unknown"}{" "}
              <span style={{ color: P.muted }}>({(meta?.sourceCompanySlug as string) ?? "?"})</span>
            </div>
            <div style={{ fontSize: 12, color: P.textSec, marginBottom: 6 }}>
              <strong style={{ color: P.text }}>Exported:</strong>{" "}
              {meta?.exportedAt ? new Date(meta.exportedAt as string).toLocaleString() : "Unknown"}
            </div>

            {/* Category counts */}
            {counts && (
              <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 }}>
                {Object.entries(counts).map(([cat, count]) => (
                  <span key={cat} style={{
                    padding: "3px 10px", borderRadius: 4, fontSize: 11,
                    background: P.surface, border: `1px solid ${P.cardBorder}`,
                    color: P.textSec,
                  }}>
                    {count} {cat}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Cross-company warning */}
          {sourceCompanySlug && !sourceMatchesTarget && (
            <div style={{
              padding: "10px 14px", borderRadius: 8, marginBottom: 16,
              background: P.warnDim, border: "1px solid rgba(245,158,11,0.25)",
              color: "#fcd34d", fontSize: 12, display: "flex", alignItems: "flex-start", gap: 8,
              lineHeight: 1.5,
            }}>
              <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>
                This package was exported from <strong>{sourceCompanySlug}</strong>,
                but you are importing into <strong>{company?.slug ?? slug}</strong>.
                Foreign key references (project IDs, agent IDs, etc.) may not resolve correctly
                unless the same entities exist in both companies.
              </span>
            </div>
          )}

          {/* ── Conflict strategy ── */}
          <div style={{ marginBottom: 20 }}>
            <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.12em", fontWeight: 600, color: P.muted, display: "block", marginBottom: 8 }}>
              Conflict Strategy
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <StrategyButton
                active={strategy === "skip"}
                onClick={() => setStrategy("skip")}
                label="Skip existing"
                desc="Only import entities that don't already exist. Existing data is left untouched."
              />
              <StrategyButton
                active={strategy === "overwrite"}
                onClick={() => setStrategy("overwrite")}
                label="Overwrite"
                desc="Update existing entities with package data. New entities are also created."
              />
            </div>
          </div>

          {/* Exclusions */}
          <div style={{ marginBottom: space.xl }}>
            <InfoNote>
              <strong style={{ color: color.textSecondary }}>Import does not include:</strong>{" "}
              Execution runs, heartbeat telemetry, agent runtime state, inbox read state, or avatar images.
              Agent status is reset to &quot;idle&quot; on import.
              Reporting-to relationships are preserved by agent ID reference.
            </InfoNote>
          </div>

          {/* Apply */}
          <button
            type="button"
            onClick={handleImport}
            disabled={importing}
            style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              padding: "10px 24px", borderRadius: 8,
              background: P.accent, border: "none", color: "#000",
              fontSize: 13, fontWeight: 600,
              cursor: importing ? "wait" : "pointer",
              opacity: importing ? 0.7 : 1,
            }}
          >
            <Upload size={14} />
            {importing ? "Importing..." : `Import into ${company?.name ?? slug}`}
          </button>
        </>
      )}

      {/* ── Results ── */}
      {result && (
        <div style={{ marginTop: 0 }}>
          <div style={{
            padding: "14px 16px", borderRadius: 10, marginBottom: 16,
            background: result.success ? P.successDim : P.errorDim,
            border: `1px solid ${result.success ? "rgba(34,197,94,0.25)" : "rgba(239,68,68,0.25)"}`,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              {result.success ? (
                <Check size={16} style={{ color: P.success }} />
              ) : (
                <AlertTriangle size={16} style={{ color: P.error }} />
              )}
              <strong style={{ color: result.success ? "#86efac" : "#fca5a5", fontSize: 14 }}>
                {result.success ? "Import Complete" : "Import Completed with Errors"}
              </strong>
            </div>
            <div style={{ fontSize: 12, color: P.textSec, lineHeight: 1.6 }}>
              Strategy: <strong>{result.strategy}</strong> | Target: <strong>{result.targetCompany}</strong>
              <br />
              Imported: <strong>{result.summary.imported}</strong> |
              Skipped: <strong>{result.summary.skipped}</strong> |
              Errors: <strong>{result.summary.errors}</strong>
            </div>
          </div>

          {/* Per-category breakdown */}
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {result.results.map((r) => (
              <div key={r.category} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "8px 14px", borderRadius: 6,
                background: P.card, border: `1px solid ${P.cardBorder}`,
              }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>{r.category}</span>
                <div style={{ display: "flex", gap: 12, fontSize: 11 }}>
                  {r.imported > 0 && <span style={{ color: P.success }}>{r.imported} imported</span>}
                  {r.skipped > 0 && <span style={{ color: P.muted }}>{r.skipped} skipped</span>}
                  {r.errors.length > 0 && <span style={{ color: P.error }}>{r.errors.length} errors</span>}
                </div>
              </div>
            ))}
          </div>

          {/* Error details */}
          {result.results.some((r) => r.errors.length > 0) && (
            <div style={{
              marginTop: 12, padding: "10px 14px", borderRadius: 8,
              background: P.errorDim, border: "1px solid rgba(239,68,68,0.2)",
              fontSize: 11, color: "#fca5a5", lineHeight: 1.5, maxHeight: 200, overflow: "auto",
            }}>
              {result.results
                .filter((r) => r.errors.length > 0)
                .flatMap((r) => r.errors.map((e) => `[${r.category}] ${e}`))
                .map((err, i) => (
                  <div key={i}>{err}</div>
                ))}
            </div>
          )}

          {/* Import another */}
          <button
            type="button"
            onClick={clearFile}
            style={{
              marginTop: 16, display: "inline-flex", alignItems: "center", gap: 6,
              padding: "8px 16px", borderRadius: 8,
              background: P.surface, border: `1px solid ${P.cardBorder}`,
              color: P.text, fontSize: 12, cursor: "pointer",
            }}
          >
            Import another package
          </button>
        </div>
      )}
    </div>
  );
}

/* ─── Strategy button ─── */
function StrategyButton({
  active,
  onClick,
  label,
  desc,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  desc: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1, padding: "10px 14px", borderRadius: 8,
        border: `1.5px solid ${active ? P.accent : P.cardBorder}`,
        background: active ? P.accentDim : "transparent",
        cursor: "pointer", textAlign: "left",
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: active ? P.accent : P.text, marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ fontSize: 11, color: P.muted, lineHeight: 1.4 }}>{desc}</div>
    </button>
  );
}
