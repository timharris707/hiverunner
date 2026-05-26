"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Archive,
  BarChart3,
  CheckCircle2,
  ChevronRight,
  ChevronDown,
  Eye,
  Brain,
  Code,
  FileText,
  FolderOpen,
  Link2,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import { listCompanies, listCompanyAgents } from "@/lib/orchestration/client";
import type { OrchestrationCompany } from "@/lib/orchestration/types";
import { P as tokens } from "@/lib/ui/tokens";

/* ─── Palette ─── */
const P = {
  bg: tokens.bg,
  surface: tokens.surface,
  surfaceElevated: tokens.surfaceElevated,
  surfaceHover: tokens.surfaceHover,
  card: tokens.surface,
  cardBorder: tokens.cardBorder,
  cardBorderHover: tokens.cardBorderHover,
  text: tokens.text,
  textSec: tokens.textSec,
  muted: tokens.muted,
  accent: tokens.accent,
  accentSoft: tokens.accentSoft,
  success: tokens.success,
  successDim: tokens.successDim,
  error: tokens.error,
  errorDim: tokens.errorDim,
  warn: tokens.warn,
  warnDim: tokens.warnDim,
  info: "var(--info)",
  infoSoft: "var(--info-soft)",
};

/* ─── Types ─── */
type SkillSource = "workspace" | "system" | "bundled";

interface SkillEntry {
  id: string;
  name: string;
  description: string;
  source: SkillSource;
  fileCount: number;
  files: string[];
  fullContent: string;
  owners: string[];
  key: string;
  mode: "read-only" | "editable";
}

type CompanySkillRecord = {
  id: string;
  slug: string;
  name: string;
  description: string;
  status: "draft" | "active" | "archived";
  version: number;
  source: "manual" | "seed" | "learned" | "imported";
  scope: "company" | "project" | "agent";
  ownerAgentName: string | null;
  reviewRequired: boolean;
  reviewState: "not_requested" | "requested" | "approved" | "rejected";
  metadata: CandidateMetadata;
  updatedAt: string;
  assignedAgentCount: number;
  assignedAgentNames: string[];
};

type AgentSkillAssignmentRecord = {
  id: string;
  skillId: string;
  skillSlug: string;
  agentName: string;
  skillName: string;
  status: "draft" | "active" | "archived";
  source: "manual" | "seed" | "learned" | "imported";
};

type CompanyMemoryRecord = {
  id: string;
  slug: string;
  title: string;
  body: string;
  kind: "fact" | "decision" | "preference" | "architecture" | "domain_constraint" | "workflow_note" | "skill_evidence";
  scope: "company" | "project" | "agent";
  status: "draft" | "active" | "rejected" | "archived";
  source: "manual" | "task" | "run" | "extractor" | "imported";
  confidence: number;
  reviewRequired: boolean;
  reviewState: "not_requested" | "requested" | "approved" | "rejected";
  metadata: CandidateMetadata;
  projectName: string | null;
  agentName: string | null;
  taskKey: string | null;
  updatedAt: string;
};

type SkillEffectivenessRecord = {
  skillId: string;
  skillSlug: string;
  skillName: string;
  skillStatus: string;
  skillVersion: number;
  assignedAgentNames: string[];
  availableCount: number;
  explicitUseCount: number;
  passCount: number;
  failCount: number;
  blockedCount: number;
  unknownCount: number;
  lastAvailableAt: string | null;
  lastExplicitUseAt: string | null;
  lastOutcomeAt: string | null;
  healthStatus: "healthy" | "needs_data" | "unused" | "stale" | "low_performing";
  healthLabel: string;
  healthSeverity: "none" | "info" | "warning" | "danger";
  healthReason: string;
  needsAttention: boolean;
};

type SkillEffectivenessTotals = {
  skillCount: number;
  availableCount: number;
  explicitUseCount: number;
  passCount: number;
  failCount: number;
  blockedCount: number;
  unknownCount: number;
  attentionCount?: number;
};

type ReviewRoutingMetadata = {
  version?: string;
  routedAt?: string;
  reviewerAgentId?: string;
  reviewerAgentName?: string;
  reviewerRole?: string;
  rule?: string;
  reason?: string;
};

type ReviewTaskMetadata = {
  taskKey?: string;
  reviewerAgentName?: string;
  executionEngine?: string;
};

type ReviewDecisionMetadata = {
  decision?: string;
  reviewerAgentName?: string;
  note?: string | null;
  confidence?: number | null;
};

type ReviewActivationMetadata = {
  activatedAssignmentCount?: number;
};

type RuntimeExportMetadata = {
  exported?: boolean;
  status?: string;
  path?: string | null;
  syncedAt?: string;
  version?: number;
};

type CandidateMetadata = Record<string, unknown> & {
  defaultSkill?: boolean | unknown;
  runtimeSkillBody?: string | unknown;
  recommendedAgentRoles?: string[] | unknown;
  source?: string | unknown;
  reviewRouting?: ReviewRoutingMetadata | unknown;
  reviewTask?: ReviewTaskMetadata | unknown;
  reviewDecision?: ReviewDecisionMetadata | unknown;
  reviewActivation?: ReviewActivationMetadata | unknown;
  runtimeExport?: RuntimeExportMetadata | unknown;
  candidateTopic?: string | unknown;
  evidenceCount?: number | unknown;
  supportingMemoryIds?: string[] | unknown;
  supportingTaskKeys?: string[] | unknown;
  extractionVersion?: string | unknown;
};

type CatalogFilter = "all" | "default" | "company" | "learned" | "draft-review";

