"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  Activity,
  ArrowRight,
  BriefcaseBusiness,
  Building2,
  ChevronDown,
  Compass,
  Cpu,
  Wifi,
  WifiOff,
  Bot,
  FolderKanban,
  FolderOpen,
  Inbox,
  LayoutDashboard,
  Network,
  Pause,
  Play,
  Plus,
  Rocket,
  Settings,
  Trash2,
  Users,
  Wrench,
} from "lucide-react";

import { CompanyErrorState, DeleteCompanyModal } from "@/components/company/company-ui";
import { MissionIconPicker } from "@/components/orchestration/MissionIconPicker";
import { AgentAvatar } from "@/components/AgentAvatar";
import { classifyProjectState, formatAge } from "@/components/orchestration/ui";
import {
  createProject,
  listCompanies,
  listCompanyAgents,
  listProjectSprints,
  listProjects,
  getCompanyEngineStatus,
  kickoffCompany,
  updateProjectSettings,
} from "@/lib/orchestration/client";
import type { EngineStatus, KickoffResult } from "@/lib/orchestration/client";
import { useActiveProjectState } from "@/lib/active-project-state";
import { resolveActiveProject } from "@/lib/active-project-utils";
import { useHiddenProjects } from "@/lib/hidden-project-state";
import { buildCanonicalCompanyPath, buildCanonicalDashboardPath } from "@/lib/orchestration/route-paths";
import type {
  OrchestrationAgent,
  OrchestrationCompany,
  OrchestrationProject,
  OrchestrationSprint,
} from "@/lib/orchestration/types";
import { PageHeader, Section, Card, PropRow, Badge, EmptyState } from "@/lib/ui/primitives";
import { color, type as T, space, radius, font, pageStyle } from "@/lib/ui/tokens";

/* ── Types ── */

const PROTECTED_COMPANY_IDS = new Set(["6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f"]);

type CompanyRosterAgent = OrchestrationAgent & {
  projectId?: string;
  projectName: string;
  companyName: string;
};

type ProjectSprintSummary = {
  name: string;
  ratioLabel: string;
  percent: number;
};

/* ── Helpers ── */

function agentStatusTone(status: OrchestrationAgent["status"]): "default" | "positive" | "negative" | "warning" {
  switch (status) {
    case "working": return "positive";
    case "idle": return "default";
    case "paused": return "warning";
    case "offline": return "negative";
    case "error": return "negative";
    default: return "default";
  }
}

function companyStatusTone(status: string): "default" | "positive" | "warning" | "negative" {
  switch (status) {
    case "active": return "positive";
    case "paused": return "warning";
    case "archived": return "negative";
    default: return "default";
  }
}

function formatAgentTask(agent: CompanyRosterAgent): string {
  if (agent.status !== "working") {
    return "Idle — ready for assignment";
  }

  return agent.currentTask || "No active task";
}

function formatAgentProject(agent: CompanyRosterAgent): string {
  return agent.projectName || "Company-wide";
}

function formatAgentModel(agent: CompanyRosterAgent): string {
  return agent.model && agent.model.trim().length > 0 ? agent.model : "Pending Forge contract";
}

function formatHeartbeatDue(raw?: string): string | null {
  if (!raw) return null;

  const dueMs = new Date(raw).getTime();
  if (!Number.isFinite(dueMs)) return null;

  const diffMs = dueMs - Date.now();
  if (diffMs <= 0) {
    return "due now";
  }

  const dueMinutes = Math.max(1, Math.floor(diffMs / 60000));
  if (dueMinutes < 60) return `${dueMinutes}m`;
  const dueHours = Math.floor(dueMinutes / 60);
  if (dueHours < 24) return `${dueHours}h`;
  return `${Math.floor(dueHours / 24)}d`;
}

function formatAgentHeartbeat(agent: CompanyRosterAgent): string {
  if (!agent.lastHeartbeat) {
    const next = formatHeartbeatDue(
      (agent as CompanyRosterAgent & { nextHeartbeat?: string; nextHeartbeatDueAt?: string }).nextHeartbeatDueAt,
    );
    return next ? `No heartbeat yet • next heartbeat ${next}` : "No heartbeat yet";
  }

  const next = formatHeartbeatDue(
    (agent as CompanyRosterAgent & { nextHeartbeat?: string; nextHeartbeatDueAt?: string }).nextHeartbeatDueAt ||
    (agent as CompanyRosterAgent & { nextHeartbeat?: string; nextHeartbeatDueAt?: string }).nextHeartbeat,
  );

  return next ? `${formatAge(agent.lastHeartbeat)} ago • next heartbeat ${next}` : `${formatAge(agent.lastHeartbeat)} ago`;
}

const companyControlStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "0 10px",
  height: 34,
  borderRadius: radius.md,
  border: `0.5px solid ${color.border}`,
  background: "transparent",
  color: color.text,
  fontSize: T.bodySmall.size,
  cursor: "pointer",
};

function AvatarWithGlow({
  source,
  alt,
  isWorking,
}: {
  source?: string;
  alt: string;
  isWorking: boolean;
}) {
  const wrapperStyle: CSSProperties = {
    position: "relative",
    width: 40,
    height: 40,
    minWidth: 40,
    flexShrink: 0,
  };

  const imageStyle: CSSProperties = {
    width: 40,
    height: 40,
    minWidth: 40,
    borderRadius: "9999px",
    objectFit: "cover",
    border: `2px solid ${color.border}`,
    boxShadow: isWorking
      ? `0 0 0 2px ${color.positive}55, 0 0 0 1px ${color.border}`
      : `0 0 0 1px ${color.border}`,
  };

  const workingDot = isWorking ? (
    <span
      style={{
        position: "absolute",
        right: -1,
        bottom: -1,
        width: 10,
        height: 10,
        borderRadius: "9999px",
        border: `2px solid ${color.surface}`,
        background: color.positive,
        boxShadow: `0 0 0 2px ${color.positive}55`,
      }}
    />
  ) : null;

  return source ? (
    <span style={wrapperStyle}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={source}
        alt={alt}
        title={alt}
        width={40}
        height={40}
        className="rounded-full object-cover"
        style={imageStyle}
      />
      {workingDot}
    </span>
  ) : (
    <span style={wrapperStyle}>
      <AgentAvatar agentId={alt} size={40} />
      {workingDot}
    </span>
  );
}

