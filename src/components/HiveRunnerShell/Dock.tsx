"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Bot,
  Brain,
  Building2,
  Check,
  ChevronRight,
  CircleDollarSign,
  FolderKanban,
  FolderOpen,
  Goal,
  Inbox,
  ListChecks,
  Logs,
  Pause,
  Play,
  Plus,
  Settings2,
  Server,
  SquarePen,
  Search,
  Sparkles,
  Terminal,
} from "lucide-react";

import { getCompanyInboxUnreadCount, getPendingSprintPlanDraftCount, listCompanies, listCompanyAgents, listProjects, updateProjectSettings } from "@/lib/orchestration/client";
import { CreateProjectModal } from "@/components/orchestration/CreateProjectModal";
import { CreateAgentModal } from "@/components/orchestration/CreateAgentModal";
import { CreateTaskModal } from "@/components/orchestration/CreateTaskModal";
import { AvatarGlyph, avatarIconToken, toAvatarIconToken } from "@/components/orchestration/AvatarGlyph";
import { HiveRunnerMarkIcon } from "@/components/HiveRunnerMarkIcon";
import { OrgChartBuildIcon } from "@/components/OrgChartBuildIcon";
import { AnimatedFolderOpenIcon } from "@/components/AnimatedFolderOpenIcon";
import { DashboardWidgetBoardIcon } from "@/components/DashboardWidgetBoardIcon";
import { RoutineRouteMoveIcon } from "@/components/RoutineRouteMoveIcon";
import { SlidersLeverMotionIcon } from "@/components/SlidersLeverMotionIcon";
import type { CompanyStatus, OrchestrationAgent, OrchestrationProject } from "@/lib/orchestration/types";
import { useDockCollapsed } from "@/lib/dock-state";
import { useActiveProjectState } from "@/lib/active-project-state";
import { useHiddenProjects } from "@/lib/hidden-project-state";
import {
  buildCanonicalCompanyPath,
  buildCanonicalDashboardPath,
  buildCanonicalInboxPath,
  buildCanonicalTasksPath,
  buildCanonicalGoalsPath,
  buildCanonicalTeamPath,
  buildCanonicalOrgPath,
  buildCanonicalSkillsPath,
  buildCanonicalHivesPath,
  buildCanonicalRuntimesPath,
  buildCanonicalCostsPath,
  buildCanonicalActivityPath,
  buildCanonicalFilesPath,
  buildCanonicalSettingsPath,
  buildCanonicalProjectsPath,
  buildCanonicalNewTaskPath,
  buildCanonicalNewAgentPath,
  buildCanonicalAgentPath,
  buildCanonicalProjectTasksPath,
  buildCanonicalProjectSettingsPath,
  buildCanonicalProjectAgentsPath,
  buildCanonicalManageProjectsPath,
  buildCanonicalMemoryPath,
} from "@/lib/orchestration/route-paths";
import { useLiveStream } from "@/components/live/LiveStreamProvider";
import { useLiveRuns } from "@/hooks/useLiveRuns";
import { isAgentLive } from "@/lib/orchestration/live-status";
import { useEventStream, type StreamEvent } from "@/lib/orchestration/use-event-stream";

interface NavItem {
  href: string;
  label: string;
  icon?: LucideIcon;
  animatedIcon?: boolean;
  iconMotion?:
    | "task"
    | "dashboard"
    | "dashboard-widget-board"
    | "inbox"
    | "workflow"
    | "goal"
    | "hive-runner-grow"
    | "files-folder-close"
    | "org-chart-build-wide"
    | "runtime"
    | "activity-pulse"
    | "broadcast-bars"
    | "costs-dollar"
    | "rocket-launch"
    | "routine-network"
    | "routine-route-move"
    | "runtime-orbit"
    | "runtime-server"
    | "settings-gear"
    | "sliders-lever-return"
    | "terminal-cursor"
    | "voice-wave";
  leadingNode?: ReactNode;
  ariaLabel?: string;
  title?: string;
  hoverRevealText?: string;
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
  suppressHoverBorder?: boolean;
  onRowMouseEnter?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
  onRowMouseLeave?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
}

type DockIconNavItem = Omit<NavItem, "href"> & { icon: LucideIcon };
type DockHrefIconNavItem = NavItem & { icon: LucideIcon };

interface CompanyNavState {
  id?: string;
  slug: string;
  name: string;
  code: string;
  status: CompanyStatus;
}

const DOCK_WIDTH = 204;
const DOCK_COLLAPSED_WIDTH = 44;
const DOCK_BG = "var(--surface)";
const DOCK_BG_ELEVATED = "var(--surface-elevated)";
const DOCK_BG_HOVER = "var(--surface-hover)";
const DOCK_BG_ACTIVE = "var(--dock-active-bg)";
const DOCK_BORDER = "var(--border)";
const DOCK_BORDER_STRONG = "var(--border-strong)";
const DOCK_BORDER_ACTIVE = "var(--dock-active-border)";
const DOCK_TEXT = "var(--text-primary)";
const DOCK_TEXT_SECONDARY = "var(--text-secondary)";
const DOCK_TEXT_MUTED = "var(--text-muted)";
const DOCK_ACCENT = "var(--accent)";
const DOCK_ACCENT_SOFT = "var(--accent-soft)";
const DOCK_POSITIVE = "var(--positive)";
const DOCK_POSITIVE_SOFT = "var(--positive-soft)";
// Use stable company ID for fallback resolution, not mutable slug/code.
const FALLBACK_COMPANY_ID = "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f";

