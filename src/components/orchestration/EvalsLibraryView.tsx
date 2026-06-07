"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ExternalLink, Library, Loader2, X } from "lucide-react";

import { listCompanies, listCompanyEvalCases } from "@/lib/orchestration/client";
import { buildCanonicalCompanyPath } from "@/lib/orchestration/route-paths";
import type {
  OrchestrationCompany,
  OrchestrationEvalCase,
  OrchestrationEvalLibraryFacet,
  OrchestrationEvalLibraryFacets,
  OrchestrationEvalLibraryFilters,
  OrchestrationEvalLibraryResult,
} from "@/lib/orchestration/types";
import { color, font, pageStyle, radius, space, type as T } from "@/lib/ui/tokens";
import { ActionButton, Badge, EmptyState, PageHeader, Section } from "@/lib/ui/primitives";

const FILTER_KEYS = [
  "projectId",
  "taskType",
  "template",
  "agent",
  "runner",
  "model",
  "reviewOutcome",
  "tag",
  "dateFrom",
  "dateTo",
] as const;

type EvalFilterKey = typeof FILTER_KEYS[number];

const EMPTY_FACETS: OrchestrationEvalLibraryFacets = {
  projects: [],
  taskTypes: [],
  templates: [],
  agents: [],
  runners: [],
  models: [],
  reviewOutcomes: [],
  tags: [],
};

export function readEvalLibraryFilters(searchParams: URLSearchParams): OrchestrationEvalLibraryFilters {
  const filters: OrchestrationEvalLibraryFilters = {};
  for (const key of FILTER_KEYS) {
    const value = searchParams.get(key)?.trim();
    if (!value) continue;
    if (key === "reviewOutcome") {
      if (value === "accepted" || value === "returned" || value === "rejected" || value === "blocked") {
        filters.reviewOutcome = value;
      }
      continue;
    }
    filters[key] = value;
  }
  return filters;
}

function hasActiveEvalFilters(filters: OrchestrationEvalLibraryFilters): boolean {
  return FILTER_KEYS.some((key) => Boolean(filters[key]));
}

function dateStart(value?: string): string | undefined {
  return value ? `${value}T00:00:00.000Z` : undefined;
}

function dateEnd(value?: string): string | undefined {
  return value ? `${value}T23:59:59.999Z` : undefined;
}

function apiFilters(filters: OrchestrationEvalLibraryFilters): OrchestrationEvalLibraryFilters {
  return {
    ...filters,
    dateFrom: dateStart(filters.dateFrom),
    dateTo: dateEnd(filters.dateTo),
    limit: 100,
  };
}

function formatDateTime(value?: string | null): string {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function templateLabel(context: Record<string, unknown>): string {
  return [context.templateName, context.name, context.templateLabel, context.templateId, context.templateSlug, context.template]
    .map((candidate) => (typeof candidate === "string" ? candidate.trim() : ""))
    .find(Boolean) ?? "No template";
}

function outcomeTone(outcome: OrchestrationEvalCase["review"]["outcome"]): "positive" | "warning" | "negative" | "info" {
  if (outcome === "accepted") return "positive";
  if (outcome === "returned") return "warning";
  if (outcome === "blocked") return "info";
  return "negative";
}

function captureTone(captureQuality: OrchestrationEvalCase["captureQuality"]): "positive" | "warning" | "negative" | "default" {
  if (captureQuality === "complete") return "positive";
  if (captureQuality === "partial") return "warning";
  if (captureQuality === "failed") return "negative";
  return "default";
}

function selectStyle() {
  return {
    width: "100%",
    height: 34,
    borderRadius: radius.md,
    border: `0.5px solid ${color.border}`,
    background: color.surface,
    color: color.text,
    padding: "0 9px",
    fontSize: T.bodySmall.size,
    outline: "none",
  };
}

function FilterSelect({
  label,
  value,
  emptyLabel,
  options,
  onChange,
}: {
  label: string;
  value?: string;
  emptyLabel: string;
  options: OrchestrationEvalLibraryFacet[];
  onChange: (value: string) => void;
}) {
  return (
    <label style={{ display: "grid", gap: 5, minWidth: 0 }}>
      <span style={{ fontSize: T.caption.size, color: color.textMuted }}>{label}</span>
      <select
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
        style={selectStyle()}
      >
        <option value="">{emptyLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label} ({option.count})
          </option>
        ))}
      </select>
    </label>
  );
}

function DateFilter({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label style={{ display: "grid", gap: 5, minWidth: 0 }}>
      <span style={{ fontSize: T.caption.size, color: color.textMuted }}>{label}</span>
      <input
        type="date"
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
        style={selectStyle()}
      />
    </label>
  );
}