/* ─── Page ─── */
export default function CompanySkillsPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? "";

  const [company, setCompany] = useState<OrchestrationCompany | null>(null);
  const [registrySkills, setRegistrySkills] = useState<SkillEntry[]>([]);
  const [companySkills, setCompanySkills] = useState<CompanySkillRecord[]>([]);
  const [skillAssignments, setSkillAssignments] = useState<AgentSkillAssignmentRecord[]>([]);
  const [memoryRecords, setMemoryRecords] = useState<CompanyMemoryRecord[]>([]);
  const [skillEffectiveness, setSkillEffectiveness] = useState<SkillEffectivenessRecord[]>([]);
  const [skillEffectivenessTotals, setSkillEffectivenessTotals] = useState<SkillEffectivenessTotals | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [expandedSkills, setExpandedSkills] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<"view" | "code">("view");
  const [refreshing, setRefreshing] = useState(false);
  const [reviewBusy, setReviewBusy] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);

  // Add skill state
  const [addInput, setAddInput] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [showAddBar, setShowAddBar] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamString = searchParams.toString();
  const catalogFilter = normalizeCatalogFilter(searchParams.get("skillFilter"));
  const roleFilter = (searchParams.get("role") ?? "").trim().toLowerCase();

  const load = useCallback(async () => {
    const [companyRows, companyAgents, registryResponse, companySkillResponse, assignmentResponse, memoryResponse, effectivenessResponse] = await Promise.all([
      listCompanies(),
      listCompanyAgents(slug),
      fetch("/api/skills", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch(`/api/orchestration/companies/${encodeURIComponent(slug)}/skills?includeArchived=true`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetch(`/api/orchestration/companies/${encodeURIComponent(slug)}/skills/assignments?includeArchived=true`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetch(`/api/orchestration/companies/${encodeURIComponent(slug)}/memory?includeArchived=true`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetch(`/api/orchestration/companies/${encodeURIComponent(slug)}/skills/effectiveness?includeArchived=true`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ]);

    const normalizedSlug = slug.trim().toLowerCase();
    setCompany(companyRows.find((r) => r.slug === normalizedSlug || r.code.toLowerCase() === normalizedSlug) ?? null);

    const raw = (registryResponse as { skills?: Record<string, unknown>[] })?.skills ?? [];
    const ownerMap = new Map<string, Set<string>>();
    for (const agent of companyAgents) {
      const skillIds = Array.isArray(agent.skills) ? agent.skills : [];
      for (const sid of skillIds) {
        const trimmed = sid.trim();
        if (!trimmed) continue;
        const set = ownerMap.get(trimmed) ?? new Set();
        set.add(agent.name);
        ownerMap.set(trimmed, set);
      }
    }

    setRegistrySkills(
      raw
        .filter((r) => typeof r.id === "string" && String(r.id).trim())
        .map((r) => {
          const id = String(r.id);
          const owners = Array.from(ownerMap.get(id) ?? []);
          const files = Array.isArray(r.files) ? (r.files as string[]) : [];
          return {
            id,
            name: String(r.name ?? id),
            description: String(r.description ?? ""),
            source: r.source === "system" ? "system" : r.source === "bundled" ? "bundled" : "workspace",
            fileCount: Number(r.fileCount ?? files.length),
            files,
            fullContent: String(r.fullContent ?? ""),
            owners,
            key: `${slug}/${id}`,
            mode: r.source === "system" || r.source === "bundled" ? "read-only" : "editable",
          } satisfies SkillEntry;
        })
    );

    const rawCompanySkills = (companySkillResponse as { skills?: CompanySkillRecord[] } | null)?.skills ?? [];
    setCompanySkills(rawCompanySkills);
    const rawAssignments = (assignmentResponse as { assignments?: AgentSkillAssignmentRecord[] } | null)?.assignments ?? [];
    setSkillAssignments(rawAssignments);
    const rawMemories = (memoryResponse as { memories?: CompanyMemoryRecord[] } | null)?.memories ?? [];
    setMemoryRecords(rawMemories);
    const rawEffectiveness = (effectivenessResponse as { summary?: SkillEffectivenessRecord[]; totals?: SkillEffectivenessTotals } | null)?.summary ?? [];
    setSkillEffectiveness(rawEffectiveness);
    setSkillEffectivenessTotals(
      (effectivenessResponse as { totals?: SkillEffectivenessTotals } | null)?.totals ?? null,
    );

    setLoading(false);
  }, [slug]);

  const patchSkill = useCallback(async (skillId: string, body: Record<string, unknown>) => {
    setReviewBusy(`skill:${skillId}`);
    setReviewError(null);
    const response = await fetch(`/api/orchestration/companies/${encodeURIComponent(slug)}/skills`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: skillId, ...body }),
    }).catch(() => null);
    if (!response?.ok) {
      const payload = await response?.json().catch(() => null);
      setReviewError(payload?.error?.message || "Failed to update skill");
    } else {
      await load();
    }
    setReviewBusy(null);
  }, [load, slug]);

  const activateSkillAssignments = useCallback(async (skillId: string) => {
    const skill = companySkills.find((item) => item.id === skillId);
    if (!skill || skill.status !== "active" || skill.reviewState !== "approved") return;
    const assignments = skillAssignments.filter((assignment) => assignment.skillId === skillId && assignment.status !== "active");
    if (assignments.length === 0) return;
    setReviewBusy(`skill-assignments:${skillId}`);
    setReviewError(null);
    for (const assignment of assignments) {
      const response = await fetch(`/api/orchestration/companies/${encodeURIComponent(slug)}/skills/assignments`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: assignment.id, status: "active" }),
      }).catch(() => null);
      if (!response?.ok) {
        const payload = await response?.json().catch(() => null);
        setReviewError(payload?.error?.message || `Failed to activate ${assignment.agentName}'s assignment`);
        setReviewBusy(null);
        return;
      }
    }
    await load();
    setReviewBusy(null);
  }, [companySkills, load, skillAssignments, slug]);

  const approveAndActivateSkill = useCallback(async (skillId: string) => {
    await patchSkill(skillId, { status: "active", reviewState: "approved" });
  }, [patchSkill]);

  const routeReviewCandidates = useCallback(async () => {
    setReviewBusy("reviews:route");
    setReviewError(null);
    const response = await fetch(`/api/orchestration/companies/${encodeURIComponent(slug)}/reviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: "all" }),
    }).catch(() => null);
    if (!response?.ok) {
      const payload = await response?.json().catch(() => null);
      setReviewError(payload?.error?.message || "Failed to route review candidates");
    } else {
      await load();
    }
    setReviewBusy(null);
  }, [load, slug]);

  const patchMemory = useCallback(async (memoryId: string, body: Record<string, unknown>) => {
    setReviewBusy(`memory:${memoryId}`);
    setReviewError(null);
    const response = await fetch(`/api/orchestration/companies/${encodeURIComponent(slug)}/memory`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: memoryId, ...body }),
    }).catch(() => null);
    if (!response?.ok) {
      const payload = await response?.json().catch(() => null);
      setReviewError(payload?.error?.message || "Failed to update memory candidate");
    } else {
      await load();
    }
    setReviewBusy(null);
  }, [load, slug]);

  const handleAddSkill = async () => {
    const input = addInput.trim();
    if (!input) return;

    // Determine name and location from input
    let name: string;
    let location: string;

    if (input.startsWith("/") || input.startsWith("~")) {
      // Absolute path - use last directory segment as name
      const segments = input.replace(/\/+$/, "").split("/");
      name = segments[segments.length - 1];
      location = input;
    } else if (input.includes("/")) {
      // Could be a relative path or a github-style ref
      const segments = input.replace(/\/+$/, "").split("/");
      name = segments[segments.length - 1];
      location = input;
    } else {
      // Simple name - try workspace first, then system
      name = input;
      location = "workspace";
    }

    setAddBusy(true);
    setAddError(null);

    const res = await fetch("/api/skills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, location }),
    }).catch(() => null);

    if (res?.ok) {
      setAddInput("");
      setShowAddBar(false);
      await load();
    } else {
      const data = await res?.json().catch(() => null);
      setAddError(data?.error?.message || "Failed to add skill");
    }
    setAddBusy(false);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const filtered = useMemo(() => {
    if (!query.trim()) return registrySkills;
    const needle = query.trim().toLowerCase();
    return registrySkills.filter((s) =>
      `${s.name} ${s.id} ${s.description} ${s.owners.join(" ")}`.toLowerCase().includes(needle)
    );
  }, [registrySkills, query]);

  const selectedSkill = useMemo(
    () => registrySkills.find((s) => s.id === selectedSkillId) ?? null,
    [registrySkills, selectedSkillId],
  );

  const roleOptions = useMemo(
    () => Array.from(
      new Set(
        companySkills.flatMap((skill) => readRecommendedRoles(skill.metadata)),
      ),
    ).sort((a, b) => a.localeCompare(b)),
    [companySkills],
  );

  const catalogSkills = useMemo(
    () => companySkills
      .filter((skill) => skillMatchesCatalogFilter(skill, catalogFilter))
      .filter((skill) => skillMatchesRoleFilter(skill, roleFilter))
      .sort((a, b) => {
        const defaultDelta = Number(b.metadata.defaultSkill === true) - Number(a.metadata.defaultSkill === true);
        return defaultDelta || a.name.localeCompare(b.name);
      }),
    [catalogFilter, companySkills, roleFilter],
  );

  const catalogFilterLabel = useMemo(
    () => catalogFilterLabelFor(catalogFilter, roleFilter),
    [catalogFilter, roleFilter],
  );

  const updateCatalogParams = useCallback((next: { skillFilter?: CatalogFilter; role?: string | null }) => {
    const params = new URLSearchParams(searchParamString);
    if (next.skillFilter) {
      if (next.skillFilter === "all") params.delete("skillFilter");
      else params.set("skillFilter", next.skillFilter);
    }
    if ("role" in next) {
      const role = next.role?.trim();
      if (role) params.set("role", role);
      else params.delete("role");
    }
    const queryString = params.toString();
    router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
  }, [pathname, router, searchParamString]);

  const resetCatalogFilters = useCallback(() => {
    const params = new URLSearchParams(searchParamString);
    params.delete("skillFilter");
    params.delete("role");
    const queryString = params.toString();
    router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
  }, [pathname, router, searchParamString]);

  const defaultCompanySkills = useMemo(
    () => companySkills.filter((skill) => skill.metadata.defaultSkill === true),
    [companySkills],
  );

  const toggleExpand = (id: string) => {
    setExpandedSkills((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (loading) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ height: 200, borderRadius: 8, background: P.card, border: `1px solid ${P.cardBorder}`, animation: "pulse 1.5s infinite" }} />
      </div>
    );
  }

  if (!company) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ padding: 16, borderRadius: 8, background: P.errorDim, border: `1px solid ${P.error}`, color: P.error, fontSize: 13 }}>
          Company not found.
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "16px 20px", color: P.text, fontSize: 13, display: "flex", gap: 0, height: "calc(100vh - 80px)" }}>
      {/* ── Left: Skills list ── */}
      <div style={{ flex: selectedSkill ? "0 0 50%" : "1 1 auto", minWidth: 0, display: "flex", flexDirection: "column" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: P.text, fontFamily: "var(--font-heading)", letterSpacing: "-0.01em" }}>
              Skills
            </h1>
            <span style={{ fontSize: 11, color: P.muted }}>{filtered.length} available</span>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button
              type="button"
              onClick={() => void handleRefresh()}
              title="Refresh"
              style={{
                width: 28, height: 28, borderRadius: 6, display: "grid", placeItems: "center",
                background: "transparent", border: `1px solid ${P.cardBorder}`, color: P.muted, cursor: "pointer",
              }}
            >
              <RefreshCw size={13} style={{ animation: refreshing ? "spin 1s linear infinite" : "none" }} />
            </button>
            <button
              type="button"
              title="Add skill"
              onClick={() => { setShowAddBar((p) => !p); setAddError(null); }}
              style={{
                width: 28, height: 28, borderRadius: 6, display: "grid", placeItems: "center",
                background: showAddBar ? P.surfaceHover : P.surface,
                border: `1px solid ${showAddBar ? P.cardBorderHover : P.cardBorder}`,
                color: showAddBar ? P.text : P.muted, cursor: "pointer",
              }}
            >
              <Plus size={13} />
            </button>
          </div>
        </div>

        <CatalogFilterBar
          activeFilter={catalogFilter}
          activeRole={roleFilter}
          roleOptions={roleOptions}
          resultCount={catalogSkills.length}
          totalCount={companySkills.length}
          onFilterChange={(filter) => updateCatalogParams({ skillFilter: filter })}
          onRoleChange={(role) => updateCatalogParams({ role })}
          onReset={resetCatalogFilters}
        />

        <CompanySkillCatalog
          slug={slug}
          skills={catalogSkills}
          totalSkills={companySkills.length}
          label={catalogFilterLabel}
          defaultCount={defaultCompanySkills.length}
        />

        <LearningReviewPanel
          skills={companySkills}
          assignments={skillAssignments}
          memories={memoryRecords}
          busyKey={reviewBusy}
          error={reviewError}
          onApproveAndActivateSkill={approveAndActivateSkill}
          onActivateAssignments={activateSkillAssignments}
          onRouteReviews={routeReviewCandidates}
          onArchiveSkill={(skillId) => patchSkill(skillId, { status: "archived" })}
          onApproveMemory={(memoryId) => patchMemory(memoryId, { status: "active", reviewState: "approved" })}
          onRejectMemory={(memoryId) => patchMemory(memoryId, { status: "rejected", reviewState: "rejected" })}
          effectiveness={skillEffectiveness}
          effectivenessTotals={skillEffectivenessTotals}
        />

        {/* Filter */}
        <div style={{ position: "relative", marginBottom: 8 }}>
          <Search size={13} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: P.muted }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter skills"
            style={{
              width: "100%", padding: "7px 10px 7px 30px", borderRadius: 6,
              border: `1px solid ${P.cardBorder}`, background: "transparent",
              color: P.text, fontSize: 12, outline: "none",
            }}
          />
        </div>

        {/* Add/import bar */}
        {showAddBar && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                autoFocus
                value={addInput}
                onChange={(e) => { setAddInput(e.target.value); setAddError(null); }}
                onKeyDown={(e) => { if (e.key === "Enter") void handleAddSkill(); if (e.key === "Escape") { setShowAddBar(false); setAddInput(""); setAddError(null); } }}
                placeholder="Skill name, path, or workspace skill directory"
                style={{
                  flex: 1, padding: "7px 10px", borderRadius: 6,
                  border: `1px solid ${P.cardBorder}`, background: "transparent",
                  color: P.text, fontSize: 12, outline: "none",
                }}
              />
              <button
                type="button"
                onClick={() => void handleAddSkill()}
                disabled={addBusy || !addInput.trim()}
                style={{
                  padding: "7px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600,
                  background: P.successDim, border: `1px solid ${P.success}`,
                  color: P.success, cursor: "pointer",
                  opacity: addBusy || !addInput.trim() ? 0.5 : 1,
                }}
              >
                {addBusy ? "Adding..." : "Add"}
              </button>
            </div>
            {addError && (
              <p style={{ margin: "4px 0 0", fontSize: 11, color: P.error }}>{addError}</p>
            )}
          </div>
        )}

        {/* Skill list */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {filtered.length === 0 ? (
            <div style={{ padding: 32, textAlign: "center", color: P.muted, fontSize: 12 }}>
              No skills found.
            </div>
          ) : (
            filtered.map((skill) => {
              const isSelected = skill.id === selectedSkillId;
              const isExpanded = expandedSkills.has(skill.id);
              const hasFiles = skill.files.length > 0;

              return (
                <div key={skill.id}>
                  <div
                    style={{
                      display: "flex", alignItems: "center", gap: 8,
                      padding: "8px 10px",
                      background: isSelected ? P.surfaceHover : P.surface,
                      borderBottom: `1px solid ${P.cardBorder}`,
                      cursor: "pointer",
                      transition: "background 0.12s",
                    }}
                    onClick={(e) => {
                      // Ctrl/Cmd+click or middle-click: open routed detail in new tab
                      if (e.metaKey || e.ctrlKey) {
                        window.open(`/companies/${slug}/skills/${encodeURIComponent(skill.id)}`, "_blank");
                        return;
                      }
                      setSelectedSkillId(isSelected ? null : skill.id);
                      setViewMode("view");
                    }}
                    onDoubleClick={() => {
                      router.push(`/companies/${slug}/skills/${encodeURIComponent(skill.id)}`);
                    }}
                    onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = P.surfaceHover; }}
                    onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = P.surface; }}
                  >
                    {/* Expand toggle */}
                    {hasFiles ? (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); toggleExpand(skill.id); }}
                        style={{ background: "transparent", border: "none", color: P.muted, cursor: "pointer", padding: 0, display: "grid", placeItems: "center", width: 16, flexShrink: 0 }}
                      >
                        {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      </button>
                    ) : (
                      <div style={{ width: 16, flexShrink: 0 }} />
                    )}

                    <Link2 size={13} style={{ color: P.muted, flexShrink: 0 }} />

                    <span style={{
                      flex: 1, fontSize: 13, color: P.text, fontWeight: 500,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {skill.name}
                    </span>

                    {skill.owners.length > 0 && (
                      <span style={{ fontSize: 10, color: P.muted, flexShrink: 0 }}>
                        {skill.owners.length} agent{skill.owners.length !== 1 ? "s" : ""}
                      </span>
                    )}

                    <ChevronRight size={13} style={{ color: P.muted, flexShrink: 0, opacity: 0.5 }} />
                  </div>

                  {/* Expanded file tree */}
                  {isExpanded && hasFiles && (
                    <div style={{ paddingLeft: 42, borderBottom: `1px solid ${P.cardBorder}` }}>
                      {skill.files.map((file) => {
                        const isDir = file.endsWith("/");
                        return (
                          <div
                            key={file}
                            style={{
                              display: "flex", alignItems: "center", gap: 6,
                              padding: "4px 8px", fontSize: 12, color: P.textSec,
                            }}
                          >
                            {isDir ? <FolderOpen size={12} style={{ color: P.muted }} /> : <FileText size={12} style={{ color: P.muted }} />}
                            {file}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── Right: Skill detail ── */}
      {selectedSkill && (
        <SkillDetailPanel
          skill={selectedSkill}
          slug={slug}
          viewMode={viewMode}
          setViewMode={setViewMode}
          onClose={() => setSelectedSkillId(null)}
        />
      )}
    </div>
  );
}

function statusTone(status: CompanySkillRecord["status"] | CompanyMemoryRecord["status"]): { bg: string; border: string; text: string } {
  if (status === "active") {
    return { bg: P.successDim, border: P.success, text: P.success };
  }
  if (status === "rejected") {
    return { bg: P.errorDim, border: P.error, text: P.error };
  }
  if (status === "archived") {
    return { bg: P.surfaceElevated, border: P.cardBorder, text: P.muted };
  }
  return { bg: P.warnDim, border: P.warn, text: P.warn };
}

function normalizeCatalogFilter(value: string | null): CatalogFilter {
  if (value === "default" || value === "company" || value === "learned" || value === "draft-review") return value;
  return "all";
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getReviewRouting(metadata: CandidateMetadata): ReviewRoutingMetadata | null {
  const route = metadata.reviewRouting;
  if (!route || typeof route !== "object" || Array.isArray(route)) return null;
  const routeRecord = route as Record<string, unknown>;
  return {
    version: readString(routeRecord.version) ?? undefined,
    routedAt: readString(routeRecord.routedAt) ?? undefined,
    reviewerAgentId: readString(routeRecord.reviewerAgentId) ?? undefined,
    reviewerAgentName: readString(routeRecord.reviewerAgentName) ?? undefined,
    reviewerRole: readString(routeRecord.reviewerRole) ?? undefined,
    rule: readString(routeRecord.rule) ?? undefined,
    reason: readString(routeRecord.reason) ?? undefined,
  };
}

function getReviewTask(metadata: CandidateMetadata): ReviewTaskMetadata | null {
  const task = metadata.reviewTask;
  if (!task || typeof task !== "object" || Array.isArray(task)) return null;
  const taskRecord = task as Record<string, unknown>;
  return {
    taskKey: readString(taskRecord.taskKey) ?? undefined,
    reviewerAgentName: readString(taskRecord.reviewerAgentName) ?? undefined,
    executionEngine: readString(taskRecord.executionEngine) ?? undefined,
  };
}

function getReviewDecision(metadata: CandidateMetadata): ReviewDecisionMetadata | null {
  const decision = metadata.reviewDecision;
  if (!decision || typeof decision !== "object" || Array.isArray(decision)) return null;
  const decisionRecord = decision as Record<string, unknown>;
  return {
    decision: readString(decisionRecord.decision) ?? undefined,
    reviewerAgentName: readString(decisionRecord.reviewerAgentName) ?? undefined,
    note: readString(decisionRecord.note),
    confidence: readNumber(decisionRecord.confidence),
  };
}

function getReviewActivation(metadata: CandidateMetadata): ReviewActivationMetadata | null {
  const activation = metadata.reviewActivation;
  if (!activation || typeof activation !== "object" || Array.isArray(activation)) return null;
  const activationRecord = activation as Record<string, unknown>;
  return {
    activatedAssignmentCount: readNumber(activationRecord.activatedAssignmentCount) ?? undefined,
  };
}

function getRuntimeExport(metadata: CandidateMetadata): RuntimeExportMetadata | null {
  const exportMetadata = metadata.runtimeExport;
  if (!exportMetadata || typeof exportMetadata !== "object" || Array.isArray(exportMetadata)) return null;
  const record = exportMetadata as Record<string, unknown>;
  return {
    exported: typeof record.exported === "boolean" ? record.exported : undefined,
    status: readString(record.status) ?? undefined,
    path: readString(record.path),
    syncedAt: readString(record.syncedAt) ?? undefined,
    version: readNumber(record.version) ?? undefined,
  };
}

function readRecommendedRoles(metadata: CandidateMetadata): string[] {
  if (!Array.isArray(metadata.recommendedAgentRoles)) return [];
  return metadata.recommendedAgentRoles
    .filter((role): role is string => typeof role === "string" && role.trim().length > 0)
    .map((role) => role.trim().toLowerCase());
}

function skillMatchesCatalogFilter(skill: CompanySkillRecord, filter: CatalogFilter): boolean {
  if (filter === "all") return skill.status !== "archived";
  if (filter === "default") return skill.metadata.defaultSkill === true && skill.status !== "archived";
  if (filter === "company") return skill.metadata.defaultSkill !== true && (skill.source === "manual" || skill.source === "imported") && skill.status !== "archived";
  if (filter === "learned") return skill.source === "learned" && skill.status !== "archived";
  return skill.status === "draft" || skill.reviewState === "requested" || (skill.reviewRequired && skill.reviewState !== "approved");
}

function skillMatchesRoleFilter(skill: CompanySkillRecord, role: string): boolean {
  if (!role) return true;
  const roles = readRecommendedRoles(skill.metadata);
  return roles.includes(role) || roles.includes("all");
}

function catalogFilterLabelFor(filter: CatalogFilter, role: string): string {
  const base = filter === "all"
    ? "All company skills"
    : filter === "default"
      ? "Default skills"
      : filter === "company"
        ? "Company-created skills"
        : filter === "learned"
          ? "Learned skills"
          : "Draft review skills";
  return role ? `${base} for ${role}` : base;
}

function runtimeExportLine(metadata: CandidateMetadata): string | null {
  const exportMetadata = getRuntimeExport(metadata);
  if (!exportMetadata) return null;
  const status = exportMetadata.exported ? "Runtime export ready" : "Runtime export inactive";
  const version = exportMetadata.version ? `v${exportMetadata.version}` : null;
  const pathPart = exportMetadata.path?.match(new RegExp("/skills/[^/]+/SKILL\\.md$"))?.[0]?.slice(1) ?? null;
  return [status, version, pathPart].filter(Boolean).join(" · ");
}

function formatRule(rule: string | undefined): string {
  if (!rule) return "Review";
  return rule
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatRoutingDate(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function candidateEvidenceLine(metadata: CandidateMetadata): string | null {
  const parts: string[] = [];
  const topic = readString(metadata.candidateTopic);
  const evidenceCount = readNumber(metadata.evidenceCount);
  const supportingMemoryIds = Array.isArray(metadata.supportingMemoryIds) ? metadata.supportingMemoryIds.length : 0;
  const supportingTaskKeys = Array.isArray(metadata.supportingTaskKeys) ? metadata.supportingTaskKeys.length : 0;

  if (topic) parts.push(`Topic: ${topic}`);
  if (evidenceCount !== null) parts.push(`${evidenceCount} evidence item${evidenceCount === 1 ? "" : "s"}`);
  else if (supportingMemoryIds > 0) parts.push(`${supportingMemoryIds} memory source${supportingMemoryIds === 1 ? "" : "s"}`);
  if (supportingTaskKeys > 0) parts.push(`${supportingTaskKeys} task source${supportingTaskKeys === 1 ? "" : "s"}`);

  return parts.length ? parts.join(" · ") : null;
}

function RoutingReviewBlock({
  routing,
  requested,
  task,
  decision,
  activation,
}: {
  routing: ReviewRoutingMetadata | null;
  requested: boolean;
  task: ReviewTaskMetadata | null;
  decision: ReviewDecisionMetadata | null;
  activation: ReviewActivationMetadata | null;
}) {
  if (!routing && !requested && !task && !decision && !activation) return null;
  const routedAt = formatRoutingDate(routing?.routedAt);
  const activated = activation?.activatedAssignmentCount ?? 0;
  return (
    <div style={{
      marginTop: 6,
      padding: "6px 7px",
      borderRadius: 6,
      border: `1px solid ${routing ? P.info : P.warn}`,
      background: routing ? P.infoSoft : P.warnDim,
    }}>
      <div style={{ display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 10, color: P.textSec, fontWeight: 700 }}>
          {routing ? `Reviewer: ${routing.reviewerAgentName ?? "Unassigned"}` : "Reviewer: Not routed"}
        </span>
        <span style={{
          padding: "1px 5px",
          borderRadius: 999,
          border: `1px solid ${routing ? P.info : P.warn}`,
          color: routing ? P.info : P.warn,
          fontSize: 9,
          fontWeight: 700,
        }}>
          {formatRule(routing?.rule)}
        </span>
        {routedAt && <span style={{ fontSize: 9, color: P.muted }}>{routedAt}</span>}
      </div>
      <div style={{
        marginTop: 3,
        fontSize: 10,
        color: P.muted,
        lineHeight: 1.35,
        display: "-webkit-box",
        WebkitLineClamp: 2,
        WebkitBoxOrient: "vertical",
        overflow: "hidden",
      }}>
        {routing?.reason ?? "Run routing to assign this candidate to the right reviewer before approval."}
      </div>
      {(task?.taskKey || decision?.decision || activated > 0) && (
        <div style={{ marginTop: 5, display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
          {task?.taskKey && (
            <span style={{ fontSize: 9, color: P.textSec }}>
              Review task: {task.taskKey}{task.executionEngine ? ` · ${task.executionEngine}` : ""}
            </span>
          )}
          {decision?.decision && (
            <span style={{ fontSize: 9, color: decision.decision === "approve" ? P.success : P.error, fontWeight: 700 }}>
              {decision.decision === "approve" ? "Approved" : "Rejected"} by {decision.reviewerAgentName ?? "reviewer"}
              {typeof decision.confidence === "number" ? ` · ${Math.round(decision.confidence * 100)}%` : ""}
            </span>
          )}
          {activated > 0 && (
            <span style={{ fontSize: 9, color: P.success, fontWeight: 700 }}>
              {activated} assignment{activated === 1 ? "" : "s"} activated
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function LearningReviewPanel({
  skills,
  assignments,
  memories,
  busyKey,
  error,
  onApproveAndActivateSkill,
  onActivateAssignments,
  onRouteReviews,
  onArchiveSkill,
  onApproveMemory,
  onRejectMemory,
  effectiveness,
  effectivenessTotals,
}: {
  skills: CompanySkillRecord[];
  assignments: AgentSkillAssignmentRecord[];
  memories: CompanyMemoryRecord[];
  effectiveness: SkillEffectivenessRecord[];
  effectivenessTotals: SkillEffectivenessTotals | null;
  busyKey: string | null;
  error: string | null;
  onApproveAndActivateSkill: (skillId: string) => Promise<void>;
  onActivateAssignments: (skillId: string) => Promise<void>;
  onRouteReviews: () => Promise<void>;
  onArchiveSkill: (skillId: string) => Promise<void>;
  onApproveMemory: (memoryId: string) => Promise<void>;
  onRejectMemory: (memoryId: string) => Promise<void>;
}) {
  const counts = skills.reduce(
    (acc, skill) => {
      acc[skill.status] += 1;
      return acc;
    },
    { draft: 0, active: 0, archived: 0 },
  );

  const visibleSkills = skills.slice(0, 5);
  const visibleMemories = memories
    .filter((memory) => memory.status !== "archived")
    .slice(0, 4);
  const activeAssignments = assignments.filter((assignment) => assignment.status === "active").length;
  const draftAssignments = assignments.filter((assignment) => assignment.status === "draft").length;
  const memoryDrafts = memories.filter((memory) => memory.status === "draft").length;
  const routedSkillDrafts = skills.filter((skill) => skill.status === "draft" && getReviewRouting(skill.metadata)).length;
  const routedMemoryDrafts = memories.filter((memory) => memory.status === "draft" && getReviewRouting(memory.metadata)).length;
  const pendingReviews = skills.filter((skill) => skill.reviewState === "requested" && skill.status === "draft").length
    + memories.filter((memory) => memory.reviewState === "requested" && memory.status === "draft").length;
  const effectivenessBySkill = useMemo(
    () => new Map(effectiveness.map((row) => [row.skillId, row])),
    [effectiveness],
  );
  const visibleEffectiveness = effectiveness
    .filter((row) => row.needsAttention || row.availableCount > 0 || row.explicitUseCount > 0 || row.passCount > 0 || row.failCount > 0 || row.blockedCount > 0)
    .sort((a, b) => Number(b.needsAttention) - Number(a.needsAttention))
    .slice(0, 5);

  return (
    <div style={{
      marginBottom: 10,
      padding: 10,
      borderRadius: 8,
      border: `1px solid ${P.cardBorder}`,
      background: P.card,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", marginBottom: 8 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 650, color: P.text }}>
            <Brain size={13} style={{ color: P.accent }} />
            Learning review
          </div>
          <div style={{ fontSize: 11, color: P.muted }}>
            Routed reviewer agents own normal decisions; operator controls are overrides
          </div>
          <div style={{ fontSize: 10, color: P.muted, marginTop: 2 }}>
            Assignments: {activeAssignments} active · {draftAssignments} draft · Pending reviews: {pendingReviews} · Routed: {routedSkillDrafts + routedMemoryDrafts}
          </div>
        </div>
        <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
          <ReviewButton
            label="Route"
            title="Assign draft review candidates to the best reviewer"
            icon={<RefreshCw size={12} />}
            busy={busyKey === "reviews:route"}
            onClick={onRouteReviews}
          />
          {(["draft", "active", "archived"] as const).map((status) => {
            const tone = statusTone(status);
            return (
              <span
                key={status}
                style={{
                  padding: "2px 6px",
                  borderRadius: 999,
                  border: `1px solid ${tone.border}`,
                  background: tone.bg,
                  color: tone.text,
                  fontSize: 10,
                  fontWeight: 650,
                  textTransform: "capitalize",
                }}
              >
                {counts[status]} {status}
              </span>
            );
          })}
        </div>
      </div>

      {error && (
        <div style={{
          marginBottom: 8,
          padding: "6px 8px",
          borderRadius: 6,
          border: `1px solid ${P.error}`,
          background: P.errorDim,
          color: P.error,
          fontSize: 11,
        }}>
          {error}
        </div>
      )}

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
        gap: 6,
        marginBottom: 8,
      }}>
        <EffectivenessMetric label="Available" value={effectivenessTotals?.availableCount ?? 0} />
        <EffectivenessMetric label="Used" value={effectivenessTotals?.explicitUseCount ?? 0} />
        <EffectivenessMetric label="Passed" value={effectivenessTotals?.passCount ?? 0} />
        <EffectivenessMetric label="Watch" value={effectivenessTotals?.attentionCount ?? 0} />
      </div>

      {visibleEffectiveness.length > 0 && (
        <div style={{ marginBottom: 8, display: "grid", gap: 5 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, fontWeight: 700, color: P.muted, textTransform: "uppercase" }}>
            <BarChart3 size={11} />
            Runtime effectiveness
          </div>
          {visibleEffectiveness.map((row) => (
            <EffectivenessRow key={row.skillId} row={row} />
          ))}
        </div>
      )}

      {visibleSkills.length === 0 ? (
        <div style={{ fontSize: 11, color: P.muted, lineHeight: 1.45 }}>
          No company skill records yet. Phase 1 adds the registry; learned skill candidates will start as drafts in a later phase.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 6 }}>
          {visibleSkills.map((skill) => {
            const tone = statusTone(skill.status);
            const assigned = assignments.filter((assignment) => assignment.skillId === skill.id && assignment.status !== "archived");
            const activeAssigned = assigned.filter((assignment) => assignment.status === "active").length;
            const canActivateSkill = skill.status !== "active" || skill.reviewState !== "approved";
            const canActivateAssignments = skill.status === "active" && skill.reviewState === "approved" && assigned.length > activeAssigned;
            const routing = getReviewRouting(skill.metadata);
            const reviewTask = getReviewTask(skill.metadata);
            const reviewDecision = getReviewDecision(skill.metadata);
            const reviewActivation = getReviewActivation(skill.metadata);
            const evidenceLine = candidateEvidenceLine(skill.metadata);
            const effectivenessRow = effectivenessBySkill.get(skill.id);
            const exportLine = runtimeExportLine(skill.metadata);
            return (
              <div
                key={skill.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  gap: 8,
                  alignItems: "center",
                  padding: "7px 8px",
                  borderRadius: 6,
                  border: `1px solid ${P.cardBorder}`,
                  background: P.surfaceElevated,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: P.text, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {skill.name}
                  </div>
                  <div style={{ fontSize: 10, color: P.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    v{skill.version} · {skill.source} · {skill.scope}
                    {skill.ownerAgentName ? ` · ${skill.ownerAgentName}` : ""}
                    {skill.assignedAgentCount ? ` · ${activeAssigned}/${skill.assignedAgentCount} active assignment${skill.assignedAgentCount === 1 ? "" : "s"}` : ""}
                  </div>
                  {skill.description && (
                    <div style={{
                      marginTop: 3,
                      fontSize: 10,
                      color: P.textSec,
                      lineHeight: 1.35,
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}>
                      {skill.description}
                    </div>
                  )}
                  {skill.assignedAgentNames.length > 0 && (
                    <div style={{ fontSize: 10, color: P.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>
                      Assigned to: {skill.assignedAgentNames.join(", ")}
                    </div>
                  )}
                  {evidenceLine && (
                    <div style={{ fontSize: 10, color: P.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>
                      {evidenceLine}
                    </div>
                  )}
                  {exportLine && (
                    <div style={{ fontSize: 10, color: P.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>
                      {exportLine}
                    </div>
                  )}
                  <RoutingReviewBlock
                    routing={routing}
                    requested={skill.reviewState === "requested"}
                    task={reviewTask}
                    decision={reviewDecision}
                    activation={reviewActivation}
                  />
                  {effectivenessRow && (
                    <div style={{ marginTop: 4 }}>
                      <EffectivenessInline row={effectivenessRow} />
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  <span
                    style={{
                      padding: "2px 6px",
                      borderRadius: 999,
                      border: `1px solid ${tone.border}`,
                      background: tone.bg,
                      color: tone.text,
                      fontSize: 10,
                      fontWeight: 650,
                      textTransform: "capitalize",
                    }}
                  >
                    {skill.status}
                  </span>
                  {canActivateSkill && (
                    <ReviewButton
                      label="Override approve"
                      title="Operator override: approve and activate this skill"
                      icon={<CheckCircle2 size={12} />}
                      busy={busyKey === `skill:${skill.id}`}
                      onClick={() => onApproveAndActivateSkill(skill.id)}
                    />
                  )}
                  {canActivateAssignments && (
                    <ReviewButton
                      label="Assign"
                      title="Activate draft assignments for this approved skill"
                      icon={<CheckCircle2 size={12} />}
                      busy={busyKey === `skill-assignments:${skill.id}`}
                      onClick={() => onActivateAssignments(skill.id)}
                    />
                  )}
                  {skill.status !== "archived" && (
                    <ReviewIconButton
                      title="Operator override: archive skill"
                      icon={<Archive size={12} />}
                      busy={busyKey === `skill:${skill.id}`}
                      onClick={() => onArchiveSkill(skill.id)}
                    />
                  )}
                </div>
              </div>
            );
          })}
          {skills.length > visibleSkills.length && (
            <div style={{ fontSize: 10, color: P.muted }}>
              {skills.length - visibleSkills.length} more company skill record{skills.length - visibleSkills.length === 1 ? "" : "s"}
            </div>
          )}
        </div>
      )}

      <div style={{ height: 1, background: P.cardBorder, margin: "10px 0" }} />

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6 }}>
        <div style={{ fontSize: 11, color: P.text, fontWeight: 650 }}>Memory candidates</div>
        <div style={{ fontSize: 10, color: P.muted }}>{memories.length} total · {memoryDrafts} draft</div>
      </div>
      {visibleMemories.length === 0 ? (
        <div style={{ fontSize: 11, color: P.muted, lineHeight: 1.45 }}>
          No memory candidates yet. Extraction will create drafts here before anything becomes durable runtime context.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 6 }}>
          {visibleMemories.map((memory) => {
            const tone = statusTone(memory.status);
            const routing = getReviewRouting(memory.metadata);
            const reviewTask = getReviewTask(memory.metadata);
            const reviewDecision = getReviewDecision(memory.metadata);
            const reviewActivation = getReviewActivation(memory.metadata);
            const evidenceLine = candidateEvidenceLine(memory.metadata);
            const provenance = [
              memory.projectName,
              memory.agentName,
              memory.taskKey,
            ].filter(Boolean).join(" · ");
            return (
              <div
                key={memory.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  gap: 8,
                  alignItems: "center",
                  padding: "7px 8px",
                  borderRadius: 6,
                  border: `1px solid ${P.cardBorder}`,
                  background: P.surfaceElevated,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: P.text, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {memory.title}
                  </div>
                  <div style={{ fontSize: 10, color: P.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {memory.kind} · {memory.source} · confidence {Math.round(memory.confidence * 100)}%
                    {provenance ? ` · ${provenance}` : ""}
                  </div>
                  {memory.body && (
                    <div style={{
                      marginTop: 3,
                      fontSize: 10,
                      color: P.textSec,
                      lineHeight: 1.35,
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}>
                      {memory.body}
                    </div>
                  )}
                  {evidenceLine && (
                    <div style={{ fontSize: 10, color: P.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 3 }}>
                      {evidenceLine}
                    </div>
                  )}
                  <RoutingReviewBlock
                    routing={routing}
                    requested={memory.reviewState === "requested"}
                    task={reviewTask}
                    decision={reviewDecision}
                    activation={reviewActivation}
                  />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 5, justifyContent: "flex-end" }}>
                  <span
                    style={{
                      padding: "2px 6px",
                      borderRadius: 999,
                      border: `1px solid ${tone.border}`,
                      background: tone.bg,
                      color: tone.text,
                      fontSize: 10,
                      fontWeight: 650,
                      textTransform: "capitalize",
                    }}
                  >
                    {memory.status}
                  </span>
                  {memory.status !== "active" && (
                    <ReviewButton
                      label="Override approve"
                      title="Operator override: approve and activate this memory candidate"
                      icon={<CheckCircle2 size={12} />}
                      busy={busyKey === `memory:${memory.id}`}
                      onClick={() => onApproveMemory(memory.id)}
                    />
                  )}
                  {memory.status !== "rejected" && memory.status !== "active" && (
                    <ReviewIconButton
                      title="Operator override: reject memory candidate"
                      icon={<X size={12} />}
                      busy={busyKey === `memory:${memory.id}`}
                      onClick={() => onRejectMemory(memory.id)}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CatalogFilterBar({
  activeFilter,
  activeRole,
  roleOptions,
  resultCount,
  totalCount,
  onFilterChange,
  onRoleChange,
  onReset,
}: {
  activeFilter: CatalogFilter;
  activeRole: string;
  roleOptions: string[];
  resultCount: number;
  totalCount: number;
  onFilterChange: (filter: CatalogFilter) => void;
  onRoleChange: (role: string | null) => void;
  onReset: () => void;
}) {
  const filters: Array<{ value: CatalogFilter; label: string }> = [
    { value: "all", label: "All" },
    { value: "default", label: "Defaults" },
    { value: "company", label: "Company-created" },
    { value: "learned", label: "Learned" },
    { value: "draft-review", label: "Draft review" },
  ];

  return (
    <div style={{
      marginBottom: 10,
      padding: 9,
      borderRadius: 7,
      border: `1px solid ${P.cardBorder}`,
      background: P.surfaceElevated,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: P.text }}>
            Catalog filters
          </div>
          <div style={{ fontSize: 10, color: P.muted, marginTop: 2 }}>
            URL-driven filters for defaults, company-created, learned, draft-review, and recommended role
          </div>
        </div>
        <span style={{ fontSize: 10, color: P.muted }}>
          {resultCount}/{totalCount} shown
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        {filters.map((filter) => (
          <button
            key={filter.value}
            type="button"
            onClick={() => onFilterChange(filter.value)}
            style={{
              padding: "5px 8px",
              borderRadius: 6,
              border: `1px solid ${activeFilter === filter.value ? P.cardBorderHover : P.cardBorder}`,
              background: activeFilter === filter.value ? P.surfaceHover : P.surface,
              color: activeFilter === filter.value ? P.text : P.textSec,
              fontSize: 10,
              fontWeight: activeFilter === filter.value ? 700 : 600,
              cursor: "pointer",
            }}
          >
            {filter.label}
          </button>
        ))}
        <select
          value={activeRole}
          onChange={(event) => onRoleChange(event.target.value || null)}
          title="Filter by recommended role"
          style={{
            height: 27,
            borderRadius: 6,
            border: `1px solid ${activeRole ? P.cardBorderHover : P.cardBorder}`,
            background: P.surface,
            color: activeRole ? P.text : P.textSec,
            fontSize: 10,
            fontWeight: 600,
            padding: "0 8px",
            outline: "none",
          }}
        >
          <option value="">Any recommended role</option>
          {roleOptions.map((role) => (
            <option key={role} value={role}>{role}</option>
          ))}
        </select>
        {(activeFilter !== "all" || activeRole) && (
          <button
            type="button"
            onClick={onReset}
            style={{
              padding: "5px 8px",
              borderRadius: 6,
              border: `1px solid ${P.cardBorder}`,
              background: P.surface,
              color: P.muted,
              fontSize: 10,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reset
          </button>
        )}
      </div>
    </div>
  );
}

function CompanySkillCatalog({
  slug,
  skills,
  totalSkills,
  label,
  defaultCount,
}: {
  slug: string;
  skills: CompanySkillRecord[];
  totalSkills: number;
  label: string;
  defaultCount: number;
}) {
  const visible = skills.slice(0, 18);

  return (
    <div style={{
      marginBottom: 10,
      padding: 9,
      borderRadius: 7,
      border: `1px solid ${P.cardBorder}`,
      background: P.successDim,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", marginBottom: 8 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: P.text }}>
            <ShieldCheck size={13} style={{ color: P.success }} />
            {label}
          </div>
          <div style={{ fontSize: 10, color: P.muted, marginTop: 2 }}>
            Skills keep their explanations, workflows, assignments, and runtime preview visible.
          </div>
        </div>
        <span style={{ fontSize: 10, color: P.muted }}>
          {skills.length}/{totalSkills} skill{totalSkills === 1 ? "" : "s"} · {defaultCount} default{defaultCount === 1 ? "" : "s"}
        </span>
      </div>

      {visible.length === 0 ? (
        <div style={{ padding: "12px 8px", borderRadius: 6, border: `1px dashed ${P.cardBorder}`, color: P.muted, fontSize: 11 }}>
          No company skills match this filter.
        </div>
      ) : (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 6,
        }}>
          {visible.map((skill) => {
          const runtimeExport = getRuntimeExport(skill.metadata);
          const body = typeof skill.metadata.runtimeSkillBody === "string" ? skill.metadata.runtimeSkillBody : "";
          const sectionCount = body.split("\n## ").length - 1;
          const explanationSectionCount = sectionCount || 1;
          const roles = readRecommendedRoles(skill.metadata);
          return (
            <Link
              key={skill.id}
              href={`/companies/${encodeURIComponent(slug)}/skills/${encodeURIComponent(skill.slug)}`}
              style={{
                display: "block",
                padding: "8px 9px",
                borderRadius: 7,
                border: `1px solid ${P.cardBorder}`,
                background: P.surfaceElevated,
                textDecoration: "none",
                color: P.text,
                minWidth: 0,
              }}
            >
              <div style={{ display: "flex", gap: 6, alignItems: "center", minWidth: 0 }}>
                <div style={{ fontSize: 11, color: P.text, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {skill.name}
                </div>
                <span style={{
                  marginLeft: "auto",
                  fontSize: 9,
                  color: skill.metadata.defaultSkill === true ? P.success : runtimeExport?.exported ? P.info : P.muted,
                  flexShrink: 0,
                }}>
                  {skill.metadata.defaultSkill === true ? "default" : runtimeExport?.exported ? "exported" : skill.status}
                </span>
              </div>
              <div style={{
                marginTop: 4,
                fontSize: 10,
                color: P.textSec,
                lineHeight: 1.35,
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}>
                {skill.description}
              </div>
              <div style={{ marginTop: 5, display: "flex", gap: 6, flexWrap: "wrap", color: P.muted, fontSize: 9 }}>
                <span>{skill.source}</span>
                <span>{skill.assignedAgentCount} agent{skill.assignedAgentCount === 1 ? "" : "s"}</span>
                <span>{explanationSectionCount} explanation section{explanationSectionCount === 1 ? "" : "s"}</span>
                {roles.length > 0 && <span>{roles.join(", ")}</span>}
                <span>View details</span>
              </div>
            </Link>
          );
          })}
        </div>
      )}
    </div>
  );
}

function EffectivenessMetric({ label, value }: { label: string; value: number }) {
  return (
    <div style={{
      padding: "6px 7px",
      borderRadius: 6,
      border: `1px solid ${P.cardBorder}`,
      background: P.surfaceElevated,
      minWidth: 0,
    }}>
      <div style={{ fontSize: 15, fontWeight: 750, color: P.text, lineHeight: 1 }}>
        {value}
      </div>
      <div style={{ marginTop: 3, fontSize: 9, color: P.muted, textTransform: "uppercase", fontWeight: 700 }}>
        {label}
      </div>
    </div>
  );
}

function EffectivenessRow({ row }: { row: SkillEffectivenessRecord }) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "minmax(0, 1fr) auto",
      gap: 8,
      alignItems: "center",
      padding: "6px 7px",
      borderRadius: 6,
      border: `1px solid ${P.cardBorder}`,
      background: P.surfaceElevated,
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
          <div style={{ fontSize: 11, color: P.text, fontWeight: 650, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {row.skillName}
          </div>
          <HealthPill row={row} compact />
        </div>
        <div style={{ fontSize: 9, color: P.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {row.assignedAgentNames.length > 0 ? row.assignedAgentNames.join(", ") : "No active assignments"}
        </div>
        {row.needsAttention && (
          <div style={{ marginTop: 2, fontSize: 9, color: P.textSec, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {row.healthReason}
          </div>
        )}
      </div>
      <EffectivenessInline row={row} />
    </div>
  );
}

function EffectivenessInline({ row }: { row: SkillEffectivenessRecord }) {
  const issueCount = row.failCount + row.blockedCount;
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
      <HealthPill row={row} />
      <EffectivenessPill label="seen" value={row.availableCount} />
      <EffectivenessPill label="used" value={row.explicitUseCount} />
      <EffectivenessPill label="pass" value={row.passCount} tone="good" />
      {issueCount > 0 && <EffectivenessPill label="fix" value={issueCount} tone="bad" />}
    </div>
  );
}

function HealthPill({ row, compact = false }: { row: SkillEffectivenessRecord; compact?: boolean }) {
  const tone = row.healthSeverity;
  const color = tone === "danger" ? P.error
    : tone === "warning" ? P.warn
      : tone === "info" ? P.info
        : P.muted;
  const border = tone === "danger" ? P.error
    : tone === "warning" ? P.warn
      : tone === "info" ? P.info
        : P.cardBorder;
  const bg = tone === "danger" ? P.errorDim
    : tone === "warning" ? P.warnDim
      : tone === "info" ? P.infoSoft
        : P.surfaceElevated;
  return (
    <span
      title={row.healthReason}
      style={{
        display: "inline-flex",
        alignItems: "center",
        height: compact ? 17 : 19,
        padding: compact ? "0 5px" : "0 6px",
        borderRadius: 999,
        border: `1px solid ${border}`,
        background: bg,
        color,
        fontSize: compact ? 8 : 9,
        fontWeight: 750,
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      {row.healthLabel}
    </span>
  );
}

function EffectivenessPill({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "good" | "bad";
}) {
  const color = tone === "good" ? P.success : tone === "bad" ? P.error : P.textSec;
  const border = tone === "good" ? P.success : tone === "bad" ? P.error : P.cardBorder;
  const bg = tone === "good" ? P.successDim : tone === "bad" ? P.errorDim : P.surfaceElevated;
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 3,
      height: 19,
      padding: "0 5px",
      borderRadius: 999,
      border: `1px solid ${border}`,
      background: bg,
      color,
      fontSize: 9,
      fontWeight: 700,
      whiteSpace: "nowrap",
    }}>
      <span>{value}</span>
      <span style={{ color: P.muted }}>{label}</span>
    </span>
  );
}

function ReviewButton({
  icon,
  label,
  title,
  busy,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  title: string;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={busy}
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        height: 24,
        padding: "0 7px",
        borderRadius: 6,
        border: `1px solid ${P.cardBorder}`,
        background: busy ? P.surfaceHover : P.surface,
        color: P.textSec,
        fontSize: 10,
        fontWeight: 650,
        cursor: busy ? "default" : "pointer",
        opacity: busy ? 0.6 : 1,
      }}
    >
      {icon}
      {busy ? "Saving" : label}
    </button>
  );
}

function ReviewIconButton({
  icon,
  title,
  busy,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={busy}
      onClick={onClick}
      style={{
        width: 24,
        height: 24,
        borderRadius: 6,
        border: `1px solid ${P.cardBorder}`,
        background: "transparent",
        color: P.muted,
        display: "grid",
        placeItems: "center",
        cursor: busy ? "default" : "pointer",
        opacity: busy ? 0.5 : 1,
      }}
    >
      {icon}
    </button>
  );
}

/* ─── Skill Detail Panel ─── */
function SkillDetailPanel({
  skill, slug, viewMode, setViewMode, onClose,
}: {
  skill: SkillEntry;
  slug: string;
  viewMode: "view" | "code";
  setViewMode: (m: "view" | "code") => void;
  onClose: () => void;
}) {
  const isReadOnly = skill.mode === "read-only";
  const sourceLabel = skill.source === "bundled" ? "MC bundled"
    : skill.source === "system" ? "System"
    : "Workspace";

  return (
    <div style={{
      flex: "0 0 50%", borderLeft: `1px solid ${P.cardBorder}`,
      display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden",
    }}>
      <div style={{ flex: 1, padding: "16px 20px", overflowY: "auto" }}>
        {/* Breadcrumb */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12, fontSize: 12, color: P.muted }}>
          <span>Skills</span>
          <ChevronRight size={12} />
          <Link href={`/companies/${slug}/skills/${encodeURIComponent(skill.id)}`} style={{ color: P.textSec, textDecoration: "none" }}>
            Detail
          </Link>
        </div>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <Link href={`/companies/${slug}/skills/${encodeURIComponent(skill.id)}`} style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none" }}>
            <Link2 size={16} style={{ color: P.muted }} />
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: P.text, fontFamily: "var(--font-heading)" }}>
              {skill.name}
            </h2>
          </Link>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {isReadOnly && (
              <span style={{ fontSize: 11, color: P.muted, fontStyle: "italic" }}>
                {sourceLabel} skills are read-only.
              </span>
            )}
            <button
              type="button"
              onClick={onClose}
              style={{ width: 24, height: 24, borderRadius: 4, display: "grid", placeItems: "center", background: "transparent", border: "none", color: P.muted, cursor: "pointer" }}
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Description */}
        {skill.description && (
          <p style={{ margin: "0 0 16px", fontSize: 12, color: P.textSec, lineHeight: 1.5 }}>
            {skill.description}
          </p>
        )}

        {/* Metadata row */}
        <div style={{
          display: "flex", flexWrap: "wrap", gap: 16, marginBottom: 16,
          fontSize: 11, color: P.muted,
        }}>
          <div>
            <span style={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginRight: 6 }}>Source</span>
            <span style={{ color: P.textSec }}>
              <Link2 size={10} style={{ display: "inline", verticalAlign: "middle", marginRight: 3 }} />
              {sourceLabel}
            </span>
          </div>
          <div>
            <span style={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginRight: 6 }}>Key</span>
            <span style={{ color: P.textSec, fontFamily: "var(--font-mono)", fontSize: 11 }}>{skill.key}</span>
          </div>
          <div>
            <span style={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginRight: 6 }}>Mode</span>
            <span style={{ color: P.textSec }}>{skill.mode === "read-only" ? "Read only" : "Editable"}</span>
          </div>
        </div>

        {/* Used by */}
        <div style={{ marginBottom: 20, fontSize: 11, color: P.muted }}>
          <span style={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginRight: 6 }}>Used by</span>
          <span style={{ color: P.textSec }}>
            {skill.owners.length > 0 ? skill.owners.join(", ") : "No agents attached"}
          </span>
        </div>

        {/* Content area */}
        {skill.fullContent ? (
          <>
            {/* SKILL.md header with view/code toggle */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "8px 0", borderBottom: `1px solid ${P.cardBorder}`, marginBottom: 12,
            }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: P.textSec, fontFamily: "var(--font-mono)" }}>
                SKILL.md
              </span>
              <div style={{ display: "flex", gap: 0 }}>
                <ToggleBtn icon={<Eye size={12} />} label="View" active={viewMode === "view"} onClick={() => setViewMode("view")} />
                <ToggleBtn icon={<Code size={12} />} label="Code" active={viewMode === "code"} onClick={() => setViewMode("code")} />
              </div>
            </div>

            {viewMode === "code" ? (
              <pre style={{
                padding: 14, borderRadius: 6,
                background: P.surfaceElevated, border: `1px solid ${P.cardBorder}`,
                fontSize: 11, color: P.textSec, fontFamily: "var(--font-mono)",
                whiteSpace: "pre-wrap", wordBreak: "break-word",
                lineHeight: 1.5, overflow: "auto", maxHeight: 600,
              }}>
                {skill.fullContent}
              </pre>
            ) : (
              <div style={{
                fontSize: 13, color: P.textSec, lineHeight: 1.7,
                maxHeight: 600, overflow: "auto",
              }}>
                <MarkdownContent content={skill.fullContent} />
              </div>
            )}
          </>
        ) : (
          <div style={{ padding: 24, textAlign: "center", color: P.muted, fontSize: 12, borderRadius: 6, border: `1px dashed ${P.cardBorder}` }}>
            No skill content available.
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Toggle button ─── */
function ToggleBtn({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        padding: "4px 10px", fontSize: 11, fontWeight: active ? 600 : 400,
        color: active ? P.text : P.muted,
        background: active ? P.surfaceHover : P.surface,
        border: `1px solid ${active ? P.cardBorderHover : P.cardBorder}`,
        borderRadius: 4, cursor: "pointer",
      }}
    >
      {icon} {label}
    </button>
  );
}

/* ─── Simple Markdown Renderer ─── */
function MarkdownContent({ content }: { content: string }) {
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("# ")) {
      elements.push(<h1 key={i} style={{ fontSize: 20, fontWeight: 700, color: P.text, margin: "16px 0 8px", fontFamily: "var(--font-heading)" }}>{line.slice(2)}</h1>);
    } else if (line.startsWith("## ")) {
      elements.push(<h2 key={i} style={{ fontSize: 16, fontWeight: 600, color: P.text, margin: "14px 0 6px", fontFamily: "var(--font-heading)" }}>{line.slice(3)}</h2>);
    } else if (line.startsWith("### ")) {
      elements.push(<h3 key={i} style={{ fontSize: 14, fontWeight: 600, color: P.text, margin: "12px 0 4px", fontFamily: "var(--font-heading)" }}>{line.slice(4)}</h3>);
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      elements.push(
        <div key={i} style={{ display: "flex", gap: 8, paddingLeft: 8, margin: "2px 0" }}>
          <span style={{ color: P.muted }}>-</span>
          <InlineMarkdown text={line.slice(2)} />
        </div>
      );
    } else if (line.startsWith("```")) {
      // Code block
      const endIdx = lines.indexOf("```", i + 1);
      const codeLines = endIdx > i ? lines.slice(i + 1, endIdx) : [];
      elements.push(
        <pre key={i} style={{
          padding: 10, borderRadius: 4,
          background: P.surfaceElevated, border: `1px solid ${P.cardBorder}`,
          fontSize: 11, color: P.textSec, fontFamily: "var(--font-mono)",
          whiteSpace: "pre-wrap", margin: "8px 0", lineHeight: 1.5,
        }}>
          {codeLines.join("\n")}
        </pre>
      );
      if (endIdx > i) i = endIdx;
    } else if (line.trim() === "") {
      elements.push(<div key={i} style={{ height: 8 }} />);
    } else {
      elements.push(<p key={i} style={{ margin: "2px 0" }}><InlineMarkdown text={line} /></p>);
    }
  }

  return <>{elements}</>;
}