const OPERATIONS_ITEMS: DockIconNavItem[] = [
  { label: "Tasks", icon: ListChecks, animatedIcon: true, iconMotion: "task" },
  { label: "Dashboard", icon: DashboardWidgetBoardIcon as LucideIcon, animatedIcon: true, iconMotion: "dashboard-widget-board" },
  { label: "Inbox", icon: Inbox, animatedIcon: true, iconMotion: "inbox" },
  { label: "Routines", icon: RoutineRouteMoveIcon as LucideIcon, animatedIcon: true, iconMotion: "routine-route-move" },
  { label: "Goals", icon: Goal, animatedIcon: true, iconMotion: "goal" },
];

const COMPANY_ITEMS: DockIconNavItem[] = [
  { label: "Org", icon: OrgChartBuildIcon as LucideIcon, animatedIcon: true, iconMotion: "org-chart-build-wide" },
  { label: "Manage Projects", icon: FolderKanban },
  { label: "Skills", icon: Sparkles },
  { label: "Memory", icon: Brain },
  { label: "Hives", icon: HiveRunnerMarkIcon as LucideIcon, animatedIcon: true, iconMotion: "hive-runner-grow" },
  { label: "Costs", icon: CircleDollarSign, animatedIcon: true, iconMotion: "costs-dollar" },
  { label: "Activity", icon: Activity },
  { label: "Files", icon: AnimatedFolderOpenIcon as LucideIcon, animatedIcon: true, iconMotion: "files-folder-close" },
  { label: "Settings", icon: SlidersLeverMotionIcon as LucideIcon, animatedIcon: true, iconMotion: "sliders-lever-return" },
];

const SYSTEM_ITEMS: DockHrefIconNavItem[] = [
  { href: "/systems/companies", label: "Manage Companies", icon: Building2, animatedIcon: true, iconMotion: "routine-network" },
  { href: "/terminal", label: "Terminal", icon: Terminal, animatedIcon: true, iconMotion: "terminal-cursor" },
  { href: "/sessions", label: "Sessions", icon: Server, animatedIcon: true, iconMotion: "runtime-server" },
  { href: "/logs", label: "Logs", icon: Logs, animatedIcon: true, iconMotion: "terminal-cursor" },
];

const NON_COMPANY_ROUTE_ROOTS = new Set([
  "api",
  "animation-lab",
  "auth",
  "_next",
  "login",
  "companies",
  "projects",
  "ideas",
  "leadlag",
  "marketing",
  "voice",
  "terminal",
  "sessions",
  "logs",
  "search",
  "settings",
  "skills",
  "workflows",
  "system",
  "systems",
  "office",
  "monitoring",
  "reliability",
  "reports",
  "memory",
  "files",
  "git",
  "cron",
  "factory",
  "org",
  "tasks",
  "agents",
]);

function SectionDivider() {
  return (
    <div
      style={{
        height: "0.5px",
        margin: "4px 6px",
        background: DOCK_BORDER,
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
            color={DOCK_TEXT_MUTED}
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
            color: DOCK_TEXT_MUTED,
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
            border: `0.5px solid ${DOCK_BORDER}`,
            background: DOCK_BG_ELEVATED,
            color: DOCK_TEXT_SECONDARY,
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
            event.currentTarget.style.border = `0.5px solid ${DOCK_BORDER_STRONG}`;
            event.currentTarget.style.background = DOCK_BG_HOVER;
            event.currentTarget.style.color = DOCK_TEXT;
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.border = `0.5px solid ${DOCK_BORDER}`;
            event.currentTarget.style.background = DOCK_BG_ELEVATED;
            event.currentTarget.style.color = DOCK_TEXT_SECONDARY;
          }}
        >
          <Plus size={11} strokeWidth={2.2} />
        </button>
      ) : null}
    </div>
  );
}

function AgentNavAvatar({ agent }: { agent: OrchestrationAgent }) {
  const iconValue = avatarIconToken(agent.emoji) ? agent.emoji : toAvatarIconToken("bot");
  const fallbackStyle = {
    width: "13px",
    height: "13px",
    minWidth: "13px",
    borderRadius: "9999px",
    border: `0.5px solid ${DOCK_BORDER_STRONG}`,
    background: DOCK_BG_ELEVATED,
    color: DOCK_TEXT,
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
        <AvatarGlyph value={iconValue} size={9} color={DOCK_TEXT} />
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
          border: `0.5px solid ${DOCK_BORDER_STRONG}`,
          boxShadow: "none",
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
        <AvatarGlyph value={iconValue} size={9} color={DOCK_TEXT} />
      </span>
    </span>
  );
}

function formatAgentNavLabel(name: string): string {
  const compact = name.replace(/(?:\s*\([^)]*\)\s*)+$/, "").trim();
  return compact || name;
}

function formatAgentNavRole(agent: OrchestrationAgent): string | undefined {
  return agent.role?.trim() || undefined;
}

