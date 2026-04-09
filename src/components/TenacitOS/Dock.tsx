"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Bot,
  Building2,
  Check,
  ChevronRight,
  X,
  Compass,
  FolderKanban,
  FolderOpen,
  Goal,
  Inbox,
  Lightbulb,
  ListChecks,
  Logs,
  Megaphone,
  Mic,
  Monitor,
  Pause,
  Play,
  Plus,
  Repeat,
  Settings2,
  SquarePen,
  Search,
  Sparkles,
  Terminal,
  TrendingUp,
  Users,
  Wallet,
  Workflow,
  Wrench,
} from "lucide-react";

import { getCompanyInbox, listCompanies, listCompanyAgents, listProjects, updateProjectSettings } from "@/lib/orchestration/client";
import { CreateProjectModal } from "@/components/orchestration/CreateProjectModal";
import { CreateAgentModal } from "@/components/orchestration/CreateAgentModal";
import { CreateCompanyModal } from "@/components/orchestration/CreateCompanyModal";
import { CreateTaskModal } from "@/components/orchestration/CreateTaskModal";
import { AvatarGlyph } from "@/components/orchestration/AvatarGlyph";
import type { CompanyStatus, OrchestrationAgent, OrchestrationProject } from "@/lib/orchestration/types";
import { useDockCollapsed } from "@/lib/dock-state";
import { useActiveProjectState } from "@/lib/active-project-state";
import { useHiddenProjects } from "@/lib/hidden-project-state";
import {
  buildCompanyPath,
  buildCanonicalCompanyPath,
  buildCanonicalDashboardPath,
  buildCanonicalInboxPath,
  buildCanonicalIssuesPath,
  buildCanonicalGoalsPath,
  buildCanonicalTeamPath,
  buildCanonicalOrgPath,
  buildCanonicalSkillsPath,
  buildCanonicalCostsPath,
  buildCanonicalActivityPath,
  buildCanonicalFilesPath,
  buildCanonicalSettingsPath,
  buildCanonicalProjectsPath,
  buildCanonicalNewIssuePath,
  buildCanonicalNewAgentPath,
  buildCanonicalAgentPath,
  buildCanonicalProjectIssuesPath,
  buildCanonicalProjectSettingsPath,
  buildCanonicalProjectAgentsPath,
  buildCanonicalManageProjectsPath,
} from "@/lib/orchestration/route-paths";
import { useLiveStream } from "@/components/live/LiveStreamProvider";

interface NavItem {
  href: string;
  label: string;
  icon?: LucideIcon;
  leadingNode?: ReactNode;
  ariaLabel?: string;
  badge?: number;
  badgeText?: string;
  indent?: boolean;
  /** Trailing status dot (right side) — used for agent liveness indicators with glow/pulse */
  statusDotColor?: string;
  /** Leading color dot (left side, before label) — used for project color indicators, no glow */
  leadingDotColor?: string;
  highlight?: boolean;
  trailingAction?: ReactNode;
  accentBar?: boolean;
  onRowMouseEnter?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
  onRowMouseLeave?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
}

interface CompanyNavState {
  id?: string;
  slug: string;
  name: string;
  code: string;
  status: CompanyStatus;
}

const DOCK_WIDTH = 204;
const DOCK_COLLAPSED_WIDTH = 44;
// Use stable company ID for fallback resolution, not mutable slug/code.
const FALLBACK_COMPANY_ID = "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f";

const OPERATIONS_ITEMS: Omit<NavItem, "href">[] = [
  { label: "Tasks", icon: ListChecks },
  { label: "Dashboard", icon: Building2 },
  { label: "Inbox", icon: Inbox },
  { label: "Approvals", icon: Check },
  { label: "Routines", icon: Workflow },
  { label: "Goals", icon: Goal },
];

const APPS_ITEMS: NavItem[] = [
  { href: "/ideas", label: "Ideas", icon: Lightbulb },
  { href: "/advisory", label: "Advisory Board", icon: Users },
  { href: "/marketing", label: "Marketing", icon: Megaphone },
  { href: "/voice", label: "Henry Voice", icon: Mic },
  { href: "/trading", label: "Trading", icon: TrendingUp },
  { href: "/trading/floor", label: "Trading Floor", icon: TrendingUp },
  { href: "/trading/terminal", label: "Trading Terminal", icon: TrendingUp },
];

const COMPANY_ITEMS: Omit<NavItem, "href">[] = [
  { label: "Org", icon: Building2 },
  { label: "Manage Projects", icon: FolderKanban },
  { label: "Skills", icon: Sparkles },
  { label: "Costs", icon: Compass },
  { label: "Activity", icon: Activity },
  { label: "Files", icon: FolderOpen },
  { label: "Settings", icon: Wrench },
];

const SYSTEM_ITEMS: NavItem[] = [
  { href: "/terminal", label: "Terminal", icon: Terminal },
  { href: "/sessions", label: "Sessions", icon: Monitor },
  { href: "/logs", label: "Logs", icon: Logs },
];

function SectionDivider() {
  return (
    <div
      style={{
        height: "0.5px",
        margin: "4px 6px",
        background: "rgba(222,220,209,0.08)",
      }}
    />
  );
}

