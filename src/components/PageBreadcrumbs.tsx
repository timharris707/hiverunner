"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";

const LABEL_MAP: Record<string, string> = {
  trading: "Trading Desk",
  advisory: "Advisory Board",
  agents: "Team",
  companies: "Companies",
  tasks: "Tasks",
  issues: "Tasks",
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
  office: "3D Office",
  factory: "Factory Floor",
  pipeline: "Pipeline",
  activity: "Activity",
  analytics: "Analytics",
  about: "About",
  approvals: "Approvals",
  skills: "Skills",
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
  export: "Export",
  import: "Import",
};

/** Segments that are structural routing and should be hidden from breadcrumbs. */
const HIDDEN_SEGMENTS = new Set(["companies"]);

/** Check if a segment looks like a short company code (e.g. NEV, TIM). */
function isCompanyCode(seg: string): boolean {
  return /^[A-Z]{2,5}$/.test(seg);
}

/** Format a slug into a readable label: "mission-control-orchestration" → "Mission Control Orchestration" */
function slugToLabel(slug: string): string {
  return slug.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

export function PageBreadcrumbs() {
  const pathname = usePathname();

  if (pathname === "/" || pathname.startsWith("/advisory")) return null;

  const segments = pathname.split("/").filter(Boolean);

  // Build crumbs, skipping structural/noise segments
  const crumbs: { label: string; href: string; isLast: boolean }[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    // Skip hidden structural segments and company codes
    if (HIDDEN_SEGMENTS.has(seg) || isCompanyCode(seg)) continue;

    const label = LABEL_MAP[seg] ?? slugToLabel(seg);
    const href = "/" + segments.slice(0, i + 1).join("/");
    crumbs.push({ label, href, isLast: i === segments.length - 1 });
  }

  if (crumbs.length === 0) return null;

  return (
    <nav
      className="flex items-center gap-1.5 mb-3"
      style={{ fontSize: "12px", color: "var(--text-muted)" }}
    >
      {crumbs.map((crumb, i) => (
        <span key={crumb.href} className="flex items-center gap-1.5">
          {i > 0 && <ChevronRight size={10} style={{ color: "var(--text-muted)", opacity: 0.5 }} />}
          {crumb.isLast ? (
            <span style={{ color: "var(--text-secondary)", fontWeight: 500 }}>
              {crumb.label}
            </span>
          ) : (
            <Link
              href={crumb.href}
              className="transition-opacity hover:opacity-80"
              style={{ color: "var(--text-muted)", textDecoration: "none" }}
            >
              {crumb.label}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}