function NavRow({ item, active, onClick }: { item: NavItem; active: boolean; onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void }) {
  const router = useRouter();
  const Icon = item.icon;
  const hasAccent = Boolean(item.accentBar);
  const highlighted = item.highlight && !active;
  const iconColor = hasAccent || active || highlighted ? DOCK_TEXT : DOCK_TEXT_SECONDARY;
  const labelColor = hasAccent || active || highlighted ? DOCK_TEXT : DOCK_TEXT_SECONDARY;
  const background = hasAccent ? DOCK_ACCENT_SOFT : active ? DOCK_BG_ACTIVE : "transparent";
  const border = hasAccent ? `0.5px solid ${DOCK_BORDER}` : active ? `0.5px solid ${DOCK_BORDER_ACTIVE}` : "0.5px solid transparent";
  const hoverBackground = active || hasAccent ? background : DOCK_BG_ELEVATED;
  const hoverBorder = active || hasAccent || item.suppressHoverBorder ? border : `0.5px solid ${DOCK_BORDER}`;
  // Accent bar uses inset box-shadow so it doesn't affect layout or get wiped by hover border resets
  const accentShadow = hasAccent ? `inset 2px 0 0 0 ${DOCK_ACCENT}` : undefined;
  const hasInlineAction = Boolean(item.trailingAction);
  const [rowHovered, setRowHovered] = useState(false);
  const showHoverReveal = rowHovered && Boolean(item.hoverRevealText);

  return (
    <a
      href={item.href}
      aria-label={item.ariaLabel ?? item.label}
      title={item.hoverRevealText ? undefined : item.title ?? item.ariaLabel ?? item.label}
      className="dock-nav-row"
      data-animated-icon={item.animatedIcon ? "true" : undefined}
      data-icon-motion={item.iconMotion}
      onClick={(event) => {
        onClick?.(event);
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }
        event.preventDefault();
        const target = new URL(item.href, window.location.origin);
        router.push(item.href);
        window.setTimeout(() => {
          const current = `${window.location.pathname}${window.location.search}`;
          const expected = `${target.pathname}${target.search}`;
          if (current !== expected) {
            window.location.assign(item.href);
          }
        }, 1200);
      }}
      onMouseEnter={(event) => {
        setRowHovered(true);
        item.onRowMouseEnter?.(event);
        if (!active) {
          event.currentTarget.style.background = hoverBackground;
          event.currentTarget.style.border = hoverBorder;
        }
      }}
      onMouseLeave={(event) => {
        setRowHovered(false);
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
      {item.leadingNode ? item.leadingNode : Icon ? (
        <span className="dock-nav-icon" aria-hidden="true" style={{ color: iconColor }}>
          <Icon size={13} strokeWidth={active || highlighted ? 2.25 : 2} color={iconColor} />
          {item.iconMotion ? <span className="dock-nav-effect" /> : null}
        </span>
      ) : null}
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
          display: "flex",
          alignItems: "baseline",
          gap: 3,
        }}
      >
        <span style={{ flex: "0 0 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
          {item.label}
        </span>
        {showHoverReveal ? (
          <span
            style={{
              flex: "1 1 auto",
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              color: DOCK_TEXT_MUTED,
              fontWeight: 500,
            }}
          >
            ({item.hoverRevealText})
          </span>
        ) : null}
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
            background: DOCK_BG_ELEVATED,
            color: DOCK_TEXT_SECONDARY,
            border: `0.5px solid ${DOCK_BORDER}`,
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
            background: DOCK_POSITIVE_SOFT,
            color: DOCK_POSITIVE,
            border: "none",
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
    </a>
  );
}

function shimmerStyle() {
  return {
    height: "18px",
    borderRadius: "7px",
    border: `0.5px solid ${DOCK_BORDER}`,
    background: `linear-gradient(90deg, ${DOCK_BG_ELEVATED} 0%, ${DOCK_BG_HOVER} 50%, ${DOCK_BG_ELEVATED} 100%)`,
    animation: "pulse 1.8s ease-in-out infinite",
  } as const;
}

function isProjectPaused(project: OrchestrationProject): boolean {
  return project.status === "paused" || project.status === "on-hold" || project.status === "inactive";
}

function operationsItemHref(code: string, itemLabel: string): string {
  switch (itemLabel) {
    case "Tasks":
      return `${buildCanonicalTasksPath(code)}?view=board&group=status`;
    case "Dashboard":
      return buildCanonicalDashboardPath(code);
    case "Inbox":
      return buildCanonicalInboxPath(code);
    case "Routines":
      return buildCanonicalCompanyPath(code, "/routines");
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
    case "Memory":
      return buildCanonicalMemoryPath(code);
    case "Hives":
      return buildCanonicalHivesPath(code);
    case "Runtimes":
      return buildCanonicalRuntimesPath(code);
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

function inferCompanyCodeFromPath(pathname: string, companies: Array<CompanyNavState & { code: string }>): string {
  const segments = pathname.split("/").filter(Boolean);
  const root = segments[0] ?? "";
  const slugOrCode = segments[1] ?? "";

  if (root === "companies" && slugOrCode) {
    const bySlug = companies.find((candidate) => candidate.slug === slugOrCode);
    return bySlug?.code || "";
  }

  if (root && !NON_COMPANY_ROUTE_ROOTS.has(root.toLowerCase())) {
    return root.toUpperCase();
  }

  const fallback = companies.find((candidate) => candidate.id === FALLBACK_COMPANY_ID) ?? companies[0];
  return fallback?.code || "";
}

async function withDockTimeout<T>(promise: Promise<T>, ms = 5000): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
    }),
  ]);
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
  const [projectsCompanySlug, setProjectsCompanySlug] = useState("");
  const [agentsCompanySlug, setAgentsCompanySlug] = useState("");
  const lastProjectSelectionKeyRef = useRef<string | null>(null);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [inboxUnreadCount, setInboxUnreadCount] = useState(0);
  const [goalsPendingDraftCount, setGoalsPendingDraftCount] = useState(0);
  const [projectStatusBusyId, setProjectStatusBusyId] = useState<string | null>(null);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [createAgentOpen, setCreateAgentOpen] = useState(false);
  const [createTaskOpen, setCreateTaskOpen] = useState(false);
  const [showCreateTaskAction, setShowCreateTaskAction] = useState(false);
  const [companyPauseBusy, setCompanyPauseBusy] = useState(false);
  const companySwitcherRef = useRef<HTMLDivElement | null>(null);

  const activeProjectForCompany =
    activeProject && activeProject.companySlug === company.slug ? activeProject : null;
  const { hiddenProjects } = useHiddenProjects(company.slug);

  const projectsReadyForCompany = projectsCompanySlug === company.slug;
  const agentsReadyForCompany = agentsCompanySlug === company.slug;
  const currentCompanyProjects = useMemo(
    () => projectsReadyForCompany ? projects : [],
    [projectsReadyForCompany, projects]
  );
  const currentCompanyAgents = useMemo(
    () => agentsReadyForCompany ? agents : [],
    [agentsReadyForCompany, agents]
  );
  const projectsPending = Boolean(company.slug) && (!projectsReadyForCompany || projectsLoading);
  const agentsPending = Boolean(company.slug) && (!agentsReadyForCompany || agentsLoading);

  const visibleProjects = useMemo(
    () => currentCompanyProjects.filter((project) => !hiddenProjects[project.id]),
    [currentCompanyProjects, hiddenProjects]
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
      const hrefPath = href.split("?")[0];
      if (pathname === hrefPath) return true;
      if (exact) return false;
      // Only match children if no sibling nav item owns a more specific prefix
      return pathname.startsWith(`${hrefPath}/`);
    },
    [pathname]
  );

  // For items that share a prefix,
  // use exact matching to avoid double-highlighting.
  const checkActiveExact = useCallback(
    (href: string, allHrefs: string[]) => {
      const hrefPath = href.split("?")[0];
      const siblingPaths = allHrefs.map((itemHref) => itemHref.split("?")[0]);
      if (pathname === hrefPath) return true;
      // If another nav item has a longer prefix that also matches, don't highlight this one
      const hasMoreSpecificSibling = siblingPaths.some(
        (other) => other !== hrefPath && other.startsWith(`${hrefPath}/`) && (pathname === other || pathname.startsWith(`${other}/`))
      );
      if (hasMoreSpecificSibling) return false;
      return pathname.startsWith(`${hrefPath}/`);
    },
    [pathname]
  );

  const isApprovalPathForCurrentCompany = useMemo(() => {
    if (!company.slug || !company.code) return false;

    const canonicalPrefix = `/${company.code}/approvals`;
    const legacyPrefix = `/companies/${company.slug}/approvals`;
    return pathname === canonicalPrefix
      || pathname.startsWith(`${canonicalPrefix}/`)
      || pathname === legacyPrefix
      || pathname.startsWith(`${legacyPrefix}/`);
  }, [company.code, company.slug, pathname]);

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
    if (!companyPickerOpen) return;

    const closeOnOutsideInteraction = (event: MouseEvent | TouchEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (companySwitcherRef.current?.contains(target)) return;
      setCompanyPickerOpen(false);
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCompanyPickerOpen(false);
    };

    document.addEventListener("mousedown", closeOnOutsideInteraction);
    document.addEventListener("touchstart", closeOnOutsideInteraction);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideInteraction);
      document.removeEventListener("touchstart", closeOnOutsideInteraction);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [companyPickerOpen]);

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
      if (!company.slug) {
        if (!cancelled) {
          setProjects([]);
          setProjectsCompanySlug("");
          setProjectsLoading(false);
        }
        return;
      }
      // Only show loading shimmer on true first load when we have no data yet.
      // Subsequent refetches (from pathname/dependency changes or polls) should
      // update silently to avoid nav flash/reset.
      if (mode === "initial" && projectsCompanySlug !== company.slug) {
        setProjectsLoading(true);
      }
      let rows: OrchestrationProject[];
      try {
        // includeNonProduction: the company itself is the scoping boundary.
        // Without this, projects whose description contains tokens like "test"
        // are silently hidden from the Dock, causing "No projects found".
        rows = await withDockTimeout(listProjects({ company: company.slug, includeNonProduction: true }));
      } catch (error) {
        if (!cancelled) {
          console.warn("[dock] project load failed", error);
          setProjectsLoading(false);
        }
        return;
      }
      if (cancelled) return;
      const sorted = rows.sort((a, b) => a.name.localeCompare(b.name));
      const visibleSorted = sorted.filter((project) => !hiddenProjects[project.id]);
      setProjectsCompanySlug(company.slug);
      setProjects((previous) => {
        // Preserve the last known non-empty list if a poll cycle returns empty.
        if (mode === "poll" && sorted.length === 0 && previous.length > 0 && projectsCompanySlug === company.slug) {
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
  }, [company.slug, pathname, activeProject, hiddenProjects, projectsCompanySlug, setActiveProjectIfChanged]);

  useEffect(() => {
    let cancelled = false;

    const loadInboxCount = async () => {
      if (!company.slug) return;
      const count = await getCompanyInboxUnreadCount({
        companySlug: company.slug,
        includeDone: true,
        kinds: "task,approval,execution,sprint_plan_draft,lead_supervisor_update",
      });
      if (cancelled || count === null) return;
      const nextCount = Math.max(0, count);
      setInboxUnreadCount((prev) => prev === nextCount ? prev : nextCount);
    };

    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") {
        void loadInboxCount();
      }
    };

    void loadInboxCount();
    const INBOX_POLL_MS = process.env.NODE_ENV === "development" ? 15000 : 10000;
    const interval = window.setInterval(() => {
      void loadInboxCount();
    }, INBOX_POLL_MS);

    // Listen for immediate unread-count updates from the inbox page
    const handleUnreadChange = (e: Event) => {
      const count = (e as CustomEvent).detail?.count;
      if (typeof count === "number") setInboxUnreadCount(count);
      else void loadInboxCount();
    };
    window.addEventListener("inbox-unread-change", handleUnreadChange);
    const handleCompanyRefresh = (event: Event) => {
      const companySlug = (event as CustomEvent<{ companySlug?: string }>).detail?.companySlug;
      if (companySlug && companySlug !== company.slug) return;
      void loadInboxCount();
    };
    window.addEventListener("orchestration-company-refresh", handleCompanyRefresh);
    window.addEventListener("focus", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("inbox-unread-change", handleUnreadChange);
      window.removeEventListener("orchestration-company-refresh", handleCompanyRefresh);
      window.removeEventListener("focus", refreshIfVisible);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [company.slug]);

  const loadGoalsPendingDraftCount = useCallback(async () => {
    if (!company.slug) return;
    const count = await getPendingSprintPlanDraftCount({ companySlug: company.slug });
    if (count === null) return;
    const nextCount = Math.max(0, count);
    setGoalsPendingDraftCount((prev) => prev === nextCount ? prev : nextCount);
  }, [company.slug]);

  useEffect(() => {
    let cancelled = false;

    const loadCount = async () => {
      if (!company.slug) return;
      const count = await getPendingSprintPlanDraftCount({ companySlug: company.slug });
      if (cancelled || count === null) return;
      setGoalsPendingDraftCount(Math.max(0, count));
    };

    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") void loadCount();
    };

    void loadCount();
    const DRAFT_POLL_MS = process.env.NODE_ENV === "development" ? 15000 : 10000;
    const interval = window.setInterval(() => {
      void loadCount();
    }, DRAFT_POLL_MS);

    const handleDraftChange = (event: Event) => {
      const eventCompanySlug = (event as CustomEvent<{ companySlug?: string }>).detail?.companySlug;
      if (eventCompanySlug && eventCompanySlug !== company.slug) return;
      void loadCount();
    };
    window.addEventListener("goals-pending-drafts-change", handleDraftChange);
    window.addEventListener("focus", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("goals-pending-drafts-change", handleDraftChange);
      window.removeEventListener("focus", refreshIfVisible);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [company.slug]);

  const handleGoalDraftStreamEvent = useCallback((event: StreamEvent) => {
    if (event.type !== "activity") return;
    if (
      event.eventType === "goal.sprint_plan_proposed" ||
      event.eventType === "goal.sprint_plan_approved" ||
      event.eventType === "goal.sprint_plan_rejected" ||
      event.eventType === "goal.completion_proposed" ||
      event.eventType === "goal.completion_approved" ||
      event.eventType === "goal.completion_rejected"
    ) {
      void loadGoalsPendingDraftCount();
    }
  }, [loadGoalsPendingDraftCount]);

  useEventStream({
    companySlug: company.slug,
    enabled: Boolean(company.slug),
    onEvent: handleGoalDraftStreamEvent,
  });

  const { runsByAgentId } = useLiveRuns({
    companySlug: company.slug,
    enabled: Boolean(company.slug),
  });

  const activeAgentCount = useMemo(() => {
    return currentCompanyAgents.filter((agent) =>
      isAgentLive({
        agentId: agent.id,
        agentStatus: agent.status,
        liveAgentIds,
        liveRunsByAgentId: runsByAgentId,
      })
    ).length;
  }, [liveAgentIds, runsByAgentId, currentCompanyAgents]);

  useEffect(() => {
    let cancelled = false;

    const loadAgents = async (mode: "initial" | "poll") => {
      if (!company.slug) {
        if (!cancelled) {
          setAgents([]);
          setAgentsCompanySlug("");
          setAgentsLoading(false);
        }
        return;
      }
      if (mode === "initial" && agentsCompanySlug !== company.slug) setAgentsLoading(true);
      const rows = await listCompanyAgents(company.slug);
      if (cancelled) return;
      const sorted = rows.sort((a, b) => a.name.localeCompare(b.name));
      setAgentsCompanySlug(company.slug);
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

    const handleCompanyRefresh = (event: Event) => {
      const detail = (event as CustomEvent<{ companySlug?: string; agent?: OrchestrationAgent }>).detail;
      const companySlug = detail?.companySlug;
      if (companySlug && companySlug !== company.slug) return;
      if (detail?.agent) {
        const optimisticAgent = detail.agent;
        setAgentsCompanySlug(company.slug);
        setAgents((prev) => {
          const next = prev.some((agent) => agent.id === optimisticAgent.id)
            ? prev.map((agent) => agent.id === optimisticAgent.id ? { ...agent, ...optimisticAgent } : agent)
            : prev.concat(optimisticAgent);
          return next.sort((a, b) => a.name.localeCompare(b.name));
        });
        setAgentsLoading(false);
      }
      void loadAgents("poll");
    };
    window.addEventListener("orchestration-company-refresh", handleCompanyRefresh);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("orchestration-company-refresh", handleCompanyRefresh);
    };
  }, [agentsCompanySlug, company.slug]);

  const cc = company.code || inferCompanyCodeFromPath(pathname, companies);
  const hasCompanyContext = Boolean(cc);

  // Extract the current sub-page so we can persist it when switching agents/projects
  const currentAgentSubpage = (() => {
    const m = pathname.match(/^\/[^/]+\/agents\/[^/]+\/([^/?]+)/);
    return m ? m[1] : null;
  })();
  const currentProjectSubpage = (() => {
    const m = pathname.match(/^\/[^/]+\/projects\/[^/]+\/([^/?]+)/);
    return m ? m[1] : null;
  })();

  const mobileItems: DockHrefIconNavItem[] = useMemo(
    () => [
      ...(hasCompanyContext
        ? [
            { href: buildCanonicalDashboardPath(cc), label: "Dashboard", icon: Building2 },
            { href: operationsItemHref(cc, "Tasks"), label: "Tasks", icon: ListChecks },
            { href: buildCanonicalProjectsPath(cc), label: "Projects", icon: FolderOpen },
            { href: buildCanonicalTeamPath(cc), label: "Agents", icon: Bot },
          ]
        : []),
      { href: "/search", label: "Search", icon: Search },
    ],
    [cc, hasCompanyContext]
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
          borderTop: `0.5px solid ${DOCK_BORDER}`,
          background: DOCK_BG,
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
              prefetch={false}
              aria-label={item.ariaLabel}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "2px",
                padding: "3px 10px",
                borderRadius: "8px",
                textDecoration: "none",
                color: active ? DOCK_ACCENT : DOCK_TEXT_SECONDARY,
                background: active ? DOCK_ACCENT_SOFT : "transparent",
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
      className="dock task-detail-scrollbarless"
      aria-label="Primary"
      style={{
        position: "fixed",
        left: 0,
        top: 0,
        bottom: 0,
        width: `${DOCK_WIDTH}px`,
        borderRight: `0.5px solid ${DOCK_BORDER}`,
        background: DOCK_BG,
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
      <div ref={companySwitcherRef} style={{ margin: "2px 4px 8px", padding: "0 0 8px", borderBottom: `0.5px solid ${DOCK_BORDER}`, position: "relative" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
          <button
            type="button"
            onClick={() => setCompanyPickerOpen((prev) => !prev)}
            aria-expanded={companyPickerOpen}
            aria-label="Switch company"
            style={{
              minWidth: 0,
              flex: 1,
              display: "flex",
              alignItems: "center",
              gap: "7px",
              padding: "4px 6px",
              borderRadius: "9px",
              border: `0.5px solid ${companyPickerOpen ? DOCK_BORDER_STRONG : "transparent"}`,
              background: companyPickerOpen ? DOCK_BG_ELEVATED : "transparent",
              color: DOCK_TEXT,
              cursor: "pointer",
              textAlign: "left",
              transition: "all 120ms ease",
            }}
            onMouseEnter={(event) => {
              event.currentTarget.style.background = DOCK_BG_HOVER;
              event.currentTarget.style.border = `0.5px solid ${DOCK_BORDER}`;
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.background = companyPickerOpen ? DOCK_BG_ELEVATED : "transparent";
              event.currentTarget.style.border = `0.5px solid ${companyPickerOpen ? DOCK_BORDER_STRONG : "transparent"}`;
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: "22px",
                height: "22px",
                borderRadius: "8px",
                border: `0.5px solid ${DOCK_BORDER}`,
                background: DOCK_BG_ELEVATED,
                color: DOCK_TEXT,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                fontSize: "11px",
                fontWeight: 700,
                letterSpacing: "0.01em",
              }}
            >
              {(company.name || company.code || "C").slice(0, 1).toUpperCase()}
            </span>
            <span
              style={{
                minWidth: 0,
                flex: 1,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontSize: "13px",
                letterSpacing: "0.01em",
                fontWeight: 600,
              }}
            >
              {company.name || "Company"}
            </span>
            <ChevronRight
              size={12}
              strokeWidth={2.2}
              color={DOCK_TEXT_MUTED}
              style={{
                flexShrink: 0,
                transform: companyPickerOpen ? "rotate(90deg)" : "rotate(0deg)",
                transition: "transform 120ms ease",
              }}
            />
          </button>
        </div>
        {companyPickerOpen ? (
          <div
            role="menu"
            aria-label="Company switcher"
            style={{
              marginTop: "6px",
              background: DOCK_BG_ELEVATED,
              border: `0.5px solid ${DOCK_BORDER}`,
              borderRadius: "12px",
              boxShadow: "var(--shadow-glass)",
              padding: "7px",
              position: "relative",
              zIndex: 70,
              overflow: "hidden",
            }}
          >
            <div style={{ padding: "5px 6px 7px", borderBottom: `0.5px solid ${DOCK_BORDER}`, marginBottom: "5px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
                <span
                  style={{
                    width: "24px",
                    height: "24px",
                    borderRadius: "8px",
                    border: `0.5px solid ${DOCK_BORDER}`,
                    background: DOCK_BG_HOVER,
                    color: DOCK_TEXT,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "11px",
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {(company.name || company.code || "C").slice(0, 1).toUpperCase()}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: "12px", color: DOCK_TEXT, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {company.name || "Company"}
                  </div>
                  <div style={{ fontSize: "10px", color: DOCK_TEXT_MUTED, textTransform: "capitalize" }}>
                    {company.status === "paused" ? "Paused" : "Active"}
                  </div>
                </div>
              </div>
            </div>
            <div style={{ padding: "3px 6px 5px", fontSize: "9px", fontWeight: 700, color: DOCK_TEXT_MUTED, textTransform: "uppercase", letterSpacing: "0.1em" }}>
              Companies
            </div>
            <div style={{ display: "grid", gap: "2px", maxHeight: "180px", overflowY: "auto", paddingBottom: "5px" }}>
              {companies.map((candidate) => {
                const active = candidate.slug === company.slug;
                return (
                  <button
                    key={candidate.slug}
                    type="button"
                    role="menuitem"
                    onClick={(event) => {
                      event.stopPropagation();
                      setCompanyPickerOpen(false);
                      if (activeProject && activeProject.companySlug !== candidate.slug) {
                        setActiveProjectIfChanged(null);
                      }
                      if (!active) router.push(buildCanonicalDashboardPath(candidate.code));
                    }}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      gap: "7px",
                      padding: "5px 6px",
                      borderRadius: "8px",
                      border: "none",
                      background: active ? DOCK_BG_HOVER : "transparent",
                      color: active ? DOCK_TEXT : DOCK_TEXT_SECONDARY,
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        width: "20px",
                        height: "20px",
                        borderRadius: "7px",
                        border: `0.5px solid ${DOCK_BORDER}`,
                        background: active ? DOCK_BG_ELEVATED : "transparent",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                        fontSize: "10px",
                        fontWeight: 700,
                      }}
                    >
                      {(candidate.name || candidate.code || "C").slice(0, 1).toUpperCase()}
                    </span>
                    <span style={{ minWidth: 0, flex: 1, fontSize: "12px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {candidate.name}
                    </span>
                    {active ? <Check size={13} color={DOCK_TEXT} /> : null}
                  </button>
                );
              })}
            </div>
            <div style={{ borderTop: `0.5px solid ${DOCK_BORDER}`, paddingTop: "5px", display: "grid", gap: "2px" }}>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setCompanyPickerOpen(false);
                  router.push("/companies/new");
                }}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: "7px",
                  padding: "5px 6px",
                  borderRadius: "8px",
                  border: "none",
                  background: "transparent",
                  color: DOCK_TEXT,
                  cursor: "pointer",
                  textAlign: "left",
                  fontSize: "12px",
                  fontWeight: 500,
                }}
              >
                <Plus size={13} strokeWidth={2.2} />
                Create company
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  void handleToggleCompanyPause();
                }}
                disabled={companyPauseBusy}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: "7px",
                  padding: "5px 6px",
                  borderRadius: "8px",
                  border: "none",
                  background: "transparent",
                  color: DOCK_TEXT_SECONDARY,
                  cursor: companyPauseBusy ? "not-allowed" : "pointer",
                  textAlign: "left",
                  fontSize: "12px",
                  opacity: companyPauseBusy ? 0.5 : 1,
                }}
              >
                {company.status === "paused" ? <Play size={13} strokeWidth={2.2} /> : <Pause size={13} strokeWidth={2.2} />}
                {company.status === "paused" ? "Resume company" : "Pause company"}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {hasCompanyContext ? (
        <>
      <SectionHeader label="Operations" />
      {OPERATIONS_ITEMS.map((entry) => {
        const isTasks = entry.label === "Tasks";
        const href = operationsItemHref(cc, entry.label);
                const item =
          isTasks
            ? {
                ...entry,
                href,
                suppressHoverBorder: true,
                trailingAction: showCreateTaskAction ? (
                  <div
                    style={{
                      position: "absolute",
                      right: "6px",
                      top: "50%",
                      transform: "translateY(-50%)",
                      display: "inline-flex",
                      alignItems: "center",
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
                        border: `0.5px solid ${DOCK_BORDER}`,
                        background: DOCK_BG_ELEVATED,
                        color: DOCK_TEXT_SECONDARY,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                        transition: "all 120ms ease",
                      }}
                      onMouseEnter={(event) => {
                        event.currentTarget.style.border = `0.5px solid ${DOCK_BORDER_STRONG}`;
                        event.currentTarget.style.background = DOCK_BG_HOVER;
                        event.currentTarget.style.color = DOCK_TEXT;
                      }}
                      onMouseLeave={(event) => {
                        event.currentTarget.style.border = `0.5px solid ${DOCK_BORDER}`;
                        event.currentTarget.style.background = DOCK_BG_ELEVATED;
                        event.currentTarget.style.color = DOCK_TEXT_SECONDARY;
                      }}
                    >
                      <Plus size={11} strokeWidth={2.2} />
                    </button>
                  </div>
                ) : null,
              }
            : entry.label === "Dashboard"
              ? { ...entry, href, badgeText: activeAgentCount > 0 ? `${activeAgentCount} live` : undefined }
              : entry.label === "Inbox"
                ? { ...entry, href, suppressHoverBorder: true, badge: inboxUnreadCount > 0 ? inboxUnreadCount : undefined }
                : entry.label === "Goals"
                  ? { ...entry, href, badge: goalsPendingDraftCount > 0 ? goalsPendingDraftCount : undefined }
                  : { ...entry, href };
        return (
          <NavRow
            key={entry.label}
            item={{
              ...item,
              onRowMouseEnter: isTasks ? () => setShowCreateTaskAction(true) : undefined,
              onRowMouseLeave: isTasks ? () => setShowCreateTaskAction(false) : undefined,
            }}
            active={entry.label === "Inbox" ? (checkActive(href) || isApprovalPathForCurrentCompany) : checkActive(href)}
          />
        );
      })}

      <SectionDivider />
        </>
      ) : null}

      {hasCompanyContext ? (
        <>
      <SectionHeader
        label="Projects"
        collapsed={!projectsOpen}
        onToggle={() => setProjectsOpen((prev) => !prev)}
        onCreate={() => {
          setCreateProjectOpen(true);
        }}
        createAriaLabel="Create project"
      />
      {projectsOpen && (projectsPending ? (
        <div style={{ display: "grid", gap: "3px", padding: "0 4px" }}>
          <div style={shimmerStyle()} />
          <div style={shimmerStyle()} />
        </div>
      ) : visibleProjects.length === 0 ? (
        <p style={{ margin: "2px 8px 4px", fontSize: "10px", color: DOCK_TEXT_MUTED }}>No projects found.</p>
      ) : (
        visibleProjects.filter((p) => p.status !== "archived").map((project) => {
          const pSlug = project.slug || project.id;
          const defaultPath = buildCanonicalProjectTasksPath(cc, pSlug);
          const href = currentProjectSubpage
            ? defaultPath.replace(/\/tasks$/, `/${currentProjectSubpage}`)
            : defaultPath;
          return (
            <NavRow
              key={project.id}
              item={{
                href,
                label: project.name,
                leadingDotColor: project.color || DOCK_ACCENT,
              }}
              active={checkActive(href) || checkActive(`/${cc}/projects/${pSlug}`)}
            />
          );
        })
      ))}

      <SectionDivider />
        </>
      ) : null}

      {hasCompanyContext ? (
        <>
      <SectionHeader
        label="Agents"
        collapsed={!agentsOpen}
        onToggle={() => setAgentsOpen((prev) => !prev)}
        onCreate={() => {
          setCreateAgentOpen(true);
        }}
        createAriaLabel="Create agent"
      />
      {agentsOpen && (agentsPending ? (
        <div style={{ display: "grid", gap: "3px", padding: "0 4px" }}>
          <div style={shimmerStyle()} />
          <div style={shimmerStyle()} />
          <div style={shimmerStyle()} />
        </div>
      ) : currentCompanyAgents.length === 0 ? (
        <p style={{ margin: "2px 8px 4px", fontSize: "10px", color: DOCK_TEXT_MUTED }}>No agents registered.</p>
      ) : (
        currentCompanyAgents.map((agent) => {
          const agentSlug = agent.slug || agent.id;
          const agentNavLabel = formatAgentNavLabel(agent.name);
          const basePath = buildCanonicalAgentPath(cc, agentSlug);
          const href = currentAgentSubpage
            ? `${basePath}/${currentAgentSubpage}`
            : `${basePath}/dashboard`;
          const agentIsLive = isAgentLive({
            agentId: agent.id,
            agentStatus: agent.status,
            liveAgentIds,
            liveRunsByAgentId: runsByAgentId,
          });
          return (
            <NavRow
              key={agent.id}
              item={{
                href,
                label: agentNavLabel,
                ariaLabel: agent.name,
                hoverRevealText: formatAgentNavRole(agent),
                leadingNode: <AgentNavAvatar agent={agent} />,
                badgeText: agentIsLive
                  ? "Live"
                  : (agent.hireApprovalStatus === "pending" || agent.hireApprovalStatus === "revision_requested")
                    ? "Pending"
                    : undefined,
              }}
              active={checkActive(href)}
            />
          );
        })
      ))}

      <SectionDivider />
        </>
      ) : null}

      {hasCompanyContext ? (
        <>
          <SectionHeader
            label="Company"
            collapsed={!companyOpen}
            onToggle={() => setCompanyOpen((prev) => !prev)}
          />
          {companyOpen && (
            <>
              {COMPANY_ITEMS.map((entry) => {
                const href = companyItemHref(cc, entry.label);
                return <NavRow key={entry.label} item={{ ...entry, href }} active={checkActive(href)} />;
              })}
            </>
          )}

          <SectionDivider />
        </>
      ) : null}

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
          borderRadius: 8, border: `0.5px solid ${DOCK_BORDER}`,
          background: DOCK_BG_ELEVATED, color: DOCK_TEXT_SECONDARY,
          cursor: "pointer", transition: "all 120ms ease",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = DOCK_ACCENT_SOFT; e.currentTarget.style.color = DOCK_ACCENT; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = DOCK_BG_ELEVATED; e.currentTarget.style.color = DOCK_TEXT_SECONDARY; }}
      >
        <ChevronRight size={14} style={{ transform: "rotate(180deg)" }} />
      </button>
    </nav>
  );

  // When collapsed, show icon-only sidebar
  if (collapsed && !isMobile) {
    const collapsedItemsRaw: { href: string; icon: LucideIcon; label: string; dividerAfter?: boolean }[] = [
      ...(hasCompanyContext
        ? [
            { href: buildCanonicalNewTaskPath(cc), icon: SquarePen, label: "New Task" },
            { href: buildCanonicalDashboardPath(cc), icon: Building2, label: "Dashboard" },
            { href: buildCanonicalInboxPath(cc), icon: Inbox, label: "Inbox", dividerAfter: true },
            ...OPERATIONS_ITEMS.map((w, i) => ({ href: operationsItemHref(cc, w.label), icon: w.icon, label: w.label, dividerAfter: i === OPERATIONS_ITEMS.length - 1 })),
            ...COMPANY_ITEMS.map((c, i) => ({ href: companyItemHref(cc, c.label), icon: c.icon, label: c.label, dividerAfter: i === COMPANY_ITEMS.length - 1 })),
          ]
        : []),
      ...SYSTEM_ITEMS.map((s) => ({ href: s.href, icon: s.icon, label: s.label })),
    ];
    const collapsedItems = collapsedItemsRaw.filter((item, index, items) => {
      const key = `${item.href}:${item.label}`;
      return items.findIndex((candidate) => `${candidate.href}:${candidate.label}` === key) === index;
    });

    return (
      <nav
        className="task-detail-scrollbarless"
        aria-label="Primary (collapsed)"
        style={{
          position: "fixed", left: 0, top: 0, bottom: 0,
          width: `${DOCK_COLLAPSED_WIDTH}px`,
          background: DOCK_BG,
          borderRight: `0.5px solid ${DOCK_BORDER}`,
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
            <div key={`${item.href}:${item.label}`}>
              <Link
                href={item.href}
                prefetch={false}
                title={item.label}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 32, height: 32, borderRadius: 6,
                  background: active ? DOCK_BG_ACTIVE : "transparent",
                  border: active ? `0.5px solid ${DOCK_BORDER_ACTIVE}` : "0.5px solid transparent",
                  color: active ? DOCK_TEXT : DOCK_TEXT_SECONDARY,
                  textDecoration: "none", transition: "all 120ms ease",
                }}
              >
                <Icon size={15} strokeWidth={active ? 2.25 : 2} />
              </Link>
              {item.dividerAfter && (
                <div style={{ height: 0.5, width: 24, margin: "3px auto", background: DOCK_BORDER }} />
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
            border: `0.5px solid ${DOCK_BORDER}`,
            background: DOCK_BG_ELEVATED, color: DOCK_TEXT_SECONDARY,
            cursor: "pointer", transition: "all 120ms ease",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = DOCK_BG_HOVER; e.currentTarget.style.color = DOCK_TEXT; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = DOCK_BG_ELEVATED; e.currentTarget.style.color = DOCK_TEXT_SECONDARY; }}
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
          router.push(buildCanonicalProjectTasksPath(cc, project.slug));
        }}
        companyId={company.id ?? ""}
        companyCode={cc}
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
      <CreateTaskModal
        open={createTaskOpen}
        onClose={() => setCreateTaskOpen(false)}
        onCreated={() => {
          router.refresh();
        }}
        companySlug={company.slug}
        companyCode={cc}
        companyName={company.name}
      />
    </>
  );
}

export { DOCK_WIDTH, DOCK_COLLAPSED_WIDTH };