function AgentInfoRow({
  label,
  value,
  compact = false,
  icon,
}: {
  label: string;
  value: string;
  compact?: boolean;
  icon?: ReactNode;
}) {
  return (
    <div
      style={{
        borderRadius: radius.md,
        padding: `${compact ? 6 : 8}px`,
      }}
    >
      <div
        style={{
          fontSize: T.caption.size,
          color: color.textMuted,
          marginBottom: 3,
          display: "flex",
          alignItems: "center",
          gap: 5,
        }}
      >
        {icon ? icon : null}
        {label}
      </div>
      <div
        style={{
          fontSize: T.bodySmall.size,
          color: color.text,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={value}
      >
        {value}
      </div>
    </div>
  );
}

/* ── Page ── */

export default function CompanyDetailPage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const slug = params?.slug ?? "";
  const { activeProject, setActiveProject } = useActiveProjectState();

  const [company, setCompany] = useState<OrchestrationCompany | null>(null);
  const [companies, setCompanies] = useState<OrchestrationCompany[]>([]);
  const [projects, setProjects] = useState<OrchestrationProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const [roster, setRoster] = useState<CompanyRosterAgent[]>([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [sprintSummaries, setSprintSummaries] = useState<Record<string, ProjectSprintSummary>>({});

  /* ── Engine state ── */
  const [engineStatus, setEngineStatus] = useState<EngineStatus | null>(null);
  const [kickoffBusy, setKickoffBusy] = useState(false);
  const [kickoffDirection, setKickoffDirection] = useState("");
  const [kickoffResult, setKickoffResult] = useState<KickoffResult | null>(null);

  /* ── Pause / resume ── */
  const [pauseBusy, setPauseBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  /* ── Company switcher ── */
  const [switcherOpen, setSwitcherOpen] = useState(false);

  const { hiddenProjects } = useHiddenProjects(slug);

  const visibleProjects = useMemo(
    () => projects.filter((p) => !hiddenProjects[p.id]),
    [projects, hiddenProjects],
  );

  const activeProjectRecord = useMemo(
    () => resolveActiveProject(projects, activeProject, slug),
    [activeProject, projects, slug],
  );

  /* ── Data fetching ── */

  useEffect(() => {
    let mounted = true;

    Promise.all([listCompanies(), listProjects({ company: slug, includeNonProduction: true })])
      .then(([allCompanies, rows]) => {
        if (!mounted) return;
        setCompanies(allCompanies);
        const slugKey = slug.toLowerCase();
        const current = allCompanies.find((item) => (
          item.slug.toLowerCase() === slugKey || item.code.toLowerCase() === slugKey
        )) ?? null;
        setCompany(current);
        setProjects(current ? rows : []);
      })
      .catch(() => {
        if (!mounted) return;
        setError("Unable to load this company right now.");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => { mounted = false; };
  }, [slug]);

  /* Agents — load eagerly */
  useEffect(() => {
    if (!company) return;

    let cancelled = false;
    const loadRoster = async () => {
      setRosterLoading(true);
      setRosterError(null);

      try {
        const companyAgents = await listCompanyAgents(company.slug);
        if (cancelled) return;
        const projectNameById = new Map(projects.map((p) => [p.id, p.name]));
        const rosterRows = companyAgents.map((agent) => ({
          ...agent,
          projectName: agent.projectId
            ? (projectNameById.get(agent.projectId) ?? "Cross-project")
            : "Company-wide",
          companyName: company.name,
        }));
        setRoster(rosterRows.sort((a, b) => a.name.localeCompare(b.name)));
      } catch {
        if (!cancelled) setRosterError("Failed to load company agent roster.");
      } finally {
        if (!cancelled) setRosterLoading(false);
      }
    };

    void loadRoster();
    return () => { cancelled = true; };
  }, [company, projects]);

  /* Sprint summaries */
  useEffect(() => {
    if (!company || projects.length === 0) {
      setSprintSummaries({});
      return;
    }

    let cancelled = false;
    const loadSprintSummaries = async () => {
      const entries = await Promise.all(
        projects.map(async (project) => {
          const sprints = await listProjectSprints(project.id);
          return [project.id, buildProjectSprintSummary(project, sprints)] as const;
        }),
      );
      if (cancelled) return;
      setSprintSummaries(Object.fromEntries(entries));
    };

    void loadSprintSummaries();
    return () => { cancelled = true; };
  }, [company, projects]);

  /* Engine status */
  useEffect(() => {
    if (!company) return;
    let cancelled = false;
    getCompanyEngineStatus(company.slug).then((status) => {
      if (!cancelled) setEngineStatus(status);
    });
    return () => { cancelled = true; };
  }, [company]);

  /* ── Handlers ── */

  const handleKickoff = async () => {
    if (!company || kickoffBusy) return;
    setKickoffBusy(true);
    setKickoffResult(null);
    try {
      const result = await kickoffCompany(company.slug, kickoffDirection || undefined);
      setKickoffResult(result);
      if (result) {
        const updated = await getCompanyEngineStatus(company.slug);
        setEngineStatus(updated);
      }
    } finally {
      setKickoffBusy(false);
    }
  };

  const handleTogglePause = async () => {
    if (!company) return;
    setPauseBusy(true);
    setError(null);
    setNotice(null);
    const next = company.status === "paused" ? "active" : "paused";
    try {
      const r = await fetch(`/api/orchestration/companies/${company.slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!r.ok) throw new Error("failed");
      setCompany((p) => p ? { ...p, status: next } : null);
      setNotice(next === "paused" ? "Company paused." : "Company resumed.");
    } catch {
      setError("Could not update company status.");
    } finally {
      setPauseBusy(false);
    }
  };

  const handleCreateProject = async (payload: {
    name: string;
    description: string;
    emoji: string;
    color: string;
    owner: string;
    status: "active" | "paused" | "archived";
    sourceWorkspaceRoot: string;
  }): Promise<boolean> => {
    if (!company) return false;
    setError(null);

    const created = await createProject({
      companyId: company.id,
      name: payload.name,
      description: payload.description,
      emoji: payload.emoji,
      color: payload.color,
      owner: payload.owner || undefined,
      status: payload.status,
      sourceWorkspaceRoot: payload.sourceWorkspaceRoot.trim() || null,
      avatarThemeName: company.theme.name,
    });

    if (!created) {
      setError("Could not create project. Please verify the details and retry.");
      return false;
    }

    setProjects((prev) => [created, ...prev]);
    setActiveProject({
      companySlug: slug,
      projectId: created.id,
      projectSlug: created.slug,
      projectName: created.name,
    });
    setCreateOpen(false);
    return true;
  };

  const handleDeleteCompany = async () => {
    if (!company || PROTECTED_COMPANY_IDS.has(company.id)) return;
    setDeleteBusy(true);
    try {
      const response = await fetch(`/api/orchestration/companies/${company.slug}?hard=true`, {
        method: "DELETE",
      });
      const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      if (!response.ok) throw new Error(body?.error?.message ?? "Failed to delete company");
      setDeleteOpen(false);
      router.push("/companies");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete company.");
      setDeleteOpen(false);
    } finally {
      setDeleteBusy(false);
    }
  };

  /* ── Error state ── */

  if (!loading && !company) {
    return (
      <CompanyErrorState
        title="Company not found"
        detail="This company could not be resolved from orchestration data."
        href="/companies"
      />
    );
  }

  /* ── Derived ── */

  const otherCompanies = companies.filter((c) => c.id !== company?.id);
  const isProtected = company ? PROTECTED_COMPANY_IDS.has(company.id) : false;
  const companyCode = company?.code || slug.slice(0, 8).toUpperCase();
  const companySlug = company?.slug || slug;
  const companyHref = (path = "") => buildCanonicalCompanyPath(companyCode, path);

  /* ── Render ── */

  return (
    <div style={pageStyle}>
      {/* ── Header ── */}
      <PageHeader
        icon={
          <Building2
            size={16}
            style={{ color: color.textSecondary }}
          />
        }
        title={loading ? "Loading..." : company?.name ?? "Company Not Found"}
        description={company?.description || undefined}
        actions={
          company ? (
            <div style={{ display: "flex", alignItems: "center", gap: space.sm, flexWrap: "wrap" }}>
              <Badge
                label={company.status}
                tone={companyStatusTone(company.status)}
              />
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: space.sm,
                }}
              >
                <button
                  type="button"
                  onClick={handleTogglePause}
                  disabled={pauseBusy}
                  style={{
                    ...companyControlStyle,
                    opacity: pauseBusy ? 0.5 : 1,
                    cursor: pauseBusy ? "not-allowed" : "pointer",
                  }}
                >
                  {company.status === "paused" ? <Play size={14} /> : <Pause size={14} />}
                  {pauseBusy ? "..." : company.status === "paused" ? "Resume" : "Pause"}
                </button>
                {/* ── Company switcher ── */}
                {otherCompanies.length > 0 && (
                  <div style={{ position: "relative" }}>
                    <button
                      type="button"
                      onClick={() => setSwitcherOpen((p) => !p)}
                      style={companyControlStyle}
                    >
                      Switch
                      <ChevronDown size={12} style={{ opacity: 0.6 }} />
                    </button>
                    {switcherOpen && (
                      <>
                        <div
                          style={{ position: "fixed", inset: 0, zIndex: 40 }}
                          onClick={() => setSwitcherOpen(false)}
                        />
                        <div
                          style={{
                            position: "absolute",
                            right: 0,
                            top: "calc(100% + 4px)",
                            minWidth: 200,
                            padding: `${space.xs}px 0`,
                            borderRadius: radius.md,
                            border: `0.5px solid ${color.border}`,
                            background: color.surfaceElevated,
                            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                            zIndex: 50,
                          }}
                        >
                          {otherCompanies.map((c) => (
                            <Link
                              key={c.slug}
                              href={buildCanonicalDashboardPath(c.code)}
                              onClick={() => setSwitcherOpen(false)}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: space.sm,
                                padding: `${space.sm}px ${space.md}px`,
                                fontSize: T.bodySmall.size,
                                color: color.text,
                                textDecoration: "none",
                              }}
                              onMouseEnter={(e) => { e.currentTarget.style.background = color.surfaceHover; }}
                              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                            >
                              <Building2 size={12} style={{ color: color.textMuted, flexShrink: 0 }} />
                              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {c.name}
                              </span>
                              <span style={{ fontSize: T.caption.size, color: color.textMuted, fontFamily: font.mono }}>
                                {c.code}
                              </span>
                            </Link>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
              {engineStatus?.ceo && (
                <button
                  type="button"
                  onClick={handleKickoff}
                  disabled={kickoffBusy}
                  style={{
                    ...companyControlStyle,
                    opacity: kickoffBusy ? 0.5 : 1,
                    cursor: kickoffBusy ? "not-allowed" : "pointer",
                  }}
                >
                  <Rocket size={14} />
                  {kickoffBusy ? "Starting..." : "Start"}
                </button>
              )}
              <Link
                href={companyHref("/settings")}
                style={{
                  ...companyControlStyle,
                  textDecoration: "none",
                }}
              >
                <Settings size={14} />
                Settings
              </Link>
            </div>
          ) : undefined
        }
      />

      {/* ── Banners ── */}
      {error && (
        <div style={{
          marginBottom: space.md,
          padding: `${space.sm}px ${space.lg}px`,
          borderRadius: radius.md,
          background: color.negativeSoft,
          border: `0.5px solid rgba(239,68,68,0.2)`,
          fontSize: T.bodySmall.size,
          color: color.negative,
        }}>
          {error}
        </div>
      )}
      {notice && (
        <div style={{
          marginBottom: space.md,
          padding: `${space.sm}px ${space.lg}px`,
          borderRadius: radius.md,
          background: color.positiveSoft,
          border: `0.5px solid rgba(34,197,94,0.2)`,
          fontSize: T.bodySmall.size,
          color: color.positive,
        }}>
          {notice}
        </div>
      )}
      {kickoffResult && (
        <div style={{
          marginBottom: space.md,
          padding: `${space.sm}px ${space.lg}px`,
          borderRadius: radius.md,
          fontSize: T.bodySmall.size,
          border: `0.5px solid ${kickoffResult.status === "queued" ? "rgba(34,197,94,0.2)" : "rgba(245,158,11,0.2)"}`,
          background: kickoffResult.status === "queued" ? color.positiveSoft : color.warningSoft,
          color: kickoffResult.status === "queued" ? color.positive : color.warning,
        }}>
          {kickoffResult.message}
        </div>
      )}

      {/* ── Profile ── */}
      {company && (
        <div style={{ width: "min(100%, 460px)" }}>
          <Section title="Profile">
            <PropRow label="Name">
              <span style={{ fontWeight: 500 }}>{company.name}</span>
            </PropRow>
            <PropRow label="Slug">
              <span style={{ fontFamily: font.mono, fontSize: T.mono.size }}>{company.slug}</span>
            </PropRow>
            <PropRow label="Code">
              <span style={{ fontFamily: font.mono, fontSize: T.mono.size }}>{company.code}</span>
            </PropRow>
            <PropRow label="Status">
              <Badge label={company.status} tone={companyStatusTone(company.status)} />
            </PropRow>
            <PropRow label="Theme">{company.theme.name}</PropRow>
            <PropRow label="Source">
              <span style={{ fontFamily: font.mono, fontSize: T.mono.size }}>{company.workspace.source}</span>
            </PropRow>
          </Section>
        </div>
      )}

      {/* ── Team ── */}
      <Section title="Team" card={false} trailing={roster.length > 0 ? `${roster.length} agents` : undefined}>
        {rosterLoading ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: space.md }}>
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} style={{
                height: 100,
                borderRadius: radius.lg,
                border: `0.5px solid ${color.border}`,
                background: color.surface,
                opacity: 0.5,
              }} />
            ))}
          </div>
        ) : rosterError ? (
          <div style={{ padding: space.lg, fontSize: T.bodySmall.size, color: color.negative }}>{rosterError}</div>
        ) : roster.length === 0 ? (
          <EmptyState icon={<Users size={24} />} title="No agents" description="No agents have been created for this company yet." />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: space.md }}>
            {roster.map((agent) => (
              <Link
                key={agent.id}
                href={companyHref(`/agents/${encodeURIComponent(agent.slug || agent.id)}`)}
                style={{ textDecoration: "none" }}
              >
                <Card hoverable>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: space.md, marginBottom: space.md }}>
                    <AvatarWithGlow
                      source={agent.avatar}
                      alt={agent.slug || agent.id}
                      isWorking={agent.status === "working"}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: T.cardTitle.size,
                        fontWeight: T.cardTitle.weight,
                        color: color.text,
                        lineHeight: 1.2,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}>
                        {agent.name}
                      </div>
                      <div style={{
                        fontSize: T.bodySmall.size,
                        color: color.textMuted,
                        lineHeight: 1.25,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}>
                        {agent.role}
                      </div>
                    </div>
                    <Badge label={agent.status} tone={agentStatusTone(agent.status)} />
                  </div>
                  <div style={{ display: "grid", gap: space.sm, marginBottom: space.md }}>
                    <AgentInfoRow label="Current Task" value={formatAgentTask(agent)} icon={<Bot size={12} />} compact />
                    <AgentInfoRow
                      label="Recent Project"
                      value={formatAgentProject(agent)}
                      icon={<BriefcaseBusiness size={12} />}
                      compact
                    />
                    <AgentInfoRow
                      label="Model"
                      value={formatAgentModel(agent)}
                      icon={agent.adapterType ? <Activity size={12} /> : <Building2 size={12} />}
                      compact
                    />
                    <AgentInfoRow
                      label="Heartbeat"
                      value={formatAgentHeartbeat(agent)}
                      icon={agent.lastHeartbeat ? <Wifi size={12} /> : <WifiOff size={12} />}
                      compact
                    />
                  </div>
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}>
                    <div style={{
                      fontSize: T.caption.size,
                      color: color.textMuted,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      minWidth: 0,
                    }}>
                      {agent.companyName}
                    </div>
                    <span style={{
                      fontSize: T.caption.size,
                      color: color.textSecondary,
                      fontWeight: 500,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                    }}>
                      <ArrowRight size={11} />
                      Open profile
                    </span>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </Section>

      {/* ── Projects ── */}
      <Section
        title="Projects"
        card={false}
        trailing={
          <div style={{ display: "flex", alignItems: "center", gap: space.sm }}>
            {visibleProjects.length > 0 && (
              <span style={{ fontSize: T.caption.size, color: color.textMuted }}>{visibleProjects.length} projects</span>
            )}
            {company && (
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                style={{
                  ...companyControlStyle,
                  color: color.textSecondary,
                }}
              >
                <Plus size={11} /> New
              </button>
            )}
          </div>
        }
      >
        {loading ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: space.md }}>
            {[1, 2, 3, 4].map((i) => (
              <div key={i} style={{
                height: 160,
                borderRadius: radius.lg,
                border: `0.5px solid ${color.border}`,
                background: color.surface,
                opacity: 0.5,
              }} />
            ))}
          </div>
        ) : visibleProjects.length === 0 ? (
          <EmptyState icon={<FolderKanban size={24} />} title="No projects" description="Create your first project to get started." />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: space.md }}>
            {visibleProjects.map((project) => {
              const sprint = sprintSummaries[project.id] ?? buildProjectSprintSummary(project, []);
              const state = classifyProjectState(project.status);
              const isSelected = activeProjectRecord?.id === project.id;

              return (
                <Card key={project.id} hoverable style={isSelected ? { borderColor: color.borderStrong } : undefined}>
                  {/* Header row */}
                  <div style={{ display: "flex", alignItems: "center", gap: space.md, marginBottom: space.sm }}>
                    <span style={{
                      display: "grid",
                      placeItems: "center",
                      width: 36,
                      height: 36,
                      borderRadius: radius.md,
                      background: "rgba(255,255,255,0.06)",
                      flexShrink: 0,
                      color: color.text,
                    }}>
                      <FolderKanban size={16} />
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Link
                        href={companyHref(`/projects/${encodeURIComponent(project.slug)}`)}
                        style={{ textDecoration: "none" }}
                        onClick={() => setActiveProject({ companySlug, projectId: project.id, projectSlug: project.slug, projectName: project.name })}
                      >
                        <span style={{
                          fontSize: T.cardTitle.size,
                          fontWeight: T.cardTitle.weight,
                          color: color.text,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          display: "block",
                        }}>
                          {project.name}
                        </span>
                      </Link>
                      <div style={{
                        fontSize: T.bodySmall.size,
                        color: color.textMuted,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}>
                        {project.description || "No description"}
                      </div>
                    </div>
                    <Badge
                      label={state}
                      tone={state === "paused" ? "warning" : state === "archived" ? "default" : "default"}
                    />
                  </div>
                  {/* Metrics row */}
                  <div style={{ display: "flex", gap: space.lg, fontSize: T.caption.size, color: color.textMuted, marginBottom: space.sm }}>
                    <span>{project.taskCount ?? 0} tasks</span>
                    <span>{project.inProgress ?? 0} active</span>
                    <span>{project.review ?? 0} review</span>
                  </div>
                  {/* Sprint progress */}
                  <div style={{ marginBottom: space.sm }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: T.caption.size, color: color.textMuted, marginBottom: 4 }}>
                      <span>{sprint.name}</span>
                      <span>{sprint.ratioLabel}</span>
                    </div>
                    <div style={{ height: 5, borderRadius: radius.full, background: color.border, overflow: "hidden" }}>
                      <div style={{
                        height: "100%",
                        borderRadius: radius.full,
                        width: `${sprint.percent}%`,
                        background: color.textSecondary,
                        transition: "width 0.5s ease",
                      }} />
                    </div>
                  </div>
                  {/* Footer: owner + actions */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ fontSize: T.caption.size, color: color.textMuted }}>
                      {project.owner ? `Owner: ${project.owner}` : "No owner assigned"}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: space.xs }}>
                      {state !== "archived" && (
                        <button
                          type="button"
                          title={state === "paused" ? "Resume project" : "Pause project"}
                          onClick={async (e) => {
                            e.stopPropagation();
                            const next = state === "paused" ? "active" : "paused";
                            const updated = await updateProjectSettings({ projectIdOrSlug: project.slug || project.id, status: next as "active" | "paused" });
                            if (updated) setProjects((prev) => prev.map((p) => p.id === project.id ? { ...p, status: next } : p));
                          }}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: 24,
                            height: 24,
                            borderRadius: radius.sm,
                            border: `0.5px solid ${color.border}`,
                            background: "transparent",
                            color: color.textMuted,
                            cursor: "pointer",
                            padding: 0,
                          }}
                        >
                          {state === "paused" ? <Play size={12} /> : <Pause size={12} />}
                        </button>
                      )}
                      <Link
                        href={companyHref(`/projects/${encodeURIComponent(project.slug)}`)}
                        title="Open project"
                        onClick={() => setActiveProject({ companySlug, projectId: project.id, projectSlug: project.slug, projectName: project.name })}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: 24,
                          height: 24,
                          borderRadius: radius.sm,
                          border: `0.5px solid ${color.border}`,
                          background: "transparent",
                          color: color.textMuted,
                          textDecoration: "none",
                        }}
                      >
                        <ArrowRight size={12} />
                      </Link>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </Section>

      {/* ── Navigation ── */}
      <Section title="Navigation" card={false}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: space.sm }}>
          {[
            { label: "Dashboard", icon: <LayoutDashboard size={14} />, path: "/dashboard" },
            { label: "Inbox", icon: <Inbox size={14} />, path: "/inbox" },
            { label: "Org Chart", icon: <Network size={14} />, path: "/org" },
            { label: "Projects", icon: <FolderKanban size={14} />, path: "/projects" },
            { label: "Hives", icon: <Cpu size={14} />, path: "/hives" },
            { label: "Costs", icon: <Compass size={14} />, path: "/costs" },
            { label: "Activity", icon: <Activity size={14} />, path: "/activity" },
            { label: "Files", icon: <FolderOpen size={14} />, path: "/files" },
            { label: "Manage Projects", icon: <Wrench size={14} />, path: "/manage-projects" },
            { label: "Settings", icon: <Settings size={14} />, path: "/settings" },
          ].map((link) => (
            <Link key={link.path} href={companyHref(link.path)} style={{ textDecoration: "none" }}>
              <Card hoverable style={{ display: "flex", alignItems: "center", gap: space.sm, padding: `${space.md}px ${space.lg}px` }}>
                <span style={{ color: color.text, display: "flex", alignItems: "center" }}>{link.icon}</span>
                <span style={{ fontSize: T.bodySmall.size, color: color.text }}>{link.label}</span>
              </Card>
            </Link>
          ))}
        </div>
      </Section>

      {/* ── Danger zone (de-emphasized) ── */}
      {company && (
        <div style={{ marginTop: space.xxxl, paddingTop: space.xl, borderTop: `0.5px solid ${color.border}` }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: T.caption.size, color: color.textMuted, textTransform: "uppercase", letterSpacing: T.sectionLabel.letterSpacing }}>
              Danger Zone
            </span>
            <button
              type="button"
              onClick={() => setDeleteOpen(true)}
              disabled={isProtected}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: space.xs,
                padding: `4px ${space.md}px`,
                borderRadius: radius.md,
                border: `0.5px solid rgba(239,68,68,0.2)`,
                background: "transparent",
                color: color.textMuted,
                fontSize: T.caption.size,
                cursor: isProtected ? "not-allowed" : "pointer",
                opacity: isProtected ? 0.5 : 1,
              }}
            >
              <Trash2 size={12} />
              {isProtected ? "Delete disabled for core company" : "Delete Company"}
            </button>
          </div>
        </div>
      )}

      {/* ── Modals ── */}
      <CreateProjectModal open={createOpen} onClose={() => setCreateOpen(false)} onSubmit={handleCreateProject} />
      <DeleteCompanyModal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDeleteCompany}
        companyName={company?.name ?? slug}
        busy={deleteBusy}
      />
    </div>
  );
}

/* ── Sprint summary helper ── */

function buildProjectSprintSummary(project: OrchestrationProject, sprints: OrchestrationSprint[]): ProjectSprintSummary {
  const ordered = [...sprints].sort(
    (a, b) => new Date(b.updated || b.startDate).getTime() - new Date(a.updated || a.startDate).getTime(),
  );
  const active = ordered.find((s) => s.status === "active");
  const planned = ordered.find((s) => s.status === "planned");
  const done = ordered.find((s) => s.status === "done");
  const current = active ?? planned ?? done ?? null;

  if (!current) {
    const total = project.taskCount;
    const doneCount = project.completed;
    const percent = total > 0 ? Math.round((doneCount / total) * 100) : 0;
    return { name: "No active sprint", ratioLabel: `${doneCount}/${total}`, percent: Math.max(0, Math.min(100, percent)) };
  }

  const total = current.taskCount > 0 ? current.taskCount : project.taskCount;
  const doneCount = current.taskCount > 0 ? current.doneCount : project.completed;
  const percent = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  return { name: current.name, ratioLabel: `${doneCount}/${total}`, percent: Math.max(0, Math.min(100, percent)) };
}

/* ── Create Project Modal (page-specific) ── */

function CreateProjectModal({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: {
    name: string;
    description: string;
    emoji: string;
    color: string;
    owner: string;
    status: "active" | "paused" | "archived";
    sourceWorkspaceRoot: string;
  }) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [emoji, setEmoji] = useState("🛰️");
  const [projectColor, setProjectColor] = useState("#b45309");
  const [owner, setOwner] = useState("");
  const [sourceWorkspaceRoot, setSourceWorkspaceRoot] = useState("");
  const [status, setStatus] = useState<"active" | "paused" | "archived">("active");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, busy]);

  if (!open) return null;

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: `8px ${space.md}px`,
    borderRadius: radius.md,
    border: `0.5px solid ${color.border}`,
    background: color.surface,
    color: color.text,
    fontSize: T.bodySmall.size,
    outline: "none",
  };

  const labelStyle: React.CSSProperties = {
    fontSize: T.caption.size,
    fontWeight: T.sectionLabel.weight,
    letterSpacing: T.sectionLabel.letterSpacing,
    textTransform: "uppercase",
    color: color.textMuted,
    marginBottom: space.xs,
    display: "block",
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--modal-backdrop)",
        backdropFilter: "blur(6px)",
        padding: space.md,
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Create project"
        style={{
          width: "100%",
          maxWidth: 540,
          borderRadius: radius.lg,
          border: `0.5px solid ${color.border}`,
          background: "var(--modal-glass)",
          padding: space.xl,
          boxShadow: "var(--shadow-glass)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: space.lg }}>
          <div>
            <span style={{ ...labelStyle, marginBottom: 2 }}>Create Project</span>
            <h2 style={{ margin: 0, fontSize: T.pageTitle.size, fontWeight: T.pageTitle.weight, color: color.text }}>New Project</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            style={{
              padding: `4px ${space.md}px`,
              borderRadius: radius.md,
              border: `0.5px solid ${color.border}`,
              background: color.surface,
              color: color.textSecondary,
              fontSize: T.bodySmall.size,
              cursor: "pointer",
              opacity: busy ? 0.5 : 1,
            }}
          >
            Close
          </button>
        </div>

        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim() || busy) return;
            setBusy(true);
            const created = await onSubmit({
              name: name.trim(),
              description: description.trim(),
              emoji: emoji.trim() || "🛰️",
              color: projectColor,
              owner: owner.trim(),
              status,
              sourceWorkspaceRoot: sourceWorkspaceRoot.trim(),
            });
            setBusy(false);
            if (created) {
              setName(""); setDescription(""); setEmoji("🛰️");
              setProjectColor("#b45309"); setOwner(""); setSourceWorkspaceRoot(""); setStatus("active");
            }
          }}
        >
          <div style={{ display: "grid", gridTemplateColumns: "1fr 200px 100px", gap: space.md, marginBottom: space.md }}>
            <label>
              <span style={labelStyle}>Name</span>
              <input required autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Orchestration Dashboard" style={inputStyle} />
            </label>
            <label>
              <span style={labelStyle}>Icon</span>
              <MissionIconPicker value={emoji} onChange={setEmoji} ariaLabel="Project icon" />
            </label>
            <label>
              <span style={labelStyle}>Accent</span>
              <input type="color" value={projectColor} onChange={(e) => setProjectColor(e.target.value)} style={{ ...inputStyle, height: 38, padding: 3 }} />
            </label>
          </div>

          <div style={{ marginBottom: space.md }}>
            <label>
              <span style={labelStyle}>Description</span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="Describe what this project is shipping."
                style={{ ...inputStyle, resize: "none" }}
              />
            </label>
          </div>

          <div style={{ marginBottom: space.md }}>
            <label>
              <span style={labelStyle}>Source Workspace</span>
              <input
                value={sourceWorkspaceRoot}
                onChange={(e) => setSourceWorkspaceRoot(e.target.value)}
                placeholder="/path/to/loanmeld"
                style={{ ...inputStyle, fontFamily: "var(--font-mono, monospace)", fontSize: 12 }}
              />
            </label>
            <p style={{ margin: "6px 0 0", fontSize: T.caption.size, color: color.textMuted, lineHeight: 1.5 }}>
              Optional existing repo path. Leave blank to use the managed HiveRunner project workspace.
            </p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: space.md, marginBottom: space.lg }}>
            <label>
              <span style={labelStyle}>Owner</span>
              <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="local-owner" style={inputStyle} />
            </label>
            <label>
              <span style={labelStyle}>Status</span>
              <select value={status} onChange={(e) => setStatus(e.target.value as "active" | "paused" | "archived")} style={inputStyle}>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="archived">Archived</option>
              </select>
            </label>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: space.sm }}>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              style={{
                ...companyControlStyle,
                opacity: busy ? 0.5 : 1,
                cursor: busy ? "not-allowed" : "pointer",
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || !name.trim()}
              style={{
                ...companyControlStyle,
                cursor: busy || !name.trim() ? "not-allowed" : "pointer",
                opacity: busy || !name.trim() ? 0.5 : 1,
                width: "auto",
              }}
            >
              {busy ? "Creating..." : "Create Project"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