function taskHref(companyCode: string, item: OrchestrationEvalCase): string {
  return buildCanonicalCompanyPath(companyCode, `/tasks/${encodeURIComponent(item.sourceTask.key)}`);
}

function metaValue(value: string | null | undefined, fallback = "None"): string {
  return value?.trim() || fallback;
}

function EvalCaseRow({ item, companyCode }: { item: OrchestrationEvalCase; companyCode: string }) {
  const traceHref = item.sourceRun.traceRoute || buildCanonicalCompanyPath(companyCode, `/runs/${encodeURIComponent(item.sourceRun.id)}`);
  return (
    <article
      data-eval-case-id={item.id}
      style={{
        borderRadius: radius.md,
        border: `0.5px solid ${color.border}`,
        background: color.surface,
        padding: space.lg,
        display: "grid",
        gap: space.md,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: space.md }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
            <Badge label={item.review.outcome} tone={outcomeTone(item.review.outcome)} />
            <Badge label={item.captureQuality} tone={captureTone(item.captureQuality)} />
            {item.sourceProject.color ? (
              <span
                aria-hidden
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 99,
                  background: item.sourceProject.color,
                }}
              />
            ) : null}
            <span style={{ fontSize: T.caption.size, color: color.textMuted }}>
              {metaValue(item.sourceProject.name, "Company-wide")}
            </span>
          </div>
          <h2 style={{ margin: 0, color: color.text, fontSize: T.cardTitle.size, fontWeight: T.cardTitle.weight, lineHeight: 1.35 }}>
            {item.sourceTask.key} · {item.sourceTask.title}
          </h2>
        </div>
        <span style={{ color: color.textMuted, fontSize: T.caption.size, whiteSpace: "nowrap" }}>
          {formatDateTime(item.createdAt)}
        </span>
      </div>

      <p style={{ margin: 0, color: color.textSecondary, fontSize: T.bodySmall.size, lineHeight: T.bodySmall.lineHeight }}>
        {item.review.rationale}
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
          gap: 8,
          color: color.textMuted,
          fontSize: T.caption.size,
        }}
      >
        <span>Type: {metaValue(item.sourceTask.type)}</span>
        <span>Template: {templateLabel(item.templateContext)}</span>
        <span>Agent: {metaValue(item.sourceRun.agentName)}</span>
        <span>Runner: {metaValue(item.sourceRun.runnerProvider ?? item.sourceRun.providerId)}</span>
        <span>Model: {metaValue(item.sourceRun.runnerModel)}</span>
      </div>

      {item.sourceTask.tags.length > 0 ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {item.sourceTask.tags.map((tag) => (
            <span
              key={tag}
              style={{
                borderRadius: radius.full,
                border: `0.5px solid ${color.border}`,
                color: color.textSecondary,
                fontSize: T.caption.size,
                padding: "2px 7px",
              }}
            >
              {tag}
            </span>
          ))}
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <a
          href={taskHref(companyCode, item)}
          style={{ color: color.accent, fontSize: T.bodySmall.size, display: "inline-flex", alignItems: "center", gap: 5, textDecoration: "none" }}
        >
          Source task <ExternalLink size={12} />
        </a>
        <a
          href={traceHref}
          style={{ color: color.accent, fontSize: T.bodySmall.size, display: "inline-flex", alignItems: "center", gap: 5, textDecoration: "none" }}
        >
          Run trace <ExternalLink size={12} />
        </a>
        <span style={{ color: color.textMuted, fontFamily: font.mono, fontSize: 11 }}>
          {item.snapshotSha256.slice(0, 12)}
        </span>
      </div>
    </article>
  );
}

