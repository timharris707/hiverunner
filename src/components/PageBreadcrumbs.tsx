"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { getTaskDetail, listCompanies } from "@/lib/orchestration/client";

const LABEL_MAP: Record<string, string> = {
  agents: "Team",
  companies: "Companies",
  tasks: "Tasks",
  team: "Team",
  board: "Board",
  inbox: "Inbox",
  sessions: "Sessions",
  memory: "Memory",
  files: "Files",
  search: "Search",
  reports: "Reports",
  logs: "Logs",
  system: "System",
  costs: "Costs",
  reliability: "Reliability",
  calendar: "Calendar",
  workflows: "Workflows",
  cron: "Cron Jobs",
  settings: "Settings",
  terminal: "Terminal",
  systems: "Systems",
  office: "3D Office",
  factory: "Factory Floor",
  pipeline: "Pipeline",
  activity: "Activity",
  analytics: "Analytics",
  about: "About",
  approvals: "Approvals",
  skills: "Skills",
  hives: "Execution Hives",
  runtimes: "Execution Hives",
  "runtime-inventory": "Runtime Inventory",
  git: "Git",
  projects: "Projects",
  overview: "Overview",
  workspaces: "Workspaces",
  configuration: "Configuration",
  budget: "Budget",
  dashboard: "Dashboard",
  routines: "Routines",
  instructions: "Instructions",
  runs: "Runs",
  goals: "Goals",
  org: "Org",
  "manage-projects": "Manage Projects",
  export: "Export",
  import: "Import",
  ideas: "Ideas",
  voice: "Voice Chat",
  leadlag: "Lead/Lag Monitor",
};

/** Segments that are structural routing and should be hidden from breadcrumbs. */
const HIDDEN_SEGMENTS = new Set(["companies"]);

/**
 * Section membership for top-level company pages.
 * Maps URL segment → section label shown as the parent crumb.
 * Only applies when the segment is the first meaningful crumb (top-level company route).
 */
const SECTION_FOR_PAGE: Record<string, string> = {
  // Operations
  tasks: "Operations", dashboard: "Operations",
  inbox: "Operations", approvals: "Operations", routines: "Operations", goals: "Operations",
  // Company
  org: "Company", "manage-projects": "Company", skills: "Company", hives: "Company", runtimes: "Company", "runtime-inventory": "Company",
  costs: "Company", activity: "Company", files: "Company", settings: "Company",
  // Systems
  terminal: "Systems", sessions: "Systems", logs: "Systems",
  // Preserved standalone tools kept outside the core HiveRunner surface.
  ideas: "Preserved Tools", marketing: "Preserved Tools", voice: "Preserved Tools", leadlag: "Preserved Tools",
};

/**
 * Full-path overrides for compound routes where the segment-by-segment approach
 * would produce redundant crumbs.
 * Maps pathname → { section, label } to render exactly two crumbs.
 */
const PATH_CRUMBS: Record<string, { section: string; label: string }> = {
  "/systems/companies": { section: "Systems", label: "Manage Companies" },
};

/** Check if a segment looks like a short company code (e.g. NEV, TIM). */
function isCompanyCode(seg: string): boolean {
  return /^[A-Z]{2,5}$/.test(seg);
}

/** Check if a segment is a UUID (e.g. 5ffcef58-87f7-4da8-9c2d-7e56bc564903). */
function isUUID(seg: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg);
}

/** Check if a segment is a task key (e.g. NEV-26, TIM-103). */
function isTaskKey(seg: string): boolean {
  return /^[A-Z]{2,5}-\d+$/.test(seg);
}