function SectionHeader({
  label,
  onCreate,
  createAriaLabel,
  collapsed,
  onToggle,
  action,
  showCreateOnHover,
}: {
  label: string;
  onCreate?: () => void;
  createAriaLabel?: string;
  collapsed?: boolean;
  onToggle?: () => void;
  action?: React.ReactNode;
  showCreateOnHover?: boolean;
}) {
  const isCollapsible = collapsed != null && onToggle != null;
  const [showCreateAction, setShowCreateAction] = useState(false);
  const shouldShowCreate = !showCreateOnHover || showCreateAction;

  return (
    <div
      onMouseEnter={() => {
        if (showCreateOnHover) setShowCreateAction(true);
      }}
      onMouseLeave={() => {
        if (showCreateOnHover) setShowCreateAction(false);
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "4px",
        width: "100%",
        margin: "2px 0 3px",
      }}
    >
      <div
        role={isCollapsible ? "button" : undefined}
        tabIndex={isCollapsible ? 0 : undefined}
        aria-expanded={isCollapsible ? !collapsed : undefined}
        onClick={onToggle}
        onKeyDown={
          isCollapsible
            ? (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onToggle();
                }
              }
            : undefined
        }
        style={{
          display: "flex",
          alignItems: "center",
          flex: 1,
          padding: "2px 8px",
          cursor: isCollapsible ? "pointer" : undefined,
          userSelect: isCollapsible ? "none" : undefined,
        }}
      >
        {isCollapsible ? (
          <ChevronRight
            size={11}
            strokeWidth={2.2}
            color="#7a7872"
            style={{
              flexShrink: 0,
              marginRight: "3px",
              transform: collapsed ? "rotate(0deg)" : "rotate(90deg)",
              transition: "transform 120ms ease",
            }}
          />
        ) : null}
        <span
          style={{
            fontSize: "10px",
            fontWeight: 600,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "#7a7872",
          }}
        >
          {label}
        </span>
      </div>
      {action ? <div style={{ marginRight: "6px", display: "inline-flex", alignItems: "center" }}>{action}</div> : null}
      {onCreate ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onCreate();
          }}
          aria-label={createAriaLabel ?? `Create ${label}`}
          title={createAriaLabel ?? `Create ${label}`}
          style={{
            width: "18px",
            height: "18px",
            borderRadius: "6px",
            border: "0.5px solid rgba(222,220,209,0.12)",
            background: "rgba(41,37,36,0.35)",
            color: "#a8a6a0",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            transition: "all 120ms ease",
            flexShrink: 0,
            marginRight: "6px",
            opacity: shouldShowCreate ? 1 : 0,
            pointerEvents: shouldShowCreate ? "auto" : "none",
          }}
          onMouseEnter={(event) => {
            event.currentTarget.style.border = "0.5px solid rgba(222,220,209,0.2)";
            event.currentTarget.style.background = "rgba(41,37,36,0.55)";
            event.currentTarget.style.color = "#eae8e4";
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.border = "0.5px solid rgba(222,220,209,0.12)";
            event.currentTarget.style.background = "rgba(41,37,36,0.35)";
            event.currentTarget.style.color = "#a8a6a0";
          }}
        >
          <Plus size={11} strokeWidth={2.2} />
        </button>
      ) : null}
    </div>
  );
}