export function EvalsLibrarySurface({
  companyCode,
  loading,
  error,
  cases,
  total,
  facets,
  filters,
  onFilterChange,
  onClearFilters,
}: {
  companyCode: string;
  loading: boolean;
  error?: string | null;
  cases: OrchestrationEvalCase[];
  total: number;
  facets: OrchestrationEvalLibraryFacets;
  filters: OrchestrationEvalLibraryFilters;
  onFilterChange?: (key: EvalFilterKey, value: string) => void;
  onClearFilters?: () => void;
}) {
  const activeFilters = hasActiveEvalFilters(filters);
  return (
    <div data-evals-library style={{ ...pageStyle, maxWidth: 1180 }}>
      <PageHeader
        icon={<Library size={17} />}
        title="Evals"
        actions={activeFilters ? (
          <ActionButton
            label="Clear"
            icon={<X size={13} />}
            onClick={() => onClearFilters?.()}
            variant="secondary"
          />
        ) : null}
      />

      <Section title="Library Filters" card={false} trailing={loading ? "Loading" : `${total} cases`}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: space.md,
            padding: space.lg,
            borderRadius: radius.md,
            border: `0.5px solid ${color.border}`,
            background: color.surfaceElevated,
          }}
        >
          <FilterSelect label="Project" value={filters.projectId} emptyLabel="All projects" options={facets.projects} onChange={(value) => onFilterChange?.("projectId", value)} />
          <FilterSelect label="Task Type" value={filters.taskType} emptyLabel="All types" options={facets.taskTypes} onChange={(value) => onFilterChange?.("taskType", value)} />
          <FilterSelect label="Template" value={filters.template} emptyLabel="All templates" options={facets.templates} onChange={(value) => onFilterChange?.("template", value)} />
          <FilterSelect label="Agent" value={filters.agent} emptyLabel="All agents" options={facets.agents} onChange={(value) => onFilterChange?.("agent", value)} />
          <FilterSelect label="Runner" value={filters.runner} emptyLabel="All runners" options={facets.runners} onChange={(value) => onFilterChange?.("runner", value)} />
          <FilterSelect label="Model" value={filters.model} emptyLabel="All models" options={facets.models} onChange={(value) => onFilterChange?.("model", value)} />
          <FilterSelect label="Review Outcome" value={filters.reviewOutcome} emptyLabel="All outcomes" options={facets.reviewOutcomes} onChange={(value) => onFilterChange?.("reviewOutcome", value)} />
          <FilterSelect label="Tag" value={filters.tag} emptyLabel="All tags" options={facets.tags} onChange={(value) => onFilterChange?.("tag", value)} />
          <DateFilter label="From" value={filters.dateFrom} onChange={(value) => onFilterChange?.("dateFrom", value)} />
          <DateFilter label="To" value={filters.dateTo} onChange={(value) => onFilterChange?.("dateTo", value)} />
        </div>
      </Section>

      {error ? (
        <div style={{ color: color.negative, background: color.negativeSoft, border: `0.5px solid ${color.negative}`, borderRadius: radius.md, padding: space.lg }}>
          {error}
        </div>
      ) : loading ? (
        <div style={{ display: "grid", placeItems: "center", padding: 48, color: color.textMuted }}>
          <Loader2 size={20} style={{ animation: "spin 1s linear infinite" }} />
        </div>
      ) : cases.length === 0 ? (
        <EmptyState
          title={activeFilters ? "No eval cases match these filters." : "No eval cases saved yet."}
          description={activeFilters ? "Try a broader library filter." : "Reviewed Run Trace saves will appear here."}
        />
      ) : (
        <Section title="Saved Cases" card={false}>
          <div style={{ display: "grid", gap: space.md }}>
            {cases.map((item) => (
              <EvalCaseRow key={item.id} item={item} companyCode={companyCode} />
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

export function EvalsLibraryView({ companySlug }: { companySlug: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filters = useMemo(() => readEvalLibraryFilters(searchParams), [searchParams]);
  const [company, setCompany] = useState<OrchestrationCompany | null>(null);
  const [library, setLibrary] = useState<OrchestrationEvalLibraryResult>({
    cases: [],
    total: 0,
    filters: {},
    facets: EMPTY_FACETS,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      const [companies, nextLibrary] = await Promise.all([
        listCompanies(),
        listCompanyEvalCases(companySlug, apiFilters(filters)),
      ]).catch(() => [[], null] as const);
      if (cancelled) return;
      const currentCompany = companies.find((item) => item.slug === companySlug) ?? null;
      setCompany(currentCompany);
      if (!currentCompany) {
        setError("Company not found.");
      } else if (!nextLibrary) {
        setError("Eval cases could not be loaded.");
      } else {
        setLibrary(nextLibrary);
      }
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [companySlug, filters]);

  const setFilter = (key: EvalFilterKey, value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (value) {
      next.set(key, value);
    } else {
      next.delete(key);
    }
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const clearFilters = () => {
    const next = new URLSearchParams(searchParams.toString());
    for (const key of FILTER_KEYS) next.delete(key);
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  return (
    <EvalsLibrarySurface
      companyCode={company?.code ?? companySlug.toUpperCase()}
      loading={loading}
      error={error}
      cases={library.cases}
      total={library.total}
      facets={library.facets}
      filters={filters}
      onFilterChange={setFilter}
      onClearFilters={clearFilters}
    />
  );
}