/** Format a slug into a readable label: "hiverunner-orchestration" -> "HiveRunner Orchestration" */
function slugToLabel(slug: string): string {
  // Preserve task keys as-is (e.g. NEV-26)
  if (isTaskKey(slug)) return slug;
  return slug.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

interface PageBreadcrumbsProps {
  /** When true, renders inline (no bottom margin) — used inside the TopBar. */
  inline?: boolean;
}

export function PageBreadcrumbs({ inline = false }: PageBreadcrumbsProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const segments = pathname.split("/").filter(Boolean);
  const companySlug = segments.length === 2 && segments[0] === "companies" ? segments[1] : null;
  const routeTaskKey = segments.length >= 3 && segments[1] === "tasks" && isTaskKey(decodeURIComponent(segments[2]))
    ? decodeURIComponent(segments[2])
    : null;
  const inboxTaskParam = searchParams.get("task");
  const inboxTaskKey = segments.length >= 2 && segments[1] === "inbox" && inboxTaskParam && isTaskKey(inboxTaskParam)
    ? inboxTaskParam
    : null;
  const breadcrumbTaskKey = routeTaskKey ?? inboxTaskKey;
  const [resolvedCompanyName, setResolvedCompanyName] = useState(companySlug ? slugToLabel(companySlug) : "");
  const [resolvedTaskTitle, setResolvedTaskTitle] = useState<{ taskKey: string; title: string } | null>(null);
  const currentTaskTitle = breadcrumbTaskKey && resolvedTaskTitle?.taskKey === breadcrumbTaskKey ? resolvedTaskTitle.title : "";

  useEffect(() => {
    if (!companySlug) return;

    let alive = true;
    listCompanies()
      .then((rows) => {
        if (!alive) return;
        const match = rows.find((row) => row.slug === companySlug);
        setResolvedCompanyName((match?.name ?? "").trim() || slugToLabel(companySlug));
      })
      .catch(() => {
        if (!alive) return;
        setResolvedCompanyName(slugToLabel(companySlug));
      });

    return () => { alive = false; };
  }, [companySlug]);

  useEffect(() => {
    if (!breadcrumbTaskKey) {
      return;
    }

    let alive = true;
    getTaskDetail(breadcrumbTaskKey)
      .then((detail) => {
        if (!alive) return;
        setResolvedTaskTitle({ taskKey: breadcrumbTaskKey, title: detail?.task.title?.trim() ?? "" });
      })
      .catch(() => {
        if (!alive) return;
        setResolvedTaskTitle({ taskKey: breadcrumbTaskKey, title: "" });
      });

    return () => { alive = false; };
  }, [breadcrumbTaskKey]);

  if (companySlug) {
    return (
      <nav
        className={`flex items-center gap-1.5${inline ? "" : " mb-3"}`}
        style={{ fontSize: inline ? "13px" : "12px", color: "var(--text-muted)" }}
      >
        <Link href="/companies" className="transition-opacity hover:opacity-80" style={{ color: "var(--text-muted)", textDecoration: "none" }}>
          Company
        </Link>
        <span className="flex items-center gap-1.5">
          <ChevronRight size={10} style={{ color: "var(--text-muted)", opacity: 0.5 }} />
          <span style={{ color: "var(--text-secondary)", fontWeight: 500 }}>
            {resolvedCompanyName}
          </span>
        </span>
      </nav>
    );
  }

  if (pathname === "/") {
    if (inline) {
      // Root always redirects — show app name as neutral placeholder
      return (
        <span
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: "13px",
            fontWeight: 600,
            color: "var(--text-primary)",
            letterSpacing: "0.02em",
          }}
        >
          Dashboard
        </span>
      );
    }
    return null;
  }

  // Check for full-path overrides for compound routes.
  const pathOverride = PATH_CRUMBS[pathname];

  // Build crumbs
  const crumbs: { label: string; href: string; isLast: boolean }[] = [];
  if (pathOverride) {
    crumbs.push({ label: pathOverride.section, href: "", isLast: false });
    crumbs.push({ label: pathOverride.label, href: pathname, isLast: true });
  } else {
    // Default: build crumbs segment-by-segment, skipping structural/noise segments
    let sectionInserted = false;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (HIDDEN_SEGMENTS.has(seg) || isCompanyCode(seg)) continue;

      // Insert section parent crumb (Operations / Company / Systems / Preserved Tools) only when
      // the segment is the first meaningful crumb (top-level route).
      if (!sectionInserted && crumbs.length === 0) {
        const section = SECTION_FOR_PAGE[seg];
        if (section) {
          sectionInserted = true;
          crumbs.push({ label: section, href: "", isLast: false });
        }
      }

      const label = isUUID(seg) ? "Detail" : (LABEL_MAP[seg] ?? slugToLabel(seg));
      const href = "/" + segments.slice(0, i + 1).join("/");
      crumbs.push({ label, href, isLast: i === segments.length - 1 });
    }
    if (routeTaskKey && currentTaskTitle) {
      const last = crumbs.at(-1);
      if (last?.label === routeTaskKey) {
        last.isLast = false;
        crumbs.push({ label: currentTaskTitle, href: pathname, isLast: true });
      }
    }
    if (inboxTaskKey) {
      const last = crumbs.at(-1);
      if (last) last.isLast = false;
      crumbs.push({
        label: inboxTaskKey,
        href: `${pathname}?task=${encodeURIComponent(inboxTaskKey)}`,
        isLast: !currentTaskTitle,
      });
      if (currentTaskTitle) {
        crumbs.push({ label: currentTaskTitle, href: `${pathname}?task=${encodeURIComponent(inboxTaskKey)}`, isLast: true });
      }
    }
  }

  if (crumbs.length === 0) {
    if (inline) {
      return (
        <span
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: "13px",
            fontWeight: 600,
            color: "var(--text-primary)",
            letterSpacing: "0.02em",
          }}
        >
          Dashboard
        </span>
      );
    }
    return null;
  }

  return (
    <nav
      className={`flex items-center gap-1.5${inline ? "" : " mb-3"}`}
      style={{ fontSize: inline ? "13px" : "12px", color: "var(--text-muted)" }}
    >
      {crumbs.map((crumb, i) => (
        <span key={`${crumb.href || crumb.label}:${i}`} className="flex items-center gap-1.5">
          {i > 0 && <ChevronRight size={10} style={{ color: "var(--text-muted)", opacity: 0.5 }} />}
          {crumb.isLast ? (
            <span style={{ color: "var(--text-secondary)", fontWeight: 500 }}>
              {crumb.label}
            </span>
          ) : crumb.href ? (
            <Link
              href={crumb.href}
              className="transition-opacity hover:opacity-80"
              style={{ color: "var(--text-muted)", textDecoration: "none" }}
            >
              {crumb.label}
            </Link>
          ) : (
            <span style={{ color: "var(--text-muted)" }}>
              {crumb.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}