function InlineMarkdown({ text }: { text: string }) {
  // Handle inline code (`...`) and bold (**...**)
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    const codeMatch = remaining.match(/^(.*?)`([^`]+)`(.*)$/);
    const boldMatch = remaining.match(/^(.*?)\*\*([^*]+)\*\*(.*)$/);

    if (codeMatch && (!boldMatch || codeMatch.index! <= boldMatch.index!)) {
      if (codeMatch[1]) parts.push(<span key={key++}>{codeMatch[1]}</span>);
      parts.push(
        <code key={key++} style={{
          padding: "1px 5px", borderRadius: 3,
          background: P.surfaceHover, border: `1px solid ${P.cardBorder}`,
          fontFamily: "var(--font-mono)", fontSize: "0.9em",
        }}>
          {codeMatch[2]}
        </code>
      );
      remaining = codeMatch[3];
    } else if (boldMatch) {
      if (boldMatch[1]) parts.push(<span key={key++}>{boldMatch[1]}</span>);
      parts.push(<strong key={key++} style={{ fontWeight: 600, color: P.text }}>{boldMatch[2]}</strong>);
      remaining = boldMatch[3];
    } else {
      parts.push(<span key={key++}>{remaining}</span>);
      break;
    }
  }

  return <>{parts}</>;
}