function AgentNavAvatar({ agent }: { agent: OrchestrationAgent }) {
  const fallback = agent.emoji || "🤖";
  const fallbackStyle = {
    width: "13px",
    height: "13px",
    minWidth: "13px",
    borderRadius: "9999px",
    border: "1px solid rgba(222,220,209,0.3)",
    background: "rgba(41,37,36,0.8)",
    color: "#e6e2dd",
    fontSize: "8px",
    lineHeight: 1,
  };

  if (!agent.avatar) {
    return (
      <span
        style={{
          ...fallbackStyle,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <AvatarGlyph value={fallback} size={9} color="#e6e2dd" />
      </span>
    );
  }

  return (
    <span
      style={{
        display: "inline-flex",
        width: "13px",
        height: "13px",
        minWidth: "13px",
        flexShrink: 0,
        position: "relative",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={agent.avatar}
        alt={agent.name}
        title={agent.name}
        width={13}
        height={13}
        className="rounded-full object-cover"
        style={{
          width: "13px",
          height: "13px",
          minWidth: "13px",
          borderRadius: "9999px",
          border: "1px solid rgba(222,220,209,0.3)",
          boxShadow: "0 0 0 1px rgba(0,0,0,0.35)",
        }}
        onError={(e) => {
          const image = e.currentTarget as HTMLImageElement;
          image.style.display = "none";
          const fallbackNode = image.nextElementSibling as HTMLElement | null;
          if (fallbackNode) {
            fallbackNode.style.display = "inline-flex";
          }
        }}
      />
      <span
        style={{
          ...fallbackStyle,
          display: "none",
          alignItems: "center",
          justifyContent: "center",
          position: "absolute",
          inset: 0,
          margin: 0,
          pointerEvents: "none",
        }}
      >
        <AvatarGlyph value={fallback} size={9} color="#e6e2dd" />
      </span>
    </span>
  );
}

function NavRow({ item, active, onClick }: { item: NavItem; active: boolean; onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void }) {
  const Icon = item.icon;
  const hasAccent = Boolean(item.accentBar);
  const highlighted = item.highlight && !active;
  const iconColor = hasAccent ? "#eae8e4" : active ? "#eae8e4" : highlighted ? "#eae8e4" : "#a8a6a0";
  const labelColor = hasAccent ? "#eae8e4" : active ? "#eae8e4" : highlighted ? "#eae8e4" : "#c2c0b6";
  const background = hasAccent ? "rgba(255,255,255,0.04)" : active ? "#0c0c0c" : "transparent";
  const border = hasAccent ? "0.5px solid rgba(222,220,209,0.06)" : active ? "0.5px solid transparent" : "0.5px solid transparent";
  const hoverBackground = active || hasAccent ? background : "rgba(255,255,255,0.04)";
  const hoverBorder = active || hasAccent ? border : "0.5px solid rgba(222,220,209,0.06)";
  // Accent bar uses inset box-shadow so it doesn't affect layout or get wiped by hover border resets
  const accentShadow = hasAccent ? "inset 2px 0 0 0 rgba(214,211,209,0.4)" : undefined;
  const hasInlineAction = Boolean(item.trailingAction);

  return (
    <Link
      href={item.href}
      aria-label={item.ariaLabel ?? item.label}
      className="dock-nav-row"
      onClick={onClick}
      onMouseEnter={(event) => {
        item.onRowMouseEnter?.(event);
        if (!active) {
          event.currentTarget.style.background = hoverBackground;
          event.currentTarget.style.border = hoverBorder;
        }
      }}
      onMouseLeave={(event) => {
        item.onRowMouseLeave?.(event);
        if (!active) {
          event.currentTarget.style.background = background;
          event.currentTarget.style.border = border;
        }
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: hasInlineAction ? "4px" : "7px",
        padding: item.indent ? "4px 8px 4px 18px" : "4px 8px 4px 10px",
        borderRadius: hasAccent ? "0" : "8px",
        textDecoration: "none",
        background,
        border,
        boxShadow: accentShadow,
        transition: "all 120ms ease",
        cursor: "pointer",
        position: "relative",
      }}
    >
      {item.leadingNode ? item.leadingNode : Icon ? <Icon size={13} strokeWidth={active || highlighted ? 2.25 : 2} color={iconColor} style={{ flexShrink: 0 }} /> : null}
      {item.leadingDotColor ? (
        <span
          aria-hidden
          style={{
            width: 7, height: 7, borderRadius: "999px",
            backgroundColor: item.leadingDotColor,
            flexShrink: 0,
          }}
        />
      ) : null}
      <span
        style={{
          fontFamily: "var(--font-body)",
          fontSize: "11px",
          fontWeight: hasAccent ? 500 : (active || highlighted ? 600 : 500),
          color: labelColor,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          lineHeight: 1.15,
          flex: hasInlineAction ? "1 1 auto" : 1,
          minWidth: 0,
          paddingRight: hasInlineAction ? "6px" : 0,
        }}
      >
        {item.label}
      </span>
      {item.trailingAction ? <span style={{ display: "inline-flex", alignItems: "center", flexShrink: 0, marginLeft: "1px" }}>{item.trailingAction}</span> : null}
      {item.statusDotColor ? (
        item.statusDotColor === "#22c55e" ? (
          /* Active agent — pulsing green dot */
          <span aria-hidden style={{ position: "relative", display: "inline-flex", width: "6px", height: "6px", flexShrink: 0 }}>
            <span style={{
              position: "absolute", inset: 0, borderRadius: "999px",
              backgroundColor: item.statusDotColor, opacity: 0.75,
              animation: "ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite",
            }} />
            <span style={{
              position: "relative", display: "inline-flex",
              width: "6px", height: "6px", borderRadius: "999px",
              backgroundColor: item.statusDotColor,
              boxShadow: `0 0 6px ${item.statusDotColor}`,
            }} />
          </span>
        ) : (
          <span
            aria-hidden
            style={{
              width: "6px",
              height: "6px",
              borderRadius: "999px",
              backgroundColor: item.statusDotColor,
              boxShadow: `0 0 6px ${item.statusDotColor}`,
              flexShrink: 0,
            }}
          />
        )
      ) : null}
      {item.badge != null ? (
        <span
          style={{
            background: "rgba(68,64,60,0.5)",
            color: "#c2c0b6",
            border: "0.5px solid rgba(222,220,209,0.12)",
            fontSize: "10px",
            fontWeight: 700,
            borderRadius: "9999px",
            padding: "0px 5px",
            minWidth: "16px",
            textAlign: "center",
            lineHeight: "13px",
            flexShrink: 0,
            marginLeft: "auto",
            marginRight: "-2px",
          }}
        >
          {item.badge}
        </span>
      ) : null}
      {item.badgeText ? (
        <span
          style={{
            background: "rgba(6,95,70,0.12)",
            color: "#6ee7b7",
            border: "0.5px solid rgba(16,185,129,0.25)",
            fontSize: "10px",
            fontWeight: 700,
            borderRadius: "9999px",
            padding: "0px 6px",
            lineHeight: "13px",
            flexShrink: 0,
            textTransform: "lowercase",
          }}
        >
          {item.badgeText}
        </span>
      ) : null}
    </Link>
  );
}

function shimmerStyle() {
  return {
    height: "18px",
    borderRadius: "7px",
    border: "1px solid rgba(120,113,108,0.18)",
    background: "linear-gradient(90deg, rgba(41,37,36,0.5) 0%, rgba(68,64,60,0.65) 50%, rgba(41,37,36,0.5) 100%)",
    animation: "pulse 1.8s ease-in-out infinite",
  } as const;
}

function isAgentActive(agent: OrchestrationAgent): boolean {
  return agent.status === "working";
}

function isProjectPaused(project: OrchestrationProject): boolean {
  return project.status === "paused" || project.status === "on-hold" || project.status === "inactive";
}

function operationsItemHref(code: string, itemLabel: string): string {
  switch (itemLabel) {
    case "Tasks":
      return `/${code}/tasks`;
    case "Dashboard":
      return buildCanonicalDashboardPath(code);
    case "Inbox":
      return buildCanonicalInboxPath(code);
    case "Approvals":
      return `/${code}/approvals/pending`;
    case "Routines":
      return `/${code}/routines`;
    case "Goals":
      return buildCanonicalGoalsPath(code);
    default:
      return buildCanonicalCompanyPath(code);
  }
}

function companyItemHref(code: string, itemLabel: string): string {
  switch (itemLabel) {
    case "Org":
      return buildCanonicalOrgPath(code);
    case "Manage Projects":
      return buildCanonicalManageProjectsPath(code);
    case "Skills":
      return buildCanonicalSkillsPath(code);
    case "Costs":
      return buildCanonicalCostsPath(code);
    case "Activity":
      return buildCanonicalActivityPath(code);
    case "Files":
      return buildCanonicalFilesPath(code);
    case "Settings":
      return buildCanonicalSettingsPath(code);
    default:
      return buildCanonicalCompanyPath(code);
  }
}

export function Dock() {
  const pathname = usePathname();
  const router = useRouter();
  const { collapsed, toggle: toggleDock } = useDockCollapsed();
  const { activeProject, setActiveProject, clearActiveProject } = useActiveProjectState();
  const { liveAgentIds } = useLiveStream();

  const [isMobile, setIsMobile] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [agentsOpen, setAgentsOpen] = useState(true);
  const [companyOpen, setCompanyOpen] = useState(true);
  const [systemsOpen, setSystemsOpen] = useState(false);
  const [appsOpen, setAppsOpen] = useState(false);
  const [company, setCompany] = useState<CompanyNavState>({
    slug: "",
    name: "",
    code: "",
    status: "active",
  });
  const [companies, setCompanies] = useState<(CompanyNavState & { code: string })[]>([]);
  const [companyPickerOpen, setCompanyPickerOpen] = useState(false);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [projects, setProjects] = useState<OrchestrationProject[]>([]);
  const [agents, setAgents] = useState<OrchestrationAgent[]>([]);
  const lastProjectSelectionKeyRef = useRef<string | null>(null);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [inboxUnreadCount, setInboxUnreadCount] = useState(0);
  const [projectStatusBusyId, setProjectStatusBusyId] = useState<string | null>(null);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [createAgentOpen, setCreateAgentOpen] = useState(false);
  const [createCompanyOpen, setCreateCompanyOpen] = useState(false);
  const [createTaskOpen, setCreateTaskOpen] = useState(false);
  const [showCreateTaskAction, setShowCreateTaskAction] = useState(false);
  const [showCompanyActions, setShowCompanyActions] = useState(false);
  const [companyPauseBusy, setCompanyPauseBusy] = useState(false);

  const activeProjectForCompany =
    activeProject && activeProject.companySlug === company.slug ? activeProject : null;
  const { hiddenProjects } = useHiddenProjects(company.slug);

  const visibleProjects = useMemo(
    () => projects.filter((project) => !hiddenProjects[project.id]),
    [hiddenProjects, projects]
  );

  const setActiveProjectIfChanged = useCallback(
    (next: {
      companySlug: string;
      projectId: string;
      projectSlug?: string;
      projectName?: string;
    } | null) => {
      const nextKey = next ? `${next.companySlug}:${next.projectId}:${next.projectSlug ?? ""}` : null;
      if (lastProjectSelectionKeyRef.current === nextKey) return;

      const currentKey = activeProject
        ? `${activeProject.companySlug}:${activeProject.projectId}:${activeProject.projectSlug ?? ""}`
        : null;

      if (currentKey === nextKey) {
        lastProjectSelectionKeyRef.current = nextKey;
        return;
      }

      lastProjectSelectionKeyRef.current = nextKey;
      if (next) {
        setActiveProject(next);
      } else {
        clearActiveProject();
      }
    },
    [activeProject, clearActiveProject, setActiveProject]
  );

  const checkActive = useCallback(
    (href: string, exact?: boolean) => {
      if (pathname === href) return true;
      if (exact) return false;
      // Only match children if no sibling nav item owns a more specific prefix
      return pathname.startsWith(`${href}/`);
    },
    [pathname]
  );

  // For items that share a prefix (e.g. /trading vs /trading/floor),
  // use exact matching to avoid double-highlighting.
  const checkActiveExact = useCallback(
    (href: string, allHrefs: string[]) => {
      if (pathname === href) return true;
      // If another nav item has a longer prefix that also matches, don't highlight this one
      const hasMoreSpecificSibling = allHrefs.some(
        (other) => other !== href && other.startsWith(`${href}/`) && (pathname === other || pathname.startsWith(`${other}/`))
      );
      if (hasMoreSpecificSibling) return false;
      return pathname.startsWith(`${href}/`);
    },
    [pathname]
  );

  const handleToggleCompanyPause = async () => {
    if (!company || companyPauseBusy) return;
    const next = company.status === "paused" ? "active" : "paused";

    setCompanyPauseBusy(true);
    try {
      const response = await fetch(`/api/orchestration/companies/${company.slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!response.ok) throw new Error("failed");

      setCompany((previous) => (previous ? { ...previous, status: next } : previous));
      setCompanies((rows) => rows.map((item) => (
        item.slug === company.slug ? { ...item, status: next } : item
      )));
    } catch {
      // keep local state as-is when the API request fails
    } finally {
      setCompanyPauseBusy(false);
    }
  };

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const resolveCompany = async () => {
      const companies = await listCompanies();
      if (cancelled || companies.length === 0) return;
      setCompanies(companies.map((c) => ({
        id: c.id,
        slug: c.slug,
        name: c.name,
        code: c.code || c.slug.slice(0, 3).toUpperCase(),
        status: c.status,
      })));

      const segments = pathname.split("/").filter(Boolean);
      const root = segments[0];

      let resolved: CompanyNavState | null = null;

      if (root === "companies" && segments[1]) {
        const current = companies.find((candidate) => candidate.slug === segments[1]);
        if (current) {
          resolved = {
            id: current.id,
            slug: current.slug,
            name: current.name,
            code: current.code || current.slug.slice(0, 3).toUpperCase(),
            status: current.status,
          };
        }
      }

      // Detect canonical /{companyCode}/... URLs
      if (!resolved && root && root !== "companies" && root !== "projects") {
        const byCode = companies.find(
          (candidate) => (candidate.code || "").toUpperCase() === root.toUpperCase()
        );
        if (byCode) {
          resolved = {
            id: byCode.id,
            slug: byCode.slug,
            name: byCode.name,
            code: byCode.code || byCode.slug.slice(0, 3).toUpperCase(),
            status: byCode.status,
          };
        }
      }

      if (!resolved && root === "projects" && segments[1]) {
        const projects = await listProjects();
        if (cancelled) return;
        const currentProject = projects.find((project) => project.id === segments[1] || project.slug === segments[1]);
        const currentCompany = currentProject?.companyId
          ? companies.find((candidate) => candidate.id === currentProject.companyId)
          : null;
        if (currentCompany) {
          resolved = {
            id: currentCompany.id,
            slug: currentCompany.slug,
            name: currentCompany.name,
            code: currentCompany.code || currentCompany.slug.slice(0, 3).toUpperCase(),
            status: currentCompany.status,
          };
        }
      }

      if (!resolved) {
        // URL doesn't contain a company code — keep current selection if we have one.
        if (company.id) return;
        const fallback = companies.find((candidate) => candidate.id === FALLBACK_COMPANY_ID) ?? companies[0];
        resolved = {
          id: fallback?.id,
          slug: fallback?.slug ?? "",
          name: fallback?.name ?? "",
          code: fallback?.code ?? "",
          status: fallback?.status ?? "active",
        };
      }

      // Only update state if the company actually changed — prevents cascading re-renders
      setCompany((prev) => (
        prev.slug === resolved!.slug && prev.name === resolved!.name && prev.code === resolved!.code && prev.status === resolved!.status
          ? prev
          : resolved!
      ));
    };

    void resolveCompany();
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  useEffect(() => {
    let cancelled = false;

    const loadProjects = async (mode: "initial" | "poll") => {
      // Only show loading shimmer on true first load when we have no data yet.
      // Subsequent refetches (from pathname/dependency changes or polls) should
      // update silently to avoid nav flash/reset.
      if (mode === "initial") {
        setProjectsLoading((prev) => projects.length === 0 ? true : prev);
      }
      // includeNonProduction: the company itself is the scoping boundary.
      // Without this, projects whose description contains tokens like "test"
      // are silently hidden from the Dock, causing "No projects found".
      const rows = await listProjects({ company: company.slug, includeNonProduction: true });
      if (cancelled) return;
      const sorted = rows.sort((a, b) => a.name.localeCompare(b.name));
      const visibleSorted = sorted.filter((project) => !hiddenProjects[project.id]);
      setProjects((previous) => {
        // Preserve the last known non-empty list if a poll cycle returns empty.
        if (mode === "poll" && sorted.length === 0 && previous.length > 0) {
          return previous;
        }
        // Skip re-render if data hasn't changed
        if (JSON.stringify(previous) === JSON.stringify(sorted)) return previous;
        return sorted;
      });
      setProjectsLoading(false);

      const pathProjectId = typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("projectId")
        : null;

      const inferredFromPath = visibleSorted.find(
        (project) =>
          pathname.includes(`/${cc}/projects/${project.slug || project.id}`) ||
          pathname.includes(`/companies/${company.slug}/projects/${project.slug || project.id}`) ||
          pathname.includes(`/projects/${project.id}`) ||
          pathProjectId === project.id ||
          pathProjectId === project.slug
      );

      if (inferredFromPath) {
        setActiveProjectIfChanged({
          companySlug: company.slug,
          projectId: inferredFromPath.id,
          projectSlug: inferredFromPath.slug,
          projectName: inferredFromPath.name,
        });
        return;
      }

      const stillValid = activeProject && activeProject.companySlug === company.slug
        ? visibleSorted.find((project) => project.id === activeProject.projectId || project.slug === activeProject.projectSlug)
        : null;

      if (stillValid) {
        if (stillValid.name !== activeProject?.projectName || stillValid.slug !== activeProject?.projectSlug) {
          setActiveProjectIfChanged({
            companySlug: company.slug,
            projectId: stillValid.id,
            projectSlug: stillValid.slug,
            projectName: stillValid.name,
          });
        }
        return;
      }

      if (visibleSorted.length === 0 && activeProject && activeProject.companySlug === company.slug) {
        setActiveProjectIfChanged(null);
        return;
      }

      if (!stillValid && visibleSorted.length > 0) {
        const fallbackProject = visibleSorted[0];
        setActiveProjectIfChanged({
          companySlug: company.slug,
          projectId: fallbackProject.id,
          projectSlug: fallbackProject.slug,
          projectName: fallbackProject.name,
        });
      }
    };

    void loadProjects("initial");

    const DOCK_POLL_MS = process.env.NODE_ENV === "development" ? 60_000 : 30_000;
    const interval = window.setInterval(() => {
      void loadProjects("poll");
    }, DOCK_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [company.slug, pathname, activeProject, hiddenProjects, setActiveProjectIfChanged]);

  useEffect(() => {
    let cancelled = false;

    const loadInboxCount = async () => {
      const inbox = await getCompanyInbox({
        companySlug: company.slug,
        includeTaskSnapshot: false,
        limit: 1,
        kinds: "task,approval",
      });
      if (cancelled || !inbox) return;
      const count = Math.max(0, inbox.unreadCount);
      setInboxUnreadCount((prev) => prev === count ? prev : count);
    };

    void loadInboxCount();
    const INBOX_POLL_MS = process.env.NODE_ENV === "development" ? 60_000 : 30_000;
    const interval = window.setInterval(() => {
      void loadInboxCount();
    }, INBOX_POLL_MS);

    // Listen for immediate unread-count updates from the inbox page
    const handleUnreadChange = (e: Event) => {
      const count = (e as CustomEvent).detail?.count;
      if (typeof count === "number") setInboxUnreadCount(count);
    };
    window.addEventListener("inbox-unread-change", handleUnreadChange);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("inbox-unread-change", handleUnreadChange);
    };
  }, [company.slug]);

  const activeAgentCount = useMemo(() => {
    // Prefer real-time SSE-based liveness (shared with dashboard)
    if (liveAgentIds.size > 0) return liveAgentIds.size;
    // Fallback: DB-polled agent.status
    return agents.filter((agent) => isAgentActive(agent)).length;
  }, [liveAgentIds, agents]);

  useEffect(() => {
    let cancelled = false;

    const loadAgents = async (mode: "initial" | "poll") => {
      if (mode === "initial") setAgentsLoading((prev) => agents.length === 0 ? true : prev);
      const rows = await listCompanyAgents(company.slug);
      if (cancelled) return;
      const sorted = rows.sort((a, b) => a.name.localeCompare(b.name));
      setAgents((prev) => {
        if (JSON.stringify(prev) === JSON.stringify(sorted)) return prev;
        return sorted;
      });
      setAgentsLoading(false);
    };

    void loadAgents("initial");

    const AGENTS_POLL_MS = process.env.NODE_ENV === "development" ? 60_000 : 30_000;
    const interval = window.setInterval(() => {
      void loadAgents("poll");
    }, AGENTS_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [company.slug]);

  const cc = company.code;

  // Extract the current sub-page so we can persist it when switching agents/projects
  const currentAgentSubpage = (() => {
    const m = pathname.match(/^\/[^/]+\/agents\/[^/]+\/([^/?]+)/);
    return m ? m[1] : null;
  })();
  const currentProjectSubpage = (() => {
    const m = pathname.match(/^\/[^/]+\/projects\/[^/]+\/([^/?]+)/);
    return m ? m[1] : null;
  })();

  const mobileItems: NavItem[] = useMemo(
    () => [
      { href: buildCanonicalDashboardPath(cc), label: "Dashboard", icon: Building2 },
      { href: buildCanonicalIssuesPath(cc), label: "Tasks", icon: ListChecks },
      { href: buildCanonicalProjectsPath(cc), label: "Projects", icon: FolderOpen },
      { href: buildCanonicalTeamPath(cc), label: "Agents", icon: Bot },
      { href: "/search", label: "Search", icon: Search },
    ],
    [cc]
  );

  if (isMobile) {
    return (
      <nav
        aria-label="Mobile Primary"
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          height: "56px",
          borderTop: "0.5px solid rgba(222,220,209,0.12)",
          background: "#262525",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-around",
          zIndex: 50,
          padding: "0 8px",
        }}
      >
        {mobileItems.map((item) => {
          const Icon = item.icon;
          const active = checkActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-label={item.ariaLabel}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "2px",
                padding: "3px 10px",
                borderRadius: "8px",
                textDecoration: "none",
                color: active ? "#f59e0b" : "#a8a29e",
                background: active ? "rgba(180,83,9,0.18)" : "transparent",
              }}
            >
              <Icon size={18} strokeWidth={active ? 2.4 : 2} />
              <span style={{ fontSize: "9px", fontWeight: active ? 700 : 500 }}>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    );
  }

  const dockContent = (
    <nav
      className="dock"
      aria-label="Primary"
      style={{
        position: "fixed",
        left: 0,
        top: 0,
        bottom: 0,
        width: `${DOCK_WIDTH}px`,
        borderRight: "0.5px solid rgba(222,220,209,0.08)",
        background: "#262525",
        boxShadow: "none",
        display: "flex",
        flexDirection: "column",
        padding: "6px 6px 10px",
        gap: "1px",
        zIndex: 50,
        overflowY: "auto",
        overflowX: "hidden",
      }}
    >
      <div style={{ margin: "2px 4px 8px", padding: "2px 2px 6px", borderBottom: "0.5px solid rgba(222,220,209,0.08)" }}>
        <p
          style={{
            margin: 0,
            fontSize: "13px",
            letterSpacing: "0.01em",
            color: "#eae8e4",
            fontWeight: 600,
          }}
        >
          {company.name}
        </p>
      </div>

      <SectionHeader label="Operations" />
      {OPERATIONS_ITEMS.map((entry) => {
        const isTasks = entry.label === "Tasks";
        const href = operationsItemHref(cc, entry.label);
                const item =
          isTasks
            ? {
                ...entry,
                href,
                trailingAction: (
                  <div
                    style={{
                      position: "absolute",
                      right: "6px",
                      top: "50%",
                      transform: "translateY(-50%)",
                      display: "inline-flex",
                      alignItems: "center",
                      opacity: showCreateTaskAction ? 1 : 0,
                      pointerEvents: showCreateTaskAction ? "auto" : "none",
                      transition: "opacity 120ms ease",
                      zIndex: 2,
                    }}
                  >
                    <button
                      type="button"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setCreateTaskOpen(true);
                      }}
                      aria-label="Create task"
                      title="Create task"
                      style={{
                        width: "18px",
                        height: "18px",
                        borderRadius: "6px",
                        border: "0.5px solid rgba(222,220,209,0.12)",
                        background: "rgba(41,37,36,0.55)",
                        color: "#a8a6a0",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                        transition: "all 120ms ease",
                      }}
                      onMouseEnter={(event) => {
                        event.currentTarget.style.border = "0.5px solid rgba(222,220,209,0.2)";
                        event.currentTarget.style.background = "rgba(41,37,36,0.55)";
                        event.currentTarget.style.color = "#eae8e4";
                      }}
                      onMouseLeave={(event) => {
                        event.currentTarget.style.border = "0.5px solid rgba(222,220,209,0.12)";
                        event.currentTarget.style.background = "rgba(41,37,36,0.55)";
                        event.currentTarget.style.color = "#a8a6a0";
                      }}
                    >
                      <Plus size={11} strokeWidth={2.2} />
                    </button>
                  </div>
                ),
              }
            : entry.label === "Dashboard"
              ? { ...entry, href, badgeText: activeAgentCount > 0 ? `${activeAgentCount} live` : undefined }
              : entry.label === "Inbox"
                ? { ...entry, href, badge: inboxUnreadCount > 0 ? inboxUnreadCount : undefined }
                : { ...entry, href };
        return (
          <NavRow
            key={entry.label}
            item={{
              ...item,
              onRowMouseEnter: isTasks ? () => setShowCreateTaskAction(true) : undefined,
              onRowMouseLeave: isTasks ? () => setShowCreateTaskAction(false) : undefined,
            }}
            active={checkActive(href)}
          />
        );
      })}

      <SectionDivider />

      <SectionHeader
        label="Projects"
        collapsed={!projectsOpen}
        onToggle={() => setProjectsOpen((prev) => !prev)}
        showCreateOnHover
        onCreate={() => {
          setCreateProjectOpen(true);
        }}
        createAriaLabel="Create project"
      />
      {projectsOpen && (projectsLoading ? (
        <div style={{ display: "grid", gap: "3px", padding: "0 4px" }}>
          <div style={shimmerStyle()} />
          <div style={shimmerStyle()} />
        </div>
      ) : visibleProjects.length === 0 ? (
        <p style={{ margin: "2px 8px 4px", fontSize: "10px", color: "#78716c" }}>No projects found.</p>
      ) : (
        visibleProjects.filter((p) => p.status !== "archived").map((project) => {
          const pSlug = project.slug || project.id;
          const defaultPath = buildCanonicalProjectIssuesPath(cc, pSlug);
          const href = currentProjectSubpage
            ? defaultPath.replace(/\/tasks$/, `/${currentProjectSubpage}`)
            : defaultPath;
          return (
            <NavRow
              key={project.id}
              item={{
                href,
                label: project.name,
                leadingDotColor: project.color || "#22d3ee",
              }}
              active={checkActive(href) || checkActive(`/${cc}/projects/${pSlug}`)}
            />
          );
        })
      ))}

      <SectionDivider />

      <SectionHeader
        label="Agents"
        collapsed={!agentsOpen}
        onToggle={() => setAgentsOpen((prev) => !prev)}
        showCreateOnHover
        onCreate={() => {
          setCreateAgentOpen(true);
        }}
        createAriaLabel="Create agent"
      />
      {agentsOpen && (agentsLoading ? (
        <div style={{ display: "grid", gap: "3px", padding: "0 4px" }}>
          <div style={shimmerStyle()} />
          <div style={shimmerStyle()} />
          <div style={shimmerStyle()} />
        </div>
      ) : agents.length === 0 ? (
        <p style={{ margin: "2px 8px 4px", fontSize: "10px", color: "#78716c" }}>No agents registered.</p>
      ) : (
        agents.map((agent) => {
          const agentSlug = agent.slug || agent.id;
          const basePath = buildCanonicalAgentPath(cc, agentSlug);
          const href = currentAgentSubpage
            ? `${basePath}/${currentAgentSubpage}`
            : basePath;
          return (
            <NavRow
              key={agent.id}
              item={{
                href,
                label: agent.name,
                leadingNode: <AgentNavAvatar agent={agent} />,
              }}
              active={checkActive(href)}
            />
          );
        })
      ))}

      <SectionDivider />

      <SectionHeader
        label="Company"
        collapsed={!companyOpen}
        onToggle={() => setCompanyOpen((prev) => !prev)}
        showCreateOnHover
        onCreate={() => { setCreateCompanyOpen(true); }}
        createAriaLabel="Create company"
      />
      {companyOpen && (
        <>
          <div
            style={{ position: "relative", margin: "0 -6px" }}
            onMouseEnter={() => setShowCompanyActions(true)}
            onMouseLeave={() => setShowCompanyActions(false)}
          >
            <NavRow
              item={{
                href: buildCompanyPath(company.slug),
                label: company.name,
                indent: true,
                accentBar: true,
              }}
              active={pathname === buildCompanyPath(company.slug) || checkActive(buildCanonicalDashboardPath(cc)) || checkActive(buildCanonicalOrgPath(cc)) || checkActive(buildCanonicalSkillsPath(cc)) || checkActive(buildCanonicalCostsPath(cc)) || checkActive(buildCanonicalActivityPath(cc)) || checkActive(buildCanonicalFilesPath(cc)) || checkActive(buildCanonicalSettingsPath(cc))}
            />
            <div
              style={{
                position: "absolute",
                right: "12px",
                top: "50%",
                transform: "translateY(-50%)",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                opacity: showCompanyActions || companyPickerOpen ? 1 : 0,
                pointerEvents: showCompanyActions || companyPickerOpen ? "auto" : "none",
                transition: "opacity 140ms ease",
                zIndex: 2,
              }}
            >
              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void handleToggleCompanyPause();
                }}
                aria-label={company.status === "paused" ? "Resume company" : "Pause company"}
                title={company.status === "paused" ? "Resume company" : "Pause company"}
                style={{
                  width: "18px",
                  height: "18px",
                  borderRadius: "6px",
                  border: "0.5px solid rgba(222,220,209,0.12)",
                  background: "rgba(41,37,36,0.35)",
                  color: "#a8a6a0",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: companyPauseBusy ? "not-allowed" : "pointer",
                  transition: "all 120ms ease",
                  opacity: companyPauseBusy ? 0.5 : 1,
                }}
                disabled={companyPauseBusy}
                onMouseEnter={(event) => {
                  if (companyPauseBusy) return;
                  event.currentTarget.style.border = "0.5px solid rgba(222,220,209,0.2)";
                  event.currentTarget.style.background = "rgba(41,37,36,0.55)";
                  event.currentTarget.style.color = "#eae8e4";
                }}
                onMouseLeave={(event) => {
                  if (companyPauseBusy) return;
                  event.currentTarget.style.border = "0.5px solid rgba(222,220,209,0.12)";
                  event.currentTarget.style.background = "rgba(41,37,36,0.35)";
                  event.currentTarget.style.color = "#a8a6a0";
                }}
                onMouseDown={(event) => {
                  if (companyPauseBusy) return;
                  event.currentTarget.style.border = "0.5px solid rgba(222,220,209,0.2)";
                  event.currentTarget.style.background = "rgba(41,37,36,0.55)";
                  event.currentTarget.style.color = "#eae8e4";
                }}
                onMouseUp={(event) => {
                  if (companyPauseBusy) return;
                  event.currentTarget.style.border = "0.5px solid rgba(222,220,209,0.2)";
                  event.currentTarget.style.background = "rgba(41,37,36,0.55)";
                  event.currentTarget.style.color = "#eae8e4";
                }}
              >
                {company.status === "paused" ? <Play size={11} strokeWidth={2.2} /> : <Pause size={11} strokeWidth={2.2} />}
              </button>
              {companies.length > 1 ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setCompanyPickerOpen((prev) => !prev);
                  }}
                  aria-label="Switch company"
                  title="Switch company"
                  style={{
                    width: "18px",
                    height: "18px",
                    borderRadius: "6px",
                    border: "0.5px solid rgba(222,220,209,0.12)",
                    background: "rgba(41,37,36,0.35)",
                    color: "#a8a6a0",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    transition: "all 120ms ease",
                  }}
                  onMouseEnter={(event) => {
                    event.currentTarget.style.border = "0.5px solid rgba(222,220,209,0.2)";
                    event.currentTarget.style.background = "rgba(41,37,36,0.55)";
                    event.currentTarget.style.color = "#eae8e4";
                  }}
                  onMouseLeave={(event) => {
                    event.currentTarget.style.border = "0.5px solid rgba(222,220,209,0.12)";
                    event.currentTarget.style.background = "rgba(41,37,36,0.35)";
                    event.currentTarget.style.color = "#a8a6a0";
                  }}
                  onMouseDown={(event) => {
                    event.currentTarget.style.border = "0.5px solid rgba(222,220,209,0.2)";
                    event.currentTarget.style.background = "rgba(41,37,36,0.55)";
                    event.currentTarget.style.color = "#eae8e4";
                  }}
                  onMouseUp={(event) => {
                    event.currentTarget.style.border = "0.5px solid rgba(222,220,209,0.2)";
                    event.currentTarget.style.background = "rgba(41,37,36,0.55)";
                    event.currentTarget.style.color = "#eae8e4";
                  }}
                >
                  <Repeat size={11} strokeWidth={2.2} />
                </button>
              ) : null}
            </div>
            {companyPickerOpen ? (
              <div
                style={{
                  margin: "4px 6px 6px 18px",
                  maxWidth: "calc(100% - 24px)",
                  background: "rgba(28,25,23,0.98)",
                  border: "1px solid rgba(120,113,108,0.35)",
                  borderRadius: "10px",
                  boxShadow: "0 12px 30px rgba(0,0,0,0.35)",
                  padding: "8px 6px 6px",
                  position: "relative",
                  zIndex: 40,
                  overflow: "hidden",
                }}
              >
                <button
                  type="button"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setCompanyPickerOpen(false);
                  }}
                  aria-label="Close company picker"
                  title="Close"
                  style={{
                    position: "absolute",
                    top: "6px",
                    right: "6px",
                    width: "18px",
                    height: "18px",
                    borderRadius: "6px",
                    border: "1px solid rgba(255,255,255,0.12)",
                    background: "rgba(255,255,255,0.04)",
                    color: "#d6d3d1",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                  }}
                >
                  <X size={10} strokeWidth={2.2} />
                </button>
                <div style={{ padding: "0 28px 8px 6px", marginBottom: "4px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                  <span style={{ fontSize: "12px", fontWeight: 600, color: "#f5f5f4", letterSpacing: "0.01em" }}>
                    Select Company
                  </span>
                </div>
                {companies.map((candidate) => {
                  const active = candidate.slug === company.slug;
                  return (
                    <button
                      key={candidate.slug}
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setCompanyPickerOpen(false);
                        if (activeProject && activeProject.companySlug !== candidate.slug) {
                          setActiveProjectIfChanged(null);
                        }
                        if (!active) window.location.href = buildCanonicalDashboardPath(candidate.code);
                      }}
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "8px",
                        padding: "4px 6px",
                        borderRadius: "8px",
                        border: "none",
                        background: active ? "rgba(255,255,255,0.08)" : "transparent",
                        color: active ? "#fafaf9" : "#d6d3d1",
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      <span style={{ fontSize: "12px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {candidate.name}
                      </span>
                      {active ? <Check size={13} color="#f5f5f4" /> : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
          {COMPANY_ITEMS.map((entry) => {
            const href = companyItemHref(cc, entry.label);
            return <NavRow key={entry.label} item={{ ...entry, href }} active={checkActive(href)} />;
          })}
        </>
      )}

      <SectionDivider />

      <SectionHeader label="Apps" collapsed={!appsOpen} onToggle={() => setAppsOpen((prev) => !prev)} />
      {appsOpen && APPS_ITEMS.map((item) => (
        <NavRow key={item.href} item={item} active={checkActiveExact(item.href, APPS_ITEMS.map((i) => i.href))} />
      ))}

      <SectionDivider />

      <SectionHeader label="Systems" collapsed={!systemsOpen} onToggle={() => setSystemsOpen((prev) => !prev)} />
      {systemsOpen && SYSTEM_ITEMS.map((item) => <NavRow key={item.href} item={item} active={checkActive(item.href)} />)}

      {/* collapse toggle */}
      <div style={{ flex: 1, minHeight: 18 }} />
      <button
        onClick={toggleDock}
        title="Collapse sidebar"
        style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          width: 32, height: 32, margin: "4px 4px 0 auto",
          borderRadius: 8, border: "1px solid rgba(120,113,108,0.25)",
          background: "rgba(41,37,36,0.5)", color: "#a8a29e",
          cursor: "pointer", transition: "all 120ms ease",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(120,53,15,0.3)"; e.currentTarget.style.color = "#fde68a"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(41,37,36,0.5)"; e.currentTarget.style.color = "#a8a29e"; }}
      >
        <ChevronRight size={14} style={{ transform: "rotate(180deg)" }} />
      </button>
    </nav>
  );

  // When collapsed, show icon-only sidebar
  if (collapsed && !isMobile) {
    const collapsedItems: { href: string; icon: LucideIcon; label: string; dividerAfter?: boolean }[] = [
      { href: buildCanonicalNewIssuePath(cc), icon: SquarePen, label: "New Task" },
      { href: buildCanonicalDashboardPath(cc), icon: Building2, label: "Dashboard" },
      { href: buildCanonicalInboxPath(cc), icon: Inbox, label: "Inbox", dividerAfter: true },
      ...OPERATIONS_ITEMS.map((w, i) => ({ href: operationsItemHref(cc, w.label), icon: w.icon, label: w.label, dividerAfter: i === OPERATIONS_ITEMS.length - 1 })),
      ...COMPANY_ITEMS.map((c, i) => ({ href: companyItemHref(cc, c.label), icon: c.icon, label: c.label, dividerAfter: i === COMPANY_ITEMS.length - 1 })),
      ...APPS_ITEMS.map((a, i) => ({ href: a.href, icon: a.icon, label: a.label, dividerAfter: i === APPS_ITEMS.length - 1 })),
      ...SYSTEM_ITEMS.map((s) => ({ href: s.href, icon: s.icon, label: s.label })),
    ];

    return (
      <nav
        aria-label="Primary (collapsed)"
        style={{
          position: "fixed", left: 0, top: 0, bottom: 0,
          width: `${DOCK_COLLAPSED_WIDTH}px`,
          background: "#262525",
          borderRight: "0.5px solid rgba(222,220,209,0.08)",
          display: "flex", flexDirection: "column", alignItems: "center",
          padding: "8px 4px", gap: 2, zIndex: 50,
          overflowY: "auto", overflowX: "hidden",
        }}
      >
        {collapsedItems.map((item) => {
          const Icon = item.icon;
          const allHrefs = collapsedItems.map((i) => i.href);
          const active = checkActiveExact(item.href, allHrefs);
          return (
            <div key={item.href + item.label}>
              <Link
                href={item.href}
                title={item.label}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 32, height: 32, borderRadius: 6,
                  background: active ? "#0c0c0c" : "transparent",
                  border: active ? "0.5px solid transparent" : "0.5px solid transparent",
                  color: active ? "#eae8e4" : "#a8a6a0",
                  textDecoration: "none", transition: "all 120ms ease",
                }}
              >
                <Icon size={15} strokeWidth={active ? 2.25 : 2} />
              </Link>
              {item.dividerAfter && (
                <div style={{ height: 0.5, width: 24, margin: "3px auto", background: "rgba(222,220,209,0.08)" }} />
              )}
            </div>
          );
        })}

        <div style={{ flex: 1, minHeight: 18 }} />
        <button
          onClick={toggleDock}
          title="Expand sidebar"
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 32, height: 32, borderRadius: 8,
            border: "0.5px solid rgba(222,220,209,0.08)",
            background: "rgba(41,37,36,0.3)", color: "#a8a6a0",
            cursor: "pointer", transition: "all 120ms ease",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.color = "#eae8e4"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(41,37,36,0.3)"; e.currentTarget.style.color = "#a8a6a0"; }}
        >
          <ChevronRight size={14} />
        </button>
      </nav>
    );
  }

  return (
    <>
      {dockContent}
      <CreateProjectModal
        open={createProjectOpen}
        onClose={() => setCreateProjectOpen(false)}
        onCreated={(project) => {
          setActiveProjectIfChanged({
            companySlug: company.slug,
            projectId: project.id,
            projectSlug: project.slug,
            projectName: project.name,
          });
          router.push(buildCanonicalProjectIssuesPath(cc, project.slug));
        }}
        companyId={company.id ?? ""}
        companyCode={cc}
        companySlug={company.slug}
      />
      <CreateAgentModal
        open={createAgentOpen}
        onClose={() => setCreateAgentOpen(false)}
        companySlug={company.slug}
        companyCode={cc}
        onCreated={() => {
          router.refresh();
        }}
      />
      <CreateCompanyModal
        open={createCompanyOpen}
        onClose={() => setCreateCompanyOpen(false)}
        onCreated={() => {
          router.refresh();
        }}
      />
      <CreateTaskModal
        open={createTaskOpen}
        onClose={() => setCreateTaskOpen(false)}
        onCreated={() => {
          router.refresh();
        }}
        companySlug={company.slug}
        companyCode={cc}
      />
    </>
  );
}

export { DOCK_WIDTH, DOCK_COLLAPSED_WIDTH };
